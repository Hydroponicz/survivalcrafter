import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { leafMaterial, SPECIES, treeGeometries, TREES } from './trees';
import { FORAGE, FORAGE_SPECIES } from '../data/forage';
import { forageGeometry, forageScale, LOW_FINDS } from './forageProps';
import { TreeFx, treeScale } from './treefx';
import { hash2 } from './noise';
import { CAMPFIRE } from './models/campfire';
import { IRON_ANVIL } from './models/iron_anvil';
import { WOOD_BUCKET } from './models/wood_bucket';
import type { ViewCull } from './cull';
import { cylinderUV, surfaceMat, worldUV, type Surface } from './surfaces';
import { builtShare, fillPlanes } from './pieceFill';
import { furnitureMesh } from './furnitureMesh';
import { STRUCTURES } from '../data/structures';
import type { VesselId } from '../data/vessels';
import { mastRig, shipSolids, windAngle, shipStats, stageProgress, type ShipDesign } from '../data/ships';
import {
  APPLE_AGE, APPLES, CROP_STAGES, corpseSpecies, cropPos, type AnimalObj, type AnimalSpecies, type BushObj, type ForageObj, type PileObj, type Species, type StructureObj,
  type CartObj, type ShipBuild, type TreeObj, type World, type WorldListener, type WorldObj,
} from './world';

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
  m.userData.owned = true;
  return m;
};

/**
 * Free what an object no longer drawn holds on the graphics card: its geometry
 * (unless shared: models, animal bodies, the character) and materials made just
 * for it (shared, textured ones are kept), and a skinned body's bone texture.
 */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mat && (mat as THREE.Material).userData.owned) (mat as THREE.Material).dispose();
    }
    (m as THREE.SkinnedMesh).skeleton?.dispose();
  });
}

/** Animals (by |dx|+|dz|) and crops further than this from you aren't drawn. */
const SHOW_ANIMALS = 220, SHOW_CROPS = 240;
/** Trees within this distance (metres) are drawn with full crowns. */
const TREE_DETAIL = 55;

/**
 * An instanced mesh that draws only the instances in (or casting a shadow
 * into) view. Every instance is kept here; each time the view moves on, the
 * ones that can be seen are packed into the mesh, so the rest cost nothing.
 */
class CulledInstances {
  mesh: THREE.InstancedMesh;
  /** Each slot's matrix and colour, and whether it's shown. */
  protected src: Float32Array;
  protected srcCol: Float32Array;
  protected live: Uint8Array;
  /** Slots in use (high-water mark). */
  protected top = 0;
  private dirty = true;
  private seen = -1;
  private gc: THREE.Vector3;
  private gr: number;
  private gh: number;
  /** Instances packed first that the shadow map draws (the rest are only in view). */
  private shadowCount = 0;
  private viewOnly = new Int32Array(0);

