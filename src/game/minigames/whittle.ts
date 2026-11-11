import * as THREE from 'three';
import { itemDef } from '../../data/items';
import { buildToolMesh } from '../tools';
import { benchMesh, clamp01, Minigame, workTool, type Meter, type MgInput } from './core';
import { sfx } from './sfx';
import type { Gesture } from './tutorials';

// Knife work, made to look like what you're making.
//
// On a branch (shafts, kindling, tongs) you draw the knife along it, left to
// right: each clean stroke peels the bark off the stretch it passes, curls of
// shaving spring off and pile up on the bench, and a second pass shaves it
// down pale and smooth (kindling keeps its curls standing, a feather stick).
// On a plank or a hide (a shovel, clothing) you cut round the outline of the
// thing; the cut shows behind the blade, and at the end the waste drops away
// and the piece is lifted out. Slipping off the line gouges the work.

type Mode = 'stick' | 'flat';

/** Outlines to cut (x along the bench, z toward you; metres), by what's being made. */
const OUTLINES: Record<string, [number, number][]> = {
  wooden_shovel: [[-0.44, 0], [-0.42, -0.1], [-0.33, -0.14], [-0.12, -0.13], [-0.08, -0.04], [0.4, -0.035], [0.44, 0], [0.4, 0.035], [-0.08, 0.04], [-0.12, 0.13], [-0.33, 0.14], [-0.42, 0.1]],
  hide_tunic: [[-0.2, -0.12], [-0.34, -0.02], [-0.3, 0.07], [-0.18, 0.02], [-0.18, 0.26], [0.18, 0.26], [0.18, 0.02], [0.3, 0.07], [0.34, -0.02], [0.2, -0.12], [0.06, -0.15], [0, -0.1], [-0.06, -0.15]],
  hide_trousers: [[-0.2, -0.24], [0.2, -0.24], [0.22, 0.26], [0.06, 0.26], [0, -0.02], [-0.06, 0.26], [-0.22, 0.26]],
  hide_boots: [[-0.26, -0.18], [-0.1, -0.18], [-0.1, 0.06], [0.24, 0.08], [0.28, 0.16], [0.24, 0.22], [-0.26, 0.22]],
};
/** A cap: a circle. */
for (const k of ['hide_cap']) OUTLINES[k] = Array.from({ length: 18 }, (_, i) => [Math.cos((i / 18) * Math.PI * 2) * -0.24, Math.sin((i / 18) * Math.PI * 2) * 0.2] as [number, number]);

/** Whether the knife work is cutting an outline from a plank or hide (else whittling a stick). */
export const isFlatCarve = (make: string | undefined, wide = false) => !!OUTLINES[make ?? (wide ? 'wooden_shovel' : 'shaft')];

const BARK = 0x5a3c22, PARED = 0xc79a64, SMOOTH = 0xe0bc84;

