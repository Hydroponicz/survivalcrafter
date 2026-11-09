// Ships: built on a shipyard's slipway from a design you choose (a medieval
// type to start from, then its length, beam, planking, masts, rig, castles
// and deck), stage by stage: keel, stem and sternpost, a frame and a run of
// planking for each bay, then the deck, castles, masts, sails and rudder.
// What the ship can do (its cargo, draft, speed, turning) comes from those
// choices: a ship is a vessel (data/vessels.ts) whose row is worked out
// from its design rather than written by hand.

import type { ToolKind } from './items';
import type { VesselDef } from './vessels';

export type Beam = 'narrow' | 'medium' | 'broad';
export interface ShipDesign {
  /** The type it started from (a preset), or 'Custom'. */
  type: string;
  /** Bays of 4 m along the keel (3–6): the ship is 4 m a bay, plus 2 m for the ends. */
  bays: number;
  /** Narrow and fast (a longship), medium, or broad and roomy (a cog, a hulk). */
  beam: Beam;
  /** Clinker (overlapping planks, riveted: northern) or carvel (edge to edge on heavier frames, nailed: southern, later). */
  build: 'clinker' | 'carvel';
  masts: 1 | 2;
  /** A square sail (runs before the wind) or a lateen (a long triangular sail: handier, turns better). */
  rig: 'square' | 'lateen';
  /** No castles, a sterncastle, or castles fore and aft. */
  castles: 0 | 1 | 2;
  /** A deck over the hold (keeps the cargo dry, carries more, sits a little deeper). */
  decked: boolean;
}

/** Where a ship's design starts: the medieval types. */
export const SHIP_PRESETS: { design: ShipDesign; blurb: string }[] = [
  { design: { type: 'Longship', bays: 6, beam: 'narrow', build: 'clinker', masts: 1, rig: 'square', castles: 0, decked: false },
    blurb: 'Long, narrow and fast, clinker-built, one square sail: the Norse raider. Shallow enough to run up on a beach.' },
  { design: { type: 'Knarr', bays: 4, beam: 'medium', build: 'clinker', masts: 1, rig: 'square', castles: 0, decked: false },
    blurb: 'The Norse trader: shorter and deeper than a longship, with an open hold amidships.' },
  { design: { type: 'Cog', bays: 5, beam: 'broad', build: 'clinker', masts: 1, rig: 'square', castles: 2, decked: true },
    blurb: 'The Hanseatic cargo ship: high-sided, broad and flat-bottomed, decked, with castles fore and aft.' },
  { design: { type: 'Hulk', bays: 6, beam: 'broad', build: 'carvel', masts: 1, rig: 'square', castles: 1, decked: true },
    blurb: 'A great round-bellied carrier: the most cargo of all, and the slowest.' },
  { design: { type: 'Caravel', bays: 5, beam: 'medium', build: 'carvel', masts: 2, rig: 'lateen', castles: 1, decked: true },
    blurb: 'Late and southern: carvel-built, two lateen sails. Quick and handy, it points well and turns well.' },
];

/** The longest ship a slipway takes (m). */
export const SLIP_LENGTH = 26;

export const shipLength = (d: ShipDesign) => d.bays * 4 + 2;
export function shipBeam(d: ShipDesign) {
  const L = shipLength(d);
  return L / (d.beam === 'narrow' ? 5.6 : d.beam === 'medium' ? 3.8 : 2.9);
}
/** The hull's depth (keel to gunwale amidships, m). */
export function shipDepth(d: ShipDesign) {
  const base = d.beam === 'narrow' ? 1.2 : d.beam === 'medium' ? 1.7 : 2.2;
  return base * (0.7 + 0.075 * d.bays) + (d.decked ? 0.3 : 0);
}

/** What the ship can do, from its design. */
export function shipStats(d: ShipDesign) {
  const L = shipLength(d), B = shipBeam(d), D = shipDepth(d);
  const capacity = Math.round(L * B * D * 85 * (d.decked ? 1.15 : 1) / 100) * 100;
  const draft = +(D * 0.45 + (d.decked ? 0.1 : 0)).toFixed(2);
  const hull = d.beam === 'narrow' ? 1.25 : d.beam === 'medium' ? 1.0 : 0.82;
  const speed = +((d.rig === 'square' ? 2.0 : 2.15) * Math.sqrt(L / 12) * hull * (d.masts === 2 ? 1.15 : 1) * (1 - 0.05 * d.castles) * (d.build === 'carvel' ? 1.04 : 1)).toFixed(2);
  const turn = +(0.4 * (12 / L) * (d.rig === 'lateen' ? 1.3 : 1) * (d.beam === 'narrow' ? 1.1 : d.beam === 'broad' ? 0.85 : 1)).toFixed(3);
  return { L, B: +B.toFixed(2), D: +D.toFixed(2), capacity, draft, speed, turn, knots: +(speed * 1.944).toFixed(1) };
}

