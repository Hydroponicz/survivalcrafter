// Rivers and lakes from the heightmap. Every column drains somewhere: a
// priority flood from the coast finds where each one sends its water and
// fills basins up to their spill point (those are lakes). Adding up the rain
// flowing through each column gives its catchment; where that's big enough
// a stream forms, carving a channel that deepens and widens downstream.

/** Catchment (in 1 m² columns of rain) where a stream starts. */
const STREAM_AT = 420;
/** Smallest basin, in columns, that holds a lake rather than a puddle. */
const MIN_LAKE = 40;

export interface Hydrology {
  /** Water surface height per column (NaN: dry). Fresh water only; the sea is separate. */
  water: Float32Array;
  /** 0 dry, 1 river channel, 2 lake. */
  kind: Uint8Array;
  /** Within a couple of metres of fresh water (banks and shores). */
  bank: Uint8Array;
  /** Rain that drains through each column. */
  catchment: Float32Array;
}

/** Binary min-heap of cell indices keyed by height. */
class Heap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  constructor(cap: number) { this.keys = new Float64Array(cap); this.vals = new Int32Array(cap); }
  push(k: number, v: number) {
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= k) break;
      this.keys[i] = this.keys[p]; this.vals[i] = this.vals[p]; i = p;
    }
    this.keys[i] = k; this.vals[i] = v;
  }
  pop(): number {
    const top = this.vals[0];
    const k = this.keys[--this.size], v = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= k) break;
      this.keys[i] = this.keys[c]; this.vals[i] = this.vals[c]; i = c;
    }
    this.keys[i] = k; this.vals[i] = v;
    return top;
  }
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Work out drainage on a `w`×`w` heightmap and carve rivers into it (in
 * place). `rain` scales how much rain falls on each column (1 if omitted).
 */
