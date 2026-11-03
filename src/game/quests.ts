import * as THREE from 'three';
import { itemDef } from '../data/items';
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
  { id: 'stones', title: 'Find loose stones',
    text: 'Loose pebbles lie on shores and around bare rock. Pick up a few: they become the heads of your tools.',
    progress: (g) => has(g, 'rock_shard', 2),
    targets: (g) => forage(g, ['pebbles']),
    far: 'None close by: look along a shore or at the foot of a rocky slope.' },
  { id: 'cordage', title: 'Twist some cordage',
    text: `Press ${KEY('C')} to open crafting. Under <b>Primitive</b>, craft <b>Cordage</b> twice (3 fiber each). Crafting takes a moment; you can keep the window open.`,
    progress: (g) => {
      const tools = (hasTool(g, 'hatchet') ? 1 : 0) + (hasTool(g, 'hammer') ? 1 : 0);
      return [Math.min(2, g.inv.count('cordage') + tools), 2];
    } },
  { id: 'hatchet', title: 'Make a stone hatchet',
    text: `In crafting (${KEY('C')}), make a <b>Stone hatchet</b>: a branch, a stone and cordage. It fells trees and splits logs.`,
    progress: (g) => hasTool(g, 'hatchet') },
  { id: 'hammer', title: 'Make a stone hammer',
    text: `Now a <b>Stone hammer</b> (same materials). You build most things with it.`,
    progress: (g) => hasTool(g, 'hammer') },
  { id: 'fell', title: 'Fell a tree',
    text: `Put the hatchet in your hand from the hotbar (${KEY('1')}-${KEY('9')}), aim at a grown tree and ${KEY('Left click')} to chop. Keep at it until it falls. Logs are heavy: they land on the ground, and you pick them up from the pile.`,
    // Done once your first tree is down and its logs are lying in a pile.
    progress: (g, q) => !!q.flags?.includes('felled') || g.inv.count('log') > 0 || g.inv.count('plank') > 0,
    targets: (g) => trees(g),
    far: 'No grown trees close by: head for the woods.' },
  { id: 'planks', title: 'Split rough planks',
    text: `Pick up the logs from the pile where your tree fell (aim at it, ${KEY('Right click')} → <b>Take all</b>). Then, in crafting (${KEY('C')}), under <b>Woodworking</b>, <b>Split log into rough planks</b> with your hatchet: 2 a log. Rough planks are what you build with; the first floor needs 4. (Later, an iron saw cuts <b>refined planks</b> for fine furniture.)`,
    progress: (g) => has(g, 'plank', 4),
    // The logs still lying about, until you've picked them up.
    targets: (g) => (g.inv.count('log') > 0 ? [] : logPiles(g)) },
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
    text: `A bed needs two hides. Craft a <b>Stone spear</b>, find deer (or a boar, if you're brave: they fight back), and ${KEY('Left click')} to strike. Then hold your knife and <b>Butcher</b> the carcass.`,
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
    text: `In crafting (${KEY('C')}), under <b>Primitive</b>, whittle <b>Kindling (from branch)</b> with your knife. You'll need another branch to make the torch itself.`,
    progress: (g) => g.inv.count('kindling') > 0 || g.inv.count('torch') > 0 },
  { id: 'torch', title: 'Make a torch',
    text: `In crafting (${KEY('C')}), under <b>Primitive</b>, make a <b>Torch</b>: a branch, 2 plant fiber and a kindling. You light it with a bow drill: keep the bow moving until it catches.`,
    progress: (g) => g.inv.count('torch') > 0 },
  { id: 'hold', title: 'Light your way',
    text: `Put the torch in your hand from the hotbar (${KEY('1')}-${KEY('9')}). It lights the ground around you, but it burns down: put it away (${KEY('0')}) when you don't need it, and make more as you go.`,
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
  private glows: THREE.Sprite[] = [];
  private targets: Target[] = [];
  private timer = 0;
  private time = 0;
  private lastHtml = '';
  /** Quests just finished (shown in the panel a while) and just offered (likewise), by id, with when. */
  private finished = new Map<string, number>();
  private offered = new Map<string, number>();
  /** Called when something the quest log shows has changed. */
  onChange?: () => void;

  constructor(glow: THREE.Texture) {
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false });
    // A downward arrow: a cone tip under a short shaft.
    const geo = new THREE.ConeGeometry(0.32, 0.6, 16).rotateX(Math.PI).translate(0, 0.3, 0);
    const shaft = new THREE.CylinderGeometry(0.11, 0.11, 0.55, 10).translate(0, 0.85, 0);
    this.arrow = new THREE.Mesh(geo, arrowMat);
    this.arrow.add(new THREE.Mesh(shaft, arrowMat));
    this.arrow.renderOrder = 8;
    this.group.add(this.arrow);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd36a, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      s.renderOrder = 7;
      this.glows.push(s);
      this.group.add(s);
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
      log.quests = d.quests.filter((q) => DEF.has(q.id)).map((q) => ({ ...q, step: Math.min(DEF.get(q.id)!.steps.length, q.step) }));
      log.off = d.off;
    } else {
      // The old single tutorial is the first-house quest.
      log.quests.push({ id: 'home', status: d.done ? 'done' : 'active', step: Math.min(HOME_STEPS.length, d.step), tracked: true, anchor: d.anchor, start: d.start });
      log.off = d.done && d.step < HOME_STEPS.length;
    }
    return log;
  }

  serialize(): QuestSave {
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

  /** Offer what's due, move quests on as their steps are done, and redraw the panel. */
  private check(g: Game) {
    // New quests, when their time comes.
    for (const d of QUESTS) {
      if (!d.offer || this.quests.some((q) => q.id === d.id) || (d.tutorial && this.off) || !d.offer(g)) continue;
      const p = g.player.pos;
      this.quests.push({ id: d.id, status: 'offered', step: 0, tracked: false, anchor: null, start: { x: p.x, z: p.z } });
      this.offered.set(d.id, this.time);
      g.msg(`New quest: ${d.title}. Open your quests (L) to take it up.`, 'good');
      this.changed();
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
    for (const [id, t] of this.offered) if (this.time - t > 45) { this.offered.delete(id); this.lastHtml = ''; }

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
        <div class="tut-hint quest-how">Press ${KEY('L')} to open your quests and take it up. You can follow several quests at once, and choose which show here.</div></div>`;
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
    this.render(html, flash);
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
    this.targets = this.targets.filter((t) => g.world.objects.has(t.id) || g.world.animals.some((a) => a.id === t.id && a.hp > 0));
    // Animals move: follow them.
    for (const t of this.targets) {
      const a = g.world.animals.find((x) => x.id === t.id);
      if (a) { t.x = a.x; t.z = a.z; t.y = g.world.terrain.heightAt(a.x, a.z) + 1.9; }
    }
    const first = this.targets[0];
    this.group.visible = !!first;
    const cam = g.camera.position;
    this.glows.forEach((s, i) => {
      const t = this.targets[i];
      s.visible = !!t;
      if (!t) return;
      const d = Math.hypot(t.x - cam.x, t.z - cam.z);
      const k = Math.max(0.9, d / 18);
      s.position.set(t.x, t.y, t.z);
      s.scale.setScalar(k * (1.1 + Math.sin(this.time * 4 + i) * 0.15));
      (s.material as THREE.SpriteMaterial).opacity = i === 0 ? 0.95 : 0.6;
    });
    if (!this.edge) return;
    if (!first) { this.edge.style.display = 'none'; return; }
    const d = Math.hypot(first.x - cam.x, first.z - cam.z);
    const k = Math.max(1, d / 14);
    this.arrow.position.set(first.x, first.y + 0.9 * k + Math.sin(this.time * 3.5) * 0.15 * k, first.z);
    this.arrow.scale.setScalar(k);
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

const isDone = (p: [number, number] | boolean) => (Array.isArray(p) ? p[0] >= p[1] : p);

/** The first-house quest's step ids, in order (for tests). */
export const ONBOARDING_STEPS = HOME_STEPS.map((s) => s.id);
