import * as THREE from 'three';
import { box, clamp01, cyl, Minigame, type Meter, type MgInput } from './core';
import type { Gesture } from './tutorials';

const STEAM = 0xdfe6ea;

/** A pair of tongs: two long arms meeting at the jaws (local -X end). */
function tongsMesh(): THREE.Group {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const arm = box(0.55, 0.012, 0.012, 0x3a3a3c, { metalness: 0.6, roughness: 0.5 });
    arm.position.set(0.27, 0, s * 0.012);
    arm.rotation.y = s * 0.03;
    g.add(arm);
  }
  return g;
}

/**
 * Quench a freshly forged tool: hold the left button to plunge it into the
 * trough, let go to lift it. The water hardens it, but plunging a very hot
 * piece too long at once builds stress until it cracks. Keep it under as much
 * as you can without the Stress gauge reaching the red.
 */
export class QuenchGame extends Minigame {
  readonly title = 'Quenching';
  readonly instructions = 'Hold the left button to plunge the glowing tool into the water, let go to lift it out. Keep it under, but lift it before Stress hits the red or it cracks.';
  showPointer = false;
  private heat = 1;
  private stress = 0;
  private depth = 0;
  private cracks = 0;
  private piece = new THREE.Group();
  private blade: THREE.Mesh;
  private water: THREE.Mesh;
  private crackAt: number;
  private rate: number;

  constructor(ease: number, gear: number) {
    super(ease);
    // A better trough holds steadier, cooler water: stress builds more slowly.
    this.rate = 0.55 * (1.2 - 0.3 * gear) * (1.15 - 0.4 * ease);
    this.crackAt = 1;
    const wood = 0x7a5634;
    const floor = box(1.3, 0.04, 0.7, wood);
    floor.position.y = -0.3;
    this.scene.add(floor);
    for (const s of [-1, 1]) {
      const side = box(1.3, 0.34, 0.04, wood);
      side.position.set(0, -0.13, s * 0.33);
      const end = box(0.04, 0.34, 0.7, 0x6e4e30);
      end.position.set(s * 0.63, -0.13, 0);
      this.scene.add(side, end);
    }
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x3f6f8a, transparent: true, opacity: 0.75, roughness: 0.15 }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -0.02;
    this.scene.add(this.water);
    this.blade = box(0.32, 0.015, 0.07, 0x552200, { emissive: 0xff5500, emissiveIntensity: 1.6, metalness: 0.4 });
    this.blade.position.x = -0.16;
    const tongs = tongsMesh();
    tongs.position.x = 0.0;
    this.piece.add(this.blade, tongs);
    this.piece.rotation.z = 0.45;
    this.scene.add(this.piece);
    this.look([0.25, 1.05, 1.55], [0, -0.05, 0]);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    const p = this.toScreen(new THREE.Vector3(-0.1, 0.05, 0));
    const at = { x: p.x + 80, y: p.y - 80 };
    if (this.depth > 0.5 && this.stress > 0.72) return { ...at, text: 'lift it out now: let go!', gesture: 'release' };
    if (this.depth < 0.5 && this.stress > 0.45) return { ...at, text: 'let the stress ease a moment', gesture: 'wait' };
    if (this.depth < 0.5) return { ...at, text: 'hold the left button to plunge it', gesture: 'hold' };
    return { ...at, text: 'keep it under… watch the Stress gauge', gesture: 'hold' };
  }

  update(dt: number, i: MgInput) {
    const target = i.down ? 1 : 0;
    this.depth += (target - this.depth) * Math.min(1, dt * 10);
    const under = this.depth > 0.5;
    if (under) {
      // Hotter metal shocks harder.
      this.stress += dt * this.rate * (0.4 + this.heat);
      this.heat = Math.max(0, this.heat - dt * 0.16);
      this.sample(1, dt);
      if (Math.random() < dt * 30 * (0.2 + this.heat)) this.burst(new THREE.Vector3(-0.15 + (Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.1), STEAM, 1, 0.5);
    } else {
      this.stress = Math.max(0, this.stress - dt * 0.55);
      this.heat = Math.max(0, this.heat - dt * 0.02);
      // Dawdling in the air lets it cool unevenly.
      this.sample(0.45, dt * 0.6);
    }
    if (this.stress >= this.crackAt) {
      this.cracks++;
      this.stress = 0.55;
      this.sample(0, 2.5);
      this.say(this.cracks >= 3 ? 'It cracks badly!' : 'Crack! Too long under.', false, 1.1);
      this.burst(new THREE.Vector3(-0.15, 0.02, 0), 0xffa040, 10, 0.9, true);
      if (this.cracks >= 3) this.done = true;
    }
    this.piece.position.y = 0.2 - this.depth * 0.26;
    (this.blade.material as THREE.MeshStandardMaterial).emissiveIntensity = this.heat * 1.8;
    (this.blade.material as THREE.MeshStandardMaterial).color.setRGB(0.25 + this.heat * 0.15, 0.2 + 0.05 * this.heat, 0.2 - 0.2 * this.heat);
    this.progress = clamp01((1 - this.heat) / 0.9);
    if (this.progress >= 1 && !this.done) { this.done = true; this.say('Hardened!', true); }
  }

  meters(): Meter[] {
    return [
      { label: 'Metal heat', value: this.heat, color: '#f2a54e' },
      { label: 'Stress', value: clamp01(this.stress), band: [0, 0.8], color: this.stress > 0.8 ? '#ff6b5b' : '#8fc8ff' },
    ];
  }
}

/**
 * Cast molten iron into a sand mould: hold the left button and pull the mouse
 * down to tip the crucible, up to tip it back. Pour in a steady stream: too
 * fast splashes, too slow (or stopping) lets the metal skin over in the mould.
 */
