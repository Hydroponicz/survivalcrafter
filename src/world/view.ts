import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STRUCTURES, totalMaterials } from '../data/structures';
import { hash2 } from './noise';
import { TILE } from './terrain';
import {
  CROP_STAGES, type AnimalObj, type BushObj, type PileObj, type Species, type StructureObj,
  type TreeObj, type World, type WorldListener, type WorldObj,
} from './world';

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

/** Fixed-capacity instanced mesh with slot allocation; hidden slots are zero-scaled. */
class InstancePool {
  mesh: THREE.InstancedMesh;
  private free: number[] = [];
  private used = 0;
  private static zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(geo: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number, shadow = true) {
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, InstancePool.zero);
    // Only draw up to the high-water mark of allocated slots.
    this.mesh.count = 0;
  }

  alloc(): number {
    if (this.free.length) return this.free.pop()!;
    if (this.used >= this.capacity) return -1;
    this.mesh.count = this.used + 1;
    return this.used++;
  }

  release(slot: number) {
    if (slot < 0) return;
    this.mesh.setMatrixAt(slot, InstancePool.zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push(slot);
  }

  set(slot: number, m: THREE.Matrix4, color?: THREE.Color) {
    if (slot < 0) return;
    this.mesh.setMatrixAt(slot, m);
    if (color) {
      this.mesh.setColorAt(slot, color);
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hide(slot: number) {
    this.set(slot, InstancePool.zero);
  }
}

function treeGeometries(species: Species): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  if (species === 'pine') {
    const trunk = new THREE.CylinderGeometry(0.14, 0.24, 4.5, 6).translate(0, 2.25, 0);
    const cones = [0, 1, 2].map((i) =>
      new THREE.ConeGeometry(1.5 - i * 0.38, 2.0, 7).translate(0, 2.4 + i * 1.25, 0));
    return { trunk, leaves: mergeGeometries(cones)! };
  }
  if (species === 'birch') {
    const trunk = new THREE.CylinderGeometry(0.11, 0.17, 4.6, 6).translate(0, 2.3, 0);
    const a = new THREE.IcosahedronGeometry(1.15, 1).scale(1, 1.45, 1).translate(0, 4.4, 0);
    const b = new THREE.IcosahedronGeometry(0.8, 1).translate(0.5, 3.6, 0.3);
    return { trunk, leaves: mergeGeometries([a, b])! };
  }
  const trunk = new THREE.CylinderGeometry(0.2, 0.3, 3.4, 7).translate(0, 1.7, 0);
  const blobs = [
    new THREE.IcosahedronGeometry(1.7, 1).translate(0, 4.0, 0),
    new THREE.IcosahedronGeometry(1.15, 1).translate(1.1, 3.4, 0.3),
    new THREE.IcosahedronGeometry(1.1, 1).translate(-0.9, 3.5, -0.6),
  ];
  return { trunk, leaves: mergeGeometries(blobs)! };
}

export class WorldView implements WorldListener {
  group = new THREE.Group();
  private trunks = {} as Record<Species, InstancePool>;
  private leaves = {} as Record<Species, InstancePool>;
  private bushPool: InstancePool;
  private berryPool: InstancePool;
  private slots = new Map<number, number>();
  private meshes = new Map<number, THREE.Object3D>();
  private cropMeshes = new Map<number, THREE.Mesh>();
  private animalMeshes = new Map<number, THREE.Group>();
  private fireLights: THREE.PointLight[] = [];
  private flames = new Set<THREE.Mesh>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private cropGeo: THREE.BufferGeometry;
  private cropMats: THREE.MeshStandardMaterial[];

  constructor(private world: World) {
    const trunkMat: Record<Species, number> = { oak: 0x5a4030, birch: 0xd8d4c8, pine: 0x4a3426 };
    const leafMat: Record<Species, number> = { oak: 0x3f7a2c, birch: 0x7aa33e, pine: 0x2b5a33 };
    for (const s of ['oak', 'birch', 'pine'] as Species[]) {
      const g = treeGeometries(s);
      this.trunks[s] = new InstancePool(g.trunk, mat(trunkMat[s]), 6000);
      this.leaves[s] = new InstancePool(g.leaves, mat(0xffffff, { flatShading: true }), 6000);
      // seed instanceColor so per-tree tint works
      this.leaves[s].mesh.setColorAt(0, new THREE.Color(leafMat[s]));
      (this.leaves[s].mesh as THREE.InstancedMesh & { baseColor?: number }).baseColor = leafMat[s];
      this.group.add(this.trunks[s].mesh, this.leaves[s].mesh);
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

    const stalks = [];
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) - 1) * 0.55, z = (Math.floor(i / 3) - 1) * 0.55;
      stalks.push(new THREE.CylinderGeometry(0.03, 0.04, 0.9, 4).translate(x, 0.45, z));
      stalks.push(new THREE.ConeGeometry(0.08, 0.25, 4).translate(x, 0.95, z));
    }
    this.cropGeo = mergeGeometries(stalks)!;
    this.cropMats = [0x6aa84f, 0x7fb348, 0x9cba45, 0xc2b04a, 0xd9b44a].map((c) => mat(c));

    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 16, 1.6);
      this.fireLights.push(l);
      this.group.add(l);
    }

    for (const o of world.objects.values()) this.added(o);
    for (const k of world.crops.keys()) this.cropsChanged(k);
    world.listener = this;
  }

  // ---------- WorldListener
  added(o: WorldObj) {
    if (o.kind === 'tree') {
      const slot = this.trunks[o.species].alloc();
      this.leaves[o.species].alloc();
      this.slots.set(o.id, slot);
      this.updateTree(o);
    } else if (o.kind === 'bush') {
      const slot = this.bushPool.alloc();
      this.berryPool.alloc();
      this.slots.set(o.id, slot);
      this.updateBush(o);
    } else {
      this.rebuildMesh(o);
    }
  }

  removed(o: WorldObj) {
    if (o.kind === 'tree') {
      const s = this.slots.get(o.id)!;
      this.trunks[o.species].release(s);
      this.leaves[o.species].release(s);
      this.slots.delete(o.id);
    } else if (o.kind === 'bush') {
      const s = this.slots.get(o.id)!;
      this.bushPool.release(s);
      this.berryPool.release(s);
      this.slots.delete(o.id);
    } else {
      const m = this.meshes.get(o.id);
      if (m) { this.disposeMesh(m); this.meshes.delete(o.id); }
    }
  }

  changed(o: WorldObj) {
    if (o.kind === 'tree') this.updateTree(o);
    else if (o.kind === 'bush') this.updateBush(o);
    else this.rebuildMesh(o);
  }

  cropsChanged(k: number) {
    const crop = this.world.crops.get(k);
    const old = this.cropMeshes.get(k);
    if (old) { this.group.remove(old); this.cropMeshes.delete(k); }
    if (!crop) return;
    const stage = this.world.cropStage(crop);
    const m = new THREE.Mesh(this.cropGeo, this.cropMats[stage]);
    const size = this.world.terrain.size;
    const tx = k % size, tz = Math.floor(k / size);
    const x = (tx + 0.5) * TILE, z = (tz + 0.5) * TILE;
    m.position.set(x, this.world.terrain.heightAt(x, z), z);
    m.scale.set(1, 0.15 + (stage / (CROP_STAGES - 1)) * 0.85, 1);
    m.castShadow = true;
    this.cropMeshes.set(k, m);
    this.group.add(m);
  }

  // ---------- updates
  private updateTree(o: TreeObj) {
    const slot = this.slots.get(o.id)!;
    const y = this.world.terrain.heightAt(o.x, o.z) - 0.1;
    const s = 0.2 + 0.8 * o.age;
    const r = hash2(o.id, 1) * Math.PI * 2;
    const hs = 0.85 + hash2(o.id, 2) * 0.35;
    this.q.setFromAxisAngle(this.up, r);
    this.m4.compose(new THREE.Vector3(o.x, y, o.z), this.q, new THREE.Vector3(s, s * hs, s));
    this.trunks[o.species].set(slot, this.m4);
    const base = new THREE.Color((this.leaves[o.species].mesh as THREE.InstancedMesh & { baseColor: number }).baseColor);
    base.offsetHSL((hash2(o.id, 3) - 0.5) * 0.04, 0, (hash2(o.id, 4) - 0.5) * 0.08);
    this.leaves[o.species].set(slot, this.m4, base);
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

  /** Re-sync heights of everything after terrain changes near a point. */
  refreshNear(x: number, z: number, r = 4) {
    for (const o of this.world.near(x, z, r)) this.changed(o);
    for (const [k] of this.cropMeshes) {
      const size = this.world.terrain.size;
      const cx = (k % size + 0.5) * TILE, cz = (Math.floor(k / size) + 0.5) * TILE;
      if (Math.abs(cx - x) < r + TILE && Math.abs(cz - z) < r + TILE) this.cropsChanged(k);
    }
  }

  private disposeMesh(m: THREE.Object3D) {
    this.group.remove(m);
    m.traverse((c) => { if (c instanceof THREE.Mesh) this.flames.delete(c); });
  }

  private rebuildMesh(o: WorldObj) {
    const old = this.meshes.get(o.id);
    if (old) this.disposeMesh(old);
    const m = o.kind === 'structure' ? this.structureMesh(o) : this.pileMesh(o as PileObj);
    this.meshes.set(o.id, m);
    this.group.add(m);
  }

  private pileMesh(o: PileObj): THREE.Object3D {
    const g = new THREE.Group();
    const y = this.world.terrain.heightAt(o.x, o.z);
    g.position.set(o.x, y, o.z);
    const corpse = o.items.find((i) => i.type === 'corpse');
    if (corpse) {
      const species = corpse.label?.includes('boar') ? 'boar' : 'deer';
      const body = animalModel(species);
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
    const def = STRUCTURES[o.type];
    const t = this.world.terrain;
    const g = new THREE.Group();
    let built = o.built;
    const progress = built ? 1 : Object.values(o.consumed).reduce((a, b) => a + b, 0) / totalMaterials(def);
    let baseY: number;
    if (def.placement === 'edge') {
      const x0 = o.tx, z0 = o.tz;
      const x1 = o.axis === 'x' ? x0 + 1 : x0, z1 = o.axis === 'z' ? z0 + 1 : z0;
      baseY = Math.min(t.cornerH(x0, z0), t.cornerH(x1, z1));
    } else {
      baseY = Math.min(
        t.cornerH(o.tx, o.tz), t.cornerH(o.tx + 1, o.tz), t.cornerH(o.tx, o.tz + 1), t.cornerH(o.tx + 1, o.tz + 1));
    }
    g.position.set(o.x, baseY, o.z);
    if (o.axis === 'z') g.rotation.y = Math.PI / 2;

    const add = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, extra?: THREE.MeshStandardMaterialParameters) => {
      const m = new THREE.Mesh(geo, mat(color, extra));
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const wood = 0x8a6440, stone = 0x8a8782;

    switch (o.type) {
      case 'campfire':
      case 'forge': {
        const forge = o.type === 'forge';
        if (forge) {
          add(new THREE.BoxGeometry(1.5, 0.9, 1.3), 0x7a6f66, 0, 0.45, 0, { flatShading: true });
          add(new THREE.BoxGeometry(0.5, 1.2, 0.5), 0x6e655d, 0.45, 1.4, 0.3);
          add(new THREE.BoxGeometry(0.8, 0.12, 0.7), 0x1a1a1a, 0, 0.91, 0);
        } else {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            add(new THREE.DodecahedronGeometry(0.16), stone, Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5, { flatShading: true });
          }
          for (let i = 0; i < 3; i++) {
            const l = add(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 5), 0x5a3c22, 0, 0.12, 0);
            l.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI);
          }
        }
        if (o.lit) {
          const flame = add(new THREE.ConeGeometry(forge ? 0.3 : 0.28, forge ? 0.5 : 0.75, 6), 0xffa030, 0, forge ? 1.1 : 0.4, 0,
            { emissive: 0xff6a00, emissiveIntensity: 2.5, transparent: true, opacity: 0.85 });
          flame.castShadow = false;
          flame.userData.fire = o.id;
          this.flames.add(flame);
        }
        break;
      }
      case 'anvil':
        add(new THREE.BoxGeometry(0.6, 0.55, 0.5), stone, 0, 0.27, 0, { flatShading: true });
        add(new THREE.BoxGeometry(1.0, 0.25, 0.45), 0x77746f, 0, 0.67, 0, { flatShading: true });
        break;
      case 'quern':
        add(new THREE.CylinderGeometry(0.55, 0.6, 0.3, 12), stone, 0, 0.15, 0);
        add(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 12), 0x9a9792, 0, 0.42, 0);
        add(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 5), wood, 0.35, 0.7, 0);
        break;
      case 'workbench':
        add(new THREE.BoxGeometry(1.6, 0.1, 0.8), wood, 0, 0.85, 0);
        for (const [x, z] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) add(new THREE.BoxGeometry(0.1, 0.85, 0.1), 0x6e4e30, x, 0.42, z);
        break;
      case 'chest':
        add(new THREE.BoxGeometry(1.0, 0.6, 0.6), wood, 0, 0.3, 0);
        add(new THREE.BoxGeometry(1.04, 0.08, 0.64), 0x5a3c22, 0, 0.62, 0);
        break;
      case 'bed':
        add(new THREE.BoxGeometry(1.0, 0.35, 1.9), wood, 0, 0.18, 0);
        add(new THREE.BoxGeometry(0.9, 0.12, 1.8), 0x9b7552, 0, 0.42, 0);
        break;
      case 'floor':
        add(new THREE.BoxGeometry(TILE, 0.12, TILE), wood, 0, 0.06 + (t.tileSlope(o.tx, o.tz) / 10), 0);
        break;
      case 'fence':
      case 'gate': {
        const open = o.type === 'gate' && o.open;
        add(new THREE.BoxGeometry(0.12, 1.3, 0.12), 0x6e4e30, -TILE / 2, 0.55, 0);
        add(new THREE.BoxGeometry(0.12, 1.3, 0.12), 0x6e4e30, TILE / 2, 0.55, 0);
        const rails = new THREE.Group();
        for (const y of [0.45, 0.9]) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(TILE - 0.1, 0.12, 0.05), mat(wood));
          r.position.set(TILE / 2 - 0.05, y, 0);
          r.castShadow = true;
          rails.add(r);
        }
        if (o.type === 'gate') {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(TILE * 1.05, 0.08, 0.04), mat(0x6e4e30));
          brace.position.set(TILE / 2 - 0.05, 0.67, 0.03);
          brace.rotation.z = 0.25;
          rails.add(brace);
        }
        rails.position.x = -TILE / 2;
        if (open) rails.rotation.y = -Math.PI / 2;
        g.add(rails);
        break;
      }
      case 'log_wall':
        for (let i = 0; i < 7; i++) {
          const l = add(new THREE.CylinderGeometry(0.17, 0.17, TILE + 0.3, 7), i % 2 ? 0x6b4a30 : 0x765236, 0, 0.17 + i * 0.33 - 0.25, 0);
          l.rotation.z = Math.PI / 2;
        }
        break;
      case 'stone_wall':
        add(new THREE.BoxGeometry(TILE + 0.1, 2.6, 0.4), stone, 0, 1.1, 0, { flatShading: true });
        add(new THREE.BoxGeometry(TILE + 0.15, 0.15, 0.45), 0x77746f, 0, 2.45, 0);
        break;
    }

    if (!built) {
      // Unfinished: a translucent ghost that rises with build progress.
      g.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          const m = (c.material as THREE.MeshStandardMaterial).clone();
          m.transparent = true;
          m.opacity = 0.35 + progress * 0.4;
          m.color.lerp(new THREE.Color(0xc8d8ff), 0.4);
          c.material = m;
          c.castShadow = false;
        }
      });
      g.scale.y = 0.15 + 0.85 * progress;
      const stakes = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), mat(0xd9c38f));
      stakes.position.y = 0.35;
      stakes.scale.y = 1 / g.scale.y;
      g.add(stakes);
    }
    return g;
  }

  // ---------- animals
  syncAnimals(time: number) {
    const live = new Set<number>();
    for (const a of this.world.animals) {
      live.add(a.id);
      let m = this.animalMeshes.get(a.id);
      if (!m) {
        m = animalModel(a.species);
        this.animalMeshes.set(a.id, m);
        this.group.add(m);
      }
      m.position.set(a.x, this.world.terrain.heightAt(a.x, a.z), a.z);
      m.rotation.y = a.rot;
      animateLegs(m, a, time);
    }
    for (const [id, m] of this.animalMeshes) {
      if (!live.has(id)) { this.group.remove(m); this.animalMeshes.delete(id); }
    }
  }

  /** Flicker flames and park the light pool on the fires nearest the player. */
  updateFires(px: number, pz: number, time: number) {
    const lit: StructureObj[] = [];
    for (const o of this.world.near(px, pz, 40)) if (o.kind === 'structure' && o.lit) lit.push(o);
    lit.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    this.fireLights.forEach((l, i) => {
      const f = lit[i];
      if (!f) { l.intensity = 0; return; }
      const y = this.world.terrain.heightAt(f.x, f.z);
      l.position.set(f.x, y + 1.2, f.z);
      l.intensity = 9 + Math.sin(time * 13 + i) * 1.5 + Math.sin(time * 7.3) * 1;
    });
    for (const fl of this.flames) {
      const s = 1 + Math.sin(time * 15 + fl.id) * 0.12;
      fl.scale.set(s, 1 + Math.sin(time * 11 + fl.id) * 0.18, s);
    }
  }
}

export function animalModel(species: 'deer' | 'boar'): THREE.Group {
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
