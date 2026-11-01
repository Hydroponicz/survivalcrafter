import { erode, slump } from './erosion';
import { latticeKey, NET_CELL, NET_REGION, regionNet } from './network';
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
  /** Lakes on the water network's grid over the map (LW × LW): surface and bed (NaN where none). */
  lakeL: Float32Array; lakeB: Float32Array;
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

/** How far from a river its valley sides can reach at most (metres), where it's cut deep through high ground. */
const VALLEY = 260;

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
  // Lake hollows, as the water network traced them (dug after the
  // weathering, which would silt them up).
  for (let k = 0; k < n; k++) {
    const x = ox + (k % TN) * CELL, z = oz + Math.floor(k / TN) * CELL;
    const dip = base.lakeDip(x, z, H[k]);
    if (dip > 0) H[k] -= dip;
  }
  // The water network over this map, from every region it reaches into.
  const span = TN * CELL, margin = 320;
  const reaches: number[] = [];
  const lakeL = new Float32Array(LW * LW).fill(NaN), lakeB = new Float32Array(LW * LW).fill(NaN);
  const ix0 = ox / NET_CELL, iz0 = oz / NET_CELL;
  for (let rz = Math.floor((oz - margin) / NET_REGION); rz <= Math.floor((oz + span + margin) / NET_REGION); rz++) {
    for (let rx = Math.floor((ox - margin) / NET_REGION); rx <= Math.floor((ox + span + margin) / NET_REGION); rx++) {
      const net = regionNet(base, seed, rx, rz), R = net.reaches;
      for (let k = 0; k < R.length; k += 8) {
        const m = R[k + 6] + margin;
        if (Math.max(R[k], R[k + 2]) < ox - m || Math.min(R[k], R[k + 2]) > ox + span + m) continue;
        if (Math.max(R[k + 1], R[k + 3]) < oz - m || Math.min(R[k + 1], R[k + 3]) > oz + span + m) continue;
        for (let q = 0; q < 8; q++) reaches.push(R[k + q]);
      }
      for (let lz = 0; lz < LW; lz++) for (let lx = 0; lx < LW; lx++) {
        const v = net.lakes.get(latticeKey(ix0 + lx, iz0 + lz));
        if (v) { lakeL[lz * LW + lx] = v[0]; lakeB[lz * LW + lx] = v[1]; }
      }
    }
  }
  const { kind, S } = fitLand(H, ox, oz, reaches, lakeL, lakeB);
  const clim = climate(H, TN, seed, SEA, ox, oz, CELL);
  for (let i = 0; i < n; i++) if (kind[i]) clim.moist[i] = Math.min(1, clim.moist[i] + 0.25);
  return {
    tx, tz, H, dep: er.deposit, flow: er.flow, kind, S,
    climBase: clim.base, moist: clim.moist, reaches: new Float32Array(reaches), wind: clim.wind, lakeL, lakeB,
  };
}

/** Points per side of a tile's lake grid (the water network's grid, over the map with its overlap). */
export const LW = (TILE + 2 * PAD) / NET_CELL + 1;

/**
 * A map point's lake, from the lake grid around it: how much it's under one
 * (0..1, a lake's edge at 0.5), the lake's surface, and its bed there.
 */
function lakeAt(lakeL: Float32Array, lakeB: Float32Array, fx: number, fz: number): { m: number; level: number; bed: number } {
  const ix = Math.max(0, Math.min(LW - 2, Math.floor(fx))), iz = Math.max(0, Math.min(LW - 2, Math.floor(fz)));
  const tx = clamp01(fx - ix), tz = clamp01(fz - iz);
  let m = 0, level = NaN, bed = 0, wb = 0;
  for (const [dx, dz, w] of [[0, 0, (1 - tx) * (1 - tz)], [1, 0, tx * (1 - tz)], [0, 1, (1 - tx) * tz], [1, 1, tx * tz]]) {
    const j = (iz + dz) * LW + ix + dx, l = lakeL[j];
    if (l !== l) continue;
    m += w; bed += lakeB[j] * w; wb += w;
    if (!(level >= l)) level = l;
  }
  return { m, level, bed: wb > 0 ? bed / wb : NaN };
}

/**
 * Shape a map's land to its water, both ways: lake beds and stream channels
 * are cut down below their surfaces, and wherever the land beside them lies
 * too low to hold the water in, it's built up into a bank. Streams cut
 * valleys in proportion to how far they've had to cut down. Returns which
 * cells are under water (1 stream, 2 lake, 3 wide river) and its surface.
 */
