import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// The Vite source uses .js paths for TS modules; this test runs it on Node 24.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === './cardAudio.js' && context.parentURL?.endsWith('/utils/sound.ts')
      ? './cardAudio.ts' : specifier, context);
  },
});
const { soundFX } = await import('../src/utils/sound.ts');
hooks.deregister();

function node(extra) {
  return { connect: (other) => other, disconnect() {}, ...extra };
}

test('card playback waits for a user unlock, pans by seat, and mute stops every scheduled hit', async () => {
  let created = 0;
  let resumeCalls = 0;
  const voices = [];
  const pans = [];
  const gains = [];
  globalThis.window = { AudioContext: class {
    state = 'suspended';
    currentTime = 10;
    sampleRate = 22050;
    destination = {};
    constructor() { created++; }
    async resume() { resumeCalls++; this.state = 'running'; }
    createDynamicsCompressor() { return node({ threshold: {}, ratio: {}, attack: {}, release: {} }); }
    createGain() { const result = node({ gain: { value: 1 } }); gains.push(result); return result; }
    createBuffer(_channels, length) { const pcm = new Float32Array(length); return { getChannelData: () => pcm }; }
    createBufferSource() {
      const voice = node({ playbackRate: {}, start(time) { this.time = time; }, stop() { this.stopped = true; } });
      voices.push(voice);
      return voice;
    }
    createStereoPanner() { const panner = node({ pan: {} }); pans.push(panner); return panner; }
  } };
  try {
    const cards = Array.from({ length: 8 }, (_, id) => ({ id }));
    const play = { seat: 1, cards, parsed: { patternType: 'TRACTOR', cards, components: [] } };
    soundFX.playCards(play, 0);
    assert.equal(created, 0);
    soundFX.unlock();
    assert.equal(created, 1);
    assert.equal(resumeCalls, 1);
    soundFX.playCards(play, 0);
    assert.equal(voices.length, 8);
    assert.ok(voices.every((voice) => voice.buffer && voice.time >= 10));
    assert.ok(voices.at(-1).time > voices[0].time + 0.18);
    assert.ok(pans.every((panner) => panner.pan.value === 0.32));
    soundFX.setMuted(true);
    assert.ok(voices.every((voice) => voice.stopped));
    assert.equal(gains[0].gain.value, 0);
    soundFX.playCards(play, 0);
    assert.equal(voices.length, 8);
  } finally {
    delete globalThis.window;
  }
});
