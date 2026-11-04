import * as THREE from 'three';
import { isIdentified, itemDef, itemName, learnSpecies, makeItem, TOOL_NAMES, TORCH_BURN, typeDesc, typeName, type Item, type ToolKind } from '../data/items';
import { RECIPES, STATION_NAMES, type Recipe } from '../data/recipes';
import { STRUCTURES, totalMaterials, type StructureDef } from '../data/structures';
import type { SkillId } from '../data/skills';
import { isRock, isSoft, Mat, MAT_NAMES, Y_MIN } from '../world/terrain';
import { telemetry } from './telemetry';
import {
  ANIMALS, APPLE_AGE, APPLES, CART_CAPACITY, corpseSpecies, toLocal, toWorld, CROP_STAGES, type CartObj, cropKey, type AnimalObj, type BushObj, type Crop, type ForageObj, type PileObj, type StructureObj, type Stump, type TreeObj, type WorldObj,
} from '../world/world';
import { FORAGE, IDENTIFY } from '../data/forage';
import type { Boulder } from '../world/groundcover';
import { BIOMES, biomeAt, type Biome } from './forage';
import { stumpSize, treeScale } from '../world/treefx';
import { SPECIES, TREES } from '../world/trees';
import { ZONE_NAMES } from '../world/climate';
import type { Game } from './game';
import type { Villager } from './villagers';
import type { Trader } from './traders';
import type { SwingKind } from './tools';
import { RECIPE_MINIGAMES, type MinigameSpec } from './minigames';
import { anvilGrade, bellowsGrade, HOT_TIME, smithyCap } from './smithy';

export type Target =
  | { kind: 'terrain'; point: THREE.Vector3; normal: THREE.Vector3; mat: Mat }
  | { kind: 'water'; point: THREE.Vector3 }
  | { kind: 'object'; obj: WorldObj; point: THREE.Vector3 }
  | { kind: 'animal'; animal: AnimalObj; point: THREE.Vector3 }
  | { kind: 'rock'; rock: Boulder; point: THREE.Vector3 }
  | { kind: 'cart'; cart: CartObj; point: THREE.Vector3 }
  | { kind: 'stump'; stump: Stump; point: THREE.Vector3 }
  | { kind: 'villager'; villager: Villager; point: THREE.Vector3 }
  | { kind: 'trader'; trader: Trader; point: THREE.Vector3 }
  | { kind: 'none' };

export interface Ctx {
  g: Game;
  t: Target;
  tool?: Item;
  /** The inventory item an action is about (e.g. studying a herb). */
  item?: Item;
  /** Skip the hands-on minigame: a plain timed action at a quality cost. */
  quick?: boolean;
  recipe?: Recipe;
}

export interface Outcome {
  success: boolean; ql: number; toolQl: number;
  /** How well the hands-on work went (0..1), if there was any. */
  perf?: number;
  /** The equipment's quality limit, if one applied. */
  cap?: number;
}

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
  /** How the tool is swung while doing this. */
  swing?: SwingKind | ((c: Ctx) => SwingKind | undefined);
  /** Resolve at this fraction of the swing (the moment of impact) instead of at the end. */
  impactAt?: number;
  /** Hands-on work: the minigame to play instead of waiting out a timer. */
  minigame?: (c: Ctx) => MinigameSpec | undefined;
  /** Always the quick, timed version (no minigame). */
  quick?: boolean;
  /** Highest quality the work can reach with the equipment at hand. */
  qualityCap?: (c: Ctx) => number | undefined;
  /** Done at once with a quick reach (no progress bar): picking things up off the ground. */
  instant?: boolean;
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

/** Cubic metres of earth in one dirt/sand/clay item (and one small rock). */
export const EARTH_PER_ITEM = 0.5;

/** Radius of the shovel/pickaxe brush (metres), and of the hoe's levelling. */
export const DIG_RADIUS = 1.3;
export const LEVEL_RADIUS = 2.2;

/** The biome under the target, for foraging. */
function biome(c: Ctx): Biome | undefined {
  if (!isGround(c)) return undefined;
  const p = c.t.point;
  return biomeAt(c.g.world, p.x, p.y, p.z, c.t.mat);
}

/** Name of a forage find as the player knows it: the species once identified, else what it looks like. */
export function forageName(o: ForageObj): string {
  const sp = FORAGE[o.species];
  // Common finds keep their own name; wild species show as their item once identified.
  if (IDENTIFY[sp.item] === undefined) return sp.name;
  return isIdentified(sp.item) ? itemDef(sp.item).name : sp.name;
}

/** Try to recognise a wild species (herbalism). Returns true if newly learned. */
function tryIdentify(g: Game, type: string, bonus = 0): boolean {
  const diff = IDENTIFY[type];
  if (diff === undefined || isIdentified(type)) return false;
  const chance = g.skills.successChance('herbalism', diff + 4 - bonus);
  g.skills.gain('herbalism', diff, false, 2);
  if (Math.random() >= chance && !g.dev.on('alwaysSucceed')) return false;
  learnSpecies(type);
  return true;
}

/** Bigger, faster earthworks with skill and a good tool. */
function earthBudget(c: Ctx, base: number, skill: SkillId) {
  const power = c.tool ? itemDef(c.tool.type).toolPower ?? 1 : 0.5;
  return base * (0.6 + 0.4 * power) * (1 + c.g.skills.get(skill) / 120);
}

/** After the ground's been worked: crops, finds (gone if `dug` out, else onto the new surface), and what's drawn. */
function afterEdit(c: Ctx, x: number, z: number, r: number, dug = false) {
  c.g.world.disturbCrops(x, z, r);
  c.g.world.settleForage(x, z, r, dug);
  c.g.resettleFinds(x, z, r + 0.5);
  c.g.view.refreshNear(x, z, r + 1);
  c.g.groundCover.invalidate(x, z, r + 1);
}

function cropAt(c: Ctx): { key: number; crop?: Crop } {
  if (!isGround(c)) return { key: -1 };
  const key = cropKey(c.t.point.x, c.t.point.z);
  return { key, crop: c.g.world.crops.get(key) };
}

/** A tamed ox close to the aimed-at cart (to hitch it to). */
function nearOx(c: Ctx): AnimalObj | undefined {
  if (c.t.kind !== 'cart') return undefined;
  const k = c.t.cart;
  return c.g.world.animals.find((a) => a.species === 'ox' && a.tamed && Math.hypot(a.x - k.x, a.z - k.z) < 6 && !c.g.world.carts.some((o) => o.hitched === a.id));
}

/** Earth items to fill with, best first. */
function fillItem(g: Game): string | undefined {
  return ['dirt', 'sand', 'clay'].find((t) => g.inv.count(t) > 0 || g.earthCredit(t) > 0);
}
const FILL_MAT: Record<string, Mat> = { dirt: Mat.Dirt, sand: Mat.Sand, clay: Mat.Clay };

// ---------- actions
/** Floors a torch can be stood on (in a ring of stones). */
const FLOORS = new Set(['floor', 'stone_foundation']);
/** The top of the floor you're looking at, if you're looking down onto one (null otherwise). */
function floorTop(c: Ctx): number | null {
  const s = obj(c, 'structure');
  if (!s || !s.built || !FLOORS.has(s.type) || c.t.kind !== 'object') return null;
  const b = STRUCTURES[s.type].boxes[0], top = s.y + b.c[1] + b.h[1];
  return Math.abs(c.t.point.y - top) < 0.12 ? top : null;
}

/** Torches set down in the world: planted in the ground, or on a wall. */
const TORCHES = new Set(['standing_torch', 'wall_torch']);
/** What a torch can be mounted on: walls (built ones), and the faces of town houses. */
const MOUNTABLE = (type: string) => type === 'wood_wall' || type === 'log_wall' || type === 'stone_wall' || type === 'window_wall' || type.startsWith('th_');

/**
 * Where a torch would go on the wall you're looking at: on the face toward
 * you, at the height you aimed (kept clear of the floor and the top), facing
 * out from it. Null if you aren't looking at a wall's face.
 */
