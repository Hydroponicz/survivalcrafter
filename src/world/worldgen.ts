import { erode, slump } from './erosion';
import { drainage, localDrainage } from './hydrology';
import { climate, SNOW_TEMP, tempAt, zoneOf, type Zone } from './climate';
import { hash2, Simplex } from './noise';
import type { StandInPlan } from './farforest';

// The world, generated in two layers, without end.
//
// The map: the land is cut into 1 km tiles, each made the first time you come
// near it. Large-scale noise decides land and sea (so there are continents,
// coasts, seas and islands in every direction); within a tile, mountain
// ranges are weathered by simulated rain, drained by rivers into lakes and
// the sea, and given a climate from the prevailing wind. Each tile is
// simulated with a wide overlap into its neighbours, and samples near a seam
// blend the tiles on either side, so the joins don't show.
//
// The detail: anywhere you look closely, the ground is sampled from the map
// (smoothly interpolated) plus metre-scale relief, with river channels carved
// along the map's river lines. That's what the voxel terrain is built from.

export const CELL = 8;
/** Core size of one map tile (metres) and the overlap simulated around it. */
export const TILE = 1024;
export const PAD = 256;
/** Grid points along one side of a tile's (padded) map. */
export const TN = (TILE + 2 * PAD) / CELL + 1;
/** Within this distance of a tile edge, the tiles on either side are blended. */
export const BLEND = 128;
export const SEA = 0;

/** Catchment area (km²) where a stream starts, and where it counts as a river (traced regionally). */
const STREAM_KM2 = 0.15, RIVER_KM2 = 0.6;
const STREAM_AT = STREAM_KM2 / (CELL * CELL * 1e-6);
/** In steep hills a stream starts from this share of the ground it needs on the flat. */
const HILL_STREAM = 0.3;
/** Least ground (km²) above a spring: streams are traced up their valleys as far as this. */
const SPRING_KM2 = 0.012;
/**
 * Rivers are traced over regions this big (metres), each with this margin of
 * land around it, on a grid of this many metres: every tile in a region uses
 * the same network, so a river runs on unbroken from tile to tile.
 */
const REGION = 8192, REGION_MARGIN = 6144, BASIN_CELL = 64;
const BASIN_N = (REGION + 2 * REGION_MARGIN) / BASIN_CELL + 1;

/** A point's river: distance from its line, surface, half-width, depth, and how steeply it falls (rise over run). */
export interface RiverHit { d: number; s: number; r: number; depth: number; fall?: number }

/** One map tile: everything simulated for it, as plain arrays (it can come from a worker). */
export interface TileData {
  tx: number; tz: number;
  H: Float32Array; dep: Float32Array; flow: Float32Array;
  kind: Uint8Array; S: Float32Array;
  climBase: Float32Array; moist: Float32Array;
  /** River reaches, 8 numbers each: ax, az, bx, bz, sa, sb, r, depth (world metres). */
  reaches: Float32Array;
  /** Where its distant forests stand, if a worker worked it out. */
  forest?: StandInPlan[];
  wind: [number, number];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The raw land before weathering, anywhere: continents and seas, ranges, hills and plains. */
export class BaseLand {
  private cont: Simplex; private warp: Simplex; private range: Simplex; private ridge: Simplex; private hill: Simplex; private low: Simplex;
  private readonly seed: number;
  constructor(seed: number) {
    this.seed = seed;
    this.cont = new Simplex(seed + 10);
    this.warp = new Simplex(seed + 11);
    this.range = new Simplex(seed + 12);
    this.ridge = new Simplex(seed + 13);
    this.hill = new Simplex(seed + 14);
    this.low = new Simplex(seed + 15);
    this.cliffs = new Simplex(seed + 16);
    this.plain = new Simplex(seed + 17);
  }

  private plain: Simplex;

  /**
   * How much a lake basin lowers ground of height h here (metres). Basins are
   * hollows in low, gentle country (left by old glaciers and slumped ground),
   * each filling into a pond or lake up to its rim. Their floors stay well
   * above the sea (a hollow open to it would just be sea).
   */
  lakeDip(x: number, z: number, h: number): number {
    if (h <= 4) return 0;
    const land = this.land(x, z);
    const range = smooth(-0.05, 0.45, this.range.fbm(x / 2400 + 3.1, z / 2400, 2));
    const calm = smooth(0.45, 0.85, land) * (1 - smooth(0.25, 0.6, range));
    if (calm <= 0) return 0;
    return Math.min(this.basin(x, z) * calm, (h - 4) * 0.6);
  }

  /**
   * How deep a lake basin dips the land here (metres; 0 outside any). Basins
   * sit at jittered spots on a ~0.9 km grid (about two in three taken), 50 to
   * 250 m across in radius, with wandering outlines.
   */
  basin(x: number, z: number): number {
    const C = 900;
    const cx = Math.floor(x / C), cz = Math.floor(z / C);
    let dip = 0;
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox, gz = cz + oz;
        if (hash2(gx, gz, this.seed + 71) > 0.65) continue;
        const px = (gx + 0.2 + 0.6 * hash2(gx, gz, this.seed + 72)) * C, pz = (gz + 0.2 + 0.6 * hash2(gx, gz, this.seed + 73)) * C;
        const r = 50 + 200 * hash2(gx, gz, this.seed + 74) ** 1.5;
        const d = Math.hypot(x - px, z - pz);
        if (d > r * 1.6) continue;
        // A ragged outline: the radius wanders with direction and place.
        const rr = r * (1 + 0.3 * this.cliffs.fbm(x / (r * 0.8) + gx * 3.1, z / (r * 0.8) + gz * 1.7, 2));
        const t = d / rr;
        if (t >= 1.25) continue;
        const depth = 5 + 9 * hash2(gx, gz, this.seed + 75);
        // Deepest in the middle, shelving gently up to the shore and beyond.
        dip = Math.max(dip, depth * (t < 1 ? 1 - 0.8 * t * t : 0.2 * (1.25 - t) / 0.25));
      }
    }
    return dip;
  }

  /**
   * How much a place lies in a great lowland plain (0..1): broad, low, gently
   * rolling country of open grassland and fields, where the hills die away,
   * tens of kilometres across.
   */
  open(x: number, z: number): number {
    return smooth(0.02, 0.32, this.plain.fbm(x / 7000 + 4.4, z / 7000, 2));
  }

  private cliffs: Simplex;

  /**
   * How cliffy the mountains are here (0..1). Some ranges are built of hard
   * beds that weather into tiers of sheer rock faces with ledges between.
   */
  cliff(x: number, z: number): number {
    return smooth(0.18, 0.42, this.cliffs.fbm(x / 3200 + 9.7, z / 3200, 2)) * smooth(0.2, 0.6, this.range.fbm(x / 2400 + 3.1, z / 2400, 2));
  }

  /** 0 open sea .. 1 inland. Mostly land, with seas, coasts and islands scattered through it. */
  land(x: number, z: number): number {
    const wx = x + this.warp.fbm(x / 3600, z / 3600, 3) * 1400, wz = z + this.warp.fbm(x / 3600 + 7, z / 3600, 3) * 1400;
    const c = this.cont.fbm(wx / 16000, wz / 16000, 4) + 0.22;
    return smooth(-0.05, 0.14, c);
  }

  height(x: number, z: number): number {
    const land = this.land(x, z);
    const inland = smooth(0.3, 0.9, land);
    // Mountain belts. Where a range rises the ground first swells broadly (a
    // massif, with long foothill slopes), and the ridges stand on top of that,
    // so peaks grow from wide bases instead of shooting up from the plain.
    const range = smooth(-0.05, 0.45, this.range.fbm(x / 2400 + 3.1, z / 2400, 2));
    // Bend the ridge lines so they curve and branch like real ranges.
    const wx = x + this.warp.fbm(x / 900 + 21, z / 900, 2) * 280, wz = z + this.warp.fbm(x / 900, z / 900 + 21, 2) * 280;
    const flat = this.open(x, z);
    const mount = (range * range * 150 + this.ridges(wx, wz) * range * 330) * inland * (1 - 0.9 * flat);
    const hills = (this.hill.fbm(x / 380, z / 380, 4) * 0.5 + 0.5) * (25 + 30 * range) * (1 - 0.75 * flat);
    const plains = 5 + this.low.fbm(x / 1500, z / 1500, 2) * 6;
    let h = land * (plains + hills + mount) + (1 - land) * -45;
    // Cliff bands: the slope gathers into steps, each a gentle ledge then a
    // sheer face, their edges wandering with the rock.
    const c = this.cliff(x, z);
    if (c > 0 && h > 30) {
      const step = 34, t = (h - 30 + this.cliffs.fbm(x / 260, z / 260, 2) * 14) / step;
      const f = t - Math.floor(t);
      const terraced = 30 + (Math.floor(t) + smooth(0.62, 0.9, f)) * step - this.cliffs.fbm(x / 260, z / 260, 2) * 14;
      h += (terraced - h) * c * smooth(30, 70, h);
    }
    return h;
  }

  /**
   * Ridged noise (0..1) shaped like eroded mountains: crests are rounded
   * rather than knife-edged, and each finer set of ridges grows mainly where
   * the coarser ones are already high, so spurs branch off the main ridges
   * and the valleys between stay smooth.
   */
  private ridges(x: number, z: number): number {
    let sum = 0, norm = 0, amp = 1, f = 1 / 1500, weight = 1;
    for (let o = 0; o < 4; o++) {
      const n = this.ridge.noise(x * f + o * 17.3, z * f - o * 9.1);
      let r = 1 - Math.sqrt(n * n + 0.012);
      r = r * r * weight;
      weight = clamp01(r * 1.5);
      sum += r * amp;
      norm += amp;
      amp *= 0.42;
      f *= 2.1;
    }
    return clamp01(sum / norm / 0.8);
  }
}

/** Half-width (metres) of a stream or river draining this much land: narrow at its source, then wider as the square root of its catchment, as real rivers are. */
const riverHalfWidth = (km2: number) => Math.min(60, Math.max(1.3, 1.0 + 10 * Math.max(0, Math.sqrt(km2) - Math.sqrt(STREAM_KM2 * HILL_STREAM))));
/** The catchment (km²) a stream of this half-width drains (riverHalfWidth backwards). */
const widthArea = (r: number) => r <= 1.3 ? 0 : ((r - 1) / 10 + Math.sqrt(STREAM_KM2 * HILL_STREAM)) ** 2;
const riverDepth = (km2: number) => Math.min(5, 0.35 + 0.6 * Math.sqrt(km2));

