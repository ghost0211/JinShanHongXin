import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RelayAssetEntry {
  fileName: string;
  url: string;
  sha256?: string;
  size?: number;
}

export interface RelayUpdateManifest {
  schemaVersion: number;
  version: string;
  tag: string;
  publishedAt: string;
  minNativeVersion: string;
  notes: string;
  releaseUrl: string;
  webBundle: RelayAssetEntry | null;
  androidApk: RelayAssetEntry | null;
  windowsInstaller: RelayAssetEntry | null;
  windowsPortable: RelayAssetEntry | null;
  relayAssets?: Record<string, string>;
}

export interface UpdateRelayOptions {
  repo?: string;
  mirrorUrl?: string;
  cacheTtlMs?: number;
  fetchFn?: typeof fetch;
}

interface CacheEntry {
  manifest: RelayUpdateManifest;
  fetchedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_REFRESH_COOLDOWN_MS = 15 * 1000;
const MAX_RELAY_ASSET_BYTES = 100 * 1024 * 1024;

function loadDefaultReleaseConfig(): { repo: string; minNativeVersion: string } {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(dir, '../../../release-config.json'),
      resolve(process.cwd(), 'release-config.json'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const parsed = JSON.parse(readFileSync(p, 'utf8')) as {
          repo?: string;
          minNativeVersion?: string;
        };
        return {
          repo: parsed.repo || 'ghost0211/JinShanHongXin',
          minNativeVersion: parsed.minNativeVersion || '0.3.0',
        };
      }
    }
  } catch {
    // ignore
  }
  return { repo: 'ghost0211/JinShanHongXin', minNativeVersion: '0.3.0' };
}

function normalizeMirror(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
}

function withMirror(url: string, mirror: string): string {
  if (!mirror) return url;
  return `${mirror}/${url}`;
}

function parseAssetList(assets: unknown): Array<{
  name: string;
  browser_download_url: string;
  size?: number;
}> {
  if (!Array.isArray(assets)) return [];
  const out: Array<{ name: string; browser_download_url: string; size?: number }> = [];
  for (const item of assets) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.name === 'string' && typeof obj.browser_download_url === 'string') {
      out.push({
        name: obj.name,
        browser_download_url: obj.browser_download_url,
        size: typeof obj.size === 'number' ? obj.size : undefined,
      });
    }
  }
  return out;
}

