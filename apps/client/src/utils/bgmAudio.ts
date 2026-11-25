export const BGM_TRACK_OPTIONS = [
  {
    id: 'jiangnan',
    label: '江南丝竹',
    subtitle: '古筝 · 洞箫',
    desc: '五声清雅丝竹，金山水乡茶室韵味',
  },
  {
    id: 'haipai',
    label: '海派雅韵',
    subtitle: '暖音电钢 · 拨弦',
    desc: '老上海慢爵士茶馆氛围，久听舒缓不腻',
  },
  {
    id: 'guqin',
    label: '幽兰清茶',
    subtitle: '古琴 · 泛音',
    desc: '留白极简禅意琴音，适合静心算牌',
  },
] as const;

export type BgmTrackId = (typeof BGM_TRACK_OPTIONS)[number]['id'];

export type BgmInstrument =
  | 'guzheng'
  | 'guqin'
  | 'xiao'
  | 'rhodes'
  | 'bass'
  | 'chime';

export interface BgmNote {
  /** Beat offset inside the loop [0, beatsPerLoop). */
  beat: number;
  /** MIDI note number (60 = C4). */
  midi: number;
  /** Note length in beats. */
  length: number;
  instrument: BgmInstrument;
  /** Relative loudness 0..1. */
  velocity: number;
  /** Stereo pan -1..1. */
  pan: number;
}

export interface BgmTrackPlan {
  id: BgmTrackId;
  bpm: number;
  beatsPerLoop: number;
  notes: readonly BgmNote[];
}

export function isBgmTrackId(value: unknown): value is BgmTrackId {
  return BGM_TRACK_OPTIONS.some((t) => t.id === value);
}

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Deterministic PRNG (Mulberry32) for zero-dependency offline audio synthesis. */
function makeRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Karplus-Strong physical-modeling plucked string (Guzheng / Guqin).
 * Uses mellow low-pass excitation + fractional delay line + gentle body warmth
 * for an organic wooden acoustic pluck with zero digital harshness.
 */
function makePluckedString(
  freq: number,
  durationSec: number,
  sampleRate: number,
  opts: { decay: number; brightness: number; harmonicShimmer: number; seed: number },
): Float32Array {
  const totalSamples = Math.max(256, Math.ceil(durationSec * sampleRate));
  const pcm = new Float32Array(totalSamples);
  const exactPeriod = Math.max(8, sampleRate / freq);
  const delayLen = Math.floor(exactPeriod);
  const frac = exactPeriod - delayLen;
  const ring = new Float32Array(delayLen + 2);
  const rng = makeRng(opts.seed);

  // Fill excitation buffer with warm filtered noise burst (silk/nylon finger pluck)
  let lp = 0;
  const excAlpha = opts.brightness;
  for (let i = 0; i < delayLen; i++) {
    const white = rng() * 2 - 1;
    lp += (white - lp) * excAlpha;
    // Soft pluck window so the initial transient is round, not clicky
    const w = Math.sin((Math.PI * (i + 0.5)) / delayLen);
    ring[i] = lp * (0.45 + 0.55 * w);
  }
  // Remove DC offset from excitation
  let dc = 0;
  for (let i = 0; i < delayLen; i++) dc += ring[i];
  dc /= delayLen;
  for (let i = 0; i < delayLen; i++) ring[i] -= dc;

  let writeIdx = 0;
  let prevSample = 0;
  let bodyLp = 0;
  const bodyAlpha = 1 - Math.exp((-2 * Math.PI * 1900) / sampleRate);
  const fadeOutSamples = Math.min(totalSamples, Math.ceil(0.08 * sampleRate));
  const attackSamples = Math.max(12, Math.ceil(0.004 * sampleRate));

  for (let i = 0; i < totalSamples; i++) {
    const idx0 = writeIdx;
    const idx1 = (writeIdx + 1) % delayLen;
    const idx2 = (writeIdx + 2) % delayLen;
    // Linear fractional interpolation for accurate tuning
    const s0 = ring[idx0] * (1 - frac) + ring[idx1] * frac;
    const s1 = ring[idx1] * (1 - frac) + ring[idx2] * frac;
    const next = opts.decay * (0.5 * (s0 + s1));
    ring[writeIdx] = next;
    writeIdx = idx1;

    // Gentle wooden soundboard smoothing
    bodyLp += (next - bodyLp) * bodyAlpha;
    let out = next * 0.65 + bodyLp * 0.35;

    // Subtle silk harmonic shimmer (especially lovely for Guqin harmonics)
    if (opts.harmonicShimmer > 0) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 2.4);
      out +=
        Math.sin(2 * Math.PI * freq * 2 * t) * opts.harmonicShimmer * env * 0.22 +
        Math.sin(2 * Math.PI * freq * t) * opts.harmonicShimmer * env * 0.14;
    }

    // De-click micro-attack & clean fade-out
    const att = i < attackSamples ? i / attackSamples : 1;
    const rem = totalSamples - 1 - i;
    const rel = rem < fadeOutSamples ? rem / fadeOutSamples : 1;
    pcm[i] = out * att * rel;
    prevSample = next;
  }
  void prevSample;

  return normalizeRms(pcm, 0.24, 0.82);
}

