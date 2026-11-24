import type {
  ClientMessage,
  GameMode,
  RoomSummary,
  RoundSettlement,
  Seat,
  ServerMessage,
} from '@jinshan/protocol';
import {
  RoomAdmissionError,
  type PeerSocketLike,
  type RoomHistorySink,
  type RoomTimingOptions,
} from './room.js';
import { RoomManager } from './roomManager.js';

export interface LocalRoundRecordedEvent {
  matchId: number;
  roomId: string;
  mode: GameMode;
  settlement: RoundSettlement;
  winnerSummary?: string;
}

export interface LocalHostOptions extends RoomTimingOptions {
  botDelayMs?: number;
  onRoomsChanged?: (rooms: RoomSummary[]) => void;
  onRoundRecorded?: (event: LocalRoundRecordedEvent) => void;
}

interface PeerContext {
  socket: PeerSocketLike;
  roomId: string | null;
  playerId: string | null;
}

class HostMessageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSeat(value: unknown): value is Seat {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isGameMode(value: unknown): value is GameMode {
  return value === 'hongxin' || value === 'heixin';
}

function badMessage(): never {
  throw new HostMessageError('INVALID_MESSAGE', '房间消息参数无效');
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') badMessage();
  return value;
}

function sanitizePlayerName(value: unknown): string {
  if (typeof value !== 'string') badMessage();
  return Array.from(value.trim()).slice(0, 16).join('');
}

function sendMsg(socket: PeerSocketLike, msg: ServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(msg));
  }
}

/**
 * Pure isomorphic room protocol host.
 *
 * Powers both:
 * 1. Pure offline single-player bot mode (1 local peer).
 * 2. Offline LAN hosting (1 local peer + up to 3 remote LAN peers bridged over native WS).
 */
export class LocalHostController {
  readonly roomManager: RoomManager;
  private readonly peers = new Map<string, PeerContext>();
  private nextMatchId = 1;
  private readonly matchMeta = new Map<number, { roomId: string; mode: GameMode }>();

  constructor(options: LocalHostOptions = {}) {
    const store: RoomHistorySink | undefined = options.onRoundRecorded
      ? {
          createMatch: (roomId, mode) => {
            const id = this.nextMatchId++;
            this.matchMeta.set(id, { roomId, mode });
            return id;
          },
          recordRound: (matchId, settlement, _stats, winnerSummary) => {
            const meta = this.matchMeta.get(matchId);
            if (!meta) return;
            options.onRoundRecorded?.({
              matchId,
              roomId: meta.roomId,
              mode: meta.mode,
              settlement,
              winnerSummary,
            });
          },
        }
      : undefined;

    this.roomManager = new RoomManager({
      store,
      botDelayMs: options.botDelayMs ?? 420,
      withDealing: options.withDealing,
      dealStepMs: options.dealStepMs,
      callWindowMs: options.callWindowMs,
      counterWindowMs: options.counterWindowMs,
      reCounterWindowMs: options.reCounterWindowMs,
      responseTimeoutMs: options.responseTimeoutMs,
      trickIntervalMs: options.trickIntervalMs,
      disconnectGraceMs: options.disconnectGraceMs ?? 15000,
      onRoomsChanged: options.onRoomsChanged,
    });
  }

  listRooms(): RoomSummary[] {
    return this.roomManager.listRooms();
  }

  connectPeer(peerId: string, socket: PeerSocketLike): void {
    const prev = this.peers.get(peerId);
    if (prev) {
      this.disconnectPeer(peerId);
    }
    this.peers.set(peerId, { socket, roomId: null, playerId: null });
  }

  disconnectPeer(peerId: string): void {
    const ctx = this.peers.get(peerId);
    if (!ctx) return;
    this.peers.delete(peerId);
    if (ctx.roomId && ctx.playerId) {
      const room = this.roomManager.getRoom(ctx.roomId);
      if (room) {
        room.handleDisconnect(ctx.playerId, ctx.socket);
        this.roomManager.pruneIfEmpty(ctx.roomId);
      }
    }
  }

