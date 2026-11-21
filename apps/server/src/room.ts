import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  applyAction,
  chooseBotAction,
  createInitialMatchState,
  getPlayerView,
  getSeatTeam,
  type GameState,
} from '@jinshan/game-core';
import type {
  GameAction,
  GameMode,
  RoomSeatInfo,
  RoomSummary,
  Seat,
  ServerMessage,
} from '@jinshan/protocol';
import type { HistoryStore } from './db.js';

interface SeatSlot {
  seat: Seat;
  occupied: boolean;
  playerId: string | null;
  name: string;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  autoBot: boolean;
  ws: WebSocket | null;
}

export interface RoomOptions {
  roomId: string;
  mode?: GameMode;
  debugMode?: boolean;
  botDelayMs?: number;
  store?: HistoryStore;
}

export class GameRoom {
  readonly roomId: string;
  mode: GameMode;
  readonly debugMode: boolean;
  debugOpenHands: boolean;
  status: 'WAITING' | 'IN_GAME' | 'FINISHED' = 'WAITING';
  hostSeat: Seat = 0;

  private readonly botDelayMs: number;
  private readonly store?: HistoryStore;
  private readonly seats: [SeatSlot, SeatSlot, SeatSlot, SeatSlot];
  private gameState: GameState | null = null;
  private matchId: number | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: RoomOptions) {
    this.roomId = options.roomId;
    this.mode = options.mode ?? 'hongxin';
    this.debugMode = options.debugMode ?? false;
    this.debugOpenHands = false;
    this.botDelayMs = options.botDelayMs ?? 450;
    this.store = options.store;

    this.seats = [0, 1, 2, 3].map((s) => ({
      seat: s as Seat,
      occupied: false,
      playerId: null,
      name: `空位 ${s + 1}`,
      isBot: false,
      connected: false,
      ready: false,
      autoBot: false,
      ws: null,
    })) as [SeatSlot, SeatSlot, SeatSlot, SeatSlot];
  }

  private send(ws: WebSocket | null, msg: ServerMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket | null, code: string, message: string): void {
    this.send(ws, { type: 'ACTION_ERROR', code, message });
  }

  getSummary(): RoomSummary {
    const seatsInfo: RoomSeatInfo[] = this.seats.map((s) => ({
      seat: s.seat,
      team: getSeatTeam(s.seat),
      occupied: s.occupied,
      playerId: s.playerId,
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
      hostSeat: this.hostSeat,
      seats: seatsInfo,
      roundNumber: this.gameState?.roundNumber ?? 0,
    };
  }

  private broadcastRoomSummary(): void {
    const room = this.getSummary();
    for (const slot of this.seats) {
      if (!slot.isBot && slot.connected) {
        this.send(slot.ws, { type: 'ROOM_UPDATED', room });
      }
    }
  }

  private broadcastGameState(): void {
    if (!this.gameState) return;
    const allowDebug = this.debugMode && this.debugOpenHands;
    for (const slot of this.seats) {
      if (!slot.isBot && slot.connected) {
        const view = getPlayerView(this.gameState, slot.seat, allowDebug);
        this.send(slot.ws, { type: 'GAME_STATE', view });
      }
    }
  }

  getSeatByPlayerId(playerId: string): Seat | null {
    const found = this.seats.find((s) => s.playerId === playerId);
    return found ? found.seat : null;
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
    ws: WebSocket,
    preferredSeat?: Seat,
  ): { playerId: string; seat: Seat } {
    if (this.status !== 'WAITING') {
      throw new Error('游戏已经开始，无法加入新玩家');
    }

    let targetSlot: SeatSlot | undefined;
    if (preferredSeat !== undefined && !this.seats[preferredSeat].occupied) {
      targetSlot = this.seats[preferredSeat];
    }
    if (!targetSlot) {
      targetSlot = this.seats.find((s) => !s.occupied);
    }
    if (!targetSlot) {
      // Displace a bot seat if room has bots
      for (let i = 3; i >= 0; i--) {
        if (this.seats[i].isBot) {
          targetSlot = this.seats[i];
          break;
        }
      }
    }
    if (!targetSlot) {
      throw new Error('房间已满');
    }

    const playerId = randomUUID();
    const trimmedName = playerName.trim() || `玩家 ${targetSlot.seat + 1}`;
    const isFirstHuman = !this.hasAnyOccupiedHuman();

    targetSlot.occupied = true;
    targetSlot.playerId = playerId;
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

  reconnect(playerId: string, ws: WebSocket): Seat {
    const slot = this.seats.find((s) => s.playerId === playerId && !s.isBot);
    if (!slot) {
      throw new Error('无效的玩家会话，无法重连');
    }

    if (slot.ws && slot.ws !== ws && slot.ws.readyState === WebSocket.OPEN) {
      slot.ws.close();
    }

    slot.ws = ws;
    slot.connected = true;
    slot.autoBot = false;

    this.send(ws, {
      type: 'ROOM_JOINED',
      roomId: this.roomId,
      playerId,
      seat: slot.seat,
      room: this.getSummary(),
    });
    this.broadcastRoomSummary();

    if (this.gameState) {
      const allowDebug = this.debugMode && this.debugOpenHands;
      this.send(ws, {
        type: 'GAME_STATE',
        view: getPlayerView(this.gameState, slot.seat, allowDebug),
      });
    }

    return slot.seat;
  }

  handleDisconnect(playerId: string): void {
    const slot = this.seats.find((s) => s.playerId === playerId && !s.isBot);
    if (!slot) return;

    slot.connected = false;
    slot.ws = null;

    if (this.status === 'IN_GAME') {
      slot.autoBot = true;
      this.broadcastRoomSummary();
      this.scheduleBotTurn();
      return;
    }

    // In WAITING phase, leave seat vacant if host leaves reassign host
    slot.occupied = false;
    slot.playerId = null;
    slot.name = `空位 ${slot.seat + 1}`;
    slot.ready = false;

    if (slot.seat === this.hostSeat) {
      const nextHuman = this.seats.find((s) => !s.isBot && s.occupied);
      if (nextHuman) {
        this.hostSeat = nextHuman.seat;
        nextHuman.ready = true;
      }
    }

    this.broadcastRoomSummary();
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
      target.name = `机器人 ${target.seat + 1}`;
      target.connected = true;
      target.ready = true;
      target.autoBot = true;
      target.ws = null;
    } else {
      target.occupied = false;
      target.isBot = false;
      target.playerId = null;
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
      from.name = `机器人 ${from.seat + 1}`;
      from.connected = true;
      from.ready = true;
      from.autoBot = true;
      from.ws = null;
    } else {
      from.occupied = false;
      from.isBot = false;
      from.playerId = null;
      from.name = `空位 ${from.seat + 1}`;
      from.connected = false;
      from.ready = false;
      from.autoBot = false;
      from.ws = null;
    }

    if (this.hostSeat === actorSeat) {
      this.hostSeat = targetSeat;
    }

    // Re-notify moved human of their new seat assignment
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
    if (enabled && this.status === 'IN_GAME') {
      this.scheduleBotTurn();
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
    const emptySeat = this.seats.find((s) => !s.occupied);
    if (emptySeat) {
      this.sendError(this.seats[actorSeat].ws, 'NOT_FULL', '请先凑齐 4 名玩家或添加机器人补位');
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
    this.gameState = createInitialMatchState({ mode: this.mode });
    if (this.store) {
      this.matchId = this.store.createMatch(this.roomId, this.mode);
    }
    this.broadcastRoomSummary();
    this.broadcastGameState();
    this.scheduleBotTurn();
  }

  handleGameAction(actorSeat: Seat, action: GameAction): void {
    if (!this.gameState || this.status !== 'IN_GAME') {
      this.sendError(this.seats[actorSeat].ws, 'NOT_IN_GAME', '当前不在对局中');
      return;
    }

    if (action.type !== 'NEXT_ROUND' && action.seat !== actorSeat) {
      this.sendError(this.seats[actorSeat].ws, 'SEAT_MISMATCH', '不能代其他座位提交操作');
      return;
    }

    const res = applyAction(this.gameState, action);
    if (!res.ok) {
      this.sendError(this.seats[actorSeat].ws, res.code, res.error);
      return;
    }

    this.applySuccessState(res.state);
  }

  private applySuccessState(nextState: GameState): void {
    const prevPhase = this.gameState?.phase;
    this.gameState = nextState;

    if (
      (nextState.phase === 'ROUND_OVER' || nextState.phase === 'MATCH_OVER') &&
      prevPhase !== nextState.phase &&
      nextState.settlement &&
      this.store &&
      this.matchId !== null
    ) {
      this.store.recordRound(this.matchId, nextState.settlement);
      if (nextState.phase === 'MATCH_OVER' && nextState.matchWinner) {
        this.status = 'FINISHED';
        this.store.finishMatch(this.matchId, `${nextState.matchWinner}队获胜`);
      }
    }

    if (nextState.phase === 'MATCH_OVER') {
      this.status = 'FINISHED';
      this.broadcastRoomSummary();
    }

    this.broadcastGameState();
    this.scheduleBotTurn();
  }

  private scheduleBotTurn(): void {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (this.disposed || !this.gameState) return;
    if (
      this.gameState.phase === 'ROUND_OVER' ||
      this.gameState.phase === 'MATCH_OVER'
    ) {
      return;
    }

    const turn = this.gameState.currentTurn;
    if (turn === null) return;
    const slot = this.seats[turn];
    if (slot.isBot || slot.autoBot) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        this.executeBotTurn();
      }, this.botDelayMs);
    }
  }

  private executeBotTurn(): void {
    if (this.disposed || !this.gameState) return;
    const turn = this.gameState.currentTurn;
    if (turn === null) return;
    const slot = this.seats[turn];
    if (!slot.isBot && !slot.autoBot) return;

    const action = chooseBotAction(this.gameState, turn);
    const res = applyAction(this.gameState, action);
    if (res.ok) {
      this.applySuccessState(res.state);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    for (const slot of this.seats) {
      if (slot.ws && slot.ws.readyState === WebSocket.OPEN) {
        slot.ws.close();
      }
      slot.ws = null;
    }
  }
}
