import * as THREE from 'three';
import { hash2, mulberry32 } from './noise';
import { isRock, Mat, WORLD_SIZE } from './terrain';
import type { Zone } from './climate';
import type { World } from './world';

// Ground cover: the grass, flowers, ferns, reeds, heather and pebbles around
// you, plus boulders and fallen logs further out. Purely visual and
// generated per 16 m tile from the terrain and climate (deterministic, so
// it's the same every visit), cached, and drawn as instanced meshes that
// sway in the wind and fade out at the edge of their range.

const TILE = 16;

interface Kind {
  name: string;
  geo: THREE.BufferGeometry;
  range: number;
  cap: number;
  /** How much the top bends in the wind (0 for rocks and logs). */
  sway: number;
  shadow: boolean;
  far: boolean;
  mesh?: THREE.InstancedMesh;
  material?: THREE.Material;
}

interface TileData { m: Float32Array; c: Float32Array; n: number }

/** Ground a log or boulder covers (a capsule from a to b), so plants don't grow through it. */
interface Obstacle { ax: number; az: number; bx: number; bz: number; r: number }

const inside = (o: Obstacle, x: number, z: number) => {
  const dx = o.bx - o.ax, dz = o.bz - o.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - o.ax) * dx + (z - o.az) * dz) / len2)) : 0;
  return Math.hypot(x - (o.ax + dx * t), z - (o.az + dz * t)) < o.r;
};

const rnd = (r: () => number, a: number, b: number) => a + (b - a) * r();

// ---------- geometry
function finish(pos: number[], nor: number[], col: number[], idx?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (idx) g.setIndex(idx);
  return g;
}

/** Tapering blades fanning out from a point; colour darkens toward the base. */
function blades(count: number, hMin: number, hMax: number, width: number, lean: number, seed: number,
  base: [number, number, number], tip: [number, number, number], heads?: (k: number) => boolean,
  head: { colour: [number, number, number]; width: number; length: number } = { colour: [0.33, 0.21, 0.1], width: 0.03, length: 0.2 }): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (let k = 0; k < count; k++) {
    const a = r() * Math.PI * 2, h = rnd(r, hMin, hMax), l = lean * rnd(r, 0.4, 1.2);
    const ox = Math.cos(a) * 0.06 * r(), oz = Math.sin(a) * 0.06 * r();
    const px = -Math.sin(a), pz = Math.cos(a); // across the blade
    const seg = 3;
    const start = pos.length / 3;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const w = width * (1 - t * 0.92) * 0.5;
      const bend = l * t * t;
      const cx = ox + Math.cos(a) * bend, cz = oz + Math.sin(a) * bend, cy = h * t;
      pos.push(cx - px * w, cy, cz - pz * w, cx + px * w, cy, cz + pz * w);
      for (let q = 0; q < 2; q++) {
        nor.push(Math.cos(a) * 0.3, 0.95, Math.sin(a) * 0.3);
        const shade = 0.55 + 0.6 * t;
        col.push(THREE.MathUtils.lerp(base[0], tip[0], t) * shade, THREE.MathUtils.lerp(base[1], tip[1], t) * shade, THREE.MathUtils.lerp(base[2], tip[2], t) * shade);
      }
    }
    for (let s = 0; s < seg; s++) {
      const i = start + s * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    if (heads?.(k)) {
      // A seed head / cattail on top of this blade.
      const hx = ox + Math.cos(a) * l, hz = oz + Math.sin(a) * l;
      const top = pos.length / 3;
      const hw = head.width * 0.5, hy0 = h * (1 - head.length), hy1 = h * 1.01;
      const [cr, cg, cb] = head.colour;
      for (const [dx, dz] of [[hw, 0], [0, hw], [-hw, 0], [0, -hw]]) {
        pos.push(hx + dx, hy0, hz + dz, hx + dx * 0.4, hy1, hz + dz * 0.4);
        nor.push(dx, 0.3, dz, dx, 0.3, dz);
        col.push(cr * 0.9, cg * 0.9, cb * 0.9, cr, cg, cb);
      }
      for (let q = 0; q < 4; q++) {
        const i = top + q * 2, j = top + ((q + 1) % 4) * 2;
        idx.push(i, j, i + 1, j, j + 1, i + 1);
      }
    }
  }
  return finish(pos, nor, col, idx);
}

