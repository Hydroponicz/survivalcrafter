import { FURNITURE } from './furniture';
// Item definitions. Every item instance carries its own quality (QL 1-100)
// and damage, like Wurm Online, rather than being an anonymous stack.

export type FoodEffect = 'nausea' | 'poison' | 'severe_poison' | 'heal' | 'refresh' | 'soothe';

export type ToolKind =
  | 'knife' | 'hatchet' | 'pickaxe' | 'shovel' | 'hoe' | 'hammer' | 'saw' | 'scythe' | 'weapon' | 'tongs' | 'crucible' | 'bow';

/** What each tool kind is called in requirement messages. */
export const TOOL_NAMES: Record<ToolKind, string> = {
  knife: 'knife', hatchet: 'hatchet', pickaxe: 'pickaxe', shovel: 'shovel', hoe: 'hoe', hammer: 'hammer', saw: 'saw',
  scythe: 'scythe', weapon: 'weapon', tongs: 'pair of tongs', crucible: 'crucible', bow: 'bow',
};

/** Where on the body something is worn. */
export type WearSlot = 'head' | 'body' | 'legs' | 'feet' | 'back' | 'quiver' | 'belt';
export const WEAR_SLOTS: WearSlot[] = ['head', 'body', 'legs', 'feet', 'back', 'quiver', 'belt'];
/** The clothing slots (they colour the body); the rest are gear hung on it. */
export const CLOTHING_SLOTS: WearSlot[] = ['head', 'body', 'legs', 'feet'];
export const WEAR_SLOT_NAMES: Record<WearSlot, string> = { head: 'Head', body: 'Body', legs: 'Legs', feet: 'Feet', back: 'Back', quiver: 'Quiver', belt: 'Belt' };

/** Seconds a torch burns, in your hand or planted (three in-game days of 20 minutes). */
export const TORCH_BURN = 3 * 20 * 60;

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
  food?: {
    nutrition: number;
    water?: number;
    /** Something that happens to you when you eat or use it. */
    effect?: FoodEffect;
    /** Button label instead of Eat/Drink (e.g. Apply). */
    verb?: string;
    /** Item left over afterwards (e.g. the empty jar). */
    returns?: string;
  };
  /**
   * Wild plants and fungi you have to learn. Until you identify the species it
   * goes by this description of how it looks.
   */
  unknownName?: string;
  fuel?: number; // seconds of burn time
  /** Items that cannot be carried (only exist on the ground). */
  noPickup?: boolean;
  /** Heavy equipment you set down in the world as this structure (and can pick back up). */
  places?: string;
  /** Clothing and armour: where it's worn, how much of a blow it takes (share, 0..1, scaled by quality), and its colour. */
  wear?: { slot: WearSlot; armor: number; colour: number };
  /** Extra carrying capacity while worn (kg): a backpack. */
  carry?: number;
  /** Holds this many of an item inside it (a quiver holds arrows). */
  holds?: { item: string; max: number };
  /** Holds water in drinks (a canteen): how many. */
  sips?: number;
  /** A cart you set down and use (see game/carts): which kind. */
  cart?: 'hand' | 'ox';
}