  constructor(geo: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number, shadow: boolean) {
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = true;
    // Culled here, instance by instance.
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(0xffffff));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.src = new Float32Array(capacity * 16);
    this.srcCol = new Float32Array(capacity * 3).fill(1);
    this.live = new Uint8Array(capacity);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    this.gc = geo.boundingSphere!.center.clone();
    this.gr = geo.boundingSphere!.radius;
    this.gh = geo.boundingBox!.max.y;
    if (shadow) {
      // The shadow map draws only the instances in its box (packed first).
      let all = 0;
      this.mesh.onBeforeShadow = () => { all = this.mesh.count; this.mesh.count = this.shadowCount; };
      this.mesh.onAfterShadow = () => { this.mesh.count = all; };
    }
  }

  protected put(i: number, m: THREE.Matrix4, color?: THREE.Color) {
    m.toArray(this.src, i * 16);
    if (color) color.toArray(this.srcCol, i * 3);
    this.live[i] = 1;
    this.dirty = true;
  }

  protected drop(i: number) {
    this.live[i] = 0;
    this.dirty = true;
  }

  protected move(from: number, to: number) {
    this.src.copyWithin(to * 16, from * 16, from * 16 + 16);
    this.srcCol.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.live[to] = this.live[from];
    this.live[from] = 0;
    this.dirty = true;
  }

  /** Pack what can be seen into the mesh (only when something or the view changed). */
  cull(view: ViewCull) {
    if (!this.dirty && this.seen === view.version) return;
    this.dirty = false;
    this.seen = view.version;
    const S = this.src, C = this.srcCol, M = this.mesh.instanceMatrix.array as Float32Array, MC = this.mesh.instanceColor!.array as Float32Array;
    const gx = this.gc.x, gy = this.gc.y, gz = this.gc.z, shadow = this.mesh.castShadow;
    let n = 0, nv = 0;
    if (shadow && this.viewOnly.length < this.top) this.viewOnly = new Int32Array(this.capacity);
    const V = this.viewOnly;
    for (let i = 0; i < this.top; i++) {
      if (!this.live[i]) continue;
      const o = i * 16;
      // Where the model's bounding sphere ends up, and how big.
      const sx = Math.hypot(S[o], S[o + 1], S[o + 2]), sy = Math.hypot(S[o + 4], S[o + 5], S[o + 6]), sz = Math.hypot(S[o + 8], S[o + 9], S[o + 10]);
      const r = this.gr * Math.max(sx, sy, sz);
      if (r === 0) continue;
      const cx = S[o] * gx + S[o + 4] * gy + S[o + 8] * gz + S[o + 12];
      const cy = S[o + 1] * gx + S[o + 5] * gy + S[o + 9] * gz + S[o + 13];
      const cz = S[o + 2] * gx + S[o + 6] * gy + S[o + 10] * gz + S[o + 14];
      if (shadow) {
        if (!view.inShadowMap(cx, cy, cz, r)) {
          // Outside the shadow map: drawn only if it's in view, after the casters.
          if (view.sphere(cx, cy, cz, r)) V[nv++] = i;
          continue;
        }
        if (!view.caster(cx, cy, cz, r, this.gh * sy)) continue;
      } else if (!view.sphere(cx, cy, cz, r)) continue;
      M.set(S.subarray(o, o + 16), n * 16);
      MC.set(C.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    this.shadowCount = n;
    for (let k = 0; k < nv; k++) {
      const i = V[k], o = i * 16;
      M.set(S.subarray(o, o + 16), n * 16);
      MC.set(C.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    const im = this.mesh.instanceMatrix, ic = this.mesh.instanceColor!;
    im.clearUpdateRanges(); im.addUpdateRange(0, Math.max(1, n) * 16); im.needsUpdate = true;
    ic.clearUpdateRanges(); ic.addUpdateRange(0, Math.max(1, n) * 3); ic.needsUpdate = true;
  }
}

/** Instances by object id, kept packed (removing one moves the last into its place). */
class PackedPool extends CulledInstances {
  private at = new Map<number, number>();
  private ids: number[] = [];

  constructor(geo: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    super(geo, material, capacity, true);
  }

  set(id: number, m: THREE.Matrix4, color: THREE.Color) {
    let i = this.at.get(id);
    if (i === undefined) {
      if (this.ids.length >= this.capacity) return;
      i = this.ids.length;
      this.ids.push(id);
      this.at.set(id, i);
      this.top = this.ids.length;
    }
    this.put(i, m, color);
  }

  remove(id: number) {
    const i = this.at.get(id);
    if (i === undefined) return;
    const last = this.ids.length - 1, lastId = this.ids[last];
    if (i !== last) {
      this.move(last, i);
      this.ids[i] = lastId;
      this.at.set(lastId, i);
    } else this.drop(i);
    this.ids.pop();
    this.at.delete(id);
    this.top = this.ids.length;
  }
}

/** Instances in slots handed out and given back. */
class InstancePool extends CulledInstances {
  private free: number[] = [];

  constructor(geo: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadow = true) {
    super(geo, material, capacity, shadow);
  }

  alloc(): number {
    if (this.free.length) return this.free.pop()!;
    if (this.top >= this.capacity) return -1;
    return this.top++;
  }

  release(slot: number) {
    if (slot < 0) return;
    this.drop(slot);
    this.free.push(slot);
  }

  set(slot: number, m: THREE.Matrix4, color?: THREE.Color) {
    if (slot >= 0) this.put(slot, m, color);
  }

  hide(slot: number) {
    if (slot >= 0) this.drop(slot);
  }
}

export class WorldView implements WorldListener {
  /** Called when a building piece appears or goes (the ground cover around it changes). */
  onStructure?: (o: StructureObj) => void;
  /** Called when a low-lying find (stones, flint, a branch) appears or goes. */
  onLowFind?: (o: ForageObj) => void;
  group = Object.assign(new THREE.Group(), { name: 'objects' });
  /** Trees being chopped and felled, chips, leaves and stumps. */
  treeFx: TreeFx;
  private trunks = {} as Record<Species, InstancePool>;
  /** Plainer trunks for trees further off (the same slots as `trunks`). */
  private trunksLo = {} as Record<Species, InstancePool>;
  private leaves = {} as Record<Species, PackedPool>;
  /** Simpler crowns for the trees further off. */
  private leavesLo = {} as Record<Species, PackedPool>;
  private leafBase = {} as Record<Species, number>;
  /** Trees drawn with the simpler crowns, and where the detail was last judged from. */
  private far = new Set<number>();
  private trees = new Map<number, TreeObj>();
  private lodAt = { x: NaN, z: NaN };
  private bushPool: InstancePool;
  private berryPool: InstancePool;
  private fruitPool!: InstancePool;
  /** Apple trees' slots in the fruit pool. */
  private fruitSlots = new Map<number, number>();
  private slots = new Map<number, number>();
  private meshes = new Map<number, THREE.Object3D>();
  /** Crops: one instanced pool per growth stage (a village's fields hold hundreds). */
  private cropPools: InstancePool[] = [];
  private cropSlots = new Map<number, { stage: number; slot: number }>();
  /** Crops too far off to draw (picked up again as you come near). */
  private farCrops = new Set<number>();
  private animalMeshes = new Map<number, THREE.Group>();
  private fireLights: THREE.PointLight[] = [];
  private flames = new Set<THREE.Mesh>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private foragePools = new Map<string, InstancePool>();
  /** Whether the player can currently see a forage find (skill-gated). */
  forageVisible: (o: ForageObj) => boolean = () => true;
  /** Where a find actually rests: on the ground as drawn (which can differ a little from its stored height). */
  forageGround: (o: ForageObj) => number = (o) => o.y;
  private cropGeo: THREE.BufferGeometry;
  private cropMats: THREE.MeshStandardMaterial[];

  constructor(private world: World) {
    const trunkMat = Object.fromEntries(SPECIES.map((s) => [s, TREES[s].bark])) as Record<Species, number>;
    const leafMat = Object.fromEntries(SPECIES.map((s) => [s, TREES[s].leaf])) as Record<Species, number>;
    for (const s of SPECIES) {
      const g = treeGeometries(s);
      this.trunks[s] = new InstancePool(g.trunk, mat(trunkMat[s]), 9000);
      this.trunksLo[s] = new InstancePool(treeGeometries(s, 0).trunk, mat(trunkMat[s]), 9000);
      this.leaves[s] = new PackedPool(g.leaves, leafMaterial(g.leaves), 9000);
      const lo = treeGeometries(s, 0).leaves;
      this.leavesLo[s] = new PackedPool(lo, leafMaterial(lo), 9000);
      this.leafBase[s] = leafMat[s];
      this.group.add(this.trunks[s].mesh, this.trunksLo[s].mesh, this.leaves[s].mesh, this.leavesLo[s].mesh);
    }
    this.bushPool = new InstancePool(
      new THREE.IcosahedronGeometry(0.6, 1).scale(1, 0.75, 1).translate(0, 0.4, 0),
      mat(0x3d6b2a, { flatShading: true }), 2000);
    const berries = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      berries.push(new THREE.SphereGeometry(0.07, 5, 4).translate(Math.cos(a) * 0.52, 0.35 + (i % 3) * 0.12, Math.sin(a) * 0.52));
    }
    this.berryPool = new InstancePool(mergeGeometries(berries)!, mat(0x3a3a9a, { emissive: 0x111133 }), 2000, false);
    this.group.add(this.bushPool.mesh, this.berryPool.mesh);
    // Apples hanging round the lower edge of an apple tree's crown (in the tree's own frame).
    const apples = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.4, r = 1.55 + (i % 4) * 0.12, y = 2.55 + ((i * 7) % 5) * 0.16;
      apples.push(new THREE.SphereGeometry(0.11, 7, 5).translate(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    this.fruitPool = new InstancePool(mergeGeometries(apples)!, mat(0xc0281e, { roughness: 0.45, emissive: 0x2a0402 }), 2000, false);
    this.group.add(this.fruitPool.mesh);

    const stalks = [];
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) - 1) * 0.3, z = (Math.floor(i / 3) - 1) * 0.3;
      stalks.push(new THREE.CylinderGeometry(0.03, 0.04, 0.9, 4).translate(x, 0.45, z));
      stalks.push(new THREE.ConeGeometry(0.08, 0.25, 4).translate(x, 0.95, z));
    }
    this.cropGeo = mergeGeometries(stalks)!;
    this.cropMats = [0x6aa84f, 0x7fb348, 0x9cba45, 0xc2b04a, 0xd9b44a].map((c) => mat(c));
    this.cropPools = this.cropMats.map((m) => new InstancePool(this.cropGeo, m, 4000));
    for (const p of this.cropPools) this.group.add(p.mesh);

    const forageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    for (const sp of FORAGE_SPECIES) {
      const pool = new InstancePool(forageGeometry(sp.id), forageMat, 3000, false);
      this.foragePools.set(sp.id, pool);
      this.group.add(pool.mesh);
    }

    // The nearest few fires and planted torches light their surroundings.
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 16, 1.6);
      this.fireLights.push(l);
      this.group.add(l);
    }

    const leafGeos = {} as Record<Species, THREE.BufferGeometry>;
    for (const sp of SPECIES) leafGeos[sp] = treeGeometries(sp).leaves;
    this.treeFx = new TreeFx(world.terrain, (sp) => leafGeos[sp], (t) => this.leafColor(t));
    this.group.add(this.treeFx.group);
    this.treeFx.syncStumps(world.stumps);

    for (const o of world.objects.values()) this.added(o);
    for (const k of world.crops.keys()) this.cropsChanged(k);
    world.listener = this;
  }

  // ---------- WorldListener
  added(o: WorldObj) {
    if (o.kind === 'structure') this.onStructure?.(o);
    if (o.kind === 'tree') {
      const slot = this.trunks[o.species].alloc();
      this.trunksLo[o.species].alloc(); // kept in step: the same slot in both
      this.slots.set(o.id, slot);
      this.trees.set(o.id, o);
      if (o.species === 'apple') this.fruitSlots.set(o.id, this.fruitPool.alloc());
      if (Math.hypot(o.x - this.lodAt.x, o.z - this.lodAt.z) > TREE_DETAIL) this.far.add(o.id);
      this.updateTree(o);
    } else if (o.kind === 'bush') {
      const slot = this.bushPool.alloc();
      this.berryPool.alloc();
      this.slots.set(o.id, slot);
      this.updateBush(o);
    } else if (o.kind === 'forage') {
      const pool = this.foragePools.get(o.species);
      if (!pool) return;
      this.slots.set(o.id, pool.alloc());
      this.updateForage(o);
      if (LOW_FINDS[o.species]) this.onLowFind?.(o);
    } else {
      this.rebuildMesh(o);
    }
  }

  removed(o: WorldObj) {
    if (o.kind === 'structure') this.onStructure?.(o);
    if (o.kind === 'tree') {
      const s = this.slots.get(o.id)!;
      this.trunks[o.species].release(s);
      this.trunksLo[o.species].release(s);
      this.leaves[o.species].remove(o.id);
      this.leavesLo[o.species].remove(o.id);
      this.slots.delete(o.id);
      this.trees.delete(o.id);
      this.far.delete(o.id);
      this.treeFx.remove(o.id);
      const fs = this.fruitSlots.get(o.id);
      if (fs !== undefined) { this.fruitPool.release(fs); this.fruitSlots.delete(o.id); }
    } else if (o.kind === 'bush') {
      const s = this.slots.get(o.id)!;
      this.bushPool.release(s);
      this.berryPool.release(s);
      this.slots.delete(o.id);
    } else if (o.kind === 'forage') {
      const s = this.slots.get(o.id);
      if (s !== undefined) this.foragePools.get(o.species)?.release(s);
      this.slots.delete(o.id);
    } else {
      const m = this.meshes.get(o.id);
      if (m) { this.disposeMesh(m); this.meshes.delete(o.id); }
      this.unbatch(o.id);
    }
  }

  changed(o: WorldObj) {
    if (o.kind === 'tree') this.updateTree(o);
    else if (o.kind === 'bush') this.updateBush(o);
    else if (o.kind === 'forage') this.updateForage(o);
    else this.rebuildMesh(o);
  }

  cropsChanged(k: number) {
    const crop = this.world.crops.get(k);
    const old = this.cropSlots.get(k);
    if (old) { this.cropPools[old.stage].release(old.slot); this.cropSlots.delete(k); }
    this.farCrops.delete(k);
    if (!crop) return;
    // Far off (a village's fields you've left behind): drawn when you come back.
    {
      const { x, z } = cropPos(k);
      if (Number.isFinite(this.lodAt.x) && Math.hypot(x - this.lodAt.x, z - this.lodAt.z) > SHOW_CROPS) { this.farCrops.add(k); return; }
    }
    const stage = this.world.cropStage(crop);
    const slot = this.cropPools[stage].alloc();
    if (slot < 0) return;
    const { x, z } = cropPos(k);
    this.q.identity();
    this.m4.compose(new THREE.Vector3(x, this.world.terrain.heightAt(x, z), z), this.q, new THREE.Vector3(1, 0.15 + (stage / (CROP_STAGES - 1)) * 0.85, 1));
    this.cropPools[stage].set(slot, this.m4);
    this.cropSlots.set(k, { stage, slot });
  }

  // ---------- updates
  /** The same per-tree leaf tint the instanced trees use. */
  private leafColor(o: TreeObj): THREE.Color {
    const base = new THREE.Color(this.leafBase[o.species]);
    return base.offsetHSL((hash2(o.id, 3) - 0.5) * 0.04, 0, (hash2(o.id, 4) - 0.5) * 0.08);
  }

  private updateTree(o: TreeObj) {
    const slot = this.slots.get(o.id)!;
    // A tree that's been chopped into is drawn on its own, notch and all.
    const fs = this.fruitSlots.get(o.id);
    if ((o.chop ?? 0) > 0 || this.treeFx.has(o.id)) {
      if (fs !== undefined) this.fruitPool.hide(fs);
      this.trunks[o.species].hide(slot);
      this.trunksLo[o.species].hide(slot);
      this.leaves[o.species].remove(o.id);
      this.leavesLo[o.species].remove(o.id);
      this.treeFx.place(this.treeFx.ensure(o));
      return;
    }
    const y = this.world.terrain.heightAt(o.x, o.z) - 0.1;
    // The same size the chopping, felling and collisions use.
    const { s, hs, yaw: r } = treeScale(o);
    this.q.setFromAxisAngle(this.up, r);
    this.m4.compose(new THREE.Vector3(o.x, y, o.z), this.q, new THREE.Vector3(s, s * hs, s));
    const lo = this.far.has(o.id);
    (lo ? this.trunksLo : this.trunks)[o.species].set(slot, this.m4);
    (lo ? this.trunks : this.trunksLo)[o.species].hide(slot);
    (lo ? this.leavesLo : this.leaves)[o.species].set(o.id, this.m4, this.leafColor(o));
    (lo ? this.leaves : this.leavesLo)[o.species].remove(o.id);
    // Apples, while it bears any.
    if (fs !== undefined) {
      if (o.age >= APPLE_AGE && (o.apples ?? APPLES) > 0) this.fruitPool.set(fs, this.m4);
      else this.fruitPool.hide(fs);
    }
  }

  /**
   * Trees near you get full crowns, those further off simpler ones (from a
   * distance they look the same, at a fraction of the drawing). Checked as you
   * move, with a margin so trees on the boundary don't flicker between the two.
   */
  /** Hand each instanced kind of thing only what can be seen (call each frame, before drawing). */
  cull(view: ViewCull) {
    for (const sp of Object.keys(this.trunks) as Species[]) {
      this.trunks[sp].cull(view); this.trunksLo[sp].cull(view); this.leaves[sp].cull(view); this.leavesLo[sp].cull(view);
    }
    this.bushPool.cull(view);
    this.berryPool.cull(view);
    this.fruitPool.cull(view);
    for (const p of this.cropPools) p.cull(view);
    for (const p of this.foragePools.values()) p.cull(view);
    this.flushBatches();
  }

  updateTreeDetail(px: number, pz: number) {
    if (Math.hypot(px - this.lodAt.x, pz - this.lodAt.z) < 6) return;
    this.lodAt = { x: px, z: pz };
    for (const k of [...this.farCrops]) {
      const c = cropPos(k);
      if (Math.hypot(c.x - px, c.z - pz) < SHOW_CROPS - 15) this.cropsChanged(k);
    }
    for (const [id, o] of this.trees) {
      const d = Math.hypot(o.x - px, o.z - pz), lo = this.far.has(id);
      if (lo && d < TREE_DETAIL - 8) this.far.delete(id);
      else if (!lo && d > TREE_DETAIL + 8) this.far.add(id);
      else continue;
      this.updateTree(o);
    }
  }

  private updateBush(o: BushObj) {
    const slot = this.slots.get(o.id)!;
    const y = this.world.terrain.heightAt(o.x, o.z);
    this.q.setFromAxisAngle(this.up, hash2(o.id, 1) * 6.28);
    this.m4.compose(new THREE.Vector3(o.x, y, o.z), this.q, new THREE.Vector3(1, 1, 1));
    this.bushPool.set(slot, this.m4);
    if (o.ripe) this.berryPool.set(slot, this.m4);
    else this.berryPool.hide(slot);
  }

  /** Redraw one find (after the ground under it has been measured). */
  resettleForage(o: ForageObj) {
    this.updateForage(o);
  }

  private updateForage(o: ForageObj) {
    const slot = this.slots.get(o.id);
    const pool = this.foragePools.get(o.species);
    if (slot === undefined || !pool) return;
    if (!this.forageVisible(o)) { pool.hide(slot); return; }
    const s = (0.85 + hash2(o.id, 5) * 0.35) * forageScale(FORAGE[o.species]?.category ?? 'material');
    this.q.setFromAxisAngle(this.up, o.rot);
    this.m4.compose(new THREE.Vector3(o.x, this.forageGround(o) - 0.02, o.z), this.q, new THREE.Vector3(s, s, s));
    pool.set(slot, this.m4);
  }

  /** Re-check which forage finds the player can see (after a skill gain or a survey). */
  refreshForage() {
    for (const o of this.world.objects.values()) if (o.kind === 'forage') this.updateForage(o);
  }

  /** Re-sync heights of everything after terrain changes near a point. */
  refreshNear(x: number, z: number, r = 4) {
    for (const o of this.world.near(x, z, r)) if (o.kind !== 'structure') this.changed(o);
    // Snapshot the keys: cropsChanged re-inserts them, which would make a live
    // iteration visit the same crop forever.
    for (const k of [...this.cropSlots.keys()]) {
      const c = cropPos(k);
      if (Math.abs(c.x - x) < r + 1 && Math.abs(c.z - z) < r + 1) this.cropsChanged(k);
    }
  }

  private disposeMesh(m: THREE.Object3D) {
    this.group.remove(m);
    m.traverse((c) => { if (c instanceof THREE.Mesh) this.flames.delete(c); });
    // (Freed on the graphics card too: doors open and shut all day in a village, and each look is new geometry.)
    disposeObject(m);
  }

  // ---------- static batches
  /**
   * Built pieces that never move (walls, floors, roofs, fences…) are merged,
   * 32 m of the world at a time, into one mesh per material: a village of
   * hundreds of pieces costs a handful of draws instead of thousands. A batch
   * is remade (one a frame) whenever a piece in it comes or goes.
   */
  private batches = new Map<string, { ids: Set<number>; meshes: THREE.Mesh[]; dirty: boolean }>();
  private batchKey = new Map<number, string>();

  private batchable(o: WorldObj): boolean {
    return o.kind === 'structure' && o.built && batchedType(o.type);
  }

  private unbatch(id: number) {
    const k = this.batchKey.get(id);
    if (k === undefined) return;
    this.batchKey.delete(id);
    const b = this.batches.get(k);
    if (b) { b.ids.delete(id); b.dirty = true; }
  }

  private toBatch(o: StructureObj) {
    const k = `${Math.floor(o.x / 32)},${Math.floor(o.z / 32)}`;
    if (this.batchKey.get(o.id) !== k) this.unbatch(o.id);
    this.batchKey.set(o.id, k);
    let b = this.batches.get(k);
    if (!b) this.batches.set(k, (b = { ids: new Set(), meshes: [], dirty: true }));
    b.ids.add(o.id);
    b.dirty = true;
  }

  /** Remake batches that changed, a few milliseconds' worth a frame (call each frame). */
  flushBatches(budgetMs = 4) {
    const until = performance.now() + budgetMs;
    for (const [k, b] of this.batches) {
      if (!b.dirty) continue;
      if (performance.now() > until) return;
      b.dirty = false;
      for (const m of b.meshes) { this.group.remove(m); m.geometry.dispose(); }
      b.meshes = [];
      if (!b.ids.size) { this.batches.delete(k); continue; }
      const byMat = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
      for (const id of b.ids) {
        const o = this.world.objects.get(id);
        if (!o || o.kind !== 'structure') continue;
        const g = buildPieceMesh(o.type, { open: o.open, water: o.water });
        g.position.set(o.x, o.y, o.z);
        g.rotation.y = o.yaw;
        g.updateMatrixWorld(true);
        g.traverse((c) => {
          if (!(c instanceof THREE.Mesh)) return;
          const m = c.material as THREE.MeshStandardMaterial;
          const key = m.userData.tint !== undefined ? m.uuid : `${m.color.getHex()}|${m.roughness}|${m.side}|${m.emissive.getHex()}|${m.transparent}`;
          let geo = (c.geometry as THREE.BufferGeometry);
          geo = geo.index ? geo.toNonIndexed() : geo.clone();
          geo.applyMatrix4(c.matrixWorld);
          for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
          if (!geo.attributes.normal) geo.computeVertexNormals();
          if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
          let e = byMat.get(key);
          if (!e) byMat.set(key, (e = { mat: m, geos: [] }));
          e.geos.push(geo);
          c.geometry.dispose();
        });
      }
      for (const { mat: m, geos } of byMat.values()) {
        const merged = mergeGeometries(geos);
        for (const g of geos) g.dispose();
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, m);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        b.meshes.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  private rebuildMesh(o: WorldObj) {
    const old = this.meshes.get(o.id);
    if (old) { this.disposeMesh(old); this.meshes.delete(o.id); }
    if (this.batchable(o)) { this.toBatch(o as StructureObj); return; }
    this.unbatch(o.id);
    const m = o.kind === 'structure' ? this.structureMesh(o) : this.pileMesh(o as PileObj);
    this.meshes.set(o.id, m);
    this.group.add(m);
  }

  private pileMesh(o: PileObj): THREE.Object3D {
    const g = new THREE.Group();
    o.y = this.world.terrain.groundBelow(o.x, o.y + 0.3, o.z);
    if (!Number.isFinite(o.y)) o.y = this.world.terrain.heightAt(o.x, o.z);
    g.position.set(o.x, o.y, o.z);
    const corpse = o.items.find((i) => i.type === 'corpse');
    if (corpse) {
      const body = animalModel(corpseSpecies(corpse.label));
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.35;
      g.add(body);
      return g;
    }
    const logs = o.items.filter((i) => i.type === 'log').length;
    for (let i = 0; i < Math.min(logs, 6); i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.8, 7), mat(0x6b4a30));
      log.rotation.z = Math.PI / 2;
      log.position.set(0, 0.18 + Math.floor(i / 3) * 0.32, ((i % 3) - 1) * 0.37);
      log.castShadow = true;
      g.add(log);
    }
    const others = o.items.length - logs;
    if (others > 0) {
      const s = Math.min(0.6, 0.18 + others * 0.02);
      const sack = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1).scale(1, 0.7, 1), mat(0x9b7b52, { flatShading: true }));
      sack.position.set(logs ? 0.9 : 0, s * 0.6, 0);
      sack.castShadow = true;
      g.add(sack);
    }
    return g;
  }

  private structureMesh(o: StructureObj): THREE.Object3D {
    const g = buildPieceMesh(o.type, { lit: o.lit, open: o.open, water: o.water });
    g.position.set(o.x, o.y, o.z);
    g.rotation.y = o.yaw;
    g.traverse((c) => { if (c instanceof THREE.Mesh && c.userData.flame) this.flames.add(c); });
    if (!o.built) {
      // A planned piece: what's been built is solid (walls course by course
      // from the ground up, floors plank by plank), the rest a blueprint ghost.
      const share = builtShare(o);
      const { built, rest } = fillPlanes(o, share);
      if (share > 0) {
        const solid = buildPieceMesh(o.type, { lit: o.lit, open: o.open, water: o.water });
        solid.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            const m = (c.material as THREE.MeshStandardMaterial).clone();
            m.userData.owned = true;
            m.clippingPlanes = [built];
            m.clipShadows = true;
            c.material = m;
          }
        });
        g.add(solid);
        solid.userData.solid = true;
      }
      g.traverse((c) => {
        if (c instanceof THREE.Mesh && !isInSolid(c)) {
          const m = (c.material as THREE.MeshStandardMaterial).clone();
          m.userData.owned = true;
          m.transparent = true;
          m.opacity = 0.35;
          m.depthWrite = false;
          m.color.lerp(new THREE.Color(0x9ec4ff), 0.55);
          m.clippingPlanes = [rest];
          c.material = m;
          c.castShadow = false;
        }
      });
    }
    return g;
  }

  // ---------- animals
  /** Vessels (carts, boats): one model each, on the ground or afloat, showing a load when there's something in them. */
  private cartMeshes = new Map<number, THREE.Group>();
  syncCarts() {
    const live = new Set<number>();
    for (const c of this.world.carts) {
      live.add(c.id);
      const loaded = c.items.length > 0;
      let m = this.cartMeshes.get(c.id);
      // (A ship is redrawn as it's built, and once off its cradle.)
      const sig = c.ship ? `${c.ship.done}:${c.ship.slipY !== undefined && !c.ship.launching}` : '';
      if (m && (m.userData.loaded !== loaded || m.userData.sig !== sig)) { this.group.remove(m); disposeObject(m); this.cartMeshes.delete(c.id); m = undefined; }
      if (!m) {
        m = vesselModel(c.type, loaded, c.ship);
        m.userData.sig = sig;
        this.cartMeshes.set(c.id, m);
        this.group.add(m);
      }
      m.position.set(c.x, this.world.vesselY(c), c.z);
      m.rotation.y = c.rot;
      // Afloat, a boat rocks a little on the water.
      if (this.world.afloat(c)) {
        const t = performance.now() / 1000;
        m.position.y += Math.sin(t * 1.3 + c.id) * 0.025;
        m.rotation.z = Math.sin(t * 0.9 + c.id * 2) * 0.03;
        m.rotation.x = Math.sin(t * 0.7 + c.id) * 0.012;
      } else { m.rotation.z = 0; m.rotation.x = 0; }
      if (c.ship && m.userData.sails) this.trimSails(c, m);
      // The wheels turn as it rolls.
      const moved = Math.hypot(c.x - (m.userData.lx ?? c.x), c.z - (m.userData.lz ?? c.z));
      m.userData.lx = c.x; m.userData.lz = c.z;
      for (const w of m.userData.wheels as THREE.Object3D[]) w.rotation.x += moved / (m.userData.r as number);
    }
    for (const [id, m] of this.cartMeshes) if (!live.has(id)) { this.group.remove(m); disposeObject(m); this.cartMeshes.delete(id); }
  }

  /**
   * A ship's sails braced round to the wind: a square sail's yard squared
   * when she runs before it and braced round (the lee yardarm aft) as she
   * comes up toward it; a lateen swung out to leeward, wider the more she
   * bears away. Shortened sail is reefed up to the yard (a lateen is furled
   * along its yard), and she heels a little to the wind on her sails.
   */
  private trimSails(c: CartObj, m: THREE.Group) {
    const s = c.ship!, afloat = this.world.afloat(c), set = afloat ? s.sail ?? 0 : 0;
    const rel = afloat ? windAngle(c.rot, this.world.wind().dir) : Math.PI, off = Math.abs(rel), side = Math.sign(rel) || 1;
    for (const sl of m.userData.sails as { pivot: THREE.Group; rig: 'square' | 'lateen'; cloth: THREE.Object3D }[]) {
      const want = sl.rig === 'square' ? side * Math.min(1.15, (Math.PI - off) * 0.55) : -side * Math.max(0.2, Math.min(1.4, off * 0.5));
      // (Ease round, as the braces and sheets are worked.)
      sl.pivot.rotation.y += (want - sl.pivot.rotation.y) * 0.03;
      if (sl.rig === 'square') { sl.cloth.scale.y = Math.max(0.06, Math.abs(set)); sl.cloth.visible = true; }
      else sl.cloth.visible = Math.abs(set) > 0.02;
    }
    if (afloat && set > 0) m.rotation.z += -side * Math.min(0.05, set * Math.sin(off) * this.world.wind().strength / 220);
  }

  syncAnimals(time: number) {
    const live = new Set<number>();
    for (const a of this.world.animals) {
      // Only those near you are drawn (a village's flock kilometres off costs nothing, nor makes the ground there be worked out).
      if (Number.isFinite(this.lodAt.x) && Math.abs(a.x - this.lodAt.x) + Math.abs(a.z - this.lodAt.z) > SHOW_ANIMALS) continue;
      live.add(a.id);
      let m = this.animalMeshes.get(a.id);
      // (A horse gets its saddle when it's tamed.)
      if (m && m.userData.tamed !== undefined && m.userData.tamed !== !!a.tamed) { this.group.remove(m); this.animalMeshes.delete(a.id); m = undefined; }
      if (!m) {
        m = animalModel(a.species, a.id, !!a.tamed);
        this.animalMeshes.set(a.id, m);
        this.group.add(m);
      }
      m.position.set(a.x, this.world.terrain.heightAt(a.x, a.z), a.z);
      m.rotation.y = a.rot;
      animateLegs(m, a, time);
      // Winding up to charge: head down and shuddering. Just hit: a flinch.
      if ((a.windup ?? 0) > 0) { m.position.y -= 0.07; m.rotation.y += Math.sin(time * 40) * 0.05; }
      m.scale.setScalar(1 + (a.hurt ?? 0) * 0.25);
    }
    for (const [id, m] of this.animalMeshes) {
      if (!live.has(id)) { this.group.remove(m); this.animalMeshes.delete(id); }
    }
  }

  /** Flicker flames and park the light pool on the fires nearest the player. */
  updateFires(px: number, pz: number, time: number) {
    const lit: StructureObj[] = [];
    // Only built things carry a flame: look through those, not everything around.
    for (const id of this.meshes.keys()) {
      const o = this.world.objects.get(id);
      if (o?.kind === 'structure' && o.lit && Math.abs(o.x - px) < 40 && Math.abs(o.z - pz) < 40) lit.push(o);
    }
    lit.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    this.fireLights.forEach((l, i) => {
      const f = lit[i];
      if (!f) { l.intensity = 0; return; }
      // A fire's light, or a torch's (weaker, up where its flame is).
      const glow = STRUCTURES[f.type].glow;
      const out = glow?.out ?? 0;
      l.position.set(f.x + Math.sin(f.yaw) * out, f.y + (glow?.height ?? 1.2), f.z + Math.cos(f.yaw) * out);
      l.intensity = (9 + Math.sin(time * 13 + i) * 1.5 + Math.sin(time * 7.3) * 1) * (glow?.strength ?? 1);
    });
    for (const fl of this.flames) {
      const s = 1 + Math.sin(time * 15 + fl.id) * 0.12;
      fl.scale.set(s, 1 + Math.sin(time * 11 + fl.id) * 0.18, s);
    }
  }
}

