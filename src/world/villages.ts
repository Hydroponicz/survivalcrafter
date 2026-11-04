// Settlements: rural villages (a handful of houses round a well, joined by
// dirt paths, with pens and fields about them) on the open farmland, and now
// and then a town (dense streets of one- and two-storey houses on a gravel
// grid round a market square, with a cathedral, a merchants' hall, the
// mayor's villa and the artisans' workshops), all joined up by roads.
//
// Everything here is worked out from the world seed alone (the same village,
// in the same place, every time), and only from the map maker's raw land, so
// it can be asked before any ground near it exists. The ground then takes its
// shape from it (the terrain flattens each building's plot and lays the paths,
// streets, roads and fields: see Terrain.colInfo), and the world places the
// settlement's pieces as ordinary generated objects, region by region (see
// World.loadRegion): real building pieces, which you can walk into, open,
// take apart or build onto.

import { hash2, mulberry32 } from './noise';
import { SEA, type WorldGen } from './worldgen';

/** Settlements are planned one (at most) per square of this size. */
export const VCELL = 512;
/** How far a settlement's centre keeps from its square's edges (so all of it lies inside). */
const MARGIN = 110;
/** No settlement this close to where the world began (your first camp). */
const AVOID = 320;
/** Plots blend back into the natural ground over this many metres. */
const FALL = 5;
/** Settlements this close are joined by a road. */
const LINK = 1000;
/** Town streets: the grid spacing, and the street width. */
const BLOCK = 26, STREET = 4;
/** How far out the ring street runs (to its outer edge). */
const TOWN_EDGE = BLOCK * 1.5 + STREET / 2;
/** A castle city: its palisade (across, and on the castle side), and the castle (how far from the town's centre, its half-size). */
const PAL_X = 46, PAL_N = 71, CASTLE_Z = 96, CASTLE_HALF = 22;

export type SettlementKind = 'village' | 'town' | 'city';
export interface VPiece { type: string; x: number; y: number; z: number; yaw: number }
/** A rectangle turned by `yaw` (the same turn as a piece's). */
export interface Rect { x: number; z: number; yaw: number; hx: number; hz: number }
/** A levelled plot (blending back into the land over `fall` metres: castle mounds are graded wider). */
interface Pad extends Rect { level: number; fall?: number }
export interface Seg { ax: number; az: number; bx: number; bz: number; w: number }
/** What a house is for (the work of whoever comes to live there). */
export type HouseRole = 'farmer' | 'shepherd' | 'woodcutter' | 'butcher' | 'smith' | 'elder' | 'villager'
  | 'priest' | 'mayor' | 'merchant' | 'baker' | 'carpenter'
  | 'lord' | 'noble' | 'innkeeper' | 'guard';
export interface House {
  x: number; z: number; yaw: number; y: number;
  /** Floor tiles along its length (2: a cottage, 3: a longhouse...). */
  tiles: number;
  /** Floor tiles deep (2: 4 m; halls 4: 8 m). */
  nz: number;
  stories: number;
  /** Which tile along the front the door is in (local x). */
  doorX: number;
  /** What kind of building (for the map and for talk). */
  kind: 'house' | 'cathedral' | 'hall' | 'villa' | 'bakery' | 'workshop' | 'smithy' | 'tavern' | 'keep' | 'great_hall' | 'barracks' | 'tower';
  role: HouseRole;
  /** Just outside the door. */
  door: { x: number; z: number };
  /** Its way to the square: the door, then (village) the bend and the square's edge, (town) the street. */
  route: { x: number; z: number }[];
  beds: { x: number; z: number }[];
  /** Where its chest stands. */
  chest: { x: number; z: number };
  /** A chopping block outside, if it has one. */
  block?: { x: number; z: number };
  /** The smith's forge and anvil. */
  smithy?: { forge: { x: number; z: number }; anvil: { x: number; z: number } };
  /** The baker's quern and oven fire. */
  bakery?: { quern: { x: number; z: number }; oven: { x: number; z: number } };
  /** The carpenter's workbench. */
  bench?: { x: number; z: number };
  /** Inside, somewhere to stand and work or pray (the cathedral's altar). */
  altar?: { x: number; z: number };
  /** Its animal pen, if it keeps one. */
  pen?: Rect;
  /** A tavern's bar (where the innkeeper serves) and hearth. */
  bar?: { x: number; z: number };
  hearth?: { x: number; z: number };
}
export interface Village {
  kind: SettlementKind;
  /** Its square on the settlement grid. */
  cx: number; cz: number;
  name: string;
  x: number; z: number;
  /** Everything of it lies within this distance of its centre. */
  r: number;
  square: { x: number; z: number; r: number };
  /** The storehouse (the shared stores), facing out onto the square. */
  store?: { x: number; z: number; yaw: number };
  /** The campfire in the square, and the benches round it. */
  fire: { x: number; z: number };
  benches: { x: number; z: number; yaw: number }[];
  houses: House[];
  pads: Pad[];
  pens: Rect[];
  fields: Rect[];
  paths: Seg[];
  /** Gravel streets and squares (towns). */
  paved: Rect[];
  /** A town's street grid: its frame (streets run along its local x and z). */
  grid?: { x: number; z: number; yaw: number };
  /** Market stalls (where merchants stand). */
  stalls: { x: number; z: number; yaw: number }[];
  /** A city's castle on its hill: its frame (centre, facing the town) and half-size. */
  castle?: { x: number; z: number; yaw: number; half: number };
  /** A city's road up to the castle: from the town's streets, to the gatehouse, into the bailey. */
  upper?: { x: number; z: number }[];
  /** The gates (in the town's palisade, and the castle's): where the guards stand. */
  gates: { x: number; z: number }[];
  pieces: VPiece[];
}

/** Where a settlement will be (worked out before its layout, so roads can be planned between them). */
interface Site { cx: number; cz: number; x: number; z: number; kind: SettlementKind; yaw: number }

