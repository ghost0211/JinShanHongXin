import type { GameMode } from '@jinshan/protocol';

export interface LanHostStartResult {
  ok: boolean;
  port: number;
  hostToken: string;
  ips: string[];
  primaryIp: string;
  error?: string;
}

export interface LanHostStatus {
  running: boolean;
  port: number;
  hostToken: string;
  ips: string[];
  primaryIp: string;
  guestCount: number;
}

export interface DiscoveredLanHost {
  ip: string;
  port: number;
  url: string;
  hostName: string;
  roomId: string;
  mode: GameMode;
  status: 'WAITING' | 'IN_GAME' | 'FINISHED';
  occupied: number;
  humanCount: number;
  maxSeats: number;
  isSelf: boolean;
  lastSeenMs: number;
}

interface NativeLanBridge {
  isAndroidApk?: () => boolean;
  isLanSupported?: () => boolean;
  getLocalIpsJson?: () => string;
  startLanHost?: (preferredPort: number, hostName: string) => string;
  stopLanHost?: () => void;
  getLanHostStatusJson?: () => string;
  startLanDiscovery?: () => boolean;
  stopLanDiscovery?: () => void;
  getDiscoveredLanHostsJson?: () => string;
}

type TauriInvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function getAndroidBridge(): NativeLanBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { JinshanAndroid?: NativeLanBridge };
  return w.JinshanAndroid ?? null;
}

function getTauriInvoke(): TauriInvokeFn | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: TauriInvokeFn } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvokeFn };
  };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
}

function isAndroidLanAvailable(): boolean {
  const b = getAndroidBridge();
  if (!b) return false;
  try {
    return typeof b.startLanHost === 'function' && (b.isLanSupported?.() ?? true);
  } catch {
    return false;
  }
}

export function isNativeLanHostSupported(): boolean {
  if (isAndroidLanAvailable()) return true;
  return getTauriInvoke() !== null;
}

export function getNativeLocalIps(): string[] {
  const b = getAndroidBridge();
  if (!b?.getLocalIpsJson) return [];
  try {
    const parsed = JSON.parse(b.getLocalIpsJson());
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function startNativeLanHost(
  preferredPort: number,
  hostName: string,
): LanHostStartResult {
  const b = getAndroidBridge();
  if (!b?.startLanHost) {
    return {
      ok: false,
      port: 0,
      hostToken: '',
      ips: [],
      primaryIp: '',
      error: '当前运行环境不支持内置局域网房主（请在安卓 APK 或 Windows 客户端中使用）',
    };
  }
  try {
    const raw = b.startLanHost(preferredPort, hostName || '金山房主');
    const parsed = JSON.parse(raw) as Partial<LanHostStartResult>;
    if (!parsed.ok || !parsed.port || !parsed.hostToken) {
      return {
        ok: false,
        port: 0,
        hostToken: '',
        ips: [],
        primaryIp: '',
        error: parsed.error || '启动局域网服务失败',
      };
    }
    const ips = Array.isArray(parsed.ips) ? parsed.ips : [];
    return {
      ok: true,
      port: parsed.port,
      hostToken: parsed.hostToken,
      ips,
      primaryIp: parsed.primaryIp || ips[0] || '',
    };
  } catch (err) {
    return {
      ok: false,
      port: 0,
      hostToken: '',
      ips: [],
      primaryIp: '',
      error: err instanceof Error ? err.message : '启动局域网服务异常',
    };
  }
}

export async function startNativeLanHostAsync(
  preferredPort: number,
  hostName: string,
): Promise<LanHostStartResult> {
  if (isAndroidLanAvailable()) {
    return startNativeLanHost(preferredPort, hostName);
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    return {
      ok: false,
      port: 0,
      hostToken: '',
      ips: [],
      primaryIp: '',
      error: '当前运行环境不支持内置局域网房主（请在安卓 APK 或 Windows 客户端中使用）',
    };
  }
  try {
    const parsed = await invoke<Partial<LanHostStartResult>>('lan_start_host', {
      preferredPort,
      hostName: hostName || '金山房主',
    });
    if (!parsed?.ok || !parsed.port || !parsed.hostToken) {
      return {
        ok: false,
        port: 0,
        hostToken: '',
        ips: [],
        primaryIp: '',
        error: parsed?.error || '启动局域网服务失败',
      };
    }
    const ips = Array.isArray(parsed.ips) ? parsed.ips : [];
    return {
      ok: true,
      port: parsed.port,
      hostToken: parsed.hostToken,
      ips,
      primaryIp: parsed.primaryIp || ips[0] || '',
    };
  } catch (err) {
    return {
      ok: false,
      port: 0,
      hostToken: '',
      ips: [],
      primaryIp: '',
      error: err instanceof Error ? err.message : '启动局域网服务异常',
    };
  }
}

export function stopNativeLanHost(): void {
  try {
    getAndroidBridge()?.stopLanHost?.();
  } catch {
    // ignore
  }
  const invoke = getTauriInvoke();
  if (invoke) {
    void invoke<void>('lan_stop_host').catch(() => {});
  }
}

export async function stopNativeLanHostAsync(): Promise<void> {
  try {
    getAndroidBridge()?.stopLanHost?.();
  } catch {
    // ignore
  }
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke<void>('lan_stop_host');
    } catch {
      // ignore
    }
  }
}

