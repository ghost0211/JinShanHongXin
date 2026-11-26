import type {
  BotDifficulty,
  DealSpeed,
  GameAction,
  GameMode,
  GamePhase,
  RoomSeatInfo,
  RoomSummary,
  RoundSettlement,
  Seat,
  ServerMessage,
} from '@jinshan/protocol';
import { chooseBotAction, chooseBotDealingCallAction } from './bot.js';
import { getSeatTeam } from './cards.js';
import {
  applyAction,
  createInitialMatchState,
  getPlayerView,
  startNextRound,
} from './engine.js';
import type { GameState } from './types.js';

/** Minimal WebSocket-compatible peer transport (works with Node `ws`, browsers, Workers, and tests). */
export interface PeerSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const PEER_OPEN = 1;

export interface RoomRoundStatUpdate {
  userId: number;
  mode: GameMode;
  won: boolean;
  scoreDelta?: number;
}

export interface RoomHistorySink {
  createMatch(roomId: string, mode: GameMode): number;
  recordRound(
    matchId: number,
    settlement: RoundSettlement,
    userStatUpdates: RoomRoundStatUpdate[],
    winnerSummary?: string,
  ): void;
}

function generateUuid(): string {
  const c = globalThis.crypto as
    | { randomUUID?: () => string; getRandomValues?: (arr: Uint8Array) => Uint8Array }
    | undefined;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface SeatSlot {
  seat: Seat;
  occupied: boolean;
  playerId: string | null;
  userId: number | null;
  name: string;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  autoBot: boolean;
  ws: PeerSocketLike | null;
}

export interface RoomTimingOptions {
  withDealing?: boolean;
  dealStepMs?: number;
  callWindowMs?: number;
  counterWindowMs?: number;
  reCounterWindowMs?: number;
  responseTimeoutMs?: number;
  trickIntervalMs?: number;
  disconnectGraceMs?: number;
}

export const DEAL_SPEED_MS: Record<DealSpeed, number> = {
  1: 960,
  2: 760,
  3: 600,
  4: 460,
  5: 340,
};

export function isDealSpeed(value: unknown): value is DealSpeed {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export interface RoomOptions extends RoomTimingOptions {
  roomId: string;
  mode?: GameMode;
  debugMode?: boolean;
  allyBotDifficulty?: BotDifficulty;
  opponentBotDifficulty?: BotDifficulty;
  dealSpeed?: DealSpeed;
  botDelayMs?: number;
  store?: RoomHistorySink;
  onReclaim?: (room: GameRoom) => void;
  onSummaryChanged?: (room: GameRoom) => void;
}

export class RoomAdmissionError extends Error {
  constructor(
    readonly code: 'ROOM_FULL' | 'ROOM_ALREADY_STARTED' | 'ALREADY_SEATED',
    message: string,
  ) {
    super(message);
  }
}

function emptySeat(seat: Seat): SeatSlot {
  return {
    seat,
    occupied: false,
    playerId: null,
    userId: null,
    name: `空位 ${seat + 1}`,
    isBot: false,
    connected: false,
    ready: false,
    autoBot: false,
    ws: null,
  };
}

// An unattended room cannot advance past round settlement on its own.
const ABANDONED_ROUND_TTL_MS = 30 * 60 * 1000;

export class GameRoom {
  readonly roomId: string;
  mode: GameMode;
  readonly debugMode: boolean;
  debugOpenHands: boolean;
  allyBotDifficulty: BotDifficulty;
  opponentBotDifficulty: BotDifficulty;
  dealSpeed: DealSpeed;
  status: 'WAITING' | 'IN_GAME' | 'FINISHED' = 'WAITING';
  hostSeat: Seat = 0;

  private readonly botDelayMs: number;
  private readonly withDealing: boolean;
  private readonly dealStepMsOverride?: number;
  private readonly callWindowMs: number;
  private readonly counterWindowMs: number;
  private readonly reCounterWindowMs: number;
  private readonly responseTimeoutMs: number;
  private readonly trickIntervalMs: number;
  private readonly disconnectGraceMs: number;
  private readonly store?: RoomHistorySink;
  private readonly onReclaim?: (room: GameRoom) => void;
  private readonly onSummaryChanged?: (room: GameRoom) => void;
  private readonly seats: [SeatSlot, SeatSlot, SeatSlot, SeatSlot];
  private gameState: GameState | null = null;
  private matchId: number | null = null;

  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private dealTimer: ReturnType<typeof setTimeout> | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private abandonedRoundTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disconnectTimers = new Map<Seat, ReturnType<typeof setTimeout>>();
  private phaseDeadlineMs: number | null = null;
  private phaseWindowTotalSec: number | null = null;
  private phaseTimerKey: string | null = null;
  private trickPauseUntilMs: number | null = null;
  private disposed = false;

  constructor(options: RoomOptions) {
    this.roomId = options.roomId;
    this.mode = options.mode ?? 'hongxin';
    this.debugMode = options.debugMode ?? false;
    this.debugOpenHands = false;
    this.allyBotDifficulty = options.allyBotDifficulty ?? 'high';
    this.opponentBotDifficulty = options.opponentBotDifficulty ?? 'high';
    this.dealSpeed = options.dealSpeed ?? 5;
    this.botDelayMs = options.botDelayMs ?? 450;
    this.withDealing = options.withDealing ?? true;
    this.dealStepMsOverride = options.dealStepMs;
    this.callWindowMs = options.callWindowMs ?? 10000;
    this.counterWindowMs = options.counterWindowMs ?? 10000;
    this.reCounterWindowMs = options.reCounterWindowMs ?? 5000;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 10000;
    this.trickIntervalMs = options.trickIntervalMs ?? 500;
    this.disconnectGraceMs = options.disconnectGraceMs ?? 15000;
    this.store = options.store;
    this.onReclaim = options.onReclaim;
    this.onSummaryChanged = options.onSummaryChanged;

    this.seats = [emptySeat(0), emptySeat(1), emptySeat(2), emptySeat(3)];
  }

  private send(ws: PeerSocketLike | null, msg: ServerMessage): void {
    if (ws && ws.readyState === PEER_OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: PeerSocketLike | null, code: string, message: string): void {
    this.send(ws, { type: 'ACTION_ERROR', code, message });
  }

  getSummary(): RoomSummary {
    const seatsInfo: RoomSeatInfo[] = this.seats.map((s) => ({
      seat: s.seat,
      team: getSeatTeam(s.seat),
      occupied: s.occupied,
      // Reconnection credentials are only sent to the owning socket in ROOM_JOINED.
      playerId: null,
      userId: s.userId,
      name: s.name,
      isBot: s.isBot,
      connected: s.connected,
      ready: s.ready,
      autoBot: s.autoBot,
    }));
    return {
      roomId: this.roomId,
      mode: this.mode,
      status: this.status,
      debugMode: this.debugMode,
      debugOpenHands: this.debugOpenHands,
      allyBotDifficulty: this.allyBotDifficulty,
      opponentBotDifficulty: this.opponentBotDifficulty,
      dealSpeed: this.dealSpeed,
      hostSeat: this.hostSeat,
      seats: seatsInfo,
      roundNumber: this.gameState?.roundNumber ?? 0,
    };
  }

  private buildViewForSeat(seat: Seat) {
    const allowDebug = this.debugMode && this.debugOpenHands;
    const view = getPlayerView(this.gameState!, seat, allowDebug);
    const trickPauseMs =
      this.trickPauseUntilMs !== null
        ? Math.max(0, this.trickPauseUntilMs - Date.now())
        : null;
    return {
      ...view,
      phaseDeadlineMs: this.phaseDeadlineMs,
      phaseWindowTotalSec: this.phaseWindowTotalSec,
      trickPauseMs: trickPauseMs && trickPauseMs > 0 ? trickPauseMs : null,
    };
  }

  private broadcastRoomSummary(): void {
    const room = this.getSummary();
    for (const slot of this.seats) {
      if (!slot.isBot && slot.connected) {
        this.send(slot.ws, { type: 'ROOM_UPDATED', room });
      }
    }
    this.onSummaryChanged?.(this);
  }

  private broadcastGameState(): void {
    if (!this.gameState) return;
    for (const slot of this.seats) {
      if (!slot.isBot && slot.connected) {
        this.send(slot.ws, {
          type: 'GAME_STATE',
          view: this.buildViewForSeat(slot.seat),
        });
      }
    }
  }

  private findHumanSeat(playerId: string): SeatSlot | undefined {
    if (this.disposed) return undefined;
    return this.seats.find((s) => s.occupied && !s.isBot && s.playerId === playerId);
  }

  getSeatByPlayerId(playerId: string, ws?: PeerSocketLike): Seat | null {
    const slot = this.findHumanSeat(playerId);
    if (!slot || (ws !== undefined && (!slot.connected || slot.ws !== ws))) return null;
    return slot.seat;
  }

  getSeatOwnerId(playerId: string): number | null | undefined {
    return this.findHumanSeat(playerId)?.userId;
  }

  hasAnyConnectedHuman(): boolean {
    return this.seats.some((s) => !s.isBot && s.connected);
  }

  hasAnyOccupiedHuman(): boolean {
    return this.seats.some((s) => !s.isBot && s.occupied);
  }

  fillEmptySeatsWithBots(): void {
    for (const slot of this.seats) {
      if (!slot.occupied) {
        slot.occupied = true;
        slot.isBot = true;
        slot.playerId = `bot-${slot.seat}`;
        slot.userId = null;
        slot.name = `机器人 ${slot.seat + 1}`;
        slot.connected = true;
        slot.ready = true;
        slot.autoBot = true;
        slot.ws = null;
      }
    }
  }

  addHuman(
    playerName: string,
    ws: PeerSocketLike,
    preferredSeat?: Seat,
    userId: number | null = null,
  ): { playerId: string; seat: Seat } {
    if (this.disposed || this.status !== 'WAITING') {
      throw new RoomAdmissionError('ROOM_ALREADY_STARTED', '房间已关闭或游戏已经开始，无法加入新玩家');
    }
    if (userId !== null && this.seats.some((s) => s.occupied && !s.isBot && s.userId === userId)) {
      throw new RoomAdmissionError('ALREADY_SEATED', '该账号已在房间中，请使用原座位重连');
    }

    let targetSlot: SeatSlot | undefined;
    if (preferredSeat !== undefined && this.seats[preferredSeat]?.occupied === false) {
      targetSlot = this.seats[preferredSeat];
    }
    if (!targetSlot) {
      targetSlot = this.seats.find((s) => !s.occupied);
    }
    if (!targetSlot) {
      for (let i = 3; i >= 0; i--) {
        if (this.seats[i].isBot) {
          targetSlot = this.seats[i];
          break;
        }
      }
    }
    if (!targetSlot) {
      throw new RoomAdmissionError('ROOM_FULL', '房间已满');
    }

    let playerId: string;
    do {
      playerId = generateUuid();
    } while (this.findHumanSeat(playerId));
    const trimmedName = playerName.trim() || `玩家 ${targetSlot.seat + 1}`;
    const isFirstHuman = !this.hasAnyOccupiedHuman();

    targetSlot.occupied = true;
    targetSlot.playerId = playerId;
    targetSlot.userId = userId;
    targetSlot.name = trimmedName;
    targetSlot.isBot = false;
    targetSlot.connected = true;
    targetSlot.ready = isFirstHuman;
    targetSlot.autoBot = false;
    targetSlot.ws = ws;

    if (isFirstHuman) {
      this.hostSeat = targetSlot.seat;
    }

    this.send(ws, {
      type: 'ROOM_JOINED',
      roomId: this.roomId,
      playerId,
      seat: targetSlot.seat,
      room: this.getSummary(),
    });
    this.broadcastRoomSummary();

    return { playerId, seat: targetSlot.seat };
  }

  private clearDisconnectTimer(seat: Seat): void {
    const t = this.disconnectTimers.get(seat);
    if (t) {
      clearTimeout(t);
      this.disconnectTimers.delete(seat);
    }
  }

  reconnect(playerId: string, ws: PeerSocketLike): Seat {
    const slot = this.findHumanSeat(playerId);
    if (!slot) {
      throw new Error('无效的玩家会话，无法重连');
    }

    this.clearDisconnectTimer(slot.seat);
    const oldWs = slot.ws;
    // Bind the new socket before closing the previous one so its close event is stale.
    slot.ws = ws;
    slot.connected = true;
    slot.autoBot = false;
    this.syncAbandonedRoundTimer();

    if (oldWs && oldWs !== ws && oldWs.readyState === PEER_OPEN) {
      oldWs.close(4001, 'Seat opened on another connection');
    }

    if (this.gameState && this.gameState.currentTurn === slot.seat) {
      this.clearBotTimer();
      this.scheduleActivities();
    }

    this.send(ws, {
      type: 'ROOM_JOINED',
      roomId: this.roomId,
      playerId,
      seat: slot.seat,
      room: this.getSummary(),
    });
    this.broadcastRoomSummary();

    if (this.gameState) {
      this.send(ws, {
        type: 'GAME_STATE',
        view: this.buildViewForSeat(slot.seat),
      });
    }

    return slot.seat;
  }

  leave(playerId: string, ws: PeerSocketLike): void {
    const seat = this.getSeatByPlayerId(playerId, ws);
    if (seat === null) return;
    const slot = this.seats[seat];
    slot.connected = false;
    slot.ws = null;
    this.clearDisconnectTimer(seat);

    if (this.status === 'IN_GAME') {
      this.enableDisconnectedAutoBot(slot);
      this.syncAbandonedRoundTimer();
    } else {
      this.releaseHumanSeat(slot);
      this.broadcastRoomSummary();
      this.reclaimIfEmpty();
    }
  }

  handleDisconnect(playerId: string, ws?: PeerSocketLike): void {
    const seat = this.getSeatByPlayerId(playerId, ws);
    if (seat === null) return;
    const slot = this.seats[seat];
    if (!slot.connected) return;

    slot.connected = false;
    slot.ws = null;
    this.clearDisconnectTimer(seat);
    this.syncAbandonedRoundTimer();

    if (this.status === 'FINISHED' || this.disconnectGraceMs <= 0) {
      this.expireDisconnectedSeat(slot);
      return;
    }

    this.broadcastRoomSummary();
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(seat);
      this.expireDisconnectedSeat(slot);
    }, this.disconnectGraceMs);
    this.disconnectTimers.set(seat, timer);
  }

  private expireDisconnectedSeat(slot: SeatSlot): void {
    if (this.disposed || slot.connected || !slot.occupied || slot.isBot) return;
    if (this.status === 'IN_GAME') {
      this.enableDisconnectedAutoBot(slot);
    } else {
      this.releaseHumanSeat(slot);
      this.broadcastRoomSummary();
      this.reclaimIfEmpty();
    }
  }

  private enableDisconnectedAutoBot(slot: SeatSlot): void {
    slot.autoBot = true;
    this.broadcastRoomSummary();
    this.scheduleActivities();
  }

  private releaseHumanSeat(slot: SeatSlot): void {
    this.clearDisconnectTimer(slot.seat);
    Object.assign(slot, emptySeat(slot.seat));

    if (slot.seat === this.hostSeat) {
      const occupiedHumans = this.seats.filter((s) => !s.isBot && s.occupied);
      const nextHost = occupiedHumans.find((s) => s.connected) ?? occupiedHumans[0];
      if (nextHost) {
        this.hostSeat = nextHost.seat;
        nextHost.ready = true;
      }
    }
  }

  private reclaimIfEmpty(): void {
    if (this.status !== 'IN_GAME' && !this.hasAnyOccupiedHuman()) {
      this.onReclaim?.(this);
    }
  }

  private clearAbandonedRoundTimer(): void {
    if (this.abandonedRoundTimer !== null) {
      clearTimeout(this.abandonedRoundTimer);
      this.abandonedRoundTimer = null;
    }
  }

  private isAbandonedRound(): boolean {
    return (
      !this.disposed &&
      this.status === 'IN_GAME' &&
      this.gameState?.phase === 'ROUND_OVER' &&
      !this.hasAnyConnectedHuman()
    );
  }

  private syncAbandonedRoundTimer(): void {
    if (!this.onReclaim || !this.isAbandonedRound()) {
      this.clearAbandonedRoundTimer();
      return;
    }
    if (this.abandonedRoundTimer !== null) return;
    this.abandonedRoundTimer = setTimeout(() => {
      this.abandonedRoundTimer = null;
      if (this.isAbandonedRound()) this.onReclaim?.(this);
    }, ABANDONED_ROUND_TTL_MS);
    (this.abandonedRoundTimer as unknown as { unref?: () => void }).unref?.();
  }

  setRoomMode(actorSeat: Seat, mode: GameMode): void {
    if (this.status !== 'WAITING') {
      this.sendError(this.seats[actorSeat].ws, 'INVALID_STATE', '开局后不可切换模式');
      return;
    }
    if (actorSeat !== this.hostSeat) {
      this.sendError(this.seats[actorSeat].ws, 'NOT_HOST', '只有房主可以切换游戏模式');
      return;
    }
    this.mode = mode;
    this.broadcastRoomSummary();
  }

  setBotDifficulty(
    actorSeat: Seat,
    allyDifficulty: BotDifficulty,
    opponentDifficulty: BotDifficulty,
  ): void {
    if (actorSeat !== this.hostSeat) {
      this.sendError(this.seats[actorSeat].ws, 'NOT_HOST', '只有房主可以调整机器人难度');
      return;
    }
    this.allyBotDifficulty = allyDifficulty;
    this.opponentBotDifficulty = opponentDifficulty;
    this.broadcastRoomSummary();
  }

  setDealSpeed(actorSeat: Seat, dealSpeed: DealSpeed): void {
    if (actorSeat !== this.hostSeat) {
      this.sendError(this.seats[actorSeat].ws, 'NOT_HOST', '只有房主可以调整发牌速度');
      return;
    }
    this.dealSpeed = dealSpeed;
    this.broadcastRoomSummary();
    if (this.status === 'IN_GAME' && this.gameState?.phase === 'DEALING') {
      this.scheduleActivities();
    }
  }

  private getEffectiveDealStepMs(): number {
    return this.dealStepMsOverride ?? DEAL_SPEED_MS[this.dealSpeed];
  }

  private resolveBotDifficulty(seat: Seat): BotDifficulty {
    // Human players using autoBot (托管) always get strong assistance.
    if (!this.seats[seat].isBot) return 'high';
    if (this.mode === 'heixin') {
      const dealer = this.gameState?.dealer ?? null;
      if (dealer !== null) {
        const isAlly = (seat === dealer) === (this.hostSeat === dealer);
        return isAlly ? this.allyBotDifficulty : this.opponentBotDifficulty;
      }
      // During initial bidding before dealer is decided, all other seats compete against host
      return this.opponentBotDifficulty;
    }
    const isAlly = getSeatTeam(seat) === getSeatTeam(this.hostSeat);
    return isAlly ? this.allyBotDifficulty : this.opponentBotDifficulty;
  }

  setSeatBot(actorSeat: Seat, targetSeat: Seat, isBot: boolean): void {
    if (this.status !== 'WAITING') {
      this.sendError(this.seats[actorSeat].ws, 'INVALID_STATE', '开局后不可调整座位');
      return;
    }
    if (actorSeat !== this.hostSeat) {
      this.sendError(this.seats[actorSeat].ws, 'NOT_HOST', '只有房主可以增减机器人');
      return;
    }
    const target = this.seats[targetSeat];
    if (target.occupied && !target.isBot) {
      this.sendError(this.seats[actorSeat].ws, 'SEAT_OCCUPIED', '该座位已有真人玩家');
      return;
    }
    if (isBot) {
      target.occupied = true;
      target.isBot = true;
      target.playerId = `bot-${target.seat}`;
      target.userId = null;
      target.name = `机器人 ${target.seat + 1}`;
      target.connected = true;
      target.ready = true;
      target.autoBot = true;
      target.ws = null;
    } else {
      target.occupied = false;
      target.isBot = false;
      target.playerId = null;
      target.userId = null;
      target.name = `空位 ${target.seat + 1}`;
      target.connected = false;
      target.ready = false;
      target.autoBot = false;
      target.ws = null;
    }
    this.broadcastRoomSummary();
  }

  swapSeat(actorSeat: Seat, targetSeat: Seat): void {
    if (this.status !== 'WAITING') {
      this.sendError(this.seats[actorSeat].ws, 'INVALID_STATE', '开局后不可换座');
      return;
    }
    if (actorSeat === targetSeat) return;

    const from = this.seats[actorSeat];
    const to = this.seats[targetSeat];
    if (to.occupied && !to.isBot) {
      this.sendError(from.ws, 'SEAT_OCCUPIED', '目标座位已有真人玩家');
      return;
    }

    const temp = { ...to };
    to.occupied = from.occupied;
    to.playerId = from.playerId;
    to.userId = from.userId;
    to.name = from.name;
    to.isBot = from.isBot;
    to.connected = from.connected;
    to.ready = from.ready;
    to.autoBot = from.autoBot;
    to.ws = from.ws;

    if (temp.isBot) {
      from.occupied = true;
      from.isBot = true;
      from.playerId = `bot-${from.seat}`;
      from.userId = null;
      from.name = `机器人 ${from.seat + 1}`;
      from.connected = true;
      from.ready = true;
      from.autoBot = true;
      from.ws = null;
    } else {
      from.occupied = false;
      from.isBot = false;
      from.playerId = null;
      from.userId = null;
      from.name = `空位 ${from.seat + 1}`;
      from.connected = false;
      from.ready = false;
      from.autoBot = false;
      from.ws = null;
    }

    if (this.hostSeat === actorSeat) {
      this.hostSeat = targetSeat;
    }

    if (to.playerId && to.ws) {
      this.send(to.ws, {
        type: 'ROOM_JOINED',
        roomId: this.roomId,
        playerId: to.playerId,
        seat: to.seat,
        room: this.getSummary(),
      });
    }
    this.broadcastRoomSummary();
  }

  setReady(actorSeat: Seat, ready: boolean): void {
    if (this.status !== 'WAITING') return;
    const slot = this.seats[actorSeat];
    if (slot.isBot || !slot.occupied) return;
    slot.ready = actorSeat === this.hostSeat ? true : ready;
    this.broadcastRoomSummary();
  }

  setAutoBot(actorSeat: Seat, enabled: boolean): void {
    const slot = this.seats[actorSeat];
    if (slot.isBot || !slot.occupied) return;
    slot.autoBot = enabled;
    this.broadcastRoomSummary();
    if (this.status === 'IN_GAME') {
      if (enabled) {
        this.scheduleActivities();
      } else if (this.gameState?.currentTurn === actorSeat) {
        this.clearBotTimer();
        this.scheduleActivities();
      }
    }
  }

  toggleDebugOpenHands(actorSeat: Seat, enabled: boolean): void {
    if (!this.debugMode) {
      this.sendError(this.seats[actorSeat].ws, 'DEBUG_DISABLED', '当前房间未开启调试模式');
      return;
    }
    this.debugOpenHands = enabled;
    this.broadcastRoomSummary();
    this.broadcastGameState();
  }

  startGame(actorSeat: Seat): void {
    if (this.status !== 'WAITING') {
      this.sendError(this.seats[actorSeat].ws, 'INVALID_STATE', '游戏已经开始');
      return;
    }
    if (actorSeat !== this.hostSeat) {
      this.sendError(this.seats[actorSeat].ws, 'NOT_HOST', '只有房主可以开始游戏');
      return;
    }
    const emptySlot = this.seats.find((s) => !s.occupied);
    if (emptySlot) {
      this.sendError(this.seats[actorSeat].ws, 'NOT_FULL', '请先凑齐 4 名玩家或添加机器人补位');
      return;
    }
    const offlineHuman = this.seats.find((s) => !s.isBot && !s.connected);
    if (offlineHuman) {
      this.sendError(this.seats[actorSeat].ws, 'PLAYER_OFFLINE', `玩家 ${offlineHuman.name} 当前离线`);
      return;
    }
    const unreadyHuman = this.seats.find(
      (s) => !s.isBot && s.seat !== this.hostSeat && !s.ready,
    );
    if (unreadyHuman) {
      this.sendError(
        this.seats[actorSeat].ws,
        'NOT_READY',
        `玩家 ${unreadyHuman.name} 尚未准备`,
      );
      return;
    }

    this.status = 'IN_GAME';
    const initial = createInitialMatchState({
      mode: this.mode,
      withDealing: this.withDealing,
    });
    if (this.store) {
      this.matchId = this.store.createMatch(this.roomId, this.mode);
    }
    this.broadcastRoomSummary();
    this.applySuccessState(initial);
  }

  handleGameAction(actorSeat: Seat, action: GameAction): void {
    if (!this.gameState || this.status !== 'IN_GAME') {
      this.sendError(this.seats[actorSeat].ws, 'NOT_IN_GAME', '当前不在对局中');
      return;
    }

    if (
      action.type === 'DEAL_STEP' ||
      action.type === 'FINISH_CALL_WINDOW' ||
      action.type === 'FINISH_COUNTER_WINDOW'
    ) {
      this.sendError(this.seats[actorSeat].ws, 'FORBIDDEN_ACTION', '系统内部指令不允许手动提交');
      return;
    }

    if (action.type === 'NEXT_ROUND') {
      if (this.gameState.phase !== 'ROUND_OVER' || !this.gameState.settlement) {
        this.sendError(this.seats[actorSeat].ws, 'INVALID_PHASE', '当前不在局间结算状态');
        return;
      }
      const next = startNextRound(this.gameState, {
        withDealing: this.withDealing,
      });
      this.applySuccessState(next);
      return;
    }

    if (action.seat !== actorSeat) {
      this.sendError(this.seats[actorSeat].ws, 'SEAT_MISMATCH', '不能代其他座位提交操作');
      return;
    }

    if (
      action.type === 'PLAY_CARDS' &&
      this.gameState.phase === 'PLAYING' &&
      this.gameState.currentTrick.length === 0 &&
      this.trickPauseUntilMs !== null &&
      Date.now() < this.trickPauseUntilMs
    ) {
      this.sendError(
        this.seats[actorSeat].ws,
        'TRICK_INTERVAL',
        '新的一轮准备中，请稍候 0.5 秒出牌',
      );
      return;
    }

    const res = applyAction(this.gameState, action);
    if (!res.ok) {
      this.sendError(this.seats[actorSeat].ws, res.code, res.error);
      return;
    }

    this.applySuccessState(res.state);
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    this.phaseDeadlineMs = null;
    this.phaseWindowTotalSec = null;
    this.phaseTimerKey = null;
  }

  private clearDealTimer(): void {
    if (this.dealTimer) {
      clearTimeout(this.dealTimer);
      this.dealTimer = null;
    }
  }

  private clearBotTimer(): void {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  private ensurePhaseWindowTimer(
    key: string,
    durationMs: number,
    onTimeout: () => void,
  ): void {
    if (this.phaseTimerKey === key && this.phaseTimer !== null) {
      return;
    }
    this.clearPhaseTimer();
    this.phaseTimerKey = key;
    this.phaseDeadlineMs = Date.now() + durationMs;
    this.phaseWindowTotalSec = Math.max(1, Math.round(durationMs / 1000));
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      this.phaseDeadlineMs = null;
      this.phaseWindowTotalSec = null;
      this.phaseTimerKey = null;
      onTimeout();
    }, durationMs);
  }

  private applySuccessState(nextState: GameState): void {
    const prevPhase: GamePhase | undefined = this.gameState?.phase;
    const prevCompletedTricks = this.gameState?.completedTricks.length ?? 0;
    this.gameState = nextState;

    // Enforce mandatory inter-trick interval (default 500ms) before each trick starts
    if (
      nextState.phase === 'PLAYING' &&
      nextState.currentTrick.length === 0 &&
      this.trickIntervalMs > 0 &&
      (prevPhase !== 'PLAYING' ||
        nextState.completedTricks.length > prevCompletedTricks)
    ) {
      this.trickPauseUntilMs = Date.now() + this.trickIntervalMs;
    } else if (
      nextState.phase !== 'PLAYING' ||
      nextState.currentTrick.length > 0
    ) {
      this.trickPauseUntilMs = null;
    }

    if (
      (nextState.phase === 'ROUND_OVER' || nextState.phase === 'MATCH_OVER') &&
      prevPhase !== nextState.phase &&
      nextState.settlement &&
      this.store &&
      this.matchId !== null
    ) {
      const settlement = nextState.settlement;
      const userStatUpdates: RoomRoundStatUpdate[] = this.seats
        .filter((s) => !s.isBot && s.userId !== null)
        .map((s) => {
          if (settlement.mode === 'heixin') {
            const won =
              s.seat === settlement.dealer
                ? settlement.bankerWon
                : !settlement.bankerWon;
            return {
              userId: s.userId!,
              mode: settlement.mode,
              won,
              scoreDelta: settlement.scoreDeltas?.[s.seat] ?? 0,
            };
          }
          const won = getSeatTeam(s.seat) === settlement.earningTeam;
          return {
            userId: s.userId!,
            mode: settlement.mode,
            won,
          };
        });
      const winnerSummary =
        nextState.phase === 'MATCH_OVER' && nextState.matchWinner
          ? `${nextState.matchWinner}队获胜`
          : undefined;
      this.store.recordRound(this.matchId, settlement, userStatUpdates, winnerSummary);
    }

    if (nextState.phase === 'MATCH_OVER') {
      this.status = 'FINISHED';
      for (const slot of this.seats) {
        if (!slot.isBot && slot.occupied && !slot.connected) this.releaseHumanSeat(slot);
      }
      this.broadcastRoomSummary();
    }
    this.syncAbandonedRoundTimer();

    // Update phase deadline BEFORE broadcasting so clients get the exact countdown immediately
    this.syncPhaseTimerForState(nextState);
    this.broadcastGameState();
    this.scheduleActivities();
    if (nextState.phase === 'MATCH_OVER') this.reclaimIfEmpty();
  }

  private syncPhaseTimerForState(state: GameState): void {
    if (this.disposed) return;

    if (state.phase === 'CALLING') {
      const key = `CALLING:${state.roundNumber}`;
      this.ensurePhaseWindowTimer(key, this.callWindowMs, () => {
        if (this.disposed || !this.gameState || this.gameState.phase !== 'CALLING') return;
        const res = applyAction(this.gameState, { type: 'FINISH_CALL_WINDOW' });
        if (res.ok) this.applySuccessState(res.state);
      });
      return;
    }

    if (state.phase === 'COUNTER_BIDDING') {
      const attempts = state.callState.counterAttempts;
      const durationMs =
        attempts === 0 ? this.counterWindowMs : this.reCounterWindowMs;
      const key = `COUNTER:${state.roundNumber}:${attempts}`;
      this.ensurePhaseWindowTimer(key, durationMs, () => {
        if (this.disposed || !this.gameState || this.gameState.phase !== 'COUNTER_BIDDING') {
          return;
        }
        const res = applyAction(this.gameState, { type: 'FINISH_COUNTER_WINDOW' });
        if (res.ok) this.applySuccessState(res.state);
      });
      return;
    }

    if (state.phase === 'COUNTER_RESPONSE') {
      const callerSeat = state.callState.callerSeat;
      const attempts = state.callState.counterAttempts;
      const key = `RESPONSE:${state.roundNumber}:${attempts}:${callerSeat}`;
      this.ensurePhaseWindowTimer(key, this.responseTimeoutMs, () => {
        if (
          this.disposed ||
          !this.gameState ||
          this.gameState.phase !== 'COUNTER_RESPONSE' ||
          this.gameState.callState.callerSeat === null
        ) {
          return;
        }
        const res = applyAction(this.gameState, {
          type: 'DEFEND_COUNTER',
          seat: this.gameState.callState.callerSeat,
        });
        if (res.ok) this.applySuccessState(res.state);
      });
      return;
    }

    this.clearPhaseTimer();
  }

  private isForcedFinalHandTurn(state: GameState, seat: Seat): boolean {
    if (state.phase !== 'PLAYING' || state.currentTrick.length === 0) {
      return false;
    }
    const leadPlay = state.currentTrick[0];
    return (
      state.hands[leadPlay.seat].length === 0 &&
      state.hands[seat].length > 0 &&
      state.hands[seat].length === leadPlay.cards.length
    );
  }

  private scheduleActivities(): void {
    this.clearBotTimer();
    this.clearDealTimer();
    if (this.disposed || !this.gameState) return;
    const state = this.gameState;

    if (state.phase === 'ROUND_OVER' || state.phase === 'MATCH_OVER') {
      return;
    }

    // 1. Dealing animation ticker
    if (state.phase === 'DEALING') {
      this.dealTimer = setTimeout(() => {
        this.dealTimer = null;
        this.executeDealStep();
      }, this.getEffectiveDealStepMs());
      return;
    }

    // 2. Post-deal free CALLING window: let bots act after a short human head-start
    if (state.phase === 'CALLING') {
      const pendingBotSeats = ([0, 1, 2, 3] as Seat[]).filter(
        (s) =>
          (this.seats[s].isBot || this.seats[s].autoBot) &&
          !state.callState.passedSeats.includes(s),
      );
      if (pendingBotSeats.length > 0) {
        const hasPendingHuman = ([0, 1, 2, 3] as Seat[]).some(
          (s) =>
            !this.seats[s].isBot &&
            !this.seats[s].autoBot &&
            !state.callState.passedSeats.includes(s),
        );
        const delay = hasPendingHuman
          ? Math.min(Math.max(this.botDelayMs * 3, 1800), Math.floor(this.callWindowMs * 0.45))
          : this.botDelayMs;
        this.botTimer = setTimeout(() => {
          this.botTimer = null;
          this.executeCallingBot(pendingBotSeats[0]);
        }, delay);
      }
      return;
    }

    // 3. Free COUNTER_BIDDING window: any eligible bot acts (give human teammate a small head-start)
    if (state.phase === 'COUNTER_BIDDING') {
      const eligibleBots = state.callState.eligibleCounterSeats.filter(
        (s) => this.seats[s].isBot || this.seats[s].autoBot,
      );
      if (eligibleBots.length > 0) {
        const hasEligibleHuman = state.callState.eligibleCounterSeats.some(
          (s) => !this.seats[s].isBot && !this.seats[s].autoBot,
        );
        const windowMs =
          state.callState.counterAttempts === 0
            ? this.counterWindowMs
            : this.reCounterWindowMs;
        const delay = hasEligibleHuman
          ? Math.min(Math.max(this.botDelayMs * 3, 1600), Math.floor(windowMs * 0.45))
          : Math.min(Math.max(this.botDelayMs * 2, 20), Math.floor(windowMs * 0.35));
        this.botTimer = setTimeout(() => {
          this.botTimer = null;
          this.executeCounterBot(eligibleBots[0]);
        }, delay);
      }
      return;
    }

    // 4. Turn-based phases: COUNTER_RESPONSE, BIDDING, CHOOSE_TRUMP, BURYING, PLAYING
    const turn = state.currentTurn;
    if (turn === null) return;
    const slot = this.seats[turn];
    const forcedFinalHand = this.isForcedFinalHandTurn(state, turn);
    if (slot.isBot || slot.autoBot || forcedFinalHand) {
      const pauseRemaining =
        state.phase === 'PLAYING' &&
        state.currentTrick.length === 0 &&
        this.trickPauseUntilMs !== null
          ? Math.max(0, this.trickPauseUntilMs - Date.now())
          : 0;
      const baseDelay = forcedFinalHand
        ? Math.min(this.botDelayMs, 280)
        : this.botDelayMs;
      const delay = pauseRemaining + baseDelay;
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        this.executeBotTurn();
      }, delay);
    }
  }

  private executeDealStep(): void {
    if (this.disposed || !this.gameState || this.gameState.phase !== 'DEALING') return;
    const res = applyAction(this.gameState, { type: 'DEAL_STEP' });
    if (!res.ok) return;

    let next = res.state;
    // Allow bots to call trump mid-dealing once enough cards are visible
    if (
      next.phase === 'DEALING' &&
      next.mode === 'hongxin' &&
      next.callState.callerSeat === null
    ) {
      for (const s of [0, 1, 2, 3] as Seat[]) {
        if (this.seats[s].isBot || this.seats[s].autoBot) {
          const callAct = chooseBotDealingCallAction(next, s, this.resolveBotDifficulty(s));
          if (callAct) {
            const callRes = applyAction(next, callAct);
            if (callRes.ok) {
              next = callRes.state;
              break;
            }
          }
        }
      }
    }

    this.applySuccessState(next);
  }

  private executeCallingBot(seat: Seat): void {
    if (this.disposed || !this.gameState || this.gameState.phase !== 'CALLING') return;
    if (!this.seats[seat].isBot && !this.seats[seat].autoBot) return;
    if (this.gameState.callState.passedSeats.includes(seat)) return;
    const action = chooseBotAction(this.gameState, seat, this.resolveBotDifficulty(seat));
    const res = applyAction(this.gameState, action);
    if (res.ok) {
      this.applySuccessState(res.state);
    }
  }

  private executeCounterBot(seat: Seat): void {
    if (this.disposed || !this.gameState || this.gameState.phase !== 'COUNTER_BIDDING') {
      return;
    }
    if (!this.seats[seat].isBot && !this.seats[seat].autoBot) return;
    if (!this.gameState.callState.eligibleCounterSeats.includes(seat)) return;
    const action = chooseBotAction(this.gameState, seat, this.resolveBotDifficulty(seat));
    const res = applyAction(this.gameState, action);
    if (res.ok) {
      this.applySuccessState(res.state);
    }
  }

  private executeBotTurn(): void {
    if (this.disposed || !this.gameState) return;
    const turn = this.gameState.currentTurn;
    if (turn === null) return;
    const slot = this.seats[turn];
    const forcedFinalHand = this.isForcedFinalHandTurn(this.gameState, turn);
    if (!slot.isBot && !slot.autoBot && !forcedFinalHand) return;

    const action: GameAction =
      forcedFinalHand && !slot.isBot && !slot.autoBot
        ? {
            type: 'PLAY_CARDS',
            seat: turn,
            cardIds: this.gameState.hands[turn].map((c) => c.id),
          }
        : chooseBotAction(this.gameState, turn, this.resolveBotDifficulty(turn));
    const res = applyAction(this.gameState, action);
    if (res.ok) {
      this.applySuccessState(res.state);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearBotTimer();
    this.clearDealTimer();
    this.clearPhaseTimer();
    this.clearAbandonedRoundTimer();
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    for (const slot of this.seats) {
      if (slot.ws && slot.ws.readyState === PEER_OPEN) {
        slot.ws.close();
      }
      slot.ws = null;
    }
  }
}
