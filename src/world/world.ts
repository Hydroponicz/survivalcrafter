import { type Item } from '../data/items';
import { STRUCTURES } from '../data/structures';
import { mulberry32, Simplex } from './noise';
import { Terrain, TILE, Tile, WATER_LEVEL } from './terrain';

export type Species = 'oak' | 'birch' | 'pine';
export type AnimalSpecies = 'deer' | 'boar';

export interface TreeObj {
  kind: 'tree'; id: number; species: Species; x: number; z: number;
  age: number; // 0..1, sprouts grow into full trees
  branches: number; // harvestable branches, regrow slowly
}

export interface BushObj {
  kind: 'bush'; id: number; x: number; z: number;
  ripe: boolean; regrowAt: number;
}

export interface StructureObj {
  kind: 'structure'; id: number; type: string;
  tx: number; tz: number; axis?: 'x' | 'z';
  x: number; z: number;
  /** Materials consumed so far, per item type. */
  consumed: Record<string, number>;
  built: boolean;
  ql: number;
  fuel: number; lit: boolean;
  open?: boolean;
  items?: Item[];
}

export interface PileObj { kind: 'pile'; id: number; x: number; z: number; items: Item[] }

export interface AnimalObj {
  kind: 'animal'; id: number; species: AnimalSpecies;
  x: number; z: number; rot: number;
  hp: number; maxHp: number;
  state: 'wander' | 'idle' | 'flee' | 'attack';
  timer: number; speed: number; dirX: number; dirZ: number;
  attackCooldown: number;
}

export interface Crop { planted: number; ql: number; tended: number }

export type WorldObj = TreeObj | BushObj | StructureObj | PileObj;

export interface WorldListener {
  added(o: WorldObj): void;
  removed(o: WorldObj): void;
  changed(o: WorldObj): void;
  cropsChanged(tileIndex: number): void;
}

export const DAY_LENGTH = 20 * 60; // seconds per in-game day
export const CROP_STAGE_TIME = 120; // seconds per growth stage
export const CROP_STAGES = 5;

export const ANIMALS: Record<AnimalSpecies, { name: string; hp: number; speed: number; aggressive: boolean; meat: number; damage: number }> = {
  deer: { name: 'Deer', hp: 35, speed: 4.5, aggressive: false, meat: 3, damage: 0 },
  boar: { name: 'Wild boar', hp: 40, speed: 3.6, aggressive: true, meat: 4, damage: 4 },
};

export class World {
  terrain: Terrain;
  objects = new Map<number, WorldObj>();
  crops = new Map<number, Crop>();
  animals: AnimalObj[] = [];
  time = DAY_LENGTH * 0.36; // start in the morning
  private grid = new Map<number, Set<WorldObj>>();
  private nextId = 1;
  listener?: WorldListener;
  spawn = { x: 0, z: 0 };

  constructor(seed: number) {
    this.terrain = new Terrain(seed);
  }

  // ---------- grid
  private key(x: number, z: number) {
    return Math.floor(z / TILE) * this.terrain.size + Math.floor(x / TILE);
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

  /** Objects whose anchor lies within the tiles overlapping the radius. */
  near(x: number, z: number, r: number): WorldObj[] {
    const out: WorldObj[] = [];
    const t0x = Math.floor((x - r) / TILE), t1x = Math.floor((x + r) / TILE);
    const t0z = Math.floor((z - r) / TILE), t1z = Math.floor((z + r) / TILE);
    for (let tz = t0z; tz <= t1z; tz++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        if (!this.terrain.inTiles(tx, tz)) continue;
        const set = this.grid.get(tz * this.terrain.size + tx);
        if (set) for (const o of set) out.push(o);
      }
    }
    return out;
  }

  objectsOnTile(tx: number, tz: number): WorldObj[] {
    const set = this.grid.get(tz * this.terrain.size + tx);
    return set ? [...set] : [];
  }

  structureAt(tx: number, tz: number, axis?: 'x' | 'z'): StructureObj | undefined {
    for (const o of this.objectsOnTile(tx, tz)) {
      if (o.kind !== 'structure') continue;
      const def = STRUCTURES[o.type];
      if (axis ? o.axis === axis : def.placement === 'tile') return o;
    }
    return undefined;
  }

