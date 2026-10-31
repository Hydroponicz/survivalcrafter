// Drainage on the world map. Every cell drains somewhere: a priority flood
// from the coast finds where each one sends its water and fills basins up to
// their spill point (those are lakes). Adding up the rain flowing through each
// cell gives its catchment; where that's big enough a stream runs. The fine
// channels are carved later, wherever terrain is generated (see worldgen.ts).

export interface Drainage {
  /** Filled height: where standing water would rise to. */
  F: Float32Array;
  /** The cell each cell drains into (-1 at the coast and map edge). */
  recv: Int32Array;
  /** Rain that drains through each cell (in cells' worth of average rain). */
  catchment: Float32Array;
  /** 0 dry, 1 river, 2 lake. */
  kind: Uint8Array;
  /** Water surface of rivers and lakes (NaN elsewhere). */
  S: Float32Array;
}

export interface DrainageOptions {
  /** Metres per cell. */
  cell: number;
  /** Catchment (cells) where a stream starts. */
  streamAt: number;
  /** Smallest basin (cells) that holds a lake. */
  minLake: number;
  /** Deepest a lake bed is scooped out (metres). */
  lakeDepth: number;
  /** Water arriving from beyond the map's edge, per cell (in cells' worth of rain). */
  inflow?: Float32Array;
}

/** Binary min-heap of cell indices keyed by height. */
export class Heap {
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
 * Work out drainage on a `w`×`w` heightmap. Lake beds are scooped out of `H`
 * in place (basins silt up during erosion). `rain` scales the rain per cell.
 */
export function drainage(H: Float32Array, w: number, sea: number, rain: Float32Array | undefined, o: DrainageOptions): Drainage {
  const n = w * w;
  const F = new Float32Array(n);
  const recv = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  const closed = new Uint8Array(n);
  const heap = new Heap(n);
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
      F[j] = Math.max(H[j], F[c] + 1e-3);
      recv[j] = c;
      heap.push(F[j], j);
    }
  }

  const catchment = new Float32Array(n);
  for (let i = 0; i < n; i++) catchment[i] = (rain ? rain[i] : 1) + (o.inflow ? o.inflow[i] : 0);
  for (let k = count - 1; k >= 0; k--) {
    const c = order[k];
    if (recv[c] >= 0) catchment[recv[c]] += catchment[c];
  }

  // Lakes: connected flooded basins, wide and deep enough.
  const kind = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const minDepth = 0.6;
  for (let i = 0; i < n; i++) {
    if (seen[i] || F[i] - H[i] < minDepth || F[i] <= sea + 0.3) continue;
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
        if (!seen[j] && F[j] - H[j] >= minDepth && F[j] > sea + 0.3) { seen[j] = 1; stack.push(j); }
      }
    }
    if (cells.length >= o.minLake && deepest > 1.5) for (const c of cells) kind[c] = 2;
  }

  // Scoop lake beds into a bowl that deepens away from the shore.
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

  const S = new Float32Array(n).fill(NaN);
  for (let k = 0; k < count; k++) {
    const c = order[k];
    if (kind[c] === 2) {
      S[c] = F[c];
      H[c] = Math.min(H[c], F[c] - Math.min(o.lakeDepth, 0.8 + 0.45 * shore[c] * o.cell));
      continue;
    }
    if (catchment[c] < o.streamAt || H[c] <= sea) continue;
    // Follow the valley floor (through shallow dips too, rather than floating
    // at the level they'd fill to).
    S[c] = Math.max(sea, H[c] - 0.5);
    kind[c] = 1;
  }
  return { F, recv, catchment, kind, S };
}

/**
 * Drainage worked out from the lie of the land nearby only, so any map that
 * covers a place agrees on where its water goes (unlike the flood above,
 * whose routes can depend on the map's edges). Water runs down the steepest
 * slope; from the bottom of a hollow it takes the lowest way out to lower
 * ground within `reach` cells. A hollow between `lakeDepth` and
 * `maxLakeDepth` deep (and no bigger than `maxLakeCells`) fills into a lake up
 * to its way out (`level`, NaN elsewhere); a river cuts its way through any
 * other. Cells on the map's edge whose water leaves it, and the
 * sea, drain nowhere (-1). A closed basin keeps its water as a small lake.
 */
export function localDrainage(H: Float32Array, w: number, sea: number, reach = 40, lakeDepth = 3, maxLakeDepth = 14, maxLakeCells = 260):
  { recv: Int32Array; catchment: Float32Array; level: Float32Array } {
  const n = w * w;
  const recv = new Int32Array(n).fill(-1);
  const level = new Float32Array(n).fill(NaN);
  const pits: number[] = [];
  for (let i = 0; i < n; i++) {
    if (H[i] <= sea) continue;
    const cx = i % w, cz = (i / w) | 0;
    let best = -1, drop = 0, edge = false;
    for (let k = 0; k < 8; k++) {
      const x = cx + NX[k], z = cz + NZ[k];
      if (x < 0 || z < 0 || x >= w || z >= w) { edge = true; continue; }
      const j = z * w + x;
      const s = (H[i] - H[j]) / (k < 4 ? 1 : Math.SQRT2);
      if (s > drop) { drop = s; best = j; }
    }
    if (best >= 0) recv[i] = best;
    else if (!edge) pits.push(i);
  }
  // Hollows, highest first: a lower one's way out takes precedence where they cross.
  pits.sort((a, b) => H[b] - H[a] || a - b);
  const seen = new Map<number, number>();
  for (const p of pits) {
    seen.clear();
    const heap = new Heap((2 * reach + 1) ** 2);
    heap.push(H[p], p);
    seen.set(p, -1);
    const px = p % w, pz = (p / w) | 0;
    let target = -1, spill = H[p];
    const basin: number[] = [];
    while (heap.size) {
      const c = heap.pop();
      if (c !== p && H[c] < H[p]) { target = c; break; }
      spill = Math.max(spill, H[c]);
      basin.push(c);
      const cx = c % w, cz = (c / w) | 0;
      for (let k = 0; k < 8; k++) {
        const x = cx + NX[k], z = cz + NZ[k];
        if (x < 0 || z < 0 || x >= w || z >= w || Math.abs(x - px) > reach || Math.abs(z - pz) > reach) continue;
        const j = z * w + x;
        if (seen.has(j)) continue;
        seen.set(j, c);
        heap.push(H[j], j);
      }
    }
    if (target < 0) {
      // A closed basin: its water stays, as a small lake in the bottom.
      for (const c of basin) if (H[c] < H[p] + lakeDepth) level[c] = Math.max(level[c] || -Infinity, H[p] + lakeDepth);
      continue;
    }
    const depth = spill - H[p];
    if (depth >= lakeDepth && depth <= maxLakeDepth) {
      const under = basin.filter((c) => H[c] < spill);
      if (under.length <= maxLakeCells) for (const c of under) level[c] = Math.max(level[c] || -Infinity, spill);
    }
    // Route the hollow out along the way the search came.
    for (let c = target, prev = seen.get(target)!; prev >= 0; c = prev, prev = seen.get(prev)!) recv[prev] = c;
  }
  // Add up what drains through each cell (upstream first).
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) if (recv[i] >= 0) indeg[recv[i]]++;
  const catchment = new Float32Array(n).fill(1);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q], j = recv[c];
    if (j < 0) continue;
    catchment[j] += catchment[c];
    if (--indeg[j] === 0) queue.push(j);
  }
  // Anything left in a loop (it shouldn't happen) drains nowhere.
  for (let i = 0; i < n; i++) if (indeg[i] > 0) recv[i] = -1;
  return { recv, catchment, level };
}
