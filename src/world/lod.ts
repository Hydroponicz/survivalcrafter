import * as THREE from 'three';
import { makeWaterMaterial } from './water';
import { BLEND, CELL, LOD_N, PAD, TILE, TN, tileLodColors, type TileData } from './worldgen';

// The distant land: every map tile near enough to see becomes one low-detail
// mesh (its core, at the 8 m map grid), coloured from the same climate and
// materials as the near terrain, so mountain ranges kilometres away are on
// the horizon wherever you go. Skirts hang down from each tile's edges so the
// joins never show gaps. Each tile is weathered on its own, so along the
// joins heights are blended with the neighbours' (as the near terrain does),
// and shading is worked out from the blended land, so no line shows where
// one tile meets the next. Near you the detailed voxel terrain takes over: these
// meshes cut a hole where it's loaded, and sit a little lower so the two never
// fight at the seam.

/** How far (in tiles) distant land is drawn around you. */
export const LOD_TILES = 3;
const SKIRT = 30;
/** Map cells per tile side, and how many cells either side of a join are blended. */
const N_CELLS = TILE / CELL, B_CELLS = BLEND / CELL, OFF = PAD / CELL;

interface LodTile { d: TileData; cols: Float32Array; group: THREE.Group; land: THREE.Mesh }

export class DistantLand {
  readonly group = new THREE.Group();
  private hole = { value: new THREE.Vector3(0, 0, 0) }; // x, z, radius
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  private waterMaterial = makeWaterMaterial({ depth: 'attribute', fresh: true, extra: (sh) => this.cut(sh), key: 'lod' });
  private index: THREE.BufferAttribute;
  private tiles = new Map<string, LodTile>();

  constructor() {
    this.material.onBeforeCompile = (sh) => this.cut(sh);
    // One index for every tile: the grid, then the skirt around its edge.
    const N = LOD_N;
    const idx: number[] = [];
    for (let z = 0; z < N - 1; z++) {
      for (let x = 0; x < N - 1; x++) {
        const a = z * N + x, b = a + 1, c = a + N, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const edge = this.edgeLoop();
    const base = N * N;
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k], b = edge[(k + 1) % edge.length];
      const sa = base + k, sb = base + ((k + 1) % edge.length);
      idx.push(a, sa, b, b, sa, sb);
    }
    this.index = new THREE.BufferAttribute(new Uint32Array(idx), 1);
  }

  /** The grid points around a tile's edge, in order. */
  private edgeLoop(): number[] {
    const N = LOD_N, out: number[] = [];
    for (let x = 0; x < N - 1; x++) out.push(x);
    for (let z = 0; z < N - 1; z++) out.push(z * N + N - 1);
    for (let x = N - 1; x > 0; x--) out.push((N - 1) * N + x);
    for (let z = N - 1; z > 0; z--) out.push(z * N);
    return out;
  }

  /** A tile's map height at a map grid point (world cells), if the point lies in its map. */
  private static sample(d: TileData, gx: number, gz: number): number {
    const lx = gx - d.tx * N_CELLS + OFF, lz = gz - d.tz * N_CELLS + OFF;
    if (lx < 0 || lz < 0 || lx >= TN || lz >= TN) return NaN;
    return d.H[lz * TN + lx];
  }

  /**
   * Land height at a map grid point: the tile it's in, blended toward its
   * neighbours near the joins with the same weights as the near terrain.
   * `nb` holds the 3×3 tiles around tile (cx, cz); ones not loaded yet are
   * left out (and the join is redone when they come).
   */
  private static heightAt(gx: number, gz: number, nb: (TileData | null)[], cx: number, cz: number): number {
    const tx = Math.floor(gx / N_CELLS), tz = Math.floor(gz / N_CELLS);
    const fx = gx - tx * N_CELLS, fz = gz - tz * N_CELLS;
    let x1 = tx, wx = 0, z1 = tz, wz = 0;
    if (fx < B_CELLS) { x1 = tx - 1; wx = 0.5 * (1 - fx / B_CELLS); } else if (N_CELLS - fx < B_CELLS) { x1 = tx + 1; wx = 0.5 * (1 - (N_CELLS - fx) / B_CELLS); }
    if (fz < B_CELLS) { z1 = tz - 1; wz = 0.5 * (1 - fz / B_CELLS); } else if (N_CELLS - fz < B_CELLS) { z1 = tz + 1; wz = 0.5 * (1 - (N_CELLS - fz) / B_CELLS); }
    let s = 0, ws = 0;
    const add = (x: number, z: number, w: number) => {
      if (w <= 0) return;
      const ix = x - cx + 1, iz = z - cz + 1;
      if (ix < 0 || iz < 0 || ix > 2 || iz > 2) return;
      const d = nb[iz * 3 + ix];
      if (!d) return;
      const h = DistantLand.sample(d, gx, gz);
      if (h !== h) return;
      s += h * w; ws += w;
    };
    add(tx, tz, (1 - wx) * (1 - wz));
    add(x1, tz, wx * (1 - wz));
    add(tx, z1, (1 - wx) * wz);
    add(x1, z1, wx * wz);
    return ws > 0 ? s / ws : DistantLand.sample(nb[4]!, gx, gz);
  }

