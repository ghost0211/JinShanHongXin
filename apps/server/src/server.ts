import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@jinshan/protocol';
import { AuthError, HistoryStore } from './db.js';
import type { RoomTimingOptions } from './room.js';
import { RoomManager } from './roomManager.js';

export interface GameServerOptions extends RoomTimingOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  botDelayMs?: number;
  staticDir?: string;
}

interface ConnContext {
  roomId: string | null;
  playerId: string | null;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 64 * 1024) {
        rejectBody(new AuthError(413, 'PAYLOAD_TOO_LARGE', '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolveBody(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        rejectBody(new AuthError(400, 'INVALID_JSON', 'JSON 格式错误'));
      }
    });
    req.on('error', (err) => rejectBody(err));
  });
}

function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? match[1].trim() : null;
}

function sendWs(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export interface RunningGameServer {
  start: () => Promise<{ port: number; host: string }>;
  stop: () => Promise<void>;
  getPort: () => number;
  roomManager: RoomManager;
  store: HistoryStore;
}

export function createGameServer(
  options: GameServerOptions = {},
): RunningGameServer {
  const host = options.host ?? '0.0.0.0';
  const requestedPort = options.port ?? 3001;
  const dbPath = options.dbPath ?? './apps/server/data/jinshan.db';
  const store = new HistoryStore(dbPath);
  const roomManager = new RoomManager({
    store,
    botDelayMs: options.botDelayMs ?? 450,
    withDealing: options.withDealing,
    dealStepMs: options.dealStepMs,
    callWindowMs: options.callWindowMs,
    counterWindowMs: options.counterWindowMs,
    reCounterWindowMs: options.reCounterWindowMs,
    responseTimeoutMs: options.responseTimeoutMs,
    trickIntervalMs: options.trickIntervalMs,
    disconnectGraceMs: options.disconnectGraceMs,
  });
  const staticRoot = options.staticDir ? resolve(options.staticDir) : null;

  const contexts = new Map<WebSocket, ConnContext>();

  const handleHttp = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    try {
      if (url.pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, rooms: roomManager.listRooms().length });
        return;
      }
      if (url.pathname === '/api/rooms' && req.method === 'GET') {
        sendJson(res, 200, { rooms: roomManager.listRooms() });
        return;
      }
      if (url.pathname === '/api/history' && req.method === 'GET') {
        sendJson(res, 200, { matches: store.listRecentMatches(20) });
        return;
      }
      if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
        sendJson(res, 200, { users: store.getLeaderboard(20) });
        return;
      }

      // Auth endpoints
      if (url.pathname === '/api/auth/register' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const username = typeof body.username === 'string' ? body.username : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const nickname = typeof body.nickname === 'string' ? body.nickname : undefined;
        const result = store.registerUser(username, password, nickname);
        sendJson(res, 201, result);
        return;
      }

      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const username = typeof body.username === 'string' ? body.username : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const result = store.loginUser(username, password);
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === '/api/auth/me' && req.method === 'GET') {
        const token = extractBearerToken(req);
        const user = store.getUserByToken(token);
        if (!user) {
          sendJson(res, 401, { code: 'UNAUTHORIZED', error: '登录已失效，请重新登录' });
          return;
        }
        sendJson(res, 200, { user });
        return;
      }

      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        const token = extractBearerToken(req);
        if (token) store.logoutToken(token);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === '/api/auth/profile' && req.method === 'POST') {
        const token = extractBearerToken(req);
        const user = store.getUserByToken(token);
        if (!user) {
          sendJson(res, 401, { code: 'UNAUTHORIZED', error: '请先登录' });
          return;
        }
        const body = await readJsonBody(req);
        const nickname = typeof body.nickname === 'string' ? body.nickname : '';
        const updated = store.updateNickname(user.id, nickname);
        sendJson(res, 200, { user: updated });
        return;
      }
    } catch (err) {
      if (err instanceof AuthError) {
        sendJson(res, err.status, { code: err.code, error: err.message });
        return;
      }
      sendJson(res, 500, {
        code: 'INTERNAL_ERROR',
        error: err instanceof Error ? err.message : '服务端错误',
      });
      return;
    }

    if (staticRoot && existsSync(staticRoot)) {
      const safePath = url.pathname === '/' ? '/index.html' : url.pathname;
      const fullPath = resolve(join(staticRoot, safePath));
      if (fullPath.startsWith(staticRoot) && existsSync(fullPath) && statSync(fullPath).isFile()) {
        const ext = extname(fullPath);
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
        });
        res.end(readFileSync(fullPath));
        return;
      }
      const fallback = join(staticRoot, 'index.html');
      if (existsSync(fallback)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync(fallback));
        return;
      }
    }

    sendJson(res, 404, { error: 'Not Found' });
  };

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res);
  });
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    contexts.set(ws, { roomId: null, playerId: null });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        sendWs(ws, {
          type: 'ACTION_ERROR',
          code: 'INVALID_JSON',
          message: '消息格式错误',
        });
        return;
      }

      const ctx = contexts.get(ws)!;

      try {
        if (msg.type === 'PING') {
          sendWs(ws, { type: 'PONG', ts: msg.ts, serverTs: Date.now() });
          return;
        }

        if (msg.type === 'CREATE_ROOM') {
          if (ctx.roomId && ctx.playerId) {
            roomManager.getRoom(ctx.roomId)?.handleDisconnect(ctx.playerId, ws);
            roomManager.pruneIfEmpty(ctx.roomId);
          }
          const authUser = store.getUserByToken(msg.authToken);
          const displayName = authUser ? authUser.nickname : msg.playerName;
          const room = roomManager.createRoom({
            mode: msg.mode ?? 'hongxin',
            debugMode: msg.debugMode ?? false,
          });
          const joined = room.addHuman(displayName, ws, 0, authUser?.id ?? null);
          if (msg.fillBots) {
            room.fillEmptySeatsWithBots();
            room.setRoomMode(joined.seat, room.mode);
          }
          ctx.roomId = room.roomId;
          ctx.playerId = joined.playerId;
          if (msg.autoStart && msg.fillBots) {
            room.startGame(joined.seat);
          }
          return;
        }

        if (msg.type === 'JOIN_ROOM') {
          const room = roomManager.getRoom(msg.roomId);
          if (!room) {
            sendWs(ws, {
              type: 'ACTION_ERROR',
              code: 'ROOM_NOT_FOUND',
              message: `房间 ${msg.roomId} 不存在`,
            });
            return;
          }
          if (msg.playerId) {
            room.reconnect(msg.playerId, ws);
            ctx.roomId = room.roomId;
            ctx.playerId = msg.playerId;
            return;
          }
          const authUser = store.getUserByToken(msg.authToken);
          const displayName = authUser ? authUser.nickname : msg.playerName;
          const joined = room.addHuman(
            displayName,
            ws,
            msg.preferredSeat,
            authUser?.id ?? null,
          );
          ctx.roomId = room.roomId;
          ctx.playerId = joined.playerId;
          return;
        }

        if (msg.type === 'RECONNECT') {
          const room = roomManager.getRoom(msg.roomId);
          if (!room) {
            sendWs(ws, {
              type: 'ACTION_ERROR',
              code: 'ROOM_NOT_FOUND',
              message: `房间 ${msg.roomId} 不存在`,
            });
            return;
          }
          room.reconnect(msg.playerId, ws);
          ctx.roomId = room.roomId;
          ctx.playerId = msg.playerId;
          return;
        }

        if (!ctx.roomId || !ctx.playerId) {
          sendWs(ws, {
            type: 'ACTION_ERROR',
            code: 'NOT_IN_ROOM',
            message: '请先创建或加入房间',
          });
          return;
        }
        const room = roomManager.getRoom(ctx.roomId);
        if (!room) {
          sendWs(ws, {
            type: 'ACTION_ERROR',
            code: 'ROOM_NOT_FOUND',
            message: '房间已关闭',
          });
          return;
        }
        const actorSeat = room.getSeatByPlayerId(ctx.playerId);
        if (actorSeat === null) {
          sendWs(ws, {
            type: 'ACTION_ERROR',
            code: 'SEAT_NOT_FOUND',
            message: '玩家不在房间座位中',
          });
          return;
        }

        switch (msg.type) {
          case 'SET_ROOM_MODE':
            room.setRoomMode(actorSeat, msg.mode);
            break;
          case 'SET_SEAT_BOT':
            room.setSeatBot(actorSeat, msg.seat, msg.isBot);
            break;
          case 'SWAP_SEAT':
            room.swapSeat(actorSeat, msg.targetSeat);
            break;
          case 'SET_READY':
            room.setReady(actorSeat, msg.ready);
            break;
          case 'START_GAME':
            room.startGame(actorSeat);
            break;
          case 'GAME_ACTION':
            room.handleGameAction(actorSeat, msg.action);
            break;
          case 'SET_AUTO_BOT':
            room.setAutoBot(actorSeat, msg.enabled);
            break;
          case 'TOGGLE_DEBUG_OPEN_HANDS':
            room.toggleDebugOpenHands(actorSeat, msg.enabled);
            break;
        }
      } catch (err) {
        sendWs(ws, {
          type: 'ACTION_ERROR',
          code: 'SERVER_ERROR',
          message: err instanceof Error ? err.message : '操作失败',
        });
      }
    });

    ws.on('close', () => {
      const ctx = contexts.get(ws);
      contexts.delete(ws);
      if (ctx?.roomId && ctx.playerId) {
        const room = roomManager.getRoom(ctx.roomId);
        if (room) {
          room.handleDisconnect(ctx.playerId, ws);
          roomManager.pruneIfEmpty(ctx.roomId);
        }
      }
    });
  });

  let actualPort = requestedPort;

  return {
    start: () =>
      new Promise((resolveStart, rejectStart) => {
        httpServer.once('error', rejectStart);
        httpServer.listen(requestedPort, host, () => {
          httpServer.off('error', rejectStart);
          const addr = httpServer.address() as AddressInfo;
          actualPort = addr.port;
          resolveStart({ port: actualPort, host });
        });
      }),
    stop: async () => {
      roomManager.disposeAll();
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolveClose) => {
        wss.close(() => {
          httpServer.close(() => resolveClose());
        });
      });
      store.close();
    },
    getPort: () => actualPort,
    roomManager,
    store,
  };
}
