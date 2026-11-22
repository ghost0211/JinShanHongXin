import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import type { ClientMessage, PlayerView, ServerMessage } from '@jinshan/protocol';
import { createGameServer, type RunningGameServer } from '../server.js';

class TestWsClient {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[] = [];
  private waiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(msg);
      const nextWaiters: typeof this.waiters = [];
      for (const w of this.waiters) {
        if (w.predicate(msg)) {
          w.resolve(msg);
        } else {
          nextWaiters.push(w);
        }
      }
      this.waiters = nextWaiters;
    });
  }

  async open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', (err) => reject(err));
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor<T extends ServerMessage['type']>(
    type: T,
    extraPredicate?: (msg: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs = 8000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const predicate = (m: ServerMessage): m is Extract<ServerMessage, { type: T }> =>
      m.type === type && (!extraPredicate || extraPredicate(m as Extract<ServerMessage, { type: T }>));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for WS message ${type}`));
      }, timeoutMs);

      this.waiters.push({
        predicate: (m) => predicate(m),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

describe('WebSocket multiplayer server integration tests', () => {
  const activeServers: RunningGameServer[] = [];
  const activeClients: TestWsClient[] = [];

  afterEach(async () => {
    for (const c of activeClients) c.close();
    activeClients.length = 0;
    for (const s of activeServers) await s.stop();
    activeServers.length = 0;
  });

  async function startTestServer(botDelayMs = 5): Promise<{ server: RunningGameServer; baseUrl: string; wsUrl: string }> {
    const server = createGameServer({
      port: 0,
      host: '127.0.0.1',
      dbPath: ':memory:',
      botDelayMs,
      withDealing: true,
      dealStepMs: 2,
      callWindowMs: 40,
      counterWindowMs: 40,
      reCounterWindowMs: 25,
      responseTimeoutMs: 40,
      trickIntervalMs: 0,
      disconnectGraceMs: 15,
    });
    activeServers.push(server);
    const { port } = await server.start();
    return {
      server,
      baseUrl: `http://127.0.0.1:${port}`,
      wsUrl: `ws://127.0.0.1:${port}/ws`,
    };
  }

  it('handles lobby creation, joining, seat swap, dual mode toggle, and debug open-hands isolation', async () => {
    const { wsUrl } = await startTestServer(20);
    const host = new TestWsClient(wsUrl);
    const guest = new TestWsClient(wsUrl);
    activeClients.push(host, guest);
    await Promise.all([host.open(), guest.open()]);

    const pJoinedHost = host.waitFor('ROOM_JOINED');
    host.send({ type: 'CREATE_ROOM', playerName: '房主小明', mode: 'hongxin', debugMode: true });
    const joinedHost = await pJoinedHost;
    assert.equal(joinedHost.seat, 0);
    assert.equal(joinedHost.room.mode, 'hongxin');

    const pJoinedGuest = guest.waitFor('ROOM_JOINED');
    guest.send({ type: 'JOIN_ROOM', roomId: joinedHost.roomId, playerName: '小红' });
    const joinedGuest = await pJoinedGuest;
    assert.equal(joinedGuest.seat, 1);

    // Guest swaps to seat 2 (teammate of host), host switches mode to heixin, adds 2 bots
    const pGuestMoved = guest.waitFor('ROOM_JOINED', (m) => m.seat === 2);
    guest.send({ type: 'SWAP_SEAT', targetSeat: 2 });
    const moved = await pGuestMoved;
    assert.equal(moved.seat, 2);

    const pModeUpdated = host.waitFor('ROOM_UPDATED', (m) => m.room.mode === 'heixin');
    host.send({ type: 'SET_ROOM_MODE', mode: 'heixin' });
    await pModeUpdated;

    host.send({ type: 'SET_SEAT_BOT', seat: 1, isBot: true });
    const pFull = host.waitFor('ROOM_UPDATED', (m) => m.room.seats.every((s) => s.occupied));
    host.send({ type: 'SET_SEAT_BOT', seat: 3, isBot: true });
    await pFull;

    guest.send({ type: 'SET_READY', ready: true });
    await host.waitFor('ROOM_UPDATED', (m) => m.room.seats[2].ready === true);

    const pHostDeal = host.waitFor('GAME_STATE', (m) => m.view.phase === 'DEALING');
    const pHostBid = host.waitFor('GAME_STATE', (m) => m.view.phase === 'BIDDING');
    const pGuestBid = guest.waitFor('GAME_STATE', (m) => m.view.phase === 'BIDDING');
    host.send({ type: 'START_GAME' });
    const [hostDeal, hostState, guestState] = await Promise.all([pHostDeal, pHostBid, pGuestBid]);

    assert.equal(hostDeal.view.phase, 'DEALING');
    assert.equal(hostState.view.mode, 'heixin');
    assert.equal(hostState.view.phase, 'BIDDING');
    assert.equal(hostState.view.dealtCount, 38);
    // Normal view hides other players' hands and bottom
    assert.equal(hostState.view.debugView, undefined);
    assert.equal(guestState.view.debugView, undefined);
    assert.equal(hostState.view.revealedBottom, null);

    // Enable debug open hands -> exposes allHands & bipaiCounts
    const pDebugHost = host.waitFor('GAME_STATE', (m) => m.view.debugView !== undefined);
    host.send({ type: 'TOGGLE_DEBUG_OPEN_HANDS', enabled: true });
    const debugState = await pDebugHost;
    assert.ok(debugState.view.debugView);
    assert.equal(debugState.view.debugView.allHands[2].length, 38);
    assert.equal(debugState.view.debugView.bottomCards.length, 10);
  });

  it('supports mid-game disconnect auto-bot takeover and clean RECONNECT snapshot sync', async () => {
    const { wsUrl } = await startTestServer(15);
    const client = new TestWsClient(wsUrl);
    activeClients.push(client);
    await client.open();

    const pJoined = client.waitFor('ROOM_JOINED');
    client.send({ type: 'CREATE_ROOM', playerName: '测试玩家', fillBots: true });
    const joined = await pJoined;

    const pStart = client.waitFor('GAME_STATE');
    client.send({ type: 'START_GAME' });
    await pStart;

    // Disconnect and reconnect with playerId
    client.close();
    await new Promise((r) => setTimeout(r, 80));

    const reconnectedClient = new TestWsClient(wsUrl);
    activeClients.push(reconnectedClient);
    await reconnectedClient.open();

    const pReJoined = reconnectedClient.waitFor('ROOM_JOINED');
    const pReState = reconnectedClient.waitFor('GAME_STATE');
    reconnectedClient.send({
      type: 'RECONNECT',
      roomId: joined.roomId,
      playerId: joined.playerId,
    });
    const [reJoined, reState] = await Promise.all([pReJoined, pReState]);
    assert.equal(reJoined.seat, 0);
    assert.equal(reJoined.playerId, joined.playerId);
    assert.ok(reState.view.roundNumber === 1);
  });

  it('plays full hongxin and heixin rounds end-to-end over WebSocket and persists to SQLite history', async () => {
    const { baseUrl, wsUrl } = await startTestServer(2);

    // 1. Full hongxin round (1 auto-bot human + 3 bots)
    const c1 = new TestWsClient(wsUrl);
    activeClients.push(c1);
    await c1.open();

    const pJ1 = c1.waitFor('ROOM_JOINED');
    c1.send({ type: 'CREATE_ROOM', playerName: '红心主', mode: 'hongxin', fillBots: true });
    await pJ1;

    c1.send({ type: 'SET_AUTO_BOT', enabled: true });
    const pRoundOver1 = c1.waitFor(
      'GAME_STATE',
      (m) => m.view.phase === 'ROUND_OVER' || m.view.phase === 'MATCH_OVER',
      15000,
    );
    c1.send({ type: 'START_GAME' });
    const over1 = await pRoundOver1;
    assert.ok(over1.view.settlement);
    assert.equal(over1.view.settlement.mode, 'hongxin');
    assert.equal(over1.view.revealedBottom?.length, 10);

    // 2. Full heixin round (1 auto-bot human + 3 bots)
    const c2 = new TestWsClient(wsUrl);
    activeClients.push(c2);
    await c2.open();

    const pJ2 = c2.waitFor('ROOM_JOINED');
    c2.send({ type: 'CREATE_ROOM', playerName: '黑心主', mode: 'heixin', fillBots: true });
    await pJ2;

    c2.send({ type: 'SET_AUTO_BOT', enabled: true });
    const pRoundOver2 = c2.waitFor(
      'GAME_STATE',
      (m) => m.view.phase === 'ROUND_OVER',
      15000,
    );
    c2.send({ type: 'START_GAME' });
    const over2 = await pRoundOver2;
    assert.ok(over2.view.settlement);
    assert.equal(over2.view.settlement.mode, 'heixin');
    const scoreSum =
      over2.view.playerScores[0] +
      over2.view.playerScores[1] +
      over2.view.playerScores[2] +
      over2.view.playerScores[3];
    assert.equal(scoreSum, 0);

    // 3. Verify SQLite HTTP /api/history & /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const historyRes = await fetch(`${baseUrl}/api/history`);
    assert.equal(historyRes.status, 200);
    const historyJson = (await historyRes.json()) as {
      matches: Array<{ mode: string; rounds: Array<{ roundNumber: number }> }>;
    };
    assert.equal(historyJson.matches.length, 2);
    assert.equal(historyJson.matches[0].rounds.length, 1);
    assert.equal(historyJson.matches[1].rounds.length, 1);
  });

  it('serves built client bundle over HTTP when staticDir is configured', async () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const clientDist = resolve(__dirname, '../../../client/dist');
    if (!existsSync(clientDist)) return;

    const server = createGameServer({
      port: 0,
      host: '127.0.0.1',
      dbPath: ':memory:',
      staticDir: clientDist,
    });
    activeServers.push(server);
    const { port } = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('金山打红心'));
  });

  it('supports user registration, login, nickname update, logout, and per-user round stats/leaderboard', async () => {
    const { baseUrl, wsUrl } = await startTestServer(2);

    // 1. Register user
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'jinshan_ace',
        password: 'secret123',
        nickname: '金山牌王',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = (await regRes.json()) as {
      token: string;
      user: { id: number; username: string; nickname: string };
    };
    assert.equal(regData.user.username, 'jinshan_ace');
    assert.equal(regData.user.nickname, '金山牌王');

    // Duplicate registration rejected with 409
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'JINSHAN_ACE', password: 'otherpassword' }),
    });
    assert.equal(dupRes.status, 409);

    // Wrong password rejected with 401
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jinshan_ace', password: 'wrong' }),
    });
    assert.equal(badLogin.status, 401);

    // Valid login + profile nickname update
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jinshan_ace', password: 'secret123' }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as { token: string };

    const profRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.token}`,
      },
      body: JSON.stringify({ nickname: '红五大师' }),
    });
    assert.equal(profRes.status, 200);
    const profData = (await profRes.json()) as { user: { nickname: string } };
    assert.equal(profData.user.nickname, '红五大师');

    // 2. Play 1 authenticated heixin round -> verify stats recorded on user & leaderboard
    const ws = new TestWsClient(wsUrl);
    activeClients.push(ws);
    await ws.open();

    const pJoined = ws.waitFor('ROOM_JOINED');
    ws.send({
      type: 'CREATE_ROOM',
      playerName: 'ignored_when_authed',
      authToken: loginData.token,
      mode: 'heixin',
      fillBots: true,
    });
    const joined = await pJoined;
    assert.equal(joined.room.seats[0].name, '红五大师');
    assert.equal(joined.room.seats[0].userId, regData.user.id);

    ws.send({ type: 'SET_AUTO_BOT', enabled: true });
    const pDone = ws.waitFor('GAME_STATE', (m) => m.view.phase === 'ROUND_OVER', 15000);
    ws.send({ type: 'START_GAME' });
    await pDone;

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(meRes.status, 200);
    const meData = (await meRes.json()) as {
      user: { heixinGames: number; heixinTotalScore: number };
    };
    assert.equal(meData.user.heixinGames, 1);

    const lbRes = await fetch(`${baseUrl}/api/leaderboard`);
    assert.equal(lbRes.status, 200);
    const lbData = (await lbRes.json()) as { users: Array<{ username: string; heixinGames: number }> };
    assert.equal(lbData.users.length, 1);
    assert.equal(lbData.users[0].heixinGames, 1);

    // 3. Logout invalidates token
    const outRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(outRes.status, 200);
    const afterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(afterLogout.status, 401);
  });

  it('enforces mandatory inter-trick interval before each trick and exposes trickPauseMs & lastTrick', async () => {
    const server = createGameServer({
      port: 0,
      host: '127.0.0.1',
      dbPath: ':memory:',
      botDelayMs: 5,
      withDealing: false,
      callWindowMs: 30,
      counterWindowMs: 30,
      reCounterWindowMs: 20,
      responseTimeoutMs: 30,
      trickIntervalMs: 120,
    });
    activeServers.push(server);
    const { port } = await server.start();
    const ws = new TestWsClient(`ws://127.0.0.1:${port}/ws`);
    activeClients.push(ws);
    await ws.open();

    const pJoin = ws.waitFor('ROOM_JOINED');
    ws.send({ type: 'CREATE_ROOM', playerName: '间隔测试', mode: 'heixin', fillBots: true });
    await pJoin;

    ws.send({ type: 'SET_AUTO_BOT', enabled: true });
    const pTrick1Done = ws.waitFor(
      'GAME_STATE',
      (m) => m.view.phase === 'PLAYING' && m.view.lastTrick !== null && m.view.currentTrick.length === 0,
      8000,
    );
    ws.send({ type: 'START_GAME' });
    const trick1Done = await pTrick1Done;
    const tDone = Date.now();
    assert.ok(trick1Done.view.lastTrick && trick1Done.view.lastTrick.plays.length === 4);
    assert.ok((trick1Done.view.trickPauseMs ?? 0) > 0);

    // Wait for trick 2's first card -> must occur AFTER the mandatory trickIntervalMs!
    const trick2Lead = await ws.waitFor(
      'GAME_STATE',
      (m) => m.view.phase === 'PLAYING' && m.view.trickNumber === 2 && m.view.currentTrick.length === 1,
      5000,
    );
    const elapsed = Date.now() - tDone;
    assert.ok(elapsed >= 100, `expected >=100ms inter-trick interval, got ${elapsed}ms`);
    assert.equal(trick2Lead.view.currentTrick.length, 1);
  });

  it('ignores stale WS close after reconnect and honors disconnect grace period without hijacking turn', async () => {
    const server = createGameServer({
      port: 0,
      host: '127.0.0.1',
      dbPath: ':memory:',
      botDelayMs: 10,
      withDealing: false,
      trickIntervalMs: 0,
      disconnectGraceMs: 500,
    });
    activeServers.push(server);
    const { port } = await server.start();
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    const c1 = new TestWsClient(wsUrl);
    activeClients.push(c1);
    await c1.open();

    const pJoined = c1.waitFor('ROOM_JOINED');
    c1.send({ type: 'CREATE_ROOM', playerName: '防抢出测试', mode: 'heixin', fillBots: true });
    const joined = await pJoined;

    const pStarted = c1.waitFor('GAME_STATE', (m) => m.view.phase === 'BIDDING');
    c1.send({ type: 'START_GAME' });
    await pStarted;

    // Reconnect from a second socket BEFORE c1 closes (simulating stale close race!)
    const c2 = new TestWsClient(wsUrl);
    activeClients.push(c2);
    await c2.open();

    const pReJoined = c2.waitFor('ROOM_JOINED');
    c2.send({ type: 'RECONNECT', roomId: joined.roomId, playerId: joined.playerId });
    const reJoined = await pReJoined;
    assert.equal(reJoined.room.seats[0].autoBot, false);
    assert.equal(reJoined.room.seats[0].connected, true);

    // Wait 120ms for c1's close event to settle -> c2 must STILL be connected and NOT hijacked by autoBot!
    await new Promise((r) => setTimeout(r, 120));
    const room = server.roomManager.getRoom(joined.roomId)!;
    const summary = room.getSummary();
    assert.equal(summary.seats[0].connected, true);
    assert.equal(summary.seats[0].autoBot, false);
  });

  it('automatically plays remaining players last cards once the lead empties their hand (even with autoBot disabled)', async () => {
    const { wsUrl } = await startTestServer(4);
    const p0 = new TestWsClient(wsUrl);
    const p2 = new TestWsClient(wsUrl);
    activeClients.push(p0, p2);
    await Promise.all([p0.open(), p2.open()]);

    const j0 = p0.waitFor('ROOM_JOINED');
    p0.send({ type: 'CREATE_ROOM', playerName: '真人A', mode: 'heixin' });
    const joined0 = await j0;

    const j2 = p2.waitFor('ROOM_JOINED');
    p2.send({ type: 'JOIN_ROOM', roomId: joined0.roomId, playerName: '真人B' });
    await j2;

    // Move p2 to seat 2 and fill seats 1 & 3 with bots
    const moved2 = p2.waitFor('ROOM_JOINED', (m) => m.seat === 2);
    p2.send({ type: 'SWAP_SEAT', targetSeat: 2 });
    await moved2;

    p0.send({ type: 'SET_SEAT_BOT', seat: 1, isBot: true });
    const full = p0.waitFor('ROOM_UPDATED', (m) => m.room.seats.every((s) => s.occupied));
    p0.send({ type: 'SET_SEAT_BOT', seat: 3, isBot: true });
    await full;

    p2.send({ type: 'SET_READY', ready: true });
    await p0.waitFor('ROOM_UPDATED', (m) => m.room.seats[2].ready === true);

    // Let autoBot fast-forward until only 1 card remains at start of final trick,
    // then disable autoBot on BOTH humans and play ONLY the lead (if human) so at least one
    // non-autoBot human follower MUST be auto-played by the server!
    let disabledAutoBot = false;
    let manualLeadSent = false;
    let verifiedFollowerAutoPlay = false;

    const handleView = (client: TestWsClient, seat: 0 | 2, view: PlayerView) => {
      if (
        !disabledAutoBot &&
        view.phase === 'PLAYING' &&
        view.myHand.length === 1 &&
        view.currentTrick.length === 0
      ) {
        disabledAutoBot = true;
        p0.send({ type: 'SET_AUTO_BOT', enabled: false });
        p2.send({ type: 'SET_AUTO_BOT', enabled: false });
      }
      if (
        disabledAutoBot &&
        !manualLeadSent &&
        view.phase === 'PLAYING' &&
        view.currentTrick.length === 0 &&
        view.currentTurn === seat &&
        view.myHand.length === 1
      ) {
        manualLeadSent = true;
        // ONLY the leading human plays manually; the other human follower does NOT send PLAY_CARDS!
        client.send({
          type: 'GAME_ACTION',
          action: { type: 'PLAY_CARDS', seat, cardIds: [view.myHand[0].id] },
        });
      }
      if (
        disabledAutoBot &&
        view.phase === 'PLAYING' &&
        view.currentTrick.length > 0 &&
        view.currentTurn === seat &&
        view.myHand.length === view.currentTrick[0].cards.length
      ) {
        // Confirm at least one human with autoBot=false hit the forced final-hand follow state
        verifiedFollowerAutoPlay = true;
      }
    };

    p0.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      if (m.type === 'GAME_STATE') handleView(p0, 0, m.view);
    });
    p2.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      if (m.type === 'GAME_STATE') handleView(p2, 2, m.view);
    });

    p0.send({ type: 'SET_AUTO_BOT', enabled: true });
    p2.send({ type: 'SET_AUTO_BOT', enabled: true });

    const pRoundOver = p0.waitFor('GAME_STATE', (m) => m.view.phase === 'ROUND_OVER', 15000);
    p0.send({ type: 'START_GAME' });
    const over = await pRoundOver;

    assert.equal(over.view.phase, 'ROUND_OVER');
    assert.equal(disabledAutoBot, true, 'expected round to reach 1-card final trick');
    assert.equal(
      verifiedFollowerAutoPlay,
      true,
      'expected at least one non-autoBot human follower to be auto-played on final trick',
    );
  });
});
