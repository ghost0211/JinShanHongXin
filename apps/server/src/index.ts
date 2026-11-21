import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './server.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = process.env.DB_PATH ?? './apps/server/data/jinshan.db';
const botDelayMs = Number(process.env.BOT_DELAY_MS ?? 450);

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultClientDist = resolve(__dirname, '../../client/dist');
const staticDir =
  process.env.STATIC_DIR ??
  (existsSync(defaultClientDist) ? defaultClientDist : undefined);

const server = createGameServer({
  port,
  host,
  dbPath,
  botDelayMs,
  staticDir,
});

const info = await server.start();
console.log(`金山打红心/打黑心服务端已启动: http://${info.host}:${info.port}`);
if (staticDir) {
  console.log(`前端静态资源已挂载: ${staticDir}`);
}

const nets = networkInterfaces();
for (const name of Object.keys(nets)) {
  for (const net of nets[name] ?? []) {
    if (net.family === 'IPv4' && !net.internal) {
      console.log(`局域网访问地址: http://${net.address}:${info.port} (WS: ws://${net.address}:${info.port}/ws)`);
    }
  }
}

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
