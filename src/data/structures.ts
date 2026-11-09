import type { ToolKind } from './items';
import type { StationKind } from './recipes';
import type { SkillId } from './skills';
import { FURNITURE } from './furniture';
import type { VesselId } from './vessels';

export type V3 = [number, number, number];
/** Axis-aligned box in the piece's local frame (origin at bottom centre, before yaw). */
export interface Box { c: V3; h: V3 }

export interface StructureDef {
  id: string;
  name: string;
  icon: string;
  category: 'Foundations' | 'Walls' | 'Roofs & stairs' | 'Doors & fences' | 'Crafting' | 'Furniture' | 'Smithy' | 'Boats';
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
  /** Gives light when lit (the fire light's strength, and how high it sits). */
  glow?: { strength: number; height: number; out?: number };
  /** Fine furniture: makes the room comfortable. Sleeping in a bed near it, you wake rested (see Game, sleep). */
  comfort?: number;
  /**
   * Equipment crafted as an item and set down whole (no plan to build): the
   * item it is placed from and picked back up as. Its quality is the item's.
   */
  item?: string;
  /** Has to be set against the side of this kind of station. */
  attach?: 'forge';
  /** Holds this much water (in jars). */
  water?: number;
  /** Only found in villages (not in the build menu yet). */
  village?: boolean;
  /** Once finished it's a vessel, not a piece (a hull carved or built in place: see data/vessels). */
  becomes?: VesselId;
  /** Has to reach out into the water: at this point along it (its local z), water at least this deep. */
  reachesWater?: { z: number; depth: number };
  desc: string;
}

const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): Box => ({ c: [cx, cy, cz], h: [hx, hy, hz] });
const WALL_SNAPS: V3[] = [[-1, 0, 0], [1, 0, 0], [-1, 2, 0], [1, 2, 0]];
const SLOPE_SNAPS: V3[] = [[-1, 0, -1], [1, 0, -1], [-1, 2, 1], [1, 2, 1]];

const stairBoxes: Box[] = Array.from({ length: 8 }, (_, k) => box(0, (k + 1) * 0.125, -1 + (k + 0.5) * 0.25, 1, (k + 1) * 0.125, 0.125));
const roofBoxes: Box[] = Array.from({ length: 4 }, (_, k) => box(0, (k + 1) * 0.5 - 0.15, -0.75 + k * 0.5, 1, 0.15, 0.25));
/** A wall with a window: the wall around a 0.9 × 0.7 m opening. */
const windowBoxes: Box[] = [box(0, 0.45, 0, 1, 0.45, 0.1), box(0, 1.8, 0, 1, 0.2, 0.1), box(-0.725, 1.25, 0, 0.275, 0.35, 0.1), box(0.725, 1.25, 0, 0.275, 0.35, 0.1)];
/** A gable: a right triangle 2 m across and 2 m high, rising toward +x, in steps. */
const gableBoxes: Box[] = Array.from({ length: 4 }, (_, k) => box(-0.75 + k * 0.5, (k + 1) * 0.25, 0, 0.25, (k + 1) * 0.25, 0.06));

