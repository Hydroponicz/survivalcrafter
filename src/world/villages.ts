// Rural villages: a handful of houses round a well, joined by dirt paths, with
// pens and fields about them, scattered across the good open farmland.
//
// Everything here is worked out from the world seed alone (the same village,
// in the same place, every time), and only from the map maker's raw land, so
// it can be asked before any ground near it exists. The ground then takes its
// shape from it (the terrain flattens each house's plot and lays the paths and
// fields: see Terrain.colInfo), and the world places the village's pieces as
// ordinary generated objects, region by region (see World.loadRegion): real
// building pieces, which you can walk into, open, take apart or build onto.

import { hash2, mulberry32 } from './noise';
import { SEA, type WorldGen } from './worldgen';

/** Villages are planned one (at most) per square of this size. */
export const VCELL = 512;
/** How far a village's centre keeps from its square's edges (so all of it lies inside). */
const MARGIN = 110;
/** No village this close to where the world began (your first camp). */
const AVOID = 320;
/** Plots blend back into the natural ground over this many metres. */
const FALL = 5;

export interface VPiece { type: string; x: number; y: number; z: number; yaw: number }
/** A rectangle turned by `yaw` (the same turn as a piece's). */
export interface Rect { x: number; z: number; yaw: number; hx: number; hz: number }
interface Pad extends Rect { level: number }
export interface Seg { ax: number; az: number; bx: number; bz: number; w: number }
/** What a house is for (the work of whoever comes to live there). */
export type HouseRole = 'farmer' | 'shepherd' | 'woodcutter' | 'butcher' | 'smith' | 'elder' | 'villager';
export interface House {
  x: number; z: number; yaw: number; y: number;
  /** Floor tiles along its length (2: a cottage, 3: a longhouse). */
  tiles: number;
  role: HouseRole;
  /** Just outside the door. */
  door: { x: number; z: number };
  /** Its path to the square: the door, the bend, the square's edge. */
  route: { x: number; z: number }[];
  beds: { x: number; z: number }[];
  /** Where its chest stands (what the household makes goes in here). */
  chest: { x: number; z: number };
  /** A chopping block outside, if it has one. */
  block?: { x: number; z: number };
  /** The smith's forge and anvil. */
  smithy?: { forge: { x: number; z: number }; anvil: { x: number; z: number } };
  /** Its animal pen, if it keeps one. */
  pen?: Rect;
}
export interface Village {
  /** Its square on the village grid. */
  cx: number; cz: number;
  name: string;
  x: number; z: number;
  /** Everything of it lies within this distance of its centre. */
  r: number;
  square: { x: number; z: number; r: number };
  /** The storehouse on the square (the village's shared stores), facing in. */
  store?: { x: number; z: number; yaw: number };
  /** The campfire in the square, and the benches round it. */
  fire: { x: number; z: number };
  benches: { x: number; z: number; yaw: number }[];
  houses: House[];
  pads: Pad[];
  pens: Rect[];
  fields: Rect[];
  paths: Seg[];
  pieces: VPiece[];
}

// ---------- rectangle helpers (local frame as in world.toLocal)
function local(r: Rect, x: number, z: number): [number, number] {
  const dx = x - r.x, dz = z - r.z, c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}
