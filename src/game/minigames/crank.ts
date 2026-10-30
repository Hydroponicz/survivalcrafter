import * as THREE from 'three';
import { benchMesh, clamp01, cyl, Minigame, ringMesh, type Meter, type MgInput } from './core';

export type CrankVariant = 'grind' | 'stir' | 'pound';

const TEXT: Record<CrankVariant, { title: string; how: string }> = {
  grind: { title: 'Grinding', how: 'Hold left button and circle the mouse around the quern to turn the handle. Steady speed: too fast spills the grain.' },
  stir: { title: 'Mixing', how: 'Hold left button and stir in circles around the bowl. Keep a steady pace so nothing slops out.' },
  pound: { title: 'Pounding', how: 'Hold left button and grind in circles with the pestle. Keep it steady.' },
};

/**
 * Turn something round and round: a quern handle, a spoon, a pestle, fibres.
 * The speed has to stay in a band; progress comes from the distance turned.
 */
export class CrankGame extends Minigame {
  readonly title: string;
  readonly instructions: string;
  private angle = 0;
  private lastAngle: number | null = null;
  private turned = 0;
  private speed = 0;
  private spin = new THREE.Group();
  private product: THREE.Mesh | null = null;
  private centre = new THREE.Vector3(0, 0.12, 0);
  private band: [number, number];
  private lastDir = 0;

  constructor(ease: number, private variant: CrankVariant, private turns: number) {
    super(ease);
    this.title = TEXT[variant].title;
    this.instructions = TEXT[variant].how;
    this.band = [2.2, 6.5 + 4 * ease];
    this.scene.add(benchMesh());
    const guide = ringMesh(0.22, 0xffffff, 0.003);
    guide.rotation.x = Math.PI / 2;
    (guide.material as THREE.MeshBasicMaterial).opacity = 0.35;
    if (variant === 'grind') {
      const base = cyl(0.26, 0.28, 0.1, 0x8a8782, 20);
      base.position.y = 0.05;
      this.scene.add(base);
      const upper = cyl(0.24, 0.24, 0.08, 0x9a9792, 20);
      upper.position.y = 0.14;
      const handle = cyl(0.015, 0.015, 0.14, 0x7a5634, 6);
      handle.position.set(0.18, 0.24, 0);
      this.spin.add(upper, handle);
      this.product = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0xf1e6cc }));
      this.product.position.set(0.38, 0.0, 0.0);
      this.centre.set(0, 0.2, 0);
      guide.position.y = 0.24;
    } else {
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: variant === 'pound' ? 0x8a8782 : 0xa0754a, side: THREE.DoubleSide }));
      bowl.position.y = 0.2;
      this.scene.add(bowl);
      this.product = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.04, 18),
        new THREE.MeshStandardMaterial({ color: variant === 'pound' ? 0x6f9a4a : 0xd9c49a }));
      this.product.position.y = 0.09;
      this.scene.add(this.product);
      const tool = variant === 'pound' ? cyl(0.025, 0.035, 0.3, 0x9a9792, 8) : cyl(0.012, 0.012, 0.36, 0x9a7650, 6);
      tool.position.set(0.1, 0.24, 0);
      tool.rotation.z = -0.35;
      this.spin.add(tool);
      this.centre.set(0, 0.2, 0);
      guide.position.y = 0.2;
      guide.scale.setScalar(0.6);
    }
    if (this.product && variant === 'grind') this.scene.add(this.product);
    this.scene.add(this.spin, guide);
    this.look([0, 0.95, 0.9], [0, 0.12, 0]);
  }

  update(dt: number, i: MgInput) {
    const c = this.toScreen(this.centre);
    const a = Math.atan2(i.y - c.y, i.x - c.x);
    let d = 0;
    if (this.lastAngle !== null) {
      d = a - this.lastAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
    }
    this.lastAngle = a;
    const dist = Math.hypot(i.x - c.x, i.y - c.y);
    // Need to actually circle, not jiggle on the spot.
    if (dist < 25) d = 0;
    const inst = Math.abs(d) / Math.max(dt, 1e-3);
    this.speed += (inst - this.speed) * Math.min(1, dt * 6);
    if (i.down && d !== 0) {
      this.angle += d;
      const [lo, hi] = this.band;
      const dir = Math.sign(d);
      const reversed = this.lastDir !== 0 && dir !== this.lastDir && Math.abs(d) > 0.02;
      if (Math.abs(d) > 0.02) this.lastDir = dir;
      if (reversed) {
        // Back-and-forth jiggling isn't turning.
        this.sample(0.1, 0.3);
        if (Math.random() < 0.3) this.say('Keep turning one way!', false, 0.6);
      } else if (this.speed > hi) {
        this.sample(0.25, Math.abs(d));
        this.turned += Math.abs(d) * 0.4;
        if (Math.random() < dt * 3) this.say('Too fast — it’s spilling!', false, 0.7);
        if (Math.random() < dt * 12) this.burst(this.centre.clone(), this.variant === 'grind' ? 0xf1e6cc : 0xd9c49a, 2, 0.8);
      } else if (this.speed >= lo) {
        this.sample(1, Math.abs(d));
        this.turned += Math.abs(d);
      } else {
        this.turned += Math.abs(d) * 0.3;
      }
    }
    const need = this.turns * Math.PI * 2;
    this.progress = clamp01(this.turned / need);
    this.spin.rotation.y = -this.angle;
    if (this.product && this.variant === 'grind') this.product.scale.setScalar(0.2 + this.progress);
    if (this.product && this.variant !== 'grind') {
      const m = this.product.material as THREE.MeshStandardMaterial;
      m.color.lerp(new THREE.Color(this.variant === 'pound' ? 0x3f6a2a : 0xe8d8b0), dt * 0.3);
    }
    if (this.progress >= 1) { this.done = true; this.say('Done!', true); }
  }

  meters(): Meter[] {
    const max = this.band[1] * 1.6;
    return [{ label: 'Speed', value: clamp01(this.speed / max), band: [this.band[0] / max, this.band[1] / max], color: '#8fc8ff' }];
  }
}
