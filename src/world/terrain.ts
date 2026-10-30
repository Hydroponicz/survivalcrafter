import * as THREE from 'three';
import { hash2, Simplex } from './noise';
import { erode } from './erosion';
import { hydrology } from './hydrology';
import { climate, SNOW_TEMP, tempAt, zoneOf, type Zone } from './climate';
import { Rock, Strata } from './geology';

// Voxel terrain. Density lives on a 1 m grid of points (0..255, solid at >= 128)
// and is meshed with Surface Nets, so the ground is smooth like Enshrouded but
// can be dug, filled, levelled and tunnelled in any direction.

export const WORLD_SIZE = 320; // metres along x and z
export const Y_MIN = -32;
export const Y_MAX = 64;
export const WATER_LEVEL = 0;
export const CH = 16; // cells per chunk edge
export const ISO = 128;

const PX = WORLD_SIZE + 1;
const PY = Y_MAX - Y_MIN + 1;
const PZ = WORLD_SIZE + 1;
const NCX = Math.ceil(WORLD_SIZE / CH);
const NCY = Math.ceil((Y_MAX - Y_MIN) / CH);
const NCZ = Math.ceil(WORLD_SIZE / CH);

export enum Mat { Air = 0, Grass = 1, Dirt = 2, Sand = 3, Clay = 4, Rock = 5, Iron = 6, Field = 7, Sandstone = 8, Shale = 9, Gravel = 10 }

export const MAT_NAMES: Record<Mat, string> = {
  [Mat.Air]: 'Air', [Mat.Grass]: 'Grass', [Mat.Dirt]: 'Dirt', [Mat.Sand]: 'Sand', [Mat.Clay]: 'Clay',
  [Mat.Rock]: 'Granite', [Mat.Iron]: 'Ironstone', [Mat.Field]: 'Field',
  [Mat.Sandstone]: 'Sandstone', [Mat.Shale]: 'Shale', [Mat.Gravel]: 'Gravel',
};

/** What each kind of bedrock is as a terrain material. */
const ROCK_MAT: Record<Rock, Mat> = { [Rock.Granite]: Mat.Rock, [Rock.Sandstone]: Mat.Sandstone, [Rock.Shale]: Mat.Shale, [Rock.Ironstone]: Mat.Iron };

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
const LIN = Object.fromEntries(Object.entries(SRGB).map(([k, c]) => [k, c.map((v) => Math.pow(v, 2.2))])) as unknown as Record<Mat, number[]>;

/** Drainage (log of water through a column) above which valley floors are clay. */
const CLAY_FLOW = 4.4;

export type Volumes = Partial<Record<Mat, number>>;

export class Terrain {
  readonly size = WORLD_SIZE;
  density = new Uint8Array(PX * PY * PZ);
  mat = new Uint8Array(PX * PY * PZ);
  /** Top surface height per grid column, for fast height queries. */
  private heights = new Float32Array(PX * PZ);
  seed: number;
  /** Water that drained through each column during erosion (for rivers and reading the land). */
  flow: Float32Array = new Float32Array(PX * PZ);
  /** Fresh water surface per column (NaN where dry): rivers and lakes. */
  water: Float32Array = new Float32Array(PX * PZ).fill(NaN);
  /** 1 where a column is part of a lake (vs. a river). */
  lake: Uint8Array = new Uint8Array(PX * PZ);
  /** Within a couple of metres of a river or lake. */
  nearWater: Uint8Array = new Uint8Array(PX * PZ);
  /** Climate per column: temperature before height, and wetness (see climate.ts). */
  climBase: Float32Array = new Float32Array(PX * PZ).fill(0.8);
  moist: Float32Array = new Float32Array(PX * PZ).fill(0.5);
  /** Direction the prevailing wind blows toward. */
  wind: [number, number] = [1, 0];

  group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private dirty = new Set<number>();
  private edited = new Set<number>();
  private material: THREE.MeshStandardMaterial;

  constructor(seed: number) {
    this.seed = seed;
    this.material = makeTerrainMaterial();
  }

  // ---------- indexing & sampling
  private idx(x: number, yi: number, z: number) { return (yi * PZ + z) * PX + x; }