/** Coat and mane colours for horses (picked by the animal's id). */
const HORSE_COATS: [number, number][] = [[0x7a4426, 0x2a1a12], [0x5a3420, 0x1e140e], [0x2c2420, 0x161210], [0x9a948c, 0x5a5650], [0xc09a5a, 0xe8dcc0], [0x8a5a34, 0x3a2416]];

/** A horse: long legs, a deep body, an arched neck and a long head; tamed, a blanket and saddle. */
function horseModel(seed: number, tamed: boolean): THREE.Group {
  const g = new THREE.Group();
  const [coat, mane] = HORSE_COATS[Math.abs(seed) % HORSE_COATS.length];
  const part = (geo: THREE.BufferGeometry, c: number, x: number, y: number, z: number, rx = 0, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat(c));
    m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; parent.add(m); return m;
  };
  part(new THREE.BoxGeometry(0.56, 0.68, 1.55), coat, 0, 1.26, 0);
  part(new THREE.SphereGeometry(0.36, 10, 8).scale(0.85, 0.95, 0.9), coat, 0, 1.3, 0.62); // chest
  part(new THREE.SphereGeometry(0.36, 10, 8).scale(0.85, 0.95, 0.9), coat, 0, 1.3, -0.62); // rump
  // Neck rising forward, the head hanging from its top.
  const neck = part(new THREE.BoxGeometry(0.3, 0.8, 0.38), coat, 0, 1.75, 0.82, 0.62);
  part(new THREE.BoxGeometry(0.08, 0.82, 0.12), mane, 0, 0.02, -0.22, 0, neck); // mane along the crest
  const head = new THREE.Group();
  head.position.set(0, 2.05, 1.12);
  head.rotation.x = 0.9;
  g.add(head);
  part(new THREE.BoxGeometry(0.24, 0.62, 0.3), coat, 0, 0.18, 0, 0, head);
  part(new THREE.BoxGeometry(0.2, 0.18, 0.26), 0x1e1814, 0, 0.5, 0.01, 0, head); // muzzle
  for (const x of [-0.08, 0.08]) part(new THREE.ConeGeometry(0.045, 0.14, 4), coat, x, -0.17, -0.05, -0.3, head); // ears
  // The tail, hanging from the rump.
  part(new THREE.BoxGeometry(0.12, 0.75, 0.12).translate(0, -0.37, 0), mane, 0, 1.5, -0.95, -0.35);
  const legH = 0.95;
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [[-0.17, 0.58], [0.17, 0.58], [-0.17, -0.6], [0.17, -0.6]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, legH, 0.14).translate(0, -legH / 2, 0), mat(coat));
    leg.position.set(x, legH, z);
    leg.castShadow = true;
    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.17), mat(0x1c1612));
    hoof.position.y = -legH + 0.05;
    leg.add(hoof);
    legs.push(leg);
    g.add(leg);
  }
  if (tamed) {
    // A woven blanket and a leather saddle: this one's yours.
    part(new THREE.BoxGeometry(0.62, 0.05, 0.72), 0x8a2a24, 0, 1.62, -0.02);
    part(new THREE.BoxGeometry(0.46, 0.12, 0.52), 0x5a3a22, 0, 1.69, -0.02);
    part(new THREE.BoxGeometry(0.4, 0.14, 0.06), 0x5a3a22, 0, 1.78, 0.22);
  }
  g.userData.legs = legs;
  g.userData.tamed = tamed;
  return g;
}

/** One shared material for every animal (their colours are baked into the vertices). */
const animalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
/** Merged animal geometry, by kind (species, coat, saddle): a herd shares it. */
const animalGeos = new Map<string, { body: THREE.BufferGeometry; legs: { geo: THREE.BufferGeometry; pos: THREE.Vector3 }[] }>();

/**
 * An animal drawn with as few draw calls as possible: all the fixed parts in
 * one mesh, and one mesh per leg (they swing). Built from the part-by-part
 * model the first time each kind is asked for; colours become vertex colours.
 */
export function animalModel(species: AnimalSpecies, seed = 0, tamed = false): THREE.Group {
  const key = species === 'horse' ? `horse:${Math.abs(seed) % HORSE_COATS.length}:${tamed ? 1 : 0}` : species === 'ox' ? `ox:${Math.abs(seed) % OX_COATS.length}:${tamed ? 1 : 0}` : species;
  let geos = animalGeos.get(key);
  if (!geos) {
    const raw = species === 'horse' ? horseModel(seed, tamed) : species === 'ox' ? oxModel(seed, tamed) : species === 'sheep' ? sheepModel() : partsModel(species);
    raw.updateMatrixWorld(true);
    const legs = raw.userData.legs as THREE.Mesh[];
    const bake = (o: THREE.Object3D, root: THREE.Matrix4): THREE.BufferGeometry[] => {
      const out: THREE.BufferGeometry[] = [];
      o.traverse((m) => {
        if (!(m as THREE.Mesh).isMesh) return;
        const mesh = m as THREE.Mesh;
        let g = mesh.geometry.clone();
        if (g.index) g = g.toNonIndexed();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(root, mesh.matrixWorld));
        const c = (mesh.material as THREE.MeshStandardMaterial).color;
        const n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) c.toArray(col, i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
        out.push(g);
      });
      return out;
    };
    // The body: everything but the legs, in the model's own frame.
    const legSet = new Set<THREE.Object3D>(legs);
    const bodyParts: THREE.BufferGeometry[] = [];
    for (const child of raw.children) if (!legSet.has(child)) bodyParts.push(...bake(child, new THREE.Matrix4()));
    // Each leg (with its hoof) in the leg's own frame, so it can still swing about its hip.
    const legGeos = legs.map((l) => ({ geo: mergeGeometries(bake(l, l.matrixWorld.clone().invert()))!, pos: l.position.clone() }));
    geos = { body: mergeGeometries(bodyParts)!, legs: legGeos };
    geos.body.userData.shared = true;
    for (const l of geos.legs) l.geo.userData.shared = true;
    animalGeos.set(key, geos);
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(geos.body, animalMat);
  body.castShadow = true;
  g.add(body);
  const legs = geos.legs.map(({ geo, pos }) => { const l = new THREE.Mesh(geo, animalMat); l.position.copy(pos); l.castShadow = true; g.add(l); return l; });
  g.userData.legs = legs;
  if (species === 'horse' || species === 'ox') g.userData.tamed = tamed;
  return g;
}

