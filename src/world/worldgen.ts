import { erode } from './erosion';
import { drainage } from './hydrology';
import { climate, SNOW_TEMP, tempAt, zoneOf, type Zone } from './climate';
import { Simplex } from './noise';

// The world, generated in two layers.
//
// The map: a 4 km continent on an 8 m grid, made once when the world is
// created. Mountain ranges hundreds of metres high, weathered by simulated
// rain, drained by rivers into lakes and the sea, with a climate from the
// prevailing wind. Big, slow, and cheap enough to hold in memory.
//
// The detail: anywhere you look closely, the ground is sampled from the map
// (smoothly interpolated) plus metre-scale relief, with river channels carved
// along the map's river lines. This is what the voxel terrain is built from,
// a piece at a time around you.

export const MAP_N = 513;
export const CELL = 8;
export const WORLD_SIZE = (MAP_N - 1) * CELL; // 4096 m
export const SEA = 0;

/** Catchment (map cells of average rain) where a stream starts. */
const STREAM_AT = 260;

/** One reach of river between two map cells. */
interface Reach { ax: number; az: number; bx: number; bz: number; sa: number; sb: number; r: number; depth: number }

export interface RiverHit { d: number; s: number; r: number; depth: number }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export class WorldGen {
  readonly seed: number;
  /** Map heights (eroded, lake beds scooped). */
  H: Float32Array;
  /** Net sediment change from erosion (+ settled, - stripped). */
  dep: Float32Array;
  /** Water that ran through each cell during erosion (log scale later). */
  flow: Float32Array;
  /** 0 dry, 1 river, 2 lake; and the water surface of each. */
  kind: Uint8Array;
  S: Float32Array;
  catchment: Float32Array;
  /** Climate: base temperature (before height) and wetness per cell. */
  climBase: Float32Array;
  moist: Float32Array;
  wind: [number, number];

  private reaches: Reach[] = [];
  /** Reaches near each map cell. */
  private buckets = new Map<number, number[]>();
  private detail: Simplex;
  private detail2: Simplex;
  private soilN: Simplex;
  private patch: Simplex;

  constructor(seed: number) {
    this.seed = seed;
    this.detail = new Simplex(seed + 501);
    this.detail2 = new Simplex(seed + 502);
    this.soilN = new Simplex(seed + 99);
    this.patch = new Simplex(seed + 17);
    const n = MAP_N * MAP_N;
    const H = new Float32Array(n);
    const warp = new Simplex(seed + 11);
    const rangeN = new Simplex(seed + 12);
    const ridgeN = new Simplex(seed + 13);
    const hillN = new Simplex(seed + 14);
    const lowN = new Simplex(seed + 15);
    const c = WORLD_SIZE / 2;
    for (let iz = 0; iz < MAP_N; iz++) {
      for (let ix = 0; ix < MAP_N; ix++) {
        const x = ix * CELL, z = iz * CELL;
        // A continent with a ragged coast.
        const dx = (x - c) / c, dz = (z - c) / c;
        const d = Math.sqrt(dx * dx + dz * dz) + warp.fbm(x / 900, z / 900, 3) * 0.28;
        const land = smooth(0.98, 0.7, d);
        // Mountain ranges: sharp ridges, only where the range noise says so.
        const range = smooth(-0.05, 0.45, rangeN.fbm(x / 2400 + 3.1, z / 2400, 2));
        const ridge = Math.pow(1 - Math.abs(ridgeN.fbm(x / 800, z / 800, 5)), 2.4);
        const mount = ridge * range * 430;
        const hills = (hillN.fbm(x / 380, z / 380, 4) * 0.5 + 0.5) * (25 + 40 * range);
        const plains = 5 + lowN.fbm(x / 1500, z / 1500, 2) * 6;
        H[iz * MAP_N + ix] = land * (plains + hills + mount) + (1 - land) * -45;
      }
    }
    // Weathering, then rain, then drainage.
    const er = erode(H, MAP_N, seed, SEA, {
      drops: 170000, maxSteps: 90, inertia: 0.05, capacity: 6, minCapacity: 0.01, erodeRate: 0.32,
      depositRate: 0.28, evaporation: 0.012, gravity: 4, radius: 2, maxDig: 3,
    });
    this.dep = er.deposit;
    this.flow = er.flow;
    const clim = climate(H, MAP_N, seed, SEA);
    this.climBase = clim.base;
    this.moist = clim.moist;
    this.wind = clim.wind;
    const dr = drainage(H, MAP_N, SEA, clim.rain, { cell: CELL, streamAt: STREAM_AT, minLake: 8, lakeDepth: 12 });
    this.H = H;
    this.kind = dr.kind;
    this.S = dr.S;
    this.catchment = dr.catchment;
    // Land by water stays damp.
    for (let i = 0; i < n; i++) if (dr.kind[i]) this.moist[i] = Math.min(1, this.moist[i] + 0.25);

    // River reaches: each river cell to the cell it drains into.
    for (let i = 0; i < n; i++) {
      if (dr.kind[i] !== 1) continue;
      const j = dr.recv[i];
      if (j < 0) continue;
      const s = Math.min(8, Math.log2(dr.catchment[i] / STREAM_AT));
      const r = 1.0 + 1.2 * s, depth = 0.5 + 0.35 * s;
      const sb = Number.isNaN(dr.S[j]) ? SEA : dr.S[j];
      const reach: Reach = {
        ax: (i % MAP_N) * CELL, az: Math.floor(i / MAP_N) * CELL, bx: (j % MAP_N) * CELL, bz: Math.floor(j / MAP_N) * CELL,
        sa: dr.S[i], sb, r, depth,
      };
      const k = this.reaches.push(reach) - 1;
      const reachCells = Math.ceil((r + 10) / CELL) + 1;
      const cx = i % MAP_N, cz = Math.floor(i / MAP_N);
      for (let oz = -reachCells; oz <= reachCells; oz++) for (let ox = -reachCells; ox <= reachCells; ox++) {
        const bx = cx + ox, bz = cz + oz;
        if (bx < 0 || bz < 0 || bx >= MAP_N || bz >= MAP_N) continue;
        const key = bz * MAP_N + bx;
        let list = this.buckets.get(key);
        if (!list) this.buckets.set(key, (list = []));
        list.push(k);
      }
    }
  }

