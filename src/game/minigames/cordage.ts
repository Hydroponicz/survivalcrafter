import * as THREE from 'three';
import { benchMesh, clamp01, Minigame, type Meter, type MgInput } from './core';

// Two-ply cordage by reverse wrapping, the way it's really done by hand:
// twist the upper strand tight, lay it over the lower one (the strands swap
// places and lock together into one wrap), and repeat. Every so often a
// strand runs thin and you splice in a fresh tuft of fibre.

const STRAND_COLORS = [0xd8c88a, 0x93a85a]; // straw and green, so you can see them swap
const AXIS_Y = 0.12;
const CORD_START = -0.55;
const LEAD = 0.12; // the knotted starting section
const PITCH = 0.05; // finished cord per wrap
const SPREAD = 0.075; // how far apart the loose strands hang
const THICK = 0.012;
const THIN = 0.0055;

type Phase = 'twist' | 'cross' | 'splice';

export class CordageGame extends Minigame {
  readonly title = 'Making cordage';
  private phase: Phase = 'twist';
  private wraps = 0;
  /** Which strand (0 or 1) is currently on top. */
  private top = 0;
  /** Twist put into the top strand, 0..1.25 (green band is the sweet spot). */
  private twist = 0;
  private kinked = false;
  /** 0..1 progress of laying the top strand over the other. */
  private cross = 0;
  private thick = [THICK, THICK];
  private readonly band: [number, number];
  private readonly spliceAt: Set<number>;
  private finished = new THREE.Group();
  private loose: THREE.Mesh[] = [];
  private bundle = new THREE.Group();
  private bundleCentre = new THREE.Vector3(0.18, 0.02, 0.2);
  private flash = 0;

