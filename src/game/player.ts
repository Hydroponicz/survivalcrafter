import * as THREE from 'three';
import { STRUCTURES } from '../data/structures';
import { TILE, WATER_LEVEL, type Terrain } from '../world/terrain';
import type { World } from '../world/world';
import type { Input } from './input';

const RADIUS = 0.32;
const EYE = 1.62;
const GRAVITY = 22;

export type CameraMode = 'first' | 'third';

interface Obstacle { type: 'circle'; x: number; z: number; r: number }
interface BoxObstacle { type: 'box'; x: number; z: number; hx: number; hz: number }

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = -0.1;
  onGround = false;
  swimming = false;
  cameraMode: CameraMode = 'first';
  camDist = 4.5;
  moving = false;
  sprinting = false;

  health = 100;
  food = 80;
  water = 80;
  stamina = 100;

  model: THREE.Group;
  private parts: Record<string, THREE.Object3D> = {};
  private walkPhase = 0;
  swing = 0; // 0..1 action animation
  heldItem = new THREE.Group();

  constructor() {
    this.model = this.buildModel();
  }

  private buildModel(): THREE.Group {
    const g = new THREE.Group();
    const m = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
    const box = (w: number, h: number, d: number, c: number, pivotTop = false) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      if (pivotTop) geo.translate(0, -h / 2, 0);
      const mesh = new THREE.Mesh(geo, m(c));
      mesh.castShadow = true;
      return mesh;
    };
    const torso = box(0.5, 0.65, 0.28, 0x6b5a3e);
    torso.position.y = 1.15;
    const belt = box(0.52, 0.08, 0.3, 0x3a2a1a);
    belt.position.y = 0.85;
    const head = box(0.3, 0.32, 0.3, 0xd9a982);
    head.position.y = 1.66;
    const hair = box(0.32, 0.1, 0.32, 0x4a3020);
    hair.position.y = 1.83;
    const armL = box(0.15, 0.62, 0.15, 0x6b5a3e, true);
    armL.position.set(-0.33, 1.45, 0);
    const armR = box(0.15, 0.62, 0.15, 0x6b5a3e, true);
    armR.position.set(0.33, 1.45, 0);
    const legL = box(0.2, 0.82, 0.2, 0x4a4036, true);
    legL.position.set(-0.13, 0.82, 0);
    const legR = box(0.2, 0.82, 0.2, 0x4a4036, true);
    legR.position.set(0.13, 0.82, 0);
    this.heldItem.position.set(0, -0.6, 0.1);
    armR.add(this.heldItem);
    g.add(torso, belt, head, hair, armL, armR, legL, legR);
    this.parts = { armL, armR, legL, legR, head };
    return g;
  }

  setHeld(kind: string | undefined) {
    this.heldItem.clear();
    if (!kind) return;
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a38 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.4, roughness: 0.5 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 5), wood);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.25;
    this.heldItem.add(handle);
    const head = new THREE.Mesh(new THREE.BoxGeometry(kind === 'shovel' ? 0.2 : 0.06, kind === 'shovel' ? 0.02 : 0.18, 0.12), metal);
    head.position.z = 0.55;
    this.heldItem.add(head);
  }

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + (this.swimming ? 1.2 : EYE), this.pos.z);
  }

  forward(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }

  /** Ground height including walkable structures like floors. */
  groundAt(world: World, x: number, z: number): number {
    const t = world.terrain;
    let h = t.heightAt(x, z);
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    const s = world.structureAt(tx, tz);
    if (s && s.built && s.type === 'floor') {
      const base = Math.min(t.cornerH(tx, tz), t.cornerH(tx + 1, tz), t.cornerH(tx, tz + 1), t.cornerH(tx + 1, tz + 1));
      h = Math.max(h, base + 0.12 + t.tileSlope(tx, tz) / 10);
    }
    return h;
  }

  update(dt: number, input: Input, world: World, busy: boolean, overweight: number, allowMove: boolean, fly = false) {
    const t = world.terrain;
    if (input.locked) {
      this.yaw -= input.mouseDX * 0.0022;
      this.pitch -= input.mouseDY * 0.0022;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
      if (this.cameraMode === 'third') this.camDist = Math.max(2, Math.min(12, this.camDist + input.wheel * 0.6));
    }

    const k = input.keys;
    if (fly) return this.flyUpdate(dt, k, world, allowMove);
    let mx = 0, mz = 0;
    if (allowMove) {
      if (k.has('KeyW')) mz -= 1;
      if (k.has('KeyS')) mz += 1;
      if (k.has('KeyA')) mx -= 1;
      if (k.has('KeyD')) mx += 1;
    }
    const len = Math.hypot(mx, mz);
    this.moving = len > 0;
    this.sprinting = this.moving && k.has('ShiftLeft') && this.stamina > 5 && !this.swimming;
    let speed = this.swimming ? 2.2 : this.sprinting ? 6.5 : 3.6;
    if (overweight > 0) speed *= Math.max(0.15, 1 - overweight / 40);
    if (this.stamina <= 0) speed *= 0.6;
    if (busy) speed *= 0.5;

    let dx = 0, dz = 0;
    if (len > 0) {
      mx /= len; mz /= len;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      dx = (mx * c + mz * s) * speed;
      dz = (-mx * s + mz * c) * speed;
    }

    // Slopes: walking uphill is slow and tiring, like hauling yourself up a Wurm hillside.
    const here = this.groundAt(world, this.pos.x, this.pos.z);
    if (len > 0 && !this.swimming) {
      const ahead = this.groundAt(world, this.pos.x + dx * 0.15, this.pos.z + dz * 0.15);
      const grade = (ahead - here) / Math.max(0.01, Math.hypot(dx, dz) * 0.15);
      if (grade > 0.35) {
        const f = Math.max(0.2, 1 - (grade - 0.35) * 0.8);
        dx *= f; dz *= f;
        this.stamina -= dt * 4 * (grade - 0.35);
      }
    }

    this.vel.x = dx;
    this.vel.z = dz;
    const nx = this.pos.x + dx * dt;
    const nz = this.pos.z + dz * dt;
    const resolved = this.collide(world, nx, nz);
    const maxXZ = t.size * TILE - 0.5;
    this.pos.x = Math.max(0.5, Math.min(maxXZ, resolved.x));
    this.pos.z = Math.max(0.5, Math.min(maxXZ, resolved.z));

    // Vertical
    const ground = this.groundAt(world, this.pos.x, this.pos.z);
    const swimLevel = WATER_LEVEL - 1.25;
    this.swimming = ground < swimLevel && this.pos.y <= swimLevel + 0.05;
    if (this.swimming) {
      this.vel.y = 0;
      this.pos.y = swimLevel;
      this.onGround = false;
      this.stamina -= dt * 1.5;
      if (k.has('Space') && allowMove) this.pos.y = swimLevel;
    } else {
      if (this.onGround && allowMove && input.hit('Space') && this.stamina > 3) {
        this.vel.y = 6.5;
        this.stamina -= 3;
        this.onGround = false;
      }
      this.vel.y -= GRAVITY * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      } else if (this.pos.y - ground < 0.25 && this.vel.y <= 0) {
        // stick to the ground when walking downhill
        this.pos.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      } else {
        this.onGround = false;
      }
      if (this.pos.y < swimLevel && ground < swimLevel) this.pos.y = swimLevel;
    }

    if (this.sprinting) this.stamina -= dt * 9;
    this.stamina = Math.max(0, this.stamina);
    this.animate(dt);
  }

  /** Dev fly mode: free movement along the view direction, no gravity or collisions. */
  private flyUpdate(dt: number, k: Set<string>, world: World, allowMove: boolean) {
    let mx = 0, mz = 0, my = 0;
    if (allowMove) {
      if (k.has('KeyW')) mz -= 1;
      if (k.has('KeyS')) mz += 1;
      if (k.has('KeyA')) mx -= 1;
      if (k.has('KeyD')) mx += 1;
      if (k.has('Space')) my += 1;
      if (k.has('KeyQ')) my -= 1;
    }
    const speed = k.has('ShiftLeft') ? 28 : 10;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.vel.set((mx * c + mz * s) * speed, my * speed, (-mx * s + mz * c) * speed);
    this.pos.addScaledVector(this.vel, dt);
    const maxXZ = world.terrain.size * TILE - 0.5;
    this.pos.x = Math.max(0.5, Math.min(maxXZ, this.pos.x));
    this.pos.z = Math.max(0.5, Math.min(maxXZ, this.pos.z));
    this.pos.y = Math.max(this.groundAt(world, this.pos.x, this.pos.z), Math.min(200, this.pos.y));
    this.moving = mx !== 0 || mz !== 0 || my !== 0;
    this.sprinting = false;
    this.swimming = false;
    this.onGround = false;
    this.animate(dt);
  }

  private obstacles(world: World, x: number, z: number): (Obstacle | BoxObstacle)[] {
    const out: (Obstacle | BoxObstacle)[] = [];
    for (const o of world.near(x, z, 3)) {
      if (o.kind === 'tree') {
        if (o.age > 0.35) out.push({ type: 'circle', x: o.x, z: o.z, r: 0.12 + 0.18 * o.age });
      } else if (o.kind === 'structure' && o.built) {
        const def = STRUCTURES[o.type];
        if (o.type === 'floor' || (def.gate && o.open)) continue;
        if (def.placement === 'edge') {
          const long = TILE / 2 + 0.05, thin = o.type === 'stone_wall' ? 0.22 : 0.12;
          out.push({ type: 'box', x: o.x, z: o.z, hx: o.axis === 'x' ? long : thin, hz: o.axis === 'x' ? thin : long });
        } else if (o.type === 'campfire') {
          out.push({ type: 'circle', x: o.x, z: o.z, r: 0.55 });
        } else {
          const half: Record<string, [number, number]> = {
            forge: [0.75, 0.65], anvil: [0.5, 0.25], quern: [0.6, 0.6], workbench: [0.8, 0.4], chest: [0.5, 0.3], bed: [0.5, 0.95],
          };
          const [hx, hz] = half[o.type] ?? [0.5, 0.5];
          out.push({ type: 'box', x: o.x, z: o.z, hx, hz });
        }
      }
    }
    return out;
  }

  private collide(world: World, x: number, z: number): { x: number; z: number } {
    for (const ob of this.obstacles(world, x, z)) {
      if (ob.type === 'circle') {
        const dx = x - ob.x, dz = z - ob.z;
        const d = Math.hypot(dx, dz);
        const min = ob.r + RADIUS;
        if (d < min && d > 1e-5) {
          x = ob.x + (dx / d) * min;
          z = ob.z + (dz / d) * min;
        }
      } else {
        const cx = Math.max(ob.x - ob.hx, Math.min(x, ob.x + ob.hx));
        const cz = Math.max(ob.z - ob.hz, Math.min(z, ob.z + ob.hz));
        const dx = x - cx, dz = z - cz;
        const d = Math.hypot(dx, dz);
        if (d < RADIUS) {
          if (d > 1e-5) {
            x = cx + (dx / d) * RADIUS;
            z = cz + (dz / d) * RADIUS;
          } else {
            // centre inside the box: push out along the shallowest axis
            const px = ob.hx + RADIUS - Math.abs(x - ob.x);
            const pz = ob.hz + RADIUS - Math.abs(z - ob.z);
            if (px < pz) x += Math.sign(x - ob.x || 1) * px;
            else z += Math.sign(z - ob.z || 1) * pz;
          }
        }
      }
    }
    return { x, z };
  }

  private animate(dt: number) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.1 && this.onGround) this.walkPhase += dt * speed * 2.2;
    else this.walkPhase *= 0.9;
    const s = Math.sin(this.walkPhase) * Math.min(1, speed / 3) * 0.7;
    const p = this.parts;
    p.legL.rotation.x = s;
    p.legR.rotation.x = -s;
    p.armL.rotation.x = -s * 0.8;
    // Action swing overrides the right arm
    p.armR.rotation.x = this.swing > 0 ? -1.2 - Math.sin(this.swing * Math.PI * 2) * 0.9 : s * 0.8;
    this.model.position.copy(this.pos);
    if (this.swimming) this.model.position.y += 0.3;
    this.model.rotation.y = this.yaw;
  }

  updateCamera(cam: THREE.PerspectiveCamera, terrain: Terrain) {
    const eye = this.eye;
    this.model.visible = this.cameraMode === 'third';
    if (this.cameraMode === 'first') {
      cam.position.copy(eye);
      cam.lookAt(eye.clone().add(this.forward()));
      return;
    }
    const f = this.forward();
    const target = eye.clone().add(new THREE.Vector3(0, 0.2, 0));
    // Shoulder offset so the crosshair isn't blocked by your own head.
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    target.addScaledVector(right, 0.45);
    let d = this.camDist;
    const pos = target.clone().addScaledVector(f, -d);
    const minY = terrain.heightAt(pos.x, pos.z) + 0.3;
    if (pos.y < minY) pos.y = minY;
    cam.position.copy(pos);
    cam.lookAt(target.clone().addScaledVector(f, 4));
  }
}
