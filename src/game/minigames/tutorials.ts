import type { MinigameSpec } from './index';

// First-time guidance for each kind of hands-on work: an intro card before you
// start, then coaching (an animated mouse gesture by the work) for your first
// few attempts, or whenever you seem stuck.

/** Mouse motions the coach can demonstrate. */
export type Gesture = 'right' | 'down' | 'up' | 'updown' | 'leftright' | 'circle' | 'click' | 'hold' | 'release' | 'wait';

export interface Tutorial {
  title: string;
  /** One line on what you're actually doing, in real-world terms. */
  what: string;
  steps: { gesture: Gesture; text: string }[];
  quality: string;
}

const T: Record<string, Tutorial> = {
  saw: {
    title: 'Sawing planks',
    what: 'Saw the log lengthways along each chalk line. Every cut gives you a plank.',
    steps: [
      { gesture: 'leftright', text: 'Hold the left button and sweep the mouse left and right, like working a saw. The cut runs along the red line.' },
      { gesture: 'wait', text: 'Keep the Stroke speed in its green zone. Rush it and the blade binds until you slow down.' },
      { gesture: 'updown', text: 'The grain pulls the blade aside: nudge the mouse up or down to keep it on the line. Green blade: on it. Red: off.' },
    ],
    quality: 'Straighter cuts make better planks. The dark groove shows where your blade really went.',
  },
  bowdrill: {
    title: 'Lighting a fire',
    what: 'A bow drill spins a stick against a board until the friction makes a glowing ember.',
    steps: [
      { gesture: 'leftright', text: 'Hold the left button and saw the mouse left and right in long, steady strokes.' },
      { gesture: 'hold', text: 'Keep a rhythm until the Heat gauge fills. Too wild and the spindle slips and loses heat.' },
    ],
    quality: 'A steady rhythm lights it faster.',
  },
  bellows: {
    title: 'Smelting ore',
    what: 'Pump the bellows to blow air into the forge so it gets hot enough to melt iron out of the ore.',
    steps: [
      { gesture: 'down', text: 'Hold the left button and pull the mouse down to squeeze the bellows. The heat rises.' },
      { gesture: 'up', text: 'Move the mouse back up (or let go) to refill them.' },
      { gesture: 'wait', text: 'Keep the Heat in the green band until the ore has melted. Too hot burns the iron.' },
    ],
    quality: 'The longer you keep the heat in the green band, the better the iron. Better bellows make this easier.',
  },
  pour: {
    title: 'Casting iron',
    what: 'Pour the molten iron from the crucible into a sand mould shaped like an anvil.',
    steps: [
      { gesture: 'down', text: 'Hold the left button and pull the mouse down to tip the crucible. Nothing pours until it tips past level.' },
      { gesture: 'up', text: 'Move the mouse up to tip it back if the stream gets too fast and splashes.' },
      { gesture: 'hold', text: 'Keep the Flow in the green band without stopping until the mould is full. A stopped pour skins over and leaves a weak seam.' },
    ],
    quality: 'One steady, unbroken pour casts the best anvil. Hotter metal (better bellows) gives you more time.',
  },
  quench: {
    title: 'Quenching',
    what: 'Plunging hot steel into water hardens it, but cooling it too suddenly can crack it.',
    steps: [
      { gesture: 'hold', text: 'Hold the left button to plunge the glowing tool into the trough. It steams and cools.' },
      { gesture: 'release', text: 'Let go to lift it out before the Stress gauge reaches the red, or it cracks.' },
      { gesture: 'wait', text: 'Let the stress ease, then plunge again, until the Metal heat is gone.' },
    ],
    quality: 'Keeping it under as much as you safely can hardens it best. Cracks damage the tool.',
  },
  'crank:grind': {
    title: 'Grinding flour',
    what: 'Turn the top stone of the quern to grind grain between the stones.',
    steps: [
      { gesture: 'circle', text: 'Hold the left button and move the mouse in circles around the quern.' },
      { gesture: 'hold', text: 'Keep a steady speed in the green band. Too fast spills the grain.' },
    ],
    quality: 'A steady, even pace grinds the finest flour.',
  },
  'crank:stir': {
    title: 'Mixing',
    what: 'Stir everything in the bowl together.',
    steps: [
      { gesture: 'circle', text: 'Hold the left button and stir in circles around the bowl.' },
      { gesture: 'hold', text: 'Keep the Speed gauge in the green band. Too fast and it slops out.' },
    ],
    quality: 'An even pace mixes it well.',
  },
  'crank:pound': {
    title: 'Pounding herbs',
    what: 'Grind the herbs in the mortar with the pestle.',
    steps: [
      { gesture: 'circle', text: 'Hold the left button and grind in circles.' },
      { gesture: 'hold', text: 'Keep the Speed gauge in the green band.' },
    ],
    quality: 'An even pace makes a smooth paste.',
  },
  'strike:split': {
    title: 'Splitting wood',
    what: 'Hit the log in the right spots to split it cleanly.',
    steps: [
      { gesture: 'hold', text: 'Aim at the yellow mark. A white ring shrinks toward it.' },
      { gesture: 'click', text: 'Click the moment the white ring meets the yellow mark.' },
    ],
    quality: 'Good timing and aim give clean splits. Misses waste effort.',
  },
  knap: {
    title: 'Knapping stone',
    what: 'Chip flakes off the stone until it matches the tool shape drawn on the leather beside it. Nothing marks the shape on the stone: judge it by eye.',
    steps: [
      { gesture: 'hold', text: 'Aim at the edge of the stone, where it sticks out beyond the shape on the leather. Hold the mouse button to build up force.' },
      { gesture: 'release', text: 'Let go to strike and a flake breaks off. Harder hits, or hits further from the edge, take bigger flakes.' },
      { gesture: 'wait', text: 'Work your way around. Keep the force in the green band: hit too hard and you\'ll chip into the shape, and chip too much and the stone breaks.' },
    ],
    quality: 'The closer the finished stone matches the drawing, the better the tool.',
  },
  'strike:haft': {
    title: 'Hafting a mallet',
    what: 'Hammer the handle into the mallet head with a rock until it\'s tight.',
    steps: [
      { gesture: 'hold', text: 'Aim at the top of the handle (the yellow mark). A white ring shrinks toward it.' },
      { gesture: 'click', text: 'Strike as the ring meets the mark: each clean blow drives the handle further in.' },
    ],
    quality: 'Well-timed hits fit the head tighter and make a better hammer.',
  },
  'strike:knap': {
    title: 'Knapping stone',
    what: 'Chip flakes off the stone to make a sharp edge.',
    steps: [
      { gesture: 'hold', text: 'Aim at the yellow mark on the stone. A white ring shrinks toward it.' },
      { gesture: 'click', text: 'Click as the white ring meets the mark to knock off a flake.' },
    ],
    quality: 'Precise hits make a sharper, stronger tool.',
  },
  'strike:forge': {
    title: 'Smithing',
    what: 'Hammer the glowing iron on the anvil before it cools. A better anvil gives you more time per hit, and better bellows keep the metal hot longer.',
    steps: [
      { gesture: 'hold', text: 'Aim at the yellow mark on the hot metal. A white ring shrinks toward it.' },
      { gesture: 'click', text: 'Strike as the ring meets the mark.' },
      { gesture: 'wait', text: 'Work quickly: the Metal heat gauge drops, and cold iron won’t shape well.' },
    ],
    quality: 'Accurate, well-timed blows on hot metal make the best tools.',
  },
  'strike:nail': {
    title: 'Nailing',
    what: 'Hammer in the nails to fix the piece in place.',
    steps: [
      { gesture: 'hold', text: 'Aim at the yellow mark on the nail head.' },
      { gesture: 'click', text: 'Strike as the white ring meets it.' },
    ],
    quality: 'Clean strikes make sturdier building pieces.',
  },
  chop: {
    title: 'Splitting on the block',
    what: 'Split wood on your chopping block. The log (or plank) stands on end, and gold lines show where to chop.',
    steps: [
      { gesture: 'click', text: 'A ring shrinks onto the gold line. Click when it turns green to swing the hatchet and split a piece off.' },
      { gesture: 'click', text: 'Split each line in turn. A log gives two rough planks (plus bark scraps); a plank gives four sticks of kindling.' },
    ],
    quality: 'Clean, well-timed blows make better planks and kindling.',
  },
  build: {
    title: 'Building',
    what: 'Build each piece right where it stands, one layer at a time: set the material in place, then fix it there.',
    steps: [
      { gesture: 'click', text: 'Move the plank (or log, or stone) onto the glowing outline. It snaps in when you\'re close, and the fit % shows how well it lines up. Click to set it.' },
      { gesture: 'click', text: 'Then hammer in each nail (or settle a log with your hatchet): click when the shrinking ring turns green. A bad hit bends the nail.' },
    ],
    quality: 'A snug fit and clean strikes make a sturdier piece.',
  },
  carve: {
    title: 'Carving',
    what: 'Carve with your knife: whittle a branch, or cut a shape out of a plank or hide, by following the dashed line.',
    steps: [
      { gesture: 'right', text: 'Hold the left button and drag the knife along the line: left to right on a branch, or around the outline on a plank or hide.' },
      { gesture: 'hold', text: 'Stay on the line at a steady pace. Rushing won\'t cut faster, and slipping off damages the piece.' },
    ],
    quality: 'The cleaner and steadier your cuts, the better the piece.',
  },
  'heat:roast': {
    title: 'Cooking over the fire',
    what: 'Hold the food over the flames until it’s cooked through, without burning it.',
    steps: [
      { gesture: 'updown', text: 'Move the mouse up and down to raise or lower the food. Lower is hotter.' },
      { gesture: 'wait', text: 'Watch the Done gauge. Too close to the flames and it scorches.' },
      { gesture: 'click', text: 'Click to take it off when Done is in the green band.' },
    ],
    quality: 'Taking it off at just the right moment, unscorched, makes the best food.',
  },
  'heat:bake': {
    title: 'Baking',
    what: 'Bake the dough over the fire until it’s golden.',
    steps: [
      { gesture: 'updown', text: 'Move the mouse up and down to raise or lower the bread. Lower is hotter.' },
      { gesture: 'click', text: 'Click to take it off when Done is in the green band.' },
    ],
    quality: 'Golden brown, not burnt, is best.',
  },
  'heat:fire': {
    title: 'Firing pottery',
    what: 'Heat the clay pot in the fire until it hardens.',
    steps: [
      { gesture: 'updown', text: 'Move the mouse up and down to push the pot into or out of the heat.' },
      { gesture: 'click', text: 'Click to pull it out when Done is in the green band. Too much heat cracks it.' },
    ],
    quality: 'Even heating makes a stronger pot.',
  },
  'heat:brew': {
    title: 'Brewing',
    what: 'Steep the herbs in hot water without letting it boil away.',
    steps: [
      { gesture: 'updown', text: 'Move the mouse up and down to set the pot over the flame.' },
      { gesture: 'click', text: 'Click to take it off when Done is in the green band.' },
    ],
    quality: 'Take it off before it boils dry.',
  },
  place: {
    title: 'Building',
    what: 'Set each piece into its place in the structure.',
    steps: [
      { gesture: 'hold', text: 'Move the mouse to line the piece up with the glowing slot. It sways a little in your hands.' },
      { gesture: 'click', text: 'Click to set it when it lines up.' },
    ],
    quality: 'Snug, straight pieces make a stronger building.',
  },
  center: {
    title: 'Throwing a pot',
    what: 'Shape the clay into a jar on the spinning wheel.',
    steps: [
      { gesture: 'hold', text: 'Hold the left button to draw the clay up into shape.' },
      { gesture: 'leftright', text: 'Move the mouse against the wobble to keep the clay centred on the wheel.' },
    ],
    quality: 'Keeping it centred while you shape it makes a better jar.',
  },
  cord: {
    title: 'Making cordage',
    what: 'Make cord by twisting two strands of fiber and wrapping them around each other, over and over.',
    steps: [
      { gesture: 'right', text: 'Twist: hold the left button and drag right to twist the upper strand. Stop when the gauge is in the green.' },
      { gesture: 'down', text: 'Lay over: hold and drag down to cross that strand over the other one. They swap places, and the cord grows by one wrap.' },
      { gesture: 'click', text: 'Add fiber: when a strand runs thin and flashes, click the fiber bundle to add more.' },
    ],
    quality: 'Keep each twist in the green band for strong cord. Over-twisting makes weak spots.',
  },
};

