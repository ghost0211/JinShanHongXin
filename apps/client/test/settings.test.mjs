import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from '../src/utils/settings.ts';

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

test('settings load defaults, migrate legacy skin/mute keys, and clamp volume cleanly', () => {
  const storage = makeStorage({
    'jinshan.tableSkin': 'cinnabar',
    jinshan_sound_muted: '1',
  });
  globalThis.window = { localStorage: storage };
  try {
    const migrated = loadAppSettings();
    assert.equal(migrated.tableSkin, 'cinnabar');
    assert.equal(migrated.soundEnabled, false);
    assert.equal(migrated.splashEnabled, DEFAULT_APP_SETTINGS.splashEnabled);
    assert.equal(migrated.allyBotDifficulty, 'high');
    assert.equal(migrated.opponentBotDifficulty, 'high');

    saveAppSettings({
      ...migrated,
      tableSkin: 'night-blue',
      soundEnabled: true,
      soundVolume: 64,
      handLayout: 'single',
      autoSelectMandatory: false,
      allyBotDifficulty: 'low',
      opponentBotDifficulty: 'medium',
    });
    const dumped = storage.dump();
    assert.equal(dumped['jinshan.tableSkin'], 'night-blue');
    assert.equal(dumped['jinshan_sound_muted'], '0');

    const reloaded = loadAppSettings();
    assert.equal(reloaded.tableSkin, 'night-blue');
    assert.equal(reloaded.soundEnabled, true);
    assert.equal(reloaded.soundVolume, 64);
    assert.equal(reloaded.handLayout, 'single');
    assert.equal(reloaded.autoSelectMandatory, false);
    assert.equal(reloaded.allyBotDifficulty, 'low');
    assert.equal(reloaded.opponentBotDifficulty, 'medium');

    // Corrupt / out-of-range values fall back safely
    storage.setItem(
      'jinshan.settings.v1',
      JSON.stringify({
        tableSkin: 'unknown',
        soundVolume: 999,
        handLayout: 'weird',
        allyBotDifficulty: 'godmode',
        opponentBotDifficulty: 42,
      }),
    );
    const clamped = loadAppSettings();
    assert.equal(clamped.tableSkin, 'night-blue'); // falls back to valid legacy key
    assert.equal(clamped.soundVolume, 100);
    assert.equal(clamped.handLayout, 'double');
    assert.equal(clamped.allyBotDifficulty, 'high');
    assert.equal(clamped.opponentBotDifficulty, 'high');
    // Legacy 'classic' skin falls back cleanly to new default 'ink'
    storage.removeItem('jinshan.settings.v1');
    storage.setItem('jinshan.tableSkin', 'classic');
    assert.equal(loadAppSettings().tableSkin, 'ink');
  } finally {
    delete globalThis.window;
  }
});
