import * as THREE from 'three';
import { STRUCTURES, totalMaterials, type StructureDef } from '../../data/structures';
import { itemDef } from '../../data/items';
import type { StructureObj } from '../../world/world';
import { builtShare, fillDir, pieceBounds } from '../../world/pieceFill';
import { surfaceMat, type Surface } from '../../world/surfaces';
import { clamp01, Minigame, type Meter, type MgInput } from './core';
import { buildToolMesh } from '../tools';
import { sfx } from './sfx';
import type { Gesture } from './tutorials';

// Building, on the piece itself. The view goes to your planned wall (or floor,
// or roof) where it stands; the next course of it glows. You carry the
// material in (a plank, a log, a stone...), line it up with the glowing slot
// and set it; then fix it: drive the nails home with your hammer, or settle a
// log with your hatchet, striking as each ring closes. The piece rises (or a
// floor spreads) one course at a time as you go.
//
// You can look around while you work: hold the right button and drag to
// circle the piece, the wheel to come closer or stand back, WASD to move the
// view along it, Q/E to turn, R to put the view back. (A quick right-click
// still stops work.) Hold Space to steady your hands.

type Phase = 'arrive' | 'place' | 'set' | 'fix' | 'done';
type Axis = 'x' | 'y' | 'z';
/** A view of the work: circling a point, from a heading and a height, at a distance. */
interface View { yaw: number; pitch: number; dist: number; focus: THREE.Vector3 }
const unit = (a: Axis) => new THREE.Vector3(a === 'x' ? 1 : 0, a === 'y' ? 1 : 0, a === 'z' ? 1 : 0);

interface Marker {
  /** Where it stands, in the piece's frame, and how far its head sits out along `out`. */
  mesh: THREE.Object3D; top: number;
  /** Out of the face (world), and the frame the hammer swings in: `handle` runs up the handle, from your hand to the head. */
  out: THREE.Vector3; handle: THREE.Vector3; side: THREE.Vector3;
  mat?: THREE.MeshStandardMaterial;
  hits: number; need: number; bent: boolean;
  /** How far it's been driven in. */
  driven: number;
}

const GOLD = new THREE.Color(0xffd36a), GREEN = new THREE.Color(0x9fdc7c);

/** The raised, ready angle of the hammer (radians back from the strike). */
const READY = 0.6;
/** How long the down-stroke takes, and the recoil back up after it (s). */
const DOWN = 0.09, RECOIL = 0.3;

/** What a material looks like when you carry it in, sized to the slot it fills (local w × h × d). */
function materialMesh(item: string, w: number, h: number, d: number): THREE.Object3D {
  const g = new THREE.Group();
  const mat = (s: Surface, tint?: number) => surfaceMat(s, tint).clone();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  switch (item) {
    case 'log': {
      const r = Math.min(h, d) * 0.5;
      add(new THREE.CylinderGeometry(r, r, w * 1.04, 12).rotateZ(Math.PI / 2), mat('rough_wood'));
      break;
    }
    case 'rock_shard': case 'mortar': case 'clay': {
      const n = Math.max(2, Math.round(w / 0.35));
      for (let i = 0; i < n; i++) add(new THREE.BoxGeometry(w / n * 0.94, h * 0.92, d * 0.95), mat('stone', item === 'mortar' ? 0xd8d0c4 : item === 'clay' ? 0xc08060 : 0xffffff), -w / 2 + (i + 0.5) * (w / n));
      break;
    }
    case 'plant_fiber':
      add(new THREE.BoxGeometry(w, h, d), mat('thatch'));
      break;
    case 'shaft': case 'branch':
      for (const z of [-d * 0.25, d * 0.25]) add(new THREE.CylinderGeometry(0.025, 0.025, w, 6).rotateZ(Math.PI / 2), mat('rough_wood'), 0, 0, z);
      break;
    case 'hide':
      add(new THREE.BoxGeometry(w, Math.max(0.02, h * 0.4), d), new THREE.MeshStandardMaterial({ color: 0x8a5e3a, roughness: 1 }));
      break;
    case 'cordage':
      add(new THREE.TorusGeometry(0.1, 0.02, 6, 20), new THREE.MeshStandardMaterial({ color: 0xc8a96e }));
      break;
    default:
      // Rough planks are weathered and uneven; sawn ones clean.
      add(new THREE.BoxGeometry(w, h, d), mat(item === 'refined_plank' ? 'planks' : 'dark_planks'));
  }
  return g;
}

