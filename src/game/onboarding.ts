import * as THREE from 'three';
import { itemDef } from '../data/items';
import type { ToolKind } from '../data/items';
import type { StructureObj } from '../world/world';
import type { Game } from './game';

// The tutorial quest on a new world: from bare hands to a first house with a
// bed and a storage chest. Each step says what to do and how; the things it
// needs are picked out in the world (a glow on the nearest few and an arrow
// over the closest, or at the edge of the screen pointing the way when it's
// out of sight). Steps finish on their own as you do them.

/** Where something to point at is, and how high above its base to point. */
interface Target { x: number; y: number; z: number; id: number }

interface Step {
  id: string;
  title: string;
  /** What to do and how (HTML). */
  text: string;
  /** Progress toward it ([have, need]), or done/not done. */
  progress: (g: Game, q: Onboarding) => [number, number] | boolean;
  /** Things in the world to point at. */
  targets?: (g: Game, q: Onboarding) => Target[];
  /** Where to go when there's nothing of the kind near by. */
  far?: string;
}

/** How far to look for things to point at (widened when nothing is close). */
let SEARCH = 70;
/** Built pieces within this distance of your first floor count as part of the house. */
const HOUSE_R = 6;

const has = (g: Game, type: string, n: number): [number, number] => [Math.min(n, g.inv.count(type)), n];
const hasTool = (g: Game, kind: ToolKind) => g.inv.items.some((i) => itemDef(i.type).tool === kind);
const builtNear = (g: Game, q: Onboarding, types: string[], r = HOUSE_R) => {
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

const STEPS: Step[] = [
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
    progress: (g) => has(g, 'log', 2),
    targets: (g) => trees(g),
    far: 'No grown trees close by: head for the woods.' },
  { id: 'planks', title: 'Split planks',
    text: `In crafting (${KEY('C')}), under <b>Woodworking</b>, <b>Split log into planks</b> with your hatchet: 2 planks a log. A floor needs 4.`,
    progress: (g) => has(g, 'plank', 4) },
  { id: 'floor', title: 'Lay a floor',
    text: `Press ${KEY('B')} to build and pick <b>Wooden floor</b>. Find level ground, ${KEY('Left click')} to place the plan, then hold your hammer, aim at the plan and ${KEY('Left click')} to build it, one plank at a time. This is where your house goes.`,
    progress: (_g, q) => !!q.anchor,
    targets: (g) => plans(g, ['floor']) },
  { id: 'walls', title: 'Raise three walls',
    text: `Pick a wall in the build menu (${KEY('B')}) and aim at the floor's edge: the plan snaps into place. <b>Log walls</b> need only 4 logs each and your hatchet; plank walls need planks and shafts. Leave one side open for the door.`,
    progress: (g, q) => [Math.min(3, builtNear(g, q, ['log_wall', 'wood_wall', 'stone_wall'])), 3],
    targets: (g) => plans(g, ['log_wall', 'wood_wall', 'stone_wall']) },
  { id: 'door', title: 'Hang a door',
    text: `Plan a <b>Wooden door</b> on the open side. It takes planks, shafts (carve a branch with your knife: <b>Woodworking → Shaft</b>) and a cordage.`,
    progress: (g, q) => builtNear(g, q, ['door']) > 0,
    targets: (g) => plans(g, ['door']) },
  { id: 'roof', title: 'Put a roof on',
    text: `Plan a <b>Thatch roof</b> (${KEY('B')} → Roofs): aim at the top of a wall and its low edge snaps on. Thatch takes planks and 8 plant fiber.`,
    progress: (g, q) => builtNear(g, q, ['roof']) > 0,
    targets: (g) => plans(g, ['roof']) },
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

export interface OnboardingSave { step: number; done: boolean; anchor: { x: number; z: number } | null; start: { x: number; z: number } }

export class Onboarding {
  step = 0;
  done = false;
  /** The first floor you built: the house is built around it. */
  anchor: { x: number; z: number } | null = null;
  start = { x: 0, z: 0 };
  /** Off for good (skipped, or the quest is over and its last message read). */
  hidden = false;

  private panel: HTMLElement | null = null;
  private edge: HTMLElement | null = null;
  private group = new THREE.Group();
  private arrow: THREE.Mesh;
  private glows: THREE.Sprite[] = [];
  private targets: Target[] = [];
  private timer = 0;
  private time = 0;
  private lastHtml = '';
  private doneTimer = 0;

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

  /** A new world's tutorial, starting where you stand. */
  static begin(glow: THREE.Texture, x: number, z: number): Onboarding {
    const q = new Onboarding(glow);
    q.start = { x, z };
    return q;
  }

  static load(glow: THREE.Texture, d: OnboardingSave): Onboarding {
    const q = new Onboarding(glow);
    q.step = Math.min(STEPS.length, d.step);
    q.done = d.done;
    q.anchor = d.anchor;
    q.start = d.start;
    q.hidden = d.done;
    return q;
  }

  serialize(): OnboardingSave {
    return { step: this.step, done: this.done, anchor: this.anchor, start: this.start };
  }

  get active() { return !this.done && !this.hidden; }

  /** Stop the tutorial (from the pause menu). */
  skip() {
    this.done = true;
    this.hidden = true;
    this.teardown();
  }

  private teardown() {
    this.group.removeFromParent();
    this.panel?.remove(); this.panel = null;
    this.edge?.remove(); this.edge = null;
  }

  update(g: Game, dt: number) {
    if (this.hidden) return;
    this.time += dt;
    if (!this.panel) this.mount(g);
    if (this.done) {
      // The finale stays up a little while, then the tutorial goes away.
      this.doneTimer += dt;
      if (this.doneTimer > 14) { this.hidden = true; this.teardown(); }
      return;
    }
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
    g.scene.add(this.group);
  }

  /** See whether the current step (and any already done after it) is finished; refresh the panel and targets. */
  private check(g: Game) {
    // The house's floor: the first floor you finish (or the nearest, for an old plan).
    if (!this.anchor) {
      let best: StructureObj | null = null, bd = Infinity;
      for (const o of g.world.objects.values()) {
        if (o.kind !== 'structure' || o.type !== 'floor' || !o.built) continue;
        const d = Math.hypot(o.x - g.player.pos.x, o.z - g.player.pos.z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) this.anchor = { x: best.x, z: best.z };
    }
    let advanced = false;
    while (this.step < STEPS.length && finished(STEPS[this.step].progress(g, this))) {
      g.msg(`Tutorial: ${STEPS[this.step].title} — done!`, 'good');
      this.step++;
      advanced = true;
    }
    if (this.step >= STEPS.length) {
      this.done = true;
      this.group.visible = false;
      if (this.edge) this.edge.style.display = 'none';
      g.msg('Tutorial complete: you have a home, a bed and somewhere to keep your things. The wilderness is yours.', 'good');
      this.render(`<div class="tut-head">Tutorial complete</div>
        <div class="tut-title">Welcome home</div>
        <div class="tut-text">You've built a house with a bed and a storage chest. From here: cook on a campfire, farm wheat, dig clay and set up a smithy. ${KEY('H')} has the full guide.</div>`, true);
      return;
    }
    const s = STEPS[this.step];
    const pr = s.progress(g, this);
    // The nearest few things to go for (looking further afield if there's nothing close).
    const p = g.player.pos;
    SEARCH = 70;
    let found = s.targets?.(g, this) ?? [];
    if (s.targets && !found.length) { SEARCH = 250; found = s.targets(g, this); }
    this.targets = found
      .map((t) => ({ t, d: Math.hypot(t.x - p.x, t.z - p.z) }))
      .sort((a, b) => a.d - b.d).slice(0, this.glows.length).map((e) => e.t);
    const far = s.far && !this.targets.length ? `<div class="tut-hint">${s.far}</div>` : '';
    const bar = Array.isArray(pr) ? `<div class="tut-progress"><div class="tut-progress-fill" style="width:${(pr[0] / pr[1]) * 100}%"></div><span>${pr[0]} / ${pr[1]}</span></div>` : '';
    this.render(`<div class="tut-head">Tutorial · step ${this.step + 1} of ${STEPS.length}</div>
      <div class="tut-title">${s.title}</div>
      <div class="tut-text">${s.text}</div>${far}${bar}
      <div class="tut-foot">Esc → Skip tutorial to turn it off</div>`, advanced);
  }

  private render(html: string, flash: boolean) {
    if (!this.panel || html === this.lastHtml) return;
    this.lastHtml = html;
    this.panel.innerHTML = html;
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

const finished = (p: [number, number] | boolean) => (Array.isArray(p) ? p[0] >= p[1] : p);

/** The steps' ids, in order (for tests). */
export const ONBOARDING_STEPS = STEPS.map((s) => s.id);
