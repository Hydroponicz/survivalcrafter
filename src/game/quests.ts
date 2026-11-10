import { telemetry } from './telemetry';
import * as THREE from 'three';
import { isIdentified, itemDef } from '../data/items';
import { FORAGE_SPECIES } from '../data/forage';
import type { ToolKind } from '../data/items';
import type { StructureObj } from '../world/world';
import type { Game } from './game';

// Quests: guided goals, each a list of steps that finish on their own as you
// do them. You can be on several at once; the quest log (L) lists them, and
// you choose which are tracked: those show in the panel on screen, and the
// first of them has the things it needs picked out in the world (a glow on
// the nearest few and an arrow over the closest, or at the edge of the screen
// pointing the way when it's out of sight). Some quests are yours from the
// start (the first house); others are offered when the time comes (a light
// for the first night), and wait in the log until you take them up.

/** Where something to point at is, and how high above its base to point. */
interface Target { x: number; y: number; z: number; id: number }

interface Step {
  id: string;
  title: string;
  /** What to do and how (HTML). */
  text: string;
  /** Progress toward it ([have, need]), or done/not done. */
  progress: (g: Game, q: QuestState) => [number, number] | boolean;
  /** Things in the world to point at. */
  targets?: (g: Game, q: QuestState) => Target[];
  /** Where to go when there's nothing of the kind near by. */
  far?: string;
  /**
   * Taught when this step is done (once): the game stops and shows a picture
   * of the idea and how it works, before you go on. The tutorial teaches the
   * game's ideas this way, at the moment they matter.
   */
  lesson?: { title: string; image?: string; text: string; button?: string };
}

export interface QuestDef {
  id: string;
  title: string;
  /** What it's about, in a line (for the quest log). */
  summary: string;
  steps: Step[];
  /** When it's done: a heading, what to know now (HTML), and a line for the message log. */
  outro: { title: string; text: string; msg: string };
  /** Offered when this becomes true (checked now and then); without it, the quest is yours from the start. */
  offer?: (g: Game) => boolean;
  /** Part of the tutorial: turned off with it. */
  tutorial?: boolean;
}

export interface QuestState {
  id: string;
  status: 'offered' | 'active' | 'done';
  step: number;
  /** Shown in the panel on screen. */
  tracked: boolean;
  /** The first floor you built: the house is built around it. */
  anchor: { x: number; z: number } | null;
  /** Where you were when the quest began. */
  start: { x: number; z: number };
  /** Things you've done that a step waits for (e.g. 'felled': a tree you cut has come down). */
  flags?: string[];
  /** The current step's id (saved with the number, so steps can be added later without shifting saves). */
  stepId?: string;
}

export interface QuestSave { quests: QuestState[]; off: boolean }
/** Saves from before there were several quests: the tutorial alone. */
export interface OldOnboardingSave { step: number; done: boolean; anchor: { x: number; z: number } | null; start: { x: number; z: number } }

/** How far to look for things to point at (widened when nothing is close). */
let SEARCH = 70;
/** Built pieces within this distance of your first floor count as part of the house. */
const HOUSE_R = 6;

const has = (g: Game, type: string, n: number): [number, number] => [Math.min(n, g.inv.count(type)), n];
const hasTool = (g: Game, kind: ToolKind) => g.inv.items.some((i) => itemDef(i.type).tool === kind);
/** Plain walls (the windowed wall and the door have steps of their own). */
const WALLS = ['log_wall', 'wood_wall', 'stone_wall'];
const builtNear = (g: Game, q: QuestState, types: string[], r = HOUSE_R) => {
  const a = q.anchor;
  if (!a) return 0;
  let n = 0;
  for (const o of g.world.objects.values()) {
    if (o.kind === 'structure' && o.built && types.includes(o.type) && Math.hypot(o.x - a.x, o.z - a.z) <= r) n++;
  }
  return n;
};

/** Finds lying on the ground of these kinds, nearest first. */
function forage(g: Game, species: string[]): Target[] {
  const p = g.player.pos, out: Target[] = [];
  for (const o of g.world.near(p.x, p.z, SEARCH)) {
    if (o.kind !== 'forage' || !species.includes(o.species) || !g.canSee(o)) continue;
    out.push({ x: o.x, y: o.y + 0.25, z: o.z, id: o.id });
  }
  return out;
}

function trees(g: Game, needBranches = false): Target[] {
  const p = g.player.pos, out: Target[] = [];
  for (const o of g.world.near(p.x, p.z, SEARCH)) {
    if (o.kind !== 'tree' || o.age < 0.45 || (needBranches && o.branches <= 0)) continue;
    out.push({ x: o.x, y: g.world.terrain.heightAt(o.x, o.z) + 2.2, z: o.z, id: o.id });
  }
  return out;
}

/** Piles with logs in them (where felled trees lie). */
function logPiles(g: Game): Target[] {
  const p = g.player.pos, out: Target[] = [];
  for (const o of g.world.near(p.x, p.z, SEARCH)) {
    if (o.kind === 'pile' && o.items.some((i) => i.type === 'log')) out.push({ x: o.x, y: o.y + 0.6, z: o.z, id: o.id });
  }
  return out;
}

/** Chopping blocks you've built round about. */
function blocks(g: Game): Target[] {
  const p = g.player.pos, out: Target[] = [];
  for (const o of g.world.near(p.x, p.z, SEARCH)) {
    if (o.kind === 'structure' && o.built && o.type === 'chopping_block') out.push({ x: o.x, y: o.y + 0.8, z: o.z, id: o.id });
  }
  return out;
}

/** Plans of these pieces still to build (to point at the work). */
function plans(g: Game, types: string[]): Target[] {
  const out: Target[] = [];
  for (const o of g.world.objects.values()) {
    if (o.kind === 'structure' && !o.built && types.includes(o.type)) out.push({ x: o.x, y: o.y + 1.2, z: o.z, id: o.id });
  }
  return out;
}

/** Game to hunt, or a carcass to butcher. */
function game(g: Game): Target[] {
  const p = g.player.pos, out: Target[] = [];
  for (const o of g.world.near(p.x, p.z, SEARCH)) {
    if (o.kind === 'pile' && o.items.some((i) => i.type === 'corpse')) out.push({ x: o.x, y: o.y + 0.6, z: o.z, id: o.id });
  }
  if (out.length) return out;
  for (const a of g.world.animals) {
    if (a.hp > 0 && Math.hypot(a.x - p.x, a.z - p.z) < SEARCH * 2) out.push({ x: a.x, y: g.world.terrain.heightAt(a.x, a.z) + 1.9, z: a.z, id: a.id });
  }
  return out;
}

