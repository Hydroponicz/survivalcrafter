import * as THREE from 'three';
import { benchMesh, box, clamp01, cyl, fireMesh, logMesh, Minigame, type Meter, type MgInput } from './core';
import type { Gesture } from './tutorials';

/**
 * Saw a log into planks, along its length. The log lies across the view with
 * chalk lines along its top, one for each cut. Hold the left button and sweep
 * the mouse left and right, as the saw goes: each stroke runs the cut further
 * along the line. Steady strokes cut; rushing makes the blade bind. The grain
 * pulls the blade aside: nudge the mouse up or down to keep it on the line
 * (the groove shows where it really went). Each finished cut drops a board.
 */
export class SawGame extends Minigame {
  readonly title = 'Sawing planks';
  readonly instructions = 'Hold left button and sweep the mouse left/right to saw along the chalk line. Nudge up/down to stay on it. Steady strokes: too fast and the blade binds.';
  showPointer = false;
  private readonly R = 0.2;
  private readonly LEN = 2.0;
  private readonly logY = 0.32;
  /** Where each cut runs (across the log), and which one you're on. */
  private lines: number[];
  private cut = 0;
  /** How far along the log the current cut has got (-LEN/2 .. LEN/2). */
  private front: number;
  /** The saw: where it is in its stroke, and how far off the line. */
  private stroke = 0;
  private offset = 0;
  private drift = 0;
  /** Stroke speed (pixels a second, smoothed), and how close the blade is to binding. */
  private speed = 0;
  private bind = 0;
  private stuck = false;
  private calm = 0;
  private idle = 0;
  private lastKerf: number;
  private saw = new THREE.Group();
  private blade: THREE.Mesh;
  private chalk: THREE.Mesh[] = [];
  private boards = 0;
  private falling: { mesh: THREE.Mesh; t: number; from: THREE.Vector3; to: THREE.Vector3 }[] = [];