/** Warm breathy bamboo flute (洞箫 / 箫) with delayed vibrato and silky air breath. */
function makeBambooFlute(
  freq: number,
  durationSec: number,
  sampleRate: number,
  seed: number,
): Float32Array {
  const totalSamples = Math.max(256, Math.ceil(durationSec * sampleRate));
  const pcm = new Float32Array(totalSamples);
  const rng = makeRng(seed);
  let phase = 0;
  let breathLp = 0;
  let breathHp = 0;
  const lpAlpha = 1 - Math.exp((-2 * Math.PI * Math.min(3200, freq * 3.2)) / sampleRate);
  const hpAlpha = 1 - Math.exp((-2 * Math.PI * Math.max(220, freq * 0.6)) / sampleRate);

  const attackSec = Math.min(0.22, durationSec * 0.28);
  const releaseSec = Math.min(0.32, durationSec * 0.35);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const rem = durationSec - t;
    const att = t < attackSec ? Math.sin((Math.PI * 0.5 * t) / attackSec) : 1;
    const rel = rem < releaseSec ? Math.sin((Math.PI * 0.5 * Math.max(0, rem)) / releaseSec) : 1;
    const env = att * rel;

    // Gentle expressive vibrato blooming after initial onset
    const vibDepth = Math.min(1, Math.max(0, (t - 0.28) / 0.45)) * 0.0045;
    const instFreq = freq * (1 + Math.sin(2 * Math.PI * 4.8 * t) * vibDepth);
    phase += (2 * Math.PI * instFreq) / sampleRate;

    const tone =
      Math.sin(phase) * 0.78 +
      Math.sin(phase * 2) * 0.16 +
      Math.sin(phase * 3) * 0.04;

    // Soft band-limited air whisper
    const white = rng() * 2 - 1;
    breathLp += (white - breathLp) * lpAlpha;
    breathHp += (breathLp - breathHp) * hpAlpha;
    const breath = (breathLp - breathHp) * 0.09;

    pcm[i] = (tone + breath) * env * 0.46;
  }

  return normalizeRms(pcm, 0.19, 0.75);
}

/** Lush vintage warm Rhodes electric piano for Shanghai lounge / Haipai mood. */
function makeWarmRhodes(
  freq: number,
  durationSec: number,
  sampleRate: number,
): Float32Array {
  const totalSamples = Math.max(256, Math.ceil(durationSec * sampleRate));
  const pcm = new Float32Array(totalSamples);
  const attackSec = 0.009;
  const releaseSec = Math.min(0.24, durationSec * 0.3);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const rem = durationSec - t;
    const att = t < attackSec ? t / attackSec : 1;
    const rel = rem < releaseSec ? Math.max(0, rem / releaseSec) : 1;
    const bodyEnv = Math.exp(-t * 1.15);
    const tineEnv = Math.exp(-t * 9.5);
    const trem = 0.92 + 0.08 * Math.sin(2 * Math.PI * 3.2 * t);

    const w = 2 * Math.PI * freq * t;
    const warmBody = Math.sin(w) * 0.78 + Math.sin(w * 2) * 0.14 * Math.exp(-t * 2.1);
    const bellTine = (Math.sin(w * 3) * 0.16 + Math.sin(w * 4) * 0.08) * tineEnv;

    pcm[i] = (warmBody * bodyEnv + bellTine) * att * rel * trem * 0.62;
  }

  return normalizeRms(pcm, 0.21, 0.78);
}

