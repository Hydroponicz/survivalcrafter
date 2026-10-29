import * as THREE from 'three';
import { pieceBoxes, STRUCTURES } from '../data/structures';
import { WATER_LEVEL, Y_MIN, type Terrain } from '../world/terrain';
import { toLocal, type World } from '../world/world';
import type { Input } from './input';

const RADIUS = 0.3;
const EYE = 1.62;
const HEIGHT = 1.8;
/** Highest ledge you can walk straight up onto (stairs, floor edges). */
const STEP = 0.55;
const GRAVITY = 22;
const RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

export type CameraMode = 'first' | 'third';

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
  /** Set while placing a building piece, so the wheel rotates it instead of zooming. */
  wheelCaptured = false;
  sprinting = false;

  /** Timed conditions: poisoned, nauseous, refreshed. `rate` is damage per second where relevant. */
  effects: Record<string, { t: number; rate: number }> = {};
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

  /**
   * Ground under the feet: the voxel surface or the top of a built piece,
   * whichever is highest without being more than a step above the feet.
   */
  groundAt(world: World, x: number, y: number, z: number): { y: number; piece: boolean } {
    let g = world.terrain.groundBelow(x, y + STEP, z);
    let piece = false;
    for (const s of world.piecesNear(x, z)) {
      if (!s.built) continue;
      const [lx, , lz] = toLocal(s, x, y, z);
      for (const b of pieceBoxes(STRUCTURES[s.type], s.open)) {
        if (Math.abs(lx - b.c[0]) > b.h[0] + 0.05 || Math.abs(lz - b.c[2]) > b.h[2] + 0.05) continue;
        const top = s.y + b.c[1] + b.h[1];
        if (top <= y + STEP && top > g) { g = top; piece = true; }
      }
    }
    return { y: g, piece };
  }

  /**
   * How much a body standing with its feet at (x, y, z) overlaps solid things:
   * terrain samples inside the ground, plus how deep it sits in trees and pieces.
   * Zero means the spot is clear.
   */
  penetration(world: World, x: number, y: number, z: number): number {
    const t = world.terrain;
    let score = 0;
    for (const h of [STEP + 0.05, 1.1, HEIGHT - 0.1]) {
      if (t.solidAt(x, y + h, z)) score += 2;
      for (const [ox, oz] of RING) if (t.solidAt(x + ox * RADIUS, y + h, z + oz * RADIUS)) score++;
    }
    for (const o of world.near(x, z, 2.5)) {
      if (o.kind === 'tree') {
        if (o.age > 0.35) score += Math.max(0, RADIUS + 0.12 + 0.18 * o.age - Math.hypot(x - o.x, z - o.z)) * 10;
        continue;
      }
      if (o.kind !== 'structure' || !o.built) continue;
      const [lx, ly, lz] = toLocal(o, x, y, z);
      for (const b of pieceBoxes(STRUCTURES[o.type], o.open)) {
        const lo = b.c[1] - b.h[1], hi = b.c[1] + b.h[1];
        if (hi <= ly + STEP || lo >= ly + HEIGHT) continue;
        const px = b.h[0] + RADIUS - Math.abs(lx - b.c[0]);
        const pz = b.h[2] + RADIUS - Math.abs(lz - b.c[2]);
        if (px > 0 && pz > 0) score += Math.min(px, pz) * 10;
      }
    }
    return score;
  }

  /**
   * A move is allowed into clear space, or — if you're already wedged against
   * something (a steep bank, a tree) — anywhere that doesn't push you deeper,
   * so you can always walk back out.
   */
  private canMove(world: World, here: number, x: number, z: number): boolean {
    const there = this.penetration(world, x, this.pos.y, z);
    return there === 0 || there <= here - 1e-6 || (here > 0 && there <= here);
  }

  /** Nearest spot within a few metres where you can stand freely, or null. */
  findFreeSpot(world: World): THREE.Vector3 | null {
    const t = world.terrain;
    for (let r = 0; r <= 6; r += 0.5) {
      const n = Math.max(1, Math.round(r * 6));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
        if (x < 1 || z < 1 || x > t.size - 1 || z > t.size - 1) continue;
        const y = t.heightAt(x, z);
        if (y < WATER_LEVEL) continue;
        if (this.penetration(world, x, y + 0.05, z) === 0) return new THREE.Vector3(x, y + 0.05, z);
      }
    }
    return null;
  }

  update(dt: number, input: Input, world: World, busy: boolean, overweight: number, allowMove: boolean, fly = false) {
    const t = world.terrain;
    if (input.locked) {
      this.yaw -= input.mouseDX * 0.0022;
      this.pitch -= input.mouseDY * 0.0022;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
      if (this.cameraMode === 'third' && !this.wheelCaptured) this.camDist = Math.max(2, Math.min(12, this.camDist + input.wheel * 0.6));
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

    // Slopes: walking uphill is slow and tiring; very steep ground can't be walked up at all.
    if (len > 0 && !this.swimming && this.onGround) {
      const step = Math.hypot(dx, dz) * 0.15;
      const here = this.groundAt(world, this.pos.x, this.pos.y, this.pos.z);
      const ahead = this.groundAt(world, this.pos.x + dx * 0.15, this.pos.y, this.pos.z + dz * 0.15);
      const grade = (ahead.y - here.y) / Math.max(0.01, step);
      if (!ahead.piece && grade > 1.3) { dx = 0; dz = 0; }
      else if (grade > 0.35 && !ahead.piece) {
        const f = Math.max(0.25, 1 - (grade - 0.35) * 0.7);
        dx *= f; dz *= f;
        this.stamina -= dt * 4 * (grade - 0.35);
      }
    }

    this.vel.x = dx;
    this.vel.z = dz;
    const nx = this.pos.x + dx * dt, nz = this.pos.z + dz * dt;
    // Slide along walls: try the full move, then each axis on its own.
    if (dx || dz) {
      const here = this.penetration(world, this.pos.x, this.pos.y, this.pos.z);
      if (this.canMove(world, here, nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
      else if (this.canMove(world, here, nx, this.pos.z)) this.pos.x = nx;
      else if (this.canMove(world, here, this.pos.x, nz)) this.pos.z = nz;
    }
    const max = t.size - 0.5;
    this.pos.x = Math.max(0.5, Math.min(max, this.pos.x));
    this.pos.z = Math.max(0.5, Math.min(max, this.pos.z));

    // Vertical
    let ground = this.groundAt(world, this.pos.x, this.pos.y, this.pos.z).y;
    if (!Number.isFinite(ground)) ground = Y_MIN;
    const swimLevel = WATER_LEVEL - 1.25;
    this.swimming = ground < swimLevel && this.pos.y <= swimLevel + 0.05;
    if (this.swimming) {
      this.vel.y = 0;
      this.pos.y = swimLevel;
      this.onGround = false;
      this.stamina -= dt * 1.5;
    } else {
      if (this.onGround && allowMove && input.hit('Space') && this.stamina > 3) {
        this.vel.y = 6.5;
        this.stamina -= 3;
        this.onGround = false;
      }
      this.vel.y -= GRAVITY * dt;
      const ny = this.pos.y + this.vel.y * dt;
      // Bump your head on ceilings and cave roofs.
      if (this.vel.y > 0 && world.blockedAt(this.pos.x, ny + HEIGHT, this.pos.z)) this.vel.y = 0;
      else this.pos.y = ny;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      } else if (this.pos.y - ground < 0.3 && this.vel.y <= 0 && this.onGround) {
        // stick to the ground when walking downhill
        this.pos.y = ground;
        this.vel.y = 0;
      } else {
        this.onGround = false;
      }
      if (this.pos.y < swimLevel && ground < swimLevel) this.pos.y = swimLevel;
    }

    if (this.sprinting) this.stamina -= dt * 9;
    this.stamina = Math.max(0, this.stamina);
    this.animate(dt);
  }

  /** Dev fly mode: free movement, no gravity or collisions. */
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
    const max = world.terrain.size - 0.5;
    this.pos.x = Math.max(0.5, Math.min(max, this.pos.x));
    this.pos.z = Math.max(0.5, Math.min(max, this.pos.z));
    this.pos.y = Math.max(Y_MIN + 1, Math.min(200, this.pos.y));
    this.moving = mx !== 0 || mz !== 0 || my !== 0;
    this.sprinting = false;
    this.swimming = false;
    this.onGround = false;
    this.animate(dt);
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
    this.model.visible = this.cameraMode === 'third';
    const eye = this.eye;
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
    // Pull the camera in rather than letting it clip into hills or cave walls.
    let d = 0.3;
    while (d < this.camDist && !terrain.solidAt(target.x - f.x * (d + 0.3), target.y - f.y * (d + 0.3), target.z - f.z * (d + 0.3))) d += 0.15;
    const pos = target.clone().addScaledVector(f, -d);
    cam.position.copy(pos);
    cam.lookAt(target.clone().addScaledVector(f, 4));
  }
}
