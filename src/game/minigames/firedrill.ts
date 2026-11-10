import * as THREE from 'three';
import { bowStave, fireboard, handhold, pouch, spindle, tinderNest } from '../../world/firekitModel';
import { clamp01, Minigame, type Meter, type MgInput } from './core';
import type { Gesture } from './tutorials';

// Making fire with the bow drill, out in the world: wherever you start it
// (beside the fire you're lighting, or on the ground before you), your fire
// making kit is laid out: the fireboard, the spindle stood in its socket, the
// handhold on top, the bow's cord turned round the spindle, a bark tray under
// the notch and a nest of tinder ready. You kneel at it; the view comes down
// to it. Saw the bow in a steady rhythm: the spindle spins, smoke curls up
// from the socket, the dust in the notch glows, and the ember is tipped into
// the tinder, which catches.

/** Where the kit is laid out: on the ground (y), facing whoever's making fire. */
export interface FireSpot { x: number; y: number; z: number }

type Phase = 'arrive' | 'drill' | 'blow' | 'done';

export class FireDrillGame extends Minigame {
  readonly title = 'Making fire';
  readonly instructions = 'Hold the left button and saw the bow left and right in a steady rhythm: the spindle spins and heats the board until the dust in the notch glows. Too wild and the spindle slips out.';
  showPointer = false;
  /** Played out in the world itself (the game draws it from this camera). */
  readonly inWorld = true;
  readonly hidesPlayer = false;
  readonly overlay = new THREE.Group();
  /** You kneel at it. */
  readonly bodyClip = 'crouch_idle' as const;
  readonly stand: { x: number; z: number; yaw: number };
  readonly workLight = new THREE.Vector3();
  private work = new THREE.Group();
  private phase: Phase = 'arrive';
  private t = 0;
  private heat = 0;
  private bowX = 0;
  private lastDir = 0;
  private lastFlip = 0;
  private spin = new THREE.Group();
  private bow: THREE.Group;
  private tips: [THREE.Vector3, THREE.Vector3];
  private cords: THREE.Mesh[] = [];
  private ember: THREE.Mesh;
  private dust: THREE.Mesh;
  private flame: THREE.Mesh;
  private nest: THREE.Group;
  private smoke: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  private camFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private camTo = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  /** Materials made here (the photographed ones are shared, and kept). */
  private owned: THREE.Material[] = [];
  /** Where the socket in use is (work frame). */
  private readonly socket = new THREE.Vector3(-0.08, 0.03, 0.025);

