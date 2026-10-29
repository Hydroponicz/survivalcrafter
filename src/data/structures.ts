import type { ToolKind } from './items';
import type { StationKind } from './recipes';
import type { SkillId } from './skills';

export interface StructureDef {
  id: string;
  name: string;
  icon: string;
  /** 'tile' sits on a tile centre; 'edge' runs along a tile border (walls, fences). */
  placement: 'tile' | 'edge';
  materials: { item: string; count: number }[];
  tool?: ToolKind;
  skill: SkillId;
  difficulty: number;
  /** Seconds per building step (one material item per step). */
  stepTime: number;
  /** Max corner height difference (decimetres) allowed on the tile/edge. */
  maxSlope: number;
  station?: StationKind;
  burns?: boolean; // accepts fuel and can be lit
  container?: number; // storage capacity in kg
  gate?: boolean;
  bed?: boolean;
  desc: string;
}

const defs: StructureDef[] = [
  { id: 'campfire', name: 'Campfire', icon: '🔥', placement: 'tile', skill: 'firemaking', difficulty: 2, stepTime: 2, maxSlope: 12,
    materials: [{ item: 'rock_shard', count: 4 }, { item: 'branch', count: 3 }], station: 'fire', burns: true,
    desc: 'Cook food and fire pottery. Needs fuel and must be lit.' },
  { id: 'forge', name: 'Forge', icon: '🏭', placement: 'tile', skill: 'masonry', difficulty: 10, stepTime: 3, maxSlope: 6,
    materials: [{ item: 'rock_shard', count: 16 }, { item: 'clay', count: 8 }], station: 'forge', burns: true,
    desc: 'Smelts ore and heats metal for smithing. Also works as a fire.' },
  { id: 'anvil', name: 'Stone anvil', icon: '⚒️', placement: 'tile', tool: 'hammer', skill: 'masonry', difficulty: 8, stepTime: 3, maxSlope: 6,
    materials: [{ item: 'rock_shard', count: 12 }], station: 'anvil', desc: 'A heavy block of shaped stone to hammer metal on.' },
  { id: 'quern', name: 'Quern', icon: '⚙️', placement: 'tile', tool: 'hammer', skill: 'masonry', difficulty: 8, stepTime: 3, maxSlope: 6,
    materials: [{ item: 'rock_shard', count: 10 }, { item: 'shaft', count: 1 }], station: 'quern', desc: 'Grinds grain into flour.' },
  { id: 'workbench', name: 'Workbench', icon: '🪑', placement: 'tile', tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 3, maxSlope: 6,
    materials: [{ item: 'plank', count: 6 }, { item: 'shaft', count: 4 }], station: 'workbench', desc: 'A sturdy table for fine work.' },
  { id: 'chest', name: 'Storage chest', icon: '📦', placement: 'tile', tool: 'hammer', skill: 'carpentry', difficulty: 10, stepTime: 3, maxSlope: 8,
    materials: [{ item: 'plank', count: 8 }], container: 300, desc: 'Holds up to 300 kg of items.' },
  { id: 'bed', name: 'Bed', icon: '🛏️', placement: 'tile', tool: 'hammer', skill: 'carpentry', difficulty: 12, stepTime: 3, maxSlope: 5,
    materials: [{ item: 'plank', count: 6 }, { item: 'hide', count: 2 }], bed: true, desc: 'Sleep to set your respawn point.' },
  { id: 'floor', name: 'Wooden floor', icon: '🟫', placement: 'tile', tool: 'hammer', skill: 'carpentry', difficulty: 6, stepTime: 2, maxSlope: 3,
    materials: [{ item: 'plank', count: 6 }], desc: 'A flat plank floor. Needs flat ground.' },
  { id: 'fence', name: 'Wooden fence', icon: '🚧', placement: 'edge', tool: 'hammer', skill: 'carpentry', difficulty: 4, stepTime: 2, maxSlope: 20,
    materials: [{ item: 'plank', count: 3 }, { item: 'shaft', count: 2 }], desc: 'Keeps animals in (or out).' },
  { id: 'gate', name: 'Wooden gate', icon: '🚪', placement: 'edge', tool: 'hammer', skill: 'carpentry', difficulty: 8, stepTime: 2, maxSlope: 10,
    materials: [{ item: 'plank', count: 4 }, { item: 'shaft', count: 2 }, { item: 'cordage', count: 1 }], gate: true,
    desc: 'A fence segment that opens.' },
  { id: 'log_wall', name: 'Log wall', icon: '🧱', placement: 'edge', tool: 'hatchet', skill: 'carpentry', difficulty: 10, stepTime: 4, maxSlope: 5,
    materials: [{ item: 'log', count: 5 }], desc: 'A sturdy cabin wall. Needs nearly flat ground.' },
  { id: 'stone_wall', name: 'Stone wall', icon: '🏰', placement: 'edge', tool: 'hammer', skill: 'masonry', difficulty: 15, stepTime: 3, maxSlope: 5,
    materials: [{ item: 'rock_shard', count: 12 }, { item: 'mortar', count: 4 }], desc: 'The strongest wall you can build.' },
];

export const STRUCTURES: Record<string, StructureDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const STRUCTURE_LIST = defs;

export function totalMaterials(def: StructureDef): number {
  return def.materials.reduce((s, m) => s + m.count, 0);
}