  /** Density at an integer grid point (world x, world y, world z). */
  d(x: number, y: number, z: number): number {
    const yi = y - Y_MIN;
    if (yi < 0) return 255;
    if (yi >= PY) return 0;
    x = x < 0 ? 0 : x >= PX ? PX - 1 : x;
    z = z < 0 ? 0 : z >= PZ ? PZ - 1 : z;
    return this.density[this.idx(x, yi, z)];
  }

  m(x: number, y: number, z: number): Mat {
    const yi = y - Y_MIN;
    if (yi < 0) return Mat.Rock;
    if (yi >= PY) return Mat.Air;
    x = x < 0 ? 0 : x >= PX ? PX - 1 : x;
    z = z < 0 ? 0 : z >= PZ ? PZ - 1 : z;
    return this.mat[this.idx(x, yi, z)];
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
    if (mat === Mat.Air) {
      // Deep inside the ground: look at the point below.
      return this.m(Math.round(x), Math.floor(y), Math.round(z)) || Mat.Dirt;
    }
    return mat;
  }

  /** Height of the topmost surface (ignores caves), bilinear between columns. */
  heightAt(x: number, z: number): number {
    x = Math.max(0, Math.min(WORLD_SIZE - 0.001, x));
    z = Math.max(0, Math.min(WORLD_SIZE - 0.001, z));
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const h = this.heights;
    const a = h[z0 * PX + x0], b = h[z0 * PX + x0 + 1];
    const c = h[(z0 + 1) * PX + x0], e = h[(z0 + 1) * PX + x0 + 1];
    return (a + (b - a) * fx) * (1 - fz) + (c + (e - c) * fx) * fz;
  }

  /** Material of the top surface at a column. */
  /** Height of the water surface at a point: a river or lake if there is one, else the sea. */
  waterAt(x: number, z: number): number {
    const ix = Math.max(0, Math.min(PX - 1, Math.round(x))), iz = Math.max(0, Math.min(PZ - 1, Math.round(z)));
    const w = this.water[iz * PX + ix];
    return Number.isNaN(w) ? WATER_LEVEL : Math.max(WATER_LEVEL, w);
  }

  /** Is there running (river, not lake) water at this column? */
  riverAt(x: number, z: number): boolean {
    const i = Math.max(0, Math.min(PZ - 1, Math.round(z))) * PX + Math.max(0, Math.min(PX - 1, Math.round(x)));
    return !Number.isNaN(this.water[i]) && !this.lake[i];
  }

  /** Is there fresh (river or lake) water at this column? */
  freshWaterAt(x: number, z: number): boolean {
    const ix = Math.max(0, Math.min(PX - 1, Math.round(x))), iz = Math.max(0, Math.min(PZ - 1, Math.round(z)));
    return !Number.isNaN(this.water[iz * PX + ix]);
  }

