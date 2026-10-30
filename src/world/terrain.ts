import * as THREE from 'three';
import { hash2, Simplex } from './noise';
import { SNOW_TEMP, type Zone } from './climate';
import { Rock, Strata } from './geology';
import { SEA, WorldGen, type SoilTop } from './worldgen';

// Voxel terrain, streamed. Density lives on a 1 m grid of points (0..255,
// solid at >= 128) and is meshed with Surface Nets, so the ground is smooth
// but can be dug, filled, levelled and tunnelled in any direction.
//
// The world is kilometres across, so the grid is only ever held in pieces:
// 16³ chunks are generated from the world map (worldgen.ts) the first time
// anything touches them, meshed while they're near you and forgotten again
// when you leave, unless you changed them. Only changed chunks are saved.

export const Y_MIN = -64;
export const Y_MAX = 512;
export const WATER_LEVEL = SEA;
export const CH = 16; // points per chunk edge
export const ISO = 128;
/** How far around you the voxel terrain is meshed (beyond it the distant terrain takes over). */
export const MESH_RADIUS = 128;

const NCY = (Y_MAX - Y_MIN) / CH;

export enum Mat { Air = 0, Grass = 1, Dirt = 2, Sand = 3, Clay = 4, Rock = 5, Iron = 6, Field = 7, Sandstone = 8, Shale = 9, Gravel = 10 }

export const MAT_NAMES: Record<Mat, string> = {
  [Mat.Air]: 'Air', [Mat.Grass]: 'Grass', [Mat.Dirt]: 'Dirt', [Mat.Sand]: 'Sand', [Mat.Clay]: 'Clay',
  [Mat.Rock]: 'Granite', [Mat.Iron]: 'Ironstone', [Mat.Field]: 'Field',
  [Mat.Sandstone]: 'Sandstone', [Mat.Shale]: 'Shale', [Mat.Gravel]: 'Gravel',
};

/** What each kind of bedrock is as a terrain material. */
const ROCK_MAT: Record<Rock, Mat> = { [Rock.Granite]: Mat.Rock, [Rock.Sandstone]: Mat.Sandstone, [Rock.Shale]: Mat.Shale, [Rock.Ironstone]: Mat.Iron };
const TOP_MAT: Record<SoilTop, Mat> = { grass: Mat.Grass, sand: Mat.Sand, clay: Mat.Clay, gravel: Mat.Gravel, rock: Mat.Rock };

/** Materials a shovel can move. Rock and ore need a pickaxe. */
export const isSoft = (m: Mat) => m === Mat.Grass || m === Mat.Dirt || m === Mat.Sand || m === Mat.Clay || m === Mat.Field || m === Mat.Gravel;
/** Bedrock of any kind (needs a pickaxe). */
export const isRock = (m: Mat) => m === Mat.Rock || m === Mat.Iron || m === Mat.Sandstone || m === Mat.Shale;

const SRGB: Record<Mat, [number, number, number]> = {
  [Mat.Air]: [1, 0, 1],
  [Mat.Grass]: [0.33, 0.52, 0.2],
  [Mat.Dirt]: [0.45, 0.33, 0.22],
  [Mat.Sand]: [0.8, 0.72, 0.5],
  [Mat.Clay]: [0.58, 0.5, 0.45],
  [Mat.Rock]: [0.52, 0.51, 0.49],
  [Mat.Iron]: [0.55, 0.36, 0.26],
  [Mat.Field]: [0.33, 0.23, 0.15],
  [Mat.Sandstone]: [0.6, 0.54, 0.45],
  [Mat.Shale]: [0.42, 0.42, 0.44],
  [Mat.Gravel]: [0.6, 0.57, 0.52],
};
const lin = (c: [number, number, number]) => c.map((v) => Math.pow(v, 2.2));
/** Grass in a dry spell, at its lushest, and up in the cold. */
const GRASS_DRY = lin([0.6, 0.55, 0.27]), GRASS_LUSH = lin([0.22, 0.47, 0.16]), GRASS_COLD = lin([0.27, 0.4, 0.27]);
const SNOW = lin([0.93, 0.95, 0.98]);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const tmpCol = [0, 0, 0];
export const LIN = Object.fromEntries(Object.entries(SRGB).map(([k, c]) => [k, c.map((v) => Math.pow(v, 2.2))])) as unknown as Record<Mat, number[]>;

export type Volumes = Partial<Record<Mat, number>>;

/** A 16³ block of grid points. */
class Chunk {
  constructor(public d: Uint8Array, public m: Uint8Array, public shared = false) {}
}
/** Every all-air chunk is this one (never written: edits copy it first). */
const AIR = new Chunk(new Uint8Array(CH * CH * CH), new Uint8Array(CH * CH * CH), true);

/** What the generator says about one 16×16 column of points (plus a one-point border). */
interface ColInfo {
  /** Surface height per point, 18×18 from (x0-1, z0-1). */
  h: Float32Array;
  water: Float32Array;
  soil: Float32Array;
  top: Uint8Array;
  under: Uint8Array;
  fold: Float32Array;
  minH: number;
  maxH: number;
}
const CI = CH + 2;

// Chunk and column keys pack unbounded coordinates into one safe integer:
// columns within about ±16,000 km of the origin, and the chunk's level above.
const OFF = 2 ** 20, SPAN = 2 ** 21, LEVEL = SPAN * SPAN;
const colKey = (cx: number, cz: number) => (cz + OFF) * SPAN + cx + OFF;
const chunkId = (cx: number, cy: number, cz: number) => cy * LEVEL + colKey(cx, cz);
const keyCx = (key: number) => (key % LEVEL) % SPAN - OFF;
const keyCz = (key: number) => Math.floor((key % LEVEL) / SPAN) - OFF;
const keyCy = (id: number) => Math.floor(id / LEVEL);
const colOf = (id: number) => id % LEVEL;
const cOf = (v: number) => Math.floor(v / CH);
const cyOf = (y: number) => Math.max(0, Math.min(NCY - 1, Math.floor((y - Y_MIN) / CH)));