export class BuildGame extends Minigame {
  readonly title: string;
  readonly instructions: string;
  /** Played out in the world itself (the game's camera follows this one). */
  readonly inWorld = true;
  readonly orbits = true;
  /** The ground's height (set by the game), so the view never goes under it. */
  static groundAt: ((x: number, z: number) => number) | null = null;
  /** Where the view is (circling the work), where it would be on its own, and whether you've moved it. */
  private view: View = { yaw: 0, pitch: 0.3, dist: 4, focus: new THREE.Vector3() };
  private autoView: View = { yaw: 0, pitch: 0.3, dist: 4, focus: new THREE.Vector3() };
  private userView = false;
  /** Holding your hands steady (Space). */
  private steady = false;
  /** The slot's face (its normal: y for a layer laid flat), and the two ways across it. */
  private n: Axis = 'z';
  private u: Axis = 'x';
  private v: Axis = 'y';
  /** While carrying the material in, the view looks past where you stand: your body's hidden then. Nailing, you're seen at work. */
  get hidesPlayer(): boolean { return this.phase !== 'fix' && this.phase !== 'done'; }
  /** Where the material sits in your hands, off the pointer, and how it sways (piece frame). */
  private grip = new THREE.Vector3();
  private swayAmp = 0;
  /** What's shown in the world while you work (added to the world's scene). */
  readonly overlay = new THREE.Group();
  /** Where you stand to do it, and which way you face. */
  readonly stand: { x: number; z: number; yaw: number };
  private def: StructureDef;
  private piece = new THREE.Group();
  private phase: Phase = 'arrive';
  private t = 0;
  private slot: { min: THREE.Vector3; max: THREE.Vector3 };
  private slotGlow: THREE.LineSegments;
  private slotFill: THREE.Mesh;
  private carried: THREE.Object3D;
  private camFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private camTo = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private markers: Marker[] = [];
  private current = 0;
  private ringT = 0;
  private period: number;
  private ring: THREE.Mesh;
  /** Where the closing ring should be when you strike. */
  private target: THREE.Mesh;
  /** The tool, swinging about your grip (the pivot) onto the nail. */
  private pivot = new THREE.Group();
  private tool: THREE.Object3D | null;
  /** Head of the tool in its own frame: how far up the handle, and its striking face. */
  private headY = 0.35;
  private faceZ = -0.04;
  /** Time into a strike (-1: not striking), and the blow waiting for the head to land. */
  private swingT = -1;
  private pending: number | null = null;
  /** A warm light on the work, so the nails show at night (the game puts a light here). */
  readonly workLight = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private placeQ = 0;
  /** How well it would fit if set down now (0..1), whether it's settled into the slot, and a nudge as it does. */
  private hoverQ = 0;
  private snapped = false;
  private nudge = 0;
  private strikeQ: number[] = [];
  private setFrom = new THREE.Vector3();
  private bits: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  constructor(ease: number, s: StructureObj, private material: string, private toolType: string | undefined, from: THREE.Camera) {
    super(ease);
    this.def = STRUCTURES[s.type];
    const name = this.def.name.toLowerCase();
    const matName = itemDef(material).name.toLowerCase();
    this.title = `Building: ${this.def.name}`;
    const fixes = this.fixKind();
    this.instructions = `Move the ${matName} onto the glowing slot and click to set it.${fixes === 'nail' ? ' Then drive each nail: a ring shrinks onto the nail head — click when it turns green and meets the small green circle. Two good blows drive a nail home; a perfect one does it in one.' : fixes === 'settle' ? ' Then settle it with your hatchet: click when the shrinking ring turns green.' : ''}`;
    void name;
    this.period = 1.25 + ease * 0.5;

    // The piece's own frame, where everything here is laid out.
    this.piece.position.set(s.x, s.y, s.z);
    this.piece.rotation.y = s.yaw;
    this.overlay.add(this.piece);

    // The slot this step fills: the next course up (or the next strip across a floor).
    const { min, max } = pieceBounds(this.def);
    const total = totalMaterials(this.def), done = Math.round(builtShare(s) * total);
    const a = done / total, b = (done + 1) / total;
    this.slot = { min: min.clone(), max: max.clone() };
    const fd = fillDir(this.def);
    this.slot.min[fd] = min[fd] + (max[fd] - min[fd]) * a;
    this.slot.max[fd] = min[fd] + (max[fd] - min[fd]) * b;
    // Thin pieces still get a slot you can see.
    for (const ax of ['x', 'z'] as const) if (this.slot.max[ax] - this.slot.min[ax] < 0.08) { this.slot.min[ax] -= 0.03; this.slot.max[ax] += 0.03; }
    const size = this.slot.max.clone().sub(this.slot.min), centre = this.slot.min.clone().add(this.slot.max).multiplyScalar(0.5);
    // Its face: a layer laid flat is worked from above; a course up a wall from its thin side.
    // (A piece filled across its length, a floor, a raft, a slipway, is always laid from above.)
    this.across = fd !== 'y';
    if (this.flatSlot()) { this.n = 'y'; this.u = 'x'; this.v = 'z'; }
    else { this.n = size.x < size.z ? 'x' : 'z'; this.u = this.n === 'x' ? 'z' : 'x'; this.v = 'y'; }
    const box = new THREE.BoxGeometry(size.x, size.y, size.z);
    this.slotGlow = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0xffd36a, transparent: true, depthTest: false, fog: false }));
    this.slotGlow.position.copy(centre);
    this.slotGlow.renderOrder = 8;
    this.slotFill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.18, depthWrite: false, fog: false }));
    this.slotFill.position.copy(centre);
    this.piece.add(this.slotGlow, this.slotFill);

    // What you carry in.
    // (Lengthways along the slot: a long course down a boat's side is a long timber, not a short one across it.)
    if (size.z > size.x * 1.2) {
      this.carried = new THREE.Group();
      const m = materialMesh(material, size.z, size.y, size.x);
      m.rotation.y = Math.PI / 2;
      this.carried.add(m);
    } else this.carried = materialMesh(material, size.x, size.y, size.z);
    this.piece.add(this.carried);

    // The ring for the strikes.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthTest: false, fog: false }));
    this.ring.renderOrder = 9;
    this.ring.visible = false;
    this.overlay.add(this.ring);
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0x9fdc7c, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false, fog: false }));
    this.target.renderOrder = 9;
    this.target.visible = false;
    this.overlay.add(this.target);
    const kind = toolType ? itemDef(toolType).tool : undefined;
    this.tool = fixes && kind ? buildToolMesh(kind, toolType) : null;
    if (this.tool) {
      // Find the head: the top of the tool, and its face on the -z side.
      this.tool.updateMatrixWorld(true);
      const top = new THREE.Box3().setFromObject(this.tool).max.y;
      let minZ = 0;
      const v = new THREE.Vector3();
      this.tool.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!g) return;
        const pos = g.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
          if (v.y > top - 0.12) minZ = Math.min(minZ, v.z);
        }
      });
      this.headY = top - 0.045;
      this.faceZ = minZ;
      this.pivot.add(this.tool);
      this.pivot.visible = false;
      this.overlay.add(this.pivot);
    }

    // Where to look from: square on to the slot's face (or down at a flat layer across its length),
    // on your side of the piece, far enough back to take in the whole slot and a little round it.
    const flat = this.n === 'y';
    const worldCentre = this.piece.localToWorld(centre.clone());
    const pq = this.piece.getWorldQuaternion(new THREE.Quaternion());
    const look = (flat ? unit(size.x >= size.z ? 'z' : 'x') : unit(this.n)).applyQuaternion(pq);
    look.y = 0; look.normalize();
    if (look.dot(from.position.clone().sub(worldCentre)) < 0) look.negate();
    const fov = ((from as THREE.PerspectiveCamera).fov ?? 70) * Math.PI / 180;
    const radius = Math.max(0.7, Math.min(8, size.length() / 2 + 0.35));
    this.autoView = {
      yaw: Math.atan2(look.x, look.z), pitch: flat ? 0.72 : 0.22,
      dist: Math.max(1.6, Math.min(45, radius / Math.tan(fov * 0.42))), focus: worldCentre.clone(),
    };
    this.view = { ...this.autoView, focus: this.autoView.focus.clone() };
    this.camTo.pos.copy(this.viewPos(this.autoView));
    this.camTo.look.copy(worldCentre);
    this.camFrom.pos.copy(from.position);
    this.camFrom.quat.copy(from.quaternion);
    this.camera.position.copy(from.position);
    this.camera.quaternion.copy(from.quaternion);
    if ((from as THREE.PerspectiveCamera).fov) this.camera.fov = (from as THREE.PerspectiveCamera).fov;
    this.camera.updateProjectionMatrix();
    // You stand beside the slot on that side (just clear of it).
    const half = flat ? Math.abs(look.dot(unit(size.x >= size.z ? 'z' : 'x').applyQuaternion(pq))) * (size.x >= size.z ? size.z : size.x) / 2 : size[this.n] / 2;
    const standAt = new THREE.Vector3(worldCentre.x, 0, worldCentre.z).addScaledVector(look, half + (flat ? 0.9 : 1.1));
    this.stand = { x: standAt.x, z: standAt.z, yaw: Math.atan2(look.x, look.z) };
    this.placeCarried(0.8);
    this.workLight.copy(worldCentre).addScaledVector(look, 0.9).add(new THREE.Vector3(0, 0.6, 0));
  }

  /** Where the camera stands for a view (kept above the ground). */
  private viewPos(v: View): THREE.Vector3 {
    const p = v.focus.clone().add(new THREE.Vector3(Math.sin(v.yaw) * Math.cos(v.pitch), Math.sin(v.pitch), Math.cos(v.yaw) * Math.cos(v.pitch)).multiplyScalar(v.dist));
    const g = BuildGame.groundAt?.(p.x, p.z);
    if (g !== undefined && Number.isFinite(g)) p.y = Math.max(p.y, g + 0.45);
    return p;
  }

  /**
   * Looking around: right-drag circles the work, the wheel comes closer or
   * stands back, WASD moves the view along it, Q/E turn, R puts it back.
   * Space steadies your hands.
   */
  private steer(dt: number, i: MgInput) {
    const v = this.view;
    if (i.orbit && (i.orbit.dx || i.orbit.dy)) {
      v.yaw -= i.orbit.dx * 0.006;
      v.pitch = Math.max(-0.05, Math.min(1.45, v.pitch + i.orbit.dy * 0.005));
      this.userView = true;
    }
    if (i.wheel) { v.dist = Math.max(1.0, Math.min(60, v.dist * Math.exp(Math.sign(i.wheel) * 0.12))); this.userView = true; }
    const k = i.keys;
    if (k) {
      const fwd = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const step = Math.max(1.2, v.dist * 0.8) * dt;
      const move = new THREE.Vector3();
      if (k.has('KeyW')) move.add(fwd);
      if (k.has('KeyS')) move.sub(fwd);
      if (k.has('KeyD')) move.add(right);
      if (k.has('KeyA')) move.sub(right);
      if (move.lengthSq()) { v.focus.addScaledVector(move.normalize(), step); this.userView = true; }
      if (k.has('KeyQ')) { v.yaw += 1.6 * dt; this.userView = true; }
      if (k.has('KeyE')) { v.yaw -= 1.6 * dt; this.userView = true; }
      this.steady = k.has('Space');
    }
    if (i.hit?.('KeyR')) {
      this.userView = false;
      this.view = { ...this.autoView, focus: this.autoView.focus.clone() };
      this.say('View reset.', true, 0.5);
    }
  }

  /** Put the camera where the view is (gliding there). */
  private placeCamera(dt: number, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 12);
    this.camera.position.lerp(this.viewPos(this.view), k);
    this.camLook.lerp(this.view.focus, k);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
  }

  /** How the step is fixed once placed: nailed (hammer), settled (hatchet), or just set (no tool). */
  private fixKind(): 'nail' | 'settle' | null {
    const kind = this.toolType ? itemDef(this.toolType).tool : undefined;
    if (kind === 'hammer') return 'nail';
    if (kind === 'hatchet') return 'settle';
    return null;
  }

  /** Hold the material out in front of the slot (0: on it, 1: well out from it). */
  private placeCarried(out: number) {
    const c = this.slot.min.clone().add(this.slot.max).multiplyScalar(0.5);
    const camLocal = this.piece.worldToLocal(this.camTo.pos.clone());
    this.carried.position.copy(c).lerp(camLocal, out * 0.45);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    this.camera.updateMatrixWorld();
    // (Placing has its own live readout: see tag().)
    if (this.phase === 'place') return null;
    if (this.phase === 'fix' && this.markers[this.current]) {
      const p = this.toScreen(this.headAt(this.markers[this.current]));
      const n = this.markers.length;
      const what = this.fixKind() === 'nail' ? `nail ${this.current + 1} of ${n}` : `end ${this.current + 1} of ${n}`;
      return { x: p.x + 40, y: p.y - 70, text: `${what}: click when the ring turns green`, gesture: 'click' };
    }
    return null;
  }

  tag(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    if (this.phase !== 'place') return null;
    this.camera.updateMatrixWorld();
    const p = this.toScreen(this.piece.localToWorld(this.slotCentre()));
    const pct = Math.round(this.hoverQ * 100);
    return pct > 0
      ? { x: p.x + 30, y: p.y - 56, text: `fit ${pct}% — click to set`, gesture: 'click' }
      : { x: p.x + 30, y: p.y - 56, text: `move the ${itemDef(this.material).name.toLowerCase()} onto the outline (right-drag to look around)` };
  }

  meters(): Meter[] {
    const strikes = this.strikeQ.length ? this.strikeQ.reduce((a, b) => a + b, 0) / this.strikeQ.length : 0;
    return [
      { label: 'Fit', value: this.phase === 'arrive' ? 0 : this.phase === 'place' ? this.hoverQ : this.placeQ, color: this.phase === 'place' ? '#9fdc7c' : undefined },
      ...(this.fixKind() ? [{ label: this.fixKind() === 'nail' ? 'Nailing' : 'Settling', value: strikes }] : []),
    ];
  }

  update(dt: number, i: MgInput) {
    // (This camera is never drawn with a scene of its own, so keep its matrices current here.)
    this.camera.updateMatrixWorld();
    this.t += dt;
    this.updateBits(dt);
    const pulse = 0.5 + Math.sin(this.time * 6) * 0.5;
    (this.slotGlow.material as THREE.LineBasicMaterial).opacity = this.phase === 'place' || this.phase === 'arrive' ? 0.55 + pulse * 0.45 : 0.25;
    (this.slotFill.material as THREE.MeshBasicMaterial).opacity = this.phase === 'place' ? 0.1 + pulse * 0.15 : 0;
    switch (this.phase) {
      case 'arrive': {
        // Glide to the piece.
        const k = Math.min(1, this.t / 0.7), e = k * k * (3 - 2 * k);
        this.camera.position.lerpVectors(this.camFrom.pos, this.camTo.pos, e);
        // (A camera's look-at points its -z at the target, unlike a plain object's.)
        const look = new THREE.PerspectiveCamera();
        look.position.copy(this.camTo.pos);
        look.lookAt(this.camTo.look);
        this.camera.quaternion.slerpQuaternions(this.camFrom.quat, look.quaternion, e);
        this.camera.updateMatrixWorld();
        if (k >= 1) {
          this.phase = 'place'; this.t = 0;
          this.camLook.copy(this.camTo.look);
          // You pick the material up off to one side: it has to be carried onto the slot, not just
          // clicked where the view happens to be centred. It sways a little in your hands, too.
          const [tu, tv] = this.tolerances();
          const a = Math.random() * Math.PI * 2, r = 1.8 + Math.random() * 1.2;
          this.grip.set(0, 0, 0);
          this.grip[this.u] = Math.cos(a) * tu * r;
          this.grip[this.v] = Math.sin(a) * tv * r;
          this.swayAmp = 0.28 * (1.15 - this.ease * 0.6);
        }
        return;
      }
      case 'place': {
        // The material slides over the piece itself, where you point: across the
        // floor (or the layer being laid), or up the face of a wall. Only how far
        // it is from the slot in that surface counts.
        this.steer(dt, i);
        this.placeCamera(dt);
        const c = this.slotCentre();
        const hit = this.pointOnSlot(i.ndc);
        if (!hit) return;
        // Where the material is: off the pointer by where you're holding it, swaying a little (less with steady hands).
        const [su, sv] = this.tolerances();
        const amp = this.swayAmp * (this.steady ? 0.2 : 1);
        const sway = new THREE.Vector3();
        sway[this.u] = Math.sin(this.time * 1.7) * su * amp;
        sway[this.v] = Math.sin(this.time * 1.3 + 1) * sv * amp;
        const local = hit.add(this.grip).add(sway);
        // How far off, as a share of what still fits each way (a long course forgives more along its length).
        const [tu, tv] = this.tolerances();
        const off = Math.hypot((local[this.u] - c[this.u]) / tu, (local[this.v] - c[this.v]) / tv);
        const tol = 1;
        const q = clamp01(1 - off / tol);
        this.hoverQ = q;
        // Close enough, and it settles into the slot with a little nudge.
        const inside = off < tol;
        if (inside && !this.snapped) { this.snapped = true; this.nudge = 1; sfx.tick(2); }
        else if (!inside) this.snapped = false;
        const want = inside ? c.clone() : local.clone();
        if (!inside) {
          // Held a hand's breadth off the surface (toward you), so it reads as carried.
          want[this.n] += (this.piece.worldToLocal(this.camera.position.clone())[this.n] > c[this.n] ? 1 : -1) * 0.05;
        }
        this.carried.position.lerp(want, 1 - Math.exp(-dt * (inside ? 16 : 30)));
        this.nudge = Math.max(0, this.nudge - dt * 4);
        this.carried.position.y += Math.sin(this.nudge * Math.PI) * 0.015;
        this.carried.rotation.z = inside ? 0 : Math.sin(this.time * 2) * 0.02;
        // The outline warms from gold to green as you close in.
        (this.slotGlow.material as THREE.LineBasicMaterial).color.copy(GOLD).lerp(GREEN, q);
        (this.slotFill.material as THREE.MeshBasicMaterial).color.copy(GOLD).lerp(GREEN, q);
        if (i.pressed) {
          if (off > tol * 3) { this.say('Line it up with the outline.', false, 0.8); return; }
          this.placeQ = q;
          this.sample(this.placeQ, 1);
          this.setFrom.copy(this.carried.position);
          this.phase = 'set';
          this.t = 0;
          (this.slotGlow.material as THREE.LineBasicMaterial).color.copy(GOLD);
          this.say(this.placeQ > 0.85 ? 'A snug fit.' : this.placeQ > 0.5 ? 'Set.' : 'A bit off — it’ll do.', this.placeQ > 0.5, 0.8);
        }
        return;
      }
      case 'set': {
        this.steer(dt, i);
        this.placeCamera(dt);
        // It drops into place.
        const k = Math.min(1, this.t / 0.18);
        const c = this.slot.min.clone().add(this.slot.max).multiplyScalar(0.5);
        this.carried.position.lerpVectors(this.setFrom, c, k * k);
        this.carried.rotation.z = 0;
        if (k >= 1) {
          sfx.thud();
          this.dust(this.piece.localToWorld(c.clone()), 10);
          this.makeMarkers();
          this.phase = this.markers.length ? 'fix' : 'done';
          if (this.phase === 'done') this.finish();
          this.t = 0;
        }
        return;
      }
      case 'fix':
        this.fix(dt, i);
        return;
      case 'done':
        this.placeCamera(dt);
        return;
    }
  }

  private slotCentre(): THREE.Vector3 {
    return this.slot.min.clone().add(this.slot.max).multiplyScalar(0.5);
  }

  /** A layer lying flat (a floor strip, a raft's log, a course of a campfire or bench) rather than a course up a wall. */
  private flatSlot(): boolean {
    if (this.across) return true;
    const size = this.slot.max.clone().sub(this.slot.min);
    return size.y < Math.min(size.x, size.z);
  }
  private across = false;

  /** How far off the slot still fits (m) each way across the surface you move over (x, then z or y), with your skill. */
  private tolerances(): [number, number] {
    const size = this.slot.max.clone().sub(this.slot.min);
    const u = size[this.u], v = size[this.v];
    const base = Math.max(0.1, Math.min(u, v) * 0.35);
    const k = 0.7 + this.ease * 0.6;
    return [Math.max(base, u * 0.12) * k, Math.max(base, v * 0.12) * k];
  }

  /** Where the pointer meets the slot's surface, in the piece's frame (or null). */
  private pointOnSlot(ndc: THREE.Vector2): THREE.Vector3 | null {
    const c = this.slotCentre();
    this.raycaster.setFromCamera(ndc, this.camera);
    this.piece.updateMatrixWorld();
    const ray = this.raycaster.ray.clone().applyMatrix4(this.piece.matrixWorld.clone().invert());
    const plane = new THREE.Plane(unit(this.n), -c[this.n]);
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    // (Within reach of the slot: a long one takes more.)
    const reach = Math.max(2.5, this.slot.max.clone().sub(this.slot.min).length());
    if (hit && hit.distanceTo(c) < reach) return hit;
    // Looking along the surface: fall back to a plane facing the view.
    const camLocal = this.piece.worldToLocal(this.camera.position.clone());
    const facing = new THREE.Plane().setFromNormalAndCoplanarPoint(camLocal.sub(c).normalize(), c);
    return ray.intersectPlane(facing, new THREE.Vector3());
  }

  /** Nails along the course (or the log's ends to settle). */
  private makeMarkers() {
    const kind = this.fixKind();
    if (!kind) return;
    const c = this.slot.min.clone().add(this.slot.max).multiplyScalar(0.5);
    const size = this.slot.max.clone().sub(this.slot.min);
    const camLocal = this.piece.worldToLocal(this.camera.position.clone());
    const flat = this.n === 'y';
    const n = this.n;
    // On the face toward you (the top, for a layer laid flat).
    const faceN = flat || camLocal[n] > c[n] ? this.slot.max[n] : this.slot.min[n];
    const sgn = faceN > c[n] ? 1 : -1;
    // Spread along its length (a flat layer's longer way).
    const along: Axis = flat ? (size.x >= size.z ? 'x' : 'z') : this.u;
    const count = kind === 'settle' ? 2 : Math.max(2, Math.min(4, Math.round(size[along] / 0.6)));
    // The frame the hammer swings in: out of the face, and across it as you see it.
    const pq = this.piece.getWorldQuaternion(new THREE.Quaternion());
    const out = unit(n).multiplyScalar(sgn).applyQuaternion(pq);
    const look = new THREE.PerspectiveCamera();
    look.position.copy(this.camera.position);
    look.lookAt(this.piece.localToWorld(c.clone()));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(look.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(look.quaternion);
    const e1 = right.addScaledVector(out, -right.dot(out)).normalize();
    const e2 = new THREE.Vector3().crossVectors(out, e1);
    if (e2.dot(camUp) < 0) e2.negate();
    // The hand is low and to the right; the view comes in from the side of the swing.
    const handle = e2.clone().sub(e1).normalize();
    const side = e1.clone().add(e2).normalize().multiplyScalar(flat ? -1 : 1);
    for (let k = 0; k < count; k++) {
      const local = c.clone();
      local[along] = this.slot.min[along] + (k + 0.5) * (size[along] / count);
      local[n] = faceN + sgn * 0.005;
      let mesh: THREE.Object3D, top = 0, mat: THREE.MeshStandardMaterial | undefined;
      if (kind === 'nail') {
        // A big iron nail standing proud of the wood, its head toward you; it catches the light.
        const nail = new THREE.Group();
        mat = new THREE.MeshStandardMaterial({ color: 0xc8c8cc, metalness: 0.55, roughness: 0.3, emissive: 0x000000 });
        const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.1, 8), mat);
        shank.position.y = 0.05;
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.022, 0.01, 14), mat);
        head.position.y = 0.1;
        nail.add(shank, head);
        top = 0.105;
        // (Standing up out of the face: up for a flat layer, out along x or z for a course up a wall.)
        if (n === 'z') nail.rotation.set(sgn * Math.PI / 2, 0, 0);
        else if (n === 'x') nail.rotation.set(0, 0, -sgn * Math.PI / 2);
        nail.position.copy(local);
        mesh = nail;
      } else {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, fog: false }));
        mesh.position.copy(local);
      }
      this.piece.add(mesh);
      this.markers.push({ mesh, top, out, handle, side, mat, hits: 0, need: kind === 'nail' ? 2 : 1, bent: false, driven: 0 });
    }
    this.current = 0;
    this.ringT = 0;
    this.ring.visible = true;
    this.target.visible = true;
    if (this.tool) {
      // (Your own character swings the hammer now: no floating one.)
      this.pivot.visible = false;
      this.pivot.position.copy(this.gripFor(this.markers[0]));
    }
  }

  /** The head of a nail (or the spot to settle), in the world. */
  private headAt(m: Marker): THREE.Vector3 {
    m.mesh.updateWorldMatrix(true, false);
    return m.mesh.localToWorld(new THREE.Vector3(0, m.top, 0));
  }

  /** Where you stand to drive the current nail (beside it, on your side of the piece), and the point to face. */
  standAt(): { x: number; z: number; face: { x: number; z: number } } | null {
    if (this.phase !== 'fix' && this.phase !== 'done') return null;
    const m = this.markers[Math.min(this.current, this.markers.length - 1)];
    if (!m) return null;
    const head = this.headAt(m);
    // Back toward where you came from, a short reach from the nail.
    const back = new THREE.Vector3(this.stand.x - head.x, 0, this.stand.z - head.z);
    if (back.lengthSq() < 1e-4) back.set(m.out.x, 0, m.out.z);
    back.normalize();
    const reach = this.n === 'y' ? 0.75 : 0.85;
    return { x: head.x + back.x * reach, z: head.z + back.z * reach, face: { x: head.x, z: head.z } };
  }

  /** What your body does: a swing in step with each blow (overhead at a wall, down at a floor). */
  bodyWork(): { clip: 'chop' | 'mine'; phase: number; impactAt: number } | null {
    if (this.phase !== 'fix') return null;
    const clip = this.n === 'y' ? 'mine' : 'chop';
    const impactAt = 0.6, ready = impactAt * 0.78;
    if (this.swingT < 0) return { clip, phase: ready, impactAt };
    const t = this.swingT;
    const phase = t < DOWN ? ready + (impactAt - ready) * (t / DOWN) : impactAt + (1 - impactAt) * Math.min(1, (t - DOWN) / RECOIL);
    return { clip, phase, impactAt };
  }

  /** Where your grip is, for the head to come down square on this nail. */
  private gripFor(m: Marker): THREE.Vector3 {
    return this.headAt(m).addScaledVector(m.handle, -this.headY).addScaledVector(m.out, -this.faceZ);
  }

  private fix(dt: number, i: MgInput) {
    const m = this.markers[this.current];
    if (!m) return;
    const head = this.headAt(m);
    const smooth = (rate: number) => 1 - Math.exp(-dt * rate);
    // The view takes in you and the nail: from the side, a little above, between the two.
    const st = this.standAt()!;
    // (Your chest: a little over a metre above the ground the piece stands on.)
    const chest = new THREE.Vector3(st.x, this.piece.position.y + 1.15, st.z);
    const mid = head.clone().lerp(chest, 0.5);
    const along = new THREE.Vector3(st.x - head.x, 0, st.z - head.z).normalize();
    const side = new THREE.Vector3(-along.z, 0, along.x);
    if (side.dot(m.side) < 0) side.negate();
    this.steer(dt, i);
    if (this.userView) {
      // You've moved the view: it circles the nail being driven, as you left it.
      this.view.focus.lerp(mid, smooth(5));
      this.placeCamera(dt);
    } else {
      const camAt = mid.clone().addScaledVector(side, 3.4).addScaledVector(along, 0.4).add(new THREE.Vector3(0, 1.3, 0));
      const g = BuildGame.groundAt?.(camAt.x, camAt.z);
      if (g !== undefined && Number.isFinite(g)) camAt.y = Math.max(camAt.y, g + 0.45);
      this.camera.position.lerp(camAt, smooth(4));
      this.camLook.lerp(mid, smooth(6));
      this.camera.lookAt(this.camLook);
      this.camera.updateMatrixWorld();
      // (So taking over the view starts from here.)
      const off = this.camera.position.clone().sub(mid);
      this.view = { yaw: Math.atan2(off.x, off.z), pitch: Math.asin(Math.max(-1, Math.min(1, off.y / Math.max(0.01, off.length())))), dist: off.length(), focus: mid.clone() };
    }
    this.workLight.copy(head).addScaledVector(m.out, 0.55).addScaledVector(m.side, 0.25).add(new THREE.Vector3(0, 0.3, 0));
    // The nail being worked glows faintly; the rest wait, a little lit.
    const pulse = 0.5 + Math.sin(this.time * 7) * 0.5;
    this.markers.forEach((o, k) => {
      if (!o.mat) return;
      if (k === this.current) o.mat.emissive.setRGB(0.35 + pulse * 0.3, 0.27 + pulse * 0.22, 0.1);
      else if (k > this.current) o.mat.emissive.setRGB(0.12, 0.12, 0.13);
      else o.mat.emissive.setRGB(0, 0, 0);
    });

    // The ring closes on the nail; strike as it meets the green circle.
    this.ringT = (this.ringT + dt / this.period) % 1;
    const r = 0.04 + (1 - this.ringT) * 0.2;
    const at = head.clone().addScaledVector(m.out, 0.006);
    this.ring.position.copy(at);
    this.ring.lookAt(this.camera.position);
    this.ring.scale.setScalar(r);
    this.target.position.copy(at);
    this.target.quaternion.copy(this.ring.quaternion);
    this.target.scale.setScalar(0.04 + 0.15 * 0.2);
    const close = Math.abs(this.ringT - 0.85);
    (this.ring.material as THREE.MeshBasicMaterial).color.set(close < 0.06 ? 0x9fdc7c : 0xffffff);
    (this.target.material as THREE.MeshBasicMaterial).opacity = close < 0.06 ? 0.9 : 0.45;

    this.swingTool(dt, m);
    if (!i.pressed || this.swingT >= 0) return;
    const p = this.toScreen(head);
    if (Math.hypot(i.x - p.x, i.y - p.y) > 90) { this.say('Aim at the nail.', false, 0.6); return; }
    // The blow is timed now; it lands when the head comes down.
    this.pending = clamp01(1 - close / 0.22);
    this.swingT = 0;
  }

  /** The hammer: held up ready over the nail, a fast down-stroke on a click, a bounce, and back up. */
  private swingTool(dt: number, m: Marker) {
    let angle = READY + Math.sin(this.time * 2.2) * 0.04;
    if (this.swingT >= 0) {
      this.swingT += dt;
      const t = this.swingT;
      if (t < DOWN) {
        const k = t / DOWN;
        angle = READY * (1 - k * k); // speeding up into the blow
      } else {
        if (this.pending !== null) { const q = this.pending; this.pending = null; this.land(q); }
        const k = Math.min(1, (t - DOWN) / RECOIL);
        // A little kick off the head, then lifted back up to the ready.
        angle = READY * (k * k * (3 - 2 * k)) + Math.sin(Math.min(1, k * 3) * Math.PI) * 0.12;
        if (k >= 1) this.swingT = -1;
      }
    }
    if (!this.tool) return;
    // Square to the work: handle along `handle`, face along -out, swinging back about the grip.
    const z = m.out, y = m.handle.clone();
    const x = new THREE.Vector3().crossVectors(y, z);
    this.pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    // Between nails, the hand moves across (smoothly; held still mid-blow).
    if (this.swingT < 0) this.pivot.position.lerp(this.gripFor(m), 1 - Math.exp(-dt * 12));
    this.tool.rotation.x = angle;
  }

  /** The blow lands. */
  private land(q: number) {
    const m = this.markers[this.current];
    if (!m) return;
    const head = this.headAt(m);
    this.strikeQ.push(q);
    this.sample(q, 1);
    if (q > 0.55) {
      m.hits++;
      sfx.tick(m.hits + this.current);
      this.dust(head, 6);
      if (this.fixKind() === 'nail') {
        // Driven in a little more; home (its head on the wood) on the last blow.
        const home = m.hits >= m.need || q > 0.9;
        const to = home ? m.top - 0.006 : Math.min(m.top - 0.03, m.driven + 0.045);
        m.mesh.translateY(-(to - m.driven));
        m.driven = to;
      } else {
        sfx.thud();
      }
      if (q > 0.9) this.say('Perfect!', true, 0.5);
      else if (q > 0.75) this.say('Good blow.', true, 0.4);
      if (m.hits >= m.need || (q > 0.9 && this.fixKind() === 'nail')) {
        if (this.fixKind() !== 'nail') m.mesh.visible = false;
        m.mat?.emissive.setRGB(0, 0, 0);
        this.current++;
        this.ringT = 0;
        if (this.current >= this.markers.length) this.finish();
      } else this.ringT = 0;
    } else {
      sfx.slip();
      this.say(this.fixKind() === 'nail' ? (q > 0.3 ? 'Glanced off — it bent! Wait for the green.' : 'Too early or late — it bent!') : 'Glanced off!', false, 0.8);
      if (this.fixKind() === 'nail' && !m.bent) { m.bent = true; m.mesh.rotateZ(0.35); }
      m.need = Math.min(m.need + 1, 4);
      this.ringT = 0;
    }
  }

  private finish() {
    this.phase = 'done';
    this.ring.visible = false;
    this.target.visible = false;
    this.slotGlow.visible = false;
    this.slotFill.visible = false;
    sfx.done();
    const perf = this.performance();
    this.say(perf > 0.85 ? 'Fine work.' : perf > 0.6 ? 'Solid.' : perf > 0.35 ? 'It’ll hold.' : 'Rough work.', perf > 0.35, 1.2);
    this.progress = 1;
    this.done = true;
  }

  /** A puff of dust and chips. */
  private dust(at: THREE.Vector3, n: number) {
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), new THREE.MeshStandardMaterial({ color: 0xc8a878, transparent: true }));
      m.position.copy(at);
      this.overlay.add(m);
      this.bits.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 1.2 + 0.3, (Math.random() - 0.5) * 1.2), life: 0.5 + Math.random() * 0.3 });
    }
  }

  private updateBits(dt: number) {
    for (const b of [...this.bits]) {
      b.life -= dt;
      b.vel.y -= 4 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      (b.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, b.life * 2);
      if (b.life <= 0) { this.overlay.remove(b.mesh); this.bits.splice(this.bits.indexOf(b), 1); }
    }
  }

  resize() { /* the game's own camera keeps its shape */ }

  dispose() {
    this.overlay.removeFromParent();
    // (The tool's model is shared with the rest of the game: leave it be.)
    if (this.tool) this.pivot.remove(this.tool);
    this.overlay.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const m = o.material as THREE.Material;
        m.dispose();
      }
    });
  }
}
