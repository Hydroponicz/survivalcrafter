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
    text: `Walk with ${KEY('W')}${KEY('A')}${KEY('S')}${KEY('D')} and look around with the mouse. ${KEY('Shift')} runs, ${KEY('Space')} jumps. Press ${KEY('H')} any time for the full guide.`,
    progress: (g, q) => Math.hypot(g.player.pos.x - q.start.x, g.player.pos.z - q.start.z) > 6 },
  { id: 'fiber', title: 'Gather plant fiber',
    text: `Fiber grass grows in open meadows. Aim at a tuft (the arrow shows the nearest) and ${KEY('Left click')} to pick it. You'll twist the fiber into cordage for your tools.`,
    progress: (g) => has(g, 'plant_fiber', 6),
    targets: (g) => forage(g, ['fiber_grass', 'reeds']),
    far: 'None close by: head for open grassland or a lake shore (reeds give fiber too).' },
  { id: 'branch', title: 'Collect branches',
    text: `Pick up fallen branches on the forest floor, or aim at a tree with bare hands and use ${KEY('Right click')} → <b>Collect branch</b>. Branches become tool handles.`,
    progress: (g) => has(g, 'branch', 3),
    targets: (g) => { const f = forage(g, ['fallen_branch', 'driftwood']); return f.length ? f : trees(g, true); },
    far: 'None close by: head into the woods.' },
  { id: 'stones', title: 'Find small rocks',
    text: 'Small rocks lie loose on shores and around bare rock. Pick up three: two you\'ll knap into a knife, and one becomes the head of your hatchet.',
    // (Rocks already made into tools count.)
    progress: (g) => [Math.min(3, g.inv.count('rock_shard') + (hasTool(g, 'knife') ? 2 : 0) + (hasTool(g, 'hatchet') ? 1 : 0)), 3],
    targets: (g) => forage(g, ['pebbles']),
    far: 'None close by: look along a shore or at the foot of a rocky slope.' },
  { id: 'knife', title: 'Knap a stone knife',
    text: `Your first tool. Press ${KEY('C')} to open crafting and, under <b>Primitive</b>, make a <b>Stone knife</b> from two small rocks. It's knapped: strike flakes off the edge of the stone until it has the shape of a blade. You'll need the knife for kindling, shafts, butchering and much more.`,
    progress: (g) => hasTool(g, 'knife') },
  { id: 'cordage', title: 'Twist some cordage',
    text: `Press ${KEY('C')} to open crafting. Under <b>Primitive</b>, craft <b>Cordage</b> (3 fiber): it lashes the hatchet's stone to its handle. Crafting takes a moment; you can keep the window open.`,
    progress: (g) => g.inv.count('cordage') > 0 || hasTool(g, 'hatchet') },
  { id: 'hatchet', title: 'Make a stone hatchet',
    text: `In crafting (${KEY('C')}), make a <b>Stone hatchet</b>: a branch, a stone and cordage. It fells trees and splits logs.`,
    progress: (g) => hasTool(g, 'hatchet') },
  { id: 'fell', title: 'Fell a tree',
    text: `Put the hatchet in your hand from the hotbar (${KEY('1')}-${KEY('9')}), aim at a grown tree and ${KEY('Left click')} to chop. Keep at it until it falls. Logs are heavy: they land on the ground, and you pick them up from the pile.`,
    // Done once your first tree is down and its logs are lying in a pile.
    progress: (g, q) => !!q.flags?.includes('felled') || g.inv.count('log') > 0 || g.inv.count('plank') > 0,
    targets: (g) => trees(g),
    far: 'No grown trees close by: head for the woods.' },
  { id: 'block', title: 'Set up a chopping block',
    text: `Pick up the logs from the pile where your tree fell (aim at it, ${KEY('Right click')} → <b>Take all</b>). Logs are split on a <b>chopping block</b>: press ${KEY('B')}, pick <b>Chopping block</b> (Crafting), place it on open ground, then with your hatchet in hand aim at it and ${KEY('Left click')} to build it. It takes one log.`,
    progress: (g) => g.inv.count('plank') >= 5 || [...g.world.near(g.player.pos.x, g.player.pos.z, 40)].some((o) => o.kind === 'structure' && o.type === 'chopping_block' && o.built),
    targets: (g) => { const p = plans(g, ['chopping_block']); return p.length || g.inv.count('log') > 0 ? p : logPiles(g); } },
  { id: 'planks', title: 'Split rough planks',
    text: `At your chopping block, open crafting (${KEY('C')}) and under <b>Woodworking</b> pick <b>Split log into rough planks</b>, with the hatchet in your hand: stand the log on the block and split it, 2 planks a log. Rough planks are what you build with: one for your hammer, and the first floor needs 4. (Later, an iron saw cuts <b>refined planks</b> for fine furniture.)`,
    // (A plank already made into the hammer counts.)
    progress: (g) => [Math.min(5, g.inv.count('plank') + (g.inv.count('wooden_hammer') > 0 ? 1 : 0)), 5],
    // The logs still lying about until you've picked them up; then your chopping block.
    targets: (g) => (g.inv.count('log') > 0 ? blocks(g) : logPiles(g)) },
  { id: 'hammer', title: 'Make a wooden hammer',
    text: `Your building tool. Carve a <b>Shaft</b> from a branch with your knife (Woodworking), then under <b>Primitive</b> make a <b>Wooden hammer</b>: the shaft and one rough plank. You drive the handle into the head with a rock.`,
    progress: (g) => hasTool(g, 'hammer') },
  { id: 'floor', title: 'Lay the floor',
    text: `Press ${KEY('B')} to build and pick <b>Wooden floor</b>. Find level ground, ${KEY('Left click')} to place the plan, then hold your hammer, aim at the plan and ${KEY('Left click')} to build it, one plank at a time. Your house is four floors in a square (4 × 4 m): aim at the edge of a built floor and the next plan snaps beside it. Each floor takes 4 planks.`,
    progress: (g, q) => [Math.min(4, builtNear(g, q, ['floor'], 4)), 4],
    targets: (g) => plans(g, ['floor']) },
  { id: 'walls', title: 'Raise the walls',
    text: `Pick a wall in the build menu (${KEY('B')}) and aim at the floor's edge: the plan snaps into place. Each side of the house takes two 2 m walls, eight in all: build six walls now and leave two gaps, one for a window and one for the door. <b>Log walls</b> need only 4 logs each and your hatchet; plank walls need planks and shafts.`,
    progress: (g, q) => [Math.min(6, builtNear(g, q, WALLS)), 6],
    targets: (g) => plans(g, WALLS) },
  { id: 'window', title: 'Put in a window',
    text: `In one gap, plan a <b>Windowed wall</b> (${KEY('B')} → Walls): planks around a framed opening. It takes 4 planks and 3 shafts (carve branches with your knife: <b>Woodworking → Shaft</b>).`,
    progress: (g, q) => builtNear(g, q, ['window_wall']) > 0,
    targets: (g) => plans(g, ['window_wall']) },
  { id: 'door', title: 'Hang a door',
    text: `Plan a <b>Wooden door</b> in the last gap. It takes planks, shafts and a cordage.`,
    progress: (g, q) => builtNear(g, q, ['door']) > 0,
    targets: (g) => plans(g, ['door']) },
  { id: 'roof', title: 'Put a roof on',
    text: `Plan a <b>Thatch roof</b> (${KEY('B')} → Roofs & stairs): aim at the top of a wall and its low edge snaps on. Two pieces on each long side slope up to meet in the middle: four in all. Each takes 3 planks and 8 plant fiber.`,
    progress: (g, q) => [Math.min(4, builtNear(g, q, ['roof'])), 4],
    targets: (g) => plans(g, ['roof']) },
  { id: 'gables', title: 'Close the roof ends',
    text: `The two ends of the roof are open triangles. Plan a <b>Gable</b> (${KEY('B')} → Roofs & stairs) on top of an end wall, under the roof's edge: two at each end, turned to face each other (${KEY('Q')} / ${KEY('E')} or the mouse wheel turns a plan). Each takes 2 planks.`,
    progress: (g, q) => [Math.min(4, builtNear(g, q, ['gable'])), 4],
    targets: (g) => plans(g, ['gable']) },
  { id: 'hides', title: 'Hunt for hides',
    text: `A bed needs two hides. Craft a <b>Stone spear</b> (or a bow and arrows), find deer (or a boar, if you're brave: they fight back). With the spear in hand, ${KEY('Left click')} to strike whatever's in front of you; a boar lowers its head before it charges, so step back or aside. Then hold your knife and <b>Butcher</b> the carcass.`,
    progress: (g) => has(g, 'hide', 2),
    targets: (g) => game(g),
    far: 'No animals in sight: deer graze in meadows and at the edges of woods. Explore a little.' },
  { id: 'bed', title: 'Build a bed',
    text: `Plan a <b>Bed</b> (${KEY('B')} → Furniture) inside your house and build it with your hammer. Sleeping in it makes it your home: you wake there if you die.`,
    progress: (g, q) => builtNear(g, q, ['bed']) > 0,
    targets: (g) => plans(g, ['bed']) },
  { id: 'chest', title: 'Build a storage chest',
    text: `Last, a <b>Storage chest</b> (${KEY('B')} → Furniture): 8 planks. It holds 300 kg, so you can keep what you gather safe at home.`,
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
    text: `Your water is running low, and it falls faster than food. Find fresh water (a river, stream or lake: the arrow points to the nearest), aim at it and ${KEY('Left click')} to <b>Drink</b>.`,
    progress: (_g, q) => flagged(q, 'drank'),
    targets: (g) => water(g),
    far: 'No water close by: head downhill; streams run in the valleys.' },
  { id: 'full', title: 'Drink your fill',
    text: `Keep drinking until you're no longer thirsty (the blue bar). Drinking goes on by itself while you stand there.`,
    progress: (g) => [Math.min(85, Math.round(g.player.water)), 85],
    targets: (g) => water(g) },
];

