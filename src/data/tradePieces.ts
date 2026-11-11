import type { StructureDef } from './structures';

// The things that make a workplace look like one: a trade's hanging sign
// beside its door, and what stands in its yard (logs stacked for the
// woodcutter, a bread oven for the baker, hams hanging at the butcher's,
// nets drying at the fisher's...). Found in villages and towns; not in the
// build menu.

/** The trades with a sign of their own: what's carved on it, and the board's paint. */
export const SIGNS: Record<string, { name: string; board: number }> = {
  woodcutter: { name: 'Woodcutter', board: 0x3f5a2a },
  smith: { name: 'Smithy', board: 0x2c2c34 },
  baker: { name: 'Bakery', board: 0x7a3a1e },
  butcher: { name: 'Butcher', board: 0x6a1a1a },
  farmer: { name: 'Farm', board: 0x6a5a1e },
  shepherd: { name: 'Shepherd', board: 0x3a5a6a },
  carpenter: { name: 'Carpenter', board: 0x5a3a1e },
  potter: { name: 'Potter', board: 0x2e4a5a },
  innkeeper: { name: 'Inn', board: 0x5a2a3a },
  merchant: { name: 'Merchant', board: 0x2a3a6a },
  dockhand: { name: 'Fishmonger', board: 0x1e4a5a },
};

const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) => ({ c: [cx, cy, cz] as [number, number, number], h: [hx, hy, hz] as [number, number, number] });
const piece = (id: string, name: string, icon: string, boxes: StructureDef['boxes'], desc: string, extra: Partial<StructureDef> = {}): StructureDef => ({
  id, name, icon, category: 'Decor', snap: false, village: true, boxes, snaps: [], materials: [], skill: 'carpentry', difficulty: 5, stepTime: 1, desc, ...extra,
});

export const TRADE_PIECES: StructureDef[] = [
  ...Object.entries(SIGNS).map(([k, s]) => piece(`sign_${k}`, `${s.name} sign`, '🪧', [box(0, 0, 0.45, 0.06, 0.3, 0.3)], `A painted sign hung out over the street: ${s.name.toLowerCase()}.`)),
  piece('log_stack', 'Log stack', '🪵', [box(0, 0.45, 0, 1.3, 0.45, 0.6)], 'Felled trunks stacked to season, ends out.'),
  piece('sawhorse', 'Sawhorse', '🪚', [box(0, 0.45, 0, 0.7, 0.45, 0.3)], 'A trestle to saw on, a log across it and the saw left in the cut.'),
  piece('bread_oven', 'Bread oven', '🍞', [box(0, 0.7, 0, 0.85, 0.7, 0.85)], 'A domed clay oven on a stone plinth, its mouth arched, a chimney at the back: fired up before dawn for the day\'s bread.',
    { station: 'fire', burns: true, glow: { strength: 0.7, height: 0.85, out: 0.8 } }),
  piece('meat_rack', 'Meat rack', '🍖', [box(0, 1, 0, 0.9, 1, 0.25)], 'A frame of poles under a little roof, hams and sides hung from its hooks to cure.'),
  piece('net_rack', 'Net rack', '🎣', [box(0, 0.9, 0, 1.2, 0.9, 0.15)], 'Fishing nets hung out to dry between two poles, floats and all, a few fish drying on the bar.'),
  piece('tool_rack', 'Smith\'s rack', '⚒️', [box(0, 0.8, 0, 0.6, 0.8, 0.15)], 'A rack of tongs and hammers, a horseshoe or two hung for luck.'),
  piece('charcoal_heap', 'Charcoal heap', '⚫', [box(0, 0.25, 0, 0.6, 0.25, 0.6)], 'Charcoal heaped ready for the forge.'),
  piece('flour_sacks', 'Flour sacks', '🌾', [box(0, 0.35, 0, 0.6, 0.35, 0.4)], 'Sacks of flour, one open, its top rolled down.'),
  piece('plough', 'Plough', '🌾', [box(0, 0.4, 0, 0.3, 0.4, 1)], 'A wooden plough with an iron share, left by the house till the next furrow.'),
  piece('plank_stack', 'Plank stack', '🪵', [box(0, 0.35, 0, 1.1, 0.35, 0.4)], 'Sawn boards stacked on bearers with sticks between, drying straight.'),
  piece('pot_shelf', 'Pot shelf', '⚱️', [box(0, 0.7, 0, 0.8, 0.7, 0.2)], 'Shelves of finished pots and jars, out for anyone passing to see.'),
  piece('wool_bales', 'Wool bales', '🐑', [box(0, 0.35, 0, 0.7, 0.35, 0.4)], 'Fleeces rolled and tied in bales after the shearing.'),
];
