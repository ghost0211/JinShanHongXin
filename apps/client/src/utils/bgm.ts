import {
  getBgmTrackPlan,
  makeReverbImpulse,
  synthesizeBgmNote,
  type BgmInstrument,
  type BgmTrackId,
  type BgmTrackPlan,
} from './bgmAudio.js';
import { soundFX } from './sound.js';

/** Comfortable ceiling so BGM stays warm beneath card-play SFX. */
const MAX_BGM_GAIN = 0.32;
const LOOKAHEAD_SEC = 0.32;
const SCHEDULER_TICK_MS = 110;
const MAX_ACTIVE_VOICES = 28;

class BgmController {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private readonly bufferCache = new Map<string, AudioBuffer>();
  private readonly activeVoices = new Set<AudioBufferSourceNode>();

  private enabled = true;
  private trackId: BgmTrackId = 'jiangnan';
  private volume = 0.45; // 0..1
  private playing = false;
  private pausedByVisibility = false;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private plan: BgmTrackPlan = getBgmTrackPlan('jiangnan');
  private loopStartTime = 0;
  private nextNoteIndex = 0;
  private visibilityBound = false;

  isEnabled(): boolean {
    return this.enabled;
  }

  getTrack(): BgmTrackId {
    return this.trackId;
  }

  getVolume(): number {
    return Math.round(this.volume * 100);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  configure(opts: {
    enabled?: boolean;
    track?: BgmTrackId;
    volume?: number;
  }): void {
    const prevEnabled = this.enabled;
    const prevTrack = this.trackId;

    if (typeof opts.enabled === 'boolean') {
      this.enabled = opts.enabled;
    }
    if (opts.track && opts.track !== this.trackId) {
      this.trackId = opts.track;
      this.plan = getBgmTrackPlan(opts.track);
      this.bufferCache.clear();
    }
    if (typeof opts.volume === 'number' && !Number.isNaN(opts.volume)) {
      this.volume = Math.max(0, Math.min(1, opts.volume / 100));
    }

    if (!this.enabled) {
      this.stopPlayback(true);
      return;
    }

    if (prevTrack !== this.trackId && this.playing) {
      // Smoothly switch to the newly selected track immediately
      this.stopPlayback(false);
      this.startPlayback();
      return;
    }

    if (!prevEnabled && this.enabled) {
      this.startPlayback();
      return;
    }

    this.applyGainSmooth(0.08);
  }

  /** Call from user gesture handlers (pointerup / click / keydown) to satisfy WebView autoplay policy. */
  unlock(): void {
    this.bindVisibilityListeners();
    if (!this.enabled || this.pausedByVisibility) return;
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      if (ctx.state !== 'running') {
        void ctx.resume().then(() => {
          if (this.enabled && !this.pausedByVisibility && !this.playing) {
            this.startPlayback();
          }
        }).catch(() => {});
      } else if (!this.playing) {
        this.startPlayback();
      }
    } catch {
      // Optional audio on environments without output hardware.
    }
  }

  dispose(): void {
    this.stopPlayback(false);
    this.bufferCache.clear();
    try {
      this.dryGain?.disconnect();
      this.wetGain?.disconnect();
      this.reverbNode?.disconnect();
      this.masterGain?.disconnect();
    } catch {
      // ignore
    }
    // Never close the shared AudioContext here — soundFX shares it!
    this.ctx = null;
    this.masterGain = null;
    this.dryGain = null;
    this.wetGain = null;
    this.reverbNode = null;
  }

  private bindVisibilityListeners(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    const handleVisibility = () => {
      if (document.hidden) {
        this.pausedByVisibility = true;
        this.stopPlayback(true);
      } else {
        this.pausedByVisibility = false;
        if (this.enabled) {
          this.unlock();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        this.pausedByVisibility = true;
        this.stopPlayback(false);
      });
    }
  }

  private ensureContext(): AudioContext | null {
    const shared = soundFX.getSharedAudioContext(true);
    if (!shared) return null;
    if (this.ctx === shared && this.masterGain && this.dryGain) {
      return shared;
    }

    // Rebind BGM bus onto the single shared AudioContext
    this.stopVoices();
    this.bufferCache.clear();
    try {
      this.dryGain?.disconnect();
      this.wetGain?.disconnect();
      this.reverbNode?.disconnect();
      this.masterGain?.disconnect();
    } catch {
      // ignore
    }

    const compressor = shared.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.2;

    const masterGain = shared.createGain();
    masterGain.gain.value = 0.0001;

    const dryGain = shared.createGain();
    dryGain.gain.value = 0.72;

    const wetGain = shared.createGain();
    wetGain.gain.value = 0.34;

    dryGain.connect(masterGain);
    this.reverbNode = null;
    if (typeof shared.createConvolver === 'function') {
      const reverb = shared.createConvolver();
      const [impL, impR] = makeReverbImpulse(shared.sampleRate, 1.4);
      const impulseBuf = shared.createBuffer(2, impL.length, shared.sampleRate);
      impulseBuf.getChannelData(0).set(impL);
      impulseBuf.getChannelData(1).set(impR);
      reverb.buffer = impulseBuf;
      reverb.connect(wetGain).connect(masterGain);
      this.reverbNode = reverb;
    }

    masterGain.connect(compressor).connect(shared.destination);

    this.ctx = shared;
    this.masterGain = masterGain;
    this.dryGain = dryGain;
    this.wetGain = wetGain;
    return shared;
  }

  private targetGain(): number {
    if (!this.enabled || this.pausedByVisibility) return 0;
    return this.volume * MAX_BGM_GAIN;
  }