/**
 * Keeps the water out of a hull: an unseen lid across it at the waterline,
 * drawn just before the water and writing only depth, so the sea isn't
 * painted over the inside of a boat whose floor lies below it. `half(z)`
 * is the hull's half-breadth at that height, along its length.
 */
let SHELL_MAT: THREE.Material | undefined;
const WATER_CAP = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true });
function waterCap(g: THREE.Group, y: number, len: number, half: (z: number) => number) {
  const pts: THREE.Vector2[] = [], n = 24;
  for (let i = 0; i <= n; i++) { const z = -len / 2 + (len * i) / n; pts.push(new THREE.Vector2(half(z) * 0.97, z)); }
  for (let i = n; i >= 0; i--) { const z = -len / 2 + (len * i) / n; pts.push(new THREE.Vector2(-half(z) * 0.97, z)); }
  const geo = new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateX(Math.PI / 2);
  // (rotateX turns the shape's y into -z: mirror it back.)
  geo.scale(1, 1, -1);
  const cap = new THREE.Mesh(geo, WATER_CAP);
  cap.position.y = y;
  cap.renderOrder = -1;
  cap.castShadow = false; cap.receiveShadow = false;
  g.add(cap);
}

/**
 * A ship from its design, as far as it's built: the keel, the stem and
 * sternpost, a frame for each bay framed, the planking bay by bay, then the
 * deck, castles, masts, sails and rudder as each is done; a cradle of blocks
 * under it while it stands on the slip. Its keel at y = 0, its bow along +z.
 */
function shipModel(d: ShipDesign, done: number, onSlip: boolean, loaded: boolean): THREE.Group {
  const g = new THREE.Group();
  const s = shipStats(d), L = s.L, B = s.B, D = s.D - (d.decked ? 0.3 : 0), P = stageProgress(d, done);
  const wood = surfaceMat('rough_wood'), planks = surfaceMat('planks'), dark = surfaceMat('dark_planks');
  // The planking seen from inside too (its own copy: the shared planks stay one-sided).
  const shellMat = SHELL_MAT ??= (() => { const m = surfaceMat('planks').clone(); m.side = THREE.DoubleSide; return m; })();
  // The hull's lines: half-breadth and the bottom's rise along it, the sheer (the gunwale rising toward the ends).
  const full = d.beam === 'narrow' ? 2 : d.beam === 'medium' ? 2.6 : 3.6;
  const sheer = d.beam === 'narrow' ? 1.3 : 0.7;
  const halfB = (z: number) => (B / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * z / L), full)), 0.5);
  const bottom = (z: number) => D * 0.7 * Math.pow(Math.abs(2 * z / L), 4);
  const rim = (z: number) => D + sheer * Math.pow(2 * z / L, 2);
  const flat = d.beam === 'broad' ? 0.55 : d.beam === 'medium' ? 0.8 : 1;
  /** The shell of planking between two points along the keel. */
  const shell = (z0: number, z1: number) => {
    const nz = Math.max(2, Math.ceil((z1 - z0) / 0.6)), nu = 14, pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= nz; i++) {
      const z = z0 + (z1 - z0) * (i / nz), w = halfB(z), lo = bottom(z), hi = rim(z);
      for (let j = 0; j <= nu; j++) {
        const t = -Math.PI / 2 + Math.PI * (j / nu);
        const c = Math.cos(t);
        pos.push(w * Math.sin(t), hi - (hi - lo) * Math.pow(c, flat), z);
      }
    }
    for (let i = 0; i < nz; i++) for (let j = 0; j < nu; j++) {
      const a = i * (nu + 1) + j, b = a + nu + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return worldUV(geo, 'planks');
  };
  const add = (m: THREE.Mesh, shadow = true) => { m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m; };
  // The cradle on the slip.
  if (onSlip) for (let z = -L / 2 + 2; z <= L / 2 - 2; z += 3) add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(B * 0.5, 0.6, 0.5), 'rough_wood'), wood)).position.set(0, -0.25, z);
  if (P.keel) add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.3, 0.35, L * 0.92), 'rough_wood'), wood)).position.set(0, 0.17, 0);
  if (P.posts) {
    for (const sgn of [-1, 1]) {
      const h = rim(sgn * L / 2) + (d.type === 'Longship' ? 1.4 : 0.5);
      const post = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.28, h, 0.35), 'rough_wood'), wood));
      post.position.set(0, h / 2, sgn * (L / 2 - 0.25));
      post.rotation.x = sgn * 0.22;
    }
  }
  const bayLen = (L - 2) / d.bays, bayZ = (i: number) => -L / 2 + 1 + bayLen * (i + 0.5);
  // Frames: ribs across each framed bay (two to a bay), from gunwale to keel.
  for (let i = 0; i < P.frames; i++) {
    for (const f of [-0.25, 0.25]) {
      const z = bayZ(i) + f * bayLen, w = halfB(z), hi = rim(z), lo = bottom(z);
      const rib = add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 4, 14, Math.PI).rotateZ(Math.PI).scale(w, hi - lo, 1), wood), false);
      rib.position.set(0, hi, z);
    }
  }
  // Planking, bay by bay (with the ends, closed in with the first and last bays).
  for (let i = 0; i < P.planking; i++) {
    const z0 = i === 0 ? -L / 2 : -L / 2 + 1 + bayLen * i, z1 = i === d.bays - 1 ? L / 2 : -L / 2 + 1 + bayLen * (i + 1);
    add(new THREE.Mesh(shell(z0, z1), shellMat));
  }
  // Strakes showing along a fully planked hull, and a wale at the gunwale.
  if (P.planking === d.bays) {
    // The water kept out of her (at her waterline).
    const wl = s.draft + 0.04;
    waterCap(g, wl, L, (z) => {
      const hi = rim(z), lo = bottom(z);
      if (wl <= lo) return 0;
      const t = Math.acos(Math.min(1, Math.pow(Math.max(0, (hi - wl) / (hi - lo)), 1 / flat)));
      return halfB(z) * Math.sin(t);
    });
    const pts = (k: number) => { const out: THREE.Vector3[] = []; for (let i = 0; i <= 24; i++) { const z = -L / 2 + 0.3 + (L - 0.6) * (i / 24); const w = halfB(z), hi = rim(z), lo = bottom(z), t = k; out.push(new THREE.Vector3(w * Math.sin(t) * 1.01, hi - (hi - lo) * Math.pow(Math.cos(t), flat), z)); } return out; };
    for (const sgn of [-1, 1]) {
      for (const t of [0.5, 0.95, 1.4]) {
        const curve = new THREE.CatmullRomCurve3(pts(sgn * t));
        add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, t > 1.3 ? 0.07 : 0.03, 4), t > 1.3 ? dark : mat(0x2e241a)), false);
      }
    }
  }
  // The deck, bay by bay, just under the gunwale.
  for (let i = 0; i < (P.deck ?? 0); i++) {
    const z = bayZ(i), w = Math.min(halfB(z - bayLen / 2), halfB(z + bayLen / 2)) * 1.9;
    add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, 0.1, bayLen), 'planks', true), planks)).position.set(0, D - 0.25, z);
  }
  // Castles: the sterncastle (and the forecastle): a raised deck on posts with a rail.
  const castle = (z: number, len: number, high: number) => {
    const w = halfB(z) * 1.9 + 0.2, y = rim(z);
    add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, high, len), 'planks'), planks)).position.set(0, y + high / 2 - 0.2, z);
    add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(w + 0.2, 0.12, len + 0.2), 'dark_planks', true), dark)).position.set(0, y + high - 0.15, z);
    for (const sx of [-1, 1]) add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.1, 0.7, len), 'dark_planks'), dark)).position.set(sx * w / 2, y + high + 0.2, z);
  };
  if (d.castles === 3) {
    // Great castles: a towering sterncastle in two storeys, and a high forecastle jutting out over the stem.
    if ((P.castles ?? 0) >= 1) { castle(-L / 2 + L * 0.15, L * 0.28, 2.6); castle(-L / 2 + L * 0.1, L * 0.16, 4.8); }
    if ((P.castles ?? 0) >= 2) castle(L / 2 - L * 0.06, L * 0.2, 3.0);
  } else {
    if ((P.castles ?? 0) >= 1) castle(-L / 2 + L * 0.13, L * 0.22, 1.8);
    if ((P.castles ?? 0) >= 2) castle(L / 2 - L * 0.1, L * 0.16, 1.4);
  }
  // Oars: a pair to every two metres of each bay benched, run out through the ports and down to the water.
  for (let i = 0; i < (P.oars ?? 0); i++) {
    for (const f of [-0.25, 0.25]) {
      const z = bayZ(i) + f * bayLen, w = halfB(z), y = rim(z) - 0.15;
      for (const sx of [-1, 1]) {
        const from = new THREE.Vector3(sx * (w - 0.6), y + 0.35, z), to = new THREE.Vector3(sx * (w + 3.4), -0.1 + D * 0.45, z + 0.4);
        const len = from.distanceTo(to), mid = from.clone().add(to).multiplyScalar(0.5);
        const oar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 5), wood), false);
        oar.position.copy(mid);
        oar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.18), wood), false);
        blade.position.copy(to);
        blade.quaternion.copy(oar.quaternion);
      }
    }
  }
  // A bowsprit on the southern, carvel-built ships with castles (it carries the forestays, and a carrack's spritsail in time).
  if (P.masts && d.build === 'carvel' && d.castles) {
    const sprit = add(new THREE.Mesh(cylinderUV(new THREE.CylinderGeometry(0.1, 0.14, L * 0.3, 7), 'rough_wood'), wood), false);
    sprit.position.set(0, rim(L / 2) + L * 0.05, L / 2 + L * 0.08);
    sprit.rotation.x = Math.PI / 2 - 0.35;
  }
  // Masts: the main just forward of amidships, a mizzen aft, and a foremast toward the bow; and their sails.
  const mastAt = (k: number) => (k === 0 ? (d.masts >= 2 ? L * (d.masts === 3 ? 0.03 : 0.08) : 0) : k === 1 ? -L * 0.27 : L * 0.3);
  const mastH = (k: number) => (k === 0 ? L * (d.masts === 3 ? 0.8 : 0.85) : k === 1 ? L * 0.55 : L * 0.62);
  for (let k = 0; k < P.masts; k++) {
    const h = mastH(k), z = mastAt(k);
    add(new THREE.Mesh(cylinderUV(new THREE.CylinderGeometry(0.12, 0.2, h, 8), 'rough_wood'), wood)).position.set(0, h / 2 + 0.2, z);
    // Shrouds down to the gunwales.
    for (const sx of [-1, 1]) {
      const from = new THREE.Vector3(0, h * 0.92, z), to = new THREE.Vector3(sx * halfB(z), rim(z), z - 0.5);
      const len = from.distanceTo(to), mid = from.clone().add(to).multiplyScalar(0.5);
      const line = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 3), mat(0x3a3020)), false);
      line.position.copy(mid);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    }
  }
  // Undyed wool canvas: pale and warm, a little lit from within so it doesn't go grey in its own shade.
  const sailMat = mat(0xf2e6cc, { side: THREE.DoubleSide, roughness: 1, emissive: 0x3a3226 });
  // Each sail (with its yard) turns on its mast, braced round to the wind as she sails (see syncCarts), and a square sail is reefed up to its yard as you shorten sail.
  const sails: { pivot: THREE.Group; rig: 'square' | 'lateen'; cloth: THREE.Object3D }[] = [];
  g.userData.sails = sails;
  for (let k = 0; k < (P.sails ?? 0); k++) {
    const h = mastH(k), z = mastAt(k), pivot = new THREE.Group();
    pivot.position.set(0, 0, z);
    g.add(pivot);
    const hang = (m: THREE.Mesh) => { pivot.add(m); m.position.z -= z; return m; };
    if (mastRig(d, k) === 'square') {
      const w = B * (k === 0 ? 1.7 : 1.3), sh = h * 0.5;
      hang(add(new THREE.Mesh(cylinderUV(new THREE.CylinderGeometry(0.07, 0.07, w + 0.6, 6), 'rough_wood').rotateZ(Math.PI / 2), wood))).position.set(0, h * 0.86, 0.25);
      // The sail, bellied a little, hung from its yard (so it reefs up toward it).
      const sail = new THREE.PlaneGeometry(w, sh, 6, 4), p = sail.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (w / 2), v = p.getY(i) / (sh / 2); p.setZ(i, (1 - u * u) * (1 - v * v * 0.6) * 0.5); }
      sail.translate(0, -sh / 2, 0);
      sail.computeVertexNormals();
      const cloth = hang(add(new THREE.Mesh(sail, sailMat)));
      cloth.position.set(0, h * 0.86, 0.35);
      sails.push({ pivot, rig: 'square', cloth });
    } else {
      // A lateen: a long yard slung slanting from the masthead, a triangle of sail under it.
      const yl = L * (k === 0 ? 0.55 : 0.4);
      const yard = add(new THREE.Mesh(cylinderUV(new THREE.CylinderGeometry(0.06, 0.06, yl, 6), 'rough_wood').rotateX(Math.PI / 2), wood), false);
      hang(yard).position.set(0.25, h * 0.75, 0);
      yard.rotation.x = 0.55;
      const a = new THREE.Vector3(0.3, h * 0.75 + Math.sin(0.55) * yl / 2, Math.cos(0.55) * yl / 2), b2 = new THREE.Vector3(0.3, h * 0.75 - Math.sin(0.55) * yl / 2, -Math.cos(0.55) * yl / 2), c = new THREE.Vector3(0.3, rim(z) + 0.8, -yl * 0.15);
      const tri = new THREE.BufferGeometry().setFromPoints([a, b2, c]);
      tri.computeVertexNormals();
      const cloth = add(new THREE.Mesh(tri, sailMat));
      pivot.add(cloth);
      sails.push({ pivot, rig: 'lateen', cloth });
    }
  }
  if (P.rudder) {
    if (d.type === 'Longship' || d.type === 'Knarr') {
      // A steering oar on the starboard quarter.
      const oar = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.12, D + 0.8, 0.5), 'dark_planks'), dark));
      oar.position.set(-halfB(-L / 2 + 2) - 0.15, D * 0.4, -L / 2 + 2);
    } else {
      // A rudder hung on the sternpost, its tiller over the stern.
      add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.14, D + 0.4, 0.9), 'dark_planks'), dark)).position.set(0, (D + 0.4) / 2, -L / 2 - 0.35);
    }
  }
  // Steps (up out of the hold, up to the castles) and, on the slip, the staging round her: a walkway down
  // each side on posts, a handrail, planks across to her side, and a flight up to it at her stern.
  for (const b of shipSolids(d, done, onSlip)) {
    if (b.kind === 'rail') {
      // A rail on stanchions: along her gunwale, round the staging.
      const [cx, cy, cz] = b.c, [hx, hy, hz] = b.h;
      add(new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.07, hx * 2), 0.08, Math.max(0.07, hz * 2)), dark), false).position.set(cx, cy + hy - 0.04, cz);
      const n = Math.max(1, Math.round(Math.max(hx, hz) * 2 / 1.2));
      for (let k = 0; k <= n; k++) {
        const t = -1 + (2 * k) / n;
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, hy * 2, 5), wood), false).position.set(cx + (hx > hz ? t * hx : 0), cy, cz + (hz >= hx ? t * hz : 0));
      }
      continue;
    }
    if (b.kind !== 'step' && b.kind !== 'staging') continue;
    const [cx, cy, cz] = b.c, [hx, hy, hz] = b.h;
    const outside = Math.abs(cx) > B / 2 + 0.2;
    if (b.kind === 'step' && outside) {
      // A scaffold flight: a tread and a post under its outer edge.
      add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(hx * 2, 0.06, hz * 2), 'planks', true), planks)).position.set(cx, cy + hy - 0.03, cz);
      for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, hy * 2, 5), wood), false).position.set(cx + sx * (hx - 0.05), cy, cz);
    } else if (b.kind === 'step') {
      add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), 'dark_planks'), dark)).position.set(cx, cy, cz);
    } else {
      add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), 'planks', true), planks)).position.set(cx, cy, cz);
      if (hz > 2) {
        // Posts down to the slip and the shore below, every 2.5 m, both edges.
        for (const sx of [-1, 1]) for (let z = cz - hz + 0.2; z <= cz + hz; z += 2.5) add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, cy + 3.5, 6), wood), false).position.set(cx + sx * (hx - 0.06), (cy - 3.5) / 2, z);
      }
    }
  }
  if (loaded && P.planking === d.bays && !d.decked) {
    for (let i = 0; i < 3; i++) add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.8, 0.6, 0.8), 'dark_planks'), dark)).position.set((i - 1) * 0.9, bottom(0) + 0.6, 1.2 - (i % 2) * 1.0);
  }
  g.userData.wheels = [];
  g.userData.r = 1;
  g.userData.loaded = loaded;
  return g;
}

