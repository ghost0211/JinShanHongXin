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

    const pHostState = host.waitFor('GAME_STATE');
    const pGuestState = guest.waitFor('GAME_STATE');
    host.send({ type: 'START_GAME' });
    const [hostState, guestState] = await Promise.all([pHostState, pGuestState]);

    assert.equal(hostState.view.mode, 'heixin');
    assert.equal(hostState.view.phase, 'BIDDING');
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
});
