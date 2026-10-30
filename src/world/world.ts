import { type Item } from '../data/items';
import { pieceBoxes, STRUCTURES, type V3 } from '../data/structures';
import { mulberry32, Simplex } from './noise';
import { Mat, Terrain, WORLD_SIZE } from './terrain';
import type { Zone } from './climate';

export type Species = 'oak' | 'birch' | 'pine';
export type AnimalSpecies = 'deer' | 'boar';

export interface TreeObj {
  kind: 'tree'; id: number; species: Species; x: number; z: number;
  age: number; // 0..1, sprouts grow into full trees
  branches: number; // harvestable branches, regrow slowly
  /** How far it has been chopped through (0..1), the direction the notch faces, and the work's quality so far. */
  chop?: number;
  notchDir?: number;
  chopQl?: number;
  /** Planted by you: grows up over time (wild trees stay the size they are). */
  growing?: boolean;
}

/** What's left after felling a tree. Scenery only. */
export interface Stump { x: number; z: number; s: number; species: Species }

export interface BushObj {
  kind: 'bush'; id: number; x: number; z: number;
  ripe: boolean; regrowAt: number;
}

/** A building piece or station. Position is its bottom centre; yaw turns it about Y. */
export interface StructureObj {
  kind: 'structure'; id: number; type: string;
  x: number; y: number; z: number; yaw: number;
  /** Materials consumed so far, per item type. */
  consumed: Record<string, number>;
  built: boolean;
  ql: number;
  fuel: number; lit: boolean;
  open?: boolean;
  items?: Item[];
  /** Placed equipment remembers its wear for when it's picked back up. */
  dmg?: number;
  /** Jars of water in a trough. */
  water?: number;
}

/** Something growing or lying on the ground that you can pick up (see data/forage). */
export interface ForageObj { kind: 'forage'; id: number; species: string; x: number; y: number; z: number; rot: number }

export interface PileObj { kind: 'pile'; id: number; x: number; y: number; z: number; items: Item[] }

export interface AnimalObj {
  kind: 'animal'; id: number; species: AnimalSpecies;
  x: number; z: number; rot: number;
  hp: number; maxHp: number;
  state: 'wander' | 'idle' | 'flee' | 'attack';
  timer: number; speed: number; dirX: number; dirZ: number;
  attackCooldown: number;
  /** When an animal stranded in water next re-aims for the shore. */
  shoreAt?: number;
}

/** Crops grow on 1 m cells of tilled ground. */
export interface Crop { planted: number; ql: number; tended: number }

export type WorldObj = TreeObj | BushObj | StructureObj | PileObj | ForageObj;

export interface WorldListener {
  added(o: WorldObj): void;
  removed(o: WorldObj): void;
  changed(o: WorldObj): void;
  cropsChanged(key: number): void;
}

export const DAY_LENGTH = 20 * 60; // seconds per in-game day
export const CROP_STAGE_TIME = 120; // seconds per growth stage
export const CROP_STAGES = 5;
const CELL = 2; // spatial hash cell size in metres
const GRID = WORLD_SIZE / CELL;

export const ANIMALS: Record<AnimalSpecies, { name: string; hp: number; speed: number; aggressive: boolean; meat: number; damage: number }> = {
  deer: { name: 'Deer', hp: 35, speed: 4.5, aggressive: false, meat: 3, damage: 0 },
  boar: { name: 'Wild boar', hp: 40, speed: 3.6, aggressive: true, meat: 4, damage: 4 },
};

export const cropKey = (x: number, z: number) => Math.floor(z) * WORLD_SIZE + Math.floor(x);
export const cropPos = (key: number) => ({ x: (key % WORLD_SIZE) + 0.5, z: Math.floor(key / WORLD_SIZE) + 0.5 });

// ---------- piece geometry helpers

/** A world point expressed in a piece's local frame. */
export function toLocal(s: StructureObj, x: number, y: number, z: number): V3 {
  const dx = x - s.x, dz = z - s.z;
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return [dx * c - dz * sn, y - s.y, dx * sn + dz * c];
}

