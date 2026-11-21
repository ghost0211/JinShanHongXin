const MUTE_KEY = 'jinshan_sound_muted';

class SoundController {
  private ctx: AudioContext | null = null;
  private muted: boolean;

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

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // ignore storage failure
    }
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
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
      if (!ctx) return;
      const now = ctx.currentTime + delaySec;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + durationSec + 0.02);
    } catch {
      // ignore audio failures
    }
  }

  playTap(): void {
    this.tone(540, 0.045, 'sine', 0.05);
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

  playCards(): void {
    this.tone(360, 0.06, 'triangle', 0.09);
    this.tone(520, 0.05, 'triangle', 0.06, 0.03);
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
}

export const soundFX = new SoundController();
