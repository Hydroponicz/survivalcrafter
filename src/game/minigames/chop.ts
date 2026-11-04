import * as THREE from 'three';
import { itemDef } from '../../data/items';
import { buildToolMesh } from '../tools';
import { clamp01, Minigame, type Meter, type MgInput } from './core';
import { sfx } from './sfx';
import type { Gesture } from './tutorials';

// Splitting wood on the chopping block, out in the world. The view goes to the
// block; a log (or a rough plank) is stood on end on it; gold lines across its
// top show where to split. A ring closes on the line: strike as it turns green
// and the hatchet comes down over your shoulder and splits a piece off, which
// topples off the block. A log gives two rough planks (and two bark slabs); a
// plank gives four sticks of kindling.

export type ChopVariant = 'planks' | 'kindling';

/** Where the block is (a chopping block, or any spot for a stand-in). */
export interface BlockSpot { x: number; y: number; z: number; top: number }

type Phase = 'arrive' | 'set' | 'split' | 'done';

interface Piece {
  /** Turns about its outer bottom edge to fall; the mesh sits inside. */
  pivot: THREE.Group;
  x0: number; x1: number;
  /** -1 / +1: falling that way (0: still standing), and how far through the fall. */
  fall: number; t: number;
}

/** The hatchet held ready (radians back from the blow), and the blow's timing (s). */
const READY = -1.75;
const DOWN = 0.11, RECOIL = 0.4;

/** Colours of the wood. */
const BARK = new THREE.Color(0x5a4330), CUT = new THREE.Color(0xdcb87c), END = new THREE.Color(0xc29a62);

/** Each split, in the order you make them: the line (across, m) and which pieces fall. */
interface Spec { lines: number[]; pieces: [number, number][]; round: number; depth: number; height: number }
const SPECS: Record<ChopVariant, Spec> = {
  // A log on end: a bark slab off each side, then down the middle for two planks.
  planks: { lines: [-0.085, 0.085, 0], pieces: [[-0.17, -0.085], [-0.085, 0], [0, 0.085], [0.085, 0.17]], round: 0.17, depth: 0, height: 0.46 },
  // A rough plank on end: a stick off each side, then down the middle.
  kindling: { lines: [-0.05, 0.05, 0], pieces: [[-0.1, -0.05], [-0.05, 0], [0, 0.05], [0.05, 0.1]], round: 0, depth: 0.05, height: 0.42 },
};

