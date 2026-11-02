import * as THREE from 'three';
import type { WorldGen } from '../world/worldgen';
import { prepareTiles } from '../world/tilesource';

// The main menu's backdrop: a camera touring a world, shot by shot. Each shot
// looks at something worth seeing (a peak, a river or lake, the coast, a
// forest), circling it slowly; between shots the view fades to black while
// the land around the next one is made.

type Kind = 'water' | 'peak' | 'coast' | 'forest';

interface Shot {
  kind: Kind;
  /** What the camera looks at. */
  target: THREE.Vector3;
  /** How far out it circles, how high above the target, where it starts and how far round it goes (radians). */
  radius: number; height: number; angle: number; sweep: number;
  /** Time of day (share of the day). */
  day: number;
}

const SHOT_SECONDS = 22, FADE = 1.4;

export class Tour {
  /** Where the land should be detailed (the ground under the camera). */
  readonly focus = new THREE.Vector3();
  /** Time of day to show. */
  day = 0.36;
  /** True once the first shot is on screen. */
  started = false;
  private centres: { kind: Kind; x: number; z: number }[] = [];
  private next = 0;
  private shot: Shot | null = null;
  private t = 0;
  private phase: 'loading' | 'in' | 'show' | 'out' = 'loading';
  private alpha = 1;
  private camY = NaN;
  private loadWait = 0;
  private dayPick = 0;

  constructor(private gen: WorldGen, spawn: { x: number; z: number }, private fade: HTMLElement, private pending: () => number) {
    this.focus.set(spawn.x, 0, spawn.z);
    this.plan(spawn.x, spawn.z);
    void this.load();
  }

  /** Pick places to visit from the broad shape of the land (cheap: no detail needed yet). */
  private plan(sx: number, sz: number) {
    const b = this.gen.base;
    const peaks: [number, number, number][] = [], coasts: [number, number, number][] = [];
    const R = 1800, step = 120;
    for (let z = sz - R; z <= sz + R; z += step) for (let x = sx - R; x <= sx + R; x += step) {
      const d = Math.hypot(x - sx, z - sz);
      if (d > R) continue;
      const land = b.land(x, z);
      if (land > 0.97) peaks.push([x, z, b.height(x, z) - d * 0.01]);
      else if (land > 0.35 && land < 0.65 && b.height(x, z) > -2) coasts.push([x, z, -d]);
    }
    const apart = (list: [number, number, number][], n: number, gap: number) => {
      list.sort((a, c) => c[2] - a[2]);
      const out: [number, number][] = [];
      for (const [x, z] of list) {
        if (out.every(([ox, oz]) => Math.hypot(ox - x, oz - z) > gap)) out.push([x, z]);
        if (out.length >= n) break;
      }
      return out;
    };
    const tops = apart(peaks, 2, 700), shore = apart(coasts, 1, 0);
    // Start near the middle (rivers and forest), then out to the sights.
    this.centres.push({ kind: 'water', x: sx, z: sz });
    if (tops[0]) this.centres.push({ kind: 'peak', x: tops[0][0], z: tops[0][1] });
    this.centres.push({ kind: 'forest', x: sx + 90, z: sz - 60 });
    if (shore[0]) this.centres.push({ kind: 'coast', x: shore[0][0], z: shore[0][1] });
    if (tops[1]) this.centres.push({ kind: 'peak', x: tops[1][0], z: tops[1][1] });
  }

  /** Make the land around the next place, find the sight there, and frame it. */
  private async load() {
    this.phase = 'loading';
    const c = this.centres[this.next % this.centres.length];
    this.next++;
    this.focus.set(c.x, this.focus.y, c.z);
    try { await prepareTiles(this.gen, c.x, c.z); } catch { /* frame what there is */ }
    this.shot = this.bestAngle(this.frame(c.kind, c.x, c.z));
    this.t = 0;
    this.camY = NaN;
    this.loadWait = 0;
    this.phase = 'in';
  }

  private frame(kind: Kind, cx: number, cz: number): Shot {
    const g = this.gen;
    const h = (x: number, z: number) => g.mapHeight(x, z);
    const days = [0.3, 0.42, 0.55, 0.68];
    const day = days[this.dayPick++ % days.length];
    const angle = Math.random() * Math.PI * 2, sweep = (Math.random() < 0.5 ? -1 : 1) * 0.9;
    const near = (test: (x: number, z: number) => boolean, R = 280) => {
      for (let r = 0; r <= R; r += 14) {
        const n = Math.max(1, Math.round((r * Math.PI * 2) / 14));
        for (let a = 0; a < n; a++) {
          const x = cx + Math.cos((a / n) * Math.PI * 2) * r, z = cz + Math.sin((a / n) * Math.PI * 2) * r;
          if (test(x, z)) return [x, z] as const;
        }
      }
      return null;
    };
    if (kind === 'water') {
      const river = near((x, z) => { const c = g.channel(x, z); return !!c && !c.sea && c.d < 1 && c.r > 4; }, 290);
      if (river) return { kind, target: new THREE.Vector3(river[0], g.channel(river[0], river[1])!.s, river[1]), radius: 75, height: 24, angle, sweep, day };
      const lake = near((x, z) => !Number.isNaN(g.lakeSurface(x, z)) && h(x, z) < g.lakeSurface(x, z) - 1.5);
      if (lake) return { kind, target: new THREE.Vector3(lake[0], g.lakeSurface(lake[0], lake[1]), lake[1]), radius: 110, height: 28, angle, sweep, day };
      return this.frame('forest', cx, cz);
    }
    if (kind === 'peak') {
      let best: [number, number, number] = [cx, cz, h(cx, cz)];
      for (let z = cz - 260; z <= cz + 260; z += 20) for (let x = cx - 260; x <= cx + 260; x += 20) {
        const y = h(x, z);
        if (y > best[2]) best = [x, z, y];
      }
      return { kind, target: new THREE.Vector3(best[0], best[2] - 8, best[1]), radius: 430, height: 36, angle, sweep: sweep * 0.6, day };
    }
    if (kind === 'coast') {
      const shore = near((x, z) => h(x, z) < -0.5 && h(x + 18, z) > 1 || h(x, z) < -0.5 && h(x - 18, z) > 1 || h(x, z) < -0.5 && h(x, z + 18) > 1 || h(x, z) < -0.5 && h(x, z - 18) > 1);
      const [x, z] = shore ?? [cx, cz];
      return { kind, target: new THREE.Vector3(x, Math.max(0, h(x, z)), z), radius: 140, height: 40, angle, sweep, day };
    }
    // Forest: over the treetops, across the gentlest, lowest ground near by (a valley floor).
    let fx = cx, fz = cz, fs = Infinity;
    for (let z = cz - 240; z <= cz + 240; z += 40) for (let x = cx - 240; x <= cx + 240; x += 40) {
      const y = h(x, z);
      if (y < 3) continue;
      const slope = Math.hypot(h(x + 20, z) - h(x - 20, z), h(x, z + 20) - h(x, z - 20)) / 40;
      const score = slope * 40 + y * 0.15;
      if (score < fs) { fs = score; fx = x; fz = z; }
    }
    return { kind: 'forest', target: new THREE.Vector3(fx, h(fx, fz) + 2, fz), radius: 130, height: 40, angle, sweep, day };
  }

