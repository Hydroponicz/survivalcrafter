import * as THREE from 'three';
import { STRUCTURES, totalMaterials, type StructureDef } from '../../data/structures';
import { itemDef } from '../../data/items';
import type { StructureObj } from '../../world/world';
import { builtShare, fillsAcross, pieceBounds } from '../../world/pieceFill';
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

type Phase = 'arrive' | 'place' | 'set' | 'fix' | 'done';

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
    if (fillsAcross(this.def)) { this.slot.min.x = min.x + (max.x - min.x) * a; this.slot.max.x = min.x + (max.x - min.x) * b; }
    else { this.slot.min.y = min.y + (max.y - min.y) * a; this.slot.max.y = min.y + (max.y - min.y) * b; }
    // Thin pieces still get a slot you can see.
    if (this.slot.max.z - this.slot.min.z < 0.08) { this.slot.min.z -= 0.03; this.slot.max.z += 0.03; }
    const size = this.slot.max.clone().sub(this.slot.min), centre = this.slot.min.clone().add(this.slot.max).multiplyScalar(0.5);
    const box = new THREE.BoxGeometry(size.x, size.y, size.z);
    this.slotGlow = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0xffd36a, transparent: true, depthTest: false, fog: false }));
    this.slotGlow.position.copy(centre);
    this.slotGlow.renderOrder = 8;
    this.slotFill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.18, depthWrite: false, fog: false }));
    this.slotFill.position.copy(centre);
    this.piece.add(this.slotGlow, this.slotFill);

    // What you carry in.
    this.carried = materialMesh(material, size.x, size.y, size.z);
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

    // Where to look from: in front of the piece, on your side of it, far enough back to see it whole.
    const yaw = s.yaw;
    const front = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const toCam = from.position.clone().sub(new THREE.Vector3(s.x, s.y, s.z));
    if (front.dot(toCam) < 0) front.negate();
    const across = fillsAcross(this.def);
    const worldCentre = this.piece.localToWorld(centre.clone());
    const pieceSize = Math.max(max.x - min.x, max.y - min.y);
    const back = across ? 1.6 : 1.2 + pieceSize * 0.75;
    this.camTo.pos.copy(worldCentre).addScaledVector(front, back).add(new THREE.Vector3(0, across ? 1.5 : 0.35, 0));
    this.camTo.look.copy(worldCentre);
    this.camFrom.pos.copy(from.position);
    this.camFrom.quat.copy(from.quaternion);
    this.camera.position.copy(from.position);
    this.camera.quaternion.copy(from.quaternion);
    if ((from as THREE.PerspectiveCamera).fov) this.camera.fov = (from as THREE.PerspectiveCamera).fov;
    this.camera.updateProjectionMatrix();
    const standAt = new THREE.Vector3(s.x, 0, s.z).addScaledVector(front, across ? 2.2 : 1.1 + pieceSize * 0.3);
    this.stand = { x: standAt.x, z: standAt.z, yaw: Math.atan2(front.x, front.z) };
    this.placeCarried(0.8);
    this.workLight.copy(worldCentre).addScaledVector(front, 0.9).add(new THREE.Vector3(0, 0.6, 0));
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
    if (this.phase === 'place') {
      const p = this.toScreen(this.piece.localToWorld(this.slot.min.clone().add(this.slot.max).multiplyScalar(0.5)));
      return { x: p.x + 30, y: p.y - 50, text: `move the ${itemDef(this.material).name.toLowerCase()} here and click` };
    }
    if (this.phase === 'fix' && this.markers[this.current]) {
      const p = this.toScreen(this.headAt(this.markers[this.current]));
      const n = this.markers.length;
      const what = this.fixKind() === 'nail' ? `nail ${this.current + 1} of ${n}` : `end ${this.current + 1} of ${n}`;
      return { x: p.x + 40, y: p.y - 70, text: `${what}: click when the ring turns green`, gesture: 'click' };
    }
    return null;
  }

  meters(): Meter[] {
    const strikes = this.strikeQ.length ? this.strikeQ.reduce((a, b) => a + b, 0) / this.strikeQ.length : 0;
    return [
      { label: 'Fit', value: this.phase === 'place' || this.phase === 'arrive' ? 0 : this.placeQ },
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
        if (k >= 1) { this.phase = 'place'; this.t = 0; }
        return;
      }
      case 'place': {
        // The material follows the pointer over the face of the piece.
        const c = this.slot.min.clone().add(this.slot.max).multiplyScalar(0.5);
        const wc = this.piece.localToWorld(c.clone());
        const n = this.camera.getWorldDirection(new THREE.Vector3()).negate();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, wc);
        this.raycaster.setFromCamera(i.ndc, this.camera);
        const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        if (!hit) return;
        const local = this.piece.worldToLocal(hit.clone());
        // Held a hand's breadth in front, so you can see where it's going.
        const camLocal = this.piece.worldToLocal(this.camera.position.clone());
        this.carried.position.copy(local).lerp(camLocal, 0.06);
        this.carried.rotation.z = Math.sin(this.time * 2) * 0.02;
        const size = this.slot.max.clone().sub(this.slot.min);
        const tol = Math.max(0.06, Math.min(size.x, size.y) * 0.25) * (0.7 + this.ease * 0.6);
        const off = Math.hypot(local.x - c.x, local.y - c.y, fillsAcross(this.def) ? local.z - c.z : 0);
        if (i.pressed) {
          if (off > tol * 3) { this.say('Line it up with the glowing slot.', false, 0.8); return; }
          this.placeQ = clamp01(1 - off / tol);
          this.sample(this.placeQ, 1);
          this.setFrom.copy(this.carried.position);
          this.phase = 'set';
          this.t = 0;
          this.say(this.placeQ > 0.85 ? 'A snug fit.' : this.placeQ > 0.5 ? 'Set.' : 'A bit off — it’ll do.', this.placeQ > 0.5, 0.8);
        }
        return;
      }
      case 'set': {
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
        return;
    }
  }

  /** Nails along the course (or the log's ends to settle). */
  private makeMarkers() {
    const kind = this.fixKind();
    if (!kind) return;
    const c = this.slot.min.clone().add(this.slot.max).multiplyScalar(0.5);
    const size = this.slot.max.clone().sub(this.slot.min);
    const camLocal = this.piece.worldToLocal(this.camTo.pos.clone());
    const across = fillsAcross(this.def);
    // On the face toward you (the top, for a floor).
    const faceZ = camLocal.z > c.z ? this.slot.max.z : this.slot.min.z;
    const sgn = faceZ > c.z ? 1 : -1;
    const count = kind === 'settle' ? 2 : across ? 2 : Math.max(2, Math.min(4, Math.round(size.x / 0.6)));
    // The frame the hammer swings in: out of the face, and across it as you see it.
    const pq = this.piece.getWorldQuaternion(new THREE.Quaternion());
    const out = (across ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, sgn)).applyQuaternion(pq);
    const look = new THREE.PerspectiveCamera();
    look.position.copy(this.camTo.pos);
    look.lookAt(this.camTo.look);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(look.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(look.quaternion);
    const e1 = right.addScaledVector(out, -right.dot(out)).normalize();
    const e2 = new THREE.Vector3().crossVectors(out, e1);
    if (e2.dot(camUp) < 0) e2.negate();
    // The hand is low and to the right; the view comes in from the side of the swing.
    const handle = e2.clone().sub(e1).normalize();
    const side = e1.clone().add(e2).normalize().multiplyScalar(across ? -1 : 1);
    for (let k = 0; k < count; k++) {
      const local = across
        ? new THREE.Vector3(c.x, this.slot.max.y + 0.005, this.slot.min.z + (k + 0.5) * (size.z / count))
        : new THREE.Vector3(this.slot.min.x + (k + 0.5) * (size.x / count), c.y, faceZ + sgn * 0.005);
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
        if (!across) nail.rotation.set(sgn * Math.PI / 2, 0, 0);
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
    this.camLook.copy(this.camTo.look);
    if (this.tool) {
      this.pivot.visible = true;
      this.pivot.position.copy(this.gripFor(this.markers[0]));
    }
  }

  /** The head of a nail (or the spot to settle), in the world. */
  private headAt(m: Marker): THREE.Vector3 {
    m.mesh.updateWorldMatrix(true, false);
    return m.mesh.localToWorld(new THREE.Vector3(0, m.top, 0));
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
    // The view closes in on the nail, from the side the hammer swings across.
    const camAt = head.clone().addScaledVector(m.out, 0.75).addScaledVector(m.side, 0.6);
    this.camera.position.lerp(camAt, smooth(4));
    this.camLook.lerp(head, smooth(6));
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
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
