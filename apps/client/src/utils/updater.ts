declare const __APP_VERSION__: string | undefined;
declare const __GITHUB_REPO__: string | undefined;

function isTauriDesktopEnv(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return (
    Boolean(win.__TAURI_INTERNALS__) ||
    Boolean(win.__TAURI__) ||
    window.location?.protocol === 'tauri:' ||
    window.location?.hostname === 'tauri.localhost' ||
    Boolean(window.location?.hostname?.endsWith('.tauri.localhost'))
  );
}

function normalizeServerHttpBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^ws/i, 'http').replace(/\/ws$/i, '');
  }
  return `http://${trimmed}`;
}

export const BUNDLED_APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()
    ? __APP_VERSION__.trim().replace(/^v/i, '')
    : '0.3.0';

export const DEFAULT_GITHUB_REPO: string =
  typeof __GITHUB_REPO__ === 'string' && __GITHUB_REPO__.trim()
    ? __GITHUB_REPO__.trim()
    : 'ghost0211/JinShanHongXin';

export type ClientPlatform = 'android' | 'windows' | 'desktop' | 'web';

export interface CurrentVersionInfo {
  platform: ClientPlatform;
  nativeVersion: string;
  webVersion: string;
  otaVersion: string | null;
  otaActive: boolean;
  supportsOta: boolean;
  effectiveVersion: string;
}

export interface UpdateAssetInfo {
  fileName: string;
  url: string;
  sha256?: string;
  size?: number;
}

export interface UpdateManifest {
  schemaVersion: number;
  version: string;
  tag: string;
  publishedAt: string;
  minNativeVersion: string;
  notes: string;
  releaseUrl: string;
  webBundle: UpdateAssetInfo | null;
  androidApk: UpdateAssetInfo | null;
  windowsInstaller: UpdateAssetInfo | null;
  windowsPortable: UpdateAssetInfo | null;
  relayAssets?: Record<string, string>;
}

export type UpdateActionKind = 'up-to-date' | 'ota-hot-update' | 'native-install' | 'web-refresh';

export interface UpdatePlan {
  kind: UpdateActionKind;
  hasUpdate: boolean;
  reason: string;
  primaryAsset: UpdateAssetInfo | null;
  secondaryAsset: UpdateAssetInfo | null;
}

export interface OtaTaskStatus {
  state: 'idle' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error';
  version: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  error: string;
}

export interface UpdateCheckResult {
  ok: boolean;
  current: CurrentVersionInfo;
  manifest: UpdateManifest | null;
  plan: UpdatePlan | null;
  source: 'mirror' | 'github-direct' | 'github-api' | 'server-relay' | null;
  relayBaseUrl: string | null;
  error?: string;
}

interface AndroidOtaBridge {
  isAndroidApk?: () => boolean;
  getAppVersionInfoJson?: () => string;
  fetchTextUrl?: (url: string) => string;
  startOtaInstall?: (version: string, downloadUrl: string, expectedSha256: string) => string;
  getOtaTaskStatusJson?: () => string;
  confirmOtaBootReady?: () => void;
  clearOtaBundle?: () => boolean;
  reloadApp?: () => void;
  openExternalUrl?: (url: string) => boolean;
}

interface NativeTextFetchResponse {
  ok: boolean;
  status: number;
  body: string;
  error?: string;
}

const IGNORED_VERSION_KEY = 'jinshan.update.ignoredVersion';

function getAndroidBridge(): AndroidOtaBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { JinshanAndroid?: AndroidOtaBridge }).JinshanAndroid;
  return b && typeof b.isAndroidApk === 'function' ? b : null;
}

function getTauriInvoke():
  | (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>)
  | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    __TAURI__?: {
      core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
    };
    __TAURI_INTERNALS__?: {
      invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
  return win.__TAURI__?.core?.invoke ?? win.__TAURI_INTERNALS__?.invoke ?? null;
}

export function stripLeadingV(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^v/i, '').trim();
}

