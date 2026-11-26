import {
  LocalHostController,
  type LocalRoundRecordedEvent,
  type PeerSocketLike,
} from '@jinshan/game-core';
import type { ClientMessage, RoomSummary, ServerMessage } from '@jinshan/protocol';

export type HostWorkerCommand =
  | { type: 'INIT'; lanBridgeUrl?: string }
  | { type: 'LOCAL_SEND'; msg: ClientMessage }
  | { type: 'RESET_ROOMS' }
  | { type: 'LAN_BRIDGE_ATTACH'; url: string }
  | { type: 'LAN_BRIDGE_DETACH' }
  | { type: 'DISPOSE' };

export type HostWorkerEvent =
  | { type: 'READY' }
  | { type: 'LOCAL_MSG'; msg: ServerMessage }
  | { type: 'ROOMS_CHANGED'; rooms: RoomSummary[] }
  | { type: 'ROUND_RECORDED'; event: LocalRoundRecordedEvent }
  | { type: 'LAN_BRIDGE_STATUS'; connected: boolean; peerCount: number; error?: string };

interface NativeBridgeInbound {
  type: 'PEER_OPEN' | 'PEER_MSG' | 'PEER_CLOSE';
  peerId: string;
  payload?: string;
}

const LOCAL_PEER_ID = 'local-host';

class LanBridgeClient {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly remotePeers = new Map<
    string,
    { readyState: number; socket: PeerSocketLike }
  >();

  constructor(
    private readonly controller: LocalHostController,
    private readonly onStatus: (connected: boolean, peerCount: number, error?: string) => void,
  ) {}

  attach(url: string): void {
    this.detach();
    this.disposed = false;
    this.url = url;
    this.openSocket();
  }

  private openSocket(): void {
    if (this.disposed || !this.url) return;
    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.pushRoomsSnapshot(this.controller.listRooms());
        this.onStatus(true, this.remotePeers.size);
      };

      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        let parsed: NativeBridgeInbound;
        try {
          parsed = JSON.parse(String(ev.data)) as NativeBridgeInbound;
        } catch {
          return;
        }
        if (!parsed || typeof parsed.peerId !== 'string') return;

        if (parsed.type === 'PEER_OPEN') {
          const peerId = `lan:${parsed.peerId}`;
          const holder: { readyState: number; socket: PeerSocketLike } = {
            readyState: 1,
            socket: {
              get readyState(): number {
                return holder.readyState;
              },
              send: (data: string) => {
                if (holder.readyState !== 1) return;
                this.sendBridge({
                  type: 'SEND',
                  peerId: parsed.peerId,
                  payload: data,
                });
              },
              close: (code?: number, reason?: string) => {
                if (holder.readyState === 3) return;
                holder.readyState = 3;
                this.sendBridge({
                  type: 'CLOSE',
                  peerId: parsed.peerId,
                  code: code ?? 1000,
                  reason: reason ?? '',
                });
              },
            } satisfies PeerSocketLike,
          };
          this.remotePeers.set(parsed.peerId, holder);
          this.controller.connectPeer(peerId, holder.socket);
          this.onStatus(true, this.remotePeers.size);
        } else if (parsed.type === 'PEER_MSG' && typeof parsed.payload === 'string') {
          this.controller.handleMessage(`lan:${parsed.peerId}`, parsed.payload);
        } else if (parsed.type === 'PEER_CLOSE') {
          const holder = this.remotePeers.get(parsed.peerId);
          if (holder) {
            holder.readyState = 3;
            this.remotePeers.delete(parsed.peerId);
          }
          this.controller.disconnectPeer(`lan:${parsed.peerId}`);
          this.onStatus(this.ws?.readyState === WebSocket.OPEN, this.remotePeers.size);
        }
      };

      ws.onerror = () => {
        // handled by onclose
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.disconnectAllRemotePeers();
        this.onStatus(false, 0);
        if (!this.disposed && this.url) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.openSocket();
          }, 1200);
        }
      };
    } catch (err) {
      this.onStatus(
        false,
        0,
        err instanceof Error ? err.message : '无法连接局域网本地中继',
      );
    }
  }

  pushRoomsSnapshot(rooms: RoomSummary[]): void {
    this.sendBridge({
      type: 'ROOMS_SNAPSHOT',
      rooms,
    });
  }

  private sendBridge(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private disconnectAllRemotePeers(): void {
    for (const [rawId, holder] of this.remotePeers) {
      holder.readyState = 3;
      this.controller.disconnectPeer(`lan:${rawId}`);
    }
    this.remotePeers.clear();
  }

  detach(): void {
    this.disposed = true;
    this.url = null;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onclose = null;
      old.close();
    }
    this.disconnectAllRemotePeers();
    this.onStatus(false, 0);
  }
}