/**
 * Lay a drainage network out as river reaches (8 numbers each, as in
 * TileData). Water surfaces only ever fall downstream: where the ground rises
 * in the way, the river cuts down through it rather than running uphill.
 * Courses are smoothed along the flow so they curve instead of stepping
 * along the grid; `wander` (metres) lets them meander.
 */
function layRivers(
  w: number, cell: number, ox: number, oz: number, H: Float32Array, recv: Int32Array, catchment: Float32Array,
  isRiver: (i: number) => boolean, km2: (c: number) => number, sink: number, wander?: (x: number, z: number) => number,
  lake?: (i: number) => number, springs = true,
): number[] {
  const n = w * w;
  const rivers: number[] = [];
  for (let i = 0; i < n; i++) if (isRiver(i)) rivers.push(i);
  // Upstream first: catchment always grows downstream.
  rivers.sort((a, b) => catchment[a] - catchment[b]);
  const S = new Float32Array(n).fill(Infinity), cap = new Float32Array(n).fill(Infinity);
  const PX = new Float32Array(n), PZ = new Float32Array(n), up = new Int32Array(n).fill(-1);
  for (const i of rivers) {
    S[i] = Math.max(SEA, Math.min(H[i] - sink, cap[i]));
    const j = recv[i];
    if (j >= 0) cap[j] = Math.min(cap[j], S[i]);
    PX[i] = ox + (i % w) * cell; PZ[i] = oz + Math.floor(i / w) * cell;
    if (j >= 0 && isRiver(j) && (up[j] < 0 || catchment[i] > catchment[up[j]])) up[j] = i;
  }
  const pos = (i: number, a: Float32Array, b: Float32Array) => isRiver(i) ? [a[i], b[i]] : [ox + (i % w) * cell, oz + Math.floor(i / w) * cell];
  for (let it = 0; it < 4; it++) {
    const qx = PX.slice(), qz = PZ.slice();
    for (const i of rivers) {
      const j = recv[i], u = up[i];
      if (u < 0 || j < 0 || !isRiver(j)) continue;
      PX[i] = 0.5 * qx[i] + 0.25 * (qx[u] + qx[j]);
      PZ[i] = 0.5 * qz[i] + 0.25 * (qz[u] + qz[j]);
    }
  }
  if (wander) {
    const qx = PX.slice(), qz = PZ.slice();
    for (const i of rivers) {
      const j = recv[i], u = up[i];
      if (u < 0 || j < 0 || !isRiver(j)) continue;
      const dx = qx[j] - qx[u], dz = qz[j] - qz[u], l = Math.hypot(dx, dz) || 1;
      const off = wander(ox + (i % w) * cell, oz + Math.floor(i / w) * cell) * Math.min(1, riverHalfWidth(km2(catchment[i])) / 6);
      PX[i] += (-dz / l) * off; PZ[i] += (dx / l) * off;
    }
  }
  // How far each point lies below its stream's spring (a stream fed by others has none).
  const along = new Float32Array(n).fill(Infinity);
  for (const i of rivers) if (up[i] < 0) along[i] = 0;
  for (const i of rivers) {
    const j = recv[i];
    if (j >= 0 && isRiver(j)) along[j] = Math.min(along[j], along[i] + Math.hypot(PX[j] - PX[i], PZ[j] - PZ[i]));
  }
  const out: number[] = [];
  for (const i of rivers) {
    const j = recv[i];
    if (j < 0) continue;
    const [bx, bz] = pos(j, PX, PZ);
    // Into a lake: down to its surface (not its bed). Otherwise down to the ground it runs into.
    const lj = lake ? lake(j) : NaN;
    const sb = isRiver(j) ? S[j] : Math.max(SEA, Math.min(S[i], Number.isNaN(lj) ? H[j] : lj));
    const a = km2(catchment[i]);
    // A spring: the stream seeps out of the ground, narrow and shallow at
    // first, rather than starting at full size.
    // (A big river starts where streams have already gathered: full size.)
    const sp = springs ? Math.min(1, along[i] / 40) : 1;
    out.push(PX[i], PZ[i], bx, bz, S[i], sb, riverHalfWidth(a) * (0.45 + 0.55 * sp), riverDepth(a) * (0.15 + 0.85 * sp));
  }
  return out;
}

/**
 * The rivers of one region, traced on a coarse grid over the region and the
 * land around it (so it knows where water comes from), as reaches split into
 * short pieces. Kept for reuse, since every tile in the region needs them.
 */
interface RegionWater {
  /** River reaches (as in TileData). */
  reaches: Float32Array;
}
/** How far below the land around it a river's surface runs (metres), on the coarse grid. */
const RIVER_SINK = 2.5;
/** How far from a river its valley sides can reach at most (metres), where it's cut deep through high ground. */
const VALLEY = 260;
const regionCache = new Map<string, RegionWater>();
function regionRivers(base: BaseLand, seed: number, rx: number, rz: number): RegionWater {
  const key = `${seed}:${rx},${rz}`;
  const hit = regionCache.get(key);
  if (hit) return hit;
  const B = BASIN_CELL, BN = BASIN_N;
  const gx0 = rx * REGION - REGION_MARGIN, gz0 = rz * REGION - REGION_MARGIN;
  const Hc = new Float32Array(BN * BN);
  for (let k = 0; k < Hc.length; k++) Hc[k] = base.height(gx0 + (k % BN) * B, gz0 + Math.floor(k / BN) * B);
  const dr = localDrainage(Hc, BN, SEA);
  const km2 = (c: number) => c * B * B * 1e-6;
  const meander = new Simplex(seed + 77);
  const coarse = layRivers(BN, B, gx0, gz0, Hc, dr.recv, dr.catchment,
    (i) => km2(dr.catchment[i]) >= RIVER_KM2 && Hc[i] > SEA, km2, RIVER_SINK,
    (x, z) => meander.fbm(x / 420, z / 420, 2) * 30, undefined, false);
  // Where the coarse grid has a river end at the sea but the finer land runs on
  // a little further, carry it on (gently down to sea level) until it reaches the shore.
  const starts = new Set<string>();
  for (let k = 0; k < coarse.length; k += 8) starts.add(`${Math.round(coarse[k])},${Math.round(coarse[k + 1])}`);
  const ends = coarse.length;
  for (let k = 0; k < ends; k += 8) {
    let bx = coarse[k + 2], bz = coarse[k + 3];
    if (starts.has(`${Math.round(bx)},${Math.round(bz)}`)) continue;
    const ei = Math.round((bz - gz0) / B) * BN + Math.round((bx - gx0) / B);
    if (!(Hc[ei] <= SEA)) continue; // it ends in a closed hollow, not the sea
    const dx = bx - coarse[k], dz = bz - coarse[k + 1], l = Math.hypot(dx, dz) || 1;
    let s0 = coarse[k + 5];
    for (let step = 0; step < 30 && base.height(bx, bz) > SEA - 1; step++) {
      const nx = bx + (dx / l) * 16, nz = bz + (dz / l) * 16, s1 = Math.max(SEA, s0 - 0.3);
      coarse.push(bx, bz, nx, nz, s0, s1, coarse[k + 6], coarse[k + 7]);
      bx = nx; bz = nz; s0 = s1;
    }
  }
  // Keep the region's own (plus a little), in pieces about 16 m long.
  const out: number[] = [];
  const lo = -600, hi = REGION + 600;
  for (let k = 0; k < coarse.length; k += 8) {
    const ax = coarse[k], az = coarse[k + 1], bx = coarse[k + 2], bz = coarse[k + 3];
    const lx = ax - rx * REGION, lz = az - rz * REGION;
    if (lx < lo || lz < lo || lx > hi || lz > hi) continue;
    const pieces = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 16));
    for (let p = 0; p < pieces; p++) {
      const t0 = p / pieces, t1 = (p + 1) / pieces;
      out.push(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1,
        coarse[k + 4] + (coarse[k + 5] - coarse[k + 4]) * t0, coarse[k + 4] + (coarse[k + 5] - coarse[k + 4]) * t1, coarse[k + 6], coarse[k + 7]);
    }
  }
  const res: RegionWater = { reaches: new Float32Array(out) };
  regionCache.set(key, res);
  if (regionCache.size > 6) regionCache.delete(regionCache.keys().next().value!);
  return res;
}