export class Terrain {
  seed: number;
  gen!: WorldGen;
  group = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  private cols = new Map<number, ColInfo>();
  /** Point heights where you've changed the ground, per column (overrides the generator). */
  private heightEdits = new Map<number, Float32Array>();
  private edited = new Set<number>();
  private meshes = new Map<number, THREE.Mesh>();
  private waterMeshes = new Map<number, THREE.Mesh>();
  private dirty = new Set<number>();
  private material: THREE.MeshStandardMaterial;
  waterMaterial: THREE.Material | null = null;
  private strata!: Strata;
  private cave!: Simplex;
  private ore!: Simplex;
  /** Chunks to mesh around you, nearest first (recomputed as you move). */
  private wanted: { id: number; dist: number }[] = [];
  private wantedAt = { x: NaN, z: NaN, y: NaN };
  /** All terrain within this distance of the last centre is meshed. */
  readyRadius = 0;
  /** Where the meshed terrain is centred. */
  get meshCentre() { return this.wantedAt; }

  constructor(seed: number) {
    this.seed = seed;
    this.material = makeTerrainMaterial();
  }

  /** Build the world map (a few seconds). */
  generate() {
    this.gen = new WorldGen(this.seed);
    this.strata = new Strata(this.seed);
    this.cave = new Simplex(this.seed + 333);
    this.ore = new Simplex(this.seed ^ 0x5eed);
  }

  get wind(): [number, number] { return this.gen.wind; }

  // ---------- generation of pieces
  private colInfo(cx: number, cz: number): ColInfo {
    const key = colKey(cx, cz);
    let ci = this.cols.get(key);
    if (ci) return ci;
    const g = this.gen;
    const x0 = cx * CH - 1, z0 = cz * CH - 1;
    const n = CI * CI;
    const h = new Float32Array(n);
    for (let k = 0; k < n; k++) h[k] = g.height(x0 + (k % CI), z0 + Math.floor(k / CI));
    const water = new Float32Array(n), soil = new Float32Array(n), fold = new Float32Array(n);
    const top = new Uint8Array(n), under = new Uint8Array(n);
    let minH = Infinity, maxH = -Infinity;
    for (let k = 0; k < n; k++) {
      const lx = k % CI, lz = Math.floor(k / CI);
      const x = x0 + lx, z = z0 + lz;
      const hx = (lx > 0 && lx < CI - 1 ? h[k + 1] - h[k - 1] : 0) / 2, hz = (lz > 0 && lz < CI - 1 ? h[k + CI] - h[k - CI] : 0) / 2;
      const slope = Math.hypot(hx, hz);
      const s = g.soil(x, z, h[k], slope);
      water[k] = g.water(x, z, h[k]);
      soil[k] = s.soil;
      top[k] = TOP_MAT[s.top];
      under[k] = s.top === 'sand' || s.top === 'clay' || s.top === 'gravel' ? top[k] : Mat.Dirt;
      fold[k] = this.strata.foldAt(x, z);
      minH = Math.min(minH, h[k]); maxH = Math.max(maxH, h[k]);
    }
    ci = { h, water, soil, top, under, fold, minH, maxH };
    this.cols.set(key, ci);
    return ci;
  }

  private generateChunk(cx: number, cy: number, cz: number): Chunk {
    const ci = this.colInfo(cx, cz);
    const y0 = Y_MIN + cy * CH;
    if (y0 > ci.maxH + 1.5) return AIR;
    const d = new Uint8Array(CH * CH * CH), m = new Uint8Array(CH * CH * CH);
    for (let lz = 0; lz < CH; lz++) {
      for (let lx = 0; lx < CH; lx++) {
        const k = (lz + 1) * CI + lx + 1;
        const h = ci.h[k], soil = ci.soil[k], top = ci.top[k] as Mat, under = ci.under[k] as Mat, fold = ci.fold[k];
        const x = cx * CH + lx, z = cz * CH + lz;
        for (let ly = 0; ly < CH; ly++) {
          const y = y0 + ly;
          const depth = h - y;
          let dens = Math.max(0, Math.min(1, depth + 0.5));
          if (dens <= 0) break; // everything above is air
          let mat: Mat;
          if (depth < soil && top !== Mat.Rock) mat = depth < 1 ? top : under;
          else {
            mat = ROCK_MAT[this.strata.at(x, y, z, fold)];
            // A few iron veins cut the granite deep down, too.
            if (mat === Mat.Rock && depth > 6 && this.ore.noise3(x * 0.09, y * 0.09, z * 0.09) > 0.72) mat = Mat.Iron;
          }
          // Winding caves through the hills, above sea level so they stay dry.
          if (y > 2 && depth > 4 && depth < 60) {
            const a = this.cave.noise3(x * 0.045, y * 0.07, z * 0.045);
            if (Math.abs(a) < 0.09) {
              const b = this.cave.noise3(x * 0.045 + 100, y * 0.07, z * 0.045);
              const c = Math.max(Math.abs(a), Math.abs(b)) / 0.09;
              if (c < 1.3) dens = Math.min(dens, Math.max(0, Math.min(1, (c - 1) * 3 + 0.5)));
            }
          }
          const i = (ly * CH + lz) * CH + lx;
          d[i] = Math.round(dens * 255);
          m[i] = mat;
        }
      }
    }
    return new Chunk(d, m);
  }

  private chunk(cx: number, cy: number, cz: number): Chunk {
    const id = chunkId(cx, cy, cz);
    let c = this.chunks.get(id);
    if (!c) { c = this.generateChunk(cx, cy, cz); this.chunks.set(id, c); }
    return c;
  }

  /** A chunk you're about to change (copies the shared empty chunk first). */
  private writable(cx: number, cy: number, cz: number): Chunk {
    let c = this.chunk(cx, cy, cz);
    if (c.shared) {
      c = new Chunk(new Uint8Array(CH * CH * CH), new Uint8Array(CH * CH * CH));
      this.chunks.set(chunkId(cx, cy, cz), c);
    }
    return c;
  }

  // ---------- sampling
  /** Density at an integer grid point. */
  d(x: number, y: number, z: number): number {
    if (y < Y_MIN) return 255;
    if (y >= Y_MAX) return 0;
    const yi = y - Y_MIN;
    const c = this.chunk(x >> 4, yi >> 4, z >> 4);
    return c.d[((yi & 15) * CH + (z & 15)) * CH + (x & 15)];
  }

