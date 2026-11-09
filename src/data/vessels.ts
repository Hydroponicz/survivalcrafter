// Vessels: everything you load and move about the world that isn't an
// animal. Carts on land, boats on the water, and in time the great ships
// built on a shipyard's slip, all in one table, so a new one is a row here
// (and a model in view.ts), and it is loaded, saved, aimed at, dragged,
// boarded, steered, damaged and repaired by the same code as the rest.
//
// In the world each one is a `CartObj` (world.ts: its place, heading, load,
// quality and wear); this table says what that kind of vessel can do.

/** The kinds of vessel. */
export type VesselId = 'hand_cart' | 'ox_cart' | 'dugout' | 'log_raft' | 'reed_boat' | 'coracle' | 'skin_boat' | 'rowboat';

/** How a boat is driven through the water. */
export interface WaterDrive {
  /** Paddled (kneeling, a paddle), poled (standing, a pole pushed off the bottom), or rowed (a pair of oars). */
  by: 'paddle' | 'pole' | 'oars';
  /** Top speed (m/s) with the right gear, and how fast it turns (rad/s, with way on). */
  speed: number;
  turn: number;
  /** The gear for full speed (item, how many); without it you scoop with your hands (slowly). */
  needs: [string, number];
  /** A pole only reaches the bottom this deep (m); out deeper you can barely push it along. */
  maxDepth?: number;
}

/** How a vessel moves under you (or in front of you). */
export interface VesselMove {
  /** Pushed or dragged by hand: your walking speed while you do (× normal). */
  push?: number;
  /** Hitched to a tamed ox, which you lead. */
  hitch?: boolean;
  /** Driven through the water from aboard it. */
  water?: WaterDrive;
}

export interface VesselDef {
  id: VesselId;
  name: string;
  /** Where it goes: on land (on wheels), or on the water (it floats). */
  medium: 'land' | 'water';
  /** What it holds (kg). */
  capacity: number;
  /** Its size for aiming at it: half-width, half-length (along its heading), height. */
  hit: { hx: number; hz: number; h: number };
  move: VesselMove;
  /** A boat: how deep it sits in the water (m); it can't go where the water is shallower. */
  draft?: number;
  /** Where people sit (metres along its heading, from the middle): the first is the steerer's. */
  seats?: number[];
  /** You stand on it (a raft's deck) rather than sit down in it. */
  stand?: boolean;
  /**
   * How easily the hull is hurt running aground (wear per hard knock, at full
   * speed): bark, reed and hide tear; a dugout or planked boat shrugs it off.
   * A worn hull leaks (slower); a wrecked one (100) is swamped until patched.
   */
  fragile?: number;
  /** What it's patched with (one per repair), and how much wear each takes off. */
  repair?: { item: string; amount: number };
  /** Carried in your pack as this item (else it stays where it is in the world). */
  item?: string;
  desc: string;
}

