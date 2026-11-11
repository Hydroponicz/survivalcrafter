import * as THREE from 'three';
import { itemDef } from '../../data/items';
import { buildToolMesh } from '../tools';
import { clamp01, clearView, Minigame, workTool, type Blocked, type Meter, type MgInput } from './core';
import { sfx } from './sfx';
import type { Gesture } from './tutorials';

// Whittling, out in the world: wherever you start it, you kneel and lay the
// branch across a log on the ground before you, and draw your knife along it.
// The branch is one piece of wood, bark and all: each clean stroke peels the
// bark off the stretch it passes, a ribbon of shaving curling up in front of
// the blade until it breaks off and drops to the ground; a second pass pares
// the wood down pale and smooth, in long flat knife facets. (Kindling keeps
// its curls standing on the stick: a feather stick.) Slip off the line and
// the blade digs in: a dark gouge. At the end you lift up what you've made.

/** Where the work is laid out: on the ground (y), in front of whoever's whittling. */
export interface CarveSpot { x: number; y: number; z: number }

type Phase = 'arrive' | 'work' | 'reveal' | 'done';

/** Along the branch (metres), its rings, and the knife's reach along it. */
const LEN = 0.66, RINGS = 120, AROUND = 18;
const BARK = new THREE.Color(0x4e3420), BARK2 = new THREE.Color(0x6b4a2c), PARED = new THREE.Color(0xdcb880), SMOOTH = new THREE.Color(0xecd4a2), GOUGE = new THREE.Color(0x3a2414);
/** The branch lies across the log at this height (work frame), slightly raised toward its far end. */
const REST_Y = 0.135;

/** A tiny repeatable random. */
const rnd = (i: number) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

interface Curl { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; rest: boolean }

export class WhittleGame extends Minigame {
  readonly title: string;
  readonly instructions = 'Hold the left button and draw the knife along the branch, left to right, keeping to the line. Steady strokes peel the bark off in long curls; a second pass shaves it smooth.';
  readonly inWorld = true;
  readonly hidesPlayer = false;
  /** You kneel at it. */
  readonly bodyClip = 'crouch_idle' as const;
  readonly overlay = new THREE.Group();
  readonly stand: { x: number; z: number; yaw: number };
  readonly workLight = new THREE.Vector3();
  showPointer = false;
  private work = new THREE.Group();
  private phase: Phase = 'arrive';
  private t = 0;
  private product: string;
  // The branch: one mesh, reshaped as it's carved.
  private branch: THREE.Mesh;
  private stick = new THREE.Group();
  private base: Float32Array;
  /** Per vertex: its ring along the branch, its angle round it, and its share of the full radius (0 at the end caps' middles). */
  private ringOf: Int16Array;
  private angleOf: Float32Array;
  private shareOf: Float32Array;
  private bump: Float32Array;
  /** Per ring: radius now, how it's been worked (0 bark, 1 pared, 2 smooth), and any gouge. */
  private radius: Float32Array;
  private stage: Uint8Array;
  private gouged: Uint8Array;
  private readonly r0 = 0.021;
  private knife = new THREE.Group();
  private guide: THREE.Line;
  private path: THREE.Vector3[] = [];
  private reached = 0;
  private pass = 0;
  // The shaving curling up in front of the blade, and those already off.
  private curl: { mesh: THREE.Mesh; from: number; colour: THREE.Color } | null = null;
  private curls: Curl[] = [];
  private feathers = 0;
  private streak = 0;
  private speedShown = 0;
  private accuracy = 1;
  private lastSound = 0;
  private lastLocal: THREE.Vector3 | null = null;
  private camFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private camTo = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private owned: THREE.Material[] = [];
  private woodMat: THREE.MeshStandardMaterial;
  private reveal = 0;
  private finished: THREE.Object3D | null = null;

