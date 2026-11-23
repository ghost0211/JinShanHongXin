import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { RoundSettlement, UserProfile } from '@jinshan/protocol';
import { AuthError, HistoryStore, type PlayerRoundStatUpdate } from '../db.js';

function temporaryDb(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'jinshan-accounts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'test.db');
}

function withStore<T>(path: string, run: (store: HistoryStore) => T): T {
  const store = new HistoryStore(path);
  try {
    return run(store);
  } finally {
    store.close();
  }
}

function withSqlite<T>(path: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function authError(status: number, code: string): (error: unknown) => boolean {
  return (error) => error instanceof AuthError && error.status === status && error.code === code;
}

const invalidCredentials = authError(401, 'INVALID_CREDENTIALS');

const settlement: RoundSettlement = {
  mode: 'heixin',
  roundNumber: 1,
  dealer: 0,
  bankerTeam: 'A',
  challengerTeam: 'B',
  tableChallengerPoints: 50,
  bottomPointsRaw: 0,
  bottomKilled: false,
  bottomBonusPoints: 0,
  totalChallengerScore: 50,
  bankerWon: true,
  earningTeam: 'A',
  earnedSteps: 0,
  penaltyAbsorbed: 0,
  actualLevelUp: 0,
  previousLevels: { A: 0, B: 0 },
  newLevels: { A: 0, B: 0 },
  previousPenalties: { A: 0, B: 0 },
  newPenalties: { A: 0, B: 0 },
  nextDealer: 0,
  matchWinner: null,
  revealedBottom: [],
  scoreDeltas: { 0: 60, 1: -20, 2: -20, 3: -20 },
};

test('signup and login preserve password boundaries, whitespace, and case-insensitive usernames', () => {
  withStore(':memory:', (store) => {
    const password = ' x  ';
    const maxPassword = '🔒'.repeat(32); // 64 JS code units, consistent with the UI.
    const signedUp = store.registerUser('  Player01  ', password, '  小明  ');
    assert.equal(signedUp.user.username, 'Player01');
    assert.equal(signedUp.user.nickname, '小明');
    assert.equal('password_hash' in signedUp.user, false);
    assert.equal('password_salt' in signedUp.user, false);
    assert.deepEqual(store.loginUser('  pLayer01 ', password).user, signedUp.user);
    assert.throws(() => store.loginUser('Player01', 'x   '), invalidCredentials);
    assert.throws(() => store.loginUser('missing', password), invalidCredentials);
    assert.throws(() => store.registerUser('PLAYER01', 'valid'), authError(409, 'USERNAME_TAKEN'));

    const max = store.registerUser('Player02', maxPassword);
    assert.equal(max.user.nickname, 'Player02');
    assert.deepEqual(store.loginUser('Player02', maxPassword).user, max.user);
    for (const invalid of ['abc', `${maxPassword}x`, null]) {
      const input = invalid as string;
      assert.throws(() => store.registerUser('Player03', input), authError(400, 'INVALID_PASSWORD'));
      assert.throws(() => store.loginUser('Player02', input), invalidCredentials);
    }
    assert.equal(store.updateNickname(max.user.id, '  新名字  ').nickname, '新名字');
    assert.equal(store.getUserByToken(max.token)?.nickname, '新名字');
  });
});

test('sessions store only token digests, expire without sliding, and revoke individually across reopen', (t) => {
  const path = temporaryDb(t);
  const { user, first, second } = withStore(path, (store) => {
    const result = store.registerUser('player', 'pass');
    return { user: result.user, first: result.token, second: store.loginUser('player', 'pass').token };
  });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);

  const ttl = withSqlite(path, (db) => {
    const columns = db.prepare('PRAGMA table_info(user_sessions)').all().map((column) => column.name);
    assert.equal(columns.includes('token'), false);
    const row = db.prepare('SELECT token_hash, created_at, expires_at FROM user_sessions WHERE token_hash = ?')
      .get(digest(second))!;
    assert.equal(row.token_hash, digest(second));
    assert.equal(Number(row.expires_at) - Number(row.created_at), 30 * 24 * 60 * 60);
    assert.equal(db.prepare('SELECT 1 FROM user_sessions WHERE token_hash = ?').get(second), undefined);
    return row.expires_at;
  });

  const third = withStore(path, (store) => {
    assert.deepEqual(store.getUserByToken(first), user);
    assert.deepEqual(store.getUserByToken(second), user);
    assert.equal(store.getUserByToken(digest(second)), null);
    assert.equal(store.getUserByToken({ token: second } as unknown as string), null);
    assert.equal(store.getUserByToken(`${second.slice(0, -1)}\n`), null);
    store.logoutToken(first);
    store.logoutToken(first); // Logout is idempotent and does not revoke the other device.
    assert.equal(store.getUserByToken(first), null);
    assert.deepEqual(store.getUserByToken(second), user);

    withSqlite(path, (db) => {
      const query = db.prepare('SELECT expires_at FROM user_sessions WHERE token_hash = ?');
      assert.equal(query.get(digest(second))?.expires_at, ttl);
      db.prepare('UPDATE user_sessions SET expires_at = unixepoch() WHERE token_hash = ?').run(digest(second));
    });
    assert.equal(store.getUserByToken(second), null);
    return store.loginUser('player', 'pass').token;
  });
  withSqlite(path, (db) => {
    assert.deepEqual(db.prepare('SELECT token_hash FROM user_sessions').all().map((row) => row.token_hash), [digest(third)]);
  });
  withStore(path, (store) => {
    assert.equal(store.getUserByToken(first), null);
    assert.equal(store.getUserByToken(second), null);
    assert.deepEqual(store.getUserByToken(third), user);
  });
});

