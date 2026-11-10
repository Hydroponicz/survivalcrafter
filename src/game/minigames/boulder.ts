import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boulderGeometry, type Boulder } from '../../world/groundcover';
import { clamp01, clearView, Minigame, type Blocked, type Meter, type MgInput } from './core';
import { sfx } from './sfx';
import type { Gesture } from './tutorials';

// Breaking up a boulder with a pickaxe, out in the world, on the boulder
// itself. Aim at the stone, hold the mouse button to raise the pick (the
// force), and let go to bring it down. Every blow bites a crater out of the
// stone: chips fly off and clatter down round it, dust puffs up, and a good
// blow opens dark cracks that spread across the face. Strike a crack and it
// splits deeper and faster. When it's had enough, the boulder gives way:
// it splits into chunks that fall apart, and leaves a heap of small rocks.

/** Where the boulder is, and the lie of the ground round it (for the rubble to land on). */
export interface BoulderSpot { rock: Boulder; ground: (x: number, z: number) => number }

/** The middle of the boulder's shape (at scale 1; see groundcover's rock()). */
const C0 = new THREE.Vector3(0, 0.5 * 0.68 * 0.55, 0);
/** The pick's fall (s) and its recovery. */
const DOWN = 0.12, RECOIL = 0.42;
/** The body's swing (as a share of the 'mine' clip): loose, raised to strike, and the blow. */
const IMPACT = 0.6, SLACK = 0.12, RAISED = IMPACT * 0.8;

type Phase = 'arrive' | 'work' | 'crumble' | 'done';

interface Aim { world: THREE.Vector3; normal: THREE.Vector3; local: THREE.Vector3; dir: THREE.Vector3 }
interface Bit { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; r: number; rest: boolean; landed: boolean; life?: number }
interface Spark { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }
interface Puff { mesh: THREE.Mesh; vel: THREE.Vector3; grow: number; life: number; max: number }