/** A slipway: two long ways on sleepers, running down into the water on piles. */
function slipwayModel(tex: (geo: THREE.BufferGeometry, s: Surface, x?: number, y?: number, z?: number, o?: { turn?: boolean; tint?: number }) => THREE.Mesh, great = false) {
  // Its length (from 6 m behind its origin), the ways' spread.
  const len = great ? 36 : 28, mid = len / 2 - 6, w = great ? 1.8 : 1.4, end = len - 6.5;
  for (const x of [-w, w]) tex(new THREE.BoxGeometry(great ? 0.6 : 0.5, great ? 0.5 : 0.4, len), 'rough_wood', x, great ? 0.25 : 0.2, mid);
  // Sleepers across, close-laid and planked over between the ways: a deck to walk out on.
  for (let z = -5.5; z <= end; z += 1.5) tex(new THREE.BoxGeometry(w * 2 + 1.8, 0.18, 0.3), 'dark_planks', 0, -0.05, z, { turn: true });
  for (const x of [-w - 0.6, -w * 0.45, w * 0.45, w + 0.6]) tex(new THREE.BoxGeometry(w * 0.55 + 0.1, 0.06, len - 0.4), 'planks', x, great ? 0.47 : 0.37, mid);
  // Footings of dressed stone under the great slip's landward half.
  if (great) for (let z = -5; z <= mid; z += 4) for (const x of [-w, w]) tex(new THREE.BoxGeometry(0.9, 1.2, 0.9), 'stone_wall', x, -0.7, z);
  // Piles under its seaward half, down into the water.
  for (let z = mid; z <= end; z += 3) for (const x of [-w - 0.7, w + 0.7]) tex(new THREE.CylinderGeometry(0.15, 0.17, 6, 7), 'rough_wood', x, -3, z);
  // A rail across its seaward end, on posts.
  tex(new THREE.BoxGeometry(w * 2 + 1.8, 0.1, 0.1), 'rough_wood', 0, great ? 1.45 : 1.35, end + 0.4, { turn: true });
  for (let x = -w - 0.9; x <= w + 0.91; x += (w * 2 + 1.8) / 4) tex(new THREE.CylinderGeometry(0.06, 0.07, 1.0, 6), 'rough_wood', x, great ? 0.95 : 0.85, end + 0.4);
  // A bollard at the head of the slip (two for the great one).
  for (const x of great ? [-1.2, 1.2] : [0]) tex(new THREE.CylinderGeometry(0.22, 0.25, 0.9, 8), 'rough_wood', x, 0.45, -6.4);
}

/** A vessel's model, in its own frame (its bow, or the way it rolls, along +z; its keel at y = 0). */
export function vesselModel(type: VesselId, loaded: boolean, ship?: ShipBuild): THREE.Group {
  switch (type) {
    case 'ship': return shipModel(ship!.design, ship!.done, ship!.slipY !== undefined && !ship!.launching, loaded);
    case 'dugout': return hullModel({ L: 2.4, B: 0.45, D: 0.42, rim: 0.5, outer: 'rough_wood', inner: 0x3a2a1e, thwarts: [-1.1, 0.9], gunwale: 0.06, waterline: 0.22 }, loaded);
    case 'reed_boat': return reedBoatModel(loaded);
    case 'coracle': return hullModel({ L: 0.68, B: 0.68, D: 0.36, rim: 0.4, outerColor: 0x5a3e28, inner: 0x6e5a3a, thwarts: [0], gunwale: 0.03, ribs: 6, waterline: 0.1 }, loaded);
    case 'skin_boat': return hullModel({ L: 2.6, B: 0.58, D: 0.45, rim: 0.55, outerColor: 0x6b4a30, inner: 0x7a5a3a, thwarts: [-1.4, 0, 1.4], gunwale: 0.04, ribs: 9, upsweep: 0.25, waterline: 0.16 }, loaded);
    case 'rowboat': return rowboatModel(loaded);
    case 'log_raft': return raftModel(loaded);
    default: return cartModel(type, loaded);
  }
}

/**
 * A small boat's hull: half an ellipsoid (pointed or round), its inside a
 * darker colour, a gunwale round the rim, thwarts across to sit on; frames
 * showing inside a skin boat or a coracle's wicker, a planked boat's strakes,
 * the ends swept up a little; and a bundle of goods if it's loaded.
 */
function hullModel(o: { L: number; B: number; D: number; rim: number; outer?: Surface; outerColor?: number; inner: number; thwarts: number[]; gunwale: number; ribs?: number; upsweep?: number; strakes?: number[]; waterline?: number }, loaded: boolean): THREE.Group {
  const g = new THREE.Group();
  const { L, B, D, rim } = o;
  // The water kept out of it (an ellipsoid's half-breadth at that height).
  if (o.waterline !== undefined) {
    const f = Math.max(0, Math.min(1, (rim - o.waterline - 0.03) / D));
    const r = Math.sqrt(Math.max(0, 1 - f * f));
    waterCap(g, o.waterline + 0.03, 2 * L * r, (z) => B * r * Math.sqrt(Math.max(0, 1 - (z / (L * r)) ** 2)));
  }
  const half = (r: number) => new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(B * r, D * r, L * r);
  const outerMat = o.outer ? surfaceMat(o.outer) : mat(o.outerColor ?? 0x6b4a30, { roughness: 0.95 });
  const hull = new THREE.Mesh(o.outer ? worldUV(half(1), o.outer) : half(1), outerMat);
  hull.position.y = rim; hull.castShadow = true; hull.receiveShadow = true;
  g.add(hull);
  const inner = new THREE.Mesh(half(0.9), mat(o.inner, { side: THREE.BackSide, roughness: 1 }));
  inner.position.y = rim + 0.01;
  g.add(inner);
  const wood = surfaceMat('rough_wood');
  const gun = new THREE.Mesh(new THREE.TorusGeometry(1, o.gunwale, 5, 32).rotateX(Math.PI / 2).scale(B * 0.95, 1, L * 0.95), wood);
  gun.position.y = rim;
  gun.castShadow = true;
  g.add(gun);
  // Lines of planking (a planked boat's strakes), round the outside at the given fractions of the depth.
  for (const f of o.strakes ?? []) {
    const r = Math.sqrt(1 - f * f);
    const line = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 3, 40).rotateX(Math.PI / 2).scale(B * r * 1.005, 1, L * r * 1.005), mat(0x2e241a));
    line.position.y = rim - D * f;
    g.add(line);
  }
  // Frames (ribs) across the inside, from gunwale to gunwale under the keel.
  if (o.ribs) {
    for (let i = 0; i < o.ribs; i++) {
      const z = ((i + 0.5) / o.ribs * 2 - 1) * L * 0.8, w = Math.sqrt(Math.max(0, 1 - (z / L) ** 2));
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1, 0.018, 4, 16, Math.PI).rotateZ(Math.PI).scale(B * w * 0.88, D * w * 0.88, 1), wood);
      rib.position.set(0, rim, z);
      g.add(rib);
    }
  }
  // Bow and stern swept up a little, as posts rising from the ends.
  if (o.upsweep) {
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, o.upsweep * 2, 6), wood);
      post.position.set(0, rim + o.upsweep * 0.5, s * L * 0.97);
      post.rotation.x = s * 0.5;
      g.add(post);
    }
  }
  for (const z of o.thwarts) {
    const w = Math.sqrt(Math.max(0.05, 1 - (z / L) ** 2));
    const th = new THREE.Mesh(worldUV(new THREE.BoxGeometry(B * 1.7 * w, 0.05, 0.2), 'rough_wood'), wood);
    th.position.set(0, rim - 0.1, z);
    g.add(th);
  }
  if (loaded) {
    const load = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(Math.min(0.6, B * 1.2), 0.5, Math.min(1.0, L * 0.6)), mat(0x7a5a3a, { roughness: 1 }));
    load.position.set(0, rim - D * 0.5, o.thwarts.length > 1 ? (o.thwarts[0] + o.thwarts[1]) / 2 : 0);
    load.castShadow = true;
    g.add(load);
  }
  g.userData.wheels = [];
  g.userData.r = 1;
  g.userData.loaded = loaded;
  return g;
}

/** A reed boat: a hull of bundled reeds, bound round at intervals, its ends drawn up into tight horns. */
function reedBoatModel(loaded: boolean): THREE.Group {
  const g = hullModel({ L: 1.9, B: 0.5, D: 0.38, rim: 0.45, outer: 'thatch', inner: 0x8a7440, thwarts: [-0.6], gunwale: 0.07, waterline: 0.12 }, loaded);
  const band = mat(0x5a4a2a, { roughness: 1 });
  for (const z of [-1.3, -0.65, 0, 0.65, 1.3]) {
    const w = Math.sqrt(1 - (z / 1.9) ** 2);
    const b = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 4, 16, Math.PI).rotateZ(Math.PI).scale(0.5 * w * 1.02, 0.38 * w * 1.02, 1), band);
    b.position.set(0, 0.45, z);
    g.add(b);
  }
  const reed = surfaceMat('thatch');
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(worldUV(new THREE.ConeGeometry(0.12, 0.7, 7), 'thatch'), reed);
    horn.position.set(0, 0.62, s * 1.9);
    horn.rotation.x = s * 0.9;
    g.add(horn);
  }
  return g;
}

/** A rowing boat: a planked hull (its strakes showing), three thwarts, oarlocks, and the oars shipped inside. */
function rowboatModel(loaded: boolean): THREE.Group {
  const g = hullModel({ L: 2.3, B: 0.72, D: 0.5, rim: 0.62, outer: 'planks', inner: 0x5a4430, thwarts: [0, -1.3, 1.3], gunwale: 0.05, ribs: 7, strakes: [0.25, 0.5, 0.72], upsweep: 0.12, waterline: 0.3 }, loaded);
  const wood = surfaceMat('rough_wood');
  for (const s of [-1, 1]) {
    const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 5), wood);
    lock.position.set(s * 0.7, 0.69, 0.1);
    g.add(lock);
    // An oar lying along the thwarts, its blade forward.
    const oar = new THREE.Group();
    oar.position.set(s * 0.32, 0.6, 0.2);
    oar.rotation.x = 0.04;
    const loom = new THREE.Mesh(cylinderUV(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 6), 'rough_wood').rotateX(Math.PI / 2), wood);
    const blade = new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.16, 0.02, 0.55), 'planks'), surfaceMat('planks'));
    blade.position.z = 1.5;
    oar.add(loom, blade);
    g.add(oar);
  }
  return g;
}

/** A log raft: logs side by side, two cross-pieces lashed over them, and a low load lashed on top if it's carrying. */
function raftModel(loaded: boolean): THREE.Group {
  const g = new THREE.Group();
  const wood = surfaceMat('rough_wood');
  const n = 6, r = 0.2;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (2 * r + 0.03), len = 3.2 - (i % 2) * 0.25;
    const log = new THREE.Mesh(cylinderUV(new THREE.CylinderGeometry(r, r * 0.92, len, 9), 'rough_wood').rotateX(Math.PI / 2), wood);
    log.position.set(x, r, (i % 3 - 1) * 0.06);
    log.castShadow = true; log.receiveShadow = true;
    g.add(log);
  }
  const rope = mat(0x8a7450, { roughness: 1 });
  for (const z of [-1.1, 1.1]) {
    const bar = new THREE.Mesh(cylinderUV(new THREE.CylinderGeometry(0.09, 0.09, 2.7, 7), 'rough_wood').rotateZ(Math.PI / 2), wood);
    bar.position.set(0, 2 * r + 0.06, z);
    g.add(bar);
    for (let i = 0; i < n; i++) {
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 4, 8), rope);
      tie.position.set((i - (n - 1) / 2) * (2 * r + 0.03), 2 * r + 0.03, z);
      g.add(tie);
    }
  }
  if (loaded) {
    const load = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 1.0), mat(0x7a5a3a, { roughness: 1 }));
    load.position.set(0, 2 * r + 0.3, 0.3);
    load.castShadow = true;
    g.add(load);
  }
  g.userData.wheels = [];
  g.userData.r = 1;
  g.userData.loaded = loaded;
  return g;
}

