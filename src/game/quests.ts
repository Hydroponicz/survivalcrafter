import { telemetry } from './telemetry';
import * as THREE from 'three';
import { isIdentified, itemDef } from '../data/items';
import { FORAGE_SPECIES } from '../data/forage';
import type { ToolKind } from '../data/items';
import type { StructureObj } from '../world/world';
import { professionById } from '../data/professions';
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
  /** One of the paths offered once camp is made (offered quietly, all at once, and chosen from a board): its picture. */
  path?: string;
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

/** Built pieces of these kinds within r of you (lit ones only, if asked). */
const around = (g: Game, types: string[], r = 100, lit = false) => {
  let n = 0;
  for (const o of g.world.near(g.player.pos.x, g.player.pos.z, r)) if (o.kind === 'structure' && o.built && types.includes(o.type) && (!lit || o.lit)) n++;
  return n;
};
const hasAny = (g: Game, types: string[]) => types.some((t) => g.inv.count(t) > 0);

/** Pieces of these kinds round about, built or not (to point at). */
function structuresNear(g: Game, types: string[]): Target[] {
  const p = g.player.pos, out: Target[] = [];
  for (const o of g.world.near(p.x, p.z, SEARCH)) if (o.kind === 'structure' && types.includes(o.type)) out.push({ x: o.x, y: o.y + 1, z: o.z, id: o.id });
  return out;
}

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

const CAMP_STEPS: Step[] = [
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
      text: `<p>Your first tree is down. Now <b>set up a basic camp</b> near here: a <b>chopping block</b>, a <b>campfire</b> and a <b>lean-to</b> to sleep under, somewhere to come back to while you find your feet.</p>
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
    text: `Stand by your chopping block with the hatchet equipped, press ${KEY('C')} and choose <b>Split log into rough planks</b> (Woodworking). Each log gives 2 planks: one is the fireboard of your fire making kit. (Later, an iron saw makes <b>refined planks</b> for fine furniture.)`,
    // (Planks already made into the kit count.)
    progress: (g) => [Math.min(2, g.inv.count('plank') + (g.inv.count('fire_kit') > 0 ? 1 : 0)), 2],
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
  { id: 'light', title: 'Light the fire',
    text: `Aim at your campfire and <b>Add fuel</b> (branches, kindling or logs), then choose <b>Light fire</b>: you kneel and work the bow drill from your kit until the ember catches. Keep the fire fed: it lights your camp at night, and wolves keep clear of the light.`,
    progress: (g) => around(g, ['campfire'], 60, true) > 0,
    targets: (g) => structuresNear(g, ['campfire']) },
  { id: 'leanto', title: 'Build a lean-to',
    text: `Somewhere to sleep: press ${KEY('B')}, choose <b>Lean-to shelter</b> (Camp essentials) and place it by your fire. Build it with your hatchet from <b>10 branches</b> and <b>10 plant fiber</b> (the thatch). It's a <b>bed</b>: sleep in it to pass the night and wake there if you fall.`,
    progress: (g) => around(g, ['lean_to'], 80) > 0,
    targets: (g) => { const p = plans(g, ['lean_to']); return p.length ? p : forage(g, ['fallen_branch', 'fiber_grass', 'reeds']); },
    far: 'Gather branches in the woods and fiber in the meadows.' },
];

