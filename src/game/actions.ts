import * as THREE from 'three';
import { itemDef, itemName, makeItem, type Item, type ToolKind } from '../data/items';
import { STATION_NAMES, type Recipe } from '../data/recipes';
import { STRUCTURES, totalMaterials, type StructureDef } from '../data/structures';
import type { SkillId } from '../data/skills';
import { TILE, TILE_NAMES, Tile, WATER_LEVEL } from '../world/terrain';
import {
  ANIMALS, CROP_STAGES, type AnimalObj, type BushObj, type PileObj, type StructureObj, type TreeObj, type WorldObj,
} from '../world/world';
import type { Game } from './game';

export type Target =
  | { kind: 'tile'; tx: number; tz: number; cx: number; cz: number; point: THREE.Vector3 }
  | { kind: 'water'; tx: number; tz: number; point: THREE.Vector3 }
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
const isTile = (c: Ctx): c is Ctx & { t: Extract<Target, { kind: 'tile' }> } => c.t.kind === 'tile';
const obj = <K extends WorldObj['kind']>(c: Ctx, kind: K): Extract<WorldObj, { kind: K }> | undefined =>
  c.t.kind === 'object' && c.t.obj.kind === kind ? (c.t.obj as Extract<WorldObj, { kind: K }>) : undefined;
const toolIs = (c: Ctx, kind: ToolKind) => !!c.tool && itemDef(c.tool.type).tool === kind;
const tileType = (c: Ctx) => (isTile(c) ? c.g.world.terrain.tileType(c.t.tx, c.t.tz) : undefined);
const softTile = (t?: Tile) => t !== undefined && t !== Tile.Rock;

function cornerLabel(c: Ctx) {
  if (!isTile(c)) return '';
  const h = c.g.world.terrain.surface[c.g.world.terrain.ci(c.t.cx, c.t.cz)];
  return ` (corner ${h} dm)`;
}

function blockedByStructure(c: Ctx): string | null {
  if (!isTile(c)) return null;
  const w = c.g.world;
  // A corner touches up to four tiles; refuse if any has a structure.
  for (const [tx, tz] of [[c.t.cx, c.t.cz], [c.t.cx - 1, c.t.cz], [c.t.cx, c.t.cz - 1], [c.t.cx - 1, c.t.cz - 1]]) {
    if (!w.terrain.inTiles(tx, tz)) continue;
    for (const o of w.objectsOnTile(tx, tz)) if (o.kind === 'structure') return 'A structure is in the way.';
  }
  return null;
}

function afterTerrainChange(c: Ctx) {
  if (!isTile(c)) return;
  const w = c.g.world;
  // Changing a corner disturbs any crops on the four surrounding tiles.
  for (const [tx, tz] of [[c.t.cx, c.t.cz], [c.t.cx - 1, c.t.cz], [c.t.cx, c.t.cz - 1], [c.t.cx - 1, c.t.cz - 1]]) {
    const k = tz * w.terrain.size + tx;
    if (w.crops.delete(k)) w.listener?.cropsChanged(k);
  }
  c.g.view.refreshNear(c.t.cx * TILE, c.t.cz * TILE, 3);
}

const FORAGE_COOLDOWN = 300;

