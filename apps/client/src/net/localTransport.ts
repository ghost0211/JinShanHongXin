import type { LocalRoundRecordedEvent } from '@jinshan/game-core';
import type { ClientMessage, RoomSummary, ServerMessage } from '@jinshan/protocol';
import {
  createHostRuntime,
  type HostWorkerCommand,
  type HostWorkerEvent,
} from './localHost.worker.js';
import type { ConnectionStatus, GameTransport } from './wsClient.js';

export interface LanBridgeStatus {
  connected: boolean;
  peerCount: number;
  error?: string;
}

export interface LocalTransportCallbacks {
  onRoomsChanged?: (rooms: RoomSummary[]) => void;
  onRoundRecorded?: (event: LocalRoundRecordedEvent) => void;
  onLanBridgeStatus?: (status: LanBridgeStatus) => void;
}

/**
 * In-device GameTransport backed by a Web Worker running `LocalHostController`.
 * Automatically falls back to main-thread execution if Web Workers are unavailable
 * or blocked in a restricted WebView environment.
 */
export class LocalWorkerTransport implements GameTransport {
  private worker: Worker | null = null;
  private inlineRuntime: { dispatch: (cmd: HostWorkerCommand) => void } | null = null;
  private status: ConnectionStatus = 'disconnected';
  private disposed = false;
  private workerReady = false;
  private pendingCommands: HostWorkerCommand[] = [];

  private readonly messageListeners = new Set<(msg: ServerMessage) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(
    private readonly callbacks: LocalTransportCallbacks = {},
    private readonly initialLanBridgeUrl?: string,
  ) {}

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

  private handleEvent(ev: HostWorkerEvent): void {
    if (this.disposed) return;
    switch (ev.type) {
      case 'READY':
        this.workerReady = true;
        this.setStatus('connected');
        this.flushPending();
        break;
      case 'LOCAL_MSG':
        for (const cb of this.messageListeners) {
          cb(ev.msg);
        }
        break;
      case 'ROOMS_CHANGED':
        this.callbacks.onRoomsChanged?.(ev.rooms);
        break;
      case 'ROUND_RECORDED':
        this.callbacks.onRoundRecorded?.(ev.event);
        break;
      case 'LAN_BRIDGE_STATUS':
        this.callbacks.onLanBridgeStatus?.({
          connected: ev.connected,
          peerCount: ev.peerCount,
          error: ev.error,
        });
        break;
    }
  }

  private flushPending(): void {
    if (this.pendingCommands.length === 0) return;
    const queued = this.pendingCommands;
    this.pendingCommands = [];
    for (const cmd of queued) {
      this.postCommand(cmd);
    }
  }

  private postCommand(cmd: HostWorkerCommand): void {
    if (this.disposed) return;
    if (this.inlineRuntime) {
      this.inlineRuntime.dispatch(cmd);
      return;
    }
    if (this.worker && (this.workerReady || cmd.type === 'INIT')) {
      this.worker.postMessage(cmd);
    } else {
      this.pendingCommands.push(cmd);
    }
  }

  private startInlineFallback(): void {
    if (this.disposed || this.inlineRuntime) return;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.inlineRuntime = createHostRuntime((ev) => this.handleEvent(ev));
    this.inlineRuntime.dispatch({
      type: 'INIT',
      lanBridgeUrl: this.initialLanBridgeUrl,
    });
  }

  connect(): void {
    if (this.disposed) return;
    if (this.worker || this.inlineRuntime) return;

    this.setStatus('connecting');

    if (typeof Worker !== 'undefined') {
      try {
        const w = new Worker(new URL('./localHost.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker = w;
        w.onmessage = (ev: MessageEvent<HostWorkerEvent>) => {
          this.handleEvent(ev.data);
        };
        w.onerror = () => {
          if (!this.workerReady) {
            this.startInlineFallback();
          }
        };
        w.postMessage({
          type: 'INIT',
          lanBridgeUrl: this.initialLanBridgeUrl,
        } satisfies HostWorkerCommand);
        return;
      } catch {
        // Fallback to inline runtime below
      }
    }

    this.startInlineFallback();
  }

  attachLanBridge(url: string): void {
    this.postCommand({ type: 'LAN_BRIDGE_ATTACH', url });
  }

  detachLanBridge(): void {
    this.postCommand({ type: 'LAN_BRIDGE_DETACH' });
  }

  resetRooms(): void {
    this.postCommand({ type: 'RESET_ROOMS' });
  }

  send(msg: ClientMessage): boolean {
    if (this.disposed) return false;
    this.postCommand({ type: 'LOCAL_SEND', msg });
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.pendingCommands = [];
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'DISPOSE' } satisfies HostWorkerCommand);
      } catch {
        // ignore
      }
      this.worker.terminate();
      this.worker = null;
    }
    if (this.inlineRuntime) {
      this.inlineRuntime.dispatch({ type: 'DISPOSE' });
      this.inlineRuntime = null;
    }
    this.setStatus('disconnected');
  }
}
