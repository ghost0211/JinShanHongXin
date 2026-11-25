import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ServerMessage } from '@jinshan/protocol';
import { LocalHostController } from '../localHost.js';
import { DEAL_SPEED_MS, type PeerSocketLike } from '../room.js';

function createVirtualPeer() {
  let state = 1;
  const messages: ServerMessage[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const socket: PeerSocketLike = {
    get readyState() {
      return state;
    },
    send(raw: string) {
      messages.push(JSON.parse(raw) as ServerMessage);
    },
    close(code?: number, reason?: string) {
      state = 3;
      closes.push({ code, reason });
    },
  };
  return {
    socket,
    messages,
    closes,
    markClosed() {
      state = 3;
    },
  };
}

describe('LocalHostController (offline single-player & multi-peer LAN)', () => {
  it('runs a pure offline single-player room with 3 bots and emits room updates', (t) => {
    const snapshots: number[] = [];
    const host = new LocalHostController({
      withDealing: false,
      botDelayMs: 5,
      trickIntervalMs: 0,
      onRoomsChanged: (rooms) => snapshots.push(rooms.length),
    });
    t.after(() => host.dispose());

    const local = createVirtualPeer();
    host.connectPeer('local-host', local.socket);

    host.handleMessage('local-host', { type: 'PING', ts: 1234 });
    assert.equal(local.messages[0]?.type, 'PONG');

    host.handleMessage('local-host', {
      type: 'CREATE_ROOM',
      playerName: '离线玩家',
      mode: 'hongxin',
      debugMode: true,
      fillBots: true,
      autoStart: true,
    });

    const joined = local.messages.find((m) => m.type === 'ROOM_JOINED');
    assert.ok(joined && joined.type === 'ROOM_JOINED');
    assert.equal(joined.seat, 0);

    const updated = local.messages.findLast((m) => m.type === 'ROOM_UPDATED');
    assert.ok(updated && updated.type === 'ROOM_UPDATED');
    assert.equal(updated.room.seats.filter((s) => s.isBot).length, 3);

    const stateMsg = local.messages.find((m) => m.type === 'GAME_STATE');
    assert.ok(stateMsg && stateMsg.type === 'GAME_STATE');
    assert.equal(stateMsg.view.viewerSeat, 0);
    assert.equal(stateMsg.view.myHand.length, 38);
    assert.ok(snapshots.some((n) => n === 1));

    host.handleMessage('local-host', { type: 'LEAVE_ROOM' });
    assert.ok(local.messages.some((m) => m.type === 'ROOM_LEFT'));
  });

  it('hosts a multi-peer LAN room with seat privacy, bot fill, disconnect grace, and reconnect', (t) => {
    const host = new LocalHostController({
      withDealing: false,
      botDelayMs: 50,
      trickIntervalMs: 0,
      disconnectGraceMs: 5000,
    });
    t.after(() => host.dispose());

    const hostPeer = createVirtualPeer();
    const guest1 = createVirtualPeer();
    const guest2 = createVirtualPeer();
    const guest1Rejoin = createVirtualPeer();

    host.connectPeer('local-host', hostPeer.socket);
    host.connectPeer('lan:g1', guest1.socket);
    host.connectPeer('lan:g2', guest2.socket);

    host.handleMessage('local-host', {
      type: 'CREATE_ROOM',
      playerName: '安卓房主',
      mode: 'heixin',
      debugMode: false,
      fillBots: false,
    });

    const hostJoined = hostPeer.messages.find((m) => m.type === 'ROOM_JOINED');
    assert.ok(hostJoined && hostJoined.type === 'ROOM_JOINED');
    const roomId = hostJoined.roomId;
    assert.match(roomId, /^\d{6}$/);

    // Remote LAN guests join over raw JSON strings (same as native WS bridge)
    host.handleMessage(
      'lan:g1',
      JSON.stringify({ type: 'JOIN_ROOM', roomId, playerName: 'iPhone牌友' }),
    );
    host.handleMessage(
      'lan:g2',
      JSON.stringify({ type: 'JOIN_ROOM', roomId, playerName: '平板牌友' }),
    );

    const g1Joined = guest1.messages.find((m) => m.type === 'ROOM_JOINED');
    const g2Joined = guest2.messages.find((m) => m.type === 'ROOM_JOINED');
    assert.ok(g1Joined && g1Joined.type === 'ROOM_JOINED');
    assert.ok(g2Joined && g2Joined.type === 'ROOM_JOINED');
    assert.equal(g1Joined.seat, 1);
    assert.equal(g2Joined.seat, 2);

    // Guests ready up, host fills seat 3 with a bot, and starts the match
    host.handleMessage('lan:g1', { type: 'SET_READY', ready: true });
    host.handleMessage('lan:g2', { type: 'SET_READY', ready: true });
    host.handleMessage('local-host', { type: 'SET_SEAT_BOT', seat: 3, isBot: true });
    host.handleMessage('local-host', { type: 'START_GAME' });

    const hostView = hostPeer.messages.findLast((m) => m.type === 'GAME_STATE');
    const g1View = guest1.messages.findLast((m) => m.type === 'GAME_STATE');
    const g2View = guest2.messages.findLast((m) => m.type === 'GAME_STATE');
    assert.ok(hostView && hostView.type === 'GAME_STATE');
    assert.ok(g1View && g1View.type === 'GAME_STATE');
    assert.ok(g2View && g2View.type === 'GAME_STATE');

    // Every player only sees their own 38-card hand (no cross-seat leakage)
    assert.equal(hostView.view.viewerSeat, 0);
    assert.equal(g1View.view.viewerSeat, 1);
    assert.equal(g2View.view.viewerSeat, 2);
    assert.equal(hostView.view.debugView, undefined);
    assert.equal(g1View.view.debugView, undefined);
    const hostCardIds = new Set(hostView.view.myHand.map((c) => c.id));
    for (const c of g1View.view.myHand) {
      assert.equal(hostCardIds.has(c.id), false);
    }

    // Guest 1 disconnects briefly and reconnects from a new LAN peer socket
    host.disconnectPeer('lan:g1');
    host.connectPeer('lan:g1-rejoin', guest1Rejoin.socket);
    host.handleMessage('lan:g1-rejoin', {
      type: 'RECONNECT',
      roomId,
      playerId: g1Joined.playerId,
    });
    const rejoinJoined = guest1Rejoin.messages.find((m) => m.type === 'ROOM_JOINED');
    const rejoinState = guest1Rejoin.messages.find((m) => m.type === 'GAME_STATE');
    assert.ok(rejoinJoined && rejoinJoined.type === 'ROOM_JOINED');
    assert.equal(rejoinJoined.seat, 1);
    assert.ok(rejoinState && rejoinState.type === 'GAME_STATE');
    assert.equal(rejoinState.view.viewerSeat, 1);
  });

  it('supports independent ally and opponent bot difficulties on room create and mid-game host updates', (t) => {
    const host = new LocalHostController({
      withDealing: false,
      botDelayMs: 50,
      trickIntervalMs: 0,
    });
    t.after(() => host.dispose());

    const hostPeer = createVirtualPeer();
    const guest = createVirtualPeer();
    host.connectPeer('local-host', hostPeer.socket);
    host.connectPeer('lan:g1', guest.socket);

    host.handleMessage('local-host', {
      type: 'CREATE_ROOM',
      playerName: '房主',
      mode: 'hongxin',
      debugMode: false,
      fillBots: false,
      allyBotDifficulty: 'low',
      opponentBotDifficulty: 'medium',
    });

    const joined = hostPeer.messages.find((m) => m.type === 'ROOM_JOINED');
    assert.ok(joined && joined.type === 'ROOM_JOINED');
    assert.equal(joined.room.allyBotDifficulty, 'low');
    assert.equal(joined.room.opponentBotDifficulty, 'medium');

    host.handleMessage('lan:g1', {
      type: 'JOIN_ROOM',
      roomId: joined.roomId,
      playerName: '客座牌友',
    });

    // Non-host cannot modify bot difficulty
    host.handleMessage('lan:g1', {
      type: 'SET_BOT_DIFFICULTY',
      allyDifficulty: 'high',
      opponentDifficulty: 'low',
    });
    const guestErr = guest.messages.findLast((m) => m.type === 'ACTION_ERROR');
    assert.ok(guestErr && guestErr.type === 'ACTION_ERROR');
    assert.equal(guestErr.code, 'NOT_HOST');

    // Fill remaining seats with bots, start game, then host updates difficulty mid-game
    host.handleMessage('lan:g1', { type: 'SET_READY', ready: true });
    host.handleMessage('local-host', { type: 'SET_SEAT_BOT', seat: 2, isBot: true });
    host.handleMessage('local-host', { type: 'SET_SEAT_BOT', seat: 3, isBot: true });
    host.handleMessage('local-host', { type: 'START_GAME' });

    host.handleMessage('local-host', {
      type: 'SET_BOT_DIFFICULTY',
      allyDifficulty: 'high',
      opponentDifficulty: 'low',
    });
    const updated = hostPeer.messages.findLast((m) => m.type === 'ROOM_UPDATED');
    assert.ok(updated && updated.type === 'ROOM_UPDATED');
    assert.equal(updated.room.allyBotDifficulty, 'high');
    assert.equal(updated.room.opponentBotDifficulty, 'low');
  });

  it('supports 5-tier dealSpeed on room create, host live update, and blocks non-host changes', (t) => {
    // 5 is the fastest (original 340ms), 1..4 are progressively slower
    assert.equal(DEAL_SPEED_MS[5], 340);
    assert.ok(
      DEAL_SPEED_MS[1] > DEAL_SPEED_MS[2] &&
        DEAL_SPEED_MS[2] > DEAL_SPEED_MS[3] &&
        DEAL_SPEED_MS[3] > DEAL_SPEED_MS[4] &&
        DEAL_SPEED_MS[4] > DEAL_SPEED_MS[5],
    );

    const host = new LocalHostController({
      withDealing: true,
      botDelayMs: 50,
      trickIntervalMs: 0,
    });
    t.after(() => host.dispose());

    const hostPeer = createVirtualPeer();
    const guest = createVirtualPeer();
    host.connectPeer('local-host', hostPeer.socket);
    host.connectPeer('lan:g1', guest.socket);

    host.handleMessage('local-host', {
      type: 'CREATE_ROOM',
      playerName: '房主',
      mode: 'hongxin',
      debugMode: false,
      fillBots: false,
      dealSpeed: 2,
    });
    const joined = hostPeer.messages.find((m) => m.type === 'ROOM_JOINED');
    assert.ok(joined && joined.type === 'ROOM_JOINED');
    assert.equal(joined.room.dealSpeed, 2);

    host.handleMessage('lan:g1', {
      type: 'JOIN_ROOM',
      roomId: joined.roomId,
      playerName: '客座牌友',
    });

    // Non-host cannot change deal speed
    host.handleMessage('lan:g1', { type: 'SET_DEAL_SPEED', dealSpeed: 5 });
    const guestErr = guest.messages.findLast((m) => m.type === 'ACTION_ERROR');
    assert.ok(guestErr && guestErr.type === 'ACTION_ERROR');
    assert.equal(guestErr.code, 'NOT_HOST');

    // Host updates dealSpeed cleanly
    host.handleMessage('local-host', { type: 'SET_DEAL_SPEED', dealSpeed: 4 });
    const updated = hostPeer.messages.findLast((m) => m.type === 'ROOM_UPDATED');
    assert.ok(updated && updated.type === 'ROOM_UPDATED');
    assert.equal(updated.room.dealSpeed, 4);
  });
});