const HOUSE_STEPS: Step[] = [
  { id: 'hammer', title: 'Make a wooden hammer',
    text: `You need a hammer to build. First carve a <b>Shaft</b> from a branch with your knife (Woodworking), then craft a <b>Wooden hammer</b> (Primitive) from the shaft and a rough plank. Split plenty of logs on your chopping block too: a floor piece takes 4 planks.`,
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


// ---------- the paths: once camp is made, a tree of trades to learn, each from the raw material on.
// The first ones open when camp is made; each opens the trades that follow from it (hunting leads to
// butchering and skinning, skinning to tailoring...).

const FISH_IDS = ['perch', 'trout', 'carp', 'pike', 'eel', 'herring', 'mackerel', 'sea_bass', 'cod'];
const MEALS = ['cooked_meat', 'cooked_fish', 'roast_mushroom', 'bread', 'hearty_stew'];
const meals = (g: Game) => MEALS.reduce((a, t) => a + g.inv.count(t), 0);

const HUNTING_STEPS: Step[] = [
  { id: 'spear', title: 'Make a stone spear',
    text: `Craft a <b>Stone spear</b> (${KEY('C')} → Primitive) from 2 branches, a small rock and cordage. A <b>bow</b> and <b>arrows</b> (with a quiver to carry them) reach further, once you've found flint and feathers.`,
    progress: (g) => g.inv.items.some((i) => itemDef(i.type).tool === 'weapon' || itemDef(i.type).tool === 'bow') },
  { id: 'hunt', title: 'Hunt an animal',
    text: `Deer graze in meadows and at the edges of woods; boars root in the woods and fight back. Equip your spear and ${KEY('Left click')} to strike. When a boar lowers its head and shakes, it's about to charge: dodge.`,
    progress: (_g, q) => flagged(q, 'killed'),
    targets: (g) => game(g),
    far: 'No animals nearby. Explore meadows and the edges of woods.' },
];
const BUTCHER_STEPS: Step[] = [
  { id: 'butcher', title: 'Butcher a carcass',
    text: `Equip your knife, aim at a body and choose <b>Butcher</b>. Your skill decides how much meat you get, and how clean the hide.`,
    progress: (_g, q) => flagged(q, 'butchered'),
    targets: (g) => game(g) },
  { id: 'meat', title: 'Lay in meat',
    text: `Hunt and butcher until you have <b>3 portions of meat</b> (raw or cooked).`,
    progress: (g) => [Math.min(3, g.inv.count('raw_meat') + g.inv.count('cooked_meat')), 3],
    targets: (g) => game(g) },
];
const SKIN_STEPS: Step[] = [
  { id: 'hides', title: 'Gather six hides',
    text: `Every animal you butcher gives a hide, cleaner the more skilled you are. Gather <b>6 hides</b>: leather for clothing, bellows and a tent.`,
    progress: (g) => [Math.min(6, g.inv.count('hide') + (around(g, ['hide_tent']) ? 6 : 0)), 6],
    targets: (g) => game(g) },
  { id: 'tent', title: 'Pitch a hide tent',
    text: `A warmer, sturdier shelter than a lean-to: place a <b>Hide tent</b> (${KEY('B')} → Camp essentials) and build it with your knife from 6 hides, 4 shafts and 3 cordage.`,
    progress: (g) => around(g, ['hide_tent']) > 0,
    targets: (g) => plans(g, ['hide_tent']) },
];
const TAILOR_STEPS: Step[] = [
  { id: 'boots', title: 'Make hide boots',
    text: `Cut and stitch <b>Hide boots</b> (${KEY('C')} → Clothing) from a hide and 2 cordage with your knife.`,
    progress: (g) => g.inv.count('hide_boots') > 0 },
  { id: 'cap', title: 'Make a hide cap',
    text: `Then a <b>Hide cap</b> (Clothing) from a hide and a cordage. <b>Wear</b> them (right-click in your backpack): clothing takes the sting out of bites and blows. A tunic, trousers, a backpack and a quiver follow.`,
    progress: (g) => g.inv.count('hide_cap') > 0 },
];
const COOK_STEPS: Step[] = [
  { id: 'meal', title: 'Cook a meal',
    text: `Stand by your lit campfire, press ${KEY('C')} → Cooking, and cook: meat, fish, a mushroom you know is safe. Hold it over the flame, not too close, and take it off when it's done.`,
    progress: (g) => meals(g) > 0,
    targets: (g) => structuresNear(g, ['campfire']) },
  { id: 'larder', title: 'Fill the larder',
    text: `Cook <b>3 meals</b> to keep by you. Cooked food feeds you far better than raw, and better cooking makes it more filling still.`,
    progress: (g) => [Math.min(3, meals(g)), 3] },
];
const FARM_STEPS: Step[] = [
  { id: 'seeds', title: 'Gather wild wheat',
    text: `Wild wheat grows in meadows: pick some for <b>wheat seeds</b>.`,
    progress: (g) => [Math.min(2, g.inv.count('wheat_seeds') + (g.inv.count('wheat') > 0 ? 2 : 0)), 2],
    targets: (g) => forage(g, ['wild_wheat']),
    far: 'Look in open meadows.' },
  { id: 'hoe', title: 'Make a hoe',
    text: `Knap a <b>Stone hoe</b> (${KEY('C')} → Primitive). It tills the soil, and levels and smooths ground for building.`,
    progress: (g) => hasTool(g, 'hoe') },
  { id: 'till', title: 'Till a field',
    text: `Hold the hoe and aim at grass or bare earth on flat ground: a square grid shows the <b>3 × 3 m bed</b> you'll till. <b>Click</b> to till it into dark, even soil. Till more beds beside it to make a bigger field.`,
    progress: (_g, q) => flagged(q, 'tilled') },
  { id: 'sow', title: 'Sow wheat',
    text: `Hold the <b>wheat seeds</b> and aim at your bed: its grid shows green. <b>Click</b> to sow it, a seed in each of its 9 squares. <b>Tend</b> it now and then with the hoe (right-click → Tend crop) and it grows better.`,
    progress: (_g, q) => flagged(q, 'sowed') },
  { id: 'harvest', title: 'Harvest your wheat',
    text: `Wheat takes a few days to ripen (golden). Then aim at it and <b>Harvest</b>: you get wheat, and seeds to sow again. Meanwhile, try another path.`,
    progress: (g) => g.inv.count('wheat') > 0 || hasAny(g, ['flour', 'dough', 'bread']) },
];
const MILL_STEPS: Step[] = [
  { id: 'quern', title: 'Build a quern',
    text: `Grain is ground between stones on a <b>Quern</b> (${KEY('B')} → Crafting), built with a hammer from 10 small rocks and a shaft.`,
    progress: (g) => around(g, ['quern']) > 0,
    targets: (g) => plans(g, ['quern']) },
  { id: 'flour', title: 'Grind flour',
    text: `At the quern, grind <b>Flour</b> (${KEY('C')} → Cooking) from 2 wheat: keep the stone turning steadily.`,
    progress: (g) => hasAny(g, ['flour', 'dough', 'bread']) },
];
const BAKE_STEPS: Step[] = [
  { id: 'dough', title: 'Mix dough',
    text: `Mix <b>Dough</b> (${KEY('C')} → Cooking) from flour and a jar of water. (No jar? The Potter's path makes one.)`,
    progress: (g) => hasAny(g, ['dough', 'bread']) },
  { id: 'bread', title: 'Bake bread',
    text: `Bake <b>Bread</b> at your lit campfire: take it off when it's golden. Bread is the most filling food there is.`,
    progress: (g) => g.inv.count('bread') > 0,
    targets: (g) => structuresNear(g, ['campfire']) },
];
const MINE_STEPS: Step[] = [
  { id: 'pick', title: 'Make a pickaxe',
    text: `Knap a <b>Stone pickaxe</b> (${KEY('C')} → Primitive).`,
    progress: (g) => hasTool(g, 'pickaxe') },
  { id: 'stone', title: 'Break up boulders',
    text: `Hold the pickaxe, aim at a boulder and break it up: hold to raise the pick, let go to strike, and hit the cracks. Gather <b>10 small rocks</b>.`,
    progress: (g) => [Math.min(10, g.inv.count('rock_shard')), 10] },
  { id: 'ore', title: 'Mine iron ore',
    text: `Iron ore is in rust-red rock (ironstone) in hills and mountainsides. Hold the pickaxe, aim at it and <b>Mine</b>.`,
    progress: (g) => hasAny(g, ['iron_ore', 'iron_lump', 'iron_knife']) },
];
const MASON_STEPS: Step[] = [
  { id: 'sand', title: 'Dig sand and clay',
    text: `Sand lies on beaches and riverbanks, clay along the water's edge. <b>Dig</b> some of each with a shovel (no shovel? carve one: Woodworking → Wooden shovel).`,
    progress: (g) => (g.inv.count('sand') > 0 && g.inv.count('clay') > 0) || g.inv.count('mortar') > 0,
    targets: (g) => water(g) },
  { id: 'mortar', title: 'Mix mortar',
    text: `Mix <b>Mortar</b> (${KEY('C')} → Pottery) from a clay and a sand: it binds stone.`,
    progress: (g) => [Math.min(2, g.inv.count('mortar') + (around(g, ['stone_foundation']) ? 2 : 0)), 2] },
  { id: 'found', title: 'Lay a stone foundation',
    text: `Place a <b>Stone foundation</b> (${KEY('B')} → Foundations) and build it with a hammer from 10 small rocks and 2 mortar. Stone walls, chimneys and towers follow.`,
    progress: (g) => around(g, ['stone_foundation']) > 0,
    targets: (g) => plans(g, ['stone_foundation']) },
];
const SMITH_STEPS: Step[] = [
  { id: 'forge', title: 'Build a forge',
    text: `Place a <b>Forge</b> (${KEY('B')} → Crafting) and build it from 16 small rocks and 8 clay.`,
    progress: (g) => around(g, ['forge']) > 0,
    targets: (g) => plans(g, ['forge']) },
  { id: 'tongs', title: 'Make tongs',
    text: `Hot metal is held in <b>Green-wood tongs</b> (${KEY('C')} → Smithy): 2 shafts and a cordage.`,
    progress: (g) => hasTool(g, 'tongs') },
  { id: 'crucible', title: 'Make a crucible',
    text: `Ore melts in a <b>Crucible</b>: shape one from 2 clay and a sand (Smithy), then fire it in your campfire.`,
    progress: (g) => hasTool(g, 'crucible') },
  { id: 'bellows', title: 'Set up the bellows',
    text: `A forge needs <b>Bellows</b> to get hot enough: make them (${KEY('C')} → Smithy) from 2 hides, 2 planks and 2 cordage, then right-click them in your backpack → <b>Place</b>, against the side of the forge.`,
    progress: (g) => around(g, ['bellows']) > 0 },
  { id: 'anvil', title: 'Set down an anvil',
    text: `Shape a <b>Stone anvil</b> (${KEY('C')} → Smithy) from 12 small rocks and set it down by the forge (right-click it in your backpack → Place).`,
    progress: (g) => around(g, ['anvil', 'iron_anvil']) > 0 },
  { id: 'smelt', title: 'Smelt iron',
    text: `Light the forge (charcoal burns hottest), then <b>Smelt iron ore</b> (Smithing): work the bellows to keep the heat in the green. Out comes an <b>iron lump</b>.`,
    progress: (g) => hasAny(g, ['iron_lump', 'iron_knife']),
    targets: (g) => structuresNear(g, ['forge']) },
  { id: 'forgeknife', title: 'Forge a knife',
    text: `At the forge and anvil, with your hammer, forge a <b>Carving knife</b> (Smithing) from an iron lump and a shaft: strike while it's hot, then quench it. Iron tools work faster and last far longer.`,
    progress: (g) => g.inv.count('iron_knife') > 0 },
];
const COMBAT_STEPS: Step[] = [
  { id: 'sword', title: 'Forge a sword',
    text: `Forge an <b>Iron sword</b> (Smithing) from 3 iron lumps, a plank and a cordage: the hardest work at the anvil yet.`,
    progress: (g) => g.inv.count('iron_sword') > 0 },
  { id: 'wolf', title: 'Stand against a wolf',
    text: `Wolves hunt by night, in packs. Draw your sword, keep your back to your fire, and strike as they come in. A clean blow when one lunges; then step back into the light.`,
    progress: (_g, q) => flagged(q, 'killed_wolf'),
    far: 'Wolves come out after dark, from their dens at the foot of the mountains.' },
];
const WOOD_STEPS: Step[] = [
  { id: 'logs', title: 'Fell and gather logs',
    text: `Fell more trees and gather <b>6 logs</b>. Bigger trees give more logs; your Woodcutting skill makes the work quicker.`,
    progress: (g) => [Math.min(6, g.inv.count('log') + (around(g, ['woodpile']) ? 6 : 0)), 6],
    targets: (g) => (g.inv.count('log') < 6 ? trees(g) : []) },
  { id: 'kindling', title: 'Split kindling',
    text: `At your chopping block, split a rough plank into <b>Kindling</b> (${KEY('C')} → Woodworking): four sticks from a plank.`,
    progress: (g) => g.inv.count('kindling') >= 4 || around(g, ['woodpile']) > 0,
    targets: (g) => blocks(g) },
  { id: 'woodpile', title: 'Stack a woodpile',
    text: `Stack a <b>Woodpile</b> (${KEY('B')} → Camp essentials) from 2 logs and 6 kindling: fuel laid by, out of the rain.`,
    progress: (g) => around(g, ['woodpile']) > 0,
    targets: (g) => plans(g, ['woodpile']) },
];
const CARPENTER_STEPS: Step[] = [
  { id: 'saw', title: 'Get a saw',
    text: `Fine woodwork needs an iron <b>Saw</b>: forge one at the forge and anvil (Smithing) from 2 iron lumps and a plank (the Smithing path shows the way), or buy one in a town.`,
    progress: (g) => hasTool(g, 'saw') },
  { id: 'refined', title: 'Saw refined planks',
    text: `With the saw in your pack, <b>Saw a log into refined planks</b> (Woodworking): 5 smooth planks from a log, if you keep to the line. You need 6.`,
    progress: (g) => [Math.min(6, g.inv.count('refined_plank') + (around(g, ['workbench']) ? 6 : 0)), 6] },
  { id: 'bench', title: 'Build a workbench',
    text: `Place a <b>Workbench</b> (${KEY('B')} → Camp essentials) and build it with your hammer from 6 refined planks and 4 shafts. It's where furniture is made.`,
    progress: (g) => around(g, ['workbench']) > 0,
    targets: (g) => plans(g, ['workbench']) },
  { id: 'stool', title: 'Make a stool',
    text: `At the workbench, make a <b>Three-legged stool</b> (${KEY('C')} → Furniture), then set it down. Fine furniture by your bed lets you wake well rested.`,
    progress: (g) => g.inv.count('stool') > 0 || around(g, ['stool']) > 0 },
];
const CHARCOAL_STEPS: Step[] = [
  { id: 'shovel', title: 'Make a shovel',
    text: `Carve a <b>Wooden shovel</b> (${KEY('C')} → Woodworking) from a rough plank and a shaft.`,
    progress: (g) => hasTool(g, 'shovel') },
  { id: 'earth', title: 'Dig earth',
    text: `A kiln is covered over with earth to starve the fire of air. Hold the shovel, aim at the ground and <b>Dig</b> until you have <b>4 dirt</b>.`,
    progress: (g) => [Math.min(4, g.inv.count('dirt') + (around(g, ['charcoal_kiln']) ? 4 : 0)), 4] },
  { id: 'kiln', title: 'Build a charcoal kiln',
    text: `Place a <b>Charcoal kiln</b> (${KEY('B')} → Crafting) and build it with the shovel: 6 logs stood on end, covered over with the earth.`,
    progress: (g) => around(g, ['charcoal_kiln']) > 0,
    targets: (g) => plans(g, ['charcoal_kiln']) },
  { id: 'burn', title: 'Burn charcoal',
    text: `By the kiln, <b>Burn charcoal</b> (${KEY('C')} → Woodworking): 2 logs make 4 charcoal, if you keep the burn low and slow. Charcoal burns long in a fire and hottest of all in a forge, and towns pay well for it.`,
    progress: (g) => g.inv.count('charcoal') > 0,
    targets: (g) => structuresNear(g, ['charcoal_kiln']) },
];
const FISHER_STEPS: Step[] = [
  { id: 'rod', title: 'Make a fishing rod',
    text: `Craft a <b>Fishing rod</b> (${KEY('C')} → Primitive) from 3 shafts and 5 cordage. (Carve shafts from branches with your knife.)`,
    progress: (g) => hasTool(g, 'rod') },
  { id: 'catch', title: 'Catch a fish',
    text: `Hold the rod, aim at water and choose <b>Fish</b>. Hold to swing the rod back and let go to cast; leave the nibbles, and click the moment the float is pulled under. Then reel in with the tension in the green. Deeper water holds bigger fish: try the end of a jetty.`,
    progress: (g) => hasAny(g, FISH_IDS) || g.inv.count('cooked_fish') > 0,
    targets: (g) => water(g),
    far: 'No water nearby. Head downhill to a river, a lake or the sea.' },
  { id: 'cook', title: 'Cook your catch',
    text: `At your lit campfire, cook the fish (${KEY('C')} → Cooking). A big one makes several cooked fish.`,
    progress: (g) => g.inv.count('cooked_fish') > 0,
    targets: (g) => structuresNear(g, ['campfire']) },
];
const POTTER_STEPS: Step[] = [
  { id: 'shovel', title: 'Make a wooden shovel',
    text: `Carve a <b>Wooden shovel</b> (${KEY('C')} → Woodworking) from a rough plank and a shaft with your knife.`,
    progress: (g) => hasTool(g, 'shovel') },
  { id: 'clay', title: 'Dig clay',
    text: `Clay lies along riverbanks and lake shores: reddish-brown, sticky ground. Hold the shovel, aim at it and <b>Dig</b>.`,
    progress: (g) => [Math.min(3, g.inv.count('clay') + (hasAny(g, ['clay_jar_unfired', 'clay_jar', 'jar_of_water']) ? 3 : 0)), 3],
    targets: (g) => water(g),
    far: 'Look by water.' },
  { id: 'shape', title: 'Shape a jar',
    text: `Throw an <b>Unfired clay jar</b> (${KEY('C')} → Pottery) from 3 clay: keep it centred on the wheel.`,
    progress: (g) => hasAny(g, ['clay_jar_unfired', 'clay_jar', 'jar_of_water']) },
  { id: 'fire', title: 'Fire it',
    text: `Fire the jar in your lit campfire (${KEY('C')} → Pottery → Fire clay jar): keep the heat steady so it doesn't crack.`,
    progress: (g) => hasAny(g, ['clay_jar', 'jar_of_water']),
    targets: (g) => structuresNear(g, ['campfire']) },
  { id: 'fill', title: 'Fill it with water',
    text: `Hold the jar, aim at fresh water and choose <b>Fill clay jar</b>. Now you can carry water with you, and mix dough.`,
    progress: (g) => g.inv.count('jar_of_water') > 0,
    targets: (g) => water(g) },
];
const BOAT_STEPS: Step[] = [
  { id: 'paddle', title: 'Carve a paddle',
    text: `Carve a <b>Paddle</b> (${KEY('C')} → Woodworking) from a rough plank and a shaft.`,
    progress: (g) => g.inv.count('paddle') > 0 },
  { id: 'dugout', title: 'Hollow out a dugout canoe',
    text: `Place a <b>Dugout canoe</b> (${KEY('B')} → Boats) near the water and build it with your hatchet: lay chocks, roll the trunk on (3 logs), then burn and chop it hollow with 4 kindling.`,
    progress: (g) => g.world.carts.some((c) => c.type === 'dugout') || !!g.boat,
    targets: (g) => plans(g, ['dugout']) },
  { id: 'paddleout', title: 'Paddle out',
    text: `Aim at the canoe and <b>Get in</b>, with the paddle in your pack: ${KEY('W')}/${KEY('S')} to paddle, ${KEY('A')}/${KEY('D')} to steer, ${KEY('X')} to get out. Rafts, skin boats, rowing boats and in time whole ships are built the same way.`,
    progress: (g) => !!g.boat },
];
const FORAGER_STEPS: Step[] = [
  { id: 'journal', title: 'Open your field journal',
    text: `Press ${KEY('J')}: your <b>field journal</b> records every wild plant and mushroom you find.`,
    progress: (_g, q) => flagged(q, 'journal') },
  { id: 'identify', title: 'Identify three wild species',
    text: `Pick wild plants and mushrooms and learn what they are: <b>Study</b> them from your backpack, or keep picking a kind until you recognise it. Some heal, some feed you, some poison you.`,
    progress: () => [Math.min(3, FORAGE_SPECIES.filter((sp) => isIdentified(sp.item)).length), 3],
    targets: (g) => forage(g, FORAGE_SPECIES.map((sp) => sp.id)) },
  { id: 'poultice', title: 'Make a healing poultice',
    text: `Yarrow (feathery, white-flowered, in meadows) heals: pound a <b>Yarrow poultice</b> (${KEY('C')} → Cooking) from 2 yarrow and a plant fiber. Apply it to heal, and to cure poison.`,
    progress: (g) => g.inv.count('poultice') > 0,
    targets: (g) => forage(g, ['yarrow']) },
];

/** The welcome's last word: where your life begins. */
function start(g: Game): string {
  const o = g.origin, prof = professionById(o?.profession);
  if (!o || prof.id === 'wanderer') return `<p><b>You begin with nothing</b>, a wanderer on the edge of the wild. Before anything else, you'll need a camp: shelter, fire, and the means to make the tools to build a life. The guide on the right will show you how.</p>`;
  const rank = o.rank === 'apprentice' ? 'an apprentice' : o.rank === 'journeyman' ? 'a journeyman' : 'a master';
  const how = o.rank === 'apprentice' ? 'The quests on the right walk you through your trade, step by step.'
    : o.rank === 'journeyman' ? 'You know the work: your trade\'s quests wait in your quest log (L) if you want them.'
      : 'Your workshop is set up just outside the village. Your trade\'s quests wait in your quest log (L) if you want them.';
  return `<p><b>You begin as ${rank} ${prof.name.toLowerCase()}</b> in ${o.village ?? 'a village nearby'}, with the tools of your trade. ${how}</p>`;
}

/** Camp is made (or the tutorial's been turned off): the paths open up. */
const campMade = (g: Game) => !!g.quests && (g.quests.off || g.quests.quests.some((q) => q.id === 'camp' && q.status === 'done'));
const doneQuest = (g: Game, id: string) => !!g.quests?.quests.some((q) => q.id === id && q.status === 'done');

/** The trades to learn once camp is made: the first ones (no `after`) open with camp; the rest when one they follow from is done. */
const PATHS: (Omit<QuestDef, 'offer'> & { after?: string[] })[] = [
  // Hunting, and what comes of it.
  { id: 'hunting', title: 'Hunting', path: '🏹', summary: 'Make a spear and bring down your first animal.', steps: HUNTING_STEPS,
    outro: { title: 'A hunter', text: `Every kill is meat and a hide: butcher the one, skin the other.`, msg: 'Quest complete: you can hunt. Butchering and Skinning are open.' } },
  { id: 'butchering', title: 'Butchering', path: '🥩', after: ['hunting'], summary: 'Butcher what you kill and lay in meat.', steps: BUTCHER_STEPS,
    outro: { title: 'A butcher', text: `Raw meat feeds a little and can make you sick: cook it.`, msg: 'Quest complete: you can butcher. Cooking is open.' } },
  { id: 'skinning', title: 'Skinning', path: '🦌', after: ['hunting'], summary: 'Take hides from your kills and pitch a hide tent.', steps: SKIN_STEPS,
    outro: { title: 'A skinner', text: `Hides make tents, bellows and clothing.`, msg: 'Quest complete: you can skin. Tailoring is open.' } },
  { id: 'tailoring', title: 'Tailoring', path: '🧵', after: ['skinning'], summary: 'Cut and stitch hides into boots and a cap.', steps: TAILOR_STEPS,
    outro: { title: 'A tailor', text: `Clothing guards you from bites and blows; a backpack carries more, a quiver holds your arrows.`, msg: 'Quest complete: you can make clothing.' } },
  { id: 'cooking', title: 'Cooking', path: '🍲', after: ['butchering', 'farming'], summary: 'Cook meals over the fire and fill your larder.', steps: COOK_STEPS,
    outro: { title: 'A cook', text: `Cooked food feeds you far better than raw. Stews and bread are the most filling of all.`, msg: 'Quest complete: you can cook.' } },
  // Farming, and grain to bread.
  { id: 'farming', title: 'Farming', path: '🌾', summary: 'Gather wild wheat, till a field, sow and harvest.', steps: FARM_STEPS,
    outro: { title: 'A farmer', text: `A field keeps giving: sow the seeds from each harvest.`, msg: 'Quest complete: you can farm. Grain milling and Cooking are open.' } },
  { id: 'milling', title: 'Grain milling', path: '⚙️', after: ['farming'], summary: 'Build a quern and grind your wheat into flour.', steps: MILL_STEPS,
    outro: { title: 'A miller', text: `Flour is the start of bread.`, msg: 'Quest complete: you can grind flour. Baking is open.' } },
  { id: 'baking', title: 'Baking', path: '🍞', after: ['milling'], summary: 'Mix dough and bake bread at the fire.', steps: BAKE_STEPS,
    outro: { title: 'A baker', text: `From seed to loaf: bread is the most filling food there is.`, msg: 'Quest complete: you can bake bread.' } },
  // Mining, and what's made of stone and iron.
  { id: 'mining', title: 'Mining', path: '⛏️', summary: 'Make a pickaxe, break up boulders and mine iron ore.', steps: MINE_STEPS,
    outro: { title: 'A miner', text: `Stone for building, ore for iron.`, msg: 'Quest complete: you can mine. Smithing and Stonecutting are open.' } },
  { id: 'masonry', title: 'Stonecutting and masonry', path: '🧱', after: ['mining'], summary: 'Mix mortar and lay a stone foundation.', steps: MASON_STEPS,
    outro: { title: 'A mason', text: `Stone outlasts timber: foundations, walls, chimneys, towers and quays.`, msg: 'Quest complete: you can build in stone.' } },
  { id: 'smithing', title: 'Smithing', path: '⚒️', after: ['mining'], summary: 'Build a forge, smelt iron and forge your first iron tool.', steps: SMITH_STEPS,
    outro: { title: 'A smith', text: `Iron tools work faster and last far longer. Quench well for hardness.`, msg: 'Quest complete: you can work iron. Combat is open.' } },
  { id: 'combat', title: 'Combat', path: '⚔️', after: ['smithing'], summary: 'Forge a sword and stand against a wolf.', steps: COMBAT_STEPS,
    outro: { title: 'A fighter', text: `A sword in hand and a fire at your back: the night holds less fear.`, msg: 'Quest complete: you can fight.' } },
  // Woodcutting, and what's made of wood.
  { id: 'woodcutting', title: 'Woodcutting', path: '🪓', summary: 'Fell trees, split kindling and stack a woodpile.', steps: WOOD_STEPS,
    outro: { title: 'A woodcutter', text: `Timber builds and burns.`, msg: 'Quest complete: you can work timber. Carpentry and Charcoal burning are open.' } },
  { id: 'carpentry', title: 'Carpentry', path: '🪚', after: ['woodcutting'], summary: 'Saw refined planks, build a workbench and make furniture.', steps: CARPENTER_STEPS,
    outro: { title: 'A carpenter', text: `A workbench makes chairs, tables, beds, chests and more. Fine furniture by your bed lets you wake well rested.`, msg: 'Quest complete: you can make furniture.' } },
  { id: 'charcoal', title: 'Charcoal burning', path: '⚫', after: ['woodcutting'], summary: 'Build a kiln and burn logs slowly into charcoal.', steps: CHARCOAL_STEPS,
    outro: { title: 'A charcoal burner', text: `Charcoal burns long and hot: the smith's fuel, and towns pay for it.`, msg: 'Quest complete: you can burn charcoal.' } },
  // Paths of their own.
  { id: 'home', title: 'A roof over your head', path: '🏠', summary: 'Build a timber house: floor, walls, a window, a door and a roof, then a bed and a chest.', steps: HOUSE_STEPS,
    outro: { title: 'Welcome home', text: `You've built a house with a bed and a storage chest. Sleep in it to wake there; store your things safely.`, msg: 'Quest complete: you have a home!' } },
  { id: 'fisher', title: 'Fishing', path: '🎣', summary: 'Make a rod, catch fish and cook them.', steps: FISHER_STEPS,
    outro: { title: 'A fisher', text: `Dawn and dusk are best, and deep water holds big fish. A fine rod bites sooner and lands bigger ones.`, msg: 'Quest complete: you can fish.' } },
  { id: 'potter', title: 'Pottery', path: '⚱️', summary: 'Dig clay, throw a jar on the wheel, fire it and carry water.', steps: POTTER_STEPS,
    outro: { title: 'A potter', text: `Clay makes jars for water, crucibles for the smithy and mortar for stone.`, msg: 'Quest complete: you can work clay.' } },
  { id: 'boatwright', title: 'Boatbuilding', path: '🛶', summary: 'Carve a paddle, hollow a dugout canoe and take to the water.', steps: BOAT_STEPS,
    outro: { title: 'Afloat', text: `Bigger hulls follow: rafts, skin boats, rowing boats and, on a slipway, ships.`, msg: 'Quest complete: you have a boat.' } },
  { id: 'forager', title: 'Foraging and herbs', path: '🌿', summary: 'Learn the wild plants and mushrooms, and make medicine.', steps: FORAGER_STEPS,
    outro: { title: 'A herbalist', text: `Herbs heal and cure; mushrooms feed or poison. Keep learning.`, msg: 'Quest complete: you know the wild plants.' } },
];

/** The paths a path opens, once it's done. */
export const PATH_AFTER: Record<string, string[] | undefined> = Object.fromEntries(PATHS.map((d) => [d.id, d.after]));

export const QUESTS: QuestDef[] = [
  { id: 'camp', title: 'Make camp', tutorial: true,
    summary: 'Start with nothing: make your first tools, then set up a camp with a chopping block, a fire and a lean-to.',
    steps: CAMP_STEPS,
    outro: { title: 'Camp is made',
      text: `You've made your first tools and set up camp: a chopping block, a fire and a lean-to. From here, choose what to learn next: each path teaches a trade from the raw material to the finished thing. Press ${KEY('L')} to see them all.`,
      msg: 'Quest complete: your camp is made! Choose a path to learn next (L).' } },
  ...PATHS.map((d) => ({ ...d, offer: (g: Game) => campMade(g) && (!d.after || d.after.some((a) => doneQuest(g, a))) })),
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
  /** Paths just opened (camp made, or a trade learned): the board of them waits to be shown. */
  private choose: { from: string; tries: number } | null = null;
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
      // (Saves from before camp was its own quest: the old first-house quest splits into camp, and the house path.)
      const raw = d.quests.some((q) => q.id === 'camp') ? d.quests : d.quests.flatMap((q) => (q.id === 'home' ? splitOldHome(q, q.stepId ?? FIRST_HOME_ORDER[q.step]) : [q]));
      log.quests = raw.filter((q) => DEF.has(q.id)).map((q) => {
        const steps = DEF.get(q.id)!.steps;
        let step = q.step;
        const at = q.stepId ? steps.findIndex((s) => s.id === q.stepId) : -1;
        if (at >= 0) step = at;
        // (A step that's since gone: start the quest over, and what's done ticks off by itself.)
        else if (q.stepId) step = 0;
        return { ...q, step: Math.min(steps.length, step) };
      });
      log.off = d.off;
    } else {
      // The old single tutorial: camp, then the house.
      const q: QuestState = { id: 'home', status: d.done ? 'done' : 'active', step: d.step, tracked: true, anchor: d.anchor, start: d.start };
      log.quests.push(...splitOldHome(q, d.done ? undefined : FIRST_HOME_ORDER[d.step]));
      log.off = d.done && d.step < FIRST_HOME_ORDER.length;
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
    this.quests = this.quests.filter((q) => q.id !== 'camp');
    this.quests.unshift({ id: 'camp', status: 'active', step: 0, tracked: true, anchor: null, start: { x, z } });
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

  /** A new game: what Survivalcrafter is, and where you begin. */
  private welcome(g: Game) {
    g.tips.add('welcome');
    telemetry.event('quest', 'welcome shown');
    g.ui.showNotice('Welcome to Survivalcrafter',
      `<p>This is a living medieval world. Its towns trade, its lords rule, its people work, eat, sleep and gossip, all without waiting for you. You are one more life in it.</p>
      <p><b>Make your own way.</b> Fell trees, burn charcoal, smith iron, weave cloth, sail between harbours, or rule from a castle. Every trade is hands-on: you split the logs, work the bellows and throw the pots yourself, and you get better the more you do.</p>
      <p><b>Nothing is off-limits.</b> Serve your master faithfully, or rob him blind. Rise to the high table, or slip away into the forest and start again. The world will remember what you did.</p>
      ${start(g)}
      <p class="notice-note">In this early version, your profession sets where you begin, what you know and what you carry, and starts your trade's quests. Working under a master for wages, customers, and running a business of your own are coming, as are lives beyond the trades.</p>`,
      'Begin', () => { this.timer = 0; }, { kind: 'lesson' });
  }

  /** Paths open: camp made (the first trades to learn) or a trade learned (the ones that follow from it). Choose as many as you like. */
  private showPaths(g: Game, ids: string[], from: string) {
    const paths = this.quests.filter((q) => ids.includes(q.id));
    const cards = paths.map((q) => {
      const d = DEF.get(q.id)!, on = q.status === 'active';
      return `<button class="path-card${on ? ' on' : ''}" data-path="${d.id}"><span class="path-icon">${d.path}</span><b>${d.title}</b><small>${d.summary}</small><em>${on ? '✓ Started' : `${d.steps.length} steps · click to start`}</em></button>`;
    }).join('');
    telemetry.event('quest', 'paths shown');
    const camp = from === 'camp', learned = DEF.get(from)?.title ?? '';
    const box = g.ui.showNotice(camp ? 'Camp is made!' : `New paths: ${learned} leads on`,
      (camp
        ? `<p>Well done: you've made your first tools, and you have a fire to cook by and a roof of sorts to sleep under. You could live like this. Or you could learn a trade.</p>
          <p>Each path below starts one of the world's trades. Finish one and the trades that follow from it open up (hunting leads to butchering and skinning, skinning to tailoring...). <b>Start as many as you like</b>, in any order; the rest wait in your quest log (${KEY('L')}).</p>`
        : `<p>You've learned <b>${learned.toLowerCase()}</b>. It opens the way to the trades that follow from it. Start any you like now, or later from your quest log (${KEY('L')}).</p>`)
      + `<div class="path-grid">${cards}</div>`,
      'Let\'s go', () => { this.timer = 0; }, { kind: 'wide' });
    let first = true;
    box.querySelectorAll<HTMLElement>('.path-card').forEach((c) => c.addEventListener('click', () => {
      const id = c.dataset.path!;
      if (c.classList.contains('on')) return;
      this.accept(id, true);
      // (The first one chosen is the one pointed out in the world.)
      if (first) { this.focus(id); first = false; }
      c.classList.add('on');
      c.querySelector('em')!.textContent = '✓ Started';
      telemetry.event('quest', `path chosen: ${id}`);
    }));
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
    const free = !g.working && !g.action && !g.ui.modalOpen && !g.ui.anyWindowOpen();
    // A new wanderer, waking up: what the game is about, before anything else.
    if (!g.tips.has('welcome') && free && g.newGame) { this.welcome(g); return; }
    // New quests, when their time comes.
    for (const d of QUESTS) {
      if (!d.offer || this.quests.some((q) => q.id === d.id) || (d.tutorial && this.off) || !d.offer(g)) continue;
      const p = g.player.pos;
      // (The paths open up together, quietly: they're chosen from a board, not announced one by one.)
      if (d.path) { this.quests.push({ id: d.id, status: 'offered', step: 0, tracked: false, anchor: null, start: { x: p.x, z: p.z } }); this.changed(); continue; }
      this.quests.push({ id: d.id, status: 'offered', step: 0, tracked: false, anchor: null, start: { x: p.x, z: p.z } });
      this.offered.set(d.id, this.time);
      telemetry.event('quest', `${d.id} offered`);
      g.msg(`New quest: ${d.title}. Open your quests (L) to take it up.`, 'good');
      // The first one: stop and show how quests work (once you're not in the middle of something).
      if (!g.tips.has('quest_intro')) this.introFor ??= d.id;
      flashOffer = true;
      this.changed();
    }
    if (this.choose && free) {
      // (The paths it opens are offered on the next look round: give them a moment to appear.)
      const ids = this.quests.filter((q) => q.status === 'offered' && DEF.get(q.id)?.path && (this.choose!.from === 'camp' ? !PATH_AFTER[q.id] : PATH_AFTER[q.id]?.includes(this.choose!.from))).map((q) => q.id);
      if (ids.length) { const from = this.choose.from; this.choose = null; this.showPaths(g, ids, from); }
      else if (++this.choose.tries > 5) this.choose = null;
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
        // Camp made, or a trade learned: the paths it opens, to choose from.
        if (q.id === 'camp' || Object.values(PATH_AFTER).some((a) => a?.includes(q.id))) this.choose = { from: q.id, tries: 0 };
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
/**
 * An old first-house quest (from before camp was a quest of its own), at the
 * step it had reached: still making camp, or camp made and on to the house.
 */
function splitOldHome(q: QuestState, stepId: string | undefined): QuestState[] {
  const camp = CAMP_STEPS.findIndex((st) => st.id === stepId), house = HOUSE_STEPS.findIndex((st) => st.id === stepId);
  if (q.status !== 'done' && camp >= 0) return [{ ...q, id: 'camp', step: camp, stepId }];
  const done: QuestState = { ...q, id: 'camp', status: 'done', step: CAMP_STEPS.length, stepId: undefined };
  return [done, { ...q, step: q.status === 'done' ? HOUSE_STEPS.length : Math.max(0, house), stepId: house >= 0 ? stepId : undefined }];
}

const isDone = (p: [number, number] | boolean) => (Array.isArray(p) ? p[0] >= p[1] : p);

/** The make-camp quest's step ids, in order (for tests). */
export const ONBOARDING_STEPS = CAMP_STEPS.map((s) => s.id);
