import * as THREE from 'three';
import type { ToolKind } from '../data/items';
import { pieceBoxes, STRUCTURES } from '../data/structures';
import { buildToolMesh, swingPose, type SwingKind } from './tools';
import { Y_MIN, type Terrain } from '../world/terrain';
import { toLocal, type World } from '../world/world';
import { treeScale, TRUNK } from '../world/treefx';
import type { Input } from './input';

const RADIUS = 0.3;
const EYE = 1.62;
const HEIGHT = 1.8;
/** Highest ledge you can walk straight up onto (stairs, floor edges). */
const STEP = 0.55;
const GRAVITY = 22;
/** Ground steeper than this (degrees) is hard going; steeper than TOO_STEEP can't be climbed and you slide. */
const STEEP = 28;
const TOO_STEEP = 42;
const MAX_SLIDE = 8;
const RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

export type CameraMode = 'first' | 'third';

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = -0.1;
  onGround = false;
  swimming = false;
  /** Feet in water but not deep enough to swim. */
  wading = false;
  cameraMode: CameraMode = 'first';
  camDist = 4.5;
  moving = false;
  /** How the ground under you is treating you, for feedback: fine, hard going, too steep to climb, or sliding. */
  slope: 'ok' | 'steep' | 'blocked' | 'sliding' = 'ok';
  /** Downhill slide velocity (m/s, x/z). */
  slide = new THREE.Vector2();
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
  private parts = {} as Record<'armL' | 'armR' | 'legL' | 'legR' | 'head' | 'upper', THREE.Object3D>;
  private walkPhase = 0;
  swing = 0; // 0..1 action animation (legacy, for actions without a swing)
  /** The current tool swing, driven by the running action. */
  swingAnim: { kind: SwingKind; phase: number; impactAt: number } | null = null;
  /** While working on something, the body turns to face it (world yaw). */
  faceYaw: number | null = null;
  heldItem = new THREE.Group();
  private heldKind: ToolKind | undefined;
  private shakeAmt = 0;
  private modelYaw = 0;

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
    // Legs hang from the hips; everything above twists and leans as one (pivot at the hips).
    const legL = box(0.2, 0.82, 0.2, 0x4a4036, true);
    legL.position.set(-0.13, 0.82, 0);
    const legR = box(0.2, 0.82, 0.2, 0x4a4036, true);
    legR.position.set(0.13, 0.82, 0);
    const upper = new THREE.Group();
    upper.position.y = 0.85;
    const torso = box(0.5, 0.65, 0.28, 0x6b5a3e);
    torso.position.y = 0.3;
    const belt = box(0.52, 0.08, 0.3, 0x3a2a1a);
    const head = box(0.3, 0.32, 0.3, 0xd9a982);
    head.position.y = 0.81;
    const hair = box(0.32, 0.1, 0.32, 0x4a3020);
    hair.position.y = 0.98;
    const nose = box(0.05, 0.06, 0.05, 0xc9926c);
    nose.position.set(0, 0.79, 0.17);
    const armL = box(0.15, 0.62, 0.15, 0x6b5a3e, true);
    armL.position.set(-0.33, 0.6, 0);
    const armR = box(0.15, 0.62, 0.15, 0x6b5a3e, true);
    armR.position.set(0.33, 0.6, 0);
    for (const arm of [armL, armR]) {
      const hand = box(0.13, 0.12, 0.13, 0xd9a982);
      hand.position.y = -0.62;
      arm.add(hand);
    }
    // The tool sits in the right fist, pointing forward out of it.
    this.heldItem.position.set(0, -0.63, 0);
    this.heldItem.rotation.x = Math.PI / 2;
    armR.add(this.heldItem);
    upper.add(torso, belt, head, hair, nose, armL, armR);
    g.add(legL, legR, upper);
    this.parts = { armL, armR, legL, legR, head, upper };
    return g;
  }

  setHeld(kind: ToolKind | undefined, itemType?: string) {
    this.heldItem.clear();
    this.heldKind = kind;
    if (kind) this.heldItem.add(buildToolMesh(kind, itemType));
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

  /** Terrain normal under the feet, averaged over a small patch so single voxels don't jolt it. */
  private groundNormal(world: World, x: number, y: number, z: number): THREE.Vector3 {
    const t = world.terrain;
    const n = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    for (const [ox, oz] of [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) {
      const gy = ox || oz ? t.groundBelow(x + ox, y + 0.6, z + oz) : y;
      n.add(t.normalAt(x + ox, (Number.isFinite(gy) ? gy : y) - 0.05, z + oz, tmp));
    }
    return n.normalize();
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
        // The trunk, as thick as this tree really is.
        if (o.age > 0.35) score += Math.max(0, RADIUS + TRUNK[o.species].r0 * treeScale(o).s * 0.9 - Math.hypot(x - o.x, z - o.z)) * 10;
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
        if (y < t.waterAt(x, z)) continue;
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
    if (this.wading) speed *= 0.6;
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

    // Slopes. Gentle ground is just tiring; steep ground slows you and drains
    // stamina; ground that's too steep can't be climbed at all: the uphill part
    // of your movement is lost (you can still go sideways or down) and you slide.
    this.slope = 'ok';
    let slideAccel = 0;
    let downhill: THREE.Vector2 | null = null;
    if (!this.swimming && this.onGround) {
      const here = this.groundAt(world, this.pos.x, this.pos.y, this.pos.z);
      if (!here.piece && Number.isFinite(here.y)) {
        const n = this.groundNormal(world, this.pos.x, here.y, this.pos.z);
        const angle = Math.acos(Math.min(1, Math.max(-1, n.y))) * 180 / Math.PI;
        const hl = Math.hypot(n.x, n.z);
        if (hl > 1e-3) downhill = new THREE.Vector2(n.x / hl, n.z / hl);
        if (downhill && angle > STEEP) {
          // How hard you're pushing uphill (m/s).
          const up = -(dx * downhill.x + dz * downhill.y);
          const tooSteep = angle > TOO_STEEP || this.stamina <= 0;
          if (tooSteep) {
            if (up > 0) { dx += up * downhill.x; dz += up * downhill.y; this.slope = 'blocked'; }
            slideAccel = 9.8 * (Math.sin(angle * Math.PI / 180) - 0.55 * Math.cos(angle * Math.PI / 180));
          } else if (up > 0) {
            // Climbable but hard going: keep only part of the uphill effort.
            const k = (angle - STEEP) / (TOO_STEEP - STEEP);
            const keep = 1 - 0.7 * k;
            dx += up * (1 - keep) * downhill.x;
            dz += up * (1 - keep) * downhill.y;
            this.stamina -= dt * (3 + 9 * k);
            this.slope = 'steep';
          }
        }
      }
      // A cliff face just ahead (a sharp rise the feet can't step up): turn the
      // push into movement along the face rather than stopping dead.
      if ((dx || dz) && this.slope !== 'blocked' && Number.isFinite(here.y)) {
        const ax = this.pos.x + dx * 0.15, az = this.pos.z + dz * 0.15;
        const ahead = this.groundAt(world, ax, this.pos.y, az);
        const rise = ahead.y - here.y;
        const run = Math.hypot(dx, dz) * 0.15;
        if (!ahead.piece && Number.isFinite(ahead.y) && rise / Math.max(0.01, run) > Math.tan(TOO_STEEP * Math.PI / 180)) {
          const n = this.groundNormal(world, ax, ahead.y, az);
          const hl = Math.hypot(n.x, n.z);
          if (hl > 1e-3) {
            const ux = n.x / hl, uz = n.z / hl;
            const up = -(dx * ux + dz * uz);
            if (up > 0) { dx += up * ux; dz += up * uz; }
          }
          this.slope = 'blocked';
        }
      }
    }
    // Sliding: pick up speed down a too-steep slope; friction stops you once it levels out.
    if (slideAccel > 0 && downhill) {
      this.slide.x += downhill.x * slideAccel * dt;
      this.slide.y += downhill.y * slideAccel * dt;
      const sp = this.slide.length();
      if (sp > MAX_SLIDE) this.slide.multiplyScalar(MAX_SLIDE / sp);
    } else {
      this.slide.multiplyScalar(Math.exp(-(this.onGround ? 7 : 0.5) * dt));
      if (this.slide.length() < 0.15) this.slide.set(0, 0);
    }
    if (this.slide.length() > 0.6) this.slope = 'sliding';
    dx += this.slide.x;
    dz += this.slide.y;

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
    const surface = world.terrain.waterAt(this.pos.x, this.pos.z);
    const swimLevel = surface - 1.25;
    // Wading through a stream or the shallows is slow going.
    this.wading = !this.swimming && this.pos.y < surface - 0.25;
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

  /** Camera shake (e.g. a heavy chop or a tree landing nearby). */
  shake(amount: number) {
    this.shakeAmt = Math.min(1, Math.max(this.shakeAmt, amount));
  }

  private scramble = 0;

  private animate(dt: number) {
    if (this.slope === 'blocked') this.scramble += dt; else this.scramble = 0;
    if (this.slope === 'sliding') this.shake(0.18);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.1 && this.onGround) this.walkPhase += dt * speed * 2.2;
    else this.walkPhase *= 0.9;
    const s = Math.sin(this.walkPhase) * Math.min(1, speed / 3) * 0.7;
    const p = this.parts;
    p.legL.rotation.x = s;
    p.legR.rotation.x = -s;
    p.armL.rotation.set(-s * 0.8, 0, 0);
    p.armR.rotation.set(s * 0.8, 0, 0);
    p.upper.rotation.set(0, 0, 0);
    p.upper.position.y = 0.85;
    const sw = this.swingAnim;
    if (sw) {
      const { raise, drive, jolt } = swingPose(sw.kind, sw.phase, sw.impactAt);
      if (sw.kind === 'chop') {
        // Two-handed: wind up over the right shoulder, twist through, drive the blade in.
        const armX = -1.15 - 1.75 * raise + 0.25 * jolt;
        p.armR.rotation.set(armX, 0, 0.45 + 0.25 * raise);
        p.armL.rotation.set(armX + 0.1, 0, -0.35 + 0.15 * raise);
        p.upper.rotation.set(-0.12 * raise + 0.32 * drive - 0.06 * jolt, 0.55 * raise - 0.35 * drive, 0);
        p.legL.rotation.x = -0.15 * drive;
        p.legR.rotation.x = 0.2 * drive;
        p.upper.position.y = 0.85 - 0.05 * drive;
      } else if (sw.kind === 'dig') {
        // Shovel: lean in, push the blade down, then lever it back.
        const armX = -0.75 - 0.35 * raise + 0.25 * drive;
        p.armR.rotation.set(armX, 0, 0.3);
        p.armL.rotation.set(armX - 0.25, 0, -0.3);
        p.upper.rotation.set(0.15 + 0.35 * drive, 0.1, 0);
      } else {
        p.armR.rotation.set(-0.6 - drive * 0.9, 0, 0.1);
        p.upper.rotation.set(drive * 0.25, 0, 0);
      }
    } else if (this.slope === 'sliding') {
      // Skidding down on your heels: lean back, legs braced forward, arms out for balance.
      p.upper.rotation.set(-0.4, 0, 0);
      p.legL.rotation.x = -0.65;
      p.legR.rotation.x = -0.35;
      p.armL.rotation.set(-0.5, 0, -1.1 + Math.sin(this.walkPhase * 3) * 0.15);
      p.armR.rotation.set(-0.5, 0, 1.1 - Math.sin(this.walkPhase * 3) * 0.15);
      p.upper.position.y = 0.72;
    } else if (this.slope === 'blocked') {
      // Scrabbling at a slope you can't get up: hunched forward, legs churning, hands grasping.
      const k = Math.sin(this.scramble * 14);
      p.upper.rotation.set(0.45, 0, 0);
      p.legL.rotation.x = 0.5 * k - 0.2;
      p.legR.rotation.x = -0.5 * k - 0.2;
      p.armL.rotation.set(-2.2 + 0.4 * k, 0, -0.2);
      p.armR.rotation.set(-2.2 - 0.4 * k, 0, 0.2);
    } else if (this.swing > 0) {
      p.armR.rotation.x = -1.2 - Math.sin(this.swing * Math.PI * 2) * 0.9;
    } else if (this.heldKind) {
      // Carry the tool a little forward.
      p.armR.rotation.x = -0.35 + s * 0.4;
    }
    this.model.position.copy(this.pos);
    if (this.swimming) this.model.position.y += 0.3;
    // Local +Z is the front of the body: face the work, otherwise the way you're looking.
    const want = this.faceYaw ?? this.yaw + Math.PI;
    let d = want - this.modelYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.modelYaw += d * Math.min(1, dt * 14);
    this.model.rotation.y = this.modelYaw;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.8);
  }

  private applyShake(cam: THREE.PerspectiveCamera) {
    if (this.shakeAmt <= 0) return;
    const a = this.shakeAmt * this.shakeAmt * 0.035;
    cam.rotateX((Math.random() - 0.5) * a);
    cam.rotateY((Math.random() - 0.5) * a);
    cam.rotateZ((Math.random() - 0.5) * a * 0.6);
  }

  updateCamera(cam: THREE.PerspectiveCamera, terrain: Terrain) {
    this.model.visible = this.cameraMode === 'third';
    const eye = this.eye;
    if (this.cameraMode === 'first') {
      cam.position.copy(eye);
      cam.lookAt(eye.clone().add(this.forward()));
      this.applyShake(cam);
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
    this.applyShake(cam);
  }
}