function wallFace(c: Ctx): { x: number; y: number; z: number; yaw: number } | null {
  const s = obj(c, 'structure');
  if (!s || !s.built || !MOUNTABLE(s.type) || c.t.kind !== 'object') return null;
  const p = c.t.point, eye = c.g.camera.position;
  const [lx, ly, lz] = toLocal(s, p.x, p.y, p.z), [ex, , ez] = toLocal(s, eye.x, eye.y, eye.z);
  // The part of the piece you hit (a windowed wall is several), and its face nearest the hit (on your side of it).
  const b = STRUCTURES[s.type].boxes.find((q) => Math.abs(lx - q.c[0]) <= q.h[0] + 0.06 && Math.abs(ly - q.c[1]) <= q.h[1] + 0.06 && Math.abs(lz - q.c[2]) <= q.h[2] + 0.06);
  if (!b) return null;
  const dx = b.h[0] - Math.abs(lx - b.c[0]), dz = b.h[2] - Math.abs(lz - b.c[2]);
  const alongZ = dz <= dx;
  // (Which side: yours, by where your eye is.)
  const sg = alongZ ? Math.sign(ez - b.c[2]) || 1 : Math.sign(ex - b.c[0]) || 1;
  const fx = alongZ ? lx : b.c[0] + sg * (b.h[0] + 0.01), fz = alongZ ? b.c[2] + sg * (b.h[2] + 0.01) : lz;
  // Heights over the whole piece (a windowed wall is a sill, two posts and a lintel), off the floor and the top.
  const boxes = STRUCTURES[s.type].boxes;
  const lo = Math.min(...boxes.map((q) => q.c[1] - q.h[1])) + 0.5, hi = Math.max(...boxes.map((q) => q.c[1] + q.h[1])) - 0.45;
  if (hi < lo) return null;
  let fy = Math.max(lo, Math.min(hi, ly)), fu = alongZ ? fx : fz;
  // Not hanging in a window: onto the nearest solid part of the face.
  const ax = alongZ ? 0 : 2, inside = (q: typeof b) => Math.abs(fu - q.c[ax]) <= q.h[ax] && Math.abs(fy - q.c[1]) <= q.h[1];
  if (!boxes.some(inside)) {
    let best = Infinity, bu = fu, bv = fy;
    for (const q of boxes) {
      const u = Math.max(q.c[ax] - q.h[ax] + 0.1, Math.min(q.c[ax] + q.h[ax] - 0.1, fu)), v = Math.max(Math.max(lo, q.c[1] - q.h[1]), Math.min(Math.min(hi, q.c[1] + q.h[1]), fy));
      const d = Math.hypot(u - fu, v - fy);
      if (d < best && v >= lo - 0.01 && v <= hi + 0.01) { best = d; bu = u; bv = v; }
    }
    fu = bu; fy = bv;
  }
  const [x, y, z] = toWorld(s, alongZ ? [fu, fy, fz] : [fx, fy, fu]);
  // Its own +z points out of the face: the wall's +z or -z (or +x / -x for a town house's end).
  const yaw = alongZ ? s.yaw + (sg > 0 ? 0 : Math.PI) : s.yaw + (sg > 0 ? Math.PI / 2 : -Math.PI / 2);
  return { x, y, z, yaw };
}

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
      const t = c.g.world.terrain;
      const temp = t.temperatureAt(p.x, p.y, p.z), wet = t.moistureAt(p.x, p.z);
      const feel = `${temp < 0.2 ? 'bitterly cold' : temp < 0.35 ? 'cold' : temp < 0.55 ? 'cool' : 'mild'} and ${wet < 0.3 ? 'dry' : wet < 0.55 ? 'fair' : wet < 0.75 ? 'damp' : 'wet'}`;
      c.g.msg(`${MAT_NAMES[mat]} at ${p.y.toFixed(1)} m (${p.y >= 0 ? 'above' : 'below'} sea level), ${slope}° slope.${under} ${isRock(mat) ? 'Exposed rock' : ZONE_NAMES[t.zoneAt(p.x, p.z)]}, ${feel} here.`, 'info');
      const b = biome(c)!;
      c.g.msg(`${BIOMES[b].name}: ${BIOMES[b].hint}`, 'info');
      const { crop } = cropAt(c);
      if (crop) {
        const st = c.g.world.cropStage(crop);
        c.g.msg(`Wheat, QL ${crop.ql.toFixed(1)}, growth ${st + 1}/${CROP_STAGES}${st === CROP_STAGES - 1 ? ' — ripe!' : ''}, tended ${crop.tended}x.`, 'info');
      }
    },
  },
  // ===== forage finds lying on the ground
  {
    id: 'pick_forage', label: (c) => `Pick ${forageName(obj(c, 'forage')!).toLowerCase()}`,
    show: (c) => !!obj(c, 'forage'),
    // Picked straight up (skill still sets the quality and grows as you gather).
    time: (c) => 2 + FORAGE[obj(c, 'forage')!.species].difficulty * 0.25, instant: true,
    skill: 'foraging', difficulty: (c) => FORAGE[obj(c, 'forage')!.species].difficulty, stamina: 1,
    run: (c, o) => {
      const node = obj(c, 'forage')!;
      const g = c.g, sp = FORAGE[node.species];
      g.world.remove(node);
      if (sp.category === 'mushroom') g.quests?.note('picked_mushroom');
      const n = sp.count[0] + Math.floor(Math.random() * (sp.count[1] - sp.count[0] + 1)) + (Math.random() < g.skills.get('foraging') / 150 ? 1 : 0);
      const biome = biomeAt(g.world, node.x, node.y, node.z, g.world.terrain.materialAt(node.x, node.y - 0.05, node.z));
      const wasKnown = isIdentified(sp.item);
      const recognised = tryIdentify(g, sp.item);
      const handledEnough = g.knowledge.handled(sp.item, biome, n);
      g.give(sp.item, o.ql, n);
      g.msg(`You pick ${n > 1 ? n + ' × ' : ''}${typeName(sp.item).toLowerCase()}.`, 'good');
      if (!wasKnown && (recognised || handledEnough)) {
        g.msg(`${recognised ? 'You recognise it' : "You've handled enough of these to know them"}: ${itemDef(sp.item).name}. ${itemDef(sp.item).desc}`, 'skill');
        g.inventoryChanged();
      }
    },
  },
  {
    id: 'examine_forage', label: 'Examine',
    show: (c) => !!obj(c, 'forage'), time: 0,
    run: (c) => {
      const node = obj(c, 'forage')!;
      const sp = FORAGE[node.species];
      c.g.msg(`${forageName(node)}. ${typeDesc(sp.item)}`, 'info');
    },
  },
  {
    id: 'survey', label: 'Survey the area', show: () => false,
    time: 2, fixedTime: true, skill: 'foraging', difficulty: 6, stamina: 2,
    run: (c, o) => c.g.survey(o.success),
  },
  {
    id: 'study', label: (c) => `Study ${c.item ? itemName(c.item).toLowerCase() : ''}`, show: () => false,
    check: (c) => (!c.item || !c.g.inv.find(c.item.uid) ? 'You no longer have it.' : isIdentified(c.item.type) ? 'You already know what that is.' : null),
    time: 5, skill: 'herbalism', difficulty: (c) => IDENTIFY[c.item!.type] ?? 5, stamina: 1,
    run: (c, o) => {
      const it = c.item!;
      if (!o.success) return c.g.msg(`You look the ${itemName(it).toLowerCase()} over, but still can't tell what it is.`, 'fail');
      learnSpecies(it.type);
      c.g.inventoryChanged();
      c.g.msg(`You figured it out: it's ${itemDef(it.type).name.toLowerCase()}. ${itemDef(it.type).desc}`, 'skill');
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
    time: 4, swing: 'dig', skill: 'digging', difficulty: 6, stamina: 6, toolWear: 0.12,
    run: (c, o) => {
      if (!isGround(c)) return;
      const { point: p, normal: n } = c.t;
      const budget = earthBudget(c, 0.9, 'digging') * (o.success ? 1 : 0.4);
      const cx = p.x - n.x * 0.35, cy = p.y - n.y * 0.35, cz = p.z - n.z * 0.35;
      const vol = c.g.world.terrain.dig(cx, cy, cz, DIG_RADIUS, budget, isSoft);
      afterEdit(c, cx, cz, DIG_RADIUS, true);
      const got = c.g.collectEarth(vol, o.ql);
      c.g.msg(got ? `You dig out ${got}.` : 'You scrape at the ground but move almost nothing.', o.success ? 'good' : 'info');
    },
  },
  {
    id: 'level', label: 'Level ground (to your feet)',
    show: (c) => toolIs(c, 'hoe') && isGround(c),
    check: (c) => {
      if (!isGround(c)) return '';
      const p = c.t.point;
      if (Math.hypot(p.x - c.g.player.pos.x, p.z - c.g.player.pos.z) > 6) return 'Stand closer to the ground you want to level.';
      return null;
    },
    swing: 'dig',
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
    swing: 'dig',
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
    show: (c) => toolIs(c, 'hoe') && isGround(c),
    swing: 'dig',
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
    time: 7, swing: 'chop', skill: 'mining', difficulty: (c) => ({ [Mat.Iron]: 18, [Mat.Shale]: 6, [Mat.Sandstone]: 7 } as Partial<Record<Mat, number>>)[groundMat(c) ?? Mat.Rock] ?? 8,
    stamina: 10, toolWear: 0.2,
    run: (c, o) => {
      if (!isGround(c)) return;
      if (!o.success) return c.g.msg('You chip at the rock, but nothing breaks off.', 'fail');
      const { point: p, normal: n } = c.t;
      const cx = p.x - n.x * 0.3, cy = p.y - n.y * 0.3, cz = p.z - n.z * 0.3;
      const vol = c.g.world.terrain.dig(cx, cy, cz, 1.1, earthBudget(c, 0.7, 'mining'), () => true);
      afterEdit(c, cx, cz, 1.1, true);
      const got = c.g.collectEarth(vol, o.ql);
      c.g.msg(got ? `You mine ${got}.${vol[Mat.Iron] ? ' Iron!' : ''}` : 'You break off some gravel.', vol[Mat.Iron] ? 'good' : 'info');
    },
  },
  // ===== boulders lying about: break them up for small rocks
  {
    id: 'break_rock', label: 'Break up the boulder',
    show: (c) => c.t.kind === 'rock' && toolIs(c, 'pickaxe'),
    time: (c) => (c.t.kind === 'rock' ? 4 + c.t.rock.sc * 5 : 6), swing: 'chop', skill: 'mining', difficulty: (c) => (c.t.kind === 'rock' ? 3 + c.t.rock.sc * 4 : 5),
    stamina: 8, toolWear: 0.15,
    run: (c, o) => {
      if (c.t.kind !== 'rock') return;
      const b = c.t.rock;
      if (!o.success) return c.g.msg('Your pickaxe skips off the boulder. Try again.', 'fail');
      c.g.world.brokenRocks.add(b.key);
      c.g.groundCover.invalidate(b.x, b.z, 2);
      const n = Math.max(2, Math.round(2 + b.sc * 5 + Math.random() * 2));
      c.g.give('rock_shard', o.ql, n);
      // Some boulders hold a nodule or two of flint.
      if (Math.random() < 0.45) { const f = 1 + (Math.random() < 0.35 ? 1 : 0); c.g.give('flint', o.ql, f); c.g.msg(`There ${f > 1 ? 'are two nodules' : 'is a nodule'} of flint in it.`, 'good'); }
      c.g.sound.chop(0.8);
      c.g.msg(`The boulder cracks apart: ${n} small rocks.`, 'good');
    },
  },
  {
    id: 'examine_rock', label: 'Examine', show: (c) => c.t.kind === 'rock', time: 0,
    run: (c) => {
      if (c.t.kind !== 'rock') return;
      const s = c.t.rock.sc;
      c.g.msg(`A ${s < 0.6 ? 'small' : s < 1.1 ? 'sizeable' : 'big'} boulder. Break it up with a pickaxe for small rocks.`, 'info');
    },
  },
  {
    id: 'cultivate', label: 'Till the soil',
    show: (c) => toolIs(c, 'hoe') && (groundMat(c) === Mat.Grass || groundMat(c) === Mat.Dirt),
    check: (c) => {
      if (!isGround(c)) return '';
      if (c.t.normal.y < 0.85) return 'The ground is too steep to farm. Level it first.';
      if (c.t.point.y < c.g.world.terrain.waterAt(c.t.point.x, c.t.point.z) + 0.1) return 'Too wet to farm.';
      if (c.g.world.near(c.t.point.x, c.t.point.z, 1.5).some((o) => o.kind === 'tree' && Math.hypot(o.x - c.t.point.x, o.z - c.t.point.z) < 1.2)) return 'Tree roots are in the way.';
      return null;
    },
    swing: 'dig',
    time: 6, skill: 'farming', difficulty: 5, stamina: 7, toolWear: 0.1,
    run: (c, o) => {
      if (!isGround(c)) return;
      if (!o.success) return c.g.msg('The roots are too tough here. You couldn\'t break the soil.', 'fail');
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
      if (!o.success) return c.g.msg('You scatter the seeds badly, and the birds eat them.', 'fail');
      const { key } = cropAt(c);
      c.g.world.crops.set(key, { planted: c.g.world.time, ql: (o.ql + seedQl) / 2, tended: 0 });
      c.g.world.listener?.cropsChanged(key);
      c.g.msg('You sow a row of wheat.', 'good');
    },
  },
  {
    id: 'tend', label: 'Tend crop',
    show: (c) => toolIs(c, 'hoe') && !!cropAt(c).crop,
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
      c.g.msg('You weed and tend the crop. It will now grow faster and better.', 'good');
    },
  },
  {
    id: 'harvest', label: 'Harvest',
    show: (c) => !!cropAt(c).crop && (!c.tool || toolIs(c, 'scythe')),
    check: (c) => { const crop = cropAt(c).crop; return !crop ? 'There is nothing here to harvest.' : c.g.world.cropStage(crop) < CROP_STAGES - 1 ? 'The wheat is not ripe yet.' : null; },
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
      const species = SPECIES.find((sp) => label.includes(sp)) ?? 'oak';
      c.g.world.add<TreeObj>({ kind: 'tree', species, x: c.t.point.x, z: c.t.point.z, age: 0.03, branches: 0, growing: true });
      c.g.msg(`You plant the ${species} sprout. Give it time to grow.`, 'good');
    },
  },

  // ===== torches
  {
    id: 'plant_torch', label: 'Plant torch here',
    show: (c) => c.g.activeItem()?.type === 'torch' && (isGround(c) || !!floorTop(c)),
    check: (c) => {
      if (isGround(c)) {
        if (c.t.normal.y < 0.6) return 'The ground is too steep to stand a torch here.';
        if (c.t.point.y < c.g.world.terrain.waterAt(c.t.point.x, c.t.point.z)) return 'Not under water.';
      }
      return null;
    },
    time: 0.6,
    run: (c) => {
      const g = c.g, it = g.activeItem();
      if (!it || it.type !== 'torch') return;
      const p = c.t.kind === 'none' ? null : c.t.point, floor = floorTop(c);
      if (!p) return;
      // In soft ground it's pushed in; on rock, gravel or a floor it stands in a ring of stones.
      const soft = isGround(c) && isSoft(c.t.mat) && c.t.mat !== Mat.Gravel;
      const y = floor ?? g.world.terrain.groundBelow(p.x, p.y + 0.3, p.z);
      g.world.add<StructureObj>({ kind: 'structure', type: 'standing_torch', x: p.x, y, z: p.z, yaw: Math.random() * 6.28,
        consumed: {}, built: true, ql: it.ql, dmg: it.dmg, fuel: TORCH_BURN * Math.max(0, 1 - it.dmg / 100), lit: true });
      g.consumeActive();
      g.msg(soft ? 'You plant the torch in the ground. It keeps burning there, and you can pick it back up any time.'
        : `You stand the torch up in a ring of stones on the ${floor !== null ? 'floor' : 'rock'}. It keeps burning there, and you can pick it back up any time.`, 'info');
    },
  },
  {
    id: 'mount_torch', label: 'Mount torch on the wall',
    show: (c) => c.g.activeItem()?.type === 'torch' && !!wallFace(c),
    check: (c) => {
      const f = wallFace(c);
      if (!f) return null;
      for (const o of c.g.world.near(f.x, f.z, 0.8)) if (o.kind === 'structure' && o.type === 'wall_torch' && Math.hypot(o.x - f.x, o.z - f.z) < 0.6 && Math.abs(o.y - f.y) < 0.8) return 'There is a torch on the wall here already.';
      return null;
    },
    time: 0.8,
    run: (c) => {
      const g = c.g, it = g.activeItem(), f = wallFace(c);
      if (!it || it.type !== 'torch' || !f) return;
      g.world.add<StructureObj>({ kind: 'structure', type: 'wall_torch', x: f.x, y: f.y, z: f.z, yaw: f.yaw,
        consumed: {}, built: true, ql: it.ql, dmg: it.dmg, fuel: TORCH_BURN * Math.max(0, 1 - it.dmg / 100), lit: true });
      g.consumeActive();
      g.msg('You set the torch in a bracket on the wall. It keeps burning there, and you can take it down any time.', 'info');
    },
  },
  {
    id: 'relight_torch', label: 'Relight torch',
    show: (c) => { const s = obj(c, 'structure'); return !!s && TORCHES.has(s.type) && !s.lit; },
    check: (c) => (c.g.inv.count('kindling') === 0 || c.g.inv.count('branch') === 0 ? 'Relighting a torch takes a kindling and a branch.' : null),
    time: 5, skill: 'firemaking', difficulty: 2, stamina: 2,
    minigame: () => ({ kind: 'bowdrill' }),
    run: (c, o) => {
      const s = obj(c, 'structure')!;
      c.g.inv.take('kindling', 1);
      if (!o.success) { c.g.inventoryChanged(); return c.g.msg('The kindling smoulders and dies. Try again.', 'fail'); }
      c.g.inv.take('branch', 1);
      c.g.inventoryChanged();
      s.lit = true; s.fuel = TORCH_BURN; s.dmg = 0;
      c.g.world.changed(s);
      c.g.msg('You bind on a fresh head and the torch flares up again.', 'good');
    },
  },
  {
    id: 'place_item', label: (c) => `Place ${itemName(c.tool!).toLowerCase()} here`,
    show: (c) => isGround(c) && !!c.tool && !!itemDef(c.tool.type).places,
    time: 0,
    run: (c) => c.g.startPlacingItem(c.tool!),
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
      g.quests?.note('drank');
    },
  },
  {
    id: 'fill_canteen', label: 'Fill canteen',
    show: (c) => c.t.kind === 'water' && c.g.inv.items.some((i) => itemDef(i.type).sips && (i.fill ?? 0) < itemDef(i.type).sips!),
    time: 2,
    run: ({ g }) => {
      const it = g.inv.items.find((i) => itemDef(i.type).sips && (i.fill ?? 0) < itemDef(i.type).sips!);
      if (!it) return;
      it.fill = itemDef(it.type).sips;
      g.inventoryChanged();
      g.msg(`You fill the canteen (${it.fill} drinks).`, 'info');
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
      c.g.msg(`${stage === 'old' ? 'An' : 'A'} ${stage} ${t.species} tree. It has ${t.branches} branches you could reach.`, 'info');
    },
  },
  {
    id: 'cut_tree',
    label: (c) => { const t = obj(c, 'tree'); return t && t.chop ? `Chop (${Math.round(t.chop * 100)}% through)` : 'Chop down'; },
    show: (c) => !!obj(c, 'tree') && toolIs(c, 'hatchet'),
    check: (c) => {
      const t = obj(c, 'tree')!;
      if (!c.g.world.objects.has(t.id)) return 'The tree is down.';
      return t.age < 0.2 ? 'It is only a sapling. Leave it to grow.' : null;
    },
    // Each swing is one blow; it lands at the bottom of the stroke.
    time: 1.35, fixedTime: true, impactAt: 0.62, swing: 'chop',
    skill: 'woodcutting', difficulty: (c) => TREES[obj(c, 'tree')!.species].difficulty, stamina: 3, toolWear: 0.05,
    repeat: (c) => { const t = obj(c, 'tree'); return !!t && c.g.world.objects.has(t.id); },
    run: (c, o) => {
      const t = obj(c, 'tree')!;
      const g = c.g;
      const p = g.player.pos;
      // The notch opens on the side you first chop from.
      if (t.notchDir === undefined) t.notchDir = Math.atan2(p.x - t.x, p.z - t.z);
      const power = c.tool ? itemDef(c.tool.type).toolPower ?? 1 : 0.5;
      // Bigger trees take longer: hardness grows with the trunk.
      const hardness = TREES[t.species].hardness * (0.35 + 0.3 * treeScale(t).s);
      const bite = (0.13 + 0.08 * power + g.skills.get('woodcutting') / 300) / hardness;
      // A glancing blow still takes a little out.
      const gained = o.success ? bite * (0.85 + Math.random() * 0.3) : bite * 0.45;
      const before = t.chop ?? 0;
      t.chop = Math.min(1, before + gained);
      // The logs' quality is the average quality of the blows that made them.
      t.chopQl = before > 0 ? ((t.chopQl ?? o.ql) * before + o.ql * gained) / t.chop : o.ql;
      g.treeHit(t, Math.min(1, gained / 0.15), o.success);
      if (!o.success && Math.random() < 0.35) g.msg('Your hatchet glances off the trunk.', 'fail');
      if (t.chop < 1) return;
      const ql = t.chopQl ?? o.ql;
      const logs = Math.max(1, Math.round(treeScale(t).s * 1.4));
      const items = [];
      for (let i = 0; i < logs; i++) items.push(makeItem('log', ql * (0.75 + t.age * 0.35), `${t.species} log`));
      for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) items.push(makeItem('branch', ql));
      if (Math.random() < 0.35) items.push(makeItem('sprout', ql, `${t.species} sprout`));
      // A bird's nest in the crown comes down with it: feathers.
      if (Math.random() < 0.6) for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) items.push(makeItem('feather', ql));
      g.msg('Timber! The tree creaks and starts to fall.', 'good');
      g.fellTree(t, items, () => {
        g.msg(`The ${t.species} crashes down, leaving ${logs} log${logs > 1 ? 's' : ''} and some branches.`, 'good');
        g.quests?.note('felled');
      });
    },
  },
  {
    id: 'pick_apples', label: 'Pick apples',
    show: (c) => { const t = obj(c, 'tree'); return !!t && t.species === 'apple' && t.age >= APPLE_AGE && !c.tool; },
    check: (c) => ((obj(c, 'tree')!.apples ?? APPLES) <= 0 ? 'No apples within reach. More will ripen in time.' : null),
    time: 3, skill: 'foraging', difficulty: 2, stamina: 1,
    run: (c, o) => {
      const t = obj(c, 'tree') as TreeObj;
      const left = t.apples ?? APPLES;
      const n = Math.min(left, o.success ? 1 + Math.floor(Math.random() * 3) : 1);
      t.apples = left - n;
      c.g.world.changed(t);
      c.g.give('apple', o.ql, n);
      c.g.msg(`You pick ${n > 1 ? `${n} apples` : 'an apple'}.`, 'good');
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
  // ===== stumps left after felling
  {
    id: 'dig_stump', label: 'Dig out stump',
    show: (c) => c.t.kind === 'stump' && toolIs(c, 'shovel'),
    // Bigger stumps have deeper roots.
    time: (c) => (c.t.kind === 'stump' ? 7 + stumpSize(c.t.stump).r * 22 : 8),
    swing: 'dig', skill: 'digging', difficulty: 8, stamina: 10, toolWear: 0.5,
    run: (c, o) => {
      if (c.t.kind !== 'stump') return;
      const st = c.t.stump, g = c.g;
      g.world.removeStump(st);
      g.view.treeFx.syncStumps(g.world.stumps);
      // The stump and its roots: firewood.
      const big = stumpSize(st).r > 0.28;
      if (big) g.give('log', o.ql, 1);
      g.give('branch', o.ql, big ? 2 : 3);
      g.msg(`You dig out the stump and pull it free${big ? ': a log and some roots for firewood' : ', roots and all'}.`, 'good');
    },
  },
  // ===== villagers
  {
    id: 'talk_villager', label: (c) => (c.t.kind === 'villager' ? `Talk to ${c.t.villager.name}` : 'Talk'),
    show: (c) => c.t.kind === 'villager', time: 0,
    run: (c) => {
      if (c.t.kind !== 'villager') return;
      const v = c.t.villager;
      if (v.lying) return c.g.msg(`${v.name} is fast asleep.`, 'info');
      const lines: Record<string, string[]> = {
        farmer: ['The wheat wants weeding twice over if it\'s to fill out.', 'Ripe fields don\'t wait. Neither do the crows.', 'A hoe and a strong back: that\'s farming.'],
        shepherd: ['Mind the gate, or they\'ll be off across the meadow.', 'Their fleece grows back by and by. Then it\'s shearing again.'],
        woodcutter: ['Fell from the outside in, and plant a sapling for every tree.', 'Split along the grain and the plank comes clean.'],
        butcher: ['A sharp knife is a kind knife.', 'Nothing goes to waste: meat for the pot, hide for the tanner.'],
        smith: ['Keep the forge hot and the trough full.', 'Quench it while it glows, or it\'ll be soft as butter.'],
        elder: ['Welcome, traveller. Mind our fields as you pass.', 'We\'ve kept this village through hard winters. You\'re welcome by the fire of an evening.'],
        villager: ['Always something to fetch and carry.', 'Lovely weather for gathering, isn\'t it?'],
        priest: ['Peace be with you, traveller.', 'The bells call the town to prayer at dawn and dusk. You\'re welcome under our roof.'],
        mayor: ['The roads keep this town fed: the traders bring grain from the villages and take our goods back.', 'Mind you pay your dues at the merchants\' hall.'],
        merchant: ['Finest wares this side of the river!', 'The traders bring the villages\' surplus here. Prices follow what\'s scarce.'],
        baker: ['Wheat from the villages, water from the well, and a hot oven.', 'Bread\'s best fresh. Ask at the stores.'],
        carpenter: ['Measure twice, cut once.', 'A good table outlasts the one who made it.'],
        lord: ['These walls have stood two hundred winters. The town below feeds them; they keep the town.', 'You\'re a long way from your own hearth, traveller. Keep the peace in my town.'],
        noble: ['The view from the castle road is the finest in the land.', 'One does so tire of the market crowds.'],
        innkeeper: ['Sit by the fire! Meat off the hearth, beds upstairs... well, beds at the back.', 'A hot meal\'s yours for a few coins.'],
        guard: ['Move along. No trouble inside the walls.', 'Gates are watched day and night.'],
      };
      const say = lines[v.role] ?? lines.villager;
      c.g.msg(`${v.name}, the ${v.roleName} (${v.doing}): "${say[Math.floor(Math.random() * say.length)]}"`, 'info');
    },
  },
  {
    // The innkeeper serves a hot meal from the town's stores.
    id: 'buy_meal', label: (c) => {
      const v = c.t.kind === 'villager' ? c.t.villager : undefined;
      return v ? `Buy a hot meal (${c.g.economy.price(v.village, 'cooked_meat', 'buy') + 2} coins)` : 'Buy a hot meal';
    },
    show: (c) => c.t.kind === 'villager' && c.t.villager.role === 'innkeeper' && !c.t.villager.lying,
    check: (c) => {
      if (c.t.kind !== 'villager') return '';
      const v = c.t.villager, price = c.g.economy.price(v.village, 'cooked_meat', 'buy') + 2;
      if (c.g.economy.stock(v.village, 'cooked_meat') === 0) return 'The pot is empty. Come back when there\'s meat on the hearth.';
      if (c.g.coins < price) return `You need ${price} coins.`;
      return null;
    },
    time: 0,
    run: (c) => {
      if (c.t.kind !== 'villager') return;
      const v = c.t.villager, eco = c.g.economy;
      const price = eco.price(v.village, 'cooked_meat', 'buy') + 2;
      const [meal] = eco.take(v.village, 'cooked_meat', 1);
      if (!meal) return;
      c.g.coins -= price;
      eco.ledger(v.village).treasury += price;
      c.g.inv.add(meal);
      c.g.eat(meal.uid);
      c.g.msg(`${v.name} sets a steaming plate before you. (${price} coins)`, 'good');
    },
  },
  {
    id: 'talk_trader', label: (c) => (c.t.kind === 'trader' ? `Talk to ${c.t.trader.name}` : 'Talk'),
    show: (c) => c.t.kind === 'trader', time: 0,
    run: (c) => {
      if (c.t.kind !== 'trader') return;
      const lines = ['The roads are long, but the grain\'s worth more in town than where it\'s grown.', 'Buy where it\'s plenty, sell where it\'s wanting: that\'s the whole of the trade.', 'Mind the boar on the road at dusk.'];
      c.g.msg(`${c.g.traders.describe(c.t.trader)} "${lines[Math.floor(Math.random() * lines.length)]}"`, 'info');
    },
  },
  {
    id: 'examine_stump', label: 'Examine stump',
    show: (c) => c.t.kind === 'stump', time: 0,
    run: (c) => c.g.msg('A tree stump, its roots still in the ground. Dig it out with a shovel to clear the spot.', 'info'),
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
    minigame: (c) => {
      const s = obj(c, 'structure')!;
      const next = nextMaterial(STRUCTURES[s.type], s);
      // Done on the piece itself: carry the next material in and fix it in place.
      return next ? { kind: 'build', s, material: next } : undefined;
    },
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
        else { c.g.inv.add(m); c.g.inventoryChanged(); c.g.msg('You slip up and have to redo that part.', 'fail'); }
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
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !STRUCTURES[s.type].item && !STRUCTURES[s.type].village && (toolIs(c, 'hammer') || toolIs(c, 'hatchet')); },
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
      if (def.water) extra = ` It holds ${(s.water ?? 0).toFixed(1)} of ${def.water} jars of water.`;
      if (def.attach) {
        const forge = c.g.world.near(s.x, s.z, 2).find((o) => o.kind === 'structure' && o.type === 'forge' && c.g.bellowsOf(o) === s);
        extra = forge ? ' It is set against a forge.' : ' It is not against a forge, so it does nothing here.';
      }
      if (def.station === 'anvil') extra = ` Working on it: ${Math.round(anvilGrade(s) * 100)}% as forgiving as the finest iron anvil.`;
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
      if (c.g.inv.count('kindling') === 0) return 'You need kindling to light a fire. Craft it from 3 branches with a knife, or split a plank at a chopping block.';
      return null;
    },
    time: 6, skill: 'firemaking', difficulty: 8, stamina: 3,
    minigame: () => ({ kind: 'bowdrill' }),
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
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].container && s.type !== 'village_store'; },
    time: 0,
    run: (c) => c.g.ui.openContainer(obj(c, 'structure')!),
  },
  {
    // The village's stores: buy and sell, and take on its work.
    id: 'open_store', label: 'Trade and work orders',
    show: (c) => obj(c, 'structure')?.type === 'village_store',
    time: 0,
    run: (c) => c.g.ui.openStore(obj(c, 'structure')!),
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
    id: 'pick_up', label: (c) => `Pick up ${STRUCTURES[obj(c, 'structure')!.type].name.toLowerCase()}`,
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].item; },
    check: (c) => {
      const w = itemDef(STRUCTURES[obj(c, 'structure')!.type].item!).weight;
      if (!c.g.dev.on('noWeight') && c.g.inv.weight() + w > c.g.carryCapacity() * 1.5) return `It is too heavy to carry with all that in your pack (${w} kg).`;
      return null;
    },
    time: (c) => 1 + itemDef(STRUCTURES[obj(c, 'structure')!.type].item!).weight / 15, stamina: 5,
    run: (c) => {
      const s = obj(c, 'structure')!;
      const def = STRUCTURES[s.type];
      const torch = TORCHES.has(s.type);
      const it = makeItem(torch && !s.lit ? 'torch_spent' : def.item!, s.ql);
      it.dmg = torch ? (s.lit ? 100 * (1 - s.fuel / TORCH_BURN) : 0) : s.dmg ?? 0;
      c.g.world.remove(s);
      c.g.inv.add(it);
      c.g.inventoryChanged();
      c.g.msg(torch
        ? (s.lit ? `You ${s.type === 'wall_torch' ? 'take down' : 'pull up'} the torch. Hold it, set it down again or mount it on a wall.` : `You ${s.type === 'wall_torch' ? 'take down' : 'pull up'} the spent torch. Relight it with a kindling and a branch.`)
        : `You pick up the ${def.name.toLowerCase()}${(s.water ?? 0) > 0 ? ', spilling the water' : ''}. Place it again from your pack.`, 'info');
    },
  },
  {
    id: 'fill_trough', label: 'Pour in a jar of water',
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].water && c.g.inv.count('jar_of_water') > 0; },
    check: (c) => { const s = obj(c, 'structure')!; return (s.water ?? 0) >= STRUCTURES[s.type].water! - 0.01 ? 'The trough is full.' : null; },
    time: 2,
    repeat: (c) => { const s = obj(c, 'structure'); return !!s && (s.water ?? 0) < STRUCTURES[s.type].water! - 0.01 && c.g.inv.count('jar_of_water') > 0; },
    run: (c) => {
      const s = obj(c, 'structure')!;
      const jar = c.g.inv.ofType('jar_of_water').at(-1);
      if (!jar) return;
      jar.type = 'clay_jar';
      const cap = STRUCTURES[s.type].water!;
      s.water = Math.min(cap, (s.water ?? 0) + 1);
      c.g.world.changed(s);
      c.g.inventoryChanged();
      c.g.msg(`You pour a jar of water into the trough (${s.water.toFixed(1)}/${cap}).`, 'info');
    },
  },
  {
    id: 'quench', label: (c) => `Quench ${itemName(hotItem(c)!).toLowerCase()}`,
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].water && !!hotItem(c); },
    check: (c) => {
      const s = obj(c, 'structure')!;
      if (!hotItem(c)) return 'It has already cooled.';
      if (!c.g.toolFor('tongs')) return 'You need tongs to hold the hot metal.';
      if ((s.water ?? 0) < 0.5) return 'The trough is dry. Pour jars of water into it first.';
      return null;
    },
    time: 4, skill: 'smithing', stamina: 3,
    difficulty: (c) => RECIPES.find((r) => r.output.item === hotItem(c)?.type)?.difficulty ?? 15,
    minigame: (c) => ({ kind: 'quench', gear: obj(c, 'structure')!.ql / 100 }),
    repeat: (c) => !!hotItem(c),
    run: (c, o) => {
      const s = obj(c, 'structure')!;
      const it = hotItem(c)!;
      const g = c.g;
      s.water = Math.max(0, (s.water ?? 0) - 0.5);
      g.world.changed(s);
      delete it.hot;
      const tongs = g.toolFor('tongs');
      if (tongs) g.wear(tongs, 0.8);
      const name = itemName(it).toLowerCase();
      g.inventoryChanged();
      if (!o.success) {
        it.dmg = Math.min(99, it.dmg + 12 + Math.random() * 10);
        g.msg(`It goes in badly and the ${name} cracks (damage ${it.dmg.toFixed(0)}).`, 'fail');
        return;
      }
      // Good quenching hardens the steel; a better trough keeps the water calmer.
      const perf = o.perf ?? 0.55;
      const before = it.ql;
      it.ql = Math.min(100, it.ql + (1.5 + 7 * perf) * (0.6 + 0.4 * s.ql / 100));
      it.quenched = true;
      g.msg(`The ${name} hisses and steams in the trough. Hardened: QL ${before.toFixed(1)} → ${it.ql.toFixed(1)}, and it will wear more slowly.`, 'good');
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
      // Fine furniture round the bed makes for a better night: you wake rested.
      let comfort = 0;
      for (const o of g.world.near(s.x, s.z, COMFORT_RANGE)) {
        if (o.kind === 'structure' && o.built && Math.hypot(o.x - s.x, o.z - s.z) <= COMFORT_RANGE) comfort += STRUCTURES[o.type].comfort ?? 0;
      }
      comfort = Math.min(MAX_COMFORT, comfort);
      if (comfort > 0) {
        g.player.effects.rested = { t: 240 + 90 * comfort, rate: comfort };
        g.msg(`Comfort ${comfort}: you wake well rested. Your stamina comes back ${Math.round(comfort * COMFORT_REGEN * 100)}% faster for a while.${comfort < MAX_COMFORT ? ' More fine furniture near the bed would help.' : ''}`, 'good');
      } else {
        g.msg('A bare room: fine furniture near the bed (made at a workbench: chairs, tables, shelves, rugs, a rocking chair…) would help you wake rested.', 'info');
      }
      const f = g.world.dayFraction;
      if (f > 0.75 || f < 0.22) {
        const DAY = 1200;
        const skip = ((1.25 - f) % 1) * DAY;
        g.world.time += skip;
        g.player.food = Math.max(0, g.player.food - 10);
        g.player.water = Math.max(0, g.player.water - 15);
        g.msg('You sleep through the night and wake up rested. Your respawn point is set.', 'good');
      } else {
        g.msg('You rest for a while. This bed is now your respawn point.', 'good');
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
    check: (c) => (obj(c, 'pile')?.items.some((i) => i.type === 'corpse') ? null : 'There is nothing left to butcher.'),
    time: 10, skill: 'butchering', difficulty: 8, stamina: 8, toolWear: 0.2,
    run: (c, o) => {
      const p = obj(c, 'pile') as PileObj;
      const corpse = p.items.find((i) => i.type === 'corpse')!;
      p.items = p.items.filter((i) => i !== corpse);
      const species = corpseSpecies(corpse.label);
      const meat = Math.max(1, ANIMALS[species].meat + (o.success ? 1 : -1));
      c.g.give('raw_meat', o.ql, meat);
      if (o.success) c.g.give('hide', o.ql, 1);
      if (p.items.length === 0) c.g.world.remove(p);
      else c.g.world.changed(p);
      c.g.msg(`You butcher the ${ANIMALS[species].name.replace('Wild ', '').toLowerCase()}: ${meat} meat${o.success ? ' and a hide' : '. The hide is ruined'}.`, o.success ? 'good' : 'info');
      c.g.quests?.note('butchered');
    },
  },

  // ===== carts
  {
    id: 'open_cart', label: (c) => `Open ${c.t.kind === 'cart' && c.t.cart.type === 'ox_cart' ? 'ox cart' : 'hand cart'}`,
    show: (c) => c.t.kind === 'cart', time: 0,
    run: (c) => { if (c.t.kind === 'cart') c.g.ui.openContainer(c.t.cart); },
  },
  {
    id: 'grab_cart', label: 'Grab the handles',
    show: (c) => c.t.kind === 'cart' && c.t.cart.type === 'hand_cart' && c.g.pushing !== c.t.cart && !c.g.riding,
    time: 0.4, fixedTime: true,
    run: (c) => { if (c.t.kind === 'cart') { c.g.pushing = c.t.cart; c.g.msg('You take the handles. Walk to push the cart; press X (or aim at it) to let go.', 'info'); } },
  },
  {
    id: 'let_go_cart', label: 'Let go',
    show: (c) => c.t.kind === 'cart' && c.g.pushing === c.t.cart, time: 0,
    run: (c) => { c.g.pushing = null; c.g.msg('You set the cart down.', 'info'); },
  },
  {
    id: 'hitch_world_cart', label: 'Hitch to your ox',
    show: (c) => c.t.kind === 'cart' && c.t.cart.type === 'ox_cart' && c.t.cart.hitched === undefined && !!nearOx(c),
    time: 3,
    run: (c) => {
      const ox = nearOx(c);
      if (c.t.kind !== 'cart' || !ox) return;
      c.t.cart.hitched = ox.id;
      c.g.msg('You hitch the cart to your ox.', 'good');
    },
  },
  {
    id: 'unhitch_cart', label: 'Unhitch',
    show: (c) => c.t.kind === 'cart' && c.t.cart.hitched !== undefined, time: 2,
    run: (c) => { if (c.t.kind === 'cart') { c.t.cart.hitched = undefined; c.g.msg('You unhitch the cart. It stays here.', 'info'); } },
  },
  {
    id: 'pick_up_cart', label: 'Pick up the cart',
    show: (c) => c.t.kind === 'cart' && c.t.cart.hitched === undefined && c.g.pushing !== c.t.cart,
    check: (c) => (c.t.kind === 'cart' && c.t.cart.items.length ? 'Empty it first.' : null),
    time: 2,
    run: (c) => {
      if (c.t.kind !== 'cart') return;
      const cart = c.t.cart, g = c.g;
      g.world.carts.splice(g.world.carts.indexOf(cart), 1);
      const it = makeItem(cart.type, cart.ql);
      it.dmg = cart.dmg;
      g.inv.add(it);
      g.inventoryChanged();
      g.msg(`You lift the ${cart.type === 'ox_cart' ? 'ox cart' : 'hand cart'} into your pack.`, 'info');
    },
  },
  {
    id: 'examine_cart', label: 'Examine', show: (c) => c.t.kind === 'cart', time: 0,
    run: (c) => {
      if (c.t.kind !== 'cart') return;
      const k = c.t.cart, w = k.items.reduce((a, i) => a + itemDef(i.type).weight, 0);
      c.g.msg(`${k.type === 'ox_cart' ? 'An ox cart' : 'A hand cart'}, QL ${k.ql.toFixed(1)}: ${w.toFixed(0)} / ${CART_CAPACITY[k.type]} kg loaded.${k.hitched !== undefined ? ' Hitched to your ox.' : ''}`, 'info');
    },
  },

  // ===== animals
  {
    id: 'feed_horse', label: (c) => (c.t.kind === 'animal' && c.t.animal.tamed ? 'Feed apple' : 'Offer apple'),
    show: (c) => c.t.kind === 'animal' && c.t.animal.species === 'horse' && c.tool?.type === 'apple' && c.t.animal !== c.g.riding,
    time: 2.5, skill: 'taming', difficulty: 10, stamina: 0,
    run: (c) => {
      if (c.t.kind !== 'animal' || !c.tool) return;
      const a = c.t.animal, g = c.g;
      if (!g.world.animals.includes(a)) return;
      g.consumeActive();
      g.inventoryChanged();
      // It stops to take the apple, turned toward you.
      a.state = 'idle'; a.timer = 3; a.speed = 0;
      a.rot = Math.atan2(g.player.pos.x - a.x, g.player.pos.z - a.z);
      telemetry.count('taming:apple');
      if (a.tamed) return g.msg('Your horse crunches the apple happily and nuzzles your shoulder.', 'good');
      // The better you are with animals, the sooner it trusts you: 20% at first, up to 70%.
      const lvl = g.skills.get('taming');
      const chance = 0.2 + 0.5 * Math.min(1, Math.max(0, (lvl - 1) / 99));
      if (Math.random() < chance) {
        a.tamed = true;
        a.hp = a.maxHp;
        telemetry.event('taming', 'Tamed a horse', { apples: telemetry.counters.get('taming:apple'), skill: +lvl.toFixed(2), chance: +chance.toFixed(2) });
        g.msg('The horse lowers its head and nuzzles your hand. It trusts you now: it\'s your horse! Aim at it and choose Ride.', 'good');
      } else {
        g.msg(`The horse takes the apple, but it's still wary of you. Keep trying (about a ${Math.round(chance * 100)}% chance each apple).`, 'info');
      }
    },
  },
  {
    id: 'tame_ox', label: 'Tame',
    show: (c) => c.t.kind === 'animal' && c.t.animal.species === 'ox' && !c.t.animal.tamed,
    // (It stands still while you work with it: see the game's animal update.)
    time: 5, skill: 'taming', difficulty: 12, stamina: 2,
    run: (c) => {
      if (c.t.kind !== 'animal') return;
      const a = c.t.animal, g = c.g;
      if (!g.world.animals.includes(a)) return;
      const lvl = g.skills.get('taming');
      const chance = 0.2 + 0.5 * Math.min(1, Math.max(0, (lvl - 1) / 99));
      telemetry.count('taming:ox');
      if (Math.random() < chance) {
        a.tamed = true; a.state = 'idle'; a.hp = a.maxHp;
        telemetry.event('taming', 'Tamed an ox', { tries: telemetry.counters.get('taming:ox'), skill: +lvl.toFixed(2), chance: +chance.toFixed(2) });
        g.msg('The ox lowers its great head and lets you scratch its brow. It\'s yours now! Aim at it to Lead it, or hitch an ox cart to it.', 'good');
      } else {
        g.msg(`The ox snorts and shakes its head: not yet. Keep at it (about a ${Math.round(chance * 100)}% chance each try).`, 'info');
      }
    },
  },
  {
    id: 'lead_ox', label: (c) => (c.t.kind === 'animal' && c.t.animal.state === 'follow' ? 'Stop leading' : 'Lead'),
    show: (c) => c.t.kind === 'animal' && c.t.animal.species === 'ox' && !!c.t.animal.tamed,
    time: 0.5, fixedTime: true,
    run: (c) => {
      if (c.t.kind !== 'animal') return;
      const a = c.t.animal;
      if (a.state === 'follow') { a.state = 'idle'; c.g.msg('You let go of the rope. The ox stays here.', 'info'); }
      else { for (const o of c.g.world.animals) if (o.state === 'follow') o.state = 'idle'; a.state = 'follow'; c.g.msg('You take the ox by its rope. It follows you.', 'info'); }
    },
  },
  {
    id: 'hitch_cart', label: 'Hitch ox cart',
    show: (c) => c.t.kind === 'animal' && c.t.animal.species === 'ox' && !!c.t.animal.tamed && c.g.inv.count('ox_cart') > 0
      && !c.g.world.carts.some((k) => c.t.kind === 'animal' && k.hitched === c.t.animal.id),
    time: 3,
    run: (c) => {
      if (c.t.kind !== 'animal') return;
      const a = c.t.animal, g = c.g;
      const it = g.inv.ofType('ox_cart')[0];
      if (!it || !g.world.animals.includes(a)) return;
      g.inv.remove(it.uid);
      const cart = g.world.addCart('ox_cart', a.x - Math.sin(a.rot) * 2.5, a.z - Math.cos(a.rot) * 2.5, a.rot, it.ql, it.dmg);
      cart.hitched = a.id;
      g.inventoryChanged();
      telemetry.event('cart', 'Hitched an ox cart');
      g.msg('You back the ox between the shafts and hitch the cart. Lead the ox and the cart rolls along behind; aim at the cart to load it.', 'good');
    },
  },
  {
    id: 'ride_horse', label: 'Ride',
    show: (c) => c.t.kind === 'animal' && c.t.animal.species === 'horse' && !!c.t.animal.tamed && !c.g.riding,
    time: 0.6, fixedTime: true,
    run: (c) => { if (c.t.kind === 'animal' && c.g.world.animals.includes(c.t.animal)) c.g.mount(c.t.animal); },
  },
  {
    id: 'shear_sheep', label: 'Shear',
    show: (c) => c.t.kind === 'animal' && c.t.animal.species === 'sheep' && toolIs(c, 'knife'),
    check: (c) => (c.t.kind === 'animal' && (c.t.animal.wool ?? 1) < 1 ? 'Its fleece hasn\'t grown back yet.' : null),
    time: 8, skill: 'taming', difficulty: 6, stamina: 3, toolWear: 0.05,
    run: (c, o) => {
      if (c.t.kind !== 'animal') return;
      const a = c.t.animal;
      a.wool = 0;
      const n = o.success ? 2 + (Math.random() < 0.5 ? 1 : 0) : 1;
      c.g.give('wool', o.ql, n);
      c.g.msg(`You shear the sheep: ${n} fleece${n > 1 ? 's' : ''} of wool.`, 'good');
    },
  },
  {
    id: 'examine_animal', label: 'Examine', show: (c) => c.t.kind === 'animal', time: 0,
    run: (c) => {
      if (c.t.kind !== 'animal') return;
      const a = c.t.animal;
      const d = ANIMALS[a.species];
      const hp = a.hp / a.maxHp;
      const an = c.t.animal;
      if (an.species === 'ox') {
        c.g.msg(an.tamed ? 'Your ox. Lead it, or hitch an ox cart to it (with the cart in your pack).' : 'A wild ox: big, slow and calm. Right-click it and choose Tame: it stands still while you work, and your Taming skill helps.', 'info');
        return;
      }
      if (an.species === 'horse') {
        c.g.msg(an.tamed ? 'Your horse. Aim at it and choose Ride, or feed it an apple.' : 'A wild horse. Calm enough to walk up to (don\'t sprint around it or hurt it, or it bolts). Hold an apple and feed it: each apple may tame it.', 'info');
        return;
      }
      c.g.msg(`A ${d.name.toLowerCase()}. ${hp > 0.8 ? 'It looks healthy.' : hp > 0.4 ? 'It is wounded.' : 'It is badly hurt.'}${d.aggressive ? ' It looks aggressive.' : ''}`, 'info');
    },
  },
  // ===== looking after yourself
  {
    id: 'apply_bandage', label: 'Apply a bandage', show: () => false,
    check: (c) => {
      if (c.g.inv.count('bandage') === 0) return 'You have no bandages. Craft some from plant fiber (Crafting → Primitive).';
      if (c.g.player.health >= 99) return 'You are not hurt.';
      if (c.g.combat.inCombat()) return 'You can\'t bandage up in the middle of a fight. Get away first.';
      return null;
    },
    time: 4, fixedTime: true,
    run: (c) => {
      const g = c.g;
      g.inv.take('bandage', 1);
      g.inventoryChanged();
      // It heals slowly: 25 health over 40 seconds.
      g.player.effects.bandaged = { t: BANDAGE_TIME, rate: 25 / BANDAGE_TIME };
      g.quests?.note('bandaged');
      g.msg('You apply the bandage. It will heal 25 health over time.', 'good');
    },
  },

  // ===== crafting (targetless; uses a recipe)
  {
    id: 'craft', label: (c) => `Craft ${c.recipe?.name.toLowerCase()}`,
    show: () => false,
    check: (c) => craftProblem(c.g, c.recipe!, c.tool),
    time: (c) => c.recipe!.time,
    minigame: (c) => withGear(c.g, RECIPE_MINIGAMES[c.recipe!.id]),
    qualityCap: (c) => {
      const st = c.recipe!.stations ?? [];
      return st.includes('forge') && !c.g.dev.on('freeCraft') ? smithyCap(c.g.smithy(), st.includes('anvil')) : undefined;
    },
    skill: (c) => c.recipe!.skill,
    difficulty: (c) => c.recipe!.difficulty,
    stamina: 4, toolWear: 0.1,
    run: (c, o) => {
      const r = c.recipe!;
      const g = c.g;
      const used: Item[] = [];
      // Crucibles crack and tongs char a little with every use.
      for (const k of r.needs ?? []) { const t = g.toolFor(k); if (t) g.wear(t, k === 'crucible' ? 5 : 1.2); }
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
      const ql = Math.min(o.ql * 0.7 + matQl * 0.3, matQl + 20, o.cap ?? 100);
      // Tools fresh off the anvil come out glowing, ready to quench.
      const hot = !!r.stations?.includes('anvil') && !!itemDef(r.output.item).tool;
      const made: Item[] = [];
      for (let i = 0; i < r.output.count; i++) {
        const it = makeItem(r.output.item, ql);
        if (hot) it.hot = HOT_TIME;
        g.inv.add(it);
        made.push(it);
      }
      // Arrows go straight into a worn quiver (as many as fit); otherwise they can't be shot.
      if (r.output.item === 'arrow') {
        const q = g.quiver();
        if (q) { const n = g.loadQuiver(q, made); if (n < made.length) g.msg(`Your quiver is full: ${made.length - n} arrow(s) went into your pack.`, 'info'); }
        else g.msg('No quiver on: these arrows go in your pack, and a bow only shoots from a worn quiver. Make one (Crafting → Clothing).', 'info');
      }
      for (const ret of r.returns ?? []) {
        const src = used.find((u) => u.type !== r.output.item);
        for (let i = 0; i < ret.count; i++) g.inv.add(makeItem(ret.item, src?.ql ?? ql));
      }
      g.inventoryChanged();
      const name = itemDef(r.output.item).name.toLowerCase();
      const article = r.output.count > 1 ? `${r.output.count} ` : /^[aeiou]/.test(name) ? 'an ' : 'a ';
      // (Some things don't take an s: kindling, flour, dough...)
      const plural = r.output.count > 1 && !name.endsWith('s') && !/kindling|flour|dough|meat|bread|cordage/.test(name) ? 's' : '';
      g.msg(`You made ${article}${name}${plural} (QL ${ql.toFixed(1)}).`, 'good');
      // (Yours only: villagers craft all day, and would bury the log.)
      if (!(g as { isVillager?: boolean }).isVillager) telemetry.event('craft', `Made ${r.output.count} ${r.output.item}`, { recipe: r.id, ql: +ql.toFixed(1), success: o.success });
      if (hot) g.msg(g.smithy().trough
        ? 'It\'s still glowing hot! Dip it in the quench trough now to harden it.'
        : 'It is still glowing. Quench it in a water trough before it cools to harden it.', 'info');
    },
  },
];

