import type { ToolKind } from './items';
import type { StationKind } from './recipes';
import type { SkillId } from './skills';

export type V3 = [number, number, number];
/** Axis-aligned box in the piece's local frame (origin at bottom centre, before yaw). */
export interface Box { c: V3; h: V3 }

export interface StructureDef {
  id: string;
  name: string;
  icon: string;
  category: 'Foundations' | 'Walls' | 'Roofs & stairs' | 'Doors & fences' | 'Crafting' | 'Furniture' | 'Smithy';
  /** Structural pieces snap to each other Valheim-style; stations are placed freely on the ground. */
  snap: boolean;
  boxes: Box[];
  /** Colliders when opened (doors and gates). */
  openBoxes?: Box[];
  /** Local snap points used to line pieces up. */
  snaps: V3[];
  materials: { item: string; count: number }[];
  tool?: ToolKind;
  skill: SkillId;
  difficulty: number;
  /** Seconds per building step (one material item per step). */
  stepTime: number;
  station?: StationKind;
  burns?: boolean; // accepts fuel and can be lit
  container?: number; // storage capacity in kg
  opens?: boolean;
  bed?: boolean;
  /**
   * Equipment crafted as an item and set down whole (no plan to build): the
   * item it is placed from and picked back up as. Its quality is the item's.
   */
  item?: string;
  /** Has to be set against the side of this kind of station. */
  attach?: 'forge';
  /** Holds this much water (in jars). */
  water?: number;
  desc: string;
}

const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): Box => ({ c: [cx, cy, cz], h: [hx, hy, hz] });
const WALL_SNAPS: V3[] = [[-1, 0, 0], [1, 0, 0], [-1, 2, 0], [1, 2, 0]];
const SLOPE_SNAPS: V3[] = [[-1, 0, -1], [1, 0, -1], [-1, 2, 1], [1, 2, 1]];

const stairBoxes: Box[] = Array.from({ length: 8 }, (_, k) => box(0, (k + 1) * 0.125, -1 + (k + 0.5) * 0.25, 1, (k + 1) * 0.125, 0.125));
const roofBoxes: Box[] = Array.from({ length: 4 }, (_, k) => box(0, (k + 1) * 0.5 - 0.15, -0.75 + k * 0.5, 1, 0.15, 0.25));

