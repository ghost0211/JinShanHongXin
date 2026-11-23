import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server.js';

const cliPath = fileURLToPath(new URL('../create-invite.js', import.meta.url));

type RegisterResponse = { status: number; body: { code?: string; token?: string } };

function runCli(dbPath: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8', timeout: 5_000,
  });
}

function temporaryDb(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'jinshan-invites-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'jinshan.db');
}

async function fixture(t: TestContext) {
  const dbPath = temporaryDb(t);
  const server = createGameServer({ port: 0, host: '127.0.0.1', dbPath });
  const { port } = await server.start();
  t.after(() => server.stop());
  const base = `http://127.0.0.1:${port}`;

  async function register(username: string, inviteCode?: unknown, password = 'welcome123'): Promise<RegisterResponse> {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, inviteCode }),
    });
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    return { status: res.status, body: await res.json() as { code?: string; token?: string } };
  }

  return { base, dbPath, register, store: server.store };
}

function digest(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function withSqlite<T>(path: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function assertInviteError(response: RegisterResponse, code: string) {
  assert.equal(response.status, 403);
  assert.equal(response.body.code, code);
  assert.equal(response.body.token, undefined);
}

test('admin CLI refuses missing databases and out-of-range lifetimes without emitting codes', (t) => {
  const dbPath = temporaryDb(t);
  const badPath = runCli(dbPath);
  assert.equal(badPath.status, 1);
  assert.equal(badPath.stdout, '');
  assert.equal(existsSync(dbPath), false);
  for (const ttl of ['0', '1.5', '721']) {
    const badTtl = runCli(dbPath, '--ttl-hours', ttl);
    assert.equal(badTtl.status, 1);
    assert.equal(badTtl.stdout, '');
    assert.match(badTtl.stderr, /1~720/);
  }
});

test('CLI invite reaches a running server, stores only its digest, and expires if unused', async (t) => {
  const { dbPath, register, store } = await fixture(t);
  const before = Math.floor(Date.now() / 1000);
  const issued = runCli(dbPath, '--ttl-hours', '2');
  const after = Math.floor(Date.now() / 1000);
  assert.equal(issued.status, 0, issued.stderr);
  const invite = JSON.parse(issued.stdout) as { code: string; expiresAt: string };
  assert.match(invite.code, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(issued.stderr.includes(invite.code), false);

  withSqlite(dbPath, (db) => {
    const rows = db.prepare('SELECT * FROM registration_invites').all();
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['code_hash', 'expires_at']);
    assert.equal(rows[0].code_hash, digest(invite.code));
    const expiresAt = Date.parse(invite.expiresAt) / 1000;
    assert.equal(rows[0].expires_at, expiresAt);
    assert.ok(expiresAt >= before + 7200 && expiresAt <= after + 7200);
  });

  const registered = await register('invited_player', ` ${invite.code}\n`);
  assert.equal(registered.status, 201);
  assert.equal(JSON.stringify(registered.body).includes(invite.code), false);
  assert.equal(store.getUserByToken(registered.body.token)?.username, 'invited_player');
  const replay = await register('other_player', invite.code);
  assertInviteError(replay, 'INVALID_INVITE');
  assert.equal(JSON.stringify(replay.body).includes(invite.code), false);

  const expired = store.createRegistrationInvite();
  withSqlite(dbPath, (db) => db.prepare('UPDATE registration_invites SET expires_at = unixepoch() WHERE code_hash = ?')
    .run(digest(expired.code)));
  assertInviteError(await register('other_player', expired.code), 'INVALID_INVITE');
  assert.deepEqual(store.getLeaderboard().map((user) => user.username), ['invited_player']);
});

test('registration requires an invite in the POST body; form errors leave a valid invite unused', async (t) => {
  const { base, register, store } = await fixture(t);
  assertInviteError(await register('player'), 'INVITE_REQUIRED');
  assertInviteError(await register('player', '   '), 'INVITE_REQUIRED');
  assertInviteError(await register('player', { code: 'not-a-code' }), 'INVALID_INVITE');
  assertInviteError(await register('player', 'A'.repeat(32)), 'INVALID_INVITE');
  const query = await fetch(`${base}/api/auth/register?inviteCode=not-a-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'player', password: 'welcome123' }),
  });
  assert.equal(query.status, 403);
  assert.equal((await query.json() as { code: string }).code, 'INVITE_REQUIRED');
  assert.deepEqual(store.getLeaderboard(), []);

  const { code } = store.createRegistrationInvite();
  const invalidPassword = await register('player', code, 'bad');
  assert.equal(invalidPassword.status, 400);
  assert.equal(invalidPassword.body.code, 'INVALID_PASSWORD');
  assert.equal((await register('player', code)).status, 201);

  const second = store.createRegistrationInvite();
  const duplicate = await register('PLAYER', second.code);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'USERNAME_TAKEN');
  assert.equal((await register('other_player', second.code)).status, 201);
});

test('two concurrent HTTP registrations cannot redeem the same invite twice', async (t) => {
  const { register, store } = await fixture(t);
  const { code } = store.createRegistrationInvite();
  const responses = await Promise.all([register('first_player', code), register('second_player', code)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 403]);
  assertInviteError(responses.find((response) => response.status === 403)!, 'INVALID_INVITE');
  assert.equal(store.getLeaderboard().length, 1);
});
