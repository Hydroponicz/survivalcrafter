import * as THREE from 'three';
import { benchMesh, box, clamp01, cyl, fireMesh, logMesh, Minigame, ringMesh, type Meter, type MgInput } from './core';

/**
 * Carve along a line: hold the left button and draw the knife from left to
 * right along the marked path on the branch.
 */
export class CarveGame extends Minigame {
  readonly title = 'Carving';
  readonly instructions = 'Hold left button and draw the knife along the line, left to right. Stay on the line.';
  private path: THREE.Vector3[] = [];
  private pass = 0;
  private reached = 0;
  private knife = new THREE.Group();
  private line: THREE.Line;
  private branch: THREE.Group;
  private readonly topY = 0.06;

  constructor(ease: number, private passes: number, wide = false) {
    super(ease);
    this.scene.add(benchMesh());
    this.branch = wide ? (() => { const g = new THREE.Group(); const p = box(1.0, 0.04, 0.24, 0x9a7650); p.position.y = 0.02; g.add(p); return g; })() : logMesh(1.1, 0.045, 0x8a6a46);
    if (!wide) this.branch.position.y = 0.045;
    this.scene.add(this.branch);
    const blade = box(0.11, 0.004, 0.02, 0xc8ccd2, { metalness: 0.7, roughness: 0.3 });
    blade.position.x = -0.05;
    const handle = box(0.09, 0.02, 0.025, 0x5a3c22);
    handle.position.x = 0.05;
    this.knife.add(blade, handle);
    this.knife.rotation.y = 0.5;
    this.scene.add(this.knife);
    this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd54a, dashSize: 0.02, gapSize: 0.012, depthTest: false }));
    this.line.renderOrder = 10;
    this.scene.add(this.line);
    this.makePath();
    this.look([0, 0.85, 0.65], [0, 0.03, 0]);
  }

  private makePath() {
    const amp = 0.012 + Math.random() * 0.012;
    const ph = Math.random() * 6;
    this.path = [];
    for (let k = 0; k <= 40; k++) {
      const x = -0.45 + (k / 40) * 0.9;
      this.path.push(new THREE.Vector3(x, this.topY + 0.002, Math.sin(x * 9 + ph) * amp));
    }
    this.line.geometry.setFromPoints(this.path);
    this.line.computeLineDistances();
    this.reached = 0;
  }

  /** z of the path at x. */
  private pathZ(x: number) {
    const k = Math.max(0, Math.min(39.999, ((x + 0.45) / 0.9) * 40));
    const a = this.path[Math.floor(k)], b = this.path[Math.floor(k) + 1];
    return a.z + (b.z - a.z) * (k - Math.floor(k));
  }

  update(dt: number, i: MgInput) {
    const p = this.onPlaneY(i.ndc, this.topY);
    if (!p) return;
    this.knife.position.set(p.x, this.topY + 0.01, p.z);
    if (!i.down) return;
    const tol = 0.012 + 0.03 * this.ease;
    const off = Math.abs(p.z - this.pathZ(p.x));
    const t = (p.x + 0.45) / 0.9;
    // Only forward progress counts, only near the line, and not rushed.
    if (t > this.reached && t < this.reached + 0.12 && off < tol * 2.2) {
      const maxStep = dt * (0.32 + 0.15 * this.ease);
      if (t - this.reached > maxStep * 1.5 && Math.random() < 0.1) this.say('Slow down — steady strokes.', false, 0.6);
      const step = Math.min(t - this.reached, maxStep);
      const reachedT = this.reached + step;
      this.sample(clamp01(1 - off / tol), step);
      this.reached = reachedT;
      if (Math.random() < step * 60) this.burst(new THREE.Vector3(p.x, this.topY + 0.01, p.z), 0xe2c690, 2, 0.4);
      if (off > tol && Math.random() < 0.2) this.say('Off the line!', false, 0.5);
    } else if (t > this.reached + 0.12) {
      this.say('Draw the knife steadily from the left.', false, 0.8);
    }
    if (this.reached >= 0.98) {
      this.pass++;
      this.branch.scale.y *= 0.9;
      this.branch.scale.z *= 0.9;
      if (this.pass >= this.passes) { this.done = true; this.progress = 1; this.say('Done!', true); return; }
      this.say('Nice. Again.', true);
      this.makePath();
    }
    this.progress = (this.pass + this.reached) / this.passes;
  }
}

export type HeatVariant = 'roast' | 'bake' | 'fire' | 'brew';

