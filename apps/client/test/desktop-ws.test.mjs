import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isRunningInNativeShell,
  isRunningInTauriDesktop,
  resolveHttpBase,
  resolveWsUrl,
} from '../src/net/wsClient.ts';

test('resolves server URLs cleanly for Web, Android APK, and Tauri 2 Windows/Desktop shells', () => {
  const prevWindow = globalThis.window;
  try {
    // 1. Regular Web browser served by game server
    globalThis.window = {
      location: {
        protocol: 'http:',
        hostname: '192.168.1.50',
        host: '192.168.1.50:3001',
        search: '',
      },
    };
    assert.equal(isRunningInTauriDesktop(), false);
    assert.equal(isRunningInNativeShell(), false);
    assert.equal(resolveHttpBase(''), '');
    assert.equal(resolveWsUrl(''), 'ws://192.168.1.50:3001/ws');

    // 2. Windows Tauri 2 production WebView2 (http://tauri.localhost)
    globalThis.window = {
      __TAURI_INTERNALS__: {},
      location: {
        protocol: 'http:',
        hostname: 'tauri.localhost',
        host: 'tauri.localhost',
        search: '',
      },
    };
    assert.equal(isRunningInTauriDesktop(), true);
    assert.equal(isRunningInNativeShell(), true);
    assert.equal(resolveHttpBase(''), 'http://127.0.0.1:3001');
    assert.equal(resolveWsUrl(''), 'ws://127.0.0.1:3001/ws');
    assert.equal(resolveHttpBase('192.168.2.192:3001'), 'http://192.168.2.192:3001');
    assert.equal(resolveWsUrl('https://hongxin.example.com'), 'wss://hongxin.example.com/ws');

    // 3. Tauri 2 tauri:// scheme (Linux/macOS desktop)
    globalThis.window = {
      location: {
        protocol: 'tauri:',
        hostname: 'localhost',
        host: 'localhost',
        search: '',
      },
    };
    assert.equal(isRunningInTauriDesktop(), true);
    assert.equal(isRunningInNativeShell(), true);
    assert.equal(resolveHttpBase(''), 'http://127.0.0.1:3001');
    assert.equal(resolveWsUrl(''), 'ws://127.0.0.1:3001/ws');

    // 4. Android APK virtual host
    globalThis.window = {
      JinshanAndroid: {},
      location: {
        protocol: 'http:',
        hostname: 'appassets.jinshan.local',
        host: 'appassets.jinshan.local',
        search: '',
      },
    };
    assert.equal(isRunningInTauriDesktop(), false);
    assert.equal(isRunningInNativeShell(), true);
    assert.equal(resolveHttpBase(''), 'http://127.0.0.1:3001');
    assert.equal(resolveWsUrl(''), 'ws://127.0.0.1:3001/ws');
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});