export function compareSemver(a: string, b: string): number {
  const parse = (s: string): [number, number, number] => {
    const clean = stripLeadingV(s).split('-')[0] ?? '';
    const parts = clean.split('.');
    return [
      Number.parseInt(parts[0] || '0', 10) || 0,
      Number.parseInt(parts[1] || '0', 10) || 0,
      Number.parseInt(parts[2] || '0', 10) || 0,
    ];
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

export function normalizeMirrorPrefix(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return '';
  return trimmed;
}

export function applyMirrorUrl(targetUrl: string, mirrorPrefix: string): string {
  const norm = normalizeMirrorPrefix(mirrorPrefix);
  if (!norm) return targetUrl;
  return `${norm}/${targetUrl}`;
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseGitHubReleaseFallback(
  raw: Record<string, unknown>,
  repo = DEFAULT_GITHUB_REPO,
  defaultMinNativeVersion = '0.3.0',
): UpdateManifest | null {
  const tag = typeof raw.tag_name === 'string' ? raw.tag_name.trim() : '';
  if (!tag) return null;
  const version = stripLeadingV(tag);
  const assetsRaw = Array.isArray(raw.assets) ? raw.assets : [];
  const assets = assetsRaw
    .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
    .map((a) => ({
      name: typeof a.name === 'string' ? a.name : '',
      url: typeof a.browser_download_url === 'string' ? a.browser_download_url : '',
      size: typeof a.size === 'number' ? a.size : undefined,
    }))
    .filter((a) => a.name && a.url);

  const pick = (re: RegExp): UpdateAssetInfo | null => {
    const found = assets.find((a) => re.test(a.name));
    return found ? { fileName: found.name, url: found.url, size: found.size } : null;
  };

  return {
    schemaVersion: 1,
    version,
    tag,
    publishedAt:
      typeof raw.published_at === 'string' ? raw.published_at : new Date().toISOString(),
    minNativeVersion: defaultMinNativeVersion,
    notes: typeof raw.body === 'string' && raw.body.trim() ? raw.body.trim() : `版本 ${tag}`,
    releaseUrl:
      typeof raw.html_url === 'string'
        ? raw.html_url
        : `https://github.com/${repo}/releases/tag/${tag}`,
    webBundle: pick(/^jinshan-web-bundle-.*\.zip$/i),
    androidApk: pick(/\.apk$/i),
    windowsInstaller: pick(/\.exe$/i),
    windowsPortable: pick(/windows.*portable.*\.zip$/i),
  };
}

export function evaluateUpdatePlan(
  current: CurrentVersionInfo,
  manifest: UpdateManifest,
): UpdatePlan {
  if (compareSemver(manifest.version, current.effectiveVersion) <= 0) {
    return {
      kind: 'up-to-date',
      hasUpdate: false,
      reason: '当前已是最新版本',
      primaryAsset: null,
      secondaryAsset: null,
    };
  }

  const nativeCompatible =
    !manifest.minNativeVersion ||
    compareSemver(current.nativeVersion, manifest.minNativeVersion) >= 0;

  if (current.supportsOta && manifest.webBundle?.url && nativeCompatible) {
    return {
      kind: 'ota-hot-update',
      hasUpdate: true,
      reason: '支持免安装热更新，下载前端资源包后即可生效',
      primaryAsset: manifest.webBundle,
      secondaryAsset:
        current.platform === 'android'
          ? manifest.androidApk
          : manifest.windowsInstaller ?? manifest.windowsPortable,
    };
  }

  if (current.platform === 'android') {
    return {
      kind: 'native-install',
      hasUpdate: true,
      reason: nativeCompatible
        ? '该版本未提供热更新包，请下载新版 APK 覆盖安装'
        : `该版本包含原生能力升级（需客户端壳 ≥ v${manifest.minNativeVersion}），请下载新版 APK 安装`,
      primaryAsset: manifest.androidApk,
      secondaryAsset: null,
    };
  }

  if (current.platform === 'windows' || current.platform === 'desktop') {
    return {
      kind: 'native-install',
      hasUpdate: true,
      reason: nativeCompatible
        ? '该版本未提供热更新包，请下载新版 Windows 客户端'
        : `该版本包含桌面原生能力升级（需客户端壳 ≥ v${manifest.minNativeVersion}），请下载新版安装包`,
      primaryAsset: manifest.windowsInstaller ?? manifest.windowsPortable,
      secondaryAsset: manifest.windowsInstaller ? manifest.windowsPortable : null,
    };
  }

  return {
    kind: 'web-refresh',
    hasUpdate: true,
    reason: '发现新版本，刷新页面或前往发布页下载客户端',
    primaryAsset: manifest.androidApk ?? manifest.windowsInstaller,
    secondaryAsset: null,
  };
}

export function buildDownloadCandidates(
  asset: UpdateAssetInfo,
  opts: {
    mirrorUrl?: string;
    relayBaseUrl?: string | null;
    manifest?: UpdateManifest | null;
  } = {},
): string[] {
  const urls: string[] = [];
  const pushUnique = (u: string | null | undefined) => {
    if (u && !urls.includes(u)) urls.push(u);
  };

  const normMirror = normalizeMirrorPrefix(opts.mirrorUrl);
  if (normMirror) {
    pushUnique(applyMirrorUrl(asset.url, normMirror));
  }
  pushUnique(asset.url);

  const relayPath = opts.manifest?.relayAssets?.[asset.fileName];
  if (opts.relayBaseUrl && relayPath) {
    pushUnique(`${opts.relayBaseUrl.replace(/\/+$/, '')}${relayPath}`);
  } else if (opts.relayBaseUrl && asset.fileName) {
    pushUnique(
      `${opts.relayBaseUrl.replace(/\/+$/, '')}/api/update/asset?name=${encodeURIComponent(asset.fileName)}`,
    );
  }
  return urls;
}

export async function getCurrentVersionInfo(): Promise<CurrentVersionInfo> {
  const webVersion = BUNDLED_APP_VERSION;
  const android = getAndroidBridge();
  if (android?.getAppVersionInfoJson) {
    try {
      const parsed = JSON.parse(android.getAppVersionInfoJson()) as {
        nativeVersion?: string;
        otaVersion?: string | null;
        otaActive?: boolean;
        supportsOta?: boolean;
      };
      const nativeVersion = stripLeadingV(parsed.nativeVersion) || webVersion;
      const otaVersion = parsed.otaVersion ? stripLeadingV(parsed.otaVersion) : null;
      const otaActive = Boolean(parsed.otaActive && otaVersion);
      const effectiveVersion =
        otaActive && otaVersion
          ? compareSemver(otaVersion, webVersion) >= 0
            ? otaVersion
            : webVersion
          : compareSemver(webVersion, nativeVersion) >= 0
            ? webVersion
            : nativeVersion;
      return {
        platform: 'android',
        nativeVersion,
        webVersion,
        otaVersion,
        otaActive,
        supportsOta: parsed.supportsOta !== false,
        effectiveVersion,
      };
    } catch {
      // fallback below
    }
  }

  if (isTauriDesktopEnv()) {
    const invoke = getTauriInvoke();
    if (invoke) {
      try {
        const info = await invoke<{
          platform?: string;
          nativeVersion?: string;
          otaVersion?: string | null;
          otaActive?: boolean;
          supportsOta?: boolean;
        }>('ota_get_version_info');
        const nativeVersion = stripLeadingV(info.nativeVersion) || webVersion;
        const otaVersion = info.otaVersion ? stripLeadingV(info.otaVersion) : null;
        const otaActive = Boolean(info.otaActive && otaVersion);
        const effectiveVersion =
          otaActive && otaVersion
            ? compareSemver(otaVersion, webVersion) >= 0
              ? otaVersion
              : webVersion
            : compareSemver(webVersion, nativeVersion) >= 0
              ? webVersion
              : nativeVersion;
        const plat: ClientPlatform =
          info.platform === 'windows' ? 'windows' : 'desktop';
        return {
          platform: plat,
          nativeVersion,
          webVersion,
          otaVersion,
          otaActive,
          supportsOta: info.supportsOta !== false,
          effectiveVersion,
        };
      } catch {
        // Older Windows shell without OTA commands -> still report windows, supportsOta: false
        return {
          platform: 'windows',
          nativeVersion: webVersion,
          webVersion,
          otaVersion: null,
          otaActive: false,
          supportsOta: false,
          effectiveVersion: webVersion,
        };
      }
    }
  }

  return {
    platform: 'web',
    nativeVersion: webVersion,
    webVersion,
    otaVersion: null,
    otaActive: false,
    supportsOta: false,
    effectiveVersion: webVersion,
  };
}

export async function confirmOtaBootReady(): Promise<void> {
  const android = getAndroidBridge();
  if (android?.confirmOtaBootReady) {
    try {
      android.confirmOtaBootReady();
    } catch {
      // ignore
    }
    return;
  }
  if (isTauriDesktopEnv()) {
    const invoke = getTauriInvoke();
    if (invoke) {
      try {
        await invoke<void>('ota_confirm_boot_ready');
      } catch {
        // ignore
      }
    }
  }
}

async function fetchText(
  url: string,
  opts: { preferNative: boolean; fetchFn?: typeof fetch },
): Promise<NativeTextFetchResponse> {
  if (opts.preferNative) {
    const android = getAndroidBridge();
    if (android?.fetchTextUrl) {
      try {
        const parsed = JSON.parse(android.fetchTextUrl(url)) as NativeTextFetchResponse;
        return parsed;
      } catch (err) {
        return {
          ok: false,
          status: 0,
          body: '',
          error: err instanceof Error ? err.message : '原生网络请求失败',
        };
      }
    }
    if (isTauriDesktopEnv()) {
      const invoke = getTauriInvoke();
      if (invoke) {
        try {
          return await invoke<NativeTextFetchResponse>('ota_fetch_text_url', { url });
        } catch (err) {
          return {
            ok: false,
            status: 0,
            body: '',
            error: err instanceof Error ? err.message : '桌面网络请求失败',
          };
        }
      }
    }
  }

  const doFetch = opts.fetchFn ?? globalThis.fetch;
  try {
    const res = await doFetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: '',
      error: err instanceof Error ? err.message : '网络请求失败',
    };
  }
}

function resolveRelayBase(serverUrl?: string): string | null {
  const raw = (serverUrl ?? '').trim();
  if (raw) {
    const base = normalizeServerHttpBase(raw);
    return base || null;
  }
  // Plain web client served by game server can query relative /api/update/manifest
  if (typeof window !== 'undefined' && !getAndroidBridge() && !isTauriDesktopEnv()) {
    const origin = window.location?.origin;
    if (origin && /^https?:\/\//i.test(origin)) {
      return origin;
    }
  }
  return null;
}

export async function checkForUpdates(
  opts: {
    mirrorUrl?: string;
    serverUrl?: string;
    repo?: string;
    forceRefresh?: boolean;
    currentOverride?: CurrentVersionInfo;
    fetchFn?: typeof fetch;
  } = {},
): Promise<UpdateCheckResult> {
  const current = opts.currentOverride ?? (await getCurrentVersionInfo());
  const repo = opts.repo ?? DEFAULT_GITHUB_REPO;
  const normMirror = normalizeMirrorPrefix(opts.mirrorUrl);
  const relayBase = resolveRelayBase(opts.serverUrl);
  const hasNativeHttp = Boolean(getAndroidBridge()?.fetchTextUrl || isTauriDesktopEnv());

  const manifestDirectUrl = `https://github.com/${repo}/releases/latest/download/update-manifest.json`;
  const githubApiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

  type SourceSpec = {
    source: 'mirror' | 'github-direct' | 'github-api' | 'server-relay';
    kind: 'manifest' | 'api' | 'relay';
    url: string;
    preferNative: boolean;
  };

  const candidates: SourceSpec[] = [];
  if (normMirror) {
    candidates.push({
      source: 'mirror',
      kind: 'manifest',
      url: applyMirrorUrl(manifestDirectUrl, normMirror),
      preferNative: hasNativeHttp,
    });
  }
  if (hasNativeHttp) {
    candidates.push({
      source: 'github-direct',
      kind: 'manifest',
      url: manifestDirectUrl,
      preferNative: true,
    });
  }
  candidates.push({
    source: 'github-api',
    kind: 'api',
    url: githubApiUrl,
    preferNative: hasNativeHttp,
  });
  if (relayBase) {
    const qs = opts.forceRefresh ? '?refresh=1' : '';
    candidates.push({
      source: 'server-relay',
      kind: 'relay',
      url: `${relayBase.replace(/\/+$/, '')}/api/update/manifest${qs}`,
      preferNative: false,
    });
  }

  let lastError = '无法连接更新服务，请稍后重试或配置加速镜像';

  for (const cand of candidates) {
    const res = await fetchText(cand.url, {
      preferNative: cand.preferNative,
      fetchFn: opts.fetchFn,
    });
    if (!res.ok || !res.body) {
      if (res.error) lastError = res.error;
      continue;
    }
    try {
      const json = JSON.parse(res.body) as Record<string, unknown>;
      let manifest: UpdateManifest | null = null;
      if (cand.kind === 'manifest') {
        if (typeof json.version === 'string' && json.version.trim()) {
          manifest = json as unknown as UpdateManifest;
        }
      } else if (cand.kind === 'relay') {
        const inner = json.manifest as Record<string, unknown> | undefined;
        if (inner && typeof inner.version === 'string') {
          manifest = inner as unknown as UpdateManifest;
        }
      } else {
        manifest = parseGitHubReleaseFallback(json, repo);
      }

      if (manifest && manifest.version) {
        manifest.version = stripLeadingV(manifest.version);
        const plan = evaluateUpdatePlan(current, manifest);
        return {
          ok: true,
          current,
          manifest,
          plan,
          source: cand.source,
          relayBaseUrl: relayBase,
        };
      }
    } catch {
      lastError = '更新清单解析失败';
    }
  }

  return {
    ok: false,
    current,
    manifest: null,
    plan: null,
    source: null,
    relayBaseUrl: relayBase,
    error: lastError,
  };
}

export async function startOtaInstall(
  version: string,
  downloadUrl: string,
  expectedSha256 = '',
): Promise<{ ok: boolean; error?: string }> {
  const android = getAndroidBridge();
  if (android?.startOtaInstall) {
    try {
      return JSON.parse(
        android.startOtaInstall(version, downloadUrl, expectedSha256),
      ) as { ok: boolean; error?: string };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '启动安卓热更新失败' };
    }
  }

  if (isTauriDesktopEnv()) {
    const invoke = getTauriInvoke();
    if (invoke) {
      try {
        return await invoke<{ ok: boolean; error?: string }>('ota_start_install', {
          version,
          downloadUrl,
          expectedSha256,
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '启动桌面热更新失败' };
      }
    }
  }

  return { ok: false, error: '当前运行环境不支持应用内热更新' };
}

export async function getOtaTaskStatus(): Promise<OtaTaskStatus> {
  const idle: OtaTaskStatus = {
    state: 'idle',
    version: '',
    downloadedBytes: 0,
    totalBytes: 0,
    progress: 0,
    error: '',
  };
  const android = getAndroidBridge();
  if (android?.getOtaTaskStatusJson) {
    try {
      return JSON.parse(android.getOtaTaskStatusJson()) as OtaTaskStatus;
    } catch {
      return idle;
    }
  }
  if (isTauriDesktopEnv()) {
    const invoke = getTauriInvoke();
    if (invoke) {
      try {
        return await invoke<OtaTaskStatus>('ota_get_task_status');
      } catch {
        return idle;
      }
    }
  }
  return idle;
}

export function reloadUpdatedApp(): void {
  const android = getAndroidBridge();
  if (android?.reloadApp) {
    android.reloadApp();
    return;
  }
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

export async function clearOtaUpdate(): Promise<boolean> {
  const android = getAndroidBridge();
  if (android?.clearOtaBundle) {
    try {
      return Boolean(android.clearOtaBundle());
    } catch {
      return false;
    }
  }
  if (isTauriDesktopEnv()) {
    const invoke = getTauriInvoke();
    if (invoke) {
      try {
        return Boolean(await invoke<boolean>('ota_clear_bundle'));
      } catch {
        return false;
      }
    }
  }
  return false;
}

export async function openExternalDownloadUrl(url: string): Promise<boolean> {
  const android = getAndroidBridge();
  if (android?.openExternalUrl) {
    try {
      return Boolean(android.openExternalUrl(url));
    } catch {
      return false;
    }
  }
  if (isTauriDesktopEnv()) {
    const invoke = getTauriInvoke();
    if (invoke) {
      try {
        return Boolean(await invoke<boolean>('ota_open_external_url', { url }));
      } catch {
        return false;
      }
    }
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }
  return false;
}

export function getIgnoredUpdateVersion(): string | null {
  try {
    return window.localStorage.getItem(IGNORED_VERSION_KEY);
  } catch {
    return null;
  }
}

export function setIgnoredUpdateVersion(version: string | null): void {
  try {
    if (!version) {
      window.localStorage.removeItem(IGNORED_VERSION_KEY);
    } else {
      window.localStorage.setItem(IGNORED_VERSION_KEY, stripLeadingV(version));
    }
  } catch {
    // ignore
  }
}
