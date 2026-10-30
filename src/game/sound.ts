// Tiny synthesized sound effects (no audio files): a chop's thunk, a glancing
// knock, the creak of a tree starting to go, and the crash when it lands.

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private noise(ctx: AudioContext, seconds: number): AudioBufferSourceNode {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /** Gain node that fades from `peak` to silence over `seconds`, scaled by distance volume. */
  private env(ctx: AudioContext, vol: number, peak: number, seconds: number, attack = 0.004): GainNode {
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    g.connect(this.master!);
    return g;
  }

  /** Axe biting into wood. `strength` 0..1. */
  chop(strength = 1, vol = 1) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Woody knock: a quick low sine drop…
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190 + Math.random() * 40, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    o.connect(this.env(ctx, vol, 0.9 * strength, 0.16));
    o.start(t);
    o.stop(t + 0.18);
    // …plus a bright splintery noise burst.
    const n = this.noise(ctx, 0.12);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400 + Math.random() * 600;
    f.Q.value = 0.9;
    n.connect(f);
    f.connect(this.env(ctx, vol, 0.7 * strength, 0.09));
    n.start(t);
  }

  /** A glancing blow: duller, shorter. */
  glance(vol = 1) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noise(ctx, 0.08);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    n.connect(f);
    f.connect(this.env(ctx, vol, 0.45, 0.07));
    n.start(t);
  }

  /** Stone or ore: a sharper clink. */
  clink(vol = 1) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1300 + Math.random() * 300, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.1);
    o.connect(this.env(ctx, vol, 0.35, 0.12));
    o.start(t);
    o.stop(t + 0.14);
    this.glance(vol * 0.8);
  }

  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;

  /**
   * Loose gravel shifting underfoot while you slide or scrabble at a slope:
   * one continuous, soft loop whose volume follows `level` (0..1) smoothly,
   * rather than a burst per step. Call every frame.
   */
  slide(level: number) {
    if (!this.slideGain && level <= 0) return;
    const ctx = this.ensure();
    if (!ctx) {
      if (this.ctx && this.slideGain) this.slideGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      return;
    }
    if (!this.slideGain) {
      // Three seconds of soft, low rumble with pebbles ticking at random
      // (never evenly spaced, so it doesn't beat like a drum).
      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < len; i++) {
        brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.995;
        d[i] = brown * 2.2;
      }
      for (let k = 0; k < 45; k++) {
        const at = Math.floor(Math.random() * (len - 2000));
        const amp = 0.08 + Math.random() * 0.2;
        const decay = 300 + Math.random() * 500;
        for (let j = 0; j < 1500; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / decay);
      }
      // Fade the loop's ends together so the seam doesn't click.
      const fade = 2000;
      for (let i = 0; i < fade; i++) { const w = i / fade; d[i] *= w; d[len - 1 - i] *= w; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.slideFilter = ctx.createBiquadFilter();
      this.slideFilter.type = 'lowpass';
      this.slideFilter.frequency.value = 1200;
      this.slideGain = ctx.createGain();
      this.slideGain.gain.value = 0;
      src.connect(this.slideFilter);
      this.slideFilter.connect(this.slideGain);
      this.slideGain.connect(this.master!);
      src.start();
    }
    const t = ctx.currentTime;
    this.slideGain.gain.setTargetAtTime(0.22 * Math.max(0, Math.min(1, level)), t, level > 0 ? 0.15 : 0.35);
    // Faster sliding sounds a little brighter.
    this.slideFilter!.frequency.setTargetAtTime(700 + 900 * level, t, 0.2);
  }

  /** The long groaning creak as a tree starts to topple. */
  creak(vol = 1) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(48, t + 1.3);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420;
    f.Q.value = 4;
    // Wobble the pitch so it sounds like straining fibres.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 9;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    o.connect(f);
    f.connect(this.env(ctx, vol, 0.5, 1.4, 0.25));
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.5);
    lfo.stop(t + 1.5);
    // Cracking fibres.
    for (let k = 0; k < 6; k++) setTimeout(() => this.glance(vol * 0.6), 120 + k * 140 + Math.random() * 80);
  }

  /** A tree hitting the ground. */
  crash(vol = 1) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noise(ctx, 1.4);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 1.2);
    n.connect(f);
    f.connect(this.env(ctx, vol, 1.0, 1.3, 0.01));
    n.start(t);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(60, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    o.connect(this.env(ctx, vol, 1.0, 0.6, 0.005));
    o.start(t);
    o.stop(t + 0.7);
    // Leaves and branches settling.
    const rustle = this.noise(ctx, 1.2);
    const hf = ctx.createBiquadFilter();
    hf.type = 'highpass';
    hf.frequency.value = 2500;
    rustle.connect(hf);
    hf.connect(this.env(ctx, vol, 0.25, 1.1, 0.15));
    rustle.start(t + 0.05);
  }
}

/** Volume falloff with distance (metres). */
export const distVol = (d: number) => Math.max(0, Math.min(1, 1.2 - d / 30));
