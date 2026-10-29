import * as THREE from 'three';
import { itemDef, itemName, makeItem, type Item, type ToolKind } from '../data/items';
import { STATION_NAMES, type Recipe } from '../data/recipes';
import { STRUCTURES, totalMaterials, type StructureDef } from '../data/structures';
import type { SkillId } from '../data/skills';
import { isSoft, Mat, MAT_NAMES, WATER_LEVEL, Y_MIN } from '../world/terrain';
import {
  ANIMALS, CROP_STAGES, cropKey, type AnimalObj, type BushObj, type Crop, type PileObj, type StructureObj, type TreeObj, type WorldObj,
} from '../world/world';
import type { Game } from './game';

export type Target =
  | { kind: 'terrain'; point: THREE.Vector3; normal: THREE.Vector3; mat: Mat }
  | { kind: 'water'; point: THREE.Vector3 }
  | { kind: 'object'; obj: WorldObj; point: THREE.Vector3 }
  | { kind: 'animal'; animal: AnimalObj; point: THREE.Vector3 }
  | { kind: 'none' };

export interface Ctx {
  g: Game;
  t: Target;
  tool?: Item;
  recipe?: Recipe;
}

export interface Outcome { success: boolean; ql: number; toolQl: number }

export interface ActionDef {
  id: string;
  label: string | ((c: Ctx) => string);
  /** Whether this action appears for the target + active item. */
  show(c: Ctx): boolean;
  /** Returns a reason the action can't run right now, or null. */
  check?(c: Ctx): string | null;
  /** Base seconds at skill 1. */
  time: number | ((c: Ctx) => number);
  skill?: SkillId | ((c: Ctx) => SkillId);
  difficulty?: number | ((c: Ctx) => number);
  stamina?: number;
  toolWear?: number;
  /** Duration ignores tool power (e.g. weapon swings). */
  fixedTime?: boolean;
  /** Re-queue automatically after completing, while still valid. */
  repeat?: boolean | ((c: Ctx) => boolean);
  run(c: Ctx, o: Outcome): void;
}

// ---------- helpers
type TerrainCtx = Ctx & { t: Extract<Target, { kind: 'terrain' }> };
const isGround = (c: Ctx): c is TerrainCtx => c.t.kind === 'terrain';
const obj = <K extends WorldObj['kind']>(c: Ctx, kind: K): Extract<WorldObj, { kind: K }> | undefined =>
  c.t.kind === 'object' && c.t.obj.kind === kind ? (c.t.obj as Extract<WorldObj, { kind: K }>) : undefined;
const toolIs = (c: Ctx, kind: ToolKind) => !!c.tool && itemDef(c.tool.type).tool === kind;
const groundMat = (c: Ctx) => (isGround(c) ? c.t.mat : undefined);

/** Cubic metres of earth in one dirt/sand/clay item (and one rock shard). */
export const EARTH_PER_ITEM = 0.5;

/** Radius of the shovel/pickaxe brush (metres). */
export const DIG_RADIUS = 1.3;
export const LEVEL_RADIUS = 2.2;
const FORAGE_COOLDOWN = 300;

/** Forage spots are 2 m patches. */
const patchKey = (x: number, z: number) => Math.floor(z / 2) * 1000 + Math.floor(x / 2);

/** Bigger, faster earthworks with skill and a good tool. */
function earthBudget(c: Ctx, base: number, skill: SkillId) {
  const power = c.tool ? itemDef(c.tool.type).toolPower ?? 1 : 0.5;
  return base * (0.6 + 0.4 * power) * (1 + c.g.skills.get(skill) / 120);
}

function afterEdit(c: Ctx, x: number, z: number, r: number) {
  c.g.world.disturbCrops(x, z, r);
  c.g.view.refreshNear(x, z, r + 1);
}

function cropAt(c: Ctx): { key: number; crop?: Crop } {
  if (!isGround(c)) return { key: -1 };
  const key = cropKey(c.t.point.x, c.t.point.z);
  return { key, crop: c.g.world.crops.get(key) };
}

/** Earth items to fill with, best first. */
function fillItem(g: Game): string | undefined {
  return ['dirt', 'sand', 'clay'].find((t) => g.inv.count(t) > 0 || g.earthCredit(t) > 0);
}
const FILL_MAT: Record<string, Mat> = { dirt: Mat.Dirt, sand: Mat.Sand, clay: Mat.Clay };

