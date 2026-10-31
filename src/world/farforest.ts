import * as THREE from 'three';
import { tempAt, zoneOf } from './climate';
import { hash2, Simplex } from './noise';
import { VEGETATION } from './world';
import { CELL, PAD, SEA, TILE, TN, type TileData } from './worldgen';

// Forests to the horizon. The real trees only stand within a couple of
// hundred metres of you; beyond that each distant land tile carries simple
// stand-ins (a few triangles each, all drawn at once) wherever the same
// climate and stand-and-clearing pattern would grow trees. From afar the
// woods, clearings and tree lines read as they do up close.

/** Map cells between candidate trees, at full detail (16 m). */
const STEP = 2;
const LEAF = { oak: new THREE.Color(0x3f7a2c), birch: new THREE.Color(0x7aa33e), pine: new THREE.Color(0x2b5a33) };

/** A five-sided spindle: a crown seen from far off. */
function crownGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const ring = (k: number): [number, number, number] => {
    const a = (k / 5) * Math.PI * 2;
    return [Math.cos(a), 0.42, Math.sin(a)];
  };
  for (let k = 0; k < 5; k++) {
    const a = ring(k), b = ring(k + 1);
    pos.push(...a, 0, 1, 0, ...b); // upper
    pos.push(...b, 0, 0.1, 0, ...a); // lower
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class FarForest {
  readonly geometry = crownGeometry();
  readonly material = new THREE.MeshLambertMaterial({ flatShading: true });
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
  build(d: TileData): { mesh: THREE.InstancedMesh; counts: [number, number, number] } | null {
    const off = PAD / CELL, N = TILE / CELL;
    const levels: number[][] = [[], [], []];
    for (let lz = 0; lz < N; lz += STEP) {
      for (let lx = 0; lx < N; lx += STEP) {
        const level = lx % (STEP * 4) === 0 && lz % (STEP * 4) === 0 ? 2 : lx % (STEP * 2) === 0 && lz % (STEP * 2) === 0 ? 1 : 0;
        levels[level].push(lx, lz);
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const mats: number[] = [], cols: number[] = [];
    const counts: [number, number, number] = [0, 0, 0];
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
        const species = sp < zone.oak ? 'oak' : sp < zone.oak + zone.birch ? 'birch' : 'pine';
        const big = (level === 2 ? 1.45 : level === 1 ? 1.2 : 1) * zone.stature * (0.8 + 0.4 * r1);
        // Pines tall and narrow; broadleaves rounder.
        if (species === 'pine') s.set(4.8 * big, 20 * big, 4.8 * big);
        else s.set(7 * big, 15 * big, 7 * big);
        p.set(x, h - 1.2, z);
        q.setFromAxisAngle(up, r2 * Math.PI * 2);
        m.compose(p, q, s);
        mats.push(...m.elements);
        const c = LEAF[species], v = 0.6 + 0.25 * r2; // a little darker: the shade within a crown
        cols.push(c.r * v, c.g * v, c.b * v);
        counts[level]++;
      }
      // Counts are cumulative, coarsest first.
    }
    const total = counts[0] + counts[1] + counts[2];
    if (!total) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, total);
    (mesh.instanceMatrix.array as Float32Array).set(mats);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3);
    mesh.computeBoundingSphere();
    return { mesh, counts: [total, counts[2] + counts[1], counts[2]] };
  }
}
