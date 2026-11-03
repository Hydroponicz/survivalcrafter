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
};
