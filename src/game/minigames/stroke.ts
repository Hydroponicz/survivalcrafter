import * as THREE from 'three';
import { benchMesh, box, clamp01, cyl, fireMesh, logMesh, Minigame, type Meter, type MgInput } from './core';
import type { Gesture } from './tutorials';

/**
 * Saw a log into planks. Hold the left button and move the mouse up and down
 * to draw the saw; keep it on the marked line by steering left/right. Rushing
 * makes the blade bind.
 */
export class SawGame extends Minigame {
  readonly title = 'Sawing';
  readonly instructions = 'Hold left button and move the mouse up/down to saw. Steer left/right to stay on the line. Don’t rush.';
  showPointer = false;
  private readonly R = 0.2;
  private cuts: number[];
  private cut = 0;
  private depth = 0;
  private stroke = 0;
  private offset = 0;
  private drift = 0;
  private bind = 0;
  private stuck = false;
  private saw = new THREE.Group();
  private guide: THREE.Mesh;
  private kerfs: THREE.Mesh[] = [];
  private logY = 0.32;

  constructor(ease: number, cuts: number) {
    super(ease);
    this.cuts = Array.from({ length: cuts }, (_, i) => -0.55 + ((i + 1) * 1.1) / (cuts + 1));
    this.scene.add(benchMesh());
    for (const x of [-0.85, 0.85]) {
      const trestle = box(0.1, 0.24, 0.5, 0x6e4e30);
      trestle.position.set(x, 0.12, 0);
      this.scene.add(trestle);
    }
    const log = logMesh(2.0, this.R);
    log.position.y = this.logY;
    this.scene.add(log);
    this.guide = box(0.006, 0.006, 0.42, 0xff4030, { emissive: 0xff2010, emissiveIntensity: 1.5 });
    this.scene.add(this.guide);
    const blade = box(0.006, 0.12, 0.85, 0xb8bcc2, { metalness: 0.7, roughness: 0.35 });
    blade.position.set(0, 0.06, 0);
    const handle = box(0.04, 0.16, 0.14, 0x7a5634);
    handle.position.set(0, 0.1, 0.48);
    this.saw.add(blade, handle);
    this.scene.add(this.saw);
    this.look([0.55, 1.05, 1.15], [0, 0.28, 0]);
    this.placeGuide();
  }

  private placeGuide() {
    this.guide.position.set(this.cuts[this.cut], this.logY + this.R + 0.004, 0);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    const p = this.toScreen(this.saw.position);
    if (this.stuck) return { x: p.x + 40, y: p.y - 40, text: 'it\u2019s binding: let go, then ease back in', gesture: 'release' };
    return { x: p.x + 40, y: p.y - 40, text: 'hold and move up/down to saw; stay on the red line', gesture: 'updown' };
  }

  update(dt: number, i: MgInput) {
    const tol = 0.012 + 0.03 * this.ease;
    // The grain pulls the blade off line unless you correct it.
    this.drift += (Math.random() - 0.5) * dt * 0.06 * (1.2 - this.ease);
    this.drift *= 0.98;
    this.offset += this.drift * dt + i.dx * 0.0012;
    this.offset = Math.max(-0.08, Math.min(0.08, this.offset));
    const prev = this.stroke;
    if (i.down && !this.stuck) this.stroke = Math.max(-0.3, Math.min(0.3, this.stroke + i.dy * 0.004));
    const moved = Math.abs(this.stroke - prev);
    const speed = moved / Math.max(dt, 1e-3);
    const align = clamp01(1 - Math.abs(this.offset) / tol);

    if (speed > 1.6 + this.ease * 1.2) this.bind += dt * 3;
    else this.bind = Math.max(0, this.bind - dt * 1.2);
    if (this.bind >= 1 && !this.stuck) { this.stuck = true; this.say('The saw binds! Let go and ease off.', false, 1.4); }
    if (this.stuck && !i.down && this.bind < 0.4) this.stuck = false;

    if (i.down && !this.stuck && moved > 0) {
      this.depth += moved * 0.085 * (0.25 + 0.75 * align);
      this.sample(align, moved);
      if (align < 0.3 && Math.random() < dt * 6) this.say('Off the line!', false, 0.6);
      if (Math.random() < moved * 40) this.burst(new THREE.Vector3(this.cuts[this.cut] + this.offset, this.logY + this.R - this.depth, 0.2), 0xd9b88a, 2, 0.5);
    }
    const full = this.R * 2;
    if (this.depth >= full) {
      const kerf = box(0.012, full + 0.01, this.R * 2.02, 0x2a1c10);
      kerf.position.set(this.cuts[this.cut] + this.offset * 0.5, this.logY, 0);
      this.scene.add(kerf);
      this.kerfs.push(kerf);
      this.cut++;
      this.depth = 0;
      this.offset = 0;
      this.say(this.cut < this.cuts.length ? 'Cut through! Next line.' : 'Done!', true);
      if (this.cut >= this.cuts.length) { this.done = true; this.progress = 1; return; }
      this.placeGuide();
    }
    this.progress = (this.cut + this.depth / full) / this.cuts.length;
    const x = this.cuts[this.cut] + this.offset;
    this.saw.position.set(x, this.logY + this.R - this.depth + 0.02, this.stroke);
    this.saw.rotation.x = -0.15;
  }

