import { itemDef, TOOL_NAMES } from '../data/items';
import { vesselOf } from '../data/vessels';
import { defaultOption } from '../game/actions';
import type { Game } from '../game/game';

// What you can press right now, and what each does: a small panel in the
// corner that follows what you're doing (placing a plan, setting down a
// station, paddling, at a ship's helm, riding, pushing a cart, at work, or
// just looking at something). Nobody should be left wondering which button
// does what.

export interface ControlRow {
  /** Keys (or mouse buttons: LMB, RMB, Wheel) that do it; several are alternatives. */
  keys: string[];
  text: string;
  /** Highlighted: good (it'll work), bad (it won't, and why), or plain. */
  state?: 'good' | 'bad';
}
export interface Controls { title: string; note?: string; rows: ControlRow[]; /** Just the basics, nothing going on: shown quietly. */ quiet?: boolean }

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function controlsFor(g: Game): Controls | null {
  // Hands-on work has its own panel; windows have their own buttons.
  if (g.working) return null;
  const active = g.activeItem();

  // ---------- placing a plan, or setting a station down
  if (g.placing) {
    const def = g.placing, item = g.placingItem, pl = g.placement;
    const rows: ControlRow[] = [];
    if (!pl) rows.push({ keys: [], text: 'Aim at the ground (or a piece) to see where it goes', state: 'bad' });
    else if (!pl.valid) rows.push({ keys: [], text: pl.reason || 'It can\'t go here', state: 'bad' });
    else rows.push({ keys: [], text: pl.snapped ? 'Fits here, snapped to the piece beside it' : 'Fits here', state: 'good' });
    rows.push({ keys: ['LMB'], text: item ? `Set the ${lower(def.name)} down here` : 'Lay the plan down here' });
    if (def.attach) rows.push({ keys: [], text: 'It goes against the side of a forge: aim at one' });
    else rows.push({ keys: ['Wheel', 'Q', 'E'], text: 'Turn it (a sixteenth of a turn each)' });
    if (def.snap) rows.push({ keys: [], text: 'Bring it near another piece\'s edge and it snaps into line' });
    if (def.reachesWater) rows.push({ keys: [], text: `Its far end must reach water ${def.reachesWater.depth} m deep (it turns toward the water until you turn it)` });
    if (def.waterside) rows.push({ keys: [], text: 'Built out from the shore over the water' });
    rows.push({ keys: ['RMB', 'Esc'], text: 'Stop placing' });
    if (!item) rows.push({ keys: ['B'], text: 'Choose a different piece' });
    rows.push({ keys: ['WASD'], text: 'Walk about while you place it' });
    const mats = def.materials.map((m) => `${m.count} × ${itemDef(m.item).name.toLowerCase()}`).join(', ');
    const note = item
      ? `Set down whole: no building needed. You can pick it back up later (aim at it, right-click).`
      : `This lays down a plan (a blueprint, free). To build it, ${def.tool ? `hold a ${TOOL_NAMES[def.tool].toLowerCase()}, ` : ''}aim at it and left-click: each step uses one of ${mats || 'nothing'}.`;
    return { title: item ? `Setting down: ${def.name}` : `Placing a plan: ${def.name}`, note, rows };
  }

  // ---------- getting about
  if (g.boat?.ship) {
    return { title: `At the helm: ${vesselOf(g.boat).name}`, rows: [
      { keys: ['W'], text: 'Set more sail (hold)' },
      { keys: ['S'], text: 'Take in sail; keep holding to back the sails and go astern' },
      { keys: ['A', 'D'], text: 'Put the helm over: turn to port / starboard' },
      { keys: ['X'], text: 'Leave the helm (she sails on as she is)' },
    ], note: 'Watch the wind gauge: she can\'t sail into the wind.' };
  }
  if (g.boat) {
    return { title: `In the ${lower(vesselOf(g.boat).name)}`, rows: [
      { keys: ['W', 'S'], text: 'Paddle ahead / back' },
      { keys: ['A', 'D'], text: 'Steer left / right' },
      { keys: ['Shift'], text: 'Dig in: faster, but tiring' },
      { keys: ['X'], text: 'Get out (step ashore, or into the water)' },
    ] };
  }
  if (g.riding) {
    return { title: 'Riding', rows: [
      { keys: ['WASD'], text: 'Ride' },
      { keys: ['Shift'], text: 'Gallop (tires the horse)' },
      { keys: ['X'], text: 'Get off' },
    ] };
  }
  if (g.pushing) {
    return { title: `Pushing the ${lower(vesselOf(g.pushing).name)}`, rows: [
      { keys: ['WASD'], text: 'Push it along and steer' },
      { keys: ['X'], text: 'Let go and set it down' },
    ] };
  }

  // ---------- busy at something
  if (g.handState()) {
    return { title: 'Chopping', rows: [
      { keys: ['LMB'], text: 'Swing the axe (each click is one blow)' },
      { keys: ['LMB'], text: 'Click again just as the axe comes back up (the ring lights green): a rhythm blow bites deeper' },
      { keys: ['Hold LMB'], text: 'Keep swinging at a steady pace' },
      { keys: ['X'], text: 'Stop' },
    ] };
  }
  if (g.action) {
    const label = typeof g.action.def.label === 'function' ? g.action.def.label(g.action.ctx) : g.action.def.label;
    return { title: label, rows: [
      { keys: ['X'], text: 'Stop' },
      { keys: [], text: 'Moving away also stops it' },
      ...(g.queue.length ? [{ keys: [], text: `${g.queue.length} more queued after this` }] : []),
    ] };
  }

  // ---------- looking at something: what a click will do
  const rows: ControlRow[] = [];
  const def = active ? itemDef(active.type) : undefined;
  if (def?.tool === 'bow') rows.push({ keys: ['LMB'], text: 'Hold to draw the bow, let go to loose an arrow (from a worn quiver)' });
  else if (def?.damage && !g.target) rows.push({ keys: ['LMB'], text: `Swing the ${active ? itemDef(active.type).name.toLowerCase() : 'weapon'}` });
  const t = g.target;
  if (t) {
    const opts = g.actionsFor(t);
    const first = defaultOption(opts);
    if (first) {
      rows.push(first.problem
        ? { keys: ['LMB', 'E'], text: `${first.label}: ${lower(first.problem)}`, state: 'bad' }
        : { keys: ['LMB', 'E'], text: first.label, state: 'good' });
      // The main thing to do here, if it can't be done yet: why not.
      const main = opts[0];
      if (main !== first && main.problem) rows.push({ keys: [], text: `${main.label}: ${lower(main.problem)}`, state: 'bad' });
      if (opts.length > 1) rows.push({ keys: ['RMB', 'F'], text: `All ${opts.length} things you can do here` });
    } else rows.push({ keys: [], text: active ? `Nothing to do here with the ${itemDef(active.type).name.toLowerCase()}` : 'Nothing to do here with bare hands' });
    if (g.lastAction) rows.push({ keys: ['R'], text: 'Do the last thing again' });
    return { title: '', rows };
  }
  // Nothing in particular: the basics.
  return { title: 'Controls', rows: [
    ...rows,
    { keys: ['WASD'], text: 'Move' },
    { keys: ['Shift'], text: 'Sprint' },
    { keys: ['Space'], text: 'Jump' },
    { keys: ['Z'], text: 'Crouch' },
    { keys: ['1-9', 'Wheel'], text: 'Pick from the hotbar' },
    { keys: ['I'], text: 'Backpack' },
    { keys: ['C'], text: 'Crafting' },
    { keys: ['B'], text: 'Build' },
    { keys: ['M'], text: 'Map' },
    { keys: ['L'], text: 'Quests' },
    { keys: ['V'], text: 'First / third person' },
    { keys: ['H'], text: 'Help: everything else' },
  ], note: 'Aim at something to see what you can do with it.', quiet: !rows.length };
}

/** A key (or mouse button) as a key cap. */
export function keyCap(k: string): string {
  const mouse: Record<string, string> = { LMB: 'Left click', RMB: 'Right click', Wheel: 'Wheel' };
  return `<kbd class="${mouse[k] ? 'kbd-mouse' : ''}">${mouse[k] ?? k}</kbd>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function controlsHtml(c: Controls): string {
  const rows = c.rows.map((r) => `<div class="ctl-row${r.state ? ` ${r.state}` : ''}"><span class="ctl-keys">${r.keys.map(keyCap).join('<i>/</i>')}</span><span class="ctl-text">${esc(r.text)}</span></div>`).join('');
  return `${c.title ? `<div class="ctl-title">${esc(c.title)}</div>` : ''}${rows}${c.note ? `<div class="ctl-note">${esc(c.note)}</div>` : ''}`;
}