export function toWorld(s: { x: number; y: number; z: number; yaw: number }, l: V3): V3 {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return [s.x + l[0] * c + l[2] * sn, s.y + l[1], s.z - l[0] * sn + l[2] * c];
}

/** Is a point inside one of the piece's boxes (optionally grown by a margin)? */
export function pointInPiece(s: StructureObj, x: number, y: number, z: number, margin = 0): boolean {
  const [lx, ly, lz] = toLocal(s, x, y, z);
  for (const b of pieceBoxes(STRUCTURES[s.type], s.open)) {
    if (Math.abs(lx - b.c[0]) <= b.h[0] + margin && Math.abs(ly - b.c[1]) <= b.h[1] + margin && Math.abs(lz - b.c[2]) <= b.h[2] + margin) return true;
  }
  return false;
}

/** What grows in each climate zone: tree density per 4 m², species mix, stature, berry bushes. */
const VEGETATION: Record<Zone, { trees: number; oak: number; birch: number; pine: number; stature: number; bushes: number }> = {
  broadleaf: { trees: 0.11, oak: 6, birch: 3, pine: 1, stature: 1, bushes: 0.04 },
  conifer: { trees: 0.14, oak: 0.5, birch: 1.5, pine: 8, stature: 1, bushes: 0.02 },
  meadow: { trees: 0.012, oak: 6, birch: 2, pine: 1, stature: 1, bushes: 0.05 },
  heath: { trees: 0.008, oak: 1, birch: 3, pine: 4, stature: 0.75, bushes: 0.03 },
  marsh: { trees: 0.03, oak: 0, birch: 8, pine: 1, stature: 0.85, bushes: 0.02 },
  alpine: { trees: 0.03, oak: 0, birch: 1, pine: 9, stature: 0.6, bushes: 0.01 },
  beach: { trees: 0.004, oak: 0, birch: 1, pine: 3, stature: 0.8, bushes: 0 },
  snow: { trees: 0, oak: 0, birch: 0, pine: 1, stature: 0.5, bushes: 0 },
};

/** Wild things are generated a region at a time around you. */
export const REGION = 64;
const NR = WORLD_SIZE / REGION;
/** Generated objects get ids from here up (region * 4096 + index), so they're the same every visit. */
export const GEN_BASE = 100_000_000;
const LOAD_R = 220;
const UNLOAD_R = 290;
export const isGenerated = (id: number) => id >= GEN_BASE;
const regionOfId = (id: number) => Math.floor((id - GEN_BASE) / 4096);

/** What you've done to a region's wild things: removed some, changed others. */
interface RegionState { removed: Set<number>; changed: Map<number, WorldObj> }

/** Something that adds more generated things to a region (the game adds forage). */
export type RegionHook = (world: World, x0: number, z0: number, rnd: () => number, id: () => number) => void;

export class World {
  terrain: Terrain;
  objects = new Map<number, WorldObj>();
  crops = new Map<number, Crop>();
  animals: AnimalObj[] = [];
  stumps: Stump[] = [];
  time = DAY_LENGTH * 0.36; // start in the morning
  private grid = new Map<number, Set<WorldObj>>();
  private nextId = 1;
  private tickTimer = 0;
  listener?: WorldListener;
  spawn = { x: 0, z: 0 };
  private regions = new Map<number, RegionState>();
  private loadedRegions = new Set<number>();
  regionHooks: RegionHook[] = [];
  /** Where things are happening (the player): slow processes run around here. */
  focus = { x: WORLD_SIZE / 2, z: WORLD_SIZE / 2 };

  constructor(seed: number) {
    this.terrain = new Terrain(seed);
  }

  // ---------- spatial hash
  private key(x: number, z: number) {
    const cx = Math.max(0, Math.min(GRID - 1, Math.floor(x / CELL)));
    const cz = Math.max(0, Math.min(GRID - 1, Math.floor(z / CELL)));
    return cz * GRID + cx;
  }

