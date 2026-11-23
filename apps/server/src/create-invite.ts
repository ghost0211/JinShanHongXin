import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_DB_PATH, DEFAULT_INVITE_TTL_HOURS, HistoryStore, MAX_INVITE_TTL_HOURS } from './db.js';

const usage = '用法：node apps/server/dist/create-invite.js [--ttl-hours 24]（须使用与服务端相同的 DB_PATH）';

function main(args: string[]): number {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return 0;
  }
  const ttlHours = args.length === 0 ? DEFAULT_INVITE_TTL_HOURS :
    args.length === 2 && args[0] === '--ttl-hours' && /^\d+$/.test(args[1]) ? Number(args[1]) : NaN;
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > MAX_INVITE_TTL_HOURS) {
    console.error(`有效期须为 1~${MAX_INVITE_TTL_HOURS} 小时（整数）。\n${usage}`);
    return 1;
  }

  const configuredPath = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  if (!configuredPath || configuredPath === ':memory:') {
    console.error('发码需要服务端正在使用的持久 SQLite 数据库文件。');
    return 1;
  }
  const dbPath = resolve(configuredPath);
  // Do not silently create a new database if the operator has the wrong path.
  if (!statSync(dbPath, { throwIfNoEntry: false })?.isFile()) {
    console.error('未找到服务端 SQLite 数据库文件，请先启动服务端并核对工作目录与 DB_PATH。');
    return 1;
  }

  const store = new HistoryStore(dbPath);
  try {
    const invite = store.createRegistrationInvite(ttlHours);
    console.log(JSON.stringify(invite));
    return 0;
  } finally {
    store.close();
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch {
  console.error('生成邀请码失败，请检查 DB_PATH、数据库权限及占用状态后重试。');
  process.exitCode = 1;
}
