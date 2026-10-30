import * as THREE from 'three';
import { hash2 } from './noise';
import type { Terrain } from './terrain';
import type { Species, Stump, TreeObj } from './world';

// Visual life of a tree being chopped: a V-notch that deepens with each hit,
// shaking and falling leaves, flying chips, and finally the tree toppling,
// crashing to the ground in a cloud of dust and leaving a stump behind.

/** Trunk shape per species: base radius, top radius, height. Matches the instanced trees. */
export const TRUNK: Record<Species, { r0: number; r1: number; h: number }> = {
  oak: { r0: 0.3, r1: 0.2, h: 3.4 },
  birch: { r0: 0.17, r1: 0.11, h: 4.6 },
  pine: { r0: 0.24, r1: 0.14, h: 4.5 },
};
export const BARK: Record<Species, number> = { oak: 0x5a4030, birch: 0xd8d4c8, pine: 0x4a3426 };
const HEARTWOOD = new THREE.Color(0xf6dfae);
/** Height of the felling notch above the ground, in the trunk's local units. */
const NOTCH_Y = 0.7;

export function treeScale(o: { id: number; age: number }) {
  const s = 0.2 + 0.8 * o.age;
  const hs = 0.85 + hash2(o.id, 2) * 0.35;
  return { s, hs, yaw: hash2(o.id, 1) * Math.PI * 2 };
}

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  max: number;
  gravity: number;
  drag: number;
  settle: boolean;
  grow?: number;
}

interface Actor {
  tree: TreeObj;
  group: THREE.Group;
  trunk: THREE.Mesh;
  leaves: THREE.Mesh;
  base: Float32Array;
  shakeT: number;
  shakeAmp: number;
  shakeAxis: THREE.Vector3;
  yawQ: THREE.Quaternion;
}

interface Faller {
  pivot: THREE.Group;
  angle: number;
  vel: number;
  axis: THREE.Vector3;
  landed: boolean;
  bounce: boolean;
  t: number;
  fadeT: number;
  length: number;
  dir: THREE.Vector2;
  onLand: (x: number, z: number) => void;
  mats: THREE.Material[];
}

export class TreeFx {
  readonly group = new THREE.Group();
  private actors = new Map<number, Actor>();
  private fallers: Faller[] = [];
  private particles: Particle[] = [];
  private stumps = new Map<string, THREE.Mesh>();
  private chipGeo = new THREE.BoxGeometry(0.06, 0.02, 0.035);
  private leafGeo = new THREE.PlaneGeometry(0.12, 0.09);
  private dustGeo = new THREE.IcosahedronGeometry(0.25, 0);

  constructor(private terrain: Terrain, private leafGeoFor: (s: Species) => THREE.BufferGeometry, private leafColor: (t: TreeObj) => THREE.Color) {}

  has(id: number) {
    return this.actors.has(id);
  }

  /** Make (or get) the individual model for a tree that's being worked on. */
  ensure(t: TreeObj): Actor {
    let a = this.actors.get(t.id);
    if (a) return a;
    const dims = TRUNK[t.species];
    const geo = new THREE.CylinderGeometry(dims.r1, dims.r0, dims.h, 18, 36).translate(0, dims.h / 2, 0);
    const bark = new THREE.Color(BARK[t.species]);
    const col = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) { col[i] = bark.r; col[i + 1] = bark.g; col[i + 2] = bark.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const trunk = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    const leaves = new THREE.Mesh(this.leafGeoFor(t.species), new THREE.MeshStandardMaterial({ color: this.leafColor(t), roughness: 0.9, flatShading: true }));
    trunk.castShadow = leaves.castShadow = true;
    trunk.receiveShadow = leaves.receiveShadow = true;
    const group = new THREE.Group();
    group.add(trunk, leaves);
    this.group.add(group);
    a = {
      tree: t, group, trunk, leaves, base: Float32Array.from(geo.attributes.position.array as Float32Array),
      shakeT: 99, shakeAmp: 0, shakeAxis: new THREE.Vector3(1, 0, 0), yawQ: new THREE.Quaternion(),
    };
    this.actors.set(t.id, a);
    this.place(a);
    this.carve(a);
    return a;
  }