export function getNativeLanHostStatus(): LanHostStatus | null {
  const b = getAndroidBridge();
  if (!b?.getLanHostStatusJson) return null;
  try {
    const parsed = JSON.parse(b.getLanHostStatusJson()) as Partial<LanHostStatus>;
    const ips = Array.isArray(parsed.ips) ? parsed.ips : [];
    return {
      running: Boolean(parsed.running),
      port: parsed.port ?? 0,
      hostToken: parsed.hostToken ?? '',
      ips,
      primaryIp: parsed.primaryIp || ips[0] || '',
      guestCount: parsed.guestCount ?? 0,
    };
  } catch {
    return null;
  }
}

export async function getNativeLanHostStatusAsync(): Promise<LanHostStatus | null> {
  if (isAndroidLanAvailable()) {
    return getNativeLanHostStatus();
  }
  const invoke = getTauriInvoke();
  if (!invoke) return null;
  try {
    const parsed = await invoke<Partial<LanHostStatus>>('lan_get_host_status');
    const ips = Array.isArray(parsed?.ips) ? parsed.ips : [];
    return {
      running: Boolean(parsed?.running),
      port: parsed?.port ?? 0,
      hostToken: parsed?.hostToken ?? '',
      ips,
      primaryIp: parsed?.primaryIp || ips[0] || '',
      guestCount: parsed?.guestCount ?? 0,
    };
  } catch {
    return null;
  }
}

export function startNativeLanDiscovery(): boolean {
  try {
    if (getAndroidBridge()?.startLanDiscovery) {
      return Boolean(getAndroidBridge()?.startLanDiscovery?.());
    }
  } catch {
    return false;
  }
  const invoke = getTauriInvoke();
  if (invoke) {
    void invoke<boolean>('lan_start_discovery').catch(() => {});
    return true;
  }
  return false;
}

export async function startNativeLanDiscoveryAsync(): Promise<boolean> {
  if (isAndroidLanAvailable()) {
    return startNativeLanDiscovery();
  }
  const invoke = getTauriInvoke();
  if (!invoke) return false;
  try {
    return Boolean(await invoke<boolean>('lan_start_discovery'));
  } catch {
    return false;
  }
}

export function stopNativeLanDiscovery(): void {
  try {
    getAndroidBridge()?.stopLanDiscovery?.();
  } catch {
    // ignore
  }
  const invoke = getTauriInvoke();
  if (invoke) {
    void invoke<void>('lan_stop_discovery').catch(() => {});
  }
}

export async function stopNativeLanDiscoveryAsync(): Promise<void> {
  try {
    getAndroidBridge()?.stopLanDiscovery?.();
  } catch {
    // ignore
  }
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke<void>('lan_stop_discovery');
    } catch {
      // ignore
    }
  }
}

export function pollDiscoveredLanHosts(): DiscoveredLanHost[] {
  const b = getAndroidBridge();
  if (!b?.getDiscoveredLanHostsJson) return [];
  try {
    const parsed = JSON.parse(b.getDiscoveredLanHostsJson());
    if (!Array.isArray(parsed)) return [];
    return parsed as DiscoveredLanHost[];
  } catch {
    return [];
  }
}

export async function pollDiscoveredLanHostsAsync(): Promise<DiscoveredLanHost[]> {
  if (isAndroidLanAvailable()) {
    return pollDiscoveredLanHosts();
  }
  const invoke = getTauriInvoke();
  if (!invoke) return [];
  try {
    const parsed = await invoke<DiscoveredLanHost[]>('lan_get_discovered_hosts');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function buildLanJoinUrl(ip: string, port: number, roomId?: string): string {
  const base = `http://${ip}:${port}`;
  if (roomId && /^\d{6}$/.test(roomId)) {
    return `${base}/?lan=1&room=${roomId}`;
  }
  return `${base}/?lan=1`;
}

export function buildLanHostBridgeWsUrl(port: number, hostToken: string): string {
  return `ws://127.0.0.1:${port}/host?token=${encodeURIComponent(hostToken)}`;
}