  constructor(ease: number, spot: FireSpot, from: THREE.Camera) {
    super(ease);
    // Facing you: +z toward where you are.
    const toYou = new THREE.Vector3(from.position.x - spot.x, 0, from.position.z - spot.z);
    if (toYou.lengthSq() < 1e-4) toYou.set(0, 0, 1);
    toYou.normalize();
    const yaw = Math.atan2(toYou.x, toYou.z);
    this.work.position.set(spot.x, spot.y, spot.z);
    this.work.rotation.y = yaw;
    this.overlay.add(this.work);
    const standAt = new THREE.Vector3(spot.x, 0, spot.z).addScaledVector(toYou, 0.62);
    this.stand = { x: standAt.x, z: standAt.z, yaw };

    // A patch of scuffed earth, the fireboard on it with the socket toward you.
    const own = <T extends THREE.Material>(m: T) => { this.owned.push(m); return m; };
    const earth = new THREE.Mesh(new THREE.CircleGeometry(0.36, 24).rotateX(-Math.PI / 2), own(new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, transparent: true, opacity: 0.45, depthWrite: false })));
    earth.position.y = 0.004; earth.receiveShadow = true;
    this.work.add(earth);
    const board = fireboard();
    board.rotation.y = Math.PI; // (the notches toward you, under the socket's edge)
    board.position.set(0, 0, 0);
    this.work.add(board);
    // The bark tray under the notch, where the ember drops; the tinder nest beside it.
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 12, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.5, 1), own(new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 1, side: THREE.DoubleSide })));
    tray.position.set(this.socket.x, 0.008, this.socket.z + 0.05);
    this.work.add(tray);
    this.dust = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6).scale(1.4, 0.5, 1.2), own(new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1 })));
    this.dust.position.set(this.socket.x, 0.012, this.socket.z + 0.045);
    this.dust.scale.setScalar(0.3);
    this.work.add(this.dust);
    this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), own(new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff4400, emissiveIntensity: 0 })));
    this.ember.position.copy(this.dust.position).add(new THREE.Vector3(0, 0.006, 0));
    this.work.add(this.ember);
    this.nest = tinderNest(0.075);
    this.nest.position.set(0.24, 0, 0.12);
    this.work.add(this.nest);
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), own(new THREE.MeshStandardMaterial({ color: 0xffa030, emissive: 0xff6a00, emissiveIntensity: 2.5, transparent: true, opacity: 0.85 })));
    this.flame.position.set(0.24, 0.1, 0.12);
    this.flame.visible = false;
    this.flame.castShadow = false;
    this.work.add(this.flame);
    // The kit's other things laid by: the pouch, a little bundle of kindling.
    const bag = pouch();
    bag.position.set(-0.3, 0, -0.06); bag.rotation.y = 0.6;
    this.work.add(bag);
    for (let k = 0; k < 5; k++) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.2, 5).rotateZ(Math.PI / 2), own(new THREE.MeshStandardMaterial({ color: 0xb09060, roughness: 0.9 })));
      stick.position.set(0.3 + (k % 2) * 0.012, 0.008 + Math.floor(k / 2) * 0.011, -0.08 + k * 0.012);
      stick.rotation.y = 0.5 + k * 0.05;
      stick.castShadow = true;
      this.work.add(stick);
    }
    // The spindle, stood in the socket (spinning), the handhold pressing it down.
    const sp = spindle(0.3);
    this.spin.add(sp);
    this.spin.position.copy(this.socket);
    this.work.add(this.spin);
    const hold = handhold();
    hold.position.set(this.socket.x, this.socket.y + 0.3, this.socket.z);
    this.work.add(hold);
    // The bow, held level across, its cord turned round the spindle.
    const b = bowStave(0.56);
    this.bow = b.group;
    this.tips = b.tips;
    this.bow.position.set(this.socket.x, this.socket.y + 0.13, this.socket.z + 0.07);
    this.work.add(this.bow);
    for (let k = 0; k < 2; k++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 1, 4), own(new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.9 })));
      this.cords.push(c);
      this.work.add(c);
    }
    this.placeCords();

    // Glide in from your own view: down beside the kit, looking at the socket and the nest.
    this.camFrom.pos.copy(from.position);
    this.camFrom.quat.copy(from.quaternion);
    this.camTo.copy(this.work.localToWorld(new THREE.Vector3(0.78, 0.6, -0.12)));
    this.lookAt.copy(this.work.localToWorld(new THREE.Vector3(0.02, 0.09, 0.1)));
    this.camera.position.copy(from.position);
    this.camera.quaternion.copy(from.quaternion);
    if ((from as THREE.PerspectiveCamera).fov) this.camera.fov = (from as THREE.PerspectiveCamera).fov;
    this.camera.near = 0.02;
    this.camera.updateProjectionMatrix();
    this.workLight.copy(this.work.localToWorld(new THREE.Vector3(0.2, 0.5, 0.4)));
  }

  /** Where you kneel (at the kit, facing it). */
  standAt(): { x: number; z: number; face: { x: number; z: number } } {
    const p = this.work.position;
    return { x: this.stand.x, z: this.stand.z, face: { x: p.x, z: p.z } };
  }

  /** The cord from each tip of the bow, round the spindle (a turn on either side of it). */
  private placeCords() {
    this.work.updateMatrixWorld(true);
    const sx = this.socket.x, sy = this.bow.position.y, sz = this.socket.z;
    this.tips.forEach((tip, k) => {
      const a = this.work.worldToLocal(this.bow.localToWorld(tip.clone()));
      const b = new THREE.Vector3(sx + (k ? 0.013 : -0.013), sy, sz + 0.005);
      const c = this.cords[k];
      c.position.copy(a).add(b).multiplyScalar(0.5);
      c.scale.y = a.distanceTo(b);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    });
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    if (this.phase !== 'drill') return null;
    const p = this.toScreen(this.work.localToWorld(this.bow.position.clone()));
    return { x: p.x + 40, y: p.y - 60, text: 'hold and saw the bow left/right in a steady rhythm', gesture: 'leftright' };
  }

  meters(): Meter[] {
    return [{ label: 'Heat', value: clamp01(this.heat), color: '#f2a54e' }];
  }

  update(dt: number, i: MgInput) {
    this.t += dt;
    this.updateSmoke(dt);
    switch (this.phase) {
      case 'arrive': {
        const k = Math.min(1, this.t / 0.7), e = k * k * (3 - 2 * k);
        this.camera.position.lerpVectors(this.camFrom.pos, this.camTo, e);
        const look = new THREE.PerspectiveCamera();
        look.position.copy(this.camTo);
        look.lookAt(this.lookAt);
        this.camera.quaternion.slerpQuaternions(this.camFrom.quat, look.quaternion, e);
        this.camera.updateMatrixWorld();
        if (k >= 1) { this.phase = 'drill'; this.t = 0; }
        return;
      }
      case 'drill': {
        this.heat = Math.max(0, this.heat - dt * 0.09);
        if (i.down && i.dx !== 0) {
          const dir = Math.sign(i.dx), speed = Math.abs(i.dx) / Math.max(dt, 1e-3);
          this.bowX = Math.max(-0.16, Math.min(0.16, this.bowX + i.dx * 0.0009));
          if (dir !== this.lastDir) {
            // A good rhythm: a stroke every 0.15-0.9 s.
            const gap = this.time - this.lastFlip;
            if (this.lastDir !== 0) this.sample(gap > 0.15 && gap < 0.9 ? 1 : 0.4, 0.3);
            this.lastFlip = this.time;
            this.lastDir = dir;
          }
          if (speed > 2600 + this.ease * 1500) {
            this.heat = Math.max(0, this.heat - 0.12);
            this.say('The spindle slips!', false, 0.7);
            this.sample(0, 0.5);
            this.spin.rotation.z = (Math.random() - 0.5) * 0.25;
          } else {
            this.heat += Math.min(speed, 1800) * dt * 0.00028 * (0.7 + 0.5 * this.ease);
            this.spin.rotation.z *= 0.8;
          }
          // The cord turns the spindle as the bow goes by.
          this.spin.rotation.y += i.dx * 0.09;
        }
        this.bow.position.x = this.socket.x + this.bowX;
        this.placeCords();
        // The dust gathers in the notch, darkens, and starts to glow; smoke rises from the socket.
        this.dust.scale.setScalar(0.3 + 0.7 * clamp01(this.heat * 1.4));
        (this.ember.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.max(0, this.heat - 0.45) * 6;
        if (this.heat > 0.3 && Math.random() < dt * (4 + this.heat * 14)) this.puff(this.socket.clone().add(new THREE.Vector3(0, 0.01, 0.01)), 0.6 + this.heat);
        this.progress = clamp01(this.heat * 0.9);
        if (this.heat >= 1) {
          this.phase = 'blow'; this.t = 0;
          this.sample(clamp01(1.3 - this.time / 14), 2);
          this.say('An ember! Into the tinder...', true, 1.2);
        }
        return;
      }
      case 'blow': {
        // The ember tipped into the nest, blown on, and it catches.
        const k = Math.min(1, this.t / 1.4);
        this.ember.position.lerpVectors(this.dust.position.clone().add(new THREE.Vector3(0, 0.006, 0)), this.nest.position.clone().add(new THREE.Vector3(0, 0.03, 0)), Math.min(1, k * 2));
        if (Math.random() < dt * 20) this.puff(this.nest.position.clone().add(new THREE.Vector3(0, 0.04, 0)), 1.2);
        if (k > 0.6) {
          this.flame.visible = true;
          const s = (k - 0.6) / 0.4;
          this.flame.scale.set(0.4 + s * 0.6, (0.4 + s * 0.8) * (1 + Math.sin(this.time * 18) * 0.12), 0.4 + s * 0.6);
        }
        this.progress = clamp01(0.9 + k * 0.1);
        if (k >= 1) { this.phase = 'done'; this.done = true; this.say('It catches!', true); }
        return;
      }
      case 'done':
        this.flame.scale.y = 1.2 * (1 + Math.sin(this.time * 18) * 0.12);
        return;
    }
  }

  /** A curl of smoke. */
  private puff(at: THREE.Vector3, size: number) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.012 * size, 6, 5), new THREE.MeshStandardMaterial({ color: 0xc8c4bc, transparent: true, opacity: 0.45, roughness: 1, depthWrite: false }));
    m.position.copy(at);
    m.castShadow = false;
    this.work.add(m);
    this.smoke.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 0.04, 0.12 + Math.random() * 0.08, (Math.random() - 0.5) * 0.04), life: 1.4 });
  }

  private updateSmoke(dt: number) {
    for (const s of [...this.smoke]) {
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.multiplyScalar(1 + dt * 1.4);
      (s.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, s.life * 0.32);
      if (s.life <= 0) { this.work.remove(s.mesh); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); this.smoke.splice(this.smoke.indexOf(s), 1); }
    }
  }

  resize() { /* the game's own camera keeps its shape */ }

  dispose() {
    this.overlay.removeFromParent();
    this.overlay.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      if (!o.userData.sharedMat) (o.material as THREE.Material).dispose();
    });
    for (const m of this.owned) m.dispose();
  }
}