test('upgrading the old plaintext schema revokes old sessions without changing credentials, stats, or history', (t) => {
  const path = temporaryDb(t);
  const legacyToken = 'ab'.repeat(32);
  let oldUser: UserProfile;
  const oldMatchId = withStore(path, (store) => {
    const { user } = store.registerUser('old_user', 'oldpass', '老玩家');
    const matchId = store.createMatch('000001', 'heixin');
    store.recordRound(matchId, settlement, [{ userId: user.id, mode: 'heixin', won: true, scoreDelta: 60 }]);
    oldUser = store.getUserById(user.id)!;
    return matchId;
  });
  withSqlite(path, (db) => {
    db.exec(`
      DROP TABLE user_sessions;
      CREATE TABLE user_sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    const salt = '0123456789abcdef'.repeat(2);
    const legacyHash = scryptSync('oldpass', salt, 32).toString('hex');
    db.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?').run(salt, legacyHash, oldUser.id);
    db.prepare('INSERT INTO user_sessions (token, user_id) VALUES (?, ?)').run(legacyToken, oldUser.id);
  });

  const newToken = withStore(path, (store) => {
    assert.equal(store.getUserByToken(legacyToken), null);
    assert.deepEqual(store.getLeaderboard(), [oldUser]);
    const [oldMatch] = store.listRecentMatches();
    assert.equal(oldMatch.id, oldMatchId);
    assert.equal(oldMatch.rounds.length, 1);
    const login = store.loginUser('OLD_USER', 'oldpass');
    assert.deepEqual(login.user, oldUser);
    return login.token;
  });
  withStore(path, (store) => assert.deepEqual(store.getUserByToken(newToken), oldUser));
});

test('a failed session write rolls back signup; a corrupt stored verifier cannot log in', (t) => {
  const path = temporaryDb(t);
  withStore(path, (store) => {
    withSqlite(path, (db) => db.exec(`
      CREATE TRIGGER fail_session BEFORE INSERT ON user_sessions
      BEGIN SELECT RAISE(ABORT, 'session write failed'); END;
    `));
    assert.throws(() => store.registerUser('player', 'pass'), /session write failed/);
    assert.deepEqual(store.getLeaderboard(), []);

    withSqlite(path, (db) => db.exec('DROP TRIGGER fail_session'));
    store.registerUser('player', 'pass');
    withSqlite(path, (db) => db.exec("UPDATE users SET password_hash = 'invalid hex'"));
    assert.throws(() => store.loginUser('player', 'pass'), invalidCredentials);
  });
});

test('settlement commits round, both players’ stats, and match result together', (t) => {
  const path = temporaryDb(t);
  withStore(path, (store) => {
    const loser = store.registerUser('loser', 'pass').user;
    const winner = store.registerUser('winner', 'pass').user;
    const matchId = store.createMatch('000001', 'heixin');
    const updates: PlayerRoundStatUpdate[] = [
      { userId: winner.id, mode: 'heixin', won: true, scoreDelta: 60 },
      { userId: loser.id, mode: 'heixin', won: false, scoreDelta: -20 },
    ];
    withSqlite(path, (db) => db.exec(`
      CREATE TRIGGER fail_finish BEFORE UPDATE OF status ON matches
      BEGIN SELECT RAISE(ABORT, 'finish write failed'); END;
    `));
    assert.throws(() => store.recordRound(matchId, settlement, updates, 'A队获胜'), /finish write failed/);
    assert.equal(store.listRecentMatches()[0].rounds.length, 0);
    assert.equal(store.listRecentMatches()[0].status, 'IN_PROGRESS');
    assert.deepEqual(store.getLeaderboard(), [loser, winner]);

    withSqlite(path, (db) => db.exec('DROP TRIGGER fail_finish'));
    store.recordRound(matchId, settlement, updates, 'A队获胜');
    store.recordPlayerRoundStats([{ userId: loser.id, mode: 'hongxin', won: true }]);
    const [match] = store.listRecentMatches();
    assert.equal(match.status, 'FINISHED');
    assert.equal(match.winnerSummary, 'A队获胜');
    assert.equal(match.rounds.length, 1);
    assert.deepEqual(JSON.parse(match.rounds[0].summaryJson), settlement);
    assert.deepEqual(store.getLeaderboard(), [
      { ...winner, heixinGames: 1, heixinWins: 1, heixinTotalScore: 60 },
      { ...loser, hongxinGames: 1, hongxinWins: 1, heixinGames: 1, heixinTotalScore: -20 },
    ]);
  });
});