/** Which tutorial a minigame uses (variants of one mechanic can need different explanations). */
export function tutorialKey(spec: MinigameSpec): string {
  switch (spec.kind) {
    case 'crank': return `crank:${spec.variant}`;
    case 'strike': return `strike:${spec.variant}`;
    case 'heat': return `heat:${spec.variant}`;
    default: return spec.kind;
  }
}

export function tutorialFor(spec: MinigameSpec): Tutorial {
  return T[tutorialKey(spec)] ?? { title: 'Hands-on work', what: '', steps: [], quality: '' };
}

const KEY = 'survivalcrafter.tutorials.v1';

/** How many times you've done each kind of work (per browser). */
export class TutorialProgress {
  private runs: Record<string, number> = {};

  constructor() {
    try {
      this.runs = JSON.parse(localStorage.getItem(KEY) ?? '{}').runs ?? {};
    } catch { /* fresh */ }
  }

  count(key: string): number {
    return this.runs[key] ?? 0;
  }

  record(key: string) {
    this.runs[key] = this.count(key) + 1;
    this.save();
  }

  reset() {
    this.runs = {};
    this.save();
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify({ runs: this.runs })); } catch { /* ignore */ }
  }
}

/** Markup for an animated mouse demonstrating a gesture. */
export function gestureHtml(g: Gesture): string {
  const held = g !== 'click' && g !== 'release' && g !== 'wait' && g !== 'up' ? ' held' : '';
  return `<span class="mg-mouse g-${g}${held}"><span class="mg-mouse-btn"></span></span>`;
}