  /**
   * A mesh of the river and lake surfaces. Each grid vertex takes its own
   * water height, or its wet neighbours' where it's on the bank, so the
   * surface tucks under the banks; steep reaches become little rapids.
   */
  waterMesh(material: THREE.Material): THREE.Mesh {
    // Spread the surface two cells out under the banks; the ground hides
    // what's beneath it and draws a clean shoreline where it dips below.
    let V = this.water.slice();
    for (let ring = 0; ring < 2; ring++) {
      const next = V.slice();
      for (let z = 0; z < PZ; z++) {
        for (let x = 0; x < PX; x++) {
          const i = z * PX + x;
          if (!Number.isNaN(V[i])) continue;
          let sum = 0, cnt = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= PX || nz >= PZ) continue;
            const w = V[nz * PX + nx];
            if (!Number.isNaN(w)) { sum += w; cnt++; }
          }
          // Dip under the bank so water and ground cross steeply (a crisp edge).
          if (cnt) next[i] = sum / cnt - 0.25;
        }
      }
      V = next;
    }
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const vid = new Int32Array(PX * PZ).fill(-1);
    const vert = (x: number, z: number) => {
      const i = z * PX + x;
      if (vid[i] < 0) {
        vid[i] = pos.length / 3;
        pos.push(x, V[i] - 0.04, z);
        uv.push(x / (WORLD_SIZE * 3), z / (WORLD_SIZE * 3));
      }
      return vid[i];
    };
    for (let z = 0; z < PZ - 1; z++) {
      for (let x = 0; x < PX - 1; x++) {
        const i = z * PX + x;
        if (Number.isNaN(V[i]) || Number.isNaN(V[i + 1]) || Number.isNaN(V[i + PX]) || Number.isNaN(V[i + PX + 1])) continue;
        const a = vert(x, z), b = vert(x + 1, z), c = vert(x, z + 1), d = vert(x + 1, z + 1);
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  private col(x: number, z: number) {
    return Math.max(0, Math.min(PZ - 1, Math.round(z))) * PX + Math.max(0, Math.min(PX - 1, Math.round(x)));
  }

  /** Temperature (0 cold .. 1 warm) at a point, cooling with height. */
  temperatureAt(x: number, y: number, z: number): number {
    return tempAt(this.climBase[this.col(x, z)], y);
  }

  moistureAt(x: number, z: number): number {
    return this.moist[this.col(x, z)];
  }

  /** What grows here, from climate and the lie of the land. */
  zoneAt(x: number, z: number): Zone {
    const i = this.col(x, z);
    const h = this.heightAt(x, z);
    const n = this.normalAt(x, h - 0.05, z);
    const slope = Math.sqrt(Math.max(0, 1 - n.y * n.y)) / Math.max(0.2, n.y);
    return zoneOf(tempAt(this.climBase[i], h), this.moist[i], h, WATER_LEVEL, !!this.nearWater[i], slope);
  }

  /**
   * Linear colour of a material at a point: grass shows the climate (straw
   * where dry, deep green where wet, dark up high) and snow lies on cold,
   * gentle ground. `ny` is the surface normal's up component.
   */
  surfaceColor(m: Mat, x: number, y: number, z: number, ny: number, out: number[] = [0, 0, 0]): number[] {
    const base = LIN[m] ?? LIN[Mat.Dirt];
    let r = base[0], g = base[1], b = base[2];
    const ci = this.col(x, z);
    const temp = tempAt(this.climBase[ci], y);
    const mix = (c: number[], k: number) => { if (k <= 0) return; r += (c[0] - r) * k; g += (c[1] - g) * k; b += (c[2] - b) * k; };
    if (m === Mat.Grass) {
      const mo = this.moist[ci];
      mix(GRASS_DRY, clamp01((0.42 - mo) / 0.3) * 0.85);
      mix(GRASS_LUSH, clamp01((mo - 0.55) / 0.3) * 0.7);
      mix(GRASS_COLD, clamp01((0.45 - temp) / 0.2) * 0.8);
    }
    mix(SNOW, clamp01((SNOW_TEMP + 0.03 - temp) / 0.05) * clamp01((ny - 0.45) / 0.25));
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }

  surfaceMaterial(x: number, z: number): Mat {
    return this.materialAt(x, this.heightAt(x, z) - 0.3, z);
  }

  /** Surface normal from the density gradient. */
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
      // Embedded: climb out to the surface just above.
      for (let k = 1; k <= 8; k++) {
        if (!this.solidAt(x, y + k * 0.15, z)) return this.refine(x, y + (k - 1) * 0.15, y + k * 0.15, z);
      }
      return y + 1.2;
    }
    let yy = y;
    while (yy > Y_MIN) {
      const next = yy - 0.25;
      if (this.solidAt(x, next, z)) return this.refine(x, next, yy, z);
      yy = next;
    }
    return -Infinity;
  }

  /** Bisect between a solid y (lo) and an open y (hi). */
  private refine(x: number, lo: number, hi: number, z: number): number {
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if (this.solidAt(x, mid, z)) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  private columnHeight(x: number, z: number): number {
    for (let yi = PY - 1; yi > 0; yi--) {
      const d = this.density[this.idx(x, yi - 1, z)];
      if (d >= ISO) {
        const above = this.density[this.idx(x, yi, z)];
        const t = (d - ISO) / Math.max(1, d - above);
        return Y_MIN + yi - 1 + Math.min(1, t);
      }
    }
    return Y_MIN;
  }

  private updateHeights(x0: number, z0: number, x1: number, z1: number) {
    for (let z = Math.max(0, z0); z <= Math.min(PZ - 1, z1); z++) {
      for (let x = Math.max(0, x0); x <= Math.min(PX - 1, x1); x++) this.heights[z * PX + x] = this.columnHeight(x, z);
    }
  }

  // ---------- generation
  generate() {
    const n = new Simplex(this.seed);
    const n2 = new Simplex(this.seed + 17);
    const n3 = new Simplex(this.seed + 99);
    const cave = new Simplex(this.seed + 333);
    const ore = new Simplex(this.seed ^ 0x5eed);
    const half = WORLD_SIZE / 2;
    const H = new Float32Array(PX * PZ);
    for (let z = 0; z < PZ; z++) {
      for (let x = 0; x < PX; x++) {
        const nx = x / WORLD_SIZE, nz = z / WORLD_SIZE;
        const dx = (x - half) / half, dz = (z - half) / half;
        const dist = Math.min(1, Math.sqrt(dx * dx + dz * dz));
        const fall = Math.pow(Math.max(0, dist - 0.55) / 0.45, 2);
        const base = n.fbm(nx * 3, nz * 3, 5) * 9 + 4;
        const ridge = 1 - Math.abs(n2.fbm(nx * 2.2, nz * 2.2, 4));
        const mount = Math.pow(Math.max(0, ridge - 0.55) / 0.45, 2) * 32 * Math.max(0, n3.fbm(nx * 1.5 + 3, nz * 1.5, 2) + 0.4);
        H[z * PX + x] = Math.max(Y_MIN + 3, base + mount - fall * 26);
      }
    }
    // Weather it: rain carves gullies and valleys and lays down sediment.
    const { deposit, flow } = erode(H, PX, this.seed, WATER_LEVEL);
    this.flow = flow;
    // Climate: the wind brings rain to the windward slopes and leaves a dry shadow behind ranges.
    const clim = climate(H, PX, this.seed, WATER_LEVEL);
    this.climBase = clim.base;
    this.wind = clim.wind;
    // Rivers and lakes: drainage carves channels and fills basins, fed by that rain.
    const hyd = hydrology(H, PX, WATER_LEVEL, clim.rain);
    this.water = hyd.water;
    this.nearWater = hyd.bank;
    // Land by water stays damp whatever the rain.
    this.moist = clim.moist;
    for (let i = 0; i < this.moist.length; i++) if (hyd.bank[i]) this.moist[i] = Math.min(1, this.moist[i] + 0.2);
    for (let i = 0; i < hyd.kind.length; i++) this.lake[i] = hyd.kind[i] === 2 ? 1 : 0;
    const hAt = (x: number, z: number) => H[Math.max(0, Math.min(PZ - 1, z)) * PX + Math.max(0, Math.min(PX - 1, x))];
    const strata = new Strata(this.seed);
    const slopeAt = (x: number, z: number) => Math.max(Math.abs(hAt(x + 1, z) - hAt(x - 1, z)), Math.abs(hAt(x, z + 1) - hAt(x, z - 1))) / 2;
    const SL = new Float32Array(PX * PZ);
    for (let z = 0; z < PZ; z++) for (let x = 0; x < PX; x++) SL[z * PX + x] = slopeAt(x, z);
    for (let z = 0; z < PZ; z++) {
      for (let x = 0; x < PX; x++) {
        const h = hAt(x, z);
        const i2 = z * PX + x;
        const slope = SL[i2];
        // Ridges shed soil and hollows collect it.
        const hollow = (hAt(x + 3, z) + hAt(x - 3, z) + hAt(x, z + 3) + hAt(x, z - 3)) / 4 - h;
        // Below a cliff, broken rock piles up as scree.
        let cliffAbove = false;
        for (let dz = -3; dz <= 3 && !cliffAbove; dz++) for (let dx = -3; dx <= 3; dx++) {
          const j = Math.max(0, Math.min(PZ - 1, z + dz)) * PX + Math.max(0, Math.min(PX - 1, x + dx));
          if (SL[j] > 1.2 && H[j] > h + 1.5) { cliffAbove = true; break; }
        }
        const dep = deposit[i2];
        // How much water drains through here (log scale): gullies, then streams, then valley floors.
        const wet = Math.log1p(flow[i2]);
        // Soil is thick where sediment settled and thin where water stripped it.
        let soil = 1.5 + (n3.fbm(x * 0.03, z * 0.03, 2) + 1) * 1.2 + Math.max(0, dep) * 1.6 + Math.min(0, dep) * 0.8;
        soil += Math.max(-1.5, Math.min(2, hollow * 1.2));
        if (h > 18) soil *= Math.max(0, 1 - (h - 18) / 6);
        if (slope > 1.1) soil = 0;
        else if (slope > 0.75) soil *= (1.1 - slope) / 0.35;
        let top: Mat = Mat.Grass;
        const wl = hyd.water[i2];
        if (!Number.isNaN(wl) && h < wl) {
          // Lake beds are silty clay; rivers wash their beds to sand, and to gravel where they run strong or steep.
          top = this.lake[i2] ? Mat.Clay : hyd.catchment[i2] > 1500 || slope > 0.35 ? Mat.Gravel : Mat.Sand;
          soil = Math.max(soil, 1.2);
        } else if (hyd.bank[i2] && slope < 0.9 && n2.noise(x * 0.15, z * 0.15) > 0.05) {
          // Clay along the banks: where you dig for pottery.
          top = Mat.Clay;
          soil = Math.max(soil, 1.2);
        } else if (soil < 0.4) top = Mat.Rock;
        else if (cliffAbove && slope > 0.35 && slope < 1.1 && h > 1.5) top = Mat.Gravel;
        else if (h < 1.2) top = n2.noise(x * 0.06, z * 0.06) > 0.35 && h > -2 ? Mat.Clay : Mat.Sand;
        // Fine silt settles along well-watered valley floors: that's where clay is.
        else if (h < 8 && wet > CLAY_FLOW && dep > 0.15 && slope < 0.4) top = Mat.Clay;
        // Coarse sediment fans out where streams leave the hills.
        else if (h < 2.5 && dep > 2) top = Mat.Sand;
        else if (h < 3.5 && n3.noise(x * 0.05 + 40, z * 0.05) > 0.7) top = Mat.Clay;
        const under = top === Mat.Sand || top === Mat.Clay || top === Mat.Gravel ? top : Mat.Dirt;
        for (let yi = 0; yi < PY; yi++) {
          const y = Y_MIN + yi;
          const depth = h - y;
          let dens = Math.max(0, Math.min(1, depth + 0.5));
          if (dens <= 0) break; // everything above is air (arrays start zeroed)
          let m: Mat;
          if (depth < soil && top !== Mat.Rock) m = depth < 1 ? top : under;
          else {
            m = ROCK_MAT[strata.at(x, y, z)];
            // A few iron veins cut the granite deep down, too.
            if (m === Mat.Rock && depth > 6 && ore.noise3(x * 0.09, y * 0.09, z * 0.09) > 0.72) m = Mat.Iron;
          }
          // Winding caves through the hills, above sea level so they stay dry.
          if (y > 2 && depth > 4) {
            const a = cave.noise3(x * 0.045, y * 0.07, z * 0.045);
            if (Math.abs(a) < 0.09) {
              const b = cave.noise3(x * 0.045 + 100, y * 0.07, z * 0.045);
              const c = Math.max(Math.abs(a), Math.abs(b)) / 0.09;
              if (c < 1.3) dens = Math.min(dens, Math.max(0, Math.min(1, (c - 1) * 3 + 0.5)));
            }
          }
          const i = this.idx(x, yi, z);
          this.density[i] = Math.round(dens * 255);
          this.mat[i] = m;
        }
      }
    }
    this.updateHeights(0, 0, PX - 1, PZ - 1);
  }

  // ---------- editing
  private forPoints(cx: number, cy: number, cz: number, r: number, fn: (i: number, x: number, y: number, z: number, dist: number) => void) {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(PX - 1, Math.ceil(cx + r));
    const y0 = Math.max(Y_MIN + 1, Math.floor(cy - r)), y1 = Math.min(Y_MAX, Math.ceil(cy + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(PZ - 1, Math.ceil(cz + r));
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const dist = Math.hypot(x - cx, y - cy, z - cz);
          if (dist <= r) fn(this.idx(x, y - Y_MIN, z), x, y, z, dist);
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
    const plan: [number, number][] = [];
    let total = 0;
    const done = this.forPoints(cx, cy, cz, r, (i, _x, _y, _z, dist) => {
      const cur = this.density[i];
      if (cur === 0 || !can(this.mat[i])) return;
      const w = Math.min(1, (r - dist) / 0.9);
      const take = Math.min(cur, w * 255);
      if (take > 0) { plan.push([i, take]); total += take; }
    });
    const scale = total > 0 ? Math.min(1, (budget * 255) / total) : 0;
    const out: Volumes = {};
    for (const [i, take] of plan) {
      const t = Math.round(take * scale);
      if (!t) continue;
      this.density[i] -= t;
      const m = this.mat[i] as Mat;
      out[m] = (out[m] ?? 0) + t / 255;
    }
    done();
    return out;
  }

  /** Add up to `budget` m³ of `fill` material in a soft-edged sphere. Returns volume added. */
  fill(cx: number, cy: number, cz: number, r: number, budget: number, fill: Mat): number {
    const plan: [number, number][] = [];
    let total = 0;
    const done = this.forPoints(cx, cy, cz, r, (i, _x, _y, _z, dist) => {
      const cur = this.density[i];
      const w = Math.min(1, (r - dist) / 0.9);
      const add = Math.min(255 - cur, w * 255);
      if (add > 0) { plan.push([i, add]); total += add; }
    });
    const scale = total > 0 ? Math.min(1, (budget * 255) / total) : 0;
    let added = 0;
    for (const [i, add] of plan) {
      const a = Math.round(add * scale);
      if (!a) continue;
      if (this.density[i] < ISO) this.mat[i] = fill;
      this.density[i] += a;
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
    const cuts: [number, number][] = [];
    const adds: [number, number][] = [];
    let cutTotal = 0, addTotal = 0, offBy = 0;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(PX - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(PZ - 1, Math.ceil(cz + r));
    let ylo = Infinity, yhi = -Infinity;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.hypot(x - cx, z - cz);
        if (dist > r) continue;
        const w = Math.min(1, (r - dist) / 1.2);
        const top = this.heights[z * PX + x];
        if (dist < r - 1) offBy = Math.max(offBy, Math.abs(top - target));
        const lo = Math.max(Y_MIN + 1, Math.floor(Math.min(top, target)) - 2);
        const hi = Math.min(Y_MAX, Math.ceil(Math.max(top, target)) + 2);
        ylo = Math.min(ylo, lo); yhi = Math.max(yhi, hi);
        for (let y = lo; y <= hi; y++) {
          const i = this.idx(x, y - Y_MIN, z);
          const want = Math.max(0, Math.min(1, target - y + 0.5)) * 255;
          const cur = this.density[i];
          const delta = (want - cur) * w;
          if (delta < -1 && can(this.mat[i] as Mat)) { cuts.push([i, -delta]); cutTotal -= delta; }
          else if (delta > 1) { adds.push([i, delta]); addTotal += delta; }
        }
      }
    }
    const cutScale = cutTotal > 0 ? Math.min(1, (budget * 255) / cutTotal) : 0;
    const addScale = addTotal > 0 ? Math.min(1, (Math.min(budget, fillBudget) * 255) / addTotal) : 0;
    const removed: Volumes = {};
    let added = 0;
    for (const [i, amt] of cuts) {
      const t = Math.min(this.density[i], Math.round(amt * cutScale));
      if (!t) continue;
      this.density[i] -= t;
      const m = this.mat[i] as Mat;
      removed[m] = (removed[m] ?? 0) + t / 255;
    }
    for (const [i, amt] of adds) {
      const a = Math.min(255 - this.density[i], Math.round(amt * addScale));
      if (!a) continue;
      if (this.density[i] < ISO) this.mat[i] = fill;
      this.density[i] += a;
      added += a / 255;
    }
    if (ylo <= yhi) this.touched(x0, ylo, z0, x1, yhi, z1);
    return { removed, added, offBy, blocked: cutTotal === 0 && addTotal === 0 };
  }

  /** Blur the soft ground in a sphere, rounding off bumps and ledges. */
  smooth(cx: number, cy: number, cz: number, r: number) {
    const changes: [number, number, Mat][] = [];
    const done = this.forPoints(cx, cy, cz, r, (i, x, y, z, dist) => {
      const m0 = this.mat[i] as Mat;
      if (this.density[i] >= ISO && !isSoft(m0)) return;
      let sum = 0, best = -1, bestMat = Mat.Dirt;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const dd = this.d(x + dx, y + dy, z + dz);
        sum += dd;
        if (dd > best && isSoft(this.m(x + dx, y + dy, z + dz))) { best = dd; bestMat = this.m(x + dx, y + dy, z + dz); }
      }
      const w = Math.min(1, (r - dist) / 1.0) * 0.6;
      const v = Math.round(this.density[i] + (sum / 27 - this.density[i]) * w);
      changes.push([i, v, this.density[i] < ISO && v >= ISO ? bestMat : m0]);
    });
    for (const [i, v, m] of changes) { this.density[i] = v; this.mat[i] = m; }
    done();
  }

  /** Repaint the surface layer (e.g. tilling a field). Returns how many points changed. */
  paint(cx: number, cy: number, cz: number, r: number, to: Mat, can: (m: Mat) => boolean): number {
    let n = 0;
    const done = this.forPoints(cx, cy, cz, r, (i, x, y, z) => {
      if (this.density[i] < 60 || !can(this.mat[i] as Mat)) return;
      // Only the skin: points with open air close above.
      if (this.d(x, y + 1, z) >= ISO && this.d(x, y + 2, z) >= ISO) return;
      if (this.mat[i] !== to) { this.mat[i] = to; n++; }
    });
    done();
    return n;
  }

  /** Slowly regrow grass on bare dirt next to grass. */
  randomTick() {
    const x = 1 + Math.floor(Math.random() * (PX - 2)), z = 1 + Math.floor(Math.random() * (PZ - 2));
    const h = this.heights[z * PX + x];
    if (h < this.waterAt(x, z) + 0.3) return;
    const y = Math.floor(h);
    const i = this.idx(x, y - Y_MIN, z);
    if (this.mat[i] !== Mat.Dirt) return;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nh = Math.floor(this.heights[(z + oz) * PX + x + ox]);
      if (this.m(x + ox, nh, z + oz) === Mat.Grass) {
        this.mat[i] = Mat.Grass;
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
  }

  // ---------- meshing
  /** Queue every chunk; near ones are built first by `update`. */
  buildMeshes() {
    for (let cy = 0; cy < NCY; cy++) for (let cz = 0; cz < NCZ; cz++) for (let cx = 0; cx < NCX; cx++) this.dirty.add(chunkId(cx, cy, cz));
  }

  /** Remesh dirty chunks, nearest first, within a time budget (ms). */
  update(px: number, pz: number, budgetMs: number) {
    if (!this.dirty.size) return;
    const start = performance.now();
    const list = [...this.dirty];
    const dist = (id: number) => {
      const cx = id % NCX, cz = Math.floor(id / NCX) % NCZ;
      return Math.hypot((cx + 0.5) * CH - px, (cz + 0.5) * CH - pz);
    };
    list.sort((a, b) => dist(a) - dist(b));
    for (const id of list) {
      // Always finish anything right next to the player so edits show at once.
      if (performance.now() - start > budgetMs && dist(id) > CH * 1.5) break;
      this.dirty.delete(id);
      this.buildChunk(id);
    }
  }

  get pendingChunks() { return this.dirty.size; }

  private buildChunk(id: number) {
    const cx = id % NCX, cz = Math.floor(id / NCX) % NCZ, cy = Math.floor(id / (NCX * NCZ));
    const x0 = cx * CH, z0 = cz * CH, y0 = Y_MIN + cy * CH;
    const S = CH + 1;
    // Quick reject: no surface crossing anywhere in range.
    let anySolid = false, anyAir = false;
    for (let y = y0 - 1; y <= y0 + CH && !(anySolid && anyAir); y++) {
      for (let z = z0 - 1; z <= z0 + CH && !(anySolid && anyAir); z++) {
        for (let x = x0 - 1; x <= x0 + CH; x++) {
          if (this.d(x, y, z) >= ISO) anySolid = true; else anyAir = true;
        }
      }
    }
    const old = this.meshes.get(id);
    if (!(anySolid && anyAir)) {
      if (old) { this.group.remove(old); old.geometry.dispose(); this.meshes.delete(id); }
      return;
    }

    const vid = new Int32Array(S * S * S).fill(-1);
    const pos: number[] = [], nor: number[] = [], col: number[] = [], index: number[] = [];
    const c = new Float32Array(8);
    let nv = 0;
    for (let lz = 0; lz < S; lz++) {
      const gz = z0 + lz - 1;
      if (gz < 0 || gz >= WORLD_SIZE) continue;
      for (let ly = 0; ly < S; ly++) {
        const gy = y0 + ly - 1;
        if (gy < Y_MIN || gy >= Y_MAX) continue;
        for (let lx = 0; lx < S; lx++) {
          const gx = x0 + lx - 1;
          if (gx < 0 || gx >= WORLD_SIZE) continue;
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
    if (!index.length) {
      if (old) { this.group.remove(old); old.geometry.dispose(); this.meshes.delete(id); }
      return;
    }
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

  // ---------- persistence: only chunks you changed are stored
  serialize() {
    const chunks: [number, string, string][] = [];
    for (const id of this.edited) {
      const [d, m] = this.chunkBytes(id);
      chunks.push([id, rle(d), rle(m)]);
    }
    return { seed: this.seed, chunks };
  }

  load(data: { chunks: [number, string, string][] }) {
    for (const [id, d, m] of data.chunks) {
      this.writeChunkBytes(id, unrle(d), unrle(m));
      this.edited.add(id);
    }
    this.updateHeights(0, 0, PX - 1, PZ - 1);
  }

  private chunkRange(id: number) {
    const cx = id % NCX, cz = Math.floor(id / NCX) % NCZ, cy = Math.floor(id / (NCX * NCZ));
    // The last chunk on each axis also owns the final row of points.
    return {
      x0: cx * CH, x1: cx === NCX - 1 ? PX - 1 : cx * CH + CH - 1,
      y0: cy * CH, y1: cy === NCY - 1 ? PY - 1 : cy * CH + CH - 1,
      z0: cz * CH, z1: cz === NCZ - 1 ? PZ - 1 : cz * CH + CH - 1,
    };
  }

  private chunkBytes(id: number): [Uint8Array, Uint8Array] {
    const r = this.chunkRange(id);
    const n = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) * (r.z1 - r.z0 + 1);
    const d = new Uint8Array(n), m = new Uint8Array(n);
    let k = 0;
    for (let y = r.y0; y <= r.y1; y++) for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
      const i = this.idx(x, y, z);
      d[k] = this.density[i]; m[k] = this.mat[i]; k++;
    }
    return [d, m];
  }

  private writeChunkBytes(id: number, d: Uint8Array, m: Uint8Array) {
    const r = this.chunkRange(id);
    let k = 0;
    for (let y = r.y0; y <= r.y1; y++) for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
      const i = this.idx(x, y, z);
      this.density[i] = d[k]; this.mat[i] = m[k]; k++;
    }
  }
}

const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const cOf = (v: number) => Math.max(0, Math.min(NCX - 1, Math.floor(v / CH)));
const cyOf = (y: number) => Math.max(0, Math.min(NCY - 1, Math.floor((y - Y_MIN) / CH)));
const chunkId = (cx: number, cy: number, cz: number) => (cy * NCZ + cz) * NCX + cx;

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