/**
 * A cart, in its own frame: it rolls along +z. A hand cart's handles reach
 * back (−z) to you; an ox cart's shafts reach forward (+z) to the ox.
 */
export function cartModel(type: VesselId, loaded: boolean): THREE.Group {
  const g = new THREE.Group();
  const ox = type === 'ox_cart';
  const k = ox ? 1.6 : 1;
  const wood = (geo: THREE.BufferGeometry, s: Surface, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(worldUV(geo, s), surfaceMat(s));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const r = ox ? 0.55 : 0.32;
  const bedY = r + 0.12 * k;
  // The bed: a floor of planks with low sides.
  wood(new THREE.BoxGeometry(0.9 * k, 0.07, 1.25 * k), 'dark_planks', 0, bedY, 0);
  for (const s of [-1, 1]) {
    wood(new THREE.BoxGeometry(0.05, 0.28 * k, 1.25 * k), 'dark_planks', s * 0.45 * k, bedY + 0.16 * k, 0);
    wood(new THREE.BoxGeometry(0.9 * k, 0.28 * k, 0.05), 'dark_planks', 0, bedY + 0.16 * k, s * 0.62 * k);
  }
  // An axle under the middle, and a wheel each side (solid for the ox cart, spoked for the hand cart).
  wood(new THREE.CylinderGeometry(0.04, 0.04, 1.05 * k, 6).rotateZ(Math.PI / 2), 'rough_wood', 0, r, 0);
  const wheels: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * (0.5 * k + 0.05), r, 0);
    g.add(w);
    const disc = new THREE.Mesh(worldUV(new THREE.CylinderGeometry(r, r, 0.07, ox ? 14 : 10).rotateZ(Math.PI / 2), 'rough_wood'), surfaceMat('rough_wood'));
    disc.castShadow = true;
    w.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 5, 16).rotateY(Math.PI / 2), mat(0x3a3a3c, { metalness: 0.4 }));
    w.add(rim);
    if (!ox) for (let i = 0; i < 3; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.09, r * 1.9, 0.04), mat(0x4e3a24)); sp.rotation.x = (i / 3) * Math.PI; w.add(sp); }
    wheels.push(w);
  }
  // Handles back to you, or shafts forward to the ox.
  for (const s of [-1, 1]) {
    const len = ox ? 2.1 : 1.0;
    const bar = wood(new THREE.CylinderGeometry(0.035, 0.04, len, 6).rotateX(Math.PI / 2), 'rough_wood', s * (ox ? 0.42 : 0.3), bedY + (ox ? 0.15 : 0.05), (ox ? 1 : -1) * (0.62 * k + len / 2 - 0.1));
    bar.rotation.x = ox ? -0.08 : 0.32;
  }
  if (loaded) {
    // A load under a hide cover.
    const load = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.82 * k, 0.55 * k, 1.15 * k), mat(0x7a5a3a, { roughness: 1 }));
    load.position.y = bedY + 0.04;
    load.castShadow = true;
    g.add(load);
  }
  g.userData.wheels = wheels;
  g.userData.r = r;
  g.userData.loaded = loaded;
  return g;
}

/** Ox coats: dun, dark brown, black, a pale cream. */
const OX_COATS = [0x8a6a4a, 0x4e3a2a, 0x2a2420, 0xcabca0];

/** An ox: a deep, heavy body on short stout legs, a big head carried low, wide horns; tamed, a wooden yoke. */
function oxModel(seed: number, tamed: boolean): THREE.Group {
  const g = new THREE.Group();
  const coat = OX_COATS[Math.abs(seed) % OX_COATS.length];
  const part = (geo: THREE.BufferGeometry, c: number, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat(c));
    m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz; m.castShadow = true; g.add(m); return m;
  };
  part(new THREE.BoxGeometry(0.85, 0.9, 1.75), coat, 0, 1.15, 0);
  part(new THREE.SphereGeometry(0.5, 10, 8).scale(0.9, 1, 0.8), coat, 0, 1.2, 0.72); // shoulders
  part(new THREE.BoxGeometry(0.6, 0.35, 0.5), coat, 0, 1.68, 0.55); // the hump over the shoulders
  part(new THREE.BoxGeometry(0.42, 0.45, 0.55), coat, 0, 1.15, 1.2, 0.35); // the head, held low
  part(new THREE.BoxGeometry(0.32, 0.26, 0.2), 0x2a201a, 0, 0.98, 1.47, 0.35); // muzzle
  for (const s of [-1, 1]) {
    part(new THREE.CylinderGeometry(0.035, 0.06, 0.42, 6), 0xe8e0c8, s * 0.32, 1.42, 1.15, 0, s * -1.15); // horns sweep out...
    part(new THREE.ConeGeometry(0.035, 0.2, 6), 0xe8e0c8, s * 0.5, 1.55, 1.15, 0, s * -0.3); // ...and up
  }
  part(new THREE.BoxGeometry(0.08, 0.8, 0.08).translate(0, -0.4, 0), coat, 0, 1.45, -0.88, -0.15); // tail
  part(new THREE.SphereGeometry(0.09, 6, 5), 0x2a201a, 0, 0.66, -0.98); // tail tuft
  const legH = 0.72;
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [[-0.27, 0.62], [0.27, 0.62], [-0.27, -0.62], [0.27, -0.62]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, legH, 0.2).translate(0, -legH / 2, 0), mat(coat));
    leg.position.set(x, legH, z);
    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.24), mat(0x1c1612));
    hoof.position.y = -legH + 0.05;
    leg.add(hoof);
    legs.push(leg);
    g.add(leg);
  }
  if (tamed) {
    // A wooden yoke across the neck, and a rope halter: this one's yours.
    part(new THREE.BoxGeometry(1.25, 0.12, 0.14), 0x6e4e30, 0, 1.6, 0.92);
    for (const s of [-1, 1]) part(new THREE.TorusGeometry(0.2, 0.025, 5, 12), 0x5a4026, s * 0.22, 1.42, 0.92, 0, Math.PI / 2);
    part(new THREE.TorusGeometry(0.2, 0.02, 5, 12), 0xc8a96e, 0, 1.12, 1.32, 0.35);
  }
  g.userData.legs = legs;
  g.userData.tamed = tamed;
  return g;
}

/** A deer or a boar, part by part (merged by animalModel). */
/** A sheep: a round fleece on short dark legs, a dark face. */
function sheepModel(): THREE.Group {
  const g = new THREE.Group();
  const fleece = mat(0xe4ddcc, { flatShading: true }), dark = mat(0x2e2824);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1).scale(0.85, 0.75, 1.25), fleece);
  body.position.y = 0.72;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.36), dark);
  head.position.set(0, 0.88, 0.68);
  head.rotation.x = 0.35;
  g.add(head);
  const poll = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), fleece);
  poll.position.set(0, 1.0, 0.56);
  g.add(poll);
  for (const x of [-0.15, 0.15]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.08), dark);
    ear.position.set(x * 1.3, 0.95, 0.62);
    g.add(ear);
  }
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [[-0.18, 0.38], [0.18, 0.38], [-0.18, -0.38], [0.18, -0.38]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.09).translate(0, -0.21, 0), dark);
    leg.position.set(x, 0.42, z);
    legs.push(leg);
    g.add(leg);
  }
  g.userData.legs = legs;
  return g;
}

function partsModel(species: 'deer' | 'boar'): THREE.Group {
  const g = new THREE.Group();
  const boar = species === 'boar';
  const c = boar ? 0x4a3a30 : 0x8a5a34;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, boar ? 0.6 : 0.55, boar ? 1.2 : 1.3), mat(c));
  body.position.y = boar ? 0.65 : 1.0;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.5), mat(c));
  head.position.set(0, boar ? 0.65 : 1.45, boar ? 0.8 : 0.8);
  head.castShadow = true;
  g.add(head);
  if (boar) {
    for (const x of [-0.12, 0.12]) {
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), mat(0xeeeedd));
      tusk.position.set(x, 0.55, 1.05);
      tusk.rotation.x = -1.2;
      g.add(tusk);
    }
  } else {
    for (const x of [-0.12, 0.12]) {
      const antler = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.45, 4), mat(0xd8c8a8));
      antler.position.set(x, 1.82, 0.7);
      antler.rotation.z = x * 3;
      g.add(antler);
    }
  }
  const legH = boar ? 0.4 : 0.75;
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [[-0.18, 0.45], [0.18, 0.45], [-0.18, -0.45], [0.18, -0.45]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, legH, 0.12).translate(0, -legH / 2, 0), mat(c));
    leg.position.set(x, legH + (boar ? 0.05 : 0), z);
    leg.castShadow = true;
    legs.push(leg);
    g.add(leg);
  }
  g.userData.legs = legs;
  return g;
}

function animateLegs(m: THREE.Group, a: AnimalObj, time: number) {
  const legs = m.userData.legs as THREE.Mesh[];
  const sw = a.speed > 0.1 ? Math.sin(time * a.speed * 3) * 0.6 : 0;
  legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? sw : -sw); });
}

const WOOD = 0x8a6440, DARK_WOOD = 0x6e4e30;

/**
 * Whether a built piece is drawn merged with its neighbours (see View.flushBatches):
 * anything that never moves or changes look (walls, roofs, furniture, stalls,
 * workbenches...), but not doors and gates (they swing), fires (flames), troughs
 * (water), nor the few pieces made from vertex-coloured models.
 */
const UNBATCHED = new Set(['campfire', 'forge', 'iron_anvil', 'quench_trough', 'standing_torch', 'wall_torch']);
function batchedType(type: string): boolean {
  const d = STRUCTURES[type];
  return !!d && !UNBATCHED.has(type) && !d.opens && !d.burns && !d.glow && d.water === undefined;
}

/**
 * Meshes for a building piece in its local frame (origin at bottom centre).
 * Shared by placed pieces and the placement ghost.
 */
