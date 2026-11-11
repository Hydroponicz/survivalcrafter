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
import { BLEND, PAD, SEA, TILE, type WorldGen } from './worldgen';

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
/** A town's grid is (2N + 1) blocks across: 5 for a town, 7 for a castle city. */
const gridN = (k: SettlementKind) => (k === 'city' || k === 'port' ? 3 : 2);
/** How far out the outer street runs (to its outer edge). */
const gridEdge = (k: SettlementKind) => (gridN(k) + 0.5) * BLOCK + STREET / 2;
/** The street lines (in the grid's own frame), the same both ways. */
const gridLines = (k: SettlementKind) => { const n = gridN(k), out: number[] = []; for (let i = -n - 1; i <= n; i++) out.push((i + 0.5) * BLOCK); return out; };
/**
 * A castle city's terraces (along its grid's z, toward the castle): the middle
 * terrace and the upper close begin, the upper close ends; how long the ramps
 * up through the terrace walls are.
 */
const T1_Z = -BLOCK / 2 + STREET / 2, T2_Z = BLOCK * 1.5 + STREET / 2, T2_END = 118, RAMP = 22;
/** A castle city: its palisade (across, and on the castle side), and the castle (how far from the town's centre, its half-size). */
const PAL_X = gridEdge('city') + 5, CASTLE_Z = 150, CASTLE_HALF = 22;
/**
 * A port: the town's grid faces the sea along its local +z. Beyond its last
 * street a quayside (the apron, made ground at HARBOUR_TOP) runs out to a
 * stone harbour wall; piers run out from that into deep water, PIER_LEN long,
 * at these places along it.
 */
const APRON = 14, PIER_LEN = 30, PIERS = [-66, -22, 22, 66], HARBOUR_TOP = SEA + 1.2;
const clampTo = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const nearestOf = (list: number[], v: number) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

export type SettlementKind = 'village' | 'town' | 'city' | 'port';
export interface VPiece { type: string; x: number; y: number; z: number; yaw: number }
/** A rectangle turned by `yaw` (the same turn as a piece's). */
export interface Rect { x: number; z: number; yaw: number; hx: number; hz: number }
/** A levelled plot (blending back into the land over `fall` metres: castle mounds are graded wider). */
interface Pad extends Rect { level: number; fall?: number; rise?: number }
export interface Seg { ax: number; az: number; bx: number; bz: number; w: number }
/** What a house is for (the work of whoever comes to live there). */
export type HouseRole = 'farmer' | 'shepherd' | 'woodcutter' | 'butcher' | 'smith' | 'elder' | 'villager'
  | 'priest' | 'mayor' | 'merchant' | 'baker' | 'carpenter'
  | 'lord' | 'noble' | 'innkeeper' | 'guard' | 'performer' | 'dockhand';
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
  kind: 'house' | 'cathedral' | 'hall' | 'villa' | 'bakery' | 'workshop' | 'smithy' | 'tavern' | 'keep' | 'great_hall' | 'barracks' | 'tower' | 'den' | 'bathhouse';
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
  /** A town's street grid: its frame (streets run along its local x and z), its street lines, how far its outer street reaches. */
  grid?: { x: number; z: number; yaw: number };
  lines?: number[];
  edge?: number;
  /** The town houses lining its streets (for the map). */
  facades: Rect[];
  /** Where people go of an evening besides the tavern: the playhouse's yard, the pleasure garden, the gaming den, the baths. */
  venues: Venue[];
  /** A castle city's terrace levels: the lower town, the middle terrace, the upper close. */
  tiers?: number[];
  /** The playhouse stage: where the players stand (in front of it), and which way they face. */
  stage?: { x: number; z: number; face: { x: number; z: number } };
  /** Market stalls (where merchants stand). */
  stalls: { x: number; z: number; yaw: number }[];
  /** A city's castle on its hill: its frame (centre, facing the town) and half-size. */
  castle?: { x: number; z: number; yaw: number; half: number };
  /** A city's road up to the castle: from the town's streets, to the gatehouse, into the bailey. */
  upper?: { x: number; z: number }[];
  /** The gates (in the town's palisade, and the castle's): where the guards stand. */
  gates: { x: number; z: number }[];
  /**
   * A port's harbour: its berths (where a ship lies alongside a pier: the
   * pier's edge at its middle, which way is out from it, and the heading she
   * lies at, bow to the sea), and where she comes in from the open water.
   */
  harbour?: { berths: Berth[]; top: number; seaward: { x: number; z: number } };
  /** Where the dockhands work (by the cranes and the cargo), facing their work. */
  docks?: { x: number; z: number; face: { x: number; z: number } }[];
  pieces: VPiece[];
}

export interface Berth { x: number; z: number; nx: number; nz: number; yaw: number; entry: { x: number; z: number } }
export interface Venue extends Rect { kind: 'playhouse' | 'garden' | 'den' | 'bathhouse'; face: { x: number; z: number }; indoors?: boolean }

/** Where a settlement will be (worked out before its layout, so roads can be planned between them). */
interface Site { cx: number; cz: number; x: number; z: number; kind: SettlementKind; yaw: number }

