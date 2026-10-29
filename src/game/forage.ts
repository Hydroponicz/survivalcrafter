import { FORAGE, FORAGE_SPECIES, LEARN_BY_HANDLING, type Biome } from '../data/forage';
import { isIdentified, knownSpecies, learnSpecies, setKnownSpecies } from '../data/items';
import { mulberry32 } from '../world/noise';
import { Mat, WATER_LEVEL, WORLD_SIZE } from '../world/terrain';
import type { ForageObj, World } from '../world/world';

// Foraging reads the land: plants, fungi, branches and pebbles lie on the ground
// where they would really grow. Picking one removes it; new ones sprout over
// time in places you aren't looking.

export type { Biome };

export const BIOMES: Record<Biome, { name: string; hint: string }> = {
  meadow: { name: 'Meadow', hint: 'Open grassland: fiber grass, wild wheat and meadow herbs.' },
  forest: { name: 'Forest floor', hint: 'Under the trees: fallen branches and mushrooms of every kind.' },
  shore: { name: 'Shore', hint: 'Beaches: pebbles, driftwood and dune grass.' },
  wetland: { name: 'Wetland', hint: 'Damp banks: reeds, mint and things that like wet feet.' },
  rocky: { name: 'Rocky ground', hint: 'Bare rock: loose pebbles. A pickaxe gets much more.' },
  bare: { name: 'Bare soil', hint: 'Turned earth. Nothing grows here.' },
};

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

/** How often each biome has something lying about, per 4 m² sample. */
const DENSITY: Record<Biome, number> = { meadow: 0.16, forest: 0.24, shore: 0.14, wetland: 0.2, rocky: 0.06, bare: 0 };
/** Most finds that crowd within 6 m of each other. */
const LOCAL_CAP = 3;

function pickSpecies(biome: Biome, r: number): string | undefined {
  let total = 0;
  for (const s of FORAGE_SPECIES) total += s.biomes[biome] ?? 0;
  if (!total) return undefined;
  let x = r * total;
  for (const s of FORAGE_SPECIES) {
    x -= s.biomes[biome] ?? 0;
    if (x <= 0) return s.id;
  }
  return undefined;
}

/** Try to grow one find at a spot. Returns it, or undefined if the spot isn't suitable. */
function trySpawn(world: World, x: number, z: number, rnd: () => number): ForageObj | undefined {
  const t = world.terrain;
  if (x < 2 || z < 2 || x > WORLD_SIZE - 2 || z > WORLD_SIZE - 2) return undefined;
  const y = t.heightAt(x, z);
  if (y < WATER_LEVEL + 0.15) return undefined;
  const n = t.normalAt(x, y - 0.05, z);
  if (n.y < 0.7) return undefined; // nothing settles on a cliff face
  const mat = t.materialAt(x, y - 0.05, z);
  const biome = biomeAt(world, x, y, z, mat);
  if (rnd() > DENSITY[biome] * 4) return undefined;
  const species = pickSpecies(biome, rnd());
  if (!species) return undefined;
  let crowd = 0;
  for (const o of world.near(x, z, 6)) {
    if (o.kind === 'forage' && Math.hypot(o.x - x, o.z - z) < 6) crowd++;
    if (o.kind === 'structure' && Math.hypot(o.x - x, o.z - z) < 3) return undefined;
    if ((o.kind === 'tree' || o.kind === 'bush') && Math.hypot(o.x - x, o.z - z) < 0.8) return undefined;
  }
  if (crowd >= LOCAL_CAP) return undefined;
  return world.add<ForageObj>({ kind: 'forage', species, x, y, z, rot: rnd() * Math.PI * 2 });
}

/** Scatter finds across a fresh world. */
export function populateForage(world: World) {
  const rnd = mulberry32(world.terrain.seed + 77);
  for (let z = 4; z < WORLD_SIZE - 4; z += 4) {
    for (let x = 4; x < WORLD_SIZE - 4; x += 4) {
      // DENSITY is per sample; trySpawn scales by 4, so sample with a quarter chance.
      if (rnd() < 0.25) trySpawn(world, x + rnd() * 4, z + rnd() * 4, rnd);
    }
  }
}

/** World seconds between regrowth attempts near the player. */
const REGROW_EVERY = 10;
/** Stop regrowing once the land around you is this full again. */
const NEARBY_CAP = 100;

/**
 * Regrowth: every few seconds something new may sprout somewhere around you,
 * but never right under your nose (8–50 m away).
 */
export class ForageGrowth {
  private timer = 0;

  update(world: World, px: number, pz: number, dt: number) {
    this.timer += dt;
    while (this.timer >= REGROW_EVERY) {
      this.timer -= REGROW_EVERY;
      let nearby = 0;
      for (const o of world.near(px, pz, 50)) if (o.kind === 'forage' && Math.hypot(o.x - px, o.z - pz) < 50) nearby++;
      if (nearby >= NEARBY_CAP) continue;
      for (let tries = 0; tries < 4; tries++) {
        const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 42;
        if (trySpawn(world, px + Math.cos(a) * r, pz + Math.sin(a) * r, Math.random)) break;
      }
    }
  }
}

/** What the player has found and learned about wild species. */
export class Knowledge {
  /** Times each identifiable item type has been handled, and where it was found. */
  seen: Record<string, { count: number; biomes: Biome[] }> = {};

  /** Record a find. Returns true if handling it enough times just taught you the species. */
  handled(type: string, biome: Biome, n: number): boolean {
    const e = (this.seen[type] ??= { count: 0, biomes: [] });
    e.count += n;
    if (!e.biomes.includes(biome)) e.biomes.push(biome);
    if (!isIdentified(type) && e.count >= LEARN_BY_HANDLING) {
      learnSpecies(type);
      return true;
    }
    return false;
  }

  serialize() {
    return { known: knownSpecies(), seen: this.seen };
  }

  load(data: { known?: string[]; seen?: Knowledge['seen'] } | undefined) {
    setKnownSpecies(data?.known ?? []);
    this.seen = data?.seen ?? {};
  }
}

/** Skill needed to see a find without surveying. */
export function noticeOf(o: ForageObj): number {
  return FORAGE[o.species]?.notice ?? 0;
}