/** Props made from models (see scripts/bake-props.mjs), each geometry made once and shared. */
const PROP_MODELS: Record<string, { positions: number[]; indices: number[]; colors: number[] }> = { campfire: CAMPFIRE, iron_anvil: IRON_ANVIL, wood_bucket: WOOD_BUCKET };
const propGeos = new Map<string, THREE.BufferGeometry>();
const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
function propMesh(name: string): THREE.Mesh {
  let geo = propGeos.get(name);
  if (!geo) {
    const m = PROP_MODELS[name];
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(m.colors, 3));
    geo.setIndex(m.indices);
    geo.computeVertexNormals();
    geo.userData.shared = true;
    propGeos.set(name, geo);
  }
  const mesh = new THREE.Mesh(geo, propMat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export function buildPieceMesh(type: string, state: { lit?: boolean; open?: boolean; water?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, extra?: THREE.MeshStandardMaterialParameters, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat(color, extra));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** A piece in a photographed surface; `turn` runs its grain the other way. */
  const tex = (geo: THREE.BufferGeometry, surface: Surface, x = 0, y = 0, z = 0, opts: { turn?: boolean; tint?: number; parent?: THREE.Object3D } = {}) => {
    if (geo instanceof THREE.CylinderGeometry) cylinderUV(geo, surface);
    else worldUV(geo, surface, opts.turn);
    const m = new THREE.Mesh(geo, surfaceMat(surface, opts.tint));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    (opts.parent ?? g).add(m);
    return m;
  };
  switch (type) {
    case 'floor':
      tex(new THREE.BoxGeometry(2, 0.2, 2), 'dark_planks', 0, 0.1, 0, { turn: true });
      break;
    case 'stone_foundation':
      tex(new THREE.BoxGeometry(2, 1, 2), 'foundation', 0, 0.5, 0);
      tex(new THREE.BoxGeometry(2.04, 0.08, 2.04), 'stone', 0, 0.97, 0, { tint: 0xd8d4cc });
      break;
    case 'wood_wall':
      // Boards on a frame: a post at each end, a rail top and bottom.
      tex(new THREE.BoxGeometry(1.9, 1.9, 0.12), 'dark_planks', 0, 1, 0);
      for (const x of [-0.95, 0.95]) tex(new THREE.BoxGeometry(0.1, 2, 0.18), 'rough_wood', x, 1, 0);
      for (const y of [0.06, 1.94]) tex(new THREE.BoxGeometry(1.9, 0.12, 0.18), 'rough_wood', 0, y, 0, { turn: true });
      break;
    case 'log_wall':
      // The wall's face, and the log ends jutting out past each corner.
      tex(new THREE.BoxGeometry(2, 1.97, 0.3), 'log_wall', 0, 0.985, 0);
      for (let i = 0; i < 6; i++) {
        const l = tex(new THREE.CylinderGeometry(0.16, 0.16, 2.24, 10), 'rough_wood', 0, 0.18 + i * 0.328, 0);
        l.rotation.z = Math.PI / 2;
      }
      break;
    case 'stone_wall':
      tex(new THREE.BoxGeometry(2, 1.9, 0.4), 'stone_wall', 0, 0.95, 0);
      tex(new THREE.BoxGeometry(2.04, 0.12, 0.44), 'stone', 0, 1.94, 0, { tint: 0xd8d4cc });
      break;
    case 'window_wall': {
      // Planks around the opening, a frame round it and a cross of bars.
      for (const [w, h, x, y] of [[2, 0.9, 0, 0.45], [2, 0.4, 0, 1.8], [0.55, 0.7, -0.725, 1.25], [0.55, 0.7, 0.725, 1.25]]) tex(new THREE.BoxGeometry(w, h, 0.16), 'dark_planks', x, y, 0);
      for (const [w, h, x, y, turn] of [[1.02, 0.08, 0, 0.94, true], [1.02, 0.08, 0, 1.56, true], [0.08, 0.7, -0.47, 1.25, false], [0.08, 0.7, 0.47, 1.25, false]] as [number, number, number, number, boolean][]) {
        tex(new THREE.BoxGeometry(w, h, 0.2), 'rough_wood', x, y, 0, { turn });
      }
      tex(new THREE.BoxGeometry(0.05, 0.62, 0.06), 'rough_wood', 0, 1.25, 0);
      tex(new THREE.BoxGeometry(0.9, 0.05, 0.06), 'rough_wood', 0, 1.25, 0, { turn: true });
      break;
    }
    case 'gable': {
      // A plank triangle, its slope under the roof's.
      const tri = new THREE.Shape([new THREE.Vector2(-1, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 2)]);
      const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06);
      tex(geo, 'dark_planks', 0, 0, 0);
      tex(new THREE.BoxGeometry(2, 0.1, 0.16), 'rough_wood', 0, 0.05, 0, { turn: true });
      break;
    }
    case 'beam':
      tex(new THREE.BoxGeometry(0.2, 2, 0.2), 'rough_wood', 0, 1, 0);
      break;
    case 'roof': {
      // A 45° slab rising toward +z, with thatch on top.
      const len = Math.SQRT2 * 2;
      const deck = tex(new THREE.BoxGeometry(2, 0.08, len), 'dark_planks', 0, 1, 0);
      deck.rotation.x = -Math.PI / 4;
      const thatch = tex(new THREE.BoxGeometry(2.1, 0.16, len + 0.1), 'thatch', 0, 1.08, -0.08);
      thatch.rotation.x = -Math.PI / 4;
      break;
    }
    case 'stairs':
      for (let k = 0; k < 8; k++) tex(new THREE.BoxGeometry(1.9, 0.08, 0.27), 'dark_planks', 0, (k + 1) * 0.25 - 0.04, -1 + (k + 0.5) * 0.25);
      for (const x of [-0.97, 0.97]) {
        const s = tex(new THREE.BoxGeometry(0.08, 0.25, Math.SQRT2 * 2), 'rough_wood', x, 1, 0, { turn: true });
        s.rotation.x = -Math.PI / 4;
      }
      break;
    case 'door': {
      tex(new THREE.BoxGeometry(0.5, 2, 0.2), 'rough_wood', -0.75, 1, 0);
      tex(new THREE.BoxGeometry(0.5, 2, 0.2), 'rough_wood', 0.75, 1, 0);
      const hinge = new THREE.Group();
      hinge.position.set(-0.5, 0, 0);
      tex(new THREE.BoxGeometry(1, 1.95, 0.08), 'dark_planks', 0.5, 0.98, 0, { turn: true, parent: hinge });
      tex(new THREE.BoxGeometry(0.9, 0.1, 0.1), 'rough_wood', 0.5, 1.5, 0.05, { turn: true, parent: hinge });
      tex(new THREE.BoxGeometry(0.9, 0.1, 0.1), 'rough_wood', 0.5, 0.5, 0.05, { turn: true, parent: hinge });
      if (state.open) hinge.rotation.y = -Math.PI / 2;
      g.add(hinge);
      break;
    }
    case 'fence':
    case 'gate': {
      tex(new THREE.BoxGeometry(0.12, 1.3, 0.12), 'rough_wood', -1, 0.65, 0);
      tex(new THREE.BoxGeometry(0.12, 1.3, 0.12), 'rough_wood', 1, 0.65, 0);
      const rails = new THREE.Group();
      rails.position.x = -1;
      for (const y of [0.45, 0.9]) tex(new THREE.BoxGeometry(1.9, 0.12, 0.05), 'rough_wood', 1, y, 0, { turn: true, parent: rails });
      if (type === 'gate') {
        const brace = tex(new THREE.BoxGeometry(2.05, 0.08, 0.04), 'rough_wood', 1, 0.67, 0.03, { turn: true, parent: rails });
        brace.rotation.z = 0.25;
        if (state.open) rails.rotation.y = -Math.PI / 2;
      }
      g.add(rails);
      break;
    }
    case 'standing_torch': {
      // A branch stuck upright in the ground (a ring of stones round its foot to hold it), its wrapped head burning (or charred, once spent).
      tex(new THREE.CylinderGeometry(0.022, 0.03, 1.0, 7), 'rough_wood', 0, 0.5, 0);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const st = tex(new THREE.DodecahedronGeometry(0.055 + (k % 2) * 0.015), 'stone', Math.cos(a) * 0.09, 0.03, Math.sin(a) * 0.09, { tint: 0x9a948c });
        st.scale.y = 0.7;
      }
      add(new THREE.CylinderGeometry(0.05, 0.038, 0.14, 8), state.lit ? 0x3a2a1c : 0x1c1814, 0, 1.03, 0, { roughness: 1 });
      if (state.lit) {
        const flame = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8).translate(0, 0.75, 0).scale(0.065, 0.15, 0.065),
          new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        const core = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).translate(0, 0.7, 0).scale(0.03, 0.08, 0.03),
          new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
        flame.position.y = core.position.y = 1.08;
        flame.userData.flame = core.userData.flame = true;
        flame.castShadow = core.castShadow = false;
        g.add(flame, core);
      }
      break;
    }
    case 'wall_torch': {
      // An iron plate on the wall, a ring on an arm, and the torch in it leaning out from the wall.
      add(new THREE.BoxGeometry(0.12, 0.2, 0.02), 0x2a2622, 0, -0.05, 0.01, { roughness: 0.6, metalness: 0.6 });
      add(new THREE.BoxGeometry(0.025, 0.025, 0.2), 0x2a2622, 0, -0.05, 0.11, { roughness: 0.6, metalness: 0.6 });
      const ring = add(new THREE.TorusGeometry(0.035, 0.008, 4, 10), 0x2a2622, 0, -0.03, 0.2, { roughness: 0.6, metalness: 0.6 });
      ring.rotation.x = Math.PI / 2 - 0.4;
      const stick = new THREE.Group();
      stick.position.set(0, -0.28, 0.1);
      stick.rotation.x = 0.4;
      tex(new THREE.CylinderGeometry(0.02, 0.026, 0.62, 7), 'rough_wood', 0, 0.31, 0, { parent: stick });
      add(new THREE.CylinderGeometry(0.045, 0.034, 0.12, 8), state.lit ? 0x3a2a1c : 0x1c1814, 0, 0.62, 0, { roughness: 1 }, stick);
      g.add(stick);
      if (state.lit) {
        // (Upright: flames rise whatever the torch's lean.)
        const tip = new THREE.Vector3(0, 0.66, 0).applyEuler(stick.rotation).add(stick.position);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8).translate(0, 0.75, 0).scale(0.06, 0.14, 0.06),
          new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        const core = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).translate(0, 0.7, 0).scale(0.028, 0.075, 0.028),
          new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
        flame.position.copy(tip).y -= 0.04;
        core.position.copy(flame.position);
        flame.userData.flame = core.userData.flame = true;
        flame.castShadow = core.castShadow = false;
        g.add(flame, core);
      }
      break;
    }
    case 'campfire':
    case 'forge': {
      const forge = type === 'forge';
      if (forge) {
        tex(new THREE.BoxGeometry(1.5, 0.9, 1.3), 'stone_wall', 0, 0.45, 0, { tint: 0xd0c8c0 });
        tex(new THREE.BoxGeometry(0.5, 1.2, 0.5), 'stone_wall', 0.45, 1.4, 0.3, { tint: 0xb0a698 });
        add(new THREE.BoxGeometry(0.8, 0.12, 0.7), 0x1a1a1a, 0, 0.91, 0);
      } else {
        g.add(propMesh('campfire'));
      }
      if (state.lit) {
        const flame = add(new THREE.ConeGeometry(forge ? 0.3 : 0.28, forge ? 0.5 : 0.75, 6), 0xffa030, 0, forge ? 1.1 : 0.4, 0,
          { emissive: 0xff6a00, emissiveIntensity: 2.5, transparent: true, opacity: 0.85 });
        flame.castShadow = false;
        flame.userData.flame = true;
      }
      break;
    }
    case 'anvil':
      tex(new THREE.BoxGeometry(0.6, 0.55, 0.5), 'stone', 0, 0.27, 0);
      tex(new THREE.BoxGeometry(1.0, 0.25, 0.45), 'stone', 0, 0.67, 0, { tint: 0xd8d4cc });
      break;
    case 'iron_anvil': {
      // The anvil on a stump, its face at a good height to work at.
      tex(new THREE.CylinderGeometry(0.28, 0.34, 0.4, 10), 'rough_wood', 0, 0.2, 0);
      const anvil = propMesh('iron_anvil');
      anvil.position.y = 0.4;
      g.add(anvil);
      break;
    }
    case 'bellows': {
      // Nozzle points along +Z, into the forge it's set against.
      for (const x of [-0.22, 0.22]) add(new THREE.BoxGeometry(0.06, 0.32, 0.06), DARK_WOOD, x, 0.16, -0.1);
      add(new THREE.BoxGeometry(0.5, 0.05, 0.1), DARK_WOOD, 0, 0.3, -0.1);
      const body = new THREE.Group();
      body.position.set(0, 0.42, -0.05);
      body.rotation.x = -0.25;
      g.add(body);
      add(new THREE.BoxGeometry(0.46, 0.035, 0.7), WOOD, 0, 0, 0, undefined, body);
      add(new THREE.BoxGeometry(0.44, 0.035, 0.68), WOOD, 0, 0.17, -0.02, undefined, body);
      const leather = add(new THREE.CylinderGeometry(0.2, 0.24, 0.62, 10, 1, true), 0x5a3a24, 0, 0.085, -0.03, { side: THREE.DoubleSide }, body);
      leather.rotation.x = Math.PI / 2;
      leather.scale.set(1, 1, 0.42);
      const nozzle = add(new THREE.CylinderGeometry(0.03, 0.05, 0.3, 8), 0x3a3a3c, 0, 0.06, 0.48, { metalness: 0.5 }, body);
      nozzle.rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 6), DARK_WOOD, 0, 0.2, -0.45, undefined, body).rotation.z = Math.PI / 2;
      break;
    }
    case 'quench_trough': {
      // A big wooden bucket of water.
      g.add(propMesh('wood_bucket'));
      const level = Math.min(1, (state.water ?? 0) / 4);
      if (level > 0) {
        const w = add(new THREE.CylinderGeometry(0.255, 0.24, 0.42 * level, 16), 0x3f6f8a, 0, 0.06 + 0.21 * level, 0, { transparent: true, opacity: 0.8, roughness: 0.15 });
        w.castShadow = false;
      }
      break;
    }
    case 'market_stall': {
      // A counter piled with goods in front, posts and a striped cloth awning sloping back over it.
      tex(new THREE.BoxGeometry(2.0, 0.85, 0.6), 'planks', 0, 0.43, -0.4);
      tex(new THREE.BoxGeometry(2.1, 0.06, 0.7), 'dark_planks', 0, 0.88, -0.4, { turn: true });
      for (const [x, z, h] of [[-0.95, -0.7, 2.0], [0.95, -0.7, 2.0], [-0.95, 0.4, 2.3], [0.95, 0.4, 2.3]]) tex(new THREE.BoxGeometry(0.08, h, 0.08), 'rough_wood', x, h / 2, z);
      const stripes = [0xb8402a, 0xe8dcc0];
      for (let k = 0; k < 6; k++) {
        const st = add(new THREE.BoxGeometry(0.36, 0.03, 1.4), stripes[k % 2], -0.9 + k * 0.36, 2.15, -0.15, { roughness: 1 });
        st.rotation.x = -0.22;
      }
      // Goods: a basket of apples, a sack, a few loaves, a bolt of cloth.
      add(new THREE.CylinderGeometry(0.2, 0.16, 0.14, 10), 0x8a6a3a, -0.6, 0.98, -0.4, { roughness: 1 });
      for (let k = 0; k < 5; k++) add(new THREE.SphereGeometry(0.06, 6, 5), 0xc0281e, -0.66 + (k % 3) * 0.06, 1.07, -0.44 + Math.floor(k / 3) * 0.08, { roughness: 0.5 });
      add(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 0.8, 0.9), 0xb8a070, 0, 1.06, -0.35, { roughness: 1 });
      for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(0.1, 8, 6).scale(1.4, 0.7, 0.9), 0xb07a3a, 0.45 + k * 0.17, 0.97, -0.5, { roughness: 0.9 });
      const bolt = add(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 10), 0x4a5a8a, 0.62, 1.0, -0.25, { roughness: 1 });
      bolt.rotation.z = Math.PI / 2;
      break;
    }
    case 'village_store': {
      // Posts, a back wall, a thatched lean-to roof; a counter in front, goods behind.
      for (const [x, z] of [[-1.55, -1.1], [1.55, -1.1], [-1.55, 1.1], [1.55, 1.1]]) tex(new THREE.BoxGeometry(0.16, z < 0 ? 2.5 : 2.1, 0.16), 'rough_wood', x, z < 0 ? 1.25 : 1.05, z);
      tex(new THREE.BoxGeometry(3.2, 2.1, 0.12), 'dark_planks', 0, 1.05, 1.1);
      for (const x of [-1.55, 1.55]) tex(new THREE.BoxGeometry(0.1, 1.0, 2.1), 'dark_planks', x, 0.5, 0);
      const roof = tex(new THREE.BoxGeometry(3.6, 0.14, 2.9), 'thatch', 0, 2.38, 0);
      roof.rotation.x = -0.2;
      tex(new THREE.BoxGeometry(3.0, 0.9, 0.5), 'planks', 0, 0.45, -0.55);
      tex(new THREE.BoxGeometry(3.1, 0.08, 0.62), 'dark_planks', 0, 0.94, -0.55, { turn: true });
      // Goods: crates, a barrel, sacks of grain, a stack of planks.
      for (const [x, y, s] of [[-1.0, 0.25, 0.5], [-1.0, 0.75, 0.45], [-0.45, 0.22, 0.44]]) tex(new THREE.BoxGeometry(s, s, s), 'planks', x, y, 0.65);
      tex(new THREE.CylinderGeometry(0.28, 0.3, 0.75, 12), 'dark_planks', 0.25, 0.38, 0.6);
      for (const [x, z] of [[0.9, 0.55], [1.15, 0.75], [1.0, 0.25]]) {
        const sack = add(new THREE.SphereGeometry(0.26, 8, 6).scale(1, 0.85, 1), 0xb8a070, x, 0.22, z, { roughness: 1 });
        sack.rotation.y = x;
      }
      for (let k = 0; k < 4; k++) tex(new THREE.BoxGeometry(1.2, 0.05, 0.22), 'planks', 0.4, 1.05 + k * 0.05, 0.85, { turn: true });
      break;
    }
    case 'well': {
      // A ring of stone round dark water, two posts, a winch and a little thatched roof.
      const ring = new THREE.CylinderGeometry(0.85, 0.9, 0.9, 18, 1, true);
      tex(ring, 'stone_wall', 0, 0.45, 0);
      add(new THREE.CylinderGeometry(0.66, 0.66, 0.9, 18, 1, true), 0x4a4640, 0, 0.45, 0, { side: THREE.BackSide, roughness: 1 });
      tex(new THREE.RingGeometry(0.64, 0.92, 18).rotateX(-Math.PI / 2), 'stone', 0, 0.91, 0, { tint: 0xd8d4cc });
      add(new THREE.CircleGeometry(0.66, 18).rotateX(-Math.PI / 2), 0x10181c, 0, 0.35, 0, { roughness: 0.15 });
      for (const x of [-0.8, 0.8]) tex(new THREE.BoxGeometry(0.14, 2.3, 0.14), 'rough_wood', x, 1.15, 0);
      const axle = tex(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 8), 'rough_wood', 0, 1.75, 0);
      axle.rotation.z = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 4), 0x8a7a5a, 0.1, 1.2, 0, { roughness: 1 });
      tex(new THREE.CylinderGeometry(0.13, 0.1, 0.22, 10), 'planks', 0.1, 0.62, 0);
      for (const side of [-1, 1]) {
        const roof = tex(new THREE.BoxGeometry(2.1, 0.08, 0.95), 'thatch', 0, 2.42, side * 0.33);
        roof.rotation.x = side * 0.62;
      }
      break;
    }
    case 'chopping_block': {
      // A round of log on end: bark round the sides, the top end-grain scarred by the axe.
      tex(new THREE.CylinderGeometry(0.3, 0.33, 0.5, 14), 'rough_wood', 0, 0.25, 0);
      add(new THREE.CylinderGeometry(0.29, 0.29, 0.012, 14), 0xb48a58, 0, 0.502, 0, { roughness: 0.95 });
      for (const [r, c] of [[0.2, 0x9c7646], [0.11, 0xa98250]] as const) add(new THREE.RingGeometry(r - 0.012, r, 20).rotateX(-Math.PI / 2), c, 0, 0.509, 0, { roughness: 1 });
      for (let k = 0; k < 3; k++) {
        const cut = add(new THREE.BoxGeometry(0.22, 0.004, 0.012), 0x6e5232, (k - 1) * 0.06, 0.51, (k - 1) * 0.05, { roughness: 1 });
        cut.rotation.y = 0.5 + k * 0.7;
      }
      break;
    }
    case 'quern':
      tex(new THREE.CylinderGeometry(0.55, 0.6, 0.3, 16), 'stone', 0, 0.15, 0);
      tex(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 16), 'stone', 0, 0.42, 0, { tint: 0xe0dcd6 });
      tex(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), 'rough_wood', 0.35, 0.7, 0);
      break;
    case 'workbench':
      tex(new THREE.BoxGeometry(1.6, 0.1, 0.8), 'planks', 0, 0.85, 0);
      for (const [x, z] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) tex(new THREE.BoxGeometry(0.1, 0.85, 0.1), 'rough_wood', x, 0.42, z);
      break;
    case 'chest':
      tex(new THREE.BoxGeometry(1.0, 0.6, 0.6), 'dark_planks', 0, 0.3, 0);
      tex(new THREE.BoxGeometry(1.04, 0.08, 0.64), 'rough_wood', 0, 0.62, 0);
      break;
    case 'bed':
      tex(new THREE.BoxGeometry(1.0, 0.35, 1.9), 'dark_planks', 0, 0.18, 0, { turn: true });
      add(new THREE.BoxGeometry(0.9, 0.12, 1.8), 0x9b7552, 0, 0.42, 0);
      break;
    case 'slipway':
    case 'great_slipway': {
      slipwayModel(tex, type === 'great_slipway');
      break;
    }
    case 'dugout':
    case 'log_raft':
    case 'reed_boat':
    case 'skin_boat':
    case 'rowboat': {
      // A hull being worked: the finished boat's shape (the ghost and the work in progress).
      g.add(vesselModel(type, false));
      break;
    }
    case 'market_hall': {
      // Six posts, tie-beams, a thatched roof (ridge along its length), a flagged floor.
      for (const x of [-6, 0, 6]) for (const z of [-4, 4]) tex(new THREE.BoxGeometry(0.3, 4, 0.3), 'rough_wood', x, 2, z);
      for (const z of [-4, 4]) tex(new THREE.BoxGeometry(12.4, 0.25, 0.3), 'rough_wood', 0, 3.9, z, { turn: true });
      for (const x of [-6, 0, 6]) tex(new THREE.BoxGeometry(0.25, 0.25, 8.3), 'rough_wood', x, 3.9, 0);
      tex(new THREE.BoxGeometry(12, 0.08, 8), 'stone', 0, 0.04, 0, { tint: 0xc8c0b4 });
      for (const side of [-1, 1]) {
        const r = tex(new THREE.BoxGeometry(13.2, 0.2, 6.4), 'thatch', 0, 5.6, side * 2.2);
        r.rotation.x = side * 0.78;
      }
      for (const x of [-6.5, 6.5]) {
        const tri = new THREE.Shape([new THREE.Vector2(-4.4, 0), new THREE.Vector2(4.4, 0), new THREE.Vector2(0, 4.2)]);
        const gab = tex(new THREE.ExtrudeGeometry(tri, { depth: 0.12, bevelEnabled: false }), 'planks', x, 4, 0);
        gab.rotation.y = Math.PI / 2;
      }
      break;
    }
    case 'stage': {
      // A raised platform with steps, a painted backdrop, a canopy and curtains.
      tex(new THREE.BoxGeometry(8, 1.2, 5), 'dark_planks', 0, 0.6, 0);
      tex(new THREE.BoxGeometry(8.1, 0.1, 5.1), 'planks', 0, 1.22, 0, { turn: true });
      for (let k = 0; k < 3; k++) tex(new THREE.BoxGeometry(1.4, 0.4 * (k + 1), 0.4), 'dark_planks', 3.2, 0.2 * (k + 1), -2.7 - (2 - k) * 0.4);
      tex(new THREE.BoxGeometry(8, 3, 0.15), 'planks', 0, 2.7, 2.4);
      add(new THREE.BoxGeometry(5, 2.2, 0.05), 0x3a5a7a, 0, 2.5, 2.3, { roughness: 1 });
      for (const x of [-3.9, 3.9]) {
        tex(new THREE.BoxGeometry(0.25, 3.6, 0.25), 'rough_wood', x, 3, 2.4);
        tex(new THREE.BoxGeometry(0.2, 3.4, 0.2), 'rough_wood', x, 2.9, -2.4);
        add(new THREE.BoxGeometry(0.9, 2.8, 0.08), 0x8a1c1c, x * 0.86, 2.6, -2.3, { roughness: 1 });
      }
      const canopy = add(new THREE.BoxGeometry(8.6, 0.08, 5.4), 0x8a1c1c, 0, 4.7, 0, { roughness: 1 });
      canopy.rotation.x = 0.12;
      break;
    }
    case 'stands': {
      // Three tiers of benches, rising to the back.
      for (let k = 0; k < 3; k++) {
        tex(new THREE.BoxGeometry(8, 0.45 * (k + 1), 1), 'dark_planks', 0, 0.225 * (k + 1), -1 + k);
        tex(new THREE.BoxGeometry(8, 0.08, 0.4), 'planks', 0, 0.45 * (k + 1) + 0.04, -1.2 + k, { turn: true });
      }
      for (const x of [-4, 4]) tex(new THREE.BoxGeometry(0.15, 2.2, 0.15), 'rough_wood', x, 1.1, 1.4);
      break;
    }
    case 'gallows': {
      // A scaffold of planks on posts, steps up one side, two uprights and a beam, a noose.
      tex(new THREE.BoxGeometry(3, 0.12, 3), 'dark_planks', 0, 1.4, 0, { turn: true });
      for (const x of [-1.35, 1.35]) for (const z of [-1.35, 1.35]) tex(new THREE.BoxGeometry(0.2, 1.4, 0.2), 'rough_wood', x, 0.7, z);
      for (let k = 0; k < 4; k++) tex(new THREE.BoxGeometry(1, 0.12, 0.35), 'planks', 0, 0.35 * (k + 1) - 0.06, -1.7 - (3 - k) * 0.35);
      for (const x of [-1, 1]) tex(new THREE.BoxGeometry(0.22, 2.9, 0.22), 'rough_wood', x, 2.9, 0.6);
      tex(new THREE.BoxGeometry(2.5, 0.22, 0.22), 'rough_wood', 0, 4.35, 0.6, { turn: true });
      add(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 5), 0x8a7650, 0, 3.7, 0.6, { roughness: 1 });
      const loop = add(new THREE.TorusGeometry(0.16, 0.03, 4, 10), 0x8a7650, 0, 3.0, 0.6, { roughness: 1 });
      loop.rotation.x = Math.PI / 2;
      break;
    }
    default:
      if (type.startsWith('th_')) townhouseMesh(type, tex, add);
      else furnitureMesh(type, g, tex, add);
  }
  return g;
}

