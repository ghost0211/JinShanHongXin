import type { BotDifficulty, DealSpeed, GameMode, RoomSummary } from '@jinshan/protocol';
import {
  GameRoom,
  type RoomHistorySink,
  type RoomTimingOptions,
} from './room.js';

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly store?: RoomHistorySink;
  private readonly botDelayMs: number;
  private readonly timingOptions: RoomTimingOptions;
  private readonly onRoomsChanged?: (rooms: RoomSummary[]) => void;

  constructor(
    options?: {
      store?: RoomHistorySink;
      botDelayMs?: number;
      onRoomsChanged?: (rooms: RoomSummary[]) => void;
    } & RoomTimingOptions,
  ) {
    this.store = options?.store;
    this.botDelayMs = options?.botDelayMs ?? 450;
    this.onRoomsChanged = options?.onRoomsChanged;
    this.timingOptions = {
      withDealing: options?.withDealing,
      dealStepMs: options?.dealStepMs,
      callWindowMs: options?.callWindowMs,
      counterWindowMs: options?.counterWindowMs,
      reCounterWindowMs: options?.reCounterWindowMs,
      responseTimeoutMs: options?.responseTimeoutMs,
      trickIntervalMs: options?.trickIntervalMs,
      disconnectGraceMs: options?.disconnectGraceMs,
    };
  }

  private emitRoomsChanged(): void {
    this.onRoomsChanged?.(this.listRooms());
  }

  private generateRoomId(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      if (!this.rooms.has(code)) return code;
    }
    // Even when random generation repeatedly collides, never overwrite an existing room.
    for (let id = 100000; id < 1000000; id++) {
      const code = String(id);
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('房间数量已达上限');
  }

  createRoom(options?: {
    mode?: GameMode;
    debugMode?: boolean;
    fillBots?: boolean;
    allyBotDifficulty?: BotDifficulty;
    opponentBotDifficulty?: BotDifficulty;
    dealSpeed?: DealSpeed;
  }): GameRoom {
    const roomId = this.generateRoomId();
    const room = new GameRoom({
      roomId,
      mode: options?.mode ?? 'hongxin',
      debugMode: options?.debugMode ?? false,
      allyBotDifficulty: options?.allyBotDifficulty ?? 'high',
      opponentBotDifficulty: options?.opponentBotDifficulty ?? 'high',
      dealSpeed: options?.dealSpeed ?? 5,
      botDelayMs: this.botDelayMs,
      store: this.store,
      ...this.timingOptions,
      onReclaim: (r) => this.reclaim(r),
      onSummaryChanged: () => this.emitRoomsChanged(),
    });
    this.rooms.set(roomId, room);
    this.emitRoomsChanged();
    return room;
  }

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  listRooms(): RoomSummary[] {
    return Array.from(this.rooms.values()).map((r) => r.getSummary());
  }

  pruneIfEmpty(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.status !== 'IN_GAME' && !room.hasAnyOccupiedHuman()) {
      this.reclaim(room);
    }
  }

  private reclaim(room: GameRoom): void {
    if (this.rooms.get(room.roomId) !== room) return;
    this.rooms.delete(room.roomId);
    room.dispose();
    this.emitRoomsChanged();
  }

  disposeAll(): void {
    for (const room of this.rooms.values()) {
      room.dispose();
    }
    this.rooms.clear();
    this.emitRoomsChanged();
  }
}