/** Little flowers: a stem and a five-petalled head of one colour. */
function flowers(head: [number, number, number], seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (let k = 0; k < 5; k++) {
    const x = rnd(r, -0.12, 0.12), z = rnd(r, -0.12, 0.12), h = rnd(r, 0.16, 0.32);
    let i = pos.length / 3;
    pos.push(x - 0.006, 0, z, x + 0.006, 0, z, x, h, z);
    nor.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    col.push(0.15, 0.3, 0.1, 0.15, 0.3, 0.1, 0.2, 0.38, 0.12);
    idx.push(i, i + 1, i + 2);
    i = pos.length / 3;
    const s = rnd(r, 0.025, 0.04);
    pos.push(x, h + 0.005, z);
    nor.push(0, 1, 0);
    col.push(head[0] * 0.7 + 0.3, head[1] * 0.7 + 0.25, head[2] * 0.7 + 0.1);
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      pos.push(x + Math.cos(a) * s, h, z + Math.sin(a) * s);
      nor.push(0, 1, 0);
      col.push(...head);
      idx.push(i, i + 1 + p, i + 1 + ((p + 1) % 5));
    }
  }
  return finish(pos, nor, col, idx);
}

/** Fern: arching fronds from a crown. */
function fern(seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const n = 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd(r, -0.3, 0.3), len = rnd(r, 0.5, 0.85);
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const seg = 6, start = pos.length / 3;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const d = len * t, y = Math.sin(t * Math.PI * 0.85) * len * 0.55;
      // Leaflets: the frond is widest in the middle and zigzags a little.
      const w = 0.075 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (s % 2 ? 1 : 0.55);
      pos.push(dx * d - px * w, y, dz * d - pz * w, dx * d + px * w, y, dz * d + pz * w);
      for (let q = 0; q < 2; q++) { nor.push(dx * 0.2, 1, dz * 0.2); const sh = 0.55 + 0.45 * t; col.push(0.022 * sh, 0.075 * sh, 0.018 * sh); }
    }
    for (let s = 0; s < seg; s++) { const i = start + s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  return finish(pos, nor, col, idx);
}

/** A lumpy rock, flattened; vertex colours white so instances carry the colour. */
function rock(radius: number, detail: number, squash: number, seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const jit = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!jit.has(key)) jit.set(key, rnd(r, 0.78, 1.15));
    v.multiplyScalar(jit.get(key)!);
    v.y = v.y * squash + radius * squash * 0.55;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  const col: number[] = [];
  const np = ng.attributes.normal;
  for (let i = 0; i < np.count; i++) {
    // A hint of moss and lichen on top.
    const up = Math.max(0, np.getY(i));
    col.push(1 - up * 0.25, 1 - up * 0.08, 1 - up * 0.35);
  }
  ng.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return ng;
}

/** Heather: a low, dense shrub of wiry stems, purple with flowers toward the tips. */
function heather(seed: number): THREE.BufferGeometry {
  // (Linear colour, so these look brighter on screen than the numbers suggest.)
  return blades(26, 0.14, 0.3, 0.03, 0.16, seed, [0.05, 0.05, 0.025], [0.24, 0.07, 0.22]);
}

/** A fallen trunk lying along X, with broken branch stubs; mossy along the top. */
function fallenLog(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.24, 4, 9, 4);
  trunk.rotateZ(Math.PI / 2);
  trunk.translate(0, 0.2, 0);
  parts.push(trunk);
  for (const [x, a] of [[-0.8, 0.6], [0.6, -0.9], [1.4, 2.2]]) {
    const b = new THREE.CylinderGeometry(0.04, 0.06, 0.6, 5);
    b.translate(0, 0.3, 0);
    b.rotateX(a);
    b.translate(x, 0.2, 0);
    parts.push(b);
  }
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    const pa = g.attributes.position, na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      nor.push(na.getX(i), na.getY(i), na.getZ(i));
      const moss = Math.max(0, na.getY(i) - 0.3) * 1.4;
      col.push(THREE.MathUtils.lerp(0.33, 0.22, moss), THREE.MathUtils.lerp(0.24, 0.36, moss), THREE.MathUtils.lerp(0.16, 0.12, moss));
    }
  }
  return finish(pos, nor, col);
}