  m(x: number, y: number, z: number): Mat {
    if (y < Y_MIN) return Mat.Rock;
    if (y >= Y_MAX) return Mat.Air;
    const yi = y - Y_MIN;
    const c = this.chunk(x >> 4, yi >> 4, z >> 4);
    return c.m[((yi & 15) * CH + (z & 15)) * CH + (x & 15)];
  }

  /** Trilinear density at any world position. */
  sample(x: number, y: number, z: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const c000 = this.d(x0, y0, z0), c100 = this.d(x0 + 1, y0, z0);
    const c010 = this.d(x0, y0 + 1, z0), c110 = this.d(x0 + 1, y0 + 1, z0);
    const c001 = this.d(x0, y0, z0 + 1), c101 = this.d(x0 + 1, y0, z0 + 1);
    const c011 = this.d(x0, y0 + 1, z0 + 1), c111 = this.d(x0 + 1, y0 + 1, z0 + 1);
    const a = c000 + (c100 - c000) * fx, b = c010 + (c110 - c010) * fx;
    const c = c001 + (c101 - c001) * fx, e = c011 + (c111 - c011) * fx;
    const f = a + (b - a) * fy, g = c + (e - c) * fy;
    return f + (g - f) * fz;
  }

  solidAt(x: number, y: number, z: number): boolean {
    return this.sample(x, y, z) >= ISO;
  }

  /** Material of the solid ground at (or just inside) a point. */
  materialAt(x: number, y: number, z: number): Mat {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    // The solid corner nearest the point, i.e. the surface layer rather than what lies beneath.
    let best = Infinity, mat = Mat.Air;
    for (let k = 0; k < 8; k++) {
      const px = x0 + (k & 1), py = y0 + ((k >> 1) & 1), pz = z0 + ((k >> 2) & 1);
      if (this.d(px, py, pz) < ISO) continue;
      const dist = Math.hypot(px - x, py - y, pz - z);
      if (dist < best) { best = dist; mat = this.m(px, py, pz); }
    }
    if (mat === Mat.Air) return this.m(Math.round(x), Math.floor(y), Math.round(z)) || Mat.Dirt;
    return mat;
  }

  /** Surface height at an integer point (your changes, else the generator's). */
  private ph(x: number, z: number): number {
    const cx = x >> 4, cz = z >> 4;
    const ed = this.heightEdits.get(colKey(cx, cz));
    if (ed) return ed[(z & 15) * CH + (x & 15)];
    return this.colInfo(cx, cz).h[((z & 15) + 1) * CI + (x & 15) + 1];
  }

  /** Height of the topmost surface (ignores caves), bilinear between points. */
  heightAt(x: number, z: number): number {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const a = this.ph(x0, z0), b = this.ph(x0 + 1, z0), c = this.ph(x0, z0 + 1), e = this.ph(x0 + 1, z0 + 1);
    return (a + (b - a) * fx) * (1 - fz) + (c + (e - c) * fx) * fz;
  }

  /** Water surface at a point: a river or lake if there is one, else the sea. */
  waterAt(x: number, z: number): number {
    const w = this.freshWater(x, z);
    return Number.isNaN(w) ? WATER_LEVEL : Math.max(WATER_LEVEL, w);
  }

  private freshWater(x: number, z: number): number {
    const ix = Math.round(x), iz = Math.round(z);
    return this.colInfo(ix >> 4, iz >> 4).water[((iz & 15) + 1) * CI + (ix & 15) + 1];
  }

  /** Is there running (river, not lake) water here? */
  riverAt(x: number, z: number): boolean {
    return !Number.isNaN(this.freshWater(x, z)) && Number.isNaN(this.gen.lakeSurface(x, z));
  }

  /** Is there fresh (river or lake) water here? */
  freshWaterAt(x: number, z: number): boolean {
    return !Number.isNaN(this.freshWater(x, z));
  }

  /** Within a few metres of a river or lake. */
  nearWaterAt(x: number, z: number): boolean {
    return this.gen.nearWater(x, z);
  }

  temperatureAt(x: number, y: number, z: number): number {
    return this.gen.temperature(x, y, z);
  }

  moistureAt(x: number, z: number): number {
    return this.gen.moisture(x, z);
  }

  /** What grows here, from climate and the lie of the land. */
  zoneAt(x: number, z: number): Zone {
    const h = this.heightAt(x, z);
    const slope = Math.hypot(this.heightAt(x + 1, z) - this.heightAt(x - 1, z), this.heightAt(x, z + 1) - this.heightAt(x, z - 1)) / 2;
    return this.gen.zone(x, z, h, slope);
  }

  /**
   * Linear colour of a material at a point: grass shows the climate (straw
   * where dry, deep green where wet, dark up high) and snow lies on cold,
   * gentle ground. `ny` is the surface normal's up component.
   */
  surfaceColor(m: Mat, x: number, y: number, z: number, ny: number, out: number[] = [0, 0, 0]): number[] {
    const base = LIN[m] ?? LIN[Mat.Dirt];
    let r = base[0], g = base[1], b = base[2];
    const temp = this.gen.temperature(x, y, z);
    const mix = (c: number[], k: number) => { if (k <= 0) return; r += (c[0] - r) * k; g += (c[1] - g) * k; b += (c[2] - b) * k; };
    if (m === Mat.Grass) {
      const mo = this.gen.moisture(x, z);
      mix(GRASS_DRY, clamp01((0.42 - mo) / 0.3) * 0.85);
      mix(GRASS_LUSH, clamp01((mo - 0.55) / 0.3) * 0.7);
      mix(GRASS_COLD, clamp01((0.45 - temp) / 0.2) * 0.8);
    }
    mix(SNOW, clamp01((SNOW_TEMP + 0.03 - temp) / 0.05) * clamp01((ny - 0.45) / 0.25));
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }

  /** The top layer at a point as generated (or as you've left it, where you've dug). Cheap. */
  topAt(x: number, z: number): Mat {
    const ix = Math.round(x), iz = Math.round(z);
    if (this.heightEdits.has(colKey(ix >> 4, iz >> 4))) return this.surfaceMaterial(x, z);
    const ci = this.colInfo(ix >> 4, iz >> 4);
    const k = ((iz & 15) + 1) * CI + (ix & 15) + 1;
    return ci.soil[k] <= 0 ? Mat.Rock : (ci.top[k] as Mat);
  }