  /** Position, scale and orientation, from the tree's data. */
  place(a: Actor) {
    const t = a.tree;
    const { s, hs, yaw } = treeScale(t);
    a.group.position.set(t.x, this.terrain.heightAt(t.x, t.z) - 0.1, t.z);
    a.group.scale.set(s, s * hs, s);
    a.yawQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    a.group.quaternion.copy(a.yawQ);
  }

  remove(id: number) {
    const a = this.actors.get(id);
    if (!a) return;
    this.group.remove(a.group);
    a.trunk.geometry.dispose();
    this.actors.delete(id);
  }

  /** Cut the V-notch into the trunk to match how far the tree has been chopped. */
  private carve(a: Actor) {
    const t = a.tree;
    const chop = Math.min(1, t.chop ?? 0);
    const { yaw, hs } = treeScale(t);
    // The notch faces where the chopping comes from, in the trunk's own frame.
    const face = (t.notchDir ?? 0) - yaw;
    const fx = Math.sin(face), fz = Math.cos(face);
    const pos = a.trunk.geometry.attributes.position as THREE.BufferAttribute;
    const col = a.trunk.geometry.attributes.color as THREE.BufferAttribute;
    const bark = new THREE.Color(BARK[t.species]);
    const ny = NOTCH_Y / hs;
    const band = (0.2 + 0.22 * chop) / hs;
    for (let i = 0; i < pos.count; i++) {
      const x = a.base[i * 3], y = a.base[i * 3 + 1], z = a.base[i * 3 + 2];
      const r = Math.hypot(x, z);
      let cut = 0;
      if (r > 1e-4 && chop > 0) {
        const facing = (x * fx + z * fz) / r; // 1 = straight at the chopper
        const across = Math.max(0, (facing - 0.1) / 0.9);
        const along = Math.max(0, 1 - Math.abs(y - ny) / band);
        // V profile: deepest at the notch centre, opening wider as it deepens.
        cut = chop * 1.05 * r * along * Math.pow(across, 0.6);
      }
      const k = r > 1e-4 ? Math.max(0.02, r - cut) / r : 1;
      pos.setXYZ(i, x * k, y, z * k);
      const c = cut > 0.003 ? bark.clone().lerp(HEARTWOOD, Math.min(1, 0.35 + cut / (0.18 * r + 1e-4))) : bark;
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    a.trunk.geometry.computeVertexNormals();
  }

  /** World position of the notch's mouth. */
  notchPoint(t: TreeObj): THREE.Vector3 {
    const dims = TRUNK[t.species];
    const { s } = treeScale(t);
    const dir = t.notchDir ?? 0;
    const y = this.terrain.heightAt(t.x, t.z) - 0.1 + NOTCH_Y * s;
    const r = dims.r0 * s * 0.9;
    return new THREE.Vector3(t.x + Math.sin(dir) * r, y, t.z + Math.cos(dir) * r);
  }

  /** A blow lands: deepen the notch, shake the tree, throw chips and shake leaves loose. */
  hit(t: TreeObj, fromX: number, fromZ: number, strength: number, clean: boolean) {
    const a = this.ensure(t);
    this.carve(a);
    const dx = t.x - fromX, dz = t.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    // Tilt away from the blow.
    a.shakeAxis.set(dz / len, 0, -dx / len);
    a.shakeT = 0;
    a.shakeAmp = (clean ? 0.035 : 0.015) * (0.6 + strength);
    const at = this.notchPoint(t);
    const toward = new THREE.Vector3(-dx / len, 0, -dz / len);
    const n = clean ? 10 + Math.round(strength * 8) : 4;
    for (let k = 0; k < n; k++) {
      const v = toward.clone().multiplyScalar(1.5 + Math.random() * 2.5)
        .add(new THREE.Vector3((Math.random() - 0.5) * 2.2, 1 + Math.random() * 2.2, (Math.random() - 0.5) * 2.2));
      const pale = Math.random() < 0.7;
      this.spawn(this.chipGeo, pale ? 0xe6c792 : BARK[t.species], at, v, 2.5, 9.8, 0.4, true);
    }
    // A few leaves drift down from the crown.
    const { s, hs } = treeScale(t);
    const leafN = clean ? 3 + Math.round(strength * 4) : 1;
    for (let k = 0; k < leafN; k++) {
      const p = new THREE.Vector3(t.x + (Math.random() - 0.5) * 2.5 * s, this.terrain.heightAt(t.x, t.z) + (3 + Math.random() * 1.5) * s * hs, t.z + (Math.random() - 0.5) * 2.5 * s);
      this.spawn(this.leafGeo, this.leafColor(t).getHex(), p, new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.4, (Math.random() - 0.5) * 0.6), 4, 0.6, 1.6, true);
    }
  }

