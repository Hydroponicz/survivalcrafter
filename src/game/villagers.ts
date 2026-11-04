// Villagers: the people of the villages. Each lives in a house (one to a bed),
// keeps a day (sleep, breakfast, work, lunch, work, an evening by the fire)
// and works a real job: the farmer tills, sows, tends and reaps the fields,
// the woodcutter fells trees and splits the logs at the chopping block, the
// shepherd shears the flock, the butcher slaughters and butchers, the smith
// lights the forge and forges tools, the elder keeps the square's fire.
//
// Their work is done with the player's own actions (data in actions.ts):
// the same checks, timings, skills, results and animations. Each villager
// has a stand-in for the game (Hands) that the actions act through, holding
// their own inventory and skills, so what they make is real: crops in the
// ground, logs on a pile, tools in their chest, meat and wool to be found.
//
// Villagers live while you're near their village; leave, and they're let go
// (their work stays done), to be woken again, going about their day, when
// you come back.

import * as THREE from 'three';
import { itemDef, makeItem, type Item } from '../data/items';
import { RECIPES, type Recipe } from '../data/recipes';
import { Skills, type SkillId } from '../data/skills';
import { STRUCTURES } from '../data/structures';
import { mulberry32 } from '../world/noise';
import { Mat } from '../world/terrain';
import type { House, HouseRole, Village } from '../world/villages';
import { cropKey, CROP_STAGES, type AnimalObj, type PileObj, type StructureObj, type TreeObj, type WorldObj } from '../world/world';
import { ACTION_MAP, type ActionDef, type Ctx, type Target } from './actions';
import { CharacterRig, characterLoaded, HOLD, SEGMENTS, segmentTime, type Clip, type Pose } from './character';
import type { Game } from './game';
import { workClip } from './game';
import { Inventory } from './inventory';
import { telemetry } from './telemetry';
import { buildToolMesh } from './tools';

/** Villagers come to life within this distance of their village, and are let go beyond the second. */
const ACTIVE_R = 170, DROP_R = 280;
const WALK = 1.45;

export const ROLE_NAMES: Record<HouseRole, string> = {
  farmer: 'farmer', shepherd: 'shepherd', woodcutter: 'woodcutter', butcher: 'butcher', smith: 'smith', elder: 'village elder', villager: 'villager',
};

const NAMES = ['Aldric', 'Edda', 'Osric', 'Maud', 'Wulfric', 'Hilde', 'Godwin', 'Agnes', 'Leofric', 'Bertha', 'Cedric', 'Elfrida', 'Hamon', 'Isolde',
  'Bran', 'Joan', 'Oswin', 'Mildred', 'Rowan', 'Elspeth', 'Tobin', 'Winifred', 'Alder', 'Gunnhild', 'Hugh', 'Ysolde', 'Ansel', 'Rosamund', 'Edwin', 'Clemence'];

/** Hair, skin and homespun colours (one of each picked per villager). */
const SKIN = [0xc99474, 0xb07a58, 0xe0b090, 0x8a5a3c, 0xd8a07c];
const HAIR = [0x3b2a1e, 0x1e1612, 0x6a4a2a, 0xa07040, 0x7a7068, 0xc8b890];
const CLOTH = [0x8c7b5e, 0x6a5a40, 0x5a6a4a, 0x7a4a3a, 0x4a5a6a, 0x9a8a6a, 0x6a3a2a, 0x5a4a5a];

/** Tools and stores each job starts with (and is restocked with each morning). */
const KIT: Record<HouseRole, [string, number][]> = {
  farmer: [['iron_hoe', 1], ['scythe', 1], ['wheat_seeds', 24]],
  shepherd: [['iron_knife', 1]],
  woodcutter: [['iron_hatchet', 1]],
  butcher: [['iron_knife', 1]],
  smith: [['iron_hammer', 1], ['iron_tongs', 1], ['iron_lump', 3], ['shaft', 3], ['log', 3], ['kindling', 3]],
  elder: [['log', 4], ['kindling', 3]],
  villager: [],
};
/** What each job is good at (skill levels). */
const TRADE: Record<HouseRole, SkillId[]> = {
  farmer: ['farming'], shepherd: ['taming'], woodcutter: ['woodcutting', 'carpentry'], butcher: ['butchering'],
  smith: ['smithing', 'firemaking'], elder: ['firemaking'], villager: ['foraging'],
};
/** What the smith forges, in turn. */
const SMITH_WORK = ['iron_knife', 'iron_hoe', 'iron_shovel', 'iron_hatchet', 'iron_pickaxe'];

interface Spot { x: number; z: number }

type Step =
  | { kind: 'walk'; to: Spot; doing?: string }
  | { kind: 'act'; id: string; t: Target; tool?: Item; recipe?: Recipe; clip?: Clip; doing?: string; elapsed: number; total: number; resolved?: boolean; started?: boolean }
  | { kind: 'pose'; clip: Clip; time: number; face?: Spot; doing?: string }
  | { kind: 'sleep' }
  | { kind: 'call'; fn: () => void };

/**
 * The game as an action sees it, for a villager: their own inventory, skills
 * and position, the shared world. (Only what the actions villagers do use.)
 */
class Hands {
  readonly dev = { on: () => false };
  readonly quests = undefined;
  readonly knowledge = { handled: () => false };
  readonly player: { pos: THREE.Vector3 };
  constructor(private v: Villager, private game: Game) { this.player = { pos: v.pos }; }
  get world() { return this.game.world; }
  get view() { return this.game.view; }
  get skills() { return this.v.skills; }
  get inv() { return this.v.inv; }
  msg() { /* villagers keep their thoughts to themselves */ }
  inventoryChanged() {}
  give(type: string, ql: number, count: number) {
    for (let i = 0; i < count; i++) this.v.inv.add(makeItem(type, ql * (0.9 + Math.random() * 0.2)));
  }
  /** Use up the item in hand (seeds sown, a sprout planted). */
  consumeActive() {
    const a = this.v.active;
    if (a) this.v.inv.remove(a.uid);
  }
  toolFor(kind: string) { return this.v.inv.items.find((i) => itemDef(i.type).tool === kind); }
  wear() { /* villagers keep their tools in good repair */ }
  quiver() { return undefined; }
  loadQuiver() { return 0; }
  smithy() { return { trough: true }; }
  treeHit(t: TreeObj, strength: number, clean: boolean) { this.game.treeHit(t, strength, clean, this.v.pos); }
  fellTree(t: TreeObj, items: Item[], onDone: () => void) { this.game.fellTree(t, items, onDone, this.v.pos); }
  takeFromPile(p: PileObj, items: Item[]) {
    for (const it of items) {
      const i = p.items.indexOf(it);
      if (i >= 0) p.items.splice(i, 1);
      this.v.inv.add(it);
    }
    if (p.items.length === 0) this.game.world.remove(p);
    else this.game.world.changed(p);
  }
}

