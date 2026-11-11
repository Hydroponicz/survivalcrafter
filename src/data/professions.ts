import type { SkillId } from './skills';
import type { HouseRole } from '../world/villages';

// Starting lives: what you are when the game begins. A wanderer starts in the
// wild with nothing and learns everything at their own pace. Every other
// profession starts you in a village with a trade: what you know (your skills),
// what you carry, where you begin, and your trade's quests. Each can be taken
// up at one of three levels: an apprentice still learning (the guide walks you
// through the trade step by step), a journeyman who knows the work, or a
// master with a workshop of their own.
//
// (In time: a master to work under, wages, customers and a business to run;
// and lives beyond the trades, from servants and guards to nobles.)

export type RankId = 'apprentice' | 'journeyman' | 'master';

export interface Rank {
  id: RankId;
  name: string;
  /** What it means, in a line. */
  blurb: string;
  /** Your trade's skills start at this. */
  skill: number;
  coins: number;
  recommended?: boolean;
}

export const RANKS: Rank[] = [
  { id: 'apprentice', name: 'Apprentice', recommended: true, skill: 8, coins: 15,
    blurb: 'You are still learning the trade. You start with simple tools, and your trade\'s quests guide you through the work step by step. Best for your first game.' },
  { id: 'journeyman', name: 'Journeyman', skill: 25, coins: 60,
    blurb: 'You know the work and carry good tools, and you can earn your keep. The trade\'s quests are there if you want them, but nobody holds your hand.' },
  { id: 'master', name: 'Master', skill: 45, coins: 200,
    blurb: 'You are an owner, skilled and well equipped, with a workshop of your own set up beside the village. For players who know the game: make the most of it.' },
];

export interface Profession {
  id: string;
  name: string;
  icon: string;
  /** What you do, in a line or two. */
  blurb: string;
  /** The chain it works in, from raw to finished ("wheat → flour → bread"). */
  chain: string;
  /** The village house it belongs to (you start beside one, if the village has one). */
  house?: HouseRole;
  /** The skills it uses (all start at the rank's level; the first is your main one, a little higher). */
  skills: SkillId[];
  /** The trade's quests (paths): started for an apprentice, offered to the others. */
  quests: string[];
  /** What you carry: for every rank, and extra by rank. */
  kit: { all: [string, number][]; apprentice?: [string, number][]; journeyman?: [string, number][]; master?: [string, number][] };
  /** A master's workshop: pieces set up, built, beside where you start. */
  workshop?: string[];
  /** What the trade can't work without, set up beside where you start at every level (a potter's kiln). */
  yard?: string[];
}

/** The wanderer: the default, and the way to learn everything at your own pace. */
export const WANDERER: Profession = {
  id: 'wanderer', name: 'Wanderer', icon: '🧭',
  blurb: 'You start alone in the wild with nothing but a few berries. Make camp, then learn any trade you like, in any order, at your own pace. The best way to see everything the game has.',
  chain: 'Everything, from scratch',
  skills: [], quests: [], kit: { all: [] },
};

const BASIC: [string, number][] = [['stone_knife', 1], ['berries', 10], ['fire_kit', 1]];