export class CarveGame extends Minigame {
  readonly title: string;
  readonly instructions: string;
  private mode: Mode;
  private product: string;
  private knife = new THREE.Group();
  private guide: THREE.Line;
  private path: THREE.Vector3[] = [];
  private lengths: number[] = [];
  private total = 1;
  private reached = 0;
  private pass = 0;
  private topY = 0.09;
  // The branch, in segments that change as you carve them.
  private segs: { mesh: THREE.Mesh; stage: number; r0: number; colour: THREE.Color }[] = [];
  private stick = new THREE.Group();
  private readonly r0 = 0.045;
  // The flat work: the stock, the cut so far, and the piece inside the outline.
  private stock: THREE.Object3D | null = null;
  private piece: THREE.Object3D | null = null;
  private cut: THREE.Line | null = null;
  // Shavings on the bench (kept, up to a point).
  private shavings: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; rest: boolean }[] = [];
  private streak = 0;
  private speedShown = 0;
  private accuracy = 1;
  private lastSound = 0;
  private reveal = -1;
  private lastP: THREE.Vector3 | null = null;

  constructor(ease: number, private passes: number, wide = false, toolType?: string, make?: string) {
    super(ease);
    this.product = make ?? (wide ? 'wooden_shovel' : 'shaft');
    this.mode = OUTLINES[this.product] ? 'flat' : 'stick';
    const name = itemDef(this.product).name;
    this.title = this.mode === 'flat' ? `Cutting: ${name}` : `Whittling: ${name}`;
    this.instructions = this.mode === 'flat'
      ? 'Hold left button and draw the knife round the outline, following the arrow. Stay on the line and keep a steady pace.'
      : 'Hold left button and draw the knife along the branch, left to right, staying on the line. Steady strokes peel it clean.';
    this.scene.add(benchMesh());
    if (this.mode === 'stick') this.makeStick();
    else this.makeFlat();
    const own = workTool(toolType, 'grip');
    if (own) this.knife.add(own);
    this.knife.rotation.y = 0.5;
    this.scene.add(this.knife);
    this.guide = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd54a, dashSize: 0.018, gapSize: 0.01, depthTest: false, transparent: true }));
    this.guide.renderOrder = 10;
    this.scene.add(this.guide);
    this.makePath();
    if (this.mode === 'stick') this.look([0, 0.72, 0.78], [0, 0.03, 0.04]);
    else this.look([0, 1.05, 0.5], [0, 0, 0.06]);
  }

  // ---------- the work
  private makeStick() {
    const n = 30, len = 0.9;
    for (let k = 0; k < n; k++) {
      // Bark varies along the branch, with a knot here and there.
      const r = this.r0 * (1 + (Math.random() - 0.5) * 0.08) * (Math.random() < 0.08 ? 1.18 : 1);
      const colour = new THREE.Color(BARK).multiplyScalar(0.85 + Math.random() * 0.3);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len / n + 0.001, 10).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: colour, roughness: 1, flatShading: true }));
      mesh.position.x = -len / 2 + (k + 0.5) * (len / n);
      mesh.castShadow = true;
      this.stick.add(mesh);
      this.segs.push({ mesh, stage: 0, r0: r, colour });
    }
    // Ends: the cut wood showing.
    for (const s of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CircleGeometry(this.r0, 12).rotateY(s * Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8b07a }));
      end.position.x = s * (len / 2 + 0.001);
      this.stick.add(end);
    }
    this.stick.position.y = this.r0;
    this.scene.add(this.stick);
  }

  private makeFlat() {
    const hide = this.product !== 'wooden_shovel';
    const colour = hide ? 0xa8805a : 0xa47a4c;
    const thick = hide ? 0.008 : 0.035;
    if (hide) {
      // An irregular hide, stretched out.
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2, r = 1 + Math.sin(a * 3 + 1) * 0.08 + (Math.random() - 0.5) * 0.08;
        pts.push(new THREE.Vector2(Math.cos(a) * 0.48 * r, Math.sin(a) * 0.36 * r));
      }
      this.stock = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: thick, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, thick, 0), new THREE.MeshStandardMaterial({ color: colour, roughness: 1, side: THREE.DoubleSide }));
    } else {
      this.stock = new THREE.Mesh(new THREE.BoxGeometry(1.0, thick, 0.34), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 }));
      this.stock.position.y = thick / 2;
    }
    this.scene.add(this.stock);
    this.topY = thick + 0.002;
    // The piece inside the outline (shown as the cut is finished).
    const outline = OUTLINES[this.product];
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const pieceColour = itemDef(this.product).wear?.colour ?? 0xb88a56;
    const piece = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false }).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: pieceColour, roughness: 0.95 }));
    // Outlined in gold when it's lifted out, so it stands clear of the bench.
    const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outline.map(([x, z]) => new THREE.Vector3(x, thick + 0.002, z))), new THREE.LineBasicMaterial({ color: 0xffd36a }));
    piece.add(rim);
    piece.visible = false;
    this.piece = piece;
    this.scene.add(piece);
    this.cut = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2a1a0e, depthTest: false }));
    this.cut.renderOrder = 9;
    this.scene.add(this.cut);
  }

  /** The line to follow this pass. */
  private makePath() {
    this.path = [];
    if (this.mode === 'stick') {
      const seg = this.segs[0];
      const r = this.pass === 0 ? seg.r0 : this.r0 * 0.88;
      this.topY = this.r0 + r + 0.002;
      const amp = 0.004 + Math.random() * 0.005, ph = Math.random() * 6;
      for (let k = 0; k <= 40; k++) {
        const x = -0.44 + (k / 40) * 0.88;
        this.path.push(new THREE.Vector3(x, this.topY, Math.sin(x * 8 + ph) * amp));
      }
    } else {
      const o = OUTLINES[this.product];
      for (const [x, z] of [...o, o[0]]) this.path.push(new THREE.Vector3(x, this.topY, z));
    }
    this.lengths = [0];
    for (let i = 1; i < this.path.length; i++) this.lengths.push(this.lengths[i - 1] + this.path[i].distanceTo(this.path[i - 1]));
    this.total = this.lengths.at(-1)!;
    this.guide.geometry.setFromPoints(this.path);
    this.guide.computeLineDistances();
    this.reached = 0;
  }

  /** The point a share of the way along the path. */
  private at(t: number): THREE.Vector3 {
    const d = clamp01(t) * this.total;
    let i = 1;
    while (i < this.lengths.length - 1 && this.lengths[i] < d) i++;
    const f = (d - this.lengths[i - 1]) / Math.max(1e-6, this.lengths[i] - this.lengths[i - 1]);
    return this.path[i - 1].clone().lerp(this.path[i], clamp01(f));
  }

  /** The nearest point of the path to p, looking just ahead of where you've got to: its share along, and how far off p is. */
  private nearest(p: THREE.Vector3): { t: number; off: number } {
    let best = { t: this.reached, off: Infinity };
    const from = Math.max(0, this.reached - 0.02) * this.total, to = Math.min(1, this.reached + 0.16) * this.total;
    for (let i = 1; i < this.path.length; i++) {
      if (this.lengths[i] < from || this.lengths[i - 1] > to) continue;
      const a = this.path[i - 1], b = this.path[i];
      const ab = new THREE.Vector2(b.x - a.x, b.z - a.z), ap = new THREE.Vector2(p.x - a.x, p.z - a.z);
      const u = clamp01(ap.dot(ab) / Math.max(1e-9, ab.lengthSq()));
      const off = Math.hypot(ap.x - ab.x * u, ap.y - ab.y * u);
      if (off < best.off) best = { t: (this.lengths[i - 1] + (this.lengths[i] - this.lengths[i - 1]) * u) / this.total, off };
    }
    return best;
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    if (this.reveal >= 0) return null;
    const p = this.toScreen(this.at(Math.min(0.98, this.reached + 0.04)));
    return { x: p.x + 30, y: p.y - 50, text: this.mode === 'flat' ? 'hold and cut round the outline' : 'hold and draw the knife along the line', gesture: this.mode === 'flat' ? undefined : 'right' };
  }

  meters(): Meter[] {
    return [
      { label: 'Stroke', value: clamp01(this.speedShown), band: [0.3, 0.8] },
      { label: 'On the line', value: this.accuracy, color: this.accuracy > 0.7 ? '#9fdc7c' : this.accuracy > 0.4 ? '#f2c14e' : '#ef7d6a' },
    ];
  }

  update(dt: number, i: MgInput) {
    this.settleShavings(dt);
    if (this.reveal >= 0) { this.animateReveal(dt); return; }
    const p = this.onPlaneY(i.ndc, this.topY);
    if (!p) return;
    // The knife follows, tipping into the stroke while you cut.
    this.knife.position.set(p.x, this.topY + 0.004, p.z);
    const dir = this.at(Math.min(1, this.reached + 0.03)).sub(this.at(this.reached));
    if (this.mode === 'flat' && dir.lengthSq() > 1e-8) this.knife.rotation.y = Math.atan2(-dir.z, dir.x) + 0.25;
    this.knife.rotation.z = i.down ? -0.25 : 0;
    this.speedShown += ((this.lastP && i.down ? this.lastP.distanceTo(p) / Math.max(dt, 1e-3) / 0.45 : 0) - this.speedShown) * Math.min(1, dt * 8);
    this.lastP = p.clone();
    if (!i.down) { this.guideGlow(false); return; }
    this.guideGlow(true);
    const tol = 0.009 + 0.022 * this.ease;
    const { t, off } = this.nearest(p);
    if (t <= this.reached) return;
    if (off > tol * 2.6) {
      this.say('Bring the knife back to the line.', false, 0.6);
      return;
    }
    // Progress is limited by a steady pace: rushing doesn't cut faster.
    const maxStep = (dt * (0.26 + 0.14 * this.ease)) / this.total * (this.mode === 'flat' ? 1.6 : 1);
    const rushed = t - this.reached > maxStep * 1.8;
    const to = Math.min(t, this.reached + maxStep);
    const clean = off <= tol;
    const q = clean ? clamp01(1 - off / tol) * (rushed ? 0.75 : 1) : 0.15;
    this.sample(q, to - this.reached);
    this.accuracy += (clamp01(1 - off / (tol * 2)) - this.accuracy) * 0.15;
    const from = this.reached;
    this.reached = to;
    const where = this.at(to);
    if (clean) {
      this.streak++;
      if (this.time - this.lastSound > 0.06) { (this.mode === 'flat' ? sfx.slice : sfx.shave)(this.speedShown); this.lastSound = this.time; }
      if (this.streak > 0 && this.streak % 40 === 0) { this.say(`Clean cut ×${this.streak / 40}`, true, 0.7); sfx.tick(this.streak / 40); }
      if (rushed && Math.random() < 0.15) this.say('Easy — steady strokes cut cleaner.', false, 0.6);
    } else {
      this.streak = 0;
      if (this.time - this.lastSound > 0.25) { sfx.slip(); this.lastSound = this.time; }
      this.say(this.mode === 'flat' ? 'Wandered off the line!' : 'Too deep — gouged it!', false, 0.6);
      this.burst(where, 0x3a2414, 4, 0.5);
    }
    if (this.mode === 'stick') this.carveStick(from, to, clean, where);
    else this.carveFlat(to, clean, where);
    if (this.reached >= 0.995) this.finishPass();
    this.progress = this.mode === 'stick' ? (this.pass + this.reached) / this.passes : this.reached;
  }

  private guideGlow(on: boolean) {
    (this.guide.material as THREE.LineDashedMaterial).opacity = on ? 1 : 0.75;
  }

  /** Peel or pare the segments the stroke passed over. */
  private carveStick(from: number, to: number, clean: boolean, where: THREE.Vector3) {
    const n = this.segs.length;
    const k0 = Math.floor(clamp01(from) * n), k1 = Math.min(n - 1, Math.floor(clamp01(to) * n));
    const kindling = this.product === 'kindling';
    for (let k = k0; k <= k1; k++) {
      const s = this.segs[k];
      if (s.stage > this.pass) continue;
      s.stage = this.pass + 1;
      const m = s.mesh.material as THREE.MeshStandardMaterial;
      if (kindling) {
        // A feather stick: the curls stay on, standing out from the wood.
        m.color.set(clean ? PARED : 0x8a6a46);
        const curl = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 4, 10, Math.PI * 1.3), new THREE.MeshStandardMaterial({ color: 0xe6c48c, side: THREE.DoubleSide }));
        curl.position.set(0, s.r0 * 0.7, (Math.random() - 0.5) * 0.02);
        curl.rotation.set(0, Math.PI / 2, Math.random() * 0.6);
        s.mesh.add(curl);
      } else {
        // Pared wood is even (no more bark bumps): one radius all along.
        const r = this.r0 * (this.pass === 0 ? 0.88 : 0.74);
        s.mesh.geometry.dispose();
        s.mesh.geometry = new THREE.CylinderGeometry(r, r, 0.9 / n + 0.002, 16).rotateZ(Math.PI / 2);
        m.flatShading = false;
        m.roughness = this.pass === 0 ? 0.85 : 0.7;
        m.color.set(this.pass === 0 ? PARED : SMOOTH);
        m.needsUpdate = true;
        if (!clean) {
          // A gouge: a dark nick in the wood.
          m.color.multiplyScalar(0.75);
          const nick = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.012), new THREE.MeshStandardMaterial({ color: 0x3a2414 }));
          nick.position.set(0, r * 0.98, 0);
          s.mesh.add(nick);
        }
      }
      if (clean) this.shaving(where, this.pass === 0 && !kindling ? BARK : 0xe8c890);
    }
  }

  /** Lengthen the cut behind the blade. */
  private carveFlat(to: number, clean: boolean, where: THREE.Vector3) {
    const pts: THREE.Vector3[] = [];
    const steps = Math.max(2, Math.ceil(to * 80));
    for (let k = 0; k <= steps; k++) pts.push(this.at((k / steps) * to).setY(this.topY + 0.001));
    this.cut!.geometry.dispose();
    this.cut!.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    if (clean && Math.random() < 0.25) this.burst(where, this.product === 'wooden_shovel' ? 0xd8b07a : 0x6a4a2e, 1, 0.25);
  }

  /** A curl of shaving flies off and lands on the bench. */
  private shaving(at: THREE.Vector3, colour: number) {
    if (Math.random() < 0.5) sfx.curl();
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.012 + Math.random() * 0.008, 0.0025, 4, 10, Math.PI * (1 + Math.random() * 0.8)), new THREE.MeshStandardMaterial({ color: colour, side: THREE.DoubleSide, roughness: 0.9 }));
    mesh.position.copy(at);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(mesh);
    this.shavings.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.3) * 0.5, 0.6 + Math.random() * 0.5, 0.3 + Math.random() * 0.4), spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, 0), rest: false });
    // A pile, not a flood.
    if (this.shavings.length > 160) { const old = this.shavings.shift()!; this.scene.remove(old.mesh); }
  }

  private settleShavings(dt: number) {
    for (const s of this.shavings) {
      if (s.rest) continue;
      s.vel.y -= 4 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      if (s.mesh.position.y <= 0.004) { s.mesh.position.y = 0.004; s.rest = true; s.mesh.rotation.x = Math.PI / 2; }
    }
  }

  private finishPass() {
    this.pass++;
    sfx.tick(this.pass + 2);
    const more = this.mode === 'stick' && this.pass < this.passes;
    if (more) {
      this.say(this.pass === 1 && this.product !== 'kindling' ? 'Bark off. Now shave it smooth.' : 'Good. Once more.', true, 1.1);
      this.makePath();
      return;
    }
    // Done: lift the work out and show it.
    this.guide.visible = false;
    if (this.cut) this.cut.visible = false;
    if (this.piece && this.stock) { this.piece.visible = true; this.piece.position.y = 0; sfx.thud(); }
    if (this.product === 'wooden_tongs') {
      const tongs = buildToolMesh('tongs', 'wooden_tongs');
      tongs.rotation.z = Math.PI / 2;
      this.stick.visible = false;
      this.piece = tongs;
      this.scene.add(tongs);
    }
    sfx.done();
    const perf = this.performance();
    this.say(`${itemDef(this.product).name}: ${perf > 0.85 ? 'fine work!' : perf > 0.6 ? 'good, clean work.' : perf > 0.35 ? 'rough, but it will do.' : 'crude.'}`, perf > 0.35, 2);
    this.knife.visible = false;
    this.reveal = 0;
    this.progress = 1;
  }

  /** The finished piece rises and turns; the waste drops away. */
  private animateReveal(dt: number) {
    this.reveal += dt;
    const k = Math.min(1, this.reveal / 1.2);
    const lift = k * k * (3 - 2 * k);
    const show = this.piece ?? this.stick;
    show.position.y = (this.mode === 'stick' && show === this.stick ? this.r0 : 0) + lift * (this.mode === 'flat' ? 0.2 : 0.12);
    show.rotation.y = lift * Math.PI * 0.35;
    if (this.mode === 'flat' && this.stock) {
      // The off-cut slides off the bench.
      this.stock.position.y = (this.product === 'wooden_shovel' ? 0.0175 : 0) - lift * 0.4;
      this.stock.position.z = lift * 0.3;
      this.stock.rotation.x = lift * 0.6;
    }
    if (this.reveal > 1.6) this.done = true;
  }
}