  constructor(ease: number, cuts: number) {
    super(ease);
    this.front = -this.LEN / 2;
    this.lastKerf = this.front;
    // The cuts, evenly across the log (the outside slabs are waste).
    // Nearest to you first.
    this.lines = Array.from({ length: cuts }, (_, i) => this.R * 0.72 - (i * this.R * 1.44) / Math.max(1, cuts - 1));
    this.scene.add(benchMesh());
    for (const x of [-0.75, 0.75]) {
      const trestle = box(0.1, 0.14, 0.5, 0x6e4e30);
      trestle.position.set(x, 0.07, 0);
      this.scene.add(trestle);
    }
    const log = logMesh(this.LEN, this.R, 0x8a7a68);
    log.position.y = this.logY;
    this.scene.add(log);
    // Chalk lines along the top of the log.
    for (const z of this.lines) {
      const line = box(this.LEN, 0.003, 0.008, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.35 });
      line.position.set(0, this.topAt(z) + 0.002, z);
      this.scene.add(line);
      this.chalk.push(line);
    }
    // The saw, lying along the log: its blade upright in the cut.
    this.blade = box(0.9, 0.07, 0.005, 0xb8bcc2, { metalness: 0.6, roughness: 0.4 });
    this.blade.position.set(0, 0.02, 0);
    const handle = box(0.16, 0.1, 0.04, 0x7a5634);
    handle.position.set(-0.52, 0.07, 0);
    this.saw.add(this.blade, handle);
    this.scene.add(this.saw);
    this.look([0, 2.0, 1.25], [0, 0.22, 0.05]);
    this.highlight();
  }

  /** Height of the log's top at a point across it. */
  private topAt(z: number) {
    return this.logY + Math.sqrt(Math.max(0, this.R * this.R - z * z));
  }

  /** The line being cut stands out; the ones done fade. */
  private highlight() {
    this.chalk.forEach((m, i) => {
      const mt = m.material as THREE.MeshStandardMaterial;
      mt.color.set(i === this.cut ? 0xff5a3c : i < this.cut ? 0x6a5040 : 0xffffff);
      mt.emissive.set(i === this.cut ? 0xff3010 : 0x000000);
      mt.emissiveIntensity = i === this.cut ? 1.2 : 0;
    });
  }

  private get tolerance() { return 0.008 + 0.022 * this.ease; }
  /** The range of stroke speeds (pixels a second) that cut well. */
  private get band(): [number, number] { return [220, 1000 + 600 * this.ease]; }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    if (this.done) return null;
    const p = this.toScreen(this.saw.position.clone().add(new THREE.Vector3(0, 0.12, 0)));
    const at = (text: string, gesture: Gesture) => ({ x: p.x + 30, y: p.y - 60, text, gesture });
    if (this.stuck) return at('too fast: the blade is stuck. Slow right down', 'wait');
    if (this.idle > 1.2) return at('hold the button and sweep left and right to saw', 'leftright');
    if (Math.abs(this.offset) > this.tolerance * 1.5) return at(this.offset > 0 ? 'off the line: nudge the mouse up' : 'off the line: nudge the mouse down', 'updown');
    if (this.speed < this.band[0] && this.idle > 0.4) return at('longer, quicker strokes', 'leftright');
    return null;
  }

  update(dt: number, i: MgInput) {
    if (this.done) { this.animateBoards(dt); return; }
    const [lo, hi] = this.band;
    // Stroke speed: how fast you're sweeping (only while holding the saw).
    const sweep = i.down ? Math.abs(i.dx) / Math.max(dt, 1e-3) : 0;
    this.speed += (sweep - this.speed) * Math.min(1, dt * 8);
    this.idle = i.down && Math.abs(i.dx) > 0.5 ? 0 : this.idle + dt;
    // The saw follows your hand back and forth.
    if (i.down) this.stroke = Math.max(-0.28, Math.min(0.28, this.stroke + i.dx * 0.0016));

    // Rushing binds the blade; it frees once you slow down.
    if (this.speed > hi) this.bind = Math.min(1, this.bind + dt * 1.6);
    else this.bind = Math.max(0, this.bind - dt * 1.1);
    if (this.bind >= 1 && !this.stuck) { this.stuck = true; this.say('The saw binds! Slow down.', false, 1.4); }
    if (this.stuck) {
      this.calm = this.speed < hi * 0.6 ? this.calm + dt : 0;
      if (this.calm > 0.35) { this.stuck = false; this.bind = 0.5; this.calm = 0; }
    }

    // The grain pulls the blade aside as you saw; nudge up/down to correct.
    const sawing = i.down && !this.stuck && this.speed > lo * 0.5;
    if (sawing) {
      this.drift += (Math.random() - 0.5) * dt * 0.05 * (1.3 - this.ease);
      this.drift *= 0.985;
      this.offset += this.drift * dt * 6;
    }
    this.offset = Math.max(-0.06, Math.min(0.06, this.offset + i.dy * 0.0005));
    const tol = this.tolerance;
    const align = clamp01(1 - Math.abs(this.offset) / (tol * 2));

    // Cutting: steady strokes in the green run the cut along the line.
    if (sawing) {
      const rate = this.speed >= lo && this.speed <= hi ? 1 : this.speed < lo ? this.speed / lo : 0.5;
      const before = this.front;
      this.front = Math.min(this.LEN / 2, this.front + dt * 0.42 * rate);
      this.sample(align, this.front - before);
      // The groove, where the blade really went.
      const z = this.lines[this.cut] + this.offset;
      while (this.lastKerf + 0.035 <= this.front) {
        const k = box(0.04, 0.004, 0.01, 0x2a1c10);
        k.position.set(this.lastKerf + 0.0175, this.topAt(z) + 0.001, z);
        this.scene.add(k);
        this.lastKerf += 0.035;
      }
      if (Math.random() < dt * 10 * rate) this.burst(new THREE.Vector3(this.front, this.topAt(z), z + 0.03), 0xe0c290, 2, 0.45);
    }
    // The blade shows whether it's on the line: green on it, red off.
    const bm = this.blade.material as THREE.MeshStandardMaterial;
    bm.emissive.setRGB(1 - align, align, 0.1).multiplyScalar(0.25);

    if (this.front >= this.LEN / 2) {
      this.dropBoard();
      this.cut++;
      // The last cut leaves two boards: the one cut off and what's left.
      if (this.cut >= this.lines.length) { this.cut--; this.dropBoard(); this.cut++; }
      if (this.cut >= this.lines.length) {
        this.say('All the boards are cut!', true, 1.5);
        this.done = true; this.progress = 1;
        return;
      }
      this.say(`Board ${this.cut} cut! ${this.lines.length - this.cut} to go.`, true, 1.2);
      this.front = -this.LEN / 2;
      this.lastKerf = this.front;
      this.offset = 0;
      this.drift = 0;
      this.highlight();
    }
    this.progress = (this.cut + (this.front + this.LEN / 2) / this.LEN) / this.lines.length;
    // The saw sits in the cut, its teeth at the front of it.
    const z = this.lines[this.cut] + this.offset;
    this.saw.position.set(this.front - 0.3 + this.stroke, this.topAt(z) - 0.02, z);
    this.animateBoards(dt);
  }

  /** A finished board slides off onto the pile beside the bench. */
  private dropBoard() {
    const board = box(this.LEN * 0.95, 0.025, 0.09, 0xd8b483);
    const from = new THREE.Vector3(0, this.topAt(this.lines[this.cut]), this.lines[this.cut]);
    const to = new THREE.Vector3(0, 0.02 + this.boards * 0.027, 0.45);
    board.position.copy(from);
    this.scene.add(board);
    this.falling.push({ mesh: board, t: 0, from, to });
    this.boards++;
    this.burst(from, 0xe0c290, 10, 0.8);
  }

  private animateBoards(dt: number) {
    for (const f of this.falling) {
      if (f.t >= 1) continue;
      f.t = Math.min(1, f.t + dt * 2.2);
      const e = f.t * f.t * (3 - 2 * f.t);
      f.mesh.position.lerpVectors(f.from, f.to, e);
      f.mesh.position.y += Math.sin(e * Math.PI) * 0.15;
    }
  }

  meters(): Meter[] {
    const [lo, hi] = this.band, top = hi * 1.3;
    return [
      { label: 'Stroke speed', value: clamp01(this.speed / top), band: [lo / top, hi / top], color: this.stuck ? '#ef7d6a' : '#e8c66a' },
      { label: 'On the line', value: clamp01(1 - Math.abs(this.offset) / (this.tolerance * 3)), band: [0.5, 1], color: '#8ad06a' },
    ];
  }
}