export class Villager {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  readonly skills = new Skills();
  readonly inv = new Inventory();
  /** The item in hand for the current job (seeds when sowing). */
  active?: Item;
  steps: Step[] = [];
  /** What they're up to, in a few words (for when you talk to them). */
  doing = 'going about their day';
  /** Lying in bed (where, and which way). */
  lying: { x: number; y: number; z: number; yaw: number } | null = null;
  readonly model = new THREE.Group();
  rig?: CharacterRig;
  private held = new THREE.Group();
  private heldKey = '';
  readonly hands: Hands;
  /** The last day they were restocked, and how many trees felled / beasts slaughtered that day. */
  day = -1;
  felled = 0;
  slaughtered = 0;
  private lambDay = -1;
  /** Each smith's turn through their work list. */
  private forgeTurn = 0;
  private colours: { skin: number; hair: number; tunic: number; trousers: number };

  constructor(readonly id: number, readonly name: string, readonly role: HouseRole, readonly home: House, readonly bed: number,
    readonly village: Village, game: Game, rnd: () => number) {
    this.hands = new Hands(this, game);
    for (const s of TRADE[role]) this.skills.levels[s] = 25 + Math.floor(rnd() * 30);
    const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
    this.colours = { skin: pick(SKIN), hair: pick(HAIR), tunic: pick(CLOTH), trousers: pick(CLOTH) };
    this.held.position.set(HOLD.pos[0], HOLD.pos[1], HOLD.pos[2]);
    this.held.rotation.set(HOLD.rot[0], HOLD.rot[1], HOLD.rot[2]);
    // Until the body has loaded (or if it can't): a plain figure.
    const stand = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.2, 4, 8).translate(0, 0.85, 0), new THREE.MeshStandardMaterial({ color: this.colours.tunic, roughness: 0.9 }));
    stand.castShadow = true;
    stand.name = 'stand-in';
    this.model.add(stand);
  }

  /** Swap the plain figure for the animated body, once the model is loaded. */
  dress(): boolean {
    if (this.rig) return true;
    const gltf = characterLoaded();
    if (!gltf) return false;
    this.rig = new CharacterRig(gltf);
    this.rig.setColours({ skin: this.colours.skin, hair: this.colours.hair, tunic: this.colours.tunic, trousers: this.colours.trousers });
    this.model.getObjectByName('stand-in')?.removeFromParent();
    this.model.add(this.rig.root);
    this.rig.hand.add(this.held);
    return true;
  }

  /** Put a tool in their hand (or nothing). */
  hold(item?: Item) {
    const key = item?.type ?? '';
    if (key === this.heldKey) return;
    this.heldKey = key;
    this.held.clear();
    if (item) this.held.add(buildToolMesh(itemDef(item.type).tool, item.type));
  }

  get roleName() { return ROLE_NAMES[this.role]; }

  /** A lamb today? (At most one a day.) */
  lambDayOk(day: number): boolean {
    if (this.lambDay === day) return false;
    this.lambDay = day;
    return true;
  }

  /** Which of the smith's goods to try first this time. */
  forgeTurnNext(): number { return this.forgeTurn++; }
}

/** Everyone in the villages near you: brings them to life, runs their days, draws them. */
export class VillageLife {
  readonly villagers: Villager[] = [];
  readonly group = Object.assign(new THREE.Group(), { name: 'villagers' });
  private active = new Map<string, Villager[]>();
  private checkT = 0;
  private nextId = 1;

  constructor(private g: Game) {}

  update(dt: number) {
    this.checkT -= dt;
    if (this.checkT <= 0) { this.checkT = 1; this.refresh(); }
    const p = this.g.player.pos;
    for (const v of this.villagers) {
      try {
        this.tick(v, dt);
      } catch (e) {
        telemetry.error('villager', `${v.name} (${v.role}) tripped up: ${(e as Error)?.message ?? e}`, { stack: (e as Error)?.stack?.split('\n').slice(0, 6).join('\n') });
        v.steps = [];
        v.active = undefined;
      }
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      v.model.visible = d < 160;
      if (v.model.visible) this.animate(v, dt, d);
    }
    // Where they stand (you bump into them).
    this.g.world.people = this.villagers.map((v) => ({ x: v.pos.x, z: v.pos.z, y: v.pos.y }));
  }

  /** A villager by the line of sight, for aiming at (talking to) them. */
  hit(p: THREE.Vector3): Villager | undefined {
    for (const v of this.villagers) {
      if (!v.model.visible) continue;
      if (v.lying) {
        if (Math.hypot(p.x - v.lying.x, p.z - v.lying.z) < 0.9 && p.y > v.lying.y - 0.2 && p.y < v.lying.y + 0.5) return v;
        continue;
      }
      if (Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < 0.32 && p.y > v.pos.y && p.y < v.pos.y + 1.8) return v;
    }
    return undefined;
  }

  // ---------- coming and going
  private refresh() {
    const p = this.g.player.pos, vil = this.g.world.terrain.villages;
    for (const v of vil.around(p.x, p.z, ACTIVE_R)) {
      const key = `${v.cx},${v.cz}`;
      if (!this.active.has(key) && Math.hypot(v.x - p.x, v.z - p.z) < ACTIVE_R + v.r * 0.3) this.wake(key, v);
    }
    for (const [key, list] of this.active) {
      const v = list[0]?.village;
      if (v && Math.hypot(v.x - p.x, v.z - p.z) < DROP_R) continue;
      for (const vi of list) { this.group.remove(vi.model); this.villagers.splice(this.villagers.indexOf(vi), 1); }
      this.active.delete(key);
      telemetry.event('villagers', `Left ${v?.name ?? key}: ${list.length} villagers let go`);
    }
  }

