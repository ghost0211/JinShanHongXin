import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialMatchState, type GameState } from '@jinshan/game-core';
import type { ServerMessage } from '@jinshan/protocol';
import { WebSocket } from 'ws';
import { RoomAdmissionError, type GameRoom } from '../room.js';
import { RoomManager } from '../roomManager.js';

function connection() {
  const messages: ServerMessage[] = [];
  const closes: Array<[number | undefined, string | undefined]> = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send(raw: string) {
      messages.push(JSON.parse(raw) as ServerMessage);
    },
    close(code?: number, reason?: string) {
      closes.push([code, reason]);
    },
  };
  return { ws: socket as unknown as WebSocket, messages, closes };
}

// Feed the room a terminal state without relying on card draws or playing a match.
function settle(room: GameRoom, phase: 'ROUND_OVER' | 'MATCH_OVER'): void {
  const lifecycle = room as unknown as { applySuccessState(state: GameState): void };
  lifecycle.applySuccessState({ ...createInitialMatchState({ withDealing: true }), phase });
}

test('exposes the rejoin credential only at ROOM_JOINED top level and checks the active socket', (t) => {
  const manager = new RoomManager();
  t.after(() => manager.disposeAll());
  const room = manager.createRoom();
  const host = connection();
  const guest = connection();
  const newer = connection();
  const first = room.addHuman('房主', host.ws, 0, 42);
  const second = room.addHuman('游客', guest.ws);
  room.fillEmptySeatsWithBots();
  room.setRoomMode(first.seat, room.mode);

  for (const [client, ownId] of [[host, first.playerId], [guest, second.playerId]] as const) {
    const joined = client.messages.find((msg) => msg.type === 'ROOM_JOINED');
    assert.equal(joined?.playerId, ownId);
    for (const msg of client.messages) {
      if ('room' in msg) assert.ok(msg.room.seats.every((slot) => slot.playerId === null));
    }
  }
  assert.ok(manager.listRooms()[0].seats.every((slot) => slot.playerId === null));
  assert.equal(room.getSeatOwnerId(first.playerId), 42);
  assert.equal(room.getSeatOwnerId(second.playerId), null);
  assert.equal(room.getSeatOwnerId('bot-2'), undefined);
  assert.equal(room.getSeatByPlayerId(first.playerId, guest.ws), null);

  assert.equal(room.reconnect(first.playerId, newer.ws), first.seat);
  assert.deepEqual(host.closes, [[4001, 'Seat opened on another connection']]);
  room.handleDisconnect(first.playerId, host.ws);
  room.leave(first.playerId, host.ws);
  assert.equal(room.getSeatByPlayerId(first.playerId, host.ws), null);
  assert.equal(room.getSeatByPlayerId(first.playerId, newer.ws), first.seat);
  assert.equal(room.getSummary().seats[first.seat].connected, true);
});

test('retains a waiting seat through grace, blocks duplicate accounts and offline starts, then hands off host', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new RoomManager({ disconnectGraceMs: 25 });
  t.after(() => manager.disposeAll());
  const room = manager.createRoom();
  const host = connection();
  const guest = connection();
  const returning = connection();
  const first = room.addHuman('房主', host.ws, 0, 42);
  const second = room.addHuman('游客', guest.ws);
  const third = room.addHuman('另一个游客', connection().ws);
  room.setReady(second.seat, true);
  room.setReady(third.seat, true);
  room.fillEmptySeatsWithBots();

  room.handleDisconnect(second.playerId, guest.ws);
  room.startGame(first.seat);
  assert.equal(room.status, 'WAITING');
  assert.ok(host.messages.some((msg) => msg.type === 'ACTION_ERROR' && msg.code === 'PLAYER_OFFLINE'));
  room.reconnect(second.playerId, guest.ws);

  room.handleDisconnect(first.playerId, host.ws);
  manager.pruneIfEmpty(room.roomId);
  assert.equal(room.getSeatByPlayerId(first.playerId), first.seat);
  assert.equal(room.getSeatByPlayerId(first.playerId, host.ws), null);
  assert.equal(room.getSummary().hostSeat, first.seat);
  assert.equal(room.getSummary().seats[first.seat].connected, false);
  assert.throws(() => room.addHuman('重复账号', returning.ws, undefined, 42), (error) =>
    error instanceof RoomAdmissionError && error.code === 'ALREADY_SEATED');
  t.mock.timers.tick(24);
  assert.equal(manager.getRoom(room.roomId), room);
  room.reconnect(first.playerId, returning.ws);
  t.mock.timers.tick(1);
  assert.equal(room.getSeatByPlayerId(first.playerId, returning.ws), first.seat);

  room.setReady(second.seat, false);
  room.handleDisconnect(first.playerId, returning.ws);
  t.mock.timers.tick(25);
  const summary = room.getSummary();
  assert.equal(summary.seats[first.seat].occupied, false);
  assert.equal(room.getSeatOwnerId(first.playerId), undefined);
  assert.equal(summary.hostSeat, second.seat);
  assert.equal(summary.seats[second.seat].ready, true);
  assert.throws(() => room.reconnect(first.playerId, returning.ws));
  const admittedAgain = room.addHuman('原账号新入座', returning.ws, first.seat, 42);
  assert.equal(admittedAgain.seat, first.seat);
  assert.notEqual(admittedAgain.playerId, first.playerId);
});