/**
 * Start a fire with a bow drill. Hold the left button and saw the bow left and
 * right in a steady rhythm to build heat until an ember forms.
 */
export class BowDrillGame extends Minigame {
  readonly title = 'Bow drill';
  readonly instructions = 'Hold left button and move the mouse left/right in a steady rhythm. Too wild and the spindle slips.';
  showPointer = false;
  private heat = 0;
  private bowX = 0;
  private lastDir = 0;
  private lastFlip = 0;
  private spindle: THREE.Mesh;
  private bow = new THREE.Group();
  private ember: THREE.Mesh;

  constructor(ease: number) {
    super(ease);
    const ground = box(2.5, 0.05, 2, 0x4a6b2c);
    ground.position.y = -0.025;
    this.scene.add(ground);
    const board = box(0.6, 0.04, 0.14, 0x9a7650);
    board.position.y = 0.02;
    this.scene.add(board);
    const tinder = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ color: 0xc9b07a, flatShading: true }));
    tinder.position.set(0.1, 0.03, 0.1);
    this.scene.add(tinder);
    this.spindle = cyl(0.015, 0.015, 0.36, 0xb08a5a, 8);
    this.spindle.position.set(0, 0.22, 0);
    this.scene.add(this.spindle);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.012, 6, 24, Math.PI * 0.7), new THREE.MeshStandardMaterial({ color: 0x6b4a2c }));
    arc.rotation.set(Math.PI / 2, 0, Math.PI * 0.15);
    const cord = box(0.5, 0.004, 0.004, 0xe0d4b0);
    cord.position.set(0, 0, -0.1);
    this.bow.add(arc, cord);
    this.bow.position.set(0, 0.2, 0.1);
    this.scene.add(this.bow);
    this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff4400, emissiveIntensity: 0 }));
    this.ember.position.set(0, 0.045, 0);
    this.scene.add(this.ember);
    this.look([0.2, 0.7, 0.8], [0, 0.12, 0]);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    const p = this.toScreen(this.bow.position);
    return { x: p.x + 40, y: p.y - 50, text: 'hold and saw left/right in a steady rhythm', gesture: 'leftright' };
  }

  update(dt: number, i: MgInput) {
    this.heat = Math.max(0, this.heat - dt * 0.09);
    if (i.down && i.dx !== 0) {
      const dir = Math.sign(i.dx);
      const speed = Math.abs(i.dx) / Math.max(dt, 1e-3);
      this.bowX = Math.max(-0.25, Math.min(0.25, this.bowX + i.dx * 0.0012));
      if (dir !== this.lastDir) {
        // A good rhythm is a stroke every ~0.2-0.8 s.
        const gap = this.time - this.lastFlip;
        if (this.lastDir !== 0) this.sample(gap > 0.15 && gap < 0.9 ? 1 : 0.4, 0.3);
        this.lastFlip = this.time;
        this.lastDir = dir;
      }
      if (speed > 2600 + this.ease * 1500) {
        this.heat = Math.max(0, this.heat - 0.12);
        this.say('The spindle slips!', false, 0.7);
        this.sample(0, 0.5);
      } else {
        this.heat += Math.min(speed, 1800) * dt * 0.00028 * (0.7 + 0.5 * this.ease);
      }
      this.spindle.rotation.y += i.dx * 0.05;
    }
    this.bow.position.x = this.bowX;
    const e = this.ember.material as THREE.MeshStandardMaterial;
    e.emissiveIntensity = Math.max(0, this.heat - 0.4) * 5;
    if (this.heat > 0.55 && Math.random() < dt * 8) this.burst(new THREE.Vector3(0, 0.05, 0), 0x777777, 1, 0.25);
    this.progress = clamp01(this.heat);
    if (this.heat >= 1) {
      this.done = true;
      // Faster ignition is better work.
      this.sample(clamp01(1.3 - this.time / 14), 2);
      this.say('An ember!', true);
    }
  }

  meters(): Meter[] {
    return [{ label: 'Heat', value: clamp01(this.heat), color: '#f2a54e' }];
  }
}

