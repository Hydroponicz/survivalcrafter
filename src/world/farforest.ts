import * as THREE from 'three';
import type { ViewCull } from './cull';
import { tempAt, zoneOf } from './climate';
import { hash2 } from './noise';
import { ImpostorAtlas } from './impostors';
import { SPECIES, TreeCover, TREES, VEGETATION, type Species } from './trees';
import { CELL, PAD, SEA, TILE, TN, type TileData } from './worldgen';
import type { Villages } from './villages';

// Forests to the horizon. The real trees only stand within a couple of
// hundred metres of you; beyond that each distant land tile carries
// stand-ins (pared-down copies of the real trees, all of a kind drawn at
// once) wherever the same climate and stand-and-clearing pattern would grow
// trees. From afar the woods, clearings and tree lines read as they do up close.

/** Map cells between candidate trees, at full detail (16 m). */
const STEP = 2;

/** Beyond this (metres) a stand-in is drawn as its barest outline. */
const OUTLINE_AT = 700;

/**
 * One kind of tree's stand-ins on one tile. All of them are kept here; only
 * those in view (and not where the real trees stand) are handed to be drawn,
 * the nearer as stand-ins and the further as outlines.
 */
export class StandIns {
  /** The stand-ins near enough to show their shape, and the outlines further off. */
  readonly mesh: THREE.InstancedMesh;
  readonly outlines: THREE.InstancedMesh;
  /** How many to consider, coarsest first, for a near, middling or far tile. */
  readonly counts: [number, number, number];
  /** Which of `counts` applies (set by the distant land as you move). */
  level = 0;
  private seen = -1;
  private seenLevel = -1;
  private seenNear = new THREE.Vector3(NaN, 0, 0);
  /** Each tree's centre and radius (x, y, z, r), for the view test. */
  private spheres: Float32Array;
  /** Trees standing where a settlement has cleared the ground (as of which of its plans), not drawn. */
  private cleared: Uint8Array | null = null;
  private clearedAt = -1;
  private box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };

  constructor(near: THREE.BufferGeometry, far: THREE.BufferGeometry, material: THREE.Material,
    private mats: Float32Array, private cols: Float32Array, counts: [number, number, number]) {
    const total = mats.length / 16;
    this.counts = counts;
    const make = (g: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(g, material, total);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      // Culled tree by tree here.
      m.frustumCulled = false;
      m.count = 0;
      return m;
    };
    this.mesh = make(near);
    this.outlines = make(far);
    near.computeBoundingSphere();
    const c = near.boundingSphere!.center, r = near.boundingSphere!.radius;
    this.spheres = new Float32Array(total * 4);
    for (let i = 0; i < total; i++) {
      const o = i * 16, M = mats;
      const s = Math.max(Math.hypot(M[o], M[o + 1], M[o + 2]), Math.hypot(M[o + 4], M[o + 5], M[o + 6]));
      this.spheres[i * 4] = M[o] * c.x + M[o + 4] * c.y + M[o + 8] * c.z + M[o + 12];
      this.spheres[i * 4 + 1] = M[o + 1] * c.x + M[o + 5] * c.y + M[o + 9] * c.z + M[o + 13];
      this.spheres[i * 4 + 2] = M[o + 2] * c.x + M[o + 6] * c.y + M[o + 10] * c.z + M[o + 14];
      this.spheres[i * 4 + 3] = r * s;
      const b = this.box;
      b.x0 = Math.min(b.x0, M[o + 12]); b.x1 = Math.max(b.x1, M[o + 12]); b.z0 = Math.min(b.z0, M[o + 14]); b.z1 = Math.max(b.z1, M[o + 14]);
    }
  }

  /** Leave out the trees on settlements' ground (their streets, plots, fields, and most of the land round a village). */
  private clearFor(villages: Villages) {
    this.clearedAt = villages.version;
    const b = this.box, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const vs = villages.knownAround(cx, cz, Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2);
    this.seen = -1;
    if (!vs.length) { this.cleared = null; return; }
    const M = this.mats, n = M.length / 16, out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = M[i * 16 + 12], z = M[i * 16 + 14];
      for (const v of vs) {
        const d = Math.hypot(x - v.x, z - v.z);
        if (d < v.r && (v.kind !== 'village' || d < v.r * 0.85 || villages.keepsClear(v, x, z))) { out[i] = 1; break; }
      }
    }
    this.cleared = out;
  }

  /** Hand to be drawn just the trees in view, outside the circle (x, z, radius) the real trees fill. */
  cull(view: ViewCull, near: THREE.Vector3, villages?: Villages) {
    if (villages && villages.version !== this.clearedAt) this.clearFor(villages);
    if (this.seen === view.version && this.seenLevel === this.level && this.seenNear.equals(near)) return;
    this.seen = view.version; this.seenLevel = this.level; this.seenNear.copy(near);
    const S = this.spheres, M = this.mats, C = this.cols;
    const a = this.mesh, b = this.outlines;
    const am = a.instanceMatrix.array as Float32Array, ac = a.instanceColor!.array as Float32Array;
    const bm = b.instanceMatrix.array as Float32Array, bc = b.instanceColor!.array as Float32Array;
    const end = this.counts[this.level], cleared = this.cleared;
    let na = 0, nb = 0;
    for (let i = 0; i < end; i++) {
      if (cleared && cleared[i]) continue;
      const x = S[i * 4], y = S[i * 4 + 1], z = S[i * 4 + 2], r = S[i * 4 + 3];
      const dx = M[i * 16 + 12] - near.x, dz = M[i * 16 + 14] - near.y, d = Math.hypot(dx, dz);
      if (d < near.z || !view.sphere(x, y, z, r)) continue;
      if (d < OUTLINE_AT) {
        am.set(M.subarray(i * 16, i * 16 + 16), na * 16); ac.set(C.subarray(i * 3, i * 3 + 3), na * 3); na++;
      } else {
        bm.set(M.subarray(i * 16, i * 16 + 16), nb * 16); bc.set(C.subarray(i * 3, i * 3 + 3), nb * 3); nb++;
      }
    }
    for (const [m, n] of [[a, na], [b, nb]] as [THREE.InstancedMesh, number][]) {
      m.count = n;
      m.visible = n > 0;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16); m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.clearUpdateRanges(); m.instanceColor!.addUpdateRange(0, Math.max(1, n) * 3); m.instanceColor!.needsUpdate = true;
    }
  }

  dispose() { this.mesh.dispose(); this.outlines.dispose(); }
}

