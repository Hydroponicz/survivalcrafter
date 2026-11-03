import * as THREE from 'three';
import { box, clamp01, mat, Minigame, type Meter, type MgInput } from './core';
import type { Gesture } from './tutorials';

// Knapping, as it's done: a stone on a leather pad, and a hammerstone in your
// hand. Strike the stone's edge and a flake breaks away, leaving a scar;
// work your way round until what's left is the shape of the tool (outlined
// on the stone). Hold the button to put force behind a blow and let go to
// strike: harder blows, and blows landed further in from the edge, take off
// bigger flakes. Too hard, or too far in, and a flake bites into the shape
// itself; bite too deep and the stone is spoiled.

export type KnapShape = 'hatchet' | 'knife' | 'spear' | 'pick' | 'hammer' | 'anvil';

/** The shape a recipe knaps, by the item it makes. */
export const KNAP_SHAPES: Record<string, KnapShape> = {
  stone_hatchet: 'hatchet', stone_knife: 'knife', stone_spear: 'spear', stone_pickaxe: 'pick', stone_hammer: 'hammer', stone_anvil: 'anvil',
};

const NAMES: Record<KnapShape, string> = {
  hatchet: 'an axe head', knife: 'a blade', spear: 'a spear point', pick: 'a pick head', hammer: 'a hammerstone', anvil: 'an anvil stone',
};

/**
 * Outline of each shape (metres, lying along x): length, greatest half-width,
 * and how wide it is along its length (t = 0 at the butt, 1 at the working end).
 */
const OUTLINES: Record<KnapShape, { len: number; w: number; at: (t: number) => number }> = {
  // Narrow at the butt (bound into the haft), a broad rounded bit.
  hatchet: { len: 0.17, w: 0.058, at: (t) => (0.38 + 0.62 * Math.min(1, t / 0.85)) * roundEnds(t, 0.08, 0.16) },
  // Long and slim, coming to a point.
  knife: { len: 0.19, w: 0.03, at: (t) => Math.pow(Math.sin(Math.PI * t), 0.6) * (1.1 - 0.5 * t) },
  // A leaf: widest near the base, a long taper to the tip.
  spear: { len: 0.17, w: 0.04, at: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.65)), 0.85) },
  // Long, narrow, pointed.
  pick: { len: 0.19, w: 0.03, at: (t) => Math.pow(Math.sin(Math.PI * t), 0.5) * (1.25 - 0.75 * t) },
  // A rounded lump for the hand.
  hammer: { len: 0.12, w: 0.046, at: (t) => Math.sqrt(Math.sin(Math.PI * t)) },
  // A broad flat slab.
  anvil: { len: 0.21, w: 0.075, at: (t) => Math.pow(Math.min(1, Math.sin(Math.PI * t) * 3.5), 0.5) },
};

/** Rounding at the ends of an outline (t: 0..1 along it; how long each rounded end is). */
function roundEnds(t: number, butt: number, tip: number): number {
  let k = 1;
  if (t < butt) k *= Math.sqrt(Math.max(0, 1 - ((butt - t) / butt) ** 2));
  if (t > 1 - tip) k *= Math.sqrt(Math.max(0, 1 - ((t - (1 - tip)) / tip) ** 2));
  return k;
}

/** The worked area: N × N cells over SIZE metres. */
const N = 110;
const SIZE = 0.34;
const CELL = SIZE / N;
/** Thickness of the stone at its middle. */
const THICK = 0.032;
const TOP = 0.012;

const idx = (i: number, j: number) => j * N + i;
const cx = (i: number) => -SIZE / 2 + (i + 0.5) * CELL;

function outline(shape: KnapShape): THREE.Vector2[] {
  const o = OUTLINES[shape], pts: THREE.Vector2[] = [], n = 40;
  for (let k = 0; k <= n; k++) { const t = k / n; pts.push(new THREE.Vector2(-o.len / 2 + o.len * t, o.w * o.at(t))); }
  for (let k = n - 1; k > 0; k--) { const t = k / n; pts.push(new THREE.Vector2(-o.len / 2 + o.len * t, -o.w * o.at(t))); }
  return pts;
}