const FOOD_STEPS: Step[] = [
  { id: 'mushroom', title: 'Pick a mushroom',
    text: `You're getting hungry. Mushrooms grow on the forest floor and in wet ground: pick one (or a few). Wild mushrooms come in many kinds, and you won't know at first which is which.`,
    progress: (_g, q) => flagged(q, 'picked_mushroom'),
    targets: (g) => forage(g, MUSHROOMS.map((s) => s.id)),
    far: 'None close by: look in the woods, especially damp ones.' },
  { id: 'journal', title: 'Open your field journal',
    text: `Press ${KEY('J')}. Your <b>field journal</b> keeps every wild plant and mushroom you've come across: what it looks like, where you found it, and, once you know, what it is. Some are good to eat; some are <b>poisonous</b>.`,
    progress: (_g, q) => flagged(q, 'journal') },
  { id: 'identify', title: 'Identify a mushroom',
    text: `An unknown mushroom is a gamble to eat. Learn what it is: pick with care (your Foraging and Herbalism help you recognise them), <b>Study</b> one from your pack, or handle enough of a kind to know it. The journal shows what you've learned.`,
    progress: () => MUSHROOM_ITEMS.some((t) => isIdentified(t)) },
  { id: 'eat', title: 'Eat something safe',
    text: `Eat something you know is safe: berries, or a mushroom you've identified as edible (open your pack and <b>Eat</b>). Cooked on a campfire, mushrooms and meat feed you far more.`,
    progress: (_g, q) => flagged(q, 'ate') },
  { id: 'spear', title: 'Make a stone spear',
    text: `For real food, hunt. In crafting (${KEY('C')}), under <b>Primitive</b>, make a <b>Stone spear</b>: two branches, a small rock and cordage. (Or a <b>bow</b> and <b>arrows</b>, if you've found flint and feathers.)`,
    progress: (g) => g.inv.items.some((i) => itemDef(i.type).tool === 'weapon' || itemDef(i.type).tool === 'bow') },
  { id: 'boar', title: 'Hunt a boar',
    text: `Boars root about at the edges of the woods. They fight back. With the spear in hand, ${KEY('Left click')} to strike what's in front of you. When the boar <b>lowers its head and shudders</b>, it's about to charge: step back or aside, then strike again. If you're hurt, get clear before you bandage up.`,
    progress: (_g, q) => flagged(q, 'killed_boar'),
    targets: (g) => boars(g),
    far: 'No boars in sight: they root at the edges of the woods. Explore a little.' },
  { id: 'butcher', title: 'Butcher the boar',
    text: `Hold your knife, aim at the carcass and use <b>Butcher corpse</b>: meat, and a hide if you work cleanly. Cook the meat on a campfire before you eat it.`,
    progress: (_g, q) => flagged(q, 'butchered'),
    targets: (g) => carcasses(g) },
];

