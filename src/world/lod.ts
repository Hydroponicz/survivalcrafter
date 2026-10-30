import * as THREE from 'three';
import { SNOW_TEMP } from './climate';
import { CELL, MAP_N, SEA, type WorldGen } from './worldgen';
import { LIN, Mat } from './terrain';

// The distant land: the whole world map as one low-detail mesh (8 m grid),
// coloured from the same climate and materials as the near terrain, so the
// mountain ranges kilometres away are always there on the horizon. Near you
// the detailed voxel terrain takes over: this mesh cuts a hole where it's
// loaded, and sits a little lower so the two never fight at the seam.

const lerp3 = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lin = (c: [number, number, number]) => c.map((v) => Math.pow(v, 2.2));
const SNOW = lin([0.93, 0.95, 0.98]);
const FOREST = lin([0.12, 0.24, 0.1]);
const PINES = lin([0.09, 0.19, 0.11]);
const DRY = lin([0.6, 0.55, 0.27]), LUSH = lin([0.22, 0.47, 0.16]), COLD = lin([0.27, 0.4, 0.27]);

export class DistantLand {
  readonly group = new THREE.Group();
  private hole = { value: new THREE.Vector3(0, 0, 0) }; // x, z, radius

  constructor(gen: WorldGen, waterMaterial: THREE.Material) {
    const N = MAP_N;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
    const H = gen.H;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = iz * N + ix;
        const x = ix * CELL, z = iz * CELL, h = H[i];
        pos[i * 3] = x; pos[i * 3 + 1] = h - 1.2; pos[i * 3 + 2] = z;
        const hx = (H[Math.min(N * N - 1, i + 1)] - H[Math.max(0, i - 1)]) / (2 * CELL);
        const hz = (H[Math.min(N * N - 1, i + N)] - H[Math.max(0, i - N)]) / (2 * CELL);
        const slope = Math.hypot(hx, hz);
        const temp = gen.temperature(x, h, z);
        const moist = gen.moist[i];
        let c: number[];
        if (h < SEA + 1.4) c = LIN[Mat.Sand];
        else if (slope > 1.25) c = LIN[Mat.Rock];
        else {
          c = LIN[Mat.Grass];
          c = lerp3(c, DRY, clamp01((0.42 - moist) / 0.3) * 0.85);
          c = lerp3(c, LUSH, clamp01((moist - 0.55) / 0.3) * 0.7);
          c = lerp3(c, COLD, clamp01((0.45 - temp) / 0.2) * 0.8);
          // Woods show as darker canopy from afar.
          const zone = gen.zone(x, z, h, slope);
          if (zone === 'broadleaf') c = lerp3(c, FOREST, 0.65);
          else if (zone === 'conifer') c = lerp3(c, PINES, 0.75);
          // Bare rock shows through on steeper ground.
          c = lerp3(c, LIN[Mat.Rock], clamp01((slope - 0.75) / 0.5));
        }
        // Snow clings to all but the sheerest faces.
        c = lerp3(c, SNOW, clamp01((SNOW_TEMP + 0.04 - temp) / 0.06) * clamp01((1.6 - slope) / 0.5));
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let k = 0;
    for (let iz = 0; iz < N - 1; iz++) {
      for (let ix = 0; ix < N - 1; ix++) {
        const a = iz * N + ix, b = a + 1, c = a + N, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.patch(mat);
    const land = new THREE.Mesh(geo, mat);
    land.frustumCulled = false;
    land.receiveShadow = false;
    this.group.add(land);

    // Lakes, as flat sheets at their surface.
    const wpos: number[] = [], widx: number[] = [], wuv: number[] = [];
    const vid = new Map<number, number>();
    const v = (ix: number, iz: number, s: number) => {
      const key = iz * N + ix;
      let id = vid.get(key);
      if (id === undefined) {
        id = wpos.length / 3;
        vid.set(key, id);
        wpos.push(ix * CELL, s - 0.6, iz * CELL);
        wuv.push((ix * CELL) / 960, (iz * CELL) / 960);
      }
      return id;
    };
    for (let iz = 0; iz < N - 1; iz++) {
      for (let ix = 0; ix < N - 1; ix++) {
        const i = iz * N + ix;
        if (gen.kind[i] !== 2) continue;
        const s = gen.S[i];
        // A cell and its neighbours, so the sheet reaches the shore.
        for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
          const jx = ix + ox, jz = iz + oz;
          if (jx < 0 || jz < 0) continue;
          const a = v(jx, jz, s), b = v(jx + 1, jz, s), c = v(jx, jz + 1, s), d = v(jx + 1, jz + 1, s);
          widx.push(a, c, b, b, c, d);
        }
      }
    }
    if (widx.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
      wg.setIndex(widx);
      wg.computeVertexNormals();
      const wm = (waterMaterial as THREE.MeshStandardMaterial).clone();
      this.patch(wm);
      const lakes = new THREE.Mesh(wg, wm);
      lakes.frustumCulled = false;
      this.group.add(lakes);
    }
  }

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
