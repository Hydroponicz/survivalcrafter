import { mulberry32 } from './noise';

// Hydraulic erosion, droplet style. Rain falls at random, runs downhill,
// picks up soil where it speeds up and drops it where it slows down or
// reaches the sea. Thousands of drops carve gullies and valleys into the
// raw noise terrain and leave fans, valley floors and beaches of sediment,
// which is what makes a landscape look weathered rather than generated.

export interface ErosionParams {
  drops: number;
  maxSteps: number;
  /** How much a drop keeps its direction (0 = follows the slope exactly). */
  inertia: number;
  /** Sediment a drop can carry per unit of speed, water and drop in height. */
  capacity: number;
  minCapacity: number;
  erodeRate: number;
  depositRate: number;
  evaporation: number;
  gravity: number;
  /** Radius (cells) of soil a drop wears away around itself. */
  radius: number;
  /** Most a single step may dig at one point (metres): keeps channels from drilling down. */
  maxDig: number;
}

export const DEFAULT_EROSION: ErosionParams = {
  drops: 90000,
  maxSteps: 70,
  inertia: 0.08,
  capacity: 5,
  minCapacity: 0.01,
  erodeRate: 0.3,
  depositRate: 0.25,
  evaporation: 0.015,
  gravity: 4,
  radius: 3,
  maxDig: 0.6,
};

export interface ErosionResult {
  /** Net change per cell: positive where sediment settled, negative where it was worn away. */
  deposit: Float32Array;
  /** Water that ran through each cell: high along gullies and valley floors. */
  flow: Float32Array;
}

/**
 * Erode a square heightmap (`w`×`w`, row-major) in place. Drops that reach
 * `seaLevel` drop a little of what they carry, building up the shore.
 */
export function erode(H: Float32Array, w: number, seed: number, seaLevel: number, p: ErosionParams = DEFAULT_EROSION): ErosionResult {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const deposit = new Float32Array(w * w);
  const flow = new Float32Array(w * w);

  // Erosion brush: cells within the radius, weighted toward the centre.
  const bx: number[] = [], bz: number[] = [], bw: number[] = [];
  let sum = 0;
  const r = p.radius;
  for (let z = -r; z <= r; z++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, z);
      if (d > r) continue;
      const wt = r - d;
      bx.push(x); bz.push(z); bw.push(wt);
      sum += wt;
    }
  }
  for (let k = 0; k < bw.length; k++) bw[k] /= sum;

  // Height and gradient at a point, bilinear between the four surrounding cells.
  let gx = 0, gz = 0;
  const sample = (px: number, pz: number) => {
    const x = px | 0, z = pz | 0;
    const u = px - x, v = pz - z;
    const i = z * w + x;
    const a = H[i], b = H[i + 1], c = H[i + w], d = H[i + w + 1];
    gx = (b - a) * (1 - v) + (d - c) * v;
    gz = (c - a) * (1 - u) + (d - b) * u;
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  const drop = (i: number, u: number, v: number, amt: number) => {
    H[i] += amt * (1 - u) * (1 - v); deposit[i] += amt * (1 - u) * (1 - v);
    H[i + 1] += amt * u * (1 - v); deposit[i + 1] += amt * u * (1 - v);
    H[i + w] += amt * (1 - u) * v; deposit[i + w] += amt * (1 - u) * v;
    H[i + w + 1] += amt * u * v; deposit[i + w + 1] += amt * u * v;
  };

  const lo = r + 1, hi = w - r - 2;
  for (let n = 0; n < p.drops; n++) {
    let px = lo + rand() * (hi - lo), pz = lo + rand() * (hi - lo);
    let dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < p.maxSteps; step++) {
      const cx = px | 0, cz = pz | 0;
      const u = px - cx, v = pz - cz;
      const ci = cz * w + cx;
      const h = sample(px, pz);
      // At the sea most of the load washes away; a little builds the shore.
      if (h <= seaLevel) { drop(ci, u, v, sediment * 0.2); break; }
      dx = dx * p.inertia - gx * (1 - p.inertia);
      dz = dz * p.inertia - gz * (1 - p.inertia);
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) { const a = rand() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= len; dz /= len; }
      px += dx; pz += dz;
      if (px < lo || px >= hi || pz < lo || pz >= hi) break;
      flow[ci] += water;
      const dh = sample(px, pz) - h;
      const cap = Math.max(-dh * speed * water * p.capacity, p.minCapacity);
      if (sediment > cap || dh > 0) {
        // Uphill: fill the hollow behind; slowing down: drop the excess.
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * p.depositRate;
        sediment -= amt;
        drop(ci, u, v, amt);
      } else {
        const amt = Math.min((cap - sediment) * p.erodeRate, -dh, p.maxDig);
        for (let k = 0; k < bw.length; k++) {
          const j = (cz + bz[k]) * w + cx + bx[k];
          const take = amt * bw[k];
          H[j] -= take;
          deposit[j] -= take;
        }
        sediment += amt;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * p.gravity));
      water *= 1 - p.evaporation;
      if (water < 0.01) break;
    }
  }

  // A light blur takes the pockmarks out of single-drop pits and ridges.
  const tmp = H.slice();
  for (let z = 1; z < w - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      const i = z * w + x;
      const avg = (tmp[i - 1] + tmp[i + 1] + tmp[i - w] + tmp[i + w]) / 4;
      H[i] = tmp[i] * 0.75 + avg * 0.25;
    }
  }
  return { deposit, flow };
}

/**
 * Rockfall and soil creep: wherever ground stands steeper than `talus`
 * (height per cell, the same everywhere or per cell), some of it slides down to the lowest neighbour, so
 * slopes settle at a natural angle with scree gathered at their feet
 * instead of standing as sheer walls and needle peaks. Moved material is
 * added to `deposit` where it lands.
 */
export function slump(H: Float32Array, w: number, talus: number | Float32Array, iters: number, deposit?: Float32Array, rate = 0.45) {
  const delta = new Float32Array(w * w);
  const nb = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  const dist = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  for (let it = 0; it < iters; it++) {
    delta.fill(0);
    let moved = 0;
    for (let z = 1; z < w - 1; z++) {
      for (let x = 1; x < w - 1; x++) {
        const i = z * w + x;
        let best = -1, over = 0;
        for (let k = 0; k < 8; k++) {
          const e = (H[i] - H[i + nb[k]]) - (typeof talus === 'number' ? talus : talus[i]) * dist[k];
          if (e > over) { over = e; best = k; }
        }
        if (best < 0) continue;
        const amt = over * 0.5 * rate;
        if (amt > moved) moved = amt;
        delta[i] -= amt;
        delta[i + nb[best]] += amt;
      }
    }
    for (let i = 0; i < w * w; i++) {
      H[i] += delta[i];
      if (deposit && delta[i] > 0) deposit[i] += delta[i];
    }
    if (moved < 0.02) break; // settled
  }
}
