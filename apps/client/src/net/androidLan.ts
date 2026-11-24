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

function getBridge(): NativeLanBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { JinshanAndroid?: NativeLanBridge };
  return w.JinshanAndroid ?? null;
}

export function isNativeLanHostSupported(): boolean {
  const b = getBridge();
  if (!b) return false;
  try {
    return typeof b.startLanHost === 'function' && (b.isLanSupported?.() ?? true);
  } catch {
    return false;
  }
}

export function getNativeLocalIps(): string[] {
  const b = getBridge();
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
  const b = getBridge();
  if (!b?.startLanHost) {
    return {
      ok: false,
      port: 0,
      hostToken: '',
      ips: [],
      primaryIp: '',
      error: '当前运行环境不支持内置局域网房主（请在安卓 APK 中使用）',
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

export function stopNativeLanHost(): void {
  try {
    getBridge()?.stopLanHost?.();
  } catch {
    // ignore
  }
}

export function getNativeLanHostStatus(): LanHostStatus | null {
  const b = getBridge();
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

export function startNativeLanDiscovery(): boolean {
  try {
    return Boolean(getBridge()?.startLanDiscovery?.());
  } catch {
    return false;
  }
}

export function stopNativeLanDiscovery(): void {
  try {
    getBridge()?.stopLanDiscovery?.();
  } catch {
    // ignore
  }
}

export function pollDiscoveredLanHosts(): DiscoveredLanHost[] {
  const b = getBridge();
  if (!b?.getDiscoveredLanHostsJson) return [];
  try {
    const parsed = JSON.parse(b.getDiscoveredLanHostsJson());
    if (!Array.isArray(parsed)) return [];
    return parsed as DiscoveredLanHost[];
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