// Skilled builders can do a step the quick way: a plain timed action, a bit lower quality.
{
  const i = ACTIONS.findIndex((a) => a.id === 'continue_build');
  const cb = ACTIONS[i];
  const quickOk = (c: Ctx) => {
    const s = obj(c, 'structure');
    if (!s) return false;
    const d = STRUCTURES[s.type];
    return c.g.canQuick(d.skill, d.difficulty);
  };
  ACTIONS.splice(i + 1, 0, {
    ...cb, id: 'quick_build', quick: true, minigame: undefined,
    label: (c) => `Quick build ${STRUCTURES[obj(c, 'structure')!.type].name.toLowerCase()} (lower quality)`,
    show: (c) => cb.show(c) && quickOk(c),
  });
}

export const ACTION_MAP: Record<string, ActionDef> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));


export function nextMaterial(def: StructureDef, s: StructureObj): string | undefined {
  for (const m of def.materials) if ((s.consumed[m.item] ?? 0) < m.count) return m.item;
  return undefined;
}

// Burn big fuel first and keep the last kindling for lighting.
const FUEL_ORDER = ['log', 'plank', 'refined_plank', 'branch', 'shaft', 'kindling'];
/** Fine furniture within this many metres of a bed counts toward a good night's sleep, up to this much. */
const COMFORT_RANGE = 6;
/** Seconds a bandage takes to heal its 25 health. */
const BANDAGE_TIME = 40;
const MAX_COMFORT = 10;
/** Faster stamina recovery per point of comfort when you wake rested. */
export const COMFORT_REGEN = 0.2;
function fuelItem(c: Ctx): Item | undefined {
  if (c.tool && itemDef(c.tool.type).fuel) return c.tool;
  for (const t of FUEL_ORDER) {
    if (t === 'kindling' && c.g.inv.count(t) < 2) continue;
    const it = c.g.inv.ofType(t).at(-1); // burn the worst first
    if (it) return it;
  }
  return undefined;
}