  meters(): Meter[] {
    return [{ label: 'Blade bind', value: clamp01(this.bind), band: [0, 0.7], color: '#ef7d6a' }];
  }
}

/**
 * Start a fire with a bow drill. Hold the left button and saw the bow left and
 * right in a steady rhythm to build heat until an ember forms.
 */
export class BowDrillGame extends Minigame {
  readonly title = 'Bow drill';
  readonly instructions = 'Hold left button and move the mouse left/right in a steady rhythm. Too wild and the spindle slips.';
  showPointer = false;
  private heat = 0;
  private bowX = 0;
  private lastDir = 0;
  private lastFlip = 0;
  private spindle: THREE.Mesh;
  private bow = new THREE.Group();
  private ember: THREE.Mesh;

  constructor(ease: number) {
    super(ease);
    const ground = box(2.5, 0.05, 2, 0x4a6b2c);
    ground.position.y = -0.025;
    this.scene.add(ground);
    const board = box(0.6, 0.04, 0.14, 0x9a7650);
    board.position.y = 0.02;
    this.scene.add(board);
    const tinder = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ color: 0xc9b07a, flatShading: true }));
    tinder.position.set(0.1, 0.03, 0.1);
    this.scene.add(tinder);
    this.spindle = cyl(0.015, 0.015, 0.36, 0xb08a5a, 8);
    this.spindle.position.set(0, 0.22, 0);
    this.scene.add(this.spindle);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.012, 6, 24, Math.PI * 0.7), new THREE.MeshStandardMaterial({ color: 0x6b4a2c }));
    arc.rotation.set(Math.PI / 2, 0, Math.PI * 0.15);
    const cord = box(0.5, 0.004, 0.004, 0xe0d4b0);
    cord.position.set(0, 0, -0.1);
    this.bow.add(arc, cord);
    this.bow.position.set(0, 0.2, 0.1);
    this.scene.add(this.bow);
    this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff4400, emissiveIntensity: 0 }));
    this.ember.position.set(0, 0.045, 0);
    this.scene.add(this.ember);
    this.look([0.2, 0.7, 0.8], [0, 0.12, 0]);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    const p = this.toScreen(this.bow.position);
    return { x: p.x + 40, y: p.y - 50, text: 'hold and saw left/right in a steady rhythm', gesture: 'leftright' };
  }

  update(dt: number, i: MgInput) {
    this.heat = Math.max(0, this.heat - dt * 0.09);
    if (i.down && i.dx !== 0) {
      const dir = Math.sign(i.dx);
      const speed = Math.abs(i.dx) / Math.max(dt, 1e-3);
      this.bowX = Math.max(-0.25, Math.min(0.25, this.bowX + i.dx * 0.0012));
      if (dir !== this.lastDir) {
        // A good rhythm is a stroke every ~0.2-0.8 s.
        const gap = this.time - this.lastFlip;
        if (this.lastDir !== 0) this.sample(gap > 0.15 && gap < 0.9 ? 1 : 0.4, 0.3);
        this.lastFlip = this.time;
        this.lastDir = dir;
      }
      if (speed > 2600 + this.ease * 1500) {
        this.heat = Math.max(0, this.heat - 0.12);
        this.say('The spindle slips!', false, 0.7);
        this.sample(0, 0.5);
      } else {
        this.heat += Math.min(speed, 1800) * dt * 0.00028 * (0.7 + 0.5 * this.ease);
      }
      this.spindle.rotation.y += i.dx * 0.05;
    }
    this.bow.position.x = this.bowX;
    const e = this.ember.material as THREE.MeshStandardMaterial;
    e.emissiveIntensity = Math.max(0, this.heat - 0.4) * 5;
    if (this.heat > 0.55 && Math.random() < dt * 8) this.burst(new THREE.Vector3(0, 0.05, 0), 0x777777, 1, 0.25);
    this.progress = clamp01(this.heat);
    if (this.heat >= 1) {
      this.done = true;
      // Faster ignition is better work.
      this.sample(clamp01(1.3 - this.time / 14), 2);
      this.say('An ember!', true);
    }
  }

  meters(): Meter[] {
    return [{ label: 'Heat', value: clamp01(this.heat), color: '#f2a54e' }];
  }
}

