import * as THREE from 'three';
import { tempAt, zoneOf } from './climate';
import { hash2, Simplex } from './noise';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GROWN } from './treefx';
import { VEGETATION } from './world';
import { CELL, PAD, SEA, TILE, TN, type TileData } from './worldgen';

// Forests to the horizon. The real trees only stand within a couple of
// hundred metres of you; beyond that each distant land tile carries
// stand-ins (pared-down copies of the real trees, all of a kind drawn at
// once) wherever the same climate and stand-and-clearing pattern would grow
// trees. From afar the
// woods, clearings and tree lines read as they do up close.

/** Map cells between candidate trees, at full detail (16 m). */
const STEP = 2;
type Kind = 'oak' | 'birch' | 'pine';
const KINDS: Kind[] = ['oak', 'birch', 'pine'];
const LEAF: Record<Kind, number> = { oak: 0x3f7a2c, birch: 0x7aa33e, pine: 0x2b5a33 };
const BARK: Record<Kind, number> = { oak: 0x5a4030, birch: 0xd8d4c8, pine: 0x4a3426 };

/** Paint a geometry one colour (as vertex colours) and drop what merging doesn't need. */
function painted(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = ng.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

/**
 * A pared-down copy of each kind of real tree (see treeGeometries in
 * view.ts), in the same shapes and colours: trunk and crowns, with far fewer
 * sides, so from a distance they're the same trees.
 */
function standIn(kind: Kind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'pine') {
    parts.push(painted(new THREE.CylinderGeometry(0.14, 0.24, 4.5, 4, 1, true).translate(0, 2.25, 0), BARK.pine));
    for (let i = 0; i < 3; i++) parts.push(painted(new THREE.ConeGeometry(1.5 - i * 0.38, 2.0, 5, 1, true).translate(0, 2.4 + i * 1.25, 0), LEAF.pine));
  } else if (kind === 'birch') {
    parts.push(painted(new THREE.CylinderGeometry(0.11, 0.17, 4.6, 4, 1, true).translate(0, 2.3, 0), BARK.birch));
    parts.push(painted(new THREE.IcosahedronGeometry(1.2, 0).scale(1.05, 1.5, 1.05).translate(0, 4.3, 0), LEAF.birch));
  } else {
    parts.push(painted(new THREE.CylinderGeometry(0.2, 0.3, 3.4, 4, 1, true).translate(0, 1.7, 0), BARK.oak));
    parts.push(painted(new THREE.IcosahedronGeometry(2.1, 0).scale(1.05, 0.85, 1.05).translate(0.1, 3.85, -0.1), LEAF.oak));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

export interface StandIns { mesh: THREE.InstancedMesh; counts: [number, number, number] }

export class FarForest {
  readonly geometry = Object.fromEntries(KINDS.map((k) => [k, standIn(k)])) as Record<Kind, THREE.BufferGeometry>;
  // Lit like the real trees.
  readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });
  /** x, z, radius: the stand-ins give way to the real trees within this circle around you. */
  readonly near = { value: new THREE.Vector3(0, 0, 0) };
  private forest: Simplex;

  constructor(private seed: number) {
    this.forest = new Simplex(seed + 1234);
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uNear = this.near;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uNear;')
        .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    if (distance(root.xz, uNear.xy) < uNear.z) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`);
    };
  }

  /**
   * The stand-ins for one tile, coarsest first: the first `counts[2]` are
   * enough for a far-off tile, `counts[1]` for a middling one, all of them
   * near. The coarser ones are bigger, so thinned-out woods still look full.
   */
  build(d: TileData): StandIns[] {
    const off = PAD / CELL, N = TILE / CELL;
    const levels: number[][] = [[], [], []];
    for (let lz = 0; lz < N; lz += STEP) {
      for (let lx = 0; lx < N; lx += STEP) {
        const level = lx % (STEP * 4) === 0 && lz % (STEP * 4) === 0 ? 2 : lx % (STEP * 2) === 0 && lz % (STEP * 2) === 0 ? 1 : 0;
        levels[level].push(lx, lz);
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const mats: Record<Kind, number[]> = { oak: [], birch: [], pine: [] }, cols: Record<Kind, number[]> = { oak: [], birch: [], pine: [] };
    const counts: Record<Kind, [number, number, number]> = { oak: [0, 0, 0], birch: [0, 0, 0], pine: [0, 0, 0] };
    for (const level of [2, 1, 0]) {
      const L = levels[level];
      for (let k = 0; k < L.length; k += 2) {
        const lx = L[k], lz = L[k + 1];
        const r1 = hash2(d.tx * N + lx, d.tz * N + lz, this.seed + 91), r2 = hash2(d.tx * N + lx, d.tz * N + lz, this.seed + 92);
        const jx = (r1 - 0.5) * CELL * STEP * 0.9, jz = (r2 - 0.5) * CELL * STEP * 0.9;
        const x = d.tx * TILE + lx * CELL + jx, z = d.tz * TILE + lz * CELL + jz;
        const ix = Math.round((x - d.tx * TILE) / CELL) + off, iz = Math.round((z - d.tz * TILE) / CELL) + off;
        const i = iz * TN + ix;
        const h = d.H[i];
        if (h < SEA + 1.5 || d.kind[i]) continue;
        const slope = Math.hypot(d.H[i + 1] - d.H[i - 1], d.H[i + TN] - d.H[i - TN]) / (2 * CELL);
        if (slope > 1.0) continue;
        const temp = tempAt(d.climBase[i], h);
        const zone = VEGETATION[zoneOf(temp, d.moist[i], h, SEA, false, slope)];
        // The same stands and clearings as the real trees grow in.
        const f = this.forest.fbm(x * 0.02, z * 0.02, 3);
        const density = zone.trees * Math.max(0.15, Math.min(1.8, 1 + f * 2.2));
        if (hash2(d.tx * N + lx, d.tz * N + lz, this.seed + 93) > density * 7.5) continue;
        const r3 = hash2(d.tx * N + lx, d.tz * N + lz, this.seed + 94);
        const sp = r3 * (zone.oak + zone.birch + zone.pine);
        const species: Kind = sp < zone.oak ? 'oak' : sp < zone.oak + zone.birch ? 'birch' : 'pine';
        // Sized like grown real trees (thinned-out ones a little bigger, to fill the gaps).
        const size = GROWN[species] * (0.8 + 0.45 * r1) * zone.stature * (level === 2 ? 1.3 : level === 1 ? 1.12 : 1);
        s.set(size, size * (1.15 + 0.35 * r2), size);
        p.set(x, h - 1.2, z);
        q.setFromAxisAngle(up, r2 * Math.PI * 2);
        m.compose(p, q, s);
        mats[species].push(...m.elements);
        const v = 0.85 + 0.25 * r3;
        cols[species].push(v, v, v);
        counts[species][level]++;
      }
    }
    const out: StandIns[] = [];
    for (const k of KINDS) {
      const c = counts[k], total = c[0] + c[1] + c[2];
      if (!total) continue;
      const mesh = new THREE.InstancedMesh(this.geometry[k], this.material, total);
      (mesh.instanceMatrix.array as Float32Array).set(mats[k]);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols[k]), 3);
      mesh.computeBoundingSphere();
      // Coarsest first: how many to draw for a near, middling or far tile.
      out.push({ mesh, counts: [total, c[2] + c[1], c[2]] });
    }
    return out;
  }
}
