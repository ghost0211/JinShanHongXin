import type { ClientMessage, ServerMessage } from '@jinshan/protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const SERVER_URL_KEY = 'jinshan_server_url';
const APK_VIRTUAL_HOST = 'appassets.jinshan.local';

export function isRunningInAndroidApk(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname === APK_VIRTUAL_HOST ||
    Boolean((window as unknown as { JinshanAndroid?: unknown }).JinshanAndroid)
  );
}

export function getSavedServerUrl(): string {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('server');
    if (fromQuery) {
      localStorage.setItem(SERVER_URL_KEY, fromQuery);
      return fromQuery;
    }
    return localStorage.getItem(SERVER_URL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveServerUrl(url: string): void {
  try {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (trimmed) {
      localStorage.setItem(SERVER_URL_KEY, trimmed);
    } else {
      localStorage.removeItem(SERVER_URL_KEY);
    }
  } catch {
    // ignore
  }
}

export function resolveHttpBase(customUrl: string): string {
  const trimmed = customUrl.trim().replace(/\/+$/, '');
  if (trimmed) {
    if (trimmed.startsWith('ws://')) return `http://${trimmed.slice(5)}`;
    if (trimmed.startsWith('wss://')) return `https://${trimmed.slice(6)}`;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    return `http://${trimmed}`;
  }
  if (
    typeof window !== 'undefined' &&
    window.location.hostname !== APK_VIRTUAL_HOST &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ) {
    return '';
  }
  return 'http://127.0.0.1:3001';
}

export function resolveWsUrl(customUrl: string): string {
  const trimmed = customUrl.trim().replace(/\/+$/, '');
  if (trimmed) {
    if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
      return trimmed.endsWith('/ws') ? trimmed : `${trimmed}/ws`;
    }
    if (trimmed.startsWith('http://')) {
      return `ws://${trimmed.slice(7)}/ws`;
    }
    if (trimmed.startsWith('https://')) {
      return `wss://${trimmed.slice(8)}/ws`;
    }
    return `ws://${trimmed}/ws`;
  }
  if (
    typeof window !== 'undefined' &&
    window.location.hostname !== APK_VIRTUAL_HOST &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}/ws`;
  }
  return 'ws://127.0.0.1:3001/ws';
}

export class ManagedWsClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private status: ConnectionStatus = 'disconnected';
  private retryAttempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private disposed = false;

  private readonly messageListeners = new Set<(msg: ServerMessage) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private pendingQueue: ClientMessage[] = [];

  constructor(initialUrl: string) {
    this.wsUrl = resolveWsUrl(initialUrl);
  }

  onMessage(cb: (msg: ServerMessage) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onStatus(cb: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const cb of this.statusListeners) {
      cb(status);
    }
  }

  connect(newCustomUrl?: string): void {
    if (newCustomUrl !== undefined) {
      this.wsUrl = resolveWsUrl(newCustomUrl);
    }
    this.disposed = false;
    this.clearTimers();

    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onclose = null;
      old.close();
    }

    this.setStatus('connecting');
    const socket = new WebSocket(this.wsUrl);
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.retryAttempt = 0;
      this.setStatus('connected');
      this.startHeartbeat();
      while (this.pendingQueue.length > 0 && socket.readyState === WebSocket.OPEN) {
        const msg = this.pendingQueue.shift()!;
        socket.send(JSON.stringify(msg));
      }
    };

    socket.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as ServerMessage;
        for (const cb of this.messageListeners) {
          cb(parsed);
        }
      } catch {
        // ignore invalid frames
      }
    };

    socket.onerror = () => {
      // close listener handles reconnect
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.clearPing();
      this.setStatus('disconnected');
      if (!this.disposed) {
        const delay = Math.min(8000, 1000 * Math.pow(2, this.retryAttempt));
        this.retryAttempt += 1;
        this.reconnectTimer = window.setTimeout(() => {
          this.connect();
        }, delay);
      }
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    // Never queue stale gameplay actions across disconnects
    if (msg.type === 'GAME_ACTION') return;
    this.pendingQueue.push(msg);
  }

  private startHeartbeat(): void {
    this.clearPing();
    this.pingTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING', ts: Date.now() }));
      }
    }, 15000);
  }

  private clearPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onclose = null;
      old.close();
    }
  }
}
