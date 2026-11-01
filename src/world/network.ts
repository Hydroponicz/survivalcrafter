import { Simplex } from './noise';
import { localDrainage, regionDrainage } from './hydrology';
import type { BaseLand } from './worldgen';

// All the land's running and standing water, as one network: every creek,
// river and lake in a region is traced together on one grid fixed to the
// world, from the land before weathering. Every map tile reads the same
// network (and shapes its ground to fit it), so water runs on unbroken from
// tile to tile, and a creek always meets the river or lake it runs into at
// that water's own level.
//
// Water is routed by the lie of the land nearby only (down the steepest
// slope, and out of hollows by the lowest way), so neighbouring regions,
// whose grids overlap, trace the same courses where they meet.

/** Metres between the network's grid points. */
export const NET_CELL = 32;
/** Regions the network is worked out over (metres square), each with this margin of land around it. */
export const NET_REGION = 8192;
const MARGIN = 2048;
const NW = (NET_REGION + 2 * MARGIN) / NET_CELL + 1;
/** Land further off, which can feed the region's rivers, is drained on a coarser grid over a wider margin. */
const COARSE = 64, COARSE_MARGIN = 6144, CN = (NET_REGION + 2 * COARSE_MARGIN) / COARSE + 1;
const SEA = 0;

/** Catchment area (km²) where a stream starts on the flat; in steep hills it needs only this share of that. */
const STREAM_KM2 = 0.15, HILL_STREAM = 0.3;
/** Least ground (km²) above a spring: streams are traced up their valleys as far as this. */
const SPRING_KM2 = 0.012;

/** Half-width (metres) of a stream or river draining this much land: narrow at its source, then wider as the square root of its catchment. */
export const riverHalfWidth = (km2: number) => Math.min(60, Math.max(1.3, 1.0 + 10 * Math.max(0, Math.sqrt(km2) - Math.sqrt(STREAM_KM2 * HILL_STREAM))));
/** Depth (metres) of a stream or river draining this much land: a creek is ankle deep, a big river a few metres. */
export const riverDepth = (km2: number) => Math.min(5, 0.4 + 1.1 * Math.sqrt(km2));

/** One region's water. */
export interface RegionNet {
  /** Stretches of stream starting in the region: ax, az, bx, bz, surface at a and b, half-width, depth (8 numbers each). */
  reaches: Float32Array;
  /** Lakes whose deepest point is in the region: grid point (see latticeKey) → [surface, bed height]. */
  lakes: Map<number, [number, number]>;
}

/** A key for a point of the network's grid (world grid indices). */
export const latticeKey = (ix: number, iz: number) => (ix + 1_000_000) * 4_000_000 + (iz + 1_000_000);