/**
 * Smelt ore at the forge: pump the bellows (hold left button, pull the mouse
 * down, then let it rise) to keep the heat in the band while the ore melts.
 */
export class BellowsGame extends Minigame {
  readonly title = 'Smelting';
  readonly instructions = 'Hold left button and pull the mouse down to pump the bellows, then up to refill. Keep the heat in the green band.';
  showPointer = false;
  private heat = 0.3;
  private squeeze = 0;
  private melt = 0;
  private bellows = new THREE.Group();
  private coals: THREE.Mesh;
  private crucible: THREE.Mesh;
  private fire = fireMesh();
  private band: [number, number];

  constructor(ease: number) {
    super(ease);
    this.band = [0.58 - 0.1 * ease, 0.8 + 0.06 * ease];
    const hearth = box(1.0, 0.5, 0.8, 0x6f665e, { flatShading: true });
    hearth.position.y = -0.25;
    this.scene.add(hearth);
    this.coals = box(0.5, 0.06, 0.4, 0x221510, { emissive: 0xff3300, emissiveIntensity: 0.3 });
    this.coals.position.y = 0.03;
    this.scene.add(this.coals);
    this.fire.group.scale.setScalar(0.8);
    this.scene.add(this.fire.group);
    this.crucible = cyl(0.09, 0.07, 0.14, 0x55504a, 12);
    this.crucible.position.set(0, 0.13, 0);
    this.scene.add(this.crucible);
    const top = box(0.36, 0.03, 0.22, 0x7a5634);
    top.position.y = 0.12;
    const bottom = box(0.36, 0.03, 0.22, 0x7a5634);
    const leather = box(0.32, 0.1, 0.2, 0x5a3a24);
    leather.position.y = 0.06;
    this.bellows.add(top, bottom, leather);
    this.bellows.position.set(0.75, 0.0, 0.1);
    this.bellows.userData = { top, leather };
    this.scene.add(this.bellows);
    this.look([0.55, 0.85, 1.25], [0.2, 0.05, 0]);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    const p = this.toScreen(this.bellows.position);
    const at = { x: p.x - 60, y: p.y - 70 };
    if (this.heat > this.band[1]) return { ...at, text: 'too hot: ease off and let it cool', gesture: 'wait' };
    if (this.heat < this.band[0]) return this.squeeze > 0.9
      ? { ...at, text: 'let the bellows refill: move up', gesture: 'up' }
      : { ...at, text: 'hold and pull down to pump', gesture: 'down' };
    return { ...at, text: 'in the green: keep it there', gesture: 'wait' };
  }

  update(dt: number, i: MgInput) {
    this.heat = Math.max(0, this.heat - dt * 0.11);
    if (i.down && i.dy > 0) {
      const before = this.squeeze;
      this.squeeze = Math.min(1, this.squeeze + i.dy * 0.006);
      this.heat += (this.squeeze - before) * 0.42;
    } else if (i.dy < 0 || !i.down) {
      this.squeeze = Math.max(0, this.squeeze + Math.min(0, i.dy) * 0.006 - (i.down ? 0 : dt * 1.5));
    }
    this.heat = Math.min(1.1, this.heat);
    const [lo, hi] = this.band;
    if (this.heat >= lo && this.heat <= hi) {
      this.melt += dt / 7;
      this.sample(1, dt);
    } else if (this.heat > hi) {
      this.melt += dt / 14;
      this.sample(0.25, dt);
      if (Math.random() < dt * 2) this.say('Too hot — the iron is burning!', false, 0.8);
    } else if (this.time > 1.5 && Math.random() < dt * 0.8) {
      this.say('Pump the bellows!', false, 0.8);
    }
    const { top, leather } = this.bellows.userData as { top: THREE.Mesh; leather: THREE.Mesh };
    top.position.y = 0.12 - this.squeeze * 0.08;
    leather.scale.y = 1 - this.squeeze * 0.75;
    leather.position.y = 0.06 - this.squeeze * 0.04;
    (this.coals.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + this.heat * 2;
    (this.crucible.material as THREE.MeshStandardMaterial).emissive.setRGB(this.melt * 0.9, this.melt * 0.35, 0);
    this.fire.flicker(this.time, 0.4 + this.heat);
    if (this.heat > hi && Math.random() < dt * 20) this.burst(new THREE.Vector3(0, 0.2, 0), 0xffa040, 1, 0.8, true);
    this.progress = clamp01(this.melt);
    if (this.melt >= 1) { this.done = true; this.say('The iron runs clear!', true); }
  }

  meters(): Meter[] {
    return [{ label: 'Heat', value: clamp01(this.heat), band: this.band, color: '#f2a54e' }];
  }
}
