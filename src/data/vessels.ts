// Vessels: everything you load and move about the world that isn't an
// animal. Carts on land, boats on the water, and in time the great ships
// built on a shipyard's slip, all in one table, so a new one is a row here
// (and a model in view.ts), and it is loaded, saved, aimed at, dragged,
// boarded and steered by the same code as the rest.
//
// In the world each one is a `CartObj` (world.ts: its place, heading, load,
// quality and wear); this table says what that kind of vessel can do.

/** The kinds of vessel. */
export type VesselId = 'hand_cart' | 'ox_cart' | 'dugout';

/** How a vessel moves under you (or in front of you). */
export interface VesselMove {
  /** Pushed or dragged by hand: your walking speed while you do (× normal). */
  push?: number;
  /** Hitched to a tamed ox, which you lead. */
  hitch?: boolean;
  /** Paddled from inside: top speed (m/s) with a paddle, and how fast it turns (rad/s at speed). */
  paddle?: { speed: number; turn: number };
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
    move: { push: 0.45, paddle: { speed: 2.8, turn: 0.6 } }, draft: 0.22, seats: [-1.1, 0.9],
    desc: 'A canoe hollowed out of a single log.',
  },
};

export const vessel = (id: string): VesselDef => VESSELS[id as VesselId];