  add<T extends WorldObj>(o: Omit<T, 'id'> & { id?: number }): T {
    const obj = o as T;
    if (!obj.id) obj.id = this.nextId++;
    else if (!isGenerated(obj.id)) this.nextId = Math.max(this.nextId, obj.id + 1);
    this.objects.set(obj.id, obj);
    const k = this.key(obj.x, obj.z);
    let set = this.grid.get(k);
    if (!set) this.grid.set(k, (set = new Set()));
    set.add(obj);
    this.listener?.added(obj);
    return obj;
  }

  remove(o: WorldObj) {
    this.detach(o);
    if (isGenerated(o.id)) {
      const st = this.regionState(regionOfId(o.id));
      st.removed.add(o.id);
      st.changed.delete(o.id);
    }
  }

  /** Take an object out of the live world without forgetting it (region unloading). */
  private detach(o: WorldObj) {
    this.objects.delete(o.id);
    this.grid.get(this.key(o.x, o.z))?.delete(o);
    this.listener?.removed(o);
  }

  /** Something about an object changed: redraw it, and remember it if it's a wild thing. */
  changed(o: WorldObj) {
    this.listener?.changed(o);
    if (isGenerated(o.id)) this.regionState(regionOfId(o.id)).changed.set(o.id, o);
  }

  private regionState(r: number): RegionState {
    let st = this.regions.get(r);
    if (!st) this.regions.set(r, (st = { removed: new Set(), changed: new Map() }));
    return st;
  }