// ---------- actions
export const ACTIONS: ActionDef[] = [
  // ===== ground
  {
    id: 'examine_ground', label: 'Examine',
    show: (c) => isGround(c), time: 0,
    run: (c) => {
      if (!isGround(c)) return;
      const { point: p, normal: n, mat } = c.t;
      const slope = Math.round((Math.acos(Math.min(1, Math.max(-1, n.y))) * 180) / Math.PI);
      const under = c.g.world.terrain.heightAt(p.x, p.z) - p.y > 1.5 ? ' You are under the surface.' : '';
      c.g.msg(`${MAT_NAMES[mat]} at ${p.y.toFixed(1)} m (${p.y >= 0 ? 'above' : 'below'} sea level), ${slope}° slope.${under}`, 'info');
      const { crop } = cropAt(c);
      if (crop) {
        const st = c.g.world.cropStage(crop);
        c.g.msg(`Wheat, QL ${crop.ql.toFixed(1)}, growth ${st + 1}/${CROP_STAGES}${st === CROP_STAGES - 1 ? ' — ripe!' : ''}, tended ${crop.tended}x.`, 'info');
      }
    },
  },
  {
    id: 'forage', label: 'Forage',
    show: (c) => groundMat(c) === Mat.Grass && !c.tool,
    check: (c) => {
      if (!isGround(c)) return 'Nothing to forage.';
      const last = c.g.foraged.get(patchKey(c.t.point.x, c.t.point.z));
      return last !== undefined && c.g.world.time - last < FORAGE_COOLDOWN ? 'This patch has been picked clean recently.' : null;
    },
    time: 6, skill: 'foraging', difficulty: 4, stamina: 2,
    run: (c, o) => {
      if (!isGround(c)) return;
      const g = c.g;
      g.foraged.set(patchKey(c.t.point.x, c.t.point.z), g.world.time);
      if (!o.success) return g.msg('You find nothing of use.', 'fail');
      const s = g.skills.get('foraging');
      const table: [string, number][] = [
        ['plant_fiber', 40], ['branch', 22], ['berries', 12 + s * 0.2], ['mushroom', 10 + s * 0.2],
        ['wheat_seeds', 4 + s * 0.15], ['rock_shard', 8],
      ];
      const n = 1 + (Math.random() < s / 60 ? 1 : 0) + (Math.random() < 0.35 ? 1 : 0);
      const found: string[] = [];
      for (let i = 0; i < n; i++) {
        const type = weighted(table);
        const count = type === 'plant_fiber' ? 2 + Math.floor(Math.random() * 3) : 1;
        g.give(type, o.ql, count);
        found.push(`${count > 1 ? count + ' ' : ''}${itemDef(type).name.toLowerCase()}`);
      }
      g.msg(`You forage and find ${found.join(', ')}.`, 'good');
    },
  },
  {
    id: 'gather_stones', label: 'Gather loose stones',
    show: (c) => (groundMat(c) === Mat.Rock || groundMat(c) === Mat.Iron) && !toolIs(c, 'pickaxe'),
    check: (c) => {
      if (!isGround(c)) return '';
      const last = c.g.foraged.get(patchKey(c.t.point.x, c.t.point.z));
      return last !== undefined && c.g.world.time - last < 120 ? 'No loose stones left here. Try elsewhere or use a pickaxe.' : null;
    },
    time: 5, skill: 'mining', difficulty: 2, stamina: 4,
    run: (c, o) => {
      if (!isGround(c)) return;
      c.g.foraged.set(patchKey(c.t.point.x, c.t.point.z), c.g.world.time);
      if (!o.success) return c.g.msg('The stones here are all stuck fast.', 'fail');
      const n = 1 + (Math.random() < 0.4 ? 1 : 0);
      c.g.give('rock_shard', o.ql * 0.8, n);
      c.g.msg(`You pry loose ${n} rock shard${n > 1 ? 's' : ''}.`, 'good');
    },
  },
  {
    id: 'dig', label: 'Dig',
    show: (c) => toolIs(c, 'shovel') && isGround(c),
    check: (c) => {
      if (!isGround(c)) return '';
      if (!isSoft(c.t.mat)) return 'Too hard for a shovel. Use a pickaxe.';
      if (c.t.point.y < Y_MIN + 3) return 'You can dig no deeper.';
      return null;
    },
    time: 4, skill: 'digging', difficulty: 6, stamina: 6, toolWear: 0.12,
    run: (c, o) => {
      if (!isGround(c)) return;
      const { point: p, normal: n } = c.t;
      const budget = earthBudget(c, 0.9, 'digging') * (o.success ? 1 : 0.4);
      const cx = p.x - n.x * 0.35, cy = p.y - n.y * 0.35, cz = p.z - n.z * 0.35;
      const vol = c.g.world.terrain.dig(cx, cy, cz, DIG_RADIUS, budget, isSoft);
      afterEdit(c, cx, cz, DIG_RADIUS);
      const got = c.g.collectEarth(vol, o.ql);
      c.g.msg(got ? `You dig out ${got}.` : 'You scrape at the ground but move almost nothing.', o.success ? 'good' : 'info');
    },
  },
  {
    id: 'level', label: 'Level ground (to your feet)',
    show: (c) => toolIs(c, 'shovel') && isGround(c),
    check: (c) => {
      if (!isGround(c)) return '';
      const p = c.t.point;
      if (Math.hypot(p.x - c.g.player.pos.x, p.z - c.g.player.pos.z) > 6) return 'Stand closer to the ground you want to level.';
      return null;
    },
    time: 4, skill: 'digging', difficulty: 9, stamina: 7, toolWear: 0.12,
    repeat: (c) => !!c.g.levelling,
    run: (c, o) => {
      if (!isGround(c)) return;
      const g = c.g;
      g.levelling = false;
      const p = c.t.point;
      // Level to where you stand, like Valheim's hoe.
      const target = g.player.pos.y;
      const fillType = fillItem(g) ?? 'dirt';
      const budget = earthBudget(c, 1.6, 'digging') * (o.success ? 1 : 0.4);
      const fillBudget = g.inv.count(fillType) * EARTH_PER_ITEM + g.earthCredit(fillType);
      const res = g.world.terrain.level(p.x, p.z, LEVEL_RADIUS, target, budget, fillBudget, isSoft, FILL_MAT[fillType]);
      afterEdit(c, p.x, p.z, LEVEL_RADIUS);
      const got = g.collectEarth(res.removed, o.ql);
      if (res.added > 0) g.spendEarth(fillType, res.added);
      const moved = Object.values(res.removed).reduce((a, b) => a + (b ?? 0), 0) + res.added;
      if (res.offBy < 0.12) { g.msg('The ground is level.', 'good'); return; }
      if (moved < 0.02) {
        g.msg(fillBudget <= 0 ? 'You need dirt, sand or clay in your pack to fill the low spots.' : 'Rock is in the way. Clear it with a pickaxe.', 'fail');
        return;
      }
      g.msg(`You level the ground${got ? ` and dig out ${got}` : ''}${res.added > 0.05 ? ', filling the hollows' : ''}. (${res.offBy.toFixed(2)} m off level)`, 'info');
      g.levelling = true;
    },
  },
  {
    id: 'raise', label: (c) => `Raise ground (uses ${fillItem(c.g) ?? 'dirt'})`,
    show: (c) => toolIs(c, 'shovel') && isGround(c) && !!fillItem(c.g),
    time: 3, skill: 'digging', difficulty: 5, stamina: 5, toolWear: 0.06,
    run: (c, o) => {
      if (!isGround(c)) return;
      const g = c.g;
      const type = fillItem(g)!;
      const { point: p, normal: n } = c.t;
      const available = g.inv.count(type) * EARTH_PER_ITEM + g.earthCredit(type);
      const budget = Math.min(available, earthBudget(c, 0.9, 'digging') * (o.success ? 1 : 0.5));
      const added = g.world.terrain.fill(p.x + n.x * 0.4, p.y + n.y * 0.4, p.z + n.z * 0.4, DIG_RADIUS, budget, FILL_MAT[type]);
      g.spendEarth(type, added);
      afterEdit(c, p.x, p.z, DIG_RADIUS);
      g.msg(`You pile up and pack down the ${type}.`, 'info');
    },
  },
  {
    id: 'smooth', label: 'Smooth ground',
    show: (c) => toolIs(c, 'shovel') && isGround(c),
    time: 3, skill: 'digging', difficulty: 4, stamina: 4, toolWear: 0.05,
    run: (c) => {
      if (!isGround(c)) return;
      const p = c.t.point;
      c.g.world.terrain.smooth(p.x, p.y, p.z, 1.8);
      afterEdit(c, p.x, p.z, 1.8);
      c.g.msg('You smooth out the bumps.', 'info');
    },
  },
  {
    id: 'mine', label: 'Mine',
    show: (c) => toolIs(c, 'pickaxe') && isGround(c),
    check: (c) => (isGround(c) && c.t.point.y < Y_MIN + 3 ? 'You have reached bedrock.' : null),
    time: 7, skill: 'mining', difficulty: (c) => (groundMat(c) === Mat.Iron ? 18 : 8),
    stamina: 10, toolWear: 0.2,
    run: (c, o) => {
      if (!isGround(c)) return;
      if (!o.success) return c.g.msg('You chip at the rock but nothing breaks off.', 'fail');
      const { point: p, normal: n } = c.t;
      const cx = p.x - n.x * 0.3, cy = p.y - n.y * 0.3, cz = p.z - n.z * 0.3;
      const vol = c.g.world.terrain.dig(cx, cy, cz, 1.1, earthBudget(c, 0.7, 'mining'), () => true);
      afterEdit(c, cx, cz, 1.1);
      const got = c.g.collectEarth(vol, o.ql);
      c.g.msg(got ? `You mine ${got}.${vol[Mat.Iron] ? ' Iron!' : ''}` : 'You break off some gravel.', vol[Mat.Iron] ? 'good' : 'info');
    },
  },
  {
    id: 'cultivate', label: 'Cultivate',
    show: (c) => toolIs(c, 'shovel') && (groundMat(c) === Mat.Grass || groundMat(c) === Mat.Dirt),
    check: (c) => {
      if (!isGround(c)) return '';
      if (c.t.normal.y < 0.85) return 'The ground is too steep to farm. Level it first.';
      if (c.t.point.y < WATER_LEVEL + 0.1) return 'Too wet to farm.';
      if (c.g.world.near(c.t.point.x, c.t.point.z, 1.5).some((o) => o.kind === 'tree' && Math.hypot(o.x - c.t.point.x, o.z - c.t.point.z) < 1.2)) return 'Tree roots are in the way.';
      return null;
    },
    time: 6, skill: 'farming', difficulty: 5, stamina: 7, toolWear: 0.1,
    run: (c, o) => {
      if (!isGround(c)) return;
      if (!o.success) return c.g.msg('The roots are too tough here. You fail to break the soil.', 'fail');
      const p = c.t.point;
      c.g.world.terrain.paint(p.x, p.y, p.z, 1.3, Mat.Field, (m) => m === Mat.Grass || m === Mat.Dirt);
      c.g.msg('You till the soil into a field. Sow seeds on it.', 'good');
    },
  },
  {
    id: 'sow', label: 'Sow wheat',
    show: (c) => groundMat(c) === Mat.Field && c.tool?.type === 'wheat_seeds',
    check: (c) => (cropAt(c).crop ? 'Something is already growing here.' : null),
    time: 3, skill: 'farming', difficulty: 6, stamina: 2,
    run: (c, o) => {
      if (!isGround(c) || !c.tool) return;
      const seedQl = c.tool.ql;
      c.g.consumeActive();
      if (!o.success) return c.g.msg('You scatter the seeds badly; the birds get them.', 'fail');
      const { key } = cropAt(c);
      c.g.world.crops.set(key, { planted: c.g.world.time, ql: (o.ql + seedQl) / 2, tended: 0 });
      c.g.world.listener?.cropsChanged(key);
      c.g.msg('You sow a row of wheat.', 'good');
    },
  },
  {
    id: 'tend', label: 'Tend crop',
    show: (c) => toolIs(c, 'shovel') && !!cropAt(c).crop,
    check: (c) => {
      const crop = cropAt(c).crop!;
      if (crop.tended >= 3) return 'The crop is already well tended.';
      if (c.g.world.cropStage(crop) >= CROP_STAGES - 1) return 'The crop is ready to harvest.';
      return null;
    },
    time: 4, skill: 'farming', difficulty: 10, stamina: 4, toolWear: 0.05,
    run: (c, o) => {
      const crop = cropAt(c).crop;
      if (!crop) return;
      if (!o.success) return c.g.msg('You pull up a few sprouts by mistake.', 'fail');
      crop.tended++;
      crop.ql = Math.min(100, crop.ql + 2 + c.g.skills.get('farming') * 0.05);
      c.g.msg('You weed and tend the crop. It will grow faster and better.', 'good');
    },
  },
  {
    id: 'harvest', label: 'Harvest',
    show: (c) => !!cropAt(c).crop && (!c.tool || toolIs(c, 'scythe')),
    check: (c) => (c.g.world.cropStage(cropAt(c).crop!) < CROP_STAGES - 1 ? 'The wheat is not ripe yet.' : null),
    time: (c) => (toolIs(c, 'scythe') ? 3 : 5), skill: 'farming', difficulty: 8, stamina: 5, toolWear: 0.1,
    run: (c, o) => {
      const { key, crop } = cropAt(c);
      if (!crop) return;
      c.g.world.crops.delete(key);
      c.g.world.listener?.cropsChanged(key);
      const scythe = toolIs(c, 'scythe');
      const n = Math.max(1, Math.round((scythe ? 2.5 : 1.3) + crop.tended * 0.5 + Math.random() * 1.5 - (o.success ? 0 : 1)));
      const ql = (crop.ql + o.ql) / 2;
      c.g.give('wheat', ql, n);
      const seeds = 1 + (Math.random() < 0.5 ? 1 : 0);
      c.g.give('wheat_seeds', ql, seeds);
      c.g.msg(`You harvest ${n} wheat and save ${seeds} seed${seeds > 1 ? 's' : ''}.`, 'good');
    },
  },
  {
    id: 'plant_sprout', label: 'Plant sprout',
    show: (c) => c.tool?.type === 'sprout' && (groundMat(c) === Mat.Grass || groundMat(c) === Mat.Dirt),
    check: (c) => {
      if (!isGround(c)) return '';
      const p = c.t.point;
      if (c.g.world.near(p.x, p.z, 2).some((o) => o.kind !== 'pile' && Math.hypot(o.x - p.x, o.z - p.z) < 1.5)) return 'There is no room to plant here.';
      return null;
    },
    time: 4, skill: 'foraging', difficulty: 6, stamina: 3,
    run: (c, o) => {
      if (!isGround(c) || !c.tool) return;
      const label = c.tool.label ?? '';
      c.g.consumeActive();
      if (!o.success) return c.g.msg('The sprout wilts as you plant it.', 'fail');
      const species = label.includes('pine') ? 'pine' : label.includes('birch') ? 'birch' : 'oak';
      c.g.world.add<TreeObj>({ kind: 'tree', species, x: c.t.point.x, z: c.t.point.z, age: 0.03, branches: 0 });
      c.g.msg(`You plant the ${species} sprout. Give it time to grow.`, 'good');
    },
  },

  // ===== water
  {
    id: 'drink', label: 'Drink',
    show: (c) => c.t.kind === 'water',
    check: ({ g }) => (g.player.water >= 99 ? 'You are not thirsty.' : null),
    time: 2,
    repeat: (c) => c.g.player.water < 95,
    run: ({ g }) => {
      g.player.water = Math.min(100, g.player.water + 20);
      g.msg('You drink the fresh water.', 'info');
    },
  },
  {
    id: 'fill_jar', label: 'Fill clay jar',
    show: (c) => c.t.kind === 'water' && c.tool?.type === 'clay_jar',
    time: 2,
    run: ({ g, tool }) => {
      if (!tool) return;
      tool.type = 'jar_of_water';
      g.inventoryChanged();
      g.msg('You fill the jar with water.', 'info');
    },
  },

  // ===== trees
  {
    id: 'examine_tree', label: 'Examine', show: (c) => !!obj(c, 'tree'), time: 0,
    run: (c) => {
      const t = obj(c, 'tree')!;
      const stage = t.age < 0.3 ? 'young' : t.age < 0.8 ? 'mature' : 'old';
      c.g.msg(`A ${stage} ${t.species} tree. It has ${t.branches} branches you could reach.`, 'info');
    },
  },
  {
    id: 'cut_tree', label: 'Cut down',
    show: (c) => !!obj(c, 'tree') && toolIs(c, 'hatchet'),
    check: (c) => (obj(c, 'tree')!.age < 0.2 ? 'It is only a sapling. Leave it to grow.' : null),
    time: (c) => 8 + obj(c, 'tree')!.age * 10,
    skill: 'woodcutting', difficulty: (c) => ({ pine: 8, oak: 14, birch: 10 })[obj(c, 'tree')!.species], stamina: 18, toolWear: 0.35,
    run: (c, o) => {
      const t = obj(c, 'tree')!;
      if (!o.success) return c.g.msg('Your hatchet glances off the trunk. You make little progress.', 'fail');
      c.g.world.remove(t);
      const logs = Math.max(1, Math.round(t.age * 3.2));
      const items = [];
      for (let i = 0; i < logs; i++) items.push(makeItem('log', o.ql * (0.75 + t.age * 0.35), `${t.species} log`));
      for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) items.push(makeItem('branch', o.ql));
      if (Math.random() < 0.35) items.push(makeItem('sprout', o.ql, `${t.species} sprout`));
      c.g.dropToGround(items, t.x, c.g.world.terrain.heightAt(t.x, t.z), t.z);
      c.g.msg(`The ${t.species} tree crashes down! It leaves ${logs} log${logs > 1 ? 's' : ''} and some branches on the ground.`, 'good');
    },
  },
  {
    id: 'collect_branch', label: 'Collect branch',
    show: (c) => !!obj(c, 'tree') && !c.tool,
    check: (c) => (obj(c, 'tree')!.branches <= 0 ? 'No branches within reach. They grow back in time.' : null),
    time: 3, skill: 'foraging', difficulty: 2, stamina: 2,
    run: (c, o) => {
      const t = obj(c, 'tree')!;
      t.branches--;
      c.g.give('branch', o.ql, 1);
      c.g.msg('You snap off a branch.', 'info');
    },
  },
  {
    id: 'pick_sprout', label: 'Pick sprout',
    show: (c) => !!obj(c, 'tree') && toolIs(c, 'knife'),
    check: (c) => (obj(c, 'tree')!.age < 0.6 ? 'The tree is too young to give sprouts.' : null),
    time: 5, skill: 'foraging', difficulty: 9, stamina: 2, toolWear: 0.05,
    run: (c, o) => {
      const t = obj(c, 'tree')!;
      if (!o.success) return c.g.msg('You fail to cut a usable sprout.', 'fail');
      c.g.inv.add(makeItem('sprout', o.ql, `${t.species} sprout`));
      c.g.inventoryChanged();
      c.g.msg(`You carefully cut a ${t.species} sprout.`, 'good');
    },
  },

  // ===== bushes
  {
    id: 'pick_berries', label: 'Pick berries',
    show: (c) => !!obj(c, 'bush'),
    check: (c) => (obj(c, 'bush')!.ripe ? null : 'There are no ripe berries.'),
    time: 3, skill: 'foraging', difficulty: 3, stamina: 1,
    run: (c, o) => {
      const b = obj(c, 'bush') as BushObj;
      b.ripe = false;
      b.regrowAt = c.g.world.time + 240 + Math.random() * 180;
      c.g.world.changed(b);
      const n = o.success ? 2 + Math.floor(Math.random() * 3) : 1;
      c.g.give('berries', o.ql, n);
      c.g.msg(`You pick ${n} handfuls of berries.`, 'good');
    },
  },

  // ===== structures: construction
  {
    id: 'continue_build', label: (c) => `Continue building ${STRUCTURES[obj(c, 'structure')!.type].name.toLowerCase()}`,
    show: (c) => { const s = obj(c, 'structure'); return !!s && !s.built; },
    check: (c) => {
      const s = obj(c, 'structure')!;
      const def = STRUCTURES[s.type];
      if (c.g.dev.on('freeBuild')) return null;
      if (def.tool && !toolIs(c, def.tool)) return `You need to activate a ${def.tool} to build this.`;
      const next = nextMaterial(def, s);
      if (next && c.g.inv.count(next) === 0) return `You need a ${itemDef(next).name.toLowerCase()} to continue.`;
      return null;
    },
    time: (c) => STRUCTURES[obj(c, 'structure')!.type].stepTime,
    skill: (c) => STRUCTURES[obj(c, 'structure')!.type].skill,
    difficulty: (c) => STRUCTURES[obj(c, 'structure')!.type].difficulty,
    stamina: 6, toolWear: 0.08,
    repeat: (c) => { const s = obj(c, 'structure'); return !!s && !s.built; },
    run: (c, o) => {
      const s = obj(c, 'structure')!;
      if (c.g.dev.on('freeBuild')) { c.g.devFinishStructure(s); return; }
      const def = STRUCTURES[s.type];
      const next = nextMaterial(def, s)!;
      const [m] = c.g.inv.take(next, 1);
      c.g.inventoryChanged();
      if (!o.success) {
        if (Math.random() < 0.3) c.g.msg(`You botch it and ruin the ${itemName(m).toLowerCase()}.`, 'fail');
        else { c.g.inv.add(m); c.g.inventoryChanged(); c.g.msg('You fumble and have to start that part over.', 'fail'); }
        return;
      }
      s.consumed[next] = (s.consumed[next] ?? 0) + 1;
      const done = Object.values(s.consumed).reduce((a, b) => a + b, 0);
      const total = totalMaterials(def);
      // Structure quality is a running average of every step's quality.
      s.ql = (s.ql * (done - 1) + (o.ql + m.ql) / 2) / done;
      if (done >= total) {
        s.built = true;
        c.g.msg(`You finish the ${def.name.toLowerCase()} (QL ${s.ql.toFixed(1)}).`, 'good');
      } else {
        c.g.msg(`You add a ${itemName(m).toLowerCase()}. (${done}/${total})`, 'info');
      }
      c.g.world.changed(s);
    },
  },
  {
    id: 'destroy_plan', label: 'Remove plan',
    show: (c) => { const s = obj(c, 'structure'); return !!s && !s.built; },
    time: 1,
    run: (c) => {
      const s = obj(c, 'structure')!;
      const items: Item[] = [];
      for (const [type, n] of Object.entries(s.consumed)) for (let i = 0; i < n; i++) items.push(makeItem(type, s.ql));
      c.g.world.remove(s);
      if (items.length) c.g.dropToGround(items, s.x, s.y, s.z);
      c.g.msg('You tear down the unfinished structure. The materials are left on the ground.', 'info');
    },
  },
  {
    id: 'demolish', label: 'Demolish',
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && (toolIs(c, 'hammer') || toolIs(c, 'hatchet')); },
    time: 12, skill: 'carpentry', difficulty: 5, stamina: 15, toolWear: 0.2,
    run: (c) => {
      const s = obj(c, 'structure')!;
      const def = STRUCTURES[s.type];
      const items: Item[] = [];
      for (const m of def.materials) for (let i = 0; i < Math.floor(m.count / 2); i++) items.push(makeItem(m.item, s.ql * 0.6));
      for (const it of s.items ?? []) items.push(it);
      c.g.world.remove(s);
      if (items.length) c.g.dropToGround(items, s.x, s.y, s.z);
      c.g.msg(`You demolish the ${def.name.toLowerCase()} and salvage some materials.`, 'info');
    },
  },
  {
    id: 'examine_structure', label: 'Examine',
    show: (c) => !!obj(c, 'structure'), time: 0,
    run: (c) => {
      const s = obj(c, 'structure')!;
      const def = STRUCTURES[s.type];
      if (!s.built) {
        const need = def.materials.map((m) => `${m.count - (s.consumed[m.item] ?? 0)} ${itemDef(m.item).name.toLowerCase()}`).join(', ');
        c.g.msg(`Unfinished ${def.name.toLowerCase()}. Still needs: ${need}.${def.tool ? ` Requires an active ${def.tool}.` : ''}`, 'info');
        return;
      }
      let extra = '';
      if (def.burns) extra = s.lit ? ` It is burning (${Math.ceil(s.fuel)}s of fuel left).` : ` It is cold. Fuel: ${Math.ceil(s.fuel)}s.`;
      if (def.container) extra = ` It holds ${(s.items ?? []).length} items.`;
      c.g.msg(`${def.name}, QL ${s.ql.toFixed(1)}. ${def.desc}${extra}`, 'info');
    },
  },

  // ===== structures: use
  {
    id: 'add_fuel', label: (c) => `Add fuel (${itemName(fuelItem(c)!).toLowerCase()})`,
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].burns && !!fuelItem(c); },
    check: (c) => (obj(c, 'structure')!.fuel > 3000 ? 'It is already packed full of fuel.' : null),
    time: 2,
    run: (c) => {
      const s = obj(c, 'structure')!;
      const f = fuelItem(c)!;
      c.g.inv.remove(f.uid);
      c.g.inventoryChanged();
      s.fuel += itemDef(f.type).fuel! * (0.6 + f.ql / 250);
      c.g.world.changed(s);
      c.g.msg(`You add the ${itemName(f).toLowerCase()} to the fire.`, 'info');
    },
  },
  {
    id: 'light_fire', label: 'Light fire',
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].burns && !s.lit; },
    check: (c) => {
      const s = obj(c, 'structure')!;
      if (s.fuel <= 0) return 'There is no fuel in it. Add branches, kindling or logs first.';
      if (c.g.inv.count('kindling') === 0) return 'You need kindling to start a fire. (Craft it from a branch with a knife.)';
      return null;
    },
    time: 6, skill: 'firemaking', difficulty: 8, stamina: 3,
    run: (c, o) => {
      const s = obj(c, 'structure')!;
      c.g.inv.take('kindling', 1);
      c.g.inventoryChanged();
      if (!o.success) return c.g.msg('The kindling smoulders and dies. Try again.', 'fail');
      s.lit = true;
      c.g.world.changed(s);
      c.g.msg('The fire catches and roars to life.', 'good');
    },
  },
  {
    id: 'open_container', label: 'Open',
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].container; },
    time: 0,
    run: (c) => c.g.ui.openContainer(obj(c, 'structure')!),
  },
  {
    id: 'toggle_open', label: (c) => `${obj(c, 'structure')!.open ? 'Close' : 'Open'} ${obj(c, 'structure')!.type === 'gate' ? 'gate' : 'door'}`,
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].opens; },
    time: 0,
    run: (c) => {
      const s = obj(c, 'structure')!;
      s.open = !s.open;
      c.g.world.changed(s);
    },
  },
  {
    id: 'sleep', label: 'Sleep',
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].bed; },
    time: 4,
    run: (c) => {
      const s = obj(c, 'structure')!;
      const g = c.g;
      g.world.spawn = { x: s.x, z: s.z };
      g.player.stamina = 100;
      const f = g.world.dayFraction;
      if (f > 0.75 || f < 0.22) {
        const DAY = 1200;
        const skip = ((1.25 - f) % 1) * DAY;
        g.world.time += skip;
        g.player.food = Math.max(0, g.player.food - 10);
        g.player.water = Math.max(0, g.player.water - 15);
        g.msg('You sleep through the night and wake rested. This bed is now your home.', 'good');
      } else {
        g.msg('You rest a while. This bed is now your home — you will wake here if you die.', 'good');
      }
    },
  },

  // ===== piles
  {
    id: 'open_pile', label: 'Look through pile',
    show: (c) => !!obj(c, 'pile'), time: 0,
    run: (c) => c.g.ui.openContainer(obj(c, 'pile')!),
  },
  {
    id: 'take_all', label: 'Take all',
    show: (c) => { const p = obj(c, 'pile'); return !!p && p.items.some((i) => !itemDef(i.type).noPickup); },
    time: 1,
    run: (c) => {
      const p = obj(c, 'pile')!;
      c.g.takeFromPile(p, p.items.filter((i) => !itemDef(i.type).noPickup));
    },
  },
  {
    id: 'butcher', label: 'Butcher corpse',
    show: (c) => { const p = obj(c, 'pile'); return !!p && toolIs(c, 'knife') && p.items.some((i) => i.type === 'corpse'); },
    time: 10, skill: 'butchering', difficulty: 8, stamina: 8, toolWear: 0.2,
    run: (c, o) => {
      const p = obj(c, 'pile') as PileObj;
      const corpse = p.items.find((i) => i.type === 'corpse')!;
      p.items = p.items.filter((i) => i !== corpse);
      const species = corpse.label?.includes('boar') ? 'boar' : 'deer';
      const meat = Math.max(1, ANIMALS[species].meat + (o.success ? 1 : -1));
      c.g.give('raw_meat', o.ql, meat);
      if (o.success) c.g.give('hide', o.ql, 1);
      if (p.items.length === 0) c.g.world.remove(p);
      else c.g.world.changed(p);
      c.g.msg(`You butcher the ${species}: ${meat} meat${o.success ? ' and a hide' : '. The hide is ruined'}.`, o.success ? 'good' : 'info');
    },
  },

  // ===== animals
  {
    id: 'examine_animal', label: 'Examine', show: (c) => c.t.kind === 'animal', time: 0,
    run: (c) => {
      if (c.t.kind !== 'animal') return;
      const a = c.t.animal;
      const d = ANIMALS[a.species];
      const hp = a.hp / a.maxHp;
      c.g.msg(`A ${d.name.toLowerCase()}. ${hp > 0.8 ? 'It looks healthy.' : hp > 0.4 ? 'It is wounded.' : 'It is badly hurt.'}${d.aggressive ? ' It looks ill-tempered.' : ''}`, 'info');
    },
  },
  {
    id: 'attack', label: 'Attack',
    show: (c) => c.t.kind === 'animal',
    check: (c) => {
      if (c.t.kind !== 'animal') return '';
      if (c.t.animal.hp <= 0 || !c.g.world.animals.includes(c.t.animal)) return 'It is gone.';
      const d = Math.hypot(c.t.animal.x - c.g.player.pos.x, c.t.animal.z - c.g.player.pos.z);
      return d > 3.2 ? 'It is out of reach.' : null;
    },
    time: (c) => (toolIs(c, 'weapon') ? 1.8 : c.tool ? 2.2 : 1.5), fixedTime: true, skill: 'fighting',
    difficulty: (c) => (c.t.kind === 'animal' && c.t.animal.species === 'boar' ? 8 : 4) - (toolIs(c, 'weapon') ? 4 : 0),
    stamina: 6, toolWear: 0.15,
    repeat: (c) => c.t.kind === 'animal' && c.t.animal.hp > 0,
    run: (c, o) => {
      if (c.t.kind !== 'animal') return;
      const a = c.t.animal;
      if (!o.success) { c.g.msg('You miss!', 'fail'); c.g.provoke(a); return; }
      const base = c.tool ? (itemDef(c.tool.type).damage ?? 3) * (0.6 + c.tool.ql / 200) : 2.5;
      const dmg = base * (0.85 + c.g.skills.get('fighting') / 80) * (0.8 + Math.random() * 0.4);
      a.hp -= dmg;
      if (a.hp <= 0) {
        c.g.killAnimal(a);
      } else {
        c.g.msg(`You hit the ${ANIMALS[a.species].name.toLowerCase()} (${Math.round(dmg)} damage).`, 'info');
        c.g.provoke(a);
      }
    },
  },

  // ===== crafting (targetless; uses a recipe)
  {
    id: 'craft', label: (c) => `Craft ${c.recipe?.name.toLowerCase()}`,
    show: () => false,
    check: (c) => craftProblem(c.g, c.recipe!, c.tool),
    time: (c) => c.recipe!.time,
    skill: (c) => c.recipe!.skill,
    difficulty: (c) => c.recipe!.difficulty,
    stamina: 4, toolWear: 0.1,
    run: (c, o) => {
      const r = c.recipe!;
      const g = c.g;
      const used: Item[] = [];
      for (const inp of r.inputs) used.push(...g.inv.take(inp.item, inp.count));
      const matQl = used.reduce((s, i) => s + i.ql, 0) / Math.max(1, used.length);
      if (!o.success) {
        // A failed attempt sometimes ruins one of the materials, Wurm-style.
        const lost = Math.random() < 0.4 ? used[Math.floor(Math.random() * used.length)] : undefined;
        for (const u of used) if (u !== lost) g.inv.add(u);
        g.inventoryChanged();
        g.msg(lost ? `You fail to make the ${r.name.toLowerCase()} and ruin the ${itemName(lost).toLowerCase()}.` : `You fail to make the ${r.name.toLowerCase()}, but the materials survive.`, 'fail');
        return;
      }
      const ql = Math.min(o.ql * 0.7 + matQl * 0.3, matQl + 20);
      for (let i = 0; i < r.output.count; i++) g.inv.add(makeItem(r.output.item, ql));
      for (const ret of r.returns ?? []) {
        const src = used.find((u) => u.type !== r.output.item);
        for (let i = 0; i < ret.count; i++) g.inv.add(makeItem(ret.item, src?.ql ?? ql));
      }
      g.inventoryChanged();
      const name = itemDef(r.output.item).name.toLowerCase();
      const article = r.output.count > 1 ? `${r.output.count} ` : /^[aeiou]/.test(name) ? 'an ' : 'a ';
      g.msg(`You create ${article}${name} (QL ${ql.toFixed(1)}).`, 'good');
    },
  },
];

