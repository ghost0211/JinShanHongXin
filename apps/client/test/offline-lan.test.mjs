import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeQrCode } from '../src/utils/qrCode.ts';
import {
  clearLocalHistory,
  loadLocalHistory,
  recordLocalRound,
  summarizeLocalStats,
} from '../src/utils/localHistory.ts';
import {
  buildLanHostBridgeWsUrl,
  buildLanJoinUrl,
  getNativeLanHostStatusAsync,
  isNativeLanHostSupported,
  pollDiscoveredLanHostsAsync,
  startNativeLanDiscoveryAsync,
  startNativeLanHostAsync,
  stopNativeLanDiscoveryAsync,
  stopNativeLanHostAsync,
} from '../src/net/androidLan.ts';

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('offline QR encoder generates valid ISO-18004 matrices with finders, timing, and dark module', () => {
  const shortQr = encodeQrCode('http://10.0.0.1');
  assert.equal(shortQr.version, 1);
  assert.equal(shortQr.size, 21);

  const lanUrl = buildLanJoinUrl('192.168.43.1', 3001, '654321');
  assert.equal(lanUrl, 'http://192.168.43.1:3001/?lan=1&room=654321');
  const qr = encodeQrCode(lanUrl);
  assert.equal(qr.version, 3);
  assert.equal(qr.size, 29);

  // Verify 3 finder pattern centers (3x3 solid dark core) and mandatory dark module (size-8, 8)
  for (const [tr, tc] of [
    [0, 0],
    [0, qr.size - 7],
    [qr.size - 7, 0],
  ]) {
    assert.equal(qr.modules[tr][tc], true);
    assert.equal(qr.modules[tr + 1][tc + 1], false);
    assert.equal(qr.modules[tr + 3][tc + 3], true);
  }
  assert.equal(qr.modules[qr.size - 8][8], true);

  // Verify timing patterns alternate on row 6 / col 6
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(qr.modules[6][i], i % 2 === 0);
    assert.equal(qr.modules[i][6], i % 2 === 0);
  }

  // Verify 2-block Version 6 capacity works cleanly (120 bytes)
  const longQr = encodeQrCode('http://192.168.100.200:3001/?lan=1&room=123456&tag=' + 'a'.repeat(70));
  assert.equal(longQr.version, 6);
  assert.equal(longQr.size, 41);

  assert.throws(() => encodeQrCode('x'.repeat(140)));
});

test('local offline history records hongxin & heixin rounds and aggregates local stats', () => {
  const storage = makeStorage();
  assert.deepEqual(loadLocalHistory(storage), []);

  recordLocalRound(
    {
      matchId: 1,
      roomId: '100001',
      mode: 'hongxin',
      settlement: {
        mode: 'hongxin',
        roundNumber: 1,
        dealer: 0,
        bankerTeam: 'A',
        challengerTeam: 'B',
        tableChallengerPoints: 90,
        bottomPointsRaw: 0,
        bottomKilled: false,
        bottomBonusPoints: 0,
        totalChallengerScore: 90,
        bankerWon: true,
        earningTeam: 'A',
        earnedSteps: 1,
        penaltyAbsorbed: 0,
        actualLevelUp: 1,
        previousLevels: { A: 0, B: 0 },
        newLevels: { A: 1, B: 0 },
        previousPenalties: { A: 0, B: 0 },
        newPenalties: { A: 0, B: 0 },
        nextDealer: 2,
        matchWinner: null,
        revealedBottom: [],
      },
    },
    0,
    storage,
  );

  recordLocalRound(
    {
      matchId: 2,
      roomId: '200002',
      mode: 'heixin',
      winnerSummary: 'A队获胜',
      settlement: {
        mode: 'heixin',
        roundNumber: 1,
        dealer: 0,
        bankerTeam: 'A',
        challengerTeam: 'B',
        tableChallengerPoints: 200,
        bottomPointsRaw: 0,
        bottomKilled: false,
        bottomBonusPoints: 0,
        totalChallengerScore: 200,
        bankerWon: true,
        earningTeam: 'A',
        earnedSteps: 0,
        penaltyAbsorbed: 0,
        actualLevelUp: 0,
        previousLevels: { A: 0, B: 0 },
        newLevels: { A: 0, B: 0 },
        previousPenalties: { A: 0, B: 0 },
        newPenalties: { A: 0, B: 0 },
        nextDealer: 1,
        matchWinner: 'A',
        revealedBottom: [],
        scoreDeltas: { 0: 360, 1: -120, 2: -120, 3: -120 },
      },
    },
    0,
    storage,
  );

  const rows = loadLocalHistory(storage);
  assert.equal(rows.length, 2);
  const stats = summarizeLocalStats(rows);
  assert.equal(stats.totalMatches, 2);
  assert.equal(stats.hongxinRounds, 1);
  assert.equal(stats.hongxinWins, 1);
  assert.equal(stats.heixinRounds, 1);
  assert.equal(stats.heixinWins, 1);
  assert.equal(stats.heixinTotalScore, 360);

  clearLocalHistory(storage);
  assert.deepEqual(loadLocalHistory(storage), []);
});