/** A tiny repeatable random from a vertex index (so a crater's jagged edge stays put). */
const jag = (i: number) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export class BoulderGame extends Minigame {
  readonly title = 'Breaking a boulder';
  readonly instructions = 'Aim at the boulder, hold the mouse button to raise the pickaxe, and let go to strike. Keep the force in the green band. Good blows open cracks in the stone: strike the cracks to split it faster.';
  readonly inWorld = true;
  readonly hidesPlayer = false;
  readonly overlay = new THREE.Group();
  readonly stand: { x: number; z: number; yaw: number };
  readonly workLight = new THREE.Vector3();
  private phase: Phase = 'arrive';
  private t = 0;
  private rock: Boulder;
  private ground: (x: number, z: number) => number;
  /** The stone as you work it: finely made, so each blow can bite into it. */
  private core: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  /** Each vertex's colour as it was (weathered), and fresh broken stone. */
  private outer: Float32Array;
  private fresh = new THREE.Color();
  private base = new THREE.Color();
  /** Cracks, as directions out from the middle (they follow the surface as it's broken). */
  private cracks: THREE.Vector3[][] = [];
  private crackMesh: THREE.Mesh | null = null;
  private crackMat = new THREE.MeshBasicMaterial({ color: 0x0d0a08 });
  private marker: THREE.Mesh;
  private aim: Aim | null = null;
  private onCrack = false;
  private charging = false;
  private power = 0;
  private band: [number, number];
  private swingT = -1;
  private swingFrom = SLACK;
  private pending: { power: number; aim: Aim } | null = null;
  private hp: number;
  private hp0: number;
  private crackHits = 0;
  private blows = 0;
  private bits: Bit[] = [];
  private puffs: Puff[] = [];
  private sparkList: Spark[] = [];
  private pieces: Bit[] = [];
  private shake = 0;
  private pattered = 0;
  /** The work's frame: the boulder's middle on the ground, +z toward you. */
  private work = new THREE.Group();
  private camFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private camTo = new THREE.Vector3();
  private camLook = new THREE.Quaternion();
  private lookPt = new THREE.Vector3();
  private faceAt = new THREE.Vector3();

  constructor(ease: number, spot: BoulderSpot, from: THREE.Camera) {
    super(ease);
    const b = this.rock = spot.rock;
    this.ground = spot.ground;
    this.band = [0.42, 0.8 + 0.14 * ease];
    // Bigger boulders take more breaking.
    this.hp = this.hp0 = 3 + b.sc * 4.5;

    // The stone, exactly where (and as) it lay.
    this.geo = fineRock();
    this.base.setRGB(b.color[0], b.color[1], b.color[2]);
    this.fresh.copy(this.base).multiplyScalar(1.12).add(new THREE.Color(0.025, 0.02, 0.012));
    const pos = this.geo.attributes.position;
    this.geo.computeVertexNormals();
    const nor = this.geo.attributes.normal;
    this.outer = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      // A hint of moss and lichen on top, as on every boulder.
      const up = Math.max(0, nor.getY(i));
      this.outer[i * 3] = this.base.r * (1 - up * 0.25);
      this.outer[i * 3 + 1] = this.base.g * (1 - up * 0.08);
      this.outer[i * 3 + 2] = this.base.b * (1 - up * 0.35);
    }
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.outer.slice(), 3));
    this.core = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }));
    this.core.castShadow = this.core.receiveShadow = true;
    this.core.position.set(b.x, b.y, b.z);
    this.core.rotation.set(b.tilt * Math.cos(b.yaw), b.yaw, b.tilt * Math.sin(b.yaw));
    this.core.scale.setScalar(b.sc);
    this.overlay.add(this.core);

    // Face it from where you are, standing a little to its left so the view takes in both of you.
    const toYou = new THREE.Vector3(from.position.x - b.x, 0, from.position.z - b.z);
    if (toYou.lengthSq() < 1e-4) toYou.set(0, 0, 1);
    toYou.normalize();
    const yaw = Math.atan2(toYou.x, toYou.z);
    const R = 0.5 * b.sc;
    this.work.position.set(b.x, b.y, b.z);
    this.work.rotation.y = yaw;
    this.overlay.add(this.work);
    this.overlay.updateMatrixWorld(true);
    const st = this.work.localToWorld(new THREE.Vector3(-0.42, 0, R + 0.6));
    this.stand = { x: st.x, z: st.z, yaw };
    this.faceAt.copy(this.mid());

    // Where the pick will land: a ring on the stone.
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide, fog: false }));
    this.marker.renderOrder = 9;
    this.marker.visible = false;
    this.overlay.add(this.marker);

    // Glide in: over your shoulder, a little above, the boulder big in the middle.
    this.camFrom.pos.copy(from.position);
    this.camFrom.quat.copy(from.quaternion);
    const h = 0.34 * b.sc;
    this.camTo.copy(this.work.localToWorld(new THREE.Vector3(0.55 + 0.5 * R, 0.62 + 1.1 * R, R + 0.95 + 0.9 * R)));
    const look = new THREE.PerspectiveCamera();
    look.position.copy(this.camTo);
    this.lookPt.copy(this.work.localToWorld(new THREE.Vector3(-0.08, h * 0.6, 0.05)));
    look.lookAt(this.lookPt);
    this.camLook.copy(look.quaternion);
    this.camera.position.copy(from.position);
    this.camera.quaternion.copy(from.quaternion);
    if ((from as THREE.PerspectiveCamera).fov) this.camera.fov = (from as THREE.PerspectiveCamera).fov;
    this.camera.updateProjectionMatrix();
    this.workLight.copy(this.work.localToWorld(new THREE.Vector3(0.5, 1.4, R + 0.8)));
  }

  /** The middle of the boulder, in the world. */
  private mid(): THREE.Vector3 {
    return this.core.localToWorld(C0.clone());
  }

  /** Where you stand (by the boulder), turned toward where you're striking. */
  standAt(): { x: number; z: number; face: { x: number; z: number } } {
    return { x: this.stand.x, z: this.stand.z, face: { x: this.faceAt.x, z: this.faceAt.z } };
  }

  /** Your swing: the pick hangs loose, rises as you gather force, comes down on the blow, and back. */
  bodyWork(): { clip: 'mine'; phase: number; impactAt: number } | null {
    if (this.phase !== 'work' && this.phase !== 'crumble') return null;
    if (this.swingT >= 0) {
      const t = this.swingT;
      const phase = t < DOWN ? this.swingFrom + (IMPACT - this.swingFrom) * (t / DOWN) : IMPACT + (1 - IMPACT) * Math.min(1, (t - DOWN) / RECOIL);
      return { clip: 'mine', phase, impactAt: IMPACT };
    }
    return { clip: 'mine', phase: this.charging ? this.chargePhase() : SLACK, impactAt: IMPACT };
  }

  private chargePhase() {
    return SLACK + (RAISED - SLACK) * Math.min(1, this.power / this.band[1]);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    if (this.phase !== 'work') return null;
    const at = this.aim?.world ?? this.mid();
    const p = this.toScreen(at);
    if (this.charging) {
      const [lo, hi] = this.band;
      return { x: p.x + 36, y: p.y - 40, text: this.power < lo ? 'more force…' : this.power > hi ? 'too hard!' : 'let go to strike', gesture: 'release' };
    }
    if (!this.aim) return { x: p.x + 36, y: p.y - 40, text: 'aim at the boulder', gesture: 'click' };
    if (this.onCrack) return { x: p.x + 36, y: p.y - 40, text: 'right on a crack: hold to raise the pick', gesture: 'hold' };
    return { x: p.x + 36, y: p.y - 40, text: this.cracks.length ? 'strike the cracks to split it: hold to raise the pick' : 'hold to raise the pick', gesture: 'hold' };
  }

  meters(): Meter[] {
    const [lo, hi] = this.band;
    return [
      { label: 'Force', value: this.charging ? Math.min(1, this.power / 1.15) : 0, band: [lo / 1.15, hi / 1.15], color: '#d9b26a' },
      { label: 'Cracks struck', value: this.blows ? this.crackHits / this.blows : 0, color: '#9fdc7c' },
    ];
  }

  update(dt: number, i: MgInput) {
    this.t += dt;
    this.updateBits(dt);
    this.updatePuffs(dt);
    this.updateSparks(dt);
    switch (this.phase) {
      case 'arrive': {
        const k = Math.min(1, this.t / 0.7), e = k * k * (3 - 2 * k);
        this.camera.position.lerpVectors(this.camFrom.pos, this.camTo, e);
        this.camera.quaternion.slerpQuaternions(this.camFrom.quat, this.camLook, e);
        this.camera.updateMatrixWorld();
        if (k >= 1) { this.phase = 'work'; this.t = 0; }
        return;
      }
      case 'work':
        this.placeCamera(dt);
        this.strike(dt, i);
        return;
      case 'crumble':
        this.placeCamera(dt);
        this.swing(dt);
        this.crumbling(dt);
        return;
      case 'done':
        this.placeCamera(dt);
        return;
    }
  }

  /** The view, with a kick on each blow that dies away. */
  private placeCamera(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 0.12);
    const s = this.shake;
    this.camera.position.copy(this.camTo).add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    this.camera.quaternion.copy(this.camLook);
    this.camera.updateMatrixWorld();
  }

  private strike(dt: number, i: MgInput) {
    // What the pointer's on (while the pick's coming down, the blow is already aimed).
    if (this.swingT < 0) {
      this.aim = this.pick(i.ndc);
      this.onCrack = !!this.aim && this.nearCrack(this.aim.dir) >= 0;
    }
    if (this.aim) this.faceAt.copy(this.aim.world);
    // The ring on the stone: gold over a crack, and tightening as you gather force.
    this.marker.visible = !!this.aim && this.swingT < 0;
    if (this.aim) {
      this.marker.position.copy(this.aim.world).addScaledVector(this.aim.normal, 0.01);
      this.marker.lookAt(this.marker.position.clone().add(this.aim.normal));
      const k = this.charging ? Math.min(1, this.power / this.band[1]) : 0;
      this.marker.scale.setScalar((0.07 - 0.035 * k) * (1 + Math.sin(this.time * 6) * 0.06));
      const m = this.marker.material as THREE.MeshBasicMaterial;
      const [lo, hi] = this.band;
      m.color.set(this.charging ? (this.power > hi ? 0xff7a5a : this.power >= lo ? 0x9fdc7c : 0xffffff) : this.onCrack ? 0xffd36a : 0xffffff);
    }
    // Hold to raise the pick; let go to bring it down.
    if (this.swingT < 0 && i.pressed && this.aim) { this.charging = true; this.power = 0; }
    if (this.charging) {
      this.power = Math.min(1.15, this.power + dt * (0.75 + 0.15 * this.ease));
      if (i.released || !i.down) {
        this.charging = false;
        if (!this.aim) { this.say('Aim at the boulder.', false, 0.7); return; }
        this.swingFrom = this.chargePhase();
        this.pending = { power: this.power, aim: this.aim };
        this.swingT = 0;
        this.marker.visible = false;
      }
    } else if (i.pressed && !this.aim && this.swingT < 0) this.say('Aim at the boulder.', false, 0.6);
    this.swing(dt);
  }

  private swing(dt: number) {
    if (this.swingT < 0) return;
    this.swingT += dt;
    if (this.swingT >= DOWN && this.pending) { const p = this.pending; this.pending = null; this.land(p.power, p.aim); }
    if (this.swingT >= DOWN + RECOIL) this.swingT = -1;
  }

  /** The point on the stone under the pointer. */
  private pick(ndc: THREE.Vector2): Aim | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.core, false)[0];
    if (!hit || !hit.face) return null;
    const normal = hit.face.normal.clone().transformDirection(this.core.matrixWorld);
    const local = this.core.worldToLocal(hit.point.clone());
    return { world: hit.point.clone(), normal, local, dir: local.clone().sub(C0).normalize() };
  }

  /** The blow lands. */
  private land(power: number, aim: Aim) {
    const [lo, hi] = this.band;
    const crack = this.nearCrack(aim.dir);
    let q: number, dmg: number;
    this.blows++;
    if (power < lo) {
      q = 0.25 + 0.3 * (power / lo); dmg = 0.25;
      this.say('Too light: it only scuffs the stone.', false, 0.8);
    } else if (power > hi) {
      q = 0.35; dmg = 0.45;
      this.say('Too hard! The pick glances off.', false, 0.8);
      sfx.clink();
      this.sparks(aim.world, aim.normal);
    } else {
      const mid = (lo + hi) / 2, half = (hi - lo) / 2;
      q = 0.8 + 0.2 * (1 - Math.abs(power - mid) / half);
      dmg = 1;
    }
    if (crack >= 0 && power >= lo) {
      dmg *= 1.9; q = Math.min(1, q + 0.1);
      this.crackHits++;
      if (power <= hi) this.say(this.crackHits > 2 ? 'Into the crack — it\'s splitting!' : 'Into the crack!', true, 0.8);
    } else if (power >= lo && power <= hi) this.say(q > 0.93 ? 'A solid blow!' : 'Good blow.', true, 0.6);
    this.sample(q, 1);
    this.hp -= dmg;
    this.progress = clamp01(1 - this.hp / this.hp0);

    // The stone gives: a crater, chips and dust, and the cracks run.
    this.crater(aim.local, dmg);
    const n = Math.round(1 + dmg * 3 + Math.random() * 2);
    for (let k = 0; k < n; k++) this.chip(aim.world, aim.normal, 0.022 + Math.random() * 0.035 * Math.min(1.6, dmg), 1);
    this.dust(aim.world, aim.normal, 0.6 + dmg * 0.5);
    if (power >= lo) {
      if (crack >= 0) this.extendCrack(crack, 0.14 + 0.1 * dmg);
      const branches = crack >= 0 ? 2 : 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < branches; k++) this.newCrack(aim.dir, 0.16 + 0.12 * Math.min(2, dmg));
      this.drawCracks();
    }
    this.shake = Math.min(0.06, 0.012 + 0.016 * dmg);
    if (power <= hi) sfx.crack(Math.min(1.5, dmg));
    if (this.hp <= 0) this.beginCrumble();
  }

  /** A bite out of the stone where the pick went in: jagged, paler fresh stone inside. */
  private crater(at: THREE.Vector3, dmg: number) {
    const sc = this.rock.sc, pos = this.geo.attributes.position, col = this.geo.attributes.color as THREE.BufferAttribute;
    const rc = (0.07 + 0.05 * Math.min(2, dmg)) / sc, depth = (0.02 + 0.022 * Math.min(2, dmg)) / sc;
    const v = new THREE.Vector3(), out = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const d = v.distanceTo(at);
      if (d >= rc) continue;
      const f = (1 - d / rc) ** 2;
      out.copy(v).sub(C0);
      const r = out.length();
      const push = Math.min(depth * f * (0.6 + 0.8 * jag(i)), Math.max(0, r - 0.09));
      v.addScaledVector(out.normalize(), -push);
      pos.setXYZ(i, v.x, v.y, v.z);
      // Fresh stone shows where it's broken.
      const k = Math.min(1, f * 1.6);
      col.setXYZ(i, col.getX(i) + (this.fresh.r - col.getX(i)) * k, col.getY(i) + (this.fresh.g - col.getY(i)) * k, col.getZ(i) + (this.fresh.b - col.getZ(i)) * k);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.geo.computeBoundingBox();
  }

  // ---------- cracks
  /** The crack (index) near a direction from the middle, if any. */
  private nearCrack(dir: THREE.Vector3): number {
    const lim = Math.cos(0.17);
    for (let c = 0; c < this.cracks.length; c++) for (const p of this.cracks[c]) if (p.dot(dir) > lim) return c;
    return -1;
  }

  /** A crack starting from a direction, wandering across the surface for about `len` radians. */
  private newCrack(from: THREE.Vector3, len: number) {
    const pts = [from.clone()];
    const t = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5);
    t.addScaledVector(from, -t.dot(from)).normalize();
    this.cracks.push(pts);
    this.grow(pts, t, len);
  }

  private extendCrack(c: number, len: number) {
    const pts = this.cracks[c];
    if (pts.length < 2) return;
    // Out from both ends.
    for (const end of [0, 1]) {
      const a = end ? pts[pts.length - 1] : pts[0], b = end ? pts[pts.length - 2] : pts[1];
      const t = a.clone().sub(b);
      t.addScaledVector(a, -t.dot(a)).normalize();
      if (end) this.grow(pts, t, len);
      else { const rev: THREE.Vector3[] = [a.clone()]; this.grow(rev, t, len); rev.shift(); pts.unshift(...rev.reverse()); }
    }
  }

  private grow(pts: THREE.Vector3[], t: THREE.Vector3, len: number) {
    const step = 0.035;
    let d = pts[pts.length - 1].clone();
    for (let s = 0; s < len / step; s++) {
      // A jagged, wandering line.
      const side = new THREE.Vector3().crossVectors(d, t).normalize();
      t.addScaledVector(side, (Math.random() - 0.5) * 0.9).normalize();
      d = d.clone().addScaledVector(t, step).normalize();
      t.addScaledVector(d, -t.dot(d)).normalize();
      pts.push(d);
    }
  }

  /** How far out the surface is in a direction from the middle (as it is now, craters and all). */
  private surfaceAt(dir: THREE.Vector3): THREE.Vector3 {
    const pos = this.geo.attributes.position, v = new THREE.Vector3();
    let best = -2, r = 0.3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).sub(C0);
      const l = v.length(), c = v.dot(dir) / (l || 1);
      if (c > best) { best = c; r = l; }
    }
    return C0.clone().addScaledVector(dir, r * 1.012);
  }

  /** The cracks drawn as dark seams on the stone. */
  private drawCracks() {
    if (this.crackMesh) { this.core.remove(this.crackMesh); this.crackMesh.geometry.dispose(); this.crackMesh = null; }
    const parts: THREE.BufferGeometry[] = [];
    const w = 0.008 / this.rock.sc;
    for (const c of this.cracks) {
      if (c.length < 2) continue;
      const pts = c.map((d) => this.surfaceAt(d));
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, w, 3, false));
    }
    if (!parts.length) return;
    // (A handful of tubes: one mesh is plenty.)
    const merged = mergeTubes(parts);
    this.crackMesh = new THREE.Mesh(merged, this.crackMat);
    this.core.add(this.crackMesh);
  }

  // ---------- the stone gives way
  private beginCrumble() {
    this.phase = 'crumble';
    this.t = 0;
    this.marker.visible = false;
    // Cracks race across it.
    for (let k = 0; k < 5; k++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize();
      this.newCrack(d, 0.5 + Math.random() * 0.4);
    }
    this.drawCracks();
    this.shake = 0.05;
    this.say('It\'s giving way…', true, 0.8);
  }

  private crumbling(dt: number) {
    if (this.t < 0.28) {
      // A shudder before it goes.
      this.core.position.set(this.rock.x + (Math.random() - 0.5) * 0.012, this.rock.y, this.rock.z + (Math.random() - 0.5) * 0.012);
      return;
    }
    if (this.core.visible) this.split();
    void dt;
    if (this.t > 1.9 && !this.done) {
      this.phase = 'done';
      sfx.done();
      const perf = this.performance();
      this.say(perf > 0.85 ? 'Broken up clean: a good heap of rocks.' : perf > 0.55 ? 'The boulder\'s broken up.' : 'Broken up, roughly: a lot of it went to grit.', perf > 0.4, 1.3);
      this.progress = 1;
      this.done = true;
    }
  }

  /** Split the boulder into chunks (whole pieces of it, fresh stone on their broken faces), and let them fall apart. */
  private split() {
    this.core.visible = false;
    this.core.updateMatrixWorld(true);
    const sc = this.rock.sc, pos = this.geo.attributes.position, col = this.geo.attributes.color;
    const K = 4 + Math.round(sc * 2.5);
    // Seeds spread round it, and every bit of the surface goes with the nearest.
    const seeds: THREE.Vector3[] = [];
    for (let k = 0; k < K; k++) {
      const y = 1 - (k + 0.5) / K * 1.6, r = Math.sqrt(Math.max(0, 1 - y * y)), a = k * 2.399963 + Math.random() * 0.5;
      seeds.push(C0.clone().add(new THREE.Vector3(Math.cos(a) * r, y * 0.6, Math.sin(a) * r).multiplyScalar(0.26)));
    }
    const groups: THREE.Vector3[][] = seeds.map(() => []);
    const cols: THREE.Color[] = seeds.map(() => new THREE.Color(0, 0, 0));
    const counts = seeds.map(() => 0);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const d = v.distanceToSquared(seeds[k]); if (d < bd) { bd = d; best = k; } }
      groups[best].push(v.clone());
      cols[best].r += col.getX(i); cols[best].g += col.getY(i); cols[best].b += col.getZ(i);
      counts[best]++;
    }
    const centre = this.mid();
    for (let k = 0; k < K; k++) {
      if (groups[k].length < 6) continue;
      const inner = C0.clone().lerp(seeds[k], 0.15);
      const geo = new ConvexGeometry([...groups[k], inner, C0.clone()]);
      const outerCol = cols[k].multiplyScalar(1 / counts[k]);
      paintPiece(geo, inner, this.fresh, outerCol);
      // Centred on itself, to tumble about its own middle.
      geo.computeBoundingBox();
      const c = geo.boundingBox!.getCenter(new THREE.Vector3());
      geo.translate(-c.x, -c.y, -c.z);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.copy(this.core.localToWorld(c.clone()));
      mesh.quaternion.copy(this.core.quaternion);
      mesh.scale.setScalar(sc);
      this.overlay.add(mesh);
      const out = mesh.position.clone().sub(centre).setY(0);
      if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize();
      const r = geo.boundingSphere!.radius * sc;
      this.pieces.push({
        mesh, r: r * 0.55, rest: false, landed: false,
        vel: out.multiplyScalar(1.3 + Math.random() * 0.9).setY(1 + Math.random() * 0.8),
        spin: new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 5),
      });
    }
    // And a spray of rubble and a cloud of dust.
    const up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < 14 + sc * 8; k++) this.chip(centre.clone().add(new THREE.Vector3((Math.random() - 0.5) * sc * 0.5, Math.random() * sc * 0.2, (Math.random() - 0.5) * sc * 0.5)), up, 0.025 + Math.random() * 0.045, 0.8);
    for (let k = 0; k < 5; k++) this.dust(centre.clone().add(new THREE.Vector3((Math.random() - 0.5) * sc * 0.6, 0, (Math.random() - 0.5) * sc * 0.6)), up, 1.4 + sc);
    this.shake = 0.07;
    sfx.crumble();
  }

  // ---------- chips, chunks and dust
  /** A chip of stone flying off the blow, to bounce and lie on the ground. */
  private chip(at: THREE.Vector3, normal: THREE.Vector3, size: number, speed: number) {
    const geo = new THREE.DodecahedronGeometry(size, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.7 + jag(i + this.bits.length * 7) * 0.6), p.getY(i) * (0.55 + jag(i * 3 + 1) * 0.5), p.getZ(i) * (0.7 + jag(i * 5 + 2) * 0.6));
    geo.computeVertexNormals();
    // Weathered on one side, fresh on the broken faces.
    const c = new Float32Array(p.count * 3), w = this.base.clone().multiplyScalar(0.78), f = this.fresh.clone().multiplyScalar(0.88);
    for (let i = 0; i < p.count; i += 3) {
      const col = jag(i + size * 1000) < 0.6 ? w : f;
      for (let k = 0; k < 3; k++) col.toArray(c, (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    mesh.castShadow = true;
    mesh.position.copy(at).addScaledVector(normal, 0.03);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.overlay.add(mesh);
    const side = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(0.9);
    const vel = normal.clone().setY(Math.max(0, normal.y)).normalize().multiplyScalar((0.7 + Math.random() * 0.9) * speed).add(side).add(new THREE.Vector3(0, 0.8 + Math.random() * 1.3, 0));
    this.bits.push({ mesh, vel, spin: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18), r: size * 0.6, rest: false, landed: false });
    // (Only so many lie about: the oldest are swept away.)
    while (this.bits.length > 90) { const old = this.bits.shift()!; this.overlay.remove(old.mesh); old.mesh.geometry.dispose(); (old.mesh.material as THREE.Material).dispose(); }
  }

  private updateBits(dt: number) {
    this.pattered = Math.max(0, this.pattered - dt);
    for (const b of [...this.bits, ...this.pieces]) {
      if (b.rest) continue;
      b.vel.y -= 9.8 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.y += b.spin.y * dt; b.mesh.rotation.z += b.spin.z * dt;
      const g = this.ground(b.mesh.position.x, b.mesh.position.z) + b.r;
      if (b.mesh.position.y < g) {
        b.mesh.position.y = g;
        if (!b.landed && this.pattered <= 0) { sfx.patter(); this.pattered = 0.04; }
        b.landed = true;
        if (Math.abs(b.vel.y) < 0.6) { b.rest = true; continue; }
        // A bounce, losing most of it to the ground.
        b.vel.y = -b.vel.y * 0.32;
        b.vel.x *= 0.55; b.vel.z *= 0.55;
        b.spin.multiplyScalar(0.5);
      }
    }
  }

  /** A puff of rock dust. */
  private dust(at: THREE.Vector3, normal: THREE.Vector3, size: number) {
    for (let k = 0; k < 3; k++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: this.base.clone().lerp(new THREE.Color(0.42, 0.38, 0.32), 0.5), transparent: true, opacity: 0.2, depthWrite: false, roughness: 1 }));
      mesh.position.copy(at).addScaledVector(normal, 0.05);
      mesh.scale.setScalar(0.04);
      this.overlay.add(mesh);
      const vel = normal.clone().multiplyScalar(0.35 + Math.random() * 0.3).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3));
      this.puffs.push({ mesh, vel, grow: (0.1 + Math.random() * 0.08) * size, life: 0, max: 0.9 + Math.random() * 0.6 });
    }
  }

  private updatePuffs(dt: number) {
    for (const p of [...this.puffs]) {
      p.life += dt;
      const k = p.life / p.max;
      p.vel.multiplyScalar(1 - dt * 2.2);
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(0.04 + p.grow * Math.sqrt(k));
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = 0.2 * (1 - k) * Math.min(1, k * 6);
      if (k >= 1) { this.overlay.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); this.puffs.splice(this.puffs.indexOf(p), 1); }
    }
  }

  /** Sparks off a glancing blow. */
  private sparks(at: THREE.Vector3, normal: THREE.Vector3) {
    for (let k = 0; k < 9; k++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.03), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, fog: false }));
      mesh.position.copy(at).addScaledVector(normal, 0.02);
      this.overlay.add(mesh);
      const vel = normal.clone().multiplyScalar(1.5 + Math.random() * 1.5).add(new THREE.Vector3((Math.random() - 0.5) * 2.4, Math.random() * 1.8, (Math.random() - 0.5) * 2.4));
      this.sparkList.push({ mesh, vel, life: 0.25 + Math.random() * 0.25 });
    }
  }

  private updateSparks(dt: number) {
    for (const s of [...this.sparkList]) {
      s.life -= dt;
      s.vel.y -= 6 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.lookAt(s.mesh.position.clone().add(s.vel));
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, s.life * 5);
      if (s.life <= 0) { this.overlay.remove(s.mesh); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); this.sparkList.splice(this.sparkList.indexOf(s), 1); }
    }
  }

  /** If something stands between the view and the work, swing the view round to a clear one. */
  fitView(blocked: Blocked) {
    this.camTo.copy(clearView(this.camTo, this.lookPt, blocked));
    const look = new THREE.PerspectiveCamera();
    look.position.copy(this.camTo);
    look.lookAt(this.lookPt);
    this.camLook.copy(look.quaternion);
  }

  resize() { /* the game's own camera keeps its shape */ }

  dispose() {
    this.overlay.removeFromParent();
    this.overlay.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    this.crackMat.dispose();
  }
}