// ---------- materials
const shared = {
  time: { value: 0 },
  wind: { value: new THREE.Vector2(1, 0) },
  windStrength: { value: 0.4 },
};

function coverMaterial(range: number, sway: number): THREE.Material {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uWind = shared.wind;
    shader.uniforms.uWindStrength = shared.windStrength;
    shader.uniforms.uRange = { value: range };
    shader.uniforms.uSway = { value: sway };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform float uRange; uniform float uSway;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
  // Shrink away toward the edge of the range instead of popping.
  float coverFade = 1.0 - smoothstep( uRange * 0.72, uRange, distance( ip.xz, cameraPosition.xz ) );
  transformed *= coverFade;
  if ( uSway > 0.0 ) {
    float bend = max( transformed.y, 0.0 );
    bend = bend * bend * uSway;
    float gust = sin( uTime * 1.6 + ip.x * 0.31 + ip.z * 0.23 ) * 0.55 + sin( uTime * 3.7 + ip.x * 0.9 - ip.z * 0.4 ) * 0.2 + 0.5;
    // Wind blows in world space; undo the instance's turn to push the right way.
    vec3 lw = normalize( transpose( mat3( instanceMatrix ) ) * vec3( uWind.x, 0.0, uWind.y ) );
    transformed.xz += lw.xz * gust * uWindStrength * bend;
  }
#endif`);
  };
  return m;
}

// ---------- placement
const KIND_DEFS: Omit<Kind, 'mesh' | 'material'>[] = [
  { name: 'grass', geo: blades(12, 0.26, 0.5, 0.06, 0.13, 11, [0.62, 0.66, 0.5], [1.05, 1.1, 0.88]), range: 40, cap: 40000, sway: 1.6, shadow: false, far: false },
  { name: 'tallgrass', geo: blades(9, 0.55, 0.9, 0.055, 0.22, 12, [0.62, 0.66, 0.5], [1.1, 1.08, 0.85], (k) => k % 3 === 0,
    { colour: [0.85, 0.78, 0.5], width: 0.02, length: 0.16 }), range: 40, cap: 8000, sway: 1.1, shadow: false, far: false },
  { name: 'flower_y', geo: flowers([0.95, 0.78, 0.15], 21), range: 38, cap: 2500, sway: 2.5, shadow: false, far: false },
  { name: 'flower_w', geo: flowers([0.92, 0.92, 0.88], 22), range: 38, cap: 2500, sway: 2.5, shadow: false, far: false },
  { name: 'flower_p', geo: flowers([0.55, 0.3, 0.75], 23), range: 38, cap: 2500, sway: 2.5, shadow: false, far: false },
  { name: 'fern', geo: fern(31), range: 40, cap: 5000, sway: 0.6, shadow: true, far: false },
  { name: 'reeds', geo: blades(10, 1.1, 1.8, 0.035, 0.18, 41, [0.3, 0.38, 0.18], [0.62, 0.62, 0.36], (k) => k % 4 === 1,
    { colour: [0.36, 0.22, 0.11], width: 0.045, length: 0.14 }), range: 48, cap: 9000, sway: 0.45, shadow: false, far: false },
  { name: 'heather', geo: heather(51), range: 42, cap: 7000, sway: 0.5, shadow: false, far: false },
  { name: 'pebble', geo: rock(0.07, 0, 0.55, 61), range: 30, cap: 5000, sway: 0, shadow: false, far: false },
  { name: 'boulder', geo: rock(0.5, 1, 0.68, 71), range: 150, cap: 2500, sway: 0, shadow: true, far: true },
  { name: 'log', geo: fallenLog(), range: 130, cap: 500, sway: 0, shadow: true, far: true },
];

/** Plants per m² by zone. */
const COVER: Record<Zone, { grass: number; tall: number; flowers: number; fern: number; heather: number }> = {
  meadow: { grass: 2.6, tall: 0.35, flowers: 0.22, fern: 0, heather: 0 },
  broadleaf: { grass: 1.2, tall: 0.1, flowers: 0.06, fern: 0.2, heather: 0 },
  conifer: { grass: 0.6, tall: 0.05, flowers: 0.02, fern: 0.26, heather: 0.04 },
  heath: { grass: 1.1, tall: 0.25, flowers: 0.03, fern: 0, heather: 0.55 },
  marsh: { grass: 1.8, tall: 0.6, flowers: 0.08, fern: 0.05, heather: 0 },
  alpine: { grass: 0.9, tall: 0, flowers: 0.05, fern: 0, heather: 0.25 },
  beach: { grass: 0.25, tall: 0.15, flowers: 0, fern: 0, heather: 0 },
  snow: { grass: 0, tall: 0, flowers: 0, fern: 0, heather: 0 },
};