test('LAN bridge URL helper encodes host token properly', () => {
  assert.equal(
    buildLanHostBridgeWsUrl(3001, 'abc123'),
    'ws://127.0.0.1:3001/host?token=abc123',
  );
  assert.equal(buildLanJoinUrl('192.168.1.8', 3002), 'http://192.168.1.8:3002/?lan=1');
});

test('Tauri desktop LAN bridge exposes native host and UDP discovery parity', async () => {
  const prevWindow = globalThis.window;
  const calls = [];
  try {
    globalThis.window = {
      __TAURI__: {
        core: {
          invoke: async (cmd, args) => {
            calls.push([cmd, args]);
            switch (cmd) {
              case 'lan_start_host':
                return {
                  ok: true,
                  port: 3001,
                  hostToken: 'deadbeef01234567',
                  ips: ['192.168.1.99'],
                  primaryIp: '192.168.1.99',
                };
              case 'lan_get_host_status':
                return {
                  running: true,
                  port: 3001,
                  hostToken: 'deadbeef01234567',
                  ips: ['192.168.1.99'],
                  primaryIp: '192.168.1.99',
                  guestCount: 2,
                };
              case 'lan_start_discovery':
                return true;
              case 'lan_get_discovered_hosts':
                return [
                  {
                    ip: '192.168.1.42',
                    port: 3001,
                    url: 'http://192.168.1.42:3001',
                    hostName: '安卓房主',
                    roomId: '123456',
                    mode: 'hongxin',
                    status: 'WAITING',
                    occupied: 2,
                    humanCount: 2,
                    maxSeats: 4,
                    isSelf: false,
                    lastSeenMs: Date.now(),
                  },
                ];
              default:
                return undefined;
            }
          },
        },
      },
    };

    assert.equal(isNativeLanHostSupported(), true);

    const started = await startNativeLanHostAsync(3001, 'PC房主');
    assert.equal(started.ok, true);
    assert.equal(started.port, 3001);
    assert.equal(started.primaryIp, '192.168.1.99');
    assert.equal(started.hostToken, 'deadbeef01234567');

    const status = await getNativeLanHostStatusAsync();
    assert.equal(status?.running, true);
    assert.equal(status?.guestCount, 2);

    assert.equal(await startNativeLanDiscoveryAsync(), true);
    const hosts = await pollDiscoveredLanHostsAsync();
    assert.equal(hosts.length, 1);
    assert.equal(hosts[0].hostName, '安卓房主');
    assert.equal(hosts[0].roomId, '123456');

    await stopNativeLanDiscoveryAsync();
    await stopNativeLanHostAsync();

    assert.deepEqual(
      calls.map(([c]) => c),
      [
        'lan_start_host',
        'lan_get_host_status',
        'lan_start_discovery',
        'lan_get_discovered_hosts',
        'lan_stop_discovery',
        'lan_stop_host',
      ],
    );
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});