function convertGitHubReleaseToManifest(
  raw: Record<string, unknown>,
  repo: string,
  defaultMinNative: string,
): RelayUpdateManifest | null {
  const tag = typeof raw.tag_name === 'string' ? raw.tag_name.trim() : '';
  if (!tag) return null;
  const version = tag.replace(/^v/i, '');
  const assets = parseAssetList(raw.assets);

  const pick = (re: RegExp): RelayAssetEntry | null => {
    const found = assets.find((a) => re.test(a.name));
    if (!found) return null;
    return {
      fileName: found.name,
      url: found.browser_download_url,
      size: found.size,
    };
  };

  return {
    schemaVersion: 1,
    version,
    tag,
    publishedAt:
      typeof raw.published_at === 'string' ? raw.published_at : new Date().toISOString(),
    minNativeVersion: defaultMinNative,
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

function attachRelayPaths(manifest: RelayUpdateManifest): RelayUpdateManifest {
  const relayAssets: Record<string, string> = {};
  const entries = [
    manifest.webBundle,
    manifest.androidApk,
    manifest.windowsInstaller,
    manifest.windowsPortable,
  ];
  for (const entry of entries) {
    if (entry?.fileName) {
      relayAssets[entry.fileName] = `/api/update/asset?name=${encodeURIComponent(entry.fileName)}`;
    }
  }
  return { ...manifest, relayAssets };
}

export class UpdateRelay {
  private readonly repo: string;
  private readonly defaultMinNative: string;
  private readonly mirrorUrl: string;
  private readonly cacheTtlMs: number;
  private readonly fetchFn: typeof fetch;
  private cache: CacheEntry | null = null;

  constructor(options: UpdateRelayOptions = {}) {
    const defaults = loadDefaultReleaseConfig();
    this.repo = (options.repo ?? process.env.UPDATE_GITHUB_REPO ?? defaults.repo).trim();
    this.defaultMinNative = defaults.minNativeVersion;
    this.mirrorUrl = normalizeMirror(options.mirrorUrl ?? process.env.UPDATE_MIRROR_URL);
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async getLatestManifest(forceRefresh = false): Promise<RelayUpdateManifest> {
    const now = Date.now();
    if (this.cache) {
      const age = now - this.cache.fetchedAt;
      if (!forceRefresh && age < this.cacheTtlMs) {
        return this.cache.manifest;
      }
      if (forceRefresh && age < MIN_REFRESH_COOLDOWN_MS) {
        return this.cache.manifest;
      }
    }

    const directManifestUrl = `https://github.com/${this.repo}/releases/latest/download/update-manifest.json`;
    const apiReleaseUrl = `https://api.github.com/repos/${this.repo}/releases/latest`;
    const candidates: Array<{ kind: 'manifest' | 'api'; url: string }> = [];
    if (this.mirrorUrl) {
      candidates.push({ kind: 'manifest', url: withMirror(directManifestUrl, this.mirrorUrl) });
    }
    candidates.push({ kind: 'manifest', url: directManifestUrl });
    candidates.push({ kind: 'api', url: apiReleaseUrl });

    let lastErr = '无法获取最新版本信息';
    for (const candidate of candidates) {
      try {
        const res = await this.fetchFn(candidate.url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'JinShanHongXin-Server/0.3.0',
          },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          continue;
        }
        const json = (await res.json()) as Record<string, unknown>;
        const manifest =
          candidate.kind === 'manifest'
            ? typeof json.version === 'string'
              ? (json as unknown as RelayUpdateManifest)
              : null
            : convertGitHubReleaseToManifest(json, this.repo, this.defaultMinNative);
        if (manifest && manifest.version) {
          const enriched = attachRelayPaths(manifest);
          this.cache = { manifest: enriched, fetchedAt: now };
          return enriched;
        }
      } catch (err) {
        lastErr = err instanceof Error ? err.message : '网络超时';
      }
    }

    if (this.cache) {
      return this.cache.manifest;
    }
    throw new Error(lastErr);
  }

  async resolveWhitelistedAsset(fileName: string): Promise<{
    fileName: string;
    upstreamUrls: string[];
  } | null> {
    const manifest = await this.getLatestManifest(false);
    const entries = [
      manifest.webBundle,
      manifest.androidApk,
      manifest.windowsInstaller,
      manifest.windowsPortable,
    ];
    const match = entries.find((e) => e && e.fileName === fileName && e.url);
    if (!match) return null;

    const urls: string[] = [];
    if (this.mirrorUrl) {
      urls.push(withMirror(match.url, this.mirrorUrl));
    }
    urls.push(match.url);
    return { fileName: match.fileName, upstreamUrls: urls };
  }

  async fetchAssetBuffer(fileName: string): Promise<{
    fileName: string;
    contentType: string;
    data: Buffer;
  } | null> {
    const target = await this.resolveWhitelistedAsset(fileName);
    if (!target) return null;

    let lastErr = '下载更新资源失败';
    for (const url of target.upstreamUrls) {
      try {
        const res = await this.fetchFn(url, {
          headers: { 'User-Agent': 'JinShanHongXin-Server/0.3.0' },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          continue;
        }
        const lenHeader = Number(res.headers.get('content-length') || 0);
        if (lenHeader > MAX_RELAY_ASSET_BYTES) {
          throw new Error('更新文件体积超过安全上限');
        }
        const arr = await res.arrayBuffer();
        if (arr.byteLength > MAX_RELAY_ASSET_BYTES) {
          throw new Error('更新文件体积超过安全上限');
        }
        const contentType = target.fileName.endsWith('.apk')
          ? 'application/vnd.android.package-archive'
          : target.fileName.endsWith('.zip')
            ? 'application/zip'
            : 'application/octet-stream';
        return {
          fileName: target.fileName,
          contentType,
          data: Buffer.from(arr),
        };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : '下载超时';
      }
    }
    throw new Error(lastErr);
  }
}

export function getJoinPathSafe(root: string, file: string): string {
  return join(root, file);
}
