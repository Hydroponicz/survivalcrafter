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
  category: 'Foundations' | 'Walls' | 'Roofs & stairs' | 'Doors & fences' | 'Crafting' | 'Furniture' | 'Decor' | 'Smithy' | 'Boats' | 'Waterside';
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
  /** A slipway: the longest ship it takes (m). */
  slip?: number;
  /**
   * Built out from the shore into the water (a quay, a jetty): it's set by the
   * water, its top this high above the surface (m), its footings running down
   * to the bed (as deep as the piece goes below its top, less a little).
   */
  waterside?: { top: number };
  /** What it is to the things you do with pieces: a floor (a torch stands on it) or a wall (a torch mounts on it). */
  role?: 'floor' | 'wall';
  /** Where you can climb it (a ladder): standing in this box, W climbs and S climbs down. */
  climb?: Box;
  /** Ships are made fast to it: leave a ship's helm near one and she's moored. */
  mooring?: boolean;
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
  { id: 'floor', role: 'floor', name: 'Wooden floor', icon: '🟫', category: 'Foundations', snap: true,
    boxes: [box(0, 0.1, 0, 1, 0.1, 1)], snaps: [[-1, 0.2, -1], [1, 0.2, -1], [-1, 0.2, 1], [1, 0.2, 1]],
    materials: [{ item: 'plank', count: 4 }], tool: 'hammer', skill: 'carpentry', difficulty: 6, stepTime: 2.5,
    desc: 'A 2×2 m wooden floor. Snaps to other floors, walls and foundations.' },
  { id: 'stone_foundation', role: 'floor', name: 'Stone foundation', icon: '⬜', category: 'Foundations', snap: true,
    boxes: [box(0, 0.5, 0, 1, 0.5, 1)],
    snaps: [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]],
    materials: [{ item: 'rock_shard', count: 10 }, { item: 'mortar', count: 2 }], tool: 'hammer', skill: 'masonry', difficulty: 10, stepTime: 3,
    desc: 'A solid stone block (2×1×2 m). Use it to make a flat base on a slope.' },

  // --- walls
  { id: 'wood_wall', role: 'wall', name: 'Plank wall', icon: '🪵', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.1)], snaps: WALL_SNAPS,
    materials: [{ item: 'plank', count: 4 }, { item: 'shaft', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 2.5,
    desc: 'A 2×2 m wooden plank wall.' },
  { id: 'log_wall', role: 'wall', name: 'Log wall', icon: '🧱', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.18)], snaps: WALL_SNAPS,
    materials: [{ item: 'log', count: 4 }], tool: 'hatchet', skill: 'carpentry', difficulty: 10, stepTime: 4,
    desc: 'A sturdy 2×2 m wall of stacked logs. Cheap to build: just logs and a hatchet.' },
  { id: 'stone_wall', role: 'wall', name: 'Stone wall', icon: '🏰', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.2)], snaps: WALL_SNAPS,
    materials: [{ item: 'rock_shard', count: 10 }, { item: 'mortar', count: 3 }], tool: 'hammer', skill: 'masonry', difficulty: 15, stepTime: 3,
    desc: 'A 2×2 m stone wall. The strongest wall you can build.' },
  { id: 'window_wall', role: 'wall', name: 'Windowed wall', icon: '🪟', category: 'Walls', snap: true,
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
defs.push({ id: 'slipway', name: 'Slipway', icon: '⚓', category: 'Boats', snap: false, reachesWater: { z: 22, depth: 1.6 }, slip: 26,
  // (A deck of sleepers the whole width of the ways: you walk out along it to work.)
  // (And a rail across its seaward end, so you don't walk off into the water.)
  boxes: [box(0, 0.2, 8, 2.3, 0.2, 14), box(0, 0.9, 21.9, 2.3, 0.5, 0.06)], snaps: [],
  materials: [{ item: 'log', count: 10 }, { item: 'plank', count: 10 }], tool: 'hatchet', skill: 'carpentry', difficulty: 12, stepTime: 5,
  desc: 'A shipyard\'s slip: a timber bed running down into the water, where ships up to 26 m long are built (aim at it to lay one down) and launched. Its far end must reach water at least 1.6 m deep.' });
// A great slipway: longer and heavier, its ways on stone footings, for the biggest ships (a carrack, a great galley).
defs.push({ id: 'great_slipway', name: 'Great slipway', icon: '⚓', category: 'Boats', snap: false, reachesWater: { z: 30, depth: 2.2 }, slip: 34,
  boxes: [box(0, 0.25, 12, 2.7, 0.25, 18), box(0, 1.0, 29.9, 2.7, 0.5, 0.06)], snaps: [],
  materials: [{ item: 'log', count: 16 }, { item: 'refined_plank', count: 12 }, { item: 'rock_shard', count: 20 }, { item: 'mortar', count: 6 }], tool: 'hatchet', skill: 'carpentry', difficulty: 18, stepTime: 6,
  desc: 'A great shipyard slip on stone footings, 36 m long, for ships up to 34 m: a carrack, a great galley. Its far end must reach water at least 2.2 m deep.' });
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


// ---------- more ways to build: floors, walls, doorways, roofs, stairs, fences (all snapping like the rest)
const HALF_WALL_SNAPS: V3[] = [[-1, 0, 0], [1, 0, 0], [-1, 1, 0], [1, 1, 0]];
const FLOOR_SNAPS: V3[] = [[-1, 0.2, -1], [1, 0.2, -1], [-1, 0.2, 1], [1, 0.2, 1]];
const RUN_SNAPS: V3[] = [[-1, 0, 0], [1, 0, 0]];
/** An open doorway in a wall: a jamb each side and a lintel, the gap 1.1 m wide and 1.9 m high. */
const doorwayBoxes = (t: number): Box[] => [box(-0.775, 1, 0, 0.225, 1, t), box(0.775, 1, 0, 0.225, 1, t), box(0, 1.95, 0, 0.55, 0.05, t)];
const R = (n: number) => ({ item: 'rock_shard', count: n }), M = (n: number) => ({ item: 'mortar', count: n });
const P = (n: number) => ({ item: 'plank', count: n }), S = (n: number) => ({ item: 'shaft', count: n });
defs.push(
  // --- foundations and floors
  { id: 'stone_floor', role: 'floor', name: 'Flagstone floor', icon: '⬛', category: 'Foundations', snap: true,
    boxes: [box(0, 0.1, 0, 1, 0.1, 1)], snaps: FLOOR_SNAPS,
    materials: [R(6), M(1)], tool: 'hammer', skill: 'masonry', difficulty: 8, stepTime: 2.5,
    desc: 'A 2×2 m floor of flat stones bedded in mortar. Snaps like a wooden floor; it won\'t rot or burn.' },
  { id: 'timber_platform', role: 'floor', name: 'Timber platform', icon: '🟫', category: 'Foundations', snap: true,
    boxes: [box(0, 0.9, 0, 1, 0.1, 1), ...[-0.85, 0.85].flatMap((x) => [box(x, 0.4, -0.85, 0.1, 0.4, 0.1), box(x, 0.4, 0.85, 0.1, 0.4, 0.1)])],
    snaps: [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]],
    materials: [{ item: 'log', count: 2 }, P(4)], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 3,
    desc: 'A plank floor up on four posts, 1 m off the ground: a cheap level base on a slope, or a porch, or a hut on stilts.' },

  // --- walls
  { id: 'wattle_wall', role: 'wall', name: 'Wattle and daub wall', icon: '🧺', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.1)], snaps: WALL_SNAPS,
    materials: [{ item: 'branch', count: 6 }, { item: 'clay', count: 3 }, { item: 'plant_fiber', count: 2 }], tool: 'hatchet', skill: 'carpentry', difficulty: 4, stepTime: 2.5,
    desc: 'Woven branches plastered with clay and straw on a frame of posts: the cheapest proper wall, the first house most people ever lived in.' },
  { id: 'timber_frame_wall', role: 'wall', name: 'Timber-framed wall', icon: '🏠', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.12)], snaps: WALL_SNAPS,
    materials: [P(3), S(2), { item: 'clay', count: 2 }, M(1)], tool: 'hammer', skill: 'carpentry', difficulty: 12, stepTime: 2.5,
    desc: 'A frame of dark oak beams and braces, the panels between them filled and limewashed: the black-and-white wall of a town house.' },
  { id: 'half_wall', role: 'wall', name: 'Plank half wall', icon: '🪵', category: 'Walls', snap: true,
    boxes: [box(0, 0.5, 0, 1, 0.5, 0.1)], snaps: HALF_WALL_SNAPS,
    materials: [P(2), S(1)], tool: 'hammer', skill: 'carpentry', difficulty: 5, stepTime: 2,
    desc: 'A plank wall 1 m high: a parapet, a counter, a stall, or the top of a wall that needs a little more.' },
  { id: 'stone_half_wall', role: 'wall', name: 'Stone half wall', icon: '🧱', category: 'Walls', snap: true,
    boxes: [box(0, 0.5, 0, 1, 0.5, 0.2)], snaps: HALF_WALL_SNAPS,
    materials: [R(5), M(2)], tool: 'hammer', skill: 'masonry', difficulty: 10, stepTime: 3,
    desc: 'A stone wall 1 m high: a parapet for a wall walk or a terrace.' },
  { id: 'stone_window_wall', role: 'wall', name: 'Stone windowed wall', icon: '🪟', category: 'Walls', snap: true,
    boxes: windowBoxes.map((b) => box(b.c[0], b.c[1], b.c[2], b.h[0], b.h[1], 0.2)), snaps: WALL_SNAPS,
    materials: [R(8), M(3), P(1)], tool: 'hammer', skill: 'masonry', difficulty: 16, stepTime: 3,
    desc: 'A 2×2 m stone wall with a window, a timber lintel over it.' },
  { id: 'palisade', role: 'wall', name: 'Palisade', icon: '🪵', category: 'Walls', snap: true,
    boxes: [box(0, 1.5, 0, 1, 1.5, 0.2)], snaps: [[-1, 0, 0], [1, 0, 0]],
    materials: [{ item: 'log', count: 5 }], tool: 'hatchet', skill: 'carpentry', difficulty: 8, stepTime: 4,
    desc: 'A row of logs set upright and sharpened, 3 m high: the first defence of a camp or a village.' },
  { id: 'stone_pillar', name: 'Stone pillar', icon: '🏛️', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 0.25, 1, 0.25)], snaps: [[0, 0, 0], [0, 2, 0]],
    materials: [R(6), M(2)], tool: 'hammer', skill: 'masonry', difficulty: 10, stepTime: 3,
    desc: 'A squared stone column 2 m tall, with a capital and a base. Stack them for a tall hall.' },
  { id: 'stone_arch', name: 'Stone arch', icon: '🌉', category: 'Walls', snap: true,
    boxes: [box(-0.85, 1, 0, 0.15, 1, 0.2), box(0.85, 1, 0, 0.15, 1, 0.2), box(0, 1.9, 0, 1, 0.1, 0.2)], snaps: WALL_SNAPS,
    materials: [R(8), M(3)], tool: 'hammer', skill: 'masonry', difficulty: 18, stepTime: 3,
    desc: 'A round stone arch spanning a 2 m bay: a cloister, an arcade, a gateway, a bridge.' },
  { id: 'chimney', name: 'Stone chimney', icon: '🏭', category: 'Walls', snap: true,
    boxes: [box(0, 1, 0, 0.4, 1, 0.4)], snaps: [[0, 0, 0], [0, 2, 0], [-0.4, 0, 0], [0.4, 0, 0]],
    materials: [R(8), M(3)], tool: 'hammer', skill: 'masonry', difficulty: 12, stepTime: 3,
    desc: 'A 2 m section of stone chimney stack. Stack them up through the roof.' },

  // --- doorways and doors
  { id: 'wood_doorway', role: 'wall', name: 'Plank doorway', icon: '🚪', category: 'Doors & fences', snap: true,
    boxes: doorwayBoxes(0.1), snaps: WALL_SNAPS,
    materials: [P(3), S(2)], tool: 'hammer', skill: 'carpentry', difficulty: 7, stepTime: 2.5,
    desc: 'A plank wall with an open doorway: between rooms, or onto a porch.' },
  { id: 'stone_doorway', role: 'wall', name: 'Stone doorway', icon: '🚪', category: 'Doors & fences', snap: true,
    boxes: doorwayBoxes(0.2), snaps: WALL_SNAPS,
    materials: [R(7), M(3)], tool: 'hammer', skill: 'masonry', difficulty: 14, stepTime: 3,
    desc: 'A stone wall with an open doorway under a round arch.' },
  { id: 'stone_door', role: 'wall', name: 'Stone wall with door', icon: '🚪', category: 'Doors & fences', snap: true,
    boxes: [box(0, 1, 0, 1, 1, 0.2)], openBoxes: [box(-0.75, 1, 0, 0.25, 1, 0.2), box(0.75, 1, 0, 0.25, 1, 0.2)], snaps: WALL_SNAPS,
    materials: [R(7), M(3), P(3), { item: 'iron_lump', count: 1 }], tool: 'hammer', skill: 'masonry', difficulty: 16, stepTime: 3,
    opens: true, desc: 'A stone wall with a heavy iron-strapped plank door you can open and close.' },
  { id: 'trapdoor', role: 'floor', name: 'Floor with trapdoor', icon: '🕳️', category: 'Doors & fences', snap: true,
    boxes: [box(0, 0.1, 0, 1, 0.1, 1)],
    openBoxes: [box(0, 0.1, -0.725, 1, 0.1, 0.275), box(0, 0.1, 0.725, 1, 0.1, 0.275), box(-0.725, 0.1, 0, 0.275, 0.1, 0.45), box(0.725, 0.1, 0, 0.275, 0.1, 0.45)],
    snaps: FLOOR_SNAPS,
    materials: [P(5), { item: 'cordage', count: 1 }], tool: 'hammer', skill: 'carpentry', difficulty: 10, stepTime: 2.5,
    opens: true, desc: 'A wooden floor with a hatch in it: open it and climb down a ladder to the cellar, or up to the loft.' },
  { id: 'railing', name: 'Railing', icon: '🚧', category: 'Doors & fences', snap: true,
    boxes: [box(0, 0.5, 0, 1, 0.5, 0.04)], snaps: RUN_SNAPS,
    materials: [P(1), S(3)], tool: 'hammer', skill: 'carpentry', difficulty: 5, stepTime: 2,
    desc: 'A light railing of turned balusters, for the edge of a balcony, a gallery or a jetty.' },
  { id: 'dry_stone_wall', name: 'Dry stone wall', icon: '🪨', category: 'Doors & fences', snap: true,
    boxes: [box(0, 0.5, 0, 1, 0.5, 0.3)], snaps: RUN_SNAPS,
    materials: [R(10)], tool: 'hammer', skill: 'masonry', difficulty: 5, stepTime: 2.5,
    desc: 'A field wall of stones laid without mortar: it lasts for centuries and keeps sheep in.' },
  { id: 'wattle_fence', name: 'Wattle fence', icon: '🧺', category: 'Doors & fences', snap: true,
    boxes: [box(0, 0.5, 0, 1, 0.5, 0.05)], snaps: RUN_SNAPS,
    materials: [{ item: 'branch', count: 6 }], tool: 'hatchet', skill: 'carpentry', difficulty: 2, stepTime: 1.5,
    desc: 'Branches woven between stakes: a quick fence for a garden or a pen.' },

  // --- roofs and stairs
  { id: 'shingle_roof', name: 'Shingle roof (45°)', icon: '🏠', category: 'Roofs & stairs', snap: true,
    boxes: roofBoxes, snaps: SLOPE_SNAPS,
    materials: [P(4), S(1)], tool: 'hammer', skill: 'carpentry', difficulty: 10, stepTime: 2,
    desc: 'A sloped 2×2 m roof covered in split oak shingles. Lasts longer than thatch.' },
  { id: 'slate_roof', name: 'Slate roof (45°)', icon: '🏚️', category: 'Roofs & stairs', snap: true,
    boxes: roofBoxes, snaps: SLOPE_SNAPS,
    materials: [P(3), R(8)], tool: 'hammer', skill: 'masonry', difficulty: 14, stepTime: 2.5,
    desc: 'A sloped 2×2 m roof of grey slates hung on battens: the roof of a church or a rich man\'s house.' },
  { id: 'stone_gable', name: 'Stone gable', icon: '📐', category: 'Roofs & stairs', snap: true,
    boxes: gableBoxes.map((b) => box(b.c[0], b.c[1], b.c[2], b.h[0], b.h[1], 0.2)), snaps: [[-1, 0, 0], [1, 0, 0], [1, 2, 0]],
    materials: [R(6), M(2)], tool: 'hammer', skill: 'masonry', difficulty: 12, stepTime: 3,
    desc: 'A stone triangle to close the end of a roof over stone walls.' },
  { id: 'stone_stairs', name: 'Stone stairs', icon: '🪜', category: 'Roofs & stairs', snap: true,
    boxes: stairBoxes, snaps: SLOPE_SNAPS,
    materials: [R(10), M(2)], tool: 'hammer', skill: 'masonry', difficulty: 14, stepTime: 3,
    desc: 'Solid stone steps that climb 2 m.' },
  { id: 'ladder', name: 'Ladder', icon: '🪜', category: 'Roofs & stairs', snap: false,
    boxes: [box(-0.23, 1.3, 0, 0.03, 1.3, 0.03), box(0.23, 1.3, 0, 0.03, 1.3, 0.03)], snaps: [],
    climb: box(0, 1.5, 0.3, 0.35, 1.8, 0.35),
    materials: [S(4), P(1)], tool: 'hammer', skill: 'carpentry', difficulty: 4, stepTime: 2,
    desc: 'A 2.6 m ladder. Stand it against a wall (Q/E to turn it, its back to the wall), and walk into it with W to climb, S to climb down.' },
);