/** Simulate one map tile (with its overlap). Pure: safe to run in a worker. */
export function buildTile(seed: number, tx: number, tz: number, base = new BaseLand(seed)): TileData {
  const n = TN * TN;
  const ox = tx * TILE - PAD, oz = tz * TILE - PAD;
  const H = new Float32Array(n);
  for (let k = 0; k < n; k++) H[k] = base.height(ox + (k % TN) * CELL, oz + Math.floor(k / TN) * CELL);
  const tileSeed = Math.floor(hash2(tx, tz, seed) * 2 ** 31);
  const er = erode(H, TN, tileSeed, SEA, {
    drops: 26000, maxSteps: 90, inertia: 0.05, capacity: 6, minCapacity: 0.01, erodeRate: 0.32,
    depositRate: 0.28, evaporation: 0.012, gravity: 4, radius: 2, maxDig: 3,
  });
  // Let over-steep crags and gully walls fall back to a natural angle (about 40°).
  // Cliff bands are hard rock: they stand far steeper.
  const talus = new Float32Array(n);
  for (let k = 0; k < n; k++) talus[k] = CELL * (0.85 + 4 * base.cliff(ox + (k % TN) * CELL, oz + Math.floor(k / TN) * CELL));
  slump(H, TN, talus, 80, er.deposit, 0.9);
  // Settle the ripples the slides leave.
  const sm = H.slice();
  for (let z = 1; z < TN - 1; z++) {
    for (let x = 1; x < TN - 1; x++) {
      const i = z * TN + x;
      H[i] = sm[i] * 0.5 + (sm[i - 1] + sm[i + 1] + sm[i - TN] + sm[i + TN]) * 0.125;
    }
  }
  // The region's rivers that run through this map: cut their channels and
  // valleys into it first, so the land's own streams find their way into them.
  const span = TN * CELL;
  const big: number[] = [];
  const rx = Math.floor((tx * TILE + TILE / 2) / REGION), rz = Math.floor((tz * TILE + TILE / 2) / REGION);
  const region = regionRivers(base, seed, rx, rz);
  const R = region.reaches;
  for (let k = 0; k < R.length; k += 8) {
    const m = R[k + 6] + 40;
    if (Math.max(R[k], R[k + 2]) < ox - m || Math.min(R[k], R[k + 2]) > ox + span + m) continue;
    if (Math.max(R[k + 1], R[k + 3]) < oz - m || Math.min(R[k + 1], R[k + 3]) > oz + span + m) continue;
    for (let q = 0; q < 8; q++) big.push(R[k + q]);
  }
  const nearBig = new Uint8Array(n);
  /** Within a big river's valley floor: no lake basins dug there. */
  const inValley = new Uint8Array(n);
  const riverSurface = new Float32Array(n).fill(NaN);
  const inChannel = new Uint8Array(n);
  const H0 = H.slice();
  for (let k = 0; k < big.length; k += 8) {
    const ax = big[k], az = big[k + 1], dx = big[k + 2] - ax, dz = big[k + 3] - az, r = big[k + 6];
    const len2 = dx * dx + dz * dz;
    // How deep the river has to cut here decides how wide a valley it opens:
    // beside its banks only, where it already runs low, wider where it cuts
    // through high ground; either way the cut eases out to the land around.
    const mx = Math.max(0, Math.min(TN - 1, Math.round((ax + dx / 2 - ox) / CELL)));
    const mz = Math.max(0, Math.min(TN - 1, Math.round((az + dz / 2 - oz) / CELL)));
    const cut = Math.max(0, H0[mz * TN + mx] - (big[k + 4] + big[k + 5]) / 2);
    const full = Math.min(VALLEY - 40, 40 + Math.max(0, cut - 14) / 0.7);
    const reach = Math.ceil((r + full + 40) / CELL) + 2;
    const cx = Math.round((ax - ox) / CELL), cz = Math.round((az - oz) / CELL);
    for (let iz = cz - reach; iz <= cz + reach; iz++) {
      for (let ix = cx - reach; ix <= cx + reach; ix++) {
        if (ix < 0 || iz < 0 || ix >= TN || iz >= TN) continue;
        const i = iz * TN + ix, x = ox + ix * CELL, z = oz + iz * CELL;
        const t = len2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / len2) : 0;
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (d > r + full + 40) continue;
        const sf = big[k + 4] + (big[k + 5] - big[k + 4]) * t;
        // The channel, a gentle floodplain beside it, then valley sides rising
        // at up to about 35° wherever the river has had to cut down.
        const e = d - r;
        const line = e < 0 ? sf + 0.25 : e < 40 ? sf + 0.3 + e * 0.35 : sf + 14.3 + (e - 40) * 0.7;
        const keep = smooth(full, full + 40, e); // 0: cut to the valley side, 1: the land as it was
        if (H[i] > line) H[i] = line + (H[i] - line) * keep;
        if (d < r + 24) nearBig[i] = 1;
        if (d < r + 70) inValley[i] = 1;
        if (d < r + 2) inChannel[i] = 1;
        if (d < r - CELL * 0.5 && !(riverSurface[i] <= sf)) riverSurface[i] = sf;
      }
    }
  }
  // Lake basins are dug after the weathering (which would silt them up), the
  // same for every tile, so neighbouring maps agree about them.
  for (let k = 0; k < n; k++) {
    const x = ox + (k % TN) * CELL, z = oz + Math.floor(k / TN) * CELL;
    // Not beside a big river (its valley floor is the river's).
    const dip = inValley[k] ? 0 : base.lakeDip(x, z, H[k]);
    if (dip > 0) H[k] -= dip;
  }
  const clim = climate(H, TN, seed, SEA, ox, oz, CELL);
  const dr = drainage(H, TN, SEA, clim.rain, { cell: CELL, streamAt: STREAM_AT * HILL_STREAM, minLake: 8, lakeDepth: 12, noLake: inChannel });
  // Lakes belong to the tile their deepest point lies in (see Tile.lake). A
  // lake this tile only sees in its overlap isn't its own: fill its hollow
  // back in and let the water run on through it, so streams here don't end
  // at a lake that isn't there.
  {
    const seen = new Uint8Array(n), c0 = PAD / CELL, c1 = c0 + TILE / CELL;
    for (let i = 0; i < n; i++) {
      if (dr.kind[i] !== 2 || seen[i]) continue;
      const cells = [i];
      seen[i] = 1;
      let deep = i;
      for (let q = 0; q < cells.length; q++) {
        const c = cells[q], cx = c % TN, cz = Math.floor(c / TN);
        if (H[c] < H[deep]) deep = c;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= TN || z >= TN) continue;
          const j = z * TN + x;
          if (dr.kind[j] === 2 && !seen[j]) { seen[j] = 1; cells.push(j); }
        }
      }
      const dx = deep % TN, dz = Math.floor(deep / TN);
      if (dx >= c0 && dx < c1 && dz >= c0 && dz < c1) continue;
      for (const c of cells) { H[c] = Math.max(H[c], dr.F[c] - 0.3); dr.kind[c] = 0; dr.S[c] = NaN; }
    }
    // Streams that ran into such a lake carry on along its drainage.
    for (let i = 0; i < n; i++) {
      if (dr.kind[i] !== 1) continue;
      for (let c = dr.recv[i], step = 0; c >= 0 && dr.kind[c] === 0 && step < 200 && dr.catchment[c] >= dr.catchment[i]; c = dr.recv[c], step++) {
        if (H[c] <= SEA) break;
        dr.kind[c] = 1; dr.S[c] = H[c] - 0.5;
      }
    }
  }
  // Which channels carry a stream. In the hills a stream starts from much
  // less ground than on the flat (rain runs off steep slopes and gathers
  // fast), and once it's running it carries on down to wherever it goes.
  const slopeAt = (i: number) => {
    const x = i % TN, z = (i / TN) | 0;
    if (x < 1 || z < 1 || x > TN - 2 || z > TN - 2) return 0;
    return Math.hypot(H[i + 1] - H[i - 1], H[i + TN] - H[i - TN]) / (2 * CELL);
  };
  const flowing = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (dr.kind[i] !== 1 || flowing[i]) continue;
    const need = STREAM_AT * (1 - (1 - HILL_STREAM) * smooth(0.05, 0.3, slopeAt(i)));
    if (dr.catchment[i] < need) continue;
    for (let c = i; c >= 0 && dr.kind[c] === 1 && !flowing[c]; c = dr.recv[c]) flowing[c] = 1;
  }
  // Every stream rises at a spring up its valley: follow it uphill, along the
  // biggest of the hollows feeding it, until the land stops rising or there's
  // too little ground above to feed a spring.
  const donor = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const j = dr.recv[i];
    if (j >= 0 && (donor[j] < 0 || dr.catchment[i] > dr.catchment[donor[j]])) donor[j] = i;
  }
  const hasUp = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (flowing[i] && dr.recv[i] >= 0) hasUp[dr.recv[i]] = 1;
  const springAt = SPRING_KM2 / (CELL * CELL * 1e-6);
  for (let i = 0; i < n; i++) {
    if (!flowing[i] || hasUp[i]) continue;
    for (let c = donor[i], prev = i, step = 0; c >= 0 && step < 250; prev = c, c = donor[c], step++) {
      if (H[c] < H[prev] - 0.05 || dr.catchment[c] < springAt || flowing[c] || dr.kind[c] === 2) break;
      flowing[c] = 1; dr.kind[c] = 1; dr.S[c] = Math.max(SEA, H[c] - 0.5);
    }
  }
  for (let i = 0; i < n; i++) if (dr.kind[i] === 1 && !flowing[i]) { dr.kind[i] = 0; dr.S[i] = NaN; }
  // Streams running side by side on flat ground join: where a stream comes
  // within ~20 m of a bigger one that isn't already just downstream of it,
  // it turns and runs into it there, and its own old course below that dries.
  const recv2 = dr.recv.slice();
  {
    const hasUp = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (dr.kind[i] === 1 && dr.recv[i] >= 0) hasUp[dr.recv[i]] = 1;
    const down = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (dr.kind[i] !== 1) continue;
      down.clear();
      for (let c = dr.recv[i], k = 0; c >= 0 && k < 8; c = dr.recv[c], k++) down.add(c);
      const ix = i % TN, iz = Math.floor(i / TN);
      let best = -1, bd = Infinity;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const x = ix + dx, z = iz + dz;
        if ((dx === 0 && dz === 0) || x < 0 || z < 0 || x >= TN || z >= TN) continue;
        const j = z * TN + x, d = dx * dx + dz * dz;
        if (d > 6.5 || dr.kind[j] !== 1 || down.has(j) || dr.catchment[j] <= dr.catchment[i] || H[j] > H[i] + 0.2) continue;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) recv2[i] = best;
    }
    // What still flows: everything downstream of the springs (and of streams
    // coming in over the map's edge) along the new courses.
    const still = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (dr.kind[i] !== 1 || hasUp[i]) continue;
      for (let c = i; c >= 0 && dr.kind[c] === 1 && !still[c]; c = recv2[c]) still[c] = 1;
    }
    for (let i = 0; i < n; i++) if (dr.kind[i] === 1 && !still[i]) { dr.kind[i] = 0; dr.S[i] = NaN; }
  }
  // The land's own streams, until they reach a river. Near a river the map's
  // own drainage mostly just retraces it, so streams are left out there,
  // except a stream coming in from outside, which carries on down into it.
  const feeds = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (dr.kind[i] !== 1 || nearBig[i]) continue;
    let c = dr.recv[i];
    if (c < 0 || !nearBig[c]) continue;
    for (let step = 0; c >= 0 && !inChannel[c] && !feeds[c] && step < 16; step++, c = dr.recv[c]) feeds[c] = 1;
  }
  const isStream = (i: number) => dr.kind[i] === 1 && (!nearBig[i] || feeds[i] === 1);
  const small = layRivers(TN, CELL, ox, oz, H, recv2, dr.catchment, isStream, (c) => c * CELL * CELL * 1e-6, 0.5,
    undefined, (i) => (dr.kind[i] === 2 ? dr.S[i] : NaN));
  for (let i = 0; i < n; i++) if (dr.kind[i] === 1 && !isStream(i)) { dr.kind[i] = 0; dr.S[i] = NaN; }
  // Wide rivers on the map itself (kind 3), so they show from afar as well.
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(riverSurface[i]) || dr.kind[i] === 2 || riverSurface[i] <= SEA + 0.1) continue;
    dr.kind[i] = 3; dr.S[i] = riverSurface[i];
  }
  for (let i = 0; i < n; i++) if (dr.kind[i]) clim.moist[i] = Math.min(1, clim.moist[i] + 0.25);
  // A stream running into a river carries on down its bank into the water:
  // its last stretch ends well inside the river, at the river's own level
  // (the map point it drains to may still be up on the bank).
  if (big.length) {
    const starts = new Set<string>();
    for (let k = 0; k < small.length; k += 8) starts.add(`${small[k]},${small[k + 1]}`);
    for (let k = 0; k < small.length; k += 8) {
      const bx = small[k + 2], bz = small[k + 3];
      if (starts.has(`${bx},${bz}`)) continue; // it carries on as another stream
      let best = Infinity, px = 0, pz = 0, ps = 0, pr = 0;
      for (let j = 0; j < big.length; j += 8) {
        const ax = big[j], az = big[j + 1], dx = big[j + 2] - ax, dz = big[j + 3] - az;
        if (Math.abs(ax - bx) > 120 || Math.abs(az - bz) > 120) continue;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? clamp01(((bx - ax) * dx + (bz - az) * dz) / l2) : 0;
        const cx = ax + dx * t, cz = az + dz * t, d = Math.hypot(bx - cx, bz - cz) - big[j + 6];
        if (d < best) { best = d; px = cx; pz = cz; ps = big[j + 4] + (big[j + 5] - big[j + 4]) * t; pr = big[j + 6]; }
      }
      if (best > 12) continue;
      // Into the river by about half its width (and never past the middle).
      const d0 = Math.hypot(bx - px, bz - pz) || 1, into = Math.max(0, d0 - pr * 0.5) / d0;
      small[k + 2] = bx + (px - bx) * into; small[k + 3] = bz + (pz - bz) * into;
      small[k + 5] = Math.min(small[k + 4], ps);
    }
  }
  // A stream ending just short of the sea carries on down into it.
  {
    const starts = new Set<string>();
    for (let k = 0; k < small.length; k += 8) starts.add(`${small[k]},${small[k + 1]}`);
    const ends = small.length;
    for (let k = 0; k < ends; k += 8) {
      const bx = small[k + 2], bz = small[k + 3];
      if (starts.has(`${bx},${bz}`) || small[k + 5] <= SEA + 0.05) continue;
      const cx = Math.round((bx - ox) / CELL), cz = Math.round((bz - oz) / CELL);
      let best = Infinity, sx = 0, sz = 0;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= TN || z >= TN || H[z * TN + x] > SEA - 0.5) continue;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; sx = ox + x * CELL; sz = oz + z * CELL; }
      }
      if (best === Infinity) continue;
      small.push(bx, bz, sx, sz, small[k + 5], SEA, small[k + 6], small[k + 7]);
    }
  }
  const reaches = big.concat(small);
  return {
    tx, tz, H, dep: er.deposit, flow: er.flow, kind: dr.kind, S: dr.S,
    climBase: clim.base, moist: clim.moist, reaches: new Float32Array(reaches), wind: clim.wind,
  };
}