export const PROFESSIONS: Profession[] = [
  { id: 'woodcutter', name: 'Woodcutter', icon: '🪓', house: 'woodcutter',
    blurb: 'Fell trees, split logs into planks and kindling, and keep the village in timber and firewood.',
    chain: 'Trees → logs → planks and kindling',
    skills: ['woodcutting', 'carpentry'], quests: ['woodcutting', 'carpentry'],
    kit: { all: BASIC, apprentice: [['stone_hatchet', 1]], journeyman: [['stone_hatchet', 1], ['log', 4]], master: [['iron_hatchet', 1], ['log', 6], ['wooden_hammer', 1]] },
    workshop: ['chopping_block', 'woodpile'] },
  { id: 'charcoal', name: 'Charcoal burner', icon: '⚫', house: 'woodcutter',
    blurb: 'Hard, smoky work in the woods: stack logs into a kiln, cover it over and burn them slowly into charcoal for the smiths.',
    chain: 'Trees → logs → charcoal',
    skills: ['firemaking', 'woodcutting'], quests: ['woodcutting', 'charcoal'],
    kit: { all: BASIC, apprentice: [['stone_hatchet', 1]], journeyman: [['stone_hatchet', 1], ['wooden_shovel', 1], ['log', 4]], master: [['iron_hatchet', 1], ['wooden_shovel', 1], ['log', 6], ['charcoal', 8]] },
    workshop: ['charcoal_kiln', 'chopping_block'] },
  { id: 'hunter', name: 'Hunter', icon: '🏹', house: 'butcher',
    blurb: 'Track deer and boar, bring them down, butcher them for meat and take their hides.',
    chain: 'Game → meat and hides → leather',
    skills: ['fighting', 'butchering'], quests: ['hunting', 'butchering', 'skinning'],
    kit: { all: BASIC, apprentice: [['stone_spear', 1]], journeyman: [['stone_spear', 1], ['bow', 1], ['quiver', 1], ['arrow', 12]], master: [['bow', 1], ['quiver', 1], ['arrow', 24], ['iron_knife', 1], ['hide', 4]] },
    workshop: ['drying_rack', 'hide_tent'] },
  { id: 'tailor', name: 'Tailor', icon: '🧵', house: 'villager',
    blurb: 'Cut and stitch hides into boots, caps, tunics, backpacks and quivers that keep folk warm and safe.',
    chain: 'Hides → leather → clothing',
    skills: ['tailoring', 'ropemaking'], quests: ['skinning', 'tailoring'],
    kit: { all: BASIC, apprentice: [['hide', 2], ['cordage', 4]], journeyman: [['hide', 4], ['cordage', 6], ['hide_boots', 1]], master: [['iron_knife', 1], ['hide', 8], ['cordage', 10], ['hide_tunic', 1]] } },
  { id: 'farmer', name: 'Farmer', icon: '🌾', house: 'farmer',
    blurb: 'Till the fields, sow and tend the wheat, and bring in the harvest that feeds the village.',
    chain: 'Seeds → wheat → flour',
    skills: ['farming', 'foraging'], quests: ['farming', 'milling'],
    kit: { all: BASIC, apprentice: [['stone_hoe', 1], ['wheat_seeds', 6]], journeyman: [['stone_hoe', 1], ['wheat_seeds', 12], ['wheat', 4]], master: [['iron_hoe', 1], ['wheat_seeds', 24], ['wheat', 10], ['wooden_hammer', 1]] },
    workshop: ['quern'] },
  { id: 'baker', name: 'Baker', icon: '🍞', house: 'baker',
    blurb: 'Grind the grain, mix the dough and bake the bread the whole village lives on.',
    chain: 'Wheat → flour → dough → bread',
    skills: ['cooking', 'farming'], quests: ['milling', 'baking', 'cooking'],
    kit: { all: BASIC, apprentice: [['wheat', 4], ['clay_jar', 1]], journeyman: [['wheat', 8], ['flour', 2], ['jar_of_water', 2]], master: [['wheat', 12], ['flour', 4], ['jar_of_water', 3], ['bread', 4], ['wooden_hammer', 1]] },
    workshop: ['quern', 'campfire'] },
  { id: 'fisher', name: 'Fisher', icon: '🎣',
    blurb: 'Cast your line from the banks, the jetties and your own boat, and bring home the catch.',
    chain: 'Rod and line → fish → cooked fish',
    skills: ['fishing', 'cooking'], quests: ['fisher', 'cooking', 'boatwright'],
    kit: { all: BASIC, apprentice: [['fishing_rod', 1]], journeyman: [['fishing_rod', 1], ['paddle', 1]], master: [['fine_fishing_rod', 1], ['paddle', 1], ['cooked_fish', 4]] } },
  { id: 'potter', name: 'Potter', icon: '⚱️',
    blurb: 'Dig clay from the riverbanks, throw pots on the wheel and fire them hard.',
    chain: 'Clay → pots and jars → crucibles and mortar',
    skills: ['pottery', 'digging'], quests: ['potter', 'masonry'],
    kit: { all: BASIC, apprentice: [['wooden_shovel', 1]], journeyman: [['wooden_shovel', 1], ['clay', 6], ['clay_jar', 1]], master: [['iron_shovel', 1], ['clay', 10], ['sand', 4], ['clay_jar', 2]] },
    yard: ['pottery_kiln'] },
  { id: 'mason', name: 'Stonemason', icon: '🧱',
    blurb: 'Break and dress stone, mix mortar and raise foundations and walls that stand for ages.',
    chain: 'Stone → dressed stone and mortar → walls',
    skills: ['masonry', 'mining'], quests: ['mining', 'masonry'],
    kit: { all: BASIC, apprentice: [['stone_pickaxe', 1]], journeyman: [['stone_pickaxe', 1], ['wooden_hammer', 1], ['rock_shard', 10]], master: [['iron_pickaxe', 1], ['iron_hammer', 1], ['rock_shard', 20], ['mortar', 6]] } },
  { id: 'smith', name: 'Blacksmith', icon: '⚒️', house: 'smith',
    blurb: 'Mine ore, smelt it into iron and hammer out the tools and weapons everyone else needs.',
    chain: 'Ore → iron → tools and weapons',
    skills: ['smithing', 'mining'], quests: ['mining', 'smithing', 'combat'],
    kit: { all: BASIC, apprentice: [['stone_pickaxe', 1], ['wooden_hammer', 1]], journeyman: [['stone_pickaxe', 1], ['wooden_hammer', 1], ['wooden_tongs', 1], ['iron_ore', 3]], master: [['iron_pickaxe', 1], ['iron_hammer', 1], ['iron_tongs', 1], ['crucible', 1], ['iron_lump', 4], ['charcoal', 10]] },
    workshop: ['forge', 'bellows', 'anvil'] },
  { id: 'carpenter', name: 'Carpenter', icon: '🪚', house: 'carpenter',
    blurb: 'Saw timber into fine planks and make the furniture, doors and fittings of every home.',
    chain: 'Logs → refined planks → furniture',
    skills: ['carpentry', 'woodcutting'], quests: ['woodcutting', 'carpentry'],
    kit: { all: BASIC, apprentice: [['stone_hatchet', 1], ['wooden_hammer', 1]], journeyman: [['stone_hatchet', 1], ['wooden_hammer', 1], ['saw', 1], ['log', 2]], master: [['iron_hatchet', 1], ['iron_hammer', 1], ['saw', 1], ['refined_plank', 10], ['shaft', 6]] },
    workshop: ['workbench', 'chopping_block'] },
];

export const ALL_PROFESSIONS = [WANDERER, ...PROFESSIONS];
export const professionById = (id: string | undefined) => ALL_PROFESSIONS.find((p) => p.id === id) ?? WANDERER;
export const rankById = (id: string | undefined) => RANKS.find((r) => r.id === id) ?? RANKS[0];