/** The boulder's shape made fine (so blows can bite into it), true to the coarse one drawn in the world. */
function fineRock(): THREE.BufferGeometry {
  const coarse = boulderGeometry();
  const probe = new THREE.Mesh(coarse, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  probe.updateMatrixWorld(true);
  const ico = new THREE.IcosahedronGeometry(1, 4);
  ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
  const fine = mergeVertices(ico);
  const pos = fine.attributes.position, ray = new THREE.Raycaster(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    ray.set(C0, d);
    const hit = ray.intersectObject(probe, false)[0];
    const r = hit ? hit.distance : 0.35;
    pos.setXYZ(i, C0.x + d.x * r, C0.y + d.y * r, C0.z + d.z * r);
  }
  coarse.dispose();
  (probe.material as THREE.Material).dispose();
  return fine;
}

/** A chunk's colours: fresh pale stone on its broken (inner) faces, weathered outside. */
function paintPiece(geo: THREE.BufferGeometry, inner: THREE.Vector3, fresh: THREE.Color, outer: THREE.Color) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    let broken = false;
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, i + k); if (v.distanceTo(inner) < 1e-4 || v.distanceTo(C0) < 1e-4) broken = true; }
    const col = broken ? fresh : outer;
    for (let k = 0; k < 3; k++) col.toArray(c, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

/** Several tubes as one geometry. */
function mergeTubes(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3, p = g.attributes.position;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