const HEAT_TEXT: Record<HeatVariant, { title: string; how: string; raw: number; done: number }> = {
  roast: { title: 'Cooking', how: 'Move the mouse up/down to hold the food higher or lower over the flame. Click to take it off when it’s done — don’t burn it.', raw: 0xb5655a, done: 0x7a3f1c },
  bake: { title: 'Baking', how: 'Move the mouse up/down to raise or lower the bread. Click to take it off when golden.', raw: 0xe8d8b0, done: 0xb07832 },
  fire: { title: 'Firing pottery', how: 'Move the mouse to push the pot into or out of the coals. Click to pull it out when it’s fired through — too hot and it cracks.', raw: 0x9a8a7a, done: 0xb0583a },
  brew: { title: 'Brewing', how: 'Move the mouse up/down to set the pot over the flame. Click to take it off when it’s steeped — don’t let it boil away.', raw: 0x7a9a6a, done: 0x6a7a3a },
};

/**
 * Hold something over the fire at the right height and take it off at the
 * right moment: underdone or burnt both cost quality.
 */
export class HeatGame extends Minigame {
  readonly title: string;
  readonly instructions: string;
  showPointer = false;
  private height = 0.55;
  private doneness = 0;
  private char = 0;
  private item: THREE.Mesh;
  private spit = new THREE.Group();
  private fire = fireMesh();
  private raw: THREE.Color;
  private cooked: THREE.Color;

  constructor(ease: number, variant: HeatVariant) {
    super(ease);
    const t = HEAT_TEXT[variant];
    this.title = t.title;
    this.instructions = t.how;
    this.raw = new THREE.Color(t.raw);
    this.cooked = new THREE.Color(t.done);
    const ground = box(2.2, 0.05, 1.6, 0x4a6b2c);
    ground.position.y = -0.025;
    this.scene.add(ground, this.fire.group);
    for (const x of [-0.3, 0.3]) {
      const post = cyl(0.015, 0.015, 0.75, 0x5a3c22, 6);
      post.position.set(x, 0.37, 0);
      this.scene.add(post);
    }
    const geo = variant === 'bake' ? new THREE.SphereGeometry(0.08, 12, 8).scale(1.4, 0.7, 1)
      : variant === 'fire' ? new THREE.CylinderGeometry(0.06, 0.08, 0.16, 12)
        : variant === 'brew' ? new THREE.CylinderGeometry(0.08, 0.07, 0.12, 12)
          : new THREE.DodecahedronGeometry(0.07, 1);
    this.item = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: this.raw, flatShading: variant === 'roast' }));
    const rod = cyl(0.008, 0.008, 0.7, 0x6b4a2c, 6);
    rod.rotation.z = Math.PI / 2;
    this.spit.add(rod, this.item);
    this.scene.add(this.spit);
    this.look([0, 1.0, 1.65], [0, 0.32, 0]);
  }

  private heat() {
    // Hotter the lower you hold it; very low is fierce.
    return Math.max(0, 1.6 - this.height * 2.2);
  }

  update(dt: number, i: MgInput) {
    this.height = Math.max(0.2, Math.min(0.75, this.height - i.dy * 0.0016));
    const h = this.heat();
    this.doneness += dt * h * (0.13 + 0.05 * this.ease);
    if (h > 1.05) this.char += dt * (h - 1.05) * (0.9 - 0.5 * this.ease);
    if (this.doneness > 1.15) this.char += dt * 0.25;
    this.spit.position.y = this.height;
    this.spit.rotation.x += dt * 1.5;
    const m = this.item.material as THREE.MeshStandardMaterial;
    m.color.copy(this.raw).lerp(this.cooked, clamp01(this.doneness)).lerp(new THREE.Color(0x1a1410), clamp01(this.char));
    if (h > 1.1 && Math.random() < dt * 14) this.burst(new THREE.Vector3(0, this.height, 0), 0x333333, 1, 0.3);
    this.fire.flicker(this.time);
    this.progress = clamp01(this.doneness);
    if (h > 1.1 && Math.random() < dt * 1.5) this.say('Too close — it’s scorching!', false, 0.7);
    if (i.pressed) {
      if (this.doneness < 0.6) { this.say('It’s nowhere near done yet.', false); return; }
      this.finish();
    } else if (this.doneness + this.char >= 2) {
      this.say('Ruined!', false);
      this.finish();
    }
  }

  private finish() {
    const band = 0.12 + 0.12 * this.ease;
    const timing = clamp01(1 - Math.max(0, Math.abs(this.doneness - 1) - band) * 2.5);
    this.sample(clamp01(timing - this.char * 0.8));
    this.say(timing > 0.85 && this.char < 0.15 ? 'Perfect!' : this.doneness < 1 ? 'A little underdone.' : 'A bit overdone.', timing > 0.7);
    this.done = true;
  }

  meters(): Meter[] {
    const band = 0.12 + 0.12 * this.ease;
    return [
      { label: 'Done', value: clamp01(this.doneness / 1.4), band: [(1 - band) / 1.4, (1 + band) / 1.4], color: '#9fdc7c' },
      { label: 'Scorch', value: clamp01(this.char), color: '#ef7d6a' },
    ];
  }
}

