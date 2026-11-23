import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@jinshan/protocol';
import { createGameServer } from '../server.js';

async function fixture(t: TestContext, disconnectGraceMs = 2_000) {
  const server = createGameServer({
    port: 0, host: '127.0.0.1', dbPath: ':memory:',
    withDealing: false, botDelayMs: 60_000, disconnectGraceMs,
  });
  const { port } = await server.start();
  t.after(() => server.stop());
  const base = `http://127.0.0.1:${port}`;

  async function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await once(socket, 'open');
    return socket;
  }

  async function register(username: string): Promise<string> {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'suitable_test_password' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    return ((await res.json()) as { token: string }).token;
  }

  return { base, connect, register, server };
}

function receive<T extends ServerMessage['type']>(
  ws: WebSocket,
  type: T,
  predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
): Promise<Extract<ServerMessage, { type: T }>> {
  type Result = Extract<ServerMessage, { type: T }>;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('close', onClose);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2_000);
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (message.type !== type || !predicate(message as Result)) return;
      cleanup();
      resolve(message as Result);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Socket closed before ${type}`));
    };
    ws.on('message', onMessage);
    ws.once('close', onClose);
  });
}

function request<T extends ServerMessage['type']>(ws: WebSocket, payload: ClientMessage, type: T) {
  const response = receive(ws, type);
  ws.send(JSON.stringify(payload));
  return response;
}

test('registered seats reconnect only with the same account, and summaries hide seat credentials', async (t) => {
  const { base, connect, register } = await fixture(t);
  const token = await register('first_user');
  const otherToken = await register('other_user');
  const host = await connect();
  const joined = await request(host, { type: 'CREATE_ROOM', playerName: 'unused', authToken: token }, 'ROOM_JOINED');
  const { roomId, playerId } = joined;
  assert.ok(playerId);
  const publicResponse = await fetch(`${base}/api/rooms`);
  const summaries = (await publicResponse.json()) as { rooms: Array<typeof joined.room> };
  assert.ok(joined.room.seats.every((seat) => seat.playerId === null));
  assert.deepEqual(summaries.rooms.map((room) => room.roomId), [roomId]);
  assert.ok(summaries.rooms[0].seats.every((seat) => seat.playerId === null));

  const replacement = await connect();
  assert.equal((await request(replacement, {
    type: 'JOIN_ROOM', roomId, playerName: 'unused', authToken: token,
  }, 'ACTION_ERROR')).code, 'ALREADY_SEATED');

  const reconnect = { type: 'RECONNECT', roomId, playerId } as const;
  assert.equal((await request(replacement, reconnect, 'ACTION_ERROR')).code, 'RECONNECT_AUTH_REQUIRED');
  assert.equal((await request(replacement, { ...reconnect, authToken: otherToken }, 'ACTION_ERROR')).code, 'RECONNECT_AUTH_REQUIRED');
  const closed = once(host, 'close');
  assert.equal((await request(replacement, { ...reconnect, authToken: token }, 'ROOM_JOINED')).playerId, playerId);
  assert.equal((await closed)[0], 4001);
});

test('waiting rooms preserve a disconnected seat, hand over host on leave, and close when empty', async (t) => {
  const { connect, server } = await fixture(t);
  const host = await connect();
  const guest = await connect();
  const created = await request(host, { type: 'CREATE_ROOM', playerName: '房主', fillBots: true }, 'ROOM_JOINED');
  const roomId = created.roomId;
  const joined = await request(guest, { type: 'JOIN_ROOM', roomId, playerName: '客人' }, 'ROOM_JOINED');
  const offline = receive(host, 'ROOM_UPDATED', (msg) => !msg.room.seats[joined.seat].connected);
  guest.close();
  assert.equal((await offline).room.seats[joined.seat].occupied, true);
  assert.equal((await request(host, { type: 'START_GAME' }, 'ACTION_ERROR')).code, 'PLAYER_OFFLINE');

  const restored = await connect();
  const result = await request(restored, { type: 'RECONNECT', roomId, playerId: joined.playerId }, 'ROOM_JOINED');
  assert.equal(result.seat, joined.seat);
  const transfer = receive(restored, 'ROOM_UPDATED', (msg) => msg.room.hostSeat === joined.seat);
  await request(host, { type: 'LEAVE_ROOM' }, 'ROOM_LEFT');
  assert.equal((await transfer).room.seats[created.seat].occupied, false);
  await request(restored, { type: 'LEAVE_ROOM' }, 'ROOM_LEFT');
  assert.equal(server.roomManager.getRoom(roomId), undefined);
});

test('leaving during an active game hands over to the bot and retains the private reconnect seat', async (t) => {
  const { connect, server } = await fixture(t);
  const host = await connect();
  const joined = await request(host, { type: 'CREATE_ROOM', playerName: '房主', mode: 'heixin', fillBots: true }, 'ROOM_JOINED');
  await request(host, { type: 'START_GAME' }, 'GAME_STATE');
  await request(host, { type: 'LEAVE_ROOM' }, 'ROOM_LEFT');
  const slot = server.roomManager.getRoom(joined.roomId)?.getSummary().seats[joined.seat];
  assert.equal(slot?.connected, false);
  assert.equal(slot?.autoBot, true);
  const state = receive(host, 'GAME_STATE');
  const restored = await request(host, { type: 'RECONNECT', roomId: joined.roomId, playerId: joined.playerId }, 'ROOM_JOINED');
  assert.equal(restored.room.seats[joined.seat].autoBot, false);
  assert.equal((await state).view.viewerSeat, joined.seat);
});

test('invalid account requests and expired credentials get structured errors', async (t) => {
  const { base, connect, register, server } = await fixture(t);
  const token = await register('expired_user');
  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const payloads = [
    { body: 'null', status: 400, code: 'INVALID_JSON' },
    { body: JSON.stringify({ extra: '字'.repeat(30_000) }), status: 413, code: 'PAYLOAD_TOO_LARGE' },
  ];
  for (const { body, status, code } of payloads) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(res.status, status);
    assert.equal(((await res.json()) as { code: string }).code, code);
  }
  const ws = await connect();
  const response = await request(ws, { type: 'CREATE_ROOM', playerName: 'guest', authToken: token }, 'ACTION_ERROR');
  assert.equal(response.code, 'UNAUTHORIZED');
  assert.equal(server.roomManager.listRooms().length, 0);
});

test('bounds repeated credential requests without blocking health checks', async (t) => {
  const { base } = await fixture(t);
  const attempt = () => fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  for (let i = 0; i < 20; i++) {
    const response = await attempt();
    assert.equal(response.status, 401);
    await response.json();
  }
  const throttled = await attempt();
  assert.equal(throttled.status, 429);
  assert.ok(Number(throttled.headers.get('Retry-After')) > 0);
  assert.equal(((await throttled.json()) as { code: string }).code, 'TOO_MANY_REQUESTS');
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
});