function fitLand(H: Float32Array, ox: number, oz: number, R: number[], lakeL: Float32Array, lakeB: Float32Array) {
  const n = TN * TN;
  const kind = new Uint8Array(n), S = new Float32Array(n).fill(NaN);
  // Lakes: beds below the surface, a low bank all round.
  const lakeM = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const { m, level, bed } = lakeAt(lakeL, lakeB, ((i % TN) * CELL) / NET_CELL, (Math.floor(i / TN) * CELL) / NET_CELL);
    lakeM[i] = m;
    if (m <= 0) continue;
    if (m >= 0.5) {
      const floor = level - 0.4 - Math.max(0, level - 0.4 - bed) * smooth(0.5, 1, m);
      if (H[i] > floor) H[i] = floor;
      kind[i] = 2; S[i] = level;
    } else {
      const bank = level + 0.35 + (0.5 - m) * 1.5;
      if (H[i] < bank) H[i] = bank;
    }
  }
  const H0 = H.slice();
  const each = (k: number, extra: number, f: (i: number, d: number, e: number, sf: number) => void) => {
    const ax = R[k], az = R[k + 1], dx = R[k + 2] - ax, dz = R[k + 3] - az, r = R[k + 6];
    const len2 = dx * dx + dz * dz;
    const reach = Math.ceil((r + extra) / CELL) + 1;
    const cx = Math.round((ax + dx / 2 - ox) / CELL), cz = Math.round((az + dz / 2 - oz) / CELL);
    const half = Math.ceil(Math.sqrt(len2) / 2 / CELL);
    for (let iz = cz - reach - half; iz <= cz + reach + half; iz++) {
      if (iz < 0 || iz >= TN) continue;
      for (let ix = cx - reach - half; ix <= cx + reach + half; ix++) {
        if (ix < 0 || ix >= TN) continue;
        const i = iz * TN + ix, x = ox + ix * CELL, z = oz + iz * CELL;
        const t = len2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / len2) : 0;
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (d > r + extra) continue;
        f(i, d, d - r, R[k + 4] + (R[k + 5] - R[k + 4]) * t);
      }
    }
  };
  // Banks first, wherever the land beside a stream lies lower than its water
  // (not out in a lake: there the stream has arrived).
  for (let k = 0; k < R.length; k += 8) {
    each(k, 5, (i, _d, e, sf) => {
      if (lakeM[i] > 0.3) return;
      const bank = sf + 0.3 + Math.max(0, e) * 0.15;
      if (H[i] < bank) H[i] = bank;
    });
  }
  // Then the channels and their valleys: a floodplain beside the water, then
  // valley sides rising at up to about 35°, as wide as the stream has had to
  // cut down through the land; either way the cut eases out to the land around.
  for (let k = 0; k < R.length; k += 8) {
    const r = R[k + 6];
    const mx = Math.max(0, Math.min(TN - 1, Math.round(((R[k] + R[k + 2]) / 2 - ox) / CELL)));
    const mz = Math.max(0, Math.min(TN - 1, Math.round(((R[k + 1] + R[k + 3]) / 2 - oz) / CELL)));
    const fp = Math.min(40, 3 + 2.5 * r), rise = 0.3 + fp * 0.35;
    const cut = Math.max(0, H0[mz * TN + mx] - (R[k + 4] + R[k + 5]) / 2);
    const full = Math.min(VALLEY - 40, fp + Math.max(0, cut - rise) / 0.7);
    const ease = 10 + 30 * Math.min(1, r / 8);
    each(k, full + ease, (i, d, e, sf) => {
      const line = e < 0 ? sf + 0.25 : e < fp ? sf + 0.3 + e * 0.35 : sf + rise + (e - fp) * 0.7;
      const keep = smooth(full, full + ease, e);
      if (H[i] > line) H[i] = line + (H[i] - line) * keep;
      if (d < r && kind[i] !== 2) { kind[i] = r > 4 ? 3 : 1; if (!(S[i] <= sf)) S[i] = sf; }
    });
  }
  return { kind, S };
}

/** A tile ready for sampling: its data plus a lookup of river reaches by map cell. */
class Tile {
  readonly ox: number; readonly oz: number;
  private buckets = new Map<number, number[]>();
  lastUsed = 0;
  constructor(readonly d: TileData) {
    this.ox = d.tx * TILE - PAD;
    this.oz = d.tz * TILE - PAD;
    // Every tile holds the same network where they overlap; each stretch is
    // looked up from the tile it starts in, so it's found once.
    const R = d.reaches, x0 = d.tx * TILE, z0 = d.tz * TILE;
    for (let k = 0; k < R.length / 8; k++) {
      const ax = R[k * 8], az = R[k * 8 + 1];
      if (ax < x0 || ax >= x0 + TILE || az < z0 || az >= z0 + TILE) continue;
      const r = R[k * 8 + 6], len = Math.hypot(R[k * 8 + 2] - ax, R[k * 8 + 3] - az);
      const reach = Math.ceil((r + 12 + len) / CELL) + 1;
      const cx = Math.round((ax - this.ox) / CELL), cz = Math.round((az - this.oz) / CELL);
      for (let oz = -reach; oz <= reach; oz++) for (let ox = -reach; ox <= reach; ox++) {
        const bx = cx + ox, bz = cz + oz;
        if (bx < 0 || bz < 0 || bx >= TN || bz >= TN) continue;
        const key = bz * TN + bx;
        let list = this.buckets.get(key);
        if (!list) this.buckets.set(key, (list = []));
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

  /** The lake at a point (see lakeAt): how much it's under one, and the surface. */
  lake(x: number, z: number) {
    return lakeAt(this.d.lakeL, this.d.lakeB, (x - this.ox) / NET_CELL, (z - this.oz) / NET_CELL);
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
    for (const [t] of this.cover(x, z)) t.river(x, z, best);
    return best.hit && best.edge < 12 ? best.hit : null;
  }

  /**
   * The ground's map height at a point, and how deep a lake stands over it
   * there (0 if none). Every tile holds the same lakes, so the point's own
   * tile says.
   */
  private lakeSample(x: number, z: number): { mapH: number; depth: number } {
    let mapH = 0;
    const cover = this.cover(x, z);
    for (const [t, w] of cover) mapH += t.height(x, z) * w;
    const { m, level } = this.tile(Math.floor(x / TILE), Math.floor(z / TILE)).lake(x, z);
    if (m < 0.5) return { mapH, depth: 0 };
    return { mapH, depth: Math.max(0, level - mapH) };
  }

  /** The surface of a lake at a point, or NaN. */
  lakeSurface(x: number, z: number): number {
    // No lake near: nothing more to work out.
    if (this.tile(Math.floor(x / TILE), Math.floor(z / TILE)).lake(x, z).m < 0.5) return NaN;
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
