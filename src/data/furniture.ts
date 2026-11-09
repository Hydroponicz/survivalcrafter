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
const I = (n: number) => ({ item: 'iron_lump', count: n }), H = (n: number) => ({ item: 'hide', count: n });
const C = (n: number) => ({ item: 'cordage', count: n }), W = (n: number) => ({ item: 'wool', count: n }), F = (n: number) => ({ item: 'plant_fiber', count: n });

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

  // --- more seats
  { id: 'footstool', name: 'Footstool', icon: '🪑', weight: 3, comfort: 1, difficulty: 8, time: 8,
    inputs: [R(1), H(1), F(3)], box: [0, 0.17, 0, 0.22, 0.17, 0.17],
    desc: 'A low padded stool to put your feet up on.' },
  { id: 'pew', name: 'Pew', icon: '⛪', weight: 22, comfort: 1, difficulty: 14, time: 18,
    inputs: [R(7)], box: [0, 0.45, 0, 1.0, 0.45, 0.25],
    desc: 'A long high-backed bench, as in a church or a great hall.' },
  { id: 'throne', name: 'Lord\'s high seat', icon: '👑', weight: 35, comfort: 3, difficulty: 26, time: 34,
    inputs: [R(10), H(2), I(1), W(2)], box: [0, 0.8, 0, 0.45, 0.8, 0.4],
    desc: 'A great carved chair with a tall back and a red wool cushion: the seat at the head of the hall.' },
  // --- more tables
  { id: 'round_table', name: 'Round table', icon: '🪵', weight: 14, comfort: 1, difficulty: 15, time: 16,
    inputs: [R(5), S(1)], box: [0, 0.38, 0, 0.55, 0.38, 0.55],
    desc: 'A round table on a single turned pedestal.' },
  { id: 'trestle_table', name: 'Trestle table', icon: '🪵', weight: 18, comfort: 1, difficulty: 10, time: 12,
    inputs: [R(5), S(2)], box: [0, 0.38, 0, 1.0, 0.38, 0.4],
    desc: 'A long board on two trestles: the everyday table of a medieval hall, taken down after the meal.' },
  { id: 'map_table', name: 'Map table', icon: '🗺️', weight: 22, comfort: 2, difficulty: 20, time: 22,
    inputs: [R(7), S(2), H(1)], box: [0, 0.45, 0, 0.75, 0.45, 0.5],
    desc: 'A broad table with a map of the coast painted on hide and stones to hold it down: plan your voyages here.' },
  { id: 'chess_table', name: 'Game table', icon: '♟️', weight: 8, comfort: 2, difficulty: 18, time: 18,
    inputs: [R(4), S(2)], box: [0, 0.38, 0, 0.35, 0.38, 0.35],
    desc: 'A small table with a chequered board inlaid in its top, and the pieces set out.' },
  { id: 'lectern', name: 'Lectern', icon: '📖', weight: 10, comfort: 1, difficulty: 14, time: 14,
    inputs: [R(3), S(1), H(1)], box: [0, 0.6, 0, 0.25, 0.6, 0.25],
    desc: 'A slanted reading stand with a great book open on it.' },
  // --- beds
  { id: 'straw_bed', name: 'Straw pallet', icon: '🛏️', weight: 6, comfort: 0, difficulty: 4, time: 8, bed: true,
    inputs: [R(1), F(16), H(1)], box: [0, 0.12, 0, 0.45, 0.12, 0.95],
    desc: 'A sack of straw on a low frame: a bed, if not a comfortable one.' },
  { id: 'bunk_bed', name: 'Bunk bed', icon: '🛏️', weight: 40, comfort: 1, difficulty: 18, time: 26, bed: true,
    inputs: [R(10), S(4), F(16), H(2)], box: [0, 0.85, 0, 0.5, 0.85, 0.95],
    desc: 'Two beds, one above the other, and a ladder up: for a crew, a barracks or a crowded house.' },
  { id: 'cradle', name: 'Cradle', icon: '👶', weight: 7, comfort: 2, difficulty: 14, time: 14,
    inputs: [R(4), S(2), W(1)], box: [0, 0.3, 0, 0.25, 0.3, 0.45],
    desc: 'A little wooden cradle on rockers, with a wool blanket.' },
  // --- storage
  { id: 'wardrobe', name: 'Wardrobe', icon: '🚪', weight: 40, comfort: 2, difficulty: 20, time: 26,
    inputs: [R(10), S(2), I(1)], box: [0, 1, 0, 0.6, 1, 0.32], container: 150,
    desc: 'A tall press with two doors and iron hinges. Stores up to 150 kg.' },
  { id: 'crate', name: 'Crate', icon: '📦', weight: 8, comfort: 0, difficulty: 8, time: 8,
    inputs: [R(4)], box: [0, 0.3, 0, 0.35, 0.3, 0.35], container: 80,
    desc: 'A nailed plank crate. Stores up to 80 kg, and stacks well in a hold or a warehouse.' },
  { id: 'wine_rack', name: 'Wine rack', icon: '🍷', weight: 14, comfort: 1, difficulty: 14, time: 16,
    inputs: [R(6), { item: 'clay_jar', count: 3 }], box: [0, 0.75, 0, 0.55, 0.75, 0.2], container: 60,
    desc: 'A rack of pigeonholes holding stoppered jars of wine. Stores up to 60 kg.' },
  { id: 'wall_shelf', name: 'Wall shelf', icon: '🏺', weight: 4, comfort: 1, difficulty: 8, time: 8,
    inputs: [R(2), { item: 'clay_jar', count: 2 }], box: [0, 1.4, 0, 0.5, 0.2, 0.12],
    desc: 'A short shelf on brackets, set against a wall, with a few jars on it.' },
  // --- the household
  { id: 'washstand', name: 'Washstand', icon: '🫗', weight: 8, comfort: 1, difficulty: 12, time: 12,
    inputs: [R(3), { item: 'clay_jar', count: 1 }], box: [0, 0.45, 0, 0.3, 0.45, 0.25],
    desc: 'A little stand with a clay basin and a ewer of water.' },
  { id: 'bathtub', name: 'Bathtub', icon: '🛁', weight: 30, comfort: 2, difficulty: 18, time: 22,
    inputs: [R(8), I(2)], box: [0, 0.3, 0, 0.4, 0.3, 0.75],
    desc: 'A big iron-hooped wooden tub. A hot bath is a luxury.' },
  { id: 'cauldron', name: 'Cauldron', icon: '🍲', weight: 25, comfort: 1, difficulty: 18, time: 18,
    inputs: [I(4), S(1)], box: [0, 0.3, 0, 0.35, 0.3, 0.35],
    desc: 'A great iron pot on three legs, for the kitchen corner.' },
  { id: 'butter_churn', name: 'Butter churn', icon: '🧈', weight: 9, comfort: 1, difficulty: 12, time: 12,
    inputs: [R(4), S(1), I(1)], box: [0, 0.45, 0, 0.2, 0.45, 0.2],
    desc: 'A tall hooped churn with its plunger.' },
  { id: 'loom', name: 'Loom', icon: '🧶', weight: 30, comfort: 2, difficulty: 22, time: 26,
    inputs: [R(8), S(4), C(4), W(3)], box: [0, 0.8, 0, 0.65, 0.8, 0.4],
    desc: 'An upright warp-weighted loom with a half-woven cloth on it.' },
  { id: 'coat_rack', name: 'Coat stand', icon: '🧥', weight: 4, comfort: 1, difficulty: 8, time: 8,
    inputs: [S(3), H(1)], box: [0, 0.9, 0, 0.25, 0.9, 0.25],
    desc: 'A turned post with pegs, a cloak and a hat on it.' },
  // --- the hall
  { id: 'weapon_rack', name: 'Weapon rack', icon: '⚔️', weight: 12, comfort: 1, difficulty: 14, time: 14,
    inputs: [R(3), S(4), I(1)], box: [0, 0.8, 0, 0.6, 0.8, 0.15],
    desc: 'A rack of spears and a sword, ready by the door.' },
  { id: 'armor_stand', name: 'Armour stand', icon: '🛡️', weight: 10, comfort: 1, difficulty: 14, time: 14,
    inputs: [R(2), S(3), H(2), I(1)], box: [0, 0.9, 0, 0.3, 0.9, 0.2],
    desc: 'A wooden stand with a leather jerkin, a helm and a round shield.' },
  { id: 'tapestry', name: 'Tapestry', icon: '🖼️', weight: 6, comfort: 2, difficulty: 16, time: 20,
    inputs: [W(8), S(1), C(1)], box: [0, 1.4, 0, 0.7, 0.9, 0.04],
    desc: 'A woven wall hanging of a hunting scene. Set it against a wall: it keeps a room warm and fine.' },
  { id: 'flower_box', name: 'Window box', icon: '🌸', weight: 5, comfort: 1, difficulty: 6, time: 8,
    inputs: [R(2), { item: 'dirt', count: 1 }, { item: 'sprout', count: 1 }], box: [0, 0.12, 0, 0.4, 0.12, 0.12],
    desc: 'A little box of flowers, for a sill, a table or a doorstep.' },

  // --- the study and the workshop
  { id: 'bookcase', name: 'Full bookcase', icon: '📚', weight: 30, comfort: 2, difficulty: 18, time: 22,
    inputs: [R(6), H(2), W(1)], box: [0, 0.95, 0, 0.6, 0.95, 0.2],
    desc: 'A tall case of shelves crowded with leather-bound books and scrolls.' },
  { id: 'alchemy_table', name: 'Alchemist\'s bench', icon: '⚗️', weight: 20, comfort: 2, difficulty: 22, time: 24,
    inputs: [R(5), { item: 'clay_jar', count: 3 }, I(1)], box: [0, 0.45, 0, 0.7, 0.45, 0.35],
    desc: 'A bench crowded with an alembic over a little burner, jars, a mortar and pestle.' },
  { id: 'armillary', name: 'Armillary sphere', icon: '🌐', weight: 6, comfort: 2, difficulty: 24, time: 24,
    inputs: [I(3), R(1)], box: [0, 0.4, 0, 0.22, 0.4, 0.22],
    desc: 'Brass rings of the heavens round a little earth, on a turned stand: the scholar\'s pride.' },
  { id: 'potters_wheel', name: 'Potter\'s wheel', icon: '🏺', weight: 18, comfort: 1, difficulty: 14, time: 16,
    inputs: [R(4), R(1), { item: 'clay', count: 2 }], box: [0, 0.4, 0, 0.45, 0.4, 0.45],
    desc: 'A kick wheel and a seat, a pot half thrown on it.' },
  { id: 'grindstone', name: 'Grindstone', icon: '⚙️', weight: 30, comfort: 1, difficulty: 12, time: 14,
    inputs: [{ item: 'rock_shard', count: 6 }, R(3), S(1)], box: [0, 0.45, 0, 0.45, 0.45, 0.25],
    desc: 'A round whetstone on a frame with a crank, for putting an edge on tools.' },
  { id: 'sawhorse', name: 'Sawhorse', icon: '🪚', weight: 6, comfort: 0, difficulty: 6, time: 6,
    inputs: [R(2), S(2)], box: [0, 0.35, 0, 0.5, 0.35, 0.25],
    desc: 'A trestle to hold planks for sawing, with a plank half cut on it.' },
  { id: 'work_table', name: 'Carpenter\'s table', icon: '🔨', weight: 25, comfort: 1, difficulty: 14, time: 16,
    inputs: [R(6), S(2), I(1)], box: [0, 0.45, 0, 0.8, 0.45, 0.35],
    desc: 'A heavy table with a vice, shavings, and tools laid out: a mallet, chisels, a plane.' },
  // --- the kitchen
  { id: 'pantry_shelf', name: 'Pantry shelves', icon: '🥫', weight: 15, comfort: 1, difficulty: 12, time: 14,
    inputs: [R(4), { item: 'clay_jar', count: 3 }], box: [0, 0.8, 0, 0.55, 0.8, 0.2], container: 80,
    desc: 'Shelves of crocks, cheeses, a ham and strings of onions. Stores up to 80 kg.' },
  { id: 'pot_rack', name: 'Pot rack', icon: '🍳', weight: 10, comfort: 1, difficulty: 12, time: 12,
    inputs: [R(2), I(3)], box: [0, 1.3, 0, 0.6, 0.3, 0.1],
    desc: 'A rail on the wall hung with iron pots, a pan and a ladle.' },
  { id: 'herb_rack', name: 'Hanging herbs', icon: '🌿', weight: 2, comfort: 1, difficulty: 4, time: 6,
    inputs: [S(1), C(1), { item: 'yarrow', count: 1 }, { item: 'mint', count: 1 }], box: [0, 1.5, 0, 0.5, 0.25, 0.08],
    desc: 'Bunches of herbs hung upside down from a pole to dry.' },
  { id: 'keg', name: 'Ale keg', icon: '🍺', weight: 14, comfort: 1, difficulty: 14, time: 14,
    inputs: [R(4), I(1)], box: [0, 0.3, 0, 0.35, 0.3, 0.3], container: 40,
    desc: 'A small barrel on its side in a cradle, with a tap. Stores up to 40 kg.' },
  { id: 'sack_pile', name: 'Sacks of grain', icon: '🌾', weight: 6, comfort: 0, difficulty: 4, time: 6,
    inputs: [F(8), C(1)], box: [0, 0.3, 0, 0.5, 0.3, 0.4], container: 100,
    desc: 'A heap of stuffed sacks. Stores up to 100 kg.' },
  // --- the bedroom
  { id: 'nightstand', name: 'Nightstand', icon: '🕯️', weight: 6, comfort: 1, difficulty: 10, time: 10,
    inputs: [R(3)], box: [0, 0.3, 0, 0.22, 0.3, 0.2], container: 15,
    desc: 'A little cupboard by the bed, a candle and a cup on it.' },
  { id: 'clothes_chest', name: 'Clothes chest', icon: '🧰', weight: 18, comfort: 1, difficulty: 14, time: 14,
    inputs: [R(5), I(1)], box: [0, 0.25, 0, 0.5, 0.25, 0.25], container: 120,
    desc: 'A low iron-banded chest for the foot of a bed. Stores up to 120 kg.' },
  { id: 'wool_rug', name: 'Woollen rug', icon: '🟥', weight: 4, comfort: 2, difficulty: 10, time: 14,
    inputs: [W(6)], box: [0, 0.01, 0, 0.9, 0.01, 0.6],
    desc: 'A woven rug in red and ochre with a patterned border.' },
  { id: 'mirror', name: 'Standing mirror', icon: '🪞', weight: 10, comfort: 2, difficulty: 20, time: 20,
    inputs: [R(3), I(3)], box: [0, 0.85, 0, 0.3, 0.85, 0.2],
    desc: 'A polished bronze mirror in a tall frame that tilts.' },
  // --- music
  { id: 'instruments', name: 'Lute and drum', icon: '🪕', weight: 5, comfort: 2, difficulty: 18, time: 18,
    inputs: [R(2), H(1), C(1)], box: [0, 0.35, 0, 0.35, 0.35, 0.25],
    desc: 'A lute leaning on a stand and a tabor drum: music for the hall.' },
  { id: 'harp', name: 'Harp', icon: '🎵', weight: 8, comfort: 2, difficulty: 22, time: 22,
    inputs: [R(3), C(2), I(1)], box: [0, 0.7, 0, 0.3, 0.7, 0.15],
    desc: 'A tall wooden harp with a carved pillar.' },
  // --- the chapel
  { id: 'altar', name: 'Altar', icon: '⛪', weight: 40, comfort: 2, difficulty: 18, time: 20,
    inputs: [R(4), W(3), I(1)], box: [0, 0.5, 0, 0.8, 0.5, 0.35],
    desc: 'An altar under a white cloth, with a cross and two candlesticks.' },
  { id: 'font', name: 'Stone font', icon: '⛲', weight: 60, comfort: 1, difficulty: 16, time: 18,
    inputs: [{ item: 'rock_shard', count: 10 }, { item: 'mortar', count: 1 }], box: [0, 0.5, 0, 0.35, 0.5, 0.35],
    desc: 'A carved stone basin on a pillar, for christenings.' },
];