// ---------- decor: things to make a place your own
defs.push(
  { id: 'brazier', name: 'Iron brazier', icon: '🔥', category: 'Decor', snap: false,
    boxes: [box(0, 0.5, 0, 0.3, 0.5, 0.3)], snaps: [],
    materials: [{ item: 'iron_lump', count: 2 }, R(2)], tool: 'hammer', skill: 'smithing', difficulty: 10, stepTime: 3,
    burns: true, glow: { strength: 0.9, height: 1.1 }, desc: 'An iron fire bowl on three legs: light for a hall or a courtyard. Feed it fuel and light it.' },
  { id: 'banner', name: 'Banner', icon: '🚩', category: 'Decor', snap: false,
    boxes: [box(0, 1.5, 0, 0.06, 1.5, 0.06)], snaps: [],
    materials: [S(2), { item: 'wool', count: 3 }, { item: 'cordage', count: 1 }], tool: 'knife', skill: 'carpentry', difficulty: 6, stepTime: 2,
    desc: 'A woollen banner on a pole: mark your hall, your gate or your camp.' },
  { id: 'woodpile', name: 'Woodpile', icon: '🪵', category: 'Decor', snap: false,
    boxes: [box(0, 0.5, 0, 0.9, 0.5, 0.4)], snaps: [],
    materials: [{ item: 'log', count: 2 }, { item: 'kindling', count: 6 }], tool: 'hatchet', skill: 'woodcutting', difficulty: 2, stepTime: 1.5,
    desc: 'Split logs stacked against the winter, under a little lean-to.' },
  { id: 'haystack', name: 'Haystack', icon: '🌾', category: 'Decor', snap: false,
    boxes: [box(0, 0.8, 0, 0.9, 0.8, 0.9)], snaps: [],
    materials: [{ item: 'plant_fiber', count: 16 }], skill: 'farming', difficulty: 2, stepTime: 1.5,
    desc: 'A stack of dried grass, thatched against the rain.' },
  { id: 'scarecrow', name: 'Scarecrow', icon: '🎃', category: 'Decor', snap: false,
    boxes: [box(0, 0.9, 0, 0.1, 0.9, 0.1)], snaps: [],
    materials: [S(2), { item: 'plant_fiber', count: 6 }, { item: 'wool', count: 1 }], skill: 'farming', difficulty: 3, stepTime: 2,
    desc: 'Old clothes stuffed with straw on a cross of sticks, to keep the birds off the wheat.' },
  { id: 'signpost', name: 'Signpost', icon: '🪧', category: 'Decor', snap: false,
    boxes: [box(0, 1, 0, 0.06, 1, 0.06)], snaps: [],
    materials: [S(1), P(2)], tool: 'hammer', skill: 'carpentry', difficulty: 3, stepTime: 2,
    desc: 'A post with pointing boards, for a crossroads or your gate.' },
  { id: 'animal_trough', name: 'Water trough', icon: '🪣', category: 'Decor', snap: false,
    boxes: [box(0, 0.25, 0, 0.8, 0.25, 0.3)], snaps: [],
    materials: [{ item: 'log', count: 1 }, P(2)], tool: 'hatchet', skill: 'carpentry', difficulty: 5, stepTime: 2.5,
    desc: 'A hollowed log trough for the animals in a pen.' },
  { id: 'planter', name: 'Raised garden bed', icon: '🌷', category: 'Decor', snap: false,
    boxes: [box(0, 0.2, 0, 0.9, 0.2, 0.45)], snaps: [],
    materials: [P(3), { item: 'dirt', count: 2 }, { item: 'sprout', count: 1 }], tool: 'hammer', skill: 'farming', difficulty: 4, stepTime: 2,
    desc: 'A plank box of earth, planted with flowers and herbs.' },
  { id: 'statue', name: 'Stone statue', icon: '🗿', category: 'Decor', snap: false,
    boxes: [box(0, 1.2, 0, 0.45, 1.2, 0.45)], snaps: [],
    materials: [R(24), M(2)], tool: 'hammer', skill: 'masonry', difficulty: 25, stepTime: 4,
    desc: 'A robed figure carved in stone on a plinth: a saint for a church door, a founder for a square.' },
  { id: 'fountain', name: 'Fountain', icon: '⛲', category: 'Decor', snap: false,
    boxes: [box(0, 0.3, 0, 1.3, 0.3, 1.3), box(0, 1.1, 0, 0.2, 0.8, 0.2)], snaps: [],
    materials: [R(30), M(6)], tool: 'hammer', skill: 'masonry', difficulty: 22, stepTime: 4,
    desc: 'A round stone basin with a carved spout: the heart of a town square.' },
);