  handleMessage(peerId: string, rawOrMessage: string | ClientMessage): void {
    const ctx = this.peers.get(peerId);
    if (!ctx || ctx.socket.readyState !== 1) return;

    let payload: unknown;
    if (typeof rawOrMessage === 'string') {
      try {
        payload = JSON.parse(rawOrMessage);
      } catch {
        sendMsg(ctx.socket, {
          type: 'ACTION_ERROR',
          code: 'INVALID_JSON',
          message: '消息格式错误',
        });
        return;
      }
    } else {
      payload = rawOrMessage;
    }

    try {
      if (!isJsonObject(payload) || typeof payload.type !== 'string') badMessage();
      const msg = payload as unknown as ClientMessage;

      if (msg.type === 'PING') {
        if (!Number.isFinite(msg.ts)) badMessage();
        sendMsg(ctx.socket, { type: 'PONG', ts: msg.ts, serverTs: Date.now() });
        return;
      }

      const previousRoom = ctx.roomId ? this.roomManager.getRoom(ctx.roomId) : undefined;
      const currentSeat = ctx.playerId
        ? previousRoom?.getSeatByPlayerId(ctx.playerId, ctx.socket) ?? null
        : null;

      if (msg.type === 'LEAVE_ROOM') {
        if (ctx.playerId && currentSeat !== null) {
          previousRoom?.leave(ctx.playerId, ctx.socket);
        }
        ctx.roomId = null;
        ctx.playerId = null;
        sendMsg(ctx.socket, { type: 'ROOM_LEFT' });
        return;
      }

      if (
        msg.type === 'CREATE_ROOM' ||
        msg.type === 'JOIN_ROOM' ||
        msg.type === 'RECONNECT'
      ) {
        if (currentSeat !== null) {
          throw new HostMessageError('ALREADY_IN_ROOM', '请先退出当前房间');
        }

        if (msg.type === 'CREATE_ROOM') {
          const mode = msg.mode === undefined ? 'hongxin' : msg.mode;
          if (!isGameMode(mode)) badMessage();
          const debugMode =
            msg.debugMode === undefined ? false : requireBoolean(msg.debugMode);
          const fillBots =
            msg.fillBots === undefined ? false : requireBoolean(msg.fillBots);
          const autoStart =
            msg.autoStart === undefined ? false : requireBoolean(msg.autoStart);
          if (autoStart && !fillBots) badMessage();
          const displayName = sanitizePlayerName(msg.playerName);
          const room = this.roomManager.createRoom({ mode, debugMode });
          const joined = room.addHuman(displayName, ctx.socket, 0, null);
          if (fillBots) {
            room.fillEmptySeatsWithBots();
            room.setRoomMode(joined.seat, mode);
          }
          ctx.roomId = room.roomId;
          ctx.playerId = joined.playerId;
          if (autoStart) room.startGame(joined.seat);
          return;
        }

        if (typeof msg.roomId !== 'string' || !/^\d{6}$/.test(msg.roomId)) badMessage();
        const room = this.roomManager.getRoom(msg.roomId);
        if (!room) throw new HostMessageError('ROOM_NOT_FOUND', '房间不存在或已关闭');

        if (msg.type === 'RECONNECT' || msg.playerId !== undefined) {
          if (
            typeof msg.playerId !== 'string' ||
            !/^[0-9a-f-]{36}$/.test(msg.playerId)
          ) {
            badMessage();
          }
          const ownerId = room.getSeatOwnerId(msg.playerId);
          if (ownerId === undefined) {
            throw new HostMessageError('RECONNECT_EXPIRED', '原座位已失效，请重新加入');
          }
          room.reconnect(msg.playerId, ctx.socket);
          ctx.roomId = room.roomId;
          ctx.playerId = msg.playerId;
          return;
        }

        if (msg.preferredSeat !== undefined && !isSeat(msg.preferredSeat)) badMessage();
        const displayName = sanitizePlayerName(msg.playerName);
        const joined = room.addHuman(displayName, ctx.socket, msg.preferredSeat, null);
        ctx.roomId = room.roomId;
        ctx.playerId = joined.playerId;
        return;
      }

      if (!previousRoom || currentSeat === null) {
        throw new HostMessageError('NOT_IN_ROOM', '请先创建或加入房间');
      }

      switch (msg.type) {
        case 'SET_ROOM_MODE':
          if (!isGameMode(msg.mode)) badMessage();
          previousRoom.setRoomMode(currentSeat, msg.mode);
          break;
        case 'SET_SEAT_BOT':
          if (!isSeat(msg.seat)) badMessage();
          previousRoom.setSeatBot(currentSeat, msg.seat, requireBoolean(msg.isBot));
          break;
        case 'SWAP_SEAT':
          if (!isSeat(msg.targetSeat)) badMessage();
          previousRoom.swapSeat(currentSeat, msg.targetSeat);
          break;
        case 'SET_READY':
          previousRoom.setReady(currentSeat, requireBoolean(msg.ready));
          break;
        case 'START_GAME':
          previousRoom.startGame(currentSeat);
          break;
        case 'GAME_ACTION':
          if (!isJsonObject(msg.action) || typeof msg.action.type !== 'string') {
            badMessage();
          }
          previousRoom.handleGameAction(currentSeat, msg.action);
          break;
        case 'SET_AUTO_BOT':
          previousRoom.setAutoBot(currentSeat, requireBoolean(msg.enabled));
          break;
        case 'TOGGLE_DEBUG_OPEN_HANDS':
          previousRoom.toggleDebugOpenHands(currentSeat, requireBoolean(msg.enabled));
          break;
        default:
          badMessage();
      }
    } catch (err) {
      if (err instanceof HostMessageError || err instanceof RoomAdmissionError) {
        sendMsg(ctx.socket, {
          type: 'ACTION_ERROR',
          code: err.code,
          message: err.message,
        });
      } else {
        sendMsg(ctx.socket, {
          type: 'ACTION_ERROR',
          code: 'HOST_ERROR',
          message: '操作失败',
        });
      }
    }
  }

  dispose(): void {
    this.roomManager.disposeAll();
    this.peers.clear();
    this.matchMeta.clear();
  }
}
