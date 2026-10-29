import { itemDef, type Item } from '../data/items';

export const CARRY_CAPACITY = 70; // kg before you start to slow down

export class Inventory {
  items: Item[] = [];

  weight(): number {
    return this.items.reduce((s, i) => s + itemDef(i.type).weight, 0);
  }

  add(item: Item) {
    this.items.push(item);
  }

  count(type: string): number {
    let n = 0;
    for (const i of this.items) if (i.type === type) n++;
    return n;
  }

  /** Best-quality items of a type first, so crafted goods benefit. */
  ofType(type: string): Item[] {
    return this.items.filter((i) => i.type === type).sort((a, b) => b.ql - a.ql);
  }

  find(uid: number): Item | undefined {
    return this.items.find((i) => i.uid === uid);
  }

  remove(uid: number): Item | undefined {
    const idx = this.items.findIndex((i) => i.uid === uid);
    if (idx < 0) return undefined;
    return this.items.splice(idx, 1)[0];
  }

  take(type: string, n: number): Item[] {
    const picked = this.ofType(type).slice(0, n);
    for (const p of picked) this.remove(p.uid);
    return picked;
  }

  /** Group items by type for display. */
  grouped(): { type: string; items: Item[] }[] {
    const map = new Map<string, Item[]>();
    for (const i of this.items) {
      let arr = map.get(i.type);
      if (!arr) map.set(i.type, (arr = []));
      arr.push(i);
    }
    return [...map.entries()].map(([type, items]) => ({ type, items: items.sort((a, b) => b.ql - a.ql) }));
  }
}