  /** Bring a village to life: one villager to a bed, the flocks in their pens, everyone where the hour finds them. */
  private wake(key: string, vil: Village) {
    const list: Villager[] = [];
    const w = this.g.world;
    vil.houses.forEach((h, hi) => {
      h.beds.forEach((_, b) => {
        const rnd = mulberry32((vil.cx * 92821) ^ (vil.cz * 68917) ^ (hi * 7919) ^ (b * 104729) ^ w.terrain.seed);
        const name = NAMES[Math.floor(rnd() * NAMES.length)];
        // The second bed in a longhouse: family, who gathers and fetches for the household.
        const role: HouseRole = b === 0 ? h.role : 'villager';
        const v = new Villager(this.nextId++, name, role, h, b, vil, this.g, rnd);
        this.restock(v);
        const night = this.night();
        if (night) this.toBed(v);
        else { const d = h.door; v.pos.set(d.x + (rnd() - 0.5), this.groundY(v, d.x, d.z), d.z + (rnd() - 0.5)); }
        v.dress();
        list.push(v);
        this.villagers.push(v);
        this.group.add(v.model);
      });
      // The flock.
      if (h.pen) {
        const penKey = `${key}:${hi}`;
        if (!w.animals.some((a) => a.penKey === penKey)) {
          const n = 3 + Math.floor(Math.random() * 2);
          for (let k = 0; k < n; k++) {
            const lx = (Math.random() - 0.5) * 3.5, lz = (Math.random() - 0.5) * 3.5, c = Math.cos(h.pen.yaw), s = Math.sin(h.pen.yaw);
            const a = w.spawnAnimal('sheep', h.pen.x + lx * c + lz * s, h.pen.z - lx * s + lz * c);
            a.pen = { ...h.pen }; a.penKey = penKey; a.wool = Math.random();
          }
        }
      }
    });
    this.active.set(key, list);
    telemetry.event('villagers', `${vil.name} comes to life: ${list.length} villagers`, { roles: list.map((v) => v.role) });
  }

  /** Each morning: a fresh day's stores (bought, bartered, brought in: the wider world isn't simulated). */
  private restock(v: Villager) {
    const day = this.g.world.day;
    if (v.day === day) return;
    v.day = day;
    v.felled = 0;
    v.slaughtered = 0;
    for (const [type, n] of KIT[v.role]) {
      const isTool = !!itemDef(type).tool;
      const have = v.inv.count(type);
      for (let i = have; i < n; i++) v.inv.add(makeItem(type, isTool ? 35 + Math.random() * 15 : 30));
    }
    // The smith's trough is topped up from the well.
    if (v.role === 'smith') for (const o of this.g.world.near(v.home.x, v.home.z, 9)) if (o.kind === 'structure' && o.type === 'quench_trough') { o.water = STRUCTURES.quench_trough.water; this.g.world.changed(o); }
  }

  // ---------- the day
  private get hour() { return this.g.world.dayFraction * 24; }
  private night() { const h = this.hour; return h >= 21.5 || h < 5.5; }