const KEY = (k: string) => `<kbd>${k}</kbd>`;

const HOME_STEPS: Step[] = [
  { id: 'move', title: 'Get your bearings',
    text: `Move with ${KEY('W')}${KEY('A')}${KEY('S')}${KEY('D')} and look around with the mouse. Hold ${KEY('Shift')} to run and press ${KEY('Space')} to jump. Press ${KEY('H')} any time to open the guide.`,
    progress: (g, q) => Math.hypot(g.player.pos.x - q.start.x, g.player.pos.z - q.start.z) > 6 },
  { id: 'fiber', title: 'Gather plant fiber',
    text: `Fiber grass grows in open meadows. Aim at a tuft and ${KEY('Left click')} to pick it (the arrow points to the nearest one). You'll twist it into cordage to tie your tools together.`,
    progress: (g) => has(g, 'plant_fiber', 6),
    targets: (g) => forage(g, ['fiber_grass', 'reeds']),
    far: 'None nearby. Head for open grassland or a lake shore (reeds give fiber too).' },
  { id: 'branch', title: 'Collect branches',
    text: `Pick up fallen branches from the forest floor, or aim at a tree with empty hands and choose ${KEY('Right click')} → <b>Collect branch</b>. Branches become your tool handles.`,
    progress: (g) => has(g, 'branch', 3),
    targets: (g) => { const f = forage(g, ['fallen_branch', 'driftwood']); return f.length ? f : trees(g, true); },
    far: 'None nearby. Head into the woods.' },
  { id: 'stones', title: 'Find small rocks',
    text: 'Small rocks lie around on shores and near bare rock. Pick up three: two for a stone knife and one for your hatchet head.',
    // (Rocks already made into tools count.)
    progress: (g) => [Math.min(3, g.inv.count('rock_shard') + (hasTool(g, 'knife') ? 2 : 0) + (hasTool(g, 'hatchet') ? 1 : 0)), 3],
    targets: (g) => forage(g, ['pebbles']),
    far: 'None nearby. Try a shoreline or the bottom of a rocky slope.' },
  { id: 'knife', title: 'Craft a stone knife',
    text: `Time for your first tool. Press ${KEY('C')} to open crafting and make a <b>Stone knife</b> (under <b>Primitive</b>) from two small rocks. You'll chip flakes off the stone until it's shaped like a blade. The knife is used for kindling, handles, butchering and lots more.`,
    progress: (g) => hasTool(g, 'knife') },
  { id: 'cordage', title: 'Make cordage',
    text: `Press ${KEY('C')} and craft <b>Cordage</b> (under <b>Primitive</b>) from 3 plant fiber. You'll use it to tie the stone head onto your hatchet.`,
    progress: (g) => g.inv.count('cordage') > 0 || hasTool(g, 'hatchet') },
  { id: 'hatchet', title: 'Craft a stone hatchet',
    text: `Craft a <b>Stone hatchet</b> (${KEY('C')} → Primitive) from a branch, a small rock and cordage. It chops down trees and splits logs.`,
    progress: (g) => hasTool(g, 'hatchet') },
  { id: 'fell', title: 'Fell a tree',
    text: `Equip the hatchet from your hotbar (${KEY('1')}-${KEY('9')} or the mouse wheel), aim at a full-grown tree and ${KEY('Left click')} to chop until it falls. The logs drop in a pile on the ground.`,
    // Done once your first tree is down and its logs are lying in a pile.
    progress: (g, q) => !!q.flags?.includes('felled') || g.inv.count('log') > 0 || g.inv.count('plank') > 0,
    targets: (g) => trees(g),
    far: 'No full-grown trees nearby. Head for the woods.',
    lesson: {
      title: 'Time to make camp',
      image: 'images/tutorial/camp.jpg',
      text: `<p>Your first tree is down. Before you go further, it's a good idea to <b>set up a basic camp</b> near here: a <b>campfire</b> and a <b>chopping block</b> to start with, somewhere to come back to while you build your home.</p>
        <p>Many things you build are <b>stations</b>, and standing near one opens up new <b>crafting recipes</b>. At a <b>chopping block</b> you split logs into planks and kindling. At a <b>lit campfire</b> you cook food and fire clay pots. Later a <b>workbench</b> lets you make furniture, and a <b>forge</b> lets you work iron.</p>
        <p>Other pieces bring <b>benefits</b> of their own. A fire gives light and warmth through the night. A tent or lean-to is a bed far from home. Fine furniture round your bed lets you wake <b>well rested</b>. More decorations will bring benefits as the game grows. Look at a piece's description in the Build menu (${KEY('B')}) to see what it does.</p>
        <p>Everything in this picture you can make yourself: the campfire, the chopping block, a lean-to, a hide tent, a woodpile, a drying rack and a couple of torches.</p>`,
      button: 'Let\'s make camp',
    } },
  { id: 'block', title: 'Set up a chopping block',
    text: `Grab the logs from the pile (aim at it, ${KEY('Right click')} → <b>Take all</b>). Logs are split on a <b>chopping block</b>: press ${KEY('B')}, choose <b>Chopping block</b> (Camp essentials, where the build menu opens) and place it on open ground. Then, with your hatchet equipped, aim at it and ${KEY('Left click')} to build it. It costs one log.`,
    progress: (g) => g.inv.count('plank') >= 5 || [...g.world.near(g.player.pos.x, g.player.pos.z, 40)].some((o) => o.kind === 'structure' && o.type === 'chopping_block' && o.built),
    targets: (g) => { const p = plans(g, ['chopping_block']); return p.length || g.inv.count('log') > 0 ? p : logPiles(g); } },
  { id: 'planks', title: 'Split rough planks',
    text: `Stand by your chopping block with the hatchet equipped, press ${KEY('C')} and choose <b>Split log into rough planks</b> (Woodworking). Each log gives 2 planks. You need 1 for your fire making kit, 1 for your hammer and 4 for the first floor. (Later, an iron saw makes <b>refined planks</b> for fine furniture.)`,
    // (Planks already made into the kit and the hammer count.)
    progress: (g) => [Math.min(6, g.inv.count('plank') + (g.inv.count('wooden_hammer') > 0 ? 1 : 0) + (g.inv.count('fire_kit') > 0 ? 1 : 0)), 6],
    // The logs still lying about until you've picked them up; then your chopping block.
    targets: (g) => (g.inv.count('log') > 0 ? blocks(g) : logPiles(g)) },
  { id: 'firekit', title: 'Make a fire making kit',
    text: `Fire is made with a bow drill. Press ${KEY('C')} and craft a <b>Fire making kit</b> (Primitive) from <b>3 cordage</b>, a <b>rough plank</b> (the fireboard) and a <b>shaft</b> (the spindle): you string the bow and bind it all together. Keep it in your pack: you need it to light any fire or torch.`,
    progress: (g) => g.inv.count('fire_kit') > 0 },
  { id: 'campfire', title: 'Build a campfire',
    text: `Every camp needs a fire. Press ${KEY('B')}, choose <b>Campfire</b> (Camp essentials) and place it near your chopping block, then build it from 4 small rocks and 3 branches. To light it, aim at it, add fuel (branches, kindling or logs) and choose <b>Light fire</b>: you kneel and work the bow drill from your kit, there on the ground beside it. A lit fire is a <b>station</b>: stand by it to cook (${KEY('C')} → Cooking).`,
    progress: (g) => [...g.world.near(g.player.pos.x, g.player.pos.z, 60)].some((o) => o.kind === 'structure' && o.type === 'campfire' && o.built),
    targets: (g) => { const p = plans(g, ['campfire']); return p.length ? p : forage(g, ['pebbles', 'fallen_branch']); },
    far: 'Gather small rocks and branches for it.' },
  { id: 'hammer', title: 'Make a wooden hammer',
    text: `You need a hammer to build. First carve a <b>Shaft</b> from a branch with your knife (Woodworking), then craft a <b>Wooden hammer</b> (Primitive) from the shaft and a rough plank.`,
    progress: (g) => hasTool(g, 'hammer') },
  { id: 'floor', title: 'Lay the floor',
    text: `Press ${KEY('B')} and choose <b>Wooden floor</b>. Find flat ground and ${KEY('Left click')} to place the plan. Then equip your hammer, aim at the plan and ${KEY('Left click')} to build it, one plank at a time. Your house is 4 floor pieces in a square: aim at the edge of a finished floor and the next one snaps into place. Each floor piece takes 4 planks.`,
    progress: (g, q) => [Math.min(4, builtNear(g, q, ['floor'], 4)), 4],
    targets: (g) => plans(g, ['floor']) },
  { id: 'walls', title: 'Raise the walls',
    text: `Choose a wall in the build menu (${KEY('B')}) and aim at the edge of the floor: it snaps into place. Each side takes 2 walls, 8 in total. Build 6 now and leave 2 gaps: one for a window and one for the door. <b>Log walls</b> are the cheapest: 4 logs each, built with your hatchet.`,
    progress: (g, q) => [Math.min(6, builtNear(g, q, WALLS)), 6],
    targets: (g) => plans(g, WALLS) },
  { id: 'window', title: 'Put in a window',
    text: `Fill one gap with a <b>Windowed wall</b> (${KEY('B')} → Walls). It costs 4 planks and 3 shafts (carve shafts from branches with your knife: <b>Woodworking → Shaft</b>).`,
    progress: (g, q) => builtNear(g, q, ['window_wall']) > 0,
    targets: (g) => plans(g, ['window_wall']) },
  { id: 'door', title: 'Add a door',
    text: `Put a <b>Wooden door</b> in the last gap. It costs planks, shafts and cordage.`,
    progress: (g, q) => builtNear(g, q, ['door']) > 0,
    targets: (g) => plans(g, ['door']) },
  { id: 'roof', title: 'Put a roof on',
    text: `Choose <b>Thatch roof</b> (${KEY('B')} → Roofs & stairs) and aim at the top of a wall: it snaps on. You need 4 pieces, 2 on each long side, sloping up to meet in the middle. Each costs 3 planks and 8 plant fiber.`,
    progress: (g, q) => [Math.min(4, builtNear(g, q, ['roof'])), 4],
    targets: (g) => plans(g, ['roof']) },
  { id: 'gables', title: 'Close up the roof',
    text: `The two ends of the roof are still open. Fill them with <b>Gables</b> (${KEY('B')} → Roofs & stairs): 2 at each end, on top of the end walls, facing each other. Rotate a piece with ${KEY('Q')} / ${KEY('E')} or the mouse wheel. Each costs 2 planks.`,
    progress: (g, q) => [Math.min(4, builtNear(g, q, ['gable'])), 4],
    targets: (g) => plans(g, ['gable']) },
  { id: 'hides', title: 'Hunt for hides',
    text: `A bed needs 2 hides. Craft a <b>Stone spear</b> (or a bow and arrows) and hunt deer, or boars if you're brave (they fight back). ${KEY('Left click')} to attack. When a boar lowers its head, it's about to charge: dodge to the side. Then equip your knife and <b>Butcher</b> the body.`,
    progress: (g) => has(g, 'hide', 2),
    targets: (g) => game(g),
    far: 'No animals nearby. Deer graze in meadows and along the edges of woods: explore a bit.' },
  { id: 'bed', title: 'Build a bed',
    text: `Place a <b>Bed</b> (${KEY('B')} → Furniture) inside your house and build it with your hammer. Sleep in it to set your respawn point.`,
    progress: (g, q) => builtNear(g, q, ['bed']) > 0,
    targets: (g) => plans(g, ['bed']) },
  { id: 'chest', title: 'Build a storage chest',
    text: `Finally, build a <b>Storage chest</b> (${KEY('B')} → Furniture) for 8 planks. It holds 300 kg, so you can store your stuff safely at home.`,
    progress: (g, q) => builtNear(g, q, ['chest']) > 0,
    targets: (g) => plans(g, ['chest']) },
];

