import { erode } from './erosion';
import { drainage } from './hydrology';
import { climate, SNOW_TEMP, tempAt, zoneOf, type Zone } from './climate';
import { hash2, Simplex } from './noise';

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
const BLEND = 128;
export const SEA = 0;

/** Catchment (map cells of average rain) where a stream starts. */
const STREAM_AT = 260;

export interface RiverHit { d: number; s: number; r: number; depth: number }

/** One map tile: everything simulated for it, as plain arrays (it can come from a worker). */
export interface TileData {
  tx: number; tz: number;
  H: Float32Array; dep: Float32Array; flow: Float32Array;
  kind: Uint8Array; S: Float32Array;
  climBase: Float32Array; moist: Float32Array;
  /** River reaches, 8 numbers each: ax, az, bx, bz, sa, sb, r, depth (world metres). */
  reaches: Float32Array;
  wind: [number, number];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The raw land before weathering, anywhere: continents and seas, ranges, hills and plains. */
export class BaseLand {
  private cont: Simplex; private warp: Simplex; private range: Simplex; private ridge: Simplex; private hill: Simplex; private low: Simplex;
  constructor(seed: number) {
    this.cont = new Simplex(seed + 10);
    this.warp = new Simplex(seed + 11);
    this.range = new Simplex(seed + 12);
    this.ridge = new Simplex(seed + 13);
    this.hill = new Simplex(seed + 14);
    this.low = new Simplex(seed + 15);
  }

  /** 0 open sea .. 1 inland. Mostly land, with seas, coasts and islands scattered through it. */
  land(x: number, z: number): number {
    const wx = x + this.warp.fbm(x / 1800, z / 1800, 3) * 700, wz = z + this.warp.fbm(x / 1800 + 7, z / 1800, 3) * 700;
    const c = this.cont.fbm(wx / 7000, wz / 7000, 4) + 0.22;
    return smooth(-0.05, 0.14, c);
  }

  height(x: number, z: number): number {
    const land = this.land(x, z);
    const range = smooth(-0.05, 0.45, this.range.fbm(x / 2400 + 3.1, z / 2400, 2));
    const ridge = Math.pow(1 - Math.abs(this.ridge.fbm(x / 800, z / 800, 5)), 2.4);
    const mount = ridge * range * 430 * smooth(0.3, 0.9, land);
    const hills = (this.hill.fbm(x / 380, z / 380, 4) * 0.5 + 0.5) * (25 + 40 * range);
    const plains = 5 + this.low.fbm(x / 1500, z / 1500, 2) * 6;
    return land * (plains + hills + mount) + (1 - land) * -45;
  }
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
  const clim = climate(H, TN, seed, SEA, ox, oz, CELL);
  const dr = drainage(H, TN, SEA, clim.rain, { cell: CELL, streamAt: STREAM_AT, minLake: 8, lakeDepth: 12 });
  for (let i = 0; i < n; i++) if (dr.kind[i]) clim.moist[i] = Math.min(1, clim.moist[i] + 0.25);
  const reaches: number[] = [];
  for (let i = 0; i < n; i++) {
    if (dr.kind[i] !== 1) continue;
    const j = dr.recv[i];
    if (j < 0) continue;
    const s = Math.min(8, Math.log2(dr.catchment[i] / STREAM_AT));
    const sb = Number.isNaN(dr.S[j]) ? SEA : dr.S[j];
    reaches.push(ox + (i % TN) * CELL, oz + Math.floor(i / TN) * CELL, ox + (j % TN) * CELL, oz + Math.floor(j / TN) * CELL,
      dr.S[i], sb, 1.0 + 1.2 * s, 0.5 + 0.35 * s);
  }
  return {
    tx, tz, H, dep: er.deposit, flow: er.flow, kind: dr.kind, S: dr.S,
    climBase: clim.base, moist: clim.moist, reaches: new Float32Array(reaches), wind: clim.wind,
  };
}

/** A tile ready for sampling: its data plus a lookup of river reaches by map cell. */
class Tile {
  readonly ox: number; readonly oz: number;
  private buckets = new Map<number, number[]>();
  lastUsed = 0;
  constructor(readonly d: TileData) {
    this.ox = d.tx * TILE - PAD;
    this.oz = d.tz * TILE - PAD;
    const R = d.reaches;
    for (let k = 0; k < R.length / 8; k++) {
      const r = R[k * 8 + 6];
      const reach = Math.ceil((r + 10) / CELL) + 1;
      const cx = Math.round((R[k * 8] - this.ox) / CELL), cz = Math.round((R[k * 8 + 1] - this.oz) / CELL);
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
      if (edge < best.edge) { best.edge = edge; best.hit = { d, s: R[o + 4] + (R[o + 5] - R[o + 4]) * t, r: R[o + 6], depth: R[o + 7] }; }
    }
  }

