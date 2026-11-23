import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@jinshan/protocol';
import { AuthError, HistoryStore } from './db.js';
import { RoomAdmissionError, type RoomTimingOptions } from './room.js';
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

class RoomMessageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSeat(value: unknown): value is 0 | 1 | 2 | 3 {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isGameMode(value: unknown): value is 'hongxin' | 'heixin' {
  return value === 'hongxin' || value === 'heixin';
}

function badRoomMessage(): never {
  throw new RoomMessageError('INVALID_MESSAGE', '房间消息参数无效');
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') badRoomMessage();
  return value;
}

function playerName(value: unknown): string {
  if (typeof value !== 'string') badRoomMessage();
  return Array.from(value.trim()).slice(0, 16).join('');
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
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > 64 * 1024) {
        tooLarge = true;
        chunks.length = 0;
        rejectBody(new AuthError(413, 'PAYLOAD_TOO_LARGE', '请求体过大'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        const body: unknown = raw ? JSON.parse(raw) : {};
        if (!isJsonObject(body)) throw new Error();
        resolveBody(body);
      } catch {
        rejectBody(new AuthError(400, 'INVALID_JSON', '请求体必须是 JSON 对象'));
      }
    });
    req.on('error', rejectBody);
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
  const credentialAttempts = new Map<string, number>();
  const authWindowMs = 60_000;
  let authWindowEnd = 0;
  let totalAuthAttempts = 0;

  function checkCredentialBudget(req: IncomingMessage, res: ServerResponse): void {
    const now = Date.now();
    if (now >= authWindowEnd) {
      authWindowEnd = now + authWindowMs;
      credentialAttempts.clear();
      totalAuthAttempts = 0;
    }
    const address = req.socket.remoteAddress ?? '';
    const count = credentialAttempts.get(address) ?? 0;
    if (count >= 20 || totalAuthAttempts >= 120) {
      res.setHeader('Retry-After', Math.ceil((authWindowEnd - now) / 1000));
      throw new AuthError(429, 'TOO_MANY_REQUESTS', '登录或注册过于频繁，请稍后再试');
    }
    credentialAttempts.set(address, count + 1);
    totalAuthAttempts++;
  }

  const handleHttp = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');

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