/** A slice of the log (or plank) between two lines, standing on end (y up from 0). */
function pieceGeometry(spec: Spec, a: number, b: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const R = spec.round;
  if (R > 0) {
    // The round of the log between x = a and x = b.
    const pts: THREE.Vector2[] = [];
    const n = 10;
    for (let k = 0; k <= n; k++) { const x = a + (b - a) * (k / n); pts.push(new THREE.Vector2(x, Math.sqrt(Math.max(0, R * R - x * x)))); }
    for (let k = n; k >= 0; k--) { const x = a + (b - a) * (k / n); pts.push(new THREE.Vector2(x, -Math.sqrt(Math.max(0, R * R - x * x)))); }
    shape.setFromPoints(pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1e-4));
  } else {
    const d = spec.depth / 2;
    shape.moveTo(a, -d); shape.lineTo(b, -d); shape.lineTo(b, d); shape.lineTo(a, d); shape.lineTo(a, -d);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: spec.height, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).toNonIndexed();
  geo.computeVertexNormals();
  // Bark round the outside, pale fresh wood where it's split, darker end grain.
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 3) {
    let c = CUT;
    if (Math.abs(nor.getY(i)) > 0.9) c = END;
    else if (R > 0) {
      let outside = true;
      for (let k = 0; k < 3; k++) if (Math.hypot(pos.getX(i + k), pos.getZ(i + k)) < R - 0.004) outside = false;
      if (outside) c = BARK;
    }
    for (let k = 0; k < 3; k++) c.toArray(col, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export class ChopGame extends Minigame {
  readonly title: string;
  readonly instructions: string;
  /** Played out in the world itself (the game draws it from this camera). */
  readonly inWorld = true;
  /** You're seen at the block, swinging the hatchet yourself. */
  readonly hidesPlayer = false;
  readonly overlay = new THREE.Group();
  readonly stand: { x: number; z: number; yaw: number };
  /** A warm light on the work at night. */
  readonly workLight = new THREE.Vector3();
  private spec: Spec;
  private phase: Phase = 'arrive';
  private t = 0;
  /** The work's own frame: on the block's top, +z toward you, +x across. */
  private work = new THREE.Group();
  private stock = new THREE.Group();
  private pieces: Piece[] = [];
  /** Which pieces are still joined to the next (one flag per line, in order across). */
  private joined: boolean[];
  private sorted: number[];
  private step = 0;
  private guides: THREE.Mesh[] = [];
  private ring: THREE.Mesh;
  private target: THREE.Mesh;
  private ringT = 0;
  private period: number;
  private strikes: number[] = [];
  private pivot = new THREE.Group();
  private tool: THREE.Object3D | null;
  private headY = 0.5;
  private edgeZ = 0.15;
  private swingT = -1;
  private pending: number | null = null;
  private camFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private camTo = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private chips: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  constructor(ease: number, private variant: ChopVariant, block: BlockSpot, toolType: string | undefined, from: THREE.Camera) {
    super(ease);
    this.spec = SPECS[variant];
    this.title = variant === 'planks' ? 'Splitting a log' : 'Splitting kindling';
    this.instructions = variant === 'planks'
      ? 'The log stands on the block. Split along each gold line: a ring closes on it — click when it turns green and the hatchet comes down. A bark slab comes off each side, then the middle splits into two rough planks.'
      : 'The plank stands on the block. Split along each gold line: a ring closes on it — click when it turns green and the hatchet comes down. Each blow splits off a stick of kindling.';
    this.period = 1.2 + ease * 0.5;
    this.joined = this.spec.lines.map(() => true);
    this.sorted = [...this.spec.lines].sort((a, b) => a - b);

    // Face the block from where you are.
    const toYou = new THREE.Vector3(from.position.x - block.x, 0, from.position.z - block.z);
    if (toYou.lengthSq() < 1e-4) toYou.set(0, 0, 1);
    toYou.normalize();
    const yaw = Math.atan2(toYou.x, toYou.z);
    this.work.position.set(block.x, block.top, block.z);
    this.work.rotation.y = yaw;
    this.overlay.add(this.work);
    this.overlay.updateMatrixWorld(true);
    const standAt = new THREE.Vector3(block.x, 0, block.z).addScaledVector(toYou, 0.95);
    this.stand = { x: standAt.x, z: standAt.z, yaw };

    // The wood, in its pieces (joined until split).
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    for (const [a, b] of this.spec.pieces) {
      const mesh = new THREE.Mesh(pieceGeometry(this.spec, a, b), mat);
      mesh.castShadow = true;
      const pivot = new THREE.Group();
      pivot.add(mesh);
      this.stock.add(pivot);
      this.pieces.push({ pivot, x0: a, x1: b, fall: 0, t: 0 });
    }
    this.stock.position.y = 0.6; // held above the block until it's set down
    this.work.add(this.stock);

    // Gold lines across the top, where to split.
    const R = this.spec.round, h = this.spec.height;
    for (const x of this.spec.lines) {
      const len = R > 0 ? 2 * Math.sqrt(R * R - x * x) : this.spec.depth;
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.003, len + 0.01), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.4, fog: false }));
      line.position.set(x, h + 0.003, 0);
      line.visible = false;
      this.stock.add(line);
      this.guides.push(line);
    }

    // The ring that closes on the line, and the mark it should meet.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthTest: false, fog: false }));
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0x9fdc7c, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthTest: false, fog: false }));
    this.ring.renderOrder = this.target.renderOrder = 9;
    this.ring.visible = this.target.visible = false;
    this.overlay.add(this.ring, this.target);

    // The hatchet, swung about your grip.
    const kind = toolType ? itemDef(toolType).tool : undefined;
    this.tool = kind ? buildToolMesh(kind, toolType) : null;
    if (this.tool) {
      this.tool.updateMatrixWorld(true);
      const top = new THREE.Box3().setFromObject(this.tool).max.y;
      let maxZ = 0, ys = 0, n = 0;
      const v = new THREE.Vector3();
      this.tool.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!g) return;
        const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) {
          v.fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld);
          if (v.y > top - 0.2) { if (v.z > maxZ) maxZ = v.z; ys += v.y; n++; }
        }
      });
      this.edgeZ = maxZ;
      this.headY = n ? ys / n : top - 0.1;
      // Handle away from you at the blow, edge down: x = y × z.
      this.pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0)));
      this.pivot.add(this.tool);
      // (Your own character swings the hatchet: the floating one stays hidden.)
      this.pivot.visible = false;
      this.work.add(this.pivot);
    }

    // Glide in: from the side, a little above, taking in you and the block.
    this.camFrom.pos.copy(from.position);
    this.camFrom.quat.copy(from.quaternion);
    // (Far enough back to see the hatchet raised high and the log it comes down on.)
    this.camTo.copy(this.work.localToWorld(new THREE.Vector3(2.3, h + 0.85, 0.75)));
    this.lookAt.copy(this.work.localToWorld(new THREE.Vector3(0, h + 0.35, 0.45)));
    this.camera.position.copy(from.position);
    this.camera.quaternion.copy(from.quaternion);
    if ((from as THREE.PerspectiveCamera).fov) this.camera.fov = (from as THREE.PerspectiveCamera).fov;
    this.camera.updateProjectionMatrix();
    this.workLight.copy(this.work.localToWorld(new THREE.Vector3(0.4, h + 0.7, 0.6)));
  }

  /** Where you stand (at the block, facing it). */
  standAt(): { x: number; z: number; face: { x: number; z: number } } {
    const b = this.work.position;
    return { x: this.stand.x, z: this.stand.z, face: { x: b.x, z: b.z } };
  }

  /** Your swing, in step with each blow: raised and ready, a chop down onto the line, and back up. */
  bodyWork(): { clip: 'chop'; phase: number; impactAt: number } | null {
    if (this.phase !== 'split') return null;
    const impactAt = 0.6, ready = impactAt * 0.78;
    if (this.swingT < 0) return { clip: 'chop', phase: ready, impactAt };
    const t = this.swingT;
    const phase = t < DOWN ? ready + (impactAt - ready) * (t / DOWN) : impactAt + (1 - impactAt) * Math.min(1, (t - DOWN) / RECOIL);
    return { clip: 'chop', phase, impactAt };
  }

  /** The point on the top where the current line is struck. */
  private strikePoint(): THREE.Vector3 {
    const x = this.spec.lines[this.step] ?? 0;
    return this.work.localToWorld(new THREE.Vector3(x, this.stock.position.y + this.spec.height, 0));
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    if (this.phase !== 'split') return null;
    const p = this.toScreen(this.strikePoint());
    return { x: p.x + 40, y: p.y - 70, text: `split ${this.step + 1} of ${this.spec.lines.length}: click when the ring turns green`, gesture: 'click' };
  }

  meters(): Meter[] {
    const q = this.strikes.length ? this.strikes.reduce((a, b) => a + b, 0) / this.strikes.length : 0;
    return [{ label: 'Splits', value: this.step / this.spec.lines.length }, { label: 'Clean blows', value: q }];
  }

  update(dt: number, i: MgInput) {
    this.t += dt;
    this.camera.updateMatrixWorld();
    this.updatePieces(dt);
    this.updateChips(dt);
    switch (this.phase) {
      case 'arrive': {
        const k = Math.min(1, this.t / 0.7), e = k * k * (3 - 2 * k);
        this.camera.position.lerpVectors(this.camFrom.pos, this.camTo, e);
        const look = new THREE.PerspectiveCamera();
        look.position.copy(this.camTo);
        look.lookAt(this.lookAt);
        this.camera.quaternion.slerpQuaternions(this.camFrom.quat, look.quaternion, e);
        this.camera.updateMatrixWorld();
        if (k >= 1) { this.phase = 'set'; this.t = 0; }
        return;
      }
      case 'set': {
        // Stood on end on the block, with a knock.
        const k = Math.min(1, this.t / 0.25);
        this.stock.position.y = 0.6 * (1 - k * k);
        if (k >= 1) {
          this.stock.position.y = 0;
          sfx.thud();
          this.phase = 'split';
          this.t = 0;
          this.guides.forEach((g) => (g.visible = true));
          this.ring.visible = this.target.visible = true;
          this.pivot.visible = false;
        }
        return;
      }
      case 'split':
        this.split(dt, i);
        return;
      case 'done':
        this.swingTool(dt);
        if (this.t > 0.9 && !this.done) { this.progress = 1; this.done = true; }
        return;
    }
  }

  private split(dt: number, i: MgInput) {
    const at = this.strikePoint();
    const pulse = 0.5 + Math.sin(this.time * 6) * 0.5;
    this.guides.forEach((g, k) => {
      const m = g.material as THREE.MeshBasicMaterial;
      g.visible = k >= this.step;
      m.opacity = k === this.step ? 0.55 + pulse * 0.45 : 0.25;
    });
    // The ring closes on the line; strike as it meets the green mark.
    this.ringT = (this.ringT + dt / this.period) % 1;
    const up = this.work.localToWorld(new THREE.Vector3(0, 1, 0)).sub(this.work.getWorldPosition(new THREE.Vector3()));
    this.ring.position.copy(at).addScaledVector(up, 0.01);
    this.ring.lookAt(this.camera.position);
    this.ring.scale.setScalar(0.04 + (1 - this.ringT) * 0.22);
    this.target.position.copy(this.ring.position);
    this.target.quaternion.copy(this.ring.quaternion);
    this.target.scale.setScalar(0.04 + 0.15 * 0.22);
    const close = Math.abs(this.ringT - 0.85);
    (this.ring.material as THREE.MeshBasicMaterial).color.set(close < 0.06 ? 0x9fdc7c : 0xffffff);
    (this.target.material as THREE.MeshBasicMaterial).opacity = close < 0.06 ? 0.9 : 0.45;
    this.swingTool(dt);
    if (!i.pressed || this.swingT >= 0) return;
    const p = this.toScreen(at);
    if (Math.hypot(i.x - p.x, i.y - p.y) > 110) { this.say('Aim at the gold line.', false, 0.6); return; }
    this.pending = clamp01(1 - close / 0.22);
    this.swingT = 0;
  }

  /** Raised over your shoulder, a fast chop down onto the line, and back up. */
  private swingTool(dt: number) {
    let a = 1; // 1: held ready, 0: the blade in the wood
    if (this.swingT >= 0) {
      this.swingT += dt;
      const t = this.swingT;
      if (t < DOWN) { const k = t / DOWN; a = 1 - k * k; }
      else {
        if (this.pending !== null) { const q = this.pending; this.pending = null; this.land(q); }
        const k = Math.min(1, (t - DOWN) / RECOIL);
        // It bites and sticks a moment, then is worked free and lifted.
        const k2 = Math.max(0, (k - 0.25) / 0.75);
        a = k2 * k2 * (3 - 2 * k2);
        if (k >= 1) this.swingT = -1;
      }
    } else a = 1 + Math.sin(this.time * 2) * 0.02;
    if (!this.tool) return;
    // The grip comes down with the blow, from up by your shoulder.
    const x = this.spec.lines[Math.min(this.step, this.spec.lines.length - 1)] ?? 0;
    const bite = 0.03; // how far the edge sinks in
    const impact = new THREE.Vector3(x, this.spec.height - bite, 0).add(new THREE.Vector3(0, this.edgeZ, this.headY));
    this.pivot.position.copy(impact).add(new THREE.Vector3(0, 0.38 * a, 0.18 * a));
    this.tool.rotation.x = READY * a;
  }

  /** The blow lands: a clean one splits the piece off. */
  private land(q: number) {
    const at = this.strikePoint();
    this.strikes.push(q);
    this.sample(q, 1);
    this.chipsAt(at, q > 0.55 ? 10 : 4);
    if (q > 0.55) {
      sfx.thud();
      sfx.tick(this.step);
      this.say(q > 0.9 ? 'Clean split!' : 'Split.', true, 0.6);
      this.splitAt(this.spec.lines[this.step]);
      this.step++;
      this.ringT = 0;
      this.progress = this.step / this.spec.lines.length;
      if (this.step >= this.spec.lines.length) this.finish();
    } else {
      sfx.slip();
      this.say(q > 0.3 ? 'It bites but doesn’t split. Wait for the green.' : 'A glancing blow — wait for the green.', false, 0.8);
      this.ringT = 0;
    }
  }

  /** Part the wood along a line: whatever's left standing alone on either side falls away. */
  private splitAt(x: number) {
    const k = this.sorted.indexOf(x);
    this.joined[k] = false;
    // The run of joined pieces either side of the split.
    const runOf = (from: number) => {
      let a = from, b = from;
      while (a > 0 && this.joined[a - 1]) a--;
      while (b < this.pieces.length - 1 && this.joined[b]) b++;
      return [a, b];
    };
    for (const [idx, dir] of [[k, -1], [k + 1, 1]] as const) {
      const [a, b] = runOf(idx);
      if (a === b && this.pieces[a].fall === 0) this.topple(a, dir);
    }
  }

  private topple(i: number, dir: number) {
    const p = this.pieces[i];
    p.fall = dir;
    p.t = 0;
    // Turn about its outer bottom edge.
    const edge = dir > 0 ? p.x1 : p.x0;
    p.pivot.position.x = edge;
    p.pivot.children[0].position.x = -edge;
  }

  private updatePieces(dt: number) {
    for (const p of this.pieces) {
      if (!p.fall) continue;
      p.t += dt;
      const edge = p.fall > 0 ? p.x1 : p.x0;
      // Tips over, slides off the edge of the block and drops to the ground beside it.
      const k1 = Math.min(1, p.t / 0.35);
      p.pivot.rotation.z = -p.fall * (Math.PI / 2) * k1 * k1;
      const k2 = clamp01((p.t - 0.3) / 0.35);
      p.pivot.position.x = edge + p.fall * (0.32 * Math.min(1, k2 * 1.5));
      p.pivot.position.y = -0.5 * k2 * k2;
      // (At rest on the ground: it lies there till the work's done.)
    }
  }

  private finish() {
    this.phase = 'done';
    this.t = 0;
    this.ring.visible = this.target.visible = false;
    this.guides.forEach((g) => (g.visible = false));
    sfx.done();
    const perf = this.performance();
    this.say(this.variant === 'planks'
      ? (perf > 0.85 ? 'Two fine planks.' : perf > 0.55 ? 'Two rough planks.' : 'Two rough planks — split a bit crooked.')
      : (perf > 0.85 ? 'Neat kindling.' : 'A handful of kindling.'), perf > 0.4, 1.2);
  }

  /** Chips and splinters flying off the blow. */
  private chipsAt(at: THREE.Vector3, n: number) {
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.012), new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? 0xd8b47a : 0xb48a58, transparent: true }));
      m.position.copy(at);
      this.overlay.add(m);
      this.chips.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 1.4 + 0.4, (Math.random() - 0.5) * 1.6), life: 0.6 + Math.random() * 0.3 });
    }
  }

  private updateChips(dt: number) {
    for (const c of [...this.chips]) {
      c.life -= dt;
      c.vel.y -= 5 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += dt * 9;
      (c.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, c.life * 2);
      if (c.life <= 0) { this.overlay.remove(c.mesh); c.mesh.geometry.dispose(); (c.mesh.material as THREE.Material).dispose(); this.chips.splice(this.chips.indexOf(c), 1); }
    }
  }

  resize() { /* the game's own camera keeps its shape */ }

  dispose() {
    this.overlay.removeFromParent();
    // (The tool's model may be shared with the rest of the game: leave it be.)
    if (this.tool) this.pivot.remove(this.tool);
    this.overlay.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