/** Mushrooms (by the item they give). */
const MUSHROOMS = FORAGE_SPECIES.filter((s) => s.category === 'mushroom');
const MUSHROOM_ITEMS = [...new Set(MUSHROOMS.map((s) => s.item))];

/** The nearest open water: a few spots on lakes, rivers and streams around you. */
function water(g: Game): Target[] {
  const p = g.player.pos, t = g.world.terrain, out: Target[] = [];
  for (let r = 6; r <= 180 && out.length < 3; r += 6) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const w = t.waterAt(x, z);
      if (Number.isFinite(w) && w > t.heightAt(x, z) + 0.15) out.push({ x, y: w + 0.4, z, id: -1 - out.length });
      if (out.length >= 3) break;
    }
  }
  return out;
}

/** Boars about, to hunt. */
function boars(g: Game): Target[] {
  const p = g.player.pos;
  return g.world.animals.filter((a) => a.species === 'boar' && a.hp > 0 && Math.hypot(a.x - p.x, a.z - p.z) < SEARCH * 2)
    .map((a) => ({ x: a.x, y: g.world.terrain.heightAt(a.x, a.z) + 1.4, z: a.z, id: a.id }));
}

/** Boar carcasses to butcher. */
function carcasses(g: Game): Target[] {
  const p = g.player.pos, out: Target[] = [];
  for (const o of g.world.near(p.x, p.z, SEARCH)) {
    if (o.kind === 'pile' && o.items.some((i) => i.type === 'corpse')) out.push({ x: o.x, y: o.y + 0.6, z: o.z, id: o.id });
  }
  return out;
}

