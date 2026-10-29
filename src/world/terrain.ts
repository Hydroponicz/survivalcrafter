import * as THREE from 'three';
import { Simplex, hash2 } from './noise';

// The world is a grid of tiles. Heights live on tile corners, in decimetres,
// exactly like Wurm: digging lowers one corner by 1 dm and gives you a dirt.
// Under the dirt is a rock layer; once you hit it you need a pickaxe.

export const WORLD_TILES = 192;
export const TILE = 2; // metres per tile
export const CHUNK = 32; // tiles per render chunk
export const WATER_LEVEL = 0;

export enum Tile {
  Grass = 0,
  Dirt = 1,
  Sand = 2,
  Clay = 3,
  Rock = 4,
  Field = 5,
}

export const TILE_NAMES: Record<Tile, string> = {
  [Tile.Grass]: 'Grass',
  [Tile.Dirt]: 'Dirt',
  [Tile.Sand]: 'Sand',
  [Tile.Clay]: 'Clay',
  [Tile.Rock]: 'Rock',
  [Tile.Field]: 'Field',
};

const SRGB_TILE_COLORS: Record<Tile, [number, number, number]> = {
  [Tile.Grass]: [0.30, 0.50, 0.19],
  [Tile.Dirt]: [0.43, 0.32, 0.21],
  [Tile.Sand]: [0.80, 0.72, 0.50],
  [Tile.Clay]: [0.55, 0.50, 0.47],
  [Tile.Rock]: [0.50, 0.49, 0.47],
  [Tile.Field]: [0.33, 0.23, 0.14],
};

// Vertex colours are interpreted as linear, so convert once up front.
const TILE_COLORS = Object.fromEntries(
  Object.entries(SRGB_TILE_COLORS).map(([k, c]) => [k, c.map((v) => Math.pow(v, 2.2))]),
) as unknown as Record<Tile, [number, number, number]>;

export class Terrain {
  readonly size = WORLD_TILES;
  readonly verts = WORLD_TILES + 1;
  surface: Int16Array;
  rock: Int16Array;
  tiles: Uint8Array;
  seed: number;
  private ore: Simplex;

  group = new THREE.Group();
  private chunks: THREE.Mesh[] = [];
  private dirty = new Set<number>();
  private material: THREE.MeshStandardMaterial;