function world(r: { x: number; z: number; yaw: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return [r.x + lx * c + lz * s, r.z - lx * s + lz * c];
}
/** How far a point lies outside a rectangle (0 inside). */
function outside(r: Rect, x: number, z: number): number {
  const [lx, lz] = local(r, x, z);
  return Math.hypot(Math.max(0, Math.abs(lx) - r.hx), Math.max(0, Math.abs(lz) - r.hz));
}
function corners(r: Rect, grow = 0): [number, number][] {
  const out: [number, number][] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(world(r, sx * (r.hx + grow), sz * (r.hz + grow)));
  return out;
}
/** Do two turned rectangles overlap (with `gap` metres kept between them)? Separating axes. */
function overlaps(a: Rect, b: Rect, gap: number): boolean {
  const ca = corners(a, gap / 2), cb = corners(b, gap / 2);
  for (const r of [a, b]) {
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    for (const [ax, az] of [[c, -s], [s, c]]) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of ca) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
      for (const [x, z] of cb) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}
function segDist(s: Seg, x: number, z: number): number {
  const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)) : 0;
  return Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
}
/** Does a path come within `clear` metres of a rectangle? */
function segHits(s: Seg, r: Rect, clear: number): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(s.bx - s.ax, s.bz - s.az) / 0.75));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (outside(r, s.ax + (s.bx - s.ax) * t, s.az + (s.bz - s.az) * t) < s.w / 2 + clear) return true;
  }
  return false;
}
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- names
const FIRST = ['Ash', 'Oak', 'Thorn', 'Elder', 'Bram', 'Wil', 'Hart', 'Brook', 'Fen', 'Kings', 'Stan', 'Mar', 'Wyn', 'Hollow', 'Lang', 'Cold', 'Red', 'Wheat', 'Barrow', 'Brad', 'Hazel', 'Rush', 'Fox', 'Stone'];
const LAST = ['by', 'ford', 'ham', 'ley', 'ton', 'stead', 'wick', 'field', 'dale', 'combe', 'thorpe', 'well', 'bury', 'mere', 'den', 'hurst'];
function villageName(rnd: () => number): string {
  const a = FIRST[Math.floor(rnd() * FIRST.length)];
  let b = LAST[Math.floor(rnd() * LAST.length)];
  if (a.toLowerCase().endsWith(b[0])) b = b.slice(1);
  return a + b;
}

/** The villages of a world: planned as they're first asked about, then remembered. */
export class Villages {
  private cells = new Map<string, Village | null>();
  /** Places villages keep away from (where the world began). Set before anything is asked. */
  private avoid: { x: number; z: number }[] = [];
  private ready = false;
  private storePiece?: VPiece;

  constructor(private gen: WorldGen) {}

  /** Keep villages away from these points; until this is called, there are none (nothing is planned yet). */
  settle(avoid: { x: number; z: number }[]) {
    if (this.ready && JSON.stringify(avoid) === JSON.stringify(this.avoid)) return;
    this.avoid = avoid.map((p) => ({ x: p.x, z: p.z }));
    this.ready = true;
    this.cells.clear();
  }

  /** The village planned in a grid square (or null), planning it if need be. */
  inCell(cx: number, cz: number): Village | null {
    if (!this.ready) return null;
    const key = `${cx},${cz}`;
    let v = this.cells.get(key);
    if (v === undefined) {
      v = this.plan(cx, cz);
      this.cells.set(key, v);
    }
    return v;
  }

  /** The village a point is in or near (within its reach), if any. */
  at(x: number, z: number, grow = 0): Village | null {
    const v = this.inCell(Math.floor(x / VCELL), Math.floor(z / VCELL));
    return v && Math.hypot(x - v.x, z - v.z) < v.r + grow ? v : null;
  }

  /** Villages already planned (cheap: nothing new is worked out). */
  known(): Village[] {
    return [...this.cells.values()].filter((v): v is Village => !!v);
  }

  /** Villages whose square lies within `r` of a point (planning any not yet worked out). */
  around(x: number, z: number, r: number): Village[] {
    const out: Village[] = [];
    for (let cz = Math.floor((z - r) / VCELL); cz <= Math.floor((z + r) / VCELL); cz++) {
      for (let cx = Math.floor((x - r) / VCELL); cx <= Math.floor((x + r) / VCELL); cx++) {
        const v = this.inCell(cx, cz);
        if (v && Math.hypot(v.x - x, v.z - z) < r + v.r) out.push(v);
      }
    }
    return out;
  }

  // ---------- what the ground and growth make of it