// ---------- actions
export const ACTIONS: ActionDef[] = [
  // ===== tiles
  {
    id: 'examine_tile', label: 'Examine',
    show: (c) => isTile(c), time: 0,
    run: ({ g, t }) => {
      if (t.kind !== 'tile') return;
      const tr = g.world.terrain;
      const corners = [[t.tx, t.tz], [t.tx + 1, t.tz], [t.tx, t.tz + 1], [t.tx + 1, t.tz + 1]]
        .map(([x, z]) => tr.surface[tr.ci(x, z)]);
      const dirt = tr.dirtDepth(t.cx, t.cz);
      g.msg(`${TILE_NAMES[tr.tileType(t.tx, t.tz)]} tile (${t.tx}, ${t.tz}). Corners: ${corners.join(' / ')} dm. ` +
        `Soil depth at selected corner: ${dirt} dm. Slope: ${tr.tileSlope(t.tx, t.tz)} dm.`, 'info');
      const crop = g.world.crops.get(t.tz * tr.size + t.tx);
      if (crop) {
        const st = g.world.cropStage(crop);
        g.msg(`Wheat, QL ${crop.ql.toFixed(1)}, growth ${st + 1}/${CROP_STAGES}${st === CROP_STAGES - 1 ? ' — ripe!' : ''}, tended ${crop.tended}x.`, 'info');
      }
    },
  },
  {
    id: 'forage', label: 'Forage',
    show: (c) => tileType(c) === Tile.Grass && !c.tool,
    check: ({ g, t }) => {
      if (t.kind !== 'tile') return 'Nothing to forage.';
      const last = g.foraged.get(t.tz * g.world.terrain.size + t.tx);
      return last !== undefined && g.world.time - last < FORAGE_COOLDOWN ? 'This tile has been picked clean recently.' : null;
    },
    time: 6, skill: 'foraging', difficulty: 4, stamina: 2,
    run: ({ g, t }, o) => {
      if (t.kind !== 'tile') return;
      g.foraged.set(t.tz * g.world.terrain.size + t.tx, g.world.time);
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
    show: (c) => tileType(c) === Tile.Rock && !toolIs(c, 'pickaxe'),
    check: ({ g, t }) => {
      if (t.kind !== 'tile') return '';
      const last = g.foraged.get(t.tz * g.world.terrain.size + t.tx);
      return last !== undefined && g.world.time - last < 120 ? 'No loose stones left here. Try another rock tile or use a pickaxe.' : null;
    },
    time: 5, skill: 'mining', difficulty: 2, stamina: 4,
    run: ({ g, t }, o) => {
      if (t.kind !== 'tile') return;
      g.foraged.set(t.tz * g.world.terrain.size + t.tx, g.world.time);
      if (!o.success) return g.msg('The stones here are all stuck fast.', 'fail');
      const n = 1 + (Math.random() < 0.4 ? 1 : 0);
      g.give('rock_shard', o.ql * 0.8, n);
      g.msg(`You pry loose ${n} rock shard${n > 1 ? 's' : ''}.`, 'good');
    },
  },
  {
    id: 'dig', label: (c) => 'Dig' + cornerLabel(c),
    show: (c) => toolIs(c, 'shovel') && isTile(c) && softTile(tileType(c)),
    check: (c) => {
      if (!isTile(c)) return '';
      const tr = c.g.world.terrain;
      if (tr.dirtDepth(c.t.cx, c.t.cz) <= 0) return 'You hit rock. You need a pickaxe to go deeper.';
      if (tr.surface[tr.ci(c.t.cx, c.t.cz)] < -40) return 'The hole keeps filling with water.';
      return blockedByStructure(c);
    },
    time: 5, skill: 'digging', difficulty: 6, stamina: 7, toolWear: 0.12,
    run: (c, o) => {
      if (!isTile(c)) return;
      const tr = c.g.world.terrain;
      const tt = tr.tileType(c.t.tx, c.t.tz);
      const yieldType = tt === Tile.Sand ? 'sand' : tt === Tile.Clay ? 'clay' : 'dirt';
      tr.changeCorner(c.t.cx, c.t.cz, -1);
      if (tt === Tile.Grass || tt === Tile.Field) tr.setTileType(c.t.tx, c.t.tz, Tile.Dirt);
      afterTerrainChange(c);
      c.g.give(yieldType, Math.max(1, o.ql), 1);
      c.g.msg(`You dig up some ${yieldType}.`, o.success ? 'good' : 'info');
    },
  },
  {
    id: 'flatten', label: 'Flatten tile (to selected corner)',
    show: (c) => toolIs(c, 'shovel') && isTile(c) && softTile(tileType(c)),
    check: (c) => {
      if (!isTile(c)) return '';
      if (c.g.world.terrain.tileSlope(c.t.tx, c.t.tz) === 0) return 'The tile is already flat.';
      return null;
    },
    time: 5, skill: 'digging', difficulty: 7, stamina: 7, toolWear: 0.12,
    repeat: (c) => isTile(c) && c.g.world.terrain.tileSlope(c.t.tx, c.t.tz) > 0,
    run: (c, o) => {
      if (!isTile(c)) return;
      const g = c.g, tr = g.world.terrain;
      const target = tr.surface[tr.ci(c.t.cx, c.t.cz)];
      const corners = [[c.t.tx, c.t.tz], [c.t.tx + 1, c.t.tz], [c.t.tx, c.t.tz + 1], [c.t.tx + 1, c.t.tz + 1]];
      corners.sort((a, b) => Math.abs(tr.surface[tr.ci(b[0], b[1])] - target) - Math.abs(tr.surface[tr.ci(a[0], a[1])] - target));
      const [x, z] = corners[0];
      const h = tr.surface[tr.ci(x, z)];
      const sub: Ctx = { ...c, t: { ...c.t, cx: x, cz: z } };
      const block = blockedByStructure(sub);
      if (block) { g.msg(block, 'fail'); g.cancelQueue(); return; }
      if (!o.success) return g.msg('You move some earth around, to no real effect.', 'fail');
      if (h > target) {
        if (tr.dirtDepth(x, z) <= 0) { g.msg('A corner is solid rock. Flattening stops.', 'fail'); g.cancelQueue(); return; }
        tr.changeCorner(x, z, -1);
        g.give('dirt', o.ql, 1);
      } else {
        const dirt = g.inv.take('dirt', 1)[0];
        if (!dirt) { g.msg('You need dirt in your inventory to raise the low corner.', 'fail'); g.cancelQueue(); return; }
        tr.changeCorner(x, z, 1);
      }
      if (tr.tileType(c.t.tx, c.t.tz) === Tile.Grass) tr.setTileType(c.t.tx, c.t.tz, Tile.Dirt);
      afterTerrainChange(sub);
      g.msg(`You level the ground a little. Slope is now ${tr.tileSlope(c.t.tx, c.t.tz)} dm.`, 'info');
    },
  },
  {
    id: 'raise', label: (c) => `Drop ${c.tool ? itemName(c.tool).toLowerCase() : ''} (raise corner)`,
    show: (c) => isTile(c) && !!c.tool && ['dirt', 'sand'].includes(c.tool.type),
    check: (c) => blockedByStructure(c),
    time: 3, skill: 'digging', difficulty: 3, stamina: 4,
    run: (c) => {
      if (!isTile(c) || !c.tool) return;
      const type = c.tool.type;
      c.g.consumeActive();
      const tr = c.g.world.terrain;
      tr.changeCorner(c.t.cx, c.t.cz, 1);
      tr.setTileType(c.t.tx, c.t.tz, type === 'sand' ? Tile.Sand : Tile.Dirt);
      afterTerrainChange(c);
      c.g.msg(`You drop the ${type} and pack it down.`, 'info');
    },
  },
  {
    id: 'mine', label: (c) => 'Mine' + cornerLabel(c),
    show: (c) => toolIs(c, 'pickaxe') && tileType(c) === Tile.Rock,
    check: (c) => {
      if (!isTile(c)) return '';
      const tr = c.g.world.terrain;
      if (tr.dirtDepth(c.t.cx, c.t.cz) > 0) return 'There is soil on that corner. Dig it away first.';
      if (tr.surface[tr.ci(c.t.cx, c.t.cz)] < -30) return 'Water seeps in. You cannot mine deeper here.';
      return blockedByStructure(c);
    },
    time: 9, skill: 'mining', difficulty: (c) => (isTile(c) && c.g.world.terrain.oreAt(c.t.tx, c.t.tz) > 0.4 ? 18 : 8),
    stamina: 12, toolWear: 0.2,
    run: (c, o) => {
      if (!isTile(c)) return;
      const tr = c.g.world.terrain;
      if (!o.success) return c.g.msg('You chip at the rock but nothing breaks off.', 'fail');
      tr.changeCorner(c.t.cx, c.t.cz, -1, -1);
      afterTerrainChange(c);
      const ore = tr.oreAt(c.t.tx, c.t.tz);
      if (ore > 0.4 && Math.random() < 0.75) {
        c.g.give('iron_ore', o.ql * (0.6 + ore * 0.6), 1);
        c.g.msg('You mine some iron ore!', 'good');
      } else {
        const n = 1 + (Math.random() < 0.5 ? 1 : 0);
        c.g.give('rock_shard', o.ql, n);
        c.g.msg(`You mine ${n} rock shard${n > 1 ? 's' : ''}.${ore > 0.25 ? ' You notice rusty streaks in the rock nearby.' : ''}`, 'good');
      }
    },
  },
  {
    id: 'cultivate', label: 'Cultivate',
    show: (c) => toolIs(c, 'shovel') && (tileType(c) === Tile.Grass || tileType(c) === Tile.Dirt),
    check: (c) => {
      if (!isTile(c)) return '';
      const w = c.g.world;
      if (w.terrain.tileSlope(c.t.tx, c.t.tz) > 10) return 'The ground is too steep to farm.';
      if (w.objectsOnTile(c.t.tx, c.t.tz).some((o) => o.kind !== 'pile')) return 'Something is in the way.';
      if (w.terrain.heightAt((c.t.tx + 0.5) * TILE, (c.t.tz + 0.5) * TILE) < WATER_LEVEL + 0.1) return 'Too wet to farm.';
      return null;
    },
    time: 8, skill: 'farming', difficulty: 5, stamina: 8, toolWear: 0.1,
    run: (c, o) => {
      if (!isTile(c)) return;
      if (!o.success) return c.g.msg('The roots are too tough here. You fail to break the soil.', 'fail');
      c.g.world.terrain.setTileType(c.t.tx, c.t.tz, Tile.Field);
      c.g.msg('You cultivate the soil into a field.', 'good');
    },
  },
  {
    id: 'sow', label: 'Sow wheat',
    show: (c) => tileType(c) === Tile.Field && c.tool?.type === 'wheat_seeds',
    check: (c) => (isTile(c) && c.g.world.crops.has(c.t.tz * c.g.world.terrain.size + c.t.tx) ? 'Something is already growing here.' : null),
    time: 4, skill: 'farming', difficulty: 6, stamina: 3,
    run: (c, o) => {
      if (!isTile(c) || !c.tool) return;
      const seedQl = c.tool.ql;
      c.g.consumeActive();
      if (!o.success) return c.g.msg('You scatter the seeds badly; the birds get them.', 'fail');
      const k = c.t.tz * c.g.world.terrain.size + c.t.tx;
      c.g.world.crops.set(k, { planted: c.g.world.time, ql: (o.ql + seedQl) / 2, tended: 0 });
      c.g.world.listener?.cropsChanged(k);
      c.g.msg('You sow the field with wheat.', 'good');
    },
  },
  {
    id: 'tend', label: 'Tend field',
    show: (c) => toolIs(c, 'shovel') && tileType(c) === Tile.Field && isTile(c) && c.g.world.crops.has(c.t.tz * c.g.world.terrain.size + c.t.tx),
    check: (c) => {
      if (!isTile(c)) return '';
      const crop = c.g.world.crops.get(c.t.tz * c.g.world.terrain.size + c.t.tx)!;
      if (crop.tended >= 3) return 'The field is already well tended.';
      if (c.g.world.cropStage(crop) >= CROP_STAGES - 1) return 'The crop is ready to harvest.';
      return null;
    },
    time: 5, skill: 'farming', difficulty: 10, stamina: 5, toolWear: 0.05,
    run: (c, o) => {
      if (!isTile(c)) return;
      const crop = c.g.world.crops.get(c.t.tz * c.g.world.terrain.size + c.t.tx);
      if (!crop) return;
      if (!o.success) return c.g.msg('You pull up a few sprouts by mistake.', 'fail');
      crop.tended++;
      crop.ql = Math.min(100, crop.ql + 2 + c.g.skills.get('farming') * 0.05);
      c.g.msg('You weed and tend the field. It will grow faster and better.', 'good');
    },
  },
  {
    id: 'harvest', label: 'Harvest',
    show: (c) => tileType(c) === Tile.Field && isTile(c) && !!c.g.world.crops.get(c.t.tz * c.g.world.terrain.size + c.t.tx) &&
      (!c.tool || toolIs(c, 'scythe')),
    check: (c) => {
      if (!isTile(c)) return '';
      const crop = c.g.world.crops.get(c.t.tz * c.g.world.terrain.size + c.t.tx)!;
      return c.g.world.cropStage(crop) < CROP_STAGES - 1 ? 'The wheat is not ripe yet.' : null;
    },
    time: (c) => (toolIs(c, 'scythe') ? 4 : 7), skill: 'farming', difficulty: 8, stamina: 6, toolWear: 0.1,
    run: (c, o) => {
      if (!isTile(c)) return;
      const k = c.t.tz * c.g.world.terrain.size + c.t.tx;
      const crop = c.g.world.crops.get(k)!;
      c.g.world.crops.delete(k);
      c.g.world.listener?.cropsChanged(k);
      const scythe = toolIs(c, 'scythe');
      const n = Math.max(1, Math.round((scythe ? 3 : 1.5) + crop.tended * 0.6 + Math.random() * 2 - (o.success ? 0 : 1.5)));
      const ql = (crop.ql + o.ql) / 2;
      c.g.give('wheat', ql, n);
      const seeds = 1 + (Math.random() < 0.5 ? 1 : 0);
      c.g.give('wheat_seeds', ql, seeds);
      c.g.msg(`You harvest ${n} wheat and save ${seeds} seed${seeds > 1 ? 's' : ''}.`, 'good');
    },
  },
  {
    id: 'plant_sprout', label: 'Plant sprout',
    show: (c) => c.tool?.type === 'sprout' && (tileType(c) === Tile.Grass || tileType(c) === Tile.Dirt),
    check: (c) => {
      if (!isTile(c)) return '';
      if (c.g.world.objectsOnTile(c.t.tx, c.t.tz).some((o) => o.kind !== 'pile')) return 'There is no room to plant here.';
      return null;
    },
    time: 4, skill: 'foraging', difficulty: 6, stamina: 3,
    run: (c, o) => {
      if (!isTile(c) || !c.tool) return;
      const label = c.tool.label ?? '';
      c.g.consumeActive();
      if (!o.success) return c.g.msg('The sprout wilts as you plant it.', 'fail');
      const species = label.includes('pine') ? 'pine' : label.includes('birch') ? 'birch' : 'oak';
      c.g.world.add<TreeObj>({ kind: 'tree', species, x: (c.t.tx + 0.5) * TILE, z: (c.t.tz + 0.5) * TILE, age: 0.03, branches: 0 });
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
      c.g.dropToGround(items, t.x, t.z);
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
      if (items.length) c.g.dropToGround(items, s.x, s.z);
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
      if (items.length) c.g.dropToGround(items, s.x, s.z);
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
    id: 'toggle_gate', label: (c) => (obj(c, 'structure')!.open ? 'Close gate' : 'Open gate'),
    show: (c) => { const s = obj(c, 'structure'); return !!s && s.built && !!STRUCTURES[s.type].gate; },
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
  if (r.tool && (!tool || !g.inv.find(tool.uid) || itemDef(tool.type).tool !== r.tool)) return `You need a ${r.tool}.`;
  for (const inp of r.inputs) {
    if (g.inv.count(inp.item) < inp.count) return `Need ${inp.count} ${itemDef(inp.item).name.toLowerCase()}.`;
  }
  for (const st of r.stations ?? []) {
    if (!g.stationNear(st)) return `Must be near ${STATION_NAMES[st]}.`;
  }
  return null;
}

