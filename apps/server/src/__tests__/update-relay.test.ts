import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGameServer } from '../server.js';

test('server update relay serves cached manifest and strictly whitelisted release assets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jinshan-relay-test-'));
  const manifestPayload = {
    schemaVersion: 1,
    version: '0.3.5',
    tag: 'v0.3.5',
    publishedAt: '2026-11-27T12:00:00.000Z',
    minNativeVersion: '0.3.0',
    notes: '服务端中转热更新测试',
    releaseUrl: 'https://github.com/ghost0211/JinShanHongXin/releases/tag/v0.3.5',
    webBundle: {
      fileName: 'jinshan-web-bundle-v0.3.5.zip',
      url: 'https://github.com/ghost0211/JinShanHongXin/releases/download/v0.3.5/jinshan-web-bundle-v0.3.5.zip',
      sha256: 'deadbeef',
      size: 11,
    },
    androidApk: null,
    windowsInstaller: null,
    windowsPortable: null,
  };

  let manifestFetches = 0;
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/update-manifest.json')) {
      manifestFetches++;
      return new Response(JSON.stringify(manifestPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/jinshan-web-bundle-v0.3.5.zip')) {
      return new Response(Buffer.from('PK-FAKE-ZIP'), {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      });
    }
    return new Response('Not Found', { status: 404 });
  };

  const server = createGameServer({
    port: 0,
    host: '127.0.0.1',
    dbPath: join(dir, 'test.sqlite'),
    updateRelay: {
      fetchFn: mockFetch,
      cacheTtlMs: 60_000,
    },
  });

  try {
    const { port } = await server.start();
    const base = `http://127.0.0.1:${port}`;

    // 1. Fetch manifest twice -> second call hits in-memory cache
    const res1 = await fetch(`${base}/api/update/manifest`);
    assert.equal(res1.status, 200);
    const body1 = (await res1.json()) as {
      ok: boolean;
      manifest: { version: string; relayAssets?: Record<string, string> };
    };
    assert.equal(body1.ok, true);
    assert.equal(body1.manifest.version, '0.3.5');
    assert.equal(
      body1.manifest.relayAssets?.['jinshan-web-bundle-v0.3.5.zip'],
      '/api/update/asset?name=jinshan-web-bundle-v0.3.5.zip',
    );

    const res2 = await fetch(`${base}/api/update/manifest`);
    assert.equal(res2.status, 200);
    assert.equal(manifestFetches, 1);

    // 2. Download whitelisted asset succeeds
    const assetRes = await fetch(
      `${base}/api/update/asset?name=jinshan-web-bundle-v0.3.5.zip`,
    );
    assert.equal(assetRes.status, 200);
    assert.equal(await assetRes.text(), 'PK-FAKE-ZIP');

    // 3. Non-whitelisted or path traversal filenames are rejected
    const badRes1 = await fetch(`${base}/api/update/asset?name=../secret.txt`);
    assert.equal(badRes1.status, 400);

    const badRes2 = await fetch(`${base}/api/update/asset?name=evil.exe`);
    assert.equal(badRes2.status, 404);
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
