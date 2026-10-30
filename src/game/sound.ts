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

  // ---------- ambience
  private amb: { wind: GainNode; windFilter: BiquadFilterNode; water: GainNode; out: GainNode } | null = null;
  private gustPhase = Math.random() * 100;
  private nextBird = 0;
  private nextCricket = 0;
  private nextFrog = 0;

  /** A looping buffer of soft noise (brown-ish), shared by the wind and water beds. */
  private loopNoise(ctx: AudioContext, seconds: number, brown: boolean): AudioBufferSourceNode {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = brown ? (b + w * 0.02) * 0.996 : w;
      d[i] = brown ? b * 3 : w;
    }
    const fade = 2000;
    for (let i = 0; i < fade; i++) { const k = i / fade; d[i] *= k; d[len - 1 - i] *= k; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  /**
   * The world's background sound, called every frame with how much of each
   * there should be (0..1): wind, running water, birdsong, crickets, frogs.
   */
  ambience(lv: { wind: number; water: number; birds: number; crickets: number; frogs: number }, dt: number) {
    const ctx = this.ensure();
    if (!ctx) {
      if (this.ctx && this.amb) this.amb.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      return;
    }
    if (!this.amb) {
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(this.master!);
      const windSrc = this.loopNoise(ctx, 4, true);
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 500;
      const wind = ctx.createGain();
      wind.gain.value = 0;
      windSrc.connect(windFilter); windFilter.connect(wind); wind.connect(out);
      windSrc.start();
      // Babbling water: two bands of noise, gently fluttering.
      const waterSrc = this.loopNoise(ctx, 3, false);
      const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = 900; b1.Q.value = 0.8;
      const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = 2600; b2.Q.value = 1.2;
      const water = ctx.createGain();
      water.gain.value = 0;
      const flutter = ctx.createOscillator(); flutter.frequency.value = 6.3;
      const fg = ctx.createGain(); fg.gain.value = 0.25;
      flutter.connect(fg);
      const wmix = ctx.createGain(); wmix.gain.value = 0.7;
      fg.connect(wmix.gain);
      waterSrc.connect(b1); waterSrc.connect(b2); b1.connect(wmix); b2.connect(wmix); wmix.connect(water); water.connect(out);
      waterSrc.start(); flutter.start();
      this.amb = { wind, windFilter, water, out };
    }
    const t = ctx.currentTime;
    const a = this.amb;
    a.out.gain.setTargetAtTime(0.9, t, 0.5);
    // Wind comes in gusts: two slow waves.
    this.gustPhase += dt;
    const gust = 0.55 + 0.3 * Math.sin(this.gustPhase * 0.31) + 0.15 * Math.sin(this.gustPhase * 0.83 + 1.7);
    a.wind.gain.setTargetAtTime(0.35 * lv.wind * gust, t, 0.4);
    a.windFilter.frequency.setTargetAtTime(280 + 700 * lv.wind * gust, t, 0.4);
    a.water.gain.setTargetAtTime(0.16 * lv.water, t, 0.5);

    const now = performance.now() / 1000;
    if (lv.birds > 0.02 && now > this.nextBird) {
      this.bird(lv.birds);
      this.nextBird = now + (1.2 + Math.random() * 4) / (0.3 + lv.birds);
    }
    if (lv.crickets > 0.02 && now > this.nextCricket) {
      this.cricket(lv.crickets);
      this.nextCricket = now + 0.5 + Math.random() * 0.9;
    }
    if (lv.frogs > 0.02 && now > this.nextFrog) {
      this.frog(lv.frogs);
      this.nextFrog = now + (1.5 + Math.random() * 5) / (0.4 + lv.frogs);
    }
  }

  /** Somewhere off to one side. */
  private panned(ctx: AudioContext, gain: number): GainNode {
    const g = ctx.createGain();
    g.gain.value = gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    g.connect(pan);
    pan.connect(this.amb?.out ?? this.master!);
    return g;
  }

  /** A songbird: a few whistled notes, a trill or a falling call. */
  private bird(level: number) {
    const ctx = this.ctx!;
    const out = this.panned(ctx, 0.05 * level * (0.4 + Math.random() * 0.6));
    const t0 = ctx.currentTime + 0.02;
    const kind = Math.floor(Math.random() * 3);
    const base = 2400 + Math.random() * 2200;
    const notes = kind === 1 ? 6 + Math.floor(Math.random() * 6) : 2 + Math.floor(Math.random() * 4);
    let t = t0;
    for (let n = 0; n < notes; n++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      const len = kind === 1 ? 0.045 : 0.09 + Math.random() * 0.12;
      const f = kind === 2 ? base * (1.25 - n * 0.08) : base * (0.85 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (kind === 0 ? 1.25 : 0.85), t + len);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + len + 0.02);
      t += len + (kind === 1 ? 0.015 : 0.04 + Math.random() * 0.08);
    }
  }

  /** A cricket's pulsing chirp. */
  private cricket(level: number) {
    const ctx = this.ctx!;
    const out = this.panned(ctx, 0.018 * level);
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.frequency.value = 4300 + Math.random() * 600;
    const g = ctx.createGain();
    g.gain.value = 0;
    for (let p = 0; p < 3; p++) {
      const s = t + p * 0.07;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(1, s + 0.01);
      g.gain.linearRampToValueAtTime(0, s + 0.045);
    }
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.25);
  }

  /** A frog's croak: a low, buzzy pulse train. */
  private frog(level: number) {
    const ctx = this.ctx!;
    const out = this.panned(ctx, 0.06 * level);
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140 + Math.random() * 90, t);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pulses = 3 + Math.floor(Math.random() * 4);
    for (let p = 0; p < pulses; p++) {
      const s = t + p * 0.06;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(1, s + 0.012);
      g.gain.linearRampToValueAtTime(0, s + 0.05);
    }
    o.connect(f); f.connect(g); g.connect(out);
    o.start(t); o.stop(t + pulses * 0.06 + 0.1);
  }
}

/** Volume falloff with distance (metres). */
export const distVol = (d: number) => Math.max(0, Math.min(1, 1.2 - d / 30));
