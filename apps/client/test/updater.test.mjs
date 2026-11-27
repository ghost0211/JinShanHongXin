import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  applyMirrorUrl,
  buildDownloadCandidates,
  checkForUpdates,
  compareSemver,
  evaluateUpdatePlan,
  normalizeMirrorPrefix,
  parseGitHubReleaseFallback,
} from '../src/utils/updater.ts';
import { createZipBuffer } from '../../../scripts/build-web-bundle.mjs';

const sampleManifest = {
  schemaVersion: 1,
  version: '0.3.2',
  tag: 'v0.3.2',
  publishedAt: '2026-11-27T12:00:00.000Z',
  minNativeVersion: '0.3.0',
  notes: '- 修复了出牌提示\n- 优化了机器人保底',
  releaseUrl: 'https://github.com/ghost0211/JinShanHongXin/releases/tag/v0.3.2',
  webBundle: {
    fileName: 'jinshan-web-bundle-v0.3.2.zip',
    url: 'https://github.com/ghost0211/JinShanHongXin/releases/download/v0.3.2/jinshan-web-bundle-v0.3.2.zip',
    sha256: 'abc123',
    size: 245000,
  },
  androidApk: {
    fileName: 'jinshan-hongxin-v0.3.2.apk',
    url: 'https://github.com/ghost0211/JinShanHongXin/releases/download/v0.3.2/jinshan-hongxin-v0.3.2.apk',
    sha256: 'def456',
    size: 440000,
  },
  windowsInstaller: {
    fileName: 'jinshan-hongxin-windows-v0.3.2-setup.exe',
    url: 'https://github.com/ghost0211/JinShanHongXin/releases/download/v0.3.2/jinshan-hongxin-windows-v0.3.2-setup.exe',
    size: 3800000,
  },
  windowsPortable: {
    fileName: 'jinshan-hongxin-windows-v0.3.2-portable.zip',
    url: 'https://github.com/ghost0211/JinShanHongXin/releases/download/v0.3.2/jinshan-hongxin-windows-v0.3.2-portable.zip',
    size: 3200000,
  },
  relayAssets: {
    'jinshan-web-bundle-v0.3.2.zip': '/api/update/asset?name=jinshan-web-bundle-v0.3.2.zip',
  },
};

test('semver comparison, mirror URL normalization, and hybrid OTA vs native plan evaluation', () => {
  assert.equal(compareSemver('v0.3.2', '0.3.0'), 1);
  assert.equal(compareSemver('0.3.0', 'v0.3.0'), 0);
  assert.equal(compareSemver('0.2.9', '0.3.0'), -1);

  assert.equal(normalizeMirrorPrefix(' https://ghfast.top/// '), 'https://ghfast.top');
  assert.equal(normalizeMirrorPrefix('ftp://invalid'), '');
  assert.equal(
    applyMirrorUrl('https://github.com/a/b', 'https://ghfast.top/'),
    'https://ghfast.top/https://github.com/a/b',
  );

  // 1. Android shell 0.3.0 with compatible minNativeVersion 0.3.0 -> OTA hot-update
  const otaPlan = evaluateUpdatePlan(
    {
      platform: 'android',
      nativeVersion: '0.3.0',
      webVersion: '0.3.0',
      otaVersion: null,
      otaActive: false,
      supportsOta: true,
      effectiveVersion: '0.3.0',
    },
    sampleManifest,
  );
  assert.equal(otaPlan.kind, 'ota-hot-update');
  assert.equal(otaPlan.hasUpdate, true);
  assert.equal(otaPlan.primaryAsset?.fileName, 'jinshan-web-bundle-v0.3.2.zip');

  // 2. Older native shell 0.2.0 (< minNativeVersion 0.3.0) -> native APK install
  const nativeAndroidPlan = evaluateUpdatePlan(
    {
      platform: 'android',
      nativeVersion: '0.2.0',
      webVersion: '0.2.0',
      otaVersion: null,
      otaActive: false,
      supportsOta: true,
      effectiveVersion: '0.2.0',
    },
    sampleManifest,
  );
  assert.equal(nativeAndroidPlan.kind, 'native-install');
  assert.equal(nativeAndroidPlan.primaryAsset?.fileName, 'jinshan-hongxin-v0.3.2.apk');

  // 3. Windows shell with older native version -> Windows installer + portable secondary
  const nativeWinPlan = evaluateUpdatePlan(
    {
      platform: 'windows',
      nativeVersion: '0.2.0',
      webVersion: '0.2.0',
      otaVersion: null,
      otaActive: false,
      supportsOta: true,
      effectiveVersion: '0.2.0',
    },
    sampleManifest,
  );
  assert.equal(nativeWinPlan.kind, 'native-install');
  assert.equal(nativeWinPlan.primaryAsset?.fileName, 'jinshan-hongxin-windows-v0.3.2-setup.exe');
  assert.equal(nativeWinPlan.secondaryAsset?.fileName, 'jinshan-hongxin-windows-v0.3.2-portable.zip');

  // 4. Already up to date (running OTA 0.3.2)
  const upToDate = evaluateUpdatePlan(
    {
      platform: 'windows',
      nativeVersion: '0.3.0',
      webVersion: '0.3.2',
      otaVersion: '0.3.2',
      otaActive: true,
      supportsOta: true,
      effectiveVersion: '0.3.2',
    },
    sampleManifest,
  );
  assert.equal(upToDate.kind, 'up-to-date');
  assert.equal(upToDate.hasUpdate, false);

  // 5. Download candidate ordering: mirror -> direct -> server relay
  const urls = buildDownloadCandidates(sampleManifest.webBundle, {
    mirrorUrl: 'https://ghfast.top/',
    relayBaseUrl: 'http://192.168.2.10:3001/',
    manifest: sampleManifest,
  });
  assert.deepEqual(urls, [
    'https://ghfast.top/https://github.com/ghost0211/JinShanHongXin/releases/download/v0.3.2/jinshan-web-bundle-v0.3.2.zip',
    'https://github.com/ghost0211/JinShanHongXin/releases/download/v0.3.2/jinshan-web-bundle-v0.3.2.zip',
    'http://192.168.2.10:3001/api/update/asset?name=jinshan-web-bundle-v0.3.2.zip',
  ]);
});