const defs: ItemDef[] = [
  // --- raw materials
  { id: 'rock_shard', name: 'Small rock', icon: '🪨', weight: 1.0, desc: 'A fist-sized stone, used for stone tools and walls. Found on shores and rocky ground, or break a boulder apart with a pickaxe.' },
  { id: 'iron_ore', name: 'Iron ore', icon: '🟤', weight: 2.0, desc: 'Rust-coloured ore. Smelt it at a lit forge.' },
  { id: 'iron_lump', name: 'Iron lump', icon: '⬛', weight: 1.0, desc: 'Smelted iron, ready to forge into tools on an anvil.' },
  { id: 'dirt', name: 'Dirt', icon: '🟫', weight: 2.0, desc: 'A pile of dirt. Use it with a shovel to raise the ground.' },
  { id: 'sand', name: 'Sand', icon: '🟨', weight: 2.0, desc: 'Fine sand. Mix it with clay to make mortar.' },
  { id: 'clay', name: 'Clay', icon: '🧱', weight: 2.0, desc: 'Sticky clay, dug up near water. Shape it into pottery.' },
  { id: 'mortar', name: 'Mortar', icon: '🥣', weight: 1.5, desc: 'Holds stone walls together.' },
  { id: 'branch', name: 'Branch', icon: '🌿', weight: 0.5, desc: 'A sturdy branch. Used for tool handles, torches and kindling.', fuel: 40 },
  { id: 'plant_fiber', name: 'Plant fiber', icon: '🌾', weight: 0.1, desc: 'Tough grass fibers. Twist them into cordage or bandages.' },
  { id: 'cordage', name: 'Cordage', icon: '🧵', weight: 0.1, desc: 'Twisted fiber rope, used to tie tools together.' },
  { id: 'log', name: 'Log', icon: '🪵', weight: 14, desc: 'A heavy log. Split it into planks at a chopping block, or burn it as fuel.', fuel: 600 },
  { id: 'plank', name: 'Rough plank', icon: '🟫', weight: 3, desc: 'A rough, uneven plank split from a log. Good for building floors, walls, roofs and doors.', fuel: 150 },
  { id: 'refined_plank', name: 'Refined plank', icon: '🟧', weight: 2.5, desc: 'A smooth plank cut with an iron saw. Used for workbenches and furniture.', fuel: 120 },
  { id: 'shaft', name: 'Shaft', icon: '🥢', weight: 0.6, desc: 'A straight wooden handle for tools.', fuel: 40 },
  { id: 'kindling', name: 'Kindling', icon: '🔥', weight: 0.3, desc: 'Dry wood chips for starting fires and making torches.', fuel: 60 },
  { id: 'torch', name: 'Torch', icon: '🔥', weight: 0.6, desc: 'A burning torch. Hold it to light your way, plant it in the ground or stand it on a floor, or mount it on a wall (indoors too). Burns for about 3 days, then relight it with kindling and a branch.' },
  { id: 'torch_spent', name: 'Spent torch', icon: '🪵', weight: 0.5, desc: 'A burnt-out torch. Relight it with a kindling and a branch (Crafting → Primitive).' },
  { id: 'sprout', name: 'Tree sprout', icon: '🌱', weight: 0.2, desc: 'Plant it in grass to grow a new tree.' },
  { id: 'wheat_seeds', name: 'Wheat seeds', icon: '🫘', weight: 0.1, desc: 'Sow them on a tilled field.' },
  { id: 'wheat', name: 'Wheat', icon: '🌾', weight: 0.5, desc: 'Harvested grain. Grind it at a quern.' },
  { id: 'hide', name: 'Hide', icon: '🟫', weight: 2, desc: 'An animal hide. Used for clothing and beds.' },
  { id: 'wool', name: 'Wool', icon: '🐑', weight: 0.4, desc: 'A fleece shorn from a sheep. Spun and woven, it makes cloth.' },

  // --- clothing (worn: see the character window, Tab)
  { id: 'hide_cap', name: 'Hide cap', icon: '🧢', weight: 0.4, wear: { slot: 'head', armor: 0.04, colour: 0x6e4a2c }, desc: 'A snug hide cap. Softens blows to the head.' },
  { id: 'hide_tunic', name: 'Hide tunic', icon: '🥼', weight: 1.6, wear: { slot: 'body', armor: 0.1, colour: 0x7a5232 }, desc: 'A hide tunic laced with cordage. Protects against tusks and horns.' },
  { id: 'hide_trousers', name: 'Hide trousers', icon: '👖', weight: 1.2, wear: { slot: 'legs', armor: 0.07, colour: 0x5e4028 }, desc: 'Tough hide leggings. Protect against tusks and thorns.' },
  { id: 'hide_backpack', name: 'Hide backpack', icon: '🎒', weight: 1.5, wear: { slot: 'back', armor: 0, colour: 0x7a5232 }, carry: 20,
    desc: 'A roomy pack of stitched hide on cordage straps. Wear it to carry 20 kg more.' },
  { id: 'quiver', name: 'Quiver', icon: '🏹', weight: 0.5, wear: { slot: 'quiver', armor: 0, colour: 0x6e4a2c }, holds: { item: 'arrow', max: 30 },
    desc: 'A hide tube slung across your back that holds up to 30 arrows. Wear it to shoot: your bow only draws arrows from your quiver. Arrows you make go straight into it.' },
  { id: 'hide_canteen', name: 'Hide canteen', icon: '🫗', weight: 0.4, wear: { slot: 'belt', armor: 0, colour: 0x5e4028 }, sips: 4,
    desc: 'A waterskin of sealed hide that hangs from your belt. Fill it at any fresh water (aim at the water), then drink from your pack: 4 good drinks.' },
  { id: 'hand_cart', name: 'Hand cart', icon: '🛒', weight: 14, cart: 'hand',
    desc: 'A two-wheeled barrow of planks. Set it down from your pack, grab the handles to push it, and load it up: it holds 120 kg.' },
  { id: 'ox_cart', name: 'Ox cart', icon: '🛞', weight: 30, cart: 'ox',
    desc: 'A big wagon on two solid wheels, with shafts for an ox. Hitch it to your tamed ox (aim at the ox → Hitch ox cart) and lead the ox: it holds 400 kg.' },
  { id: 'hide_boots', name: 'Hide boots', icon: '🥾', weight: 0.6, wear: { slot: 'feet', armor: 0.04, colour: 0x4a3220 }, desc: 'Soft hide boots, bound at the ankle.' },

  // --- tools
  { id: 'stone_knife', name: 'Stone knife', icon: '🔪', weight: 0.3, tool: 'knife', toolPower: 0.7, damage: 4, desc: 'A rough stone blade. Cuts branches, kindling and meat.' },
  { id: 'stone_hatchet', name: 'Stone hatchet', icon: '🪓', weight: 1.2, tool: 'hatchet', toolPower: 0.6, damage: 7, desc: 'A stone head tied to a branch. Chops trees and splits logs, slowly.' },
  { id: 'stone_pickaxe', name: 'Stone pickaxe', icon: '⛏️', weight: 1.5, tool: 'pickaxe', toolPower: 0.55, damage: 6, desc: 'A stone pick. Slow on rock, but it gets the job done.' },
  { id: 'wooden_hammer', name: 'Wooden hammer', icon: '🔨', weight: 0.9, tool: 'hammer', toolPower: 0.6, damage: 5, desc: 'A simple wooden mallet. Used for building and basic smithing.' },
  { id: 'stone_hammer', name: 'Stone hammer', icon: '🔨', weight: 1.2, tool: 'hammer', toolPower: 0.6, damage: 6, desc: 'An old stone hammer for building and basic smithing. (No longer crafted: make a wooden hammer instead.)' },
  { id: 'wooden_shovel', name: 'Wooden shovel', icon: '🪏', weight: 1.5, tool: 'shovel', toolPower: 0.6, damage: 4, desc: 'Digs and raises dirt, sand and clay.' },
  { id: 'stone_hoe', name: 'Stone hoe', icon: '🌱', weight: 1.3, tool: 'hoe', toolPower: 0.6, damage: 5, desc: 'A flat stone blade on a long handle. Tills soil for planting, tends crops, and levels and smooths the ground.' },
  { id: 'flint', name: 'Flint', icon: '🪨', weight: 0.3, desc: 'A glassy stone that chips into sharp edges, perfect for arrowheads. Found on shores, on rocky ground and inside broken boulders.' },
  { id: 'feather', name: 'Feather', icon: '🪶', weight: 0.01, desc: 'A long feather, sometimes found when you chop down a tree with a nest. Used for arrows.' },
  { id: 'bow', name: 'Short bow', icon: '🏹', weight: 1.0, tool: 'bow', toolPower: 0.8, damage: 0, desc: 'A simple wooden bow. Equip it, hold the left mouse button to draw and release to shoot. Needs arrows in your pack.' },
  { id: 'arrow', name: 'Arrow', icon: '➶', weight: 0.05, desc: 'A flint-tipped arrow with feather fletching. Shoot it from a bow.' },
  { id: 'bandage', name: 'Bandage', icon: '🩹', weight: 0.1, desc: 'A strip of woven plant fiber. Heals 25 health over time. Takes a few seconds to apply, so get away from danger first.' },
  { id: 'stone_spear', name: 'Stone spear', icon: '🗡️', weight: 1.5, tool: 'weapon', toolPower: 0.7, damage: 12, desc: 'A long branch with a sharp stone tip. Good for hunting.' },
  { id: 'iron_knife', name: 'Carving knife', icon: '🔪', weight: 0.4, tool: 'knife', toolPower: 1.0, damage: 6, desc: 'A sharp iron knife for carving and butchering.' },
  { id: 'iron_hatchet', name: 'Iron hatchet', icon: '🪓', weight: 1.5, tool: 'hatchet', toolPower: 1.0, damage: 11, desc: 'A sharp iron hatchet. Chops trees much faster than stone.' },
  { id: 'iron_pickaxe', name: 'Iron pickaxe', icon: '⛏️', weight: 2.5, tool: 'pickaxe', toolPower: 1.0, damage: 10, desc: 'A heavy iron pick. Breaks rock fast.' },
  { id: 'iron_hammer', name: 'Iron hammer', icon: '🔨', weight: 1.5, tool: 'hammer', toolPower: 1.0, damage: 9, desc: 'A solid iron hammer for building and smithing.' },
  { id: 'iron_shovel', name: 'Iron shovel', icon: '🪏', weight: 2, tool: 'shovel', toolPower: 1.0, damage: 7, desc: 'An iron shovel. Digs and raises earth quickly.' },
  { id: 'iron_hoe', name: 'Iron hoe', icon: '🌱', weight: 1.6, tool: 'hoe', toolPower: 1.0, damage: 8, desc: 'A wide iron hoe. Tills, tends crops and levels ground quickly.' },
  { id: 'saw', name: 'Saw', icon: '🪚', weight: 1.5, tool: 'saw', toolPower: 1.0, damage: 5, desc: 'An iron saw. Cuts logs into smooth refined planks.' },
  { id: 'scythe', name: 'Scythe', icon: '🌙', weight: 2.5, tool: 'scythe', toolPower: 1.0, damage: 10, desc: 'Harvests crops and gets you more from each one.' },
  { id: 'wooden_tongs', name: 'Green-wood tongs', icon: '🥢', weight: 0.5, tool: 'tongs', toolPower: 0.45,
    desc: 'Two green sticks tied at one end. They can hold hot metal, but burn out after a while.' },
  { id: 'iron_tongs', name: 'Iron tongs', icon: '✂️', weight: 1, tool: 'tongs', toolPower: 1.0, desc: 'Iron tongs for holding hot metal and crucibles. They never burn out.' },
  { id: 'iron_sword', name: 'Iron sword', icon: '⚔️', weight: 2.5, tool: 'weapon', toolPower: 1.0, damage: 22, desc: 'A sharp iron sword. Much deadlier than a spear.' },

  // --- pottery & containers
  { id: 'clay_jar_unfired', name: 'Unfired clay jar', icon: '⚱️', weight: 2, desc: 'Fire it in a lit campfire before you can use it.' },
  { id: 'clay_jar', name: 'Clay jar', icon: '🏺', weight: 1.5, desc: 'Aim at water to fill it, then drink from your pack.' },
  { id: 'crucible_unfired', name: 'Unfired crucible', icon: '⚱️', weight: 1.5, desc: 'A thick clay cup. Fire it in a lit campfire before you can use it.' },
  { id: 'crucible', name: 'Crucible', icon: '🫙', weight: 1.2, tool: 'crucible', toolPower: 1.0,
    desc: 'A fired clay cup that holds ore while it melts in the forge. Wears down a little each use.' },
  { id: 'jar_of_water', name: 'Jar of water', icon: '💧', weight: 3.5, food: { nutrition: 0, water: 35, returns: 'clay_jar' }, desc: 'Fresh water. Drink it or use it for cooking.' },

  // --- food
  { id: 'apple', name: 'Apple', icon: '🍎', weight: 0.15, food: { nutrition: 8, water: 4 }, desc: 'A crisp red apple from an apple tree. A tasty snack, and horses love them: hold one and feed it to a wild horse to win it over.' },
  { id: 'berries', name: 'Berries', icon: '🫐', weight: 0.1, food: { nutrition: 4, water: 2 }, desc: 'A handful of wild berries.' },
  { id: 'mushroom', name: 'Penny bun', icon: '🍄', weight: 0.1, food: { nutrition: 4 }, unknownName: 'Brown-capped mushroom',
    desc: 'A plump mushroom with a brown cap and a thick pale stem. Tasty, and even better roasted.' },
  { id: 'chanterelle', name: 'Chanterelle', icon: '🍄', weight: 0.1, food: { nutrition: 12 }, unknownName: 'Golden funnel mushroom',
    desc: 'A golden-orange mushroom shaped like a little funnel, with ridges under the cap. A prized find.' },
  { id: 'red_cap', name: 'Fly agaric', icon: '🍄', weight: 0.1, food: { nutrition: 1, effect: 'nausea' }, unknownName: 'Red spotted mushroom',
    desc: 'A striking red mushroom speckled with white spots. Makes you violently sick.' },
  { id: 'pale_cap', name: 'Death cap', icon: '🍄', weight: 0.1, food: { nutrition: 1, effect: 'poison' }, unknownName: 'Pale skirted mushroom',
    desc: 'A smooth, pale greenish-white mushroom with a skirt on its stem. Poisonous.' },
  { id: 'yarrow', name: 'Yarrow', icon: '🌿', weight: 0.05, food: { nutrition: 1, effect: 'soothe' }, unknownName: 'Feathery white-flowered herb',
    desc: 'Feathery leaves and flat clusters of tiny white flowers. Can be made into a poultice that heals wounds and cures poison.' },
  { id: 'hemlock', name: 'Hemlock', icon: '🌿', weight: 0.05, food: { nutrition: 0, effect: 'severe_poison' }, unknownName: 'Tall white-flowered herb',
    desc: 'A tall herb with lacy white flowers and a purple-spotted stem. Deadly poisonous, and easy to mistake for yarrow.' },
  { id: 'mint', name: 'Wild mint', icon: '🌱', weight: 0.05, food: { nutrition: 1, effect: 'refresh' }, unknownName: 'Toothed-leaf herb',
    desc: 'A low herb with jagged leaves and a fresh smell. Chew it, or brew it into tea to restore stamina.' },
  { id: 'wild_onion', name: 'Wild onion', icon: '🧅', weight: 0.1, food: { nutrition: 6 }, unknownName: 'Purple-flowered herb',
    desc: 'Grassy leaves and round purple flowers with a sharp smell. Edible, and great in stews.' },
  { id: 'poultice', name: 'Yarrow poultice', icon: '🩹', weight: 0.2, food: { nutrition: 0, effect: 'heal', verb: 'Apply' },
    desc: 'Heals wounds and cures poison.' },
  { id: 'mint_tea', name: 'Mint tea', icon: '🍵', weight: 3.5, food: { nutrition: 0, water: 30, effect: 'refresh', returns: 'clay_jar' },
    desc: 'A jar of fragrant tea. Restores stamina and keeps you going for a while.' },
  { id: 'hearty_stew', name: 'Hearty stew', icon: '🍲', weight: 3.5, food: { nutrition: 45, water: 15, returns: 'clay_jar' },
    desc: 'Meat and wild onion slow-cooked in a jar. The most filling meal in the game.' },
  { id: 'roast_mushroom', name: 'Roasted mushroom', icon: '🍄', weight: 0.1, food: { nutrition: 8 }, desc: 'Smoky and filling.' },
  { id: 'raw_meat', name: 'Raw meat', icon: '🥩', weight: 0.6, food: { nutrition: 3 }, desc: 'Raw meat. Cook it first, or it may make you sick.' },
  { id: 'cooked_meat', name: 'Cooked meat', icon: '🍖', weight: 0.5, food: { nutrition: 22 }, desc: 'A hearty meal.' },
  { id: 'flour', name: 'Flour', icon: '🥡', weight: 0.5, desc: 'Ground wheat. Mix it into dough.' },
  { id: 'dough', name: 'Dough', icon: '🫓', weight: 0.8, food: { nutrition: 2 }, desc: 'Bake it over a fire to make bread.' },
  { id: 'bread', name: 'Bread', icon: '🍞', weight: 0.6, food: { nutrition: 30 }, desc: 'Fresh-baked bread. Very filling.' },

  // --- smithy equipment (crafted, carried, then placed)
  { id: 'bellows', name: 'Bellows', icon: '🪗', weight: 8, places: 'bellows',
    desc: 'Leather bellows on a wooden frame. Place it against the side of a forge so it can get hot enough to smelt and smith. Better bellows heat faster and more steadily.' },
  { id: 'stone_anvil', name: 'Stone anvil', icon: '🪨', weight: 30, places: 'anvil',
    desc: 'A block of hard stone to hammer metal on. Basic, but it works. Place it near your forge.' },
  { id: 'iron_anvil', name: 'Iron anvil', icon: '⚒️', weight: 45, places: 'iron_anvil',
    desc: 'A cast-iron anvil. Much easier to work on than stone, and lets you forge higher-quality items.' },
  { id: 'quench_trough', name: 'Quench trough', icon: '🛁', weight: 15, places: 'quench_trough',
    desc: 'A wooden trough sealed with clay. Fill it with water, then dip freshly forged tools in it to harden them.' },

  // --- ground-only
  { id: 'corpse', name: 'Corpse', icon: '💀', weight: 80, noPickup: true, desc: 'Butcher it with a knife for meat and hide.' },
];