const defs: StructureDef[] = [
  // --- foundations
  { id: 'floor', name: 'Wooden floor', icon: '🟫', category: 'Foundations', snap: true,
    boxes: [box(0, 0.1, 0, 1, 0.1, 1)], snaps: [[-1, 0.2, -1], [1, 0.2, -1], [-1, 0.2, 1], [1, 0.2, 1]],
    materials: [{ item: 'plank', count: 4 }], tool: 'hammer', skill: 'carpentry', difficulty: 6, stepTime: 2.5,
    desc: 'A 2×2 m wooden floor. Snaps to other floors, walls and foundations.' },
  { id: 'stone_foundation', name: 'Stone foundation', icon: '⬜', category: 'Foundations', snap: true,
    boxes: [box(0, 0.5, 0, 1, 0.5, 1)],
    snaps: [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]],
    materials: [{ item: 'rock_shard', count: 10 }, { item: 'mortar', count: 2 }], tool: 'hammer', skill: 'masonry', difficulty: 10, stepTime: 3,
    desc: 'A solid stone block (2×1×2 m). Use it to make a flat base on a slope.' },

  // --- walls
  { id: 'wood_wall', name: 'Plank wall', icon: '🪵', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.1)], snaps: WALL_SNAPS,
    materials: [{ item: 'plank', count: 4 }, { item: 'shaft', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 2.5,
    desc: 'A 2×2 m wooden plank wall.' },
  { id: 'log_wall', name: 'Log wall', icon: '🧱', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.18)], snaps: WALL_SNAPS,
    materials: [{ item: 'log', count: 4 }], tool: 'hatchet', skill: 'carpentry', difficulty: 10, stepTime: 4,
    desc: 'A sturdy 2×2 m wall of stacked logs. Cheap to build: just logs and a hatchet.' },
  { id: 'stone_wall', name: 'Stone wall', icon: '🏰', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.2)], snaps: WALL_SNAPS,
    materials: [{ item: 'rock_shard', count: 10 }, { item: 'mortar', count: 3 }], tool: 'hammer', skill: 'masonry', difficulty: 15, stepTime: 3,
    desc: 'A 2×2 m stone wall. The strongest wall you can build.' },
  { id: 'window_wall', name: 'Windowed wall', icon: '🪟', category: 'Walls', snap: true,
    boxes: windowBoxes, snaps: WALL_SNAPS,
    materials: [{ item: 'plank', count: 4 }, { item: 'shaft', count: 3 }], tool: 'hammer', skill: 'carpentry', difficulty: 10, stepTime: 2.5,
    desc: 'A 2×2 m plank wall with a window to let light in.' },
  { id: 'beam', name: 'Wooden beam', icon: '🥢', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 0.1, 1, 0.1)], snaps: [[0, 0, 0], [0, 2, 0]],
    materials: [{ item: 'plank', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 5, stepTime: 2,
    desc: 'A 2 m wooden post.' },

  // --- roofs & stairs
  { id: 'roof', name: 'Thatch roof (45°)', icon: '🛖', category: 'Roofs & stairs', snap: true,
    boxes: roofBoxes, snaps: SLOPE_SNAPS,
    materials: [{ item: 'plank', count: 3 }, { item: 'plant_fiber', count: 8 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 2,
    desc: 'A sloped 2×2 m roof piece. Its lower edge snaps onto the top of a wall.' },
  { id: 'gable', name: 'Gable (roof end)', icon: '📐', category: 'Roofs & stairs', snap: true,
    boxes: gableBoxes, snaps: [[-1, 0, 0], [1, 0, 0], [1, 2, 0]],
    materials: [{ item: 'plank', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 6, stepTime: 2,
    desc: 'A triangle of planks that fills the open end under a sloped roof. Place it on top of a wall and rotate it to face the right way.' },
  { id: 'stairs', name: 'Wooden stairs', icon: '🪜', category: 'Roofs & stairs', snap: true,
    boxes: stairBoxes, snaps: SLOPE_SNAPS,
    materials: [{ item: 'plank', count: 5 }, { item: 'shaft', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 10, stepTime: 2.5,
    desc: 'Wooden stairs that climb 2 m.' },

  // --- doors & fences
  { id: 'door', name: 'Wooden door', icon: '🚪', category: 'Doors & fences', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.1)], openBoxes: [box(-0.75, 1, 0, 0.25, 1, 0.1), box(0.75, 1, 0, 0.25, 1, 0.1)], snaps: WALL_SNAPS,
    materials: [{ item: 'plank', count: 4 }, { item: 'shaft', count: 2 }, { item: 'cordage', count: 1 }], tool: 'hammer', skill: 'carpentry', difficulty: 12, stepTime: 2.5,
    opens: true, desc: 'A wall with a door you can open and close.' },
  { id: 'fence', name: 'Wooden fence', icon: '🚧', category: 'Doors & fences', snap: true,
    boxes: [box(0, 0.6, 0, 1, 0.6, 0.06)], snaps: [[-1, 0, 0], [1, 0, 0]],
    materials: [{ item: 'plank', count: 2 }, { item: 'shaft', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 4, stepTime: 2,
    desc: 'A wooden fence. Keeps animals in, or out.' },
  { id: 'gate', name: 'Wooden gate', icon: '⛩️', category: 'Doors & fences', snap: true,
    boxes: [box(0, 0.6, 0, 1, 0.6, 0.06)], openBoxes: [], snaps: [[-1, 0, 0], [1, 0, 0]],
    materials: [{ item: 'plank', count: 3 }, { item: 'shaft', count: 2 }, { item: 'cordage', count: 1 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 2,
    opens: true, desc: 'A fence gate you can open and close.' },

  // --- crafting stations (placed freely)
  { id: 'campfire', name: 'Campfire', icon: '🔥', category: 'Crafting', snap: false,
    boxes: [box(0, 0.25, 0, 0.6, 0.25, 0.6)], snaps: [],
    materials: [{ item: 'rock_shard', count: 4 }, { item: 'branch', count: 3 }], skill: 'firemaking', difficulty: 2, stepTime: 2,
    station: 'fire', burns: true, desc: 'Cooks food, fires pottery and lights up your camp. Add fuel and light it first.' },
  { id: 'forge', name: 'Forge', icon: '🏭', category: 'Crafting', snap: false,
    boxes: [box(0, 0.9, 0, 0.75, 0.9, 0.65)], snaps: [],
    materials: [{ item: 'rock_shard', count: 16 }, { item: 'clay', count: 8 }], skill: 'masonry', difficulty: 10, stepTime: 3,
    station: 'forge', burns: true, desc: 'Smelts ore and heats metal for smithing. Also works as a fire for cooking.' },
  { id: 'chopping_block', name: 'Chopping block', icon: '🪵', category: 'Crafting', snap: false,
    boxes: [box(0, 0.25, 0, 0.32, 0.25, 0.32)], snaps: [],
    materials: [{ item: 'log', count: 1 }], tool: 'hatchet', skill: 'woodcutting', difficulty: 3, stepTime: 2,
    station: 'chopping_block', desc: 'A sturdy stump to chop on. Split logs into rough planks and planks into kindling here.' },
  { id: 'quern', name: 'Quern', icon: '⚙️', category: 'Crafting', snap: false,
    boxes: [box(0, 0.4, 0, 0.6, 0.4, 0.6)], snaps: [],
    materials: [{ item: 'rock_shard', count: 10 }, { item: 'shaft', count: 1 }], tool: 'hammer', skill: 'masonry', difficulty: 8, stepTime: 3,
    station: 'quern', desc: 'Grinds grain into flour.' },
  { id: 'workbench', name: 'Workbench', icon: '🪑', category: 'Crafting', snap: false,
    boxes: [box(0, 0.45, 0, 0.8, 0.45, 0.4)], snaps: [],
    materials: [{ item: 'refined_plank', count: 6 }, { item: 'shaft', count: 4 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 3,
    station: 'workbench', desc: 'A sturdy workbench for crafting fine furniture.' },

  // --- smithy equipment: crafted as items, then placed (never planned)
  { id: 'bellows', name: 'Bellows', icon: '🪗', category: 'Smithy', snap: false, item: 'bellows', attach: 'forge',
    boxes: [box(0, 0.3, 0, 0.3, 0.3, 0.45)], snaps: [], materials: [], skill: 'carpentry', difficulty: 8, stepTime: 0,
    desc: 'Blows air into the forge. Without bellows, a forge can\'t get hot enough to smelt or smith.' },
  { id: 'anvil', name: 'Stone anvil', icon: '🪨', category: 'Smithy', snap: false, item: 'stone_anvil',
    boxes: [box(0, 0.4, 0, 0.5, 0.4, 0.25)], snaps: [], materials: [], skill: 'masonry', difficulty: 8, stepTime: 0,
    station: 'anvil', desc: 'A heavy stone block to hammer metal on.' },
  { id: 'iron_anvil', name: 'Iron anvil', icon: '⚒️', category: 'Smithy', snap: false, item: 'iron_anvil',
    boxes: [box(0, 0.4, 0, 0.55, 0.4, 0.22)], snaps: [], materials: [], skill: 'smithing', difficulty: 20, stepTime: 0,
    station: 'anvil', desc: 'A cast-iron anvil. Easier to work on than stone, and lets you forge higher-quality items.' },
  { id: 'quench_trough', name: 'Quench trough', icon: '🛁', category: 'Smithy', snap: false, item: 'quench_trough',
    boxes: [box(0, 0.27, 0, 0.31, 0.27, 0.31)], snaps: [], materials: [], skill: 'carpentry', difficulty: 8, stepTime: 0,
    water: 4, desc: 'Dip freshly forged tools in the water to harden them.' },

  // --- furniture
  { id: 'chest', name: 'Storage chest', icon: '📦', category: 'Furniture', snap: false,
    boxes: [box(0, 0.33, 0, 0.5, 0.33, 0.3)], snaps: [],
    materials: [{ item: 'plank', count: 8 }], tool: 'hammer', skill: 'carpentry', difficulty: 10, stepTime: 3,
    container: 300, desc: 'Stores up to 300 kg of items.' },
  { id: 'bed', name: 'Bed', icon: '🛏️', category: 'Furniture', snap: false,
    boxes: [box(0, 0.24, 0, 0.5, 0.24, 0.95)], snaps: [],
    materials: [{ item: 'plank', count: 6 }, { item: 'hide', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 12, stepTime: 3,
    bed: true, desc: 'Sleep here to set your respawn point. Fine furniture nearby helps you wake up well rested.' },

];

// A village well: a stone ring round deep water, a little roof over the winch.
defs.push({ id: 'well', name: 'Village well', icon: '🪣', category: 'Crafting', snap: false, village: true,
  boxes: [box(0, 0.45, 0, 0.85, 0.45, 0.85), box(-0.8, 1.2, 0, 0.08, 1.2, 0.08), box(0.8, 1.2, 0, 0.08, 1.2, 0.08)], snaps: [],
  materials: [{ item: 'rock_shard', count: 20 }, { item: 'mortar', count: 4 }, { item: 'plank', count: 4 }], tool: 'hammer', skill: 'masonry', difficulty: 15, stepTime: 3,
  desc: 'The village well: deep, clean water.' });

// The village storehouse: an open-fronted shed of crates, sacks and barrels on the square.
defs.push({ id: 'village_store', name: 'Village storehouse', icon: '🏪', category: 'Crafting', snap: false, village: true,
  boxes: [box(0, 1.1, 1.05, 1.6, 1.1, 0.12), box(0, 0.5, 0.45, 1.5, 0.5, 0.55), box(-1.55, 1.1, 0, 0.08, 1.1, 1.15), box(1.55, 1.1, 0, 0.08, 1.1, 1.15)], snaps: [],
  materials: [{ item: 'plank', count: 16 }, { item: 'log', count: 4 }, { item: 'plant_fiber', count: 12 }], tool: 'hammer', skill: 'carpentry', difficulty: 12, stepTime: 3,
  container: 2000, desc: 'The village\'s shared stores: what its people make, and what they live on. Trade with the village here, and take on its work orders.' });

// A market stall: a counter of goods under a striped awning.
defs.push({ id: 'market_stall', name: 'Market stall', icon: '⛺', category: 'Crafting', snap: false, village: true,
  boxes: [box(0, 0.45, -0.4, 1.0, 0.45, 0.3), box(-0.95, 1.1, 0.4, 0.06, 1.1, 0.06), box(0.95, 1.1, 0.4, 0.06, 1.1, 0.06)], snaps: [],
  materials: [{ item: 'plank', count: 6 }, { item: 'shaft', count: 4 }, { item: 'wool', count: 4 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 2,
  desc: 'A trader\'s stall on the market square.' });

// Town houses: the background buildings of a dense town's streets, each one whole piece (2–3 storeys,
// upper floors jettied out over the street), so a town can have hundreds. Not entered (the homes and
// shops people use are built of real pieces). Sizes in floor tiles wide × deep, then storeys; styles:
// a = stone below, plank above, thatch; b = all dark timber, thatch; c = all stone, plank roof.
export const TOWNHOUSE_SIZES: [number, number, number][] = [[2, 2, 2], [2, 2, 3], [3, 2, 2], [3, 2, 3], [2, 4, 2], [3, 4, 3]];
export const TOWNHOUSE_STYLES = ['a', 'b', 'c'] as const;
/** A town house's storey height (m). */
export const TH_STOREY = 2.4;
for (const [w, d, st] of TOWNHOUSE_SIZES) {
  for (const style of TOWNHOUSE_STYLES) {
    defs.push({ id: `th_${w}${d}${st}${style}`, name: st === 3 ? 'Tall town house' : 'Town house', icon: '🏘️', category: 'Walls', snap: false, village: true,
      boxes: [box(0, (st * TH_STOREY) / 2, 0, w, (st * TH_STOREY) / 2, d)], snaps: [],
      materials: [], skill: 'carpentry', difficulty: 20, stepTime: 3,
      desc: 'A town house, its upper storeys leaning out over the street.' });
  }
}
// A covered market hall: a thatched roof on posts over the stalls (12 × 8 m).
defs.push({ id: 'market_hall', name: 'Market hall', icon: '🏛️', category: 'Crafting', snap: false, village: true,
  boxes: [-6, 0, 6].flatMap((x) => [box(x, 2, -4, 0.15, 2, 0.15), box(x, 2, 4, 0.15, 2, 0.15)]), snaps: [],
  materials: [], skill: 'carpentry', difficulty: 15, stepTime: 3, desc: 'A covered market: stalls in out of the rain.' });
// The playhouse: a raised stage with a backdrop and canopy, and tiered stands for the audience.
defs.push({ id: 'stage', name: 'Stage', icon: '🎭', category: 'Crafting', snap: false, village: true,
  boxes: [box(0, 0.6, 0, 4, 0.6, 2.5), box(0, 2.7, 2.4, 4, 1.5, 0.1)], snaps: [],
  materials: [], skill: 'carpentry', difficulty: 12, stepTime: 3, desc: 'A playhouse stage, where players and minstrels perform.' });
defs.push({ id: 'stands', name: 'Stands', icon: '🪜', category: 'Crafting', snap: false, village: true,
  boxes: [box(0, 0.22, -1, 4, 0.22, 0.5), box(0, 0.45, 0, 4, 0.45, 0.5), box(0, 0.67, 1, 4, 0.67, 0.5)], snaps: [],
  materials: [], skill: 'carpentry', difficulty: 8, stepTime: 3, desc: 'Tiered benches for watching a play or a joust.' });

// The gallows on a castle city's square (a warning to thieves).
defs.push({ id: 'gallows', name: 'Gallows', icon: '🪢', category: 'Crafting', snap: false, village: true,
  boxes: [box(0, 0.7, 0, 1.5, 0.7, 1.5), box(-1, 2.9, 0.6, 0.11, 1.45, 0.11), box(1, 2.9, 0.6, 0.11, 1.45, 0.11)], snaps: [],
  materials: [], skill: 'carpentry', difficulty: 10, stepTime: 3, desc: 'The town\'s gallows.' });

// Boats are made where they'll be launched from: the hull is worked in place like any piece, and once
// it's done it's a vessel (data/vessels) you can drag, load and paddle.
// A dugout: a big log (three logs' worth, from one good tree) hollowed out with fire and axe:
// burn a bed of embers along the top, chop out the charred wood, burn again (the kindling).
defs.push({ id: 'dugout', name: 'Dugout canoe', icon: '🛶', category: 'Boats', snap: false, becomes: 'dugout',
  boxes: [box(0, 0.35, 0, 0.45, 0.35, 2.4)], snaps: [],
  materials: [{ item: 'log', count: 3 }, { item: 'kindling', count: 4 }], tool: 'hatchet', skill: 'carpentry', difficulty: 14, stepTime: 6,
  desc: 'A canoe hollowed out of one great log with fire and axe. Build it near the water: it is heavy to drag. Paddle it with a paddle; it carries two and 160 kg.' });

// A slipway: a long bed of timbers running down the shore into the water, ships built on a cradle on it
// (see data/ships) and slid down it at launch. Its landward end (local -z) on the shore, the seaward end
// (+z) out over water deep enough to float a ship off it.
defs.push({ id: 'slipway', name: 'Slipway', icon: '⚓', category: 'Boats', snap: false, reachesWater: { z: 22, depth: 1.6 },
  boxes: [box(-1.4, 0.2, 8, 0.25, 0.2, 14), box(1.4, 0.2, 8, 0.25, 0.2, 14)], snaps: [],
  materials: [{ item: 'log', count: 10 }, { item: 'plank', count: 10 }], tool: 'hatchet', skill: 'carpentry', difficulty: 12, stepTime: 5,
  desc: 'A shipyard\'s slip: a timber bed running down into the water, where ships up to 26 m long are built (aim at it to lay one down) and launched. Its far end must reach water at least 1.6 m deep.' });
// A raft: logs laid side by side and lashed across with cordage.
defs.push({ id: 'log_raft', name: 'Log raft', icon: '🪵', category: 'Boats', snap: false, becomes: 'log_raft',
  boxes: [box(0, 0.2, 0, 1.3, 0.2, 1.6)], snaps: [],
  materials: [{ item: 'log', count: 6 }, { item: 'cordage', count: 4 }], tool: 'hatchet', skill: 'carpentry', difficulty: 6, stepTime: 4,
  desc: 'Logs lashed side by side. Slow, but it carries 300 kg and goes anywhere shallow. Pole it along with a punt pole (Crafting).' });
// A reed boat: bundles of reeds (plant fiber from the marshes) bound tight with cordage.
defs.push({ id: 'reed_boat', name: 'Reed boat', icon: '🌾', category: 'Boats', snap: false, becomes: 'reed_boat',
  boxes: [box(0, 0.3, 0, 0.5, 0.3, 1.9)], snaps: [],
  materials: [{ item: 'plant_fiber', count: 24 }, { item: 'cordage', count: 6 }], tool: 'knife', skill: 'ropemaking', difficulty: 6, stepTime: 2.5,
  desc: 'Reed bundles bound into a light boat you can carry (18 kg). Cheap and quick, but it tears on the bottom: keep it off the rocks.' });
// A skin boat: a frame of light timbers, hides stretched over it and stitched.
defs.push({ id: 'skin_boat', name: 'Skin boat', icon: '🛶', category: 'Boats', snap: false, becomes: 'skin_boat',
  boxes: [box(0, 0.32, 0, 0.6, 0.32, 2.6)], snaps: [],
  materials: [{ item: 'shaft', count: 8 }, { item: 'hide', count: 6 }, { item: 'cordage', count: 6 }], tool: 'knife', skill: 'carpentry', difficulty: 12, stepTime: 4,
  desc: 'Hides over a light frame, like an Irish currach: fast, roomy (240 kg, three seats) and light for its size. The hide can tear on rocks.' });
// A rowing boat: planks fastened over frames, thwarts to sit on, oarlocks for a pair of oars.
defs.push({ id: 'rowboat', name: 'Rowing boat', icon: '🚣', category: 'Boats', snap: false, becomes: 'rowboat',
  boxes: [box(0, 0.4, 0, 0.75, 0.4, 2.3)], snaps: [],
  materials: [{ item: 'refined_plank', count: 10 }, { item: 'plank', count: 4 }, { item: 'shaft', count: 4 }], tool: 'hammer', skill: 'carpentry', difficulty: 20, stepTime: 5,
  desc: 'A planked boat with thwarts and oarlocks: the fastest and roomiest small boat (450 kg, three seats), and sturdy. Row it with a pair of oars.' });

// A torch planted in the ground: it burns (its fuel is the burn left) and lights the spot.
defs.push({ id: 'standing_torch', name: 'Torch', icon: '🔥', category: 'Crafting', snap: false, item: 'torch',
  boxes: [box(0, 0.55, 0, 0.09, 0.55, 0.09)], snaps: [], materials: [], skill: 'firemaking', difficulty: 1, stepTime: 0,
  glow: { strength: 0.55, height: 1.15 }, desc: 'A torch planted in the ground. Burns for about 3 days.' });
// A torch in an iron bracket on a wall (indoors, or on a house front): its local +z points out from the wall.
defs.push({ id: 'wall_torch', name: 'Wall torch', icon: '🔥', category: 'Crafting', snap: false, item: 'torch',
  boxes: [box(0, 0.08, 0.2, 0.08, 0.32, 0.2)], snaps: [], materials: [], skill: 'firemaking', difficulty: 1, stepTime: 0,
  glow: { strength: 0.55, height: 0.45, out: 0.45 }, desc: 'A torch in a bracket on the wall. Burns for about 3 days.' });

// Fine furniture: made at a workbench and set down from your pack (see data/furniture).
for (const f of FURNITURE) {
  const [x, y, z, hx, hy, hz] = f.box;
  defs.push({ id: f.id, name: f.name, icon: f.icon, category: 'Furniture', snap: false, item: f.id,
    boxes: [box(x, y, z, hx, hy, hz)], snaps: [], materials: [], skill: 'carpentry', difficulty: f.difficulty, stepTime: 0,
    comfort: f.comfort || undefined, container: f.container, bed: f.bed, desc: f.desc });
}

export const STRUCTURES: Record<string, StructureDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const STRUCTURE_LIST = defs;
/** Pieces you plan and then build step by step (equipment is crafted and placed instead). */
export const BUILDABLE = defs.filter((d) => !d.item && !d.village);

export function totalMaterials(def: StructureDef): number {
  return def.materials.reduce((s, m) => s + m.count, 0);
}

/** Colliders for a piece in its current state. */
export function pieceBoxes(def: StructureDef, open?: boolean): Box[] {
  return open && def.openBoxes ? def.openBoxes : def.boxes;
}
