import * as THREE from 'three';
import { getNextUid, isIdentified, itemDef, itemName, learnSpecies, makeItem, setNextUid, TORCH_BURN, WEAR_SLOTS, type Item, type WearSlot } from '../data/items';
import type { Recipe, StationKind } from '../data/recipes';
import { SKILLS, Skills, type SkillId } from '../data/skills';
import { pieceBoxes, STRUCTURES, type StructureDef, type V3 } from '../data/structures';
import { anvilGrade } from './smithy';
import { isRock, Mat, WATER_LEVEL, type Volumes } from '../world/terrain';
import { forageHeight, forageScale } from '../world/forageProps';
import { buildPieceMesh, WorldView } from '../world/view';
import { GroundCover, PIECE_MARGIN } from '../world/groundcover';
import { Fireflies } from '../world/fireflies';
import { DistantLand } from '../world/lod';
import { GraphicsSettings } from './graphics';
import { deleteSave, downloadSave, hasSaveAt, migrateSave, readSave, readSaveFile, writeSave } from './storage';

/** Within this distance the real trees stand (wild things load about 220 m around you); distant forests take over beyond. */
const NEAR_TREES = 230;
import { seaFloor } from '../world/water';
import { prepareTiles, WorkerTiles } from '../world/tilesource';
import { ViewCull } from '../world/cull';
import { perf } from './perf';
import { TILE, tileOf, WorldGen } from '../world/worldgen';
import {
  ANIMALS, DAY_LENGTH, pointInPiece, toLocal, toWorld, World, type AnimalObj, type ForageObj, type PileObj, type StructureObj, type TreeObj, type WorldObj,
} from '../world/world';
import {
  ACTION_MAP, ACTIONS, COMFORT_REGEN, craftProblem, DIG_RADIUS, EARTH_PER_ITEM, LEVEL_RADIUS, type ActionDef, type Ctx, type Target,
} from './actions';
import { DevSettings } from './dev';
import { distVol, Sound } from './sound';
import { HELD_ITEMS, type SwingKind } from './tools';
import { ViewModel } from './viewmodel';
import { treeScale } from '../world/treefx';
import { CharacterRig, characterLoaded, SEGMENTS, type Clip } from './character';
import { MinigameSession, minigameVerb, type MinigameSpec } from './minigames';
import { TutorialProgress, tutorialKey } from './minigames/tutorials';
import { FORAGE, type ForageCategory } from '../data/forage';
import { ForageGrowth, forageRegion, Knowledge, noticeOf } from './forage';
import { Input } from './input';
import { CARRY_CAPACITY, Inventory } from './inventory';
import { Player } from './player';
import { Sky } from './sky';
import type { UI } from '../ui/ui';
import { Tour } from './tour';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { QuestLog } from './quests';
import { Combat } from './combat';
import { WorldMap } from '../ui/worldmap';

const REACH = 4.5;
/** Skill above a task's difficulty needed to do it the quick way. */
export const QUICK_MARGIN = 10;
const BUILD_REACH = 8;
const SAVE_KEY = 'survivalcrafter.save.v5';
/** Saves from older world generators, which can't be loaded into the current one, and why. */
export const OLD_SAVES: [string, string][] = [
  ['survivalcrafter.save.v4', 'The world now goes on forever, so worlds from before can no longer be loaded. Start a new world to play.'],
  ['survivalcrafter.save.v3', 'The world is now a vast open continent that streams in as you explore, so worlds from before can no longer be loaded. Start a new world to play.'],
  ['survivalcrafter.save.v2', 'Worlds are now shaped by erosion, so worlds from before the change can no longer be loaded. Start a new world to play.'],
  ['survivalcrafter.save.v1', 'The world is now made of voxels, so worlds from the old tile terrain can no longer be loaded. Start a new world to play.'],
];

/** What digging each material gives you. */
const EARTH_ITEMS: Partial<Record<Mat, string>> = {
  [Mat.Grass]: 'dirt', [Mat.Dirt]: 'dirt', [Mat.Field]: 'dirt', [Mat.Sand]: 'sand', [Mat.Clay]: 'clay',
  [Mat.Rock]: 'rock_shard', [Mat.Iron]: 'iron_ore',
  [Mat.Sandstone]: 'rock_shard', [Mat.Shale]: 'rock_shard', [Mat.Gravel]: 'rock_shard',
};

export interface RunningAction {
  def: ActionDef;
  ctx: Ctx;
  elapsed: number;
  total: number;
  startPos: THREE.Vector3;
  /** Resolved early, at the moment of impact (the rest of the time is follow-through). */
  resolved?: boolean;
  /** For long looping swings: which swing last landed. */
  lastBlow?: number;
}

interface QueuedAction { def: ActionDef; ctx: Ctx }

interface PendingDrop { left: number; done: boolean; at: { x: number; z: number }; land: (x: number, z: number) => void }

export type MsgKind = 'info' | 'good' | 'fail' | 'warn' | 'skill';

/** The smithy around you: a lit forge, the bellows set against it, your best anvil, a trough. */
export interface Smithy { forge?: StructureObj; bellows?: StructureObj; anvil?: StructureObj; trough?: StructureObj }