/** Warm acoustic plucked bass supporting harmony cleanly without muddiness. */
function makeAcousticBass(
  freq: number,
  durationSec: number,
  sampleRate: number,
): Float32Array {
  const totalSamples = Math.max(256, Math.ceil(durationSec * sampleRate));
  const pcm = new Float32Array(totalSamples);
  const attackSec = 0.012;
  const releaseSec = Math.min(0.16, durationSec * 0.25);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const rem = durationSec - t;
    const att = t < attackSec ? t / attackSec : 1;
    const rel = rem < releaseSec ? Math.max(0, rem / releaseSec) : 1;
    const env = Math.exp(-t * 1.65) * att * rel;
    const w = 2 * Math.PI * freq * t;
    const sig =
      Math.sin(w) * 0.78 +
      Math.sin(w * 2) * 0.24 * Math.exp(-t * 4.2) +
      Math.sin(w * 3) * 0.08 * Math.exp(-t * 10);
    pcm[i] = sig * env * 0.65;
  }

  return normalizeRms(pcm, 0.23, 0.8);
}

/** Delicate tea-house wind chime / harmonic bell accent. */
function makeSoftChime(
  freq: number,
  durationSec: number,
  sampleRate: number,
): Float32Array {
  const totalSamples = Math.max(256, Math.ceil(durationSec * sampleRate));
  const pcm = new Float32Array(totalSamples);
  const attackSec = 0.006;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const att = t < attackSec ? t / attackSec : 1;
    const w = 2 * Math.PI * freq * t;
    const sig =
      Math.sin(w) * Math.exp(-t * 1.35) * 0.68 +
      Math.sin(w * 2.0) * Math.exp(-t * 2.2) * 0.22 +
      Math.sin(w * 2.99) * Math.exp(-t * 3.8) * 0.1;
    const rem = totalSamples - 1 - i;
    const rel = rem < 400 ? rem / 400 : 1;
    pcm[i] = sig * att * rel * 0.45;
  }

  return normalizeRms(pcm, 0.14, 0.72);
}

function normalizeRms(pcm: Float32Array, targetRms: number, maxPeak: number): Float32Array {
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    sumSq += v * v;
    const av = Math.abs(v);
    if (av > peak) peak = av;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, pcm.length));
  if (rms < 1e-6 || peak < 1e-6) return pcm;
  const gain = Math.min(targetRms / rms, maxPeak / peak);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] *= gain;
  }
  return pcm;
}

/**
 * Synthesize a single instrument note sample (deterministic offline PCM, zero network/assets).
 */
export function synthesizeBgmNote(
  instrument: BgmInstrument,
  midi: number,
  durationSec: number,
  sampleRate: number,
): Float32Array {
  const freq = midiToFreq(midi);
  const seed = Math.imul(midi + 17, 2654435761) ^ instrument.length * 1013904223;
  switch (instrument) {
    case 'guzheng':
      return makePluckedString(freq, Math.max(0.45, durationSec), sampleRate, {
        decay: 0.9965,
        brightness: 0.34,
        harmonicShimmer: 0.08,
        seed,
      });
    case 'guqin':
      return makePluckedString(freq, Math.max(0.85, durationSec), sampleRate, {
        decay: 0.9974,
        brightness: 0.2,
        harmonicShimmer: 0.26,
        seed: seed ^ 0x51a7,
      });
    case 'xiao':
      return makeBambooFlute(freq, Math.max(0.55, durationSec), sampleRate, seed ^ 0x9e37);
    case 'rhodes':
      return makeWarmRhodes(freq, Math.max(0.5, durationSec), sampleRate);
    case 'bass':
      return makeAcousticBass(freq, Math.max(0.45, durationSec), sampleRate);
    case 'chime':
      return makeSoftChime(freq, Math.max(0.8, durationSec), sampleRate);
  }
}

