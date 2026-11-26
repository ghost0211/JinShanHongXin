import type { TrickPlayView } from '@jinshan/protocol';
import { makeCardSample, planCardSound, type CardStroke } from './cardAudio.js';

const MUTE_KEY = 'jinshan_sound_muted';
const MAX_CARD_VOICES = 20;

class SoundController {
  private ctx: AudioContext | null = null;
  private output: GainNode | null = null;
  private readonly cardVoices = new Set<AudioBufferSourceNode>();
  private readonly cardSamples: Record<CardStroke['kind'], AudioBuffer[]> = { slide: [], land: [] };
  private sampleIndex = 0;
  private muted: boolean;
  private volume = 0.82;
  private hapticsEnabled = true;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  getVolume(): number {
    return Math.round(this.volume * 100);
  }

  setVolume(percent: number): void {
    const clamped = Math.max(0, Math.min(100, percent));
    this.volume = clamped / 100;
    if (this.output && !this.muted) {
      this.output.gain.value = this.volume;
    }
  }

  isHapticsEnabled(): boolean {
    return this.hapticsEnabled;
  }

  setHapticsEnabled(enabled: boolean): void {
    this.hapticsEnabled = enabled;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.output) this.output.gain.value = muted ? 0 : this.volume;
    if (muted) this.stopCardSounds();
    else this.unlock();
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // ignore storage failure
    }
  }

  /**
   * Shared single AudioContext across SFX and BGM.
   * Android WebView / mobile Chromium can silence an older AudioContext when a
   * second AudioContext starts playing, so all audio buses MUST share one context.
   */
  getSharedAudioContext(create = false): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.ctx && this.ctx.state === 'closed') {
      this.ctx = null;
      this.output = null;
      this.cardSamples.slide.length = 0;
      this.cardSamples.land.length = 0;
    }
    if (this.ctx || !create) return this.ctx;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    this.output = ctx.createGain();
    this.output.gain.value = this.muted ? 0 : this.volume;
    this.output.connect(limiter).connect(ctx.destination);
    this.ctx = ctx;
    return ctx;
  }

  private getContext(create = false): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    return this.getSharedAudioContext(create);
  }

  unlock(): void {
    try {
      const ctx = this.getContext(true);
      if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
    } catch {
      // Audio is optional on browsers without a usable output device.
    }
  }

  /** Reset cached AudioContext references (used by tests when swapping mock window). */
  resetContext(): void {
    this.stopCardSounds();
    this.ctx = null;
    this.output = null;
    this.cardSamples.slide.length = 0;
    this.cardSamples.land.length = 0;
  }

  stopCardSounds(): void {
    for (const source of this.cardVoices) {
      try { source.stop(); } catch { /* Already stopped. */ }
    }
    this.cardVoices.clear();
  }

  private tone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'triangle',
    gainVal = 0.08,
    delaySec = 0,
  ): void {
    try {
      const ctx = this.getContext();
      if (!ctx || !this.output || ctx.state !== 'running') return;
      const now = ctx.currentTime + delaySec;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
      osc.connect(gain).connect(this.output);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      osc.start(now);
      osc.stop(now + durationSec + 0.02);
    } catch {
      // ignore audio failures
    }
  }

  playTap(): void {
    this.tone(540, 0.05, 'sine', 0.09);
    if (!this.hapticsEnabled) return;
    try {
      (
        window as unknown as {
          JinshanAndroid?: { vibrate?: (ms: number) => void };
        }
      ).JinshanAndroid?.vibrate?.(10);
    } catch {
      // ignore haptic failure
    }
  }

  playCards(play: TrickPlayView, viewerSeat: TrickPlayView['seat']): void {
    try {
      const ctx = this.getContext();
      if (!ctx || !this.output || ctx.state !== 'running') return;
      const start = ctx.currentTime + 0.008;
      const relativeSeat = (play.seat - viewerSeat + 4) % 4;
      const pan = [0, 0.32, 0, -0.32][relativeSeat];
      for (const stroke of planCardSound(play)) {
        while (this.cardVoices.size >= MAX_CARD_VOICES) {
          const oldest = this.cardVoices.values().next().value!;
          this.cardVoices.delete(oldest);
          oldest.stop();
        }
        const samples = this.cardSamples[stroke.kind];
        if (!samples.length) {
          for (const seed of [1357, 10939, 27367]) {
            const pcm = makeCardSample(stroke.kind, ctx.sampleRate, seed);
            const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
            buffer.getChannelData(0).set(pcm);
            samples.push(buffer);
          }
        }
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        const panner = pan && typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
        source.buffer = samples[this.sampleIndex++ % samples.length];
        source.playbackRate.value = stroke.rate;
        gain.gain.value = stroke.strength * (relativeSeat === 2 ? 0.64 : 0.79);
        source.connect(gain);
        if (panner) {
          panner.pan.value = pan;
          gain.connect(panner).connect(this.output);
        } else {
          gain.connect(this.output);
        }
        source.onended = () => {
          this.cardVoices.delete(source);
          source.disconnect();
          gain.disconnect();
          panner?.disconnect();
        };
        source.start(start + stroke.at);
        this.cardVoices.add(source);
      }
    } catch {
      // Playback must never interrupt the game.
    }
  }

  playSpecial(): void {
    this.tone(523.25, 0.09, 'triangle', 0.1, 0);
    this.tone(659.25, 0.09, 'triangle', 0.1, 0.06);
    this.tone(783.99, 0.14, 'triangle', 0.12, 0.12);
  }

  playSuccess(): void {
    this.tone(587.33, 0.1, 'sine', 0.09, 0);
    this.tone(880, 0.18, 'sine', 0.11, 0.08);
  }

  playError(): void {
    this.tone(240, 0.11, 'sawtooth', 0.06, 0);
    this.tone(185, 0.14, 'sawtooth', 0.06, 0.09);
  }

  playTurnAlert(): void {
    this.tone(660, 0.08, 'sine', 0.07, 0);
    this.tone(880, 0.11, 'sine', 0.07, 0.08);
  }
}

export const soundFX = new SoundController();
