// Merchant shipping: each port keeps a few merchant ships (cogs, hulks,
// knarrs, caravels, now and then a carrack) that sail between the ports
// along the coast, carrying what one has spare to where it's short (through
// the ports' own stores and treasuries, like the traders on the roads), or
// out over the horizon to trade abroad and home again.
//
// A ship is a place along her voyage (worked out whether you're near or
// not); close to you she's a real ship on the water, alongside a pier with
// her sails furled or under way with them set and drawing, that you can
// walk aboard (her master won't let you take the helm).
//
// Sea routes are found once, between the ports' harbour mouths, on a grid
// over the map's raw land (only from map tiles already made, so it never
// holds up a frame), and smoothed into a few long legs.

import { itemDef, type Item } from '../data/items';
import { SHIP_PRESETS, shipStats, totalSteps, type ShipDesign } from '../data/ships';
import { vesselOf } from '../data/vessels';
import { SEA, TILE } from '../world/worldgen';
import type { CartObj } from '../world/world';
import type { Berth, Village } from '../world/villages';
import { GOODS } from './economy';
import type { Game } from './game';
import { telemetry } from './telemetry';

/** Ships show (as real ships on the water) within this distance of you. */
const SHOW_R = 900;
/** Ports within this distance of you fit out their ships (if they haven't yet). */
const SEND_R = 3200;
/** Ships set sail only from ports within this distance of you (beyond, they wait alongside). */
const ROAM_R = 4500;
/** Ports this far apart (or nearer) trade by sea. */
const LINK_R = 4000;
/** How long a ship lies alongside (s), how much she carries (kg), how far out she goes to trade abroad (m). */
const REST = 200, CAPACITY = 600, ABROAD = 1600;
/** The sea-route grid (m), and how deep a cell must be to sail through. */
const CELL = 24, DEEP = 3;

const NAMES = ['Mary', 'Trinity', 'Saint Nicholas', 'Good Fortune', 'Swallow', 'Christopher', 'Margaret', 'Holy Ghost', 'Saint Peter', 'Sea Hart',
  'Falcon', 'Rose', 'Katherine', 'Gabriel', 'Grace', 'Saint Anne', 'Clement', 'Mary Rose', 'Michael', 'George', 'Plenty', 'Kingfisher', 'Saint Botolph', 'Cog Thomas'];
/** The types a merchant fleet is made of (the carrack only now and then). */
const TYPES = ['Cog', 'Cog', 'Hulk', 'Knarr', 'Caravel', 'Balinger', 'Nef', 'Hulk', 'Cog', 'Carrack'];

type Pt = { x: number; z: number };
export interface MerchantShip {
  id: number;
  /** Her name and her home port (by grid square). */
  name: string;
  home: string;
  design: ShipDesign;
  /** Where she's sailing from and to: a port's key, or 'abroad' (out over the horizon). */
  from: string;
  to: string;
  /** Her berth at the port she's bound for (or lying at), and the one she sailed from. */
  berth: number;
  fromBerth?: number;
  /** Metres along the voyage. */
  d: number;
  /** Lying alongside (or away abroad) before she sails (seconds left). */
  rest: number;
  cargo: Item[];
  coins: number;
}

const keyOf = (v: Village) => `${v.cx},${v.cz}`;

export class Shipping {
  list: MerchantShip[] = [];
  private nextId = 1;
  private sendT = 0;
  /** Voyages worked out (by ship), and sea routes between harbour mouths (null: none could be found). */
  private voyages = new Map<number, { pts: Pt[]; len: number[] }>();
  private seaRoutes = new Map<string, Pt[] | null>();
  /** The ships on the water near you, as real ships (by ship id). */
  private hulls = new Map<number, CartObj>();

  constructor(private g: Game) {}

  private port(key: string): Village | null {
    if (key === 'abroad') return null;
    const [cx, cz] = key.split(',').map(Number);
    const v = this.g.world.terrain.villages.inCell(cx, cz);
    return v?.harbour ? v : null;
  }