/**
 * Generate a silky 2.0-second stereo tea-house reverb impulse response (left + right PCM).
 * Progressive high-frequency damping keeps the ambience warm and cozy, never metallic.
 */
export function makeReverbImpulse(
  sampleRate: number,
  durationSec = 2.0,
): [Float32Array, Float32Array] {
  const len = Math.max(256, Math.ceil(durationSec * sampleRate));
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  const rngL = makeRng(44101);
  const rngR = makeRng(88219);
  let lpL = 0;
  let lpR = 0;

  for (let i = 0; i < len; i++) {
    const x = i / len;
    // Smooth onset (first 12ms) + warm exponential decay
    const onset = Math.min(1, i / Math.max(1, sampleRate * 0.012));
    const decay = Math.exp(-x * 4.8) * onset;
    // Progressively darken tail so reverb feels like a wood-paneled tea room
    const alpha = 0.38 * (1 - 0.65 * x);
    lpL += ((rngL() * 2 - 1) - lpL) * alpha;
    lpR += ((rngR() * 2 - 1) - lpR) * alpha;
    left[i] = lpL * decay * 0.55;
    right[i] = lpR * decay * 0.55;
  }

  return [left, right];
}

// ============================================================================
// 3 Original Full 16-Bar Compositions (each ~48-64s seamless loop)
// ============================================================================

