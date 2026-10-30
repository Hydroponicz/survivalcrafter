import { type Item } from '../data/items';
import { pieceBoxes, STRUCTURES, type V3 } from '../data/structures';
import { mulberry32, Simplex } from './noise';
import { Mat, Terrain, WATER_LEVEL, WORLD_SIZE } from './terrain';

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
    else this.nextId = Math.max(this.nextId, obj.id + 1);
    this.objects.set(obj.id, obj);
    const k = this.key(obj.x, obj.z);
    let set = this.grid.get(k);
    if (!set) this.grid.set(k, (set = new Set()));
    set.add(obj);
    this.listener?.added(obj);
    return obj;
  }

  remove(o: WorldObj) {
    this.objects.delete(o.id);
    this.grid.get(this.key(o.x, o.z))?.delete(o);
    this.listener?.removed(o);
  }

  changed(o: WorldObj) {
    this.listener?.changed(o);
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
  generate() {
    const t = this.terrain;
    t.generate();
    const rng = mulberry32(t.seed + 5);
    const forest = new Simplex(t.seed + 1234);
    for (let z = 4; z < WORLD_SIZE - 4; z += 2) {
      for (let x = 4; x < WORLD_SIZE - 4; x += 2) {
        const px = x + rng() * 2, pz = z + rng() * 2;
        const h = t.heightAt(px, pz);
        if (h < WATER_LEVEL + 0.5) continue;
        if (t.surfaceMaterial(px, pz) !== Mat.Grass) continue;
        const f = forest.fbm(px * 0.02, pz * 0.02, 3);
        const density = f > 0.15 ? 0.3 : f > -0.1 ? 0.055 : 0.011;
        if (rng() < density) {
          const species: Species = h > 14 ? 'pine' : rng() < 0.25 ? 'birch' : rng() < 0.3 ? 'pine' : 'oak';
          this.add<TreeObj>({ kind: 'tree', species, x: px, z: pz, age: 0.55 + rng() * 0.45, branches: 3 });
        } else if (rng() < 0.03) {
          this.add<BushObj>({ kind: 'bush', x: px, z: pz, ripe: rng() < 0.7, regrowAt: 0 });
        }
      }
    }
    this.findSpawn();
    this.populateAnimals(28);
  }

  /**
   * A gentle lowland meadow near the middle of the island: not a mountaintop,
   * with walkable ground all around so a new character can head off any way.
   */
  findSpawn() {
    const t = this.terrain;
    const c = WORLD_SIZE / 2;
    const ok = (x: number, z: number, maxH: number) => {
      if (t.surfaceMaterial(x, z) !== Mat.Grass) return false;
      const h = t.heightAt(x, z);
      if (h < 1.5 || h > maxH) return false;
      // Gentle in a 6 m radius, so you don't start on a ledge.
      for (let a = 0; a < 8; a++) {
        for (const r of [2, 4, 6]) {
          const nx = x + Math.cos((a / 8) * Math.PI * 2) * r, nz = z + Math.sin((a / 8) * Math.PI * 2) * r;
          if (Math.abs(t.heightAt(nx, nz) - h) > r * 0.35) return false;
        }
      }
      return !this.near(x, z, 2).some((o) => Math.hypot(o.x - x, o.z - z) < 2);
    };
    for (const maxH of [10, 16, 40]) {
      for (let r = 0; r < c - 12; r += 2) {
        for (let a = 0; a < 24; a++) {
          const x = c + Math.cos((a / 24) * Math.PI * 2) * r;
          const z = c + Math.sin((a / 24) * Math.PI * 2) * r;
          if (ok(x, z, maxH)) { this.spawn = { x, z }; return; }
        }
      }
    }
    this.spawn = { x: c, z: c };
  }

  populateAnimals(n: number) {
    const t = this.terrain;
    let tries = 0;
    while (this.animals.length < n && tries++ < n * 50) {
      const x = 8 + Math.random() * (WORLD_SIZE - 16);
      const z = 8 + Math.random() * (WORLD_SIZE - 16);
      if (t.heightAt(x, z) < 1) continue;
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 30) continue;
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
      this.terrain.randomTick();
    }
    for (const o of this.objects.values()) {
      if (o.kind === 'tree') {
        if (o.age < 1) {
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
      objects: [...this.objects.values()],
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
    for (const o of data.objects) w.add(o);
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
