import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GameMode, RoundSettlement, UserProfile } from '@jinshan/protocol';

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

export interface PlayerRoundStatUpdate {
  userId: number;
  mode: GameMode;
  won: boolean;
  scoreDelta?: number;
}

interface UserRow {
  id: number;
  username: string;
  nickname: string;
  password_salt: string;
  password_hash: string;
  hongxin_games: number;
  hongxin_wins: number;
  heixin_games: number;
  heixin_wins: number;
  heixin_total_score: number;
  created_at: string;
}

function mapUserRow(row: UserRow): UserProfile {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    hongxinGames: row.hongxin_games,
    hongxinWins: row.hongxin_wins,
    heixinGames: row.heixin_games,
    heixinWins: row.heixin_wins,
    heixinTotalScore: row.heixin_total_score,
    createdAt: row.created_at,
  };
}

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DUMMY_PASSWORD_SALT = '00000000000000000000000000000000';
const DUMMY_PASSWORD_HASH = Buffer.alloc(32);

function isValidPassword(password: unknown): password is string {
  // Match the UI's JS string length, without trimming or normalizing passwords.
  return typeof password === 'string' && password.length >= 4 && password.length <= 64;
}

function hashPassword(password: string, salt: string): Buffer {
  // Keep using the original hex salt string as the scrypt input for existing hashes.
  return scryptSync(password, salt, 32);
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === length && !/[^0-9a-f]/i.test(value);
}

