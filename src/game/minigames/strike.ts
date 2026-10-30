import * as THREE from 'three';
import { box, clamp01, cyl, logMesh, Minigame, ringMesh, type Meter, type MgInput } from './core';
import type { Gesture } from './tutorials';

export type StrikeVariant = 'split' | 'knap' | 'forge' | 'nail';

const TEXT: Record<StrikeVariant, { title: string; how: string }> = {
  split: { title: 'Splitting', how: 'Aim at the mark and click when the closing ring meets it. Clean strikes split clean wood.' },
  knap: { title: 'Knapping', how: 'Aim at the glowing spot on the stone and click as the ring closes to strike off a flake.' },
  forge: { title: 'Smithing', how: 'Aim at the mark and strike as the ring closes. Work fast — the metal cools!' },
  nail: { title: 'Nailing', how: 'Aim at the nail head and strike as the ring closes.' },
};

/**
 * Timed, aimed blows: a ring closes in on a mark; click as it meets the mark
 * with the pointer on it. Used for splitting, knapping, smithing and nailing.
 */
export class StrikeGame extends Minigame {
  readonly title: string;
  readonly instructions: string;
  private targets: THREE.Vector3[] = [];
  private hit = 0;
  private ring: THREE.Mesh;
  private mark: THREE.Mesh;
  private ringT = 0;
  private tool = new THREE.Group();
  private swing = 0;
  private swingTo = new THREE.Vector3();
  private heat = 1;
  private work: THREE.Object3D;
  private nails: THREE.Mesh[] = [];
  private period: number;
  private misses = 0;
  /** Facing of the struck surface: rings face +y (top) or +z (front). */
  private face: 'top' | 'front';

  /** Smithing equipment: anvil grade (truer strikes), bellows grade (hotter metal), iron or stone face. */
  private gear: { anvil: number; heat: number; iron: boolean };