export type PlaceVariant = 'stone' | 'log' | 'stick';

/**
 * Set a stone, log or stick into place: move it over the marked slot and
 * click to set it. Accuracy is quality.
 */
export class PlaceGame extends Minigame {
  readonly title: string;
  readonly instructions: string;
  private slots: THREE.Vector3[] = [];
  private k = 0;
  private held: THREE.Mesh;
  private ghost: THREE.Mesh;
  private dropping: { mesh: THREE.Mesh; to: THREE.Vector3; t: number } | null = null;
  private sway = Math.random() * 6;

  constructor(ease: number, private variant: PlaceVariant, count: number) {
    super(ease);
    this.title = variant === 'stone' ? 'Laying stone' : variant === 'log' ? 'Stacking logs' : 'Setting materials';
    this.instructions = 'Move the piece over the glowing slot and click to set it. The closer, the better the work.';
    const ground = box(2.4, 0.05, 1.6, 0x5d7a3a);
    ground.position.y = -0.025;
    this.scene.add(ground);
    const makePiece = () => variant === 'log'
      ? (() => { const g = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x6b4a30 })); g.rotation.z = Math.PI / 2; return g; })()
      : variant === 'stone'
        ? new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.14), new THREE.MeshStandardMaterial({ color: 0x8a8782, flatShading: true }))
        : new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x8a6440 }));
    // Some already-laid pieces below, for context.
    for (let r = 0; r < 2; r++) {
      for (let c = -1; c <= 1; c++) {
        if (variant === 'stick') continue;
        const m = makePiece();
        m.position.set(variant === 'log' ? 0 : c * 0.24 + (r % 2) * 0.12, 0.06 + r * 0.13, variant === 'log' ? c * 0.001 : 0);
        if (variant === 'log' && c !== 0) continue;
        this.scene.add(m);
      }
    }
    for (let n = 0; n < count; n++) {
      if (variant === 'log') this.slots.push(new THREE.Vector3(0, 0.32 + n * 0.14, 0));
      else if (variant === 'stone') this.slots.push(new THREE.Vector3(-0.24 + ((n * 0.24 + Math.random() * 0.3) % 0.6), 0.32, 0));
      else this.slots.push(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.03, (Math.random() - 0.5) * 0.3));
    }
    this.held = makePiece();
    this.ghost = makePiece();
    const gm = this.ghost.material as THREE.MeshStandardMaterial;
    gm.transparent = true; gm.opacity = 0.35; gm.emissive = new THREE.Color(0xffd54a); gm.emissiveIntensity = 0.6; gm.depthWrite = false;
    if (variant === 'stick') { this.held.rotation.z = Math.PI / 2; this.ghost.rotation.z = Math.PI / 2; }
    this.scene.add(this.held, this.ghost);
    this.ghost.position.copy(this.slots[0]);
    this.look([0, 0.9, 1.1], [0, 0.2, 0]);
  }

  update(dt: number, i: MgInput) {
    if (this.dropping) {
      const d = this.dropping;
      d.t += dt * 5;
      d.mesh.position.lerp(d.to, Math.min(1, d.t));
      if (d.t >= 1) this.dropping = null;
    }
    const slot = this.slots[this.k];
    if (!slot) return;
    const p = this.variant === 'stick' ? this.onPlaneY(i.ndc, slot.y) : this.onPlaneZ(i.ndc, slot.z);
    if (!p) return;
    // The piece is heavy and swings a little in your hands: time the set.
    this.sway += dt * (2.2 - this.ease);
    const swing = Math.sin(this.sway) * (0.07 - 0.04 * this.ease);
    this.held.position.set(p.x + swing, this.variant === 'stick' ? slot.y + 0.05 : p.y, this.variant === 'stick' ? p.z : slot.z + 0.02);
    if (!i.pressed) return;
    const off = this.variant === 'stick'
      ? Math.hypot(this.held.position.x - slot.x, this.held.position.z - slot.z)
      : Math.hypot(this.held.position.x - slot.x, this.held.position.y - slot.y);
    const q = clamp01(1 - off / (0.05 + 0.1 * this.ease));
    if (q <= 0) { this.say('Not there — line it up with the slot.', false); return; }
    this.sample(q);
    this.say(q > 0.85 ? 'Snug!' : q > 0.5 ? 'Good' : 'A bit crooked', q > 0.5);
    const placed = this.held.clone();
    placed.material = (this.held.material as THREE.Material).clone();
    this.scene.add(placed);
    this.dropping = { mesh: placed, to: slot.clone().add(new THREE.Vector3((this.held.position.x - slot.x) * 0.5, 0, 0)), t: 0 };
    this.burst(slot.clone(), this.variant === 'stone' ? 0xb8b0a0 : 0x9a7650, 5, 0.5);
    this.k++;
    this.progress = this.k / this.slots.length;
    if (this.k >= this.slots.length) { this.done = true; this.held.visible = false; this.ghost.visible = false; return; }
    this.ghost.position.copy(this.slots[this.k]);
  }
}