export const VESSELS: Record<VesselId, VesselDef> = {
  hand_cart: {
    id: 'hand_cart', name: 'Hand cart', medium: 'land', capacity: 120, hit: { hx: 0.55, hz: 0.7, h: 1.0 }, move: { push: 0.8 }, item: 'hand_cart',
    desc: 'A two-wheeled barrow of planks.',
  },
  ox_cart: {
    id: 'ox_cart', name: 'Ox cart', medium: 'land', capacity: 400, hit: { hx: 0.85, hz: 1.1, h: 1.4 }, move: { hitch: true }, item: 'ox_cart',
    desc: 'A big wagon on two solid wheels, with shafts for an ox.',
  },
  // The oldest boat there is: one great log, hollowed out with fire and axe (as on the Amazon, in
  // West Africa, and in Europe since the Stone Age). Heavy to drag, steady on the water, room for two.
  dugout: {
    id: 'dugout', name: 'Dugout canoe', medium: 'water', capacity: 160, hit: { hx: 0.45, hz: 2.4, h: 0.7 },
    move: { push: 0.45, water: { by: 'paddle', speed: 2.8, turn: 0.6, needs: ['paddle', 1] } }, draft: 0.22, seats: [-1.1, 0.9],
    fragile: 0.5, repair: { item: 'log', amount: 40 },
    desc: 'A canoe hollowed out of a single log.',
  },
  // Logs lashed side by side: carries a lot, and shallow water is no trouble, but it's slow, and it's
  // poled along off the bottom (out of your depth, you can only scull it).
  log_raft: {
    id: 'log_raft', name: 'Log raft', medium: 'water', capacity: 300, hit: { hx: 1.3, hz: 1.6, h: 0.45 },
    move: { push: 0.3, water: { by: 'pole', speed: 1.6, turn: 0.45, needs: ['punt_pole', 1], maxDepth: 2.6 } }, draft: 0.14, seats: [-0.6], stand: true,
    fragile: 0.2, repair: { item: 'cordage', amount: 30 },
    desc: 'Logs lashed side by side, poled along.',
  },
  // Bundles of reeds bound into a boat (as on Lake Titicaca and the Nile): quick to make from what grows
  // in any marsh, light enough to carry, but the reeds soon tear and waterlog.
  reed_boat: {
    id: 'reed_boat', name: 'Reed boat', medium: 'water', capacity: 90, hit: { hx: 0.5, hz: 1.9, h: 0.6 },
    move: { push: 0.85, water: { by: 'paddle', speed: 2.3, turn: 0.75, needs: ['paddle', 1] } }, draft: 0.12, seats: [-0.6],
    fragile: 4, repair: { item: 'plant_fiber', amount: 15 }, item: 'reed_boat',
    desc: 'Bundles of reeds bound into a boat.',
  },
  // A round wicker basket covered in hide (Wales, Ireland, the Tigris): one person, light enough to carry
  // on your back, and it spins at a touch: hard to keep straight.
  coracle: {
    id: 'coracle', name: 'Coracle', medium: 'water', capacity: 60, hit: { hx: 0.65, hz: 0.7, h: 0.45 },
    move: { push: 0.9, water: { by: 'paddle', speed: 1.5, turn: 2.2, needs: ['paddle', 1] } }, draft: 0.1, seats: [0],
    fragile: 3, repair: { item: 'hide', amount: 35 }, item: 'coracle',
    desc: 'A round wicker boat covered in hide.',
  },
  // Hides stretched over a frame of light timbers (the Irish currach, the Inuit umiak): long, fast and
  // roomy for its weight; the hide can tear on rocks.
  skin_boat: {
    id: 'skin_boat', name: 'Skin boat', medium: 'water', capacity: 240, hit: { hx: 0.6, hz: 2.6, h: 0.65 },
    move: { push: 0.6, water: { by: 'paddle', speed: 3.2, turn: 0.55, needs: ['paddle', 1] } }, draft: 0.16, seats: [-1.4, 0, 1.4],
    fragile: 2, repair: { item: 'hide', amount: 30 },
    desc: 'Hides stretched over a frame of light timbers.',
  },
  // Planks on frames, with thwarts and oarlocks: a carpenter's boat. The fastest and roomiest of the
  // small craft, and sturdy; it takes two oars.
  rowboat: {
    id: 'rowboat', name: 'Rowing boat', medium: 'water', capacity: 450, hit: { hx: 0.75, hz: 2.3, h: 0.8 },
    move: { push: 0.4, water: { by: 'oars', speed: 3.6, turn: 0.7, needs: ['oar', 2] } }, draft: 0.3, seats: [0, -1.3, 1.3],
    fragile: 0.4, repair: { item: 'refined_plank', amount: 35 },
    desc: 'A planked boat with thwarts and oarlocks.',
  },
};

export const vessel = (id: string): VesselDef => VESSELS[id as VesselId];