  // ---------- regions
  /** Load the regions around a point and let go of distant ones. Returns how many were generated. */
  stream(px: number, pz: number, maxNew = 1): number {
    let made = 0;
    const r0x = Math.floor((px - LOAD_R) / REGION), r1x = Math.floor((px + LOAD_R) / REGION);
    const r0z = Math.floor((pz - LOAD_R) / REGION), r1z = Math.floor((pz + LOAD_R) / REGION);
    const want: [number, number, number][] = [];
    for (let rz = Math.max(0, r0z); rz <= Math.min(NR - 1, r1z); rz++) {
      for (let rx = Math.max(0, r0x); rx <= Math.min(NR - 1, r1x); rx++) {
        const d = this.regionDist(rx, rz, px, pz);
        if (d <= LOAD_R && !this.loadedRegions.has(rz * NR + rx)) want.push([rx, rz, d]);
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const [rx, rz] of want) {
      if (made >= maxNew) break;
      // Work out the ground a few columns a frame first; generate once it's all known.
      if (maxNew < 10 && this.terrain.prepare(rx * REGION, rz * REGION, REGION, 3) > 0) break;
      this.loadRegion(rx, rz);
      made++;
    }
    for (const r of [...this.loadedRegions]) {
      if (this.regionDist(r % NR, Math.floor(r / NR), px, pz) > UNLOAD_R) this.unloadRegion(r);
    }
    return made;
  }

  /** Are all regions within `r` of a point loaded? */
  regionsReady(px: number, pz: number, r = LOAD_R): boolean {
    for (let rz = Math.max(0, Math.floor((pz - r) / REGION)); rz <= Math.min(NR - 1, Math.floor((pz + r) / REGION)); rz++) {
      for (let rx = Math.max(0, Math.floor((px - r) / REGION)); rx <= Math.min(NR - 1, Math.floor((px + r) / REGION)); rx++) {
        if (this.regionDist(rx, rz, px, pz) <= r && !this.loadedRegions.has(rz * NR + rx)) return false;
      }
    }
    return true;
  }

  private regionDist(rx: number, rz: number, px: number, pz: number) {
    const cx = Math.max(rx * REGION, Math.min(px, (rx + 1) * REGION)), cz = Math.max(rz * REGION, Math.min(pz, (rz + 1) * REGION));
    return Math.hypot(cx - px, cz - pz);
  }

  /** Grow a region's trees, bushes and the rest (the same every time), minus what you've taken. */
  private loadRegion(rx: number, rz: number) {
    const r = rz * NR + rx;
    this.loadedRegions.add(r);
    const st = this.regions.get(r);
    let k = 0;
    const nextId = () => GEN_BASE + r * 4096 + k++;
    const place = <T extends WorldObj>(o: Omit<T, 'id'>) => {
      const id = nextId();
      if (st?.removed.has(id)) return;
      const kept = st?.changed.get(id);
      this.add<T>((kept ?? { ...o, id }) as T);
    };
    const t = this.terrain;
    const rng = mulberry32(this.terrain.seed * 31 + r * 7919);
    const forest = this.forestNoise ??= new Simplex(t.seed + 1234);
    const x0 = rx * REGION, z0 = rz * REGION;
    for (let gz = 0; gz < REGION; gz += 2) {
      for (let gx = 0; gx < REGION; gx += 2) {
        const px = x0 + gx + rng() * 2, pz = z0 + gz + rng() * 2;
        const roll = rng(), roll2 = rng(), roll3 = rng();
        const h = t.heightAt(px, pz);
        if (h < t.waterAt(px, pz) + 0.5) continue;
        if (t.topAt(px, pz) !== Mat.Grass) continue;
        // The climate zone sets what grows; patchy noise breaks it into stands and clearings.
        const zone = VEGETATION[t.zoneAt(px, pz)];
        const f = forest.fbm(px * 0.02, pz * 0.02, 3);
        const density = zone.trees * Math.max(0.15, Math.min(1.8, 1 + f * 2.2));
        if (roll < density) {
          const sp = roll2 * (zone.oak + zone.birch + zone.pine);
          const species: Species = sp < zone.oak ? 'oak' : sp < zone.oak + zone.birch ? 'birch' : 'pine';
          // Mostly full-grown, with younger trees and saplings coming up between them;
          // up high and in the dry, trees grow stunted.
          const age = (roll3 < 0.1 ? 0.15 + roll3 * 1.5 : roll3 < 0.32 ? 0.35 + (roll3 - 0.1) * 1.6 : 0.75 + (roll3 - 0.32) * 0.37) * zone.stature;
          place<TreeObj>({ kind: 'tree', species, x: px, z: pz, age, branches: 3 });
        } else if (roll2 < zone.bushes) {
          place<BushObj>({ kind: 'bush', x: px, z: pz, ripe: roll3 < 0.7, regrowAt: 0 });
        }
      }
    }
    // Everything else the game grows here (forage), numbered after the trees.
    k = 1100;
    for (const hook of this.regionHooks) {
      hook(this, x0, z0, rng, () => {
        const id = nextId();
        return st?.removed.has(id) ? -1 : id;
      });
    }
  }

  private forestNoise?: Simplex;

  /** Let go of a far region: its wild things are regenerated (with your changes) when you come back. */
  private unloadRegion(r: number) {
    this.loadedRegions.delete(r);
    const rx = r % NR, rz = Math.floor(r / NR);
    for (const o of this.near((rx + 0.5) * REGION, (rz + 0.5) * REGION, REGION * 0.75)) {
      if (Math.floor(o.x / REGION) !== rx || Math.floor(o.z / REGION) !== rz) continue;
      // Wild things go (their changes are kept in the region's state), and so does regrown forage.
      if (isGenerated(o.id) || o.kind === 'forage') this.detach(o);
    }
  }

  /** Objects anchored within the cells overlapping a radius. */
  near(x: number, z: number, r: number): WorldObj[] {
    const out: WorldObj[] = [];
    const c0x = Math.max(0, Math.floor((x - r) / CELL)), c1x = Math.min(GRID - 1, Math.floor((x + r) / CELL));
    const c0z = Math.max(0, Math.floor((z - r) / CELL)), c1z = Math.min(GRID - 1, Math.floor((z + r) / CELL));
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const set = this.grid.get(cz * GRID + cx);
        if (set) for (const o of set) out.push(o);
      }
    }
    return out;
  }

  /** Built pieces whose colliders could touch a point. */
  piecesNear(x: number, z: number, r = 2.5): StructureObj[] {
    return this.near(x, z, r + 1.5).filter((o): o is StructureObj => o.kind === 'structure');
  }

  /** Is anything solid (terrain or a built piece) at this point? */
  blockedAt(x: number, y: number, z: number): boolean {
    if (this.terrain.solidAt(x, y, z)) return true;
    for (const s of this.piecesNear(x, z, 0)) if (s.built && pointInPiece(s, x, y, z)) return true;
    return false;
  }

  // ---------- generation
  /** Make the world map and pick where you start (wild things load as you approach). */
  generate() {
    this.terrain.generate();
    this.findSpawn();
  }

  /**
   * Somewhere gentle to start: lowland grass or woodland near the middle of
   * the land, not a mountainside, with walkable ground all around. Searched on
   * the world map directly (fast) rather than through the voxel terrain.
   */
  findSpawn() {
    const g = this.terrain.gen;
    const c = WORLD_SIZE / 2;
    const ok = (x: number, z: number, maxH: number) => {
      const h = g.height(x, z);
      if (h < 3 || h > maxH || !Number.isNaN(g.water(x, z, h))) return false;
      for (let a = 0; a < 8; a++) {
        for (const r of [3, 6, 10]) {
          const nx = x + Math.cos((a / 8) * Math.PI * 2) * r, nz = z + Math.sin((a / 8) * Math.PI * 2) * r;
          if (Math.abs(g.height(nx, nz) - h) > r * 0.3) return false;
        }
      }
      const zone = g.zone(x, z, h);
      return (zone === 'meadow' || zone === 'broadleaf' || zone === 'heath') && g.soil(x, z, h, 0).top === 'grass';
    };
    for (const maxH of [40, 90, 200]) {
      for (let r = 0; r < c - 200; r += 24) {
        for (let a = 0; a < 32; a++) {
          const x = c + Math.cos((a / 32) * Math.PI * 2 + r) * r;
          const z = c + Math.sin((a / 32) * Math.PI * 2 + r) * r;
          if (ok(x, z, maxH)) { this.spawn = { x, z }; return; }
        }
      }
    }
    this.spawn = { x: c, z: c };
  }

  /** Keep a few animals about: new ones appear out of sight around you, far-off ones wander away. */
  keepAnimals(px: number, pz: number, want = 24) {
    this.animals = this.animals.filter((a) => Math.hypot(a.x - px, a.z - pz) < 320);
    const g = this.terrain.gen;
    for (let tries = 0; tries < 6 && this.animals.length < want; tries++) {
      const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 150;
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (x < 8 || z < 8 || x > WORLD_SIZE - 8 || z > WORLD_SIZE - 8) continue;
      const h = g.height(x, z);
      if (h < 1 || !Number.isNaN(g.water(x, z, h)) || g.temperature(x, h, z) < 0.25) continue;
      this.spawnAnimal(Math.random() < 0.65 ? 'deer' : 'boar', x, z);
    }
  }

  spawnAnimal(species: AnimalSpecies, x: number, z: number): AnimalObj {
    const d = ANIMALS[species];
    const a: AnimalObj = {
      kind: 'animal', id: this.nextId++, species, x, z, rot: Math.random() * Math.PI * 2,
      hp: d.hp, maxHp: d.hp, state: 'idle', timer: 1 + Math.random() * 4, speed: 0, dirX: 0, dirZ: 0,
      attackCooldown: 0,
    };
    this.animals.push(a);
    return a;
  }

  // ---------- time
  get dayFraction() { return (this.time % DAY_LENGTH) / DAY_LENGTH; }
  get day() { return Math.floor(this.time / DAY_LENGTH) + 1; }

  cropStage(c: Crop): number {
    const stageTime = CROP_STAGE_TIME / (1 + c.tended * 0.15);
    return Math.min(CROP_STAGES - 1, Math.floor((this.time - c.planted) / stageTime));
  }

  /** Forage finds on ground that was dug away or buried are lost; the rest settle to the new surface. */
  settleForage(x: number, z: number, r: number) {
    for (const o of this.near(x, z, r + 1)) {
      if (o.kind !== 'forage') continue;
      const h = this.terrain.heightAt(o.x, o.z);
      if (Math.abs(h - o.y) > 0.25) this.remove(o);
      else { o.y = h; this.changed(o); }
    }
  }

  /** Remove crops whose tilled soil was disturbed near a point. */
  disturbCrops(x: number, z: number, r: number) {
    for (const k of [...this.crops.keys()]) {
      const p = cropPos(k);
      if (Math.hypot(p.x - x, p.z - z) > r + 0.6) continue;
      if (this.terrain.surfaceMaterial(p.x, p.z) !== Mat.Field) {
        this.crops.delete(k);
        this.listener?.cropsChanged(k);
      }
    }
  }

  /** Slow world processes: tree growth, bush ripening, grass spreading. */
  tick(dt: number) {
    this.time += dt;
    this.tickTimer += dt;
    while (this.tickTimer > 0.25) {
      this.tickTimer -= 0.25;
      this.terrain.randomTick(this.focus.x, this.focus.z);
    }
    for (const o of this.objects.values()) {
      if (o.kind === 'tree') {
        if (o.growing && o.age < 1) {
          o.age = Math.min(1, o.age + dt / 900);
          if (Math.random() < dt) this.changed(o);
        }
        if (o.branches < 3 && Math.random() < dt / 240) o.branches++;
      } else if (o.kind === 'bush') {
        if (!o.ripe && this.time >= o.regrowAt) { o.ripe = true; this.changed(o); }
      } else if (o.kind === 'structure' && o.lit) {
        o.fuel -= dt;
        if (o.fuel <= 0) { o.fuel = 0; o.lit = false; this.changed(o); }
      }
    }
    for (const [k, c] of this.crops) {
      const prev = (c as Crop & { _stage?: number })._stage;
      const s = this.cropStage(c);
      if (prev !== s) {
        (c as Crop & { _stage?: number })._stage = s;
        this.listener?.cropsChanged(k);
      }
    }
  }

  // ---------- persistence
  serialize() {
    return {
      terrain: this.terrain.serialize(),
      // Your things, and what you've changed about the wild ones.
      objects: [...this.objects.values()].filter((o) => !isGenerated(o.id) && o.kind !== 'forage'),
      regions: [...this.regions.entries()]
        .filter(([, st]) => st.removed.size || st.changed.size)
        .map(([r, st]) => [r, [...st.removed], [...st.changed.values()]] as [number, number[], WorldObj[]]),
      crops: [...this.crops.entries()].map(([k, c]) => [k, { planted: c.planted, ql: c.ql, tended: c.tended }]),
      animals: this.animals.map((a) => ({ species: a.species, x: a.x, z: a.z, hp: a.hp })),
      time: this.time,
      spawn: this.spawn,
      stumps: this.stumps,
    };
  }

  static load(data: ReturnType<World['serialize']>): World {
    const w = new World(data.terrain.seed);
    w.terrain.generate();
    w.terrain.load(data.terrain);
    for (const o of data.objects) {
      // Old saves planned anvils as buildings; they're placed equipment now.
      if (o.kind === 'structure' && STRUCTURES[o.type]?.item && !o.built) { o.built = true; o.ql = Math.max(o.ql, 10); }
      w.add(o);
    }
    for (const [r, removed, changed] of data.regions ?? []) {
      w.regions.set(r, { removed: new Set(removed), changed: new Map(changed.map((o) => [o.id, o])) });
    }
    for (const [k, c] of data.crops as [number, Crop][]) w.crops.set(k, c);
    for (const a of data.animals) {
      const an = w.spawnAnimal(a.species, a.x, a.z);
      an.hp = a.hp;
    }
    w.time = data.time;
    w.spawn = data.spawn;
    w.stumps = data.stumps ?? [];
    return w;
  }
}