  lake(x: number, z: number): number {
    for (let oz = 0; oz <= 1; oz++) for (let ox = 0; ox <= 1; ox++) {
      const jx = Math.floor((x - this.ox) / CELL) + ox, jz = Math.floor((z - this.oz) / CELL) + oz;
      if (jx < 0 || jz < 0 || jx >= TN || jz >= TN) continue;
      const i = jz * TN + jx;
      if (this.d.kind[i] === 2) return this.d.S[i];
    }
    return NaN;
  }
}

/** Builds tiles somewhere else (a worker) and hands them back. */
export interface TileSource {
  request(tx: number, tz: number): void;
}

export class WorldGen {
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
  /** Called when a tile arrives (e.g. to build its distant terrain); `lod` if a worker made its colours. */
  onTile?: (t: TileData, lod?: Float32Array) => void;

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
  addTile(d: TileData, lod?: Float32Array) {
    const key = `${d.tx},${d.tz}`;
    this.pending.delete(key);
    if (this.tiles.has(key)) return;
    this.tiles.set(key, new Tile(d));
    this.wind = d.wind;
    this.onTile?.(d, lod);
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
      this.addTile(buildTile(this.seed, tx, tz, this.base));
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
    for (const [t, w] of this.cover(x, z)) if (w > 0.15) t.river(x, z, best);
    return best.hit && best.edge < 12 ? best.hit : null;
  }

  /** A lake the point lies in (its surface), or NaN. */
  lakeSurface(x: number, z: number): number {
    let best = NaN, bw = 0;
    for (const [t, w] of this.cover(x, z)) {
      if (w <= bw) continue;
      const s = t.lake(x, z);
      if (!Number.isNaN(s) || w > 0.5) { best = s; bw = w; }
    }
    return best;
  }

  // ---------- detail
  /** Ground height at any point: the map plus local relief, with river channels cut in. */
  height(x: number, z: number): number {
    let h = this.mapHeight(x, z);
    const slope = this.mapSlope(x, z);
    // Rugged where the land is steep, gentle in the lowlands.
    const amp = 0.5 + 4.5 * smooth(0.15, 0.9, slope);
    const calm = Number.isNaN(this.lakeSurface(x, z)) ? 1 : 0.25;
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
  soil(x: number, z: number, h: number, slope: number): { top: SoilTop; soil: number; waterBed: boolean } {
    const dep = this.field('dep', x, z);
    const wet = Math.log1p(this.field('flow', x, z));
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

/** Which tile a world coordinate falls in. */
export const tileOf = (v: number) => Math.floor(v / TILE);

// ---------- distant land colours (pure, so a worker can make them)
const lin3 = (c: [number, number, number]) => c.map((v) => Math.pow(v, 2.2));
const LOD = {
  sand: lin3([0.8, 0.72, 0.5]), rock: lin3([0.52, 0.51, 0.49]), grass: lin3([0.33, 0.52, 0.2]),
  snow: lin3([0.93, 0.95, 0.98]), forest: lin3([0.12, 0.24, 0.1]), pines: lin3([0.09, 0.19, 0.11]),
  dry: lin3([0.6, 0.55, 0.27]), lush: lin3([0.22, 0.47, 0.16]), cold: lin3([0.27, 0.4, 0.27]),
};
/** Points along one side of a tile's distant-land mesh (its core, at map resolution). */
export const LOD_N = TILE / CELL + 1;

/**
 * Colours for a tile's distant land, one per core map point: grass by the
 * climate, darker canopy where woods grow, rock on steep ground, snow up high.
 */
export function tileLodColors(d: TileData): Float32Array {
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
      let c: number[];
      if (h < SEA + 1.4) c = LOD.sand;
      else if (slope > 1.25) c = LOD.rock;
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
        c = mix(c, LOD.rock, (slope - 0.75) / 0.5);
      }
      c = mix(c, LOD.snow, ((SNOW_TEMP + 0.04 - temp) / 0.06) * clamp01((1.6 - slope) / 0.5));
      const k = (lz * LOD_N + lx) * 3;
      out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2];
    }
  }
  return out;
}