  // ---------- generation
  generate() {
    const t = this.terrain;
    t.generate();
    const rng = mulberry32(t.seed + 5);
    const forest = new Simplex(t.seed + 1234);
    for (let tz = 1; tz < t.size - 1; tz++) {
      for (let tx = 1; tx < t.size - 1; tx++) {
        if (t.tileType(tx, tz) !== Tile.Grass) continue;
        const cx = (tx + 0.5) * TILE, cz = (tz + 0.5) * TILE;
        const h = t.heightAt(cx, cz);
        if (h < WATER_LEVEL + 0.5) continue;
        const f = forest.fbm(tx * 0.04, tz * 0.04, 3);
        const density = f > 0.15 ? 0.32 : f > -0.1 ? 0.06 : 0.012;
        const x = cx + (rng() - 0.5) * TILE * 0.6;
        const z = cz + (rng() - 0.5) * TILE * 0.6;
        if (rng() < density) {
          const species: Species = h > 14 ? 'pine' : rng() < 0.25 ? 'birch' : rng() < 0.3 ? 'pine' : 'oak';
          this.add<TreeObj>({ kind: 'tree', species, x, z, age: 0.55 + rng() * 0.45, branches: 3 });
        } else if (rng() < 0.03) {
          this.add<BushObj>({ kind: 'bush', x, z, ripe: rng() < 0.7, regrowAt: 0 });
        }
      }
    }
    this.findSpawn();
    this.populateAnimals(28);
  }

  findSpawn() {
    const t = this.terrain;
    const c = t.size / 2;
    for (let r = 0; r < c; r++) {
      for (let a = 0; a < 16; a++) {
        const tx = Math.round(c + Math.cos(a / 16 * Math.PI * 2) * r);
        const tz = Math.round(c + Math.sin(a / 16 * Math.PI * 2) * r);
        if (!t.inTiles(tx, tz)) continue;
        if (t.tileType(tx, tz) !== Tile.Grass) continue;
        const x = (tx + 0.5) * TILE, z = (tz + 0.5) * TILE;
        if (t.heightAt(x, z) < 1.5 || t.tileSlope(tx, tz) > 8) continue;
        if (this.objectsOnTile(tx, tz).length) continue;
        this.spawn = { x, z };
        return;
      }
    }
    this.spawn = { x: c * TILE, z: c * TILE };
  }

  populateAnimals(n: number) {
    const t = this.terrain;
    let tries = 0;
    while (this.animals.length < n && tries++ < n * 50) {
      const x = (4 + Math.random() * (t.size - 8)) * TILE;
      const z = (4 + Math.random() * (t.size - 8)) * TILE;
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

  /** Slow world processes: tree growth, bush ripening, grass spreading. */
  tick(dt: number) {
    this.time += dt;
    const t = this.terrain;
    // Random tile ticks, like Minecraft's random ticks.
    for (let i = 0; i < 40; i++) {
      const tx = Math.floor(Math.random() * t.size);
      const tz = Math.floor(Math.random() * t.size);
      if (t.tileType(tx, tz) === Tile.Dirt && Math.random() < 0.05 && t.heightAt((tx + 0.5) * TILE, (tz + 0.5) * TILE) > WATER_LEVEL) {
        const nb = [t.tileType(tx + 1, tz), t.tileType(tx - 1, tz), t.tileType(tx, tz + 1), t.tileType(tx, tz - 1)];
        if (nb.includes(Tile.Grass) && !this.structureAt(tx, tz)) t.setTileType(tx, tz, Tile.Grass);
      }
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
    // Keep crop visuals in step with their growth stage.
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
    const objs = [...this.objects.values()];
    return {
      terrain: this.terrain.serialize(),
      objects: objs,
      crops: [...this.crops.entries()].map(([k, c]) => [k, { planted: c.planted, ql: c.ql, tended: c.tended }]),
      animals: this.animals.map((a) => ({ species: a.species, x: a.x, z: a.z, hp: a.hp })),
      time: this.time,
      spawn: this.spawn,
    };
  }

  static load(data: ReturnType<World['serialize']>): World {
    const w = new World(data.terrain.seed);
    w.terrain.load(data.terrain);
    for (const o of data.objects) w.add(o);
    for (const [k, c] of data.crops as [number, Crop][]) w.crops.set(k, c);
    for (const a of data.animals) {
      const an = w.spawnAnimal(a.species, a.x, a.z);
      an.hp = a.hp;
    }
    w.time = data.time;
    w.spawn = data.spawn;
    return w;
  }
}
