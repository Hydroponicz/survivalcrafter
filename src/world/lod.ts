import * as THREE from 'three';
import { CELL, LOD_N, PAD, TILE, TN, tileLodColors, type TileData } from './worldgen';

// The distant land: every map tile near enough to see becomes one low-detail
// mesh (its core, at the 8 m map grid), coloured from the same climate and
// materials as the near terrain, so mountain ranges kilometres away are on
// the horizon wherever you go. Skirts hang down from each tile's edges so the
// joins never show gaps. Near you the detailed voxel terrain takes over: these
// meshes cut a hole where it's loaded, and sit a little lower so the two never
// fight at the seam.

/** How far (in tiles) distant land is drawn around you. */
export const LOD_TILES = 3;
const SKIRT = 30;

export class DistantLand {
  readonly group = new THREE.Group();
  private hole = { value: new THREE.Vector3(0, 0, 0) }; // x, z, radius
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  private waterMaterial: THREE.Material;
  private index: THREE.BufferAttribute;
  private tiles = new Map<string, THREE.Group>();

  constructor(waterMaterial: THREE.Material) {
    this.patch(this.material);
    this.waterMaterial = (waterMaterial as THREE.MeshStandardMaterial).clone();
    this.patch(this.waterMaterial);
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

  /** A tile's map is ready: build its distant land (colours may come from the worker). */
  addTile(d: TileData, lod?: Float32Array) {
    const key = `${d.tx},${d.tz}`;
    if (this.tiles.has(key)) return;
    const N = LOD_N, off = PAD / CELL;
    const cols = lod ?? tileLodColors(d);
    const edge = this.edgeLoop();
    const pos = new Float32Array((N * N + edge.length) * 3);
    const col = new Float32Array((N * N + edge.length) * 3);
    const x0 = d.tx * TILE, z0 = d.tz * TILE;
    for (let lz = 0; lz < N; lz++) {
      for (let lx = 0; lx < N; lx++) {
        const k = lz * N + lx;
        pos[k * 3] = x0 + lx * CELL;
        pos[k * 3 + 1] = d.H[(lz + off) * TN + lx + off] - 1.2;
        pos[k * 3 + 2] = z0 + lz * CELL;
      }
    }
    col.set(cols);
    for (let k = 0; k < edge.length; k++) {
      const e = edge[k], s = N * N + k;
      pos[s * 3] = pos[e * 3]; pos[s * 3 + 1] = pos[e * 3 + 1] - SKIRT; pos[s * 3 + 2] = pos[e * 3 + 2];
      col[s * 3] = cols[e * 3]; col[s * 3 + 1] = cols[e * 3 + 1]; col[s * 3 + 2] = cols[e * 3 + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(this.index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const group = new THREE.Group();
    const land = new THREE.Mesh(geo, this.material);
    group.add(land);

    // Lakes, as flat sheets at their surface.
    const wpos: number[] = [], widx: number[] = [], wuv: number[] = [];
    const vid = new Map<number, number>();
    const v = (lx: number, lz: number, s: number) => {
      const key2 = lz * (N + 1) + lx;
      let id = vid.get(key2);
      if (id === undefined) {
        id = wpos.length / 3;
        vid.set(key2, id);
        const x = x0 + lx * CELL, z = z0 + lz * CELL;
        wpos.push(x, s - 0.6, z);
        wuv.push(x / 960, z / 960);
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
      wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
      wg.setIndex(widx);
      wg.computeVertexNormals();
      group.add(new THREE.Mesh(wg, this.waterMaterial));
    }
    group.userData = { tx: d.tx, tz: d.tz };
    this.tiles.set(key, group);
    this.group.add(group);
  }

  /** Drop distant land too far from a point to see. */
  prune(x: number, z: number) {
    for (const [key, g] of this.tiles) {
      const { tx, tz } = g.userData as { tx: number; tz: number };
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

  private patch(m: THREE.Material) {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uHole = this.hole;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLodPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLodPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLodPos;\nuniform vec3 uHole;')
        .replace('void main() {', 'void main() {\n  if (distance(vLodPos.xz, uHole.xy) < uHole.z) discard;');
    };
  }
}
