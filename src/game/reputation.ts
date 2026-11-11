import type { Village } from '../world/villages';

// What people think of you. Each settlement keeps its own opinion of you
// (its standing, -100 to 100): trade with it, fill its work orders, live and
// work there, and it warms to you. Across the world your name travels too:
// renown grows with everything good you do anywhere, so strangers in far
// places may have heard of you.
//
// (In time: harm done, thefts and crimes cost you standing, and a bad name
// spreads too.)

export interface Tier { name: string; colour: string; blurb: string }

const TIERS: [number, Tier][] = [
  [-50, { name: 'Hated', colour: '#9a2d1e', blurb: 'They want you gone.' }],
  [-15, { name: 'Distrusted', colour: '#a5522a', blurb: 'They keep an eye on you.' }],
  [10, { name: 'Stranger', colour: '#6b5434', blurb: 'They don\'t know you yet. Trade with them and take their work orders.' }],
  [30, { name: 'Known', colour: '#5a6a2a', blurb: 'They know your face and greet you.' }],
  [55, { name: 'Liked', colour: '#3f6e1c', blurb: 'You\'re welcome here.' }],
  [80, { name: 'Respected', colour: '#2d6b4a', blurb: 'Your word counts for something here.' }],
  [Infinity, { name: 'Honoured', colour: '#8a6a10', blurb: 'One of their own, and more.' }],
];

const RENOWN: [number, string][] = [
  [10, 'Unknown'], [40, 'Heard of locally'], [120, 'Known in the region'], [300, 'Well known'], [700, 'Famous'], [Infinity, 'Legendary'],
];

const key = (v: Village) => `${v.cx},${v.cz}`;

export class Reputation {
  private standing = new Map<string, number>();
  /** How far your name has travelled (0 up). */
  renown = 0;
  /** Called when a settlement's opinion of you crosses into a new tier. */
  onTier?: (v: Village, tier: Tier, up: boolean) => void;

  of(v: Village): number { return this.standing.get(key(v)) ?? 0; }

  /** Change a settlement's opinion of you (and, for the good, your renown). */
  add(v: Village, amount: number) {
    if (!amount) return;
    const before = this.of(v), after = Math.max(-100, Math.min(100, before + amount));
    this.standing.set(key(v), after);
    if (amount > 0) this.renown += amount * 0.5;
    const t0 = tierOf(before), t1 = tierOf(after);
    if (t0 !== t1) this.onTier?.(v, t1, after > before);
  }

  /** Set a starting opinion (no messages): e.g. the village you start out working in. */
  set(v: Village, n: number) { this.standing.set(key(v), n); }

  renownName(): string { return RENOWN.find(([n]) => this.renown < n)![1]; }
  /** How far toward the next renown title (0..1). */
  renownShare(): number {
    const i = RENOWN.findIndex(([n]) => this.renown < n), lo = i > 0 ? RENOWN[i - 1][0] : 0, hi = RENOWN[i][0];
    return Number.isFinite(hi) ? (this.renown - lo) / (hi - lo) : 1;
  }

  serialize() { return { standing: [...this.standing.entries()], renown: this.renown }; }
  load(d?: { standing: [string, number][]; renown: number }) {
    if (!d) return;
    this.standing = new Map(d.standing);
    this.renown = d.renown ?? 0;
  }
}

export function tierOf(n: number): Tier { return TIERS.find(([lim]) => n < lim)![1]; }