/**
 * Smelt ore at the forge: pump the bellows (hold left button, pull the mouse
 * down, then let it rise) to keep the heat in the band while the ore melts.
 */
export class BellowsGame extends Minigame {
  readonly title = 'Smelting';
  readonly instructions = 'Hold left button and pull the mouse down to pump the bellows, then up to refill. Keep the heat in the green band.';
  showPointer = false;
  private heat = 0.3;
  private squeeze = 0;
  private melt = 0;
  private bellows = new THREE.Group();
  private coals: THREE.Mesh;
  private crucible: THREE.Mesh;
  private fire = fireMesh();
  private band: [number, number];
  /** How hard each pump blows, and how slowly the heat falls away (from the bellows' quality). */
  private blow: number;
  private loss: number;

  constructor(ease: number, gear = 0.5) {
    super(ease);
    this.band = [0.58 - 0.1 * ease - 0.05 * gear, 0.8 + 0.06 * ease + 0.04 * gear];
    this.blow = 0.32 + 0.22 * gear;
    this.loss = 0.13 - 0.04 * gear;
    const hearth = box(1.0, 0.5, 0.8, 0x6f665e, { flatShading: true });
    hearth.position.y = -0.25;
    this.scene.add(hearth);
    this.coals = box(0.5, 0.06, 0.4, 0x221510, { emissive: 0xff3300, emissiveIntensity: 0.3 });
    this.coals.position.y = 0.03;
    this.scene.add(this.coals);
    this.fire.group.scale.setScalar(0.8);
    this.scene.add(this.fire.group);
    this.crucible = cyl(0.09, 0.07, 0.14, 0x55504a, 12);
    this.crucible.position.set(0, 0.13, 0);
    this.scene.add(this.crucible);
    const top = box(0.36, 0.03, 0.22, 0x7a5634);
    top.position.y = 0.12;
    const bottom = box(0.36, 0.03, 0.22, 0x7a5634);
    const leather = box(0.32, 0.1, 0.2, 0x5a3a24);
    leather.position.y = 0.06;
    this.bellows.add(top, bottom, leather);
    this.bellows.position.set(0.75, 0.0, 0.1);
    this.bellows.userData = { top, leather };
    this.scene.add(this.bellows);
    this.look([0.55, 0.85, 1.25], [0.2, 0.05, 0]);
  }

  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    const p = this.toScreen(this.bellows.position);
    const at = { x: p.x - 60, y: p.y - 70 };
    if (this.heat > this.band[1]) return { ...at, text: 'too hot: ease off and let it cool', gesture: 'wait' };
    if (this.heat < this.band[0]) return this.squeeze > 0.9
      ? { ...at, text: 'let the bellows refill: move up', gesture: 'up' }
      : { ...at, text: 'hold and pull down to pump', gesture: 'down' };
    return { ...at, text: 'in the green: keep it there', gesture: 'wait' };
  }

  update(dt: number, i: MgInput) {
    this.heat = Math.max(0, this.heat - dt * this.loss);
    if (i.down && i.dy > 0) {
      const before = this.squeeze;
      this.squeeze = Math.min(1, this.squeeze + i.dy * 0.006);
      this.heat += (this.squeeze - before) * this.blow;
    } else if (i.dy < 0 || !i.down) {
      this.squeeze = Math.max(0, this.squeeze + Math.min(0, i.dy) * 0.006 - (i.down ? 0 : dt * 1.5));
    }
    this.heat = Math.min(1.1, this.heat);
    const [lo, hi] = this.band;
    if (this.heat >= lo && this.heat <= hi) {
      this.melt += dt / 7;
      this.sample(1, dt);
    } else if (this.heat > hi) {
      this.melt += dt / 14;
      this.sample(0.25, dt);
      if (Math.random() < dt * 2) this.say('Too hot — the iron is burning!', false, 0.8);
    } else if (this.time > 1.5 && Math.random() < dt * 0.8) {
      this.say('Pump the bellows!', false, 0.8);
    }
    const { top, leather } = this.bellows.userData as { top: THREE.Mesh; leather: THREE.Mesh };
    top.position.y = 0.12 - this.squeeze * 0.08;
    leather.scale.y = 1 - this.squeeze * 0.75;
    leather.position.y = 0.06 - this.squeeze * 0.04;
    (this.coals.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + this.heat * 2;
    (this.crucible.material as THREE.MeshStandardMaterial).emissive.setRGB(this.melt * 0.9, this.melt * 0.35, 0);
    this.fire.flicker(this.time, 0.4 + this.heat);
    if (this.heat > hi && Math.random() < dt * 20) this.burst(new THREE.Vector3(0, 0.2, 0), 0xffa040, 1, 0.8, true);
    this.progress = clamp01(this.melt);
    if (this.melt >= 1) { this.done = true; this.say('The iron runs clear!', true); }
  }

  meters(): Meter[] {
    return [{ label: 'Heat', value: clamp01(this.heat), band: this.band, color: '#f2a54e' }];
  }
}