export interface Placement { def: StructureDef; valid: boolean; reason: string; x: number; y: number; z: number; yaw: number; snapped: boolean }

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
  knowledge = new Knowledge();
  growth = new ForageGrowth();
  /** Forage finds revealed by a survey, until a time (seconds of play). */
  revealed = new Map<number, number>();
  private markers = new THREE.Group();
  private markerTex = makeGlowTexture();
  private lastForagingLevel = 0;
  dev = new DevSettings();
  graphics = new GraphicsSettings();
  private lastFrame = -Infinity;
  private frameNo = 0;

  target: Target | null = null;
  action: RunningAction | null = null;
  queue: QueuedAction[] = [];
  lastAction: { def: ActionDef; recipe?: Recipe } | null = null;
  activeUid: number | null = null;
  hotbar: (string | null)[] = Array(9).fill(null);
  /** What you're wearing, by slot (item uids; the items stay in your pack). */
  equipped: Partial<Record<WearSlot, number>> = {};
  placing: StructureDef | null = null;
  /** The equipment item being set down, when placing one rather than planning a building. */
  placingItem: Item | null = null;
  placement: Placement | null = null;
  paused = false;
  private abandoned = false;

  /** Hands-on work in progress (a crafting or building minigame). */
  working: { session: MinigameSession; def: ActionDef; ctx: Ctx; key: string } | null = null;
  /** How many times you've done each kind of hands-on work (for first-time guides). */
  readonly tutorials = new TutorialProgress();
  /** Windows to reopen once the work is done. */
  private reopen: string[] = [];

  /** Fractional earth dug (positive) or owed for fills (negative), per item type. */
  earth: Record<string, number> = {};
  /** Set by a levelling step that should continue. */
  levelling = false;
  placeYaw = 0;

  private brush: THREE.LineLoop;
  private brushOuter: THREE.LineLoop;
  private ghost: THREE.Group | null = null;
  private ghostType = '';
  private ghostMats = {
    ok: new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.4, depthWrite: false }),
    bad: new THREE.MeshBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.4, depthWrite: false }),
  };
  private timer = new THREE.Timer();
  private renderDt = 1 / 60;
  /** What's in view, for the near trees and plants, and (looser, so redone less often) the grass. */
  private viewCull = new ViewCull(8, 3);
  private torchLight = new THREE.PointLight(0xffa24a, 0, 15, 1.6);
  private grassCull = new ViewCull(15, 4);
  /** Felled trees whose logs haven't landed yet. */
  private pendingDrops: PendingDrop[] = [];
  private screeTimer = 0;
  private steepTipShown = false;
  readonly sound = new Sound();
  /** Grass, plants, rocks and logs around you (visual only). */
  groundCover!: GroundCover;
  private distant!: DistantLand;
  private tileWorkers?: WorkerTiles;
  private tileTimer = 0;
  private fireflies = new Fireflies();
  /** What the surroundings sound and look like right now, refreshed a couple of times a second. */
  private amb = { wind: 0.3, water: 0, birds: 0, crickets: 0, frogs: 0, fireflies: 0, sway: 0.4 };
  private ambTimer = 0;
  private viewModel = new ViewModel();
  private saveTimer = 0;
  private respawnTimer = 0;
  elapsed = 0;
  /** Explanations already shown (and acknowledged) in this world. */
  tips = new Set<string>();
  /** Swinging, drawing a bow, arrows in flight; and whether you're in a fight. */
  readonly combat = new Combat(this);
  /** The land you've explored, for the map (M). */
  map!: WorldMap;
  /** The tutorial quest on a new world (null on worlds from before it, once it's over and saved as done it stays done). */
  /** Your quests (a world from before quests has an empty log, so later quests are still offered). */
  quests: QuestLog | null = null;
  /** The main menu's backdrop: a camera touring this world, with no one in it (never saved). */
  tour: Tour | null = null;

  constructor(canvas: HTMLCanvasElement, world: World) {
    // Log depth: the view runs out to kilometres without distant hills flickering.
    // (MSAA on the canvas can only be chosen now: turning anti-aliasing off or on takes a restart.)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.graphics.aa !== 'off', powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    // Planned pieces draw the built part solid and the rest as a blueprint, split by clipping planes.
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 7000);
    this.input = new Input(canvas);

    this.world = world;
    this.map = new WorldMap(world.terrain.gen);
    this.scene.add(world.terrain.group);
    this.view = new WorldView(world);
    this.knowledge.load(undefined);
    this.view.forageVisible = (o) => this.canSee(o);
    world.regionHooks.push(forageRegion);
    this.scene.add(this.markers);
    this.scene.add(this.view.group);
    this.scene.add(this.player.model);
    // The light of a torch in your hand (always in the scene, dark when unused,
    // so lighting one doesn't make every material rebuild its shader).
    this.scene.add(this.torchLight);
    this.sky = new Sky(this.scene);
    this.sky.groundAt = (x, z) => this.distant.groundAt(x, z);
    // The rest of the world, out to the horizon: map tiles are made in the
    // background as you travel, and each becomes distant land when it arrives.
    const gen = world.terrain.gen;
    this.distant = new DistantLand(gen.seed);
    this.distant.bakeTrees(this.renderer);
    this.distant.lakeLevels = (tx, tz) => gen.settledLakes(tx, tz);
    this.scene.add(this.distant.group);
    gen.onTile = (d, lod, forest) => { this.distant.addTile(d, lod, forest); seaFloor.changed(); };
    gen.forEachTile((d) => this.distant.addTile(d));
    if (gen.tileSource instanceof WorkerTiles) this.tileWorkers = gen.tileSource;
    else {
      try {
        this.tileWorkers = new WorkerTiles(gen.seed, (d, lod, forest) => gen.addTile(d, lod, forest), TILE);
        gen.useSource(this.tileWorkers);
      } catch { /* no workers: tiles are made on the main thread when needed */ }
    }
    this.groundCover = new GroundCover(world);
    this.groundCover.view = this.grassCull;
    this.applyGraphics();
    this.scene.add(this.groundCover.group, this.fireflies.points);
    // A piece going up (or coming down) changes the grass round it: redraw the patches it reaches.
    this.view.onStructure = (o) => this.groundCover.invalidate(o.x, o.z, 4.5);
    // A find turning up (or going) where the grass is already drawn: redraw that patch round it.
    this.view.onLowFind = (o) => this.groundCover.invalidateIfDrawn(o.x, o.z);

    const ring = (opacity: number) => new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, () => new THREE.Vector3())),
      new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true, opacity, depthTest: false, fog: false }),
    );
    this.brush = ring(0.85);
    this.brushOuter = ring(0.35);
    this.brush.renderOrder = this.brushOuter.renderOrder = 5;
    this.scene.add(this.brush, this.brushOuter);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer?.setSize(window.innerWidth, window.innerHeight);
    });
    // Save when the tab is hidden or closed. Hiding comes first and gives the
    // save time to finish; closing alone may not wait for it.
    window.addEventListener('beforeunload', () => { if (!this.abandoned) void this.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && !this.abandoned) void this.save(); });
  }

  // ---------- setup
  newCharacter() {
    const s = this.world.spawn;
    this.player.pos.set(s.x, this.world.terrain.heightAt(s.x, s.z) + 0.1, s.z);
    // A very humble start: empty hands and a couple of handfuls of berries.
    // Your first tool is a knife you knap yourself.
    this.inv.add(makeItem('berries', 10));
    this.inv.add(makeItem('berries', 10));
    this.msg('You wake in the wilderness with empty hands and a few berries. Press H for help.', 'warn');
    this.msg('Follow the tutorial on the right: it walks you from bare hands to your first house.', 'info');
    this.quests = QuestLog.begin(this.markerTex, s.x, s.z);
  }

  /** Show this world as the main menu's backdrop: a slow camera tour, nothing to play. */
  startTour(fade: HTMLElement) {
    this.abandoned = true;
    const s = this.world.spawn;
    this.player.pos.set(s.x, this.world.terrain.heightAt(s.x, s.z), s.z);
    this.tour = new Tour(this.world.terrain.gen, s, fade, () => this.world.terrain.pendingChunks);
    this.brush.visible = this.brushOuter.visible = false;
    this.start();
  }

  private tourStep(dt: number) {
    const t = this.tour!, p = this.player;
    t.update(dt, this.camera);
    p.pos.copy(t.focus);
    this.world.time = this.world.time - this.world.dayFraction * DAY_LENGTH + t.day * DAY_LENGTH;
    perf.time('terrain', () => this.world.terrain.update(p.pos.x, p.pos.y, p.pos.z, 6));
    this.world.focus = { x: p.pos.x, z: p.pos.z };
    perf.time('objects', () => this.world.stream(p.pos.x, p.pos.z, 1));
  }

  start() {
    // Mesh the land around you before the first frame; the rest streams in.
    const p = this.player.pos;
    // The distant land too (as it arrives later, it's made a tile a frame).
    this.distant.drain(Infinity);
    this.world.stream(p.x, p.z, 999);
    this.world.keepAnimals(p.x, p.z);
    this.world.terrain.buildNear(p.x, p.y, p.z, 40);
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
    // Clothing that has left your pack (dropped, stored) comes off.
    for (const slot of WEAR_SLOTS) this.worn(slot);
    this.ui?.refresh();
  }

  activeItem(): Item | undefined {
    return this.activeUid === null ? undefined : this.inv.find(this.activeUid);
  }

  setActive(uid: number | null) {
    this.activeUid = uid;
    const it = this.activeItem();
    this.player.setHeld(it ? itemDef(it.type).tool : undefined, it?.type);
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

  /** Bind on a bandage (takes a few seconds, and not in a fight). */
  applyBandage() {
    this.request(ACTION_MAP.apply_bandage, { g: this, t: { kind: 'none' } });
  }

  autoBind(it: Item) {
    if (!itemDef(it.type).tool && !HELD_ITEMS.has(it.type) && it.type !== 'bandage') return;
    if (this.hotbar.includes(it.type)) return;
    const free = this.hotbar.indexOf(null);
    if (free >= 0) this.hotbar[free] = it.type;
  }

  /** What's worn in a slot (forgetting anything no longer in your pack). */
  worn(slot: WearSlot): Item | undefined {
    const uid = this.equipped[slot];
    if (uid === undefined) return undefined;
    const it = this.inv.find(uid);
    if (!it) { delete this.equipped[slot]; this.dressPlayer(); }
    return it;
  }

  /** Put on a piece of clothing (taking off what was in its slot). */
  putOn(uid: number) {
    const it = this.inv.find(uid), w = it && itemDef(it.type).wear;
    if (!it || !w) return;
    this.equipped[w.slot] = uid;
    this.msg(`You put on the ${itemName(it).toLowerCase()}.`, 'info');
    this.dressPlayer();
    this.inventoryChanged();
  }

  takeOff(slot: WearSlot) {
    const it = this.worn(slot);
    delete this.equipped[slot];
    if (it) this.msg(`You take off the ${itemName(it).toLowerCase()}.`, 'info');
    this.dressPlayer();
    this.inventoryChanged();
  }

  /** How much of a blow your clothing takes (0..0.6): each piece by its kind and quality. */
  armor(): number {
    let a = 0;
    for (const slot of WEAR_SLOTS) {
      const it = this.worn(slot);
      if (it) a += itemDef(it.type).wear!.armor * (0.6 + it.ql / 125);
    }
    return Math.min(0.6, a);
  }

  /** Show what you're wearing on your character. */
  dressPlayer() {
    const colours: Partial<Record<WearSlot, number>> = {};
    for (const slot of WEAR_SLOTS) {
      const uid = this.equipped[slot];
      const it = uid !== undefined ? this.inv.find(uid) : undefined;
      if (it) colours[slot] = itemDef(it.type).wear!.colour;
    }
    this.player.dress(colours);
  }

  /** Put an item type in a hotbar slot. A type lives in one slot only, so it moves (swapping with the target). */
  bindHotbar(slot: number, type: string | null) {
    const from = type ? this.hotbar.indexOf(type) : -1;
    if (from >= 0 && from !== slot) this.hotbar[from] = this.hotbar[slot];
    this.hotbar[slot] = type;
    this.ui?.refresh();
  }

  swapHotbar(a: number, b: number) {
    [this.hotbar[a], this.hotbar[b]] = [this.hotbar[b], this.hotbar[a]];
    this.ui?.refresh();
  }

  /** Activate the best item of the slot's type, or put it away if it's already active. */
  useHotbar(slot: number) {
    const type = this.hotbar[slot];
    const it = type ? this.inv.ofType(type)[0] : undefined;
    if (!it) return;
    if (type === 'bandage') return this.applyBandage();
    const active = this.activeItem();
    this.setActive(active && active.type === type ? null : it.uid);
  }

  /** Step to the next (dir 1) or previous (-1) hotbar slot holding something you can hold, wrapping round. */
  cycleHotbar(dir: number) {
    const active = this.activeItem();
    let at = active ? this.hotbar.indexOf(active.type) : -1;
    if (at < 0) at = dir > 0 ? -1 : this.hotbar.length;
    for (let n = 0; n < this.hotbar.length; n++) {
      at = (at + dir + this.hotbar.length) % this.hotbar.length;
      const type = this.hotbar[at];
      if (!type || type === 'bandage') continue; // (a bandage is applied, not held)
      const it = this.inv.ofType(type)[0];
      if (!it) continue;
      if (it.uid !== this.activeUid) this.setActive(it.uid);
      return;
    }
  }

  /** Drop items in a pile on the ground below a point, merging with a pile already there. */
  dropToGround(items: Item[], x: number, y: number, z: number) {
    for (const it of items) if (it.hot) { delete it.hot; this.msg(`The ${itemName(it).toLowerCase()} hisses and cools on the ground.`, 'info'); }
    const existing = this.world.near(x, z, 1.5).find((o) => o.kind === 'pile' && Math.hypot(o.x - x, o.z - z) < 1.2 && Math.abs(o.y - y) < 1.5) as PileObj | undefined;
    if (existing) {
      existing.items.push(...items);
      this.world.changed(existing);
      return existing;
    }
    let gy = this.world.terrain.groundBelow(x, y + 0.5, z);
    if (!Number.isFinite(gy)) gy = this.world.terrain.heightAt(x, z);
    return this.world.add<PileObj>({ kind: 'pile', x, y: gy, z, items });
  }

  dropItems(uids: number[]) {
    const items = uids.map((u) => this.inv.remove(u)).filter((i): i is Item => !!i);
    if (!items.length) return;
    const f = this.player.forward();
    const p = this.player.pos;
    this.dropToGround(items, p.x + f.x * 0.8, p.y, p.z + f.z * 0.8);
    this.inventoryChanged();
  }

  earthCredit(type: string): number {
    return Math.max(0, this.earth[type] ?? 0);
  }

  /** Turn dug volume into items (whole items only; the rest carries over). Returns a description. */
  collectEarth(vol: Volumes, ql: number): string {
    const got: Record<string, number> = {};
    for (const [m, v] of Object.entries(vol)) {
      const type = EARTH_ITEMS[Number(m) as Mat];
      if (!type || !v) continue;
      this.earth[type] = (this.earth[type] ?? 0) + v;
      while (this.earth[type] >= EARTH_PER_ITEM) {
        this.earth[type] -= EARTH_PER_ITEM;
        got[type] = (got[type] ?? 0) + 1;
      }
    }
    for (const [type, n] of Object.entries(got)) this.give(type, Math.max(1, ql), n);
    return Object.entries(got).map(([t, n]) => `${n} ${itemDef(t).name.toLowerCase()}`).join(', ');
  }

  /** Pay for filled-in volume with earth items. */
  spendEarth(type: string, volume: number) {
    this.earth[type] = (this.earth[type] ?? 0) - volume;
    while (this.earth[type] < -1e-6) {
      if (!this.inv.take(type, 1).length) { this.earth[type] = 0; break; }
      this.earth[type] += EARTH_PER_ITEM;
    }
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
      delete it.hot;
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
    const known = isIdentified(it.type);
    const harmful = f.effect === 'nausea' || f.effect === 'poison' || f.effect === 'severe_poison';
    if (known && harmful) return this.msg(`You know better than to eat ${itemDef(it.type).name.toLowerCase()}.`, 'fail');
    if (f.nutrition > 0 && p.food >= 99 && !f.water && !f.effect) return this.msg('You are too full to eat.', 'fail');
    const name = itemName(it).toLowerCase();
    const qm = 0.6 + it.ql / 125;
    p.food = Math.min(100, p.food + f.nutrition * qm);
    p.water = Math.min(100, p.water + (f.water ?? 0) * (f.nutrition ? qm : 1));
    if (f.nutrition > 0 && !harmful) this.quests?.note('ate');
    if (f.returns) {
      it.type = f.returns;
      this.msg(`You ${f.nutrition ? 'eat' : 'drink'} the ${name}.`, 'info');
    } else {
      this.inv.remove(uid);
      const verb = f.verb ? f.verb.toLowerCase() : 'eat';
      this.msg(`You ${verb} the ${name}.${it.type === 'raw_meat' || it.type === 'mushroom' ? ' It is not very appetising raw.' : ''}`, 'info');
      if (it.type === 'raw_meat' && Math.random() < 0.3) { p.health -= 8; this.msg('Your stomach cramps.', 'fail'); }
    }
    if (f.effect) this.applyEffect(f.effect, it.type);
    // Eating something teaches you what it was, one way or another.
    if (!known) {
      learnSpecies(it.type);
      this.msg(harmful ? `That was ${itemDef(it.type).name.toLowerCase()}. You won't forget it.` : `It was ${itemDef(it.type).name.toLowerCase()}. Now you know.`, harmful ? 'warn' : 'skill');
    }
    this.inventoryChanged();
  }

  private applyEffect(effect: string, type: string) {
    const p = this.player;
    const fx = p.effects;
    switch (effect) {
      case 'nausea':
        p.food = Math.max(0, p.food - 15);
        p.stamina = 0;
        p.health -= 5;
        fx.nauseous = { t: 45, rate: 0 };
        this.msg('Your stomach heaves. You are violently sick.', 'warn');
        break;
      case 'poison':
        fx.poisoned = { t: 30, rate: 0.6 };
        this.msg('A cold sweat breaks out. You have been poisoned!', 'warn');
        break;
      case 'severe_poison':
        fx.poisoned = { t: 45, rate: 1.1 };
        this.msg('Your limbs go numb and your heart races. This is deadly poison — treat it now!', 'warn');
        break;
      case 'heal':
        p.health = Math.min(100, p.health + 30);
        if (fx.poisoned) { delete fx.poisoned; this.msg('The poultice draws out the poison.', 'good'); }
        else this.msg('The poultice soothes your wounds.', 'good');
        break;
      case 'soothe':
        p.health = Math.min(100, p.health + 6);
        if (fx.poisoned) fx.poisoned.t = Math.max(0, fx.poisoned.t - 10);
        this.msg('The bitter leaves settle you a little.', 'info');
        break;
      case 'refresh': {
        const tea = type !== 'mint';
        p.stamina = Math.min(100, p.stamina + (tea ? 100 : 30));
        fx.refreshed = { t: tea ? 180 : 40, rate: 0 };
        delete fx.nauseous;
        this.msg(tea ? 'The tea clears your head. You feel tireless.' : 'The fresh taste perks you up.', 'good');
        break;
      }
    }
  }

  // ---------- foraging
  /** Can the player see this find? Rarer ones need skill, or a survey. */
  canSee(o: ForageObj): boolean {
    return noticeOf(o) <= this.skills.get('foraging') || (this.revealed.get(o.id) ?? 0) > this.elapsed;
  }

  /** Look around carefully and mark what's growing nearby. */
  survey(success: boolean) {
    const p = this.player.pos;
    const skill = this.skills.get('foraging');
    const radius = (success ? 14 : 7) + skill * 0.25;
    const counts: Partial<Record<ForageCategory, number>> = {};
    let hidden = 0;
    this.markers.clear();
    const until = this.elapsed + 12;
    for (const o of this.world.near(p.x, p.z, radius)) {
      if (o.kind !== 'forage' || Math.hypot(o.x - p.x, o.z - p.z) > radius) continue;
      const sp = FORAGE[o.species];
      if (sp.notice > skill + 15) continue;
      if (sp.notice > skill) { hidden++; this.revealed.set(o.id, until); this.world.changed(o); }
      counts[sp.category] = (counts[sp.category] ?? 0) + 1;
      const colour = sp.notice > skill ? 0xffd54a : MARKER_COLOURS[sp.category];
      const top = o.y + forageHeight(o.species) * forageScale(sp.category) + 0.35;
      const glow = (sx: number, sy: number, y: number, bob: boolean) => {
        const m = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.markerTex, color: colour, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        m.position.set(o.x, y, o.z);
        m.scale.set(sx, sy, 1);
        m.userData = { until, baseY: y, id: o.id, bob };
        m.renderOrder = 6;
        this.markers.add(m);
      };
      glow(0.7, 0.7, top, true);
      glow(0.12, 2.2, top + 0.9, false); // a soft beam so it reads from a distance
    }
    const parts = (Object.entries(counts) as [ForageCategory, number][])
      .map(([c, n]) => `${n} ${CATEGORY_WORDS[c][n === 1 ? 0 : 1]}`);
    if (!parts.length) return this.msg(success ? 'You look around carefully. Nothing worth picking nearby.' : 'You look around, but nothing catches your eye.', 'info');
    this.msg(`You spot ${parts.join(', ')} within ${Math.round(radius)} m.${hidden ? ` ${hidden} of them you would normally have missed.` : ''}`, 'good');
  }

  private updateMarkers() {
    for (const m of [...this.markers.children] as THREE.Sprite[]) {
      const left = m.userData.until - this.elapsed;
      if (left <= 0 || !this.world.objects.has(m.userData.id)) { this.markers.remove(m); m.material.dispose(); continue; }
      m.material.opacity = Math.min(1, left / 3) * (m.userData.bob ? 0.9 : 0.3);
      if (m.userData.bob) m.position.y = m.userData.baseY + Math.sin(this.elapsed * 3 + m.userData.id) * 0.08;
    }
    // Revealed finds hide again when the survey wears off; a skill-up may show new ones.
    let changed = false;
    for (const [id, until] of this.revealed) {
      if (until > this.elapsed) continue;
      this.revealed.delete(id);
      const o = this.world.objects.get(id);
      if (o) this.world.changed(o);
      changed = true;
    }
    const lvl = Math.floor(this.skills.get('foraging'));
    if (lvl !== this.lastForagingLevel) { this.lastForagingLevel = lvl; changed = true; this.view.refreshForage(); }
    return changed;
  }

  /** Can an identifiable item be used in recipes? Only once you know what it is. */
  usableCount(type: string): number {
    return isIdentified(type) ? this.inv.count(type) : 0;
  }

  stationNear(kind: StationKind): boolean {
    // A forge only gets hot enough for metal with bellows blowing into it.
    if (kind === 'forge') return !!this.smithy().bellows;
    if (kind === 'anvil') return !!this.smithy().anvil;
    const p = this.player.pos;
    for (const o of this.world.near(p.x, p.z, 4)) {
      if (o.kind !== 'structure' || !o.built) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) > 4) continue;
      const st = STRUCTURES[o.type].station;
      if (kind === 'fire' && (st === 'fire' || st === 'forge') && o.lit) return true;
      if (kind === st && kind !== 'fire') return true;
    }
    return false;
  }

  /** Bellows set against a forge's side. */
  bellowsOf(forge: StructureObj): StructureObj | undefined {
    return this.world.near(forge.x, forge.z, 2).find((o): o is StructureObj =>
      o.kind === 'structure' && o.type === 'bellows' && Math.hypot(o.x - forge.x, o.z - forge.z) < 1.6 && Math.abs(o.y - forge.y) < 0.6);
  }

  smithy(): Smithy {
    const p = this.player.pos;
    const out: Smithy = {};
    let anvilScore = -1;
    for (const o of this.world.near(p.x, p.z, 4)) {
      if (o.kind !== 'structure' || !o.built || Math.hypot(o.x - p.x, o.z - p.z) > 4) continue;
      if (o.type === 'forge' && o.lit) {
        const b = this.bellowsOf(o);
        // Prefer a forge that has bellows.
        if (!out.forge || (b && !out.bellows)) { out.forge = o; out.bellows = b; }
      } else if (STRUCTURES[o.type].station === 'anvil') {
        const score = anvilGrade(o);
        if (score > anvilScore) { anvilScore = score; out.anvil = o; }
      } else if (o.type === 'quench_trough' && (!out.trough || o.ql > out.trough.ql)) {
        out.trough = o;
      }
    }
    return out;
  }

  /** Is a forge lit nearby but missing its bellows? (For a helpful message.) */
  forgeWithoutBellows(): boolean {
    const s = this.smithy();
    return !!s.forge && !s.bellows;
  }

  /** Best tool of a kind: the active item if it qualifies, else the best in the pack. */
  toolFor(kind: string | undefined): Item | undefined {
    if (!kind) return undefined;
    const a = this.activeItem();
    if (a && !a.hot && itemDef(a.type).tool === kind) return a;
    return this.inv.items.filter((i) => !i.hot && itemDef(i.type).tool === kind).sort((x, y) => y.ql - x.ql)[0];
  }

  // ---------- actions
  actionsFor(t: Target): { def: ActionDef; ctx: Ctx; label: string; problem: string | null }[] {
    // A torch is held up in the other hand, as it were: you work as with bare hands.
    const held = this.activeItem();
    const ctx: Ctx = { g: this, t, tool: held && HELD_ITEMS.has(held.type) ? undefined : held };
    const out = [];
    for (const def of ACTIONS) {
      // Structures pick the right tool automatically.
      let c = ctx;
      if ((def.id === 'continue_build' || def.id === 'quick_build') && t.kind === 'object' && t.obj.kind === 'structure') {
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
    if (this.action || this.working) {
      if (this.queue.length >= 5) return this.msg('You cannot queue any more actions.', 'fail');
      this.queue.push({ def, ctx });
      this.msg(`Queued: ${typeof def.label === 'function' ? def.label(ctx) : def.label}.`, 'info');
      return;
    }
    this.begin(def, ctx);
  }

  craft(r: Recipe, count: number, quick = false) {
    const tool = this.toolFor(r.tool);
    const ctx: Ctx = { g: this, t: { kind: 'none' }, tool, recipe: r, quick };
    const problem = craftProblem(this, r, tool);
    if (problem) { this.msg(problem, 'fail'); return; }
    for (let i = 0; i < count; i++) this.request(ACTION_MAP.craft, ctx);
  }

  /**
   * Is what an action is aimed at gone? A plant picked, a pile emptied, a
   * tree felled, a boulder broken up, an animal gone: the action (and any
   * queued after it on the same thing) has nothing left to work on.
   */
  private targetGone(ctx: Ctx): boolean {
    const t = ctx.t;
    if (t.kind === 'object') return this.world.objects.get(t.obj.id) !== t.obj;
    if (t.kind === 'animal') return !this.world.animals.includes(t.animal);
    if (t.kind === 'rock') return this.world.brokenRocks.has(t.rock.key);
    return false;
  }

  private begin(def: ActionDef, ctx: Ctx): boolean {
    if (this.targetGone(ctx)) { this.msg('There is nothing there any more.', 'fail'); return false; }
    if (ctx.tool?.hot && def.toolWear) { this.msg(`The ${itemName(ctx.tool).toLowerCase()} is too hot to work with. Quench it or let it cool.`, 'fail'); return false; }
    const problem = def.check?.(ctx) ?? null;
    if (problem) { this.msg(problem, 'fail'); return false; }
    const stamina = def.stamina ?? 0;
    if (stamina > 0 && this.player.stamina < stamina) { this.msg('You are too exhausted. Rest a moment.', 'fail'); return false; }
    const base = typeof def.time === 'function' ? def.time(ctx) : def.time;
    if (base <= 0) {
      def.run(ctx, { success: true, ql: 0, toolQl: 0 });
      return true;
    }
    const instant = this.dev.on('instantActions') || (this.dev.on('instantCraft') && def.id === 'craft');
    const spec = !instant && !ctx.quick && !def.quick ? def.minigame?.(ctx) : undefined;
    if (spec) {
      this.startWork(def, ctx, spec);
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
    if (instant) total = 0;
    this.action = { def, ctx, elapsed: 0, total, startPos: this.player.pos.clone() };
    this.lastAction = { def, recipe: ctx.recipe };
    return true;
  }

  /** Can this work be done the quick way (a plain timed action at a quality cost)? */
  canQuick(skill: SkillId, difficulty: number): boolean {
    return this.skills.get(skill) >= difficulty + QUICK_MARGIN;
  }

  /** Start hands-on work: the view moves to the workstation and you do the job yourself. */
  private startWork(def: ActionDef, ctx: Ctx, spec: MinigameSpec) {
    const skill = this.skillOf(def, ctx);
    const diff = typeof def.difficulty === 'function' ? def.difficulty(ctx) : def.difficulty ?? 1;
    const lvl = skill ? this.skills.get(skill) : 1;
    const tool = ctx.tool;
    const power = tool ? itemDef(tool.type).toolPower ?? 1 : 1;
    // Skill above the task's difficulty, and a good tool, make the work more forgiving.
    // Your first go at a kind of work is a forgiving practice run with a guide.
    const key = tutorialKey(spec);
    const runs = this.tutorials.count(key);
    const ease = Math.max(0.15, Math.min(1, 0.32 + (lvl - diff) / 50 + (power - 0.7) * 0.3 + (tool?.ql ?? 0) / 400 + (runs === 0 ? 0.3 : 0)));
    // (Equipment like bellows and anvils helps through the spec's own `gear`.)
    if (!this.working && !this.reopen.length) this.reopen = this.ui.closeAllWindows();
    const label = typeof def.label === 'function' ? def.label(ctx) : def.label;
    const session = new MinigameSession(spec, ease, this.ui.root, (perf, secs) => this.endWork(perf, secs), label,
      { intro: runs === 0, coach: runs < 3 }, tool?.type, { scene: this.scene, camera: this.camera });
    // Building happens at the piece itself: step up to it.
    const stand = (session.mg as { stand?: { x: number; z: number; yaw: number } }).stand;
    if (stand) {
      const p = this.player, t = this.world.terrain;
      const y = this.player.groundAt(this.world, stand.x, t.heightAt(stand.x, stand.z) + 1, stand.z).y;
      if (Number.isFinite(y) && this.player.penetration(this.world, stand.x, y + 0.02, stand.z) === 0) { p.pos.set(stand.x, y + 0.02, stand.z); p.vel.set(0, 0, 0); }
      p.yaw = stand.yaw;
      p.pitch = 0;
    }
    this.working = { session, def, ctx, key };
    this.lastAction = { def, recipe: ctx.recipe };
    if (runs > 0) this.msg(`You set to work (${minigameVerb(spec)}). Right-click to stop.`, 'info');
  }

  private endWork(perf: number | null, seconds: number) {
    const w = this.working;
    this.working = null;
    if (!w) return;
    if (perf === null) {
      this.msg('You stop working.', 'info');
      this.queue = [];
      this.repeatBlocked = false;
    } else {
      this.tutorials.record(w.key);
      this.complete(w.def, w.ctx, Math.max(2, seconds), perf);
    }
    if (!this.working && !this.action && this.reopen.length) {
      for (const n of this.reopen) this.ui.show(n as Parameters<UI['show']>[0]);
      this.reopen = [];
    }
  }

  private skillOf(def: ActionDef, ctx: Ctx): SkillId | undefined {
    return typeof def.skill === 'function' ? def.skill(ctx) : def.skill;
  }

  cancelAction(reason?: string) {
    if (this.working) this.working.session.cancel();
    if (this.action && reason) this.msg(reason, 'fail');
    this.action = null;
    this.levelling = false;
    this.queue = [];
    this.player.swing = 0;
  }

  cancelQueue() {
    this.queue = [];
    this.repeatBlocked = true;
  }
  private repeatBlocked = false;

  private finish(a: RunningAction) {
    this.complete(a.def, a.ctx, a.total);
  }

  /**
   * Resolve a finished piece of work. `perf` (0..1) is how well a minigame
   * went; without it, the outcome is a plain skill roll.
   */
  private complete(def: ActionDef, ctx: Ctx, seconds: number, perf?: number, atImpact = false) {
    // Conditions may have changed while working (and what you were working on may be gone).
    if (this.targetGone(ctx)) {
      this.msg('There is nothing there any more.', 'fail');
      if (!atImpact) { this.action = null; this.afterAction(def, ctx, false); }
      return;
    }
    const problem = def.check?.(ctx) ?? null;
    if (problem) { this.msg(problem, 'fail'); this.action = null; this.queue = []; return; }
    const quick = !!ctx.quick || !!def.quick;
    const skill = this.skillOf(def, ctx);
    const diff = typeof def.difficulty === 'function' ? def.difficulty(ctx) : def.difficulty ?? 1;
    const tool = ctx.tool;
    const toolQl = tool?.ql ?? 0;
    const power = tool ? itemDef(tool.type).toolPower ?? 1 : 0.5;
    let success = true;
    let ql = 10;
    if (skill) {
      const base = this.skills.rollQuality(skill, toolQl, 0, power);
      if (perf !== undefined) {
        // Your hands decide: performance sets most of the quality, skill caps it.
        success = this.dev.on('alwaysSucceed') || perf >= 0.3;
        ql = Math.max(1, Math.min(this.skills.get(skill) + 8, base * (0.55 + 0.65 * perf)));
      } else {
        success = this.dev.on('alwaysSucceed') || Math.random() < this.skills.successChance(skill, diff, toolQl, power);
        ql = quick ? base * 0.85 : base;
      }
      const before = this.skills.get(skill);
      const gain = this.skills.gain(skill, diff, success, seconds);
      if (Math.floor(before) !== Math.floor(before + gain)) {
        this.msg(`${skillName(skill)} increased to ${Math.floor(before + gain)}.`, 'skill');
      }
    }
    this.player.stamina = Math.max(0, this.player.stamina - (def.stamina ?? 0));
    if (tool && def.toolWear) this.wear(tool, def.toolWear);
    // Crude equipment limits how good the work can get.
    const cap = def.qualityCap?.(ctx);
    if (cap !== undefined) ql = Math.min(ql, cap);
    if (!atImpact) this.action = null;
    def.run(ctx, { success, ql, toolQl, perf, cap });
    this.ui?.refresh();
    if (!atImpact) this.afterAction(def, ctx);
  }

  /** Wear a tool down (quenched tools resist); it breaks at 100 damage. */
  wear(tool: Item, amount: number) {
    if (this.dev.on('noToolWear') || !this.inv.find(tool.uid)) return;
    const power = itemDef(tool.type).toolPower ?? 1;
    tool.dmg += (amount * (1.5 - tool.ql / 100) * (0.5 + Math.random()) * (tool.quenched ? 0.6 : 1)) / Math.max(0.4, power);
    if (tool.dmg >= 100) {
      this.inv.remove(tool.uid);
      this.msg(`Your ${itemName(tool).toLowerCase()} breaks!`, 'warn');
      this.inventoryChanged();
    }
  }

  /** After an action: start the next queued one, else repeat it while it still makes sense. */
  private afterAction(def: ActionDef, ctx: Ctx, mayRepeat = true) {
    // The next queued action, skipping any whose target has gone (picked, emptied, felled…).
    let skipped = 0;
    while (this.queue.length) {
      const next = this.queue.shift()!;
      if (this.targetGone(next.ctx)) { skipped++; continue; }
      if (skipped) this.msg(`${skipped === 1 ? 'A queued action was' : `${skipped} queued actions were`} dropped: there was nothing left there.`, 'info');
      this.begin(next.def, next.ctx);
      return;
    }
    if (skipped) this.msg(`${skipped === 1 ? 'A queued action was' : `${skipped} queued actions were`} dropped: there was nothing left there.`, 'info');
    const rep = typeof def.repeat === 'function' ? def.repeat(ctx) : def.repeat;
    if (mayRepeat && rep && !this.repeatBlocked) {
      const c = { ...ctx, tool: ctx.tool && this.inv.find(ctx.tool.uid) ? ctx.tool : this.activeItem() };
      if (!this.targetGone(c) && !def.check?.(c)) this.begin(def, c);
    }
    this.repeatBlocked = false;
  }

  /** Pebbles, dust and scraping when you slide or can't get up a slope, plus a one-time tip. */
  private slopeFeedback(dt: number) {
    const p = this.player;
    // Only while actually slipping, or pushing into a slope you can't climb (not standing on one).
    const active = (p.slope === 'sliding' && p.slide.length() > 0.4) || (p.slope === 'blocked' && p.moving);
    if (!active) { this.screeTimer = 0; return; }
    this.screeTimer -= dt;
    if (this.screeTimer > 0) return;
    this.screeTimer = p.slope === 'sliding' ? 0.12 : 0.28;
    const t = this.world.terrain;
    const mat = t.materialAt(p.pos.x, p.pos.y - 0.1, p.pos.z);
    const colour = isRock(mat) || mat === Mat.Gravel ? 0x8d8a85 : mat === Mat.Sand ? 0xcdbb88 : 0x6e5638;
    const n = t.normalAt(p.pos.x, p.pos.y - 0.05, p.pos.z);
    const hl = Math.hypot(n.x, n.z) || 1;
    this.view.treeFx.scree(p.pos.x, p.pos.y, p.pos.z, n.x / hl, n.z / hl, colour, p.slope === 'sliding' ? 3 : 2);
    if (!this.steepTipShown) {
      this.steepTipShown = true;
      this.msg('Too steep to climb here. Find a gentler way up, or cut steps into the slope with a shovel or pickaxe.', 'warn');
    }
  }

  /** Turn the body toward what you're working on (third person). */
  private faceToward(t: Target): number | null {
    const p = this.player.pos;
    const at = t.kind === 'object' ? t.obj : t.kind === 'animal' ? t.animal : t.kind === 'terrain' ? t.point : null;
    if (!at) return null;
    const dx = at.x - p.x, dz = at.z - p.z;
    return Math.hypot(dx, dz) < 0.2 ? null : Math.atan2(dx, dz);
  }

  /** Feedback for a blow that lands while mining or digging (the work itself resolves at the end). */
  private blowFx(ctx: Ctx, swing: SwingKind) {
    if (ctx.t.kind !== 'terrain') return;
    const hard = isRock(ctx.t.mat);
    if (swing === 'chop' && hard) this.sound.clink();
    else this.sound.glance(0.8);
    this.player.shake(hard ? 0.35 : 0.2);
  }

  /** A blow lands on a tree: notch, shake, chips, thunk. */
  treeHit(t: TreeObj, strength: number, clean: boolean) {
    const p = this.player.pos;
    this.world.changed(t); // swaps the instanced tree for its own notched model
    this.view.treeFx.hit(t, p.x, p.z, strength, clean);
    if (clean) this.sound.chop(0.6 + strength * 0.4); else this.sound.glance();
    this.player.shake(clean ? 0.3 + strength * 0.25 : 0.15);
  }

  /**
   * Fell a tree: it topples away from you; logs and branches land where the
   * trunk comes down, and a stump is left behind.
   */
  fellTree(t: TreeObj, items: Item[], onDone: () => void) {
    const p = this.player.pos;
    const dx = t.x - p.x, dz = t.z - p.z;
    const { s } = treeScale(t);
    this.world.stumps.push({ x: t.x, z: t.z, s, species: t.species });
    this.view.treeFx.syncStumps(this.world.stumps);
    this.sound.creak(distVol(Math.hypot(dx, dz)));
    // The logs land with the trunk. If the fall is never drawn (e.g. the tab is
    // in the background), drop them anyway after a few seconds.
    const len = Math.hypot(dx, dz) || 1;
    const drop: PendingDrop = {
      left: 6, done: false, at: { x: t.x + (dx / len) * 2, z: t.z + (dz / len) * 2 },
      land: (x, z) => {
        if (drop.done) return;
        drop.done = true;
        this.dropToGround(items, x, this.world.terrain.heightAt(x, z), z);
        onDone();
      },
    };
    this.pendingDrops.push(drop);
    this.view.treeFx.fell(t, dx, dz, (x, z) => {
      const d = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
      this.sound.crash(distVol(d));
      this.player.shake(Math.max(0, 1 - d / 22));
      drop.land(x, z);
    });
    this.world.remove(t);
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
    this.dropToGround([makeItem('corpse', 50, `${d.name.toLowerCase()} corpse`)], a.x, this.world.terrain.heightAt(a.x, a.z), a.z);
    this.msg(`You kill the ${d.name.toLowerCase()}! Butcher the corpse with a knife.`, 'good');
    this.quests?.note(`killed_${a.species}`);
    if (this.action?.ctx.t.kind === 'animal' && this.action.ctx.t.animal === a) this.action = null;
    this.queue = this.queue.filter((q) => !(q.ctx.t.kind === 'animal' && q.ctx.t.animal === a));
  }

  private updateAnimals(dt: number) {
    const w = this.world, t = w.terrain, p = this.player.pos;
    for (const a of w.animals) {
      const d = ANIMALS[a.species];
      const toP = Math.hypot(p.x - a.x, p.z - a.z);
      a.timer -= dt;
      a.attackCooldown -= dt;
      if (a.hurt) a.hurt = Math.max(0, a.hurt - dt);
      // Staggered by a blow: it stands a moment before it can act.
      if ((a.stun ?? 0) > 0) { a.stun! -= dt; a.speed = 0; continue; }
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
          this.combat.lastFight = this.elapsed;
          if ((a.windup ?? 0) > 0) {
            // Head down, it gathers itself... and lunges. Whoever's still in front of it gets the tusks.
            a.windup! -= dt;
            a.speed = a.windup! < 0.15 ? d.speed * 1.8 : 0;
            if (a.windup! <= 0) {
              a.windup = 0;
              a.attackCooldown = 1.6 + Math.random() * 0.8;
              const facing = (p.x - a.x) * a.dirX + (p.z - a.z) * a.dirZ;
              if (toP < 2.2 && facing > 0) {
                if (this.dev.on('godMode')) this.msg(`The ${d.name.toLowerCase()} bounces off you harmlessly.`, 'info');
                else {
                  const armor = this.armor();
                  const dmg = d.damage * (0.75 + Math.random() * 0.5) * (1 - armor);
                  this.player.health -= dmg;
                  this.msg(`The ${d.name.toLowerCase()} gores you! (${Math.round(dmg)}${armor > 0.02 ? `, your clothing took ${Math.round(armor * 100)}%` : ''})`, 'warn');
                  this.ui?.flashDamage();
                  this.player.shake(0.5);
                  if (this.action?.def.id === 'apply_bandage') this.cancelAction('The blow knocks the bandage out of your hands.');
                }
              } else this.msg(`You get clear of the ${d.name.toLowerCase()}'s charge.`, 'info');
            }
          } else {
            a.dirX = (p.x - a.x) / l; a.dirZ = (p.z - a.z) / l;
            a.speed = toP > 1.4 ? d.speed * 0.9 : 0;
            // Close enough: it lowers its head to charge (you have a moment to get out of the way).
            if (toP < 2.0 && a.attackCooldown <= 0) a.windup = 0.6;
          }
          if (a.timer <= 0 || toP > 30) { a.state = 'idle'; a.timer = 3; }
          break;
        }
      }
      // Keep out of water; one that's in it anyway (an older save) heads for shore, even when resting.
      const inWater = t.heightAt(a.x, a.z) < t.waterAt(a.x, a.z) + 0.2;
      if (inWater && a.state !== 'attack' && (a.state === 'idle' || !(this.elapsed < (a.shoreAt ?? 0)))) {
        // Head for the nearest dry ground (re-aiming now and then, so a turn away from a steep bank sticks).
        let best = Infinity;
        for (let k = 0; k < 16; k++) {
          const ang = (k / 16) * Math.PI * 2, cx = Math.cos(ang), cz = Math.sin(ang);
          for (let r = 2; r < 40 && r < best; r += 2) {
            const x = a.x + cx * r, z = a.z + cz * r;
            if (t.heightAt(x, z) >= t.waterAt(x, z) + 0.3) { best = r; a.dirX = cx; a.dirZ = cz; break; }
          }
        }
        a.state = 'wander'; a.timer = Math.max(a.timer, 3); a.speed = 1.1;
        a.shoreAt = this.elapsed + 2.5;
      }
      if (a.speed > 0) {
        const nx = a.x + a.dirX * a.speed * dt;
        const nz = a.z + a.dirZ * a.speed * dt;
        const h = t.heightAt(nx, nz);
        if ((!inWater && h < t.waterAt(nx, nz) + 0.2) || (!inWater && w.blockedAt(nx, h + 0.6, nz)) ||
          (!inWater && Math.abs(h - t.heightAt(a.x, a.z)) > a.speed * dt * 1.5)) {
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
      this.respawnTimer = 20;
      w.keepAnimals(p.x, p.z);
    }
  }

  // ---------- targeting
  /** March a ray from the camera through animals, objects, pieces, water and voxels. */
  raycast(maxReach = REACH, skipPieces = false): Target | null {
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const origin = cam.position.clone();
    const eye = this.player.eye;
    const third = this.player.cameraMode === 'third';
    const maxD = third ? this.player.camDist + maxReach + 1 : maxReach;
    const t = this.world.terrain;
    // Only things standing near the line of sight can be hit (a tree crown is the widest, 1.5 m × size).
    const flat = Math.hypot(dir.x, dir.z), ux = flat > 1e-6 ? dir.x / flat : 0, uz = flat > 1e-6 ? dir.z / flat : 0;
    const objs = this.world.near(origin.x, origin.z, maxD + 3).filter((o) => {
      const ox = o.x - origin.x, oz = o.z - origin.z;
      const along = Math.max(0, Math.min(maxD * flat, ox * ux + oz * uz));
      const off = Math.hypot(ox - ux * along, oz - uz * along);
      return off < reachOf(o) + 0.3;
    });
    const animals = this.world.animals.filter((a) => Math.hypot(a.x - origin.x, a.z - origin.z) < maxD + 2);
    const rocks = this.groundCover.bouldersNear(origin.x, origin.z, maxD + 1);
    const p = new THREE.Vector3();
    for (let d = 0.1; d <= maxD; d += 0.05) {
      p.copy(origin).addScaledVector(dir, d);
      const tooFar = third && p.distanceTo(eye) > maxReach + 0.5;
      if (tooFar && d > this.player.camDist + 0.5) break;
      if (!tooFar) {
        for (const a of animals) {
          const g = t.heightAt(a.x, a.z);
          const tall = a.species === 'deer' ? 1.6 : 1.0;
          if (Math.hypot(p.x - a.x, p.z - a.z) < 0.6 && p.y > g && p.y < g + tall) return { kind: 'animal', animal: a, point: p.clone() };
        }
        for (const o of objs) {
          if (skipPieces && o.kind === 'structure') continue;
          if (this.hitObject(o, p)) return { kind: 'object', obj: o, point: p.clone() };
        }
        // Boulders: squat lumps (half a metre across at scale 1, flattened).
        for (const b of rocks) {
          const rx = 0.5 * b.sc, ry = 0.36 * b.sc, dy = p.y - b.y;
          if (((p.x - b.x) ** 2 + (p.z - b.z) ** 2) / (rx * rx) + (dy * dy) / (ry * ry) < 1) return { kind: 'rock', rock: b, point: p.clone() };
        }
      }
      if (t.solidAt(p.x, p.y, p.z)) {
        if (tooFar) return null;
        return { kind: 'terrain', point: p.clone(), normal: t.normalAt(p.x, p.y, p.z), mat: t.materialAt(p.x, p.y, p.z) };
      }
      if (!tooFar && p.y < t.waterAt(p.x, p.z)) return { kind: 'water', point: p.clone() };
    }
    return null;
  }

  private hitObject(o: WorldObj, p: THREE.Vector3): boolean {
    const dx = p.x - o.x, dz = p.z - o.z;
    switch (o.kind) {
      case 'tree': {
        const g = this.world.terrain.heightAt(o.x, o.z);
        const { s } = treeScale(o);
        const y = p.y - g;
        const { hs } = treeScale(o);
        if (y < 0 || y > 6.5 * s * hs) return false;
        const r = y < 2.6 * s * hs ? 0.2 + 0.3 * s : 1.5 * s;
        return dx * dx + dz * dz < r * r;
      }
      case 'bush': {
        const g = this.world.terrain.heightAt(o.x, o.z);
        return dx * dx + dz * dz + (p.y - g - 0.4) ** 2 < 0.45;
      }
      case 'pile':
        return dx * dx + dz * dz + (p.y - o.y - 0.3) ** 2 < 0.3;
      case 'forage': {
        if (!this.canSee(o)) return false;
        const y = p.y - o.y;
        const sc = forageScale(FORAGE[o.species]?.category ?? 'material');
        return dx * dx + dz * dz < 0.18 * sc && y > -0.15 && y < forageHeight(o.species) * sc + 0.15;
      }
      case 'structure':
        return pointInPiece(o, p.x, p.y, p.z, 0.04);
    }
  }

  /** Ring(s) on the ground showing the area a shovel, hoe or pickaxe will work. */
  private updateBrush() {
    const t = this.target;
    const tool = this.activeItem() ? itemDef(this.activeItem()!.type).tool : undefined;
    const show = !this.placing && t?.kind === 'terrain' && (tool === 'shovel' || tool === 'pickaxe' || tool === 'hoe');
    this.brush.visible = show;
    // The hoe levels a wider round (the outer ring); the inner is what it tills.
    this.brushOuter.visible = show && tool === 'hoe';
    if (!show || t?.kind !== 'terrain') return;
    const place = (ring: THREE.LineLoop, r: number) => {
      const pos = ring.geometry.attributes.position as THREE.BufferAttribute;
      const n = pos.count;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = t.point.x + Math.cos(a) * r, z = t.point.z + Math.sin(a) * r;
        let y = this.world.terrain.groundBelow(x, t.point.y + 1.5, z);
        if (!Number.isFinite(y) || Math.abs(y - t.point.y) > 3) y = t.point.y;
        pos.setXYZ(i, x, y + 0.06, z);
      }
      pos.needsUpdate = true;
      ring.geometry.computeBoundingSphere();
    };
    place(this.brush, tool === 'pickaxe' ? 1.1 : DIG_RADIUS);
    if (tool === 'hoe') place(this.brushOuter, LEVEL_RADIUS);
  }

  // ---------- building placement (Valheim-style planning)
  startPlacing(def: StructureDef) {
    this.placing = def;
    this.placingItem = null;
    this.player.wheelCaptured = true;
    this.msg(`Planning ${def.name.toLowerCase()}: left-click to place, mouse wheel or Q/E to rotate, right-click to stop.`, 'info');
  }

  /** Set down a piece of equipment from your pack (bellows, anvil, trough…). */
  startPlacingItem(it: Item) {
    const type = itemDef(it.type).places;
    if (!type) return;
    if (this.working || this.action) return this.msg('Finish what you are doing first.', 'fail');
    const def = STRUCTURES[type];
    this.placing = def;
    this.placingItem = it;
    this.player.wheelCaptured = true;
    this.ui.closeAllWindows();
    this.msg(def.attach === 'forge'
      ? 'Placing bellows: aim at the side of a forge to set them against it. Left-click to place, right-click to stop.'
      : `Placing ${def.name.toLowerCase()}: left-click to set it down, mouse wheel or Q/E to rotate, right-click to stop.`, 'info');
  }

  stopPlacing() {
    this.placing = null;
    this.placingItem = null;
    this.placement = null;
    this.player.wheelCaptured = false;
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; this.ghostType = ''; }
  }

  private updatePlacement() {
    const def = this.placing;
    if (!def) return;
    if (this.ghostType !== def.id) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = buildPieceMesh(def.id);
      this.ghost.traverse((c) => { if (c instanceof THREE.Mesh) { c.castShadow = false; c.receiveShadow = false; } });
      this.ghostType = def.id;
      this.scene.add(this.ghost);
    }
    const inp = this.input;
    if (inp.locked) {
      const step = Math.PI / 8;
      if (inp.wheel) this.placeYaw += Math.sign(inp.wheel) * step;
      if (inp.hit('KeyQ')) this.placeYaw += step;
      if (inp.hit('KeyE')) this.placeYaw -= step;
    }
    const hit = this.raycast(BUILD_REACH);
    if (!hit || hit.kind === 'none' || hit.kind === 'animal') {
      this.ghost!.visible = false;
      this.placement = null;
      return;
    }
    const pt = hit.point;
    let x = pt.x, y = pt.y, z = pt.z, yaw = this.placeYaw, snapped = false;
    let valid = true, reason = '';

    if (hit.kind === 'object' && hit.obj.kind === 'structure') {
      // Resting on another piece: sit on top of the box that was hit.
      y = this.pieceTopAt(hit.obj, pt) ?? pt.y;
    }
    if (def.snap) {
      const snap = this.findSnap(def, pt, yaw);
      if (snap) ({ x, y, z, yaw } = snap), snapped = true;
    }
    if (def.attach) {
      const fit = this.attachSpot(def, pt);
      if (fit) ({ x, y, z, yaw } = fit), snapped = true;
      else { valid = false; reason = 'Bellows have to go against the side of a forge. Aim at a forge.'; }
    }
    if (!snapped && hit.kind === 'terrain' && !def.snap && hit.normal.y < 0.75) { valid = false; reason = 'The ground is too steep here. Level it with a hoe.'; }
    if (!snapped && hit.kind === 'water') { valid = false; reason = 'You cannot build on water.'; }
    if (!snapped && hit.kind === 'object' && hit.obj.kind !== 'structure') { valid = false; reason = 'Something is in the way.'; }
    const probe: StructureObj = { kind: 'structure', id: -1, type: def.id, x, y, z, yaw, consumed: {}, built: true, ql: 0, fuel: 0, lit: false };
    const pp = this.player.pos;
    if (Math.hypot(x - pp.x, z - pp.z) > BUILD_REACH) { valid = false; reason = 'Too far away.'; }
    for (const h of [0.3, 1.0, 1.6]) {
      if (pointInPiece(probe, pp.x, pp.y + h, pp.z, 0.25)) { valid = false; reason = 'You are standing in the way.'; }
    }
    for (const o of this.world.near(x, z, 2)) {
      if (def.attach && o.kind === 'structure' && o.type === def.id && Math.hypot(o.x - x, o.z - z) < 0.5) { valid = false; reason = 'There are already bellows on that side.'; }
      if (o.kind === 'tree' && o.age > 0.2 && pointInPiece(probe, o.x, this.world.terrain.heightAt(o.x, o.z) + 0.5, o.z, 0.3)) { valid = false; reason = 'A tree is in the way.'; }
      if (o.kind === 'structure' && o.type === def.id && Math.hypot(o.x - x, o.y - y, o.z - z) < 0.15) { valid = false; reason = 'There is already one there.'; }
    }
    if (!def.snap && y < this.world.terrain.waterAt(x, z) - 0.3) { valid = false; reason = 'That spot is under water.'; }

    const g = this.ghost!;
    g.visible = true;
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const m = valid ? this.ghostMats.ok : this.ghostMats.bad;
    g.traverse((c) => { if (c instanceof THREE.Mesh) c.material = m; });
    this.placement = { def, valid, reason, x, y, z, yaw, snapped };
  }

  /**
   * Where bellows would sit against the nearest forge: flush with whichever
   * side faces where you're aiming, nozzle pointing in.
   */
  private attachSpot(def: StructureDef, aim: THREE.Vector3) {
    let forge: StructureObj | undefined;
    let best = 3;
    for (const o of this.world.near(aim.x, aim.z, 3)) {
      if (o.kind !== 'structure' || o.type !== def.attach || !o.built) continue;
      const d = Math.hypot(o.x - aim.x, o.z - aim.z);
      if (d < best) { best = d; forge = o; }
    }
    if (!forge) return null;
    const fb = STRUCTURES[forge.type].boxes[0].h;
    const depth = def.boxes[0].h[2];
    const [lx, , lz] = toLocal(forge, aim.x, aim.y, aim.z);
    // Pick the side by where the aim sits relative to the forge's footprint.
    const side: V3 = Math.abs(lx) / fb[0] > Math.abs(lz) / fb[2] ? [Math.sign(lx) || 1, 0, 0] : [0, 0, Math.sign(lz) || 1];
    const off = side[0] ? fb[0] + depth + 0.02 : fb[2] + depth + 0.02;
    const [x, , z] = toWorld(forge, [side[0] * off, 0, side[2] * off]);
    // Local +Z (the nozzle) points back into the forge.
    const yaw = Math.atan2(forge.x - x, forge.z - z);
    return { x, y: forge.y, z, yaw };
  }

  /** Top of whichever box of a piece contains a point. */
  private pieceTopAt(s: StructureObj, p: THREE.Vector3): number | undefined {
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const dx = p.x - s.x, dz = p.z - s.z;
    const lx = dx * c - dz * sn, ly = p.y - s.y, lz = dx * sn + dz * c;
    for (const b of pieceBoxes(STRUCTURES[s.type], s.open)) {
      if (Math.abs(lx - b.c[0]) <= b.h[0] + 0.05 && Math.abs(ly - b.c[1]) <= b.h[1] + 0.05 && Math.abs(lz - b.c[2]) <= b.h[2] + 0.05) {
        return s.y + b.c[1] + b.h[1];
      }
    }
    return undefined;
  }

  /**
   * Line a piece up with nearby pieces: pair one of its snap points with a
   * nearby piece's snap point, turning in 90° steps relative to that piece,
   * and keep the fit closest to where you're aiming that doesn't overlap.
   */
  private findSnap(def: StructureDef, aim: THREE.Vector3, yaw: number) {
    let best: { x: number; y: number; z: number; yaw: number; score: number } | null = null;
    const quarter = Math.PI / 2;
    for (const o of this.world.near(aim.x, aim.z, 4)) {
      if (o.kind !== 'structure') continue;
      const od = STRUCTURES[o.type];
      if (!od.snap) continue;
      const qyaw = o.yaw + Math.round((yaw - o.yaw) / quarter) * quarter;
      for (const sp of od.snaps) {
        const T = toWorld(o, sp);
        if (Math.hypot(T[0] - aim.x, T[1] - aim.y, T[2] - aim.z) > 1.6) continue;
        for (const gs of def.snaps) {
          const off = toWorld({ x: 0, y: 0, z: 0, yaw: qyaw }, gs);
          const x = T[0] - off[0], y = T[1] - off[1], z = T[2] - off[2];
          const probe: StructureObj = { kind: 'structure', id: -1, type: def.id, x, y, z, yaw: qyaw, consumed: {}, built: true, ql: 0, fuel: 0, lit: false };
          const centre = toWorld(probe, def.boxes[0].c);
          // Reject fits that sit inside an existing piece.
          let clash = false;
          for (const e of this.world.near(x, z, 3)) {
            if (e.kind !== 'structure') continue;
            if (pointInPiece(e, centre[0], centre[1], centre[2], -0.05) || (e.type === def.id && Math.hypot(e.x - x, e.y - y, e.z - z) < 0.15)) { clash = true; break; }
          }
          if (clash) continue;
          const score = Math.hypot(centre[0] - aim.x, centre[1] - aim.y, centre[2] - aim.z);
          if (!best || score < best.score) best = { x, y, z, yaw: qyaw, score };
        }
      }
    }
    return best;
  }

  devFinishStructure(s: StructureObj) {
    const def = STRUCTURES[s.type];
    for (const m of def.materials) s.consumed[m.item] = m.count;
    s.built = true;
    s.ql = Math.max(s.ql, 50);
    this.world.changed(s);
    this.msg(`[dev] ${def.name} built instantly.`, 'info');
  }

  /** Clear the finds lying where a piece goes (stones, mushrooms, branches...): they'd poke up through it. */
  private clearAround(s: StructureObj) {
    for (const o of [...this.world.near(s.x, s.z, 6)]) {
      if (o.kind === 'forage' && pointInPiece(s, o.x, o.y + 0.1, o.z, PIECE_MARGIN)) this.world.remove(o);
    }
  }

  private confirmPlacement() {
    const p = this.placement;
    if (!p) return;
    if (!p.valid) return this.msg(p.reason, 'fail');
    const item = this.placingItem;
    if (item) {
      if (!this.inv.find(item.uid)) { this.stopPlacing(); return this.msg('You no longer have it.', 'fail'); }
      this.inv.remove(item.uid);
      if (this.activeUid === item.uid) this.activeUid = null;
      this.inventoryChanged();
      const placed = this.world.add<StructureObj>({
        kind: 'structure', type: p.def.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
        consumed: {}, built: true, ql: item.ql, dmg: item.dmg, fuel: 0, lit: false,
      });
      if (p.def.water) placed.water = 0;
      this.clearAround(placed);
      this.stopPlacing();
      this.sound.glance(0.6);
      const name = p.def.name.toLowerCase();
      const forgeNear = this.world.near(p.x, p.z, 4).some((o) => o.kind === 'structure' && o.type === 'forge' && Math.hypot(o.x - p.x, o.z - p.z) < 4);
      if (!p.def.attach && !forgeNear) this.msg('Tip: smithing needs the forge, anvil and trough all within reach of where you stand. Keep them close together.', 'info');
      this.msg(p.def.attach ? `You set the bellows against the forge (QL ${placed.ql.toFixed(1)}). Now it can get hot enough for metal.`
        : p.def.water ? `You set down the ${name}. Fill it with jars of water before quenching.`
          : `You set down the ${name} (QL ${placed.ql.toFixed(1)}).`, 'good');
      return;
    }
    const s = this.world.add<StructureObj>({
      kind: 'structure', type: p.def.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
      consumed: {}, built: false, ql: 0, fuel: 0, lit: false,
    });
    if (p.def.container) s.items = [];
    this.clearAround(s);
    if (this.dev.on('freeBuild')) this.devFinishStructure(s);
    else this.msg(`Planned a ${p.def.name.toLowerCase()}. Build it with "Continue building" using the materials and tools it needs.`, 'good');
  }

  // ---------- main loop
  /**
   * The bed under the sea at a point, for the water's depth: the land map,
   * with river channels cut down where they reach the sea (else a river
   * mouth would read as dry land, all shore foam).
   */
  private seaBed(x: number, z: number): number {
    let h = this.distant.groundAt(x, z);
    if (!(h < 4)) return h;
    // Only where the map is already made: the sea floor reaches far out, and
    // making tiles out there on the spot would stall the game.
    const gen = this.world.terrain.gen;
    if (!gen.covered(x, z)) return h;
    const rv = gen.river(x, z);
    if (rv && rv.d < rv.r) h = Math.min(h, WATER_LEVEL - rv.depth * (1 - (rv.d / rv.r) ** 2));
    return h;
  }

  /** Put the graphics settings into effect. */
  applyGraphics() {
    const q = this.graphics.level;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const sun = this.sky.sun;
    sun.castShadow = q.shadowSize > 0;
    if (q.shadowSize && sun.shadow.mapSize.x !== q.shadowSize) {
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    this.groundCover.setDensity(q.plants);
    this.applyAA();
    this.distant.radius = q.viewTiles;
    this.distant.forestThin = q.forestThin;
  }

  /** High anti-aliasing: the world drawn into a multisampled buffer, then SMAA over it. */
  private composer: EffectComposer | null = null;

  private applyAA() {
    const aa = this.graphics.aa;
    // Cut-out edges (the distant trees' cards) smoothed by the multisampling.
    this.distant.setAlphaToCoverage(aa !== 'off');
    const want = aa === 'high';
    if (want && !this.composer) {
      const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
      const c = new EffectComposer(this.renderer, target);
      c.addPass(new RenderPass(this.scene, this.camera));
      c.addPass(new SMAAPass());
      c.addPass(new OutputPass());
      this.composer = c;
    } else if (!want && this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  }

  private frame(timestamp: number) {
    // Hold to the frame rate cap: there's no point drawing faster than you'll
    // notice, and it keeps the computer cool.
    const cap = this.graphics.fpsCap;
    if (cap) {
      const interval = 1000 / cap, since = timestamp - this.lastFrame;
      if (since < interval - 1) return;
      // Keep to the cap on average whatever the screen's refresh rate: step the
      // schedule on by whole intervals (a frame a hair early still counts as one),
      // or start afresh after a long stall.
      this.lastFrame = since < interval * 3 ? this.lastFrame + Math.max(1, Math.floor((since + 1) / interval)) * interval : timestamp;
    }
    perf.begin();
    this.timer.update(timestamp);
    const dt = Math.min(0.05, this.timer.getDelta());
    this.renderDt = dt;
    this.elapsed += dt;
    if (this.tour) this.tourStep(dt);
    else if (!this.paused) perf.time('update', () => this.update(dt));
    this.render();
    this.input.endFrame();
    perf.end();
  }

  private update(dt: number) {
    const inp = this.input;
    const p = this.player;
    this.ui.root.classList.toggle('working', !!this.working);

    if (this.working) {
      // Hands-on work: the mouse drives the minigame; you stand still.
      if (!inp.locked) this.working.session.cancel();
      else this.working.session.update(dt, inp);
      p.work = this.working ? { clip: workClip(this.working.def.id, this.working.ctx) ?? 'craft' } : null;
      p.faceYaw = this.working ? this.faceToward(this.working.ctx.t) : null;
      p.update(dt, inp, this.world, true, 0, false, false);
      p.updateCamera(this.camera, this.world.terrain);
      // Work in the world (building) is seen through its own view of the piece.
      const wc = this.working?.session.worldCamera;
      if (wc) { this.camera.position.copy(wc.position); this.camera.quaternion.copy(wc.quaternion); }
      this.tickLife(dt);
      return;
    }

    // --- hotkeys
    if (inp.hit('KeyV')) {
      p.cameraMode = p.cameraMode === 'first' ? 'third' : 'first';
      this.msg(`${p.cameraMode === 'first' ? 'First' : 'Third'}-person view.`, 'info');
    }
    if (inp.hit('KeyI') || inp.hit('Tab')) this.ui.toggleInventory();
    if (inp.hit('KeyC')) this.ui.toggle('crafting');
    if (inp.hit('KeyK')) this.ui.toggle('skills');
    if (inp.hit('KeyB')) this.ui.toggle('build');
    if (inp.hit('KeyH') || inp.hit('F1')) this.ui.toggle('help');
    if (inp.hit('KeyJ')) this.ui.toggle('journal');
    if (inp.hit('KeyL')) this.ui.toggle('quests');
    if (inp.hit('KeyM')) this.ui.toggle('map');
    if (inp.hit('KeyG') && !this.placing) this.request(ACTION_MAP.survey, { g: this, t: { kind: 'none' } });
    if (inp.hit('KeyR')) this.repeatLast();
    if (inp.hit('KeyX')) { if (this.action) this.cancelAction('You stop what you are doing.'); }
    if (inp.hit('Escape')) this.stopPlacing();
    if (inp.hit('Backquote') || inp.hit('F2')) this.ui.toggle('dev');
    if (inp.hit('Digit0')) this.setActive(null);
    for (let i = 0; i < 9 && !this.ui.menuOpen; i++) {
      if (inp.hit(`Digit${i + 1}`)) {
        const hovered = this.ui.hoveredItem !== null ? this.inv.find(this.ui.hoveredItem) : undefined;
        if (hovered) this.bindHotbar(i, hovered.type);
        else this.useHotbar(i);
      }
    }
    // The mouse wheel steps through the hotbar (unless placing, where it rotates the piece).
    if (inp.wheel && inp.locked && !this.player.wheelCaptured && !this.ui.menuOpen && !this.ui.cursorActive()) {
      this.cycleHotbar(Math.sign(inp.wheel));
      inp.wheel = 0;
    }

    // While a window or menu is open the mouse drives the in-game cursor, not the camera.
    if (this.ui.cursorActive()) {
      const wheel = inp.wheel;
      this.ui.cursor.setVisible(true);
      this.ui.cursor.move(inp.mouseDX, inp.mouseDY);
      if (this.ui.isOpen('map')) this.ui.mapView.input(wheel, inp.held.has(0), this.ui.cursor.x, this.ui.cursor.y);
      inp.mouseDX = inp.mouseDY = inp.wheel = 0;
    }

    // --- player
    const over = this.dev.on('noWeight') ? 0 : this.inv.weight() - CARRY_CAPACITY;
    p.update(dt, inp, this.world, !!this.action, over, !this.ui.menuOpen, this.dev.on('fly'));
    if (this.action && Math.hypot(p.pos.x - this.action.startPos.x, p.pos.z - this.action.startPos.z) > 0.6) {
      this.cancelAction('You moved and stopped what you were doing.');
    }
    p.updateCamera(this.camera, this.world.terrain);
    this.slopeFeedback(dt);

    // --- targeting
    this.target = inp.locked || this.placing ? this.raycast() : this.target;
    this.updateBrush();
    this.updatePlacement();

    for (const btn of inp.takeClicks()) {
      if (this.placing) {
        if (btn === 0) this.confirmPlacement();
        else { this.stopPlacing(); this.msg('Stopped planning.', 'info'); }
        continue;
      }
      // A weapon or bow in hand, or an animal under your aim: fight.
      if (btn === 0 && !this.action && this.combat.wantsClick()) { this.combat.press(); continue; }
      if (!this.target) continue;
      const opts = this.actionsFor(this.target);
      if (btn === 0) {
        const first = opts.find((o) => !o.problem) ?? opts[0];
        if (first) this.request(first.def, first.ctx);
      } else if (btn === 2) {
        this.ui.openContextMenu(this.target, opts);
      }
    }
    if (inp.hit('KeyF') && inp.locked && this.target && !this.placing) this.ui.openContextMenu(this.target, this.actionsFor(this.target));
    if (inp.hit('KeyE') && inp.locked && this.target && !this.placing) {
      const opts = this.actionsFor(this.target);
      const first = opts.find((o) => !o.problem) ?? opts[0];
      if (first) this.request(first.def, first.ctx);
    }

    // --- action progress
    p.swingAnim = null;
    p.faceYaw = null;
    p.work = null;
    if (this.action) {
      const a = this.action;
      a.elapsed += dt;
      const swing = typeof a.def.swing === 'function' ? a.def.swing(a.ctx) : a.def.swing;
      p.swing = swing ? 0 : (a.elapsed * 1.2) % 1;
      p.faceYaw = this.faceToward(a.ctx.t);
      if (swing) {
        if (a.def.impactAt) {
          // One swing, one blow: the hit lands partway through.
          p.swingAnim = { kind: swing, phase: a.elapsed / a.total, impactAt: a.def.impactAt };
          if (!a.resolved && a.elapsed >= a.total * a.def.impactAt) {
            a.resolved = true;
            this.complete(a.def, a.ctx, a.total, undefined, true);
          }
        } else {
          // A longer job (mining, digging) is a series of swings; the work resolves at the end.
          const period = swing === 'dig' ? 1.6 : 1.3;
          const phase = (a.elapsed % period) / period;
          p.swingAnim = { kind: swing, phase, impactAt: 0.62 };
          const blow = Math.floor(a.elapsed / period - 0.62);
          if (blow >= 0 && blow !== a.lastBlow) { a.lastBlow = blow; this.blowFx(a.ctx, swing); }
        }
      }
      // The body at work: a clip kept in time with the job (each blow on its beat), or a loop.
      const clip = workClip(a.def.id, a.ctx);
      if (clip) {
        const sw = p.swingAnim;
        const seg = SEGMENTS[clip];
        p.work = sw ? { clip, phase: sw.phase % 1, impactAt: sw.impactAt }
          : seg ? { clip, phase: Math.min(1, a.elapsed / Math.max(0.3, a.total)), impactAt: 0.55 } : { clip };
      }
      if (this.action === a && a.elapsed >= a.total) {
        if (a.resolved) { this.action = null; this.afterAction(a.def, a.ctx); }
        else this.finish(a);
      }
    } else {
      p.swing = 0;
    }
    perf.time('combat', () => this.combat.update(dt));

    this.tickLife(dt);
  }

  /** Needs, effects, the world and autosave: everything that runs whatever you're doing. */
  private tickLife(dt: number) {
    const inp = this.input;
    const p = this.player;
    const uiOpen = this.ui.anyWindowOpen();
    // --- survival
    // Hauling yourself up a steep slope is exertion too: no catching your breath.
    const busy = !!this.action || !!this.working || p.sprinting || p.slope === 'steep' || p.slope === 'blocked';
    p.food = Math.max(0, p.food - dt * 0.05);
    p.water = Math.max(0, p.water - dt * 0.08);
    const fx = p.effects;
    if (!busy) {
      let regen = p.food > 5 && p.water > 5 ? 9 : 2.5;
      if (fx.nauseous) regen *= 0.3;
      if (fx.refreshed) regen *= 2;
      if (fx.rested) regen *= 1 + COMFORT_REGEN * fx.rested.rate;
      p.stamina = Math.min(100, p.stamina + dt * regen);
    }
    if (fx.poisoned) p.health -= dt * fx.poisoned.rate;
    if (fx.bandaged) p.health = Math.min(100, p.health + dt * fx.bandaged.rate);
    for (const [k, e] of Object.entries(fx)) {
      e.t -= dt;
      if (e.t <= 0) {
        delete fx[k];
        this.msg(k === 'poisoned' ? 'The poison has run its course.' : k === 'nauseous' ? 'Your stomach settles.' : k === 'rested' ? 'The rested feeling wears off.' : k === 'bandaged' ? 'The bandage has done its work.' : 'The tea wears off.', 'info');
      }
    }
    if (p.food <= 0 || p.water <= 0) {
      p.health -= dt * 0.5;
    } else if (p.food > 30 && p.water > 30 && !fx.poisoned) {
      p.health = Math.min(100, p.health + dt * 0.3);
    }
    // Fresh forgings cool off unless you quench them (not while you're at work).
    if (!this.working) {
      for (const it of this.inv.items) {
        if (it.hot === undefined) continue;
        it.hot -= dt;
        if (it.hot <= 0) {
          delete it.hot;
          this.msg(`Your ${itemName(it).toLowerCase()} has cooled in the air without being quenched.`, 'info');
          this.inventoryChanged();
        }
      }
    }
    // A torch in hand burns down; in deep water it's put out.
    const held = this.activeItem();
    if (held?.type === 'torch') {
      held.dmg += ((dt * this.dev.timeScale) / TORCH_BURN) * 100;
      const doused = p.swimming;
      if (held.dmg >= 100 || doused) {
        this.msg(doused ? 'Your torch hisses out in the water. Relight it with kindling and a branch.' : 'Your torch burns down to a charred stub. Relight it with kindling and a branch.', 'warn');
        // It's spent, not gone: what's left can be relit.
        this.inv.remove(held.uid);
        const spent = makeItem('torch_spent', held.ql);
        this.inv.add(spent);
        this.setActive(null);
        this.inventoryChanged();
      }
    }
    if (this.dev.on('noNeeds')) { p.food = 100; p.water = 100; p.stamina = 100; }
    if (this.dev.on('godMode')) p.health = 100;
    // The first time you're badly hurt: stop and explain health and bandages.
    if (p.health < 50 && p.health > 0 && !this.tips.has('health') && !this.dev.on('godMode')) {
      this.tips.add('health');
      this.ui.showNotice('You are badly hurt',
        `<p>Your <b>health</b> is below half. At zero you die: you wake at home (your bed, once you've slept in one) and your pack is left where you fell.</p>
        <p>Health comes back on its own, slowly, while you're fed and watered. To heal faster, bind on a <b>bandage</b>: twist one from 4 plant fiber (Crafting → Primitive), then <b>Apply</b> it from your pack or the hotbar. It takes a few seconds and heals 25 health over the next while.</p>
        <p>You can't bandage yourself <b>in the middle of a fight</b>: back off and get clear first. Getting hit knocks the bandage out of your hands.</p>`,
        'I understand', () => this.tips.add('health_ok'));
    }
    if (p.health <= 0) this.die();

    // --- world
    for (const d of [...this.pendingDrops]) {
      d.left -= dt;
      if (!d.done && d.left <= 0) d.land(d.at.x, d.at.z);
      if (d.done) this.pendingDrops.splice(this.pendingDrops.indexOf(d), 1);
    }
    perf.time('world', () => {
      this.world.tick(dt * this.dev.timeScale);
      this.growth.update(this.world, p.pos.x, p.pos.z, dt * this.dev.timeScale);
    });
    this.updateMarkers();
    if (!this.quests && !this.tour) this.quests = new QuestLog(this.markerTex);
    if (this.quests && !this.quests.onChange) this.quests.onChange = () => this.ui.refresh();
    this.quests?.update(this, dt);
    perf.time('animals', () => this.updateAnimals(dt));
    perf.time('map', () => this.map.update(dt, p.pos.x, p.pos.z, this.ui.isOpen('map')));
    perf.time('terrain', () => this.world.terrain.update(p.pos.x, p.pos.y, p.pos.z, 6));
    this.world.focus = { x: p.pos.x, z: p.pos.z };
    perf.time('objects', () => this.world.stream(p.pos.x, p.pos.z, 1));

    this.saveTimer += dt;
    if (this.saveTimer > 60) { this.saveTimer = 0; perf.time('autosave', () => this.save()); }

    if (!uiOpen && !inp.locked && !this.ui.menuOpen && this.ui.wantsRelock) {
      this.ui.wantsRelock = false;
      this.ui.relockGrace = 0.5;
      inp.lock();
    }
    this.ui.update();
  }

  /** A torch in hand lights the ground around you, flickering. */
  private updateTorchLight() {
    const p = this.player, l = this.torchLight;
    // Building by hand: a warm light on the work, so the nails show at night.
    const work = this.working ? (this.working.session.mg as { workLight?: THREE.Vector3 }).workLight : undefined;
    if (work) { l.position.copy(work); l.intensity = 1.6; return; }
    if (this.activeItem()?.type !== 'torch' || this.tour) { l.intensity = 0; return; }
    // At the flame (in first person, a little ahead of you and to the right).
    p.heldItem.getWorldPosition(l.position);
    if (p.cameraMode === 'first') {
      const f = p.forward();
      l.position.set(p.pos.x + f.x * 0.45 + Math.cos(p.yaw) * 0.25, p.eye.y - 0.25, p.pos.z + f.z * 0.45 - Math.sin(p.yaw) * 0.25);
    } else l.position.y += 0.35;
    const t = this.elapsed;
    l.intensity = 7 + Math.sin(t * 13) * 0.8 + Math.sin(t * 7.7) * 0.6 + Math.sin(t * 23) * 0.3;
  }

  private die() {
    const p = this.player;
    this.msg('You have died. Your belongings remain where you fell.', 'warn');
    if (this.inv.items.length) {
      this.dropToGround(this.inv.items.splice(0), p.pos.x, p.pos.y, p.pos.z);
    }
    this.setActive(null);
    this.cancelAction();
    p.health = 100; p.food = 60; p.water = 60; p.stamina = 100;
    p.effects = {};
    const s = this.world.spawn;
    p.pos.set(s.x, this.world.terrain.heightAt(s.x, s.z) + 0.3, s.z);
    p.vel.set(0, 0, 0);
    for (const a of this.world.animals) if (a.state === 'attack') { a.state = 'idle'; a.timer = 3; }
    this.ui.showDeath();
    this.inventoryChanged();
  }

  private render() {
    const p = this.player;
    this.view.treeFx.update(this.renderDt);
    perf.time('sky', () => this.sky.update(this.world.dayFraction, p.pos, this.elapsed, this.renderer, this.camera, this.renderDt));
    this.ambTimer -= this.renderDt;
    if (this.ambTimer <= 0) { this.ambTimer = 0.5; this.surroundings(); }
    // What's in view: the near trees, plants and grass hand only that to be drawn.
    perf.time('culling', () => {
      this.viewCull.update(this.camera, this.sky.sunDir, this.sky.sun);
      this.view.cull(this.viewCull);
      this.grassCull.update(this.camera);
    });
    perf.time('grass', () => this.groundCover.update(this.camera.position, this.elapsed, this.world.terrain.wind, this.amb.sway));
    this.world.terrain.waterTime.value = this.elapsed;
    perf.time('sea floor', () => seaFloor.update(this.camera.position.x, this.camera.position.z, this.renderDt, (x, z) => this.seaBed(x, z), WATER_LEVEL));
    this.tileTimer -= this.renderDt;
    if (this.tileTimer <= 0) { this.tileTimer = 0.5; perf.time('distant land', () => this.keepTiles()); }
    const mc = this.world.terrain.meshCentre;
    this.distant.setHole(mc.x, mc.z, Number.isFinite(mc.x) ? Math.max(0, this.world.terrain.readyRadius - 6) : 0);
    this.distant.setTreesNear(p.pos.x, p.pos.z, NEAR_TREES);
    perf.time('distant land', () => this.distant.drain(2));
    perf.time('culling', () => this.distant.cull(this.camera));
    this.fireflies.update(this.renderDt, this.elapsed, this.camera.position, this.world.terrain, this.amb.fireflies);
    const a = this.amb;
    this.sound.ambience({ wind: a.wind, river: a.water, birds: a.birds, night: a.crickets, frogs: a.frogs }, this.renderDt);
    this.view.updateTreeDetail(this.camera.position.x, this.camera.position.z);
    this.view.syncAnimals(this.elapsed);
    this.view.updateFires(p.pos.x, p.pos.z, this.elapsed);
    this.updateTorchLight();
    this.frameNo++;
    this.renderer.shadowMap.needsUpdate = this.frameNo % this.graphics.level.shadowEvery === 0;
    perf.time('draw', () => { if (this.composer) this.composer.render(this.renderDt); else this.renderer.render(this.scene, this.camera); });
    // First-person hands and tool, on top of the world.
    if (!this.working && !this.tour) {
      const it = this.activeItem();
      const kind = it ? itemDef(it.type).tool : undefined;
      this.viewModel.setTool(kind, it?.type);
      const speed = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4);
      const light = { hemi: this.sky.hemi.intensity, sun: this.sky.sun.intensity * 0.6 };
      // Your body's own arms, once it has loaded (otherwise a plain hand and tool).
      const g = characterLoaded();
      if (p.rig && g && !this.viewModel.hasArms) this.viewModel.useArms(new CharacterRig(g, true));
      if (this.viewModel.hasArms) {
        const show = p.cameraMode === 'first' && !this.ui.anyWindowOpen();
        this.viewModel.updateArms(this.renderDt, show, p.pose, p.poseBlend, p.model, this.camera.position, p.pitch, this.camera, { kind, type: it?.type }, p.wornColours, light);
      } else {
        const show = p.cameraMode === 'first' && (!!kind || !!p.swingAnim) && !this.ui.anyWindowOpen();
        this.viewModel.update(this.renderDt, show, p.swingAnim, speed, light);
      }
      this.viewModel.render(this.renderer);
    }
    this.working?.session.render(this.renderer);
  }

  // ---------- persistence
  /** Save the game (in the background; resolves once it's safely stored). */
  async save(): Promise<void> {
    try {
      const p = this.player;
      const data = {
        version: 2,
        earth: this.earth,
        knowledge: this.knowledge.serialize(),
        effects: this.player.effects,
        world: this.world.serialize(),
        player: {
          pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, pitch: p.pitch, cam: p.cameraMode,
          health: p.health, food: p.food, water: p.water, stamina: p.stamina,
        },
        inv: this.inv.items,
        skills: this.skills.levels,
        hotbar: this.hotbar,
        equipped: this.equipped,
        active: this.activeUid,
        nextUid: getNextUid(),
        quests: this.quests?.serialize() ?? null,
        tips: [...this.tips],
        explored: this.map.serialize(),
      };
      await writeSave(SAVE_KEY, data);
    } catch (e) {
      console.warn('Save failed', e);
    }
  }

  /** Ask for the map tiles around you (nearest first) and let far ones go. */
  private keepTiles() {
    const p = this.player.pos, gen = this.world.terrain.gen;
    if (this.tileWorkers) this.tileWorkers.focus = { x: p.x, z: p.z };
    const tx = tileOf(p.x), tz = tileOf(p.z);
    const want: [number, number, number][] = [];
    const R = this.distant.radius;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (!this.distant.has(tx + dx, tz + dz)) want.push([tx + dx, tz + dz, dx * dx + dz * dz]);
    }
    want.sort((a, b) => a[2] - b[2]);
    // Without workers, make at most one a go (each takes a moment).
    for (const [x, z] of this.tileWorkers ? want : want.slice(0, 1)) {
      if (gen.hasTile(x, z)) this.distant.addTile(gen.tileData(x, z)!);
      else gen.want(x, z);
    }
    this.distant.prune(p.x, p.z);
    gen.forget(p.x, p.z, (R + 1) * TILE);
  }

  /**
   * Read the surroundings for ambience: time of day, the zone you're in, how
   * wooded and how high it is, and how close running water is.
   */
  private surroundings() {
    const p = this.player.pos, t = this.world.terrain, f = this.world.dayFraction;
    const elev = Math.sin((f - 0.25) * Math.PI * 2);
    const day = Math.max(0, Math.min(1, elev * 4 + 0.3));
    const night = 1 - day;
    const chorus = Math.exp(-(((f - 0.27) / 0.05) ** 2));
    const zone = t.zoneAt(p.x, p.z);
    let trees = 0;
    for (const o of this.world.near(p.x, p.z, 14)) if (o.kind === 'tree' && o.age > 0.4 && Math.hypot(o.x - p.x, o.z - p.z) < 14) trees++;
    let wd = Infinity;
    for (let dz = -16; dz <= 16; dz += 2) for (let dx = -16; dx <= 16; dx += 2) {
      if (t.riverAt(p.x + dx, p.z + dz)) wd = Math.min(wd, Math.hypot(dx, dz));
    }
    const water = wd < 16 ? (1 - wd / 16) ** 1.5 : 0;
    const underground = t.heightAt(p.x, p.z) > p.y + 2.5;
    const alt = Math.max(0, Math.min(1, (p.y - 2) / 28));
    const wooded = Math.min(1, trees / 10);
    const high = zone === 'alpine' || zone === 'snow';
    const warm = zone === 'meadow' || zone === 'heath' || zone === 'broadleaf' || zone === 'marsh';
    const a = this.amb;
    a.wind = Math.min(1, 0.15 + 0.5 * alt + 0.25 * (1 - wooded) + (high ? 0.25 : 0) + (zone === 'heath' ? 0.1 : 0));
    a.water = water;
    a.birds = Math.min(1, day * (0.2 + 0.8 * wooded + 0.8 * chorus) * (high ? 0.2 : zone === 'beach' ? 0.5 : 1));
    a.crickets = night * (warm ? 1 : 0.25);
    a.frogs = night * Math.min(1, (zone === 'marsh' ? 1 : 0) + water * 0.6);
    a.fireflies = night * (zone === 'marsh' ? 1 : zone === 'meadow' || zone === 'broadleaf' ? 0.6 : 0) * (t.moistureAt(p.x, p.z) > 0.4 ? 1 : 0.4);
    a.sway = 0.25 + a.wind * 0.9;
    if (underground) { a.wind *= 0.15; a.birds = 0; a.crickets *= 0.2; a.frogs = 0; a.water *= 0.4; }
  }

  /** Pause-menu escape hatch: hop to the nearest clear spot, or home if there is none. */
  unstuck() {
    this.cancelAction();
    const p = this.player;
    const spot = p.findFreeSpot(this.world);
    if (spot) {
      p.pos.copy(spot);
      this.msg('You scramble free.', 'info');
    } else {
      const s = this.world.spawn;
      p.pos.set(s.x, this.world.terrain.heightAt(s.x, s.z) + 0.1, s.z);
      this.msg('You could not find footing nearby, so you made your way back home.', 'info');
    }
    p.vel.set(0, 0, 0);
  }

  /** Download this world as a file: a backup, or a way to take it to another computer. */
  async exportSave() {
    await this.save();
    const data = await readSave(SAVE_KEY);
    const day = new Date().toISOString().slice(0, 10);
    await downloadSave(data, `survivalcrafter-${this.world.terrain.seed}-${day}`);
  }

  /** Replace this world with one from a save file, and reload into it. */
  async importAndReload(file: File) {
    await Game.importSave(file);
    this.abandoned = true; // don't save the old world over it on the way out
    // Straight back into the game (see main.ts), not the menu.
    try { sessionStorage.setItem('survivalcrafter.launch', JSON.stringify({ kind: 'continue' })); } catch { /* the menu, then */ }
    location.reload();
  }

  /** Store a save file as the save (throws with a message if it isn't one). */
  static async importSave(file: File) {
    const data = await readSaveFile(file);
    await writeSave(SAVE_KEY, data);
  }

  async abandon() {
    this.abandoned = true;
    await Game.clearSave();
    location.reload();
  }

  static async hasSave(): Promise<boolean> {
    try {
      await migrateSave(SAVE_KEY);
      return await hasSaveAt(SAVE_KEY);
    } catch { return false; }
  }

  static async clearSave() {
    try { await deleteSave(SAVE_KEY); } catch { /* ignore */ }
  }

  /** The stored save, if there is one (read it before building the game: that part isn't async). */
  static async readSave(): Promise<unknown> {
    try { return await readSave(SAVE_KEY); } catch (e) { console.warn('Load failed', e); return undefined; }
  }

  static async loadSave(canvas: HTMLCanvasElement, data: any): Promise<Game | null> {
    try {
      if (!data) return null;
      setNextUid(data.nextUid);
      // The land around where you were, made in the background first.
      const gen = new WorldGen(data.world.terrain.seed);
      await prepareTiles(gen, data.player.pos[0], data.player.pos[2]);
      const world = World.load(data.world, gen);
      const g = new Game(canvas, world);
      const p = g.player;
      p.pos.set(data.player.pos[0], data.player.pos[1], data.player.pos[2]);
      p.yaw = data.player.yaw; p.pitch = data.player.pitch; p.cameraMode = data.player.cam;
      p.health = data.player.health; p.food = data.player.food; p.water = data.player.water; p.stamina = data.player.stamina;
      g.inv.items = data.inv;
      Object.assign(g.skills.levels, data.skills);
      g.hotbar = data.hotbar;
      g.equipped = data.equipped ?? {};
      g.dressPlayer();
      g.earth = data.earth ?? {};
      g.knowledge.load(data.knowledge);
      g.player.effects = data.effects ?? {};
      g.activeUid = data.active;
      g.setActive(data.active);
      g.tips = new Set(data.tips ?? []);
      g.map.load(data.explored);
      const quests = data.quests ?? data.onboarding;
      if (quests) g.quests = QuestLog.load(g.markerTex, quests);
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

const MARKER_COLOURS: Record<ForageCategory, number> = {
  material: 0xffffff, food: 0x9fdc7c, mushroom: 0xffa860, herb: 0x8fc8ff,
};

const CATEGORY_WORDS: Record<ForageCategory, [string, string]> = {
  material: ['useful material', 'useful materials'],
  food: ['wild food', 'wild foods'],
  mushroom: ['mushroom', 'mushrooms'],
  herb: ['herb', 'herbs'],
};

/** Soft round glow for survey markers. */
function makeGlowTexture(): THREE.Texture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** What the body does for each job (null: stands at ease). `minigame`: the hands-on version. */
function workClip(id: string, _c?: Ctx): Clip | null {
  switch (id) {
    case 'cut_tree': return 'chop';
    case 'mine': case 'break_rock': case 'dig': case 'level': case 'raise': case 'smooth': case 'cultivate': return 'mine';
    case 'harvest': return 'sickle';
    case 'pick_forage': case 'collect_branch': case 'pick_sprout': case 'pick_berries': case 'sow': case 'tend': case 'plant_sprout': case 'butcher': return 'gather';
    case 'pick_up': case 'take_all': case 'place_item': case 'fill_jar': return 'pickup';
    case 'drink': return 'drink';
    case 'continue_build': case 'quick_build': case 'demolish': return 'hammer';
    case 'craft': return 'craft';
    case 'light_fire': case 'add_fuel': case 'fill_trough': case 'quench': case 'toggle_open': case 'open_container': case 'relight_torch': case 'apply_bandage': return 'interact';
    case 'plant_torch': return 'pickup';
    default: return null;
  }
}

/** How far from its anchor an object can be hit (in plan): a tree's crown, a piece's furthest corner. */
const pieceReach = new Map<string, number>();
function reachOf(o: WorldObj): number {
  switch (o.kind) {
    case 'tree': return Math.max(0.2 + 0.3 * treeScale(o).s, 1.5 * treeScale(o).s);
    case 'structure': {
      let r = pieceReach.get(o.type);
      if (r === undefined) {
        const def = STRUCTURES[o.type];
        r = 0;
        for (const b of [...def.boxes, ...(def.openBoxes ?? [])]) r = Math.max(r, Math.hypot(Math.abs(b.c[0]) + b.h[0], Math.abs(b.c[2]) + b.h[2]));
        pieceReach.set(o.type, r);
      }
      return r + 0.05;
    }
    default: return 0.8;
  }
}
