// Skills rise from 1 to 100 with heavily diminishing returns. Like Wurm, you
// learn most from actions whose difficulty is close to your current level.

export const SKILLS = {
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  digging: 'Digging',
  foraging: 'Foraging',
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
} as const;

export type SkillId = keyof typeof SKILLS;

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
