import type { ClientMessage, ServerMessage } from '@jinshan/protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface GameTransport {
  connect(): void;
  send(msg: ClientMessage): boolean;
  onMessage(cb: (msg: ServerMessage) => void): () => void;
  onStatus(cb: (status: ConnectionStatus) => void): () => void;
  dispose(): void;
}

const SERVER_URL_KEY = 'jinshan_server_url';
const APK_VIRTUAL_HOST = 'appassets.jinshan.local';

export function isRunningInTauriDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return (
    Boolean(win.__TAURI_INTERNALS__) ||
    Boolean(win.__TAURI__) ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost' ||
    window.location.hostname.endsWith('.tauri.localhost')
  );
}

export function isRunningInAndroidApk(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname === APK_VIRTUAL_HOST ||
    Boolean((window as unknown as { JinshanAndroid?: unknown }).JinshanAndroid)
  );
}

export function isRunningInNativeShell(): boolean {
  return isRunningInAndroidApk() || isRunningInTauriDesktop();
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
    const http = trimmed.startsWith('ws://') ? `http://${trimmed.slice(5)}`
      : trimmed.startsWith('wss://') ? `https://${trimmed.slice(6)}`
      : /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
    return http.endsWith('/ws') ? http.slice(0, -3) : http;
  }
  if (
    typeof window !== 'undefined' &&
    !isRunningInNativeShell() &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ) {
    return '';
  }
  return 'http://127.0.0.1:3001';
}

export function resolveWsUrl(customUrl: string): string {
  const trimmed = customUrl.trim().replace(/\/+$/, '');
  if (trimmed) {
    return `${resolveHttpBase(trimmed).replace(/^http/, 'ws')}/ws`;
  }
  if (
    typeof window !== 'undefined' &&
    !isRunningInNativeShell() &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}/ws`;
  }
  return 'ws://127.0.0.1:3001/ws';
}

export class ManagedWsClient implements GameTransport {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private status: ConnectionStatus = 'disconnected';
  private retryAttempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private disposed = false;

  private readonly messageListeners = new Set<(msg: ServerMessage) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly onSeatReplaced?: () => void;

  constructor(initialUrl: string, onSeatReplaced?: () => void) {
    this.wsUrl = resolveWsUrl(initialUrl);
    this.onSeatReplaced = onSeatReplaced;
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
    };

    socket.onmessage = (ev) => {
      if (this.ws !== socket) return;
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

    socket.onclose = (event) => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.clearPing();
      if (event.code === 4001) this.onSeatReplaced?.();
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

  send(msg: ClientMessage): boolean {
    // A reconnect takes a fresh snapshot; never replay stale mutations into it.
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
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