  constructor(ease: number, private variant: StrikeVariant, private hits: number, gear?: { anvil?: number; heat?: number; iron?: boolean }) {
    super(ease);
    this.title = TEXT[variant].title;
    this.instructions = TEXT[variant].how;
    this.gear = { anvil: gear?.anvil ?? 0.5, heat: gear?.heat ?? 0.5, iron: gear?.iron ?? true };
    this.period = 1.5 + ease * 0.6 + (variant === 'forge' ? this.gear.anvil * 0.4 : 0);
    this.face = 'top';
    const toolHead = variant === 'split' ? 0x8a8a8a : variant === 'knap' ? 0x77736c : 0x5a5a5a;
    const handle = cyl(0.018, 0.018, 0.5, 0x7a5634, 6);
    handle.rotation.z = Math.PI / 2;
    handle.position.x = 0.25;
    const head = variant === 'knap'
      ? new THREE.Mesh(new THREE.DodecahedronGeometry(0.05), new THREE.MeshStandardMaterial({ color: toolHead, flatShading: true }))
      : box(variant === 'split' ? 0.12 : 0.07, 0.07, 0.07, toolHead, { metalness: 0.5 });
    this.tool.add(head);
    if (variant !== 'knap') this.tool.add(handle);

    if (variant === 'split') {
      const stump = cyl(0.3, 0.33, 0.4, 0x5a3c22, 16);
      stump.position.y = -0.2;
      this.scene.add(stump);
      const log = logMesh(0.45, 0.17);
      log.rotation.z = Math.PI / 2;
      log.position.y = 0.225;
      this.scene.add(log);
      this.work = log;
      for (let k = 0; k < hits; k++) {
        const a = (k / hits) * Math.PI * 2 + Math.random() * 0.6;
        this.targets.push(new THREE.Vector3(Math.cos(a) * 0.08, 0.452, Math.sin(a) * 0.08));
      }
      this.look([0.35, 1.2, 0.8], [0, 0.3, 0]);
    } else if (variant === 'knap') {
      const leather = box(0.7, 0.02, 0.5, 0x7a5a3a);
      this.scene.add(leather);
      const core = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 1), new THREE.MeshStandardMaterial({ color: 0x8d8a85, flatShading: true }));
      core.scale.set(1.4, 0.7, 1);
      core.position.y = 0.1;
      this.scene.add(core);
      this.work = core;
      for (let k = 0; k < hits; k++) {
        const a = (k / hits) * Math.PI * 2;
        this.targets.push(new THREE.Vector3(Math.cos(a) * 0.12, 0.17, Math.sin(a) * 0.07));
      }
      this.look([0.1, 0.75, 0.45], [0, 0.1, 0]);
    } else if (variant === 'forge') {
      const anvil = new THREE.Group();
      if (this.gear.iron) {
        const body = box(0.5, 0.35, 0.28, 0x55585c, { metalness: 0.6, roughness: 0.4 });
        body.position.y = -0.18;
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.6 }));
        horn.rotation.z = Math.PI / 2;
        horn.position.set(0.38, -0.06, 0);
        anvil.add(body, horn);
      } else {
        const body = box(0.6, 0.36, 0.34, 0x8a8782, { flatShading: true });
        body.position.y = -0.18;
        anvil.add(body);
      }
      this.scene.add(anvil);
      const bar = box(0.45, 0.04, 0.08, 0x552200, { emissive: 0xff5500, emissiveIntensity: 1.5 });
      bar.position.y = 0.02;
      this.scene.add(bar);
      this.work = bar;
      for (let k = 0; k < hits; k++) this.targets.push(new THREE.Vector3(-0.17 + (k / Math.max(1, hits - 1)) * 0.34, 0.042, (Math.random() - 0.5) * 0.03));
      this.look([0.15, 0.85, 0.7], [0, 0.0, 0]);
    } else {
      // nail: a plank laid across a beam, nails standing ready
      const beam = box(0.16, 0.16, 0.9, 0x6e4e30);
      beam.position.y = -0.1;
      this.scene.add(beam);
      const plank = box(0.9, 0.04, 0.22, 0x8a6440);
      plank.position.y = 0.0;
      this.scene.add(plank);
      this.work = plank;
      for (let k = 0; k < hits; k++) {
        const p = new THREE.Vector3(-0.06 + (k % 2) * 0.12, 0.08, -0.06 + (k % 3) * 0.06);
        this.targets.push(p);
        const nail = cyl(0.006, 0.006, 0.08, 0x9a9a9a, 6, { metalness: 0.7 });
        nail.position.set(p.x, 0.06, p.z);
        const headDisk = cyl(0.014, 0.014, 0.006, 0x9a9a9a, 8, { metalness: 0.7 });
        headDisk.position.y = 0.04;
        nail.add(headDisk);
        this.scene.add(nail);
        this.nails.push(nail);
      }
      this.look([0.1, 0.7, 0.5], [0, 0.03, 0]);
    }
    this.ring = ringMesh(0.05, 0xffffff, 0.005);
    this.mark = ringMesh(0.05, 0xffd54a, 0.007);
    if (this.face === 'top') { this.ring.rotation.x = Math.PI / 2; this.mark.rotation.x = Math.PI / 2; }
    this.scene.add(this.ring, this.mark, this.tool);
    this.tool.position.set(0.2, 0.5, 0.25);
    this.placeTarget();
  }

  private placeTarget() {
    const t = this.targets[this.hit];
    if (!t) return;
    this.mark.position.copy(t);
    this.ring.position.copy(t);
    this.ringT = 0;
  }

  private ringScale() {
    // Ring closes from 3.2x to 0.4x the mark over one period.
    return 3.2 - (this.ringT / this.period) * 2.8;
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    const t = this.targets[this.hit];
    if (!t) return null;
    const p = this.toScreen(t);
    const close = Math.abs(this.ringScale() - 1) < 0.35;
    return close
      ? { x: p.x + 50, y: p.y - 20, text: 'NOW: click!', gesture: 'click' }
      : { x: p.x + 50, y: p.y - 20, text: 'aim at the yellow mark, wait for the ring', gesture: 'hold' };
  }

  update(dt: number, i: MgInput) {
    if (this.variant === 'forge') {
      this.heat = Math.max(0, this.heat - dt / (8 + this.ease * 6 + this.gear.heat * 5));
      ((this.work as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + this.heat * 1.6;
    }
    this.ringT += dt;
    const s = this.ringScale();
    this.ring.scale.setScalar(Math.max(0.05, s));
    const t = this.targets[this.hit];
    if (!t) return;

    // Tool hovers over where you aim, and swings down on a strike.
    const aim = this.onPlaneY(i.ndc, t.y) ?? t.clone();
    if (this.swing > 0) {
      this.swing -= dt * 5;
      const k = Math.sin(Math.max(0, this.swing) * Math.PI);
      this.tool.position.lerpVectors(this.swingTo.clone().add(new THREE.Vector3(0.05, 0.02, 0)), this.swingTo.clone().add(new THREE.Vector3(0.12, 0.35, 0.1)), 1 - k);
      this.tool.rotation.z = -0.4 * k;
    } else {
      this.tool.position.lerp(aim.clone().add(new THREE.Vector3(0.12, 0.35, 0.1)), Math.min(1, dt * 12));
      this.tool.rotation.z = 0.5;
    }

    if (i.pressed) {
      const slack = 0.35 + 0.5 * this.ease + (this.variant === 'forge' ? 0.3 * this.gear.anvil : 0);
      const timing = clamp01(1 - Math.abs(s - 1) / slack);
      const off = Math.hypot(aim.x - t.x, aim.z - t.z);
      const aimQ = clamp01(1 - off / (0.03 + 0.05 * this.ease));
      let q = timing * 0.6 + aimQ * 0.4;
      if (this.variant === 'forge' && this.heat < 0.3) { q *= 0.5; this.say('The metal is too cold!', false); }
      this.swing = 1;
      this.swingTo.copy(aim);
      this.strikeEffect(t, q);
      if (aimQ < 0.15) {
        this.say('Missed the mark!', false);
        this.sample(0.1);
        this.ringT = 0;
        this.miss();
        return;
      }
      this.sample(q);
      this.say(q > 0.85 ? 'Perfect!' : q > 0.55 ? 'Good' : 'Rough', q > 0.55);
      if (this.variant === 'nail' && this.nails[this.hit]) this.nails[this.hit].position.y = 0.02;
      this.hit++;
      this.progress = this.hit / this.hits;
      if (this.hit >= this.hits) { this.done = true; this.finishEffect(); return; }
      this.placeTarget();
    } else if (s < 0.4) {
      this.sample(0.15);
      this.say('Too slow!', false);
      this.ringT = 0;
      this.miss();
    }
  }

  /** Too many misses and the work is spoiled; it ends with whatever you managed. */
  private miss() {
    this.misses++;
    if (this.misses > this.hits * 2 + 2) {
      this.say('You make a mess of it.', false, 1.2);
      this.done = true;
    }
  }

  private strikeEffect(at: THREE.Vector3, q: number) {
    const colour = this.variant === 'forge' ? 0xffa040 : this.variant === 'knap' ? 0x9e9a92 : this.variant === 'nail' ? 0xcfcfcf : 0xd9b88a;
    this.burst(at.clone().add(new THREE.Vector3(0, 0.01, 0)), colour, 6 + Math.round(q * 8), 0.8, this.variant === 'forge');
    if (this.variant === 'knap') this.work.scale.multiplyScalar(0.97);
  }

  private finishEffect() {
    if (this.variant === 'split') {
      // The log falls apart in two halves.
      this.work.visible = false;
      for (const s of [-1, 1]) {
        const half = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.45, 12, 1, false, s > 0 ? 0 : Math.PI, Math.PI),
          new THREE.MeshStandardMaterial({ color: 0xc89a62, side: THREE.DoubleSide }));
        half.position.set(s * 0.06, 0.225, 0);
        half.rotation.z = s * 0.35;
        this.scene.add(half);
      }
    }
    this.say('Done!', true);
  }

  meters(): Meter[] {
    return this.variant === 'forge' ? [{ label: 'Metal heat', value: this.heat, band: [0.3, 1], color: '#f2a54e' }] : [];
  }
}