export class GroundCover {
  readonly group = new THREE.Group();
  private kinds: Kind[];
  private byName: Record<string, number> = {};
  private cache = [new Map<number, TileData[]>(), new Map<number, TileData[]>()];
  /** Logs and boulders per far tile, kept for the near tiles' plants to avoid. */
  private obstacles = new Map<number, Obstacle[]>();
  private centre = [NaN, NaN];
  private dirty = true;
  private seed: number;

  constructor(private world: World) {
    this.seed = world.terrain.seed;
    this.kinds = KIND_DEFS.map((d, i) => {
      const material = coverMaterial(d.range, d.sway);
      const mesh = new THREE.InstancedMesh(d.geo, material, d.cap);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(d.cap * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = d.shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.byName[d.name] = i;
      return { ...d, mesh, material };
    });
  }

  /** Forget cached tiles around an edit so they're regenerated on the new ground. */
  invalidate(x: number, z: number, r: number) {
    for (const cache of this.cache) {
      for (let tz = Math.floor((z - r) / TILE); tz <= Math.floor((z + r) / TILE); tz++) {
        for (let tx = Math.floor((x - r) / TILE); tx <= Math.floor((x + r) / TILE); tx++) { cache.delete(tz * 1000 + tx); this.obstacles.delete(tz * 1000 + tx); }
      }
    }
    this.dirty = true;
  }

  /** Per frame: wind, and rebuilding the instances when you cross into a new tile. */
  update(cam: THREE.Vector3, time: number, wind: [number, number], strength: number, budgetMs = 4) {
    shared.time.value = time;
    shared.wind.value.set(wind[0], wind[1]);
    shared.windStrength.value = strength;
    const tx = Math.floor(cam.x / TILE), tz = Math.floor(cam.z / TILE);
    if (tx !== this.centre[0] || tz !== this.centre[1]) { this.centre = [tx, tz]; this.dirty = true; }
    if (!this.dirty) return;
    // Generate missing tiles nearest first, within a time budget; rebuild once all are in.
    const start = performance.now();
    let missing = false;
    for (const far of [false, true]) {
      const r = Math.ceil(Math.max(...this.kinds.filter((k) => k.far === far).map((k) => k.range)) / TILE);
      const cache = this.cache[far ? 1 : 0];
      const want: [number, number, number][] = [];
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const x = tx + dx, z = tz + dz;
        if (x < 0 || z < 0 || x * TILE >= WORLD_SIZE || z * TILE >= WORLD_SIZE) continue;
        if (!cache.has(z * 1000 + x)) want.push([x, z, dx * dx + dz * dz]);
      }
      want.sort((a, b) => a[2] - b[2]);
      for (const [x, z] of want) {
        if (performance.now() - start > budgetMs && cache.size > 0) { missing = true; break; }
        cache.set(z * 1000 + x, this.generate(x, z, far));
      }
      // Drop tiles well out of range so memory doesn't grow.
      for (const k of cache.keys()) {
        const x = k % 1000, z = Math.floor(k / 1000);
        if (Math.abs(x - tx) > r + 2 || Math.abs(z - tz) > r + 2) { cache.delete(k); if (far) this.obstacles.delete(k); }
      }
    }
    this.rebuild(tx, tz);
    this.dirty = missing;
  }

