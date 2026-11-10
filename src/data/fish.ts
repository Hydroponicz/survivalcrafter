// The fish you can catch: in fresh water (rivers and lakes) or the sea, in
// shallows or deep water, by day or by night. Which bites depends on where
// you cast and when; how big it runs, on the water and your rod.

export interface FishDef {
  id: string;
  name: string;
  sea: boolean;
  /** How heavy they run (kg), smallest to largest. */
  kg: [number, number];
  /** How hard it fights (0..1). */
  strength: number;
  /** How often it's the one that bites, where it lives. */
  common: number;
  /** Only in water at least this deep (m). */
  minDepth?: number;
  /** When it bites best: about dawn and dusk, or at night. */
  feeds?: 'twilight' | 'night';
  /** Swims in shoals: a fine rod sometimes hooks two at once. */
  shoals?: boolean;
  /** Its colours: back, belly, and fins (for the fish on the line). */
  colors: [number, number, number];
  /** Body shape: length to depth (an eel is long and thin). */
  slender: number;
  /** Cooked fish it makes. */
  serves: number;
}

export const FISH: FishDef[] = [
  { id: 'perch', name: 'Perch', sea: false, kg: [0.15, 0.7], strength: 0.3, common: 5, shoals: true, colors: [0x4f6a32, 0xd8c890, 0xd0602a], slender: 3.2, serves: 1 },
  { id: 'trout', name: 'Trout', sea: false, kg: [0.3, 2.2], strength: 0.55, common: 3, feeds: 'twilight', colors: [0x5c6a4e, 0xe8dcc0, 0xb88060], slender: 4.2, serves: 1 },
  { id: 'carp', name: 'Carp', sea: false, kg: [1, 6], strength: 0.65, common: 2, minDepth: 0.9, colors: [0x7a6a32, 0xd8b868, 0x8a5a2a], slender: 3.0, serves: 2 },
  { id: 'pike', name: 'Pike', sea: false, kg: [1.5, 9], strength: 0.9, common: 1, minDepth: 1.4, colors: [0x3e5a34, 0xe0d8a8, 0x7a6a3a], slender: 5.2, serves: 3 },
  { id: 'eel', name: 'Eel', sea: false, kg: [0.3, 1.8], strength: 0.6, common: 1.5, feeds: 'night', colors: [0x3a3424, 0x9a8a5a, 0x3a3424], slender: 12, serves: 1 },
  { id: 'herring', name: 'Herring', sea: true, kg: [0.1, 0.45], strength: 0.25, common: 5, shoals: true, colors: [0x3a5a7a, 0xe8eef0, 0x8aa0b0], slender: 4.5, serves: 1 },
  { id: 'mackerel', name: 'Mackerel', sea: true, kg: [0.3, 1.2], strength: 0.5, common: 4, shoals: true, feeds: 'twilight', colors: [0x2a6a5a, 0xf0f0e8, 0x2a4a4a], slender: 4.8, serves: 1 },
  { id: 'sea_bass', name: 'Sea bass', sea: true, kg: [0.8, 5], strength: 0.7, common: 2, minDepth: 1, colors: [0x6a7a84, 0xe8ecec, 0x5a6a74], slender: 3.6, serves: 2 },
  { id: 'cod', name: 'Cod', sea: true, kg: [1.5, 12], strength: 0.85, common: 1.5, minDepth: 2, colors: [0x7a7050, 0xe8e0c8, 0x6a6040], slender: 4.0, serves: 3 },
];

export const FISH_BY_ID: Record<string, FishDef> = Object.fromEntries(FISH.map((f) => [f.id, f]));

/** The time of day, as fish see it. */
export function feedingTime(dayFraction: number): 'twilight' | 'night' | 'day' {
  const f = dayFraction;
  if ((f > 0.2 && f < 0.3) || (f > 0.72 && f < 0.82)) return 'twilight';
  return f > 0.77 || f < 0.23 ? 'night' : 'day';
}

/** Which fish takes the bait here and now (and how heavy it is). `fine`: a fine rod (bigger fish). */
export function whichFish(sea: boolean, depth: number, dayFraction: number, fine: boolean): { fish: FishDef; kg: number } {
  const when = feedingTime(dayFraction);
  const here = FISH.filter((f) => f.sea === sea && depth >= (f.minDepth ?? 0) * 0.8);
  const pool = here.length ? here : FISH.filter((f) => f.sea === sea);
  const weight = (f: FishDef) => f.common * (f.feeds === when ? 2.5 : f.feeds === 'night' ? 0.35 : 1) * (f.minDepth && depth > f.minDepth * 1.5 ? 1.5 : 1);
  let r = Math.random() * pool.reduce((s, f) => s + weight(f), 0);
  let fish = pool[0];
  for (const f of pool) { r -= weight(f); if (r <= 0) { fish = f; break; } }
  // Bigger in deep water, and on a fine rod (stronger line, better bait held).
  const roll = Math.pow(Math.random(), fine ? 1.3 : 2) * Math.min(1, 0.55 + depth / 5);
  const kg = fish.kg[0] + (fish.kg[1] - fish.kg[0]) * roll;
  return { fish, kg: Math.round(kg * 100) / 100 };
}
