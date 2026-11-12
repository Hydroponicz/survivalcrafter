// The village economy: each settlement keeps its goods in its stores (kept in
// its ledger, so the economy runs on whether you're there or not), reached at
// the storehouse on its square.
// Villagers bring what they make there and draw what they need from it:
// seed for the fields, fuel for the fires, iron for the smith, food at meals.
// A treasury of coins trades with passing merchants each morning (selling
// what's piled up past need, buying in what the village can't make: iron),
// and pays you for goods, at prices that follow supply and demand. Traders
// on the roads carry surplus from one settlement to another that's short of
// it (see traders.ts).
//
// Every job a villager does is open to you too: the village posts work orders
// for what it's short of (planks, wheat, wool, meat, tools...), paid per item
// delivered and a bonus on completion. What you bring goes into the same
// stores the villagers work from.

import { itemDef, makeItem, type Item } from '../data/items';
import { FISH } from '../data/fish';
import type { HouseRole, Village } from '../world/villages';
import type { StructureObj } from '../world/world';
import type { Game } from './game';
import { telemetry } from './telemetry';

export interface GoodDef {
  /** What one is worth, in coins (before supply and demand). */
  value: number;
  /** How many the village likes to keep in store (per villager when `perHead`). */
  want: number;
  perHead?: boolean;
  /** Whose work makes it (none: bought in from merchants). */
  job?: HouseRole;
  /** Eaten at meals (how many meals one makes). */
  meals?: number;
}

/** Everything a village stores, uses and trades. */
export const GOODS: Record<string, GoodDef> = {
  wheat: { value: 2, want: 2, perHead: true, job: 'farmer', meals: 0.5 },
  bread: { value: 6, want: 1, perHead: true, job: 'baker', meals: 1.5 },
  flour: { value: 3, want: 4, job: 'baker' },
  wheat_seeds: { value: 1, want: 16, job: 'farmer' },
  cooked_meat: { value: 7, want: 1, perHead: true, job: 'butcher', meals: 1 },
  raw_meat: { value: 4, want: 4, job: 'butcher' },
  // (Fish: nobody in a village fishes yet, so the stores take what you bring, and the job board may ask for some.)
  cooked_fish: { value: 5, want: 3, job: 'butcher' },
  ...Object.fromEntries(FISH.map((f) => [f.id, { value: 1 + f.serves * 2, want: 1, job: 'butcher' as HouseRole }])),
  hide: { value: 6, want: 4, job: 'butcher' },
  wool: { value: 3, want: 8, job: 'shepherd' },
  log: { value: 4, want: 10, job: 'woodcutter' },
  plank: { value: 3, want: 16, job: 'woodcutter' },
  kindling: { value: 1, want: 10, job: 'woodcutter' },
  charcoal: { value: 3, want: 6, job: 'woodcutter' },
  branch: { value: 0.5, want: 12, job: 'villager' },
  shaft: { value: 2, want: 6, job: 'villager' },
  plant_fiber: { value: 0.5, want: 10, job: 'villager' },
  rock_shard: { value: 0.5, want: 10, job: 'villager' },
  flint: { value: 1, want: 4, job: 'villager' },
  iron_lump: { value: 12, want: 4 },
  refined_plank: { value: 4, want: 10, job: 'carpenter' },
  stool: { value: 18, want: 2, job: 'carpenter' },
  chair: { value: 24, want: 2, job: 'carpenter' },
  bench: { value: 26, want: 2, job: 'carpenter' },
  table: { value: 40, want: 1, job: 'carpenter' },
  iron_knife: { value: 30, want: 2, job: 'smith' },
  iron_hoe: { value: 32, want: 2, job: 'smith' },
  iron_shovel: { value: 38, want: 2, job: 'smith' },
  iron_hatchet: { value: 42, want: 2, job: 'smith' },
  iron_pickaxe: { value: 50, want: 1, job: 'smith' },
  // The market's fruit, and the potter's ware (jars, and jars of water for the road).
  apple: { value: 2, want: 6, job: 'farmer' },
  berries: { value: 1, want: 6, job: 'villager' },
  clay_jar: { value: 8, want: 3, job: 'potter' },
  jar_of_water: { value: 9, want: 4, job: 'potter' },
  crucible: { value: 14, want: 1, job: 'potter' },
};
/** What a market's stalls are kept stocked with: when one runs low, the merchants bring more (so many, if the treasury can pay). */
const MARKET: [string, number, number][] = [
  ['kindling', 6, 12], ['branch', 4, 8], ['log', 4, 6], ['charcoal', 2, 4], ['apple', 4, 10], ['berries', 3, 8],
  ['bread', 4, 8], ['clay_jar', 2, 4], ['jar_of_water', 2, 6], ['cooked_meat', 3, 6], ['hide', 1, 3],
];