  /** The bedrock at a point, ignoring soil and anything you've dug (cheap: no voxels). */
  bedrockAt(x: number, y: number, z: number): Mat {
    return ROCK_MAT[this.strata.at(x, y, z)];
  }

  surfaceMaterial(x: number, z: number): Mat {
    return this.materialAt(x, this.heightAt(x, z) - 0.3, z);
  }

  normalAt(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 0.5;
    out.set(
      this.sample(x - e, y, z) - this.sample(x + e, y, z),
      this.sample(x, y - e, z) - this.sample(x, y + e, z),
      this.sample(x, y, z - e) - this.sample(x, y, z + e),
    );
    if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
    return out.normalize();
  }

  /**
   * The ground surface below a point (works inside caves and under overhangs).
   * Returns -Infinity if there is nothing below.
   */
  groundBelow(x: number, y: number, z: number): number {
    if (this.solidAt(x, y, z)) {
      for (let k = 1; k <= 8; k++) {
        if (!this.solidAt(x, y + k * 0.15, z)) return this.refine(x, y + (k - 1) * 0.15, y + k * 0.15, z);
      }
      return y + 1.2;
    }
    // Skip straight down to just above the surface when we're high above it.
    let yy = Math.min(y, Math.max(this.heightAt(x, z) + 2, Y_MIN));
    if (yy < y && this.solidAt(x, yy, z)) yy = y;
    while (yy > Y_MIN) {
      const next = yy - 0.25;
      if (this.solidAt(x, next, z)) return this.refine(x, next, yy, z);
      yy = next;
    }
    return -Infinity;
  }