/** How far (map cells) a lake's water may reach past the cells counted as lake, where the land lies low enough. */
const LAKE_REACH = 3;

const EMPTY = new Float32Array(0);

/** How far (metres) a stream crossing between tiles may be joined to the other tile's version of it. */
const LINK_REACH = 60;

/** A tile ready for sampling: its data plus a lookup of river reaches by map cell. */
class Tile {
  readonly ox: number; readonly oz: number;
  private buckets = new Map<number, number[]>();
  /** Lake surfaces as finally settled against the real (blended) ground; see WorldGen.settleLakes. */
  level?: Float32Array;
  /** Stretches carrying streams on from a lake's old shore down to its settled one. */
  readonly lakeLinks: number[] = [];
  /** Stretches of stream that leave this tile (indices into its reaches). */
  readonly exits: number[] = [];
  /** Whether streams coming in from the neighbours have widened this tile's (see WorldGen.inherit). */
  inherited = false;
  /** Each stretch's half-width as the tile itself measured it, before inherit. */
  readonly rawWidth: Float32Array;
  /** Stretches not drawn: this tile's version of a stream above where a neighbour's version joins it. */
  hidden?: Uint8Array;
  lastUsed = 0;
  constructor(readonly d: TileData) {
    this.ox = d.tx * TILE - PAD;
    this.oz = d.tz * TILE - PAD;
    const R = d.reaches;
    const x0 = d.tx * TILE, z0 = d.tz * TILE;
    const inCore = (x: number, z: number) => x >= x0 && x < x0 + TILE && z >= z0 && z < z0 + TILE;
    // Each stretch of stream belongs to the tile it starts in, so where tiles
    // overlap it's drawn once (neighbours trace the same water a little
    // differently, and both would show). Streams leaving this tile are
    // joined to the next tile's version of them (see WorldGen.links).
    for (let k = 0; k < R.length / 8; k++) {
      if (inCore(R[k * 8], R[k * 8 + 1]) && !inCore(R[k * 8 + 2], R[k * 8 + 3])) this.exits.push(k);
    }
    this.rawWidth = new Float32Array(R.length / 8);
    for (let k = 0; k < this.rawWidth.length; k++) this.rawWidth[k] = R[k * 8 + 6];
    this.index();
  }

  /** Bucket the stretches this tile owns by the map cells they come near. */
  index() {
    const R = this.d.reaches, x0 = this.d.tx * TILE, z0 = this.d.tz * TILE;
    const inCore = (x: number, z: number) => x >= x0 && x < x0 + TILE && z >= z0 && z < z0 + TILE;
    const buckets = this.buckets;
    buckets.clear();
    for (let k = 0; k < R.length / 8; k++) {
      if (!inCore(R[k * 8], R[k * 8 + 1]) || this.hidden?.[k]) continue;
      const r = R[k * 8 + 6], len = Math.hypot(R[k * 8 + 2] - R[k * 8], R[k * 8 + 3] - R[k * 8 + 1]);
      const reach = Math.ceil((r + 12 + len) / CELL) + 1;
      const cx = Math.round((R[k * 8] - this.ox) / CELL), cz = Math.round((R[k * 8 + 1] - this.oz) / CELL);
      for (let oz = -reach; oz <= reach; oz++) for (let ox = -reach; ox <= reach; ox++) {
        const bx = cx + ox, bz = cz + oz;
        if (bx < 0 || bz < 0 || bx >= TN || bz >= TN) continue;
        const key = bz * TN + bx;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(k);
      }
    }
  }

  at(a: Float32Array | Uint8Array, ix: number, iz: number) {
    ix = ix < 0 ? 0 : ix >= TN ? TN - 1 : ix;
    iz = iz < 0 ? 0 : iz >= TN ? TN - 1 : iz;
    return a[iz * TN + ix];
  }

  lerp(a: Float32Array, x: number, z: number): number {
    const fx = (x - this.ox) / CELL, fz = (z - this.oz) / CELL;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const a00 = this.at(a, ix, iz), a10 = this.at(a, ix + 1, iz), a01 = this.at(a, ix, iz + 1), a11 = this.at(a, ix + 1, iz + 1);
    return (a00 + (a10 - a00) * tx) * (1 - tz) + (a01 + (a11 - a01) * tx) * tz;
  }

  height(x: number, z: number): number {
    const fx = (x - this.ox) / CELL, fz = (z - this.oz) / CELL;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const H = this.d.H;
    const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const row = (dz: number) => cr(this.at(H, ix - 1, iz + dz), this.at(H, ix, iz + dz), this.at(H, ix + 1, iz + dz), this.at(H, ix + 2, iz + dz), tx);
    return cr(row(-1), row(0), row(1), row(2), tz);
  }

  river(x: number, z: number, best: { hit: RiverHit | null; edge: number }) {
    const ix = Math.round((x - this.ox) / CELL), iz = Math.round((z - this.oz) / CELL);
    const list = this.buckets.get(iz * TN + ix);
    if (!list) return;
    const R = this.d.reaches;
    for (const k of list) {
      const o = k * 8;
      const ax = R[o], az = R[o + 1], dx = R[o + 2] - ax, dz = R[o + 3] - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / len2) : 0;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      const edge = d - R[o + 6];
      if (edge < best.edge) {
        best.edge = edge;
        best.hit = { d, s: R[o + 4] + (R[o + 5] - R[o + 4]) * t, r: R[o + 6], depth: R[o + 7], fall: len2 > 0 ? Math.abs(R[o + 4] - R[o + 5]) / Math.sqrt(len2) : 0 };
      }
    }
  }

  /**
   * The lake at a point: its surface, and how far (map cells) the point lies
   * outside the cells this tile counts as lake (0 inside). Lakes reach a
   * couple of cells past those, so the shore follows the lie of the land
   * rather than the map grid. [NaN, Infinity] when there's none.
   */
  lake(x: number, z: number): [number, number] {
    const near = this.nearLake ??= this.findNearLake();
    if (!near.size) return [NaN, Infinity];
    const fx = (x - this.ox) / CELL, fz = (z - this.oz) / CELL;
    const cx = Math.round(fx), cz = Math.round(fz);
    let best = NaN, bd = Infinity;
    // The nearest lake cell to this cell or its neighbours (exact distance from the point).
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const j = near.get((cz + dz) * TN + cx + dx);
        if (j === undefined) continue;
        const d = Math.max(0, Math.hypot((j % TN) - fx, Math.floor(j / TN) - fz) - 0.75);
        const lv = this.level ? this.level[j] : this.d.S[j];
        if (d < bd && !Number.isNaN(lv)) { bd = d; best = lv; }
      }
    }
    return bd <= LAKE_REACH ? [best, bd] : [NaN, Infinity];
  }

  private nearLake?: Map<number, number>;
  /** Cells of the lakes this tile owns. */
  owned?: Uint8Array;
  ownedLakes(): Uint8Array {
    if (!this.owned) this.nearLake = this.findNearLake();
    return this.owned!;
  }
  /**
   * For each cell near a lake this tile owns, the nearest cell of it. A lake
   * reaching across the join between tiles is worked out by both, a little
   * differently; it belongs to the tile its deepest point lies in, and only
   * that tile's version is used, so its shore never ends in a straight line
   * where one tile's say gives out.
   */
  private findNearLake(): Map<number, number> {
    const kind = this.d.kind, H = this.d.H, n = kind.length;
    const owned = new Uint8Array(n), seen = new Uint8Array(n);
    const x0 = PAD / CELL, x1 = x0 + TILE / CELL;
    for (let i = 0; i < n; i++) {
      if (kind[i] !== 2 || seen[i]) continue;
      const cells: number[] = [i];
      seen[i] = 1;
      let deep = i;
      for (let q = 0; q < cells.length; q++) {
        const c = cells[q], cx = c % TN, cz = Math.floor(c / TN);
        if (H[c] < H[deep]) deep = c;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= TN || z >= TN) continue;
          const j = z * TN + x;
          if (kind[j] === 2 && !seen[j]) { seen[j] = 1; cells.push(j); }
        }
      }
      const dx = deep % TN, dz = Math.floor(deep / TN);
      if (dx >= x0 && dx < x1 && dz >= x0 && dz < x1) for (const c of cells) owned[c] = 1;
    }
    this.owned = owned;
    const near = new Map<number, number>(), dist = new Map<number, number>();
    const R = LAKE_REACH + 1;
    for (let i = 0; i < n; i++) {
      if (!owned[i]) continue;
      const ix = i % TN, iz = Math.floor(i / TN);
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const x = ix + dx, z = iz + dz;
        if (x < 0 || z < 0 || x >= TN || z >= TN) continue;
        const k = z * TN + x, d = dx * dx + dz * dz;
        if (d < (dist.get(k) ?? Infinity)) { dist.set(k, d); near.set(k, i); }
      }
    }
    return near;
  }
}