test('checkForUpdates falls back from direct GitHub to server relay and parses GitHub release API', async () => {
  const fallbackManifest = parseGitHubReleaseFallback({
    tag_name: 'v0.4.0',
    body: '新版说明',
    html_url: 'https://github.com/ghost0211/JinShanHongXin/releases/tag/v0.4.0',
    published_at: '2026-11-27T12:00:00Z',
    assets: [
      {
        name: 'jinshan-hongxin-v0.4.0.apk',
        browser_download_url: 'https://example.com/app.apk',
        size: 500000,
      },
    ],
  });
  assert.equal(fallbackManifest?.version, '0.4.0');
  assert.equal(fallbackManifest?.androidApk?.fileName, 'jinshan-hongxin-v0.4.0.apk');

  const seenUrls = [];
  const fakeFetch = async (url) => {
    seenUrls.push(String(url));
    if (String(url).includes('/api/update/manifest')) {
      return new Response(JSON.stringify({ ok: true, manifest: sampleManifest }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error('ECONNREFUSED');
  };

  const res = await checkForUpdates({
    mirrorUrl: 'https://ghfast.top',
    serverUrl: 'http://192.168.2.10:3001',
    currentOverride: {
      platform: 'android',
      nativeVersion: '0.3.0',
      webVersion: '0.3.0',
      otaVersion: null,
      otaActive: false,
      supportsOta: true,
      effectiveVersion: '0.3.0',
    },
    fetchFn: fakeFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(res.source, 'server-relay');
  assert.equal(res.plan?.kind, 'ota-hot-update');
  assert.equal(res.manifest?.version, '0.3.2');
  assert.ok(seenUrls[0].startsWith('https://ghfast.top/https://github.com/'));
  assert.ok(seenUrls.some((u) => u.includes('/api/update/manifest')));
});

test('pure-Node PKZIP creator produces valid standard ZIP archive readable by unzip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jinshan-zip-test-'));
  try {
    const zipBuf = createZipBuffer([
      { name: 'index.html', data: Buffer.from('<!doctype html><h1>金山打红心</h1>', 'utf8') },
      { name: 'assets/app.js', data: Buffer.from('console.log("ok");'.repeat(200), 'utf8') },
    ]);
    const zipPath = join(dir, 'bundle.zip');
    writeFileSync(zipPath, zipBuf);
    const extracted = execFileSync('unzip', ['-p', zipPath, 'index.html'], { encoding: 'utf8' });
    assert.equal(extracted, '<!doctype html><h1>金山打红心</h1>');
    execFileSync('unzip', ['-t', zipPath], { stdio: 'ignore' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