const BANDAGE_STEPS: Step[] = [
  { id: 'fiber', title: 'Gather plant fiber',
    text: `A bandage takes 4 plant fiber. Pick fiber grass in the meadows (or reeds by the water).`,
    progress: (g) => [Math.min(4, g.inv.count('plant_fiber') + g.inv.count('bandage') * 4), 4],
    targets: (g) => forage(g, ['fiber_grass', 'reeds']) },
  { id: 'make', title: 'Twist a bandage',
    text: `In crafting (${KEY('C')}), under <b>Primitive</b>, make a <b>Bandage</b>. It goes on your hotbar.`,
    progress: (g, q) => g.inv.count('bandage') > 0 || flagged(q, 'bandaged') },
  { id: 'apply', title: 'Bind your wounds',
    text: `Away from any fight, <b>Apply</b> the bandage (from your pack, or its hotbar key). It takes a few seconds: stand still. It heals 25 health, slowly.`,
    progress: (_g, q) => flagged(q, 'bandaged') },
];

/** Dusk: the sun low and going down (the first evening you see, in practice your first day). */
const dusk = (g: Game) => {
  const f = g.world.dayFraction;
  return f > 0.69 && f < 0.85;
};

const LIGHT_STEPS: Step[] = [
  { id: 'materials', title: 'Gather what a torch needs',
    text: `A torch is a branch with its head wrapped in plant fiber and packed with kindling. Gather a <b>branch</b> and <b>2 plant fiber</b>.`,
    progress: (g) => {
      const torches = g.inv.count('torch');
      return [Math.min(3, Math.min(1, g.inv.count('branch') + torches) + Math.min(2, g.inv.count('plant_fiber') + torches * 2)), 3];
    },
    targets: (g) => { const f = forage(g, ['fiber_grass', 'reeds', 'fallen_branch']); return f.length ? f : trees(g, true); },
    far: 'Fiber grass grows in open meadows; branches lie in the woods.' },
  { id: 'kindling', title: 'Make kindling',
    text: `In crafting (${KEY('C')}), under <b>Primitive</b>, whittle <b>Kindling (from branch)</b> with a knife (no knife yet? knap a <b>Stone knife</b> from two small rocks first). You'll need another branch to make the torch itself.`,
    progress: (g) => g.inv.count('kindling') > 0 || g.inv.count('torch') > 0 },
  { id: 'torch', title: 'Make a torch',
    text: `In crafting (${KEY('C')}), under <b>Primitive</b>, make a <b>Torch</b>: a branch, 2 plant fiber and a kindling. You light it with a bow drill: keep the bow moving until it catches.`,
    progress: (g) => g.inv.count('torch') > 0 },
  { id: 'hold', title: 'Light your way',
    text: `Put the torch in your hand from the hotbar (${KEY('1')}-${KEY('9')}). It lights the ground around you. To light a spot, aim at soft ground (grass, dirt, sand, clay: not rock) and ${KEY('Left click')} to plant it there; pick it up again any time. A torch burns about three days, in your hand or planted; a spent one is relit with a kindling and a branch.`,
    progress: (g) => g.activeItem()?.type === 'torch' },
];