export class FarForest {
  /** x, z, radius: the stand-ins give way to the real trees within this circle around you. */
  readonly near = { value: new THREE.Vector3(0, 0, 0) };
  /** The distant trees: cards showing pictures of the real trees. */
  readonly impostors = new ImpostorAtlas(this.near);
  private cover: TreeCover;

  constructor(private seed: number) {
    this.cover = new TreeCover(seed);
  }

  /** Take the impostors' pictures (needs the game's renderer; once). */
  bake(renderer: THREE.WebGLRenderer) { this.impostors.bake(renderer); }

  /**
   * The stand-ins for one tile, coarsest first: the first `counts[2]` are
   * enough for a far-off tile, `counts[1]` for a middling one, all of them
   * near. The coarser ones are bigger, so thinned-out woods still look full.
   */
  /** A tile's stand-ins, from a plan made elsewhere (a worker) or worked out here. */
  build(d: TileData, plan = planStandIns(this.seed, this.cover, d)): StandIns[] {
    // Coarsest first: how many to consider for a near, middling or far tile.
    return plan.map((p) => new StandIns(this.impostors.cards[p.species], this.impostors.cards[p.species], this.impostors.material, p.mats, p.cols, p.counts));
  }
}

/** A tile's stand-ins of one kind of tree. */
export interface StandInPlan { species: Species; mats: Float32Array; cols: Float32Array; counts: [number, number, number] }

/**
 * Where a tile's stand-ins stand, kind by kind (pure arithmetic over the
 * tile's map, so a worker can do it): matrices and tints, coarsest first.
 */
export function planStandIns(seed: number, cover: TreeCover, d: TileData): StandInPlan[] {
  const off = PAD / CELL, N = TILE / CELL;
  const levels: number[][] = [[], [], []];
  for (let lz = 0; lz < N; lz += STEP) {
    for (let lx = 0; lx < N; lx += STEP) {
      const level = lx % (STEP * 4) === 0 && lz % (STEP * 4) === 0 ? 2 : lx % (STEP * 2) === 0 && lz % (STEP * 2) === 0 ? 1 : 0;
      levels[level].push(lx, lz);
    }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const mats = {} as Record<Species, number[]>, cols = {} as Record<Species, number[]>;
  const counts = {} as Record<Species, [number, number, number]>;
  for (const k of SPECIES) { mats[k] = []; cols[k] = []; counts[k] = [0, 0, 0]; }
  for (const level of [2, 1, 0]) {
    const L = levels[level];
    for (let k = 0; k < L.length; k += 2) {
      const lx = L[k], lz = L[k + 1];
      const r1 = hash2(d.tx * N + lx, d.tz * N + lz, seed + 91), r2 = hash2(d.tx * N + lx, d.tz * N + lz, seed + 92);
      const jx = (r1 - 0.5) * CELL * STEP * 0.9, jz = (r2 - 0.5) * CELL * STEP * 0.9;
      const x = d.tx * TILE + lx * CELL + jx, z = d.tz * TILE + lz * CELL + jz;
      const ix = Math.round((x - d.tx * TILE) / CELL) + off, iz = Math.round((z - d.tz * TILE) / CELL) + off;
      const i = iz * TN + ix;
      const h = d.H[i];
      if (h < SEA + 1.5 || d.kind[i]) continue;
      // Banks are mostly open: keep back from rivers and lakes, except in the wild stretches.
      if (cover.bankClearance(x, z) > 2 && (d.kind[i + 1] || d.kind[i - 1] || d.kind[i + TN] || d.kind[i - TN])) continue;
      const slope = Math.hypot(d.H[i + 1] - d.H[i - 1], d.H[i + TN] - d.H[i - TN]) / (2 * CELL);
      if (slope > 1.0) continue;
      const temp = tempAt(d.climBase[i], h);
      const zoneName = zoneOf(temp, d.moist[i], h, SEA, false, slope), zone = VEGETATION[zoneName];
      // The same woods, stands and clearings as the real trees grow in.
      if (hash2(d.tx * N + lx, d.tz * N + lz, seed + 93) > cover.density(zoneName, x, z) * 7.5) continue;
      const species = cover.pick(zoneName, hash2(d.tx * N + lx, d.tz * N + lz, seed + 94));
      const r3 = hash2(d.tx * N + lx, d.tz * N + lz, seed + 95);
      // Sized like grown real trees (thinned-out ones a little bigger, to fill the gaps).
      const size = TREES[species].grown * (0.8 + 0.45 * r1) * zone.stature * (level === 2 ? 1.3 : level === 1 ? 1.12 : 1);
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
  const out: StandInPlan[] = [];
  for (const k of SPECIES) {
    const c = counts[k], total = c[0] + c[1] + c[2];
    if (total) out.push({ species: k, mats: new Float32Array(mats[k]), cols: new Float32Array(cols[k]), counts: [total, c[2] + c[1], c[2]] });
  }
  return out;
}