const flagged = (q: QuestState, f: string) => !!q.flags?.includes(f);

const WATER_STEPS: Step[] = [
  { id: 'drink', title: 'Find water and drink',
    text: `You're thirsty, and thirst drains faster than hunger. Find fresh water (a river, stream or lake; the arrow points to the nearest), aim at it and ${KEY('Left click')} to <b>Drink</b>.`,
    progress: (_g, q) => flagged(q, 'drank'),
    targets: (g) => water(g),
    far: 'No water nearby. Head downhill: streams run along the valleys.' },
  { id: 'full', title: 'Drink your fill',
    text: `Keep drinking until your water bar (blue) is full. You'll keep drinking as long as you stand still.`,
    progress: (g) => [Math.min(85, Math.round(g.player.water)), 85],
    targets: (g) => water(g) },
];

const FOOD_STEPS: Step[] = [
  { id: 'mushroom', title: 'Pick a mushroom',
    text: `You're getting hungry. Mushrooms grow on the forest floor and in damp ground: pick one or two. There are many kinds, and at first you won't know which are safe.`,
    progress: (_g, q) => flagged(q, 'picked_mushroom'),
    targets: (g) => forage(g, MUSHROOMS.map((s) => s.id)),
    far: 'None nearby. Look in the woods, especially damp areas.' },
  { id: 'journal', title: 'Open your field journal',
    text: `Press ${KEY('J')} to open your <b>field journal</b>. It records every wild plant and mushroom you find: what it looks like, where it grows and, once you know, what it is. Some are good to eat; some are <b>poisonous</b>.`,
    progress: (_g, q) => flagged(q, 'journal') },
  { id: 'identify', title: 'Identify a mushroom',
    text: `Eating an unknown mushroom is risky. Find out what it is first: <b>Study</b> it from your pack, or keep picking that kind until you recognise it. Your Foraging and Herbalism skills help. The journal shows what you've learned.`,
    progress: () => MUSHROOM_ITEMS.some((t) => isIdentified(t)) },
  { id: 'eat', title: 'Eat something safe',
    text: `Eat something you know is safe: berries, or a mushroom you've identified as edible (open your pack and choose <b>Eat</b>). Cooking mushrooms and meat on a campfire makes them much more filling.`,
    progress: (_g, q) => flagged(q, 'ate') },
  { id: 'spear', title: 'Make a stone spear',
    text: `For a proper meal, you'll need to hunt. Craft a <b>Stone spear</b> (${KEY('C')} → Primitive) from 2 branches, a small rock and cordage. (A <b>bow</b> and <b>arrows</b> work too, if you've found flint and feathers.)`,
    progress: (g) => g.inv.items.some((i) => itemDef(i.type).tool === 'weapon' || itemDef(i.type).tool === 'bow') },
  { id: 'boar', title: 'Hunt a boar',
    text: `Boars roam the edges of the woods, and they fight back. Equip your spear and ${KEY('Left click')} to attack. When a boar <b>lowers its head and shakes</b>, it's about to charge: dodge back or to the side, then strike again. If you get hurt, back off before bandaging.`,
    progress: (_g, q) => flagged(q, 'killed_boar'),
    targets: (g) => boars(g),
    far: 'No boars nearby. They roam the edges of the woods: explore a bit.' },
  { id: 'butcher', title: 'Butcher the boar',
    text: `Equip your knife, aim at the body and choose <b>Butcher corpse</b> to get meat (and a hide, if you're careful). Cook the meat on a campfire before eating it.`,
    progress: (_g, q) => flagged(q, 'butchered'),
    targets: (g) => carcasses(g) },
];

const BANDAGE_STEPS: Step[] = [
  { id: 'fiber', title: 'Gather plant fiber',
    text: `A bandage takes 4 plant fiber. Pick fiber grass in meadows, or reeds by the water.`,
    progress: (g) => [Math.min(4, g.inv.count('plant_fiber') + g.inv.count('bandage') * 4), 4],
    targets: (g) => forage(g, ['fiber_grass', 'reeds']) },
  { id: 'make', title: 'Craft a bandage',
    text: `Craft a <b>Bandage</b> (${KEY('C')} → Primitive). It goes on your hotbar.`,
    progress: (g, q) => g.inv.count('bandage') > 0 || flagged(q, 'bandaged') },
  { id: 'apply', title: 'Apply the bandage',
    text: `Once you're safe from danger, <b>Apply</b> the bandage from your pack or hotbar. Stand still for a few seconds while you wrap it. It heals 25 health over time.`,
    progress: (_g, q) => flagged(q, 'bandaged') },
];

/** Dusk: the sun low and going down (the first evening you see, in practice your first day). */
const dusk = (g: Game) => {
  const f = g.world.dayFraction;
  return f > 0.69 && f < 0.85;
};