  private refine(x: number, lo: number, hi: number, z: number): number {
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if (this.solidAt(x, mid, z)) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Re-measure the surface at points you've changed. */
  private updateHeights(x0: number, z0: number, x1: number, z1: number) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const key = colKey(x >> 4, z >> 4);
        let ed = this.heightEdits.get(key);
        if (!ed) {
          const ci = this.colInfo(x >> 4, z >> 4);
          ed = new Float32Array(CH * CH);
          for (let k = 0; k < CH * CH; k++) ed[k] = ci.h[(Math.floor(k / CH) + 1) * CI + (k % CH) + 1];
          this.heightEdits.set(key, ed);
        }
        ed[(z & 15) * CH + (x & 15)] = this.columnHeight(x, z, ed[(z & 15) * CH + (x & 15)]);
      }
    }
  }

  /** Topmost surface at a point, scanning down from a little above the old one. */
  private columnHeight(x: number, z: number, near: number): number {
    for (let y = Math.min(Y_MAX - 1, Math.ceil(near) + 40); y > Y_MIN; y--) {
      const d = this.d(x, y - 1, z);
      if (d >= ISO) {
        const above = this.d(x, y, z);
        const t = (d - ISO) / Math.max(1, d - above);
        return y - 1 + Math.min(1, t);
      }
    }
    return Y_MIN;
  }

  // ---------- editing
  private forPoints(cx: number, cy: number, cz: number, r: number, fn: (c: Chunk, i: number, x: number, y: number, z: number, dist: number) => void) {
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
    const y0 = Math.max(Y_MIN + 1, Math.floor(cy - r)), y1 = Math.min(Y_MAX - 1, Math.ceil(cy + r));
    const z0 = Math.floor(cz - r), z1 = Math.ceil(cz + r);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const dist = Math.hypot(x - cx, y - cy, z - cz);
          if (dist > r) continue;
          const yi = y - Y_MIN;
          fn(this.writable(x >> 4, yi >> 4, z >> 4), ((yi & 15) * CH + (z & 15)) * CH + (x & 15), x, y, z, dist);
        }
      }
    }
    return () => this.touched(x0, y0, z0, x1, y1, z1);
  }

  /**
   * Remove up to `budget` m³ of material from a soft-edged sphere.
   * Only materials accepted by `can` are affected. Returns volume per material.
   */
  dig(cx: number, cy: number, cz: number, r: number, budget: number, can: (m: Mat) => boolean): Volumes {
    const plan: [Chunk, number, number][] = [];
    let total = 0;
    const done = this.forPoints(cx, cy, cz, r, (c, i, _x, _y, _z, dist) => {
      const cur = c.d[i];
      if (cur === 0 || !can(c.m[i])) return;
      const w = Math.min(1, (r - dist) / 0.9);
      const take = Math.min(cur, w * 255);
      if (take > 0) { plan.push([c, i, take]); total += take; }
    });
    const scale = total > 0 ? Math.min(1, (budget * 255) / total) : 0;
    const out: Volumes = {};
    for (const [c, i, take] of plan) {
      const t = Math.round(take * scale);
      if (!t) continue;
      c.d[i] -= t;
      const m = c.m[i] as Mat;
      out[m] = (out[m] ?? 0) + t / 255;
    }
    done();
    return out;
  }

  /** Add up to `budget` m³ of `fill` material in a soft-edged sphere. Returns volume added. */
  fill(cx: number, cy: number, cz: number, r: number, budget: number, fill: Mat): number {
    const plan: [Chunk, number, number][] = [];
    let total = 0;
    const done = this.forPoints(cx, cy, cz, r, (c, i, _x, _y, _z, dist) => {
      const cur = c.d[i];
      const w = Math.min(1, (r - dist) / 0.9);
      const add = Math.min(255 - cur, w * 255);
      if (add > 0) { plan.push([c, i, add]); total += add; }
    });
    const scale = total > 0 ? Math.min(1, (budget * 255) / total) : 0;
    let added = 0;
    for (const [c, i, add] of plan) {
      const a = Math.round(add * scale);
      if (!a) continue;
      if (c.d[i] < ISO) c.m[i] = fill;
      c.d[i] += a;
      added += a / 255;
    }
    done();
    return added;
  }

  /**
   * Move the ground in a disc toward a flat surface at height `target`, Valheim
   * style. Removal is limited by `budget` and to materials `can` accepts; filling
   * is limited by `fillBudget` (the dirt you carry). Returns what moved, and how
   * far from flat the disc still is (metres).
   */
  level(cx: number, cz: number, r: number, target: number, budget: number, fillBudget: number, can: (m: Mat) => boolean, fill: Mat) {
    const cuts: [Chunk, number, number][] = [];
    const adds: [Chunk, number, number][] = [];
    let cutTotal = 0, addTotal = 0, offBy = 0;
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
    const z0 = Math.floor(cz - r), z1 = Math.ceil(cz + r);
    let ylo = Infinity, yhi = -Infinity;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.hypot(x - cx, z - cz);
        if (dist > r) continue;
        const w = Math.min(1, (r - dist) / 1.2);
        const top = this.ph(x, z);
        if (dist < r - 1) offBy = Math.max(offBy, Math.abs(top - target));
        const lo = Math.max(Y_MIN + 1, Math.floor(Math.min(top, target)) - 2);
        const hi = Math.min(Y_MAX - 1, Math.ceil(Math.max(top, target)) + 2);
        ylo = Math.min(ylo, lo); yhi = Math.max(yhi, hi);
        for (let y = lo; y <= hi; y++) {
          const yi = y - Y_MIN;
          const c = this.writable(x >> 4, yi >> 4, z >> 4);
          const i = ((yi & 15) * CH + (z & 15)) * CH + (x & 15);
          const want = Math.max(0, Math.min(1, target - y + 0.5)) * 255;
          const delta = (want - c.d[i]) * w;
          if (delta < -1 && can(c.m[i] as Mat)) { cuts.push([c, i, -delta]); cutTotal -= delta; }
          else if (delta > 1) { adds.push([c, i, delta]); addTotal += delta; }
        }
      }
    }
    const cutScale = cutTotal > 0 ? Math.min(1, (budget * 255) / cutTotal) : 0;
    const addScale = addTotal > 0 ? Math.min(1, (Math.min(budget, fillBudget) * 255) / addTotal) : 0;
    const removed: Volumes = {};
    let added = 0;
    for (const [c, i, amt] of cuts) {
      const t = Math.min(c.d[i], Math.round(amt * cutScale));
      if (!t) continue;
      c.d[i] -= t;
      const m = c.m[i] as Mat;
      removed[m] = (removed[m] ?? 0) + t / 255;
    }
    for (const [c, i, amt] of adds) {
      const a = Math.min(255 - c.d[i], Math.round(amt * addScale));
      if (!a) continue;
      if (c.d[i] < ISO) c.m[i] = fill;
      c.d[i] += a;
      added += a / 255;
    }
    if (ylo <= yhi) this.touched(x0, ylo, z0, x1, yhi, z1);
    return { removed, added, offBy, blocked: cutTotal === 0 && addTotal === 0 };
  }

  /** Blur the soft ground in a sphere, rounding off bumps and ledges. */
  smooth(cx: number, cy: number, cz: number, r: number) {
    const changes: [Chunk, number, number, Mat][] = [];
    const done = this.forPoints(cx, cy, cz, r, (c, i, x, y, z, dist) => {
      const m0 = c.m[i] as Mat;
      if (c.d[i] >= ISO && !isSoft(m0)) return;
      let sum = 0, best = -1, bestMat = Mat.Dirt;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const dd = this.d(x + dx, y + dy, z + dz);
        sum += dd;
        if (dd > best && isSoft(this.m(x + dx, y + dy, z + dz))) { best = dd; bestMat = this.m(x + dx, y + dy, z + dz); }
      }
      const w = Math.min(1, (r - dist) / 1.0) * 0.6;
      const v = Math.round(c.d[i] + (sum / 27 - c.d[i]) * w);
      changes.push([c, i, v, c.d[i] < ISO && v >= ISO ? bestMat : m0]);
    });
    for (const [c, i, v, m] of changes) { c.d[i] = v; c.m[i] = m; }
    done();
  }

  /** Repaint the surface layer (e.g. tilling a field). Returns how many points changed. */
  paint(cx: number, cy: number, cz: number, r: number, to: Mat, can: (m: Mat) => boolean): number {
    let n = 0;
    const done = this.forPoints(cx, cy, cz, r, (c, i, x, y, z) => {
      if (c.d[i] < 60 || !can(c.m[i] as Mat)) return;
      // Only the skin: points with open air close above.
      if (this.d(x, y + 1, z) >= ISO && this.d(x, y + 2, z) >= ISO) return;
      if (c.m[i] !== to) { c.m[i] = to; n++; }
    });
    done();
    return n;
  }

  /** Slowly regrow grass on bare dirt next to grass, somewhere near (px, pz). */
  randomTick(px = 0, pz = 0) {
    const x = Math.round(px + (Math.random() - 0.5) * 120), z = Math.round(pz + (Math.random() - 0.5) * 120);
    // Only where you've changed things (untouched ground already has its grass).
    if (!this.heightEdits.has(colKey(x >> 4, z >> 4))) return;
    const h = this.ph(x, z);
    if (h < this.waterAt(x, z) + 0.3) return;
    const y = Math.floor(h);
    if (this.m(x, y, z) !== Mat.Dirt) return;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (this.m(x + ox, Math.floor(this.ph(x + ox, z + oz)), z + oz) === Mat.Grass) {
        const yi = y - Y_MIN;
        this.writable(x >> 4, yi >> 4, z >> 4).m[((yi & 15) * CH + (z & 15)) * CH + (x & 15)] = Mat.Grass;
        this.touched(x, y, z, x, y, z);
        return;
      }
    }
  }

  /** Mark chunks for remeshing and saving after points in a box changed. */
  private touched(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    // A point influences the cells on either side of it.
    for (let cy = cyOf(y0 - 1); cy <= cyOf(y1); cy++) {
      for (let cz = cOf(z0 - 1); cz <= cOf(z1); cz++) {
        for (let cx = cOf(x0 - 1); cx <= cOf(x1); cx++) this.dirty.add(chunkId(cx, cy, cz));
      }
    }
    for (let cy = cyOf(y0); cy <= cyOf(y1); cy++) {
      for (let cz = cOf(z0); cz <= cOf(z1); cz++) {
        for (let cx = cOf(x0); cx <= cOf(x1); cx++) this.edited.add(chunkId(cx, cy, cz));
      }
    }
    this.updateHeights(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    this.wantedAt.x = NaN; // edited chunks join the mesh set
  }

  // ---------- streaming
  /** Which chunks should be meshed around a point, nearest first. */
  private plan(px: number, py: number, pz: number, newCols = Infinity) {
    const out: { id: number; dist: number }[] = [];
    let skipped = false, skipDist = Infinity;
    const r = Math.ceil(MESH_RADIUS / CH);
    const pcx = Math.floor(px / CH), pcz = Math.floor(pz / CH), pcy = cyOf(py);
    const editedCols = new Map<number, number[]>();
    for (const id of this.edited) {
      const cx = keyCx(id), cz = keyCz(id), cy = keyCy(id);
      const k = colKey(cx, cz);
      const list = editedCols.get(k) ?? [];
      list.push(cy);
      editedCols.set(k, list);
    }
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const ccx = (cx + 0.5) * CH, ccz = (cz + 0.5) * CH;
        const dist = Math.hypot(ccx - px, ccz - pz);
        if (dist > MESH_RADIUS + CH) continue;
        // Working out a new column costs a few ms: only a handful per frame, nearest first.
        if (!this.cols.has(colKey(cx, cz)) && dist > CH * 2) {
          if (newCols <= 0) { skipped = true; skipDist = Math.min(skipDist, dist); continue; }
          newCols--;
        }
        const ci = this.colInfo(cx, cz);
        // The surface band, plus chunks around you (caves and tunnels), plus anything you changed.
        const ys = new Set<number>();
        for (let cy = cyOf(ci.minH - 3); cy <= cyOf(ci.maxH + 2); cy++) ys.add(cy);
        if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2) for (let cy = pcy - 1; cy <= pcy + 1; cy++) if (cy >= 0 && cy < NCY) ys.add(cy);
        for (const cy of editedCols.get(colKey(cx, cz)) ?? []) { ys.add(cy); if (cy > 0) ys.add(cy - 1); if (cy < NCY - 1) ys.add(cy + 1); }
        for (const cy of ys) out.push({ id: chunkId(cx, cy, cz), dist: Math.hypot(ccx - px, Y_MIN + (cy + 0.5) * CH - py, ccz - pz) * 0.25 + dist * 0.75 });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return { out, skipped, skipDist };
  }

  /**
   * Keep the terrain around a point meshed: build what's missing or changed,
   * nearest first, within a time budget (ms); drop what's far behind you.
   */
  update(px: number, py: number, pz: number, budgetMs: number) {
    const start = performance.now();
    const w = this.wantedAt;
    if (this.replan || !(Math.hypot(px - w.x, pz - w.z) < 8 && Math.abs(py - w.y) < 8)) {
      const { out, skipped, skipDist } = this.plan(px, py, pz, 4);
      this.wanted = out;
      this.skipDist = skipDist;
      // Columns still to work out: carry on next frame.
      this.replan = skipped;
      if (!(Math.hypot(px - w.x, pz - w.z) < 8)) this.unload(px, pz);
      this.wantedAt = { x: px, y: py, z: pz };
    }
    let ready = Infinity;
    for (const { id, dist } of this.wanted) {
      if (this.meshes.has(id) && !this.dirty.has(id)) continue;
      if (this.empty.has(id) && !this.dirty.has(id)) continue;
      // Always finish anything right next to you so edits show at once.
      if (performance.now() - start > budgetMs && dist > CH * 1.5) { ready = Math.min(ready, dist); break; }
      this.dirty.delete(id);
      this.buildChunk(id);
    }
    // Rivers and lakes for meshed columns.
    for (const { id } of this.wanted) {
      const key = colOf(id);
      if (this.waterMeshes.has(key)) continue;
      if (performance.now() - start > budgetMs) break;
      this.buildWater(keyCx(id), keyCz(id));
    }
    ready = Math.min(ready, this.skipDist);
    this.readyRadius = Number.isFinite(ready) ? Math.max(0, ready - CH) : MESH_RADIUS;
  }

  private replan = false;
  private skipDist = Infinity;
  /** Chunks that have no surface to draw (so we don't keep re-checking them). */
  private empty = new Set<number>();

  private unload(px: number, pz: number) {
    const far = (cx: number, cz: number, extra: number) => Math.hypot((cx + 0.5) * CH - px, (cz + 0.5) * CH - pz) > MESH_RADIUS + CH + extra;
    for (const [id, mesh] of this.meshes) {
      if (!far(keyCx(id), keyCz(id), 24)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(id);
    }
    for (const [key, mesh] of this.waterMeshes) {
      if (!far(keyCx(key), keyCz(key), 24)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.waterMeshes.delete(key);
    }
    for (const id of this.empty) if (far(keyCx(id), keyCz(id), 24)) this.empty.delete(id);
    // Forget generated data you can't reach any more (what you changed stays).
    for (const id of this.chunks.keys()) {
      if (!this.edited.has(id) && far(keyCx(id), keyCz(id), 96)) this.chunks.delete(id);
    }
    for (const key of this.cols.keys()) if (far(keyCx(key), keyCz(key), 160)) this.cols.delete(key);
  }

  /**
   * Work out up to `budget` of the not-yet-known columns in an area; returns
   * how many are still missing (spreads the cost of new ground over frames).
   */
  prepare(x0: number, z0: number, size: number, budget: number): number {
    let missing = 0;
    for (let cz = cOf(z0); cz <= cOf(z0 + size - 1); cz++) {
      for (let cx = cOf(x0); cx <= cOf(x0 + size - 1); cx++) {
        if (this.cols.has(colKey(cx, cz))) continue;
        if (budget-- > 0) this.colInfo(cx, cz); else missing++;
      }
    }
    return missing;
  }

  /** Mesh everything near a point right away (used when a world first loads). */
  buildNear(px: number, py: number, pz: number, radius: number) {
    this.wanted = this.plan(px, py, pz).out;
    this.wantedAt = { x: px, y: py, z: pz };
    for (const { id, dist } of this.wanted) {
      if (dist > radius) break;
      if (!this.meshes.has(id) && !this.empty.has(id)) this.buildChunk(id);
    }
  }

  get pendingChunks() {
    let n = 0;
    for (const { id } of this.wanted) if (!this.meshes.has(id) && !this.empty.has(id)) n++;
    return n + this.dirty.size;
  }

  // ---------- meshing
  private buildChunk(id: number) {
    const cx = keyCx(id), cz = keyCz(id), cy = keyCy(id);
    const x0 = cx * CH, z0 = cz * CH, y0 = Y_MIN + cy * CH;
    const S = CH + 1;
    const old = this.meshes.get(id);
    const drop = () => {
      if (old) { this.group.remove(old); old.geometry.dispose(); this.meshes.delete(id); }
      this.empty.add(id);
    };
    // Quick reject from the column's heights: nothing here but sky.
    const ci = this.colInfo(cx, cz);
    if (y0 - 1 > ci.maxH + 1.5 && !this.edited.has(id) && !this.heightEdits.has(colKey(cx, cz))) return drop();
    let anySolid = false, anyAir = false;
    for (let y = y0 - 1; y <= y0 + CH && !(anySolid && anyAir); y++) {
      for (let z = z0 - 1; z <= z0 + CH && !(anySolid && anyAir); z++) {
        for (let x = x0 - 1; x <= x0 + CH; x++) {
          if (this.d(x, y, z) >= ISO) anySolid = true; else anyAir = true;
        }
      }
    }
    if (!(anySolid && anyAir)) return drop();
    this.empty.delete(id);

    const vid = new Int32Array(S * S * S).fill(-1);
    const pos: number[] = [], nor: number[] = [], col: number[] = [], index: number[] = [];
    const c = new Float32Array(8);
    let nv = 0;
    for (let lz = 0; lz < S; lz++) {
      const gz = z0 + lz - 1;
      for (let ly = 0; ly < S; ly++) {
        const gy = y0 + ly - 1;
        if (gy < Y_MIN || gy >= Y_MAX) continue;
        for (let lx = 0; lx < S; lx++) {
          const gx = x0 + lx - 1;
          let mask = 0;
          for (let k = 0; k < 8; k++) {
            c[k] = this.d(gx + (k & 1), gy + ((k >> 1) & 1), gz + ((k >> 2) & 1));
            if (c[k] >= ISO) mask |= 1 << k;
          }
          if (mask === 0 || mask === 255) continue;
          // Vertex = average of the edge crossings.
          let sx = 0, sy = 0, sz = 0, cnt = 0;
          for (const [a, b] of EDGES) {
            if ((c[a] >= ISO) === (c[b] >= ISO)) continue;
            const t = (ISO - c[a]) / (c[b] - c[a]);
            sx += (a & 1) + ((b & 1) - (a & 1)) * t;
            sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
            sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
            cnt++;
          }
          const fx = sx / cnt, fy = sy / cnt, fz = sz / cnt;
          // Normal = -gradient of the trilinear field at the vertex.
          const gxv = (1 - fy) * (1 - fz) * (c[1] - c[0]) + fy * (1 - fz) * (c[3] - c[2]) + (1 - fy) * fz * (c[5] - c[4]) + fy * fz * (c[7] - c[6]);
          const gyv = (1 - fx) * (1 - fz) * (c[2] - c[0]) + fx * (1 - fz) * (c[3] - c[1]) + (1 - fx) * fz * (c[6] - c[4]) + fx * fz * (c[7] - c[5]);
          const gzv = (1 - fx) * (1 - fy) * (c[4] - c[0]) + fx * (1 - fy) * (c[5] - c[1]) + (1 - fx) * fy * (c[6] - c[2]) + fx * fy * (c[7] - c[3]);
          let nx = -gxv, ny = -gyv, nz = -gzv;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          // Colour from the solid corner closest to the surface (lowest solid density),
          // so the thin grass layer isn't hidden by the dirt beneath it.
          let bk = -1;
          for (let k = 0; k < 8; k++) if (c[k] >= ISO && (bk < 0 || c[k] < c[bk])) bk = k;
          let m = this.m(gx + (bk & 1), gy + ((bk >> 1) & 1), gz + ((bk >> 2) & 1));
          if (m === Mat.Grass && ny < 0.55) m = Mat.Dirt; // grass doesn't cling to steep banks
          const wx = gx + fx, wy = gy + fy, wz = gz + fz;
          const [r, gC, b] = this.surfaceColor(m, wx, wy, wz, ny, tmpCol);
          const j = 0.88 + hash2(Math.floor(wx * 3), Math.floor(wz * 3) + Math.floor(wy * 7), 3) * 0.24;
          const wet = wy < this.waterAt(wx, wz) + 0.25 ? 0.72 : 1;
          pos.push(wx, wy, wz);
          nor.push(nx, ny, nz);
          col.push(r * j * wet, gC * j * wet, b * j * wet);
          vid[(lz * S + ly) * S + lx] = nv++;
        }
      }
    }
    // Quads across every sign-changing grid edge owned by this chunk.
    const cell = (gx: number, gy: number, gz: number) => {
      const lx = gx - x0 + 1, ly = gy - y0 + 1, lz = gz - z0 + 1;
      if (lx < 0 || ly < 0 || lz < 0 || lx >= S || ly >= S || lz >= S) return -1;
      return vid[(lz * S + ly) * S + lx];
    };
    const p = [0, 0, 0], e = [0, 0, 0];
    for (let lz = 0; lz < CH; lz++) {
      for (let ly = 0; ly < CH; ly++) {
        for (let lx = 0; lx < CH; lx++) {
          p[0] = x0 + lx; p[1] = y0 + ly; p[2] = z0 + lz;
          const d0 = this.d(p[0], p[1], p[2]) >= ISO;
          for (let a = 0; a < 3; a++) {
            e[0] = e[1] = e[2] = 0; e[a] = 1;
            const d1 = this.d(p[0] + e[0], p[1] + e[1], p[2] + e[2]) >= ISO;
            if (d0 === d1) continue;
            const u = (a + 1) % 3, v = (a + 2) % 3;
            const q = [p[0], p[1], p[2]];
            q[u]--; q[v]--; const c0 = cell(q[0], q[1], q[2]);
            q[u]++; const c1 = cell(q[0], q[1], q[2]);
            q[v]++; const c2 = cell(q[0], q[1], q[2]);
            q[u]--; const c3 = cell(q[0], q[1], q[2]);
            if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) continue;
            if (d0) index.push(c0, c1, c2, c0, c2, c3);
            else index.push(c0, c2, c1, c0, c3, c2);
          }
        }
      }
    }
    if (!index.length) return drop();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    if (old) {
      old.geometry.dispose();
      old.geometry = g;
    } else {
      const mesh = new THREE.Mesh(g, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.set(id, mesh);
      this.group.add(mesh);
    }
  }

  /**
   * The river and lake surface for one column. Each point takes its own water
   * height, or (on the bank) its wet neighbours' dipped a little, so the
   * surface tucks under the banks and the ground draws a clean shoreline.
   */
  private buildWater(cx: number, cz: number) {
    const key = colKey(cx, cz);
    const ci = this.colInfo(cx, cz);
    const W = ci.water;
    const V = new Float32Array(CI * CI).fill(NaN);
    let any = false;
    for (let k = 0; k < CI * CI; k++) {
      if (!Number.isNaN(W[k])) { V[k] = W[k]; any = true; continue; }
      const lx = k % CI, lz = Math.floor(k / CI);
      let sum = 0, cnt = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = lx + dx, z = lz + dz;
        if (x < 0 || z < 0 || x >= CI || z >= CI) continue;
        const w = W[z * CI + x];
        if (!Number.isNaN(w)) { sum += w; cnt++; }
      }
      if (cnt) V[k] = sum / cnt - 0.25;
    }
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.waterMaterial ?? undefined);
    mesh.visible = false;
    this.waterMeshes.set(key, mesh);
    if (!any || !this.waterMaterial) return;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const vid = new Int32Array(CI * CI).fill(-1);
    const x0 = cx * CH - 1, z0 = cz * CH - 1;
    const vert = (k: number) => {
      if (vid[k] < 0) {
        vid[k] = pos.length / 3;
        const x = x0 + (k % CI), z = z0 + Math.floor(k / CI);
        pos.push(x, V[k] - 0.04, z);
        uv.push(x / 960, z / 960);
      }
      return vid[k];
    };
    // Quads for this column's cells only (the border is for the bank dip).
    for (let lz = 1; lz < CI - 1; lz++) {
      for (let lx = 1; lx < CI - 1; lx++) {
        const k = lz * CI + lx;
        if (Number.isNaN(V[k]) || Number.isNaN(V[k + 1]) || Number.isNaN(V[k + CI]) || Number.isNaN(V[k + CI + 1])) continue;
        const a = vert(k), b = vert(k + 1), c = vert(k + CI), d = vert(k + CI + 1);
        idx.push(a, c, b, b, c, d);
      }
    }
    if (!idx.length) return;
    const geo = mesh.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    mesh.visible = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // ---------- persistence: only chunks you changed are stored
  serialize() {
    const chunks: [number, string, string][] = [];
    for (const id of this.edited) {
      const cx = keyCx(id), cz = keyCz(id), cy = keyCy(id);
      const c = this.chunk(cx, cy, cz);
      chunks.push([id, rle(c.d), rle(c.m)]);
    }
    return { seed: this.seed, chunks };
  }

  load(data: { chunks: [number, string, string][] }) {
    const cols = new Set<number>();
    for (const [id, d, m] of data.chunks) {
      const dd = unrle(d), mm = unrle(m);
      if (dd.length !== CH * CH * CH || mm.length !== CH * CH * CH) continue;
      this.chunks.set(id, new Chunk(dd, mm));
      this.edited.add(id);
      cols.add(colOf(id));
    }
    // Re-measure the surface wherever you'd changed it.
    for (const key of cols) {
      const cx = keyCx(key), cz = keyCz(key);
      this.updateHeights(cx * CH, cz * CH, cx * CH + CH - 1, cz * CH + CH - 1);
    }
  }
}