  // ---------- map sampling
  private at(a: Float32Array, ix: number, iz: number) {
    ix = ix < 0 ? 0 : ix >= MAP_N ? MAP_N - 1 : ix;
    iz = iz < 0 ? 0 : iz >= MAP_N ? MAP_N - 1 : iz;
    return a[iz * MAP_N + ix];
  }

  /** Bilinear sample of a map field at world (x, z). */
  lerp(a: Float32Array, x: number, z: number): number {
    const fx = x / CELL, fz = z / CELL;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const a00 = this.at(a, ix, iz), a10 = this.at(a, ix + 1, iz), a01 = this.at(a, ix, iz + 1), a11 = this.at(a, ix + 1, iz + 1);
    return (a00 + (a10 - a00) * tx) * (1 - tz) + (a01 + (a11 - a01) * tx) * tz;
  }

  /** Smooth (Catmull-Rom) map height, so slopes don't show the 8 m grid. */
  mapHeight(x: number, z: number): number {
    const fx = x / CELL, fz = z / CELL;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const row = (dz: number) => cr(this.at(this.H, ix - 1, iz + dz), this.at(this.H, ix, iz + dz), this.at(this.H, ix + 1, iz + dz), this.at(this.H, ix + 2, iz + dz), tx);
    return cr(row(-1), row(0), row(1), row(2), tz);
  }

  /** Steepness of the map (rise per metre) around a point. */
  mapSlope(x: number, z: number): number {
    const gx = (this.lerp(this.H, x + CELL, z) - this.lerp(this.H, x - CELL, z)) / (2 * CELL);
    const gz = (this.lerp(this.H, x, z + CELL) - this.lerp(this.H, x, z - CELL)) / (2 * CELL);
    return Math.hypot(gx, gz);
  }

  /** The nearest river reach to a point, if one is close enough to matter. */
  river(x: number, z: number): RiverHit | null {
    const ix = Math.round(x / CELL), iz = Math.round(z / CELL);
    const list = this.buckets.get(iz * MAP_N + ix);
    if (!list) return null;
    let best: RiverHit | null = null, bestEdge = Infinity;
    for (const k of list) {
      const R = this.reaches[k];
      const dx = R.bx - R.ax, dz = R.bz - R.az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? clamp01(((x - R.ax) * dx + (z - R.az) * dz) / len2) : 0;
      const d = Math.hypot(x - (R.ax + dx * t), z - (R.az + dz * t));
      const edge = d - R.r;
      if (edge < bestEdge) { bestEdge = edge; best = { d, s: R.sa + (R.sb - R.sa) * t, r: R.r, depth: R.depth }; }
    }
    return best && bestEdge < 12 ? best : null;
  }

