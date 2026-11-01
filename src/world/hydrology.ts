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
  /** Cells no lake may cover (a river's channel runs through them). */
  noLake?: Uint8Array;
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
    // Not right against the sea: there the ridge holding a lake back is too
    // thin to trust, and it would hang above the shore.
    let bySea = false;
    for (const c of cells) {
      const cx = c % w, cz = (c / w) | 0;
      for (let dz = -3; dz <= 3 && !bySea; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x >= 0 && z >= 0 && x < w && z < w && H[z * w + x] <= sea) { bySea = true; break; }
      }
      if (bySea) break;
    }
    const inRiver = o.noLake ? cells.some((c) => o.noLake![c]) : false;
    if (cells.length >= o.minLake && deepest > 1.5 && !bySea && !inRiver) for (const c of cells) kind[c] = 2;
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
 * ground within `reach` cells (a river cuts its way out there). Cells on
 * the map's edge whose water leaves it, the sea, and the bottoms of hollows
 * with no way out nearby drain nowhere (-1).
 */
export function localDrainage(H: Float32Array, w: number, sea: number, reach = 40): { recv: Int32Array; catchment: Float32Array } {
  const n = w * w;
  const recv = new Int32Array(n).fill(-1);
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
    let target = -1;
    while (heap.size) {
      const c = heap.pop();
      if (c !== p && H[c] < H[p]) { target = c; break; }
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
    if (target < 0) continue; // no way out nearby
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
  return { recv, catchment };
}

/** What `regionDrainage` works out. */
export interface RegionDrainage {
  /** The cell each cell drains into (-1: the sea, the grid's edge, or a hollow with no way out nearby). */
  recv: Int32Array;
  /** Cells' worth of land draining through each cell (plus any inflow). */
  catchment: Float32Array;
  /** The lake each cell lies in (-1 for none). */
  lake: Int32Array;
  /** Each lake's surface (the height where it spills over), its lowest cell, and the cell its water leaves by. */
  lakes: { level: number; pit: number; outlet: number }[];
}

/**
 * Drainage that, like `localDrainage`, depends only on the land near each
 * place (so overlapping grids agree), and also finds lakes: a hollow whose
 * water would stand deep enough over a wide enough area fills to the height
 * where it spills over, and runs out from there. Shallower hollows are cut
 * through instead (the stream runs on, in a little gorge).
 */
export function regionDrainage(H: Float32Array, w: number, sea: number, o: {
  /** How far (cells) to look for a hollow's way out. */
  reach: number;
  /** Least depth (metres) and area (cells) for a hollow to hold a lake. */
  minDepth: number; minCells: number;
  /** Water arriving from beyond the grid, per cell (cells' worth). */
  inflow?: Float32Array;
  /** Whether a hollow (its cells) may hold a lake at all; otherwise it's cut through. */
  lakeOk?: (cells: number[]) => boolean;
}): RegionDrainage {
  const n = w * w;
  const recv = new Int32Array(n).fill(-1);
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
  const lake = new Int32Array(n).fill(-1);
  const lakes: RegionDrainage['lakes'] = [];
  // Hollows, lowest first: a low one's lake takes in any shallower hollows
  // within it. Each is flooded from its bottom up until the water finds
  // lower ground beyond; the highest point passed on the way is where it
  // spills, and everything flooded before that point is its basin.
  pits.sort((a, b) => H[a] - H[b] || a - b);
  const R = o.reach, span = 2 * R + 1;
  const heap = new Heap(span * span);
  const from = new Map<number, number>();
  const order: number[] = [];
  for (const p of pits) {
    from.clear();
    order.length = 0;
    heap.size = 0;
    heap.push(H[p], p);
    from.set(p, -1);
    const px = p % w, pz = (p / w) | 0;
    let target = -1, level = H[p], spillAt = 0;
    while (heap.size) {
      const c = heap.pop();
      if (c !== p && (H[c] < H[p] || H[c] <= sea || (lake[c] >= 0 && lake[c] !== lake[p]))) { target = c; break; }
      if (H[c] > level) { level = H[c]; spillAt = order.length; }
      order.push(c);
      const cx = c % w, cz = (c / w) | 0;
      for (let k = 0; k < 8; k++) {
        const x = cx + NX[k], z = cz + NZ[k];
        if (x < 0 || z < 0 || x >= w || z >= w || Math.abs(x - px) > R || Math.abs(z - pz) > R) continue;
        const j = z * w + x;
        if (from.has(j)) continue;
        from.set(j, c);
        heap.push(H[j], j);
      }
    }
    if (target < 0) continue; // no way out nearby: it drains nowhere
    // Route the hollow out along the way the flood came.
    for (let c = target, prev = from.get(target)!; prev >= 0; c = prev, prev = from.get(prev)!) recv[prev] = c;
    if (lake[p] >= 0) continue; // already under a lower hollow's lake
    // A lake if deep and wide enough (not just a dip in a slope), and not
    // right by the sea, where the ridge holding it in is too thin to trust.
    const basin: number[] = [];
    for (let k = 0; k < spillAt; k++) if (H[order[k]] < level - 0.05) basin.push(order[k]);
    if (level - H[p] < o.minDepth || basin.length < o.minCells || level <= sea + 0.5) continue;
    let bySea = false;
    for (const c of basin) {
      const cx = c % w, cz = (c / w) | 0;
      for (let dz = -2; dz <= 2 && !bySea; dz++) for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x >= 0 && z >= 0 && x < w && z < w && H[z * w + x] <= sea) { bySea = true; break; }
      }
      if (bySea) break;
    }
    if (bySea || (o.lakeOk && !o.lakeOk(basin))) continue;
    const id = lakes.length;
    // It leaves by the first cell on its way out that isn't under it.
    let outlet = p;
    for (let c = p, step = 0; c >= 0 && step < span * span; c = recv[c], step++) {
      if (H[c] >= level - 0.05 && c !== p) { outlet = c; break; }
    }
    lakes.push({ level, pit: p, outlet });
    for (const c of basin) lake[c] = id;
  }
  // Add up what drains through each cell (upstream first).
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) if (recv[i] >= 0) indeg[recv[i]]++;
  const catchment = new Float32Array(n);
  for (let i = 0; i < n; i++) catchment[i] = 1 + (o.inflow ? o.inflow[i] : 0);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q], j = recv[c];
    if (j < 0) continue;
    catchment[j] += catchment[c];
    if (--indeg[j] === 0) queue.push(j);
  }
  for (let i = 0; i < n; i++) if (indeg[i] > 0) recv[i] = -1;
  return { recv, catchment, lake, lakes };
}
