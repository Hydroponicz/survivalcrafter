import * as THREE from 'three';
import { getNextUid, itemDef, itemName, makeItem, setNextUid, type Item } from '../data/items';
import type { Recipe, StationKind } from '../data/recipes';
import { SKILLS, Skills, type SkillId } from '../data/skills';
import { STRUCTURES, type StructureDef } from '../data/structures';
import { TILE, WATER_LEVEL } from '../world/terrain';
import { WorldView } from '../world/view';
import {
  ANIMALS, World, type AnimalObj, type PileObj, type StructureObj, type WorldObj,
} from '../world/world';
import { ACTION_MAP, ACTIONS, craftProblem, type ActionDef, type Ctx, type Target } from './actions';
import { DevSettings } from './dev';
import { Input } from './input';
import { CARRY_CAPACITY, Inventory } from './inventory';
import { Player } from './player';
import { Sky } from './sky';
import type { UI } from '../ui/ui';

const REACH = 4.5;
const SAVE_KEY = 'survivalcrafter.save.v1';

export interface RunningAction {
  def: ActionDef;
  ctx: Ctx;
  elapsed: number;
  total: number;
  startPos: THREE.Vector3;
}

interface QueuedAction { def: ActionDef; ctx: Ctx }

export type MsgKind = 'info' | 'good' | 'fail' | 'warn' | 'skill';