export function hydrology(H: Float32Array, w: number, sea: number, rain?: Float32Array): Hydrology {
  const n = w * w;
  const F = new Float32Array(n); // filled height: where water would stand
  const recv = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  const closed = new Uint8Array(n);
  const heap = new Heap(n);
  // Water leaves the land at the coast and the map's edge.
  for (let i = 0; i < n; i++) {
    const x = i % w, z = (i / w) | 0;
    if (H[i] <= sea || x === 0 || z === 0 || x === w - 1 || z === w - 1) {
      F[i] = H[i]; closed[i] = 1; heap.push(F[i], i);
    }
  }
  let count = 0;
  while (heap.size) {
    const c = heap.pop();
    order[count++] = c;
    const cx = c % w, cz = (c / w) | 0;
    for (let k = 0; k < 8; k++) {
      const x = cx + NX[k], z = cz + NZ[k];
      if (x < 0 || z < 0 || x >= w || z >= w) continue;
      const j = z * w + x;
      if (closed[j]) continue;
      closed[j] = 1;
      // A tiny rise keeps water moving across flats and lake beds.
      F[j] = Math.max(H[j], F[c] + 1e-4);
      recv[j] = c;
      heap.push(F[j], j);
    }
  }

  // Catchment: everything upstream drains through you.
  const catchment = new Float32Array(n);
  for (let i = 0; i < n; i++) catchment[i] = rain ? rain[i] : 1;
  for (let k = count - 1; k >= 0; k--) {
    const c = order[k];
    if (recv[c] >= 0) catchment[recv[c]] += catchment[c];
  }

  // Lakes: basins deep and wide enough, found as connected flooded areas.
  const kind = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || F[i] - H[i] < 0.2 || F[i] <= sea + 0.2) continue;
    const cells: number[] = [];
    let deepest = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      deepest = Math.max(deepest, F[c] - H[c]);
      const cx = c % w, cz = (c / w) | 0;
      for (let k = 0; k < 4; k++) {
        const x = cx + NX[k], z = cz + NZ[k];
        if (x < 0 || z < 0 || x >= w || z >= w) continue;
        const j = z * w + x;
        if (!seen[j] && F[j] - H[j] >= 0.2 && F[j] > sea + 0.2) { seen[j] = 1; stack.push(j); }
      }
    }
    if (cells.length >= MIN_LAKE && deepest > 0.8) for (const c of cells) kind[c] = 2;
  }

  // Water surfaces, from the coast upstream so a river never runs uphill.
  const water = new Float32Array(n).fill(NaN);
  const S = new Float32Array(n).fill(NaN);
  for (let k = 0; k < count; k++) {
    const c = order[k];
    if (kind[c] === 2) { S[c] = F[c]; continue; }
    if (catchment[c] < STREAM_AT || H[c] <= sea) continue;
    const down = recv[c] >= 0 && !Number.isNaN(S[recv[c]]) ? S[recv[c]] : sea;
    S[c] = Math.max(down, F[c] - 0.35);
    kind[c] = 1;
  }

  // Carve channels: banks first (raised a touch so water never floats above
  // the ground beside it), then the beds, which always win.
  const strength = (c: number) => Math.min(4, Math.log2(catchment[c] / STREAM_AT));
  const nearest = new Float32Array(n).fill(Infinity);
  const visit = (fn: (c: number, j: number, d: number, radius: number, depth: number) => void) => {
    for (let c = 0; c < n; c++) {
      if (kind[c] !== 1) continue;
      const s = strength(c);
      const radius = 0.7 + 0.5 * s, depth = 0.45 + 0.3 * s;
      const reach = Math.ceil(radius + 1.5);
      const cx = c % w, cz = (c / w) | 0;
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const x = cx + dx, z = cz + dz;
          if (x < 1 || z < 1 || x >= w - 1 || z >= w - 1) continue;
          const d = Math.hypot(dx, dz);
          if (d <= radius + 1.5) fn(c, z * w + x, d, radius, depth);
        }
      }
    }
  };
  visit((c, j, d, radius) => {
    if (d >= radius && d <= radius + 1 && kind[j] !== 2) H[j] = Math.max(H[j], S[c] + 0.12);
  });
  visit((c, j, d, radius, depth) => {
    if (kind[j] === 2) return;
    if (d <= radius) {
      const t = 1 - (d / radius) * (d / radius);
      H[j] = Math.min(H[j], S[c] + 0.12 - (depth + 0.12) * t);
      if (d < nearest[j] && d < radius * 0.95) { nearest[j] = d; water[j] = S[c]; }
    } else {
      H[j] = Math.min(H[j], S[c] + 0.12 + (d - radius) * 0.7);
    }
  });
  // Lakes silt up while the land erodes; scoop out a bowl that deepens away
  // from the shore so they're deep enough to swim in.
  const shore = new Float32Array(n).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (kind[i] !== 2) continue;
    const cx = i % w, cz = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const x = cx + NX[k], z = cz + NZ[k];
      if (x >= 0 && z >= 0 && x < w && z < w && kind[z * w + x] !== 2) { shore[i] = 1; queue.push(i); break; }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const cx = c % w, cz = (c / w) | 0;
    for (let k = 0; k < 4; k++) {
      const x = cx + NX[k], z = cz + NZ[k];
      if (x < 0 || z < 0 || x >= w || z >= w) continue;
      const j = z * w + x;
      if (kind[j] === 2 && shore[j] > shore[c] + 1) { shore[j] = shore[c] + 1; queue.push(j); }
    }
  }
  for (let i = 0; i < n; i++) {
    if (kind[i] !== 2) continue;
    water[i] = F[i];
    H[i] = Math.min(H[i], F[i] - Math.min(4, 0.3 + 0.5 * shore[i]));
  }

  // Banks and shores.
  const bank = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (Number.isNaN(water[c])) continue;
    const cx = c % w, cz = (c / w) | 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x >= 0 && z >= 0 && x < w && z < w) bank[z * w + x] = 1;
    }
  }
  return { water, kind, bank, catchment };
}