// ---------- rectangle helpers (local frame as in world.toLocal)
function local(r: { x: number; z: number; yaw: number }, x: number, z: number): [number, number] {
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
export function segDist(s: Seg, x: number, z: number): number {
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
const TOWN_LAST = ['bridge', 'minster', 'chester', 'borough', 'port', 'castle', 'haven', 'market'];
function settlementName(rnd: () => number, kind: SettlementKind): string {
  const a = FIRST[Math.floor(rnd() * FIRST.length)];
  let b = LAST[Math.floor(rnd() * LAST.length)];
  // (A town takes a grander ending; the same number of draws either way.)
  const t = TOWN_LAST[Math.floor(rnd() * TOWN_LAST.length)];
  if (kind !== 'village') b = t;
  if (a.toLowerCase().endsWith(b[0])) b = b.slice(1);
  return a + b;
}

const cellKey = (cx: number, cz: number) => `${cx},${cz}`;

/** The settlements of a world: planned as they're first asked about, then remembered. */
export class Villages {
  private cells = new Map<string, Village | null>();
  private sites = new Map<string, Site | null>();
  /** Places settlements keep away from (where the world began). Set before anything is asked. */
  private avoid: { x: number; z: number }[] = [];
  private ready = false;
  /** Roads, by the pair of settlements they join; and in 64 m buckets for finding them. */
  private roads = new Map<string, Seg[]>();
  private roadBuckets = new Map<string, Seg[]>();
  private linked = new Set<string>();

  constructor(private gen: WorldGen) {}

  /** Keep settlements away from these points; until this is called, there are none (nothing is planned yet). */
  settle(avoid: { x: number; z: number }[]) {
    if (this.ready && JSON.stringify(avoid) === JSON.stringify(this.avoid)) return;
    this.avoid = avoid.map((p) => ({ x: p.x, z: p.z }));
    this.ready = true;
    this.cells.clear();
    this.sites.clear();
    this.roads.clear();
    this.roadBuckets.clear();
    this.linked.clear();
  }

  /** The settlement planned in a grid square (or null), planning it if need be. */
  inCell(cx: number, cz: number): Village | null {
    if (!this.ready) return null;
    const key = cellKey(cx, cz);
    let v = this.cells.get(key);
    if (v === undefined) {
      const s = this.site(cx, cz);
      v = s ? this.layout(s) : null;
      this.cells.set(key, v);
    }
    return v;
  }

  /** The settlement a point is in or near (within its reach), if any. */
  at(x: number, z: number, grow = 0): Village | null {
    const v = this.inCell(Math.floor(x / VCELL), Math.floor(z / VCELL));
    return v && Math.hypot(x - v.x, z - v.z) < v.r + grow ? v : null;
  }

  /** Settlements already planned (cheap: nothing new is worked out). */
  known(): Village[] {
    return [...this.cells.values()].filter((v): v is Village => !!v);
  }

  /** Settlements whose square lies within `r` of a point (planning any not yet worked out). */
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

  // ---------- roads
  /** The settlements a settlement has roads to. */
  neighbours(v: Village): Village[] {
    const me = this.site(v.cx, v.cz);
    if (!me) return [];
    return this.siteLinks(me).map((s) => this.inCell(s.cx, s.cz)).filter((x): x is Village => !!x);
  }

  /** Sites within road distance of a site. */
  private siteLinks(s: Site): Site[] {
    const out: Site[] = [];
    const reach = Math.ceil(LINK / VCELL);
    for (let cz = s.cz - reach; cz <= s.cz + reach; cz++) {
      for (let cx = s.cx - reach; cx <= s.cx + reach; cx++) {
        if (cx === s.cx && cz === s.cz) continue;
        const o = this.site(cx, cz);
        if (o && Math.hypot(o.x - s.x, o.z - s.z) < LINK) out.push(o);
      }
    }
    return out;
  }

  /** Where the road toward a point leaves a settlement: its inner end (at the square, or a town street's end) and its outer end. */
  private exit(s: Site, toward: { x: number; z: number }): { inner: { x: number; z: number }[]; out: { x: number; z: number } } {
    const a = Math.atan2(toward.z - s.z, toward.x - s.x);
    if (s.kind === 'village') {
      const inner = { x: s.x + Math.cos(a) * 6, z: s.z + Math.sin(a) * 6 };
      return { inner: [inner], out: { x: s.x + Math.cos(a) * 58, z: s.z + Math.sin(a) * 58 } };
    }
    // A town: out along one of the four streets off the market square, through the ring street.
    const [lx, lz] = local(s, toward.x, toward.z);
    let alongX = Math.abs(lx) > Math.abs(lz), sg = Math.sign(alongX ? lx : lz) || 1;
    // (A city's castle is up behind its north side: roads leave it east, west or south.)
    if (s.kind === 'city' && !alongX && sg > 0) { alongX = true; sg = Math.sign(lx) || 1; }
    const street = BLOCK / 2;
    const pt = (u: number, w: number) => { const [x, z] = alongX ? world(s, u, w) : world(s, w, u); return { x, z }; };
    return { inner: [pt(sg * (BLOCK / 2 - 3), street), pt(sg * TOWN_EDGE, street)], out: pt(sg * (TOWN_EDGE + 18), street) };
  }

  /** The road between two sites: a gently wandering line from one's exit to the other's. */
  private road(a: Site, b: Site): Seg[] {
    const key = [cellKey(a.cx, a.cz), cellKey(b.cx, b.cz)].sort().join('|');
    let segs = this.roads.get(key);
    if (segs) return segs;
    const [p, q] = cellKey(a.cx, a.cz) < cellKey(b.cx, b.cz) ? [a, b] : [b, a];
    const ep = this.exit(p, q), eq = this.exit(q, p);
    const pts: { x: number; z: number }[] = [...ep.inner, ep.out];
    const len = Math.hypot(eq.out.x - ep.out.x, eq.out.z - ep.out.z);
    const n = Math.max(1, Math.round(len / 45));
    const nx = -(eq.out.z - ep.out.z) / (len || 1), nz = (eq.out.x - ep.out.x) / (len || 1);
    const seed = hash2(p.cx * 31 + q.cx, p.cz * 37 + q.cz, 913);
    for (let i = 1; i < n; i++) {
      const t = i / n, wob = (hash2(i, Math.floor(seed * 1e6), 5) - 0.5) * 16 * Math.sin(Math.PI * t);
      pts.push({ x: ep.out.x + (eq.out.x - ep.out.x) * t + nx * wob, z: ep.out.z + (eq.out.z - ep.out.z) * t + nz * wob });
    }
    pts.push(eq.out, ...[...eq.inner].reverse());
    segs = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push({ ax: pts[i].x, az: pts[i].z, bx: pts[i + 1].x, bz: pts[i + 1].z, w: 2.6 });
    this.roads.set(key, segs);
    // (Indexed by the 64 m squares each part of it crosses.)
    for (const sg of segs) {
      const x0 = Math.floor((Math.min(sg.ax, sg.bx) - 4) / 64), x1 = Math.floor((Math.max(sg.ax, sg.bx) + 4) / 64);
      const z0 = Math.floor((Math.min(sg.az, sg.bz) - 4) / 64), z1 = Math.floor((Math.max(sg.az, sg.bz) + 4) / 64);
      for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
        const k = `${bx},${bz}`;
        const list = this.roadBuckets.get(k) ?? [];
        list.push(sg);
        this.roadBuckets.set(k, list);
      }
    }
    return segs;
  }

  /** Lay out the roads of every site whose roads could reach a point. */
  private ensureRoads(x: number, z: number) {
    const cx = Math.floor(x / VCELL), cz = Math.floor(z / VCELL), reach = Math.ceil(LINK / VCELL / 2) + 1;
    for (let j = cz - reach; j <= cz + reach; j++) {
      for (let i = cx - reach; i <= cx + reach; i++) {
        const k = cellKey(i, j);
        if (this.linked.has(k)) continue;
        this.linked.add(k);
        const s = this.site(i, j);
        if (s) for (const o of this.siteLinks(s)) this.road(s, o);
      }
    }
  }

  /** Road segments passing within `r` of a point. */
  roadsNear(x: number, z: number, r: number): Seg[] {
    if (!this.ready) return [];
    this.ensureRoads(x, z);
    const out = new Set<Seg>();
    for (let bz = Math.floor((z - r) / 64); bz <= Math.floor((z + r) / 64); bz++) {
      for (let bx = Math.floor((x - r) / 64); bx <= Math.floor((x + r) / 64); bx++) {
        for (const s of this.roadBuckets.get(`${bx},${bz}`) ?? []) if (segDist(s, x, z) < r + s.w) out.add(s);
      }
    }
    return [...out];
  }

  /** Roads already laid out (cheap), for the map. */
  knownRoads(): Seg[][] {
    return [...this.roads.values()];
  }

  /** The way from one settlement to another: out of the first by its streets, along the road, into the other. */
  routeBetween(a: Village, b: Village): { x: number; z: number }[] {
    const sa = this.site(a.cx, a.cz), sb = this.site(b.cx, b.cz);
    if (!sa || !sb) return [];
    const segs = this.road(sa, sb);
    const pts = [{ x: segs[0].ax, z: segs[0].az }, ...segs.map((s) => ({ x: s.bx, z: s.bz }))];
    const fwd = Math.hypot(pts[0].x - a.x, pts[0].z - a.z) < Math.hypot(pts.at(-1)!.x - a.x, pts.at(-1)!.z - a.z);
    if (!fwd) pts.reverse();
    return [{ x: a.x, z: a.z }, ...pts, { x: b.x, z: b.z }];
  }

  // ---------- what the ground and growth make of it

  /** The ground's height at a point once the settlement's plots are levelled (`h`: the natural height). */
  shape(v: Village, x: number, z: number, h: number): number {
    for (const p of v.pads) {
      const d = outside(p, x, z);
      // (On a plot it's the plot's level, whatever a neighbour's slope would make of it.)
      if (d === 0) return p.level;
      const fall = p.fall ?? FALL;
      if (d < fall) h += (p.level - h) * (1 - smooth(0, fall, d));
    }
    return h;
  }

  /** What the ground's top is made of here, if a settlement or road changes it. */
  surface(v: Village | null, x: number, z: number, roads: Seg[]): 'path' | 'street' | 'field' | null {
    const rag = (hash2(Math.floor(x * 1.4), Math.floor(z * 1.4), 77) - 0.5) * 0.4;
    if (v) {
      for (const p of v.paved) if (outside(p, x, z) < 0.15 + rag * 0.5) return 'street';
      if (v.kind === 'village' && Math.hypot(x - v.square.x, z - v.square.z) < v.square.r + rag) return 'path';
      for (const s of v.paths) if (segDist(s, x, z) < s.w / 2 + rag) return 'path';
      for (const f of v.fields) if (outside(f, x, z) === 0) return 'field';
    }
    for (const s of roads) if (segDist(s, x, z) < s.w / 2 + rag) return 'path';
    return null;
  }

  /** Whether trees and bushes stay off a spot: the buildings, pens, fields, paths, streets and square. */
  keepsClear(v: Village, x: number, z: number): boolean {
    if (Math.hypot(x - v.square.x, z - v.square.z) < v.square.r + 4) return true;
    for (const p of v.pads) if (outside(p, x, z) < 3) return true;
    for (const p of v.paved) if (outside(p, x, z) < 2) return true;
    for (const p of v.pens) if (outside(p, x, z) < 2) return true;
    for (const f of v.fields) if (outside(f, x, z) < 1.5) return true;
    for (const s of v.paths) if (segDist(s, x, z) < s.w / 2 + 1.5) return true;
    // A town keeps its whole grid clear (gardens and yards between the houses).
    if (v.grid) {
      const [lx, lz] = local(v.grid, x, z);
      if (Math.abs(lx) < TOWN_EDGE + 3 && Math.abs(lz) < TOWN_EDGE + 3) return true;
      // A city: everything inside the palisade, and the castle's hill.
      if (v.kind === 'city' && Math.abs(lx) < PAL_X + 3 && lz > -PAL_X - 3 && lz < CASTLE_Z + CASTLE_HALF + 16) return true;
    }
    return false;
  }

  /** Whether a point is on (or by) a road between settlements. */
  onRoad(x: number, z: number, margin = 1.5): boolean {
    for (const s of this.roadsNear(x, z, 4)) if (segDist(s, x, z) < s.w / 2 + margin) return true;
    return false;
  }

  /** Whether a point is inside a building (nothing grows or lies about in there). */
  indoors(x: number, z: number): boolean {
    const v = this.at(x, z);
    if (!v) return false;
    for (const p of v.pads) if (outside(p, x, z) < 0.5) return true;
    for (const p of v.pens) if (outside(p, x, z) < 0.5) return true;
    return false;
  }

  /** The settlement's pieces anchored within a square of the world. */
  piecesIn(v: Village, x0: number, z0: number, size: number): VPiece[] {
    return v.pieces.filter((p) => p.x >= x0 && p.x < x0 + size && p.z >= z0 && p.z < z0 + size);
  }

  // ---------- planning
  private rng(cx: number, cz: number) {
    return mulberry32((Math.imul(this.gen.seed, 2654435761) ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ 0x7111a6e) >>> 0);
  }

  /** Where a grid square's settlement goes (if it has one), and whether it's a town. */
  private site(cx: number, cz: number): Site | null {
    if (!this.ready) return null;
    const key = cellKey(cx, cz);
    let s = this.sites.get(key);
    if (s !== undefined) return s;
    s = null;
    const rnd = this.rng(cx, cz);
    // Now and then a castle city, where there's a hill to build the castle on and level land below it for the town.
    if (hash2(cx, cz, this.gen.seed ^ 0xc17e) < 0.1) s = this.citySite(cx, cz);
    if (!s && rnd() <= 0.42) {
      // A few spots in the square: keep the best open, level farmland.
      let best: { x: number; z: number; score: number } | null = null;
      for (let i = 0; i < 7; i++) {
        const x = cx * VCELL + MARGIN + rnd() * (VCELL - 2 * MARGIN), z = cz * VCELL + MARGIN + rnd() * (VCELL - 2 * MARGIN);
        const score = this.siteScore(x, z);
        if (score !== null && (!best || score < best.score)) best = { x, z, score };
      }
      if (best) {
        // About one settlement in five is a town, where the land is level enough for one.
        const town = hash2(cx, cz, this.gen.seed ^ 0x70e7) < 0.22 && this.townOk(best.x, best.z);
        s = { cx, cz, x: best.x, z: best.z, kind: town ? 'town' : 'village', yaw: hash2(cx, cz, 4242) * Math.PI * 2 };
      }
    }
    this.sites.set(key, s);
    return s;
  }

  /** How uneven a spot is (lower is better), or null if a settlement can't go there. */
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

  /**
   * A castle city's site: a hill, broad enough on top for the castle and
   * standing well above level land (CASTLE_Z metres off) for the town. The site
   * is the town's centre, its frame turned to face the castle.
   */
  private citySite(cx: number, cz: number): Site | null {
    const g = this.gen;
    let best: { s: Site; score: number } | null = null;
    for (let i = 0; i < 12; i++) {
      const hx = cx * VCELL + 150 + hash2(cx * 13 + i, cz, 71) * (VCELL - 300), hz = cz * VCELL + 150 + hash2(cx, cz * 17 + i, 72) * (VCELL - 300);
      if (this.avoid.some((a) => Math.hypot(a.x - hx, a.z - hz) < AVOID + 60)) continue;
      const top = g.height(hx, hz);
      if (top < SEA + 8 || !Number.isNaN(g.water(hx, hz, top))) continue;
      // A broad top.
      let broad = true;
      for (let k = 0; k < 8 && broad; k++) {
        const a = (k / 8) * Math.PI * 2, h = g.height(hx + Math.cos(a) * 16, hz + Math.sin(a) * 16);
        if (Math.abs(h - top) > 4.5) broad = false;
      }
      if (!broad) continue;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
        const tx = hx - dx * CASTLE_Z, tz = hz - dz * CASTLE_Z;
        const drop = top - g.height(tx, tz);
        if (drop < 5 || drop > 35) continue;
        // The whole city inside its square of the grid.
        const yaw = Math.atan2(dx, dz), F = { x: tx, z: tz, yaw };
        const inCell = [[-PAL_X - 4, -PAL_X - 4], [PAL_X + 4, -PAL_X - 4], [-PAL_X - 4, CASTLE_Z + CASTLE_HALF + 18], [PAL_X + 4, CASTLE_Z + CASTLE_HALF + 18]]
          .every(([lx, lz]) => { const [x, z] = world(F, lx, lz); return x > cx * VCELL + 8 && x < (cx + 1) * VCELL - 8 && z > cz * VCELL + 8 && z < (cz + 1) * VCELL - 8; });
        if (!inCell || this.siteScore(tx, tz) === null || !this.townOk(tx, tz)) continue;
        const score = Math.abs(drop - 14);
        if (!best || score < best.score) best = { s: { cx, cz, x: tx, z: tz, kind: 'city', yaw }, score };
      }
    }
    return best?.s ?? null;
  }

  /** Is the land level and dry enough, wide enough, for a town's streets? */
  private townOk(x: number, z: number): boolean {
    const g = this.gen, h = g.height(x, z);
    for (const r of [25, 45, 62]) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const ph = g.height(px, pz);
        if (!Number.isNaN(g.water(px, pz, ph)) || Math.abs(ph - h) / r > 0.1) return false;
      }
    }
    return true;
  }

  private layout(s: Site): Village {
    // (The same random draws as choosing the site, then on from there.)
    const rnd = this.rng(s.cx, s.cz);
    for (let i = 0; i < 15; i++) rnd();
    const v: Village = {
      kind: s.kind, cx: s.cx, cz: s.cz, name: settlementName(rnd, s.kind), x: s.x, z: s.z, r: 0, square: { x: s.x, z: s.z, r: 5 + rnd() * 1.5 },
      fire: { x: s.x, z: s.z }, benches: [], houses: [], pads: [], pens: [], fields: [], paths: [], paved: [], stalls: [], gates: [], pieces: [],
    };
    const links = this.siteLinks(s);
    if (s.kind === 'town') this.layoutTown(v, s, links, rnd);
    else if (s.kind === 'city') { this.layoutTown(v, s, links, rnd, true); this.layoutCity(v, rnd); }
    else this.layoutVillage(v, s, links, rnd);
    // How far it all reaches.
    let reach = v.square.r;
    for (const r of [...v.pads, ...v.pens, ...v.fields, ...v.paved]) for (const [qx, qz] of corners(r)) reach = Math.max(reach, Math.hypot(qx - v.x, qz - v.z));
    for (const sg of v.paths) reach = Math.max(reach, Math.hypot(sg.bx - v.x, sg.bz - v.z) + sg.w);
    v.r = reach + FALL;
    return v;
  }

  private ground(v: Village, x: number, z: number) {
    return this.shape(v, x, z, this.gen.height(x, z));
  }

  /** Level a plot for a building (or anything): returns its level. */
  private pad(v: Village, r: Rect): number {
    const hs = [...corners(r), [r.x, r.z] as [number, number]].map(([qx, qz]) => this.gen.height(qx, qz));
    const level = hs.reduce((a, b) => a + b, 0) / hs.length;
    v.pads.push({ ...r, level });
    return level;
  }

  // ---------- villages
  private layoutVillage(v: Village, s: Site, links: Site[], rnd: () => number) {
    const g = this.gen, { x, z } = v, sq = v.square;
    const ground = (px: number, pz: number) => this.ground(v, px, pz);
    const dry = (px: number, pz: number) => Number.isNaN(g.water(px, pz, g.height(px, pz)));
    const rects = (): Rect[] => [...v.pads, ...v.pens, ...v.fields];
    const free = (r: Rect, gap: number) => rects().every((o) => !overlaps(o, r, gap)) && v.paths.every((sg) => !segHits(sg, r, 0.6))
      && outside(r, sq.x, sq.z) > sq.r + 1.5;
    const lim = VCELL / 2 + (MARGIN - 10);
    const inCell = (px: number, pz: number) => Math.abs(px - (s.cx + 0.5) * VCELL) < lim && Math.abs(pz - (s.cz + 0.5) * VCELL) < lim;
    const n = 5 + Math.floor(rnd() * 8);
    const spread = 6 + n * 1.9;
    const logs = rnd() < 0.6;

    // Roads leading out of the village, toward its neighbours (or a lane or two out into the country),
    // laid first so the houses keep off them.
    const roads = 1 + Math.floor(rnd() * 2), a0 = rnd() * Math.PI * 2;
    const dirs = links.length ? links.map((o) => Math.atan2(o.z - z, o.x - x)) : Array.from({ length: roads }, (_, k) => a0 + k * Math.PI);
    for (let k = 0; k < roads; k++) rnd();
    for (const a of dirs) {
      // (Straight: the road between settlements comes in the same way.)
      const e = this.exit(s, { x: x + Math.cos(a), z: z + Math.sin(a) });
      v.paths.push({ ax: e.inner[0].x, az: e.inner[0].z, bx: e.out.x, bz: e.out.z, w: 2.6 });
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
        const hs = [...corners(pad), [hx, hz] as [number, number]].map(([px, pz]) => g.height(px, pz));
        if (Math.max(...hs) - Math.min(...hs) > 2.4 || corners(pad, 3).some(([px, pz]) => !dry(px, pz))) continue;
        // The path from the door, bending a little, to the square's edge.
        const doorX = -tiles + 1;
        const [dx, dz] = world(pad, doorX, -2.9);
        const toSq = Math.atan2(dz - z, dx - x);
        const ex = x + Math.cos(toSq) * (sq.r - 0.5), ez = z + Math.sin(toSq) * (sq.r - 0.5);
        const mx = (dx + ex) / 2 + (rnd() - 0.5) * 2.5, mz = (dz + ez) / 2 + (rnd() - 0.5) * 2.5;
        const path: Seg[] = [{ ax: dx, az: dz, bx: mx, bz: mz, w: 1.5 }, { ax: mx, az: mz, bx: ex, bz: ez, w: 1.5 }];
        if (rects().some((o) => path.some((sg) => segHits(sg, o, 0.4)))) continue;
        const level = this.pad(v, pad);
        v.paths.push(...path);
        const house = this.newHouse(hx, hz, yaw, level, tiles, 2, 1, 'house', role);
        house.door = { x: dx, z: dz };
        house.route = [{ x: dx, z: dz }, { x: mx, z: mz }, { x: ex, z: ez }];
        v.houses.push(house);
        this.building(v, house, { ground: logs ? 'log_wall' : 'wood_wall', upper: 'wood_wall', windows: 0.5 }, rnd);
        this.furnish(v, house, tiles === 3 ? 2 : 1);
        this.yard(v, house, rnd);
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
      this.fenceRect(v, pen, h.yaw, [3, 0]);
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

    // The storehouse: on the square's edge, where no path comes in.
    const fa = rnd() * Math.PI * 2;
    {
      const starts = v.paths.filter((sg) => Math.hypot(sg.ax - x, sg.az - z) < sq.r + 1).map((sg) => Math.atan2(sg.az - z, sg.ax - x));
      starts.push(fa);
      let best = 0, gap = -1;
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        let gg = Math.PI;
        for (const st of starts) { let d = Math.abs(a - st) % (Math.PI * 2); if (d > Math.PI) d = Math.PI * 2 - d; gg = Math.min(gg, d); }
        if (gg > gap) { gap = gg; best = a; }
      }
      const d = sq.r + 1.6, stx = x + Math.cos(best) * d, stz = z + Math.sin(best) * d;
      // Its open front (local -z) toward the well.
      const syaw = Math.atan2(-(x - stx), -(z - stz));
      v.store = { x: stx, z: stz, yaw: syaw };
      const level = this.pad(v, { x: stx, z: stz, yaw: syaw, hx: 1.9, hz: 1.4 });
      v.pieces.push({ type: 'village_store', x: stx, y: level, z: stz, yaw: syaw });
    }
    // The square: a well in the middle, a fire and benches to sit round of an evening.
    v.pieces.push({ type: 'well', x, y: ground(x, z) - 0.05, z, yaw: rnd() * Math.PI * 2 });
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
  }

  // ---------- towns
  /**
   * A town: a market square in the middle of a grid of gravel streets, its
   * blocks lined with houses (many of two storeys) facing the streets; the
   * cathedral, the merchants' hall and the mayor's villa on the square, the
   * baker, carpenter and smith among the houses.
   */
  private layoutTown(v: Village, s: Site, links: Site[], rnd: () => number, city = false) {
    const F = { x: s.x, z: s.z, yaw: s.yaw };
    v.grid = F;
    const at = (lx: number, lz: number) => world(F, lx, lz);
    const half = BLOCK / 2, ring = BLOCK * 1.5;
    // The market square, and the streets: two each way round it, and the ring.
    v.square = { x: s.x, z: s.z, r: half - STREET / 2 };
    v.paved.push({ x: s.x, z: s.z, yaw: F.yaw, hx: half, hz: half });
    for (const u of [-ring, -half, half, ring]) {
      const [ax, az] = at(u, 0), [bx, bz] = at(0, u);
      v.paved.push({ x: ax, z: az, yaw: F.yaw, hx: STREET / 2, hz: TOWN_EDGE }, { x: bx, z: bz, yaw: F.yaw, hx: TOWN_EDGE, hz: STREET / 2 });
    }
    // Roads out: each joins the ring street, out along a street off the square.
    for (const o of links) {
      const e = this.exit(s, o);
      const last = e.inner.at(-1)!;
      v.paths.push({ ax: last.x, az: last.z, bx: e.out.x, bz: e.out.z, w: 2.6 });
    }
    // A building on a block: centred at (bx, bz) in the grid, its front facing `face` (a unit vector in the grid).
    const blockY = (lx: number, lz: number, yawRel: number, nx: number, nz: number, extra = 0) => {
      const [wx, wz] = at(lx, lz);
      const yaw = F.yaw + yawRel;
      const level = this.pad(v, { x: wx, z: wz, yaw, hx: nx + 0.8 + extra, hz: nz + 0.8 });
      return { wx, wz, yaw, level };
    };
    const faceYaw = (fx: number, fz: number) => Math.atan2(-fx, -fz); // local -z toward (fx, fz) in the grid
    const streetPoint = (h: House) => {
      // The street in front: out from the door to the street's middle.
      const [lx, lz] = local(F, h.door.x, h.door.z);
      const u = [-ring, -half, half, ring];
      const nearX = u.reduce((a, b) => (Math.abs(b - lx) < Math.abs(a - lx) ? b : a)), nearZ = u.reduce((a, b) => (Math.abs(b - lz) < Math.abs(a - lz) ? b : a));
      const [x, z] = Math.abs(nearX - lx) < Math.abs(nearZ - lz) ? at(nearX, lz) : at(lx, nearZ);
      return { x, z };
    };
    const addHouse = (h: House, spec: { ground: string; upper: string; windows: number }, beds: number) => {
      const [dx, dz] = world(h, h.doorX, -h.nz - 0.9);
      h.door = { x: dx, z: dz };
      const sp = streetPoint(h);
      h.route = [h.door, sp, sp];
      v.houses.push(h);
      this.building(v, h, spec, rnd);
      if (beds > 0) this.furnish(v, h, beds);
      return h;
    };
    const stone = { ground: 'stone_wall', upper: 'stone_wall', windows: 0.6 };

    // The market: a well, stalls round it, a fire and benches for the evening.
    v.pieces.push({ type: 'well', x: s.x, y: this.ground(v, s.x, s.z) - 0.05, z: s.z, yaw: F.yaw });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      const [sx, sz] = at(Math.cos(a) * 7, Math.sin(a) * 7);
      const yaw = Math.atan2(-(s.x - sx), -(s.z - sz)) + Math.PI; // its front (with the goods) outward
      v.pieces.push({ type: 'market_stall', x: sx, y: this.ground(v, sx, sz), z: sz, yaw });
      v.stalls.push({ x: sx, z: sz, yaw });
    }
    {
      const [fx, fz] = at(-3.6, 3.6);
      v.pieces.push({ type: 'campfire', x: fx, y: this.ground(v, fx, fz), z: fz, yaw: 0 });
      v.fire = { x: fx, z: fz };
      for (const [ox, oz] of [[-1.9, 0], [0, 1.9]]) {
        const [bx, bz] = at(-3.6 + ox, 3.6 + oz);
        const byaw = Math.atan2(bx - fx, bz - fz) + Math.PI / 2;
        v.pieces.push({ type: 'bench', x: bx, y: this.ground(v, bx, bz), z: bz, yaw: byaw });
        v.benches.push({ x: bx, z: bz, yaw: byaw });
      }
    }

    // North of the square: the cathedral, its nave along the street, the bell tower at its east end.
    {
      const { wx, wz, yaw, level } = blockY(-2, BLOCK, faceYaw(0, -1), 7, 4);
      const nave = this.newHouse(wx, wz, yaw, level, 7, 4, 3, 'cathedral', 'priest');
      nave.doorX = 0;
      addHouse(nave, stone, 0);
      const [tx, tz] = world(nave, 9, 0);
      const tl = this.pad(v, { x: tx, z: tz, yaw, hx: 2.6, hz: 2.6 });
      const tower = this.newHouse(tx, tz, yaw, tl, 2, 2, 6, 'cathedral', 'priest');
      tower.doorX = 99; // (no door: it's entered from the nave)
      this.building(v, tower, stone, rnd);
      // Pews down the nave facing the altar at its east end; the priest's cot in a corner.
      const put = (type: string, lx: number, lz: number, ly: number) => { const [x, z] = world(nave, lx, lz); v.pieces.push({ type, x, y: level + ly, z, yaw: yaw + Math.PI / 2 }); };
      for (const lx of [-5, -3, -1.2, 1.2, 3]) for (const lz of [-2, 2]) put('bench', lx, lz, 0.2);
      put('table', 5.6, 0, 0.2);
      const [ax, az] = world(nave, 4.4, 0);
      nave.altar = { x: ax, z: az };
      const [bx, bz] = world(nave, -6.2, 2.6);
      v.pieces.push({ type: 'bed', x: bx, y: level + 0.2, z: bz, yaw });
      nave.beds.push({ x: bx, z: bz });
    }
    // East: the merchants' hall, two storeys of stone, the town's storehouse at its door.
    {
      const { wx, wz, yaw, level } = blockY(BLOCK + 1, 0, faceYaw(-1, 0), 5, 4);
      const hall = addHouse(this.newHouse(wx, wz, yaw, level, 5, 4, 2, 'hall', 'merchant'), { ground: 'stone_wall', upper: 'wood_wall', windows: 0.7 }, 0);
      const put = (type: string, lx: number, lz: number, r = 0) => { const [x, z] = world(hall, lx, lz); v.pieces.push({ type, x, y: level + 0.2, z, yaw: yaw + r }); };
      put('dining_table', 0, 0, 0);
      for (const lx of [-3, 3]) put('chest', lx, 3.4, Math.PI);
      put('shelf', 0, 3.6, Math.PI);
      const [sx, sz] = world(hall, 2.6, -4 - 3.2);
      const syaw = yaw;
      const sl = this.pad(v, { x: sx, z: sz, yaw: syaw, hx: 1.9, hz: 1.4 });
      v.store = { x: sx, z: sz, yaw: syaw };
      v.pieces.push({ type: 'village_store', x: sx, y: sl, z: sz, yaw: syaw });
    }
    // West: the mayor's villa, with a walled garden behind.
    {
      const { wx, wz, yaw, level } = blockY(-BLOCK + 1, 0, faceYaw(1, 0), 4, 2);
      const villa = addHouse(this.newHouse(wx, wz, yaw, level, 4, 2, 2, 'villa', 'mayor'), { ground: 'stone_wall', upper: 'stone_wall', windows: 0.8 }, 1);
      const [gx, gz] = world(villa, 0, 2 + 0.8 + 3.2);
      const garden: Rect = { x: gx, z: gz, yaw, hx: 5, hz: 3 };
      v.pens.push(garden);
      this.fenceRect(v, garden, yaw, [0, -3]);
      const put = (type: string, lx: number, lz: number, r = 0) => { const [x, z] = world(garden, lx, lz); v.pieces.push({ type, x, y: this.ground(v, x, z), z, yaw: yaw + r }); };
      put('bench', -2, 1.8, Math.PI); put('bench', 2, 1.8, Math.PI);
      for (const lx of [-4, -1, 1, 4]) put('potted_plant', lx, 0.6);
    }
    // The other blocks: houses facing the streets all round, the artisans' workshops among them.
    const crafts: HouseRole[] = ['baker', 'carpenter', 'smith', 'merchant', 'merchant'];
    let homes = 0;
    const blocks: [number, number][] = [[0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [bi, bj] of blocks) {
      const cx = bi * BLOCK, cz = bj * BLOCK;
      // Sides nearest the square first (the best frontage).
      const sides: [number, number][] = ([[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][])
        .sort((a, b) => Math.hypot(cx + a[0] * 11, cz + a[1] * 11) - Math.hypot(cx + b[0] * 11, cz + b[1] * 11));
      for (const [nx, nz] of sides) {
        // A city's grand tavern: the whole frontage of the block south of the square.
        if (city && bi === 0 && bj === -1 && nx === 0 && nz === 1) {
          const { wx, wz, yaw, level } = blockY(cx, cz + (11 - 0.8 - 4), faceYaw(0, 1), 5, 4);
          const tav = this.newHouse(wx, wz, yaw, level, 5, 4, 2, 'tavern', 'innkeeper');
          tav.doorX = 1;
          addHouse(tav, { ground: 'stone_wall', upper: 'wood_wall', windows: 0.7 }, 0);
          this.tavern(v, tav);
          continue;
        }
        let t = -5.5;
        while (t < 5.5) {
          const role = crafts.shift();
          const shop = role === 'baker' || role === 'carpenter' || role === 'smith';
          const tiles = shop ? 2 : rnd() < 0.35 ? 3 : 2;
          const extra = shop ? 3.4 : 0;
          const width = tiles * 2 + extra;
          if (t + width > 5.5) { if (role) crafts.unshift(role); break; }
          // (The workshop's yard is on the house's own right: which way along the side that is depends on how it faces.)
          const yr = faceYaw(nx, nz), rightAlong = nz !== 0 ? Math.cos(yr) : -Math.sin(yr);
          const along = t + width / 2 - (rightAlong >= 0 ? 1 : -1) * extra / 2;
          // Centre: set back from the block's street edge; tangent runs along the side.
          const lx = cx + nx * (11 - 0.8 - 2) + (nz !== 0 ? along : 0) * 1, lz = cz + nz * (11 - 0.8 - 2) + (nx !== 0 ? along : 0);
          const yawRel = faceYaw(nx, nz);
          const { wx, wz, yaw, level } = blockY(lx, lz, yawRel, tiles, 2, extra);
          const stories = shop ? 1 : rnd() < 0.55 ? 2 : 1;
          const kind = role === 'baker' ? 'bakery' : role === 'carpenter' ? 'workshop' : role === 'smith' ? 'smithy' : 'house';
          // Homes for a dozen households; the rest are shops and lodgings (no one at home).
          const lived = !!role || homes < (city ? 8 : 12);
          if (!role && lived) homes++;
          const h = addHouse(this.newHouse(wx, wz, yaw, level, tiles, 2, stories, kind, role ?? 'villager'),
            { ground: rnd() < 0.4 ? 'stone_wall' : 'wood_wall', upper: 'wood_wall', windows: 0.6 }, lived ? (tiles === 3 ? 2 : 1) : 0);
          if (!lived) h.beds = [];
          this.yard(v, h, rnd);
          t += width + 1;
        }
      }
    }
  }

  /** A grand tavern's insides: a long table and benches, a hearth, a bar by the shelves, tables and stools, barrels, beds to let. */
  private tavern(v: Village, h: House) {
    const put = (type: string, lx: number, lz: number, yaw = 0) => {
      const [x, z] = world(h, lx, lz);
      v.pieces.push({ type, x, y: h.y + 0.2, z, yaw: h.yaw + yaw });
      return { x, z };
    };
    put('dining_table', 0, -0.5);
    put('bench', 0, -1.5); put('bench', 0, 0.5, Math.PI);
    put('table', 2.6, 2.4, Math.PI / 2); put('stool', 1.7, 2.4); put('stool', 3.5, 2.4);
    put('barrel', 4.4, 3.3); put('barrel', -1.5, 3.4);
    put('shelf', 0, 3.6, Math.PI);
    h.hearth = put('campfire', -3.4, 2.8);
    h.bar = (([x, z]) => ({ x, z }))(world(h, 0, 2.6));
    // Beds to let (anyone may sleep in them), and the innkeeper's own.
    for (const lx of [-3.9, 3.9]) put('bed', lx, -2.4, Math.PI / 2);
    this.furnish(v, h, 1);
  }

  /**
   * A castle city's upper parts: the castle on its hill (curtain walls with a
   * tower at each corner and a gatehouse, a keep, a great hall, the guards'
   * barracks, a well in the courtyard), the road climbing to it lined with the
   * villas of the well-to-do, and a timber palisade round the whole of the
   * town below, with gates where the roads come in.
   */
  private layoutCity(v: Village, rnd: () => number) {
    const F = v.grid!, at = (lx: number, lz: number) => { const [x, z] = world(F, lx, lz); return { x, z }; };
    const H = CASTLE_HALF;
    const C = { ...at(0, CASTLE_Z), yaw: F.yaw, half: H };
    v.castle = C;
    const cat = (lx: number, lz: number) => { const [x, z] = world(C, lx, lz); return { x, z }; };
    // The castle mound: levelled at the hilltop, graded wide.
    const level = this.gen.height(C.x, C.z);
    v.pads.push({ x: C.x, z: C.z, yaw: C.yaw, hx: H + 3, hz: H + 3, level, fall: 16 });
    v.paved.push({ x: C.x, z: C.z, yaw: C.yaw, hx: H - 1, hz: H - 1 });
    // The road up: from the town's street, out through the palisade, to the gatehouse and into the courtyard.
    const P0 = at(13, BLOCK * 1.5), P1 = cat(0, -H - 2.5), P2 = cat(0, -H + 5);
    v.upper = [P0, P1, P2];
    const len = Math.hypot(P1.x - P0.x, P1.z - P0.z), ryaw = Math.atan2(P1.x - P0.x, P1.z - P0.z);
    v.paved.push({ x: (P0.x + P1.x) / 2, z: (P0.z + P1.z) / 2, yaw: ryaw, hx: 2.2, hz: len / 2 + 1 });
    v.gates.push(P1, P2);
    // Curtain walls, three courses of stone (6 m); the gatehouse's opening in the middle of the side facing the town.
    const stoneSpec = { ground: 'stone_wall', upper: 'stone_wall', windows: 0.08, hollow: true };
    for (const [sx, sz, ry] of [[0, -1, 0], [0, 1, 0], [-1, 0, Math.PI / 2], [1, 0, Math.PI / 2]] as const) {
      for (let t = -H + 3; t <= H - 3; t += 2) {
        if (sz === -1 && Math.abs(t) < 6.5) continue;
        const p = cat(sx ? sx * H : t, sz ? sz * H : t);
        for (let k = 0; k < 3; k++) v.pieces.push({ type: 'stone_wall', x: p.x, y: level - 0.1 + k * 2, z: p.z, yaw: C.yaw + ry });
      }
    }
    // Towers at the corners, and either side of the gate.
    const tower = (lx: number, lz: number, stories: number) => {
      const p = cat(lx, lz);
      const t = this.newHouse(p.x, p.z, C.yaw, level, 2, 2, stories, 'tower', 'guard');
      t.doorX = 99;
      this.building(v, t, stoneSpec, rnd);
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower(sx * H, sz * H, 5);
    tower(-4, -H, 4); tower(4, -H, 4);
    // Inside: the keep, the great hall, the barracks.
    const inside = (lx: number, lz: number, faceX: number, faceZ: number, tiles: number, nz: number, stories: number, kind: House['kind'], role: HouseRole) => {
      const p = cat(lx, lz);
      const h = this.newHouse(p.x, p.z, C.yaw + Math.atan2(-faceX, -faceZ), level, tiles, nz, stories, kind, role);
      const [dx, dz] = world(h, h.doorX, -h.nz - 0.9);
      h.door = { x: dx, z: dz };
      h.route = [h.door, h.door, h.door];
      v.houses.push(h);
      return h;
    };
    const keep = inside(0, 9, 0, -1, 4, 4, 4, 'keep', 'lord');
    keep.doorX = 1;
    { const [dx, dz] = world(keep, keep.doorX, -keep.nz - 0.9); keep.door = { x: dx, z: dz }; keep.route = [keep.door, keep.door, keep.door]; }
    this.building(v, keep, { ground: 'stone_wall', upper: 'stone_wall', windows: 0.15 }, rnd);
    this.furnish(v, keep, 1);
    const hall = inside(10, -6, -1, 0, 5, 4, 2, 'great_hall', 'lord');
    this.building(v, hall, { ground: 'stone_wall', upper: 'stone_wall', windows: 0.5 }, rnd);
    {
      const put = (type: string, lx: number, lz: number, yaw = 0) => { const [x, z] = world(hall, lx, lz); v.pieces.push({ type, x, y: level + 0.2, z, yaw: hall.yaw + yaw }); };
      put('dining_table', 0, 0); put('bench', 0, -1, 0); put('bench', 0, 1, Math.PI);
      put('armchair', 3, 0, -Math.PI / 2);
      put('hide_rug', -2.5, 0);
    }
    const barracks = inside(-12, -8, 1, 0, 3, 2, 2, 'barracks', 'guard');
    this.building(v, barracks, { ground: 'stone_wall', upper: 'wood_wall', windows: 0.3 }, rnd);
    this.furnish(v, barracks, 2);
    { const p = cat(-4, -5); v.pieces.push({ type: 'well', x: p.x, y: level - 0.05, z: p.z, yaw: C.yaw }); }
    { const p = cat(5, 6); v.pieces.push({ type: 'campfire', x: p.x, y: level, z: p.z, yaw: 0 }); }

    // The villas of the well-to-do, either side of the road up.
    const dirX = (P1.x - P0.x) / len, dirZ = (P1.z - P0.z) / len;
    for (const t of [0.36, 0.68]) {
      for (const side of [-1, 1]) {
        const cx = P0.x + (P1.x - P0.x) * t + dirZ * side * 9, cz = P0.z + (P1.z - P0.z) * t - dirX * side * 9;
        // Front toward the road.
        const yaw = Math.atan2(-(dirZ * side * -1), -(-dirX * side * -1));
        const vl = this.pad(v, { x: cx, z: cz, yaw, hx: 3.8, hz: 2.8 });
        const h = this.newHouse(cx, cz, yaw, vl, 3, 2, t > 0.5 ? 3 : 2, 'villa', 'noble');
        const [dx, dz] = world(h, h.doorX, -h.nz - 0.9);
        h.door = { x: dx, z: dz };
        h.route = [h.door, h.door, h.door];
        v.houses.push(h);
        this.building(v, h, { ground: 'stone_wall', upper: 'stone_wall', windows: 0.8 }, rnd);
        this.furnish(v, h, 2);
      }
    }

    // The palisade: two courses of logs round the town and the villas, gates where roads come in (an opening under a lintel).
    const gaps: { side: number; at: number }[] = [];
    const sides: [number, number, number, number][] = [[-PAL_X, -PAL_X, PAL_X, -PAL_X], [PAL_X, -PAL_X, PAL_X, PAL_N], [PAL_X, PAL_N, -PAL_X, PAL_N], [-PAL_X, PAL_N, -PAL_X, -PAL_X]];
    const toGrid = (p: { x: number; z: number }) => local(F, p.x, p.z);
    const crossings = [...v.paths.map((sg) => [toGrid({ x: sg.ax, z: sg.az }), toGrid({ x: sg.bx, z: sg.bz })]), [toGrid(P0), toGrid(P1)]];
    sides.forEach(([x0, z0, x1, z1], si) => {
      for (const [[ax, az], [bx, bz]] of crossings) {
        // Where a road crosses this side (in the grid's frame).
        const d1x = x1 - x0, d1z = z1 - z0, d2x = bx - ax, d2z = bz - az, den = d1x * d2z - d1z * d2x;
        if (Math.abs(den) < 1e-6) continue;
        const u = ((ax - x0) * d2z - (az - z0) * d2x) / den, w = ((ax - x0) * d1z - (az - z0) * d1x) / den;
        if (u > 0 && u < 1 && w >= 0 && w <= 1) gaps.push({ side: si, at: u * Math.hypot(d1x, d1z) });
      }
    });
    sides.forEach(([x0, z0, x1, z1], si) => {
      const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      const ry = Math.abs(uz) > 0.5 ? Math.PI / 2 : 0;
      for (let d = 1; d < L; d += 2) {
        const gap = gaps.find((g) => g.side === si && Math.abs(g.at - d) < 2.6);
        const p = at(x0 + ux * d, z0 + uz * d);
        const gy = this.ground(v, p.x, p.z) - 0.1;
        // A gate: open below, a course of logs across the top, posts either side.
        if (gap) { v.pieces.push({ type: 'log_wall', x: p.x, y: gy + 2, z: p.z, yaw: F.yaw + ry }); continue; }
        for (let k = 0; k < 2; k++) v.pieces.push({ type: 'log_wall', x: p.x, y: gy + k * 2, z: p.z, yaw: F.yaw + ry });
      }
      for (const g of gaps.filter((gg) => gg.side === si)) {
        const p = at(x0 + ux * g.at, z0 + uz * g.at);
        v.gates.push(p);
      }
    });
  }

  // ---------- buildings
  private newHouse(x: number, z: number, yaw: number, y: number, tiles: number, nz: number, stories: number, kind: House['kind'], role: HouseRole): House {
    return { x, z, yaw, y, tiles, nz, stories, doorX: -tiles + 1, kind, role, door: { x, z }, route: [], beds: [], chest: { x, z } };
  }

  /**
   * A building of real pieces: floors, walls (a door in front, windows here and
   * there), storey on storey, and a pitched roof (ridge along its length) with
   * its gable ends filled in. Any width; any depth in 4 m steps.
   */
  private building(v: Village, h: House, spec: { ground: string; upper: string; windows: number; hollow?: boolean }, rnd: () => number) {
    const nx = h.tiles, nz = h.nz, half = Math.PI / 2;
    const put = (type: string, lx: number, ly: number, lz: number, yaw: number) => {
      const [x, z] = world(h, lx, lz);
      v.pieces.push({ type, x, y: h.y + ly, z, yaw: h.yaw + yaw });
    };
    const top = h.stories * 2.2;
    for (let st = 0; st < h.stories; st++) {
      const fy = st * 2.2, wy = fy + 0.2, wall = st === 0 ? spec.ground : spec.upper;
      const win = () => (rnd() < spec.windows ? 'window_wall' : wall);
      for (let i = 0; i < nx; i++) {
        const lx = -nx + 1 + i * 2;
        if (st === 0 || !spec.hollow) for (let j = 0; j < nz; j++) put('floor', lx, fy, -nz + 1 + j * 2, 0);
        put(st === 0 && lx === h.doorX ? 'door' : win(), lx, wy, -nz, 0);
        put(win(), lx, wy, nz, Math.PI);
      }
      for (const side of [-1, 1]) for (let j = 0; j < nz; j++) put(rnd() < spec.windows * 0.4 ? 'window_wall' : wall, side * nx, wy, -nz + 1 + j * 2, half);
    }
    // The roof, a row at a time up each side to the ridge; the gable ends filled in (walls, then a gable).
    const rows = nz / 2, endWall = h.stories > 1 ? spec.upper : spec.ground;
    for (let j = 0; j < rows; j++) {
      const zf = -nz + 1 + 2 * j, zb = nz - 1 - 2 * j, y = top + 2 * j;
      for (let i = 0; i < nx; i++) {
        const lx = -nx + 1 + i * 2;
        put('roof', lx, y, zf, 0);
        put('roof', lx, y, zb, Math.PI);
      }
      for (const side of [-1, 1]) {
        put('gable', side * nx, y, zf, -half);
        put('gable', side * nx, y, zb, half);
        for (let k = 0; k < j; k++) { put(endWall, side * nx, top + 2 * k, zf, half); put(endWall, side * nx, top + 2 * k, zb, half); }
      }
    }
  }

  /** A household's things: beds along the far end, a chest in the back corner, a table and stool by the door. */
  private furnish(v: Village, h: House, beds: number) {
    const n = h.tiles;
    const put = (type: string, lx: number, lz: number, yaw: number) => {
      const [x, z] = world(h, lx, lz);
      v.pieces.push({ type, x, y: h.y + 0.2, z, yaw: h.yaw + yaw });
    };
    const bedX = [n - 0.8, n - 2.2].slice(0, Math.min(beds, n === 3 ? 2 : 1));
    for (const bx of bedX) {
      put('bed', bx, 0.75, 0);
      const [x, z] = world(h, bx, 0.75);
      h.beds.push({ x, z });
    }
    put('chest', -n + 0.9, 1.5, Math.PI);
    { const [x, z] = world(h, -n + 0.9, 1.5); h.chest = { x, z }; }
    put('table', -n + 1.6 + (n === 3 ? 0.6 : 0), 0.3, Math.PI / 2);
    put('stool', -n + 0.7 + (n === 3 ? 0.6 : 0), 0.3, 0);
  }

  /** What stands outside a house for its trade: a chopping block, the smithy, the bakery's quern and oven, the carpenter's bench. */
  private yard(v: Village, h: House, rnd: () => number) {
    const n = h.tiles, y0 = h.y;
    const at = (lx: number, lz: number) => world(h, lx, lz);
    const put = (type: string, lx: number, lz: number, yaw: number) => { const [x, z] = at(lx, lz); v.pieces.push({ type, x, y: y0, z, yaw: h.yaw + yaw }); return { x, z }; };
    if (h.role === 'woodcutter' || h.role === 'carpenter' || (h.kind === 'house' && v.kind === 'village' && rnd() < 0.15)) {
      const [x, z] = at(h.role === 'smith' ? -n - 1.7 : n + 1.7, -1);
      v.pieces.push({ type: 'chopping_block', x, y: this.ground(v, x, z), z, yaw: rnd() * 6 });
      h.block = { x, z };
    }
    if (h.role === 'smith') {
      const forge = put('forge', n + 2.8, -0.6, 0);
      put('bellows', n + 2.8 + 1.05, -0.6, Math.PI / 2);
      const anvil = put('anvil', n + 2.4, 1.5, Math.PI / 2);
      put('quench_trough', n + 3.9, 1.5, 0);
      h.smithy = { forge, anvil };
    }
    if (h.role === 'baker') {
      const quern = put('quern', n + 2.5, 1.2, 0);
      const oven = put('campfire', n + 2.6, -1.0, 0);
      h.bakery = { quern, oven };
    }
    if (h.role === 'carpenter') {
      h.bench = put('workbench', n + 2.4, 1.3, Math.PI / 2);
    }
  }

  /** A fence round a rectangle (2 m panels), with a gate at the given panel. */
  private fenceRect(v: Village, r: Rect, yaw: number, gate: [number, number]) {
    const panels: [number, number, number][] = [];
    for (let x = -r.hx + 1; x < r.hx; x += 2) { panels.push([x, -r.hz, 0], [x, r.hz, 0]); }
    for (let z = -r.hz + 1; z < r.hz; z += 2) { panels.push([-r.hx, z, Math.PI / 2], [r.hx, z, Math.PI / 2]); }
    for (const [lx, lz, ry] of panels) {
      const [fx, fz] = world(r, lx, lz);
      const isGate = Math.abs(lx - gate[0]) < 1.01 && Math.abs(lz - gate[1]) < 1.01 && (gate[0] === r.hx || gate[0] === -r.hx ? ry !== 0 : ry === 0);
      v.pieces.push({ type: isGate ? 'gate' : 'fence', x: fx, y: this.ground(v, fx, fz) - 0.04, z: fz, yaw: yaw + ry });
    }
  }
}