/** One stage of the work, done a step at a time (each step takes its materials, worked with its tool). */
export interface ShipStage {
  id: string;
  /** What a step of it is called. */
  name: string;
  tool: ToolKind;
  steps: number;
  /** Materials for each step. */
  per: { item: string; count: number }[];
}

/** The stages of building a ship of this design, in order. */
export function shipStages(d: ShipDesign): ShipStage[] {
  const planks = d.beam === 'narrow' ? 6 : d.beam === 'medium' ? 8 : 10;
  const out: ShipStage[] = [
    { id: 'keel', name: 'Lay the keel', tool: 'hatchet', steps: 1, per: [{ item: 'log', count: d.bays }] },
    { id: 'posts', name: 'Raise the stem and sternpost', tool: 'hatchet', steps: 1, per: [{ item: 'log', count: 2 }] },
    { id: 'frames', name: 'Frame a bay', tool: 'saw', steps: d.bays, per: [{ item: 'log', count: d.build === 'carvel' ? 2 : 1 }, { item: 'refined_plank', count: 2 }] },
    { id: 'planking', name: 'Plank a bay', tool: 'hammer', steps: d.bays,
      per: [{ item: 'refined_plank', count: planks }, { item: 'iron_lump', count: d.build === 'carvel' ? 2 : 1 }, { item: 'plant_fiber', count: 4 }] },
  ];
  if (d.decked) out.push({ id: 'deck', name: 'Deck a bay', tool: 'hammer', steps: d.bays, per: [{ item: 'refined_plank', count: 6 }] });
  if (d.castles) out.push({ id: 'castles', name: d.castles === 2 ? 'Build a castle' : 'Build the sterncastle', tool: 'hammer', steps: d.castles, per: [{ item: 'refined_plank', count: 10 }, { item: 'shaft', count: 4 }] });
  out.push(
    { id: 'masts', name: 'Step a mast', tool: 'hatchet', steps: d.masts, per: [{ item: 'log', count: 2 }, { item: 'cordage', count: 8 }] },
    { id: 'sails', name: 'Make and bend on a sail', tool: 'knife', steps: d.masts, per: [{ item: 'wool', count: d.rig === 'square' ? 12 : 10 }, { item: 'cordage', count: 6 }] },
    { id: 'rudder', name: 'Hang the rudder', tool: 'hammer', steps: 1, per: [{ item: 'refined_plank', count: 4 }, { item: 'iron_lump', count: 1 }] },
  );
  return out;
}

export const totalSteps = (d: ShipDesign) => shipStages(d).reduce((n, s) => n + s.steps, 0);

/** The step after `done` steps: which stage, and which step of it (or null when the ship is finished). */
export function nextStep(d: ShipDesign, done: number): { stage: ShipStage; index: number } | null {
  let n = done;
  for (const s of shipStages(d)) {
    if (n < s.steps) return { stage: s, index: n };
    n -= s.steps;
  }
  return null;
}

/** How many steps of each stage are done (for drawing the ship as it grows). */
export function stageProgress(d: ShipDesign, done: number): Record<string, number> {
  const out: Record<string, number> = {};
  let n = done;
  for (const s of shipStages(d)) { out[s.id] = Math.max(0, Math.min(s.steps, n)); n -= s.steps; }
  return out;
}

/** All the materials a design takes. */
export function shipMaterials(d: ShipDesign): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of shipStages(d)) for (const m of s.per) out[m.item] = (out[m.item] ?? 0) + m.count * s.steps;
  return out;
}

/** How high the helm stands above the keel (matching the model: the hull's sheer aft, the sterncastle's deck). */
function helmHeight(d: ShipDesign): number {
  const s = shipStats(d), hullD = s.D - (d.decked ? 0.3 : 0), sheer = d.beam === 'narrow' ? 1.3 : 0.7;
  const rimAft = hullD + sheer * Math.pow(1 - 4.4 / s.L, 2);
  if (d.castles) return rimAft + 1.6;
  return d.decked ? hullD - 0.2 : 0.55;
}

const cache = new WeakMap<ShipDesign, VesselDef>();
/** A ship's row in the vessel table, worked out from its design. */
export function shipVessel(d: ShipDesign): VesselDef {
  let v = cache.get(d);
  if (v) return v;
  const s = shipStats(d);
  v = {
    id: 'ship', name: d.type === 'Custom' ? 'Ship' : d.type, medium: 'water', capacity: s.capacity,
    hit: { hx: s.B / 2, hz: s.L / 2, h: s.D + (d.castles ? 2.2 : 0.6) },
    move: { water: { by: 'sail', speed: s.speed, turn: s.turn } },
    // At the helm aft: up on the sterncastle if she has one, else on the deck (or the floor of an open hull).
    draft: s.draft, seats: [-s.L / 2 + 2.2], stand: true, deck: helmHeight(d),
    fragile: d.build === 'carvel' ? 0.25 : 0.3, repair: { item: 'refined_plank', amount: 8 },
    desc: `A ${d.beam}, ${d.build}-built ship, ${s.L} m long.`,
  };
  cache.set(d, v);
  return v;
}