  update(dt: number) {
    this.sendT -= dt;
    if (this.sendT <= 0) { this.sendT = 6; this.fitOut(); }
    const p = this.g.player.pos;
    for (const s of this.list) {
      try { this.tick(s, dt); } catch (e) {
        telemetry.error('ships', `The ${s.name} lost her way: ${(e as Error)?.message ?? e}`);
        s.rest = REST; this.voyages.delete(s.id);
      }
      const pos = this.position(s);
      const near = !!pos && Math.hypot(pos.x - p.x, pos.z - p.z) < (this.hulls.has(s.id) ? SHOW_R + 100 : SHOW_R);
      if (near && pos) this.show(s, pos, dt); else this.hide(s);
    }
  }

  // ---------- the fleets
  /** Ports near you that haven't fitted out their ships do so: two or three each, of the merchant types. */
  private fitOut() {
    const p = this.g.player.pos, eco = this.g.economy;
    for (const v of this.g.world.terrain.villages.knownAround(p.x, p.z, SEND_R)) {
      if (!v.harbour || !v.harbour.berths.length) continue;
      const l = eco.ledger(v);
      if (l.ships) continue;
      l.ships = true;
      const n = Math.min(v.harbour.berths.length, 2 + (v.cx + v.cz & 1));
      for (let k = 0; k < n; k++) {
        const type = TYPES[Math.floor(Math.random() * TYPES.length)];
        const design = { ...SHIP_PRESETS.find((s) => s.design.type === type)!.design };
        const name = `${NAMES[Math.floor(Math.random() * NAMES.length)]} of ${v.name}`;
        this.list.push({ id: this.nextId++, name, home: keyOf(v), design, from: keyOf(v), to: keyOf(v), berth: (k * 3 + 1) % v.harbour.berths.length, d: 0, rest: 20 + Math.random() * REST, cargo: [], coins: 300 });
        telemetry.event('ships', `${name} fitted out (${type.toLowerCase()})`);
      }
    }
  }

  private tick(s: MerchantShip, dt: number) {
    if (s.rest > 0) {
      s.rest -= dt;
      if (s.rest <= 0) this.setSail(s);
      return;
    }
    const r = this.voyage(s);
    if (!r) { s.rest = REST / 2; s.from = s.to; return; }
    // Under way at a steady pace, easing off near either end (warping out of the harbour, and in).
    const total = r.len.at(-1)!, ease = Math.min(1, 0.2 + Math.min(s.d, total - s.d) / 60);
    s.d += this.pace(s) * ease * dt;
    if (s.d >= total) this.arrive(s);
  }

  private pace(s: MerchantShip) { return shipStats(s.design).speed * 0.6; }

  /** Off again: to the port nearby that most wants what's spare here (or abroad, if none can be reached). */
  private setSail(s: MerchantShip) {
    const p = this.g.player.pos;
    // Home from abroad.
    if (s.from === 'abroad') { s.to = s.home; s.d = 0; this.voyages.delete(s.id); return; }
    const here = this.port(s.from), eco = this.g.economy;
    if (!here) { s.rest = REST; return; }
    // Far from you, the harbours go quiet (a ship waits alongside till you come nearer).
    if (Math.hypot(here.x - p.x, here.z - p.z) > ROAM_R) { s.rest = REST; return; }
    const ports = this.g.world.terrain.villages.knownAround(here.x, here.z, LINK_R).filter((o) => o !== here && o.harbour?.berths.length);
    let best: Village | null = null, bestScore = -1;
    for (const o of ports) {
      let score = Math.random() * 5;
      for (const [item, d] of Object.entries(GOODS)) score += Math.min(eco.surplus(here, item) + s.cargo.filter((c) => c.type === item).length, eco.shortfall(o, item)) * d.value;
      if (score > bestScore && this.seaRoute(here, o) !== undefined) { bestScore = score; best = o; }
    }
    // Load what the destination is short of and this port has spare, the most valuable first.
    if (best) {
      let kg = s.cargo.reduce((a, i) => a + itemDef(i.type).weight, 0);
      const dest = best;
      const wants = Object.entries(GOODS).map(([item, d]) => ({ item, n: Math.min(eco.surplus(here, item), eco.shortfall(dest, item)), value: d.value }))
        .filter((w) => w.n > 0).sort((a, b) => b.value - a.value);
      for (const w of wants) {
        const room = Math.floor((CAPACITY - kg) / Math.max(0.05, itemDef(w.item).weight));
        if (room <= 0) break;
        const got = eco.traderBuys(here, w.item, Math.min(w.n, room), s);
        s.cargo.push(...got);
        kg += got.reduce((a, i) => a + itemDef(i.type).weight, 0);
      }
      s.to = keyOf(best);
      s.fromBerth = s.berth;
      s.berth = this.freeBerth(best, s);
    } else s.to = 'abroad';
    s.d = 0;
    this.voyages.delete(s.id);
    telemetry.event('ships', `${s.name} sails from ${here.name} for ${best ? best.name : 'foreign parts'}`, { cargo: s.cargo.length });
  }