  /** A lake the point lies in (its surface), or NaN. */
  lakeSurface(x: number, z: number): number {
    for (let oz = 0; oz <= 1; oz++) for (let ox = 0; ox <= 1; ox++) {
      const jx = Math.floor(x / CELL) + ox, jz = Math.floor(z / CELL) + oz;
      if (jx < 0 || jz < 0 || jx >= MAP_N || jz >= MAP_N) continue;
      const i = jz * MAP_N + jx;
      if (this.kind[i] === 2) return this.S[i];
    }
    return NaN;
  }

  // ---------- detail
  /** Ground height at any point: the map plus local relief, with river channels cut in. */
  height(x: number, z: number): number {
    let h = this.mapHeight(x, z);
    const slope = this.mapSlope(x, z);
    // Rugged where the land is steep, gentle in the lowlands.
    const amp = 0.5 + 4.5 * smooth(0.15, 0.9, slope);
    const lake = this.lakeSurface(x, z);
    const calm = Number.isNaN(lake) ? 1 : 0.25;
    h += (this.detail.fbm(x / 26, z / 26, 4) * amp + this.detail2.fbm(x / 7, z / 7, 2) * amp * 0.25) * calm;
    const rv = this.river(x, z);
    if (rv) {
      const { d, s, r, depth } = rv;
      if (d < r) {
        const k = 1 - (d / r) * (d / r);
        h = Math.min(h, s + 0.15 - (depth + 0.15) * k);
      } else {
        // Banks slope down to the water; a slight levee keeps it in.
        h = Math.min(h, s + 0.15 + (d - r) * 0.55);
        if (d < r + 1.5) h = Math.max(h, s + 0.12);
      }
    }
    return h;
  }

  /** Fresh water surface at a point (river or lake), or NaN. Pass the ground height if known. */
  water(x: number, z: number, ground = this.height(x, z)): number {
    const rv = this.river(x, z);
    if (rv && rv.d < rv.r * 0.97 && ground < rv.s) return rv.s;
    const lake = this.lakeSurface(x, z);
    if (!Number.isNaN(lake) && ground < lake) return lake;
    return NaN;
  }

  /** Within a few metres of a river or lake. */
  nearWater(x: number, z: number): boolean {
    const rv = this.river(x, z);
    if (rv && rv.d < rv.r + 3) return true;
    for (const [ox, oz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) if (!Number.isNaN(this.lakeSurface(x + ox, z + oz))) return true;
    return false;
  }

  temperature(x: number, y: number, z: number): number {
    return tempAt(this.lerp(this.climBase, x, z), y);
  }

  moisture(x: number, z: number): number {
    return this.lerp(this.moist, x, z);
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
  soil(x: number, z: number, h: number, slope: number): { top: SoilTop; soil: number; waterBed: boolean } {
    const dep = this.lerp(this.dep, x, z);
    const wet = Math.log1p(this.lerp(this.flow, x, z));
    const temp = this.temperature(x, h, z);
    let soil = 1.4 + (this.soilN.fbm(x * 0.03, z * 0.03, 2) + 1) * 1.1 + Math.max(0, dep) * 0.5 + Math.min(0, dep) * 0.3;
    // Thin up in the cold, gone on cliffs.
    soil *= clamp01((temp - SNOW_TEMP) / 0.25);
    if (slope > 1.1) soil = 0;
    else if (slope > 0.75) soil *= (1.1 - slope) / 0.35;
    const w = this.water(x, z, h);
    if (!Number.isNaN(w)) {
      const lake = !Number.isNaN(this.lakeSurface(x, z));
      const rv = this.river(x, z);
      return { top: lake ? 'clay' : rv && (rv.r > 4 || slope > 0.3) ? 'gravel' : 'sand', soil: Math.max(soil, 1.2), waterBed: true };
    }
    if (this.nearWater(x, z) && slope < 0.9 && this.patch.noise(x * 0.15, z * 0.15) > 0.05) return { top: 'clay', soil: Math.max(soil, 1.2), waterBed: false };
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

/** Make the world map (a couple of seconds). */
export function makeWorld(seed: number): WorldGen {
  return new WorldGen(seed);
}

