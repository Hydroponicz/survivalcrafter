import { Mat, WATER_LEVEL } from '../world/terrain';
import type { World } from '../world/world';

// Foraging reads the land: what you find depends on where you are, and each
// patch of ground only holds a few finds before it needs time to recover.

export type Biome = 'meadow' | 'forest' | 'shore' | 'wetland' | 'rocky' | 'bare';

export interface BiomeInfo {
  name: string;
  /** Finds an area holds when fully recovered. */
  pool: number;
  /** Weighted finds; weights may grow with foraging skill. */
  finds: (skill: number) => [string, number][];
  hint: string;
}

export const BIOMES: Record<Biome, BiomeInfo> = {
  meadow: {
    name: 'Meadow', pool: 2,
    finds: (s) => [['plant_fiber', 60], ['wheat_seeds', 6 + s * 0.15], ['branch', 5], ['mushroom', 3], ['rock_shard', 4]],
    hint: 'Open grassland: mostly plant fiber, sometimes wild wheat seeds.',
  },
  forest: {
    name: 'Forest floor', pool: 3,
    finds: (s) => [['branch', 42], ['mushroom', 16 + s * 0.2], ['plant_fiber', 18], ['sprout', 3 + s * 0.05]],
    hint: 'Under the trees: fallen branches, mushrooms and the odd seedling.',
  },
  shore: {
    name: 'Shore', pool: 2,
    finds: () => [['rock_shard', 40], ['branch', 22], ['plant_fiber', 18]],
    hint: 'Beaches: smooth pebbles, driftwood and dune grass.',
  },
  wetland: {
    name: 'Wetland', pool: 2,
    finds: (s) => [['plant_fiber', 55], ['mushroom', 8 + s * 0.1], ['branch', 8]],
    hint: 'Muddy banks: reeds for fiber, and mushrooms in the damp.',
  },
  rocky: {
    name: 'Rocky ground', pool: 3,
    finds: () => [['rock_shard', 100]],
    hint: 'Bare rock: loose stones to gather by hand. A pickaxe gets much more.',
  },
  bare: {
    name: 'Bare soil', pool: 0,
    finds: () => [],
    hint: 'Turned earth. Nothing grows here to forage.',
  },
};

/** Size of a forage area in metres. */
export const AREA = 12;
/** World seconds for an area to regrow one find. */
export const REGROW = 240;

const areaKey = (x: number, z: number) => Math.floor(z / AREA) * 1000 + Math.floor(x / AREA);

/** What kind of place this is, judged from the ground material and surroundings. */
export function biomeAt(world: World, x: number, y: number, z: number, mat: Mat): Biome {
  switch (mat) {
    case Mat.Rock:
    case Mat.Iron:
      return 'rocky';
    case Mat.Sand:
      return 'shore';
    case Mat.Clay:
      return 'wetland';
    case Mat.Dirt:
    case Mat.Field:
      return 'bare';
    case Mat.Grass: {
      let trees = 0;
      for (const o of world.near(x, z, 6)) {
        if (o.kind === 'tree' && o.age > 0.4 && Math.hypot(o.x - x, o.z - z) < 6) trees++;
      }
      if (trees >= 2) return 'forest';
      if (y < WATER_LEVEL + 1.2) return 'wetland';
      return 'meadow';
    }
    default:
      return 'bare';
  }
}

/** Depletable forage pools per area. Areas start full and regrow over world time. */
export class ForageState {
  /** Finds taken (fractional, recovering) and when that was last updated. */
  private taken = new Map<number, { used: number; at: number }>();

  /** Finds left in the area at a point. */
  left(x: number, z: number, biome: Biome, now: number): number {
    const max = BIOMES[biome].pool;
    const e = this.taken.get(areaKey(x, z));
    if (!e) return max;
    const used = Math.max(0, e.used - (now - e.at) / REGROW);
    return Math.max(0, max - used);
  }

  /** Seconds until at least one find has regrown. */
  untilNext(x: number, z: number, biome: Biome, now: number): number {
    const left = this.left(x, z, biome, now);
    return left >= 1 ? 0 : (1 - left) * REGROW;
  }

  take(x: number, z: number, now: number) {
    const k = areaKey(x, z);
    const e = this.taken.get(k);
    const used = e ? Math.max(0, e.used - (now - e.at) / REGROW) : 0;
    this.taken.set(k, { used: used + 1, at: now });
  }

  /** Describe how much is left, for Examine. */
  describe(x: number, z: number, biome: Biome, now: number): string {
    const max = BIOMES[biome].pool;
    if (!max) return 'nothing to forage';
    const left = Math.floor(this.left(x, z, biome, now));
    if (left >= max) return 'untouched';
    if (left === 0) return 'picked clean';
    return left === 1 ? 'nearly picked clean' : 'partly picked over';
  }

  reset() {
    this.taken.clear();
  }

  serialize(): [number, number, number][] {
    return [...this.taken.entries()].map(([k, e]) => [k, e.used, e.at]);
  }

  load(data: [number, number, number][] | undefined) {
    this.taken.clear();
    for (const [k, used, at] of data ?? []) this.taken.set(k, { used, at });
  }
}