const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function rle(bytes: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < bytes.length;) {
    const v = bytes[i];
    let n = 1;
    while (i + n < bytes.length && bytes[i + n] === v && n < 255) n++;
    out.push(n, v);
    i += n;
  }
  let s = '';
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.slice(i, i + 0x8000));
  return btoa(s);
}

function unrle(b64: string): Uint8Array {
  const bin = atob(b64);
  const out: number[] = [];
  for (let i = 0; i < bin.length; i += 2) {
    const n = bin.charCodeAt(i), v = bin.charCodeAt(i + 1);
    for (let k = 0; k < n; k++) out.push(v);
  }
  return new Uint8Array(out);
}

/** Vertex-coloured standard material with triplanar rock/soil detail noise. */
function makeTerrainMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const detail = makeDetailTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nuniform sampler2D detailMap;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 bw = pow(abs(vWNrm), vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);
        float d1 = texture2D(detailMap, vWPos.zy * 0.45).r * bw.x + texture2D(detailMap, vWPos.xz * 0.45).r * bw.y + texture2D(detailMap, vWPos.xy * 0.45).r * bw.z;
        float d2 = texture2D(detailMap, vWPos.zy * 0.06).g * bw.x + texture2D(detailMap, vWPos.xz * 0.06).g * bw.y + texture2D(detailMap, vWPos.xy * 0.06).g * bw.z;
        diffuseColor.rgb *= (0.8 + 0.4 * d1) * (0.82 + 0.36 * d2);`);
  };
  return mat;
}

/** Tileable value noise: fine grain in red, broad patches in green. */
function makeDetailTexture(): THREE.Texture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const layer = (x: number, y: number, cells: number, seed: number) => {
    const fx = (x / S) * cells, fy = (y / S) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const h = (a: number, b: number) => hash2(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, seed);
    const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * sx;
    const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fine = layer(x, y, 32, 1) * 0.6 + layer(x, y, 64, 2) * 0.4;
      const broad = layer(x, y, 4, 3) * 0.6 + layer(x, y, 8, 4) * 0.4;
      const i = (y * S + x) * 4;
      img.data[i] = fine * 255;
      img.data[i + 1] = broad * 255;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}