export interface Placement { def: StructureDef; valid: boolean; reason: string; tx: number; tz: number; axis?: 'x' | 'z' }

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world: World;
  view: WorldView;
  player = new Player();
  inv = new Inventory();
  skills = new Skills();
  input: Input;
  sky: Sky;
  ui!: UI;
  foraged = new Map<number, number>();
  dev = new DevSettings();

  target: Target | null = null;
  action: RunningAction | null = null;
  queue: QueuedAction[] = [];
  lastAction: { def: ActionDef; recipe?: Recipe } | null = null;
  activeUid: number | null = null;
  hotbar: (string | null)[] = Array(9).fill(null);
  placing: StructureDef | null = null;
  placement: Placement | null = null;
  paused = false;
  private abandoned = false;

  private highlight: THREE.LineLoop;
  private cornerMarker: THREE.Mesh;
  private ghost: THREE.Mesh;
  private timer = new THREE.Timer();
  private saveTimer = 0;
  private respawnTimer = 0;
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 900);
    this.input = new Input(canvas);

    this.world = world;
    world.terrain.buildMeshes();
    this.scene.add(world.terrain.group);
    this.view = new WorldView(world);
    this.scene.add(this.view.group);
    this.scene.add(this.player.model);
    this.sky = new Sky(this.scene, world.terrain.size * TILE);

    this.highlight = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 4 }, () => new THREE.Vector3())),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: true }),
    );
    this.cornerMarker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.35, depthWrite: false }));
    this.scene.add(this.highlight, this.cornerMarker, this.ghost);
    this.ghost.visible = false;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('beforeunload', () => { if (!this.abandoned) this.save(); });
  }

  // ---------- setup
  newCharacter() {
    const s = this.world.spawn;
    this.player.pos.set(s.x, this.world.terrain.heightAt(s.x, s.z), s.z);
    // A very humble start: a crude knife and a bit of fiber.
    this.inv.add(makeItem('stone_knife', 8));
    this.inv.add(makeItem('berries', 10));
    this.inv.add(makeItem('berries', 10));
    this.autoBind(this.inv.items[0]);
    this.msg('You wake in the wilderness with nothing but a crude knife. Press H for help.', 'warn');
    this.msg('Forage grass for fiber and branches, gather stones from bare rock, then craft (C) your first tools.', 'info');
  }

  start() {
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ---------- messaging & inventory helpers used by actions
  pendingMsgs: [string, MsgKind][] = [];

  msg(text: string, kind: MsgKind = 'info') {
    if (this.ui) this.ui.log(text, kind);
    else this.pendingMsgs.push([text, kind]);
  }

  inventoryChanged() {
    if (this.activeUid !== null && !this.inv.find(this.activeUid)) this.setActive(null);
    this.ui?.refresh();
  }

  activeItem(): Item | undefined {
    return this.activeUid === null ? undefined : this.inv.find(this.activeUid);
  }

  setActive(uid: number | null) {
    this.activeUid = uid;
    const it = this.activeItem();
    this.player.setHeld(it ? itemDef(it.type).tool : undefined);
    this.ui?.refresh();
  }

  /** Remove the active item from the inventory (e.g. dropped dirt) and pick the next of the same type. */
  consumeActive() {
    const it = this.activeItem();
    if (!it) return;
    this.inv.remove(it.uid);
    const next = this.inv.ofType(it.type)[0];
    this.setActive(next ? next.uid : null);
    this.inventoryChanged();
  }

  give(type: string, ql: number, count: number) {
    for (let i = 0; i < count; i++) {
      const it = makeItem(type, ql * (0.9 + Math.random() * 0.2));
      this.inv.add(it);
      if (i === 0) this.autoBind(it);
    }
    this.inventoryChanged();
  }

  autoBind(it: Item) {
    if (!itemDef(it.type).tool) return;
    if (this.hotbar.includes(it.type)) return;
    const free = this.hotbar.indexOf(null);
    if (free >= 0) this.hotbar[free] = it.type;
  }

  dropToGround(items: Item[], x: number, z: number) {
    const existing = this.world.near(x, z, 1.5).find((o) => o.kind === 'pile' && Math.hypot(o.x - x, o.z - z) < 1.2) as PileObj | undefined;
    if (existing) {
      existing.items.push(...items);
      this.world.changed(existing);
      return existing;
    }
    return this.world.add<PileObj>({ kind: 'pile', x, z, items });
  }

  dropItems(uids: number[]) {
    const items = uids.map((u) => this.inv.remove(u)).filter((i): i is Item => !!i);
    if (!items.length) return;
    const f = this.player.forward();
    this.dropToGround(items, this.player.pos.x + f.x * 0.8, this.player.pos.z + f.z * 0.8);
    this.inventoryChanged();
  }

  takeFromPile(p: PileObj | StructureObj, items: Item[]) {
    let took = 0;
    const list = p.kind === 'pile' ? p.items : (p.items ??= []);
    for (const it of items) {
      if (itemDef(it.type).noPickup) continue;
      if (!this.dev.on('noWeight') && this.inv.weight() + itemDef(it.type).weight > CARRY_CAPACITY * 1.5) {
        this.msg('You cannot carry any more.', 'fail');
        break;
      }
      const idx = list.indexOf(it);
      if (idx >= 0) list.splice(idx, 1);
      this.inv.add(it);
      this.autoBind(it);
      took++;
    }
    if (p.kind === 'pile' && p.items.length === 0) this.world.remove(p);
    else this.world.changed(p);
    if (took) this.msg(`You pick up ${took} item${took > 1 ? 's' : ''}.`, 'info');
    this.inventoryChanged();
  }

  putIntoContainer(s: StructureObj, uids: number[]) {
    const cap = STRUCTURES[s.type].container ?? 0;
    s.items ??= [];
    let w = s.items.reduce((a, i) => a + itemDef(i.type).weight, 0);
    for (const u of uids) {
      const it = this.inv.find(u);
      if (!it) continue;
      if (w + itemDef(it.type).weight > cap) { this.msg('The chest is full.', 'fail'); break; }
      this.inv.remove(u);
      s.items.push(it);
      w += itemDef(it.type).weight;
    }
    this.inventoryChanged();
  }

  eat(uid: number) {
    const it = this.inv.find(uid);
    if (!it) return;
    const f = itemDef(it.type).food;
    if (!f) return;
    const p = this.player;
    if (f.nutrition > 0 && p.food >= 99 && !f.water) return this.msg('You are too full to eat.', 'fail');
    const qm = 0.6 + it.ql / 125;
    p.food = Math.min(100, p.food + f.nutrition * qm);
    p.water = Math.min(100, p.water + (f.water ?? 0) * (f.nutrition ? qm : 1));
    if (it.type === 'jar_of_water') {
      it.type = 'clay_jar';
      this.msg('You drink from the jar.', 'info');
    } else {
      this.inv.remove(uid);
      this.msg(`You eat the ${itemName(it).toLowerCase()}.${it.type === 'raw_meat' || it.type === 'mushroom' ? ' It is not very appetising raw.' : ''}`, 'info');
      if (it.type === 'raw_meat' && Math.random() < 0.3) { p.health -= 8; this.msg('Your stomach cramps.', 'fail'); }
    }
    this.inventoryChanged();
  }

  stationNear(kind: StationKind): boolean {
    const p = this.player.pos;
    for (const o of this.world.near(p.x, p.z, 4)) {
      if (o.kind !== 'structure' || !o.built) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) > 4) continue;
      const st = STRUCTURES[o.type].station;
      if (kind === 'fire' && (st === 'fire' || st === 'forge') && o.lit) return true;
      if (kind === 'forge' && st === 'forge' && o.lit) return true;
      if (kind === st && kind !== 'fire' && kind !== 'forge') return true;
    }
    return false;
  }

  /** Best tool of a kind: the active item if it qualifies, else the best in the pack. */
  toolFor(kind: string | undefined): Item | undefined {
    if (!kind) return undefined;
    const a = this.activeItem();
    if (a && itemDef(a.type).tool === kind) return a;
    return this.inv.items.filter((i) => itemDef(i.type).tool === kind).sort((x, y) => y.ql - x.ql)[0];
  }

  // ---------- actions
  actionsFor(t: Target): { def: ActionDef; ctx: Ctx; label: string; problem: string | null }[] {
    const ctx: Ctx = { g: this, t, tool: this.activeItem() };
    const out = [];
    for (const def of ACTIONS) {
      // Structures pick the right tool automatically.
      let c = ctx;
      if (def.id === 'continue_build' && t.kind === 'object' && t.obj.kind === 'structure') {
        c = { ...ctx, tool: this.toolFor(STRUCTURES[t.obj.type].tool) ?? ctx.tool };
      }
      if (!def.show(c)) continue;
      const label = typeof def.label === 'function' ? def.label(c) : def.label;
      out.push({ def, ctx: c, label, problem: def.check?.(c) ?? null });
    }
    // Examine last; the most useful action first.
    out.sort((a, b) => Number(a.def.id.startsWith('examine')) - Number(b.def.id.startsWith('examine')));
    return out;
  }

  request(def: ActionDef, ctx: Ctx) {
    if (this.action) {
      if (this.queue.length >= 5) return this.msg('You cannot queue any more actions.', 'fail');
      this.queue.push({ def, ctx });
      this.msg(`Queued: ${typeof def.label === 'function' ? def.label(ctx) : def.label}.`, 'info');
      return;
    }
    this.begin(def, ctx);
  }

  craft(r: Recipe, count: number) {
    const tool = this.toolFor(r.tool);
    const ctx: Ctx = { g: this, t: { kind: 'none' }, tool, recipe: r };
    const problem = craftProblem(this, r, tool);
    if (problem) { this.msg(problem, 'fail'); return; }
    for (let i = 0; i < count; i++) this.request(ACTION_MAP.craft, ctx);
  }

  private begin(def: ActionDef, ctx: Ctx): boolean {
    const problem = def.check?.(ctx) ?? null;
    if (problem) { this.msg(problem, 'fail'); return false; }
    const stamina = def.stamina ?? 0;
    if (stamina > 0 && this.player.stamina < stamina) { this.msg('You are too exhausted. Rest a moment.', 'fail'); return false; }
    const base = typeof def.time === 'function' ? def.time(ctx) : def.time;
    if (base <= 0) {
      def.run(ctx, { success: true, ql: 0, toolQl: 0 });
      return true;
    }
    const skill = this.skillOf(def, ctx);
    const lvl = skill ? this.skills.get(skill) : 1;
    const tool = ctx.tool;
    const power = tool ? itemDef(tool.type).toolPower ?? 1 : 1;
    const toolQ = tool ? 0.9 + tool.ql / 500 : 1;
    const dmgSlow = tool ? 1 + tool.dmg / 200 : 1;
    // Skill speeds you up; crude or damaged tools slow you down.
    let total = def.fixedTime
      ? base * (1.15 - lvl / 250)
      : Math.max(base * 0.3, (base * (1.3 - lvl / 150) * dmgSlow) / ((0.5 + 0.5 * power) * toolQ));
    if (this.dev.on('instantActions') || (this.dev.on('instantCraft') && def.id === 'craft')) total = 0;
    this.action = { def, ctx, elapsed: 0, total, startPos: this.player.pos.clone() };
    this.lastAction = { def, recipe: ctx.recipe };
    return true;
  }

  private skillOf(def: ActionDef, ctx: Ctx): SkillId | undefined {
    return typeof def.skill === 'function' ? def.skill(ctx) : def.skill;
  }

  cancelAction(reason?: string) {
    if (this.action && reason) this.msg(reason, 'fail');
    this.action = null;
    this.queue = [];
    this.player.swing = 0;
  }

  cancelQueue() {
    this.queue = [];
    this.repeatBlocked = true;
  }
  private repeatBlocked = false;

  private finish(a: RunningAction) {
    const { def, ctx } = a;
    // Conditions may have changed while working.
    const problem = def.check?.(ctx) ?? null;
    if (problem) { this.msg(problem, 'fail'); this.action = null; this.queue = []; return; }
    const skill = this.skillOf(def, ctx);
    const diff = typeof def.difficulty === 'function' ? def.difficulty(ctx) : def.difficulty ?? 1;
    const tool = ctx.tool;
    const toolQl = tool?.ql ?? 0;
    const power = tool ? itemDef(tool.type).toolPower ?? 1 : 0.5;
    let success = true;
    let ql = 10;
    if (skill) {
      success = this.dev.on('alwaysSucceed') || Math.random() < this.skills.successChance(skill, diff, toolQl, power);
      ql = this.skills.rollQuality(skill, toolQl, ctx.recipe ? 0 : 0, power);
      const before = this.skills.get(skill);
      const gain = this.skills.gain(skill, diff, success, a.total);
      if (Math.floor(before) !== Math.floor(before + gain)) {
        this.msg(`${skillName(skill)} increased to ${Math.floor(before + gain)}.`, 'skill');
      }
    }
    this.player.stamina = Math.max(0, this.player.stamina - (def.stamina ?? 0));
    if (tool && def.toolWear && !this.dev.on('noToolWear') && this.inv.find(tool.uid)) {
      tool.dmg += def.toolWear * (1.5 - tool.ql / 100) * (0.5 + Math.random());
      if (tool.dmg >= 100) {
        this.inv.remove(tool.uid);
        this.msg(`Your ${itemName(tool).toLowerCase()} breaks!`, 'warn');
        this.inventoryChanged();
      }
    }
    this.action = null;
    def.run(ctx, { success, ql, toolQl });
    this.ui?.refresh();

    // Next: queued action, else automatic repeat.
    const next = this.queue.shift();
    if (next) { this.begin(next.def, next.ctx); return; }
    const rep = typeof def.repeat === 'function' ? def.repeat(ctx) : def.repeat;
    if (rep && !this.repeatBlocked) {
      const c = { ...ctx, tool: ctx.tool && this.inv.find(ctx.tool.uid) ? ctx.tool : this.activeItem() };
      if (!def.check?.(c)) this.begin(def, c);
    }
    this.repeatBlocked = false;
  }

  repeatLast() {
    const la = this.lastAction;
    if (!la) return;
    if (la.recipe) return this.craft(la.recipe, 1);
    if (!this.target) return;
    const opts = this.actionsFor(this.target).filter((o) => o.def.id === la.def.id);
    if (opts[0]) this.request(opts[0].def, opts[0].ctx);
    else this.msg('You cannot do that here.', 'fail');
  }

  // ---------- combat & animals
  provoke(a: AnimalObj) {
    if (ANIMALS[a.species].aggressive && !this.dev.on('peaceful')) { a.state = 'attack'; a.timer = 25; }
    else { a.state = 'flee'; a.timer = 5; }
  }

  killAnimal(a: AnimalObj) {
    this.world.animals = this.world.animals.filter((x) => x !== a);
    const d = ANIMALS[a.species];
    this.dropToGround([makeItem('corpse', 50, `${d.name.toLowerCase()} corpse`)], a.x, a.z);
    this.msg(`You kill the ${d.name.toLowerCase()}! Butcher the corpse with a knife.`, 'good');
    if (this.action?.ctx.t.kind === 'animal' && this.action.ctx.t.animal === a) this.action = null;
    this.queue = this.queue.filter((q) => !(q.ctx.t.kind === 'animal' && q.ctx.t.animal === a));
  }

  private updateAnimals(dt: number) {
    const w = this.world, t = w.terrain, p = this.player.pos;
    const maxXZ = t.size * TILE - 2;
    for (const a of w.animals) {
      const d = ANIMALS[a.species];
      const toP = Math.hypot(p.x - a.x, p.z - a.z);
      a.timer -= dt;
      a.attackCooldown -= dt;
      if (a.state === 'attack' && this.dev.on('peaceful')) { a.state = 'idle'; a.timer = 2; }
      // Deer are skittish: they bolt when you sprint nearby.
      if (a.species === 'deer' && a.state !== 'flee' && toP < 8 && this.player.sprinting) { a.state = 'flee'; a.timer = 4; }
      switch (a.state) {
        case 'idle':
          a.speed = 0;
          if (a.timer <= 0) {
            a.state = 'wander';
            a.timer = 3 + Math.random() * 5;
            const ang = Math.random() * Math.PI * 2;
            a.dirX = Math.cos(ang); a.dirZ = Math.sin(ang);
          }
          break;
        case 'wander':
          a.speed = 1.1;
          if (a.timer <= 0) { a.state = 'idle'; a.timer = 2 + Math.random() * 6; }
          break;
        case 'flee': {
          a.speed = d.speed;
          const l = toP || 1;
          a.dirX = (a.x - p.x) / l; a.dirZ = (a.z - p.z) / l;
          if (a.timer <= 0) { a.state = 'idle'; a.timer = 2; }
          break;
        }
        case 'attack': {
          const l = toP || 1;
          a.dirX = (p.x - a.x) / l; a.dirZ = (p.z - a.z) / l;
          a.speed = toP > 1.4 ? d.speed * 0.9 : 0;
          if (toP < 1.8 && a.attackCooldown <= 0) {
            a.attackCooldown = 2.2;
            if (this.dev.on('godMode')) {
              this.msg(`The ${d.name.toLowerCase()} bounces off you harmlessly.`, 'info');
            } else if (Math.random() < 0.7 - this.skills.get('fighting') / 250) {
              const dmg = d.damage * (0.7 + Math.random() * 0.6);
              this.player.health -= dmg;
              this.msg(`The ${d.name.toLowerCase()} gores you! (${Math.round(dmg)})`, 'warn');
              this.ui?.flashDamage();
            } else this.msg(`You dodge the ${d.name.toLowerCase()}.`, 'info');
          }
          if (a.timer <= 0 || toP > 30) { a.state = 'idle'; a.timer = 3; }
          break;
        }
      }
      if (a.speed > 0) {
        const nx = a.x + a.dirX * a.speed * dt;
        const nz = a.z + a.dirZ * a.speed * dt;
        const h = t.heightAt(nx, nz);
        if (h < WATER_LEVEL + 0.2 || nx < 2 || nz < 2 || nx > maxXZ || nz > maxXZ || this.blocked(nx, nz)) {
          // turn away from water or walls
          const ang = Math.atan2(a.dirZ, a.dirX) + Math.PI * (0.5 + Math.random());
          a.dirX = Math.cos(ang); a.dirZ = Math.sin(ang);
        } else {
          a.x = nx; a.z = nz;
        }
        const targetRot = Math.atan2(a.dirX, a.dirZ);
        let dr = targetRot - a.rot;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        a.rot += dr * Math.min(1, dt * 6);
      }
    }
    // Keep the wilds stocked.
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) {
      this.respawnTimer = 45;
      if (w.animals.length < 28) {
        for (let i = 0; i < 20; i++) {
          const x = (4 + Math.random() * (t.size - 8)) * TILE, z = (4 + Math.random() * (t.size - 8)) * TILE;
          if (Math.hypot(x - p.x, z - p.z) < 50 || t.heightAt(x, z) < 1) continue;
          w.spawnAnimal(Math.random() < 0.65 ? 'deer' : 'boar', x, z);
          break;
        }
      }
    }
  }

  /** Walls and fences keep animals in pens. */
  private blocked(x: number, z: number): boolean {
    for (const o of this.world.near(x, z, 2)) {
      if (o.kind !== 'structure' || !o.built) continue;
      const def = STRUCTURES[o.type];
      if (def.placement !== 'edge' || (def.gate && o.open)) continue;
      const hx = o.axis === 'x' ? TILE / 2 : 0.4, hz = o.axis === 'x' ? 0.4 : TILE / 2;
      if (Math.abs(x - o.x) < hx && Math.abs(z - o.z) < hz) return true;
    }
    return false;
  }

  // ---------- targeting
  private raycast(): Target | null {
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const origin = cam.position.clone();
    const eye = this.player.eye;
    const maxD = this.player.cameraMode === 'third' ? this.player.camDist + REACH + 1 : REACH;
    const t = this.world.terrain;
    const objs = this.world.near(origin.x, origin.z, maxD + 2);
    const animals = this.world.animals.filter((a) => Math.hypot(a.x - origin.x, a.z - origin.z) < maxD + 2);
    const p = new THREE.Vector3();
    for (let d = 0.2; d <= maxD; d += 0.05) {
      p.copy(origin).addScaledVector(dir, d);
      if (this.player.cameraMode === 'third' && p.distanceTo(eye) > REACH + 0.5) {
        // Too far from the character; but keep marching while still between camera and player.
        if (d > this.player.camDist + 0.5) break;
        continue;
      }
      for (const a of animals) {
        const g = t.heightAt(a.x, a.z);
        const tall = a.species === 'deer' ? 1.6 : 1.0;
        if (Math.hypot(p.x - a.x, p.z - a.z) < 0.6 && p.y > g && p.y < g + tall) return { kind: 'animal', animal: a, point: p.clone() };
      }
      for (const o of objs) if (this.hitObject(o, p)) return { kind: 'object', obj: o, point: p.clone() };
      const h = t.heightAt(p.x, p.z);
      if (p.y < WATER_LEVEL && h < WATER_LEVEL - 0.05) {
        return { kind: 'water', tx: Math.floor(p.x / TILE), tz: Math.floor(p.z / TILE), point: p.clone() };
      }
      if (p.y <= h) {
        const tx = Math.floor(p.x / TILE), tz = Math.floor(p.z / TILE);
        if (!t.inTiles(tx, tz)) return null;
        return { kind: 'tile', tx, tz, cx: Math.round(p.x / TILE), cz: Math.round(p.z / TILE), point: p.clone() };
      }
    }
    return null;
  }

  private hitObject(o: WorldObj, p: THREE.Vector3): boolean {
    const t = this.world.terrain;
    const g = t.heightAt(o.x, o.z);
    const dx = p.x - o.x, dz = p.z - o.z;
    switch (o.kind) {
      case 'tree': {
        const s = 0.2 + 0.8 * o.age;
        const y = p.y - g;
        if (y < 0 || y > 6.5 * s) return false;
        const r = y < 2.6 * s ? 0.2 + 0.3 * s : 1.5 * s;
        return dx * dx + dz * dz < r * r;
      }
      case 'bush':
        return dx * dx + dz * dz + (p.y - g - 0.4) ** 2 < 0.45;
      case 'pile':
        return dx * dx + dz * dz + (p.y - g - 0.3) ** 2 < 0.3;
      case 'structure': {
        const def = STRUCTURES[o.type];
        const base = def.placement === 'edge' ? Math.min(t.cornerH(o.tx, o.tz), t.cornerH(o.tx + (o.axis === 'x' ? 1 : 0), o.tz + (o.axis === 'z' ? 1 : 0))) : g;
        const y = p.y - base;
        if (def.placement === 'edge') {
          const hx = o.axis === 'x' ? TILE / 2 : 0.2, hz = o.axis === 'x' ? 0.2 : TILE / 2;
          const hgt = o.type === 'fence' || o.type === 'gate' ? 1.35 : 2.5;
          return Math.abs(dx) < hx && Math.abs(dz) < hz && y > -0.3 && y < hgt;
        }
        if (o.type === 'floor') return Math.abs(dx) < TILE / 2 && Math.abs(dz) < TILE / 2 && y > -0.2 && y < 0.25 + t.tileSlope(o.tx, o.tz) / 10;
        const half: Record<string, [number, number, number]> = {
          campfire: [0.6, 0.5, 0.6], forge: [0.8, 1.8, 0.7], anvil: [0.5, 0.8, 0.3], quern: [0.6, 0.8, 0.6],
          workbench: [0.8, 0.95, 0.4], chest: [0.55, 0.7, 0.35], bed: [0.55, 0.5, 1.0],
        };
        const [hx, hy, hz] = half[o.type] ?? [0.5, 1, 0.5];
        return Math.abs(dx) < hx && Math.abs(dz) < hz && y > -0.2 && y < hy;
      }
    }
  }

  private updateHighlight() {
    const t = this.target;
    const show = !!t && t.kind === 'tile' && !this.placing;
    this.highlight.visible = show;
    this.cornerMarker.visible = show;
    if (!show || t?.kind !== 'tile') return;
    const tr = this.world.terrain;
    const pos = this.highlight.geometry.attributes.position as THREE.BufferAttribute;
    const cs = [[t.tx, t.tz], [t.tx + 1, t.tz], [t.tx + 1, t.tz + 1], [t.tx, t.tz + 1]];
    cs.forEach(([x, z], i) => pos.setXYZ(i, x * TILE, tr.cornerH(x, z) + 0.04, z * TILE));
    pos.needsUpdate = true;
    this.highlight.geometry.computeBoundingSphere();
    this.cornerMarker.position.set(t.cx * TILE, tr.cornerH(t.cx, t.cz) + 0.06, t.cz * TILE);
  }

  // ---------- building placement
  startPlacing(def: StructureDef) {
    this.placing = def;
    this.msg(`Placing ${def.name.toLowerCase()}: left-click to set out the plan, right-click or Esc to cancel.`, 'info');
  }

  private updatePlacement() {
    this.ghost.visible = false;
    this.placement = null;
    const def = this.placing;
    if (!def) return;
    let point: THREE.Vector3 | null = null;
    const t = this.target;
    if (t && t.kind !== 'none') point = t.point;
    if (!point) return;
    const tr = this.world.terrain;
    const tx = Math.floor(point.x / TILE), tz = Math.floor(point.z / TILE);
    if (!tr.inTiles(tx, tz)) return;
    let valid = true, reason = '';
    let axis: 'x' | 'z' | undefined;
    let ex = tx, ez = tz;
    if (def.placement === 'edge') {
      const fx = point.x / TILE - tx, fz = point.z / TILE - tz;
      const opts: [number, number, number, 'x' | 'z'][] = [
        [fz, tx, tz, 'x'], [1 - fz, tx, tz + 1, 'x'], [fx, tx, tz, 'z'], [1 - fx, tx + 1, tz, 'z'],
      ];
      opts.sort((a, b) => a[0] - b[0]);
      [, ex, ez, axis] = opts[0];
      if (!tr.inTiles(ex, ez)) return;
      if (tr.edgeSlope(ex, ez, axis) > def.maxSlope) { valid = false; reason = 'The ground is too steep along that edge.'; }
      if (this.world.structureAt(ex, ez, axis)) { valid = false; reason = 'Something is already built there.'; }
      const x = axis === 'x' ? (ex + 0.5) * TILE : ex * TILE;
      const z = axis === 'z' ? (ez + 0.5) * TILE : ez * TILE;
      for (const o of this.world.near(x, z, 1.5)) {
        if (o.kind === 'tree' && Math.hypot(o.x - x, o.z - z) < 1.1) { valid = false; reason = 'A tree is in the way.'; }
      }
      const y = Math.min(tr.cornerH(ex, ez), tr.cornerH(ex + (axis === 'x' ? 1 : 0), ez + (axis === 'z' ? 1 : 0)));
      this.ghost.scale.set(axis === 'x' ? TILE : 0.25, 1.6, axis === 'z' ? TILE : 0.25);
      this.ghost.position.set(x, y + 0.8, z);
    } else {
      if (tr.tileSlope(tx, tz) > def.maxSlope) { valid = false; reason = `The tile is too steep (${tr.tileSlope(tx, tz)} dm, max ${def.maxSlope}). Flatten it with a shovel.`; }
      if (this.world.structureAt(tx, tz)) { valid = false; reason = 'Something is already built there.'; }
      if (this.world.objectsOnTile(tx, tz).some((o) => o.kind === 'tree' || o.kind === 'bush')) { valid = false; reason = 'Clear the vegetation first.'; }
      if (this.world.crops.has(tz * tr.size + tx)) { valid = false; reason = 'There are crops here.'; }
      const x = (tx + 0.5) * TILE, z = (tz + 0.5) * TILE;
      if (tr.heightAt(x, z) < WATER_LEVEL) { valid = false; reason = 'You cannot build in water.'; }
      const sz = def.id === 'floor' ? TILE : 1.2;
      this.ghost.scale.set(sz, def.id === 'floor' ? 0.15 : 1, sz);
      this.ghost.position.set(x, tr.heightAt(x, z) + (def.id === 'floor' ? 0.07 : 0.5), z);
    }
    const dist = Math.hypot(this.ghost.position.x - this.player.pos.x, this.ghost.position.z - this.player.pos.z);
    if (dist > REACH + 1) { valid = false; reason = 'Too far away.'; }
    this.ghost.visible = true;
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(valid ? 0x66ff88 : 0xff5555);
    this.placement = { def, valid, reason, tx: ex, tz: ez, axis };
  }

  devFinishStructure(s: StructureObj) {
    const def = STRUCTURES[s.type];
    for (const m of def.materials) s.consumed[m.item] = m.count;
    s.built = true;
    s.ql = Math.max(s.ql, 50);
    this.world.changed(s);
    this.msg(`[dev] ${def.name} built instantly.`, 'info');
  }

  private confirmPlacement() {
    const p = this.placement;
    if (!p) return;
    if (!p.valid) return this.msg(p.reason, 'fail');
    const x = p.axis === 'x' ? (p.tx + 0.5) * TILE : p.axis === 'z' ? p.tx * TILE : (p.tx + 0.5) * TILE;
    const z = p.axis === 'z' ? (p.tz + 0.5) * TILE : p.axis === 'x' ? p.tz * TILE : (p.tz + 0.5) * TILE;
    const s = this.world.add<StructureObj>({
      kind: 'structure', type: p.def.id, tx: p.tx, tz: p.tz, axis: p.axis, x, z,
      consumed: {}, built: false, ql: 0, fuel: 0, lit: false,
    });
    if (p.def.container) s.items = [];
    if (this.dev.on('freeBuild')) {
      this.devFinishStructure(s);
    } else {
      this.msg(`You plan a ${p.def.name.toLowerCase()}. Use "Continue building" on it with the materials in your pack.`, 'good');
    }
    if (!this.input.keys.has('ShiftLeft')) this.placing = null;
  }

  // ---------- main loop
  private frame(timestamp: number) {
    this.timer.update(timestamp);
    const dt = Math.min(0.05, this.timer.getDelta());
    this.elapsed += dt;
    if (!this.paused) this.update(dt);
    this.render();
    this.input.endFrame();
  }

  private update(dt: number) {
    const inp = this.input;
    const p = this.player;
    const uiOpen = this.ui.anyWindowOpen();

    // --- hotkeys
    if (inp.hit('KeyV')) {
      p.cameraMode = p.cameraMode === 'first' ? 'third' : 'first';
      this.msg(`${p.cameraMode === 'first' ? 'First' : 'Third'}-person view.`, 'info');
    }
    if (inp.hit('KeyI') || inp.hit('Tab')) this.ui.toggle('inventory');
    if (inp.hit('KeyC')) this.ui.toggle('crafting');
    if (inp.hit('KeyK')) this.ui.toggle('skills');
    if (inp.hit('KeyB')) this.ui.toggle('build');
    if (inp.hit('KeyH') || inp.hit('F1')) this.ui.toggle('help');
    if (inp.hit('KeyR')) this.repeatLast();
    if (inp.hit('KeyX')) { if (this.action) this.cancelAction('You stop what you are doing.'); }
    if (inp.hit('Escape')) { this.placing = null; }
    if (inp.hit('Backquote') || inp.hit('F2')) this.ui.toggle('dev');
    if (inp.hit('Digit0')) this.setActive(null);
    for (let i = 0; i < 9 && !this.ui.menuOpen; i++) {
      if (inp.hit(`Digit${i + 1}`)) {
        if (this.ui.hoveredItem !== null) {
          const it = this.inv.find(this.ui.hoveredItem);
          if (it) { this.hotbar[i] = it.type; this.ui.refresh(); }
        } else {
          const type = this.hotbar[i];
          const it = type ? this.inv.ofType(type)[0] : undefined;
          if (it) this.setActive(this.activeUid === it.uid ? null : it.uid);
        }
      }
    }

    // --- player
    const over = this.dev.on('noWeight') ? 0 : this.inv.weight() - CARRY_CAPACITY;
    p.update(dt, inp, this.world, !!this.action, over, !this.ui.menuOpen, this.dev.on('fly'));
    if (this.action && Math.hypot(p.pos.x - this.action.startPos.x, p.pos.z - this.action.startPos.z) > 0.6) {
      this.cancelAction('You moved and stopped what you were doing.');
    }
    p.updateCamera(this.camera, this.world.terrain);

    // --- targeting
    this.target = inp.locked || this.placing ? this.raycast() : this.target;
    this.updateHighlight();
    this.updatePlacement();

    for (const btn of inp.takeClicks()) {
      if (this.placing) {
        if (btn === 0) this.confirmPlacement();
        else { this.placing = null; this.msg('Placement cancelled.', 'info'); }
        continue;
      }
      if (!this.target) continue;
      const opts = this.actionsFor(this.target);
      if (btn === 0) {
        const first = opts.find((o) => !o.problem) ?? opts[0];
        if (first) this.request(first.def, first.ctx);
      } else if (btn === 2) {
        this.ui.openContextMenu(this.target, opts);
      }
    }
    if (inp.hit('KeyF') && inp.locked && this.target) this.ui.openContextMenu(this.target, this.actionsFor(this.target));
    if (inp.hit('KeyE') && inp.locked && this.target) {
      const opts = this.actionsFor(this.target);
      const first = opts.find((o) => !o.problem) ?? opts[0];
      if (first) this.request(first.def, first.ctx);
    }

    // --- action progress
    if (this.action) {
      const a = this.action;
      a.elapsed += dt;
      p.swing = (a.elapsed * 1.2) % 1;
      if (a.elapsed >= a.total) this.finish(a);
    } else {
      p.swing = 0;
    }

    // --- survival
    const busy = !!this.action || p.sprinting;
    p.food = Math.max(0, p.food - dt * 0.05);
    p.water = Math.max(0, p.water - dt * 0.08);
    if (!busy) {
      const regen = p.food > 5 && p.water > 5 ? 9 : 2.5;
      p.stamina = Math.min(100, p.stamina + dt * regen);
    }
    if (p.food <= 0 || p.water <= 0) {
      p.health -= dt * 0.5;
    } else if (p.food > 30 && p.water > 30) {
      p.health = Math.min(100, p.health + dt * 0.3);
    }
    if (this.dev.on('noNeeds')) { p.food = 100; p.water = 100; p.stamina = 100; }
    if (this.dev.on('godMode')) p.health = 100;
    if (p.health <= 0) this.die();

    // --- world
    this.world.tick(dt * this.dev.timeScale);
    this.updateAnimals(dt);
    this.world.terrain.rebuildDirty();

    this.saveTimer += dt;
    if (this.saveTimer > 60) { this.saveTimer = 0; this.save(); }

    if (!uiOpen && !inp.locked && !this.ui.menuOpen && this.ui.wantsRelock) {
      this.ui.wantsRelock = false;
      inp.lock();
    }
    this.ui.update();
  }

  private die() {
    const p = this.player;
    this.msg('You have died. Your belongings remain where you fell.', 'warn');
    if (this.inv.items.length) {
      this.dropToGround(this.inv.items.splice(0), p.pos.x, p.pos.z);
    }
    this.setActive(null);
    this.cancelAction();
    p.health = 100; p.food = 60; p.water = 60; p.stamina = 100;
    const s = this.world.spawn;
    p.pos.set(s.x, this.world.terrain.heightAt(s.x, s.z) + 0.5, s.z);
    p.vel.set(0, 0, 0);
    for (const a of this.world.animals) if (a.state === 'attack') { a.state = 'idle'; a.timer = 3; }
    this.ui.showDeath();
    this.inventoryChanged();
  }

  private render() {
    const p = this.player;
    this.sky.update(this.world.dayFraction, p.pos, this.elapsed);
    this.view.syncAnimals(this.elapsed);
    this.view.updateFires(p.pos.x, p.pos.z, this.elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- persistence
  save() {
    try {
      const p = this.player;
      const data = {
        version: 1,
        world: this.world.serialize(),
        player: {
          pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, pitch: p.pitch, cam: p.cameraMode,
          health: p.health, food: p.food, water: p.water, stamina: p.stamina,
        },
        inv: this.inv.items,
        skills: this.skills.levels,
        hotbar: this.hotbar,
        active: this.activeUid,
        nextUid: getNextUid(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Save failed', e);
    }
  }

  abandon() {
    this.abandoned = true;
    Game.clearSave();
    location.reload();
  }

  static hasSave(): boolean {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  static clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }

  static loadSave(canvas: HTMLCanvasElement): Game | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      setNextUid(data.nextUid);
      const world = World.load(data.world);
      const g = new Game(canvas, world);
      const p = g.player;
      p.pos.set(data.player.pos[0], data.player.pos[1], data.player.pos[2]);
      p.yaw = data.player.yaw; p.pitch = data.player.pitch; p.cameraMode = data.player.cam;
      p.health = data.player.health; p.food = data.player.food; p.water = data.player.water; p.stamina = data.player.stamina;
      g.inv.items = data.inv;
      Object.assign(g.skills.levels, data.skills);
      g.hotbar = data.hotbar;
      g.activeUid = data.active;
      g.setActive(data.active);
      return g;
    } catch (e) {
      console.warn('Load failed', e);
      return null;
    }
  }
}

export function skillName(id: SkillId): string {
  return SKILLS[id];
}