/** Signed distance from a point to a polygon (negative inside). */
function signedDist(poly: THREE.Vector2[], x: number, z: number): number {
  let d = Infinity, inside = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const p = poly[a], q = poly[b];
    if ((p.y > z) !== (q.y > z) && x < ((q.x - p.x) * (z - p.y)) / (q.y - p.y) + p.x) inside = !inside;
    const ex = q.x - p.x, ez = q.y - p.y, l2 = ex * ex + ez * ez;
    const t = l2 ? Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.y) * ez) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - p.x - ex * t, z - p.y - ez * t));
  }
  return inside ? -d : d;
}

export class KnapGame extends Minigame {
  readonly title = 'Knapping';
  readonly instructions: string;
  /** The stone left, and the shape to leave (cells). */
  private stone = new Uint8Array(N * N);
  private shape = new Uint8Array(N * N);
  /** Flake scars pressed into the top (per vertex), and where the stone was freshly struck. */
  private scar = new Float32Array((N + 1) * (N + 1));
  private fresh = new Float32Array((N + 1) * (N + 1));
  /** Cells' distance in from the edge (in cells). */
  private depth = new Float32Array(N * N);
  private shapeCells = 0;
  private wasteStart = 1;
  private stoneMesh: THREE.Mesh;
  private hammer: THREE.Mesh;
  private power = 0;
  private charging = false;
  /** A blow on its way down: where, and how far through. */
  private blow: { at: THREE.Vector3; t: number; power: number } | null = null;
  private flakes: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; rest: boolean }[] = [];
  private aim = new THREE.Vector3();
  private strikes = 0;
  private noiseSeed = Math.random() * 100;
  /** The force band that breaks clean flakes, and how much waste may be left. */
  private band: [number, number];
  private doneWaste: number;

  constructor(ease: number, private kind: KnapShape, hits: number) {
    super(ease);
    this.instructions = `Knap ${NAMES[kind]}: strike flakes off the edge of the stone until it matches the outline. Hold the button to put force behind the blow, let go to strike.`;
    this.band = [0.28, 0.72 + 0.15 * ease];
    this.doneWaste = 0.12 + 0.1 * ease;

    const pad = box(0.6, 0.02, 0.46, 0x7a5a3a);
    pad.position.y = -0.0;
    this.scene.add(pad);

    // The shape, and a stone around it a good deal bigger, irregular.
    const poly = outline(kind);
    const margin = 0.018 + hits * 0.003;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = cx(i), z = cx(j), d = signedDist(poly, x, z);
      if (d < 0) { this.shape[idx(i, j)] = 1; this.shapeCells++; }
      const a = Math.atan2(z, x * 0.7);
      const wobble = 1 + 0.35 * Math.sin(a * 3 + this.noiseSeed) + 0.2 * Math.sin(a * 7 + this.noiseSeed * 1.7);
      if (d < margin * wobble) this.stone[idx(i, j)] = 1;
    }
    this.wasteStart = Math.max(1, this.wasteCells());

    this.stoneMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4, metalness: 0.05 }));
    this.stoneMesh.position.y = TOP;
    this.scene.add(this.stoneMesh);
    this.rebuild();

    // The shape to leave, outlined on the stone.
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(poly.map((p) => new THREE.Vector3(p.x, TOP + 0.004, p.y))),
      new THREE.LineDashedMaterial({ color: 0xffd36a, dashSize: 0.008, gapSize: 0.005, transparent: true, opacity: 0.9, depthTest: false }));
    line.computeLineDistances();
    line.renderOrder = 10;
    this.scene.add(line);

    this.hammer = new THREE.Mesh(new THREE.DodecahedronGeometry(0.022, 1).scale(1.25, 0.9, 1), mat(0x8a857c, { flatShading: true }));
    this.hammer.castShadow = true;
    this.scene.add(this.hammer);
    this.look([0, 0.47, 0.25], [0, 0, 0.01]);
  }

  private wasteCells(): number {
    let n = 0;
    for (let k = 0; k < N * N; k++) if (this.stone[k] && !this.shape[k]) n++;
    return n;
  }

  private keptShape(): number {
    let n = 0;
    for (let k = 0; k < N * N; k++) if (this.stone[k] && this.shape[k]) n++;
    return n / Math.max(1, this.shapeCells);
  }

  /** How far each cell lies in from the edge (a chamfer distance, in cells). */
  private measure() {
    const D = this.depth;
    for (let k = 0; k < N * N; k++) D[k] = this.stone[k] ? 1e6 : 0;
    const pass = (i: number, j: number, di: number, dj: number, w: number) => {
      const a = i + di, b = j + dj;
      const v = a < 0 || b < 0 || a >= N || b >= N ? 0 : D[idx(a, b)];
      if (v + w < D[idx(i, j)]) D[idx(i, j)] = v + w;
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (this.stone[idx(i, j)]) { pass(i, j, -1, 0, 1); pass(i, j, 0, -1, 1); pass(i, j, -1, -1, 1.41); pass(i, j, 1, -1, 1.41); }
    for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) if (this.stone[idx(i, j)]) { pass(i, j, 1, 0, 1); pass(i, j, 0, 1, 1); pass(i, j, 1, 1, 1.41); pass(i, j, -1, 1, 1.41); }
  }

  /** Redraw the stone: thick in the middle, thinning to an edge, with its flake scars. */
  private rebuild() {
    this.measure();
    const V = N + 1, pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3), index: number[] = [];
    const ramp = 12;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      // A corner is as deep as the shallowest cell around it.
      let d = Infinity;
      for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) d = Math.min(d, a < 0 || b < 0 || a >= N || b >= N ? 0 : this.depth[idx(a, b)]);
      const v = j * V + i;
      const s = Math.min(1, d / ramp);
      const h = d === 0 ? 0.0015 : Math.max(0.002, THICK * Math.sqrt(s * (2 - s)) - this.scar[v]);
      pos[v * 3] = -SIZE / 2 + i * CELL; pos[v * 3 + 1] = h; pos[v * 3 + 2] = -SIZE / 2 + j * CELL;
      // Dark flint, lighter and greyer where freshly flaked.
      const n = 0.92 + 0.08 * Math.sin(i * 1.7 + j * 2.3 + this.noiseSeed) * Math.cos(i * 0.9 - j * 1.3);
      const f = Math.min(1, this.fresh[v]);
      col[v * 3] = (0.16 + 0.2 * f) * n; col[v * 3 + 1] = (0.15 + 0.2 * f) * n; col[v * 3 + 2] = (0.145 + 0.22 * f) * n;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (!this.stone[idx(i, j)]) continue;
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
    // The edge follows the cells' corners in steps: smooth it into a curve
    // (each corner on the edge eased toward its neighbours along the edge).
    const solid = (a: number, b: number) => a >= 0 && b >= 0 && a < N && b < N && this.stone[idx(a, b)] ? 1 : 0;
    const onEdge = new Uint8Array(V * V);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const n = solid(i - 1, j - 1) + solid(i, j - 1) + solid(i - 1, j) + solid(i, j);
      if (n > 0 && n < 4) onEdge[j * V + i] = 1;
    }
    for (let pass = 0; pass < 4; pass++) {
      const nx = new Float32Array(V * V), nz = new Float32Array(V * V);
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const v = j * V + i;
        if (!onEdge[v]) continue;
        let sx = 0, sz = 0, c = 0;
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (a < 0 || b < 0 || a > N || b > N || !onEdge[b * V + a]) continue;
          sx += pos[(b * V + a) * 3]; sz += pos[(b * V + a) * 3 + 2]; c++;
        }
        nx[v] = c ? (pos[v * 3] + sx / c) / 2 : pos[v * 3];
        nz[v] = c ? (pos[v * 3 + 2] + sz / c) / 2 : pos[v * 3 + 2];
      }
      for (let v = 0; v < V * V; v++) if (onEdge[v]) { pos[v * 3] = nx[v]; pos[v * 3 + 2] = nz[v]; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    this.stoneMesh.geometry.dispose();
    this.stoneMesh.geometry = g;
  }

  /** The stone's edge cell nearest a point (local x, z), and how far in from the edge the point is. */
  private nearestEdge(x: number, z: number): { i: number; j: number; dist: number; inside: number } | null {
    let best: { i: number; j: number; dist: number } | null = null;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = idx(i, j);
      if (!this.stone[k] || this.depth[k] > 1.01) continue;
      const d = Math.hypot(cx(i) - x, cx(j) - z);
      if (!best || d < best.dist) best = { i, j, dist: d };
    }
    if (!best) return null;
    const ai = Math.floor((x + SIZE / 2) / CELL), aj = Math.floor((z + SIZE / 2) / CELL);
    const inStone = ai >= 0 && aj >= 0 && ai < N && aj < N && this.stone[idx(ai, aj)];
    return { ...best, inside: inStone ? this.depth[idx(ai, aj)] * CELL : -best.dist };
  }

  /** Which way is out from the stone at an edge cell (away from the stone around it). */
  private outward(i: number, j: number): THREE.Vector2 {
    let sx = 0, sz = 0;
    for (let b = -5; b <= 5; b++) for (let a = -5; a <= 5; a++) {
      const p = i + a, q = j + b;
      if (p < 0 || q < 0 || p >= N || q >= N || !this.stone[idx(p, q)]) continue;
      sx += a; sz += b;
    }
    const v = new THREE.Vector2(-sx, -sz);
    return v.lengthSq() > 0 ? v.normalize() : new THREE.Vector2(1, 0);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    if (this.done || this.blow) return null;
    const p = this.toScreen(this.aim.clone().setY(TOP + THICK));
    if (this.charging) {
      const [lo, hi] = this.band;
      return { x: p.x + 40, y: p.y - 30, text: this.power < lo ? 'more force…' : this.power > hi ? 'too hard!' : 'let go to strike', gesture: 'release' };
    }
    const e = this.nearestEdge(this.aim.x, this.aim.z);
    const onEdge = e && e.inside < 0.02 && e.inside > -0.012;
    const k = e ? idx(e.i, e.j) : -1;
    if (onEdge && k >= 0 && this.shape[k]) return { x: p.x + 40, y: p.y - 30, text: 'that edge is the shape: strike the waste, outside the line', gesture: 'hold' };
    return onEdge
      ? { x: p.x + 40, y: p.y - 30, text: 'hold to put force behind the blow', gesture: 'hold' }
      : { x: p.x + 40, y: p.y - 30, text: 'aim at the edge of the stone, outside the gold line', gesture: 'hold' };
  }

  update(dt: number, i: MgInput) {
    const p = this.onPlaneY(i.ndc, TOP + THICK * 0.5);
    if (p) this.aim.copy(p);

    // Flakes that broke away tumble onto the pad.
    for (const f of this.flakes) {
      if (f.rest) continue;
      f.vel.y -= 3 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += f.spin.x * dt; f.mesh.rotation.z += f.spin.z * dt;
      if (f.mesh.position.y < 0.014) { f.mesh.position.y = 0.014; f.rest = true; f.mesh.rotation.x = (Math.random() - 0.5) * 0.3; f.mesh.rotation.z = (Math.random() - 0.5) * 0.3; }
    }
    for (let k = 0; k < this.fresh.length; k++) if (this.fresh[k] > 0.35) this.fresh[k] = Math.max(0.35, this.fresh[k] - dt * 0.4);

    if (this.done) return;

    // The hammerstone: over your aim, raised as you gather force, then down.
    if (this.blow) {
      this.blow.t += dt / 0.11;
      const k = Math.min(1, this.blow.t);
      const from = this.blow.at.clone().add(new THREE.Vector3(0.045, 0.05 + this.blow.power * 0.1, -0.01));
      this.hammer.position.lerpVectors(from, this.blow.at.clone().add(new THREE.Vector3(0.016, 0.022, 0)), k * k);
      if (this.blow.t >= 1) { const b = this.blow; this.blow = null; this.strike(b.at, b.power); }
      return;
    }
    if (i.pressed) { this.charging = true; this.power = 0; }
    if (this.charging && i.down) this.power = Math.min(1.15, this.power + dt * (0.75 + 0.15 * (1 - this.ease)));
    // Held off to the side of where you aim, so you can see the spot.
    const lift = this.charging ? 0.05 + this.power * 0.1 : 0.05;
    this.hammer.position.lerp(this.aim.clone().add(new THREE.Vector3(0.045, lift, -0.01)), Math.min(1, dt * 14));
    this.hammer.rotation.set(0.3, 0.4, -0.2 - (this.charging ? this.power * 0.5 : 0));
    if (this.charging && i.released) {
      this.charging = false;
      this.blow = { at: this.aim.clone().setY(TOP + THICK * 0.6), t: 0, power: this.power };
    }
  }

  /** The blow lands: break a flake off where it struck (or not). */
  private strike(at: THREE.Vector3, power: number) {
    const e = this.nearestEdge(at.x, at.z);
    if (!e) return;
    const [lo, hi] = this.band;
    // Too far off the stone, or too far in from its edge, and nothing comes away.
    if (e.inside < -0.014) { this.say('You strike the leather.', false); this.sample(0.3, 0.3); return; }
    const deepest = 0.03 + 0.012 * this.ease;
    if (e.inside > deepest) { this.say('Too far in: the blow just bruises the stone. Strike nearer the edge.', false, 1.6); this.sample(0.25, 0.5); this.burst(at, 0x9e9a92, 4, 0.4); return; }
    if (power < lo * 0.6) { this.say('Too soft: nothing comes away.', false); this.sample(0.4, 0.3); return; }

    this.strikes++;
    const out = this.outward(e.i, e.j);
    const edge = new THREE.Vector2(cx(e.i), cx(e.j));
    const hard = power > hi;
    // A bigger flake for a harder blow and one landed further in from the edge.
    let R = (0.018 + 0.04 * Math.min(1, power) + Math.max(0, e.inside) * 0.5) * (0.85 + Math.random() * 0.3) * (1.15 - 0.2 * this.ease);
    if (hard) R *= 1.55;
    const bite = R * (0.5 + (hard ? 0.25 : 0)) + Math.max(0, e.inside) * 0.6;
    const centre = edge.clone().addScaledVector(out, R - bite);
    const seed = Math.random() * 10;
    let removed = 0, removedShape = 0;
    const r0 = Math.ceil((R * 1.4) / CELL);
    const ci = Math.round((centre.x + SIZE / 2) / CELL - 0.5), cj = Math.round((centre.y + SIZE / 2) / CELL - 0.5);
    for (let b = -r0; b <= r0; b++) for (let a = -r0; a <= r0; a++) {
      const p = ci + a, q = cj + b;
      if (p < 0 || q < 0 || p >= N || q >= N) continue;
      const k = idx(p, q);
      if (!this.stone[k]) continue;
      const dx = cx(p) - centre.x, dz = cx(q) - centre.y, ang = Math.atan2(dz, dx);
      // Flakes break with a ragged, shell-like edge.
      if (Math.hypot(dx, dz) > R * (1 + 0.18 * Math.sin(ang * 5 + seed) + 0.1 * Math.sin(ang * 9 + seed * 2))) continue;
      this.stone[k] = 0;
      removed++;
      if (this.shape[k]) removedShape++;
    }
    // Pieces knocked loose from the rest fall away too.
    removedShape += this.dropLoose();
    // The flake scar: a shallow scoop running in from the edge.
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = -SIZE / 2 + i * CELL, z = -SIZE / 2 + j * CELL, d = Math.hypot(x - centre.x, z - centre.y);
      if (d > R * 1.9) continue;
      const k = 1 - d / (R * 1.9);
      this.scar[j * (N + 1) + i] += 0.007 * k * k * Math.min(1.2, power);
      this.fresh[j * (N + 1) + i] = Math.max(this.fresh[j * (N + 1) + i], k * 1.4);
    }
    this.rebuild();
    if (removed) this.flake(new THREE.Vector3(edge.x, TOP + THICK * 0.4, edge.y), out, R);
    this.burst(new THREE.Vector3(edge.x, TOP + THICK * 0.5, edge.y), 0xb0aca4, 5 + Math.round(power * 6), 0.6);

    // How it went: flakes off the waste are good; any bite out of the shape is not.
    const nick = removedShape / Math.max(1, this.shapeCells);
    const kept = this.keptShape(), waste = this.wasteCells() / this.wasteStart;
    if (!removed) this.say('Only grit comes away.', false);
    else if (nick > 0.03) this.say(hard ? 'Too hard! A big flake bites deep into the shape.' : 'Too deep: that flake bit into the shape.', false, 1.4);
    else if (nick > 0) this.say('Careful: you nicked the outline.', false);
    else if (hard) this.say('Too hard, but it came away clean. Lucky.', true);
    else this.say(R > 0.03 ? 'A good big flake.' : 'A neat little flake.', true);
    this.sample(clamp01(1 - nick * 14) * (removed ? 1 : 0.4), 0.6);

    this.progress = clamp01((1 - waste) / (1 - this.doneWaste));
    if (kept < 0.8) {
      this.say('Too much of it has broken away: the stone is spoiled.', false, 2);
      this.sample(0, 4);
      this.done = true;
    } else if (waste <= this.doneWaste) {
      // The finished piece: as good as it matches the outline.
      this.sample(Math.pow(kept, 4) * (1 - waste * 0.6), 4);
      this.say(`Done: it has the shape of ${NAMES[this.kind]}.`, true, 2);
      this.done = true;
    }
  }

  /** Any stone no longer joined to the main piece falls away. Returns how much of the shape went with it. */
  private dropLoose(): number {
    const label = new Int32Array(N * N).fill(-1), sizes: number[] = [];
    for (let k = 0; k < N * N; k++) {
      if (!this.stone[k] || label[k] >= 0) continue;
      const id = sizes.length, stack = [k];
      label[k] = id;
      let n = 0;
      while (stack.length) {
        const c = stack.pop()!, i = c % N, j = (c - i) / N;
        n++;
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (a < 0 || b < 0 || a >= N || b >= N) continue;
          const q = idx(a, b);
          if (this.stone[q] && label[q] < 0) { label[q] = id; stack.push(q); }
        }
      }
      sizes.push(n);
    }
    if (sizes.length < 2) return 0;
    const main = sizes.indexOf(Math.max(...sizes));
    let lost = 0;
    for (let k = 0; k < N * N; k++) if (this.stone[k] && label[k] !== main) { this.stone[k] = 0; if (this.shape[k]) lost++; }
    if (lost === 0) this.say('A loose piece falls away.', true);
    return lost;
  }

  /** A flake flies off the edge and lands on the pad. */
  private flake(at: THREE.Vector3, out: THREE.Vector2, R: number) {
    const g = new THREE.CircleGeometry(R * 0.42, 7);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 1; k < p.count; k++) p.setXY(k, p.getX(k) * (0.7 + Math.random() * 0.5), p.getY(k) * (0.5 + Math.random() * 0.4));
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6a655e, roughness: 0.4, side: THREE.DoubleSide, flatShading: true }));
    m.position.copy(at);
    m.castShadow = true;
    this.scene.add(m);
    const v = new THREE.Vector3(out.x, 0, out.y).multiplyScalar(0.12 + Math.random() * 0.12);
    v.y = 0.25 + Math.random() * 0.15;
    this.flakes.push({ mesh: m, vel: v, spin: new THREE.Vector3((Math.random() - 0.5) * 18, 0, (Math.random() - 0.5) * 18), rest: false });
  }

  meters(): Meter[] {
    const waste = this.wasteCells() / this.wasteStart;
    return [
      { label: 'Force', value: this.charging ? Math.min(1, this.power / 1.15) : 0, band: [this.band[0] / 1.15, this.band[1] / 1.15], color: '#d9b26a' },
      { label: 'Shape kept', value: this.keptShape(), band: [0.95, 1], color: '#9fdc7c' },
      { label: 'Waste left', value: waste, band: [0, this.doneWaste], color: '#c9a27a' },
    ];
  }
}