/** Builds tiles somewhere else (a worker) and hands them back. */
export interface TileSource {
  request(tx: number, tz: number): void;
}

export class WorldGen {
  /** Tiles made on the spot (holding everything up) rather than in the background, and the time it took. */
  static blocking = { tiles: 0, ms: 0 };
  readonly seed: number;
  readonly base: BaseLand;
  private tiles = new Map<string, Tile>();
  private pending = new Set<string>();
  private source?: TileSource;
  private clock = 0;
  wind: [number, number] = [1, 0];
  private detail: Simplex;
  private detail2: Simplex;
  private soilN: Simplex;
  private patch: Simplex;
  /** Called when a tile arrives (e.g. to build its distant terrain); `lod` and `forest` if a worker made its colours and distant trees. */
  onTile?: (t: TileData, lod?: Float32Array, forest?: StandInPlan[]) => void;

  constructor(seed: number) {
    this.seed = seed;
    this.base = new BaseLand(seed);
    this.detail = new Simplex(seed + 501);
    this.detail2 = new Simplex(seed + 502);
    this.soilN = new Simplex(seed + 99);
    this.patch = new Simplex(seed + 17);
  }

  /** Let tiles be made off the main thread; `want()` asks for them ahead of need. */
  useSource(source: TileSource) { this.source = source; }

  /** A tile arrived from the source. */
  addTile(d: TileData, lod?: Float32Array, forest?: StandInPlan[]) {
    if (forest) d.forest = forest;
    const key = `${d.tx},${d.tz}`;
    this.pending.delete(key);
    if (this.tiles.has(key)) return;
    this.tiles.set(key, new Tile(d));
    this.wind = d.wind;
    this.onTile?.(d, lod, forest);
    for (const w of this.waiters.slice()) w();
  }

  private waiters: (() => void)[] = [];
  /** Whether tiles are made somewhere else (a worker). */
  get tileSource() { return this.source; }

  /**
   * The tiles that sampling the land within `reach` metres of a point needs:
   * those covering it, and the neighbours of each (streams carry on from them).
   */
  tilesAround(x: number, z: number, reach: number): [number, number][] {
    const out: [number, number][] = [];
    const lo = (v: number) => Math.floor((v - reach - BLEND) / TILE) - 1, hi = (v: number) => Math.floor((v + reach + BLEND) / TILE) + 1;
    for (let tz = lo(z); tz <= hi(z); tz++) for (let tx = lo(x); tx <= hi(x); tx++) out.push([tx, tz]);
    return out;
  }

  /** Ask for these tiles and wait until they're all here. */
  whenTiles(list: [number, number][]): Promise<void> {
    for (const [x, z] of list) this.want(x, z);
    const here = () => list.every(([x, z]) => this.tiles.has(`${x},${z}`));
    if (here()) return Promise.resolve();
    return new Promise((resolve) => {
      const w = () => {
        if (!here()) return;
        this.waiters.splice(this.waiters.indexOf(w), 1);
        resolve();
      };
      this.waiters.push(w);
    });
  }

  /** Every tile made so far. */
  forEachTile(fn: (d: TileData) => void) { for (const t of this.tiles.values()) fn(t.d); }

  hasTile(tx: number, tz: number) { return this.tiles.has(`${tx},${tz}`); }

  tileData(tx: number, tz: number): TileData | undefined { return this.tiles.get(`${tx},${tz}`)?.d; }

  /** Ask for a tile in the background (if there's a source), without waiting. */
  want(tx: number, tz: number) {
    const key = `${tx},${tz}`;
    if (this.tiles.has(key) || this.pending.has(key)) return;
    if (!this.source) { this.tile(tx, tz); return; }
    this.pending.add(key);
    this.source.request(tx, tz);
  }

  /** The tile, made right now if it hasn't arrived yet. */
  private tile(tx: number, tz: number): Tile {
    const key = `${tx},${tz}`;
    let t = this.tiles.get(key);
    if (!t) {
      const t0 = performance.now();
      this.addTile(buildTile(this.seed, tx, tz, this.base));
      WorldGen.blocking.tiles++; WorldGen.blocking.ms += performance.now() - t0;
      t = this.tiles.get(key)!;
    }
    t.lastUsed = this.clock;
    return t;
  }

  /** Forget tiles far from a point (they're remade if you come back). */
  forget(x: number, z: number, keep: number) {
    this.clock++;
    for (const [key, t] of this.tiles) {
      const cx = (t.d.tx + 0.5) * TILE, cz = (t.d.tz + 0.5) * TILE;
      if (Math.max(Math.abs(cx - x), Math.abs(cz - z)) > keep + TILE) this.tiles.delete(key);
    }
  }

  /**
   * The tiles that cover a point and how much each counts: just one away from
   * the seams, blending to an even split right on them.
   */
  private cover(x: number, z: number): [Tile, number][] {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    const fx = x - tx * TILE, fz = z - tz * TILE;
    const ax: [number, number][] = [[tx, 1]], az: [number, number][] = [[tz, 1]];
    const split = (f: number, t: number, out: [number, number][]) => {
      if (f < BLEND) { const w = 0.5 * (1 - f / BLEND); out[0][1] = 1 - w; out.push([t - 1, w]); }
      else if (TILE - f < BLEND) { const w = 0.5 * (1 - (TILE - f) / BLEND); out[0][1] = 1 - w; out.push([t + 1, w]); }
    };
    split(fx, tx, ax);
    split(fz, tz, az);
    const out: [Tile, number][] = [];
    for (const [x0, wx] of ax) for (const [z0, wz] of az) out.push([this.tile(x0, z0), wx * wz]);
    return out;
  }