function isSessionToken(token: unknown): token is string {
  return typeof token === 'string' && token.length === 64 && !/[^0-9a-f]/.test(token);
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class HistoryStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    try {
      this.inTransaction(() => this.initSchema());
    } catch (err) {
      this.db.close();
      throw err;
    }
  }

  private inTransaction<T>(write: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Some SQLite errors already roll back the transaction. Keep the original error.
      }
      throw err;
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        nickname TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        hongxin_games INTEGER NOT NULL DEFAULT 0,
        hongxin_wins INTEGER NOT NULL DEFAULT 0,
        heixin_games INTEGER NOT NULL DEFAULT 0,
        heixin_wins INTEGER NOT NULL DEFAULT 0,
        heixin_total_score INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

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

    // Legacy tokens were stored as bearer credentials. Revoke only those sessions
    // on upgrade instead of copying them; accounts and history remain untouched.
    const sessionColumns = this.db.prepare('PRAGMA table_info(user_sessions)').all();
    if (sessionColumns.some((column) => column.name === 'token')) {
      this.db.exec('PRAGMA secure_delete = ON; DROP TABLE user_sessions;');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT NOT NULL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS user_sessions_expires_at ON user_sessions(expires_at);
    `);
    this.deleteExpiredSessions();
  }

  registerUser(
    rawUsername: string,
    password: string,
    rawNickname?: string,
  ): { user: UserProfile; token: string } {
    const username = rawUsername.trim();
    const nickname = (rawNickname?.trim() || username).slice(0, 16);

    if (username.length < 2 || username.length > 20) {
      throw new AuthError(400, 'INVALID_USERNAME', '用户名长度需为 2~20 个字符');
    }
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(username)) {
      throw new AuthError(400, 'INVALID_USERNAME', '用户名仅支持中英文、数字、下划线和短横线');
    }
    if (!isValidPassword(password)) {
      throw new AuthError(400, 'INVALID_PASSWORD', '密码长度需为 4~64 位');
    }

    const existing = this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username) as { id: number } | undefined;
    if (existing) {
      throw new AuthError(409, 'USERNAME_TAKEN', '该用户名已被注册');
    }

    const salt = randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt).toString('hex');

    return this.inTransaction(() => {
      const row = this.db
        .prepare(
          `INSERT INTO users (username, nickname, password_salt, password_hash)
           VALUES (?, ?, ?, ?) ON CONFLICT(username) DO NOTHING RETURNING *`,
        )
        .get(username, nickname, salt, hash) as UserRow | undefined;
      if (!row) {
        throw new AuthError(409, 'USERNAME_TAKEN', '该用户名已被注册');
      }
      return { user: mapUserRow(row), token: this.createSession(row.id) };
    });
  }

  loginUser(
    rawUsername: string,
    password: string,
  ): { user: UserProfile; token: string } {
    const username = rawUsername.trim();
    if (username.length < 2 || username.length > 20 || !isValidPassword(password)) {
      throw new AuthError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
    }
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as UserRow | undefined;

    // Missing users and corrupt credentials still take the same scrypt path.
    const credentials = row && isHex(row.password_salt, 32) && isHex(row.password_hash, 64)
      ? row
      : null;
    const actual = hashPassword(password, credentials?.password_salt ?? DUMMY_PASSWORD_SALT);
    const expected = credentials ? Buffer.from(credentials.password_hash, 'hex') : DUMMY_PASSWORD_HASH;
    if (!timingSafeEqual(actual, expected) || !credentials) {
      throw new AuthError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
    }

    const token = this.createSession(credentials.id);
    return { user: mapUserRow(credentials), token };
  }

  private deleteExpiredSessions(): void {
    this.db.prepare('DELETE FROM user_sessions WHERE expires_at <= unixepoch()').run();
  }

  private createSession(userId: number): string {
    this.deleteExpiredSessions();
    const token = randomBytes(32).toString('hex');
    this.db
      .prepare(
        `INSERT INTO user_sessions (token_hash, user_id, expires_at)
         VALUES (?, ?, unixepoch() + ?)`,
      )
      .run(hashSessionToken(token), userId, SESSION_TTL_SECONDS);
    return token;
  }

  getUserById(userId: number): UserProfile | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userId) as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  getUserByToken(token: string | undefined | null): UserProfile | null {
    if (!isSessionToken(token)) return null;
    const row = this.db
      .prepare(
        `SELECT u.* FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > unixepoch()`,
      )
      .get(hashSessionToken(token)) as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  logoutToken(token: string): void {
    if (!isSessionToken(token)) return;
    this.db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashSessionToken(token));
  }

  updateNickname(userId: number, rawNickname: string): UserProfile {
    const nickname = rawNickname.trim().slice(0, 16);
    if (nickname.length < 1) {
      throw new AuthError(400, 'INVALID_NICKNAME', '昵称不能为空');
    }
    this.db
      .prepare('UPDATE users SET nickname = ? WHERE id = ?')
      .run(nickname, userId);
    const updated = this.getUserById(userId);
    if (!updated) {
      throw new AuthError(404, 'USER_NOT_FOUND', '用户不存在');
    }
    return updated;
  }

  recordPlayerRoundStats(entries: readonly PlayerRoundStatUpdate[]): void {
    if (entries.length === 0) return;
    this.inTransaction(() => this.updatePlayerRoundStats(entries));
  }

  private updatePlayerRoundStats(entries: readonly PlayerRoundStatUpdate[]): void {
    const stmtHongxin = this.db.prepare(`
      UPDATE users
      SET hongxin_games = hongxin_games + 1,
          hongxin_wins = hongxin_wins + ?
      WHERE id = ?
    `);
    const stmtHeixin = this.db.prepare(`
      UPDATE users
      SET heixin_games = heixin_games + 1,
          heixin_wins = heixin_wins + ?,
          heixin_total_score = heixin_total_score + ?
      WHERE id = ?
    `);
    for (const item of entries) {
      if (item.mode === 'hongxin') {
        stmtHongxin.run(item.won ? 1 : 0, item.userId);
      } else {
        stmtHeixin.run(item.won ? 1 : 0, item.scoreDelta ?? 0, item.userId);
      }
    }
  }

  getLeaderboard(limit = 20): UserProfile[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM users
         ORDER BY (hongxin_wins + heixin_wins) DESC, heixin_total_score DESC, id ASC
         LIMIT ?`,
      )
      .all(limit) as unknown as UserRow[];
    return rows.map(mapUserRow);
  }

  createMatch(roomId: string, mode: GameMode): number {
    const stmt = this.db.prepare(
      `INSERT INTO matches (room_id, mode, status) VALUES (?, ?, 'IN_PROGRESS')`,
    );
    const res = stmt.run(roomId, mode);
    return Number(res.lastInsertRowid);
  }

  recordRound(
    matchId: number,
    settlement: RoundSettlement,
    stats: readonly PlayerRoundStatUpdate[] = [],
    winnerSummary?: string,
  ): void {
    this.inTransaction(() => {
      this.db.prepare(`
        INSERT INTO round_records (
          match_id, round_number, mode, dealer_seat, challenger_total, banker_won, summary_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        matchId,
        settlement.roundNumber,
        settlement.mode,
        settlement.dealer,
        settlement.totalChallengerScore,
        settlement.bankerWon ? 1 : 0,
        JSON.stringify(settlement),
      );
      if (stats.length > 0) this.updatePlayerRoundStats(stats);
      if (winnerSummary !== undefined) this.finishMatch(matchId, winnerSummary);
    });
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