function buildJiangnanTrack(): BgmTrackPlan {
  // D Major Pentatonic (D E F# A B) — flowing Jiangnan Guzheng & Xiao bamboo flute
  const notes: BgmNote[] = [];
  const push = (
    beat: number,
    midi: number,
    length: number,
    instrument: BgmInstrument,
    velocity: number,
    pan: number,
  ) => notes.push({ beat, midi, length, instrument, velocity, pan });

  // 16 bars × 4 beats = 64 beats. Chord roots per bar in D pentatonic:
  // D(50), Bm(47), G(43), A(45) — classic gentle Jiangnan harmonic cycle
  const barAccomp: Array<[number, number, number, number]> = [
    [50, 57, 62, 66], // Bar 1: D
    [47, 54, 59, 62], // Bar 2: Bm
    [43, 50, 55, 59], // Bar 3: G
    [45, 52, 57, 64], // Bar 4: A
    [50, 57, 62, 66], // Bar 5: D
    [54, 57, 62, 69], // Bar 6: D/F#
    [43, 50, 57, 62], // Bar 7: G(add9)
    [45, 52, 57, 62], // Bar 8: Asus4
    [47, 54, 59, 66], // Bar 9: Bm
    [43, 50, 59, 62], // Bar 10: G
    [50, 57, 62, 69], // Bar 11: D
    [45, 52, 57, 64], // Bar 12: A
    [43, 50, 55, 62], // Bar 13: G
    [47, 54, 59, 64], // Bar 14: Bm7
    [45, 52, 57, 62], // Bar 15: A(add4)
    [50, 57, 62, 66], // Bar 16: D resolve
  ];

  // Gentle rolling Guzheng harp accompaniment + soft warm bass
  for (let bar = 0; bar < 16; bar++) {
    const base = bar * 4;
    const [r, fifth, oct, top] = barAccomp[bar];
    push(base, r, 3.6, 'bass', 0.42, -0.08);
    push(base, fifth, 2.2, 'guzheng', 0.34, -0.26);
    push(base + 0.5, oct, 2.0, 'guzheng', 0.32, -0.18);
    push(base + 1.5, top, 2.1, 'guzheng', 0.3, -0.1);
    push(base + 2.5, oct, 1.8, 'guzheng', 0.28, -0.2);
    if (bar % 2 === 1) {
      push(base + 3.0, fifth + 12, 1.8, 'guzheng', 0.25, -0.12);
    }
  }

  // Expressive Guzheng lead melody (16 bars, A - A' - B - A'' lyrical arc)
  const melody: Array<[number, number, number, number]> = [
    // Phrase A (bars 1-4)
    [0, 74, 1.5, 0.54], [1.5, 76, 1.0, 0.48], [2.5, 78, 1.5, 0.54],
    [4, 81, 2.0, 0.58], [6, 78, 1.0, 0.46], [7, 76, 1.0, 0.45],
    [8, 74, 1.5, 0.52], [9.5, 71, 1.0, 0.46], [10.5, 69, 1.5, 0.5],
    [12, 71, 2.0, 0.5], [14, 74, 2.0, 0.48],
    // Phrase A' (bars 5-8)
    [16, 78, 1.5, 0.55], [17.5, 81, 1.0, 0.52], [18.5, 83, 1.5, 0.58],
    [20, 86, 2.0, 0.6], [22, 83, 1.0, 0.5], [23, 81, 1.0, 0.48],
    [24, 78, 1.5, 0.52], [25.5, 76, 1.0, 0.46], [26.5, 74, 1.5, 0.5],
    [28, 76, 3.0, 0.52],
    // Phrase B (bars 9-12: gentle peak & water ripple)
    [32, 83, 1.5, 0.56], [33.5, 81, 1.0, 0.5], [34.5, 78, 1.5, 0.52],
    [36, 76, 1.5, 0.5], [37.5, 74, 1.0, 0.46], [38.5, 71, 1.5, 0.48],
    [40, 74, 1.0, 0.52], [41, 76, 1.0, 0.5], [42, 78, 1.0, 0.54], [43, 81, 1.5, 0.56],
    [44, 76, 2.5, 0.5], [46.5, 74, 1.5, 0.46],
    // Phrase A'' (bars 13-16: tender return home)
    [48, 71, 1.5, 0.52], [49.5, 74, 1.0, 0.5], [50.5, 76, 1.5, 0.52],
    [52, 78, 2.0, 0.54], [54, 76, 1.0, 0.46], [55, 74, 1.0, 0.45],
    [56, 71, 1.5, 0.48], [57.5, 69, 1.5, 0.46], [59, 71, 1.0, 0.44],
    [60, 74, 3.8, 0.56],
  ];
  for (const [b, m, len, vel] of melody) {
    push(b, m, Math.max(1.4, len + 0.6), 'guzheng', vel, 0.24);
  }

  // Warm breathy Xiao bamboo flute counter-melody (enters softly in bars 5-16 for depth)
  const flute: Array<[number, number, number, number]> = [
    [16, 69, 3.5, 0.34], [20, 74, 3.5, 0.36],
    [24, 71, 3.2, 0.32], [28, 69, 3.5, 0.3],
    [32, 78, 2.5, 0.38], [34.5, 76, 1.5, 0.34], [36, 74, 3.5, 0.36],
    [40, 81, 3.2, 0.38], [44, 76, 3.6, 0.33],
    [52, 74, 3.5, 0.34], [56, 76, 2.0, 0.32], [58, 74, 2.0, 0.3], [60, 74, 3.8, 0.35],
  ];
  for (const [b, m, len, vel] of flute) {
    push(b, m, len, 'xiao', vel, -0.32);
  }

  notes.sort((a, b) => a.beat - b.beat);
  return { id: 'jiangnan', bpm: 76, beatsPerLoop: 64, notes };
}