/** What a new village has in store, and in its treasury. */
const START: [string, number][] = [
  ['wheat', 12], ['wheat_seeds', 24], ['cooked_meat', 10], ['raw_meat', 2], ['log', 8], ['plank', 8], ['kindling', 10],
  ['iron_lump', 4], ['shaft', 6], ['branch', 6],
];
/** A town's stores are bigger (and it has bread and sawn timber). */
const TOWN_START: [string, number][] = [
  ['wheat', 20], ['bread', 16], ['cooked_meat', 8], ['flour', 4], ['log', 12], ['plank', 10], ['refined_plank', 6], ['kindling', 16],
  ['iron_lump', 6], ['shaft', 10], ['branch', 10], ['wheat_seeds', 6], ['charcoal', 4],
  ['apple', 12], ['berries', 10], ['clay_jar', 6], ['jar_of_water', 8], ['crucible', 1], ['hide', 2],
];
const START_TREASURY = 250, TOWN_TREASURY = 900, CITY_TREASURY = 2500;

/** A village's books (saved with the game). */
export interface Ledger {
  name: string;
  treasury: number;
  /** The storehouse has been stocked to start with. */
  seeded: boolean;
  /** The last day the merchants came. */
  traded: number;
  /** Meals missed for want of food (today). */
  hungry: number;
  hungryDay: number;
  /** What's in its stores. */
  goods: Item[];
  /** The traders based here have set out. */
  traders?: boolean;
  /** A port: its merchant ships have been fitted out. */
  ships?: boolean;
}

/** Something the village wants brought in: so many of an item, paid each, plus a bonus when done. */
export interface WorkOrder {
  village: string;
  villageName: string;
  item: string;
  count: number;
  delivered: number;
  each: number;
  bonus: number;
  job?: HouseRole;
}

const key = (v: Village) => `${v.cx},${v.cz}`;

export class Economy {
  private ledgers = new Map<string, Ledger>();
  private found = new Map<string, StructureObj>();
  /** Work orders you've taken on. */
  orders: WorkOrder[] = [];

  constructor(private g: Game) {}

  ledger(v: Village): Ledger {
    let l = this.ledgers.get(key(v));
    if (!l) {
      const town = v.kind !== 'village', big = v.kind === 'city' ? 1.6 : 1;
      l = { name: v.name, treasury: v.kind === 'city' ? CITY_TREASURY : town ? TOWN_TREASURY : START_TREASURY, seeded: true, traded: 0, hungry: 0, hungryDay: 0, goods: [] };
      for (const [type, n] of town ? TOWN_START : START) for (let i = 0; i < Math.round(n * big); i++) l.goods.push(makeItem(type, 25 + Math.random() * 15));
      this.ledgers.set(key(v), l);
    }
    l.goods ??= [];
    return l;
  }

  /** Is this settlement's ledger open yet (anyone traded with it)? */
  hasLedger(v: Village): boolean { return this.ledgers.has(key(v)); }

  /** The settlement's storehouse (if its region is loaded): where its stores are reached. */
  storehouse(v: Village): StructureObj | undefined {
    const s = v.store;
    if (!s) return undefined;
    const cached = this.found.get(key(v));
    if (cached && this.g.world.objects.get(cached.id) === cached) return cached;
    const o = this.g.world.near(s.x, s.z, 2).find((x): x is StructureObj => x.kind === 'structure' && x.type === 'village_store' && Math.hypot(x.x - s.x, x.z - s.z) < 0.5);
    if (!o) return undefined;
    this.found.set(key(v), o);
    // (An older save kept the goods in the storehouse itself: they move into the stores.)
    if (o.items?.length) {
      const l = this.ledger(v);
      if (!(l as { migrated?: boolean }).migrated) { l.goods.push(...o.items); (l as { migrated?: boolean }).migrated = true; }
      o.items = [];
      this.g.world.changed(o);
    }
    return o;
  }

  /** The village a storehouse belongs to. */
  villageOf(s: StructureObj): Village | null {
    return this.g.world.terrain.villages.at(s.x, s.z);
  }

  population(v: Village): number {
    return v.houses.reduce((n, h) => n + h.beds.length, 0);
  }

  want(v: Village, item: string): number {
    const d = GOODS[item];
    if (!d) return 0;
    return Math.round(d.perHead ? d.want * this.population(v) : d.want);
  }

  stock(v: Village, item: string): number {
    let n = 0;
    for (const i of this.ledger(v).goods) if (i.type === item) n++;
    return n;
  }

  /** How short (or long) the village is of something: >1 short, <1 plenty. */
  private scarcity(v: Village, item: string): number {
    return Math.max(0.5, Math.min(2, (this.want(v, item) + 2) / (this.stock(v, item) + 2)));
  }

