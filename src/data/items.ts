// Item definitions. Every item instance carries its own quality (QL 1-100)
// and damage, like Wurm Online, rather than being an anonymous stack.

export type ToolKind =
  | 'knife' | 'hatchet' | 'pickaxe' | 'shovel' | 'hammer' | 'saw' | 'scythe' | 'weapon';

export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  weight: number; // kg
  desc: string;
  tool?: ToolKind;
  /** Multiplier on action speed and result quality when used as a tool. */
  toolPower?: number;
  /** Melee damage when used as a weapon (also applies to tools). */
  damage?: number;
  food?: { nutrition: number; water?: number };
  fuel?: number; // seconds of burn time
  /** Items that cannot be carried (only exist on the ground). */
  noPickup?: boolean;
}

const defs: ItemDef[] = [
  // --- raw materials
  { id: 'rock_shard', name: 'Rock shard', icon: '🪨', weight: 1.0, desc: 'A rough shard of stone. Knapped into tools, stacked into walls.' },
  { id: 'iron_ore', name: 'Iron ore', icon: '🟤', weight: 2.0, desc: 'Rust-coloured ore. Smelt it at a lit forge.' },
  { id: 'iron_lump', name: 'Iron lump', icon: '⬛', weight: 1.0, desc: 'Smelted iron, ready to be worked on an anvil.' },
  { id: 'dirt', name: 'Dirt', icon: '🟫', weight: 2.0, desc: 'A heap of dirt. Drop it to raise the ground.' },
  { id: 'sand', name: 'Sand', icon: '🟨', weight: 2.0, desc: 'Fine sand. Mixed with clay to make mortar.' },
  { id: 'clay', name: 'Clay', icon: '🧱', weight: 2.0, desc: 'Sticky clay, dug near water. Shape it into pottery.' },
  { id: 'mortar', name: 'Mortar', icon: '🥣', weight: 1.5, desc: 'Binds stone walls together.' },
  { id: 'branch', name: 'Branch', icon: '🌿', weight: 0.5, desc: 'A sturdy branch.', fuel: 40 },
  { id: 'plant_fiber', name: 'Plant fiber', icon: '🌾', weight: 0.1, desc: 'Tough grass fibers. Twist them into cordage.' },
  { id: 'cordage', name: 'Cordage', icon: '🧵', weight: 0.1, desc: 'Twisted fiber rope for binding tools.' },
  { id: 'log', name: 'Log', icon: '🪵', weight: 14, desc: 'A heavy log. Split it into planks or burn it.', fuel: 600 },
  { id: 'plank', name: 'Plank', icon: '🟧', weight: 3, desc: 'A wooden plank.', fuel: 150 },
  { id: 'shaft', name: 'Shaft', icon: '🥢', weight: 0.6, desc: 'A straight wooden handle.', fuel: 40 },
  { id: 'kindling', name: 'Kindling', icon: '🔥', weight: 0.3, desc: 'Dry wood chips used to start fires.', fuel: 60 },
  { id: 'sprout', name: 'Tree sprout', icon: '🌱', weight: 0.2, desc: 'Plant it on grass to grow a new tree.' },
  { id: 'wheat_seeds', name: 'Wheat seeds', icon: '🫘', weight: 0.1, desc: 'Sow on a cultivated field.' },
  { id: 'wheat', name: 'Wheat', icon: '🌾', weight: 0.5, desc: 'Harvested grain. Grind it at a quern.' },
  { id: 'hide', name: 'Hide', icon: '🟫', weight: 2, desc: 'An animal hide.' },

  // --- tools
  { id: 'stone_knife', name: 'Stone knife', icon: '🔪', weight: 0.3, tool: 'knife', toolPower: 0.7, damage: 4, desc: 'A crude knapped blade.' },
  { id: 'stone_hatchet', name: 'Stone hatchet', icon: '🪓', weight: 1.2, tool: 'hatchet', toolPower: 0.6, damage: 7, desc: 'A rock lashed to a branch. Fells trees, slowly.' },
  { id: 'stone_pickaxe', name: 'Stone pickaxe', icon: '⛏️', weight: 1.5, tool: 'pickaxe', toolPower: 0.55, damage: 6, desc: 'Barely bites into rock, but it works.' },
  { id: 'stone_hammer', name: 'Stone hammer', icon: '🔨', weight: 1.2, tool: 'hammer', toolPower: 0.6, damage: 6, desc: 'For building and rough smithing.' },
  { id: 'wooden_shovel', name: 'Wooden shovel', icon: '🪏', weight: 1.5, tool: 'shovel', toolPower: 0.6, damage: 4, desc: 'Digs dirt, sand and clay.' },
  { id: 'stone_spear', name: 'Stone spear', icon: '🗡️', weight: 1.5, tool: 'weapon', toolPower: 0.7, damage: 12, desc: 'A long branch tipped with a sharp shard.' },
  { id: 'iron_knife', name: 'Carving knife', icon: '🔪', weight: 0.4, tool: 'knife', toolPower: 1.0, damage: 6, desc: 'A fine iron carving knife.' },
  { id: 'iron_hatchet', name: 'Iron hatchet', icon: '🪓', weight: 1.5, tool: 'hatchet', toolPower: 1.0, damage: 11, desc: 'A proper woodcutting hatchet.' },
  { id: 'iron_pickaxe', name: 'Iron pickaxe', icon: '⛏️', weight: 2.5, tool: 'pickaxe', toolPower: 1.0, damage: 10, desc: 'Breaks rock with authority.' },
  { id: 'iron_hammer', name: 'Iron hammer', icon: '🔨', weight: 1.5, tool: 'hammer', toolPower: 1.0, damage: 9, desc: 'Smithing and construction.' },
  { id: 'iron_shovel', name: 'Iron shovel', icon: '🪏', weight: 2, tool: 'shovel', toolPower: 1.0, damage: 7, desc: 'Moves earth quickly.' },
  { id: 'saw', name: 'Saw', icon: '🪚', weight: 1.5, tool: 'saw', toolPower: 1.0, damage: 5, desc: 'Cuts logs into many planks.' },
  { id: 'scythe', name: 'Scythe', icon: '🌙', weight: 2.5, tool: 'scythe', toolPower: 1.0, damage: 10, desc: 'Harvests crops with a better yield.' },
  { id: 'iron_sword', name: 'Iron sword', icon: '⚔️', weight: 2.5, tool: 'weapon', toolPower: 1.0, damage: 22, desc: 'A real weapon.' },

  // --- pottery & containers
  { id: 'clay_jar_unfired', name: 'Unfired clay jar', icon: '⚱️', weight: 2, desc: 'Needs to be fired in a lit fire.' },
  { id: 'clay_jar', name: 'Clay jar', icon: '🏺', weight: 1.5, desc: 'Fill it at the water\'s edge.' },
  { id: 'jar_of_water', name: 'Jar of water', icon: '💧', weight: 3.5, food: { nutrition: 0, water: 35 }, desc: 'Fresh water. Drink it or cook with it.' },

  // --- food
  { id: 'berries', name: 'Berries', icon: '🫐', weight: 0.1, food: { nutrition: 4, water: 2 }, desc: 'A handful of wild berries.' },
  { id: 'mushroom', name: 'Mushroom', icon: '🍄', weight: 0.1, food: { nutrition: 3 }, desc: 'Edible... probably.' },
  { id: 'roast_mushroom', name: 'Roasted mushroom', icon: '🍄', weight: 0.1, food: { nutrition: 8 }, desc: 'Smoky and filling.' },
  { id: 'raw_meat', name: 'Raw meat', icon: '🥩', weight: 0.6, food: { nutrition: 3 }, desc: 'You should really cook this.' },
  { id: 'cooked_meat', name: 'Cooked meat', icon: '🍖', weight: 0.5, food: { nutrition: 22 }, desc: 'A hearty meal.' },
  { id: 'flour', name: 'Flour', icon: '🥡', weight: 0.5, desc: 'Ground wheat.' },
  { id: 'dough', name: 'Dough', icon: '🫓', weight: 0.8, food: { nutrition: 2 }, desc: 'Bake it over a fire.' },
  { id: 'bread', name: 'Bread', icon: '🍞', weight: 0.6, food: { nutrition: 30 }, desc: 'Fresh bread. The best food around.' },

  // --- ground-only
  { id: 'corpse', name: 'Corpse', icon: '💀', weight: 80, noPickup: true, desc: 'Butcher it with a knife.' },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Unknown item ${id}`);
  return d;
}

export interface Item {
  uid: number;
  type: string;
  ql: number; // 1..100
  dmg: number; // 0..100, item breaks at 100
  /** Optional custom label, e.g. "deer corpse". */
  label?: string;
}

let nextUid = 1;
export function setNextUid(n: number) { nextUid = Math.max(nextUid, n); }
export function getNextUid() { return nextUid; }

export function makeItem(type: string, ql: number, label?: string): Item {
  itemDef(type);
  return { uid: nextUid++, type, ql: Math.max(1, Math.min(100, ql)), dmg: 0, label };
}

export function itemName(it: Item): string {
  return it.label ?? itemDef(it.type).name;
}