function buildHaipaiTrack(): BgmTrackPlan {
  // Warm Old-Shanghai Lounge (F Major / Dm9 smooth tea-house jazz) — 80 BPM, 64 beats
  const notes: BgmNote[] = [];
  const push = (
    beat: number,
    midi: number,
    length: number,
    instrument: BgmInstrument,
    velocity: number,
    pan: number,
  ) => notes.push({ beat, midi, length, instrument, velocity, pan });

  // 16-bar velvety Rhodes chord progression (root bass + 4-note warm voicings)
  const bars: Array<{ bass: number; walk: number; chord: number[] }> = [
    { bass: 41, walk: 45, chord: [57, 60, 64, 67] }, // Fmaj9
    { bass: 38, walk: 41, chord: [57, 60, 64, 67] }, // Dm9
    { bass: 43, walk: 46, chord: [58, 62, 65, 69] }, // Gm9
    { bass: 48, walk: 43, chord: [58, 62, 64, 69] }, // C13
    { bass: 41, walk: 48, chord: [57, 60, 64, 69] }, // Fmaj7(6)
    { bass: 45, walk: 43, chord: [57, 60, 64, 67] }, // Am7
    { bass: 46, walk: 45, chord: [57, 62, 65, 69] }, // Bbmaj7
    { bass: 48, walk: 46, chord: [58, 60, 65, 67] }, // C9sus4
    { bass: 41, walk: 45, chord: [57, 60, 64, 67] }, // Fmaj9
    { bass: 45, walk: 40, chord: [55, 60, 64, 67] }, // Am7
    { bass: 38, walk: 45, chord: [57, 60, 64, 69] }, // Dm9
    { bass: 43, walk: 48, chord: [58, 62, 65, 69] }, // Gm9
    { bass: 46, walk: 43, chord: [57, 60, 62, 65] }, // Bbmaj9
    { bass: 45, walk: 38, chord: [55, 60, 64, 69] }, // Am7
    { bass: 43, walk: 48, chord: [58, 62, 65, 67] }, // Gm7 -> C9
    { bass: 41, walk: 48, chord: [57, 60, 64, 67] }, // Fmaj9 resolve
  ];

  for (let bar = 0; bar < 16; bar++) {
    const b = bar * 4;
    const { bass, walk, chord } = bars[bar];
    // Relaxed upright bass walking on beat 1 and beat 3.5
    push(b, bass, 2.8, 'bass', 0.46, -0.1);
    push(b + 3.0, walk, 1.2, 'bass', 0.34, -0.05);

    // Rolled lush Rhodes chords (beat 1 + gentle syncopated comp on beat 2.5)
    chord.forEach((m, idx) => {
      push(b + idx * 0.04, m, 3.2, 'rhodes', 0.25 + idx * 0.02, -0.24 + idx * 0.14);
    });
    if (bar % 2 === 0) {
      chord.slice(1).forEach((m, idx) => {
        push(b + 2.5 + idx * 0.03, m, 1.4, 'rhodes', 0.17, -0.12 + idx * 0.14);
      });
    }
  }

  // Smooth, unhurried tea-house lounge melody on upper Rhodes + occasional soft Guzheng sparkle
  const lead: Array<[number, number, number, number]> = [
    [0.5, 72, 1.5, 0.42], [2.0, 74, 1.5, 0.4], [4.0, 76, 2.2, 0.44], [6.5, 72, 1.2, 0.36],
    [8.0, 74, 2.0, 0.42], [10.0, 72, 1.0, 0.38], [11.0, 69, 1.5, 0.4], [12.5, 70, 2.8, 0.38],
    [16.5, 77, 1.5, 0.44], [18.0, 76, 1.5, 0.42], [20.0, 72, 2.2, 0.4], [22.5, 74, 1.4, 0.38],
    [24.0, 77, 2.0, 0.44], [26.0, 74, 1.5, 0.4], [28.0, 72, 3.2, 0.42],
    [32.5, 79, 1.5, 0.44], [34.0, 77, 1.0, 0.4], [35.0, 76, 1.5, 0.42], [36.5, 72, 2.5, 0.4],
    [40.0, 74, 1.5, 0.42], [41.5, 76, 1.0, 0.4], [42.5, 77, 1.5, 0.44], [44.0, 74, 3.0, 0.4],
    [48.5, 74, 1.5, 0.42], [50.0, 72, 1.5, 0.4], [52.0, 69, 2.0, 0.4], [54.5, 72, 1.5, 0.38],
    [56.0, 70, 1.8, 0.38], [58.0, 69, 1.8, 0.38], [60.0, 69, 3.8, 0.42],
  ];
  for (const [b, m, len, vel] of lead) {
    push(b, m, len + 0.5, 'rhodes', vel, 0.22);
  }
  // Delicate silk-string accents every 4 bars to tie the Shanghai lounge to Chinese aesthetics
  for (const [b, m] of [
    [14.5, 79],
    [30.5, 81],
    [46.5, 79],
    [62.0, 77],
  ]) {
    push(b, m, 2.2, 'guzheng', 0.28, 0.36);
  }

  notes.sort((a, b) => a.beat - b.beat);
  return { id: 'haipai', bpm: 80, beatsPerLoop: 64, notes };
}