/** Hand equipment quality to the minigame: bellows blow harder, anvils strike truer. */
function withGear(g: Game, spec: MinigameSpec | undefined): MinigameSpec | undefined {
  if (!spec) return spec;
  const s = g.smithy();
  const blow = s.bellows ? bellowsGrade(s.bellows) : 0;
  if (spec.kind === 'bellows' || spec.kind === 'pour') return { ...spec, gear: blow };
  if (spec.kind === 'chop') {
    const b = g.nearestStation('chopping_block');
    return { ...spec, block: b ? { x: b.x, y: b.y, z: b.z, top: b.y + 0.51 } : undefined };
  }
  if (spec.kind === 'strike' && spec.variant === 'forge') {
    return { ...spec, gear: s.anvil ? anvilGrade(s.anvil) : 0, heat: blow, iron: s.anvil?.type === 'iron_anvil' };
  }
  return spec;
}

/** The glowing forging to quench: the one you picked, else the freshest. */
function hotItem(c: Ctx): Item | undefined {
  if (c.item?.hot && c.g.inv.find(c.item.uid)) return c.item;
  return c.g.inv.items.filter((i) => i.hot).sort((a, b) => b.hot! - a.hot!)[0];
}

export function craftProblem(g: Game, r: Recipe, tool?: Item): string | null {
  if (g.dev.on('freeCraft')) return null;
  // An ox cart is made to fit your ox: you need one first.
  if (r.id === 'ox_cart' && !g.world.animals.some((a) => a.species === 'ox' && a.tamed)) return 'You need a tamed ox first: find a wild ox in the grassland and Tame it.';
  if (r.tool && (!tool || !g.inv.find(tool.uid) || itemDef(tool.type).tool !== r.tool)) return `You need a ${r.tool}.`;
  for (const k of r.needs ?? []) {
    if (!g.toolFor(k)) return `You need a ${TOOL_NAMES[k]} in your pack${k === 'tongs' ? ' to handle the hot metal' : k === 'crucible' ? ' to melt the ore in' : ''}.`;
  }
  for (const inp of r.inputs) {
    if (g.usableCount(inp.item) < inp.count) return `Need ${inp.count} ${itemDef(inp.item).name.toLowerCase()}.`;
  }
  for (const st of r.stations ?? []) {
    if (st === 'forge' && !g.stationNear(st) && g.forgeWithoutBellows()) return 'The forge can\'t get hot enough without bellows. Craft bellows and place them against its side.';
    if (!g.stationNear(st)) return `Must be near ${STATION_NAMES[st]}.`;
  }
  return null;
}