const LIGHT_STEPS: Step[] = [
  { id: 'materials', title: 'Gather torch materials',
    text: `A torch is a branch wrapped in plant fiber and packed with kindling. Gather <b>4 branches</b> (3 become kindling) and <b>2 plant fiber</b>.`,
    progress: (g) => {
      const torches = g.inv.count('torch'), kindling = Math.min(1, g.inv.count('kindling'));
      return [Math.min(6, Math.min(4, g.inv.count('branch') + kindling * 3 + torches * 4) + Math.min(2, g.inv.count('plant_fiber') + torches * 2)), 6];
    },
    targets: (g) => { const f = forage(g, ['fiber_grass', 'reeds', 'fallen_branch']); return f.length ? f : trees(g, true); },
    far: 'Fiber grass grows in open meadows, and branches lie in the woods.' },
  { id: 'kindling', title: 'Make kindling',
    text: `Craft <b>Kindling (from branches)</b> (${KEY('C')} → Primitive) from 3 branches with your knife. No knife yet? Make a <b>Stone knife</b> from two small rocks first. Keep one branch for the torch itself.`,
    progress: (g) => g.inv.count('kindling') > 0 || g.inv.count('torch') > 0 },
  { id: 'torch', title: 'Make a torch',
    text: `Craft a <b>Torch</b> (${KEY('C')} → Primitive) from a branch, 2 plant fiber and a kindling. You light it with the bow drill from your <b>fire making kit</b> (no kit yet? craft one from 3 cordage, a rough plank and a shaft): kneel and keep the bow moving until the flame catches.`,
    progress: (g) => g.inv.count('torch') > 0 },
  { id: 'hold', title: 'Light your way',
    text: `Equip the torch from your hotbar to light up your surroundings. You can also plant it: aim at soft ground (grass, dirt, sand or clay, not rock) and ${KEY('Left click')}. Pick it back up any time. A torch burns for about 3 days; relight a burnt-out one with a kindling and a branch.`,
    progress: (g) => g.activeItem()?.type === 'torch' },
];

export const QUESTS: QuestDef[] = [
  { id: 'home', title: 'A roof over your head', tutorial: true,
    summary: 'Start with nothing and build your first home, with a bed and a storage chest.',
    steps: HOME_STEPS,
    outro: { title: 'Welcome home',
      text: `You've built a house with a bed and a storage chest. What's next? Cook on a campfire, farm wheat, dig clay or set up a smithy. Press ${KEY('H')} for the full guide.`,
      msg: 'Quest complete: you have a home! The wilderness is yours to explore.' } },
  { id: 'light', title: 'Light in the dark', tutorial: true,
    summary: 'Night is falling. Craft a torch to light up the darkness.',
    offer: dusk,
    steps: LIGHT_STEPS,
    outro: { title: 'Light in the night',
      text: `Torches are handy, but they burn out. For a steadier light, build a <b>campfire</b> (${KEY('B')}), add fuel and light it with a bow drill: it lights up your camp, cooks food and keeps you warm. A lit <b>forge</b> glows too. Keep fires fed with branches, kindling or logs.`,
      msg: 'Quest complete: you have a torch! Campfires and forges also light the night, as long as you keep them fueled.' } },
  { id: 'water', title: 'Something to drink', tutorial: true,
    summary: 'You\'re getting thirsty. Find fresh water and drink.',
    offer: (g) => g.player.water < 50,
    steps: WATER_STEPS,
    outro: { title: 'Water',
      text: `Thirst drains faster than hunger, and when your water runs out you start losing health. Drink from rivers, streams and lakes. To carry water, make <b>clay jars</b>: dig clay near water, shape a jar (Pottery), fire it in a campfire, then aim at water and choose <b>Fill clay jar</b>.`,
      msg: 'Quest complete: you know where to find water. Craft clay jars to carry some with you.' } },
  { id: 'food', title: 'Living off the land', tutorial: true,
    summary: 'You\'re getting hungry. Find safe food to eat, then go hunting.',
    offer: (g) => g.player.food < 50,
    steps: FOOD_STEPS,
    outro: { title: 'A hunter-gatherer',
      text: `Pick what you know is safe, learn what you don't (your journal, ${KEY('J')}, keeps track), and hunt for meat and hides. Cook meat on a campfire: raw meat can make you sick. Hides are used for clothing and beds.`,
      msg: 'Quest complete: you can feed yourself from the land.' } },
  { id: 'bandages', title: 'Patch yourself up', tutorial: true,
    summary: 'You\'re hurt. Craft a bandage and patch yourself up once you\'re safe.',
    offer: (g) => g.tips.has('health_ok'),
    steps: BANDAGE_STEPS,
    outro: { title: 'Bandaged',
      text: `Health slowly comes back on its own while you're fed and watered, and a bandage heals 25 more over time. Keep a few on your hotbar, and always get away from danger before bandaging.`,
      msg: 'Quest complete: keep a few bandages on hand.' } },
];

const DEF = new Map(QUESTS.map((d) => [d.id, d]));

export class QuestLog {
  quests: QuestState[] = [];
  /** The tutorial quests are turned off (from the pause menu). */
  off = false;

  private panel: HTMLElement | null = null;
  private edge: HTMLElement | null = null;
  private group = new THREE.Group();
  private arrow: THREE.Mesh;
  /** A ring on the ground round each thing to go for (with a ripple spreading out of it). */
  private glows: THREE.Group[] = [];
  private targets: Target[] = [];
  private timer = 0;
  private time = 0;
  /** What the panel shows now (null: redraw it, whatever's due). */
  private lastHtml: string | null = null;
  /** Quests just finished (shown in the panel a while) and just offered (likewise), by id, with when. */
  private finished = new Map<string, number>();
  private offered = new Map<string, number>();
  /** The first quest offered, waiting for a quiet moment to explain the quest log. */
  private introFor: string | null = null;
  /** Lessons waiting to be shown (steps just done that teach something). */
  private lessons: { quest: string; step: Step }[] = [];
  /** Called when something the quest log shows has changed. */
  onChange?: () => void;

