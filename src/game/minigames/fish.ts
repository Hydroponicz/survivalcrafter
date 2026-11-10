import * as THREE from 'three';
import { whichFish, type FishDef } from '../../data/fish';
import { clamp01, clearView, Minigame, type Blocked, type Meter, type MgInput } from './core';
import { sfx } from './sfx';
import type { Gesture } from './tutorials';

// Fishing, out in the world, from wherever you stand at the water's edge (or
// off the end of a jetty). Hold the button to swing the rod back and let go to
// cast; the mouse aims left and right. The float bobs where it lands. Fish
// nibble (the float twitches: leave it) and then one takes the bait: the float
// is pulled right under, and you have a moment to strike. Then the fight: hold
// to reel in, keeping the line's tension in the green; ease off when the fish
// runs or the line snaps, and pull the rod against its runs (the mouse, the
// other way) to turn it. Let it go slack too long and the hook shakes loose.
// Bring it in and it's yours, and you can cast again. You fish until you stop.
//
// A fine rod casts further, fish bite sooner, its line holds a heavier fish
// and the tension it bears is wider, it reels in faster, and sometimes it
// brings in two from a shoal at once.

export interface FishSpot {
  /** Where you stand, and the water you aimed at. */
  from: { x: number; y: number; z: number };
  toward: { x: number; z: number };
  fine: boolean;
  /** The water at a spot: its surface, depth, and whether it's the sea (null: dry land). */
  water: (x: number, z: number) => { surface: number; depth: number; sea: boolean } | null;
  /** The ground's height (where a cast that misses the water lands). */
  ground: (x: number, z: number) => number;
  dayFraction: () => number;
  /** The tip of the rod in your hands (the line runs from it), if it can be found. */
  rodTip: () => THREE.Vector3 | null;
  /** How much room there is (m) between the line from a to b and the nearest tree trunk: the view looks past them. */
  clearance?: (a: THREE.Vector3, b: THREE.Vector3) => number;
  /** Your fishing skill (1..100): bites come sooner. */
  skill: number;
  /** A fish landed: how heavy, how well you played it (0..1), and how long the whole catch took. */
  onCatch: (c: { fish: FishDef; kg: number; quality: number; seconds: number }) => void;
}

type Phase = 'arrive' | 'ready' | 'flight' | 'wait' | 'bite' | 'fight' | 'landed' | 'reelin';

/** The swing (a share of the 'chop' clip): the rod out over the water, raised back to cast. */
const OUT = 0.6, BACK = 0.3;

export class FishGame extends Minigame {
  get title() { return this.caught ? `Fishing — ${this.caught} caught` : 'Fishing'; }
  readonly instructions = 'Hold the mouse button to swing the rod back, and let go to cast (move the mouse to aim). Wait for a bite: when the float is pulled right under, click to strike. Then hold to reel in, keeping the tension in the green; let go when it gets too tight, and move the mouse against the fish\'s runs.';
  readonly inWorld = true;
  readonly hidesPlayer = false;
  readonly overlay = new THREE.Group();
  readonly stand: { x: number; z: number; yaw: number };
  readonly workLight = new THREE.Vector3();
  private phase: Phase = 'arrive';
  private t = 0;
  private spot: FishSpot;
  private dir = new THREE.Vector3();
  private right = new THREE.Vector3();
  private camFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private camTo = new THREE.Vector3();
  private camLook = new THREE.Quaternion();
  private lookPt = new THREE.Vector3();
  private maxCast: number;
  // The cast.
  private power = 0;
  private holdT = 0;
  private charging = false;
  private aimMark: THREE.Mesh;
  private flightFrom = new THREE.Vector3();
  private flightTo = new THREE.Vector3();
  private flightT = 0;
  private flightDur = 0.6;
  // The float, the line, the fish.
  private bobber: THREE.Group;
  private line: THREE.Line;
  private linePts = new Float32Array(24 * 3);
  private here: { surface: number; depth: number; sea: boolean } | null = null;
  private waitT = 0;
  private nibbles: number[] = [];
  private biteT = 0;
  private biteWindow: number;
  private fish: { def: FishDef; kg: number; pos: THREE.Vector3; stamina: number; surge: number; surgeT: number; start: number; inBand: number; total: number; slack: number; hooked: number } | null = null;
  private shadow: THREE.Mesh;
  private tension = 0;
  private band: [number, number];
  private snapAt: number;
  private caught = 0;
  private hanging: { mesh: THREE.Group; t: number; info: { fish: FishDef; kg: number; quality: number; seconds: number }; twin: boolean } | null = null;
  private rings: { mesh: THREE.Mesh; t: number; max: number; size: number }[] = [];
  private drops: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  private reelTick = 0;
  private reelFrom = new THREE.Vector3();

