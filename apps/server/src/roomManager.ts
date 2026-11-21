import type { GameMode, RoomSummary } from '@jinshan/protocol';
import type { HistoryStore } from './db.js';
import { GameRoom } from './room.js';

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly store?: HistoryStore;
  private readonly botDelayMs: number;

  constructor(options?: { store?: HistoryStore; botDelayMs?: number }) {
    this.store = options?.store;
    this.botDelayMs = options?.botDelayMs ?? 450;
  }

  private generateRoomId(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      if (!this.rooms.has(code)) return code;
    }
    return String(Date.now()).slice(-6);
  }

  createRoom(options?: {
    mode?: GameMode;
    debugMode?: boolean;
    fillBots?: boolean;
  }): GameRoom {
    const roomId = this.generateRoomId();
    const room = new GameRoom({
      roomId,
      mode: options?.mode ?? 'hongxin',
      debugMode: options?.debugMode ?? false,
      botDelayMs: this.botDelayMs,
      store: this.store,
    });
    this.rooms.set(roomId, room);
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
    if (!room.hasAnyConnectedHuman() && room.status === 'WAITING') {
      room.dispose();
      this.rooms.delete(roomId);
    }
  }

  disposeAll(): void {
    for (const room of this.rooms.values()) {
      room.dispose();
    }
    this.rooms.clear();
  }
}