export class PourGame extends Minigame {
  readonly title = 'Casting';
  readonly instructions = 'Hold the left button and pull the mouse down to tip the crucible, up to tip it back. Keep the Flow in the green band until the mould is full.';
  showPointer = false;
  private tilt = 0;
  private flow = 0;
  private fill = 0;
  private heat: number;
  private cool: number;
  private stalled = 0;
  private band: [number, number];
  private crucible = new THREE.Group();
  private metal: THREE.Mesh;
  private stream: THREE.Mesh;
  private pool: THREE.Mesh;

  constructor(ease: number, gear: number) {
    super(ease);
    // Better bellows got the metal hotter, so it stays runny for longer.
    this.heat = 0.85 + 0.15 * gear;
    this.cool = 0.03 * (1.25 - 0.5 * gear);
    this.band = [0.35 - 0.08 * ease, 0.65 + 0.1 * ease];
    const sand = box(1.0, 0.2, 0.7, 0xcdbb88, { flatShading: true });
    sand.position.y = -0.1;
    this.scene.add(sand);
    const cavity = box(0.56, 0.02, 0.24, 0x3a3020);
    cavity.position.y = 0.001;
    this.scene.add(cavity);
    this.pool = box(0.54, 0.02, 0.22, 0x552200, { emissive: 0xff6a00, emissiveIntensity: 2 });
    this.pool.position.y = 0.004;
    this.pool.scale.set(0.01, 1, 1);
    this.scene.add(this.pool);
    const pot = cyl(0.09, 0.07, 0.16, 0x55504a, 14);
    this.metal = cyl(0.075, 0.075, 0.02, 0x552200, 14, { emissive: 0xff7a10, emissiveIntensity: 2.2 });
    this.metal.position.y = 0.07;
    const tongs = tongsMesh();
    tongs.position.set(0.08, 0, 0);
    this.crucible.add(pot, this.metal, tongs);
    this.crucible.position.set(-0.12, 0.42, 0);
    this.scene.add(this.crucible);
    this.stream = cyl(0.012, 0.016, 1, 0x552200, 8, { emissive: 0xff7a10, emissiveIntensity: 2.4 });
    this.stream.visible = false;
    this.scene.add(this.stream);
    this.look([0.2, 0.9, 1.0], [0, 0.15, 0]);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    const p = this.toScreen(this.crucible.position);
    const at = { x: p.x + 110, y: p.y + 40 };
    if (this.flow > this.band[1]) return { ...at, text: 'too fast: move up to tip it back', gesture: 'up' };
    if (this.flow < this.band[0]) return { ...at, text: 'hold and pull down to tip it', gesture: 'down' };
    return { ...at, text: 'a steady stream: hold it there', gesture: 'hold' };
  }

  update(dt: number, i: MgInput) {
    if (i.down) this.tilt = clamp01(this.tilt + i.dy * 0.004);
    else this.tilt = Math.max(0, this.tilt - dt * 0.8);
    this.heat = Math.max(0, this.heat - dt * this.cool);
    // Nothing comes out until the lip tips past level.
    const target = Math.max(0, (this.tilt - 0.3) / 0.7) * 1.2;
    this.flow += (target - this.flow) * Math.min(1, dt * 6);
    const [lo, hi] = this.band;
    if (this.flow > 0.05) {
      this.fill += this.flow * dt / 6;
      this.stalled = 0;
      if (this.flow > hi) {
        this.sample(0.3, dt);
        if (Math.random() < dt * 20) this.burst(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.03, 0), 0xffa040, 1, 0.9, true);
        if (Math.random() < dt * 2) this.say('Too fast — it’s splashing!', false, 0.7);
      } else if (this.flow < lo) {
        this.sample(0.55, dt);
      } else {
        this.sample(1, dt);
      }
    } else if (this.fill > 0.02) {
      // A stopped pour skins over: a weak seam in the casting.
      this.stalled += dt;
      if (this.stalled > 0.8) {
        this.sample(0.15, dt);
        if (Math.random() < dt) this.say('Keep pouring — it’s skinning over!', false, 0.8);
      }
    }
    this.fill = Math.min(1, this.fill);
    this.crucible.rotation.z = -this.tilt * 1.6;
    this.metal.visible = this.fill < 0.98;
    const glow = 0.4 + this.heat * 2;
    (this.metal.material as THREE.MeshStandardMaterial).emissiveIntensity = glow;
    (this.pool.material as THREE.MeshStandardMaterial).emissiveIntensity = glow;
    this.pool.scale.x = Math.max(0.01, this.fill);
    this.pool.position.x = -0.27 + 0.27 * this.fill;
    // The stream falls from the crucible's lip into the mould.
    const lip = new THREE.Vector3(-0.09, 0.08, 0).applyEuler(this.crucible.rotation).add(this.crucible.position);
    this.stream.visible = this.flow > 0.05;
    if (this.stream.visible) {
      const h = Math.max(0.02, lip.y);
      this.stream.scale.set(0.5 + this.flow, h, 0.5 + this.flow);
      this.stream.position.set(lip.x, h / 2, 0);
    }
    this.progress = this.fill;
    if (this.fill >= 1) { this.done = true; this.say('The mould is full!', true); }
    else if (this.heat <= 0.05) {
      this.done = true;
      this.sample(0.1, 3);
      this.say('The iron froze in the crucible!', false, 1.2);
    }
  }

  meters(): Meter[] {
    const max = 1.2;
    return [
      { label: 'Flow', value: clamp01(this.flow / max), band: [this.band[0] / max, this.band[1] / max], color: '#f2a54e' },
      { label: 'Metal heat', value: this.heat, color: '#ff8a5b' },
    ];
  }
}