  /** A berth at a port that no other ship is lying at or bound for (or the least crowded). */
  private freeBerth(v: Village, me: MerchantShip): number {
    const key = keyOf(v), n = v.harbour!.berths.length, use = new Array(n).fill(0);
    for (const o of this.list) if (o !== me && (o.to === key || (o.rest > 0 && o.from === key))) use[o.berth % n]++;
    let best = 0;
    for (let i = 1; i < n; i++) if (use[i] < use[best]) best = i;
    return best;
  }

  /** Arrived: sell what this port is short of, and lie alongside a while (or, abroad, be away a long while). */
  private arrive(s: MerchantShip) {
    s.from = s.to;
    s.d = 0;
    this.voyages.delete(s.id);
    if (s.to === 'abroad') { s.rest = REST * 3; return; }
    s.rest = REST;
    const v = this.port(s.to);
    if (!v) return;
    const before = s.cargo.length;
    s.cargo = this.g.economy.traderSells(v, s.cargo, s);
    // (Back from abroad, she brings foreign goods: coin enough to buy at home.)
    if (s.to === s.home) s.coins = Math.max(s.coins, 300);
    telemetry.event('ships', `${s.name} made port at ${v.name}: sold ${before - s.cargo.length} of ${before}`, { coins: Math.round(s.coins) });
  }

  // ---------- where she is
  /** Where a ship lies alongside: off her berth's pier edge by half her beam. */
  private moored(s: MerchantShip, v: Village): { x: number; z: number; rot: number } {
    const b = v.harbour!.berths[s.berth % v.harbour!.berths.length], half = shipStats(s.design).B / 2 + 0.7;
    return { x: b.x + b.nx * half, z: b.z + b.nz * half, rot: b.yaw };
  }

