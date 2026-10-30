import type { ToolKind } from './items';
import type { SkillId } from './skills';

export type StationKind = 'fire' | 'forge' | 'anvil' | 'workbench' | 'quern';

export const STATION_NAMES: Record<StationKind, string> = {
  fire: 'a lit fire',
  forge: 'a lit forge with bellows',
  anvil: 'an anvil',
  workbench: 'a workbench',
  quern: 'a quern',
};

export interface Recipe {
  id: string;
  name: string;
  category: string;
  skill: SkillId;
  difficulty: number;
  time: number; // seconds at skill 1 with toolPower 1
  tool?: ToolKind;
  stations?: StationKind[];
  inputs: { item: string; count: number }[];
  output: { item: string; count: number };
  /** Tools that must be in your pack (not held), e.g. tongs and a crucible. */
  needs?: ToolKind[];
  /** Items handed back after crafting (e.g. the empty jar). */
  returns?: { item: string; count: number }[];
}

export const RECIPES: Recipe[] = [
  // --- primitive
  { id: 'cordage', name: 'Cordage', category: 'Primitive', skill: 'ropemaking', difficulty: 2, time: 4,
    inputs: [{ item: 'plant_fiber', count: 3 }], output: { item: 'cordage', count: 1 } },
  { id: 'stone_knife', name: 'Stone knife', category: 'Primitive', skill: 'toolcrafting', difficulty: 3, time: 6,
    inputs: [{ item: 'rock_shard', count: 2 }], output: { item: 'stone_knife', count: 1 } },
  { id: 'stone_hatchet', name: 'Stone hatchet', category: 'Primitive', skill: 'toolcrafting', difficulty: 6, time: 8,
    inputs: [{ item: 'branch', count: 1 }, { item: 'rock_shard', count: 1 }, { item: 'cordage', count: 1 }],
    output: { item: 'stone_hatchet', count: 1 } },
  { id: 'stone_pickaxe', name: 'Stone pickaxe', category: 'Primitive', skill: 'toolcrafting', difficulty: 8, time: 9,
    inputs: [{ item: 'branch', count: 1 }, { item: 'rock_shard', count: 2 }, { item: 'cordage', count: 1 }],
    output: { item: 'stone_pickaxe', count: 1 } },
  { id: 'stone_hammer', name: 'Stone hammer', category: 'Primitive', skill: 'toolcrafting', difficulty: 6, time: 8,
    inputs: [{ item: 'branch', count: 1 }, { item: 'rock_shard', count: 1 }, { item: 'cordage', count: 1 }],
    output: { item: 'stone_hammer', count: 1 } },
  { id: 'stone_spear', name: 'Stone spear', category: 'Primitive', skill: 'toolcrafting', difficulty: 8, time: 9,
    inputs: [{ item: 'branch', count: 2 }, { item: 'rock_shard', count: 1 }, { item: 'cordage', count: 1 }],
    output: { item: 'stone_spear', count: 1 } },
  { id: 'kindling_branch', name: 'Kindling (from branch)', category: 'Primitive', skill: 'firemaking', difficulty: 1, time: 3,
    tool: 'knife', inputs: [{ item: 'branch', count: 1 }], output: { item: 'kindling', count: 2 } },

  // --- woodworking
  { id: 'shaft', name: 'Shaft', category: 'Woodworking', skill: 'carpentry', difficulty: 3, time: 5,
    tool: 'knife', inputs: [{ item: 'branch', count: 1 }], output: { item: 'shaft', count: 1 } },
  { id: 'kindling_log', name: 'Kindling (from log)', category: 'Woodworking', skill: 'woodcutting', difficulty: 3, time: 6,
    tool: 'hatchet', inputs: [{ item: 'log', count: 1 }], output: { item: 'kindling', count: 6 } },
  { id: 'split_planks', name: 'Split log into planks', category: 'Woodworking', skill: 'carpentry', difficulty: 6, time: 12,
    tool: 'hatchet', inputs: [{ item: 'log', count: 1 }], output: { item: 'plank', count: 2 } },
  { id: 'saw_planks', name: 'Saw log into planks', category: 'Woodworking', skill: 'carpentry', difficulty: 10, time: 10,
    tool: 'saw', inputs: [{ item: 'log', count: 1 }], output: { item: 'plank', count: 5 } },
  { id: 'wooden_shovel', name: 'Wooden shovel', category: 'Woodworking', skill: 'carpentry', difficulty: 8, time: 12,
    tool: 'knife', inputs: [{ item: 'plank', count: 1 }, { item: 'shaft', count: 1 }], output: { item: 'wooden_shovel', count: 1 } },

  // --- pottery & masonry
  { id: 'clay_jar', name: 'Unfired clay jar', category: 'Pottery', skill: 'pottery', difficulty: 5, time: 8,
    inputs: [{ item: 'clay', count: 3 }], output: { item: 'clay_jar_unfired', count: 1 } },
  { id: 'fire_jar', name: 'Fire clay jar', category: 'Pottery', skill: 'pottery', difficulty: 8, time: 15,
    stations: ['fire'], inputs: [{ item: 'clay_jar_unfired', count: 1 }], output: { item: 'clay_jar', count: 1 } },
  { id: 'mortar', name: 'Mortar', category: 'Pottery', skill: 'masonry', difficulty: 6, time: 5,
    inputs: [{ item: 'clay', count: 1 }, { item: 'sand', count: 1 }], output: { item: 'mortar', count: 2 } },

  // --- metal
  { id: 'smelt_iron', name: 'Smelt iron ore', category: 'Smithing', skill: 'smithing', difficulty: 10, time: 15,
    stations: ['forge'], needs: ['crucible', 'tongs'], inputs: [{ item: 'iron_ore', count: 1 }], output: { item: 'iron_lump', count: 1 } },
  { id: 'iron_knife', name: 'Carving knife', category: 'Smithing', skill: 'smithing', difficulty: 15, time: 15,
    tool: 'hammer', stations: ['forge', 'anvil'], needs: ['tongs'],
    inputs: [{ item: 'iron_lump', count: 1 }, { item: 'shaft', count: 1 }], output: { item: 'iron_knife', count: 1 } },
  { id: 'iron_hatchet', name: 'Iron hatchet', category: 'Smithing', skill: 'smithing', difficulty: 18, time: 18,
    tool: 'hammer', stations: ['forge', 'anvil'], needs: ['tongs'],
    inputs: [{ item: 'iron_lump', count: 2 }, { item: 'shaft', count: 1 }], output: { item: 'iron_hatchet', count: 1 } },
  { id: 'iron_pickaxe', name: 'Iron pickaxe', category: 'Smithing', skill: 'smithing', difficulty: 22, time: 20,
    tool: 'hammer', stations: ['forge', 'anvil'], needs: ['tongs'],
    inputs: [{ item: 'iron_lump', count: 3 }, { item: 'shaft', count: 1 }], output: { item: 'iron_pickaxe', count: 1 } },
  { id: 'iron_hammer', name: 'Iron hammer', category: 'Smithing', skill: 'smithing', difficulty: 14, time: 15,
    tool: 'hammer', stations: ['forge', 'anvil'], needs: ['tongs'],
    inputs: [{ item: 'iron_lump', count: 1 }, { item: 'shaft', count: 1 }], output: { item: 'iron_hammer', count: 1 } },
  { id: 'iron_shovel', name: 'Iron shovel', category: 'Smithing', skill: 'smithing', difficulty: 18, time: 18,
    tool: 'hammer', stations: ['forge', 'anvil'], needs: ['tongs'],
    inputs: [{ item: 'iron_lump', count: 2 }, { item: 'shaft', count: 1 }], output: { item: 'iron_shovel', count: 1 } },
  { id: 'saw', name: 'Saw', category: 'Smithing', skill: 'smithing', difficulty: 25, time: 20,
    tool: 'hammer', stations: ['forge', 'anvil'], needs: ['tongs'],
    inputs: [{ item: 'iron_lump', count: 2 }, { item: 'plank', count: 1 }], output: { item: 'saw', count: 1 } },
  { id: 'scythe', name: 'Scythe', category: 'Smithing', skill: 'smithing', difficulty: 25, time: 20,
    tool: 'hammer', stations: ['forge', 'anvil'], needs: ['tongs'],
    inputs: [{ item: 'iron_lump', count: 2 }, { item: 'shaft', count: 2 }], output: { item: 'scythe', count: 1 } },
  { id: 'iron_sword', name: 'Iron sword', category: 'Smithing', skill: 'smithing', difficulty: 30, time: 25,
    tool: 'hammer', stations: ['forge', 'anvil'], needs: ['tongs'],
    inputs: [{ item: 'iron_lump', count: 3 }, { item: 'plank', count: 1 }, { item: 'cordage', count: 1 }],
    output: { item: 'iron_sword', count: 1 } },

  // --- smithy equipment
  { id: 'wooden_tongs', name: 'Green-wood tongs', category: 'Smithy', skill: 'carpentry', difficulty: 4, time: 8,
    tool: 'knife', inputs: [{ item: 'shaft', count: 2 }, { item: 'cordage', count: 1 }], output: { item: 'wooden_tongs', count: 1 } },
  { id: 'crucible', name: 'Unfired crucible', category: 'Smithy', skill: 'pottery', difficulty: 7, time: 8,
    inputs: [{ item: 'clay', count: 2 }, { item: 'sand', count: 1 }], output: { item: 'crucible_unfired', count: 1 } },
  { id: 'fire_crucible', name: 'Fire crucible', category: 'Smithy', skill: 'pottery', difficulty: 9, time: 15,
    stations: ['fire'], inputs: [{ item: 'crucible_unfired', count: 1 }], output: { item: 'crucible', count: 1 } },
  { id: 'bellows', name: 'Bellows', category: 'Smithy', skill: 'carpentry', difficulty: 8, time: 14,
    tool: 'hammer', inputs: [{ item: 'hide', count: 2 }, { item: 'plank', count: 2 }, { item: 'cordage', count: 2 }],
    output: { item: 'bellows', count: 1 } },
  { id: 'stone_anvil', name: 'Stone anvil', category: 'Smithy', skill: 'masonry', difficulty: 8, time: 14,
    tool: 'hammer', inputs: [{ item: 'rock_shard', count: 12 }], output: { item: 'stone_anvil', count: 1 } },
  { id: 'quench_trough', name: 'Quench trough', category: 'Smithy', skill: 'carpentry', difficulty: 8, time: 12,
    tool: 'hammer', inputs: [{ item: 'plank', count: 5 }, { item: 'clay', count: 2 }], output: { item: 'quench_trough', count: 1 } },
  { id: 'iron_tongs', name: 'Iron tongs', category: 'Smithy', skill: 'smithing', difficulty: 12, time: 14,
    tool: 'hammer', stations: ['forge', 'anvil'], needs: ['tongs'],
    inputs: [{ item: 'iron_lump', count: 1 }], output: { item: 'iron_tongs', count: 1 } },
  { id: 'iron_anvil', name: 'Cast an iron anvil', category: 'Smithy', skill: 'smithing', difficulty: 20, time: 30,
    stations: ['forge'], needs: ['crucible', 'tongs'],
    inputs: [{ item: 'iron_lump', count: 8 }, { item: 'sand', count: 4 }], output: { item: 'iron_anvil', count: 1 } },

  // --- cooking
  { id: 'poultice', name: 'Yarrow poultice', category: 'Cooking', skill: 'herbalism', difficulty: 8, time: 6,
    inputs: [{ item: 'yarrow', count: 2 }, { item: 'plant_fiber', count: 1 }], output: { item: 'poultice', count: 1 } },
  { id: 'mint_tea', name: 'Mint tea', category: 'Cooking', skill: 'herbalism', difficulty: 6, time: 8,
    stations: ['fire'], inputs: [{ item: 'mint', count: 2 }, { item: 'jar_of_water', count: 1 }], output: { item: 'mint_tea', count: 1 } },
  { id: 'hearty_stew', name: 'Hearty stew', category: 'Cooking', skill: 'cooking', difficulty: 18, time: 16,
    stations: ['fire'], inputs: [{ item: 'cooked_meat', count: 1 }, { item: 'wild_onion', count: 2 }, { item: 'jar_of_water', count: 1 }],
    output: { item: 'hearty_stew', count: 1 } },
  { id: 'roast_mushroom', name: 'Roasted penny bun', category: 'Cooking', skill: 'cooking', difficulty: 2, time: 5,
    stations: ['fire'], inputs: [{ item: 'mushroom', count: 1 }], output: { item: 'roast_mushroom', count: 1 } },
  { id: 'cooked_meat', name: 'Cooked meat', category: 'Cooking', skill: 'cooking', difficulty: 6, time: 10,
    stations: ['fire'], inputs: [{ item: 'raw_meat', count: 1 }], output: { item: 'cooked_meat', count: 1 } },
  { id: 'flour', name: 'Flour', category: 'Cooking', skill: 'cooking', difficulty: 8, time: 8,
    stations: ['quern'], inputs: [{ item: 'wheat', count: 2 }], output: { item: 'flour', count: 1 } },
  { id: 'dough', name: 'Dough', category: 'Cooking', skill: 'cooking', difficulty: 10, time: 6,
    inputs: [{ item: 'flour', count: 1 }, { item: 'jar_of_water', count: 1 }], output: { item: 'dough', count: 1 },
    returns: [{ item: 'clay_jar', count: 1 }] },
  { id: 'bread', name: 'Bread', category: 'Cooking', skill: 'cooking', difficulty: 14, time: 14,
    stations: ['fire'], inputs: [{ item: 'dough', count: 1 }], output: { item: 'bread', count: 1 } },
];
