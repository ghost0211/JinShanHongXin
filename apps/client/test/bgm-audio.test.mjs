import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import {
  BGM_TRACK_OPTIONS,
  getBgmTrackPlan,
  isBgmTrackId,
  makeReverbImpulse,
  synthesizeBgmNote,
} from '../src/utils/bgmAudio.ts';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/utils/bgm.ts')) {
      if (specifier === './bgmAudio.js') return nextResolve('./bgmAudio.ts', context);
      if (specifier === './sound.js') return nextResolve('./sound.ts', context);
    }
    if (context.parentURL?.endsWith('/utils/sound.ts') && specifier === './cardAudio.js') {
      return nextResolve('./cardAudio.ts', context);
    }
    return nextResolve(specifier, context);
  },
});
const { bgmPlayer } = await import('../src/utils/bgm.ts');
const { soundFX } = await import('../src/utils/sound.ts');
hooks.deregister();

test('all 3 offline BGM tracks have bounded, non-clipping DSP synthesis and warm reverb impulse', () => {
  assert.equal(BGM_TRACK_OPTIONS.length, 3);
  for (const track of BGM_TRACK_OPTIONS) {
    assert.equal(isBgmTrackId(track.id), true);
    const plan = getBgmTrackPlan(track.id);
    assert.equal(plan.id, track.id);
    assert.ok(plan.bpm >= 55 && plan.bpm <= 95);
    assert.equal(plan.beatsPerLoop, 64);
    assert.ok(plan.notes.length >= 24, `${track.id} should contain a rich 16-bar arrangement`);
    let prevBeat = -1;
    for (const n of plan.notes) {
      assert.ok(n.beat >= prevBeat, `${track.id} notes must be sorted by beat`);
      assert.ok(n.beat >= 0 && n.beat < plan.beatsPerLoop);
      assert.ok(n.midi >= 36 && n.midi <= 92);
      assert.ok(n.velocity > 0 && n.velocity <= 1);
      assert.ok(n.pan >= -1 && n.pan <= 1);
      prevBeat = n.beat;
    }
  }
  assert.equal(isBgmTrackId('rock-metal'), false);

  const sampleRate = 22050;
  for (const instrument of ['guzheng', 'guqin', 'xiao', 'rhodes', 'bass', 'chime']) {
    const pcm = synthesizeBgmNote(instrument, instrument === 'bass' ? 45 : 69, 0.9, sampleRate);
    assert.ok(pcm.length > 5000);
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i];
      assert.equal(Number.isFinite(v), true, `${instrument} produced non-finite sample`);
      const av = Math.abs(v);
      if (av > peak) peak = av;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / pcm.length);
    assert.ok(peak > 0.1 && peak <= 0.9, `${instrument} peak out of bounds: ${peak}`);
    assert.ok(rms > 0.04 && rms < 0.45, `${instrument} RMS out of bounds: ${rms}`);
    // Clean fade-out tail prevents click artifacts
    assert.ok(Math.abs(pcm[pcm.length - 1]) < 0.01, `${instrument} tail must decay smoothly`);
  }

  const [impL, impR] = makeReverbImpulse(sampleRate, 1.5);
  assert.equal(impL.length, impR.length);
  assert.ok(impL.length > sampleRate);
  let diffSum = 0;
  for (let i = 0; i < impL.length; i++) {
    assert.equal(Number.isFinite(impL[i]) && Number.isFinite(impR[i]), true);
    diffSum += Math.abs(impL[i] - impR[i]);
  }
  assert.ok(diffSum > 10, 'stereo reverb channels should be decorrelated');
});

function mockNode(extra = {}) {
  return {
    connect(target) {
      return target;
    },
    disconnect() {},
    ...extra,
  };
}