  constructor(ease: number, private plies: number) {
    super(ease);
    this.band = [0.58 - 0.08 * ease, 0.82 + 0.08 * ease];
    // A strand runs out after every couple of wraps.
    this.spliceAt = new Set([2, 4, 6, 8].filter((n) => n < plies));
    this.scene.add(benchMesh(1.6, 0.8));
    // A stone pins the start of the cord to the bench.
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: 0x7f7b74, flatShading: true }));
    stone.scale.set(1.2, 0.8, 1);
    stone.position.set(CORD_START, 0.06, 0);
    this.scene.add(stone, this.finished);
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
      this.loose.push(m);
      this.scene.add(m);
    }
    // The bundle of fibre you splice from.
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.18, 3), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xb8b46a : 0xa0a85a, flatShading: true }));
      blade.rotation.z = Math.PI / 2 + Math.sin(a) * 0.12;
      blade.rotation.y = Math.cos(a) * 0.15;
      blade.position.set(Math.cos(a) * 0.01, 0.012 + Math.sin(a) * 0.008, Math.sin(a) * 0.02);
      this.bundle.add(blade);
    }
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 5, 12), new THREE.MeshStandardMaterial({ color: 0x8a6a3a }));
    tie.rotation.y = Math.PI / 2;
    tie.position.y = 0.012;
    this.bundle.add(tie);
    this.bundle.position.copy(this.bundleCentre);
    this.scene.add(this.bundle);
    this.look([-0.02, 0.46, 0.8], [-0.05, 0.17, 0]);
    this.showPointer = false;
    this.buildFinished();
    this.buildLoose();
  }

  get instructions(): string {
    const steps = [
      ['twist', 'Twist the upper strand: hold the left button and drag right until the gauge is in the green. Drag left to ease off if it kinks.'],
      ['cross', 'Lay it over: hold the left button and drag down to cross the twisted strand over the other one.'],
      ['splice', 'This strand is running thin: click the fibre bundle to splice in a fresh tuft.'],
    ] as const;
    return steps.map(([p, text]) => `<div class="mg-step${p === this.phase ? ' on' : ''}">${text}</div>`).join('');
  }

  /** Where the cord is being worked: the end of the finished section. */
  private workX() {
    return CORD_START + LEAD + this.wraps * PITCH + this.cross * PITCH;
  }

  /** The finished two-ply cord: two strands wound around each other. */
  private buildFinished() {
    for (const c of [...this.finished.children]) {
      this.finished.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const end = CORD_START + LEAD + this.wraps * PITCH;
    const turns = (end - CORD_START) / (PITCH * 2);
    for (let k = 0; k < 2; k++) {
      const pts: THREE.Vector3[] = [];
      const n = Math.max(8, Math.round(turns * 24));
      for (let i = 0; i <= n; i++) {
        const x = CORD_START + ((end - CORD_START) * i) / n;
        const a = ((x - CORD_START) / (PITCH * 2)) * Math.PI * 2 + k * Math.PI;
        pts.push(new THREE.Vector3(x, AXIS_Y + Math.cos(a) * 0.009, Math.sin(a) * 0.009));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, 0.0085, 7, false),
        new THREE.MeshStandardMaterial({ color: STRAND_COLORS[k], roughness: 0.95 }));
      this.finished.add(tube);
    }
  }

  /** The two loose strands, from the working point out to where your fingers hold them. */
  private buildLoose() {
    const x = this.workX();
    const c = this.cross;
    for (let k = 0; k < 2; k++) {
      const isTop = k === this.top;
      // While crossing, the top strand swings down in front of the other, which rises behind it.
      const sY = isTop ? 1 - 2 * c : -1 + 2 * c;
      const sZ = (isTop ? 0.05 : -0.03) * Math.sin(Math.PI * c);
      const endPt = new THREE.Vector3(x + 0.32, AXIS_Y + SPREAD * sY, sZ);
      const mid = new THREE.Vector3(x + 0.12, AXIS_Y + SPREAD * 0.45 * sY, sZ * 0.8);
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, AXIS_Y, 0), mid, endPt]);
      const radius = this.thick[k] * (isTop && this.kinked ? 1.15 : 1);
      const m = this.loose[k];
      m.geometry.dispose();
      m.geometry = new THREE.TubeGeometry(curve, 40, radius, 8, false);
      this.paintTwist(m.geometry, k, isTop && this.phase !== 'splice' ? this.twist : 0.12);
    }
  }

  /** Spiral fibre lines whose pitch tightens as the strand is twisted. */
  private paintTwist(geo: THREE.BufferGeometry, k: number, twist: number) {
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const n = uv.count;
    const col = new Float32Array(n * 3);
    const base = new THREE.Color(STRAND_COLORS[k]);
    const kink = new THREE.Color(0x9a4a2a);
    const turns = 1 + twist * 9;
    const thin = this.thick[k] < THICK * 0.7;
    for (let i = 0; i < n; i++) {
      const along = uv.getX(i), around = uv.getY(i);
      const stripe = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * (around * 2 - along * turns)), 3);
      const c = base.clone().multiplyScalar(1 - stripe * 0.65);
      if (k === this.top && this.kinked) c.lerp(kink, 0.35);
      if (thin && this.phase === 'splice') c.lerp(new THREE.Color(0xffe080), 0.4 + 0.4 * Math.sin(this.flash * 8));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  update(dt: number, i: MgInput) {
    this.flash += dt;
    const [lo, hi] = this.band;
    if (this.phase === 'twist') {
      if (i.down && i.dx !== 0) {
        this.twist = Math.max(0, Math.min(1.25, this.twist + i.dx * 0.0016 * (0.85 + 0.3 * this.ease)));
        if (this.twist > 1.12 && !this.kinked) {
          this.kinked = true;
          this.say('Too tight — it’s kinking! Drag left to ease it.', false, 1.2);
        }
        if (this.kinked && this.twist < hi) this.kinked = false;
      }
      if (i.released && this.twist > 0.05) {
        if (this.twist < lo) {
          this.say('Not enough twist yet — keep going.', false);
        } else {
          // In the band is perfect; over-twisted still holds, but kinks weaken it.
          const q = this.twist <= hi ? 1 : clamp01(1 - (this.twist - hi) * 2.5) * (this.kinked ? 0.6 : 1);
          this.sample(q);
          this.say(q > 0.9 ? 'Nice and tight' : this.kinked ? 'Kinked — that’ll be a weak spot' : 'A bit overtwisted', q > 0.7);
          this.phase = 'cross';
          this.cross = 0;
        }
      }
    } else if (this.phase === 'cross') {
      if (i.down && i.dy > 0) this.cross = Math.min(1, this.cross + i.dy * 0.006);
      if (i.down && i.dy < 0) this.cross = Math.max(0, this.cross + i.dy * 0.006);
      if (this.cross >= 1) {
        this.wraps++;
        this.top = 1 - this.top;
        this.twist = 0;
        this.kinked = false;
        this.cross = 0;
        this.buildFinished();
        this.burst(new THREE.Vector3(this.workX(), AXIS_Y, 0.02), STRAND_COLORS[this.top], 3, 0.25);
        if (this.wraps >= this.plies) {
          this.done = true;
          this.say('A good length of cord!', true);
        } else if (this.spliceAt.has(this.wraps)) {
          this.thick[this.top] = THIN;
          this.phase = 'splice';
          this.say('Running thin — splice in more fibre', false, 1.2);
        } else {
          this.phase = 'twist';
        }
      }
    } else {
      // Splice: click the bundle.
      if (i.pressed) {
        const p = this.toScreen(this.bundleCentre);
        if (Math.hypot(i.x - p.x, i.y - p.y) < 80) {
          this.thick[this.top] = THICK;
          this.sample(1, 0.5);
          this.burst(new THREE.Vector3(this.workX() + 0.1, AXIS_Y + SPREAD * 0.5, 0), 0xb8b46a, 6, 0.35);
          this.say('Spliced in', true);
          this.phase = 'twist';
        } else {
          this.say('Click the fibre bundle on the bench.', false);
        }
      } else if (i.down && Math.abs(i.dx) > 2) {
        this.say('Splice in fresh fibre first.', false, 0.8);
      }
    }
    this.bundle.rotation.z = this.phase === 'splice' ? Math.sin(this.flash * 6) * 0.06 : 0;
    this.progress = (this.wraps + this.cross * 0.9) / this.plies;
    // The pointer only matters when you have to click the bundle.
    this.showPointer = this.phase === 'splice';
    this.buildLoose();
  }

  /** A floating arrow by the strand's end saying what to do. */
  hint(): { x: number; y: number; text: string } | null {
    const x = this.workX() + 0.34;
    if (this.phase === 'twist') {
      const p = this.toScreen(new THREE.Vector3(x, AXIS_Y + SPREAD, 0));
      return { x: p.x + 20, y: p.y - 10, text: 'drag ➡ to twist' };
    }
    if (this.phase === 'cross') {
      const p = this.toScreen(new THREE.Vector3(x, AXIS_Y + SPREAD * (1 - 2 * this.cross), 0.03));
      return { x: p.x + 20, y: p.y, text: 'drag ⬇ to lay over' };
    }
    const p = this.toScreen(this.bundleCentre);
    return { x: p.x - 30, y: p.y + 30, text: 'click to splice' };
  }

  meters(): Meter[] {
    if (this.phase !== 'twist') return [{ label: 'Wraps', value: this.wraps / this.plies, color: '#d8c88a' }];
    return [{ label: 'Twist', value: this.twist / 1.25, band: [this.band[0] / 1.25, this.band[1] / 1.25], color: this.kinked ? '#ef7d6a' : '#e8b562' }];
  }
}