// ---------- waterside: quays, jetties, moorings
// Built out into the water from the shore: each is set by the water's surface (its top a set height above
// it) and its footings run down to the bed (they can be built where it's up to about 4 m deep).
defs.push(
  { id: 'quay', role: 'floor', name: 'Stone quay', icon: '⚓', category: 'Waterside', snap: true, waterside: { top: 1.0 },
    boxes: [box(0, 2.5, 0, 1, 2.5, 1)],
    snaps: [[-1, 5, -1], [1, 5, -1], [-1, 5, 1], [1, 5, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]],
    materials: [R(16), M(4)], tool: 'hammer', skill: 'masonry', difficulty: 14, stepTime: 3,
    desc: 'A 2×2 m block of dressed stone built up from the bed, its top 1 m above the water: line them up along the shore for a harbour wall that ships can lie against. Floors and walls snap onto it.' },
  { id: 'quay_steps', name: 'Quay steps', icon: '🪜', category: 'Waterside', snap: true, waterside: { top: 1.0 },
    boxes: [box(0, 1.9, 0, 1, 1.9, 1), ...[0, 1, 2, 3].map((k) => { const top = 3.8 + 0.3 * (k + 1), z0 = 1 - 0.5 * (k + 1); return box(0, (3.8 + top) / 2, (z0 - 1) / 2, 1, (top - 3.8) / 2, (z0 + 1) / 2); })],
    snaps: [[-1, 5, -1], [1, 5, -1], [-1, 5, 1], [1, 5, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]],
    materials: [R(14), M(4)], tool: 'hammer', skill: 'masonry', difficulty: 16, stepTime: 3,
    desc: 'Stone steps from the top of a quay down to the water (on the side it faces): to a boat, or out of a swim.' },
  { id: 'breakwater', name: 'Rubble breakwater', icon: '🪨', category: 'Waterside', snap: true, waterside: { top: 0.6 },
    boxes: [box(0, 2.3, 0, 1, 2.3, 1)],
    snaps: [[-1, 4.6, -1], [1, 4.6, -1], [-1, 4.6, 1], [1, 4.6, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]],
    materials: [R(24)], tool: 'hammer', skill: 'masonry', difficulty: 6, stepTime: 2,
    desc: 'Rough stone heaped up from the bed: a cheap mole to break the waves and shelter a harbour. You can walk along its top.' },
  { id: 'jetty', role: 'floor', name: 'Timber jetty', icon: '🛶', category: 'Waterside', snap: true, waterside: { top: 0.8 },
    boxes: [box(0, 6.9, 0, 1, 0.1, 1), ...[-0.85, 0.85].flatMap((x) => [box(x, 3.4, -0.85, 0.1, 3.4, 0.1), box(x, 3.4, 0.85, 0.1, 3.4, 0.1)])],
    snaps: [[-1, 7, -1], [1, 7, -1], [-1, 7, 1], [1, 7, 1]],
    materials: [{ item: 'log', count: 2 }, P(6)], tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 3,
    desc: 'A 2×2 m plank deck on four piles driven into the bed, 0.8 m above the water: run them out from the shore for a landing stage.' },
  { id: 'jetty_ladder', role: 'floor', name: 'Jetty end with ladder', icon: '🪜', category: 'Waterside', snap: true, waterside: { top: 0.8 },
    boxes: [box(0, 6.9, 0, 1, 0.1, 1), ...[-0.85, 0.85].flatMap((x) => [box(x, 3.4, -0.85, 0.1, 3.4, 0.1), box(x, 3.4, 0.85, 0.1, 3.4, 0.1)])],
    // (The ladder's rails are drawn but not solid: you climb up between them and step off onto the deck.)
    climb: box(0, 6.1, 1.4, 0.4, 1.6, 0.4),
    snaps: [[-1, 7, -1], [1, 7, -1], [-1, 7, 1], [1, 7, 1]],
    materials: [{ item: 'log', count: 2 }, P(6), S(4)], tool: 'hammer', skill: 'carpentry', difficulty: 9, stepTime: 3,
    desc: 'A jetty deck with a ladder down into the water off its end: climb up out of the water, or down to a boat.' },
  { id: 'mooring_post', name: 'Mooring post', icon: '🪝', category: 'Waterside', snap: false, mooring: true,
    boxes: [box(0, 0.45, 0, 0.14, 0.45, 0.14)], snaps: [],
    materials: [{ item: 'log', count: 1 }, { item: 'cordage', count: 2 }], tool: 'hatchet', skill: 'carpentry', difficulty: 3, stepTime: 2,
    desc: 'A stout post to make a boat fast to. Leave a ship\'s helm near one and her crew make her fast: she stays put.' },
  { id: 'bollard', name: 'Stone bollard', icon: '🪝', category: 'Waterside', snap: false, mooring: true,
    boxes: [box(0, 0.35, 0, 0.2, 0.35, 0.2)], snaps: [],
    materials: [R(6), M(1), { item: 'iron_lump', count: 1 }], tool: 'hammer', skill: 'masonry', difficulty: 8, stepTime: 2.5,
    desc: 'A squat stone bollard with an iron ring, for the edge of a quay. Leave a ship\'s helm near one and she\'s moored.' },
  { id: 'harbour_beacon', name: 'Harbour beacon', icon: '🗼', category: 'Waterside', snap: false,
    boxes: [box(0, 1.6, 0, 0.5, 1.6, 0.5)], snaps: [],
    materials: [R(20), M(4), { item: 'iron_lump', count: 2 }], tool: 'hammer', skill: 'masonry', difficulty: 16, stepTime: 3,
    burns: true, glow: { strength: 2.2, height: 3.7 }, desc: 'A stone tower with an iron fire basket on top: lit at night, it guides ships home. Feed it fuel and light it.' },
  { id: 'harbour_crane', name: 'Treadwheel crane', icon: '🏗️', category: 'Waterside', snap: false,
    boxes: [box(0, 1.6, 0, 1.2, 1.6, 1.0), box(0, 4.2, 1.8, 0.2, 0.2, 2.0)], snaps: [],
    materials: [{ item: 'log', count: 6 }, { item: 'refined_plank', count: 10 }, S(6), { item: 'cordage', count: 8 }, { item: 'iron_lump', count: 2 }], tool: 'hammer', skill: 'carpentry', difficulty: 22, stepTime: 4,
    desc: 'A great wooden wheel men walk inside to wind the rope, and a jib out over the water: the harbour crane that loads the ships.' },
  { id: 'net_rack', name: 'Net drying rack', icon: '🎣', category: 'Waterside', snap: false,
    boxes: [box(0, 0.9, 0, 1.1, 0.9, 0.08)], snaps: [],
    materials: [S(4), { item: 'cordage', count: 6 }], tool: 'knife', skill: 'ropemaking', difficulty: 5, stepTime: 2,
    desc: 'Poles with fishing nets hung to dry: every fishing village has them along the shore.' },
);

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
