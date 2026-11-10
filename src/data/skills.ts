// Skills rise from 1 to 100 with heavily diminishing returns. Like Wurm, you
// learn most from actions whose difficulty is close to your current level.

export const SKILLS = {
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  digging: 'Digging',
  foraging: 'Foraging',
  herbalism: 'Herbalism',
  toolcrafting: 'Toolcrafting',
  ropemaking: 'Ropemaking',
  carpentry: 'Carpentry',
  masonry: 'Masonry',
  smithing: 'Smithing',
  pottery: 'Pottery',
  firemaking: 'Firemaking',
  cooking: 'Cooking',
  farming: 'Farming',
  fighting: 'Fighting',
  butchering: 'Butchering',
  tailoring: 'Tailoring',
  taming: 'Taming',
  fishing: 'Fishing',
} as const;

export type SkillId = keyof typeof SKILLS;

/** What each skill is for (tooltips). */
export const SKILL_INFO: Record<SkillId, string> = {
  woodcutting: 'Chopping trees and splitting wood. Higher skill means faster chopping and better logs.',
  mining: 'Mining rock, ore and boulders with a pickaxe. Higher skill means faster mining and better ore.',
  digging: 'Moving earth: digging and raising ground with a shovel, levelling and smoothing it with a hoe.',
  foraging: 'Gathering wild plants and items. Higher skill reveals rarer finds and makes surveys (G) reach further.',
  herbalism: 'Knowing your plants and mushrooms. Helps you recognise what\'s safe to eat.',
  toolcrafting: 'Making stone tools: knives, hatchets, pickaxes, hoes, hammers and spears.',
  ropemaking: 'Twisting plant fiber into cordage and bandages.',
  carpentry: 'Woodworking and building: planks, handles, furniture, floors, walls, roofs and doors.',
  masonry: 'Building with stone: foundations, walls, forges, querns and anvils.',
  smithing: 'Smelting ore and forging iron tools at the forge and anvil.',
  pottery: 'Shaping and firing clay jars and crucibles.',
  firemaking: 'Building and lighting fires, and making kindling and torches.',
  cooking: 'Roasting, baking and brewing. Higher skill makes more filling food.',
  farming: 'Tilling fields, and sowing, tending and harvesting wheat.',
  fighting: 'Fighting animals and dodging their attacks.',
  butchering: 'Butchering animals with a knife. Higher skill gives more meat and cleaner hides.',
  tailoring: 'Making clothing from hides. Higher skill makes better protection.',
  fishing: 'Catching fish with a rod: casting, striking when the float goes under, and playing the fish in. Higher skill: bites come sooner and the fight is more forgiving.',
  taming: 'Winning wild animals over. Feed a wild horse apples to tame it: the higher your skill, the better the chance each time.',
};

export class Skills {
  levels: Record<SkillId, number>;

  constructor() {
    this.levels = {} as Record<SkillId, number>;
    for (const k of Object.keys(SKILLS) as SkillId[]) this.levels[k] = 1;
  }

  get(id: SkillId): number {
    return this.levels[id];
  }

  /** Chance of success for an action of the given difficulty (0..100). */
  successChance(id: SkillId, difficulty: number, toolQl = 0, toolPower = 1): number {
    const s = this.levels[id];
    const bonus = toolQl * 0.15 * toolPower;
    const c = 0.65 + (s + bonus - difficulty) / 35;
    return Math.max(0.05, Math.min(0.97, c));
  }

  /**
   * Result quality: bounded by skill, nudged by tool and material quality.
   * Can never exceed the material quality by much — good materials matter.
   */
  rollQuality(id: SkillId, toolQl: number, materialQl: number, toolPower = 1): number {
    const s = this.levels[id];
    const base = s * 0.65 + toolQl * 0.2 * toolPower + materialQl * 0.15;
    const jitter = (Math.random() - 0.5) * Math.max(6, s * 0.25);
    const cap = Math.max(s + 5, 10);
    return Math.max(1, Math.min(cap, base + jitter, materialQl > 0 ? materialQl + 15 : 100));
  }

  /** Award skill. Returns the gain for feedback. */
  gain(id: SkillId, difficulty: number, success: boolean, timeSec: number): number {
    const s = this.levels[id];
    const closeness = 1 / (1 + Math.abs(difficulty - s) / 12);
    const remaining = Math.pow((100 - s) / 100, 2.2);
    let g = 0.35 * closeness * remaining * Math.min(2, 0.5 + timeSec / 6);
    if (!success) g *= 0.5;
    this.levels[id] = Math.min(99.999, s + g);
    return g;
  }
}