  private rebuild(tx: number, tz: number) {
    for (let i = 0; i < this.kinds.length; i++) {
      const k = this.kinds[i];
      const cache = this.cache[k.far ? 1 : 0];
      const r = Math.ceil(k.range / TILE);
      const mesh = k.mesh!;
      const ma = mesh.instanceMatrix.array as Float32Array, ca = mesh.instanceColor!.array as Float32Array;
      let n = 0;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const t = cache.get((tz + dz) * 1000 + tx + dx)?.[i];
        if (!t || !t.n) continue;
        const take = Math.min(t.n, k.cap - n);
        if (take <= 0) continue;
        ma.set(t.m.subarray(0, take * 16), n * 16);
        ca.set(t.c.subarray(0, take * 3), n * 3);
        n += take;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  /** Everything that grows or lies in one tile, for the near or far kinds. */
  private generate(tx: number, tz: number, far: boolean): TileData[] {
    const t = this.world.terrain;
    const r = mulberry32(Math.floor(hash2(tx, tz, this.seed + (far ? 7 : 3)) * 2 ** 31));
    const lists: { m: number[]; c: number[] }[] = this.kinds.map(() => ({ m: [], c: [] }));
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = [0, 0, 0];
    const pieces = this.world.piecesNear(tx * TILE + TILE / 2, tz * TILE + TILE / 2, TILE);
    const put = (kind: string, x: number, y: number, z: number, yaw: number, sc: number, cr: number, cg: number, cb: number, tilt = 0, sy = sc) => {
      const L = lists[this.byName[kind]];
      e.set(tilt * Math.cos(yaw), yaw, tilt * Math.sin(yaw));
      q.setFromEuler(e);
      mtx.compose(p.set(x, y, z), q, s.set(sc, sy, sc));
      L.m.push(...mtx.elements);
      L.c.push(cr, cg, cb);
    };
    // Ground info at a point: height, material, steepness, zone.
    const probe = (x: number, z: number) => {
      const h = t.heightAt(x, z);
      const gx = t.heightAt(x + 0.5, z) - t.heightAt(x - 0.5, z), gz = t.heightAt(x, z + 0.5) - t.heightAt(x, z - 0.5);
      const slope = Math.hypot(gx, gz);
      return { h, slope, mat: t.topAt(x, z) };
    };
    const blocked = (x: number, y: number, z: number) => pieces.length > 0 && this.world.blockedAt(x, y + 0.12, z);

    // Logs and boulders lying here (they can reach in from the next tile, too).
    const obs: Obstacle[] = [];
    if (!far) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx, z = tz + dz;
        if (x < 0 || z < 0 || x * TILE >= WORLD_SIZE || z * TILE >= WORLD_SIZE) continue;
        const key = z * 1000 + x;
        if (!this.obstacles.has(key)) this.cache[1].set(key, this.generate(x, z, true));
        obs.push(...(this.obstacles.get(key) ?? []));
      }
    }
    const covered = (x: number, z: number) => obs.length > 0 && obs.some((o) => inside(o, x, z));

    if (!far) {
      // Zones change slowly: look them up on a 4 m grid.
      const zones: Zone[] = [];
      for (let gz = 0; gz < 4; gz++) for (let gx = 0; gx < 4; gx++) zones.push(t.zoneAt(tx * TILE + gx * 4 + 2, tz * TILE + gz * 4 + 2));
      const zoneAt = (x: number, z: number) => zones[Math.min(3, Math.floor((z - tz * TILE) / 4)) * 4 + Math.min(3, Math.floor((x - tx * TILE) / 4))];
      const samples = TILE * TILE * 3;
      for (let k = 0; k < samples; k++) {
        const x = tx * TILE + r() * TILE, z = tz * TILE + r() * TILE;
        if (covered(x, z)) continue;
        const g = probe(x, z);
        const water = t.waterAt(x, z);
        const zone = zoneAt(x, z);
        const cov = COVER[zone];
        const roll = r() * 3; // three samples per m²: compare densities against this
        const yaw = r() * Math.PI * 2;
        const wet = t.freshWaterAt(x, z) || t.nearWaterAt(x, z);
        // Reeds: along banks and standing in the shallows.
        if (wet && (g.mat === Mat.Grass || g.mat === Mat.Clay || g.mat === Mat.Sand || g.mat === Mat.Gravel) && g.h > water - 0.7 && g.slope < 0.8) {
          if (roll < (g.h < water ? 1.4 : 0.9) && !blocked(x, g.h, z)) {
            const v = rnd(r, 0.85, 1.1);
            put('reeds', x, g.h - 0.05, z, yaw, rnd(r, 0.75, 1.15), v, v, v);
            continue;
          }
        }
        if (g.h < water + 0.05) continue;
        if (isRock(g.mat) || g.mat === Mat.Gravel || g.mat === Mat.Sand) {
          if (roll < (g.mat === Mat.Sand ? 0.12 : 0.3) && g.slope < 1.2) {
            t.surfaceColor(g.mat, x, g.h, z, 1, col);
            const v = rnd(r, 0.6, 1.0);
            put('pebble', x, g.h - 0.02, z, yaw, rnd(r, 0.5, 1.6), col[0] * v * 1.6, col[1] * v * 1.6, col[2] * v * 1.6);
          }
          continue;
        }
        if (g.mat !== Mat.Grass || g.slope > 1.1 || blocked(x, g.h, z)) continue;
        t.surfaceColor(Mat.Grass, x, g.h, z, 1, col);
        const v = rnd(r, 0.85, 1.15) * 1.25;
        let acc = cov.grass;
        if (roll < acc) { put('grass', x, g.h - 0.02, z, yaw, rnd(r, 0.7, 1.3), col[0] * v, col[1] * v, col[2] * v, 0, rnd(r, 0.6, 1.25) * (zone === 'alpine' ? 0.55 : 1)); continue; }
        if (roll < (acc += cov.tall)) { put('tallgrass', x, g.h - 0.02, z, yaw, rnd(r, 0.8, 1.2), col[0] * v * 1.1, col[1] * v * 1.05, col[2] * v); continue; }
        if (roll < (acc += cov.fern)) { const f = rnd(r, 0.8, 1.15); put('fern', x, g.h - 0.03, z, yaw, rnd(r, 0.7, 1.3), f, f, f); continue; }
        if (roll < (acc += cov.heather)) { const f = rnd(r, 0.8, 1.2); put('heather', x, g.h - 0.02, z, yaw, rnd(r, 1.1, 1.8), f, f, f, 0, rnd(r, 0.8, 1.2)); continue; }
        if (roll < (acc += cov.flowers)) {
          const f = rnd(r, 0.85, 1.1);
          put(['flower_y', 'flower_w', 'flower_p'][Math.floor(r() * 3)], x, g.h - 0.01, z, yaw, rnd(r, 0.8, 1.2), f, f, f);
        }
      }
    } else {
      // Boulders on rough and open ground; fallen trees in the woods.
      for (let k = 0; k < 20; k++) {
        const x = tx * TILE + r() * TILE, z = tz * TILE + r() * TILE;
        const g = probe(x, z);
        if (g.h < t.waterAt(x, z) + 0.1 || g.slope > 1.4 || blocked(x, g.h, z)) continue;
        const zone = t.zoneAt(x, z);
        const rocky = isRock(g.mat) || g.mat === Mat.Gravel;
        const pBoulder = rocky ? 0.35 : zone === 'alpine' || zone === 'heath' ? 0.12 : zone === 'meadow' || zone === 'conifer' ? 0.04 : 0.02;
        if (r() < pBoulder) {
          // Coloured like the bedrock it broke from.
          const below = t.bedrockAt(x, g.h - 1.2, z);
          t.surfaceColor(isRock(below) ? below : Mat.Rock, x, g.h, z, 0, col);
          const v = rnd(r, 0.75, 1.05) * 1.5;
          const sc = rnd(r, 0.35, 1.5);
          put('boulder', x, g.h - sc * 0.15, z, r() * 6.28, sc, col[0] * v, col[1] * v, col[2] * v, rnd(r, -0.2, 0.2));
          obs.push({ ax: x, az: z, bx: x, bz: z, r: 0.55 * sc });
          continue;
        }
        if ((zone === 'broadleaf' || zone === 'conifer') && g.mat === Mat.Grass && g.slope < 0.5 && r() < 0.06) {
          const f = rnd(r, 0.75, 1.05);
          const yaw = r() * 6.28, sc = rnd(r, 0.7, 1.15);
          put('log', x, g.h - 0.05, z, yaw, sc, f, f, f, Math.atan(g.slope) * 0.5);
          // The trunk runs 2 m either way along its local X.
          const hx = Math.cos(yaw) * 2 * sc, hz = -Math.sin(yaw) * 2 * sc;
          obs.push({ ax: x - hx, az: z - hz, bx: x + hx, bz: z + hz, r: 0.32 * sc });
        }
      }
    }
    if (far) this.obstacles.set(tz * 1000 + tx, obs);
    return lists.map((L) => ({ m: new Float32Array(L.m), c: new Float32Array(L.c), n: L.c.length / 3 }));
  }
}