// ---------- rectangle helpers (local frame as in world.toLocal)
// (A frame's turn is worked out once and kept with it: the ground asks these for every column.)
type Frame = { x: number; z: number; yaw: number; _c?: number; _s?: number };
function local(r: Frame, x: number, z: number): [number, number] {
  const dx = x - r.x, dz = z - r.z, c = (r._c ??= Math.cos(r.yaw)), s = (r._s ??= Math.sin(r.yaw));
  return [dx * c - dz * s, dx * s + dz * c];
}
function world(r: Frame, lx: number, lz: number): [number, number] {
  const c = (r._c ??= Math.cos(r.yaw)), s = (r._s ??= Math.sin(r.yaw));
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
const PORT_LAST = ['haven', 'port', 'mouth', 'quay', 'strand', 'wick', 'sea', 'bay'];
function settlementName(rnd: () => number, kind: SettlementKind): string {
  const a = FIRST[Math.floor(rnd() * FIRST.length)];
  let b = LAST[Math.floor(rnd() * LAST.length)];
  // (A town takes a grander ending; the same number of draws either way.)
  const tr = rnd(), t = (kind === 'port' ? PORT_LAST : TOWN_LAST)[Math.floor(tr * (kind === 'port' ? PORT_LAST : TOWN_LAST).length)];
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

  /**
   * Have the map tiles made (in the background, side by side) that planning
   * the settlements and roads reaching a point needs, before any of it is
   * asked for: otherwise each missing tile is made on the spot, on the page,
   * and the page freezes. `r` widens it to every settlement within r of the
   * point. Works outward in rounds: the squares round the point, then the
   * squares round each settlement found (its roads run to their settlements).
   */
  async prepare(x: number, z: number, r = 0): Promise<void> {
    if (!this.ready || !this.gen.tileSource) return;
    const cx = Math.floor(x / VCELL), cz = Math.floor(z / VCELL);
    // ensureRoads' reach (or r's, if wider), and siteLinks' from each settlement.
    const r1 = Math.max(Math.ceil(LINK / VCELL / 2) + 1, Math.ceil(r / VCELL)), r2 = Math.ceil(LINK / VCELL);
    for (let round = 0; round < 6; round++) {
      const need = new Map<string, [number, number]>();
      const found: Site[] = [];
      for (let j = cz - r1; j <= cz + r1; j++) for (let i = cx - r1; i <= cx + r1; i++) {
        if (!this.cellTiles(i, j, need)) continue;
        const s = this.site(i, j);
        if (s) found.push(s);
      }
      for (const s of found) for (let j = s.cz - r2; j <= s.cz + r2; j++) for (let i = s.cx - r2; i <= s.cx + r2; i++) {
        if (this.cellTiles(i, j, need)) this.site(i, j);
      }
      if (!need.size) return;
      await this.gen.whenTiles([...need.values()]);
    }
  }

  /** Whether the tiles a square's planning reads are made: those missing are added to `need`. */
  private cellTiles(cx: number, cz: number, need: Map<string, [number, number]>): boolean {
    if (this.sites.has(cellKey(cx, cz))) return true;
    // The square, a port's harbour reaching out past it, and the blending and lakes of the tiles round it.
    const m = 320 + PAD + BLEND;
    const tx0 = Math.floor((cx * VCELL - m) / TILE), tx1 = Math.floor(((cx + 1) * VCELL + m) / TILE);
    const tz0 = Math.floor((cz * VCELL - m) / TILE), tz1 = Math.floor(((cz + 1) * VCELL + m) / TILE);
    let ok = true;
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
      if (this.gen.hasTile(tx, tz)) continue;
      ok = false;
      need.set(`${tx},${tz}`, [tx, tz]);
    }
    return ok;
  }

  /** The settlements already planned (never plans one: safe to ask every frame). */
  planned(): Village[] {
    const out: Village[] = [];
    for (const v of this.cells.values()) if (v) out.push(v);
    return out;
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
      if (v) this.version++;
    }
    return v;
  }

  /** The settlement a point is in or near (within its reach), if any. */
  at(x: number, z: number, grow = 0): Village | null {
    const v = this.inCell(Math.floor(x / VCELL), Math.floor(z / VCELL));
    return v && Math.hypot(x - v.x, z - v.z) < v.r + grow ? v : null;
  }

  /**
   * The settlements whose ground reaches a point (their plots, and a port's
   * harbour out past its own square): the one in its own square first, then
   * any port round about whose reach takes in the point.
   */
  shapersNear(x: number, z: number, grow = 0): Village[] {
    const own = this.at(x, z, grow), out = own ? [own] : [];
    const cx = Math.floor(x / VCELL), cz = Math.floor(z / VCELL);
    for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      if (i === cx && j === cz) continue;
      const v = this.inCell(i, j);
      if (v && v.kind === 'port' && Math.hypot(x - v.x, z - v.z) < v.r + grow) out.push(v);
    }
    return out;
  }

  /** Goes up each time another settlement is planned (the distant forests clear its ground when it does). */
  version = 0;

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

  /**
   * The settlements a settlement has roads to that can be worked out from map
   * tiles already made (no tile is made on the spot: those not ready yet join in
   * once the map round you has reached them). For things
   * that roam far (traders), so they never hold up a frame.
   */
  readyNeighbours(v: Village): Village[] {
    const reach = Math.ceil(LINK / VCELL), out: Village[] = [];
    for (let cz = v.cz - reach; cz <= v.cz + reach; cz++) {
      for (let cx = v.cx - reach; cx <= v.cx + reach; cx++) {
        if ((cx === v.cx && cz === v.cz) || !this.layoutReady(cx, cz)) continue;
        const o = this.inCell(cx, cz);
        if (o && Math.hypot(o.x - v.x, o.z - v.z) < LINK) out.push(o);
      }
    }
    return out;
  }

  /** Settlements already planned within `r` of a point (nothing new is worked out). */
  knownAround(x: number, z: number, r: number): Village[] {
    return this.known().filter((v) => Math.hypot(v.x - x, v.z - z) < r + v.r);
  }

  /**
   * Can a square's settlement be laid out without making any map tile on the
   * spot? Its layout needs the sites around it too (for its roads), so their
   * squares' tiles must be here as well.
   */
  private layoutReady(cx: number, cz: number): boolean {
    if (this.cells.has(cellKey(cx, cz))) return true;
    const reach = Math.ceil(LINK / VCELL);
    let ready = true;
    for (let j = cz - reach; j <= cz + reach; j++) for (let i = cx - reach; i <= cx + reach; i++) if (!this.sites.has(cellKey(i, j)) && !this.cellReady(i, j)) ready = false;
    return ready;
  }

  /** Can a grid square's settlement be planned without making any map tile on the spot? */
  private cellReady(cx: number, cz: number): boolean {
    const key = cellKey(cx, cz);
    if (this.cells.has(key)) return true;
    let ready = true;
    const t0x = Math.floor((cx * VCELL - BLEND) / TILE) - 1, t1x = Math.floor(((cx + 1) * VCELL + BLEND) / TILE) + 1;
    const t0z = Math.floor((cz * VCELL - BLEND) / TILE) - 1, t1z = Math.floor(((cz + 1) * VCELL + BLEND) / TILE) + 1;
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      // (Not asked for here: the tiles round you are fetched anyway, and asking for far ones would only churn.)
      if (!this.gen.hasTile(tx, tz)) ready = false;
    }
    return ready;
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
    const [lx, lz] = local(s, toward.x, toward.z), E = gridEdge(s.kind);
    const P = (gx: number, gz: number) => { const [x, z] = world(s, gx, gz); return { x, z }; };
    if (s.kind === 'city') {
      // A city's castle is up behind its north side, its terraces below it: roads leave by the lower town, east, west or
      // south (down from the market by the ramp, then along a street of the lower town).
      const B = BLOCK / 2, low = -1.5 * BLOCK;
      if (Math.abs(lx) > Math.abs(lz) || lz > 0) { const sg = Math.sign(lx) || 1; return { inner: [P(B, 0), P(B, low), P(sg * E, low)], out: P(sg * (E + 18), low) }; }
      return { inner: [P(B, 0), P(B, -E)], out: P(B, -(E + 18)) };
    }
    // A town: out along one of the four streets off the market square, to the edge of town (a port's never seaward).
    const alongX = Math.abs(lx) > Math.abs(lz) || (s.kind === 'port' && lz > 0), sg = s.kind === 'port' && !alongX ? -1 : Math.sign(alongX ? lx : lz) || 1;
    const street = BLOCK / 2;
    const pt = (u: number, w: number) => (alongX ? P(u, w) : P(w, u));
    return { inner: [pt(sg * (BLOCK / 2 - 3), street), pt(sg * E, street)], out: pt(sg * (E + 18), street) };
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
      const [lx, lz] = local(p, x, z);
      const d = Math.hypot(Math.max(0, Math.abs(lx) - p.hx), Math.max(0, Math.abs(lz) - p.hz));
      // (On a plot it's the plot's level, whatever a neighbour's slope would make of it; a ramp climbs along its length.)
      if (d === 0) return p.rise ? p.level + (p.rise * lz) / (2 * p.hz) : p.level;
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
    // A town keeps its whole grid clear (gardens and yards between the houses).
    if (v.grid) {
      const [lx, lz] = local(v.grid, x, z), e = v.edge! + 3;
      if (Math.abs(lx) < e && Math.abs(lz) < e) return true;
      if (v.kind === 'port' && Math.abs(lx) < e + 18 && lz > -e && lz < e + APRON + PIER_LEN + 40) return true;
      // A city: everything inside the palisade, and the castle's hill.
      if (v.kind === 'city' && Math.abs(lx) < PAL_X + 3 && lz > -PAL_X - 3 && lz < CASTLE_Z + CASTLE_HALF + 16) return true;
    }
    if (Math.hypot(x - v.square.x, z - v.square.z) < v.square.r + 4) return true;
    for (const p of v.pads) if (outside(p, x, z) < 3) return true;
    for (const p of v.paved) if (outside(p, x, z) < 2) return true;
    for (const p of v.pens) if (outside(p, x, z) < 2) return true;
    for (const f of v.fields) if (outside(f, x, z) < 1.5) return true;
    for (const s of v.paths) if (segDist(s, x, z) < s.w / 2 + 1.5) return true;
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
    // (A town's streets and yards are no place for things to grow or lie about either.)
    if (v.grid) {
      const [lx, lz] = local(v.grid, x, z), e = v.edge! + 2;
      if (Math.abs(lx) < e && Math.abs(lz) < e) return true;
      if (v.kind === 'port' && Math.abs(lx) < e + 16 && lz > -e && lz < e + APRON + PIER_LEN + 40) return true;
    }
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
    // On the coast, often a port: low land running down to deep water, for a harbour.
    if (hash2(cx, cz, this.gen.seed ^ 0x9047) < 0.6) s = this.portSite(cx, cz);
    // Now and then a castle city, where there's a hill to build the castle on and level land below it for the town.
    if (!s && hash2(cx, cz, this.gen.seed ^ 0xc17e) < 0.1) s = this.citySite(cx, cz);
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
        const town = hash2(cx, cz, this.gen.seed ^ 0x70e7) < 0.22 && this.townOk(best.x, best.z, 'town');
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
      const hx = cx * VCELL + 60 + hash2(cx * 13 + i, cz, 71) * (VCELL - 120), hz = cz * VCELL + 60 + hash2(cx, cz * 17 + i, 72) * (VCELL - 120);
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
        if (drop < 12 || drop > 40) continue;
        // The whole city inside its square of the grid.
        const yaw = Math.atan2(dx, dz), F = { x: tx, z: tz, yaw };
        const inCell = [[-PAL_X - 4, -PAL_X - 4], [PAL_X + 4, -PAL_X - 4], [-PAL_X - 4, CASTLE_Z + CASTLE_HALF + 18], [PAL_X + 4, CASTLE_Z + CASTLE_HALF + 18]]
          .every(([lx, lz]) => { const [x, z] = world(F, lx, lz); return x > cx * VCELL + 8 && x < (cx + 1) * VCELL - 8 && z > cz * VCELL + 8 && z < (cz + 1) * VCELL - 8; });
        if (!inCell || this.siteScore(tx, tz) === null || !this.townOk(tx, tz, 'city')) continue;
        const score = Math.abs(drop - 22);
        if (!best || score < best.score) best = { s: { cx, cz, x: tx, z: tz, kind: 'city', yaw }, score };
      }
    }
    return best?.s ?? null;
  }

  /**
   * A port's site: dry, gently sloping land for the town (its grid's local +z
   * toward the sea), its seaward edge low by the water, the water off its
   * quay deep enough to lie alongside, deeper still at the piers' ends, and
   * open sea beyond. The site is the town's centre.
   */
  private portSite(cx: number, cz: number): Site | null {
    const g = this.gen, E = gridEdge('port');
    const sea = (x: number, z: number, below: number) => { const h = g.height(x, z); return h < SEA - below && Number.isNaN(g.water(x, z, h)); };
    let best: { s: Site; score: number } | null = null;
    // Candidates from the shore itself: points near sea level along a lattice over the square, the town set back
    // from each (inland, uphill) with its grid facing straight down the slope to the sea.
    const cands: { x: number; z: number; yaw: number }[] = [];
    for (let j = 1; j < 12; j++) for (let i = 1; i < 12; i++) {
      const sx = cx * VCELL + (i / 12) * VCELL, sz = cz * VCELL + (j / 12) * VCELL, h = g.height(sx, sz);
      if (Math.abs(h - SEA) > 1.5) continue;
      const gx = g.height(sx + 10, sz) - g.height(sx - 10, sz), gz = g.height(sx, sz + 10) - g.height(sx, sz - 10), gl = Math.hypot(gx, gz);
      if (gl < 0.4) continue;
      const nx = -gx / gl, nz = -gz / gl, yaw = Math.atan2(nx, nz);
      for (const off of [E + 4, E + 9, E + 14]) cands.push({ x: sx - nx * off, z: sz - nz * off, yaw });
    }
    for (const c of cands) {
      const { x, z } = c;
      if (this.avoid.some((a) => Math.hypot(a.x - x, a.z - z) < AVOID + 60)) continue;
      const h0 = g.height(x, z);
      if (h0 < SEA + 1.5 || h0 > SEA + 26) continue;
      for (const turn of [0, -0.2, 0.2]) {
        const yaw = c.yaw + turn, F = { x, z, yaw };
        const P = (lx: number, lz: number) => world(F, lx, lz);
        // The town in the square (its quayside and harbour may reach out past it: they're found from the squares round about).
        const ok = [[-E - 4, -E - 4], [E + 4, -E - 4], [-E - 4, E + 4], [E + 4, E + 4]]
          .every(([lx, lz]) => { const [px, pz] = P(lx, lz); return px > cx * VCELL + 6 && px < (cx + 1) * VCELL - 6 && pz > cz * VCELL + 6 && pz < (cz + 1) * VCELL - 6; });
        if (!ok) continue;
        // The harbour basin is dredged (see layoutHarbour): what it needs is open sea just past it, and beyond.
        let chan = 0;
        for (const lx of [-40, 0, 40]) { const [px, pz] = P(lx, E + APRON + PIER_LEN + 30); if (sea(px, pz, 3)) chan++; }
        if (chan < 2) continue;
        { const [ox, oz] = P(0, E + APRON + PIER_LEN + 90); if (!sea(ox, oz, 5)) continue; }
        // The town: dry land, not too high nor too rough (its waterfront may be shore or shallows: it's made ground).
        let dry = true, lo = Infinity, hi = -Infinity;
        for (const lz of [-E, -E / 2, 0, E / 2]) for (const lx of [-E, -E / 2, 0, E / 2, E]) {
          const [px, pz] = P(lx, lz), h = g.height(px, pz);
          if (h < SEA + 0.8 || h > SEA + 34 || !Number.isNaN(g.water(px, pz, h))) { dry = false; break; }
          lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
        if (!dry || hi - lo > 24) continue;
        const [fx, fz] = P(0, E - 8), front = g.height(fx, fz);
        const rv = g.river(x, z);
        if (rv && rv.d < rv.r + 30) continue;
        const score = Math.abs(front - (SEA + 3)) + (hi - lo) * 0.3 + Math.abs(turn) * 4;
        if (!best || score < best.score) best = { s: { cx, cz, x, z, kind: 'port', yaw }, score };
      }
    }
    return best?.s ?? null;
  }

  /** Is the land level and dry enough, wide enough, for a town's streets? */
  private townOk(x: number, z: number, kind: SettlementKind): boolean {
    const g = this.gen, h = g.height(x, z);
    // (A city's terraces take up more of the slope.)
    const steep = kind === 'city' ? 0.16 : 0.12;
    for (const r of kind === 'city' ? [30, 60, 90, 120] : [30, 55, 80]) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const ph = g.height(px, pz);
        if (!Number.isNaN(g.water(px, pz, ph)) || Math.abs(ph - h) / r > steep) return false;
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
      fire: { x: s.x, z: s.z }, benches: [], houses: [], pads: [], pens: [], fields: [], paths: [], paved: [], stalls: [], gates: [], pieces: [], facades: [], venues: [],
    };
    const links = this.siteLinks(s);
    if (s.kind === 'town') this.layoutGrid(v, s, links, rnd);
    else if (s.kind === 'city') { this.layoutGrid(v, s, links, rnd); this.layoutCity(v, rnd); }
    else if (s.kind === 'port') { this.layoutGrid(v, s, links, rnd); this.layoutHarbour(v, rnd); }
    else this.layoutVillage(v, s, links, rnd);
    // How far it all reaches.
    let reach = v.square.r;
    for (const r of [...v.pads, ...v.pens, ...v.fields, ...v.paved]) for (const [qx, qz] of corners(r)) reach = Math.max(reach, Math.hypot(qx - v.x, qz - v.z));
    for (const sg of v.paths) reach = Math.max(reach, Math.hypot(sg.bx - v.x, sg.bz - v.z) + sg.w);
    // (A port's piers and mole reach out past its ground.)
    if (v.harbour) for (const p of v.pieces) reach = Math.max(reach, Math.hypot(p.x - v.x, p.z - v.z) + 4);
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

  // ---------- towns and cities
  /**
   * A town or castle city: a grid of gravel streets (5 × 5 blocks for a town,
   * 7 × 7 for a city), every block lined wall to wall with town houses facing
   * its streets, the people's own homes and workshops among them, and the
   * districts: the market square, the covered market, the cathedral, the
   * merchants' hall, the mayor's villa, the inns and taverns; in a city the
   * playhouse, the gaming den, the bathhouse and the pleasure garden too.
   *
   * A castle city climbs its hill in three terraces, each held up by a stone
   * wall with ramps up through it where the streets cross: the lower town
   * (homes and workshops round the square with its gallows, inside the timber
   * palisade), the middle terrace (the market, the inns and the shops, the
   * playhouse and the rest of the entertainments, behind the outer stone
   * wall), and the upper close under the castle (the cathedral, the mayor and
   * the wealthy, their villas along the top street, the tiltyard).
   */
  private layoutGrid(v: Village, s: Site, links: Site[], rnd: () => number) {
    const city = s.kind === 'city';
    const F = { x: s.x, z: s.z, yaw: s.yaw };
    const N = gridN(s.kind), E = gridEdge(s.kind), lines = gridLines(s.kind), IN = BLOCK / 2 - STREET / 2;
    v.grid = F; v.lines = lines; v.edge = E;
    const at = (lx: number, lz: number) => world(F, lx, lz);
    const pt = (lx: number, lz: number) => { const [x, z] = world(F, lx, lz); return { x, z }; };
    const faceYaw = (fx: number, fz: number) => Math.atan2(-fx, -fz); // local -z toward (fx, fz) in the grid
    const natural = (lx: number, lz: number) => { const [x, z] = at(lx, lz); return this.gen.height(x, z); };
    const mean = (x0: number, z0: number, x1: number, z1: number) => {
      let sum = 0;
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) sum += natural(x0 + ((x1 - x0) * i) / 4, z0 + ((z1 - z0) * j) / 4);
      return sum / 25;
    };
    const used = new Set<string>();
    const use = (bi: number, bj: number) => used.add(`${bi},${bj}`);

    // ---- the ground: a city's terraces (the ramps first: the ground takes the first plot it's on), a town's blocks levelled one by one
    let levelAt: (bi: number, bj: number) => number;
    let tiers: number[] = [];
    if (city) {
      const L0 = mean(-E, -E, E, T1_Z);
      // (Each terrace stands well above the last, whatever the hill would make of it: the climb to the castle is the point.)
      const L1 = clampTo(mean(-E, T1_Z, E, T2_Z), L0 + 5, L0 + 8);
      const L2 = clampTo(mean(-E, T2_Z, E, T2_END), L1 + 5, L1 + 8);
      tiers = [L0, L1, L2];
      v.tiers = tiers;
      for (const [z0, lo, hi] of [[T1_Z, L0, L1], [T2_Z, L1, L2]]) {
        for (const u of lines) {
          const c = pt(u, z0 + RAMP / 2);
          v.pads.push({ x: c.x, z: c.z, yaw: F.yaw, hx: STREET / 2, hz: RAMP / 2, level: (lo + hi) / 2, rise: hi - lo, fall: 0.01 });
        }
      }
      const tier = (z0: number, z1: number, level: number, fall: number) => {
        const c = pt(0, (z0 + z1) / 2);
        v.pads.push({ x: c.x, z: c.z, yaw: F.yaw, hx: E, hz: (z1 - z0) / 2, level, fall });
      };
      tier(-E, T1_Z, L0, 8); tier(T1_Z, T2_Z, L1, 6); tier(T2_Z, T2_END, L2, 10);
      levelAt = (_bi, bj) => (bj <= -1 ? L0 : bj <= 1 ? L1 : L2);
    } else if (s.kind === 'port') {
      // A port steps down to the sea: the waterfront blocks just above the quayside, each row inland no more than
      // a step above the one below it (cut into the slope where the land climbs faster); the quayside itself made
      // ground at the harbour's level, out over the old shore to the harbour wall.
      const lv = new Map<string, number>();
      for (let bj = N; bj >= -N; bj--) for (let bi = -N; bi <= N; bi++) {
        const m = mean(bi * BLOCK - IN, bj * BLOCK - IN, bi * BLOCK + IN, bj * BLOCK + IN);
        const level = bj === N ? clampTo(m, HARBOUR_TOP + 0.5, HARBOUR_TOP + 1.4) : clampTo(m, HARBOUR_TOP + 0.5, lv.get(`${bi},${bj + 1}`)! + 2.4);
        const [x, z] = at(bi * BLOCK, bj * BLOCK);
        v.pads.push({ x, z, yaw: F.yaw, hx: IN, hz: IN, level });
        lv.set(`${bi},${bj}`, level);
      }
      const c = pt(0, E - STREET + (APRON - 2 + STREET) / 2);
      v.pads.push({ x: c.x, z: c.z, yaw: F.yaw, hx: E + 4, hz: (APRON - 2 + STREET) / 2, level: HARBOUR_TOP, fall: 1.5 });
      v.paved.push({ x: c.x, z: c.z, yaw: F.yaw, hx: E + 4, hz: (APRON - 2 + STREET) / 2 });
      levelAt = (bi, bj) => lv.get(`${bi},${bj}`)!;
    } else {
      const lv = new Map<string, number>();
      for (let bj = -N; bj <= N; bj++) for (let bi = -N; bi <= N; bi++) {
        const [x, z] = at(bi * BLOCK, bj * BLOCK);
        lv.set(`${bi},${bj}`, this.pad(v, { x, z, yaw: F.yaw, hx: IN, hz: IN }));
      }
      levelAt = (bi, bj) => lv.get(`${bi},${bj}`)!;
    }

    // ---- the streets, and the roads out
    for (const u of lines) {
      const a = pt(u, 0), b = pt(0, u);
      v.paved.push({ x: a.x, z: a.z, yaw: F.yaw, hx: STREET / 2, hz: E }, { x: b.x, z: b.z, yaw: F.yaw, hx: E, hz: STREET / 2 });
    }
    for (const o of links) {
      const e = this.exit(s, o);
      const last = e.inner.at(-1)!;
      v.paths.push({ ax: last.x, az: last.z, bx: e.out.x, bz: e.out.z, w: 2.6 });
    }

    // ---- building helpers
    const lim = lines.at(-1)!;
    const streetPoint = (h: House) => {
      // The street in front: out from the door to the street's middle.
      const [lx, lz] = local(F, h.door.x, h.door.z);
      const nx = nearestOf(lines, lx), nz = nearestOf(lines, lz);
      return Math.abs(nx - lx) < Math.abs(nz - lz) ? pt(nx, clampTo(lz, -lim, lim)) : pt(clampTo(lx, -lim, lim), nz);
    };
    type Spec = { ground: string; upper: string; windows: number };
    const stone: Spec = { ground: 'stone_wall', upper: 'stone_wall', windows: 0.6 };
    const raise = (o: { lx: number; lz: number; face: [number, number]; tiles: number; nz: number; stories: number; kind: House['kind']; role: HouseRole; spec: Spec; beds: number; y: number; doorX?: number }) => {
      const [wx, wz] = at(o.lx, o.lz);
      const h = this.newHouse(wx, wz, F.yaw + faceYaw(o.face[0], o.face[1]), o.y, o.tiles, o.nz, o.stories, o.kind, o.role);
      if (o.doorX !== undefined) h.doorX = o.doorX;
      const [dx, dz] = world(h, h.doorX, -h.nz - 0.9);
      h.door = { x: dx, z: dz };
      const sp = streetPoint(h);
      h.route = [h.door, sp, sp];
      v.houses.push(h);
      this.building(v, h, o.spec, rnd);
      if (o.beds > 0) this.furnish(v, h, o.beds);
      return h;
    };
    const SIDES: Record<string, [number, number]> = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
    /** Where a building `depthHalf` deep stands on a block's side, `along` it (grid coordinates). */
    const onSide = (bi: number, bj: number, sd: string, along: number, depthHalf: number): [number, number] => {
      const [nx, nz] = SIDES[sd], cx = bi * BLOCK, cz = bj * BLOCK;
      return nz ? [cx + along, cz + nz * (IN - depthHalf)] : [cx + nx * (IN - depthHalf), cz + along];
    };
    const townhouse = (lx: number, lz: number, face: [number, number], w: number, d: number, st: number, style: string, y: number) => {
      const [x, z] = at(lx, lz), yaw = F.yaw + faceYaw(face[0], face[1]);
      v.pieces.push({ type: `th_${w}${d}${st}${style}`, x, y: y - 0.02, z, yaw });
      v.facades.push({ x, z, yaw, hx: w, hz: d });
    };
    type Fill = { sides?: string; tall?: number; deep?: boolean; roles?: HouseRole[]; homes?: number; homeRole?: HouseRole; noLived?: string; stone?: number };
    /**
     * A block's edges built up: town houses wall to wall all along each side
     * (facing its street), with the people's homes and workshops in among them.
     */
    const fill = (bi: number, bj: number, o: Fill = {}) => {
      use(bi, bj);
      const sides = o.sides ?? 'NSEW', y = levelAt(bi, bj), D = o.deep ? 8 : 4;
      const roles = [...(o.roles ?? [])];
      let homes = o.homes ?? 0;
      for (const sd of sides) {
        const [nx, nz] = SIDES[sd];
        const a0 = nz ? -IN : -IN + (sides.includes('S') ? D : 0), a1 = nz ? IN : IN - (sides.includes('N') ? D : 0);
        const livedOk = !(o.noLived ?? '').includes(sd) && !o.deep;
        const yr = faceYaw(nx, nz), rightAlong = nz !== 0 ? Math.cos(yr) : -Math.sin(yr);
        let t = a0;
        while (a1 - t >= 4) {
          const r = a1 - t;
          // Someone's home or workshop here?
          const role: HouseRole | undefined = !livedOk ? undefined : roles.length ? roles[0] : homes > 0 && rnd() < 0.45 ? (o.homeRole ?? 'villager') : undefined;
          if (role) {
            const shop = role === 'baker' || role === 'carpenter' || role === 'smith';
            const tiles = shop ? 2 : r >= 6.6 && rnd() < 0.4 ? 3 : 2;
            const extra = shop ? 3.4 : 0, width = tiles * 2 + extra + 0.4;
            if (width <= r) {
              if (roles.length) roles.shift(); else homes--;
              // (A workshop's yard is on the house's own right: which way along the side that is depends on how it faces.)
              const along = t + width / 2 - ((rightAlong >= 0 ? 1 : -1) * extra) / 2;
              const [lx, lz] = onSide(bi, bj, sd, along, 2.25);
              const stories = shop ? 1 : rnd() < (city ? 0.7 : 0.5) ? 2 : 1;
              const kind: House['kind'] = role === 'baker' ? 'bakery' : role === 'carpenter' ? 'workshop' : role === 'smith' ? 'smithy' : 'house';
              const h = raise({ lx, lz, face: [nx, nz], tiles, nz: 2, stories, kind, role, y, beds: tiles === 3 ? 2 : 1,
                spec: { ground: rnd() < 0.5 ? 'stone_wall' : 'wood_wall', upper: 'wood_wall', windows: 0.6 } });
              this.yard(v, h, rnd);
              t += width;
              continue;
            }
          }
          const w = r >= 10 ? (rnd() < 0.5 ? 6 : 4) : r >= 8 ? 4 : r >= 6 ? 6 : 4;
          const wt = w / 2, dt = D / 2;
          const st = o.deep ? (wt === 3 ? 3 : 2) : rnd() < (o.tall ?? 0.3) ? 3 : 2;
          const style = rnd() < (o.stone ?? 0.25) ? 'c' : rnd() < 0.55 ? 'a' : 'b';
          const [lx, lz] = onSide(bi, bj, sd, t + w / 2, dt + 0.05);
          townhouse(lx, lz, [nx, nz], wt, dt, st, style, y);
          t += w;
        }
      }
    };
    const put = (type: string, lx: number, lz: number, y: number, yawRel = 0) => {
      const [x, z] = at(lx, lz);
      v.pieces.push({ type, x, y, z, yaw: F.yaw + yawRel });
      return { x, z };
    };
    const pave = (bi: number, bj: number, half = BLOCK / 2) => { const c = pt(bi * BLOCK, bj * BLOCK); v.paved.push({ x: c.x, z: c.z, yaw: F.yaw, hx: half, hz: half }); };
    const stall = (lx: number, lz: number, ox: number, oz: number, y: number) => {
      // Its front (with the goods) facing out (ox, oz).
      const p = put('market_stall', lx, lz, y, faceYaw(ox, oz));
      v.stalls.push({ ...p, yaw: F.yaw + faceYaw(ox, oz) });
    };

    // ---- the districts' set pieces
    /** The market square: a well, stalls round it, a fire and benches for the evening (and in a city, the gallows). */
    const square = (bi: number, bj: number, gallows: boolean) => {
      use(bi, bj);
      const cx = bi * BLOCK, cz = bj * BLOCK, y = levelAt(bi, bj), c = pt(cx, cz);
      v.square = { x: c.x, z: c.z, r: IN };
      pave(bi, bj);
      put('well', cx, cz, y - 0.05);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3, ox = Math.cos(a), oz = Math.sin(a);
        stall(cx + ox * 7, cz + oz * 7, ox, oz, y);
      }
      const f = put('campfire', cx - 3.6, cz + 3.6, y);
      v.fire = f;
      for (const [ox, oz] of [[-1.9, 0], [0, 1.9]]) {
        const [bx, bz] = at(cx - 3.6 + ox, cz + 3.6 + oz);
        const byaw = Math.atan2(bx - f.x, bz - f.z) + Math.PI / 2;
        v.pieces.push({ type: 'bench', x: bx, y, z: bz, yaw: byaw });
        v.benches.push({ x: bx, z: bz, yaw: byaw });
      }
      if (gallows) put('gallows', cx + 7.4, cz + 7.4, y, Math.PI / 4);
    };
    /** The covered market: a great thatched roof on posts over a crowd of stalls, more round about it. */
    const marketHall = (bi: number, bj: number) => {
      use(bi, bj);
      const cx = bi * BLOCK, cz = bj * BLOCK, y = levelAt(bi, bj);
      pave(bi, bj);
      put('market_hall', cx, cz, y);
      for (const sx of [-3, 3]) for (const sz of [-1, 1]) stall(cx + sx, cz + sz * 1.8, 0, sz, y);
      for (const sz of [-1, 1]) stall(cx, cz + sz * 7.2, 0, sz, y);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) stall(cx + sx * 8.6, cz + sz * 3, sx, 0, y);
      for (const [bx, bz] of [[-8.6, 7.6], [8.8, 7.4], [-9, -7.8], [8.4, -8.2], [-7.6, 8.6]]) put('barrel', cx + bx, cz + bz, y);
    };
    /** The cathedral: its nave along the block facing the street to the south, the bell tower at its east end. */
    const cathedral = (bi: number, bj: number) => {
      const cx = bi * BLOCK, cz = bj * BLOCK, y = levelAt(bi, bj);
      const nave = raise({ lx: cx - 2, lz: cz + 1.5, face: [0, -1], tiles: 7, nz: 4, stories: 3, kind: 'cathedral', role: 'priest', spec: stone, beds: 0, y, doorX: 0 });
      const [tx, tz] = world(nave, 9, 0);
      const tower = this.newHouse(tx, tz, nave.yaw, y, 2, 2, 6, 'cathedral', 'priest');
      tower.doorX = 99; // (no door: it's entered from the nave)
      this.building(v, tower, stone, rnd);
      // Pews down the nave facing the altar at its east end; the priest's cot in a corner.
      const pew = (type: string, lx: number, lz: number) => { const [x, z] = world(nave, lx, lz); v.pieces.push({ type, x, y: y + 0.2, z, yaw: nave.yaw + Math.PI / 2 }); };
      for (const lx of [-5, -3, -1.2, 1.2, 3]) for (const lz of [-2, 2]) pew('bench', lx, lz);
      pew('table', 5.6, 0);
      const [ax, az] = world(nave, 4.4, 0);
      nave.altar = { x: ax, z: az };
      const [bx, bz] = world(nave, -6.2, 2.6);
      v.pieces.push({ type: 'bed', x: bx, y: y + 0.2, z: bz, yaw: nave.yaw });
      nave.beds.push({ x: bx, z: bz });
    };
    /** The merchants' hall, two storeys of stone facing west, the town's storehouse at its door. */
    const merchantsHall = (bi: number, bj: number) => {
      const y = levelAt(bi, bj);
      const hall = raise({ lx: bi * BLOCK + 1, lz: bj * BLOCK, face: [-1, 0], tiles: 5, nz: 4, stories: 2, kind: 'hall', role: 'merchant', spec: { ground: 'stone_wall', upper: 'wood_wall', windows: 0.7 }, beds: 0, y });
      const fit = (type: string, lx: number, lz: number, r = 0) => { const [x, z] = world(hall, lx, lz); v.pieces.push({ type, x, y: y + 0.2, z, yaw: hall.yaw + r }); };
      fit('dining_table', 0, 0);
      for (const lx of [-3, 3]) fit('chest', lx, 3.4, Math.PI);
      fit('shelf', 0, 3.6, Math.PI);
      const [sx, sz] = world(hall, 2.6, -4 - 3.2);
      v.store = { x: sx, z: sz, yaw: hall.yaw };
      v.pieces.push({ type: 'village_store', x: sx, y, z: sz, yaw: hall.yaw });
    };
    /** The mayor's villa facing east, a walled garden behind. */
    const mayorVilla = (bi: number, bj: number) => {
      const y = levelAt(bi, bj);
      const villa = raise({ lx: bi * BLOCK + 1, lz: bj * BLOCK, face: [1, 0], tiles: 4, nz: 2, stories: 2, kind: 'villa', role: 'mayor', spec: { ...stone, windows: 0.8 }, beds: 1, y });
      const [gx, gz] = world(villa, 0, 2 + 0.8 + 3.2);
      const garden: Rect = { x: gx, z: gz, yaw: villa.yaw, hx: 5, hz: 3 };
      v.pens.push(garden);
      this.fenceRect(v, garden, villa.yaw, [0, -3]);
      const g = (type: string, lx: number, lz: number, r = 0) => { const [x, z] = world(garden, lx, lz); v.pieces.push({ type, x, y, z, yaw: villa.yaw + r }); };
      g('bench', -2, 1.8, Math.PI); g('bench', 2, 1.8, Math.PI);
      for (const lx of [-4, -1, 1, 4]) g('potted_plant', lx, 0.6);
    };
    /** An inn: a great tavern of two or three storeys filling one side of a block. */
    const inn = (bi: number, bj: number, sd: string, stories: number) => {
      const [lx, lz] = onSide(bi, bj, sd, 0, 4.25);
      const tav = raise({ lx, lz, face: SIDES[sd], tiles: 5, nz: 4, stories, kind: 'tavern', role: 'innkeeper', spec: { ground: 'stone_wall', upper: 'wood_wall', windows: 0.7 }, beds: 0, y: levelAt(bi, bj), doorX: 1 });
      this.tavern(v, tav);
    };
    /** A small building on a block's side for an evening's pleasure (the gaming den, the bathhouse). */
    const venueHouse = (bi: number, bj: number, sd: string, kind: 'den' | 'bathhouse') => {
      const y = levelAt(bi, bj), tiles = kind === 'den' ? 3 : 4;
      const [lx, lz] = onSide(bi, bj, sd, 0, 2.25);
      const h = raise({ lx, lz, face: SIDES[sd], tiles, nz: 2, stories: kind === 'den' ? 2 : 1, kind, role: 'villager', y, beds: kind === 'den' ? 1 : 0,
        spec: kind === 'den' ? { ground: 'wood_wall', upper: 'wood_wall', windows: 0.3 } : { ...stone, windows: 0.3 } });
      const fit = (type: string, x0: number, z0: number, r = 0) => { const [x, z] = world(h, x0, z0); v.pieces.push({ type, x, y: y + 0.2, z, yaw: h.yaw + r }); };
      if (kind === 'den') {
        // Dice and cards: two tables and their stools, a barrel of ale.
        for (const tx of [-1.4, 1.4]) { fit('table', tx, -0.3, Math.PI / 2); fit('stool', tx - 0.9, -0.3); fit('stool', tx + 0.9, -0.3); }
        fit('barrel', 2.4, 1.3);
      } else {
        // Three tubs, a bench to undress on.
        for (const tx of [-2.6, 0, 2.6]) fit('quench_trough', tx, 0.6, Math.PI / 2);
        fit('bench', 0, -1.3);
      }
      v.venues.push({ kind, x: h.x, z: h.z, yaw: h.yaw, hx: tiles - 1, hz: 1.1, face: { x: h.x, z: h.z }, indoors: true });
    };
    /** The playhouse: a walled yard, the stage at its north end, stands round three sides, the crowd standing between. */
    const playhouse = (bi: number, bj: number) => {
      use(bi, bj);
      const cx = bi * BLOCK, cz = bj * BLOCK, y = levelAt(bi, bj);
      pave(bi, bj, IN);
      put('stage', cx, cz + 6.4, y);
      put('stands', cx, cz - 7.4, y, Math.PI);
      put('stands', cx + 8.6, cz - 0.5, y, Math.PI / 2);
      put('stands', cx - 8.6, cz - 0.5, y, -Math.PI / 2);
      for (let d = -IN + 1; d < IN; d += 2) {
        for (const [lx, lz, ry] of [[d, IN, 0], [d, -IN, 0], [IN, d, Math.PI / 2], [-IN, d, Math.PI / 2]] as const) {
          if (lz === -IN && Math.abs(lx) < 6) continue; // the way in
          const p = pt(cx + lx, cz + lz);
          v.pieces.push({ type: 'log_wall', x: p.x, y: y - 0.1, z: p.z, yaw: F.yaw + ry });
        }
      }
      const front = pt(cx, cz + 6.4 - 2.5 - 0.7), toward = pt(cx, cz - 3);
      v.stage = { x: front.x, z: front.z, face: toward };
      const yard = pt(cx, cz - 1.6);
      v.venues.push({ kind: 'playhouse', x: yard.x, z: yard.z, yaw: F.yaw, hx: 5, hz: 2.4, face: front });
    };
    /** A pleasure garden: hedged round, gravel walks crossing at a fountain, flowers in pots, benches. */
    const garden = (bi: number, bj: number) => {
      use(bi, bj);
      const cx = bi * BLOCK, cz = bj * BLOCK, y = levelAt(bi, bj), c = pt(cx, cz);
      const r: Rect = { x: c.x, z: c.z, yaw: F.yaw, hx: IN - 0.5, hz: IN - 0.5 };
      v.pens.push(r);
      this.fenceRect(v, r, F.yaw, [0, -(IN - 0.5)]);
      v.paved.push({ x: c.x, z: c.z, yaw: F.yaw, hx: 1.2, hz: IN - 1 }, { x: c.x, z: c.z, yaw: F.yaw, hx: IN - 1, hz: 1.2 });
      put('well', cx, cz, y - 0.05);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        put('bench', cx + sx * 4.5, cz + sz * 2.2, y, sz > 0 ? Math.PI : 0);
        for (const k of [3, 5.5, 8]) put('potted_plant', cx + sx * k, cz + sz * 7.5, y);
        put('potted_plant', cx + sx * 7.5, cz + sz * 4, y);
      }
      v.venues.push({ kind: 'garden', x: c.x, z: c.z, yaw: F.yaw, hx: 7, hz: 7, face: c });
    };
    /** The cathedral close: a quiet paved yard, a well, benches. */
    const close = (bi: number, bj: number) => {
      use(bi, bj);
      const cx = bi * BLOCK, cz = bj * BLOCK, y = levelAt(bi, bj);
      pave(bi, bj, IN);
      put('well', cx + 5, cz, y - 0.05);
      for (const sx of [-1, 1]) { put('bench', cx + sx * 6, cz + 5, y, Math.PI); put('bench', cx + sx * 6, cz - 5, y); put('potted_plant', cx + sx * 9, cz + 9, y); put('potted_plant', cx + sx * 9, cz - 9, y); }
    };

    if (s.kind === 'port') {
      // ---- a port: the market square and the great buildings inland, the sailors' taverns and the merchants'
      // warehouses along the waterfront, the dockhands living just behind it.
      square(0, -1, false);
      cathedral(0, -2); fill(0, -2, { sides: 'N' });
      merchantsHall(1, -1); fill(1, -1, { sides: 'NSE' });
      mayorVilla(-1, -1); fill(-1, -1, { sides: 'NS' });
      marketHall(0, 1);
      inn(-2, 3, 'N', 3); fill(-2, 3, { sides: 'SEW' });
      inn(2, 3, 'N', 2); fill(2, 3, { sides: 'SEW' });
      venueHouse(1, 2, 'N', 'den'); fill(1, 2, { sides: 'SEW', roles: ['dockhand'], homes: 1 });
      fill(-1, 2, { roles: ['dockhand', 'dockhand'], homes: 1 });
      fill(0, 2, { roles: ['dockhand', 'merchant'] });
      fill(-2, 2, { roles: ['carpenter', 'dockhand'] });
      fill(2, 2, { roles: ['smith', 'dockhand'] });
      fill(-1, 0, { roles: ['baker', 'merchant'] });
      fill(1, 0, { roles: ['merchant'], homes: 1, tall: 0.5 });
      // The warehouses: deep, tall, of stone, wall to wall along the waterfront.
      for (const bi of [-3, -1, 0, 1, 3]) fill(bi, 3, { deep: true, stone: 0.6, tall: 0.8 });
      for (let bj = -N; bj <= N; bj++) for (let bi = -N; bi <= N; bi++) {
        if (!used.has(`${bi},${bj}`)) fill(bi, bj, { homes: (bi + bj) & 1 ? 0 : 1, tall: 0.35 });
      }
      return;
    }
    if (!city) {
      // ---- a town: the market square in the middle, the great buildings round it
      square(0, 0, false);
      cathedral(0, 1); fill(0, 1, { sides: 'N' });
      merchantsHall(1, 0); fill(1, 0, { sides: 'NSE' });
      mayorVilla(-1, 0); fill(-1, 0, { sides: 'NS' });
      inn(0, -1, 'N', 2); fill(0, -1, { sides: 'SEW', homes: 1 });
      marketHall(2, 0);
      venueHouse(1, -1, 'N', 'den'); fill(1, -1, { sides: 'SEW', homes: 1 });
      // The artisans' quarter to the south-west, merchants by the covered market.
      fill(-1, -1, { roles: ['baker', 'carpenter'] });
      fill(-2, -1, { roles: ['smith'], homes: 1 });
      fill(1, 1, { roles: ['merchant'], homes: 1, tall: 0.4 });
      fill(2, 1, { roles: ['merchant'], tall: 0.4 });
      for (let bj = -N; bj <= N; bj++) for (let bi = -N; bi <= N; bi++) {
        if (!used.has(`${bi},${bj}`)) fill(bi, bj, { homes: (bi + bj) & 1 ? 0 : 1, tall: 0.2 });
      }
      return;
    }

    // ---- a city: the lower town (homes and workshops round the square with its gallows)
    square(0, -2, true);
    fill(-1, -1, { roles: ['smith', 'carpenter'] });
    fill(-2, -1, { roles: ['baker', 'smith'] });
    fill(-1, -2, { roles: ['carpenter', 'baker'] });
    for (let bj = -N; bj <= -1; bj++) for (let bi = -N; bi <= N; bi++) {
      if (!used.has(`${bi},${bj}`)) fill(bi, bj, { homes: (bi + bj) & 1 ? 0 : 1, tall: 0.3 });
    }
    // The middle terrace: the covered market, the merchants' hall, inns and taverns, the shops; the entertainments.
    const front = 'S';
    marketHall(0, 0);
    merchantsHall(1, 0); fill(1, 0, { sides: 'NSE', noLived: front, tall: 0.7 });
    inn(0, 1, 'S', 3); fill(0, 1, { sides: 'NEW', tall: 0.7 });
    inn(-1, 0, 'E', 3); fill(-1, 0, { sides: 'NSW', noLived: front, tall: 0.7 });
    playhouse(2, 1);
    venueHouse(2, 0, 'W', 'den'); fill(2, 0, { sides: 'NSE', noLived: front, tall: 0.7 });
    venueHouse(-2, 0, 'E', 'bathhouse'); fill(-2, 0, { sides: 'NSW', noLived: front, tall: 0.7 });
    garden(-1, 1);
    fill(1, 1, { roles: ['performer', 'merchant'], tall: 0.7 });
    fill(-2, 1, { roles: ['merchant'], tall: 0.7 });
    fill(3, 0, { deep: true, stone: 0.4 }); fill(-3, 0, { deep: true, stone: 0.4 });
    fill(3, 1, { roles: ['merchant'], tall: 0.7 }); fill(-3, 1, { tall: 0.7, homes: 1 });
    // The upper close: the cathedral under the castle, the mayor, the wealthy.
    cathedral(0, 3); fill(0, 3, { sides: 'N', stone: 0.8 });
    close(0, 2);
    mayorVilla(-1, 2); fill(-1, 2, { sides: 'NS', noLived: front, stone: 0.7, tall: 0.6 });
    for (let bj = 2; bj <= N; bj++) for (let bi = -N; bi <= N; bi++) {
      if (!used.has(`${bi},${bj}`)) fill(bi, bj, { homes: (bi + bj) & 1 ? 0 : 1, homeRole: 'noble', noLived: bj === 2 ? front : '', tall: 0.6, stone: 0.6 });
    }
    // Along the top street, looking out over the town: the villas of the well-to-do, each with its garden; the tiltyard.
    const top = lines.at(-1)! + STREET / 2;
    for (const vx of [-24, -10, 10, 24, 38, 52, 66, 80]) {
      const h = raise({ lx: vx, lz: top + 0.3 + 2, face: [0, -1], tiles: 3, nz: 2, stories: Math.abs(vx) < 30 ? 3 : 2, kind: 'villa', role: 'noble', spec: { ...stone, windows: 0.8 }, beds: 1, y: tiers[2] });
      const [gx, gz] = world(h, 0, 2 + 0.6 + 3);
      const gr: Rect = { x: gx, z: gz, yaw: h.yaw, hx: 3, hz: 3 };
      v.pens.push(gr);
      this.fenceRect(v, gr, h.yaw, [0, -3]);
      const [px, pz] = world(gr, 0, 0);
      v.pieces.push({ type: 'potted_plant', x: px, y: tiers[2], z: pz, yaw: 0 });
    }
    {
      const c = pt(-60, top + 13), list: Rect = { x: c.x, z: c.z, yaw: F.yaw, hx: 22, hz: 6 };
      v.pens.push(list);
      this.fenceRect(v, list, F.yaw, [-22, 0]);
      for (let d = -17; d <= 17; d += 2) put('fence', -60 + d, top + 13, tiers[2] - 0.04);
      for (const dx of [-12, 0, 12]) put('stands', -60 + dx, top + 3.4, tiers[2], Math.PI);
    }

    // The stone walls: along each terrace's front (a gap where each street ramps up through it), down the sides of
    // the ramps, and round the two upper terraces' sides (a course higher, for a parapet).
    const course = (lx: number, lz: number, ry: number, topY: number, n: number) => {
      const p = pt(lx, lz);
      for (let k = 0; k < n; k++) v.pieces.push({ type: 'stone_wall', x: p.x, y: topY - 2 * (k + 1), z: p.z, yaw: F.yaw + ry });
    };
    const [L0, L1, L2] = tiers;
    for (const [z0, lo, hi] of [[T1_Z, L0, L1], [T2_Z, L1, L2]]) {
      for (let x = -E + 1; x < E; x += 2) {
        if (lines.some((u) => Math.abs(x - u) < STREET / 2 + 0.5)) continue;
        course(x, z0 - 0.1, 0, hi, Math.ceil((hi - lo) / 2));
      }
      for (const u of lines) {
        for (let d = 1; d < RAMP; d += 2) {
          const n = Math.ceil((hi - lo) * (1 - d / RAMP) / 2 - 0.15);
          if (n <= 0) continue;
          for (const side of [-1, 1]) if (Math.abs(u + side * STREET / 2) < E - 0.5) course(u + side * (STREET / 2 + 0.1), z0 + d, Math.PI / 2, hi, n);
        }
      }
      // The stone wall's gates: the ramps up from the lower town by the market.
      if (z0 === T1_Z) for (const u of [-BLOCK / 2, BLOCK / 2]) v.gates.push(pt(u, z0 + RAMP + 1));
    }
    for (const [z0, z1, level] of [[T1_Z, T2_Z, L1], [T2_Z, T2_END, L2]]) {
      for (let z = z0 + 1; z < z1; z += 2) {
        for (const side of [-1, 1]) {
          const low = Math.min(L0, natural(side * (E + 4), z));
          course(side * (E + 0.1), z, Math.PI / 2, level + 2, clampTo(Math.ceil((level + 2 - low) / 2), 1, 7));
        }
      }
    }
    // Across the back of the upper close, a parapet (the castle's slope rises behind it), the road up through its gate.
    for (let x = -E + 1; x < E; x += 2) if (Math.abs(x) > 3) course(x, T2_END + 0.1, 0, L2 + 2, 1);
    v.gates.push(pt(0, T2_END + 1.5));
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
   * barracks, a well in the courtyard), the road climbing to it from the
   * upper close, and a timber palisade round the whole of the town below,
   * with gates where the roads come in.
   */
  private layoutCity(v: Village, rnd: () => number) {
    const F = v.grid!, at = (lx: number, lz: number) => { const [x, z] = world(F, lx, lz); return { x, z }; };
    const H = CASTLE_HALF;
    const C = { ...at(0, CASTLE_Z), yaw: F.yaw, half: H };
    v.castle = C;
    const cat = (lx: number, lz: number) => { const [x, z] = world(C, lx, lz); return { x, z }; };
    // The castle mound: levelled at the hilltop, graded wide.
    // (Built up into a motte where the hill alone wouldn't lift it well above the upper close.)
    const level = Math.max(this.gen.height(C.x, C.z), (v.tiers?.[2] ?? -Infinity) + 9);
    v.pads.push({ x: C.x, z: C.z, yaw: C.yaw, hx: H + 3, hz: H + 3, level, fall: 16 });
    v.paved.push({ x: C.x, z: C.z, yaw: C.yaw, hx: H - 1, hz: H - 1 });
    // The road up: from the town's street, out through the palisade, to the gatehouse and into the courtyard.
    const P0 = at(0, v.lines!.at(-1)!), P1 = cat(0, -H - 2.5), P2 = cat(0, -H + 5);
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

    // The palisade: two courses of logs round the town and the villas, gates where roads come in (an opening under a lintel).
    const gaps: { side: number; at: number }[] = [];
    // (Round the lower town, meeting the stone walls of the terraces above at either end.)
    const E = v.edge!;
    const sides: [number, number, number, number][] = [[-E, T1_Z, -PAL_X, T1_Z], [-PAL_X, T1_Z, -PAL_X, -PAL_X], [-PAL_X, -PAL_X, PAL_X, -PAL_X], [PAL_X, -PAL_X, PAL_X, T1_Z], [PAL_X, T1_Z, E, T1_Z]];
    const toGrid = (p: { x: number; z: number }) => local(F, p.x, p.z);
    const crossings = v.paths.map((sg) => [toGrid({ x: sg.ax, z: sg.az }), toGrid({ x: sg.bx, z: sg.bz })]);
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

  /**
   * A port's harbour: the stone harbour wall along the quayside's edge
   * (blocks stacked down to the bed where it's deep), piers on piles out into
   * deep water with bollards and lanterns, a stone mole running out at its
   * east end to the lighthouse, treadwheel cranes over the water, cargo
   * stacked on the quay, the fish market at its west end, and the shipyard
   * just beyond the town with a great slip. Ships lie alongside the piers
   * (the berths) and come in from the sea beyond them.
   */
  private layoutHarbour(v: Village, rnd: () => number) {
    const F = v.grid!, E = v.edge!, A = HARBOUR_TOP;
    const at = (lx: number, lz: number) => world(F, lx, lz);
    const wallZ = E + APRON - 1;
    // The harbour basin, dredged out in front of the wall (or built up, where the sea's deeper) to a good depth for
    // ships to lie alongside, its edges sloping back to the natural bed.
    {
      const z0 = wallZ + 0.6, z1 = wallZ + PIER_LEN + 6, [bx, bz] = at(-2, (z0 + z1) / 2);
      v.pads.push({ x: bx, z: bz, yaw: F.yaw, hx: E + 14, hz: (z1 - z0) / 2, level: SEA - 4.6, fall: 10 });
    }
    // (The bed as the harbour leaves it.)
    const bed = (lx: number, lz: number) => { const [x, z] = at(lx, lz); return this.ground(v, x, z); };
    const put = (type: string, lx: number, lz: number, y: number, yawRel = 0) => {
      const [x, z] = at(lx, lz);
      v.pieces.push({ type, x, y, z, yaw: F.yaw + yawRel });
      return { x, z };
    };
    /** A column of quay blocks with its top at the harbour's level, as deep as the bed needs. */
    const quayColumn = (lx: number, lz: number, type = 'quay') => {
      const b = bed(lx, lz);
      if (b > A - 0.4) return false;
      for (let k = 0; k < 4; k++) {
        put(type, lx, lz, A - 5 * (k + 1));
        if (A - 5 * (k + 1) <= b + 0.3) break;
      }
      return true;
    };
    // The harbour wall.
    for (let lx = -(E + 3); lx <= E + 3; lx += 2) quayColumn(lx, wallZ);
    // The piers, each two jetties wide, as far out as their piles reach the bed.
    const berths: Berth[] = [];
    for (const px of PIERS) {
      let len = 0;
      for (let r = 0; r < PIER_LEN / 2; r++) {
        const lz = E + APRON + 1 + 2 * r;
        if (A - bed(px, lz) > 7.6) break;
        for (const sx of [-1, 1]) put('jetty', px + sx, lz, A - 7);
        len = 2 * (r + 1);
      }
      if (len < 10) continue;
      const z0 = E + APRON, z1 = z0 + len, mid = (z0 + z1) / 2;
      for (const sx of [-1, 1]) {
        for (let lz = z0 + 3; lz < z1 - 1; lz += 8) put('bollard', px + sx * 1.65, lz, A);
        put('lantern_post', px + sx * 1.6, z1 - 0.6, A);
        // A berth down each side: a ship lies along the pier, bow to the sea.
        const [ex, ez] = at(px + sx * 2, mid), [nx2, nz2] = at(px + sx * 3, mid), [ix, iz] = at(px + sx * 14, z1 + 30);
        berths.push({ x: ex, z: ez, nx: nx2 - ex, nz: nz2 - ez, yaw: F.yaw, entry: { x: ix, z: iz } });
      }
      put('cargo_pile', px, z0 + 2.5, A, 0);
    }
    // The mole out to the lighthouse, at the east end.
    {
      const mx = E + 7;
      let last = -1;
      for (let lz = wallZ; lz < wallZ + 40; lz += 2) {
        if (A - bed(mx, lz) > 19) break;
        for (const sx of [-1, 1]) quayColumn(mx + sx, lz);
        last = lz;
      }
      if (last > wallZ + 8) put('harbour_beacon', mx, last, A);
      for (let lz = wallZ + 6; lz < last - 3; lz += 10) put('lantern_post', mx - 1.4, lz, A);
    }
    // Cranes at the wall's edge, their jibs out over the water; the dockhands' work about them and the cargo.
    const docks: { x: number; z: number; face: { x: number; z: number } }[] = [];
    const spot = (lx: number, lz: number, fx: number, fz: number) => { const [x, z] = at(lx, lz), [qx, qz] = at(fx, fz); docks.push({ x, z, face: { x: qx, z: qz } }); };
    for (const cx of [-44, 0, 44]) {
      put('harbour_crane', cx, wallZ - 2.6, A);
      spot(cx + 2.2, wallZ - 3.4, cx, wallZ);
    }
    const cargo = ['cargo_pile', 'crate', 'barrel', 'sack_pile', 'keg', 'crate', 'barrel'];
    for (let k = 0; k < 18; k++) {
      const lx = -E + 30 + rnd() * (2 * E - 30), lz = E + 1.5 + rnd() * (APRON - 7);
      if (PIERS.some((p) => Math.abs(lx - p) < 4) || [-44, 0, 44].some((c) => Math.abs(lx - c) < 4)) continue;
      const type = cargo[k % cargo.length];
      put(type, lx, lz, A, Math.floor(rnd() * 4) * (Math.PI / 2));
      if (k % 3 === 0) spot(lx + 1.4, lz, lx, lz);
    }
    for (let lx = -E + 6; lx <= E; lx += 16) put('lantern_post', lx, wallZ - 1.4, A);
    // The fish market at the west end: stalls facing the quay, nets and racks drying.
    for (const [lx, lz, ry] of [[-E + 4, E + 3.5, 0], [-E + 10, E + 3.5, 0], [-E + 16, E + 3.5, 0], [-E + 7, E + 9, Math.PI], [-E + 13, E + 9, Math.PI]] as const) {
      const p = put('market_stall', lx, lz, A, ry);
      v.stalls.push({ ...p, yaw: F.yaw + ry });
    }
    put('net_rack', -E - 1, E + 6, A, Math.PI / 2);
    put('drying_rack', -E + 22, E + 8, A);
    // The shipyard: a great slip just past the west end of the quay, running down into the harbour.
    {
      const sx = -E - 12, sz = wallZ - 10;
      if (bed(sx, sz + 30) < SEA - 2.2) {
        const y = Math.max(A - 0.4, bed(sx, sz) - 0.2);
        put('great_slipway', sx, sz, y);
        put('woodpile', sx - 5, sz - 3, y);
        put('sawhorse', sx + 4.5, sz - 4, y);
        spot(sx + 3.5, sz, sx, sz);
      }
    }
    v.harbour = { berths, top: A, seaward: (() => { const [x, z] = at(0, E + APRON + PIER_LEN + 90); return { x, z }; })() };
    v.docks = docks;
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
