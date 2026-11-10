// Little synthesized sounds for the hands-on work (scrapes, cuts, slips and a
// chime when it's done). One shared audio context; silent when sound is off.

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): AudioContext | null {
  try { if (localStorage.getItem('survivalcrafter.sound') === 'off') return null; } catch { /* storage blocked */ }
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** A burst of filtered noise: `freq` sets the colour, `q` how ringing it is. */
function noise(seconds: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass') {
  const a = audio();
  if (!a || !noiseBuf) return;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  const t = a.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + seconds + 0.02);
}

function tone(freq: number, seconds: number, vol: number, type: OscillatorType = 'sine', delay = 0) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = a.createGain();
  const t = a.currentTime + delay;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + seconds + 0.02);
}

export const sfx = {
  /** A knife paring wood: brighter the faster the stroke. */
  shave(speed: number) { noise(0.07, 2200 + speed * 2600, 1.4, 0.05); },
  /** A blade drawn through hide or plank. */
  slice(speed: number) { noise(0.06, 1400 + speed * 1400, 2.2, 0.04); },
  /** The blade bites too deep, or skids. */
  slip() { noise(0.16, 500, 0.9, 0.12, 'lowpass'); tone(110, 0.12, 0.05, 'triangle'); },
  /** A curl of shaving comes free. */
  curl() { tone(1800 + Math.random() * 600, 0.05, 0.015, 'sine'); },
  /** A stretch finished cleanly. */
  tick(step = 0) { tone(660 * Math.pow(1.06, step), 0.12, 0.04, 'triangle'); },
  /** The piece comes free: done. */
  done() { tone(523, 0.35, 0.05, 'triangle'); tone(659, 0.35, 0.05, 'triangle', 0.09); tone(784, 0.5, 0.05, 'triangle', 0.18); },
  /** An off-cut drops to the bench. */
  thud() { noise(0.18, 220, 0.8, 0.14, 'lowpass'); },
  /** A pick into stone: a sharp crack over a deep knock, heavier the harder the blow. */
  crack(k = 1) {
    noise(0.05, 3600 + Math.random() * 800, 1.2, 0.08 + 0.06 * k);
    noise(0.28, 150, 0.7, 0.1 + 0.1 * k, 'lowpass');
    tone(90 + Math.random() * 30, 0.12, 0.04 + 0.03 * k, 'triangle');
  },
  /** The pick glances off: a bright ring. */
  clink() { tone(2300 + Math.random() * 500, 0.14, 0.03, 'square'); noise(0.04, 5200, 2, 0.05); },
  /** A small stone landing. */
  patter() { noise(0.03, 2200 + Math.random() * 1800, 2, 0.02 + Math.random() * 0.02); },
  /** Something into the water: a float landing (small) or a fish thrashing (big). */
  splash(k = 1) { noise(0.12 + 0.2 * k, 900 + Math.random() * 500, 0.7, 0.05 + 0.08 * k); noise(0.06, 2600, 1.2, 0.03 * k); },
  /** The float plunging under: a bite! */
  plop() { tone(320, 0.08, 0.05, 'sine'); tone(180, 0.12, 0.05, 'sine', 0.04); noise(0.1, 700, 1, 0.06); },
  /** The reel's ratchet as you wind in. */
  reel() { noise(0.018, 4200 + Math.random() * 800, 3, 0.025); },
  /** The line parts. */
  snap() { tone(1400, 0.05, 0.06, 'square'); noise(0.08, 3000, 1.5, 0.08); tone(220, 0.2, 0.03, 'triangle', 0.03); },
  /** The whole stone gives way: a deep crunch and a rattle of rubble. */
  crumble() {
    noise(0.9, 120, 0.6, 0.3, 'lowpass');
    noise(0.12, 2800, 1, 0.12);
    for (let k = 0; k < 8; k++) setTimeout(() => noise(0.07, 900 + Math.random() * 2200, 1.4, 0.04 + Math.random() * 0.04), 80 + k * 70 + Math.random() * 60);
  },
};
