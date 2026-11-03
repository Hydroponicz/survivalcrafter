// Fine furniture: made at a workbench (mostly from sawn, refined planks),
// carried as an item and set down where you like (and picked back up).
// Pieces with comfort make a room a better place to sleep: a bed with fine
// furniture around it lets you wake rested. Each entry here makes its item,
// its workbench recipe and the piece placed in the world.

export interface FurnitureDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Carried weight (kg). */
  weight: number;
  comfort: number;
  inputs: { item: string; count: number }[];
  difficulty: number;
  /** Seconds of work at skill 1. */
  time: number;
  /** Its bulk for bumping into: centre and half-sizes (x, y, z), metres. */
  box: [number, number, number, number, number, number];
  /** Holds things (kg). */
  container?: number;
  /** A bed: sleep in it. */
  bed?: boolean;
}

const R = (n: number) => ({ item: 'refined_plank', count: n });
const S = (n: number) => ({ item: 'shaft', count: n });

export const FURNITURE: FurnitureDef[] = [
  // --- seats
  { id: 'stool', name: 'Three-legged stool', icon: '🪑', weight: 3, comfort: 1, difficulty: 10, time: 10,
    inputs: [R(2), S(3)], box: [0, 0.23, 0, 0.2, 0.23, 0.2],
    desc: 'A simple three-legged stool.' },
  { id: 'chair', name: 'Chair', icon: '🪑', weight: 5, comfort: 1, difficulty: 12, time: 12,
    inputs: [R(3), S(2)], box: [0, 0.48, 0, 0.24, 0.48, 0.24],
    desc: 'A wooden chair with a slatted back.' },
  { id: 'bench', name: 'Bench', icon: '🪑', weight: 8, comfort: 1, difficulty: 11, time: 12,
    inputs: [R(4), S(2)], box: [0, 0.23, 0, 0.75, 0.23, 0.18],
    desc: 'A long bench that seats two.' },
  { id: 'rocking_chair', name: 'Rocking chair', icon: '🪑', weight: 9, comfort: 2, difficulty: 18, time: 20,
    inputs: [R(6), S(4), { item: 'cordage', count: 1 }], box: [0, 0.55, 0, 0.3, 0.55, 0.45],
    desc: 'A classic wooden rocking chair, perfect for a spot by the fire.' },
  { id: 'armchair', name: 'Hide armchair', icon: '🛋️', weight: 14, comfort: 3, difficulty: 20, time: 22,
    inputs: [R(5), { item: 'hide', count: 2 }, { item: 'plant_fiber', count: 6 }], box: [0, 0.48, 0, 0.42, 0.48, 0.4],
    desc: 'A deep, comfy armchair padded with grass and covered in hide.' },
  // --- tables and desks
  { id: 'side_table', name: 'Side table', icon: '🪵', weight: 5, comfort: 1, difficulty: 11, time: 10,
    inputs: [R(3), S(1)], box: [0, 0.3, 0, 0.25, 0.3, 0.25],
    desc: 'A small table for beside a bed or chair.' },
  { id: 'table', name: 'Kitchen table', icon: '🪵', weight: 15, comfort: 1, difficulty: 14, time: 16,
    inputs: [R(6), S(4)], box: [0, 0.4, 0, 0.7, 0.4, 0.45],
    desc: 'A sturdy square table for working and eating.' },
  { id: 'dining_table', name: 'Long dining table', icon: '🪵', weight: 28, comfort: 2, difficulty: 18, time: 24,
    inputs: [R(10), S(6)], box: [0, 0.4, 0, 1.15, 0.4, 0.5],
    desc: 'A long dining table that seats six.' },
  { id: 'writing_desk', name: 'Writing desk', icon: '🪵', weight: 20, comfort: 2, difficulty: 20, time: 22,
    inputs: [R(7), S(2), { item: 'iron_lump', count: 1 }], box: [0, 0.45, 0, 0.6, 0.45, 0.35],
    desc: 'A writing desk with a sloped top and little cubbyholes.' },
  // --- storage and shelves
  { id: 'shelf', name: 'Bookshelf', icon: '📚', weight: 12, comfort: 1, difficulty: 13, time: 14,
    inputs: [R(4), S(2)], box: [0, 0.75, 0, 0.6, 0.75, 0.16],
    desc: 'Open shelves for jars, tools and keepsakes.' },
  { id: 'cupboard', name: 'Cupboard', icon: '🗄️', weight: 25, comfort: 2, difficulty: 16, time: 20,
    inputs: [R(8), S(2), { item: 'cordage', count: 1 }], box: [0, 0.9, 0, 0.55, 0.9, 0.28], container: 100,
    desc: 'A tall cupboard with two doors. Stores up to 100 kg.' },
  { id: 'dresser', name: 'Chest of drawers', icon: '🗄️', weight: 30, comfort: 2, difficulty: 19, time: 22,
    inputs: [R(8), { item: 'iron_lump', count: 1 }], box: [0, 0.45, 0, 0.55, 0.45, 0.25], container: 120,
    desc: 'A chest of four deep drawers. Stores up to 120 kg.' },
  { id: 'barrel', name: 'Barrel', icon: '🛢️', weight: 12, comfort: 0, difficulty: 16, time: 18,
    inputs: [R(6), { item: 'iron_lump', count: 1 }], box: [0, 0.42, 0, 0.3, 0.42, 0.3], container: 150,
    desc: 'A wooden barrel with iron hoops. Stores up to 150 kg.' },
  { id: 'tool_rack', name: 'Tool rack', icon: '🪓', weight: 6, comfort: 1, difficulty: 10, time: 10,
    inputs: [R(3), S(3)], box: [0, 0.75, 0, 0.6, 0.75, 0.1],
    desc: 'A rack of pegs to hang your tools on.' },
  // --- comforts
  { id: 'hide_rug', name: 'Hide rug', icon: '🟫', weight: 4, comfort: 1, difficulty: 8, time: 10,
    inputs: [{ item: 'hide', count: 3 }, { item: 'cordage', count: 2 }], box: [0, 0.01, 0, 0.9, 0.01, 0.6],
    desc: 'A soft rug made from stitched hides.' },
  { id: 'potted_plant', name: 'Potted plant', icon: '🪴', weight: 4, comfort: 1, difficulty: 6, time: 8,
    inputs: [{ item: 'clay_jar', count: 1 }, { item: 'dirt', count: 1 }, { item: 'sprout', count: 1 }], box: [0, 0.35, 0, 0.16, 0.35, 0.16],
    desc: 'A young tree in a clay pot. Brings some green indoors.' },
  { id: 'spinning_wheel', name: 'Spinning wheel', icon: '🧶', weight: 10, comfort: 2, difficulty: 22, time: 24,
    inputs: [R(7), S(4), { item: 'cordage', count: 2 }], box: [0, 0.5, 0, 0.5, 0.5, 0.25],
    desc: 'A large wooden spinning wheel. A classic piece for any homestead.' },
  { id: 'fine_bed', name: 'Four-poster bed', icon: '🛏️', weight: 45, comfort: 3, difficulty: 24, time: 30, bed: true,
    inputs: [R(12), S(4), { item: 'hide', count: 3 }, { item: 'plant_fiber', count: 12 }], box: [0, 0.3, 0, 0.6, 0.3, 1.05],
    desc: 'A four-poster bed with a thick mattress. Sleep in it, and it counts as comfort 3 on its own.' },
];