export const QUESTS: QuestDef[] = [
  { id: 'home', title: 'A roof over your head', tutorial: true,
    summary: 'From bare hands to a first house, with a bed to sleep in and a chest for your things.',
    steps: HOME_STEPS,
    outro: { title: 'Welcome home',
      text: `You've built a house with a bed and a storage chest. From here: cook on a campfire, farm wheat, dig clay and set up a smithy. ${KEY('H')} has the full guide.`,
      msg: 'Quest complete: you have a home, a bed and somewhere to keep your things. The wilderness is yours.' } },
  { id: 'light', title: 'Light in the dark', tutorial: true,
    summary: 'Night is coming. Make a torch to see by.',
    offer: dusk,
    steps: LIGHT_STEPS,
    outro: { title: 'Lights in the night',
      text: `A torch is a light to carry, but it burns out. For steadier light: a <b>campfire</b> (${KEY('B')} → build one, add fuel, and light it with a bow drill) lights up your camp, cooks your food and warms you while it has fuel; a lit <b>forge</b> glows as it heats metal. Fires burn down too: feed them branches, kindling or logs.`,
      msg: 'Quest complete: you have a torch to see by. Campfires and a lit forge light the night too, as long as you keep them fed.' } },
  { id: 'water', title: 'Something to drink', tutorial: true,
    summary: 'You\'re getting thirsty. Find fresh water and drink.',
    offer: (g) => g.player.water < 50,
    steps: WATER_STEPS,
    outro: { title: 'Water',
      text: `Water runs low faster than food, and when it's gone you lose health. Drink from rivers, streams and lakes. To carry water with you, make <b>clay jars</b>: dig clay by the water, shape a jar (Pottery) and fire it in a campfire, then aim at water and <b>Fill clay jar</b>, and drink from your pack.`,
      msg: 'Quest complete: you know where to find water. Clay jars let you carry it.' } },
  { id: 'food', title: 'Living off the land', tutorial: true,
    summary: 'You\'re getting hungry. Forage safely, then hunt.',
    offer: (g) => g.player.food < 50,
    steps: FOOD_STEPS,
    outro: { title: 'A hunter-gatherer',
      text: `Forage what you know, learn what you don't (${KEY('J')} keeps track), and hunt for meat and hides. Cook meat on a campfire: raw, it may turn your stomach. Hides make clothing and a bed.`,
      msg: 'Quest complete: you can feed yourself from the land.' } },
  { id: 'bandages', title: 'Patch yourself up', tutorial: true,
    summary: 'You\'re hurt. Make a bandage and bind your wounds, away from any fight.',
    offer: (g) => g.tips.has('health_ok'),
    steps: BANDAGE_STEPS,
    outro: { title: 'Bandaged',
      text: `Health comes back slowly on its own while you're fed and watered; a bandage heals 25 more over the next while. Keep a few on your hotbar, and remember: get clear of a fight before you bind a wound.`,
      msg: 'Quest complete: keep a few bandages on you.' } },
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
  private lastHtml = '';
  /** Quests just finished (shown in the panel a while) and just offered (likewise), by id, with when. */
  private finished = new Map<string, number>();
  private offered = new Map<string, number>();
  /** The first quest offered, waiting for a quiet moment to explain the quest log. */
  private introFor: string | null = null;
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
    this.lastHtml = '';
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
    this.lastHtml = '';
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
      <p>Quests come to you as you go: this one runs <b>alongside</b> your house, not instead of it. You can follow several at once.</p>
      <p>Your <b>quest log</b> (${KEY('L')}) holds them all. There you:</p>
      <ul>
        <li><b>Accept</b> a new quest to take it up. It shows in the panel on the right while it's <b>tracked</b>.</li>
        <li><b>Point it out</b>: one quest at a time has what it needs marked in the world, with <span style="color:#8fd0ff">blue rings</span> on the ground and an arrow. Point out the quest you want to work on now, and switch back whenever you like.</li>
        <li><b>Untrack</b> a quest to set it aside: it keeps its progress for later.</li>
      </ul>
      <p>Let's take this one up now.</p>`,
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
      g.msg(`New quest: ${d.title}. Open your quests (L) to take it up.`, 'good');
      // The first one: stop and show how quests work (once you're not in the middle of something).
      if (!g.tips.has('quest_intro')) this.introFor ??= d.id;
      flashOffer = true;
      this.changed();
    }
    if (this.introFor && !g.working && !g.ui.modalOpen && !g.ui.anyWindowOpen()) this.intro(g, this.introFor);
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
        q.step++;
        flash = true;
        this.changed();
      }
      if (q.step >= d.steps.length) {
        q.status = 'done';
        this.finished.set(q.id, this.time);
        g.msg(d.outro.msg, 'good');
        this.changed();
      }
    }
    for (const [id, t] of this.finished) if (this.time - t > 20) { this.finished.delete(id); this.lastHtml = ''; }
    // (Offers waiting from an earlier session show again.)
    for (const q of this.quests) if (q.status === 'offered' && DEF.get(q.id)?.tutorial && !this.offered.has(q.id)) { this.offered.set(q.id, this.time); this.lastHtml = ''; }
    // An offer stays in the panel until you take it up (a tutorial one), or a while (others).
    for (const [id, t] of this.offered) {
      const q = this.quests.find((x) => x.id === id);
      if (q?.status !== 'offered' || (!DEF.get(id)?.tutorial && this.time - t > 45)) { this.offered.delete(id); this.lastHtml = ''; }
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
        <div class="tut-hint quest-how">Press ${KEY('L')} for your quest log: <b>Accept</b> it, then <b>Point it out</b> to have what it needs marked in the world.</div></div>`;
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