/** The land the water runs over: the raw land, with its lake hollows (the same as every tile digs). */
export function waterLand(base: BaseLand, x: number, z: number): number {
  const h = base.height(x, z);
  return h - base.lakeDip(x, z, h);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

const cache = new Map<string, RegionNet>();

/** The water network of region (rx, rz) (made once, then kept). */
export function regionNet(base: BaseLand, seed: number, rx: number, rz: number): RegionNet {
  const key = `${seed}:${rx},${rz}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const net = makeNet(base, seed, rx, rz);
  cache.set(key, net);
  if (cache.size > 6) cache.delete(cache.keys().next().value!);
  return net;
}

/**
 * Water running into the grid from the land around it: the coarse drainage
 * of the wider margin, added where each of its streams crosses in (at the
 * lowest point there, the valley floor).
 */
function inflowFrom(base: BaseLand, rx: number, rz: number, H: Float32Array, gx0: number, gz0: number): Float32Array {
  const w = NW, G = NET_CELL;
  const cx0 = rx * NET_REGION - COARSE_MARGIN, cz0 = rz * NET_REGION - COARSE_MARGIN;
  const Hc = new Float32Array(CN * CN);
  for (let k = 0; k < Hc.length; k++) Hc[k] = base.height(cx0 + (k % CN) * COARSE, cz0 + Math.floor(k / CN) * COARSE);
  const dr = localDrainage(Hc, CN, SEA);
  const inflow = new Float32Array(w * w);
  const span = (w - 1) * G;
  const inside = (x: number, z: number) => x >= gx0 && z >= gz0 && x <= gx0 + span && z <= gz0 + span;
  const scale = (COARSE * COARSE) / (G * G);
  for (let c = 0; c < CN * CN; c++) {
    const r = dr.recv[c];
    if (r < 0) continue;
    const x = cx0 + (c % CN) * COARSE, z = cz0 + Math.floor(c / CN) * COARSE;
    const x2 = cx0 + (r % CN) * COARSE, z2 = cz0 + Math.floor(r / CN) * COARSE;
    if (inside(x, z) || !inside(x2, z2)) continue;
    const ix = Math.round((x2 - gx0) / G), iz = Math.round((z2 - gz0) / G);
    let bi = -1, bh = Infinity;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const px = Math.max(0, Math.min(w - 1, ix + dx)), pz = Math.max(0, Math.min(w - 1, iz + dz));
      if (H[pz * w + px] < bh) { bh = H[pz * w + px]; bi = pz * w + px; }
    }
    inflow[bi] += dr.catchment[c] * scale;
  }
  return inflow;
}

function makeNet(base: BaseLand, seed: number, rx: number, rz: number): RegionNet {
  const w = NW, G = NET_CELL, n = w * w;
  const gx0 = rx * NET_REGION - MARGIN, gz0 = rz * NET_REGION - MARGIN;
  const H = new Float32Array(n);
  // Where the land is a lake hollow (see BaseLand.basin): only those hold
  // lakes. Other hollows in the raw land would have silted up or been cut
  // through by their streams long ago, so the water runs on through them.
  const hollow = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const x = gx0 + (k % w) * G, z = gz0 + Math.floor(k / w) * G, h = base.height(x, z), dip = base.lakeDip(x, z, h);
    H[k] = h - dip;
    hollow[k] = dip > 0.5 ? 1 : 0;
  }
  const dr = regionDrainage(H, w, SEA, {
    reach: 40, minDepth: 1.5, minCells: 6, inflow: inflowFrom(base, rx, rz, H, gx0, gz0),
    lakeOk: (cells) => cells.reduce((a, c) => a + hollow[c], 0) >= cells.length * 0.5,
  });
  const { recv, catchment, lake, lakes } = dr;
  const km2 = (c: number) => c * G * G * 1e-6;
  const isLand = (i: number) => H[i] > SEA && lake[i] < 0;
  const slopeAt = (i: number) => {
    const x = i % w, z = (i / w) | 0;
    if (x < 1 || z < 1 || x > w - 2 || z > w - 2) return 0;
    return Math.hypot(H[i + 1] - H[i - 1], H[i + w] - H[i - w]) / (2 * G);
  };

  // Which cells carry a stream. In the hills a stream starts from much less
  // ground than on the flat (rain runs off steep slopes and gathers fast);
  // once running it carries on down to wherever it goes.
  const flowing = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (flowing[i] || !isLand(i)) continue;
    const need = STREAM_KM2 * (1 - (1 - HILL_STREAM) * smooth(0.05, 0.3, slopeAt(i)));
    if (km2(catchment[i]) < need) continue;
    for (let c = i; c >= 0 && isLand(c) && !flowing[c]; c = recv[c]) flowing[c] = 1;
  }
  // Water leaving a lake runs on from its outlet, whatever the outlet's own catchment.
  for (const L of lakes) for (let c = L.outlet; c >= 0 && isLand(c) && !flowing[c]; c = recv[c]) flowing[c] = 1;
  // Every stream rises at a spring up its valley: follow it uphill, along the
  // biggest of the hollows feeding it, as long as the land keeps rising and
  // there's enough ground above to feed one.
  const donor = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const j = recv[i];
    if (j >= 0 && isLand(i) && (donor[j] < 0 || catchment[i] > catchment[donor[j]])) donor[j] = i;
  }
  const fed = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (flowing[i] && recv[i] >= 0) fed[recv[i]] = 1;
  for (let i = 0; i < n; i++) {
    if (!flowing[i] || fed[i]) continue;
    for (let c = donor[i], prev = i, step = 0; c >= 0 && step < 60; prev = c, c = donor[c], step++) {
      if (H[c] < H[prev] - 0.05 || km2(catchment[c]) < SPRING_KM2 || flowing[c]) break;
      flowing[c] = 1;
    }
  }
  const streams: number[] = [];
  for (let i = 0; i < n; i++) if (flowing[i]) streams.push(i);
  streams.sort((a, b) => catchment[a] - catchment[b] || a - b); // upstream first

  // Water surfaces. Running down, each stream sits a little below the land
  // (more for a bigger one) but never rises: where the land rises in its
  // way it cuts down through it. Then, running up, none sits below the
  // water it runs into: a lake's surface, the river it joins, the sea.
  const S = new Float32Array(n).fill(NaN), cap = new Float32Array(n).fill(Infinity);
  for (const L of lakes) cap[L.outlet] = Math.min(cap[L.outlet], L.level);
  const width = (i: number) => riverHalfWidth(km2(catchment[i]));
  for (const i of streams) {
    const sink = Math.min(3, 0.8 + 0.12 * width(i));
    S[i] = Math.max(SEA, Math.min(H[i] - sink, cap[i]));
    const j = recv[i];
    if (j >= 0 && flowing[j]) cap[j] = Math.min(cap[j], S[i]);
  }
  const below = (j: number) => j < 0 ? -Infinity : flowing[j] ? S[j] : lake[j] >= 0 ? lakes[lake[j]].level : H[j] <= SEA ? SEA : -Infinity;
  for (let k = streams.length - 1; k >= 0; k--) {
    const i = streams[k];
    S[i] = Math.max(S[i], below(recv[i]));
  }

  // Courses: from grid point to grid point, eased toward the points above and
  // below so they curve rather than step, wandering a little (rivers more).
  const up = new Int32Array(n).fill(-1);
  for (const i of streams) {
    const j = recv[i];
    if (j >= 0 && flowing[j] && (up[j] < 0 || catchment[i] > catchment[up[j]])) up[j] = i;
  }
  const PX = new Float32Array(n), PZ = new Float32Array(n);
  for (let i = 0; i < n; i++) { PX[i] = gx0 + (i % w) * G; PZ[i] = gz0 + Math.floor(i / w) * G; }
  for (let it = 0; it < 3; it++) {
    const qx = PX.slice(), qz = PZ.slice();
    for (const i of streams) {
      const j = recv[i], u = up[i];
      if (u < 0 || j < 0 || !flowing[j]) continue;
      PX[i] = 0.5 * qx[i] + 0.25 * (qx[u] + qx[j]);
      PZ[i] = 0.5 * qz[i] + 0.25 * (qz[u] + qz[j]);
    }
  }
  const meander = new Simplex(seed + 77), wiggle = new Simplex(seed + 78);
  {
    const qx = PX.slice(), qz = PZ.slice();
    for (const i of streams) {
      const j = recv[i], u = up[i];
      if (u < 0 || j < 0 || !flowing[j]) continue;
      const x = gx0 + (i % w) * G, z = gz0 + Math.floor(i / w) * G;
      const dx = qx[j] - qx[u], dz = qz[j] - qz[u], l = Math.hypot(dx, dz) || 1;
      const off = meander.fbm(x / 420, z / 420, 2) * 30 * Math.min(1, width(i) / 6) + wiggle.fbm(x / 110, z / 110, 2) * 7;
      PX[i] += (-dz / l) * off; PZ[i] += (dx / l) * off;
    }
  }
  // How far each point lies below its stream's spring (a stream fed by others has none).
  const along = new Float32Array(n).fill(Infinity);
  const outlets = new Set(lakes.map((L) => L.outlet));
  for (const i of streams) if (up[i] < 0 && !outlets.has(i)) along[i] = 0;
  for (const i of streams) {
    const j = recv[i];
    if (j >= 0 && flowing[j]) along[j] = Math.min(along[j], along[i] + Math.hypot(PX[j] - PX[i], PZ[j] - PZ[i]));
  }

  const x0 = rx * NET_REGION, z0 = rz * NET_REGION;
  const mine = (x: number, z: number) => x >= x0 && x < x0 + NET_REGION && z >= z0 && z < z0 + NET_REGION;
  const out: number[] = [];
  /**
   * A stretch from (ax, az) to (bx, bz), curved through the points before
   * and after it (Catmull-Rom), in pieces about 8 m long.
   */
  const lay = (p0x: number, p0z: number, ax: number, az: number, bx: number, bz: number, p3x: number, p3z: number,
    sa: number, sb: number, r: number, dep: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const m = Math.max(1, Math.round(len / 8));
    const at = (t: number): [number, number] => {
      const t2 = t * t, t3 = t2 * t;
      return [
        0.5 * (2 * ax + (bx - p0x) * t + (2 * p0x - 5 * ax + 4 * bx - p3x) * t2 + (3 * ax - p0x - 3 * bx + p3x) * t3),
        0.5 * (2 * az + (bz - p0z) * t + (2 * p0z - 5 * az + 4 * bz - p3z) * t2 + (3 * az - p0z - 3 * bz + p3z) * t3),
      ];
    };
    let [px, pz] = [ax, az];
    for (let k = 1; k <= m; k++) {
      const [qx, qz] = k === m ? [bx, bz] : at(k / m);
      if (mine(px, pz)) out.push(px, pz, qx, qz, sa + (sb - sa) * ((k - 1) / m), sa + (sb - sa) * (k / m), r, dep);
      px = qx; pz = qz;
    }
  };
  const gp = (i: number): [number, number] => [gx0 + (i % w) * G, gz0 + Math.floor(i / w) * G];
  for (const i of streams) {
    const j = recv[i];
    if (j < 0) continue;
    const a = km2(catchment[i]);
    // A spring seeps out of the ground narrow and shallow, rather than starting at full size.
    const sp = Math.min(1, along[i] / 60);
    const r = width(i) * (0.45 + 0.55 * sp), dep = riverDepth(a) * (0.25 + 0.75 * sp);
    const into = flowing[j];
    // Into a lake or the sea: on to the grid point there (under the water).
    const [bx, bz] = into ? [PX[j], PZ[j]] : gp(j);
    const sb = into ? S[j] : below(j);
    const u = up[i];
    const [p0x, p0z] = u >= 0 ? [PX[u], PZ[u]] : [2 * PX[i] - bx, 2 * PZ[i] - bz];
    const jj = into ? recv[j] : -1;
    const [p3x, p3z] = jj >= 0 && flowing[jj] ? [PX[jj], PZ[jj]] : [2 * bx - PX[i], 2 * bz - PZ[i]];
    lay(p0x, p0z, PX[i], PZ[i], bx, bz, p3x, p3z, S[i], Math.min(S[i], sb), r, dep);
  }
  // Each lake's outflow starts in the lake itself, so it leaves from the water.
  for (const L of lakes) {
    const o = L.outlet;
    if (!flowing[o]) continue;
    const ox = o % w, oz = (o / w) | 0;
    let from = -1;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = ox + dx, z = oz + dz;
      if (x < 0 || z < 0 || x >= w || z >= w) continue;
      const c = z * w + x;
      if (lakes[lake[c]] === L && (from < 0 || recv[c] === o)) from = c;
    }
    if (from < 0) continue;
    const [fx, fz] = gp(from);
    lay(2 * fx - PX[o], 2 * fz - PZ[o], fx, fz, PX[o], PZ[o], recv[o] >= 0 && flowing[recv[o]] ? PX[recv[o]] : 2 * PX[o] - fx,
      recv[o] >= 0 && flowing[recv[o]] ? PZ[recv[o]] : 2 * PZ[o] - fz, L.level, S[o], width(o), riverDepth(km2(catchment[o])));
  }

  // Lakes: each grid point under one, its surface, and its bed (deepening
  // away from the shore, never above the hollow's own floor).
  const lakeOut = new Map<number, [number, number]>();
  const shore = new Float32Array(n).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (lake[i] < 0) continue;
    const cx = i % w, cz = (i / w) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= w || z >= w || lake[z * w + x] !== lake[i]) { shore[i] = 1; queue.push(i); break; }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q], cx = c % w, cz = (c / w) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= w || z >= w) continue;
      const j = z * w + x;
      if (lake[j] === lake[c] && shore[j] > shore[c] + 1) { shore[j] = shore[c] + 1; queue.push(j); }
    }
  }
  const ix0 = gx0 / G, iz0 = gz0 / G;
  for (let i = 0; i < n; i++) {
    const id = lake[i];
    if (id < 0) continue;
    const L = lakes[id], p = L.pit;
    if (!mine(gx0 + (p % w) * G, gz0 + Math.floor(p / w) * G)) continue;
    const bed = Math.min(H[i], L.level - Math.min(14, 0.6 + 0.05 * shore[i] * G));
    lakeOut.set(latticeKey(ix0 + (i % w), iz0 + Math.floor(i / w)), [L.level, bed]);
  }
  return { reaches: new Float32Array(out), lakes: lakeOut };
}