export const ACTION_MAP: Record<string, ActionDef> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

function weighted(table: [string, number][]): string {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of table) { r -= w; if (r <= 0) return k; }
  return table[0][0];
}

export function nextMaterial(def: StructureDef, s: StructureObj): string | undefined {
  for (const m of def.materials) if ((s.consumed[m.item] ?? 0) < m.count) return m.item;
  return undefined;
}

// Burn big fuel first and keep the last kindling for lighting.
const FUEL_ORDER = ['log', 'plank', 'branch', 'shaft', 'kindling'];
function fuelItem(c: Ctx): Item | undefined {
  if (c.tool && itemDef(c.tool.type).fuel) return c.tool;
  for (const t of FUEL_ORDER) {
    if (t === 'kindling' && c.g.inv.count(t) < 2) continue;
    const it = c.g.inv.ofType(t).at(-1); // burn the worst first
    if (it) return it;
  }
  return undefined;
}

export function craftProblem(g: Game, r: Recipe, tool?: Item): string | null {
  if (g.dev.on('freeCraft')) return null;
  if (r.tool && (!tool || !g.inv.find(tool.uid) || itemDef(tool.type).tool !== r.tool)) return `You need a ${r.tool}.`;
  for (const inp of r.inputs) {
    if (g.inv.count(inp.item) < inp.count) return `Need ${inp.count} ${itemDef(inp.item).name.toLowerCase()}.`;
  }
  for (const st of r.stations ?? []) {
    if (!g.stationNear(st)) return `Must be near ${STATION_NAMES[st]}.`;
  }
  return null;
}

