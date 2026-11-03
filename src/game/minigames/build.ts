import * as THREE from 'three';
import { STRUCTURES, totalMaterials, type StructureDef } from '../../data/structures';
import { itemDef } from '../../data/items';
import type { StructureObj } from '../../world/world';
import { builtShare, fillsAcross, pieceBounds } from '../../world/pieceFill';
import { surfaceMat, type Surface } from '../../world/surfaces';
import { clamp01, Minigame, workTool, type Meter, type MgInput } from './core';
import { sfx } from './sfx';
import type { Gesture } from './tutorials';

// Building, on the piece itself. The view goes to your planned wall (or floor,
// or roof) where it stands; the next course of it glows. You carry the
// material in (a plank, a log, a stone...), line it up with the glowing slot
// and set it; then fix it: drive the nails home with your hammer, or settle a
// log with your hatchet, striking as each ring closes. The piece rises (or a
// floor spreads) one course at a time as you go.

type Phase = 'arrive' | 'place' | 'set' | 'fix' | 'done';

interface Marker { pos: THREE.Vector3; mesh: THREE.Object3D; hits: number; need: number; bent: boolean }

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
      add(new THREE.BoxGeometry(w, h, d), mat('planks'));
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
  private tool: THREE.Object3D | null;
  private swing = 0;
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
    this.instructions = `Move the ${matName} onto the glowing slot and click to set it.${fixes === 'nail' ? ' Then hammer each nail home: click as the ring closes on it.' : fixes === 'settle' ? ' Then settle it with your hatchet: strike as the ring closes.' : ''}`;
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
    this.tool = fixes ? workTool(toolType) : null;
    if (this.tool) { this.tool.visible = false; this.overlay.add(this.tool); }

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
      const p = this.toScreen(this.markers[this.current].pos);
      return { x: p.x + 30, y: p.y - 50, text: 'click as the ring closes', gesture: 'click' };
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
    const count = kind === 'settle' ? 2 : across ? 2 : Math.max(2, Math.min(4, Math.round(size.x / 0.6)));
    for (let k = 0; k < count; k++) {
      const local = across
        ? new THREE.Vector3(c.x, this.slot.max.y + 0.005, this.slot.min.z + (k + 0.5) * (size.z / count))
        : new THREE.Vector3(this.slot.min.x + (k + 0.5) * (size.x / count), c.y, faceZ + Math.sign(faceZ - c.z || 1) * 0.005);
      let mesh: THREE.Object3D;
      if (kind === 'nail') {
        // A nail standing proud of the wood, its head toward you.
        const nail = new THREE.Group();
        const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6), new THREE.MeshStandardMaterial({ color: 0x8a8a8e, metalness: 0.6, roughness: 0.4 }));
        shank.position.y = 0.035;
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 10), shank.material);
        head.position.y = 0.07;
        nail.add(shank, head);
        // Point it out of the face.
        if (across) nail.rotation.set(0, 0, 0);
        else nail.rotation.set((faceZ > c.z ? 1 : -1) * Math.PI / 2, 0, 0);
        nail.position.copy(local);
        mesh = nail;
      } else {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, fog: false }));
        mesh.position.copy(local);
      }
      this.piece.add(mesh);
      this.markers.push({ pos: this.piece.localToWorld(local.clone()), mesh, hits: 0, need: kind === 'nail' ? 2 : 1, bent: false });
    }
    this.current = 0;
    this.ringT = 0;
    this.ring.visible = true;
    if (this.tool) this.tool.visible = true;
  }

  private fix(dt: number, i: MgInput) {
    const m = this.markers[this.current];
    if (!m) return;
    // The ring closes on the nail; strike as it meets the head.
    this.ringT = (this.ringT + dt / this.period) % 1;
    const r = 0.03 + (1 - this.ringT) * 0.16;
    this.ring.position.copy(m.pos);
    this.ring.lookAt(this.camera.position);
    this.ring.scale.setScalar(r);
    const close = Math.abs(this.ringT - 0.85);
    (this.ring.material as THREE.MeshBasicMaterial).color.set(close < 0.06 ? 0x9fdc7c : 0xffffff);
    // The tool hangs ready by the nail, and swings down onto it.
    if (this.tool) {
      this.swing = Math.max(0, this.swing - dt * 5);
      const up = new THREE.Vector3(0, 0.25 + 0.25 * this.swing, 0);
      this.tool.position.copy(m.pos).add(up).add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(-0.12));
      this.tool.rotation.set(0, Math.atan2(this.camera.position.x - m.pos.x, this.camera.position.z - m.pos.z) + Math.PI / 2, -0.3 - this.swing * 0.9);
    }
    if (!i.pressed) return;
    const p = this.toScreen(m.pos);
    if (Math.hypot(i.x - p.x, i.y - p.y) > 60) { this.say('Aim at the nail.', false, 0.6); return; }
    this.swing = 1;
    const q = clamp01(1 - close / 0.22);
    this.strikeQ.push(q);
    this.sample(q, 1);
    if (q > 0.55) {
      m.hits++;
      sfx.tick(m.hits + this.current);
      this.dust(m.pos, 5);
      // Driven in a little more; home on the last blow.
      if (this.fixKind() === 'nail') {
        const shank = m.mesh;
        shank.translateY(-0.035 * (q > 0.85 ? 1.3 : 1));
      } else {
        sfx.thud();
      }
      if (q > 0.9) this.say('Perfect!', true, 0.5);
      if (m.hits >= m.need || (q > 0.9 && this.fixKind() === 'nail' && m.hits >= 1)) {
        if (this.fixKind() !== 'nail') m.mesh.visible = false;
        this.current++;
        this.ringT = 0;
        if (this.current >= this.markers.length) this.finish();
      }
    } else {
      sfx.slip();
      this.say(this.fixKind() === 'nail' ? 'Glanced off — it bent!' : 'Glanced off!', false, 0.6);
      if (this.fixKind() === 'nail' && !m.bent) { m.bent = true; m.mesh.rotateZ(0.35); }
      m.need = Math.min(m.need + 1, 4);
    }
  }

  private finish() {
    this.phase = 'done';
    this.ring.visible = false;
    if (this.tool) this.tool.visible = false;
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
    if (this.tool) this.overlay.remove(this.tool);
    this.overlay.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const m = o.material as THREE.Material;
        m.dispose();
      }
    });
  }
}