export function createHostRuntime(emit: (ev: HostWorkerEvent) => void): {
  dispatch: (cmd: HostWorkerCommand) => void;
} {
  let controller: LocalHostController | null = null;
  let lanBridge: LanBridgeClient | null = null;
  let localOpen = false;

  const ensureInitialized = () => {
    if (controller) return;
    controller = new LocalHostController({
      botDelayMs: 420,
      onRoomsChanged: (rooms) => {
        emit({ type: 'ROOMS_CHANGED', rooms });
        lanBridge?.pushRoomsSnapshot(rooms);
      },
      onRoundRecorded: (event) => {
        emit({ type: 'ROUND_RECORDED', event });
      },
    });
    lanBridge = new LanBridgeClient(controller, (connected, peerCount, error) => {
      emit({ type: 'LAN_BRIDGE_STATUS', connected, peerCount, error });
    });

    localOpen = true;
    const localSocket: PeerSocketLike = {
      get readyState() {
        return localOpen ? 1 : 3;
      },
      send(raw: string) {
        if (!localOpen) return;
        try {
          const parsed = JSON.parse(raw) as ServerMessage;
          emit({ type: 'LOCAL_MSG', msg: parsed });
        } catch {
          // ignore
        }
      },
      close() {
        localOpen = false;
      },
    };
    controller.connectPeer(LOCAL_PEER_ID, localSocket);
    emit({ type: 'READY' });
  };

  return {
    dispatch(cmd: HostWorkerCommand) {
      switch (cmd.type) {
        case 'INIT':
          ensureInitialized();
          if (cmd.lanBridgeUrl) {
            lanBridge?.attach(cmd.lanBridgeUrl);
          }
          break;
        case 'LOCAL_SEND':
          ensureInitialized();
          controller?.handleMessage(LOCAL_PEER_ID, cmd.msg);
          break;
        case 'RESET_ROOMS':
          controller?.roomManager.disposeAll();
          break;
        case 'LAN_BRIDGE_ATTACH':
          ensureInitialized();
          lanBridge?.attach(cmd.url);
          break;
        case 'LAN_BRIDGE_DETACH':
          lanBridge?.detach();
          break;
        case 'DISPOSE':
          localOpen = false;
          lanBridge?.detach();
          controller?.dispose();
          controller = null;
          lanBridge = null;
          break;
      }
    },
  };
}

// Worker entrypoint when executed as a DedicatedWorkerGlobalScope
const workerScope = globalThis as unknown as {
  postMessage?: (msg: HostWorkerEvent) => void;
  onmessage?: ((ev: MessageEvent<HostWorkerCommand>) => void) | null;
  document?: unknown;
};

if (typeof workerScope.document === 'undefined' && typeof workerScope.postMessage === 'function') {
  const runtime = createHostRuntime((ev) => {
    workerScope.postMessage?.(ev);
  });
  workerScope.onmessage = (ev: MessageEvent<HostWorkerCommand>) => {
    runtime.dispatch(ev.data);
  };
}