// Fine furniture, carried and set down (see data/furniture).
for (const f of FURNITURE) {
  defs.push({ id: f.id, name: f.name, icon: f.icon, weight: f.weight, places: f.id,
    desc: `${f.desc}${f.comfort ? ` Comfort ${f.comfort}: sleep in a bed near it to wake rested.` : ''} Made at a workbench; set it down from your pack, pick it up again any time.` });
}

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
  /** Freshly forged and still glowing: seconds until it has cooled in the air. */
  hot?: number;
  /** Hardened in a quench trough: wears more slowly. */
  quenched?: boolean;
  /** What's inside it (the arrows in a quiver). */
  contents?: Item[];
  /** Drinks of water left in it (a canteen). */
  fill?: number;
}

let nextUid = 1;
export function setNextUid(n: number) { nextUid = Math.max(nextUid, n); }
export function getNextUid() { return nextUid; }

export function makeItem(type: string, ql: number, label?: string): Item {
  itemDef(type);
  return { uid: nextUid++, type, ql: Math.max(1, Math.min(100, ql)), dmg: 0, label };
}

// ---------- species knowledge
// Which wild species the player has identified. Unidentified ones are called by
// what they look like everywhere in the UI.
let known = new Set<string>();

export function setKnownSpecies(types: Iterable<string>) {
  known = new Set(types);
}

export function learnSpecies(type: string) {
  known.add(type);
}

export function isIdentified(type: string): boolean {
  return !ITEMS[type]?.unknownName || known.has(type);
}

export function knownSpecies(): string[] {
  return [...known];
}

/** Name of an item type as the player currently knows it. */
export function typeName(type: string): string {
  const d = itemDef(type);
  return isIdentified(type) ? d.name : `${d.unknownName} (unidentified)`;
}

export function itemName(it: Item): string {
  const name = it.label ?? typeName(it.type);
  return it.hot ? `Glowing ${name.toLowerCase()}` : name;
}

/** Description as the player currently knows it. */
export function typeDesc(type: string): string {
  const d = itemDef(type);
  return isIdentified(type) ? d.desc : 'You are not sure what this is. Study it, or find more, to learn it.';
}