test('reclaims a waiting room only after its final human seat is released (bots do not count)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new RoomManager({ disconnectGraceMs: 25 });
  t.after(() => manager.disposeAll());
  const waiting = manager.createRoom();
  const last = connection();
  const player = waiting.addHuman('掉线玩家', last.ws);
  waiting.fillEmptySeatsWithBots();
  waiting.handleDisconnect(player.playerId, last.ws);
  manager.pruneIfEmpty(waiting.roomId);
  t.mock.timers.tick(24);
  assert.equal(manager.getRoom(waiting.roomId), waiting);
  t.mock.timers.tick(1);
  assert.equal(manager.getRoom(waiting.roomId), undefined);

  const empty = manager.createRoom();
  const leaving = connection();
  const leaver = empty.addHuman('退房玩家', leaving.ws);
  empty.fillEmptySeatsWithBots();
  empty.leave(leaver.playerId, leaving.ws);
  assert.equal(manager.getRoom(empty.roomId), undefined);
  assert.deepEqual(leaving.closes, []);
});

test('immediately auto-plays an active leaver, retains the credential, and reclaims the empty finished match', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new RoomManager({ disconnectGraceMs: 25, dealStepMs: 1000 });
  t.after(() => manager.disposeAll());
  const room = manager.createRoom();
  const player = connection();
  const joined = room.addHuman('真人', player.ws, 0, 42);
  room.fillEmptySeatsWithBots();
  room.startGame(joined.seat);
  room.leave(joined.playerId, player.ws);
  const slot = room.getSummary().seats[joined.seat];
  assert.deepEqual([slot.occupied, slot.connected, slot.autoBot], [true, false, true]);
  assert.equal(room.getSeatOwnerId(joined.playerId), 42);
  assert.deepEqual(player.closes, []);
  manager.pruneIfEmpty(room.roomId);
  assert.equal(manager.getRoom(room.roomId), room);

  const returning = connection();
  assert.equal(room.reconnect(joined.playerId, returning.ws), joined.seat);
  assert.equal(room.getSummary().seats[joined.seat].autoBot, false);
  room.handleDisconnect(joined.playerId, returning.ws);
  t.mock.timers.tick(24);
  assert.equal(room.getSummary().seats[joined.seat].autoBot, false);
  t.mock.timers.tick(1);
  assert.equal(room.getSummary().seats[joined.seat].autoBot, true);
  settle(room, 'MATCH_OVER');
  assert.equal(manager.getRoom(room.roomId), undefined);
  assert.equal(room.getSeatOwnerId(joined.playerId), undefined);
});

test('keeps a finished match available to its connected humans until the final leave or disconnect', (t) => {
  const manager = new RoomManager();
  t.after(() => manager.disposeAll());
  const room = manager.createRoom();
  const first = connection();
  const second = connection();
  const host = room.addHuman('房主', first.ws);
  const guest = room.addHuman('游客', second.ws);
  settle(room, 'MATCH_OVER');
  assert.equal(manager.getRoom(room.roomId), room);
  room.leave(host.playerId, first.ws);
  assert.equal(room.getSeatOwnerId(host.playerId), undefined);
  assert.equal(room.getSummary().hostSeat, guest.seat);
  assert.equal(manager.getRoom(room.roomId), room);
  room.handleDisconnect(guest.playerId, second.ws);
  assert.equal(manager.getRoom(room.roomId), undefined);
});

test('only reclaims an unattended round at its idle deadline, reset by reconnection', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new RoomManager({ dealStepMs: 60 * 60 * 1000 });
  t.after(() => manager.disposeAll());
  const room = manager.createRoom();
  const player = connection();
  const joined = room.addHuman('真人', player.ws);
  room.fillEmptySeatsWithBots();
  room.startGame(joined.seat);
  room.leave(joined.playerId, player.ws);
  const idleMs = 30 * 60 * 1000;
  t.mock.timers.tick(idleMs);
  assert.equal(manager.getRoom(room.roomId), room);

  settle(room, 'ROUND_OVER');
  t.mock.timers.tick(idleMs - 1);
  const returning = connection();
  room.reconnect(joined.playerId, returning.ws);
  t.mock.timers.tick(1);
  assert.equal(manager.getRoom(room.roomId), room);
  room.leave(joined.playerId, returning.ws);
  t.mock.timers.tick(idleMs - 1);
  assert.equal(manager.getRoom(room.roomId), room);
  t.mock.timers.tick(1);
  assert.equal(manager.getRoom(room.roomId), undefined);
});

test('never overwrites an existing room when random room codes keep colliding', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const manager = new RoomManager();
  t.after(() => manager.disposeAll());
  const first = manager.createRoom();
  const second = manager.createRoom();
  const third = manager.createRoom();
  assert.equal(new Set([first.roomId, second.roomId, third.roomId]).size, 3);
  for (const room of [first, second, third]) {
    assert.match(room.roomId, /^[1-9]\d{5}$/);
    assert.equal(manager.getRoom(room.roomId), room);
  }
});
