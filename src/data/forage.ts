// Wild things you can pick up off the ground. Each species grows in certain
// biomes; rarer ones only catch the eye of a skilled forager.

export type Biome = 'meadow' | 'forest' | 'shore' | 'wetland' | 'rocky' | 'bare';

export type ForageCategory = 'material' | 'food' | 'mushroom' | 'herb';

export interface ForageSpecies {
  id: string;
  /** What you call it when you see it on the ground (before and after identifying the item). */
  name: string;
  category: ForageCategory;
  /** Spawn weight per biome. */
  biomes: Partial<Record<Biome, number>>;
  item: string;
  count: [number, number];
  /** Foraging skill needed to notice it at all (a survey reveals it a little earlier). */
  notice: number;
  /** Difficulty of picking it cleanly. */
  difficulty: number;
}

export const FORAGE_SPECIES: ForageSpecies[] = [
  { id: 'fiber_grass', name: 'Fiber grass', category: 'material', biomes: { meadow: 40, forest: 6, shore: 10 },
    item: 'plant_fiber', count: [2, 3], notice: 0, difficulty: 2 },
  { id: 'reeds', name: 'Reeds', category: 'material', biomes: { wetland: 45, shore: 6 },
    item: 'plant_fiber', count: [2, 4], notice: 0, difficulty: 3 },
  { id: 'fallen_branch', name: 'Fallen branch', category: 'material', biomes: { forest: 34, meadow: 5 },
    item: 'branch', count: [1, 2], notice: 0, difficulty: 1 },
  { id: 'driftwood', name: 'Driftwood', category: 'material', biomes: { shore: 22 },
    item: 'branch', count: [1, 2], notice: 0, difficulty: 1 },
  { id: 'pebbles', name: 'Loose pebbles', category: 'material', biomes: { shore: 26, rocky: 40, meadow: 3 },
    item: 'rock_shard', count: [1, 2], notice: 0, difficulty: 2 },
  { id: 'wild_wheat', name: 'Wild wheat', category: 'food', biomes: { meadow: 10 },
    item: 'wheat_seeds', count: [1, 2], notice: 4, difficulty: 4 },
  { id: 'penny_bun', name: 'Brown-capped mushroom', category: 'mushroom', biomes: { forest: 18, wetland: 5 },
    item: 'mushroom', count: [1, 2], notice: 0, difficulty: 3 },
  { id: 'fly_agaric', name: 'Red spotted mushroom', category: 'mushroom', biomes: { forest: 9 },
    item: 'red_cap', count: [1, 2], notice: 0, difficulty: 3 },
  { id: 'death_cap', name: 'Pale skirted mushroom', category: 'mushroom', biomes: { forest: 5, wetland: 3 },
    item: 'pale_cap', count: [1, 1], notice: 6, difficulty: 4 },
  { id: 'chanterelle', name: 'Golden funnel mushroom', category: 'mushroom', biomes: { forest: 4 },
    item: 'chanterelle', count: [1, 3], notice: 15, difficulty: 8 },
  { id: 'yarrow', name: 'Feathery white-flowered herb', category: 'herb', biomes: { meadow: 6 },
    item: 'yarrow', count: [1, 2], notice: 10, difficulty: 6 },
  { id: 'hemlock', name: 'Tall white-flowered herb', category: 'herb', biomes: { meadow: 3, wetland: 6 },
    item: 'hemlock', count: [1, 2], notice: 10, difficulty: 6 },
  { id: 'mint', name: 'Toothed-leaf herb', category: 'herb', biomes: { wetland: 9 },
    item: 'mint', count: [1, 3], notice: 6, difficulty: 5 },
  { id: 'wild_onion', name: 'Purple-flowered herb', category: 'food', biomes: { meadow: 6, forest: 2 },
    item: 'wild_onion', count: [1, 2], notice: 8, difficulty: 5 },
];

export const FORAGE: Record<string, ForageSpecies> = Object.fromEntries(FORAGE_SPECIES.map((s) => [s.id, s]));

/** How hard it is to recognise each identifiable species (herbalism difficulty). */
export const IDENTIFY: Record<string, number> = {
  mushroom: 3, red_cap: 6, pale_cap: 10, chanterelle: 12,
  yarrow: 10, hemlock: 14, mint: 6, wild_onion: 5,
};

/** Handling this many of a species teaches you what it is. */
export const LEARN_BY_HANDLING = 5;

export const BIOME_NAMES: Record<Biome, string> = {
  meadow: 'meadow', forest: 'forest floor', shore: 'shore', wetland: 'wetland', rocky: 'rocky ground', bare: 'bare soil',
};