      // Bound synchronous password work per source and across the whole server.
      if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(url.pathname)) {
        checkCredentialBudget(req, res);
      }
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
        const body = await readJsonBody(req);
        const token = extractBearerToken(req);
        const user = store.getUserByToken(token);
        if (!user) {
          sendJson(res, 401, { code: 'UNAUTHORIZED', error: '请先登录' });
          return;
        }
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
      console.error('HTTP API error', err);
      if (!res.destroyed) sendJson(res, 500, { code: 'INTERNAL_ERROR', error: '服务端错误' });
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
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });

  function authenticate(token: unknown) {
    if (token === undefined) return null; // Guests remain supported.
    if (typeof token !== 'string') badRoomMessage();
    const user = store.getUserByToken(token);
    if (!user) throw new RoomMessageError('UNAUTHORIZED', '登录已失效，请重新登录');
    return user;
  }

  wss.on('connection', (ws) => {
    const ctx: ConnContext = { roomId: null, playerId: null };
    contexts.set(ws, ctx);
    ws.on('error', () => { /* ws closes invalid frames; clean up on close. */ });

    ws.on('message', (raw) => {
      if (ws.readyState !== ws.OPEN) return;
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        sendWs(ws, { type: 'ACTION_ERROR', code: 'INVALID_JSON', message: '消息格式错误' });
        return;
      }

      try {
        if (!isJsonObject(payload) || typeof payload.type !== 'string') badRoomMessage();
        // The protocol types describe trusted values; validate room fields before use.
        const msg = payload as unknown as ClientMessage;
        if (msg.type === 'PING') {
          if (!Number.isFinite(msg.ts)) badRoomMessage();
          sendWs(ws, { type: 'PONG', ts: msg.ts, serverTs: Date.now() });
          return;
        }

        const previousRoom = ctx.roomId ? roomManager.getRoom(ctx.roomId) : undefined;
        const currentSeat = ctx.playerId ? previousRoom?.getSeatByPlayerId(ctx.playerId, ws) ?? null : null;
        if (msg.type === 'LEAVE_ROOM') {
          if (ctx.playerId && currentSeat !== null) previousRoom?.leave(ctx.playerId, ws);
          ctx.roomId = null;
          ctx.playerId = null;
          sendWs(ws, { type: 'ROOM_LEFT' });
          return;
        }

        if (msg.type === 'CREATE_ROOM' || msg.type === 'JOIN_ROOM' || msg.type === 'RECONNECT') {
          if (currentSeat !== null) {
            throw new RoomMessageError('ALREADY_IN_ROOM', '请先退出当前房间');
          }

          if (msg.type === 'CREATE_ROOM') {
            const mode = msg.mode === undefined ? 'hongxin' : msg.mode;
            if (!isGameMode(mode)) badRoomMessage();
            const debugMode = msg.debugMode === undefined ? false : requireBoolean(msg.debugMode);
            const fillBots = msg.fillBots === undefined ? false : requireBoolean(msg.fillBots);
            const autoStart = msg.autoStart === undefined ? false : requireBoolean(msg.autoStart);
            if (autoStart && !fillBots) badRoomMessage();
            const user = authenticate(msg.authToken);
            const displayName = user?.nickname ?? playerName(msg.playerName);
            const room = roomManager.createRoom({ mode, debugMode });
            const joined = room.addHuman(displayName, ws, 0, user?.id ?? null);
            if (fillBots) {
              room.fillEmptySeatsWithBots();
              room.setRoomMode(joined.seat, mode); // Publish the filled seats before starting.
            }
            ctx.roomId = room.roomId;
            ctx.playerId = joined.playerId;
            if (autoStart) room.startGame(joined.seat);
            return;
          }

          if (typeof msg.roomId !== 'string' || !/^\d{6}$/.test(msg.roomId)) badRoomMessage();
          const room = roomManager.getRoom(msg.roomId);
          if (!room) throw new RoomMessageError('ROOM_NOT_FOUND', '房间不存在或已关闭');
          if (msg.type === 'RECONNECT' || msg.playerId !== undefined) {
            if (typeof msg.playerId !== 'string' || !/^[0-9a-f-]{36}$/.test(msg.playerId)) badRoomMessage();
            const ownerId = room.getSeatOwnerId(msg.playerId);
            if (ownerId === undefined) throw new RoomMessageError('RECONNECT_EXPIRED', '原座位已失效，请重新加入');
            if (ownerId !== null && authenticate(msg.authToken)?.id !== ownerId) {
              throw new RoomMessageError('RECONNECT_AUTH_REQUIRED', '请使用原账号登录后重连');
            }
            room.reconnect(msg.playerId, ws);
            ctx.roomId = room.roomId;
            ctx.playerId = msg.playerId;
            return;
          }

          if (msg.preferredSeat !== undefined && !isSeat(msg.preferredSeat)) badRoomMessage();
          const user = authenticate(msg.authToken);
          const displayName = user?.nickname ?? playerName(msg.playerName);
          const joined = room.addHuman(displayName, ws, msg.preferredSeat, user?.id ?? null);
          ctx.roomId = room.roomId;
          ctx.playerId = joined.playerId;
          return;
        }

        if (!previousRoom || currentSeat === null) {
          throw new RoomMessageError('NOT_IN_ROOM', '请先创建或加入房间');
        }
        const room = previousRoom;
        const actorSeat = currentSeat;

        switch (msg.type) {
          case 'SET_ROOM_MODE':
            if (!isGameMode(msg.mode)) badRoomMessage();
            room.setRoomMode(actorSeat, msg.mode);
            break;
          case 'SET_SEAT_BOT':
            if (!isSeat(msg.seat)) badRoomMessage();
            room.setSeatBot(actorSeat, msg.seat, requireBoolean(msg.isBot));
            break;
          case 'SWAP_SEAT':
            if (!isSeat(msg.targetSeat)) badRoomMessage();
            room.swapSeat(actorSeat, msg.targetSeat);
            break;
          case 'SET_READY':
            room.setReady(actorSeat, requireBoolean(msg.ready));
            break;
          case 'START_GAME':
            room.startGame(actorSeat);
            break;
          case 'GAME_ACTION':
            if (!isJsonObject(msg.action) || typeof msg.action.type !== 'string') badRoomMessage();
            room.handleGameAction(actorSeat, msg.action);
            break;
          case 'SET_AUTO_BOT':
            room.setAutoBot(actorSeat, requireBoolean(msg.enabled));
            break;
          case 'TOGGLE_DEBUG_OPEN_HANDS':
            room.toggleDebugOpenHands(actorSeat, requireBoolean(msg.enabled));
            break;
          default:
            badRoomMessage();
        }
      } catch (err) {
        if (err instanceof RoomMessageError || err instanceof RoomAdmissionError) {
          sendWs(ws, { type: 'ACTION_ERROR', code: err.code, message: err.message });
        } else {
          console.error('WebSocket room error', err);
          sendWs(ws, { type: 'ACTION_ERROR', code: 'SERVER_ERROR', message: '操作失败' });
        }
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