  constructor(ease: number, spot: FishSpot, from: THREE.Camera) {
    super(ease);
    this.spot = spot;
    this.maxCast = spot.fine ? 14 : 9;
    this.band = [0.3, 0.8 + 0.06 * ease + (spot.fine ? 0.07 : 0)];
    this.snapAt = (spot.fine ? 1.15 : 1.0) + 0.04 * ease;
    this.biteWindow = 0.5 + 0.35 * ease + (spot.fine ? 0.12 : 0);
    this.dir.set(spot.toward.x - spot.from.x, 0, spot.toward.z - spot.from.z);
    if (this.dir.lengthSq() < 1e-4) this.dir.set(0, 0, 1);
    this.dir.normalize();
    this.right.set(-this.dir.z, 0, this.dir.x);
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    this.stand = { x: spot.from.x, z: spot.from.z, yaw };

    // The float: red over white, a quill through it.
    this.bobber = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc8402a, roughness: 0.6 }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.6 }));
    const quill = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 5), new THREE.MeshStandardMaterial({ color: 0xe8e0c8 }));
    quill.position.y = 0.02;
    this.bobber.add(top, bot, quill);
    this.bobber.visible = false;
    this.overlay.add(this.bobber);
    // The line, from the rod tip.
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePts, 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xece4d0, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.overlay.add(this.line);
    // A fish under the water: a dark shape.
    this.shadow = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6).scale(0.5, 0.1, 1), new THREE.MeshBasicMaterial({ color: 0x0c1418, transparent: true, opacity: 0.55, depthWrite: false }));
    this.shadow.visible = false;
    this.overlay.add(this.shadow);
    // Where the cast would land.
    this.aimMark = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, fog: false }));
    this.aimMark.visible = false;
    this.overlay.add(this.aimMark);

    // The view: over your shoulder, out across the water.
    const f = spot.from, up = new THREE.Vector3(0, 1, 0);
    // Over the right shoulder; or the left, or higher and further back, if a tree's in the way.
    const head = new THREE.Vector3(f.x, f.y + 1.6, f.z);
    const views: [number, number, number][] = [[1.85, -2.3, 0.75], [1.85, -2.3, -0.75], [2.6, -3.2, 0.3], [1.7, -1.4, 1.2], [1.7, -1.4, -1.2], [1.8, -0.5, 2.1], [1.8, -0.5, -2.1], [2.3, 0.4, 2.7], [2.3, 0.4, -2.7]];
    const at = (v: [number, number, number]) => new THREE.Vector3(f.x, f.y, f.z).addScaledVector(up, v[0]).addScaledVector(this.dir, v[1]).addScaledVector(this.right, v[2]);
    const ahead = head.clone().addScaledVector(this.dir, 4).addScaledVector(up, -0.6);
    const room = (v: [number, number, number]) => Math.min(spot.clearance?.(at(v), head) ?? 9, spot.clearance?.(at(v), ahead) ?? 9);
    const clear = views.find((v) => room(v) > 0.6) ?? views.reduce((a, b) => (room(b) > room(a) ? b : a));
    this.camTo.copy(at(clear));
    const w = spot.water(spot.toward.x, spot.toward.z);
    const lookAt = new THREE.Vector3(f.x, f.y, f.z).addScaledVector(this.dir, 7.5);
    lookAt.y = (w?.surface ?? f.y - 0.5) + 0.2;
    const look = new THREE.PerspectiveCamera();
    look.position.copy(this.camTo);
    look.lookAt(lookAt);
    this.camLook.copy(look.quaternion);
    this.lookPt.copy(lookAt);
    this.camFrom.pos.copy(from.position);
    this.camFrom.quat.copy(from.quaternion);
    this.camera.position.copy(from.position);
    this.camera.quaternion.copy(from.quaternion);
    if ((from as THREE.PerspectiveCamera).fov) this.camera.fov = (from as THREE.PerspectiveCamera).fov;
    this.camera.updateProjectionMatrix();
    this.workLight.set(f.x, f.y + 1.6, f.z).addScaledVector(this.dir, 1.2);
  }

  /** You stand where you are, turned to the water (toward the float, once it's out). */
  standAt(): { x: number; z: number; face: { x: number; z: number } } {
    const p = this.bobber.visible ? this.bobber.position : new THREE.Vector3(this.spot.toward.x, 0, this.spot.toward.z);
    return { x: this.stand.x, z: this.stand.z, face: { x: p.x, z: p.z } };
  }

  /** The rod in your hands: swung back as you gather the cast, out over the water as you fish, pumping as you play a fish. */
  bodyWork(): { clip: 'chop'; phase: number; impactAt: number } | null {
    if (this.phase === 'arrive') return null;
    let phase = OUT + 0.04;
    if (this.charging) phase = OUT - (OUT - BACK) * Math.min(1, this.power * 1.1);
    else if (this.phase === 'flight') phase = OUT + 0.06 * (1 - Math.min(1, this.flightT / 0.2));
    else if (this.phase === 'fight') phase = OUT + 0.08 + Math.sin(this.time * (this.tension > 0.4 ? 9 : 3)) * 0.03 * (0.5 + this.tension);
    else if (this.phase === 'bite') phase = OUT + 0.06;
    return { clip: 'chop', phase, impactAt: OUT };
  }

  private tip(): THREE.Vector3 {
    const f = this.spot.from;
    return this.spot.rodTip() ?? new THREE.Vector3(f.x, f.y + 1.7, f.z).addScaledVector(this.dir, 1.8).addScaledVector(this.right, 0.25);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    const at = this.bobber.visible ? this.bobber.position : this.aimMark.visible ? this.aimMark.position : this.tip();
    const p = this.toScreen(at);
    const x = Math.min(window.innerWidth - 260, p.x + 30), y = Math.max(140, p.y - 60);
    switch (this.phase) {
      case 'ready': return { x, y, text: this.charging ? (this.power > 0.92 ? 'let go to cast!' : 'let go to cast (the longer, the further)') : 'hold to swing the rod back · move the mouse to aim', gesture: this.charging ? 'release' : 'hold' };
      case 'wait': return { x, y, text: this.nibbles.length && this.waitT - this.nibbles[0] < 0.3 ? 'a nibble… not yet!' : 'wait: strike only when the float is pulled under', gesture: 'wait' };
      case 'bite': return { x, y, text: 'NOW! click to strike', gesture: 'click' };
      case 'fight': {
        const [lo, hi] = this.band, f = this.fish!;
        const away = f.surge !== 0 && this.counterNeeded();
        return { x, y, text: this.tension > hi ? 'too tight — let go!' : this.tension < lo ? 'hold to reel in' : away ? `it's running ${f.surge > 0 ? 'right' : 'left'}: move the mouse ${f.surge > 0 ? 'left' : 'right'}` : 'keep reeling', gesture: this.tension > hi ? 'release' : 'hold' };
      }
      default: return null;
    }
  }

  meters(): Meter[] {
    if (this.phase === 'fight' && this.fish) {
      const [lo, hi] = this.band;
      return [
        { label: 'Tension', value: this.tension / this.snapAt, band: [lo / this.snapAt, hi / this.snapAt], color: this.tension > hi ? '#e8664a' : '#d9b26a' },
        { label: 'Fish\'s strength', value: this.fish.stamina, color: '#7ab0d8' },
      ];
    }
    return [{ label: 'Cast', value: this.charging ? this.power : 0, color: '#d9b26a' }];
  }

  update(dt: number, i: MgInput) {
    this.t += dt;
    this.updateRings(dt);
    this.updateDrops(dt);
    if (this.phase === 'arrive') {
      const k = Math.min(1, this.t / 0.8), e = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(this.camFrom.pos, this.camTo, e);
      this.camera.quaternion.slerpQuaternions(this.camFrom.quat, this.camLook, e);
      this.camera.updateMatrixWorld();
      if (k >= 1) this.toPhase('ready');
      return;
    }
    this.camera.position.copy(this.camTo);
    this.camera.quaternion.copy(this.camLook);
    this.camera.updateMatrixWorld();
    switch (this.phase) {
      case 'ready': this.ready(dt, i); break;
      case 'flight': this.flight(dt); break;
      case 'wait': this.wait(dt, i); break;
      case 'bite': this.bite(dt, i); break;
      case 'fight': this.fight(dt, i); break;
      case 'landed': this.landed(dt); break;
      case 'reelin': this.reelIn(dt); break;
    }
    this.drawLine();
  }

  private toPhase(p: Phase) { this.phase = p; this.t = 0; }

  // ---------- the cast
  private castDir(i: MgInput): THREE.Vector3 {
    const a = Math.max(-0.6, Math.min(0.6, (i.x / window.innerWidth - 0.5) * 1.5));
    return this.dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(this.right, Math.sin(a)).normalize();
  }

  private ready(dt: number, i: MgInput) {
    this.bobber.visible = false;
    if (!this.charging && i.pressed) { this.charging = true; this.holdT = 0; }
    if (this.charging) {
      // Swung back and forth: let go at the top of the swing for the longest cast.
      this.holdT += dt;
      const c = (this.holdT * 0.75) % 2;
      this.power = c < 1 ? c : 2 - c;
    }
    // Where it would land.
    const d = this.castDir(i), dist = 2 + (this.charging ? this.power : 0.5) * (this.maxCast - 2);
    const f = this.spot.from;
    const tx = f.x + d.x * dist, tz = f.z + d.z * dist, w = this.spot.water(tx, tz);
    this.aimMark.visible = true;
    this.aimMark.position.set(tx, (w?.surface ?? f.y) + 0.03, tz);
    this.aimMark.scale.setScalar(this.charging ? 0.35 : 0.25);
    (this.aimMark.material as THREE.MeshBasicMaterial).color.set(w && w.depth > 0.15 ? 0xffffff : 0xff7a5a);
    if (this.charging && (i.released || !i.down)) {
      this.charging = false;
      this.aimMark.visible = false;
      this.flightFrom.copy(this.tip());
      this.flightTo.set(tx, (w?.surface ?? this.spot.ground(tx, tz)) + 0.01, tz);
      this.here = w && w.depth > 0.15 ? w : null;
      this.flightDur = 0.45 + this.power * 0.45;
      this.bobber.visible = true;
      this.line.visible = true;
      sfx.slice(0.6 + this.power);
      this.toPhase('flight');
    }
  }

  private flight(dt: number) {
    this.flightT = this.t;
    const k = Math.min(1, this.t / this.flightDur);
    const p = this.flightFrom.clone().lerp(this.flightTo, k);
    p.y += Math.sin(k * Math.PI) * (1 + this.flightDur * 2.5);
    this.bobber.position.copy(p);
    void dt;
    if (k < 1) return;
    if (!this.here) {
      this.say('That landed on the bank. Reel in and cast onto the water.', false, 1.2);
      this.startReelIn();
      return;
    }
    sfx.splash(0.35);
    this.ring(this.flightTo, 0.5);
    // How long till a fish takes it: sooner with a fine rod, skill, at dawn and dusk, in deeper water.
    const when = this.spot.dayFraction(), tw = (when > 0.2 && when < 0.3) || (when > 0.72 && when < 0.82);
    const depth = this.here.depth;
    let wait = 5 + Math.random() * 8;
    wait *= this.spot.fine ? 0.6 : 1;
    wait *= tw ? 0.7 : 1;
    wait *= depth < 0.5 ? 1.6 : depth > 2.5 ? 0.8 : 1;
    wait *= 1 - Math.min(0.4, this.spot.skill / 200);
    this.waitT = 0;
    this.biteT = wait;
    // A nibble or three first, to keep you honest.
    const n = Math.floor(Math.random() * 3.5);
    this.nibbles = Array.from({ length: n }, () => 1 + Math.random() * Math.max(0.5, wait - 1.6)).sort((a, b) => a - b);
    this.toPhase('wait');
  }

  // ---------- waiting for a bite
  private wait(dt: number, i: MgInput) {
    this.waitT += dt;
    const base = this.here!.surface;
    // Bobbing on the water, and a twitch at each nibble.
    let dip = Math.sin(this.time * 2.2) * 0.008;
    for (const n of this.nibbles) { const s = this.waitT - n; if (s > 0 && s < 0.3) dip -= Math.sin((s / 0.3) * Math.PI) * 0.03; }
    if (this.nibbles.length && this.waitT > this.nibbles[0] + 0.3) {
      this.nibbles.shift();
    } else if (this.nibbles.length && Math.abs(this.waitT - this.nibbles[0]) < dt) { this.ring(this.bobber.position, 0.18); sfx.curl(); }
    this.bobber.position.y = base + 0.005 + dip;
    if (i.pressed) {
      // Struck too soon: the fish is spooked off, and it'll be a while.
      this.say('Too soon: you snatched the bait away and spooked it.', false, 1.2);
      this.bobber.position.addScaledVector(this.towardYou(this.bobber.position), 0.5);
      this.ring(this.bobber.position, 0.25);
      this.biteT = this.waitT + 4 + Math.random() * 5;
      this.nibbles = [];
      return;
    }
    if (this.waitT >= this.biteT) {
      sfx.plop();
      sfx.splash(0.6);
      this.ring(this.bobber.position, 0.45);
      this.splashDrops(this.bobber.position, 8);
      this.toPhase('bite');
    }
  }

  private bite(dt: number, i: MgInput) {
    // Pulled right under.
    this.bobber.position.y = this.here!.surface - 0.09 - Math.sin(this.time * 18) * 0.015;
    void dt;
    if (i.pressed) { this.hook(); return; }
    if (this.t > this.biteWindow) {
      this.say('Too slow: it took the bait and was gone.', false, 1.2);
      this.bobber.position.y = this.here!.surface;
      this.waitT = 0;
      this.biteT = 3 + Math.random() * 6;
      this.nibbles = [];
      this.toPhase('wait');
    }
  }

  private hook() {
    const { fish, kg } = whichFish(this.here!.sea, this.here!.depth, this.spot.dayFraction(), this.spot.fine);
    this.fish = { def: fish, kg, pos: this.bobber.position.clone(), stamina: 1, surge: 0, surgeT: 0.6, start: this.horizontal(this.bobber.position), inBand: 0, total: 0, slack: 0, hooked: this.time };
    this.fish.pos.y = this.here!.surface;
    this.tension = 0.45;
    // A bigger fish casts a bigger shadow.
    const len = 0.22 * Math.cbrt(kg / 0.3) * (fish.slender / 4);
    this.shadow.scale.set(len / fish.slender * 2.2, 1, len);
    this.say(kg > fish.kg[1] * 0.6 ? 'Hooked — and it\'s a big one!' : 'Hooked!', true, 1);
    sfx.splash(1);
    this.splashDrops(this.bobber.position, 14);
    this.toPhase('fight');
  }

  // ---------- the fight
  private counterNeeded(): boolean { return !!this.fish && this.fish.surge !== 0; }

  private fight(dt: number, i: MgInput) {
    const f = this.fish!, def = f.def, here = this.here!;
    // The fish's runs: a burst one way or the other, then a breather.
    f.surgeT -= dt;
    if (f.surgeT <= 0) {
      if (f.surge) { f.surge = 0; f.surgeT = 0.7 + Math.random() * 1.6 * (1.2 - def.strength); }
      else { f.surge = Math.random() < 0.5 ? -1 : 1; f.surgeT = 0.6 + Math.random() * 0.9 * (0.5 + def.strength) * (0.4 + f.stamina); this.ring(f.pos, 0.35); sfx.splash(0.5 * (0.4 + def.strength)); }
    }
    const weight = Math.min(1.6, 0.6 + f.kg / Math.max(0.5, def.kg[1]) * 0.8);
    let pull = def.strength * weight * (0.3 + 0.7 * f.stamina) * (f.surge ? 1.5 : 0.45);
    // Pulling the rod the other way from its run turns it.
    const ox = (i.x / window.innerWidth - 0.5) * 2;
    const against = f.surge !== 0 && ox * f.surge < -0.2;
    if (against) pull *= 0.45;
    const reeling = i.down;
    const [lo, hi] = this.band;
    const toYou = this.towardYou(f.pos);
    if (reeling) {
      this.tension += dt * (0.35 + pull * 1.35);
      const speed = (this.spot.fine ? 2.3 : 1.6) * (1 - Math.min(0.85, pull * 0.6));
      f.pos.addScaledVector(toYou, speed * dt);
      this.reelTick -= dt;
      if (this.reelTick <= 0) { sfx.reel(); this.reelTick = 0.06; }
    } else {
      this.tension -= dt * 1.15;
      f.pos.addScaledVector(toYou, -pull * 1.4 * dt);
    }
    this.tension = Math.max(0, this.tension + (f.surge ? pull * 0.25 * dt : 0));
    f.pos.addScaledVector(this.right, f.surge * pull * 1.1 * dt);
    // Reeled into the shallows at your feet: drag it out onto the bank. (It won't swim up out of the water itself.)
    const w = this.spot.water(f.pos.x, f.pos.z);
    if (!w || w.depth < 0.12) {
      if (reeling && this.horizontal(f.pos) < 6) { this.land(); return; }
      f.pos.addScaledVector(toYou, -2.4 * dt);
    }
    f.pos.y = here.surface;
    // Tiring it: with the line in the green it fights itself out.
    f.total += dt;
    if (this.tension >= lo && this.tension <= hi) { f.inBand += dt; f.stamina = Math.max(0, f.stamina - dt * 0.14 / (0.4 + def.strength * weight)); }
    // Too tight: it snaps. Too slack, too long: the hook shakes loose. Too far: it's taken all the line.
    if (this.tension > this.snapAt) { sfx.snap(); this.lose(`The line snapped! ${this.spot.fine ? 'It was too much even for this line.' : 'Ease off when it pulls hard.'}`); return; }
    f.slack = this.tension < 0.06 ? f.slack + dt : 0;
    if (f.slack > 2.6) { this.lose('The line went slack and the hook shook loose.'); return; }
    if (this.horizontal(f.pos) > this.maxCast + 6) { this.lose('It ran off with all your line, and slipped the hook.'); return; }
    // The float dragged along over it, the shadow beneath, splashes as it fights.
    this.bobber.position.copy(f.pos).setY(here.surface - 0.02 + Math.sin(this.time * 9) * 0.01);
    this.shadow.visible = true;
    this.shadow.position.copy(f.pos).setY(here.surface - 0.18);
    const heading = toYou.clone().multiplyScalar(-1).addScaledVector(this.right, f.surge * 0.8);
    this.shadow.rotation.y = Math.atan2(heading.x, heading.z);
    if (f.surge && Math.random() < dt * 6) { this.splashDrops(f.pos, 3); this.ring(f.pos, 0.25); }
    const d = this.horizontal(f.pos);
    this.progress = clamp01(1 - (d - 1.6) / Math.max(1, f.start - 1.6));
    if (d < 1.6) this.land();
  }

  private lose(why: string) {
    const f = this.fish!;
    this.sample(f.total ? f.inBand / f.total * 0.6 : 0.2, 1);
    this.say(why, false, 1.6);
    this.fish = null;
    this.shadow.visible = false;
    this.startReelIn();
  }

  private land() {
    const f = this.fish!;
    const q = clamp01(f.total ? f.inBand / f.total : 0.5);
    this.sample(q, 1);
    sfx.splash(1.2);
    this.splashDrops(f.pos, 16);
    this.shadow.visible = false;
    const twin = this.spot.fine && !!f.def.shoals && Math.random() < 0.3;
    const mesh = fishModel(f.def, f.kg);
    this.overlay.add(mesh);
    this.hanging = { mesh, t: 0, info: { fish: f.def, kg: f.kg, quality: q, seconds: this.time - f.hooked + 6 }, twin };
    this.say(`${f.kg >= 1 ? `${f.kg.toFixed(1)} kg` : `${Math.round(f.kg * 1000)} g`} ${f.def.name.toLowerCase()}!${twin ? ' And another on the line!' : ''}`, true, 1.8);
    this.fish = null;
    this.toPhase('landed');
  }

  private landed(dt: number) {
    const h = this.hanging!;
    h.t += dt;
    // Swung in, dangling from the rod tip and flapping.
    const tip = this.tip();
    const k = Math.min(1, h.t / 0.5);
    // (Swung in to hang before you at chest height, where you can see it.)
    const f = this.spot.from;
    const show = new THREE.Vector3(f.x, f.y + 1.25, f.z).addScaledVector(this.dir, 0.95).addScaledVector(this.right, 0.15);
    void tip;
    const at = this.bobber.position.clone().lerp(show, k * k);
    this.bobber.position.copy(at).add(new THREE.Vector3(0, 0.12, 0));
    h.mesh.position.copy(at);
    h.mesh.rotation.set(Math.sin(this.time * 14) * 0.35, this.time * 1.5, Math.PI / 2);
    if (h.t > 1.7) {
      this.spot.onCatch(h.info);
      this.caught++;
      // (A shoaling fish: another of the same, a little smaller.)
      if (h.twin) {
        const [lo, hi] = h.info.fish.kg;
        this.spot.onCatch({ ...h.info, kg: Math.round((lo + (hi - lo) * Math.random() * 0.6) * 100) / 100 });
        this.caught++;
      }
      sfx.done();
      this.overlay.remove(h.mesh);
      h.mesh.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
      this.hanging = null;
      this.line.visible = false;
      this.toPhase('ready');
    }
  }

  private startReelIn() {
    this.reelFrom.copy(this.bobber.position);
    this.toPhase('reelin');
  }

  private reelIn(dt: number) {
    const k = Math.min(1, this.t / 0.8);
    this.bobber.position.copy(this.reelFrom).lerp(this.tip(), k * k);
    this.reelTick -= dt;
    if (this.reelTick <= 0) { sfx.reel(); this.reelTick = 0.07; }
    if (k >= 1) { this.line.visible = false; this.toPhase('ready'); }
  }

  // ---------- the line, splashes
  private drawLine() {
    if (!this.line.visible) return;
    const a = this.tip(), b = this.bobber.position;
    // Slack, it sags (taut in a fight, straighter the tighter).
    const sag = this.phase === 'fight' ? Math.max(0, 0.35 - this.tension * 0.4) : this.phase === 'flight' ? 0 : 0.5;
    const n = this.linePts.length / 3;
    for (let k = 0; k < n; k++) {
      const s = k / (n - 1);
      const x = a.x + (b.x - a.x) * s, z = a.z + (b.z - a.z) * s;
      const y = a.y + (b.y - a.y) * s - Math.sin(s * Math.PI) * sag * Math.min(1, a.distanceTo(b) / 6);
      this.linePts[k * 3] = x; this.linePts[k * 3 + 1] = y; this.linePts[k * 3 + 2] = z;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }

  private towardYou(p: THREE.Vector3): THREE.Vector3 {
    const v = new THREE.Vector3(this.spot.from.x - p.x, 0, this.spot.from.z - p.z);
    return v.lengthSq() > 1e-6 ? v.normalize() : this.dir.clone().negate();
  }

  private horizontal(p: THREE.Vector3): number {
    return Math.hypot(p.x - this.spot.from.x, p.z - this.spot.from.z);
  }

  private ring(at: THREE.Vector3, size: number) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.7, depthWrite: false }));
    m.position.set(at.x, (this.here?.surface ?? at.y) + 0.015, at.z);
    m.scale.setScalar(0.05);
    this.overlay.add(m);
    this.rings.push({ mesh: m, t: 0, max: 1.1, size });
  }

  private updateRings(dt: number) {
    for (const r of [...this.rings]) {
      r.t += dt;
      const k = r.t / r.max;
      r.mesh.scale.setScalar(0.05 + r.size * Math.sqrt(k) * 1.6);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
      if (k >= 1) { this.overlay.remove(r.mesh); r.mesh.geometry.dispose(); (r.mesh.material as THREE.Material).dispose(); this.rings.splice(this.rings.indexOf(r), 1); }
    }
  }

  private splashDrops(at: THREE.Vector3, n: number) {
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.012 + Math.random() * 0.012, 5, 4), new THREE.MeshBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.85 }));
      m.position.set(at.x, (this.here?.surface ?? at.y) + 0.02, at.z);
      this.overlay.add(m);
      this.drops.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 1.4, 1 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4), life: 0.7 });
    }
  }

  private updateDrops(dt: number) {
    for (const d of [...this.drops]) {
      d.life -= dt;
      d.vel.y -= 9 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      if (d.life <= 0 || (this.here && d.mesh.position.y < this.here.surface - 0.05)) { this.overlay.remove(d.mesh); d.mesh.geometry.dispose(); (d.mesh.material as THREE.Material).dispose(); this.drops.splice(this.drops.indexOf(d), 1); }
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
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}

/** A fish, nose down along +y (hanging off a line), sized to its weight. */
export function fishModel(def: FishDef, kg: number): THREE.Group {
  const g = new THREE.Group();
  const len = 0.22 * Math.cbrt(kg / 0.3) * (def.slender > 8 ? 1.6 : 1);
  const depth = len / def.slender * 1.6;
  const [back, belly, fin] = def.colors;
  // The body: darker along the back, pale underneath.
  const geo = new THREE.SphereGeometry(1, 16, 10).scale(depth * 0.32, len / 2, depth / 2);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), cb = new THREE.Color(back), cl = new THREE.Color(belly), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.copy(cl).lerp(cb, clamp01(p.getZ(i) / (depth / 2) * 0.8 + 0.5)); c.toArray(col, i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25 }));
  g.add(body);
  // The tail, a dorsal fin, and an eye.
  const finMat = new THREE.MeshStandardMaterial({ color: fin, roughness: 0.6, side: THREE.DoubleSide });
  const tail = new THREE.Mesh(new THREE.ConeGeometry(depth * 0.45, len * 0.25, 4).scale(0.15, 1, 1), finMat);
  tail.position.y = len / 2 + len * 0.09;
  tail.rotation.x = Math.PI;
  g.add(tail);
  if (def.slender < 8) {
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(depth * 0.25, len * 0.3, 3).scale(0.12, 1, 1), finMat);
    dorsal.position.set(0, len * 0.05, depth * 0.5);
    dorsal.rotation.x = -1.2;
    g.add(dorsal);
  }
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(depth * 0.07, 6, 4), new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.2 }));
    eye.position.set(s * depth * 0.28, -len * 0.38, depth * 0.12);
    g.add(eye);
  }
  return g;
}