  private tick(v: Villager, dt: number) {
    if (!v.steps.length) this.think(v);
    const s = v.steps[0];
    if (!s) return;
    v.speed = 0;
    switch (s.kind) {
      case 'call': v.steps.shift(); s.fn(); return;
      case 'sleep':
        v.doing = 'asleep';
        if (!this.night()) { v.steps.shift(); this.getUp(v); }
        return;
      case 'pose':
        if (s.doing) v.doing = s.doing;
        s.time -= dt;
        if (s.face) v.yaw = Math.atan2(s.face.x - v.pos.x, s.face.z - v.pos.z);
        if (s.time <= 0) v.steps.shift();
        return;
      case 'walk': {
        if (s.doing) v.doing = s.doing;
        const dx = s.to.x - v.pos.x, dz = s.to.z - v.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.15) { v.steps.shift(); return; }
        const step = Math.min(d, WALK * dt);
        v.pos.x += (dx / d) * step; v.pos.z += (dz / d) * step;
        v.pos.y = this.groundY(v, v.pos.x, v.pos.z);
        v.yaw = Math.atan2(dx, dz);
        v.speed = WALK;
        return;
      }
      case 'act': this.act(v, s, dt); return;
    }
  }

  /** Decide what to do next, by the hour and the job. */
  private think(v: Villager) {
    const h = this.hour;
    this.restock(v);
    if (this.night()) { this.goToBed(v); return; }
    if (h < 7) { this.breakfast(v); return; }
    if (h >= 12 && h < 13) { this.lunch(v); return; }
    if (h >= 18.5) { this.evening(v); return; }
    switch (v.role) {
      case 'farmer': this.farm(v); break;
      case 'woodcutter': this.cutWood(v); break;
      case 'shepherd': this.tendFlock(v); break;
      case 'butcher': this.butcher(v); break;
      case 'smith': this.smith(v); break;
      case 'elder': this.elder(v); break;
      default: this.gather(v); break;
    }
    if (!v.steps.length) this.loiter(v);
  }

  private breakfast(v: Villager) {
    const t = this.tableSpot(v.home);
    this.walkTo(v, t.stand, 'having breakfast');
    v.steps.push({ kind: 'pose', clip: 'eat', time: 25, face: t.face, doing: 'having breakfast' });
  }

  private lunch(v: Villager) {
    const vil = v.village, b = vil.benches[v.id % Math.max(1, vil.benches.length)];
    const a = (v.id * 2.399) % (Math.PI * 2);
    const spot = b && v.id % 3 === 0 ? { x: b.x + Math.sin(b.yaw) * 0.6, z: b.z + Math.cos(b.yaw) * 0.6 } : { x: vil.fire.x + Math.cos(a) * 3, z: vil.fire.z + Math.sin(a) * 3 };
    this.walkTo(v, spot, 'off to lunch');
    v.steps.push({ kind: 'pose', clip: 'eat', time: 40, face: vil.fire, doing: 'eating lunch in the square' });
  }

  private evening(v: Villager) {
    const vil = v.village;
    const fire = this.structureAt(vil.fire, 'campfire');
    // The elder sees to the fire; everyone gathers round it.
    if (v.role === 'elder' && fire && !fire.lit) { this.keepFire(v, fire, 'lighting the evening fire'); if (v.steps.length) return; }
    const a = (v.id * 2.399 + Math.floor(this.g.world.time / 60)) % (Math.PI * 2), r = 2.4 + (v.id % 3) * 0.5;
    this.walkTo(v, { x: vil.fire.x + Math.cos(a) * r, z: vil.fire.z + Math.sin(a) * r }, 'heading to the fire');
    v.steps.push({ kind: 'pose', clip: v.id % 4 === 0 ? 'interact' : 'idle', time: 30 + Math.random() * 30, face: vil.fire, doing: 'sitting out the evening by the fire' });
  }

  private goToBed(v: Villager) {
    const b = v.home.beds[v.bed];
    if (!b) return;
    this.walkTo(v, { x: b.x, z: b.z }, 'going home to bed', true);
    v.steps.push({ kind: 'call', fn: () => this.toBed(v) }, { kind: 'sleep' });
  }

  private toBed(v: Villager) {
    const h = v.home, b = h.beds[v.bed];
    if (!b) return;
    v.lying = { x: b.x, y: h.y + 0.2 + 0.5, z: b.z, yaw: h.yaw };
    v.pos.set(b.x, h.y + 0.2, b.z);
    v.steps = [{ kind: 'sleep' }];
    v.doing = 'asleep';
  }

  private getUp(v: Villager) {
    if (!v.lying) return;
    v.lying = null;
    // Up and beside the bed.
    const [x, z] = local(v.home, -0.0, 0.4);
    const b = v.home.beds[v.bed];
    v.pos.set(b ? b.x - Math.cos(v.home.yaw) * 0.9 : x, v.home.y + 0.2, b ? b.z + Math.sin(v.home.yaw) * 0.9 : z);
  }

  /** Nothing to do this minute: a word with someone, a look round, a sit. */
  private loiter(v: Villager) {
    const vil = v.village;
    const r = Math.random();
    const spot = r < 0.4 ? v.home.route[0] : r < 0.7 ? { x: vil.x + (Math.random() - 0.5) * 6, z: vil.z + (Math.random() - 0.5) * 6 } : v.home.route[1];
    this.walkTo(v, spot, 'taking a breather');
    v.steps.push({ kind: 'pose', clip: Math.random() < 0.3 ? 'interact' : 'idle', time: 12 + Math.random() * 15, doing: 'taking a breather' });
  }

  // ---------- jobs
  /** The farmer: reap what's ripe, sow what's bare, weed what's growing, plough what's gone back to grass. */
  private farm(v: Villager) {
    const w = this.g.world, t = w.terrain;
    if (v.inv.count('wheat') >= 12) { this.store(v, ['wheat'], 'taking the harvest home'); return; }
    const cells = fieldCells(v.village);
    if (!cells.length) return;
    const hoe = v.inv.items.find((i) => i.type === 'iron_hoe'), scythe = v.inv.items.find((i) => i.type === 'scythe');
    type Job = { cell: Spot; id: string; tool?: Item; doing: string; rank: number };
    const jobs: Job[] = [];
    for (const c of cells) {
      const crop = w.crops.get(cropKey(c.x, c.z));
      const mat = t.topAt(c.x, c.z);
      if (crop) {
        const st = w.cropStage(crop);
        if (st >= CROP_STAGES - 1) jobs.push({ cell: c, id: 'harvest', tool: scythe, doing: 'reaping wheat', rank: 0 });
        else if (crop.tended < 1 && st >= 1) jobs.push({ cell: c, id: 'tend', tool: hoe, doing: 'weeding the wheat', rank: 2 });
      } else if (mat === Mat.Field) {
        const seeds = v.inv.ofType('wheat_seeds').at(-1);
        if (seeds) jobs.push({ cell: c, id: 'sow', tool: seeds, doing: 'sowing wheat', rank: 1 });
      } else if (mat === Mat.Grass || mat === Mat.Dirt) jobs.push({ cell: c, id: 'cultivate', tool: hoe, doing: 'ploughing the field', rank: 3 });
    }
    if (!jobs.length) return;
    // The most pressing kind of work, a few cells of it in a row, nearest first.
    const rank = Math.min(...jobs.map((j) => j.rank));
    let at: Spot = v.pos;
    const todo = jobs.filter((j) => j.rank === rank);
    for (let k = 0; k < 5 && todo.length; k++) {
      todo.sort((a, b) => dist(a.cell, at) - dist(b.cell, at));
      const j = todo.shift()!;
      // (Seeds: one handful per row, picked as they sow.)
      const tool = j.id === 'sow' ? undefined : j.tool;
      if (j.id !== 'sow' && !tool) continue;
      const stand = { x: j.cell.x + (at.x - j.cell.x > 0 ? 0.8 : -0.8), z: j.cell.z };
      this.walkTo(v, stand, j.doing);
      if (j.id === 'sow') v.steps.push({ kind: 'call', fn: () => { v.active = v.inv.ofType('wheat_seeds').at(-1); } });
      this.queueAct(v, j.id, terrainTarget(this.g, j.cell), j.id === 'sow' ? () => v.active : tool, j.doing);
      at = stand;
    }
  }

  /** The woodcutter: split the logs in hand at the block, store planks, else fell a tree out past the houses (two a day), and plant a sprout for it. */
  private cutWood(v: Villager) {
    const block = v.home.block && this.structureAt(v.home.block, 'chopping_block');
    if (v.inv.count('plank') >= 6) { this.store(v, ['plank'], 'stacking planks'); return; }
    const hatchet = v.inv.items.find((i) => i.type === 'iron_hatchet');
    if (!hatchet) return;
    if (v.inv.count('log') > 0 && block) {
      const r = RECIPES.find((x) => x.id === 'split_planks')!;
      this.walkTo(v, standBy(block, v.pos, 0.75), 'carrying a log to the block');
      this.queueAct(v, 'craft', objTarget(block), hatchet, 'splitting logs into planks', r, 'chop');
      return;
    }
    const sprout = v.inv.items.find((i) => i.type === 'sprout');
    if (sprout) {
      const vil = v.village, a = Math.random() * Math.PI * 2, d = vil.r + 8 + Math.random() * 25;
      const spot = { x: vil.x + Math.cos(a) * d, z: vil.z + Math.sin(a) * d };
      this.walkTo(v, spot, 'planting a sapling');
      v.steps.push({ kind: 'call', fn: () => { v.active = sprout; } });
      this.queueAct(v, 'plant_sprout', terrainTarget(this.g, spot), () => sprout, 'planting a sapling');
      v.steps.push({ kind: 'call', fn: () => { if (v.inv.find(sprout.uid)) v.inv.remove(sprout.uid); } });
      return;
    }
    if (v.felled >= 2) return;
    const tree = this.pickTree(v);
    if (!tree) return;
    v.felled++;
    this.walkTo(v, standBy(tree, v.pos, 0.35 + 0.3 * (tree.age ?? 1) + 0.6), 'off to fell a tree');
    this.queueAct(v, 'cut_tree', objTarget(tree), hatchet, `felling ${/^[aeiou]/.test(tree.species) ? 'an' : 'a'} ${tree.species}`);
    // Once it's down: wait for it to land, then gather up the logs.
    v.steps.push({ kind: 'pose', clip: 'idle', time: 4.5, face: tree, doing: 'watching the tree come down' });
    v.steps.push({ kind: 'call', fn: () => this.collectLogs(v, tree) });
  }

  private pickTree(v: Villager): TreeObj | undefined {
    const vil = v.village, w = this.g.world;
    let best: TreeObj | undefined, bestD = Infinity;
    for (const o of w.near(vil.x, vil.z, vil.r + 60)) {
      if (o.kind !== 'tree' || o.age < 0.6 || o.species === 'apple' || o.growing) continue;
      const fromC = Math.hypot(o.x - vil.x, o.z - vil.z);
      if (fromC < vil.r - 8 || fromC > vil.r + 60) continue;
      const d = Math.hypot(o.x - v.home.x, o.z - v.home.z);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  private collectLogs(v: Villager, tree: TreeObj) {
    const pile = this.g.world.near(tree.x, tree.z, 12).find((o): o is PileObj => o.kind === 'pile' && o.items.some((i) => i.type === 'log'));
    if (!pile) return;
    const steps: Step[] = [];
    const save = v.steps;
    v.steps = steps;
    this.walkTo(v, standBy(pile, v.pos, 0.7), 'gathering up the logs');
    this.queueAct(v, 'take_all', objTarget(pile), undefined, 'gathering up the logs');
    v.steps = [...steps, ...save];
  }

  /** The shepherd: shear any sheep whose fleece has grown, bring the wool home, and a lamb now and then. */
  private tendFlock(v: Villager) {
    const pen = v.home.pen;
    if (!pen) { this.gather(v); return; }
    if (v.inv.count('wool') >= 6) { this.store(v, ['wool'], 'taking the wool home'); return; }
    const flock = this.flock(v.home);
    // A lamb born now and then, while the pen has room.
    if (flock.length < 4 && v.lambDayOk(this.g.world.day)) {
      const a = this.g.world.spawnAnimal('sheep', pen.x, pen.z);
      a.pen = { ...pen }; a.penKey = flock[0]?.penKey ?? `${v.village.cx},${v.village.cz}:${v.village.houses.indexOf(v.home)}`; a.wool = 0;
    }
    const knife = v.inv.items.find((i) => i.type === 'iron_knife');
    const shaggy = flock.find((a) => (a.wool ?? 1) >= 1);
    this.enterPen(v, pen);
    if (shaggy && knife) {
      v.steps.push({ kind: 'call', fn: () => {
        const save = v.steps; v.steps = [];
        this.walkTo(v, standBy(shaggy, v.pos, 0.9), 'catching a sheep');
        this.queueAct(v, 'shear_sheep', animalTarget(shaggy), knife, 'shearing a sheep');
        v.steps.push(...save);
      } });
    } else {
      const [tx, tz] = local(pen, -1.2, 1.2);
      this.walkTo(v, { x: tx, z: tz }, 'looking over the flock');
      v.steps.push({ kind: 'pose', clip: 'interact', time: 10, doing: 'looking over the flock' });
    }
    this.leavePen(v, pen);
  }

  private flock(h: House): AnimalObj[] {
    const pen = h.pen;
    if (!pen) return [];
    return this.g.world.animals.filter((a) => a.pen && Math.hypot(a.pen.x - pen.x, a.pen.z - pen.z) < 0.5);
  }

  private enterPen(v: Villager, pen: NonNullable<House['pen']>) {
    const [ox, oz] = local(pen, 4.4, 0), [ix, iz] = local(pen, 1.8, 0), [gx, gz] = local(pen, 3, 0);
    this.walkTo(v, { x: ox, z: oz }, 'going to the pen');
    v.steps.push({ kind: 'call', fn: () => this.setOpen({ x: gx, z: gz }, 'gate', true) });
    v.steps.push({ kind: 'walk', to: { x: ix, z: iz } });
    v.steps.push({ kind: 'call', fn: () => this.setOpen({ x: gx, z: gz }, 'gate', false) });
  }

  private leavePen(v: Villager, pen: NonNullable<House['pen']>) {
    const [ox, oz] = local(pen, 4.4, 0), [ix, iz] = local(pen, 1.8, 0), [gx, gz] = local(pen, 3, 0);
    v.steps.push({ kind: 'walk', to: { x: ix, z: iz } });
    v.steps.push({ kind: 'call', fn: () => this.setOpen({ x: gx, z: gz }, 'gate', true) });
    v.steps.push({ kind: 'walk', to: { x: ox, z: oz } });
    v.steps.push({ kind: 'call', fn: () => this.setOpen({ x: gx, z: gz }, 'gate', false) });
  }

  /** The butcher: once a day, a beast from a well-stocked pen, butchered for meat and hide. */
  private butcher(v: Villager) {
    if (v.inv.count('raw_meat') >= 3 || v.inv.count('hide') >= 1) { this.store(v, ['raw_meat', 'hide'], 'hanging up the meat'); return; }
    const knife = v.inv.items.find((i) => i.type === 'iron_knife');
    if (!knife) return;
    // A carcass waiting to be dressed?
    const vil = v.village;
    const carcass = this.g.world.near(vil.x, vil.z, vil.r).find((o): o is PileObj => o.kind === 'pile' && o.items.some((i) => i.type === 'corpse') && Math.hypot(o.x - vil.x, o.z - vil.z) < vil.r);
    if (carcass) {
      this.walkTo(v, standBy(carcass, v.pos, 0.7), 'going to the carcass');
      this.queueAct(v, 'butcher', objTarget(carcass), knife, 'butchering');
      return;
    }
    if (v.slaughtered >= 1 || this.hour < 9) return;
    const house = v.village.houses.find((h) => h.pen && this.flock(h).length >= 4);
    if (!house?.pen) return;
    const beast = this.flock(house)[0];
    v.slaughtered++;
    this.enterPen(v, house.pen);
    v.steps.push({ kind: 'call', fn: () => {
      if (!this.g.world.animals.includes(beast)) return;
      const save = v.steps; v.steps = [];
      this.walkTo(v, standBy(beast, v.pos, 0.9), 'choosing a beast');
      v.steps.push({ kind: 'pose', clip: 'attack_one', time: 1.6, face: beast, doing: 'slaughtering a sheep' });
      v.steps.push({ kind: 'call', fn: () => this.slaughter(beast) });
      v.steps.push(...save);
    } });
    this.leavePen(v, house.pen);
  }

  private slaughter(a: AnimalObj) {
    const w = this.g.world;
    if (!w.animals.includes(a)) return;
    w.animals = w.animals.filter((x) => x !== a);
    this.g.dropToGround([makeItem('corpse', 50, 'sheep corpse')], a.x, w.terrain.heightAt(a.x, a.z), a.z);
  }

  /** The smith: keep the forge lit, forge a tool at the anvil, quench it, and store it (up to a few at a time). */
  private smith(v: Villager) {
    const sm = v.home.smithy;
    if (!sm) { this.gather(v); return; }
    const forge = this.structureAt(sm.forge, 'forge'), anvil = this.structureAt(sm.anvil, 'anvil');
    if (!forge || !anvil) return;
    const made = v.inv.items.filter((i) => SMITH_WORK.includes(i.type) && !i.hot);
    if (made.length >= 2) { this.store(v, SMITH_WORK, 'taking the new tools in'); return; }
    if (!forge.lit) { this.keepFire(v, forge, 'firing up the forge'); return; }
    const hot = v.inv.items.find((i) => i.hot);
    const trough = this.g.world.near(sm.anvil.x, sm.anvil.z, 4).find((o): o is StructureObj => o.kind === 'structure' && o.type === 'quench_trough');
    if (hot && trough) {
      this.walkTo(v, standBy(trough, v.pos, 0.7), 'carrying the hot iron');
      this.queueAct(v, 'quench', objTarget(trough), v.inv.items.find((i) => i.type === 'iron_tongs'), 'quenching the iron');
      return;
    }
    const hammer = v.inv.items.find((i) => i.type === 'iron_hammer');
    for (let k = 0; k < SMITH_WORK.length; k++) {
      const id = SMITH_WORK[(v.forgeTurnNext() + k) % SMITH_WORK.length];
      const r = RECIPES.find((x) => x.id === id);
      if (!r || !hammer || !r.inputs.every((i) => v.inv.count(i.item) >= i.count)) continue;
      this.walkTo(v, standBy(anvil, forge, 0.8), 'heading to the anvil');
      this.queueAct(v, 'craft', objTarget(anvil), hammer, `forging ${/^[aeiou]/.test(r.name.toLowerCase()) ? 'an' : 'a'} ${r.name.toLowerCase()}`, r, 'hammer');
      return;
    }
    // Out of iron for today: work the bellows.
    this.walkTo(v, standBy(forge, v.pos, 0.9), 'tending the forge');
    v.steps.push({ kind: 'pose', clip: 'interact', time: 15, face: forge, doing: 'tending the forge' });
  }

  /** Feed a fire (a forge or the square's) and light it: the player's Add fuel and Light fire. */
  private keepFire(v: Villager, s: StructureObj, doing: string) {
    const stand = standBy(s, v.pos, 1.0);
    if (s.fuel < 400 && (v.inv.count('log') + v.inv.count('branch') + v.inv.count('plank')) > 0) {
      this.walkTo(v, stand, doing);
      this.queueAct(v, 'add_fuel', objTarget(s), undefined, doing);
      return;
    }
    if (s.fuel > 0 && !s.lit && v.inv.count('kindling') > 0) {
      this.walkTo(v, stand, doing);
      this.queueAct(v, 'light_fire', objTarget(s), undefined, doing, undefined, 'interact');
    }
  }

  /** The elder: walks the village, has a word at people's doors, sits by the well. */
  private elder(v: Villager) {
    const vil = v.village;
    const h = vil.houses[Math.floor(Math.random() * vil.houses.length)];
    const r = Math.random();
    if (r < 0.5 && h) {
      this.walkTo(v, h.route[0], 'calling on the neighbours');
      v.steps.push({ kind: 'pose', clip: 'interact', time: 10 + Math.random() * 10, face: { x: h.x, z: h.z }, doing: 'calling on the neighbours' });
    } else {
      const b = vil.benches[Math.floor(Math.random() * vil.benches.length)];
      if (b) this.walkTo(v, { x: b.x + Math.sin(b.yaw) * 0.6, z: b.z + Math.cos(b.yaw) * 0.6 }, 'taking the air');
      v.steps.push({ kind: 'pose', clip: 'idle', time: 25, face: vil.fire, doing: 'keeping an eye on the village' });
    }
  }

  /** Family members: fetch water, pick up branches, stones and fibre about the village, and bring them home. */
  private gather(v: Villager) {
    const vil = v.village;
    const haul = v.inv.items.filter((i) => ['branch', 'rock_shard', 'small_rock', 'plant_fiber', 'flint'].includes(i.type)).length;
    if (haul >= 8) { this.store(v, ['branch', 'rock_shard', 'small_rock', 'plant_fiber', 'flint'], 'bringing in what they gathered'); return; }
    if (Math.random() < 0.25) {
      this.walkTo(v, { x: vil.x + 1.2, z: vil.z + 0.4 }, 'fetching water');
      v.steps.push({ kind: 'pose', clip: 'interact', time: 8, face: vil, doing: 'drawing water at the well' });
      return;
    }
    const finds = this.g.world.near(vil.x, vil.z, vil.r + 30).filter((o) => o.kind === 'forage'
      && ['fallen_branch', 'pebbles', 'fiber_grass', 'flint'].includes(o.species));
    let at: Spot = v.pos;
    for (let k = 0; k < 4 && finds.length; k++) {
      finds.sort((a, b) => dist(a, at) - dist(b, at));
      const f = finds.shift()!;
      this.walkTo(v, standBy(f, at, 0.5), 'gathering about the village');
      this.queueAct(v, 'pick_forage', objTarget(f), undefined, 'gathering about the village');
      at = f;
    }
  }

  /** Carry these things home and put them in the chest. */
  private store(v: Villager, types: string[], doing: string) {
    const h = v.home;
    this.walkTo(v, standBy(h.chest, { x: h.x, z: h.z }, 0.7), doing, true);
    v.steps.push({ kind: 'pose', clip: 'interact', time: 1.5, face: h.chest, doing });
    v.steps.push({ kind: 'call', fn: () => {
      const chest = this.structureAt(h.chest, 'chest');
      if (!chest) return;
      chest.items ??= [];
      const cap = STRUCTURES.chest.container ?? 300;
      let kg = chest.items.reduce((s, i) => s + itemDef(i.type).weight, 0);
      for (const it of [...v.inv.items]) {
        if (!types.includes(it.type) || it.hot) continue;
        if (kg + itemDef(it.type).weight > cap) { v.inv.remove(it.uid); continue; } // (a full chest: it goes to market)
        v.inv.remove(it.uid);
        chest.items.push(it);
        kg += itemDef(it.type).weight;
      }
      this.g.world.changed(chest);
    } });
  }

  // ---------- doing an action, the player's way
  private queueAct(v: Villager, id: string, t: Target, tool: Item | undefined | (() => Item | undefined), doing: string, recipe?: Recipe, clip?: Clip) {
    v.steps.push({ kind: 'call', fn: () => {
      const tl = typeof tool === 'function' ? tool() : tool;
      v.steps.unshift({ kind: 'act', id, t, tool: tl, recipe, clip, doing, elapsed: 0, total: 0 });
    } });
  }

  private act(v: Villager, s: Extract<Step, { kind: 'act' }>, dt: number) {
    const def = ACTION_MAP[s.id];
    const ctx = this.ctx(v, s);
    if (!def || this.gone(s.t)) { v.steps.shift(); return; }
    if (!s.started) {
      s.started = true;
      // The same checks the player meets (crafting's are about the player's own stations: the job has seen to its own).
      const problem = s.id === 'craft' ? (s.recipe && s.recipe.inputs.every((i) => v.inv.count(i.item) >= i.count) ? null : 'nothing to work') : def.check?.(ctx) ?? null;
      if (problem) { v.steps.shift(); return; }
      s.total = def.instant ? 0.75 : this.duration(v, def, ctx);
    }
    v.doing = s.doing ?? v.doing;
    s.elapsed += dt;
    const at = targetPos(s.t);
    if (at) v.yaw = Math.atan2(at.x - v.pos.x, at.z - v.pos.z);
    // An animal being worked on stands still for it.
    if (s.t.kind === 'animal') { const a = s.t.animal; a.speed = 0; a.state = 'idle'; a.timer = 2; }
    if (def.impactAt) {
      if (!s.resolved && s.elapsed >= s.total * def.impactAt) { s.resolved = true; this.complete(v, def, ctx, s.total); }
      if (s.elapsed >= s.total) {
        // One blow done: again while there's still work (a tree still standing).
        const again = typeof def.repeat === 'function' ? def.repeat(ctx) : !!def.repeat;
        if (again && !this.gone(s.t)) { s.elapsed = 0; s.resolved = false; } else v.steps.shift();
      }
      return;
    }
    if (s.elapsed >= s.total) {
      v.steps.shift();
      this.complete(v, def, ctx, s.total);
    }
  }

  private ctx(v: Villager, s: Extract<Step, { kind: 'act' }>): Ctx {
    return { g: v.hands as unknown as Game, t: s.t, tool: s.tool, recipe: s.recipe };
  }

  /** How long an action takes them: the player's formula (skill speeds it, a good tool helps). */
  private duration(v: Villager, def: ActionDef, ctx: Ctx): number {
    const base = typeof def.time === 'function' ? def.time(ctx) : def.time;
    const skill = typeof def.skill === 'function' ? def.skill(ctx) : def.skill;
    const lvl = skill ? v.skills.get(skill) : 1;
    const tool = ctx.tool, power = tool ? itemDef(tool.type).toolPower ?? 1 : 1, toolQ = tool ? 0.9 + tool.ql / 500 : 1;
    return def.fixedTime ? base * (1.15 - lvl / 250) : Math.max(base * 0.3, (base * (1.3 - lvl / 150)) / ((0.5 + 0.5 * power) * toolQ));
  }

  /** The outcome, as for the player: skill against difficulty, quality from skill and tool; then the action's own effect. */
  private complete(v: Villager, def: ActionDef, ctx: Ctx, seconds: number) {
    const skill = typeof def.skill === 'function' ? def.skill(ctx) : def.skill;
    const diff = typeof def.difficulty === 'function' ? def.difficulty(ctx) : def.difficulty ?? 1;
    const tool = ctx.tool, toolQl = tool?.ql ?? 0, power = tool ? itemDef(tool.type).toolPower ?? 1 : 0.5;
    let success = true, ql = 10;
    if (skill) {
      success = Math.random() < v.skills.successChance(skill, diff, toolQl, power);
      ql = v.skills.rollQuality(skill, toolQl, 0, power);
      v.skills.gain(skill, diff, success, seconds);
    }
    v.active = tool;
    try {
      def.run(ctx, { success, ql, toolQl });
      telemetry.count(`villager:${def.id}`);
    } catch (e) {
      telemetry.error('villager', `${v.name} couldn't ${def.id}: ${(e as Error)?.message ?? e}`, { stack: (e as Error)?.stack?.split('\n').slice(0, 6).join('\n') });
      v.steps = [];
    }
    v.active = undefined;
  }

  private gone(t: Target): boolean {
    if (t.kind === 'object') return this.g.world.objects.get(t.obj.id) !== t.obj;
    if (t.kind === 'animal') return !this.g.world.animals.includes(t.animal);
    return false;
  }

  // ---------- getting about
  /**
   * Walk somewhere by the village paths: out of the house you're in (opening
   * and closing the door), along its path to the square, along the other
   * house's path and in at its door; or straight out across the fields.
   */
  private walkTo(v: Villager, to: Spot, doing: string, indoorsDest = false) {
    const vil = v.village;
    const from = v.pos;
    const inHouse = this.houseAt(vil, from.x, from.z);
    const destHouse = indoorsDest ? this.houseAt(vil, to.x, to.z) ?? v.home : this.houseAt(vil, to.x, to.z);
    const walk = (p: Spot) => v.steps.push({ kind: 'walk', to: p, doing });
    if (inHouse && inHouse === destHouse) { walk(to); return; }
    if (inHouse) {
      walk(this.doorSpot(inHouse, -1.3));
      v.steps.push({ kind: 'call', fn: () => this.setOpen(this.doorSpot(inHouse, -2), 'door', true) });
      walk(inHouse.route[0]);
      v.steps.push({ kind: 'call', fn: () => this.setOpen(this.doorSpot(inHouse, -2), 'door', false) });
    }
    const start: Spot = inHouse ? inHouse.route[0] : from;
    if (destHouse) {
      // From the square (or straight to the door if it's close by).
      const r = destHouse.route;
      if (dist(start, r[0]) > 6) {
        if (inHouse) { walk(inHouse.route[1]); walk(inHouse.route[2]); }
        walk(r[2]); walk(r[1]);
      }
      walk(r[0]);
      v.steps.push({ kind: 'call', fn: () => this.setOpen(this.doorSpot(destHouse, -2), 'door', true) });
      walk(this.doorSpot(destHouse, -1.3));
      v.steps.push({ kind: 'call', fn: () => this.setOpen(this.doorSpot(destHouse, -2), 'door', false) });
      walk(to);
      return;
    }
    // Out across the village: along your own path a way, then straight there.
    if (inHouse && dist(to, { x: vil.x, z: vil.z }) < dist(to, inHouse) + 6) walk(inHouse.route[1]);
    walk(to);
  }

  private houseAt(vil: Village, x: number, z: number): House | undefined {
    return vil.houses.find((h) => { const [lx, lz] = toHouse(h, x, z); return Math.abs(lx) < h.tiles - 0.05 && Math.abs(lz) < 1.95; });
  }

  private doorSpot(h: House, lz: number): Spot {
    const [x, z] = local(h, -h.tiles + 1, lz);
    return { x, z };
  }

  private groundY(v: Villager, x: number, z: number): number {
    const h = this.houseAt(v.village, x, z);
    return h ? h.y + 0.2 : this.g.world.terrain.heightAt(x, z);
  }

  /** Open or close a door or gate, by the player's own Open/Close. */
  private setOpen(at: Spot, type: 'door' | 'gate', open: boolean) {
    const s = this.structureAt(at, type, 0.8);
    if (!s || !!s.open === open) return;
    ACTION_MAP.toggle_open.run({ g: this.g, t: { kind: 'object', obj: s, point: new THREE.Vector3(s.x, s.y, s.z) } }, { success: true, ql: 0, toolQl: 0 });
  }

  private structureAt(at: Spot, type: string, r = 1.2): StructureObj | undefined {
    let best: StructureObj | undefined, bd = r;
    for (const o of this.g.world.near(at.x, at.z, r + 1)) {
      if (o.kind !== 'structure' || o.type !== type) continue;
      const d = Math.hypot(o.x - at.x, o.z - at.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  private tableSpot(h: House): { stand: Spot; face: Spot } {
    const n = h.tiles, tx = -n + 1.6 + (n === 3 ? 0.6 : 0);
    const [sx, sz] = local(h, tx - 0.9, 0.3), [fx, fz] = local(h, tx, 0.3);
    return { stand: { x: sx, z: sz }, face: { x: fx, z: fz } };
  }

  // ---------- the body
  private animate(v: Villager, dt: number, far: number) {
    if (!v.rig && !v.dress()) {
      v.model.position.copy(v.pos);
      v.model.rotation.set(0, v.yaw, 0);
      return;
    }
    const rig = v.rig!;
    const s = v.steps[0];
    let pose: Pose = { kind: 'loop', clip: 'idle' };
    let item: Item | undefined;
    if (v.lying) pose = { kind: 'loop', clip: 'idle', speed: 0.3 };
    else if (s?.kind === 'walk') pose = { kind: 'move', clip: 'walk', groundSpeed: v.speed };
    else if (s?.kind === 'pose') pose = { kind: 'loop', clip: s.clip };
    else if (s?.kind === 'act' && s.started) {
      const def = ACTION_MAP[s.id];
      item = s.tool && itemDef(s.tool.type).tool ? s.tool : undefined;
      const clip = s.clip ?? workClip(s.id) ?? 'craft';
      const seg = SEGMENTS[clip];
      if (seg) {
        // A blow at a time (a tree), or a series of them over a longer job.
        const period = def?.impactAt ? Math.max(0.3, s.total) : clip === 'mine' ? 1.6 : clip === 'chop' || clip === 'hammer' ? 1.3 : Math.max(0.6, s.total);
        const phase = def?.impactAt ? s.elapsed / Math.max(0.3, s.total) : (s.elapsed % period) / period;
        pose = { kind: 'scrub', clip, time: segmentTime(seg, phase, def?.impactAt ?? 0.62) };
      } else pose = { kind: 'loop', clip };
    }
    v.hold(item);
    // Far away, the body is updated less often (it's small on screen).
    const skip = far > 60 && (v.id + Math.floor(performance.now() / 16)) % 3 !== 0;
    if (!skip) rig.update(far > 60 ? dt * 3 : dt, pose, 0.2);
    if (v.lying) {
      // On the bed: lying along it.
      v.model.position.set(v.lying.x - Math.sin(v.lying.yaw) * 0.85, v.lying.y, v.lying.z - Math.cos(v.lying.yaw) * 0.85);
      v.model.rotation.set(0, v.lying.yaw, 0);
      rig.root.rotation.set(Math.PI / 2, 0, 0);
    } else {
      rig.root.rotation.set(0, 0, 0);
      v.model.position.copy(v.pos);
      v.model.rotation.set(0, v.yaw, 0);
    }
  }
}

// ---------- helpers
function dist(a: Spot, b: Spot) { return Math.hypot(a.x - b.x, a.z - b.z); }

/** A point in a house's (or pen's) own frame, in the world. */
function local(r: { x: number; z: number; yaw: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return [r.x + lx * c + lz * s, r.z - lx * s + lz * c];
}
function toHouse(h: House, x: number, z: number): [number, number] {
  const dx = x - h.x, dz = z - h.z, c = Math.cos(h.yaw), s = Math.sin(h.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Where to stand to work on something: `gap` metres out from it, on the side you're coming from. */
function standBy(o: Spot, from: Spot, gap: number): Spot {
  let dx = from.x - o.x, dz = from.z - o.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  return { x: o.x + dx * gap, z: o.z + dz * gap };
}

function terrainTarget(g: Game, p: Spot): Target {
  const t = g.world.terrain, y = t.heightAt(p.x, p.z);
  return { kind: 'terrain', point: new THREE.Vector3(p.x, y, p.z), normal: new THREE.Vector3(0, 1, 0), mat: t.topAt(p.x, p.z) };
}
function objTarget(o: WorldObj): Target {
  return { kind: 'object', obj: o, point: new THREE.Vector3(o.x, 'y' in o ? o.y : 0, o.z) };
}
function animalTarget(a: AnimalObj): Target {
  return { kind: 'animal', animal: a, point: new THREE.Vector3(a.x, 0, a.z) };
}
function targetPos(t: Target): Spot | null {
  return t.kind === 'object' ? t.obj : t.kind === 'animal' ? t.animal : t.kind === 'terrain' ? t.point : null;
}

/** The squares of a village's fields worked as crop rows (every other row, for walking between). */
const cellCache = new WeakMap<Village, Spot[]>();
function fieldCells(v: Village): Spot[] {
  let out = cellCache.get(v);
  if (out) return out;
  out = [];
  for (const f of v.fields) {
    const r = Math.hypot(f.hx, f.hz) + 1;
    for (let z = Math.floor(f.z - r); z <= f.z + r; z++) {
      for (let x = Math.floor(f.x - r); x <= f.x + r; x++) {
        if (z % 2 !== 0) continue;
        const cx = x + 0.5, cz = z + 0.5;
        const dx = cx - f.x, dz = cz - f.z, c = Math.cos(f.yaw), s = Math.sin(f.yaw);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) < f.hx - 0.6 && Math.abs(lz) < f.hz - 0.6) out.push({ x: cx, z: cz });
      }
    }
  }
  cellCache.set(v, out);
  return out;
}