/**
 * A town house: a stone or timber ground floor with a door and windows, upper
 * storeys jettied out over the street on beams, timber framing on the plank
 * storeys, a steep roof (ridge along the front) with its gable ends, and a
 * chimney on the stone ones.
 */
function townhouseMesh(type: string, tex: (geo: THREE.BufferGeometry, s: Surface, x?: number, y?: number, z?: number, o?: { turn?: boolean; tint?: number }) => THREE.Mesh,
  add: (geo: THREE.BufferGeometry, color: number, x?: number, y?: number, z?: number, extra?: THREE.MeshStandardMaterialParameters) => THREE.Mesh) {
  const w = +type[3], d = +type[4], st = +type[5], style = type[6];
  const W = w * 2, D = d * 2, H = 2.4;
  const ground: Surface = style === 'b' ? 'dark_planks' : 'stone_wall', upper: Surface = style === 'c' ? 'stone_wall' : style === 'b' ? 'dark_planks' : 'planks';
  const roofS: Surface = style === 'c' ? 'dark_planks' : 'thatch';
  const tint = style === 'a' ? 0xf0e6d6 : 0xffffff;
  tex(new THREE.BoxGeometry(W, H, D), ground, 0, H / 2, 0);
  // Upper storeys, each jutting out a little more over the street (local -z is the front).
  let front = D / 2, top = H;
  for (let k = 1; k < st; k++) {
    const jut = style === 'c' ? 0 : 0.35 * k;
    const dd = D + jut;
    tex(new THREE.BoxGeometry(W + 0.1, H, dd), upper, 0, H * k + H / 2, -jut / 2, { tint });
    // The floor beam the storey sits out on, and the posts of its frame.
    tex(new THREE.BoxGeometry(W + 0.2, 0.18, 0.22), 'rough_wood', 0, H * k + 0.05, -dd / 2 - jut / 2 + 0.05, { turn: true });
    if (style !== 'c') for (let x = -W / 2; x <= W / 2 + 0.01; x += W / Math.max(1, w)) tex(new THREE.BoxGeometry(0.16, H, 0.16), 'rough_wood', x, H * k + H / 2, -dd / 2 - jut / 2 - 0.03);
    front = dd / 2 + jut / 2;
    top = H * (k + 1);
  }
  // Windows: dark panes in frames, one or two to a bay, every storey; the door below.
  for (let k = 0; k < st; k++) {
    const jut = k === 0 || style === 'c' ? 0 : 0.35 * k;
    const fz = -(k === 0 ? D / 2 : D / 2 + jut) - 0.02;
    for (let x = -W / 2 + 1; x < W / 2; x += 2) {
      if (k === 0 && x === -W / 2 + 1) continue; // the door's bay
      add(new THREE.BoxGeometry(0.7, 0.8, 0.06), 0x1c1f24, x, H * k + 1.3, fz, { roughness: 0.3, metalness: 0.1 });
      tex(new THREE.BoxGeometry(0.86, 0.1, 0.1), 'rough_wood', x, H * k + 0.86, fz, { turn: true });
      // (and at the back)
      add(new THREE.BoxGeometry(0.7, 0.8, 0.06), 0x1c1f24, x, H * k + 1.3, D / 2 + 0.02, { roughness: 0.3, metalness: 0.1 });
    }
  }
  tex(new THREE.BoxGeometry(1.0, 1.95, 0.1), 'dark_planks', -W / 2 + 1, 0.98, -D / 2 - 0.04);
  // The roof: two steep slopes meeting at a ridge along the front, and the gable ends filled.
  const back = D / 2, depth = front + back, mid = (back - front) / 2, rise = depth * 0.62;
  const slope = Math.hypot(depth / 2, rise), ang = Math.atan2(rise, depth / 2);
  for (const side of [-1, 1]) {
    const r = tex(new THREE.BoxGeometry(W + 0.5, 0.16, slope + 0.35), roofS, 0, top + rise / 2, mid + side * depth / 4);
    r.rotation.x = side * ang;
  }
  const tri = new THREE.Shape([new THREE.Vector2(-depth / 2, 0), new THREE.Vector2(depth / 2, 0), new THREE.Vector2(0, rise)]);
  for (const x of [-W / 2, W / 2 - 0.1]) {
    const gab = tex(new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), upper, x, top, mid, { tint });
    gab.rotation.y = Math.PI / 2;
  }
  if (style === 'c' || (w === 3 && style === 'a')) tex(new THREE.BoxGeometry(0.6, 1.6, 0.6), 'stone_wall', W / 2 - 0.8, top + rise * 0.6, back - 0.8);
}

/** Inside the solid (built) copy of a planned piece? */
function isInSolid(o: THREE.Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) if (p.userData.solid) return true;
  return false;
}
