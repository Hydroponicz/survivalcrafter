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
    what: 'You saw the log lengthways along the red lines to cut it into planks.',
    steps: [
      { gesture: 'updown', text: 'Hold the left button and move the mouse up and down to work the saw back and forth.' },
      { gesture: 'leftright', text: 'Nudge left or right to keep the blade on the red line as the grain pulls it off.' },
      { gesture: 'release', text: 'Don’t rush. Saw too fast and the blade binds — let go of the button and ease back in.' },
    ],
    quality: 'Staying on the line makes better planks. Speed doesn’t matter; straightness does.',
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
    quality: 'Time spent in the green band makes better iron.',
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
    what: 'Strike the log in the right spots to split it cleanly along the grain.',
    steps: [
      { gesture: 'hold', text: 'Aim at the yellow mark. A white ring shrinks toward it.' },
      { gesture: 'click', text: 'Click the moment the white ring meets the yellow mark.' },
    ],
    quality: 'Good timing and aim give clean splits. Misses waste effort.',
  },
  'strike:knap': {
    title: 'Knapping stone',
    what: 'Strike flakes off the stone to shape a sharp edge.',
    steps: [
      { gesture: 'hold', text: 'Aim at the yellow mark on the stone. A white ring shrinks toward it.' },
      { gesture: 'click', text: 'Click as the white ring meets the mark to knock off a flake.' },
    ],
    quality: 'Precise strikes make a keener, stronger tool.',
  },
  'strike:forge': {
    title: 'Smithing',
    what: 'Hammer the glowing iron on the anvil to shape it before it cools.',
    steps: [
      { gesture: 'hold', text: 'Aim at the yellow mark on the hot metal. A white ring shrinks toward it.' },
      { gesture: 'click', text: 'Strike as the ring meets the mark.' },
      { gesture: 'wait', text: 'Work quickly: the Metal heat gauge drops, and cold iron won’t shape well.' },
    ],
    quality: 'Accurate, well-timed blows on hot metal make the best tools.',
  },
  'strike:nail': {
    title: 'Nailing',
    what: 'Drive the nails to fix the piece in place.',
    steps: [
      { gesture: 'hold', text: 'Aim at the yellow mark on the nail head.' },
      { gesture: 'click', text: 'Strike as the white ring meets it.' },
    ],
    quality: 'Clean strikes make sturdier building pieces.',
  },
  carve: {
    title: 'Carving',
    what: 'Whittle the wood by drawing the knife along the marked line.',
    steps: [
      { gesture: 'right', text: 'Hold the left button and draw the knife slowly from left to right along the dashed line.' },
      { gesture: 'hold', text: 'Stay on the line. Rushing doesn’t carve faster.' },
    ],
    quality: 'The closer you follow the line, the better the piece.',
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
    quality: 'Golden, not burnt, is best.',
  },
  'heat:fire': {
    title: 'Firing pottery',
    what: 'Heat the clay pot in the fire until it hardens.',
    steps: [
      { gesture: 'updown', text: 'Move the mouse up and down to push the pot into or out of the heat.' },
      { gesture: 'click', text: 'Click to pull it out when Done is in the green band. Too much heat cracks it.' },
    ],
    quality: 'Even firing makes a sound pot.',
  },
  'heat:brew': {
    title: 'Brewing',
    what: 'Steep the herbs in hot water without letting it boil away.',
    steps: [
      { gesture: 'updown', text: 'Move the mouse up and down to set the pot over the flame.' },
      { gesture: 'click', text: 'Click to take it off when Done is in the green band.' },
    ],
    quality: 'Just steeped, never boiled dry.',
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
    what: 'You make cord by twisting two strands of fibre and wrapping them around each other, over and over. The twist in each strand is what holds the cord together.',
    steps: [
      { gesture: 'right', text: 'Twist: hold the left button and drag right to twist the upper strand. Stop when the gauge is in the green.' },
      { gesture: 'down', text: 'Lay over: hold and drag down to cross that strand over the other one. They swap places, and the cord grows by one wrap.' },
      { gesture: 'click', text: 'Splice: when a strand runs thin and flashes, click the fibre bundle to add more.' },
    ],
    quality: 'Each twist in the green band makes strong cord. Overtwisting kinks it and leaves weak spots.',
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