  private applyGainSmooth(rampSec: number): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const target = this.targetGain();
    const g = this.masterGain.gain;
    if (typeof g.cancelScheduledValues === 'function') {
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.linearRampToValueAtTime(Math.max(0.0001, target), now + rampSec);
    } else {
      g.value = target;
    }
  }

  private startPlayback(): void {
    if (!this.enabled || this.pausedByVisibility) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state !== 'running') {
      void ctx
        .resume()
        .then(() => {
          if (this.enabled && !this.pausedByVisibility && !this.playing) {
            this.startPlayback();
          }
        })
        .catch(() => {});
      return;
    }

    this.stopVoices();
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    this.plan = getBgmTrackPlan(this.trackId);
    this.loopStartTime = ctx.currentTime + 0.06;
    this.nextNoteIndex = 0;
    this.playing = true;

    if (this.masterGain) {
      const now = ctx.currentTime;
      const g = this.masterGain.gain;
      if (typeof g.cancelScheduledValues === 'function') {
        g.cancelScheduledValues(now);
        g.setValueAtTime(0.0001, now);
        g.linearRampToValueAtTime(Math.max(0.0001, this.targetGain()), now + 0.45);
      } else {
        g.value = this.targetGain();
      }
    }

    this.scheduleAhead();
    this.schedulerTimer = setInterval(() => this.scheduleAhead(), SCHEDULER_TICK_MS);
  }

  private stopPlayback(fadeOut: boolean): void {
    this.playing = false;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (fadeOut && this.ctx && this.masterGain && this.ctx.state === 'running') {
      const now = this.ctx.currentTime;
      const g = this.masterGain.gain;
      if (typeof g.cancelScheduledValues === 'function') {
        g.cancelScheduledValues(now);
        g.setValueAtTime(Math.max(0.0001, g.value), now);
        g.linearRampToValueAtTime(0.0001, now + 0.16);
      } else {
        g.value = 0;
      }
    }
    this.stopVoices();
  }

  private stopVoices(): void {
    for (const voice of this.activeVoices) {
      try {
        voice.stop();
      } catch {
        // Already ended
      }
    }
    this.activeVoices.clear();
  }

  private getOrBuildBuffer(
    ctx: AudioContext,
    instrument: BgmInstrument,
    midi: number,
    durationSec: number,
  ): AudioBuffer {
    const durBucket = Math.round(durationSec * 4) / 4;
    const key = `${instrument}:${midi}:${durBucket}`;
    const cached = this.bufferCache.get(key);
    if (cached) return cached;

    const pcm = synthesizeBgmNote(instrument, midi, Math.max(0.45, durBucket), ctx.sampleRate);
    const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buffer.getChannelData(0).set(pcm);
    if (this.bufferCache.size > 140) {
      const oldestKey = this.bufferCache.keys().next().value;
      if (oldestKey) this.bufferCache.delete(oldestKey);
    }
    this.bufferCache.set(key, buffer);
    return buffer;
  }

  private scheduleAhead(): void {
    if (!this.playing || !this.ctx || !this.dryGain || this.ctx.state !== 'running') {
      return;
    }
    const ctx = this.ctx;
    const secPerBeat = 60 / this.plan.bpm;
    const loopDurationSec = this.plan.beatsPerLoop * secPerBeat;
    const horizon = ctx.currentTime + LOOKAHEAD_SEC;

    // Catch up cleanly if the main thread stalled longer than a full loop
    while (this.loopStartTime + loopDurationSec < ctx.currentTime - 0.1) {
      this.loopStartTime += loopDurationSec;
      this.nextNoteIndex = 0;
    }

    let guard = 0;
    while (guard++ < 48) {
      if (this.nextNoteIndex >= this.plan.notes.length) {
        this.loopStartTime += loopDurationSec;
        this.nextNoteIndex = 0;
      }
      const note = this.plan.notes[this.nextNoteIndex];
      const when = this.loopStartTime + note.beat * secPerBeat;
      if (when > horizon) break;

      this.nextNoteIndex += 1;
      if (when < ctx.currentTime - 0.08) continue;

      this.triggerNote(ctx, note.instrument, note.midi, note.length * secPerBeat, note.velocity, note.pan, when);
    }
  }

  private triggerNote(
    ctx: AudioContext,
    instrument: BgmInstrument,
    midi: number,
    durationSec: number,
    velocity: number,
    pan: number,
    when: number,
  ): void {
    try {
      while (this.activeVoices.size >= MAX_ACTIVE_VOICES) {
        const oldest = this.activeVoices.values().next().value;
        if (!oldest) break;
        this.activeVoices.delete(oldest);
        try {
          oldest.stop();
        } catch {
          // ignore
        }
      }

      const buffer = this.getOrBuildBuffer(ctx, instrument, midi, durationSec);
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      const panner =
        pan !== 0 && typeof ctx.createStereoPanner === 'function'
          ? ctx.createStereoPanner()
          : null;

      source.buffer = buffer;
      gain.gain.value = velocity;
      source.connect(gain);

      const tailNode: AudioNode = panner ? (gain.connect(panner), (panner.pan.value = pan), panner) : gain;
      if (this.dryGain) tailNode.connect(this.dryGain);
      if (this.reverbNode) tailNode.connect(this.reverbNode);

      source.onended = () => {
        this.activeVoices.delete(source);
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
      };

      source.start(when);
      this.activeVoices.add(source);
    } catch {
      // Background music must never interrupt gameplay.
    }
  }
}

export const bgmPlayer = new BgmController();