  /**
   * Work out heights, shading normals and (on the very edge) colours for a
   * tile's land: all of it, or just the band along its join with the tile
   * at offset (sx, sz) (each -1, 0 or 1).
   */
  private shape(t: LodTile, bandsOnly: boolean, sx = 0, sz = 0) {
    const N = LOD_N, d = t.d;
    const nb: (TileData | null)[] = [];
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) nb.push(this.tiles.get(`${d.tx + ox},${d.tz + oz}`)?.d ?? null);
    nb[4] = d;
    const H = (gx: number, gz: number) => DistantLand.heightAt(gx, gz, nb, d.tx, d.tz);
    const geo = t.land.geometry;
    const pos = geo.attributes.position.array as Float32Array;
    const nor = geo.attributes.normal.array as Float32Array;
    const col = geo.attributes.color.array as Float32Array;
    const gx0 = d.tx * N_CELLS, gz0 = d.tz * N_CELLS;
    const band = B_CELLS + 1;
    const inX = (lx: number) => sx < 0 ? lx <= band : sx > 0 ? lx >= N - 1 - band : true;
    const inZ = (lz: number) => sz < 0 ? lz <= band : sz > 0 ? lz >= N - 1 - band : true;
    for (let lz = 0; lz < N; lz++) {
      if (bandsOnly && !inZ(lz)) continue;
      for (let lx = 0; lx < N; lx++) {
        if (bandsOnly && !inX(lx)) continue;
        const k = lz * N + lx, gx = gx0 + lx, gz = gz0 + lz;
        pos[k * 3 + 1] = H(gx, gz) - 1.2;
        const hx = H(gx + 1, gz) - H(gx - 1, gz);
        const hz = H(gx, gz + 1) - H(gx, gz - 1);
        const nx = -hx / (2 * CELL), nz = -hz / (2 * CELL), l = Math.hypot(nx, 1, nz);
        nor[k * 3] = nx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = nz / l;
        // Points on the join itself take the average colour of the tiles sharing them.
        const onX = lx === 0 || lx === N - 1, onZ = lz === 0 || lz === N - 1;
        col[k * 3] = t.cols[k * 3]; col[k * 3 + 1] = t.cols[k * 3 + 1]; col[k * 3 + 2] = t.cols[k * 3 + 2];
        if (onX || onZ) {
          let n = 1;
          for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const o = nb[(oz + 1) * 3 + ox + 1] && this.tiles.get(`${d.tx + ox},${d.tz + oz}`);
            if (!o) continue;
            const mx = lx - ox * N_CELLS, mz = lz - oz * N_CELLS;
            if (mx < 0 || mz < 0 || mx >= N || mz >= N) continue;
            const j = (mz * N + mx) * 3;
            col[k * 3] += o.cols[j]; col[k * 3 + 1] += o.cols[j + 1]; col[k * 3 + 2] += o.cols[j + 2];
            n++;
          }
          col[k * 3] /= n; col[k * 3 + 1] /= n; col[k * 3 + 2] /= n;
        }
      }
    }
    // The skirt follows the edge.
    const edge = this.edgeLoop();
    for (let k = 0; k < edge.length; k++) {
      const e = edge[k], s = N * N + k;
      pos[s * 3 + 1] = pos[e * 3 + 1] - SKIRT;
      for (let c = 0; c < 3; c++) { nor[s * 3 + c] = nor[e * 3 + c]; col[s * 3 + c] = col[e * 3 + c]; }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  /** A tile's map is ready: build its distant land (colours may come from the worker). */
  addTile(d: TileData, lod?: Float32Array) {
    const key = `${d.tx},${d.tz}`;
    if (this.tiles.has(key)) return;
    const N = LOD_N;
    const cols = lod ?? tileLodColors(d);
    const edge = this.edgeLoop();
    const nv = N * N + edge.length;
    const pos = new Float32Array(nv * 3);
    const x0 = d.tx * TILE, z0 = d.tz * TILE;
    for (let lz = 0; lz < N; lz++) {
      for (let lx = 0; lx < N; lx++) {
        const k = lz * N + lx;
        pos[k * 3] = x0 + lx * CELL;
        pos[k * 3 + 2] = z0 + lz * CELL;
      }
    }
    for (let k = 0; k < edge.length; k++) {
      const e = edge[k], s = N * N + k;
      pos[s * 3] = pos[e * 3]; pos[s * 3 + 2] = pos[e * 3 + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setIndex(this.index);
    const group = new THREE.Group();
    const land = new THREE.Mesh(geo, this.material);
    group.add(land);
    const t: LodTile = { d, cols, group, land };
    this.tiles.set(key, t);
    this.shape(t, false);
    // The neighbours' joins with this tile can now be blended properly.
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        const o = (ox || oz) && this.tiles.get(`${d.tx + ox},${d.tz + oz}`);
        if (o) this.shape(o, true, -ox, -oz);
      }
    }
    const off = OFF;

    // Lakes, as flat sheets at their surface.
    const wpos: number[] = [], widx: number[] = [], wdepth: number[] = [];
    const vid = new Map<number, number>();
    const v = (lx: number, lz: number, s: number) => {
      const key2 = lz * (N + 1) + lx;
      let id = vid.get(key2);
      if (id === undefined) {
        id = wpos.length / 3;
        vid.set(key2, id);
        const x = x0 + lx * CELL, z = z0 + lz * CELL;
        wpos.push(x, s - 0.6, z);
        wdepth.push(s - d.H[(lz + off) * TN + lx + off]);
      }
      return id;
    };
    for (let lz = 0; lz < N - 1; lz++) {
      for (let lx = 0; lx < N - 1; lx++) {
        const i = (lz + off) * TN + lx + off;
        if (d.kind[i] !== 2 && d.kind[i + 1] !== 2 && d.kind[i + TN] !== 2 && d.kind[i + TN + 1] !== 2) continue;
        let s = NaN;
        for (const j of [i, i + 1, i + TN, i + TN + 1]) if (d.kind[j] === 2) { s = d.S[j]; break; }
        const a = v(lx, lz, s), b = v(lx + 1, lz, s), c = v(lx, lz + 1, s), dd = v(lx + 1, lz + 1, s);
        widx.push(a, c, b, b, c, dd);
      }
    }
    if (widx.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      wg.setAttribute('depth', new THREE.Float32BufferAttribute(wdepth, 1));
      wg.setIndex(widx);
      wg.computeVertexNormals();
      group.add(new THREE.Mesh(wg, this.waterMaterial));
    }
    this.group.add(group);
  }

  /** Drop distant land too far from a point to see. */
  prune(x: number, z: number) {
    this.lastTx = NaN;
    for (const [key, t] of this.tiles) {
      const g = t.group, tx = t.d.tx, tz = t.d.tz;
      if (Math.max(Math.abs((tx + 0.5) * TILE - x), Math.abs((tz + 0.5) * TILE - z)) <= (LOD_TILES + 1.5) * TILE) continue;
      for (const m of g.children) (m as THREE.Mesh).geometry.dispose();
      this.group.remove(g);
      this.tiles.delete(key);
    }
  }

  has(tx: number, tz: number) { return this.tiles.has(`${tx},${tz}`); }

  /** Cut a hole where the detailed terrain is (x, z, radius). */
  setHole(x: number, z: number, r: number) {
    this.hole.value.set(x, z, r);
  }

  /** Patch a shader to leave out the hole. */
  private cut(shader: THREE.WebGLProgramParametersWithUniforms) {
    shader.uniforms.uHole = this.hole;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLodPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLodPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLodPos;\nuniform vec3 uHole;')
      .replace('void main() {', 'void main() {\n  if (distance(vLodPos.xz, uHole.xy) < uHole.z) discard;');
  }

  /** Land height from the map at a point (nearest map point), or NaN where no tile is loaded. */
  groundAt(x: number, z: number): number {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    if (tx !== this.lastTx || tz !== this.lastTz) { this.lastTx = tx; this.lastTz = tz; this.lastTile = this.tiles.get(`${tx},${tz}`)?.d ?? null; }
    const d = this.lastTile;
    if (!d) return NaN;
    return d.H[(Math.round((z - tz * TILE) / CELL) + OFF) * TN + Math.round((x - tx * TILE) / CELL) + OFF];
  }
  private lastTx = NaN;
  private lastTz = NaN;
  private lastTile: TileData | null = null;
}