  /** Whether the tiles a point needs (those covering it, and their neighbours) are all made. */
  covered(x: number, z: number): boolean {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE), fx = x - tx * TILE, fz = z - tz * TILE;
    const x0 = tx - (fx < BLEND ? 2 : 1), x1 = tx + (TILE - fx < BLEND ? 2 : 1);
    const z0 = tz - (fz < BLEND ? 2 : 1), z1 = tz + (TILE - fz < BLEND ? 2 : 1);
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) if (!this.tiles.has(`${i},${j}`)) return false;
    return true;
  }

  private blend(x: number, z: number, f: (t: Tile) => number): number {
    const c = this.cover(x, z);
    if (c.length === 1) return f(c[0][0]);
    let s = 0;
    for (const [t, w] of c) s += f(t) * w;
    return s;
  }

  // ---------- map sampling
  mapHeight(x: number, z: number): number {
    return this.blend(x, z, (t) => t.height(x, z));
  }

  field(name: 'dep' | 'flow' | 'climBase' | 'moist', x: number, z: number): number {
    return this.blend(x, z, (t) => t.lerp(t.d[name], x, z));
  }

  /** Steepness of the map (rise per metre) around a point. */
  mapSlope(x: number, z: number): number {
    return this.blend(x, z, (t) => {
      const gx = (t.lerp(t.d.H, x + CELL, z) - t.lerp(t.d.H, x - CELL, z)) / (2 * CELL);
      const gz = (t.lerp(t.d.H, x, z + CELL) - t.lerp(t.d.H, x, z - CELL)) / (2 * CELL);
      return Math.hypot(gx, gz);
    });
  }

  /** The nearest river reach to a point, if one is close enough to matter. */
  river(x: number, z: number): RiverHit | null {
    const best = { hit: null as RiverHit | null, edge: Infinity };
    const cover = this.cover(x, z);
    for (const [t] of cover) { this.inherit(t); t.river(x, z, best); }
    for (const [t] of cover) {
      this.settleLakes(t);
      const L = t.lakeLinks;
      for (let o = 0; o < L.length; o += 8) {
        const ax = L[o], az = L[o + 1], dx = L[o + 2] - ax, dz = L[o + 3] - az;
        if (Math.abs(x - ax) > 200 || Math.abs(z - az) > 200) continue;
        const len2 = dx * dx + dz * dz;
        const tt = len2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / len2) : 0;
        const d = Math.hypot(x - (ax + dx * tt), z - (az + dz * tt));
        const edge = d - L[o + 6];
        if (edge < best.edge) {
          best.edge = edge;
          best.hit = { d, s: L[o + 4] + (L[o + 5] - L[o + 4]) * tt, r: L[o + 6], depth: L[o + 7], fall: len2 > 0 ? Math.abs(L[o + 4] - L[o + 5]) / Math.sqrt(len2) : 0 };
        }
      }
    }
    // Where a stream crosses into this point's tile, the link joining it to
    // this tile's own version of it.
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE), fx = x - tx * TILE, fz = z - tz * TILE;
    const nx = fx < LINK_REACH ? -1 : TILE - fx < LINK_REACH ? 1 : 0, nz = fz < LINK_REACH ? -1 : TILE - fz < LINK_REACH ? 1 : 0;
    if (nx || nz) {
      for (const [ox, oz] of [[nx, 0], [0, nz], [nx, nz]]) {
        if (!ox && !oz) continue;
        const L = this.links(tx, tz, ox, oz);
        for (let o = 0; o < L.length; o += 8) {
          const ax = L[o], az = L[o + 1], dx = L[o + 2] - ax, dz = L[o + 3] - az;
          if (Math.abs(x - ax) > 80 || Math.abs(z - az) > 80) continue;
          const len2 = dx * dx + dz * dz;
          const t = len2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / len2) : 0;
          const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
          const edge = d - L[o + 6];
          if (edge < best.edge) {
            best.edge = edge;
            best.hit = { d, s: L[o + 4] + (L[o + 5] - L[o + 4]) * t, r: L[o + 6], depth: L[o + 7], fall: len2 > 0 ? Math.abs(L[o + 4] - L[o + 5]) / Math.sqrt(len2) : 0 };
          }
        }
      }
    }
    return best.hit && best.edge < 12 ? best.hit : null;
  }

  /**
   * The map height at a point and how deep lake water stands there. Each map
   * tile says how deep its own lakes are; like the ground, that's blended
   * across the joins between tiles, so where two tiles disagree about a lake
   * it shallows out across the join rather than ending in a wall. A lake's
   * water reaches a little past the cells counted as lake wherever the land
   * lies below its surface, so the shore follows the land, not the map grid.
   */
  private lakeSample(x: number, z: number): { mapH: number; depth: number } {
    let mapH = 0;
    for (const [t, w] of this.cover(x, z)) mapH += t.height(x, z) * w;
    const [s, bd] = this.lakeNear(x, z);
    if (Number.isNaN(s)) return { mapH, depth: 0 };
    // Past the lake's own cells it laps only over ground a little below its
    // surface, never out over a lower hollow or channel beside it.
    // Where the ground there dips lower, it rises into a low bank that holds
    // the lake in, rather than the water ending in a wall.
    if (bd > 0 && s - mapH > 0.6 + 0.4 * bd) return { mapH: s + 0.25 - 0.1 * bd, depth: 0 };
    return { mapH, depth: Math.max(0, Math.min(s - mapH, (LAKE_REACH - bd) * 4)) };
  }

  /** The nearest lake's surface around a point and how far outside its cells (map cells) the point is: [NaN, Infinity] if none. */
  private lakeNear(x: number, z: number): [number, number] {
    // Lakes belong to one tile each; ask this tile and any neighbour whose map
    // reaches here (a lake can spread up to the map's overlap past its tile).
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    const fx = x - tx * TILE, fz = z - tz * TILE;
    let s = NaN, bd = Infinity;
    for (let oz = -1; oz <= 1; oz++) {
      if ((oz < 0 && fz > PAD) || (oz > 0 && TILE - fz > PAD)) continue;
      for (let ox = -1; ox <= 1; ox++) {
        if ((ox < 0 && fx > PAD) || (ox > 0 && TILE - fx > PAD)) continue;
        const lt = this.tile(tx + ox, tz + oz);
        this.settleLakes(lt);
        const [ls, d] = lt.lake(x, z);
        if (!Number.isNaN(ls) && d < bd) { bd = d; s = ls; }
      }
    }
    return [s, bd];
  }

  /**
   * A lake can't stand higher than the ground holding it in. Each tile
   * worked out its lakes on its own map, but near its edges the real ground
   * is blended with the neighbours' and can lie lower; so every lake's
   * surface is brought down to the lowest point of the real ground round its
   * shore (and a lake left too shallow goes).
   */
  /**
   * A tile's lake surfaces as settled (NaN where none), if the tiles around
   * it are already made (settling needs their ground); else undefined.
   */
  settledLakes(tx: number, tz: number): Float32Array | undefined {
    // Only if already worked out (for the land around you): settling is
    // heavy, and from afar a lake's own level looks the same.
    return this.tiles.get(`${tx},${tz}`)?.level;
  }

  /**
   * Streams keep their size from tile to tile. Each tile measures a stream
   * by the land it can see draining into it, so a river coming in from the
   * next tile reads there as only the creek its last few hundred metres
   * would make. Where a neighbour's stream runs in, this tile's version of
   * it (and everything below) takes on the catchment it was missing.
   * Uses the neighbours as they were made, so it never depends on the
   * order tiles come in.
   */
  private inherit(t: Tile): boolean {
    if (t.inherited) return true;
    // Never makes tiles itself (that would spread outward without end):
    // waits until the neighbours have arrived.
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) if (!this.tiles.has(`${t.d.tx + ox},${t.d.tz + oz}`)) return false;
    t.inherited = true;
    const R = t.d.reaches, n = R.length / 8;
    const x0 = t.d.tx * TILE, z0 = t.d.tz * TILE;
    const inHome = (x: number, z: number) => x >= x0 && x < x0 + TILE && z >= z0 && z < z0 + TILE;
    const startAt = new Map<string, number>();
    const endAt = new Map<string, number[]>();
    for (let k = 0; k < n; k++) {
      startAt.set(`${R[k * 8]},${R[k * 8 + 1]}`, k);
      const key = `${R[k * 8 + 2]},${R[k * 8 + 3]}`;
      const l = endAt.get(key);
      if (l) l.push(k); else endAt.set(key, [k]);
    }
    const add = new Float32Array(n);
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oz) continue;
      const nb = this.tile(t.d.tx + ox, t.d.tz + oz), NR = nb.d.reaches;
      for (const e of nb.exits) {
        const o = e * 8, ex = NR[o + 2], ez = NR[o + 3];
        if (!inHome(ex, ez)) continue;
        const r = nb.rawWidth[e];
        let bd = Infinity, bj = -1;
        for (let j = 0; j < n; j++) {
          const q = j * 8;
          if (Math.abs(R[q] - ex) > LINK_REACH || Math.abs(R[q + 1] - ez) > LINK_REACH || !inHome(R[q], R[q + 1])) continue;
          const ax = R[q], az = R[q + 1], dx = R[q + 2] - ax, dz = R[q + 3] - az, l2 = dx * dx + dz * dz;
          const tt = l2 > 0 ? clamp01(((ex - ax) * dx + (ez - az) * dz) / l2) : 0;
          const d = Math.hypot(ex - ax - dx * tt, ez - az - dz * tt);
          if (d < bd) { bd = d; bj = j; }
        }
        if (bj < 0 || bd > LINK_REACH * 0.6) continue;
        add[bj] = Math.max(add[bj], widthArea(r) - widthArea(t.rawWidth[bj]));
        // This tile's own course above the join runs beside the neighbour's
        // (which is joined in there): leave just the one. (Not where a smaller
        // stream runs into a bigger one: that's a tributary, not the same water.)
        for (let c = bj, step = 0; step < 12 && t.rawWidth[bj] < r * 1.3 + 0.5; step++) {
          const ups = endAt.get(`${R[c * 8]},${R[c * 8 + 1]}`);
          if (!ups || ups.length !== 1) break;
          const u = ups[0], q = u * 8;
          if (!inHome(R[q], R[q + 1]) || Math.hypot(R[q] - ex, R[q + 1] - ez) > LINK_REACH) break;
          (t.hidden ??= new Uint8Array(n))[u] = 1;
          c = u;
        }
      }
    }
    const extra = new Float32Array(n);
    let any = false;
    for (let j = 0; j < n; j++) {
      if (add[j] <= 0.005) continue;
      any = true;
      for (let c: number | undefined = j, step = 0; c !== undefined && step < 2000; step++) {
        extra[c] += add[j];
        c = startAt.get(`${R[c * 8 + 2]},${R[c * 8 + 3]}`);
      }
    }
    if (!any) { if (t.hidden) t.index(); return true; }
    for (let k = 0; k < n; k++) {
      if (!extra[k]) continue;
      const a = widthArea(t.rawWidth[k]) + extra[k];
      R[k * 8 + 6] = Math.max(R[k * 8 + 6], riverHalfWidth(a));
      R[k * 8 + 7] = Math.max(R[k * 8 + 7], riverDepth(a));
    }
    t.index();
    return true;
  }

  private settleLakes(t: Tile) {
    if (t.level) return;
    // Settling reads the ground around the tile: wait until its neighbours
    // are here rather than make them (each would want its own settled too,
    // and so on outward).
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) if (!this.tiles.has(`${t.d.tx + ox},${t.d.tz + oz}`)) return;
    this.inherit(t);
    const d = t.d, n = d.kind.length, owned = t.ownedLakes();
    const level = new Float32Array(n).fill(NaN);
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!owned[i] || seen[i]) continue;
      const cells = [i];
      seen[i] = 1;
      let rim = d.S[i], bed = Infinity;
      for (let q = 0; q < cells.length; q++) {
        const c = cells[q], cx = c % TN, cz = Math.floor(c / TN);
        bed = Math.min(bed, d.H[c]);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= TN || z >= TN) continue;
          const j = z * TN + x;
          if (owned[j]) { if (!seen[j]) { seen[j] = 1; cells.push(j); } continue; }
          // Just outside the lake: the real ground there, a little beyond.
          const wx = t.ox + (x + dx) * CELL, wz = t.oz + (z + dz) * CELL;
          rim = Math.min(rim, this.mapHeight(t.ox + x * CELL, t.oz + z * CELL), this.mapHeight(wx, wz));
        }
      }
      const s = Math.min(d.S[i], rim - 0.15);
      if (s - bed < 0.8) continue;
      for (const c of cells) level[c] = s;
      // Streams that ran in at the old shore carry on down to the new one.
      if (s < d.S[i] - 0.3) {
        const wet = cells.filter((c) => d.H[c] < s - 0.2);
        const R = d.reaches;
        for (let k = 0; k < R.length; k += 8) {
          const bx = R[k + 2], bz = R[k + 3];
          const cx = Math.round((bx - t.ox) / CELL), cz = Math.round((bz - t.oz) / CELL);
          let near = false;
          for (let dz = -3; dz <= 3 && !near; dz++) for (let dx = -3; dx <= 3; dx++) {
            const x = cx + dx, z = cz + dz;
            if (x >= 0 && z >= 0 && x < TN && z < TN && owned[z * TN + x] && seen[z * TN + x] && cells.includes(z * TN + x)) { near = true; break; }
          }
          if (!near) continue;
          let best = -1, bd = Infinity;
          for (const c of wet) { const dd = Math.hypot(t.ox + (c % TN) * CELL - bx, t.oz + Math.floor(c / TN) * CELL - bz); if (dd < bd) { bd = dd; best = c; } }
          if (best < 0 || bd < 2) continue;
          t.lakeLinks.push(bx, bz, t.ox + (best % TN) * CELL, t.oz + Math.floor(best / TN) * CELL, R[k + 5], s, R[k + 6], R[k + 7]);
        }
      }
    }
    t.level = level;
    this.joinMouths(t);
  }

  /**
   * A stream whose last stretch stops short of the water it was running
   * into (a lake that settled lower, or one another tile traced a little
   * differently) carries on down to the nearest water within reach.
   */
  private joinMouths(t: Tile) {
    const R = t.d.reaches;
    const starts = new Set<string>();
    for (let k = 0; k < R.length; k += 8) starts.add(`${R[k]},${R[k + 1]}`);
    const x0 = t.d.tx * TILE, z0 = t.d.tz * TILE;
    for (let k = 0; k < R.length; k += 8) {
      const bx = R[k + 2], bz = R[k + 3];
      if (starts.has(`${bx},${bz}`) || R[k] < x0 || R[k] >= x0 + TILE || R[k + 1] < z0 || R[k + 1] >= z0 + TILE) continue;
      const se = R[k + 5];
      const dx = bx - R[k], dz = bz - R[k + 1], l = Math.hypot(dx, dz) || 1;
      // Already in water just past its end?
      const px = bx + (dx / l) * 2, pz = bz + (dz / l) * 2;
      if (this.mapHeight(px, pz) < SEA || !Number.isNaN(this.waterBeside(px, pz, R, k))) continue;
      // The nearest water no higher than the stream, searching outward (ahead of it first).
      let best: [number, number, number] | null = null;
      for (let rad = 3; rad <= 32 && !best; rad += 3) {
        for (let a = 0; a < 24; a++) {
          const ang = Math.atan2(dz, dx) + ((a % 2 ? 1 : -1) * Math.ceil(a / 2) * Math.PI) / 12;
          const x = bx + Math.cos(ang) * rad, z = bz + Math.sin(ang) * rad;
          const w = this.mapHeight(x, z) < SEA ? SEA : this.waterBeside(x, z, R, k);
          if (!Number.isNaN(w) && w <= se + 0.2) { best = [x, z, w]; break; }
        }
      }
      if (best) t.lakeLinks.push(bx, bz, best[0], best[1], se, Math.min(se, best[2]), R[k + 6], R[k + 7]);
    }
  }

  /** Water at a point other than the stream stretch k of reaches R itself (NaN if none). */
  private waterBeside(x: number, z: number, R: Float32Array, k: number): number {
    const lake = this.lakeSurface(x, z);
    if (!Number.isNaN(lake)) return lake;
    const rv = this.river(x, z);
    if (!rv || rv.d > rv.r) return NaN;
    // Not just this same stream: it must be a different one (or lower down).
    const ax = R[k], az = R[k + 1], bx = R[k + 2], bz = R[k + 3];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const tt = l2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / l2) : 0;
    if (Math.hypot(x - ax - dx * tt, z - az - dz * tt) < R[k + 6] + 0.5 && rv.s >= R[k + 5] - 0.05) return NaN;
    return rv.s;
  }

  private linkCache = new Map<string, Float32Array>();
  /**
   * Stretches joining the streams that leave tile (tx+ox, tz+oz) into tile
   * (tx, tz) to that tile's own version of each (the two tiles trace the
   * same water a little differently near their join). Where it has none
   * close by, the stream carries on along its own course a little way.
   */
  private links(tx: number, tz: number, ox: number, oz: number): Float32Array {
    // Only once the next tile is here (never made on the spot for this).
    const home = this.tile(tx, tz), nb = this.tiles.get(`${tx + ox},${tz + oz}`);
    if (!nb) return EMPTY;
    // Worked out again once both have taken in their neighbours' streams.
    const ready = this.inherit(home) && this.inherit(nb);
    const key = `${tx},${tz}|${ox},${oz}|${ready}`;
    let L = this.linkCache.get(key);
    if (L) return L;
    const H = home.d.reaches, R = nb.d.reaches, out: number[] = [];
    const x0 = tx * TILE, z0 = tz * TILE;
    const inHome = (x: number, z: number) => x >= x0 && x < x0 + TILE && z >= z0 && z < z0 + TILE;
    const startAt = new Map<string, number>();
    for (let k = 0; k < R.length / 8; k++) startAt.set(`${R[k * 8]},${R[k * 8 + 1]}`, k);
    const homeStart = new Map<string, number>();
    for (let k = 0; k < H.length / 8; k++) homeStart.set(`${H[k * 8]},${H[k * 8 + 1]}`, k);
    // Whether home's stretch j runs on back out to where the stream came in
    // from (the two tiles route water hugging their edge opposite ways): it
    // is upstream of it, not where it goes.
    const backInto = (j: number, sx: number, sz: number) => {
      for (let c: number | undefined = j, step = 0; c !== undefined && step < 16; step++) {
        const q = c * 8;
        if (!inHome(H[q + 2], H[q + 3]) && Math.hypot(H[q + 2] - sx, H[q + 3] - sz) < 20) return true;
        c = homeStart.get(`${H[q + 2]},${H[q + 3]}`);
      }
      return false;
    };
    for (const k of nb.exits) {
      const o = k * 8, ex = R[o + 2], ez = R[o + 3];
      if (!inHome(ex, ez)) continue;
      const r = R[o + 6], se = R[o + 5];
      // A stream that only strays over the edge a little way and comes back
      // (water hugging the seam) is drawn along its own course over here.
      let strays = false;
      for (let j = startAt.get(`${ex},${ez}`), step = 0; j !== undefined && step < 16; step++) {
        const q = j * 8;
        if (!inHome(R[q], R[q + 1])) { strays = true; break; }
        j = startAt.get(`${R[q + 2]},${R[q + 3]}`);
      }
      if (strays) {
        for (let j = startAt.get(`${ex},${ez}`); j !== undefined;) {
          const q = j * 8;
          if (!inHome(R[q], R[q + 1])) break;
          for (let c = 0; c < 8; c++) out.push(R[q + c]);
          j = startAt.get(`${R[q + 2]},${R[q + 3]}`);
        }
        continue;
      }
      // The nearest stretch of home's own stream of about this size or bigger.
      let bd = Infinity, bs = Infinity, px = 0, pz = 0, ps = 0, pr = 0, pdep = 0, back = false;
      for (let j = 0; j < H.length; j += 8) {
        if (!inHome(H[j], H[j + 1]) || home.hidden?.[j / 8]) continue;
        const ax = H[j], az = H[j + 1], dx = H[j + 2] - ax, dz = H[j + 3] - az;
        if (Math.abs(ax - ex) > LINK_REACH + 20 || Math.abs(az - ez) > LINK_REACH + 20) continue;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? clamp01(((ex - ax) * dx + (ez - az) * dz) / l2) : 0;
        const cx = ax + dx * t, cz = az + dz * t, d = Math.hypot(ex - cx, ez - cz);
        if (backInto(j / 8, R[o], R[o + 1])) {
          // Home's version runs back out alongside, carrying this water on
          // over there (see below): nothing to join.
          if (d < 12) back = true;
          continue;
        }
        // Rather the same stream (about as big) than a little one beside it.
        const score = d + (H[j + 6] < r * 0.6 ? 20 : 0);
        if (score < bs) { bs = score; bd = d; px = cx; pz = cz; ps = H[j + 4] + (H[j + 5] - H[j + 4]) * t; pr = H[j + 6]; pdep = H[j + 7]; }
      }
      if (back) continue;
      if (bd < LINK_REACH) {
        if (bd > 0.5) out.push(ex, ez, px, pz, se, Math.min(se, ps), Math.min(r, pr), Math.min(R[o + 7], pdep));
        continue;
      }
      // None near: carry on along the neighbour's own course.
      for (let j = startAt.get(`${ex},${ez}`), step = 0; j !== undefined && step < 30; step++) {
        const q = j * 8;
        if (!inHome(R[q], R[q + 1])) break;
        for (let c = 0; c < 8; c++) out.push(R[q + c]);
        j = startAt.get(`${R[q + 2]},${R[q + 3]}`);
      }
    }
    L = new Float32Array(out);
    this.linkCache.set(key, L);
    if (this.linkCache.size > 200) this.linkCache.delete(this.linkCache.keys().next().value!);
    return L;
  }

  /** The surface of a lake at a point, or NaN. */
  lakeSurface(x: number, z: number): number {
    // No lake near: nothing more to work out.
    if (Number.isNaN(this.lakeNear(x, z)[0])) return NaN;
    const { mapH, depth } = this.lakeSample(x, z);
    return depth > 0.05 ? mapH + depth : NaN;
  }

  // ---------- detail
  /**
   * The river channel at a point, shaped for the ground it runs through: it
   * never runs above the valley floor around it (so it can't float over low
   * ground), it meets the sea at sea level, and its width and depth wander
   * along its course: pools, riffles and narrows rather than a ditch.
   */
  channel(x: number, z: number, mapH = this.mapHeight(x, z)): (RiverHit & { sea: boolean }) | null {
    const rv = this.river(x, z);
    if (!rv) return null;
    let s = Math.min(rv.s, mapH - 0.2);
    // Across the coastal lowland the river eases down to sea level and becomes the sea.
    s = SEA + Math.max(0, s - SEA) * smooth(0.5, 5, mapH);
    const sea = s < SEA + 0.12;
    if (sea) s = SEA;
    const wobble = this.detail2.noise(x / 37 + 11, z / 37);
    const r = rv.r * (0.8 + 0.35 * (wobble * 0.5 + 0.5));
    const depth = rv.depth * (0.65 + 0.6 * (this.detail.noise(x / 23 + 5, z / 23) * 0.5 + 0.5));
    return { d: rv.d, s, r, depth, sea };
  }

  /** Ground height at any point: the map plus local relief, with river channels cut in. */
  height(x: number, z: number): number {
    const { mapH, depth } = this.lakeSample(x, z);
    let h = mapH;
    const slope = this.mapSlope(x, z);
    const ch = this.channel(x, z, mapH);
    // Rugged where the land is steep, gentle in the lowlands, calm by water
    // (so banks don't dip below the waterline).
    const amp = 0.5 + 2.5 * smooth(0.15, 0.9, slope);
    let calm = depth > 0.05 ? 0.25 : 1;
    if (ch) calm *= 0.15 + 0.85 * smooth(ch.r, ch.r + 8, ch.d);
    h += (this.detail.fbm(x / 26, z / 26, 4) * amp + this.detail2.fbm(x / 7, z / 7, 2) * amp * 0.25) * calm;
    // A lake bed stays under the water: only right at the shore does the
    // ground come up through it (no scatter of tiny islands in the shallows).
    if (depth > 0.05) h = Math.min(h, mapH + depth - 0.4 * smooth(0.1, 0.6, depth));
    // A stream running into a lake ends there: it doesn't cut on through the lake bed.
    const intoLake = smooth(0.05, 0.6, depth);
    if (ch && intoLake < 1) {
      const uncut = h;
      const { d, s, r, depth } = ch;
      if (d < r) {
        // A rounded bed, a little rough.
        const k = 1 - (d / r) * (d / r);
        const rough = this.detail2.noise(x / 2.3, z / 2.3) * 0.18 * k;
        h = Math.min(h, s + 0.15 - (depth + 0.15) * k + rough);
      } else {
        // Banks slope down to the water.
        h = Math.min(h, s + 0.15 + (d - r) * 0.55);
      }
      h += (uncut - h) * intoLake;
    }
    return h;
  }

  /** Fresh water surface at a point (river or lake), or NaN. Pass the ground height if known. */
  water(x: number, z: number, ground = this.height(x, z)): number {
    // A lake fills its bed (where a stream has cut a channel far below that,
    // the channel stays a channel: the water doesn't hang over it). Inside a
    // lake its surface wins over a stream running in, which would otherwise
    // lie on top of it at the stream's own level.
    const { mapH, depth } = this.lakeSample(x, z);
    if (depth > 0.05 && ground < mapH + depth && ground > mapH - 1.5) return mapH + depth;
    const ch = this.channel(x, z);
    // Where a river meets the sea, it's the sea.
    if (ch && ch.d < ch.r * 0.97 && ground < ch.s) return ch.sea ? NaN : ch.s;
    return NaN;
  }


  /** Within a few metres of a river or lake. */
  nearWater(x: number, z: number, rv = this.river(x, z)): boolean {
    if (rv && rv.d < rv.r + 3) return true;
    for (const [ox, oz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) if (!Number.isNaN(this.lakeSurface(x + ox, z + oz))) return true;
    return false;
  }

  temperature(x: number, y: number, z: number): number {
    return tempAt(this.field('climBase', x, z), y);
  }

  moisture(x: number, z: number): number {
    return this.field('moist', x, z);
  }

  zone(x: number, z: number, h = this.height(x, z), slope?: number): Zone {
    if (slope === undefined) {
      const e = 1;
      slope = Math.hypot(this.height(x + e, z) - this.height(x - e, z), this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    }
    return zoneOf(this.temperature(x, h, z), this.moisture(x, z), h, SEA, this.nearWater(x, z), slope);
  }

  /**
   * What the ground is made of at a column: the top layer, what lies under
   * it, and how deep soil goes before bedrock (0: bare rock).
   */
  /** What the ground is made of at a point. `w` and `rv` save working out its water and river again, if the caller has them. */
  soil(x: number, z: number, h: number, slope: number, w = this.water(x, z, h), rvb = this.river(x, z)): { top: SoilTop; soil: number; waterBed: boolean } {
    const dep = this.field('dep', x, z);
    const wet = Math.log1p(this.field('flow', x, z));
    const temp = this.temperature(x, h, z);
    let soil = 1.4 + (this.soilN.fbm(x * 0.03, z * 0.03, 2) + 1) * 1.1 + Math.max(0, dep) * 0.5 + Math.min(0, dep) * 0.3;
    // Thin up in the cold, gone on cliffs.
    soil *= clamp01((temp - SNOW_TEMP) / 0.25);
    if (slope > 1.1) soil = 0;
    else if (slope > 0.75) soil *= (1.1 - slope) / 0.35;
    if (!Number.isNaN(w)) {
      const lake = !Number.isNaN(this.lakeSurface(x, z));
      return { top: lake ? 'clay' : rvb && (rvb.r > 4 || slope > 0.3) ? 'gravel' : 'sand', soil: Math.max(soil, 1.2), waterBed: true };
    }
    // Clay along the banks of rivers and lakes; a little creek runs between grassy banks.
    const bigWater = rvb ? rvb.r > 3 && rvb.d < rvb.r + 3 : false;
    const lakeSide = !rvb && this.nearWater(x, z, rvb);
    if ((bigWater || lakeSide) && slope < 0.9 && this.patch.noise(x * 0.15, z * 0.15) > 0.05) return { top: 'clay', soil: Math.max(soil, 1.2), waterBed: false };
    if (soil < 0.4) return { top: 'rock', soil: 0, waterBed: false };
    if (h < SEA + 1.4) return { top: this.patch.noise(x * 0.06, z * 0.06) > 0.4 && h > -2 ? 'clay' : 'sand', soil, waterBed: false };
    // Silt along well-watered valley floors.
    if (h < 40 && wet > 6.2 && dep > 0.3 && slope < 0.35) return { top: 'clay', soil, waterBed: false };
    // Scree below cliffs.
    if (slope > 0.4 && slope < 1.1 && this.mapSlope(x, z) > 0.9) return { top: 'gravel', soil, waterBed: false };
    return { top: 'grass', soil, waterBed: false };
  }
}

export type SoilTop = 'grass' | 'sand' | 'clay' | 'gravel' | 'rock';

/** Which tile a world coordinate falls in. */
export const tileOf = (v: number) => Math.floor(v / TILE);

// ---------- distant land colours (pure, so a worker can make them)
const lin3 = (c: [number, number, number]) => c.map((v) => Math.pow(v, 2.2));
const snowEdge = new Simplex(9137);
/**
 * How much snow lies (0..1) at a point of this temperature and steepness
 * (rise over run). Its lower edge wanders with the lie of the land rather
 * than following a contour, it holds on gentle ground and thins out on steep
 * faces, so crags and buttresses stand dark through the white.
 */
export function snowCover(x: number, z: number, temp: number, slope: number): number {
  const edge = SNOW_TEMP + snowEdge.fbm(x / 170, z / 170, 3) * 0.07;
  return clamp01((edge - temp) / 0.05) * clamp01((0.95 - slope) / 0.4);
}

const LOD = {
  sand: lin3([0.8, 0.72, 0.5]), rock: lin3([0.42, 0.405, 0.385]), grass: lin3([0.33, 0.52, 0.2]),
  snow: lin3([0.93, 0.95, 0.98]), forest: lin3([0.12, 0.24, 0.1]), pines: lin3([0.09, 0.19, 0.11]),
  dry: lin3([0.6, 0.55, 0.27]), lush: lin3([0.22, 0.47, 0.16]), cold: lin3([0.27, 0.4, 0.27]),
};
/** Points along one side of a tile's distant-land mesh (its core, at map resolution). */
export const LOD_N = TILE / CELL + 1;

/**
 * Colours for a tile's distant land, one per core map point: grass by the
 * climate, darker canopy where woods grow, rock on steep ground, snow up high.
 */
export function tileLodColors(d: TileData, layers?: Float32Array): Float32Array {
  const out = new Float32Array(LOD_N * LOD_N * 3);
  const off = PAD / CELL;
  const mix = (c: number[], t: number[], k: number) => { k = clamp01(k); return [c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k, c[2] + (t[2] - c[2]) * k]; };
  for (let lz = 0; lz < LOD_N; lz++) {
    for (let lx = 0; lx < LOD_N; lx++) {
      const ix = lx + off, iz = lz + off, i = iz * TN + ix;
      const h = d.H[i];
      const hx = (d.H[i + 1] - d.H[i - 1]) / (2 * CELL), hz = (d.H[i + TN] - d.H[i - TN]) / (2 * CELL);
      const slope = Math.hypot(hx, hz);
      const temp = tempAt(d.climBase[i], h), moist = d.moist[i];
      // Ridges and spurs stand out from the gullies between them: compare with
      // the ground around (positive on crests), over a wide and a tight ring.
      let ring = 0, near = 0;
      for (const j of [i - 2, i + 2, i - 2 * TN, i + 2 * TN, i - 2 * TN - 2, i - 2 * TN + 2, i + 2 * TN - 2, i + 2 * TN + 2]) ring += d.H[j];
      for (const j of [i - 1, i + 1, i - TN, i + TN]) near += d.H[j];
      const crest = Math.max(-1, Math.min(1, (h - ring / 8) / 6 + (h - near / 4) / 4));
      const x = d.tx * TILE + lx * CELL, z = d.tz * TILE + lz * CELL;
      let c: number[];
      let wSand = 0, wRock = 0;
      if (h < SEA + 1.4) { c = LOD.sand; wSand = 1; }
      else {
        c = LOD.grass;
        c = mix(c, LOD.dry, ((0.42 - moist) / 0.3) * 0.85);
        c = mix(c, LOD.lush, ((moist - 0.55) / 0.3) * 0.7);
        c = mix(c, LOD.cold, ((0.45 - temp) / 0.2) * 0.8);
        let wet = false;
        for (const j of [i, i + 1, i - 1, i + TN, i - TN]) if (d.kind[j]) wet = true;
        const zone = zoneOf(temp, moist, h, SEA, wet, slope);
        if (zone === 'broadleaf') c = mix(c, LOD.forest, 0.65);
        else if (zone === 'conifer') c = mix(c, LOD.pines, 0.75);
        // Bare rock on steep ground, and above the trees on exposed crests too.
        const high = clamp01((0.32 - temp) / 0.12);
        // Rock itself varies: beds of paler and darker stone, and weathered patches.
        const tone = 0.82 + 0.12 * Math.sin(h / 9 + snowEdge.noise(x / 300, z / 300) * 3) + 0.14 * snowEdge.noise(x / 90 + 40, z / 90);
        const rock = [LOD.rock[0] * tone, LOD.rock[1] * tone, LOD.rock[2] * tone];
        wRock = clamp01((slope - 0.7) / 0.45 + high * (crest * 1.5 + (slope - 0.45) / 0.4));
        c = mix(c, rock, wRock);
      }
      // Wind scours snow off the crests and it drifts deep in the gullies.
      const wSnow = snowCover(x, z, temp + crest * 0.03, slope - Math.min(0, crest) * 0.4);
      c = mix(c, LOD.snow, wSnow);
      if (layers) {
        // Ground texture weights (grass, sand, rock, snow) for this point.
        const L = (lz * LOD_N + lx) * 4, keep = 1 - wSnow;
        layers[L] = (1 - wSand) * (1 - wRock) * keep; layers[L + 1] = wSand * keep;
        layers[L + 2] = (1 - wSand) * wRock * keep; layers[L + 3] = wSnow;
      }
      // A touch of light on the crests and shadow in the gullies, as at a distance.
      const shade = 1 + crest * 0.18;
      c = [c[0] * shade, c[1] * shade, c[2] * shade];
      const k = (lz * LOD_N + lx) * 3;
      out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2];
    }
  }
  return out;
}