  /** The ground's height at a point once the village's plots are levelled (`h`: the natural height). */
  shape(v: Village, x: number, z: number, h: number): number {
    for (const p of v.pads) {
      const d = outside(p, x, z);
      // (On a plot it's the plot's level, whatever a neighbour's slope would make of it.)
      if (d === 0) return p.level;
      if (d < FALL) h += (p.level - h) * (1 - smooth(0, FALL, d));
    }
    return h;
  }

  /** What the ground's top is made of here, if the village changes it: a path, or a ploughed field. */
  surface(v: Village, x: number, z: number): 'path' | 'field' | null {
    const rag = (hash2(Math.floor(x * 1.4), Math.floor(z * 1.4), 77) - 0.5) * 0.4;
    if (Math.hypot(x - v.square.x, z - v.square.z) < v.square.r + rag) return 'path';
    for (const s of v.paths) if (segDist(s, x, z) < s.w / 2 + rag) return 'path';
    for (const f of v.fields) if (outside(f, x, z) === 0) return 'field';
    return null;
  }

  /** Whether trees and bushes stay off a spot: the houses, pens, fields, paths and square. */
  keepsClear(v: Village, x: number, z: number): boolean {
    if (Math.hypot(x - v.square.x, z - v.square.z) < v.square.r + 4) return true;
    for (const p of v.pads) if (outside(p, x, z) < 3) return true;
    for (const p of v.pens) if (outside(p, x, z) < 2) return true;
    for (const f of v.fields) if (outside(f, x, z) < 1.5) return true;
    for (const s of v.paths) if (segDist(s, x, z) < s.w / 2 + 1.5) return true;
    return false;
  }

  /** Whether a point is inside a house (nothing grows or lies about in there). */
  indoors(x: number, z: number): boolean {
    const v = this.at(x, z);
    if (!v) return false;
    for (const p of v.pads) if (outside(p, x, z) < 0.5) return true;
    for (const p of v.pens) if (outside(p, x, z) < 0.5) return true;
    return false;
  }

  /** The village's pieces anchored within a square of the world. */
  piecesIn(v: Village, x0: number, z0: number, size: number): VPiece[] {
    return v.pieces.filter((p) => p.x >= x0 && p.x < x0 + size && p.z >= z0 && p.z < z0 + size);
  }

  // ---------- planning
  private plan(cx: number, cz: number): Village | null {
    const seed = this.gen.seed;
    const rnd = mulberry32((Math.imul(seed, 2654435761) ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ 0x7111a6e) >>> 0);
    if (rnd() > 0.42) return null;
    // A few spots in the square: keep the best open, level farmland.
    let best: { x: number; z: number; score: number } | null = null;
    for (let i = 0; i < 7; i++) {
      const x = cx * VCELL + MARGIN + rnd() * (VCELL - 2 * MARGIN), z = cz * VCELL + MARGIN + rnd() * (VCELL - 2 * MARGIN);
      const score = this.siteScore(x, z);
      if (score !== null && (!best || score < best.score)) best = { x, z, score };
    }
    if (!best) return null;
    return this.layout(cx, cz, best.x, best.z, rnd);
  }