  /** What the village pays you for one (`sell`), or asks for one (`buy`). */
  price(v: Village, item: string, side: 'buy' | 'sell'): number {
    const d = GOODS[item];
    if (!d) return 0;
    const p = d.value * this.scarcity(v, item) * (side === 'buy' ? 1.3 : 0.8);
    return Math.max(side === 'buy' ? 1 : 0.5, Math.round(p * 2) / 2);
  }

  /** Put things in the village's stores. */
  put(v: Village, items: Item[]): number {
    const l = this.ledger(v);
    for (const it of items) { delete it.hot; l.goods.push(it); }
    return items.length;
  }

  /** Take up to `n` of something out of the stores (the best first). */
  take(v: Village, item: string, n: number): Item[] {
    const l = this.ledger(v);
    const picked = l.goods.filter((i) => i.type === item).sort((a, b) => b.ql - a.ql).slice(0, n);
    if (!picked.length) return [];
    const set = new Set(picked);
    l.goods = l.goods.filter((i) => !set.has(i));
    return picked;
  }

  /** A villager's meal from the stores: the most filling food there is. False if there's none (they go hungry). */
  eat(v: Village): boolean {
    const l = this.ledger(v), day = this.g.world.day;
    if (l.hungryDay !== day) { l.hungryDay = day; l.hungry = 0; }
    for (const food of ['bread', 'cooked_meat', 'wheat']) {
      const need = Math.ceil(1 / (GOODS[food].meals ?? 1));
      if (this.stock(v, food) >= need) { this.take(v, food, need); return true; }
    }
    l.hungry++;
    return false;
  }

  /** Meals in store (at a meal per villager per meal time, two a day). */
  meals(v: Village): number {
    let m = 0;
    for (const [type, d] of Object.entries(GOODS)) if (d.meals) m += this.stock(v, type) * d.meals;
    return m;
  }

  /**
   * The merchants call (once a day, while you're about): they buy up what the
   * village has more of than it needs, and sell it what it can't make (iron),
   * or is about to run out of (seed, food), as the treasury allows.
   */
  trade(v: Village) {
    const l = this.ledger(v), day = this.g.world.day;
    if (l.traded === day || this.g.world.dayFraction < 8 / 24) return;
    l.traded = day;
    let sold = 0, bought = 0;
    // A town's (and a city's) market dues, tolls and rents: what keeps its treasury in coin to feed it.
    if (v.kind !== 'village') l.treasury += this.population(v) * (v.kind === 'city' ? 8 : 6);
    for (const [item, d] of Object.entries(GOODS)) {
      const have = this.stock(v, item), want = this.want(v, item);
      if (have > want * 2 + 2) {
        const n = have - want * 2;
        this.take(v, item, n);
        const coins = Math.round(n * d.value * 0.6);
        l.treasury += coins; sold += coins;
      }
    }
    const buyIn = (item: string, n: number, mark = 1.25) => {
      const each = (GOODS[item]?.value ?? 1) * mark;
      const afford = Math.min(n, Math.floor(l.treasury / each));
      if (afford <= 0) return;
      this.put(v, Array.from({ length: afford }, () => makeItem(item, 30 + Math.random() * 10)));
      l.treasury -= Math.round(afford * each);
      bought += Math.round(afford * each);
    };
    if (this.stock(v, 'iron_lump') < 2) buyIn('iron_lump', 3);
    // A town's market stalls kept in what they sell.
    if (v.kind !== 'village') for (const [item, low, n] of MARKET) if (this.stock(v, item) < low) buyIn(item, n, 1.15);
    if (this.stock(v, 'wheat_seeds') < 6) buyIn('wheat_seeds', 10);
    // Enough grain for everyone's two meals a day (a town has no fields of its own: it lives on what comes in).
    const short = this.population(v) * 2 - this.meals(v);
    if (short > 0) buyIn('wheat', Math.ceil(short / (GOODS.wheat.meals ?? 0.5)), 1.25);
    telemetry.event('economy', `${v.name}: merchants called`, { sold, bought, treasury: l.treasury });
  }

  // ---------- traders
  /** How much of something a settlement has to spare (beyond what it wants, with a margin). */
  surplus(v: Village, item: string): number {
    return Math.max(0, this.stock(v, item) - Math.ceil(this.want(v, item) * 1.2) - 1);
  }

  /** How many of something a settlement is short of. */
  shortfall(v: Village, item: string): number {
    return Math.max(0, this.want(v, item) - this.stock(v, item));
  }