  /** Where a ship is now (and which way she's going), or null if she's away abroad or her port isn't known. */
  position(s: MerchantShip): { x: number; z: number; rot: number; moving: boolean } | null {
    if (s.rest > 0) {
      const v = this.port(s.from);
      if (!v) return null;
      const m = this.moored(s, v);
      return { ...m, moving: false };
    }
    const r = this.voyage(s);
    if (!r) return null;
    const d = Math.min(s.d, r.len.at(-1)!);
    let i = 1;
    while (i < r.len.length - 1 && r.len[i] < d) i++;
    const a = r.pts[i - 1], b = r.pts[i], seg = r.len[i] - r.len[i - 1] || 1, f = (d - r.len[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, rot: Math.atan2(b.x - a.x, b.z - a.z), moving: true };
  }

  /** The whole voyage: off the berth, out of the harbour mouth, the sea route, in at the other port's mouth, alongside. */
  private voyage(s: MerchantShip) {
    let r = this.voyages.get(s.id);
    if (r) return r;
    const a = this.port(s.from === 'abroad' ? s.home : s.from), b = s.to === 'abroad' ? null : this.port(s.to);
    if (!a) return null;
    let pts: Pt[];
    if (s.from === 'abroad' || s.to === 'abroad') {
      // Out to sea past the harbour mouth and on over the horizon (or back in from it).
      const berth = a.harbour!.berths[s.berth % a.harbour!.berths.length], m = this.moored(s, a);
      const sea = a.harbour!.seaward, dx = sea.x - a.x, dz = sea.z - a.z, dl = Math.hypot(dx, dz) || 1;
      const far = { x: sea.x + (dx / dl) * ABROAD, z: sea.z + (dz / dl) * ABROAD };
      pts = [m, berth.entry, sea, far];
      if (s.from === 'abroad') pts.reverse();
    } else {
      if (!b) return null;
      const route = this.seaRoute(a, b);
      if (!route) return null;
      const fb = (s.fromBerth ?? s.berth) % a.harbour!.berths.length;
      const ba = a.harbour!.berths[fb], bb = b.harbour!.berths[s.berth % b.harbour!.berths.length];
      const ma = this.moored({ ...s, berth: fb }, a), mb = this.moored(s, b);
      pts = [ma, ba.entry, ...route, bb.entry, mb];
    }
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    r = { pts, len };
    this.voyages.set(s.id, r);
    return r;
  }

  /**
   * The sea route between two ports' harbour mouths: undefined while the map
   * between them isn't made yet (she waits), null if there's no way by sea.
   */
  private seaRoute(a: Village, b: Village): Pt[] | null | undefined {
    const key = [keyOf(a), keyOf(b)].sort().join('|');
    if (this.seaRoutes.has(key)) {
      const r = this.seaRoutes.get(key)!;
      if (!r) return null;
      return keyOf(a) < keyOf(b) ? r : [...r].reverse();
    }
    const gen = this.g.world.terrain.gen, A = a.harbour!.seaward, B = b.harbour!.seaward;
    const x0 = Math.min(A.x, B.x) - 700, x1 = Math.max(A.x, B.x) + 700, z0 = Math.min(A.z, B.z) - 700, z1 = Math.max(A.z, B.z) + 700;
    for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) if (!gen.hasTile(tx, tz)) return undefined;
    const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
    const wet = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) wet[j * nx + i] = gen.height(x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL) < SEA - DEEP ? 1 : 0;
    const cell = (p: Pt) => {
      const ci = Math.floor((p.x - x0) / CELL), cj = Math.floor((p.z - z0) / CELL);
      // (The nearest open water to it.)
      for (let r = 0; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < nx && j < nz && wet[j * nx + i]) return j * nx + i;
      }
      return -1;
    };
    const s0 = cell(A), s1 = cell(B);
    let route: Pt[] | null = null;
    if (s0 >= 0 && s1 >= 0) {
      // A* over the open water.
      const gScore = new Float32Array(nx * nz).fill(Infinity), came = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz);
      const h = (k: number) => Math.hypot((k % nx) - (s1 % nx), Math.floor(k / nx) - Math.floor(s1 / nx));
      const open: [number, number][] = [[h(s0), s0]];
      gScore[s0] = 0;
      let found = false, guard = 0;
      while (open.length && guard++ < 200000) {
        // (A plain binary heap.)
        const [, k] = open[0];
        const last = open.pop()!;
        if (open.length) { open[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[i], open[m]] = [open[m], open[i]]; i = m; } }
        if (closed[k]) continue;
        closed[k] = 1;
        if (k === s1) { found = true; break; }
        const i = k % nx, j = Math.floor(k / nx);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const n = jj * nx + ii;
          if (!wet[n] || closed[n]) continue;
          const c = gScore[k] + (di && dj ? Math.SQRT2 : 1);
          if (c < gScore[n]) {
            gScore[n] = c; came[n] = k;
            open.push([c + h(n), n]);
            for (let q = open.length - 1; q > 0;) { const p2 = (q - 1) >> 1; if (open[p2][0] <= open[q][0]) break; [open[p2], open[q]] = [open[q], open[p2]]; q = p2; }
          }
        }
      }
      if (found) {
        const cells: number[] = [];
        for (let k = s1; k !== -1; k = came[k]) cells.push(k);
        cells.reverse();
        const at = (k: number): Pt => ({ x: x0 + ((k % nx) + 0.5) * CELL, z: z0 + (Math.floor(k / nx) + 0.5) * CELL });
        // Smoothed into long legs: from each point, straight on to the furthest one still in clear water.
        const clear = (p: Pt, q: Pt) => {
          const n = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / (CELL / 2));
          for (let t = 1; t < n; t++) { const x = p.x + ((q.x - p.x) * t) / n, z = p.z + ((q.z - p.z) * t) / n; if (gen.height(x, z) >= SEA - DEEP + 0.5) return false; }
          return true;
        };
        route = [A];
        let i = 0;
        const pts = cells.map(at);
        while (i < pts.length - 1) {
          let j = pts.length - 1;
          while (j > i + 1 && !clear(pts[i], pts[j])) j--;
          route.push(pts[j]);
          i = j;
        }
        route.push(B);
      }
    }
    // (Kept the same way round whichever port asked.)
    this.seaRoutes.set(key, route && keyOf(a) > keyOf(b) ? [...route].reverse() : route);
    telemetry.event('ships', `Sea route ${a.name}–${b.name}: ${route ? `${route.length} legs` : 'none'}`);
    return route;
  }

  // ---------- seen up close: a real ship on the water
  private show(s: MerchantShip, pos: { x: number; z: number; rot: number; moving: boolean }, dt: number) {
    const w = this.g.world;
    let k = this.hulls.get(s.id);
    if (!k || !w.carts.includes(k)) {
      k = w.addCart('ship', pos.x, pos.z, pos.rot, 60);
      k.ship = { design: s.design, done: totalSteps(s.design), npc: s.id, sail: 0, speed: 0 };
      this.hulls.set(s.id, k);
    }
    // She swings round to her course (or her berth's heading) at a ship's pace, not on the spot.
    let dr = pos.rot - k.rot;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    const turn = vesselOf(k).move.water!.turn * 0.8 * dt;
    k.rot += Math.max(-turn, Math.min(turn, dr));
    const ox = k.x, oz = k.z;
    k.x = pos.x; k.z = pos.z;
    const sh = k.ship!;
    sh.sail = pos.moving ? 1 : 0;
    sh.speed = dt > 0 ? Math.hypot(k.x - ox, k.z - oz) / dt : 0;
  }

  private hide(s: MerchantShip) {
    const k = this.hulls.get(s.id);
    if (!k) return;
    const w = this.g.world, i = w.carts.indexOf(k);
    // (Not while you're aboard her: she stays as she is till you step off.)
    if (this.g.shipUnder() === k) return;
    if (i >= 0) w.carts.splice(i, 1);
    this.hulls.delete(s.id);
  }

  /** The merchant ship a hull on the water is, if it's one. */
  of(k: CartObj): MerchantShip | undefined {
    return k.ship?.npc !== undefined ? this.list.find((s) => s.id === k.ship!.npc) : undefined;
  }

  /** What you'd learn of her, looking her over. */
  describe(s: MerchantShip): string {
    const where = (key: string) => (key === 'abroad' ? 'foreign parts' : this.port(key)?.name ?? 'somewhere');
    const goods = new Map<string, number>();
    for (const i of s.cargo) goods.set(i.type, (goods.get(i.type) ?? 0) + 1);
    const hold = goods.size ? [...goods].map(([t, n]) => `${n} ${itemDef(t).name.toLowerCase()}`).join(', ') : 'nothing but ballast';
    const doing = s.rest > 0 ? (s.from === 'abroad' ? 'away abroad' : `lying alongside at ${where(s.from)}`) : `bound from ${where(s.from)} for ${where(s.to)}`;
    return `The ${s.design.type.toLowerCase()} ${s.name}, ${doing}. In her hold: ${hold}.`;
  }

  serialize() {
    return { list: this.list, nextId: this.nextId };
  }

  load(data?: { list: MerchantShip[]; nextId: number }) {
    if (!data) return;
    this.list = data.list ?? [];
    this.nextId = data.nextId ?? this.list.length + 1;
  }
}

export type { Berth };