  constructor(ease: number, private passes: number, spot: CarveSpot, from: THREE.Camera, toolType?: string, make?: string) {
    super(ease);
    this.product = make ?? 'shaft';
    this.title = `Whittling: ${itemDef(this.product).name}`;
    // Facing you: +z toward where you are.
    const toYou = new THREE.Vector3(from.position.x - spot.x, 0, from.position.z - spot.z);
    if (toYou.lengthSq() < 1e-4) toYou.set(0, 0, 1);
    toYou.normalize();
    const yaw = Math.atan2(toYou.x, toYou.z);
    this.work.position.set(spot.x, spot.y, spot.z);
    this.work.rotation.y = yaw;
    this.overlay.add(this.work);
    const standAt = new THREE.Vector3(spot.x, 0, spot.z).addScaledVector(toYou, 0.5);
    this.stand = { x: standAt.x, z: standAt.z, yaw };
    const own = <T extends THREE.Material>(m: T) => { this.owned.push(m); return m; };

    // A patch of trodden earth; a short log lying across, and a stone, to rest the branch on.
    const earth = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2), own(new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, transparent: true, opacity: 0.3, depthWrite: false })));
    earth.position.y = 0.004; earth.receiveShadow = true;
    this.work.add(earth);
    this.work.add(this.restLog(own));
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 1).scale(1.3, 0.75, 1), own(new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.95, flatShading: true })));
    stone.position.set(-0.27, 0.03, 0.02); stone.rotation.y = 0.7; stone.castShadow = stone.receiveShadow = true;
    this.work.add(stone);

    // The branch, from the stone up across the log.
    this.woodMat = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    const geo = new THREE.CylinderGeometry(this.r0, this.r0, LEN, AROUND, RINGS, false).rotateZ(Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute, n = pos.count;
    this.base = Float32Array.from(pos.array as Float32Array);
    this.ringOf = new Int16Array(n); this.angleOf = new Float32Array(n); this.shareOf = new Float32Array(n); this.bump = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      this.ringOf[i] = Math.max(0, Math.min(RINGS, Math.round(((x + LEN / 2) / LEN) * RINGS)));
      this.angleOf[i] = Math.atan2(z, y);
      this.shareOf[i] = Math.hypot(y, z) / this.r0;
      // Bark: ridges running along it, a knot or two, and a little taper.
      const r = this.ringOf[i], a = this.angleOf[i];
      this.bump[i] = 0.0016 * Math.sin(a * 7 + r * 0.05) + 0.0009 * (rnd(r * 31 + Math.round(a * 5)) - 0.5)
        + 0.004 * Math.exp(-((r - 34) ** 2) / 8) * Math.max(0, Math.cos(a - 1.2)) + 0.003 * Math.exp(-((r - 88) ** 2) / 6) * Math.max(0, Math.cos(a + 2));
    }
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.radius = new Float32Array(RINGS + 1);
    for (let r = 0; r <= RINGS; r++) this.radius[r] = this.r0 * (1.04 - 0.08 * (r / RINGS));
    this.stage = new Uint8Array(RINGS + 1);
    this.gouged = new Uint8Array(RINGS + 1);
    this.branch = new THREE.Mesh(geo, this.woodMat);
    this.branch.castShadow = this.branch.receiveShadow = true;
    this.stick.add(this.branch);
    // Resting on the stone and the log: a little tilt up toward the far end.
    this.stick.position.set(0, REST_Y - 0.02, 0);
    this.stick.rotation.z = 0.06;
    this.work.add(this.stick);
    this.reshape(0, RINGS);

    const kn = workTool(toolType, 'grip');
    if (kn) this.knife.add(kn);
    this.knife.rotation.y = 0.35;
    this.work.add(this.knife);
    this.guide = new THREE.Line(new THREE.BufferGeometry(), own(new THREE.LineDashedMaterial({ color: 0xffd54a, dashSize: 0.016, gapSize: 0.009, depthTest: false, transparent: true, opacity: 0.85 })));
    this.guide.renderOrder = 10;
    this.work.add(this.guide);
    this.makePath();

    // Glide down from your own view to the work.
    this.camFrom.pos.copy(from.position);
    this.camFrom.quat.copy(from.quaternion);
    // (From across the branch, a little to one side: you, kneeling, and the work between.)
    this.camTo.copy(this.work.localToWorld(new THREE.Vector3(-0.42, 0.78, -0.5)));
    this.lookAt.copy(this.work.localToWorld(new THREE.Vector3(0.04, REST_Y + 0.08, 0.14)));
    this.camera.position.copy(from.position);
    this.camera.quaternion.copy(from.quaternion);
    if ((from as THREE.PerspectiveCamera).fov) this.camera.fov = (from as THREE.PerspectiveCamera).fov;
    this.camera.near = 0.02;
    this.camera.updateProjectionMatrix();
    this.workLight.copy(this.work.localToWorld(new THREE.Vector3(0.2, 0.5, 0.4)));
  }

  /** A short length of log lying across, under the branch's far half. */
  private restLog(own: <T extends THREE.Material>(m: T) => T): THREE.Group {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.058, 0.062, 0.22, 14, 4).rotateX(Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i));
      c.copy(BARK).lerp(BARK2, 0.5 + 0.5 * Math.sin(a * 9 + pos.getZ(i) * 20)).multiplyScalar(0.85 + rnd(i) * 0.25);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const log = new THREE.Mesh(geo, own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
    log.castShadow = log.receiveShadow = true;
    g.add(log);
    // Its sawn ends: pale wood with rings.
    for (const s of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CircleGeometry(0.057, 16), own(new THREE.MeshStandardMaterial({ color: 0xc8a272, roughness: 0.9 })));
      end.position.z = s * 0.1105; end.rotation.y = s > 0 ? 0 : Math.PI;
      g.add(end);
      for (const rr of [0.018, 0.033, 0.047]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(rr, rr + 0.003, 18), own(new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.9 })));
        ring.position.z = s * 0.1112; ring.rotation.y = s > 0 ? 0 : Math.PI;
        g.add(ring);
      }
    }
    g.position.set(0.17, 0.058, 0);
    return g;
  }

  /** Remake the rings from..to: their radius (with facets once carved) and colour. */
  private reshape(from: number, to: number) {
    const geo = this.branch.geometry, pos = geo.attributes.position as THREE.BufferAttribute, col = geo.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const r = this.ringOf[i];
      if (r < from - 1 || r > to + 1) continue;
      const a = this.angleOf[i], st = this.stage[r], share = this.shareOf[i];
      let rad: number;
      if (st === 0) {
        rad = this.radius[r] + this.bump[i];
        // Bark, darker in its furrows, with lighter ridges.
        c.copy(BARK).lerp(BARK2, 0.5 + 0.5 * Math.sin(a * 7 + r * 0.05)).multiplyScalar(0.85 + rnd(r * 13 + Math.round(a * 4)) * 0.3);
      } else {
        // Knife work leaves long flat facets round it: fewer and plainer once it's smoothed.
        const facets = st === 1 ? 7 : 11, depth = st === 1 ? 0.07 : 0.025;
        const f = Math.cos(((a * facets) / (Math.PI * 2) % 1 - 0.5) * (Math.PI * 2 / facets)) ;
        rad = this.radius[r] * (1 - depth + depth * f);
        const grain = 0.92 + 0.1 * Math.sin(r * 0.9 + a * 2) * Math.sin(a * 3 + 1) + 0.05 * (rnd(Math.round(a * 9) * 7 + 3) - 0.5);
        c.copy(st === 1 ? PARED : SMOOTH).multiplyScalar(grain);
        // A few flecks of bark left in the hollows after the first pass.
        if (st === 1 && rnd(r * 17 + Math.round(a * 6)) < 0.08) c.lerp(BARK2, 0.6);
        if (this.gouged[r]) c.lerp(GOUGE, 0.55);
      }
      const k = share * rad;
      const x = this.base[i * 3];
      pos.setXYZ(i, x, Math.cos(a) * k, Math.sin(a) * k);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeVertexNormals();
  }

  /** Where you kneel (at the branch, facing it). */
  standAt(): { x: number; z: number; face: { x: number; z: number } } {
    const p = this.work.position;
    return { x: this.stand.x, z: this.stand.z, face: { x: p.x, z: p.z } };
  }

  /** A point on top of the branch (work frame), at a share along it. */
  private onTop(t: number, lift = 0.002): THREE.Vector3 {
    const ring = Math.round(clamp01(t) * RINGS);
    const v = new THREE.Vector3(-LEN / 2 + clamp01(t) * LEN, this.radius[ring] + lift, 0);
    return this.stick.localToWorld(v.clone()).applyMatrix4(new THREE.Matrix4().copy(this.work.matrixWorld).invert());
  }

  /** This pass's line: along the top of the branch, from near one end to near the other. */
  private makePath() {
    this.work.updateMatrixWorld(true);
    this.path = [];
    const ph = Math.random() * 6, amp = 0.002 + Math.random() * 0.003;
    for (let k = 0; k <= 40; k++) {
      const t = this.ringShare(k / 40);
      this.path.push(this.onTop(t, 0.003).add(new THREE.Vector3(0, 0, Math.sin(t * 9 + ph) * amp)));
    }
    this.guide.geometry.dispose();
    this.guide.geometry = new THREE.BufferGeometry().setFromPoints(this.path);
    this.guide.computeLineDistances();
    this.reached = 0;
  }

  /** The point a share of the way along this pass (work frame). */
  private at(t: number): THREE.Vector3 {
    const f = clamp01(t) * (this.path.length - 1), i = Math.min(this.path.length - 2, Math.floor(f));
    return this.path[i].clone().lerp(this.path[i + 1], f - i);
  }
  /** The share of the branch (0..1, ring space) a share along this pass is at. */
  private ringShare(t: number) { return 0.96 - clamp01(t) * 0.92; }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    if (this.phase !== 'work') return null;
    const p = this.toScreen(this.work.localToWorld(this.at(Math.min(0.98, this.reached + 0.06))));
    return { x: p.x + 30, y: p.y - 60, text: this.pass === 0 ? 'hold and draw the knife along the branch' : 'once more: shave it smooth', gesture: 'right' };
  }

  meters(): Meter[] {
    return [
      { label: 'Stroke', value: clamp01(this.speedShown), band: [0.3, 0.8] },
      { label: 'On the line', value: this.accuracy, color: this.accuracy > 0.7 ? '#9fdc7c' : this.accuracy > 0.4 ? '#f2c14e' : '#ef7d6a' },
    ];
  }

  update(dt: number, i: MgInput) {
    this.t += dt;
    this.settleCurls(dt);
    switch (this.phase) {
      case 'arrive': {
        const k = Math.min(1, this.t / 0.7), e = k * k * (3 - 2 * k);
        this.camera.position.lerpVectors(this.camFrom.pos, this.camTo, e);
        const look = new THREE.PerspectiveCamera();
        look.position.copy(this.camTo);
        look.lookAt(this.lookAt);
        this.camera.quaternion.slerpQuaternions(this.camFrom.quat, look.quaternion, e);
        this.camera.updateMatrixWorld();
        this.knife.position.copy(this.at(0)).add(new THREE.Vector3(0, 0.03, 0.04));
        if (k >= 1) { this.phase = 'work'; this.t = 0; }
        return;
      }
      case 'work': this.carve(dt, i); return;
      case 'reveal': this.animateReveal(dt); return;
      case 'done': return;
    }
  }

  private carve(dt: number, i: MgInput) {
    // (The branch rises a little toward its far end: meet the pointer at the height of the wood just ahead.)
    const here = this.at(Math.min(1, this.reached + 0.03));
    const hit = this.onPlaneY(i.ndc, this.work.position.y + here.y);
    if (!hit) return;
    const p = this.work.worldToLocal(hit.clone());
    // The knife follows the pointer, laid on the wood, tipping into the stroke while you cut.
    this.knife.position.set(p.x, here.y + (i.down ? 0.001 : 0.012), p.z);
    this.knife.rotation.z = i.down ? -0.3 : -0.1;
    this.speedShown += ((this.lastLocal && i.down ? this.lastLocal.distanceTo(p) / Math.max(dt, 1e-3) / 0.4 : 0) - this.speedShown) * Math.min(1, dt * 8);
    this.lastLocal = p.clone();
    if (!i.down) { this.dropCurl(); return; }
    const tol = 0.007 + 0.016 * this.ease;
    // Nearest point of the line just ahead of where you've got to.
    let best = { t: this.reached, off: Infinity };
    for (let k = 0; k <= 30; k++) {
      const t = Math.min(1, this.reached - 0.01 + (k / 30) * 0.15);
      const q = this.at(t), off = Math.hypot(q.x - p.x, q.z - p.z);
      if (off < best.off) best = { t, off };
    }
    if (best.t <= this.reached) return;
    if (best.off > tol * 2.6) { this.say('Bring the knife back to the line.', false, 0.6); this.dropCurl(); return; }
    // A steady pace: rushing doesn't cut faster.
    const maxStep = dt * (0.34 + 0.16 * this.ease);
    const rushed = best.t - this.reached > maxStep * 1.8;
    const to = Math.min(best.t, this.reached + maxStep);
    const clean = best.off <= tol;
    this.sample(clean ? clamp01(1 - best.off / tol) * (rushed ? 0.75 : 1) : 0.15, to - this.reached);
    this.accuracy += (clamp01(1 - best.off / (tol * 2)) - this.accuracy) * 0.15;
    const from = this.reached;
    this.reached = to;
    // The wood the blade passed over.
    const r0 = Math.floor(this.ringShare(to) * RINGS), r1 = Math.ceil(this.ringShare(from) * RINGS);
    for (let r = r0; r <= r1; r++) {
      if (this.stage[r] > this.pass) continue;
      this.stage[r] = this.pass + 1;
      this.radius[r] = this.r0 * (this.pass === 0 ? 0.86 : 0.74) * (1.02 - 0.06 * (r / RINGS));
      if (!clean) { this.gouged[r] = 1; this.radius[r] *= 0.93; }
    }
    this.reshape(r0, r1);
    // Also round off the uncut stretch beyond each end of the stroke (the ends stay bark).
    if (clean) {
      this.streak++;
      this.growCurl(to);
      if (this.time - this.lastSound > 0.06) { sfx.shave(this.speedShown); this.lastSound = this.time; }
      if (this.streak % 45 === 0) { this.say(`Clean stroke ×${this.streak / 45}`, true, 0.7); sfx.tick(this.streak / 45); }
      if (rushed && Math.random() < 0.12) this.say('Easy: steady strokes cut cleaner.', false, 0.6);
    } else {
      this.streak = 0;
      this.dropCurl();
      if (this.time - this.lastSound > 0.25) { sfx.slip(); this.lastSound = this.time; }
      this.say('Too deep: the blade dug in!', false, 0.6);
    }
    this.progress = (this.pass + this.reached) / this.passes;
    if (this.reached >= 0.995) this.finishPass();
  }

  // ---------- shavings
  /** A curled ribbon of wood: `len` along the stroke, rolled up tighter at its free end. */
  private ribbon(len: number, width: number, colour: THREE.Color, inner: THREE.Color): THREE.BufferGeometry {
    const seg = 14, pts: number[] = [], cols: number[] = [], idx: number[] = [];
    const R = 0.015, turns = Math.min(1.7, len / 0.03);
    for (let k = 0; k <= seg; k++) {
      const s = k / seg;
      // It leaves the wood flat and rolls up as it grows (a spiral, tighter toward the end).
      const ang = s * turns * Math.PI * 2, rad = R * (1 - 0.45 * s);
      const x = -Math.sin(ang) * rad + (1 - Math.min(1, turns)) * s * len, y = (1 - Math.cos(ang)) * rad;
      const wob = 0.0015 * Math.sin(k * 1.7);
      for (const side of [-1, 1]) {
        pts.push(x, y, side * width * (0.5 - 0.15 * s) + wob);
        const c = side > 0 ? colour : inner;
        cols.push(c.r, c.g, c.b);
      }
      if (k < seg) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** The shaving curling up in front of the blade grows with the stroke; long enough, it breaks off. */
  private growCurl(to: number) {
    const outer = this.pass === 0 && this.product !== 'kindling' ? BARK.clone() : (this.pass === 0 ? PARED : SMOOTH).clone().multiplyScalar(1.05);
    if (!this.curl) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.curlMat());
      mesh.castShadow = true;
      this.work.add(mesh);
      this.curl = { mesh, from: to, colour: outer };
      // (Each comes off at its own slant round the wood.)
      mesh.userData.tilt = (Math.random() - 0.5) * 1.2;
    }
    const c = this.curl, len = (to - c.from) * LEN * 0.92;
    c.mesh.geometry.dispose();
    c.mesh.geometry = this.ribbon(Math.max(0.004, len), 0.016 + 0.006 * this.ease, c.colour, SMOOTH);
    // Standing up just ahead of the blade, rolling back toward you.
    c.mesh.position.copy(this.at(to)).add(new THREE.Vector3(-0.004, -0.001, 0));
    c.mesh.rotation.set(c.mesh.userData.tilt ?? 0, 0, 0);
    if (len > (this.product === 'kindling' ? 0.045 : 0.07)) this.dropCurl();
  }

  private curlMat() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    this.owned.push(m);
    return m;
  }

  /** Let the curl go: it drops to the ground (or, on a feather stick, stays standing on the wood). */
  private dropCurl() {
    const c = this.curl;
    if (!c) return;
    this.curl = null;
    if (Math.random() < 0.7) sfx.curl();
    if (this.product === 'kindling' && this.feathers < 14) {
      // A feather stick: the curl stays on, standing out from the wood.
      this.feathers++;
      this.stick.attach(c.mesh);
      return;
    }
    this.curls.push({ mesh: c.mesh, vel: new THREE.Vector3((Math.random() - 0.3) * 0.25, 0.25 + Math.random() * 0.2, 0.15 + Math.random() * 0.2), spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6), rest: false });
    // A heap, not a flood.
    if (this.curls.length > 90) { const old = this.curls.shift()!; old.mesh.removeFromParent(); old.mesh.geometry.dispose(); }
  }

  private settleCurls(dt: number) {
    for (const s of this.curls) {
      if (s.rest) continue;
      s.vel.y -= 3.2 * dt;
      s.vel.multiplyScalar(1 - dt * 1.5); // light: the air slows it
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      // (Onto the log, if it lands on it; else the ground.)
      const onLog = Math.abs(s.mesh.position.x - 0.17) < 0.055 && Math.abs(s.mesh.position.z) < 0.11;
      const floor = onLog ? 0.115 : 0.006;
      if (s.mesh.position.y <= floor) { s.mesh.position.y = floor; s.rest = true; s.mesh.rotation.x = (Math.random() - 0.5) * 0.6; s.mesh.rotation.z = (Math.random() - 0.5) * 0.6; }
    }
  }

  private finishPass() {
    this.dropCurl();
    this.pass++;
    sfx.tick(this.pass + 2);
    if (this.pass < this.passes) {
      this.say(this.pass === 1 && this.product !== 'kindling' ? 'Bark off. Now shave it smooth.' : 'Good. Once more.', true, 1.1);
      this.makePath();
      return;
    }
    // Done: lift up what you've made.
    this.guide.visible = false;
    this.knife.visible = false;
    if (this.product === 'wooden_tongs') {
      const tongs = buildToolMesh('tongs', 'wooden_tongs');
      tongs.rotation.z = Math.PI / 2;
      tongs.position.copy(this.stick.position);
      this.stick.visible = false;
      this.work.add(tongs);
      this.finished = tongs;
    } else this.finished = this.stick;
    sfx.done();
    const perf = this.performance();
    this.say(`${itemDef(this.product).name}: ${perf > 0.85 ? 'fine work!' : perf > 0.6 ? 'good, clean work.' : perf > 0.35 ? 'rough, but it will do.' : 'crude.'}`, perf > 0.35, 2);
    this.phase = 'reveal';
    this.reveal = 0;
    this.progress = 1;
  }

  /** The finished piece is lifted and turned in the light. */
  private animateReveal(dt: number) {
    this.reveal += dt;
    const k = Math.min(1, this.reveal / 1.2), lift = k * k * (3 - 2 * k);
    const f = this.finished!;
    f.position.y = REST_Y - 0.02 + lift * 0.14;
    f.rotation.x = lift * 0.5;
    f.rotation.y = lift * 0.35;
    if (this.reveal > 1.7) { this.phase = 'done'; this.done = true; }
  }

  /** If something stands between the view and the work, swing the view round to a clear one. */
  fitView(blocked: Blocked) {
    this.camTo.copy(clearView(this.camTo, this.lookAt, blocked));
  }

  resize() { /* the game's own camera keeps its shape */ }

  dispose() {
    this.overlay.removeFromParent();
    this.overlay.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      if (!o.userData.sharedMat && !this.owned.includes(o.material as THREE.Material)) (o.material as THREE.Material).dispose();
    });
    for (const m of this.owned) m.dispose();
  }
}
