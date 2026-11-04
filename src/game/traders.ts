// Traders: travelling merchants who walk the roads between settlements with a
// hand cart, buying up what one has to spare and selling it where it's short
// (grain from the villages to the towns, the towns' tools, bread and timber
// back out). Their buying and selling goes through the settlements' own
// stores and treasuries (see economy.ts), so a village that keeps a trader
// busy grows rich, and one cut off goes without.
//
// They're on the road whether you're near or not (a trader is just a place
// along a route, and a cart of goods); near you, you see them walking it,
// and can stop them for a word.

import * as THREE from 'three';
import { itemDef, type Item } from '../data/items';
import { cartModel, disposeObject } from '../world/view';
import type { Village } from '../world/villages';
import { GOODS } from './economy';
import { CharacterRig, characterLoaded } from './character';
import type { Game } from './game';
import { telemetry } from './telemetry';

/** Walking pace with a loaded cart (m/s), how much a cart carries, how long they stay in each place (s). */
const PACE = 1.25, CAPACITY = 100, REST = 70;
/** Traders show (and are worked out on the ground) within this distance of you. */
const SHOW_R = 120;
/** Settlements within this distance of you send out their traders (if they haven't yet). */
const SEND_R = 1400;
/** Traders set out only from settlements within this distance of you (beyond, they wait). */
const ROAM_R = 2600;

const NAMES = ['Wat', 'Gilbert', 'Adela', 'Roger', 'Simon', 'Margery', 'Piers', 'Alys', 'Ralf', 'Cecily', 'Jocelyn', 'Odo', 'Emma', 'Baldwin', 'Avice', 'Hamo'];

export interface Trader {
  id: number;
  name: string;
  /** The settlements (by grid square) they're travelling from and to. */
  from: string;
  to: string;
  /** Metres along the way. */
  d: number;
  /** Resting in a settlement before setting out (seconds left). */
  rest: number;
  cargo: Item[];
  coins: number;
}

const keyOf = (v: Village) => `${v.cx},${v.cz}`;

export class Traders {
  list: Trader[] = [];
  readonly group = Object.assign(new THREE.Group(), { name: 'traders' });
  private routes = new Map<number, { pts: { x: number; z: number }[]; len: number[] }>();
  private bodies = new Map<number, { root: THREE.Group; rig?: CharacterRig; cart: THREE.Group; loaded: boolean }>();
  private sendT = 0;
  private nextId = 1;
  /** Where each one is right now (for aiming at them). */
  private at = new Map<number, THREE.Vector3>();

  constructor(private g: Game) {}

  private village(key: string): Village | null {
    const [cx, cz] = key.split(',').map(Number);
    return this.g.world.terrain.villages.inCell(cx, cz);
  }

  update(dt: number) {
    this.sendT -= dt;
    if (this.sendT <= 0) { this.sendT = 5; this.send(); }
    const p = this.g.player.pos;
    const live = new Set<number>();
    for (const t of this.list) {
      try {
        this.tick(t, dt);
      } catch (e) {
        telemetry.error('traders', `${t.name} lost the way: ${(e as Error)?.message ?? e}`);
        t.rest = REST; this.routes.delete(t.id);
      }
      const pos = this.position(t);
      if (!pos || Math.hypot(pos.x - p.x, pos.z - p.z) > SHOW_R) continue;
      live.add(t.id);
      this.show(t, pos, dt);
    }
    for (const [id, b] of this.bodies) if (!live.has(id)) { this.group.remove(b.root); disposeObject(b.root); b.rig?.material.dispose(); this.bodies.delete(id); this.at.delete(id); }
  }