test('BgmController unlocks on gesture, schedules notes with reverb, switches tracks, and stops cleanly', async () => {
  let created = 0;
  let resumeCalls = 0;
  const voices = [];
  const convolvers = [];
  globalThis.window = {
    addEventListener() {},
    AudioContext: class {
      state = 'suspended';
      currentTime = 1.0;
      sampleRate = 22050;
      destination = {};
      constructor() {
        created += 1;
      }
      async resume() {
        resumeCalls += 1;
        this.state = 'running';
      }
      async suspend() {
        this.state = 'suspended';
      }
      async close() {
        this.state = 'closed';
      }
      createDynamicsCompressor() {
        return mockNode({ threshold: {}, ratio: {}, attack: {}, release: {} });
      }
      createGain() {
        return mockNode({
          gain: {
            value: 1,
            cancelScheduledValues() {},
            setValueAtTime(v) {
              this.value = v;
            },
            linearRampToValueAtTime(v) {
              this.value = v;
            },
          },
        });
      }
      createConvolver() {
        const c = mockNode({ buffer: null });
        convolvers.push(c);
        return c;
      }
      createBuffer(channels, length) {
        const ch = Array.from({ length: channels }, () => new Float32Array(length));
        return { getChannelData: (idx) => ch[idx] };
      }
      createBufferSource() {
        const v = mockNode({
          buffer: null,
          playbackRate: { value: 1 },
          start(at) {
            this.startedAt = at;
          },
          stop() {
            this.stopped = true;
          },
        });
        voices.push(v);
        return v;
      }
      createOscillator() {
        return mockNode({
          type: 'sine',
          frequency: { setValueAtTime() {} },
          start() {},
          stop() {},
        });
      }
      createStereoPanner() {
        return mockNode({ pan: { value: 0 } });
      }
    },
  };

  try {
    soundFX.setMuted(false);
    soundFX.unlock();
    bgmPlayer.configure({ enabled: true, track: 'jiangnan', volume: 50 });
    assert.equal(bgmPlayer.isEnabled(), true);
    assert.equal(bgmPlayer.getTrack(), 'jiangnan');
    assert.equal(bgmPlayer.getVolume(), 50);

    bgmPlayer.unlock();
    await new Promise((r) => setTimeout(r, 10));
    // CRITICAL: SFX and BGM MUST share a single AudioContext so Android WebView never silences SFX!
    assert.equal(created, 1, 'SFX and BGM must share one AudioContext');
    assert.equal(resumeCalls, 1);
    assert.equal(convolvers.length, 1);
    assert.ok(convolvers[0].buffer, 'reverb impulse should be loaded');
    assert.equal(bgmPlayer.isPlaying(), true);
    assert.ok(voices.length > 0, 'opening bar notes should be scheduled immediately');

    // Card-play SFX continues working seamlessly while BGM is playing!
    const bgmVoiceCount = voices.length;
    const cards = [{ id: 1 }, { id: 2 }];
    soundFX.playCards({ seat: 0, cards, parsed: { patternType: 'PAIR', cards, components: [] } }, 0);
    assert.ok(voices.length > bgmVoiceCount, 'SFX playCards must emit voices while BGM is active');

    // Muting SFX must NOT stop BGM, and disabling BGM must NOT break SFX!
    soundFX.setMuted(true);
    assert.equal(bgmPlayer.isPlaying(), true);
    soundFX.setMuted(false);

    const countBeforeSwitch = voices.length;
    bgmPlayer.configure({ track: 'haipai' });
    assert.equal(bgmPlayer.getTrack(), 'haipai');
    assert.ok(voices.length > countBeforeSwitch, 'switching track should schedule new track notes');

    bgmPlayer.configure({ enabled: false });
    assert.equal(bgmPlayer.isPlaying(), false);
    const countAfterBgmOff = voices.length;
    soundFX.playCards({ seat: 0, cards, parsed: { patternType: 'PAIR', cards, components: [] } }, 0);
    assert.ok(voices.length > countAfterBgmOff, 'SFX must keep playing after turning BGM off');
  } finally {
    bgmPlayer.dispose();
    soundFX.resetContext();
    delete globalThis.window;
  }
});