  constructor(glow: THREE.Texture) {
    // Quest markers are a cool blue, and lie on the ground: nothing like the
    // warm floating glow of fireflies, campfires or torches.
    const arrowMat = new THREE.MeshBasicMaterial({ color: MARKER, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false });
    // A downward arrow: a cone tip under a short shaft.
    const geo = new THREE.ConeGeometry(0.32, 0.6, 16).rotateX(Math.PI).translate(0, 0.3, 0);
    const shaft = new THREE.CylinderGeometry(0.11, 0.11, 0.55, 10).translate(0, 0.85, 0);
    this.arrow = new THREE.Mesh(geo, arrowMat);
    this.arrow.add(new THREE.Mesh(shaft, arrowMat));
    this.arrow.renderOrder = 8;
    this.group.add(this.arrow);
    void glow;
    const ringMat = () => new THREE.MeshBasicMaterial({ color: MARKER, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.5, 40).rotateX(-Math.PI / 2), ringMat());
      const ripple = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.5, 40).rotateX(-Math.PI / 2), ringMat());
      // A faint column of light standing up out of it, to find it by from further off.
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 3, 8, 1, true).translate(0, 1.5, 0), ringMat());
      ring.renderOrder = ripple.renderOrder = beam.renderOrder = 7;
      g.add(ring, ripple, beam);
      this.glows.push(g);
      this.group.add(g);
    }
    this.group.visible = false;
  }

  /** A new world: the quests you start with, beginning where you stand. */
  static begin(glow: THREE.Texture, x: number, z: number): QuestLog {
    const log = new QuestLog(glow);
    for (const d of QUESTS) if (!d.offer) log.quests.push({ id: d.id, status: 'active', step: 0, tracked: true, anchor: null, start: { x, z } });
    return log;
  }

  static load(glow: THREE.Texture, d: QuestSave | OldOnboardingSave): QuestLog {
    const log = new QuestLog(glow);
    if ('quests' in d) {
      log.quests = d.quests.filter((q) => DEF.has(q.id)).map((q) => {
        const steps = DEF.get(q.id)!.steps;
        let step = q.step;
        const at = q.stepId ? steps.findIndex((s) => s.id === q.stepId) : -1;
        if (at >= 0) step = at;
        // Saves from before steps were saved by name: their numbers follow the first order.
        else if (!q.stepId && q.id === 'home') step = oldHomeStep(step);
        return { ...q, step: Math.min(steps.length, step) };
      });
      log.off = d.off;
    } else {
      // The old single tutorial is the first-house quest.
      log.quests.push({ id: 'home', status: d.done ? 'done' : 'active', step: d.done ? HOME_STEPS.length : oldHomeStep(d.step), tracked: true, anchor: d.anchor, start: d.start });
      log.off = d.done && d.step < HOME_STEPS.length;
    }
    return log;
  }

  serialize(): QuestSave {
    for (const q of this.quests) q.stepId = this.def(q).steps[q.step]?.id;
    return { quests: this.quests, off: this.off };
  }

  /** Any tutorial quest still going (for the pause menu's Skip tutorial). */
  get active() { return !this.off && this.quests.some((q) => q.status !== 'done' && DEF.get(q.id)?.tutorial); }

  def(q: QuestState): QuestDef { return DEF.get(q.id)!; }

  /** Turn the tutorial quests off (from the pause menu). */
  skip() {
    this.off = true;
    this.quests = this.quests.filter((q) => q.status === 'done' || !DEF.get(q.id)?.tutorial);
    this.offered.clear();
    // Clear the panel and the markers straight away (the game may be paused, so the next check could be a while).
    this.targets = [];
    this.group.visible = false;
    if (this.edge) this.edge.style.display = 'none';
    this.changed();
    this.render('', false);
  }

  /** Bring the tutorial back (from the pause menu): the house quest starts again, and any steps you've already done tick off by themselves. */
  restart(x: number, z: number) {
    this.off = false;
    this.quests = this.quests.filter((q) => q.id !== 'home');
    this.quests.unshift({ id: 'home', status: 'active', step: 0, tracked: true, anchor: null, start: { x, z } });
    this.timer = 0;
    this.changed();
  }

  /** Take up an offered quest (tracked, unless you say otherwise). */
  accept(id: string, track = true) {
    const q = this.quests.find((x) => x.id === id && x.status === 'offered');
    if (!q) return;
    q.status = 'active';
    q.tracked = track;
    this.offered.delete(id);
    this.timer = 0;
    this.changed();
  }

  /** Show or hide a quest in the panel on screen. */
  setTracked(id: string, on: boolean) {
    const q = this.quests.find((x) => x.id === id);
    if (!q || q.tracked === on) return;
    q.tracked = on;
    this.timer = 0;
    this.changed();
  }

  /** Put a quest first: it's the one whose things are pointed out in the world. */
  focus(id: string) {
    const i = this.quests.findIndex((x) => x.id === id);
    if (i <= 0) return;
    const [q] = this.quests.splice(i, 1);
    q.tracked = true;
    this.quests.unshift(q);
    this.timer = 0;
    this.changed();
  }

  /** Record something you've done that a quest step may be waiting for. */
  note(flag: string) {
    for (const q of this.quests) {
      if (q.status === 'done') continue;
      q.flags ??= [];
      if (!q.flags.includes(flag)) q.flags.push(flag);
    }
    this.timer = 0;
  }

  /** The quest the world arrows are for: the first tracked one under way. */
  get focused(): QuestState | undefined {
    return this.quests.find((q) => q.status === 'active' && q.tracked);
  }

  private changed() {
    this.lastHtml = null;
    this.onChange?.();
  }

  update(g: Game, dt: number) {
    this.time += dt;
    if (!this.panel) this.mount(g);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.4;
      this.check(g);
    }
    this.place(g);
  }

  private mount(g: Game) {
    this.panel = document.createElement('div');
    this.panel.className = 'tut-panel';
    this.edge = document.createElement('div');
    this.edge.className = 'tut-edge';
    this.edge.innerHTML = '<div class="tut-edge-arrow">➤</div><div class="tut-edge-dist"></div>';
    g.ui.root.append(this.panel, this.edge);
    // Hold Alt and drag it wherever suits you.
    g.ui.movable(this.panel, 'tutorial');
    g.scene.add(this.group);
  }

  /** Progress of a quest's current step, for showing. */
  progressOf(g: Game, q: QuestState): [number, number] | boolean {
    const s = this.def(q).steps[q.step];
    return s ? s.progress(g, q) : true;
  }

  /** The first time a quest is offered: what the quest log is and how to follow several quests. */
  private intro(g: Game, id: string) {
    this.introFor = null;
    g.tips.add('quest_intro');
    const d = DEF.get(id)!;
    g.ui.showNotice(`New quest: ${d.title}`,
      `<p>${d.summary}</p>
      <p>You can have <b>multiple quests active</b> at once. Your other quests keep their progress.</p>
      <p>Open your <b>quest log</b> with ${KEY('L')}:</p>
      <ul>
        <li><b>Accept</b> to start a quest. It's <b>pinned</b> to the panel on the right.</li>
        <li><b>Track</b> to show a quest's objectives in the world: <span style="color:#8fd0ff">blue markers</span> and an arrow. One quest is tracked at a time; switch any time.</li>
        <li><b>Unpin</b> to hide a quest from the panel. You won't lose progress.</li>
      </ul>`,
      'Open my quests', () => { g.ui.show('quests'); g.ui.refresh(); });
  }

  /** Offer what's due, move quests on as their steps are done, and redraw the panel. */
  private check(g: Game) {
    let flashOffer = false;
    // New quests, when their time comes.
    for (const d of QUESTS) {
      if (!d.offer || this.quests.some((q) => q.id === d.id) || (d.tutorial && this.off) || !d.offer(g)) continue;
      const p = g.player.pos;
      this.quests.push({ id: d.id, status: 'offered', step: 0, tracked: false, anchor: null, start: { x: p.x, z: p.z } });
      this.offered.set(d.id, this.time);
      telemetry.event('quest', `${d.id} offered`);
      g.msg(`New quest: ${d.title}. Open your quests (L) to take it up.`, 'good');
      // The first one: stop and show how quests work (once you're not in the middle of something).
      if (!g.tips.has('quest_intro')) this.introFor ??= d.id;
      flashOffer = true;
      this.changed();
    }
    if (this.introFor && !g.working && !g.ui.modalOpen && !g.ui.anyWindowOpen()) this.intro(g, this.introFor);
    // A lesson waiting (a step just done that teaches something): shown as soon as you're free to read it.
    if (this.lessons.length && !this.introFor && !g.working && !g.action && !g.ui.modalOpen && !g.ui.anyWindowOpen()) {
      const { quest, step } = this.lessons.shift()!, l = step.lesson!;
      g.tips.add(`lesson:${quest}:${step.id}`);
      telemetry.event('quest', `lesson: ${l.title}`);
      g.ui.showNotice(l.title, l.text, l.button ?? 'Got it', () => {}, { image: l.image, kind: 'lesson' });
    }
    const home = this.quests.find((q) => q.id === 'home');
    // The house's floor: the first floor you finish (or the nearest, for an old plan).
    if (home && !home.anchor) {
      let best: StructureObj | null = null, bd = Infinity;
      for (const o of g.world.objects.values()) {
        if (o.kind !== 'structure' || o.type !== 'floor' || !o.built) continue;
        const d = Math.hypot(o.x - g.player.pos.x, o.z - g.player.pos.z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) home.anchor = { x: best.x, z: best.z };
    }
    let flash = false;
    for (const q of this.quests) {
      if (q.status !== 'active') continue;
      const d = this.def(q);
      while (q.step < d.steps.length && isDone(d.steps[q.step].progress(g, q))) {
        g.msg(`${d.title}: ${d.steps[q.step].title} — done!`, 'good');
        if (d.steps[q.step].lesson && !g.tips.has(`lesson:${q.id}:${d.steps[q.step].id}`)) this.lessons.push({ quest: q.id, step: d.steps[q.step] });
        telemetry.event('quest', `${q.id}: ${d.steps[q.step].id} done`, { step: q.step + 1, of: d.steps.length });
        q.step++;
        flash = true;
        this.changed();
      }
      if (q.step >= d.steps.length) {
        q.status = 'done';
        telemetry.event('quest', `${q.id} complete`);
        this.finished.set(q.id, this.time);
        g.msg(d.outro.msg, 'good');
        this.changed();
      }
    }
    for (const [id, t] of this.finished) if (this.time - t > 20) { this.finished.delete(id); this.lastHtml = null; }
    // (Offers waiting from an earlier session show again.)
    for (const q of this.quests) if (q.status === 'offered' && DEF.get(q.id)?.tutorial && !this.offered.has(q.id)) { this.offered.set(q.id, this.time); this.lastHtml = null; }
    // An offer stays in the panel until you take it up (a tutorial one), or a while (others).
    for (const [id, t] of this.offered) {
      const q = this.quests.find((x) => x.id === id);
      if (q?.status !== 'offered' || (!DEF.get(id)?.tutorial && this.time - t > 45)) { this.offered.delete(id); this.lastHtml = null; }
    }

    // The focused quest's step: the nearest few things to go for (looking further afield if there's nothing close).
    const f = this.focused;
    const s = f && this.def(f).steps[f.step];
    const p = g.player.pos;
    SEARCH = 70;
    let found = s?.targets?.(g, f!) ?? [];
    if (s?.targets && !found.length) { SEARCH = 250; found = s.targets(g, f!); }
    this.targets = found
      .map((t) => ({ t, d: Math.hypot(t.x - p.x, t.z - p.z) }))
      .sort((a, b) => a.d - b.d).slice(0, this.glows.length).map((e) => e.t);

    // The panel: news first (offers, quests just done), then each tracked quest; the focused one in full.
    let html = '';
    for (const id of this.offered.keys()) {
      const d = DEF.get(id)!;
      html += `<div class="quest-card quest-offer"><div class="tut-head">New quest</div>
        <div class="tut-title">${d.title}</div>
        <div class="tut-text">${d.summary}</div>
        <div class="tut-hint quest-how">Press ${KEY('L')} for your quest log: <b>Accept</b> it, then <b>Track</b> it to mark its targets in the world.</div></div>`;
    }
    for (const id of this.finished.keys()) {
      const d = DEF.get(id)!;
      html += `<div class="quest-card"><div class="tut-head">Quest complete · ${d.title}</div>
        <div class="tut-title">${d.outro.title}</div>
        <div class="tut-text">${d.outro.text}</div></div>`;
    }
    for (const q of this.quests) {
      if (q.status !== 'active' || !q.tracked) continue;
      const d = this.def(q), st = d.steps[q.step], pr = st.progress(g, q);
      const bar = Array.isArray(pr) ? `<div class="tut-progress"><div class="tut-progress-fill" style="width:${(pr[0] / pr[1]) * 100}%"></div><span>${pr[0]} / ${pr[1]}</span></div>` : '';
      if (q === f) {
        const far = st.far && !this.targets.length ? `<div class="tut-hint">${st.far}</div>` : '';
        html += `<div class="quest-card"><div class="tut-head">${d.title} · step ${q.step + 1} of ${d.steps.length}</div>
          <div class="tut-title">${st.title}</div>
          <div class="tut-text">${st.text}</div>${far}${bar}</div>`;
      } else {
        html += `<div class="quest-card quest-brief"><div class="tut-head">${d.title} · step ${q.step + 1} of ${d.steps.length}</div>
          <div class="quest-brief-title">${st.title}</div>${bar}</div>`;
      }
    }
    if (html) html += `<div class="tut-foot">${KEY('L')} quests · Hold Alt to move this</div>`;
    this.render(html, flash || flashOffer);
  }

  private render(html: string, flash: boolean) {
    if (!this.panel || html === this.lastHtml) return;
    this.lastHtml = html;
    this.panel.innerHTML = html;
    this.panel.style.display = html ? '' : 'none';
    if (flash) {
      this.panel.classList.remove('tut-flash');
      void this.panel.offsetWidth; // restart the animation
      this.panel.classList.add('tut-flash');
    }
  }

  /** Put the arrow and glows on the targets, and the screen-edge arrow toward the nearest when it's out of view. */
  private place(g: Game) {
    // Things that have gone (picked, felled) drop out until the next check.
    // (Places, like a stretch of water, have no id of their own: they stay.)
    this.targets = this.targets.filter((t) => t.id < 0 || g.world.objects.has(t.id) || g.world.animals.some((a) => a.id === t.id && a.hp > 0));
    // Animals move: follow them.
    for (const t of this.targets) {
      const a = g.world.animals.find((x) => x.id === t.id);
      if (a) { t.x = a.x; t.z = a.z; t.y = g.world.terrain.heightAt(a.x, a.z) + 1.9; }
    }
    // Hands-on work (building a piece, say) has the view to itself: no markers in the way.
    const first = g.working ? undefined : this.targets[0];
    this.group.visible = !!first;
    const cam = g.camera.position;
    this.glows.forEach((s, i) => {
      const t = this.targets[i];
      s.visible = !!t;
      if (!t) return;
      const d = Math.hypot(t.x - cam.x, t.z - cam.z);
      // On the ground under it (or on the water, for a place to drink).
      const ter = g.world.terrain, below = ter.groundBelow(t.x, t.y, t.z);
      s.position.set(t.x, Math.max(Number.isFinite(below) ? below : ter.heightAt(t.x, t.z), ter.waterAt(t.x, t.z)) + 0.04, t.z);
      // A steady ring round it, with a ripple spreading out every couple of seconds.
      // It doesn't cover the thing itself, so you can always see what it is.
      const size = Math.max(1, d / 12);
      s.scale.setScalar(size);
      const [ring, ripple, beam] = s.children as THREE.Mesh[];
      (beam.material as THREE.MeshBasicMaterial).opacity = (i === 0 ? 0.35 : 0.2) * Math.min(1, Math.max(0.15, (d - 3) / 10));
      const fade = Math.min(1, Math.max(0.4, d / 6));
      (ring.material as THREE.MeshBasicMaterial).opacity = (i === 0 ? 0.75 : 0.45) * fade;
      const k = ((this.time * 0.6 + i * 0.37) % 1);
      ripple.scale.setScalar(1 + k * 1.2);
      (ripple.material as THREE.MeshBasicMaterial).opacity = (1 - k) * (i === 0 ? 0.6 : 0.35) * fade;
    });
    if (!this.edge) return;
    if (!first) { this.edge.style.display = 'none'; return; }
    const d = Math.hypot(first.x - cam.x, first.z - cam.z);
    const k = Math.max(1, d / 14);
    this.arrow.position.set(first.x, first.y + 0.9 * k + Math.sin(this.time * 3.5) * 0.15 * k, first.z);
    this.arrow.scale.setScalar(k);
    // Right by it, the arrow would fill the view: let it fade.
    (this.arrow.material as THREE.MeshBasicMaterial).opacity = 0.95 * Math.min(1, Math.max(0.2, (d - 1.5) / 4));
    this.arrow.rotation.y = this.time * 1.5;
    // On screen? Otherwise an arrow at the edge, pointing the way.
    const v = new THREE.Vector3(first.x, first.y, first.z).project(g.camera);
    const behind = v.z > 1;
    const onScreen = !behind && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.85;
    if (onScreen) { this.edge.style.display = 'none'; return; }
    let x = v.x, y = v.y;
    if (behind) { x = -x; y = -y; }
    const len = Math.hypot(x, y) || 1;
    x /= len; y /= len;
    const w = window.innerWidth, h = window.innerHeight;
    // Pushed out to an ellipse just inside the screen.
    const px = w / 2 + x * (w / 2 - 60), py = h / 2 - y * (h / 2 - 60);
    this.edge.style.display = 'block';
    this.edge.style.transform = `translate(${px}px, ${py}px)`;
    (this.edge.firstElementChild as HTMLElement).style.transform = `translate(-50%, -50%) rotate(${Math.atan2(-y, x)}rad)`;
    (this.edge.lastElementChild as HTMLElement).textContent = `${Math.round(d)} m`;
  }
}

/** The colour of quest markers (rings and arrow): a cool sky blue. */
const MARKER = 0x7fd8ff;

/** The first-house quest's steps in the order saves numbered them before steps were saved by name. */
const FIRST_HOME_ORDER = ['move', 'fiber', 'branch', 'stones', 'cordage', 'hatchet', 'hammer', 'fell', 'planks', 'floor', 'walls', 'window', 'door', 'roof', 'gables', 'hides', 'bed', 'chest'];
function oldHomeStep(n: number): number {
  const id = FIRST_HOME_ORDER[n];
  const at = id ? HOME_STEPS.findIndex((s) => s.id === id) : -1;
  return at >= 0 ? at : Math.min(n, HOME_STEPS.length);
}

const isDone = (p: [number, number] | boolean) => (Array.isArray(p) ? p[0] >= p[1] : p);

/** The first-house quest's step ids, in order (for tests). */
export const ONBOARDING_STEPS = HOME_STEPS.map((s) => s.id);