  /** Where the camera is on a shot at a share of the way through it. */
  private at(s: Shot, u: number): [number, number] {
    const a = s.angle + s.sweep * (u * u * (3 - 2 * u) * 0.6 + u * 0.4);
    return [s.target.x + Math.sin(a) * s.radius, s.target.z + Math.cos(a) * s.radius];
  }

  /**
   * How high the camera must be at (x, z) to see the target over the land
   * between, and to keep clear of the ground around it.
   */
  private clearance(s: Shot, x: number, z: number): number {
    const g = this.gen, T = s.target;
    let need = -Infinity;
    // The ground near the camera, and any rise beside it.
    need = Math.max(need, Math.max(0, g.mapHeight(x, z)) + 30);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      need = Math.max(need, Math.max(0, g.mapHeight(x + Math.cos(a) * 30, z + Math.sin(a) * 30)) + 26, Math.max(0, g.mapHeight(x + Math.cos(a) * 60, z + Math.sin(a) * 60)) + 16);
    }
    // The sight line: at each step toward the target it has to clear the land.
    for (let k = 1; k < 12; k++) {
      const f = k / 12;
      if (f > 0.9) break;
      const ground = Math.max(0, g.mapHeight(x + (T.x - x) * f, z + (T.z - z) * f)) + 6;
      need = Math.max(need, (ground - T.y * f) / (1 - f));
    }
    return need;
  }

  /** Start the circle where it needs the least climbing to keep the view clear. */
  private bestAngle(s: Shot): Shot {
    let best = s.angle, bestLift = Infinity;
    for (let k = 0; k < 12; k++) {
      const trial = { ...s, angle: s.angle + (k / 12) * Math.PI * 2 };
      let lift = 0;
      for (const u of [0, 0.33, 0.66, 1]) {
        const [x, z] = this.at(trial, u);
        lift = Math.max(lift, this.clearance(trial, x, z) - (s.target.y + s.height));
      }
      if (lift < bestLift) { bestLift = lift; best = trial.angle; }
    }
    return { ...s, angle: best };
  }

  /** Move the camera along (the view stays faded out until there is something to show). */
  update(dt: number, camera: THREE.PerspectiveCamera) {
    const s = this.shot;
    if (this.phase === 'in' && s) {
      // Hold black until the land near the camera is made (or long enough).
      this.loadWait += dt;
      if (this.pending() > 8 && this.loadWait < 6) { this.place(s, camera, 0); this.setFade(1); return; }
    }
    if (!s || this.phase === 'loading') { this.setFade(1); return; }
    this.t += dt;
    if (this.phase === 'in') {
      this.alpha = Math.max(0, this.alpha - dt / FADE);
      this.started = true;
      if (this.alpha <= 0) this.phase = 'show';
    } else if (this.phase === 'show' && this.t > SHOT_SECONDS - FADE) {
      this.phase = 'out';
    } else if (this.phase === 'out') {
      this.alpha = Math.min(1, this.alpha + dt / FADE);
      if (this.alpha >= 1) { void this.load(); }
    }
    this.setFade(this.alpha);
    this.place(s, camera, dt);
  }

  private place(s: Shot, camera: THREE.PerspectiveCamera, dt: number) {
    // Ease in and out of the turn.
    const [x, z] = this.at(s, Math.min(1, this.t / SHOT_SECONDS));
    // Stay clear of the ground (and well above the trees, up to about 25 m).
    const floor = this.clearance(s, x, z);
    const want = Math.max(s.target.y + s.height, floor);
    this.camY = Number.isNaN(this.camY) || !dt ? want : Math.max(floor, this.camY + (want - this.camY) * Math.min(1, dt * 1.5));
    camera.position.set(x, this.camY, z);
    camera.lookAt(s.target);
    this.focus.set(x, this.gen.mapHeight(x, z), z);
    this.day = s.day + this.t * 0.0004;
  }

  private setFade(a: number) {
    this.fade.style.opacity = String(a);
  }
}