  /** How uneven a spot is (lower is better), or null if a village can't go there. */
  private siteScore(x: number, z: number): number | null {
    const g = this.gen;
    for (const a of this.avoid) if (Math.hypot(a.x - x, a.z - z) < AVOID) return null;
    const h = g.height(x, z);
    if (h < SEA + 4 || h > 70 || !Number.isNaN(g.water(x, z, h))) return null;
    const zone = g.zone(x, z, h);
    if (zone !== 'meadow' && zone !== 'broadleaf' && zone !== 'heath') return null;
    if (g.soil(x, z, h, 0).top !== 'grass') return null;
    const rv = g.river(x, z);
    if (rv && rv.d < rv.r + 35) return null;
    let worst = 0, sum = 0;
    for (const r of [15, 30, 48]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const ph = g.height(px, pz);
        if (!Number.isNaN(g.water(px, pz, ph)) || ph < SEA + 2) return null;
        const d = Math.abs(ph - h);
        worst = Math.max(worst, d / r);
        sum += d;
      }
    }
    if (worst > 0.22) return null;
    // Meadow is the best farmland; woodland is cleared for it, heath is poorer.
    return sum / 24 + (zone === 'meadow' ? 0 : zone === 'broadleaf' ? 1 : 2);
  }

  private layout(cx: number, cz: number, x: number, z: number, rnd: () => number): Village {
    const g = this.gen;
    const v: Village = { cx, cz, name: villageName(rnd), x, z, r: 0, square: { x, z, r: 5 + rnd() * 1.5 }, fire: { x, z }, benches: [], houses: [], pads: [], pens: [], fields: [], paths: [], pieces: [] };
    const sq = v.square;
    const ground = (px: number, pz: number) => this.shape(v, px, pz, g.height(px, pz));
    const dry = (px: number, pz: number) => Number.isNaN(g.water(px, pz, g.height(px, pz)));
    const rects = (): Rect[] => [...v.pads, ...v.pens, ...v.fields];
    const free = (r: Rect, gap: number) => rects().every((o) => !overlaps(o, r, gap)) && v.paths.every((s) => !segHits(s, r, 0.6))
      && outside(r, sq.x, sq.z) > sq.r + 1.5;
    const lim = VCELL / 2 + (MARGIN - 10);
    const inCell = (px: number, pz: number) => Math.abs(px - (cx + 0.5) * VCELL) < lim && Math.abs(pz - (cz + 0.5) * VCELL) < lim;
    const n = 5 + Math.floor(rnd() * 8);
    const spread = 6 + n * 1.9;
    const logs = rnd() < 0.6;

    // Roads leading out of the village (one or two), laid first so the houses keep off them.
    for (let k = 0, roads = 1 + Math.floor(rnd() * 2), a0 = rnd() * Math.PI * 2; k < roads; k++) {
      const a = a0 + k * (Math.PI * (0.8 + rnd() * 0.4));
      const len = spread + 30;
      const mx = x + Math.cos(a + 0.15) * len * 0.5, mz = z + Math.sin(a + 0.15) * len * 0.5;
      const ex = x + Math.cos(a) * len, ez = z + Math.sin(a) * len;
      if (!inCell(ex, ez)) continue;
      v.paths.push({ ax: x + Math.cos(a) * sq.r, az: z + Math.sin(a) * sq.r, bx: mx, bz: mz, w: 2.4 }, { ax: mx, az: mz, bx: ex, bz: ez, w: 2.2 });
    }

    // Houses round the square, each facing it, a path from its door.
    const roles: HouseRole[] = ['elder', 'farmer', 'shepherd', 'woodcutter', 'smith', 'butcher', 'farmer', 'shepherd', 'villager', 'farmer', 'villager', 'woodcutter'];
    for (let i = 0; i < n; i++) {
      const tiles = i === 0 || rnd() < 0.3 ? 3 : 2;
      const role = roles[i % roles.length];
      // The smith works beside the house: a wider plot for the forge and anvil.
      const extra = role === 'smith' ? 3.4 : 0;
      for (let tries = 0; tries < 40; tries++) {
        const a = rnd() * Math.PI * 2, r = sq.r + 7 + rnd() * spread;
        const hx = x + Math.cos(a) * r, hz = z + Math.sin(a) * r;
        if (!inCell(hx, hz)) continue;
        // Its front (local -z) toward the square, turned a little off true.
        const yaw = Math.atan2(-(x - hx), -(z - hz)) + (rnd() - 0.5) * 0.35;
        const pad: Rect = { x: hx, z: hz, yaw, hx: tiles + 1.3 + extra, hz: 2 + 1.3 };
        if (!free(pad, 2.5)) continue;
        // Level enough to build on, and dry.
        const hs: number[] = [];
        for (const [px, pz] of [...corners(pad), [hx, hz] as [number, number]]) hs.push(g.height(px, pz));
        const lo = Math.min(...hs), hi = Math.max(...hs);
        if (hi - lo > 2.4 || corners(pad, 3).some(([px, pz]) => !dry(px, pz))) continue;
        // The path from the door, bending a little, to the square's edge.
        const doorX = -tiles + 1;
        const [dx, dz] = world(pad, doorX, -2.9);
        const toSq = Math.atan2(dz - z, dx - x);
        const ex = x + Math.cos(toSq) * (sq.r - 0.5), ez = z + Math.sin(toSq) * (sq.r - 0.5);
        const mx = (dx + ex) / 2 + (rnd() - 0.5) * 2.5, mz = (dz + ez) / 2 + (rnd() - 0.5) * 2.5;
        const path: Seg[] = [{ ax: dx, az: dz, bx: mx, bz: mz, w: 1.5 }, { ax: mx, az: mz, bx: ex, bz: ez, w: 1.5 }];
        if (rects().some((o) => path.some((s) => segHits(s, o, 0.4)))) continue;
        const level = hs.reduce((s, h) => s + h, 0) / hs.length;
        v.pads.push({ ...pad, level });
      // (The square's things settle on the ground as it now lies.)
      for (const pc of v.pieces) {
        if (Math.hypot(pc.x - x, pc.z - z) < sq.r + 8 && ['well', 'campfire', 'bench', 'barrel'].includes(pc.type)) pc.y = ground(pc.x, pc.z) - (pc.type === 'well' ? 0.05 : 0);
      }
        v.paths.push(...path);
        const house: House = { x: hx, z: hz, yaw, y: level, tiles, role, door: { x: dx, z: dz }, route: [{ x: dx, z: dz }, { x: mx, z: mz }, { x: ex, z: ez }], beds: [], chest: { x: hx, z: hz } };
        v.houses.push(house);
        this.house(v, house, logs, rnd);
        break;
      }
    }

    // Pens behind the herders' houses (and sometimes others), fields out past the houses.
    for (const h of v.houses) {
      if (h.role !== 'shepherd' && !(h.role === 'butcher' || rnd() < 0.2)) continue;
      const [px, pz] = world(h, 0, 2 + 1.3 + 1.8 + 3);
      const pen: Rect = { x: px, z: pz, yaw: h.yaw, hx: 3, hz: 3 };
      if (!free(pen, 1.5) || !inCell(px, pz)) continue;
      const hs = corners(pen).map(([qx, qz]) => g.height(qx, qz));
      if (Math.max(...hs) - Math.min(...hs) > 1.6 || corners(pen, 1).some(([qx, qz]) => !dry(qx, qz))) continue;
      v.pens.push(pen);
      h.pen = pen;
      for (const [lx, lz, yaw] of [[-2, -3, 0], [0, -3, 0], [2, -3, 0], [-2, 3, 0], [0, 3, 0], [2, 3, 0], [-3, -2, Math.PI / 2], [-3, 0, Math.PI / 2], [-3, 2, Math.PI / 2], [3, -2, Math.PI / 2], [3, 0, Math.PI / 2], [3, 2, Math.PI / 2]] as const) {
        const [fx, fz] = world(pen, lx, lz);
        const gate = lx === 3 && lz === 0;
        v.pieces.push({ type: gate ? 'gate' : 'fence', x: fx, y: ground(fx, fz) - 0.04, z: fz, yaw: h.yaw + yaw });
      }
      // A trough of water for the animals.
      const [tx, tz] = world(pen, -1.8, 1.8);
      v.pieces.push({ type: 'quench_trough', x: tx, y: ground(tx, tz), z: tz, yaw: h.yaw });
    }
    const fieldCount = 2 + Math.floor(rnd() * 3);
    for (let k = 0, tries = 0; k < fieldCount && tries < 40; tries++) {
      const a = rnd() * Math.PI * 2, hz = 5 + rnd() * 4, hx = 3.5 + rnd() * 2.5;
      const r = sq.r + spread + 6 + hz + rnd() * 10;
      const fx = x + Math.cos(a) * r, fz = z + Math.sin(a) * r;
      // Long side running out from the village.
      const f: Rect = { x: fx, z: fz, yaw: Math.atan2(Math.cos(a), Math.sin(a)) + (rnd() - 0.5) * 0.5, hx, hz };
      if (!corners(f).every(([qx, qz]) => inCell(qx, qz)) || !free(f, 2)) continue;
      const hs = [...corners(f), [fx, fz] as [number, number]].map(([qx, qz]) => g.height(qx, qz));
      if (Math.max(...hs) - Math.min(...hs) > 3.5 || corners(f, 2).some(([qx, qz]) => !dry(qx, qz))) continue;
      v.fields.push(f);
      k++;
    }

    // The square: a well in the middle, a fire and benches to sit round of an evening.
    v.pieces.push({ type: 'well', x, y: ground(x, z) - 0.05, z, yaw: rnd() * Math.PI * 2 });
    const fa = rnd() * Math.PI * 2;
    const fx = x + Math.cos(fa) * 3.6, fz = z + Math.sin(fa) * 3.6;
    v.pieces.push({ type: 'campfire', x: fx, y: ground(fx, fz), z: fz, yaw: 0 });
    v.fire = { x: fx, z: fz };
    for (const off of [-0.7, 0.7]) {
      const bx = fx + Math.cos(fa + off * 1.6) * 1.8, bz = fz + Math.sin(fa + off * 1.6) * 1.8;
      const byaw = Math.atan2(bx - fx, bz - fz) + Math.PI / 2;
      v.pieces.push({ type: 'bench', x: bx, y: ground(bx, bz), z: bz, yaw: byaw });
      v.benches.push({ x: bx, z: bz, yaw: byaw });
    }
    const ba = fa + Math.PI * (0.6 + rnd() * 0.8);
    const bx = x + Math.cos(ba) * (sq.r - 0.8), bz = z + Math.sin(ba) * (sq.r - 0.8);
    v.pieces.push({ type: 'barrel', x: bx, y: ground(bx, bz), z: bz, yaw: rnd() * 6 });

    // The storehouse: on the square's edge, where no path comes in (always planned last,
    // so the pieces before it keep their numbers).
    {
      const starts = v.paths.filter((s) => Math.hypot(s.ax - x, s.az - z) < sq.r + 1).map((s) => Math.atan2(s.az - z, s.ax - x));
      starts.push(fa);
      let best = 0, gap = -1;
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        let g = Math.PI;
        for (const s of starts) { let d = Math.abs(a - s) % (Math.PI * 2); if (d > Math.PI) d = Math.PI * 2 - d; g = Math.min(g, d); }
        if (g > gap) { gap = g; best = a; }
      }
      const d = sq.r + 1.6, stx = x + Math.cos(best) * d, stz = z + Math.sin(best) * d;
      // Its open front (local -z) toward the well.
      const syaw = Math.atan2(-(x - stx), -(z - stz));
      v.store = { x: stx, z: stz, yaw: syaw };
      // Levelled to stand on.
      const pad: Rect = { x: stx, z: stz, yaw: syaw, hx: 1.9, hz: 1.4 };
      const hs = [...corners(pad), [stx, stz] as [number, number]].map(([qx, qz]) => g.height(qx, qz));
      const level = hs.reduce((a, b) => a + b, 0) / hs.length;
      v.pads.push({ ...pad, level });
      this.storePiece = { type: 'village_store', x: stx, y: level, z: stz, yaw: syaw };
    }
    // How far it all reaches.
    let reach = sq.r;
    for (const r of rects()) for (const [qx, qz] of corners(r)) reach = Math.max(reach, Math.hypot(qx - x, qz - z));
    for (const s of v.paths) reach = Math.max(reach, Math.hypot(s.bx - x, s.bz - z) + s.w);
    v.r = reach + FALL;
    if (this.storePiece) { v.pieces.push(this.storePiece); this.storePiece = undefined; }
    return v;
  }

  /** A house's pieces: floor, walls with a door and windows, a pitched roof with gables, a bed, a chest, a table. */
  private house(v: Village, h: House, logs: boolean, rnd: () => number) {
    const n = h.tiles, y0 = h.y;
    const put = (type: string, lx: number, ly: number, lz: number, yaw: number) => {
      const [x, z] = world(h, lx, lz);
      v.pieces.push({ type, x, y: y0 + ly, z, yaw: h.yaw + yaw });
    };
    const wall = logs ? 'log_wall' : 'wood_wall';
    const half = Math.PI / 2;
    const doorX = -n + 1;
    for (let i = 0; i < n; i++) {
      const lx = -n + 1 + i * 2;
      put('floor', lx, 0, -1, 0);
      put('floor', lx, 0, 1, 0);
      // Front: the door, then windows; back: a window in the middle.
      put(lx === doorX ? 'door' : 'window_wall', lx, 0.2, -2, 0);
      put(i === Math.floor(n / 2) ? 'window_wall' : wall, lx, 0.2, 2, Math.PI);
      put('roof', lx, 2.2, -1, 0);
      put('roof', lx, 2.2, 1, Math.PI);
    }
    for (const side of [-1, 1]) {
      put(side === 1 && rnd() < 0.5 ? 'window_wall' : wall, side * n, 0.2, -1, half);
      put(wall, side * n, 0.2, 1, half);
      put('gable', side * n, 2.2, -1, -half);
      put('gable', side * n, 2.2, 1, half);
    }
    // Inside: beds along the far end, a chest in the back corner, a table by the door.
    const beds = n === 3 ? [n - 0.8, n - 2.2] : [n - 0.8];
    for (const bx of beds) {
      put('bed', bx, 0.2, 0.75, 0);
      const [x, z] = world(h, bx, 0.75);
      h.beds.push({ x, z });
    }
    put('chest', -n + 0.9, 0.2, 1.5, Math.PI);
    { const [x, z] = world(h, -n + 0.9, 1.5); h.chest = { x, z }; }
    put('table', -n + 1.6 + (n === 3 ? 0.6 : 0), 0.2, 0.3, half);
    put('stool', -n + 0.7 + (n === 3 ? 0.6 : 0), 0.2, 0.3, 0);
    // Outside: a woodcutter splits logs by the house; others sometimes keep a block too.
    if (h.role === 'woodcutter' || rnd() < 0.15) {
      const [x, z] = world(h, h.role === 'smith' ? -n - 1.7 : n + 1.7, -1);
      v.pieces.push({ type: 'chopping_block', x, y: this.shape(v, x, z, this.gen.height(x, z)), z, yaw: rnd() * 6 });
      h.block = { x, z };
    }
    // The smithy: a forge with bellows at its side, an anvil and a quench trough, on the levelled plot.
    if (h.role === 'smith') {
      const at = (lx: number, lz: number) => world(h, lx, lz);
      const [fx, fz] = at(n + 2.8, -0.6), [bx, bz] = at(n + 2.8 + 1.05, -0.6), [ax, az] = at(n + 2.4, 1.5), [tx, tz] = at(n + 3.9, 1.5);
      v.pieces.push({ type: 'forge', x: fx, y: y0, z: fz, yaw: h.yaw });
      v.pieces.push({ type: 'bellows', x: bx, y: y0, z: bz, yaw: h.yaw + Math.PI / 2 });
      v.pieces.push({ type: 'anvil', x: ax, y: y0, z: az, yaw: h.yaw + Math.PI / 2 });
      v.pieces.push({ type: 'quench_trough', x: tx, y: y0, z: tz, yaw: h.yaw });
      h.smithy = { forge: { x: fx, z: fz }, anvil: { x: ax, z: az } };
    }
  }
}