  /**
   * Fell the tree: it creaks, tips away from you with gathering speed, and
   * crashes down. `onLand` fires once at the moment of impact.
   */
  fell(t: TreeObj, dirX: number, dirZ: number, onLand: (x: number, z: number) => void) {
    const a = this.ensure(t);
    this.actors.delete(t.id);
    const { s, hs } = treeScale(t);
    const dims = TRUNK[t.species];
    // Everything below the notch stays behind as the stump.
    const pos = a.trunk.geometry.attributes.position as THREE.BufferAttribute;
    const ny = NOTCH_Y / hs;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < ny) pos.setY(i, ny);
    pos.needsUpdate = true;
    a.trunk.geometry.computeVertexNormals();
    // Hinge on the far side of the notch, at notch height.
    const len = Math.hypot(dirX, dirZ) || 1;
    const dir = new THREE.Vector2(dirX / len, dirZ / len);
    const base = this.terrain.heightAt(t.x, t.z) - 0.1;
    const hinge = new THREE.Vector3(t.x + dir.x * dims.r0 * s * 0.6, base + NOTCH_Y * s, t.z + dir.y * dims.r0 * s * 0.6);
    const pivot = new THREE.Group();
    pivot.position.copy(hinge);
    this.group.add(pivot);
    pivot.attach(a.group);
    const mats = [a.trunk.material as THREE.Material, a.leaves.material as THREE.Material];
    this.fallers.push({
      pivot, angle: 0.02, vel: 0.05, axis: new THREE.Vector3(dir.y, 0, -dir.x), landed: false, bounce: false,
      t: 0, fadeT: 0, length: dims.h * s * hs, dir, onLand, mats,
    });
  }

  /** Stumps are just scenery: a short trunk with a pale, freshly cut top. */
  syncStumps(list: Stump[]) {
    const live = new Set<string>();
    for (const st of list) {
      const key = `${st.x.toFixed(2)},${st.z.toFixed(2)}`;
      live.add(key);
      if (this.stumps.has(key)) continue;
      const dims = TRUNK[st.species];
      const h = NOTCH_Y * st.s;
      const r = dims.r0 * st.s;
      const geo = new THREE.CylinderGeometry(r * 0.96, r, h, 14).translate(0, h / 2, 0);
      const m = new THREE.Mesh(geo, [
        new THREE.MeshStandardMaterial({ color: BARK[st.species], roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0xe6c792, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: BARK[st.species] }),
      ]);
      m.position.set(st.x, this.terrain.heightAt(st.x, st.z) - 0.1, st.z);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.stumps.set(key, m);
    }
    for (const [k, m] of this.stumps) if (!live.has(k)) { this.group.remove(m); this.stumps.delete(k); }
  }

  private spawn(geo: THREE.BufferGeometry, color: number, at: THREE.Vector3, vel: THREE.Vector3, life: number, gravity: number, drag: number, settle: boolean, opacity = 1, grow?: number) {
    if (this.particles.length > 400) return;
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 1 }));
    mesh.position.copy(at);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.group.add(mesh);
    this.particles.push({
      mesh, vel, spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
      life, max: life, gravity, drag, settle, grow,
    });
  }

  update(dt: number) {
    // Hit wobble: a quick, decaying sway.
    const q = new THREE.Quaternion();
    for (const a of this.actors.values()) {
      if (a.shakeT > 3) continue;
      a.shakeT += dt;
      const ang = a.shakeAmp * Math.sin(a.shakeT * 26) * Math.exp(-a.shakeT * 4.5);
      q.setFromAxisAngle(a.shakeAxis, ang);
      a.group.quaternion.copy(q).multiply(a.yawQ);
    }

    // Falling trees: gravity torque grows as they lean, so they start slow and finish fast.
    for (const f of [...this.fallers]) {
      f.t += dt;
      if (!f.landed || f.bounce) {
        const g = 9.8 * 1.5 / Math.max(2, f.length);
        f.vel += g * Math.sin(f.angle + 0.02) * dt;
        f.angle += f.vel * dt;
        const maxAngle = this.restAngle(f);
        if (f.angle >= maxAngle) {
          f.angle = maxAngle;
          if (!f.landed) {
            f.landed = true;
            f.bounce = true;
            f.vel = -f.vel * 0.18;
            this.landEffects(f);
            const mid = f.length * 0.55;
            f.onLand(f.pivot.position.x + f.dir.x * mid, f.pivot.position.z + f.dir.y * mid);
          } else {
            f.bounce = false;
            f.vel = 0;
          }
        }
      }
      f.pivot.quaternion.setFromAxisAngle(f.axis, f.angle);
      if (f.landed && !f.bounce) {
        // Lie there a moment, then sink away (the logs are what's left).
        f.fadeT += dt;
        if (f.fadeT > 2.2) {
          const k = Math.min(1, (f.fadeT - 2.2) / 1.2);
          for (const m of f.mats) { m.transparent = true; m.opacity = 1 - k; }
          f.pivot.position.y -= dt * 0.3;
          if (k >= 1) {
            this.group.remove(f.pivot);
            f.pivot.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry !== this.chipGeo && (o.material as THREE.Material).dispose(); });
            this.fallers.splice(this.fallers.indexOf(f), 1);
          }
        }
      }
    }

    for (const p of [...this.particles]) {
      p.life -= dt;
      const m = p.mesh;
      const ground = this.terrain.heightAt(m.position.x, m.position.z) + 0.02;
      const resting = p.settle && m.position.y <= ground && p.vel.y <= 0;
      if (!resting) {
        p.vel.y -= p.gravity * dt;
        p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
        m.position.addScaledVector(p.vel, dt);
        m.rotation.x += p.spin.x * dt;
        m.rotation.y += p.spin.y * dt;
        m.rotation.z += p.spin.z * dt;
        if (p.settle && m.position.y < ground) {
          m.position.y = ground;
          p.vel.set(p.vel.x * 0.3, Math.abs(p.vel.y) * 0.2, p.vel.z * 0.3);
          p.spin.multiplyScalar(0.3);
          if (Math.abs(p.vel.y) < 0.3) p.vel.set(0, 0, 0);
        }
      }
      if (p.grow) m.scale.multiplyScalar(1 + p.grow * dt);
      const mat = m.material as THREE.MeshStandardMaterial;
      if (p.life < 1) mat.opacity = Math.max(0, p.life) * (p.grow ? 0.5 : 1);
      if (p.life <= 0) {
        this.group.remove(m);
        mat.dispose();
        this.particles.splice(this.particles.indexOf(p), 1);
      }
    }
  }

  /** How far a tree can tip before its crown hits the ground (follows the slope). */
  private restAngle(f: Faller): number {
    const reach = f.length * 0.8;
    const tipX = f.pivot.position.x + f.dir.x * reach;
    const tipZ = f.pivot.position.z + f.dir.y * reach;
    // Height of the hinge above the ground where the crown will land.
    const drop = f.pivot.position.y - this.terrain.heightAt(tipX, tipZ);
    // The crown has some bulk, so it touches down a little before the trunk axis would.
    return Math.acos(Math.max(-1, Math.min(1, (0.55 - drop) / reach)));
  }

  private landEffects(f: Faller) {
    // Dust along the trunk, a burst of leaves at the crown.
    for (let k = 0; k < 14; k++) {
      const along = 0.2 + Math.random() * 0.9;
      const x = f.pivot.position.x + f.dir.x * f.length * along + (Math.random() - 0.5) * 0.8;
      const z = f.pivot.position.z + f.dir.y * f.length * along + (Math.random() - 0.5) * 0.8;
      const p = new THREE.Vector3(x, this.terrain.heightAt(x, z) + 0.2, z);
      this.spawn(this.dustGeo, 0x9a8a6a, p, new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5), 1.8, 0.2, 1.4, false, 0.5, 0.9);
    }
    const crown = f.length * 0.85;
    for (let k = 0; k < 26; k++) {
      const x = f.pivot.position.x + f.dir.x * crown + (Math.random() - 0.5) * 2.5;
      const z = f.pivot.position.z + f.dir.y * crown + (Math.random() - 0.5) * 2.5;
      const p = new THREE.Vector3(x, this.terrain.heightAt(x, z) + 0.5 + Math.random() * 1.5, z);
      const col = (f.mats[1] as THREE.MeshStandardMaterial).color.getHex();
      this.spawn(this.leafGeo, col, p, new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3), 5, 1.2, 1.2, true);
    }
  }
}