  constructor(seed: number) {
    this.seed = seed;
    this.surface = new Int16Array(this.verts * this.verts);
    this.rock = new Int16Array(this.verts * this.verts);
    this.tiles = new Uint8Array(this.size * this.size);
    this.ore = new Simplex(seed ^ 0x5eed);
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: makeTileTexture(),
      roughness: 0.95,
      metalness: 0,
    });
  }

  // ---------- indexing
  ci(x: number, z: number) { return z * this.verts + x; }
  ti(x: number, z: number) { return z * this.size + x; }
  inTiles(tx: number, tz: number) { return tx >= 0 && tz >= 0 && tx < this.size && tz < this.size; }
  inCorners(x: number, z: number) { return x >= 0 && z >= 0 && x < this.verts && z < this.verts; }

  /** Corner height in metres. */
  cornerH(x: number, z: number): number {
    x = Math.max(0, Math.min(this.verts - 1, x));
    z = Math.max(0, Math.min(this.verts - 1, z));
    return this.surface[this.ci(x, z)] / 10;
  }

  tileType(tx: number, tz: number): Tile {
    if (!this.inTiles(tx, tz)) return Tile.Sand;
    return this.tiles[this.ti(tx, tz)] as Tile;
  }

  setTileType(tx: number, tz: number, t: Tile) {
    if (!this.inTiles(tx, tz)) return;
    this.tiles[this.ti(tx, tz)] = t;
    this.markDirtyTile(tx, tz);
  }

  /** Height in metres at a world position, matching the rendered triangles. */
  heightAt(wx: number, wz: number): number {
    const gx = wx / TILE;
    const gz = wz / TILE;
    const tx = Math.floor(gx);
    const tz = Math.floor(gz);
    const fx = gx - tx;
    const fz = gz - tz;
    const ha = this.cornerH(tx, tz);
    const hb = this.cornerH(tx + 1, tz);
    const hc = this.cornerH(tx, tz + 1);
    const hd = this.cornerH(tx + 1, tz + 1);
    if (fx + fz <= 1) return ha + (hb - ha) * fx + (hc - ha) * fz;
    return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }

  /** Max minus min corner height of a tile, in decimetres. */
  tileSlope(tx: number, tz: number): number {
    const hs = [
      this.surface[this.ci(tx, tz)], this.surface[this.ci(tx + 1, tz)],
      this.surface[this.ci(tx, tz + 1)], this.surface[this.ci(tx + 1, tz + 1)],
    ];
    return Math.max(...hs) - Math.min(...hs);
  }

  edgeSlope(tx: number, tz: number, axis: 'x' | 'z'): number {
    const a = this.surface[this.ci(tx, tz)];
    const b = axis === 'x' ? this.surface[this.ci(tx + 1, tz)] : this.surface[this.ci(tx, tz + 1)];
    return Math.abs(a - b);
  }

  dirtDepth(x: number, z: number): number {
    const i = this.ci(x, z);
    return this.surface[i] - this.rock[i];
  }

  /** Is there an iron vein at this tile? */
  oreAt(tx: number, tz: number): number {
    return this.ore.fbm(tx * 0.07, tz * 0.07, 2);
  }

  /** Re-derive the tile type after a corner height change. */
  updateTileAround(x: number, z: number) {
    for (let tz = z - 1; tz <= z; tz++) {
      for (let tx = x - 1; tx <= x; tx++) {
        if (!this.inTiles(tx, tz)) continue;
        let exposed = true;
        for (const [cx, cz] of [[tx, tz], [tx + 1, tz], [tx, tz + 1], [tx + 1, tz + 1]]) {
          if (this.dirtDepth(cx, cz) > 0) exposed = false;
        }
        const t = this.tileType(tx, tz);
        if (exposed && t !== Tile.Rock) this.setTileType(tx, tz, Tile.Rock);
        else if (!exposed && t === Tile.Rock) this.setTileType(tx, tz, Tile.Dirt);
        this.markDirtyTile(tx, tz);
      }
    }
  }

  changeCorner(x: number, z: number, dSurface: number, dRock = 0) {
    if (!this.inCorners(x, z)) return;
    const i = this.ci(x, z);
    this.surface[i] += dSurface;
    this.rock[i] += dRock;
    if (this.rock[i] > this.surface[i]) this.rock[i] = this.surface[i];
    this.updateTileAround(x, z);
  }

  // ---------- generation
  generate() {
    const n = new Simplex(this.seed);
    const n2 = new Simplex(this.seed + 17);
    const n3 = new Simplex(this.seed + 99);
    const V = this.verts;
    const half = this.size / 2;
    for (let z = 0; z < V; z++) {
      for (let x = 0; x < V; x++) {
        const nx = x / this.size;
        const nz = z / this.size;
        const dx = (x - half) / half;
        const dz = (z - half) / half;
        const d = Math.min(1, Math.sqrt(dx * dx + dz * dz));
        const fall = Math.pow(Math.max(0, d - 0.55) / 0.45, 2);
        const base = n.fbm(nx * 3, nz * 3, 5) * 9 + 4;
        const ridge = 1 - Math.abs(n2.fbm(nx * 2.2, nz * 2.2, 4));
        const mount = Math.pow(Math.max(0, ridge - 0.55) / 0.45, 2) * 32 *
          Math.max(0, n3.fbm(nx * 1.5 + 3, nz * 1.5, 2) + 0.4);
        const h = base + mount - fall * 26;
        const surf = Math.round(h * 10);
        let depth = Math.round(8 + (n3.fbm(nx * 6, nz * 6, 2) + 1) * 10);
        if (h > 18) depth = Math.max(0, Math.round(depth * (1 - (h - 18) / 6)));
        const i = this.ci(x, z);
        this.surface[i] = surf;
        this.rock[i] = surf - depth;
      }
    }
    // Steep slopes shed their soil, exposing rock.
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        if (this.tileSlope(x, z) > 28) {
          for (const [cx, cz] of [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]]) {
            const i = this.ci(cx, cz);
            this.rock[i] = this.surface[i];
          }
        }
      }
    }
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        let exposed = true;
        let minH = Infinity;
        for (const [cx, cz] of [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]]) {
          if (this.dirtDepth(cx, cz) > 0) exposed = false;
          minH = Math.min(minH, this.surface[this.ci(cx, cz)]);
        }
        let t = Tile.Grass;
        if (exposed) t = Tile.Rock;
        else if (minH < 12) {
          t = n2.noise(x * 0.12, z * 0.12) > 0.35 && minH > -20 ? Tile.Clay : Tile.Sand;
        } else if (minH < 35 && n3.noise(x * 0.1 + 40, z * 0.1) > 0.6) t = Tile.Clay;
        this.tiles[this.ti(x, z)] = t;
      }
    }
  }

  // ---------- rendering
  buildMeshes() {
    const per = this.size / CHUNK;
    for (let cz = 0; cz < per; cz++) {
      for (let cx = 0; cx < per; cx++) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.chunks.push(mesh);
        this.group.add(mesh);
        this.buildChunk(cx, cz);
      }
    }
  }

  markDirtyTile(tx: number, tz: number) {
    const per = this.size / CHUNK;
    // A corner change can affect neighbouring chunks' normals; mark generously.
    for (const [ox, oz] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = tx + ox, z = tz + oz;
      if (!this.inTiles(x, z)) continue;
      this.dirty.add(Math.floor(z / CHUNK) * per + Math.floor(x / CHUNK));
    }
  }

  rebuildDirty() {
    if (!this.dirty.size) return;
    const per = this.size / CHUNK;
    for (const id of this.dirty) this.buildChunk(id % per, Math.floor(id / per));
    this.dirty.clear();
  }

  private cornerNormal(x: number, z: number, out: THREE.Vector3) {
    const l = this.cornerH(x - 1, z), r = this.cornerH(x + 1, z);
    const d = this.cornerH(x, z - 1), u = this.cornerH(x, z + 1);
    out.set(l - r, 2 * TILE, d - u).normalize();
    return out;
  }

  private buildChunk(cx: number, cz: number) {
    const per = this.size / CHUNK;
    const mesh = this.chunks[cz * per + cx];
    const count = CHUNK * CHUNK * 6;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const nv = new THREE.Vector3();
    let p = 0;
    const push = (x: number, z: number, u: number, v: number, c: [number, number, number], shade: number) => {
      const h = this.cornerH(x, z);
      pos[p * 3] = x * TILE; pos[p * 3 + 1] = h; pos[p * 3 + 2] = z * TILE;
      this.cornerNormal(x, z, nv);
      nor[p * 3] = nv.x; nor[p * 3 + 1] = nv.y; nor[p * 3 + 2] = nv.z;
      // Darken soil that is wet/underwater.
      const wet = h < WATER_LEVEL + 0.2 ? 0.75 : 1;
      col[p * 3] = c[0] * shade * wet; col[p * 3 + 1] = c[1] * shade * wet; col[p * 3 + 2] = c[2] * shade * wet;
      uv[p * 2] = u; uv[p * 2 + 1] = v;
      p++;
    };
    for (let tz = cz * CHUNK; tz < (cz + 1) * CHUNK; tz++) {
      for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx++) {
        const t = this.tileType(tx, tz);
        const c = TILE_COLORS[t];
        const shade = 0.9 + hash2(tx, tz, 3) * 0.2;
        push(tx, tz, 0, 0, c, shade);
        push(tx, tz + 1, 0, 1, c, shade);
        push(tx + 1, tz, 1, 0, c, shade);
        push(tx + 1, tz, 1, 0, c, shade);
        push(tx, tz + 1, 0, 1, c, shade);
        push(tx + 1, tz + 1, 1, 1, c, shade);
      }
    }
    const g = mesh.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }

  // ---------- persistence
  serialize() {
    return {
      seed: this.seed,
      surface: toB64(new Uint8Array(this.surface.buffer)),
      rock: toB64(new Uint8Array(this.rock.buffer)),
      tiles: toB64(this.tiles),
    };
  }

  load(data: { surface: string; rock: string; tiles: string }) {
    this.surface = new Int16Array(fromB64(data.surface).buffer);
    this.rock = new Int16Array(fromB64(data.rock).buffer);
    this.tiles = fromB64(data.tiles);
  }
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A grayscale per-tile texture: speckled detail with soft darkened borders. */
function makeTileTexture(): THREE.Texture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      const border = edge < 1 ? 0.82 : edge < 2 ? 0.92 : 1;
      const speck = 0.86 + hash2(x, y, 7) * 0.14 + (hash2(x >> 2, y >> 2, 9) - 0.5) * 0.1;
      const v = Math.max(0, Math.min(255, 255 * border * speck));
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}