/**
 * Throw a pot: the clay wobbles on the spinning wheel; move the mouse to keep
 * it centred while holding the left button to draw it up into shape.
 */
export class CenterGame extends Minigame {
  readonly title = 'Pottery wheel';
  readonly instructions = 'Hold left button to shape the clay. Move the mouse against the wobble to keep it centred on the wheel.';
  showPointer = false;
  private off = new THREE.Vector2();
  private vel = new THREE.Vector2();
  private clay: THREE.Mesh;
  private wheel: THREE.Mesh;
  private grown = 0;
  private target: THREE.Mesh;

  constructor(ease: number) {
    super(ease);
    this.scene.add(benchMesh(1.4, 1.0));
    this.wheel = cyl(0.3, 0.3, 0.05, 0x5a4a3a, 24);
    this.wheel.position.y = 0.025;
    this.scene.add(this.wheel);
    this.clay = new THREE.Mesh(this.profile(0), new THREE.MeshStandardMaterial({ color: 0x9a7a62, roughness: 1 }));
    this.clay.position.y = 0.05;
    this.scene.add(this.clay);
    this.target = ringMesh(0.03, 0x9fdc7c, 0.004);
    this.target.rotation.x = Math.PI / 2;
    this.target.position.y = 0.052;
    this.scene.add(this.target);
    this.look([0, 0.8, 0.75], [0, 0.08, 0]);
  }

  /** Lathe profile from a squat lump (0) to a jar (1). */
  private profile(t: number) {
    const pts: THREE.Vector2[] = [];
    const h = 0.08 + t * 0.2;
    for (let k = 0; k <= 12; k++) {
      const y = (k / 12) * h;
      const u = k / 12;
      const lump = 0.12 * Math.sqrt(Math.max(0, 1 - u * u));
      const jar = 0.07 + 0.05 * Math.sin(u * Math.PI) - (u > 0.85 ? (u - 0.85) * 0.25 : 0);
      pts.push(new THREE.Vector2(Math.max(0.005, lump * (1 - t) + jar * t), y));
    }
    return new THREE.LatheGeometry(pts, 24);
  }

  update(dt: number, i: MgInput) {
    // The clay wanders off centre; the wobble gets worse the taller it gets.
    const push = (0.2 + this.grown * 0.4) * (1.1 - this.ease * 0.6);
    this.vel.x += (Math.random() - 0.5) * push * dt * 2;
    this.vel.y += (Math.random() - 0.5) * push * dt * 2;
    this.vel.multiplyScalar(0.985);
    this.off.addScaledVector(this.vel, dt);
    this.off.x += i.dx * 0.00012;
    this.off.y += i.dy * 0.00012;
    this.off.clampLength(0, 0.12);
    const tol = 0.012 + 0.025 * this.ease;
    const centred = clamp01(1 - this.off.length() / tol);
    this.wheel.rotation.y += dt * 9;
    this.clay.rotation.y += dt * 9;
    this.clay.position.set(this.off.x, 0.05, this.off.y);
    if (i.down) {
      if (centred > 0) {
        this.grown = Math.min(1, this.grown + dt * 0.14 * (0.5 + centred));
        this.sample(centred, dt);
      } else {
        this.sample(0, dt);
        if (Math.random() < dt * 2) this.say('It’s wobbling — recentre it!', false, 0.6);
        // Shaping off-centre slumps the clay.
        this.grown = Math.max(0, this.grown - dt * 0.05);
      }
      this.clay.geometry.dispose();
      this.clay.geometry = this.profile(this.grown);
    }
    this.progress = this.grown;
    if (this.grown >= 1) { this.done = true; this.say('A fine jar!', true); }
  }

  meters(): Meter[] {
    const tol = 0.012 + 0.025 * this.ease;
    return [{ label: 'Off centre', value: clamp01(this.off.length() / (tol * 3)), band: [0, 1 / 3], color: '#ef7d6a' }];
  }
}