  /** Settlements near you that haven't sent out their traders yet do so (one each, two from a town). */
  private send() {
    const p = this.g.player.pos, eco = this.g.economy;
    // (Only settlements already planned: sending traders never makes the map be worked out on the spot.)
    for (const v of this.g.world.terrain.villages.knownAround(p.x, p.z, SEND_R)) {
      const l = eco.ledger(v);
      if (l.traders) continue;
      l.traders = true;
      for (let k = 0, n = v.kind === 'city' ? 3 : v.kind === 'town' ? 2 : 1; k < n; k++) {
        const t: Trader = { id: this.nextId++, name: NAMES[Math.floor(Math.random() * NAMES.length)], from: keyOf(v), to: keyOf(v), d: 0, rest: 10 + Math.random() * 60, cargo: [], coins: 80 };
        this.list.push(t);
      }
    }
  }

  private route(t: Trader) {
    let r = this.routes.get(t.id);
    if (r) return r;
    const a = this.village(t.from), b = this.village(t.to);
    if (!a || !b || a === b) return null;
    const pts = this.g.world.terrain.villages.routeBetween(a, b);
    if (pts.length < 2) return null;
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    r = { pts, len };
    this.routes.set(t.id, r);
    return r;
  }

  /** Where a trader is: along the road, or resting in a settlement. */
  position(t: Trader): { x: number; z: number; dirX: number; dirZ: number } | null {
    if (t.rest > 0 || t.from === t.to) {
      const v = this.village(t.to);
      if (!v) return null;
      // Waiting with the cart by the storehouse.
      const s = v.store ?? v.square;
      return { x: s.x + 2.5 + (t.id % 3), z: s.z + 2.5, dirX: 0, dirZ: 1 };
    }
    const r = this.route(t);
    if (!r) return null;
    const d = Math.min(t.d, r.len.at(-1)!);
    let i = 1;
    while (i < r.len.length - 1 && r.len[i] < d) i++;
    const a = r.pts[i - 1], b = r.pts[i], seg = r.len[i] - r.len[i - 1] || 1, f = (d - r.len[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, dirX: (b.x - a.x) / seg, dirZ: (b.z - a.z) / seg };
  }

  private tick(t: Trader, dt: number) {
    if (t.rest > 0) {
      t.rest -= dt;
      if (t.rest <= 0) this.setOut(t);
      return;
    }
    const r = this.route(t);
    if (!r) { t.rest = REST; t.from = t.to; return; }
    t.d += PACE * dt;
    if (t.d >= r.len.at(-1)!) this.arrive(t);
  }

  /** Arrived: sell what this place is short of, and rest a while. */
  private arrive(t: Trader) {
    const v = this.village(t.to), eco = this.g.economy;
    t.from = t.to;
    t.d = 0;
    this.routes.delete(t.id);
    t.rest = REST;
    if (!v) return;
    const before = t.cargo.length;
    t.cargo = eco.traderSells(v, t.cargo, t);
    telemetry.event('traders', `${t.name} reached ${v.name}: sold ${before - t.cargo.length} of ${before}`, { coins: Math.round(t.coins) });
  }

  /**
   * Off again: to the neighbour that most wants what's spare here (or that
   * still wants what's left in the cart), buying up those goods for it.
   */
  private setOut(t: Trader) {
    const here = this.village(t.from), eco = this.g.economy;
    if (!here) { t.rest = REST; return; }
    // Far from you, the roads go quiet (a trader waits where they are till you come nearer).
    const p = this.g.player.pos;
    if (Math.hypot(here.x - p.x, here.z - p.z) > ROAM_R) { t.rest = REST; return; }
    const near = this.g.world.terrain.villages.readyNeighbours(here);
    if (!near.length) { t.rest = REST * 3; return; }
    let best = near[Math.floor(Math.random() * near.length)], bestScore = 0;
    for (const n of near) {
      let score = 0;
      for (const [item, d] of Object.entries(GOODS)) {
        const spare = eco.surplus(here, item) + t.cargo.filter((c) => c.type === item).length;
        score += Math.min(spare, eco.shortfall(n, item)) * d.value;
      }
      if (score > bestScore) { bestScore = score; best = n; }
    }
    // Load the cart with what the destination is short of (and this place has spare), the most valuable first.
    let kg = t.cargo.reduce((s, i) => s + itemDef(i.type).weight, 0);
    const wants = Object.entries(GOODS).map(([item, d]) => ({ item, n: Math.min(eco.surplus(here, item), eco.shortfall(best, item)), value: d.value }))
      .filter((w) => w.n > 0).sort((a, b) => b.value - a.value);
    for (const w of wants) {
      const room = Math.floor((CAPACITY - kg) / Math.max(0.05, itemDef(w.item).weight));
      if (room <= 0) break;
      const got = eco.traderBuys(here, w.item, Math.min(w.n, room), t);
      t.cargo.push(...got);
      kg += got.reduce((s, i) => s + itemDef(i.type).weight, 0);
    }
    t.to = keyOf(best);
    t.d = 0;
    this.routes.delete(t.id);
    telemetry.event('traders', `${t.name} sets out from ${here.name} for ${best.name}`, { cargo: t.cargo.length });
  }

  // ---------- seen up close
  private show(t: Trader, pos: { x: number; z: number; dirX: number; dirZ: number }, dt: number) {
    let b = this.bodies.get(t.id);
    const loaded = t.cargo.length > 0;
    if (b && b.loaded !== loaded) { b.root.remove(b.cart); disposeObject(b.cart); b.cart = cartModel('hand_cart', loaded); b.root.add(b.cart); b.loaded = loaded; }
    if (!b) {
      const root = new THREE.Group();
      const cart = cartModel('hand_cart', loaded);
      root.add(cart);
      b = { root, cart, loaded };
      this.bodies.set(t.id, b);
      this.group.add(root);
    }
    if (!b.rig) {
      const gltf = characterLoaded();
      if (gltf) {
        b.rig = new CharacterRig(gltf);
        b.rig.setColours({ tunic: 0x3a5a7a, trousers: 0x4a3a2a, hair: 0x5a3a20 });
        b.root.add(b.rig.root);
      }
    }
    const moving = t.rest <= 0 && t.from !== t.to;
    const y = this.g.world.terrain.heightAt(pos.x, pos.z);
    const yaw = moving ? Math.atan2(pos.dirX, pos.dirZ) : 0;
    b.root.position.set(pos.x, y, pos.z);
    b.root.rotation.y = yaw;
    // The cart goes ahead of them, pushed by its handles.
    b.cart.position.set(0, 0, 1.45);
    b.cart.rotation.y = 0;
    b.rig?.update(dt, moving ? { kind: 'move', clip: 'walk', groundSpeed: PACE } : { kind: 'loop', clip: 'idle' }, 0.2);
    this.at.set(t.id, new THREE.Vector3(pos.x, y, pos.z));
  }

  /** A trader by the line of sight, for talking to them. */
  hit(p: THREE.Vector3): Trader | undefined {
    for (const t of this.list) {
      const at = this.at.get(t.id);
      if (at && Math.hypot(p.x - at.x, p.z - at.z) < 0.35 && p.y > at.y && p.y < at.y + 1.8) return t;
    }
    return undefined;
  }

  /** What a trader would tell you. */
  describe(t: Trader): string {
    const from = this.village(t.from)?.name ?? 'somewhere', to = this.village(t.to)?.name ?? 'somewhere';
    const counts = new Map<string, number>();
    for (const c of t.cargo) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
    const load = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n} ${itemDef(k).name.toLowerCase()}`).join(', ');
    if (t.rest > 0 || t.from === t.to) return `${t.name}, a travelling trader, resting in ${to}${load ? ` with ${load} in the cart` : ''}.`;
    return `${t.name}, a travelling trader, bound from ${from} to ${to}${load ? ` with ${load}` : ' with an empty cart, to buy'}.`;
  }

  /** Where they all are (for the map). */
  positions(): { x: number; z: number }[] {
    return this.list.map((t) => this.position(t)).filter((p): p is NonNullable<typeof p> => !!p);
  }

  serialize() {
    return { list: this.list, nextId: this.nextId };
  }

  load(data?: { list: Trader[]; nextId: number }) {
    if (!data) return;
    this.list = data.list ?? [];
    this.nextId = data.nextId ?? this.list.length + 1;
  }
}