function buildGuqinTrack(): BgmTrackPlan {
  // Spacious zen Guqin & Xiao in G Major Pentatonic (G A B D E) — 60 BPM, 64 beats (64s loop)
  const notes: BgmNote[] = [];
  const push = (
    beat: number,
    midi: number,
    length: number,
    instrument: BgmInstrument,
    velocity: number,
    pan: number,
  ) => notes.push({ beat, midi, length, instrument, velocity, pan });

  // Deep open Guqin strings (generous silence for calm card counting)
  const lowStrings: Array<[number, number, number]> = [
    [0, 43, 5.5], [8, 45, 5.0], [16, 47, 5.5], [24, 50, 5.5],
    [32, 48 - 1, 5.5], // B2 (47)
    [40, 45, 5.5], [48, 43, 5.5], [56, 50, 4.0], [60, 43, 4.0],
  ];
  for (const [b, m, len] of lowStrings) {
    push(b, m, len, 'guqin', 0.52, -0.18);
  }

  // Contemplative upper Guqin harmonics & melodic phrases
  const phrases: Array<[number, number, number, number]> = [
    [1.5, 67, 3.0, 0.48], [4.5, 69, 2.8, 0.44], [6.5, 71, 3.0, 0.46],
    [10.0, 74, 3.8, 0.5], [13.5, 71, 2.8, 0.42],
    [18.0, 69, 3.2, 0.46], [21.0, 67, 2.8, 0.44], [23.0, 64, 3.0, 0.42],
    [26.0, 62, 4.2, 0.48], [30.0, 67, 2.8, 0.42],
    [34.0, 76, 3.5, 0.5], [37.5, 74, 2.8, 0.46], [39.5, 71, 2.8, 0.44],
    [42.5, 69, 3.6, 0.48], [46.0, 67, 3.0, 0.44],
    [50.0, 74, 3.2, 0.48], [53.0, 71, 2.6, 0.44], [55.5, 69, 2.6, 0.42],
    [58.0, 67, 5.2, 0.5],
  ];
  for (const [b, m, len, vel] of phrases) {
    push(b, m, len, 'guqin', vel, 0.2);
  }

  // Sparse serene Xiao bamboo flute breaths
  const breaths: Array<[number, number, number]> = [
    [16, 74, 5.0],
    [32, 79, 5.0],
    [48, 71, 5.0],
    [58, 67, 5.2],
  ];
  for (const [b, m, len] of breaths) {
    push(b, m, len, 'xiao', 0.28, -0.3);
  }

  // Whisper-soft tea chime at major 16-beat section turns
  for (const [b, m] of [
    [0, 79],
    [16, 83],
    [32, 86],
    [48, 79],
  ]) {
    push(b, m, 3.6, 'chime', 0.22, 0.34);
  }

  notes.sort((a, b) => a.beat - b.beat);
  return { id: 'guqin', bpm: 60, beatsPerLoop: 64, notes };
}

const TRACK_CACHE = new Map<BgmTrackId, BgmTrackPlan>();

export function getBgmTrackPlan(trackId: BgmTrackId): BgmTrackPlan {
  const existing = TRACK_CACHE.get(trackId);
  if (existing) return existing;
  const built =
    trackId === 'haipai'
      ? buildHaipaiTrack()
      : trackId === 'guqin'
        ? buildGuqinTrack()
        : buildJiangnanTrack();
  TRACK_CACHE.set(trackId, built);
  return built;
}