  /** A trader buys from a settlement (at its own prices, a little under what it'd charge you). Returns what they got. */
  traderBuys(v: Village, item: string, n: number, purse: { coins: number }): Item[] {
    const out: Item[] = [];
    const l = this.ledger(v);
    for (let i = 0; i < n; i++) {
      const p = this.price(v, item, 'sell') * 1.1;
      if (purse.coins < p) break;
      const [it] = this.take(v, item, 1);
      if (!it) break;
      purse.coins -= p; l.treasury += p;
      out.push(it);
    }
    return out;
  }

  /** A settlement buys from a trader (what it's short of, as its treasury allows). Returns what it didn't take. */
  traderSells(v: Village, items: Item[], purse: { coins: number }): Item[] {
    const l = this.ledger(v), left: Item[] = [];
    for (const it of items) {
      const p = this.price(v, it.type, 'sell') * 1.05;
      if (!GOODS[it.type] || this.shortfall(v, it.type) <= 0 && this.stock(v, it.type) > this.want(v, it.type) * 1.5 || p > l.treasury) { left.push(it); continue; }
      l.treasury -= p; purse.coins += p;
      this.put(v, [it]);
    }
    return left;
  }

  // ---------- work orders
  /** What the village would have you bring in now: its shortfalls, most needed first. */
  openOrders(v: Village): WorkOrder[] {
    const out: WorkOrder[] = [];
    for (const [item, d] of Object.entries(GOODS)) {
      const short = this.want(v, item) - this.stock(v, item);
      if (short < 2) continue;
      if (this.orders.some((o) => o.village === key(v) && o.item === item)) continue;
      const count = Math.min(12, short);
      const each = this.price(v, item, 'sell');
      out.push({ village: key(v), villageName: v.name, item, count, delivered: 0, each, bonus: Math.max(2, Math.round(count * each * 0.25)), job: d.job });
    }
    return out.sort((a, b) => b.count * b.each - a.count * a.each);
  }

  takeOrder(o: WorkOrder) {
    if (this.orders.some((x) => x.village === o.village && x.item === o.item)) return;
    this.orders.push({ ...o });
    this.g.msg(`Work order taken: bring ${o.count} ${itemDef(o.item).name.toLowerCase()} to ${o.villageName}'s storehouse. ${o.each} coins each, and ${o.bonus} more when it's done.`, 'good');
  }

  dropOrder(o: WorkOrder) {
    this.orders = this.orders.filter((x) => x !== o);
  }

  // ---------- trading with you
  /** Sell things to the village: paid from the treasury (as far as it'll stretch); counts toward your work orders. */
  sell(v: Village, items: Item[]): number {
    const l = this.ledger(v);
    let paid = 0, n = 0;
    for (const it of items) {
      if (!GOODS[it.type]) continue;
      const p = this.price(v, it.type, 'sell');
      if (p > l.treasury) { this.g.msg(`${v.name}'s treasury can't pay for any more just now.`, 'fail'); break; }
      this.g.inv.remove(it.uid);
      this.put(v, [it]);
      l.treasury -= p;
      paid += p;
      n++;
      const order = this.orders.find((o) => o.village === key(v) && o.item === it.type);
      if (order) {
        order.delivered++;
        if (order.delivered >= order.count) {
          const bonus = Math.min(order.bonus, l.treasury);
          l.treasury -= bonus;
          this.g.coins += bonus;
          this.dropOrder(order);
          this.g.msg(`Work order done for ${v.name}: ${order.count} ${itemDef(order.item).name.toLowerCase()}. A bonus of ${bonus} coins.`, 'good');
          // Work done for a village: it thinks better of you.
          this.g.rep.add(v, 6 + order.count * 0.4);
          telemetry.event('economy', `Work order done: ${order.count} ${order.item} for ${v.name}`, { bonus });
        }
      }
    }
    this.g.coins += paid;
    // Honest trade: they get to know you.
    if (paid) this.g.rep.add(v, Math.min(4, paid * 0.06));
    if (n) this.g.inventoryChanged();
    return n;
  }

  /** Buy one of something from the village's stores. */
  buy(v: Village, item: string): boolean {
    const p = this.price(v, item, 'buy');
    if (this.g.coins < p) { this.g.msg(`You need ${p} coins for that.`, 'fail'); return false; }
    const [it] = this.take(v, item, 1);
    if (!it) return false;
    this.g.coins -= p;
    this.ledger(v).treasury += p;
    this.g.rep.add(v, Math.min(2, p * 0.03));
    this.g.inv.add(it);
    this.g.inventoryChanged();
    return true;
  }

  // ---------- saving
  serialize() {
    return { ledgers: [...this.ledgers.entries()], orders: this.orders };
  }

  load(data?: { ledgers: [string, Ledger][]; orders: WorkOrder[] }) {
    if (!data) return;
    this.ledgers = new Map(data.ledgers);
    this.orders = data.orders ?? [];
  }
}