const defs: StructureDef[] = [
  // --- foundations
  { id: 'floor', name: 'Wooden floor', icon: '🟫', category: 'Foundations', snap: true,
    boxes: [box(0, 0.1, 0, 1, 0.1, 1)], snaps: [[-1, 0.2, -1], [1, 0.2, -1], [-1, 0.2, 1], [1, 0.2, 1]],
    materials: [{ item: 'plank', count: 4 }], tool: 'hammer', skill: 'carpentry', difficulty: 6, stepTime: 2.5,
    desc: 'A 2×2 m plank floor. Snaps to other floors, walls and foundations.' },
  { id: 'stone_foundation', name: 'Stone foundation', icon: '⬜', category: 'Foundations', snap: true,
    boxes: [box(0, 0.5, 0, 1, 0.5, 1)],
    snaps: [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]],
    materials: [{ item: 'rock_shard', count: 10 }, { item: 'mortar', count: 2 }], tool: 'hammer', skill: 'masonry', difficulty: 10, stepTime: 3,
    desc: 'A solid 2×1×2 m block. Sink it into a slope to get a level base.' },

  // --- walls
  { id: 'wood_wall', name: 'Plank wall', icon: '🪵', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.1)], snaps: WALL_SNAPS,
    materials: [{ item: 'plank', count: 4 }, { item: 'shaft', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 2.5,
    desc: 'A 2×2 m plank wall.' },
  { id: 'log_wall', name: 'Log wall', icon: '🧱', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.18)], snaps: WALL_SNAPS,
    materials: [{ item: 'log', count: 4 }], tool: 'hatchet', skill: 'carpentry', difficulty: 10, stepTime: 4,
    desc: 'A sturdy 2×2 m cabin wall of stacked logs.' },
  { id: 'stone_wall', name: 'Stone wall', icon: '🏰', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.2)], snaps: WALL_SNAPS,
    materials: [{ item: 'rock_shard', count: 10 }, { item: 'mortar', count: 3 }], tool: 'hammer', skill: 'masonry', difficulty: 15, stepTime: 3,
    desc: 'The strongest wall you can build.' },
  { id: 'beam', name: 'Wooden beam', icon: '🥢', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 0.1, 1, 0.1)], snaps: [[0, 0, 0], [0, 2, 0]],
    materials: [{ item: 'plank', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 5, stepTime: 2,
    desc: 'A 2 m upright post.' },

  // --- roofs & stairs
  { id: 'roof', name: 'Thatch roof (45°)', icon: '🛖', category: 'Roofs & stairs', snap: true,
    boxes: roofBoxes, snaps: SLOPE_SNAPS,
    materials: [{ item: 'plank', count: 3 }, { item: 'plant_fiber', count: 8 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 2,
    desc: 'A sloped 2×2 m roof. Its low edge snaps onto wall tops.' },
  { id: 'stairs', name: 'Wooden stairs', icon: '🪜', category: 'Roofs & stairs', snap: true,
    boxes: stairBoxes, snaps: SLOPE_SNAPS,
    materials: [{ item: 'plank', count: 5 }, { item: 'shaft', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 10, stepTime: 2.5,
    desc: 'Climbs 2 m over 2 m.' },

  // --- doors & fences
  { id: 'door', name: 'Wooden door', icon: '🚪', category: 'Doors & fences', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.1)], openBoxes: [box(-0.75, 1, 0, 0.25, 1, 0.1), box(0.75, 1, 0, 0.25, 1, 0.1)], snaps: WALL_SNAPS,
    materials: [{ item: 'plank', count: 4 }, { item: 'shaft', count: 2 }, { item: 'cordage', count: 1 }], tool: 'hammer', skill: 'carpentry', difficulty: 12, stepTime: 2.5,
    opens: true, desc: 'A wall segment with a door that opens.' },
  { id: 'fence', name: 'Wooden fence', icon: '🚧', category: 'Doors & fences', snap: true,
    boxes: [box(0, 0.6, 0, 1, 0.6, 0.06)], snaps: [[-1, 0, 0], [1, 0, 0]],
    materials: [{ item: 'plank', count: 2 }, { item: 'shaft', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 4, stepTime: 2,
    desc: 'Keeps animals in (or out).' },
  { id: 'gate', name: 'Wooden gate', icon: '⛩️', category: 'Doors & fences', snap: true,
    boxes: [box(0, 0.6, 0, 1, 0.6, 0.06)], openBoxes: [], snaps: [[-1, 0, 0], [1, 0, 0]],
    materials: [{ item: 'plank', count: 3 }, { item: 'shaft', count: 2 }, { item: 'cordage', count: 1 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 2,
    opens: true, desc: 'A fence segment that swings open.' },

  // --- crafting stations (placed freely)
  { id: 'campfire', name: 'Campfire', icon: '🔥', category: 'Crafting', snap: false,
    boxes: [box(0, 0.25, 0, 0.6, 0.25, 0.6)], snaps: [],
    materials: [{ item: 'rock_shard', count: 4 }, { item: 'branch', count: 3 }], skill: 'firemaking', difficulty: 2, stepTime: 2,
    station: 'fire', burns: true, desc: 'Cook food and fire pottery. Needs fuel and must be lit.' },
  { id: 'forge', name: 'Forge', icon: '🏭', category: 'Crafting', snap: false,
    boxes: [box(0, 0.9, 0, 0.75, 0.9, 0.65)], snaps: [],
    materials: [{ item: 'rock_shard', count: 16 }, { item: 'clay', count: 8 }], skill: 'masonry', difficulty: 10, stepTime: 3,
    station: 'forge', burns: true, desc: 'Smelts ore and heats metal for smithing. Also works as a fire.' },
  { id: 'quern', name: 'Quern', icon: '⚙️', category: 'Crafting', snap: false,
    boxes: [box(0, 0.4, 0, 0.6, 0.4, 0.6)], snaps: [],
    materials: [{ item: 'rock_shard', count: 10 }, { item: 'shaft', count: 1 }], tool: 'hammer', skill: 'masonry', difficulty: 8, stepTime: 3,
    station: 'quern', desc: 'Grinds grain into flour.' },
  { id: 'workbench', name: 'Workbench', icon: '🪑', category: 'Crafting', snap: false,
    boxes: [box(0, 0.45, 0, 0.8, 0.45, 0.4)], snaps: [],
    materials: [{ item: 'plank', count: 6 }, { item: 'shaft', count: 4 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 3,
    station: 'workbench', desc: 'A sturdy table for fine work.' },

  // --- smithy equipment: crafted as items, then placed (never planned)
  { id: 'bellows', name: 'Bellows', icon: '🪗', category: 'Smithy', snap: false, item: 'bellows', attach: 'forge',
    boxes: [box(0, 0.3, 0, 0.3, 0.3, 0.45)], snaps: [], materials: [], skill: 'carpentry', difficulty: 8, stepTime: 0,
    desc: 'Blows air into the forge. Without it a forge cannot get hot enough to smelt or smith.' },
  { id: 'anvil', name: 'Stone anvil', icon: '🪨', category: 'Smithy', snap: false, item: 'stone_anvil',
    boxes: [box(0, 0.4, 0, 0.5, 0.4, 0.25)], snaps: [], materials: [], skill: 'masonry', difficulty: 8, stepTime: 0,
    station: 'anvil', desc: 'A heavy block of dressed stone to hammer metal on.' },
  { id: 'iron_anvil', name: 'Iron anvil', icon: '⚒️', category: 'Smithy', snap: false, item: 'iron_anvil',
    boxes: [box(0, 0.4, 0, 0.55, 0.4, 0.22)], snaps: [], materials: [], skill: 'smithing', difficulty: 20, stepTime: 0,
    station: 'anvil', desc: 'A cast iron anvil. Strikes land truer and the work can reach higher quality than on stone.' },
  { id: 'quench_trough', name: 'Quench trough', icon: '🛁', category: 'Smithy', snap: false, item: 'quench_trough',
    boxes: [box(0, 0.25, 0, 0.6, 0.25, 0.3)], snaps: [], materials: [], skill: 'carpentry', difficulty: 8, stepTime: 0,
    water: 4, desc: 'Plunge freshly forged tools into the water to harden them.' },

  // --- furniture
  { id: 'chest', name: 'Storage chest', icon: '📦', category: 'Furniture', snap: false,
    boxes: [box(0, 0.33, 0, 0.5, 0.33, 0.3)], snaps: [],
    materials: [{ item: 'plank', count: 8 }], tool: 'hammer', skill: 'carpentry', difficulty: 10, stepTime: 3,
    container: 300, desc: 'Holds up to 300 kg of items.' },
  { id: 'bed', name: 'Bed', icon: '🛏️', category: 'Furniture', snap: false,
    boxes: [box(0, 0.24, 0, 0.5, 0.24, 0.95)], snaps: [],
    materials: [{ item: 'plank', count: 6 }, { item: 'hide', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 12, stepTime: 3,
    bed: true, desc: 'Sleep to set your respawn point.' },
];

export const STRUCTURES: Record<string, StructureDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const STRUCTURE_LIST = defs;
/** Pieces you plan and then build step by step (equipment is crafted and placed instead). */
export const BUILDABLE = defs.filter((d) => !d.item);

export function totalMaterials(def: StructureDef): number {
  return def.materials.reduce((s, m) => s + m.count, 0);
}

/** Colliders for a piece in its current state. */
export function pieceBoxes(def: StructureDef, open?: boolean): Box[] {
  return open && def.openBoxes ? def.openBoxes : def.boxes;
}
