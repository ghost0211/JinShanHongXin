import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GameMode, RoundSettlement } from '@jinshan/protocol';

export interface MatchRecord {
  id: number;
  roomId: string;
  mode: GameMode;
  status: string;
  winnerSummary: string | null;
  createdAt: string;
  finishedAt: string | null;
  rounds: RoundRecordSummary[];
}

export interface RoundRecordSummary {
  id: number;
  matchId: number;
  roundNumber: number;
  mode: GameMode;
  dealerSeat: number;
  challengerTotal: number;
  bankerWon: boolean;
  summaryJson: string;
  createdAt: string;
}

export class HistoryStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
        winner_summary TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS round_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        round_number INTEGER NOT NULL,
        mode TEXT NOT NULL,
        dealer_seat INTEGER NOT NULL,
        challenger_total INTEGER NOT NULL,
        banker_won INTEGER NOT NULL,
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (match_id) REFERENCES matches(id)
      );
    `);
  }

  createMatch(roomId: string, mode: GameMode): number {
    const stmt = this.db.prepare(
      `INSERT INTO matches (room_id, mode, status) VALUES (?, ?, 'IN_PROGRESS')`,
    );
    const res = stmt.run(roomId, mode);
    return Number(res.lastInsertRowid);
  }

  recordRound(matchId: number, settlement: RoundSettlement): void {
    const stmt = this.db.prepare(`
      INSERT INTO round_records (
        match_id, round_number, mode, dealer_seat, challenger_total, banker_won, summary_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      matchId,
      settlement.roundNumber,
      settlement.mode,
      settlement.dealer,
      settlement.totalChallengerScore,
      settlement.bankerWon ? 1 : 0,
      JSON.stringify(settlement),
    );
  }

  finishMatch(matchId: number, winnerSummary: string): void {
    const stmt = this.db.prepare(`
      UPDATE matches
      SET status = 'FINISHED', winner_summary = ?, finished_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(winnerSummary, matchId);
  }

  listRecentMatches(limit = 20): MatchRecord[] {
    const matchRows = this.db
      .prepare(
        `SELECT id, room_id, mode, status, winner_summary, created_at, finished_at
         FROM matches ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      id: number;
      room_id: string;
      mode: GameMode;
      status: string;
      winner_summary: string | null;
      created_at: string;
      finished_at: string | null;
    }>;

    const roundStmt = this.db.prepare(
      `SELECT id, match_id, round_number, mode, dealer_seat, challenger_total, banker_won, summary_json, created_at
       FROM round_records WHERE match_id = ? ORDER BY round_number ASC`,
    );

    return matchRows.map((m) => {
      const rounds = (roundStmt.all(m.id) as Array<{
        id: number;
        match_id: number;
        round_number: number;
        mode: GameMode;
        dealer_seat: number;
        challenger_total: number;
        banker_won: number;
        summary_json: string;
        created_at: string;
      }>).map((r) => ({
        id: r.id,
        matchId: r.match_id,
        roundNumber: r.round_number,
        mode: r.mode,
        dealerSeat: r.dealer_seat,
        challengerTotal: r.challenger_total,
        bankerWon: r.banker_won === 1,
        summaryJson: r.summary_json,
        createdAt: r.created_at,
      }));

      return {
        id: m.id,
        roomId: m.room_id,
        mode: m.mode,
        status: m.status,
        winnerSummary: m.winner_summary,
        createdAt: m.created_at,
        finishedAt: m.finished_at,
        rounds,
      };
    });
  }

  close(): void {
    this.db.close();
  }
}
