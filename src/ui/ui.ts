import { GUIDE_HTML } from './guide';
import { perf } from '../game/perf';
import { telemetry } from '../game/telemetry';
import { isIdentified, ITEMS, itemDef, itemName, TOOL_NAMES, typeDesc, WEAR_SLOT_NAMES, WEAR_SLOTS, type Item } from '../data/items';
import { RECIPES, STATION_NAMES, type Recipe } from '../data/recipes';
import { SKILL_INFO, SKILLS, type SkillId } from '../data/skills';
import { Tooltip } from './tooltip';
import { MapView } from './mapview';
import { drawIcons, itemIcon, onIconsReady, pieceIcon } from './itemIcons';
import { pieceBounds } from '../world/pieceFill';
import { CharacterPreview } from './preview';
import { BUILDABLE, STRUCTURES, totalMaterials } from '../data/structures';
import { vesselOf } from '../data/vessels';
import { allowed, nextStep, pointsTo, settle, SHIP_PRESETS, windName, shipLength, shipMaterials, shipStats, totalSteps, type ShipDesign } from '../data/ships';
import { ACTION_MAP, craftProblem, forageName, type ActionDef, type Ctx, type Target } from '../game/actions';
import { DEV_FLAGS, devCommands, type DevFlag } from '../game/dev';
import { BIOME_NAMES, IDENTIFY } from '../data/forage';
import { VirtualCursor } from './cursor';
import { BIOMES, biomeAt } from '../game/forage';
import { QUICK_MARGIN, type Game, type MsgKind } from '../game/game';
import { minigameVerb, RECIPE_MINIGAMES } from '../game/minigames';
import { MAT_NAMES } from '../world/terrain';
import { ANIMALS, cropKey, type CartObj, type PileObj, type StructureObj } from '../world/world';
import { GOODS } from '../game/economy';
import type { HouseRole } from '../world/villages';

/** Whose work a good is, as a work order puts it. */
const JOB_WORDS: Record<HouseRole, string> = {
  farmer: 'farmer\'s work', shepherd: 'shepherd\'s work', woodcutter: 'woodcutter\'s work', butcher: 'butcher\'s work',
  smith: 'smith\'s work', elder: 'odd jobs', villager: 'gathering about the land',
  priest: 'the church\'s needs', mayor: 'the town\'s needs', merchant: 'trade goods', baker: 'baker\'s work', carpenter: 'carpenter\'s work',
  lord: 'the castle\'s needs', noble: 'fine goods', innkeeper: 'the tavern\'s needs', guard: 'the garrison\'s needs', performer: 'the playhouse\'s needs', dockhand: 'the harbour\'s needs',
};
const fmtCoins = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));

type WindowName = 'inventory' | 'character' | 'crafting' | 'skills' | 'build' | 'help' | 'container' | 'dev' | 'journal' | 'quests' | 'map' | 'store' | 'shipyard';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const DRAG_ITEM = 'application/x-sc-item';
const DRAG_SLOT = 'application/x-sc-slot';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class UI {
  root: HTMLElement;
  hoveredItem: number | null = null;
  menuOpen = false;
  wantsRelock = false;
  private windows = new Map<WindowName, HTMLElement>();
  private open = new Set<WindowName>();
  private bars: Record<string, HTMLElement> = {};
  private targetEl: HTMLElement;
  private hintEl: HTMLElement;
  private progress: HTMLElement;
  private progressFill: HTMLElement;
  private progressLabel: HTMLElement;
  private hotbarEl: HTMLElement;
  private clockEl: HTMLElement;
  private perfEl: HTMLElement;
  private statusEl: HTMLElement;
  private windEl: HTMLElement;
  private logEl: HTMLElement;
  private menuEl: HTMLElement;
  private pauseEl: HTMLElement;
  private deathEl: HTMLElement;
  /**
   * Until the first click captures the mouse (a browser only lets a page do
   * that when you click on it), a "click to start" screen, not the pause menu.
   */
  private startEl: HTMLElement;
  private started = false;
  private damageEl: HTMLElement;
  private container: StructureObj | PileObj | CartObj | null = null;
  /** The village storehouse being traded at. */
  private storeObj: StructureObj | null = null;
  /** The slipway the shipyard window is for, and the design being drawn up there. */
  private slipObj: StructureObj | null = null;
  private shipDraft: ShipDesign = { ...SHIP_PRESETS[0].design };
  private craftCategory = 'Primitive';
  private expanded = new Set<string>();
  private refreshTimer = 0;
  private hintTimer = 0;
  private hintKey = '';
  private lastHtml = new Map<WindowName, string>();
  private pressedWindow: WindowName | null = null;
  /** A window being dragged by its title bar, and where in it you took hold. */
  private windowDrag: { name: string; w: HTMLElement; dx: number; dy: number } | null = null;
  /** Where you've put each window (remembered in this browser). */
  private windowPos: Record<string, { x: number; y: number }> = (() => {
    try { return JSON.parse(localStorage.getItem('survivalcrafter.windows') ?? '{}'); } catch { return {}; }
  })();
  private pendingRender = new Set<WindowName>();
  private lastRefreshKey = '';
  /** In-game cursor for windows and menus while the mouse stays captured. */
  cursor: VirtualCursor;
  /** Hover boxes for anything with a data-tip or title. */
  tooltip: Tooltip;
  /** The world map (made when first opened). */
  private _mapView: MapView | null = null;
  get mapView(): MapView { return (this._mapView ??= new MapView(this.g, this.g.map)); }
  /** Your character, in the inventory window. */
  private preview = new CharacterPreview();
  /** Seconds to keep the pause screen hidden after asking to re-capture the mouse. */
  relockGrace = 0;
  private devGive = { type: 'log', count: 10, ql: 50, kind: 'All' };
  private devSkill = 50;

  constructor(private g: Game) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = '';
    this.tooltip = new Tooltip(document.body);
    onIconsReady(() => { this.lastRefreshKey = ''; this.refresh(); });
    const hud = el('div', 'hud');
    hud.innerHTML = `
      <div class="crosshair"></div>
      <div class="target"><div class="target-name"></div><div class="target-hint"></div></div>
      <div class="progress"><div class="progress-label"></div><div class="progress-bar"><div class="progress-fill"></div></div></div>
      <div class="clock"></div>
      <div class="perf-line"></div>
      <div class="status"></div>
      <div class="wind-gauge"><svg viewBox="-50 -50 100 100" width="92" height="92">
        <circle r="46" class="wg-ring"/><path class="wg-nogo" d=""/>
        <path class="wg-ship" d="M0,-24 C7,-14 8,6 6,22 L-6,22 C-8,6 -7,-14 0,-24 Z"/>
        <g class="wg-arrow"><path d="M0,-44 L0,-26 M-6,-33 L0,-25 L6,-33"/></g>
      </svg><div class="wg-text"></div></div>
      <div class="bars"></div>
      <div class="hotbar"></div>
      <div class="log"></div>`;
    this.root.appendChild(hud);
    this.targetEl = hud.querySelector('.target-name')!;
    this.hintEl = hud.querySelector('.target-hint')!;
    this.progress = hud.querySelector('.progress')!;
    this.progressFill = hud.querySelector('.progress-fill')!;
    this.progressLabel = hud.querySelector('.progress-label')!;
    this.hotbarEl = hud.querySelector('.hotbar')!;
    this.clockEl = hud.querySelector('.clock')!;
    this.perfEl = hud.querySelector('.perf-line')!;
    this.statusEl = hud.querySelector('.status')!;
    this.windEl = hud.querySelector('.wind-gauge')!;
    this.logEl = hud.querySelector('.log')!;
    const bars = hud.querySelector('.bars')!;
    for (const [k, label] of [['health', 'Health'], ['food', 'Food'], ['water', 'Water'], ['stamina', 'Stamina']]) {
      const b = el('div', `bar bar-${k}`, `<span>${label}</span><div class="bar-fill"></div>`);
      bars.appendChild(b);
      this.bars[k] = b.querySelector('.bar-fill')!;
    }

    for (const name of ['inventory', 'character', 'crafting', 'skills', 'build', 'help', 'container', 'dev', 'journal', 'quests', 'map', 'store', 'shipyard'] as WindowName[]) {
      const w = el('div', `window window-${name}`);
      w.style.display = 'none';
      w.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.pressedWindow = name;
      });
      this.root.appendChild(w);
      this.windows.set(name, w);
    }

    this.menuEl = el('div', 'context-menu');
    this.menuEl.style.display = 'none';
    this.root.appendChild(this.menuEl);
    this.cursor = new VirtualCursor(this.root, () => this.cursorActive(), (target, button) => {
      // Right-click, or clicking off the action menu, closes it.
      if (this.menuOpen && (button === 2 || !target || !this.menuEl.contains(target))) {
        this.closeMenu();
        return true;
      }
      return false;
    });
    // The map zooms with the wheel (the cursor otherwise scrolls whatever's under it).
    this.cursor.wheelHook = (dy, x, y) => {
      if (!this.isOpen('map')) return false;
      this.mapView.input(Math.sign(dy), false, x, y);
      return true;
    };

    this.pauseEl = el('div', 'pause', `
      <div class="pause-box">
        <h2>Paused</h2>
        <p>Click to return to the wilderness</p>
        <div class="pause-buttons">
          <button data-act="resume" title="Back to the game">Resume</button>
          <button data-act="save" title="Save now (the game also saves every minute and when you leave)">Save game</button>
          <button data-act="unstuck" title="Move to the nearest open ground if you are stuck in terrain">Unstuck</button>
          <button data-act="quality" title="Cycle Low / Medium / High: shadows, view distance, plants and sharpness">Graphics: ${g.graphics.level.label}</button>
          <button data-act="aa" title="Smooths jagged edges. Standard: the graphics card's own (MSAA). High adds SMAA over the whole picture.">Anti-aliasing: ${g.graphics.aaLabel}</button>
          <button data-act="fps" title="Cap the frame rate to save power and keep your computer cool">Frame cap: ${g.graphics.fpsLabel}</button>
          <button data-act="export" title="Download your world as a file (a backup, or to move it to another browser)">Export save file</button>
          <button data-act="import" title="Load a world from a save file, replacing this one">Import save file</button>
          <button data-act="help" title="Controls and how the game works (H)">Controls &amp; guide</button>
          <button data-act="sound" title="Turn the game's sound on or off">Sound: ${g.sound.muted ? 'off' : 'on'}</button>
          <button data-act="windows" title="Put every window and panel back where it started">Reset window positions</button>
          <button data-act="skip-tutorial" title="Turn the tutorial quest off for this world">Skip tutorial</button>
          <button data-act="restart-tutorial" title="Add the tutorial quest back to your quest log">Restart tutorial</button>
          <button data-act="new" title="Delete this world and start a new one" class="danger">Abandon world</button>
        </div>
      </div>`);
    this.pauseEl.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (act === 'save') { void g.save().then(() => this.log('Game saved.', 'good')); return; }
      if (act === 'unstuck') { g.unstuck(); g.input.lock(); return; }
      if (act === 'quality') {
        g.graphics.nextQuality(); g.applyGraphics();
        (e.target as HTMLElement).textContent = `Graphics: ${g.graphics.level.label}`;
        return;
      }
      if (act === 'aa') {
        const was = g.graphics.aa;
        g.graphics.nextAA(); g.applyGraphics();
        (e.target as HTMLElement).textContent = `Anti-aliasing: ${g.graphics.aaLabel}`;
        // The graphics card's own smoothing is set when the game starts.
        if ((was === 'off') !== (g.graphics.aa === 'off')) this.log('Turning anti-aliasing fully on or off takes effect when you next load the game.', 'info');
        return;
      }
      if (act === 'fps') {
        g.graphics.nextFpsCap();
        (e.target as HTMLElement).textContent = `Frame cap: ${g.graphics.fpsLabel}`;
        return;
      }
      if (act === 'help') { this.toggle('help'); return; }
      if (act === 'sound') {
        g.sound.muted = !g.sound.muted;
        (e.target as HTMLElement).textContent = `Sound: ${g.sound.muted ? 'off' : 'on'}`;
        return;
      }
      if (act === 'windows') { this.resetWindows(); this.log('Windows are back where they started.', 'info'); return; }
      if (act === 'skip-tutorial') {
        if (confirm('Turn the tutorial off for this world?')) { g.quests?.skip(); this.log('Tutorial off. Press H any time for the guide, or restart it from this menu.', 'info'); this.update(); }
        return;
      }
      if (act === 'restart-tutorial') {
        g.quests?.restart(g.player.pos.x, g.player.pos.z);
        this.log('The tutorial is back in your quest log. Steps you\'ve already done will tick off by themselves.', 'good');
        this.update();
        return;
      }
      if (act === 'export') {
        g.exportSave().then(() => this.log('World exported: check your downloads.', 'good'), (err) => this.log(`Export failed: ${err?.message ?? err}`, 'fail'));
        return;
      }
      if (act === 'import') {
        pickFile((file) => {
          if (!confirm('Replace this world with the one in that file? Export this one first if you want to keep it.')) return;
          g.importAndReload(file).catch((err) => this.log(err?.message ?? String(err), 'fail'));
        });
        return;
      }
      if (act === 'new') {
        if (confirm('Abandon this world and start a new one? Your save will be deleted.')) {
          g.abandon();
        }
        return;
      }
      g.input.lock();
    });
    this.root.appendChild(this.pauseEl);
    this.startEl = el('div', 'start-prompt', `
      <div class="start-box"><h2>Click to start</h2><p>The game takes the mouse to look around. Press Esc any time to pause.</p></div>`);
    this.startEl.addEventListener('click', () => g.input.lock());
    this.root.appendChild(this.startEl);
    this.deathEl = el('div', 'death', '<h1>You have died</h1><p>You wake at your home. Your belongings lie where you fell.</p>');
    this.root.appendChild(this.deathEl);
    this.damageEl = el('div', 'damage');
    this.root.appendChild(this.damageEl);

    window.addEventListener('keydown', (e) => this.onKey(e));
    // A drag ends with dragend instead of mouseup; both release the redraw hold.
    const release = () => {
      const name = this.pressedWindow;
      if (!name) return;
      this.pressedWindow = null;
      // Let the click event fire on the old DOM first, then catch up.
      if (this.pendingRender.delete(name)) setTimeout(() => { if (this.open.has(name)) this.render(name); }, 0);
    };
    window.addEventListener('mouseup', release);
    window.addEventListener('mouseup', () => this.endWindowDrag());
    window.addEventListener('mousemove', (e) => { if (this.windowDrag && !this.g.input.locked) this.dragWindowTo(e.clientX, e.clientY); });
    window.addEventListener('dragend', release);
    document.addEventListener('mousedown', (e) => {
      // With the mouse captured, clicks are routed through clickMenuCursor instead.
      if (this.menuOpen && !this.g.input.locked && !this.menuEl.contains(e.target as Node)) this.closeMenu();
    });
    for (const [t, k] of g.pendingMsgs) this.log(t, k);
    g.pendingMsgs = [];
    this.refresh();
  }

  // ---------- windows
  anyWindowOpen() {
    return this.open.size > 0 || this.menuOpen;
  }

  toggle(name: WindowName) {
    if (this.open.has(name)) this.close(name);
    else this.show(name);
  }

  /** Is this window open? */
  isOpen(name: WindowName) { return this.open.has(name); }

  show(name: WindowName) {
    if (name === 'journal') this.g.quests?.note('journal');
    if (name === 'map') { this.mapView.mount(this.windows.get('map')!); this.mapView.opened(); }
    this.open.add(name);
    this.windows.get(name)!.style.display = 'flex';
    const pos = this.windowPos[name];
    if (pos) this.placeWindow(this.windows.get(name)!, pos.x, pos.y);
    this.render(name);
  }

  /**
   * Let a window or panel be dragged about by a handle (its title bar), and
   * put it back where it was last left.
   */
  movable(w: HTMLElement, key: string, handle: HTMLElement = w) {
    handle.classList.add('drag-handle');
    handle.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, a, [draggable="true"]')) return;
      const r = w.getBoundingClientRect();
      this.windowDrag = { name: key, w, dx: e.clientX - r.left, dy: e.clientY - r.top };
      handle.classList.add('dragging');
    });
    const pos = this.windowPos[key];
    if (pos && handle === w) this.placeWindow(w, pos.x, pos.y);
  }

  /** Put a window's top left corner at (x, y), keeping its title bar on screen. */
  private placeWindow(w: HTMLElement, x: number, y: number) {
    const width = w.offsetWidth || 300;
    w.style.left = `${Math.max(-width + 80, Math.min(window.innerWidth - 80, x))}px`;
    w.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, y))}px`;
    w.style.right = 'auto';
    w.style.bottom = 'auto';
    w.style.transform = 'none';
  }

  private dragWindowTo(px: number, py: number) {
    const d = this.windowDrag!;
    this.placeWindow(d.w, px - d.dx, py - d.dy);
  }

  private endWindowDrag() {
    const d = this.windowDrag;
    if (!d) return;
    this.windowDrag = null;
    for (const h of [d.w, ...d.w.querySelectorAll('.dragging')]) h.classList.remove('dragging');
    this.windowPos[d.name] = { x: parseFloat(d.w.style.left), y: parseFloat(d.w.style.top) };
    try { localStorage.setItem('survivalcrafter.windows', JSON.stringify(this.windowPos)); } catch { /* private mode */ }
  }

  /** Put every window back where it started. */
  resetWindows() {
    this.windowPos = {};
    try { localStorage.removeItem('survivalcrafter.windows'); } catch { /* private mode */ }
    for (const w of [...this.windows.values(), ...this.root.querySelectorAll<HTMLElement>('.tut-panel')]) { w.style.left = w.style.top = w.style.right = w.style.bottom = w.style.transform = ''; }
  }

  /** Close every window (and the action menu); returns which were open. */
  closeAllWindows(): WindowName[] {
    const was = [...this.open];
    for (const n of was) this.close(n);
    if (this.menuOpen) this.closeMenu();
    this.wantsRelock = false;
    return was;
  }

  close(name: WindowName) {
    this.open.delete(name);
    this.windows.get(name)!.style.display = 'none';
    this.lastHtml.delete(name);
    this.pendingRender.delete(name);
    if (name === 'container') this.container = null;
    if (name === 'store') this.storeObj = null;
    if (name === 'inventory') this.hoveredItem = null;
    if (!this.anyWindowOpen() && !this.g.input.locked) this.wantsRelock = true;
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (this.menuOpen) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) {
        (this.menuEl.querySelectorAll('.menu-item')[n - 1] as HTMLElement | undefined)?.click();
        e.stopImmediatePropagation();
      }
      if (e.code === 'Escape') this.closeMenu();
      return;
    }
    if (e.code === 'Escape' && this.open.size) {
      for (const n of [...this.open]) this.close(n);
    }
  }

  /** The shipyard at a slipway: draw up a ship and lay her down, or see how the one on the slip is coming on. */
  openShipyard(o: StructureObj) {
    this.slipObj = o;
    this.show('shipyard');
  }

  openStore(o: StructureObj) {
    this.storeObj = o;
    this.show('store');
  }

  openContainer(o: StructureObj | PileObj | CartObj) {
    this.container = o;
    this.show('container');
    this.show('inventory');
  }

  // ---------- context menu
  openContextMenu(t: Target, opts: { def: ActionDef; ctx: Ctx; label: string; problem: string | null }[]) {
    this.menuEl.innerHTML = '';
    this.menuEl.appendChild(el('div', 'menu-title', esc(this.describeTarget(t))));
    if (!opts.length) this.menuEl.appendChild(el('div', 'menu-empty', 'Nothing to do here with that.'));
    opts.forEach((o, i) => {
      const item = el('div', `menu-item${o.problem ? ' disabled' : ''}`,
        `<span class="key">${i + 1}</span>${esc(o.label)}${o.problem ? `<div class="why">${esc(o.problem)}</div>` : ''}`);
      item.addEventListener('click', () => {
        this.closeMenu();
        this.g.request(o.def, o.ctx);
      });
      this.menuEl.appendChild(item);
    });
    const active = this.g.activeItem();
    this.menuEl.appendChild(el('div', 'menu-foot', `Active: ${active ? esc(itemName(active)) : 'bare hands'}`));
    this.menuEl.style.display = 'block';
    this.menuOpen = true;
    this.cursor.setVisible(this.cursorActive());
  }

  /** The in-game cursor drives the UI while the mouse is captured and a window or menu is open. */
  cursorActive(): boolean {
    return this.g.input.locked && (this.anyWindowOpen() || this.peeking);
  }

  /** Holding Left Alt shows the cursor (hover for tooltips, drag windows) without opening anything. */
  get peeking(): boolean {
    return this.g.input.keys.has('AltLeft') || !!this.windowDrag || !!this.altHint;
  }

  /** The first time you hold Alt: what it's for, until you say you've got it. */
  private altHint: HTMLElement | null = null;
  private altSeen = (() => { try { return localStorage.getItem('survivalcrafter.altHint') === 'seen'; } catch { return false; } })();

  private showAltHint() {
    this.altSeen = true;
    const h = el('div', 'alt-hint', `<h3>Free cursor</h3>
      <p>While you hold <b>Left Alt</b> the cursor is yours and the camera holds still:</p>
      <ul><li>hover anything (bars, items, skills, buttons) to learn more about it</li>
      <li>drag windows and the tutorial panel by their title bars to where you like them</li></ul>
      <p class="hint">Let go of Alt to look around again.</p>`);
    const ok = el('button', 'wide', 'Got it');
    ok.addEventListener('click', () => {
      h.remove();
      this.altHint = null;
      try { localStorage.setItem('survivalcrafter.altHint', 'seen'); } catch { /* private mode */ }
    });
    h.appendChild(ok);
    this.root.appendChild(h);
    this.altHint = h;
  }

  closeMenu() {
    this.menuEl.style.display = 'none';
    this.menuOpen = false;
    if (!this.anyWindowOpen() && !this.g.input.locked) this.wantsRelock = true;
  }

  describeTarget(t: Target): string {
    const g = this.g;
    switch (t.kind) {
      case 'terrain': {
        const crop = g.world.crops.get(cropKey(t.point.x, t.point.z));
        const b = biomeAt(g.world, t.point.x, t.point.y, t.point.z, t.mat);
        const name = b === 'meadow' || b === 'forest' || b === 'wetland' ? BIOMES[b].name : MAT_NAMES[t.mat];
        return `${name}${crop ? ' (wheat)' : ''}`;
      }
      case 'water': return 'Water';
      case 'animal': return ANIMALS[t.animal.species].name;
      case 'rock': return t.rock.sc < 0.6 ? 'Small boulder' : t.rock.sc < 1.1 ? 'Boulder' : 'Large boulder';
      case 'cart': { const m = g.shipping.of(t.cart); return m ? `The ${m.name} (${m.design.type.toLowerCase()})` : vesselOf(t.cart).name; }
      case 'villager': return t.villager.lying ? `${t.villager.name} (asleep)` : `${t.villager.name}, ${t.villager.roleName}`;
      case 'trader': return `${t.trader.name}, travelling trader`;
      case 'stump': return `${t.stump.species[0].toUpperCase()}${t.stump.species.slice(1)} stump`;
      case 'none': return '';
      case 'object': {
        const o = t.obj;
        if (o.kind === 'tree') return `${o.species[0].toUpperCase()}${o.species.slice(1)} tree${o.age < 0.3 ? ' (young)' : ''}`;
        if (o.kind === 'bush') return o.ripe ? 'Berry bush (ripe)' : 'Berry bush';
        if (o.kind === 'forage') return forageName(o);
        if (o.kind === 'pile') {
          const corpse = o.items.find((i) => i.type === 'corpse');
          if (corpse) return itemName(corpse)[0].toUpperCase() + itemName(corpse).slice(1);
          return o.items.length === 1 ? itemName(o.items[0]) : `Pile of ${o.items.length} items`;
        }
        const def = STRUCTURES[o.type];
        if (!o.built) {
          const done = Object.values(o.consumed).reduce((a, b) => a + b, 0);
          return `Planned ${def.name.toLowerCase()} (${Math.round((done / totalMaterials(def)) * 100)}% built)`;
        }
        return `${def.name}${def.burns ? (o.lit ? ' — burning' : ' — cold') : ''}${def.opens ? (o.open ? ' (open)' : ' (closed)') : ''}`;
      }
    }
  }

  // ---------- log
  log(text: string, kind: MsgKind) {
    const line = el('div', `log-line log-${kind}`, esc(text));
    this.logEl.appendChild(line);
    while (this.logEl.children.length > 40) this.logEl.firstChild!.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
    setTimeout(() => line.classList.add('old'), 12000);
  }

  flashDamage() {
    this.damageEl.classList.remove('flash');
    void this.damageEl.offsetWidth;
    this.damageEl.classList.add('flash');
  }

  /** A notice that pauses the game until you've read it. */
  modalOpen = false;
  /**
   * A notice that stops the game until you've read it: a warning (red), or a
   * lesson (a picture of the thing, then how it works).
   */
  showNotice(title: string, html: string, button: string, onOk: () => void, opts: { image?: string; kind?: 'warning' | 'lesson' } = {}) {
    const g = this.g;
    this.modalOpen = true;
    g.paused = true;
    g.input.unlock();
    this.cursor.setVisible(false);
    const el2 = el('div', 'notice-backdrop');
    const pic = opts.image ? `<img class="notice-pic" src="${opts.image}" alt="" draggable="false">` : '';
    el2.innerHTML = `<div class="notice${opts.kind === 'lesson' ? ' lesson' : ''}">${pic}<div class="notice-head">${title}</div><div class="notice-body">${html}</div><button class="notice-ok">${button}</button></div>`;
    this.root.appendChild(el2);
    el2.querySelector('button')!.addEventListener('click', () => {
      el2.remove();
      this.modalOpen = false;
      g.paused = false;
      g.input.lock();
      onOk();
    });
  }

  showDeath() {
    this.deathEl.classList.add('show');
    setTimeout(() => this.deathEl.classList.remove('show'), 4000);
  }

  // ---------- per-frame HUD
  update() {
    const g = this.g, p = g.player;
    // (Everything below touches the page only when what it shows has changed:
    // writing the same thing every frame still costs the browser style and layout work.)
    for (const k of ['health', 'food', 'water', 'stamina'] as const) setStyle(this.bars[k], 'width', `${Math.round(p[k] * 2) / 2}%`);

    const bar = (k: string, v: number, what: string) => setData(this.bars[k].parentElement!, 'tip', `<b>${k[0].toUpperCase() + k.slice(1)}</b> ${Math.round(v)} / 100<br>${what}`);
    bar('health', p.health, 'At zero you die and wake at home, your pack left where you fell. Heals slowly while you\'re fed and watered.');
    bar('food', p.food, 'Falls over time. Eat (from your backpack): cooked food and better quality feed you more. Starving hurts.');
    bar('water', p.water, 'Falls faster than food. Aim at a lake or river and drink, or carry jars of water.');
    bar('stamina', p.stamina, 'Spent by hard work, sprinting and climbing; comes back when you rest, faster when well fed.');
    const f = g.world.dayFraction;
    const mins = Math.floor(f * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0'), mm = String(mins % 60).padStart(2, '0');
    // With dev settings on, where you are too (handy for reporting a spot).
    const pos = g.dev.anyActive ? ` · ${Math.round(g.player.pos.x)}, ${Math.round(g.player.pos.z)} · ${perf.fps} fps` : '';
    setData(this.clockEl, 'tip', '<b>Time</b><br>A day lasts 20 minutes. Nights are dark: have a fire, or a house to wait them out in.');
    setText(this.clockEl, `Day ${g.world.day} · ${hh}:${mm}${f > 0.78 || f < 0.22 ? ' · night' : ''}${pos}`);
    // With dev settings on: the slowest frame each second, and what took the time in it.
    setStyle(this.perfEl, 'display', g.dev.anyActive ? '' : 'none');
    if (g.dev.anyActive) {
      const top = perf.worstParts.filter(([, ms]) => ms >= 1).slice(0, 3).map(([k, ms]) => `${k} ${ms.toFixed(0)}`).join(', ');
      setText(this.perfEl, `slowest ${perf.worst.toFixed(0)} ms${top ? ` (${top})` : ''}`);
    }

    const status: string[] = [];
    if (g.dev.anyActive) status.push('<span class="dev-badge">DEV</span>');
    if (p.food < 20) status.push('<span class="warn" data-tip="Your food is low. Eat soon, or you start losing health.">Hungry</span>');
    if (p.water < 20) status.push('<span class="warn" data-tip="Your water is low. Drink from a lake or river.">Thirsty</span>');
    if (p.stamina < 10) status.push('<span class="warn" data-tip="No strength left for hard work. Stop and rest a moment.">Exhausted</span>');
    const w = g.inv.weight();
    if (w > g.carryCapacity()) status.push(`<span class="warn" data-tip="You carry more than ${g.carryCapacity()} kg and move slowly. Drop or store something.">Overloaded ${w.toFixed(0)}/${g.carryCapacity()} kg</span>`);
    if (p.swimming) status.push('Swimming');
    if (p.slope === 'blocked') status.push('<span class="warn">Too steep to climb</span>');
    else if (p.slope === 'sliding') status.push('<span class="warn">Sliding!</span>');
    else if (p.slope === 'steep') status.push('Steep — hard going');
    if (p.effects.poisoned) status.push(`<span class="bad" data-tip="Losing health until it wears off. A yarrow poultice cures it.">Poisoned ${Math.ceil(p.effects.poisoned.t)}s</span>`);
    if (p.effects.nauseous) status.push('<span class="warn" data-tip="Your stamina recovers slowly for a while.">Nauseous</span>');
    if (p.effects.refreshed) status.push('<span class="good-text" data-tip="Mint tea: stamina comes back twice as fast for a while.">Refreshed</span>');
    if (p.effects.bandaged) status.push('<span class="good-text" data-tip="A bandage is slowly healing you.">Bandaged</span>');
    if (p.effects.rested) status.push(`<span class="good-text" data-tip="You slept in comfort (${p.effects.rested.rate}): stamina comes back ${Math.round(p.effects.rested.rate * 20)}% faster for a while.">Well rested</span>`);
    if (g.placing) status.push(`Placing: ${g.placing.name} — Left-click place · ${g.placing.attach ? 'aim at the side of a forge' : 'Wheel or Q/E rotate'} · Right-click cancel${g.placement?.snapped ? ' · snapped' : ''}`);
    if (g.placement && !g.placement.valid) status.push(`<span class="warn">${esc(g.placement.reason)}</span>`);
    setHTML(this.statusEl, status.join(' · '));
    this.updateWindGauge(g);

    // What you're aiming at, and what a click would do (worked out a few times a second, or when the aim changes).
    const t = g.target;
    this.hintTimer -= 1 / 60;
    const tKey = t ? targetKey(t) : '';
    if (tKey !== this.hintKey || this.hintTimer <= 0) {
      this.hintKey = tKey;
      this.hintTimer = 0.2;
      if (t && !g.placing) {
        setText(this.targetEl, this.describeTarget(t));
        const opts = g.actionsFor(t);
        const first = opts.find((o) => !o.problem) ?? opts[0];
        setHTML(this.hintEl, first ? `<b>LMB</b> ${esc(first.label)} &nbsp; <b>RMB</b> more` : '');
      } else {
        setText(this.targetEl, '');
        setText(this.hintEl, '');
      }
    }

    const a = g.action;
    if (a) {
      setStyle(this.progress, 'display', 'block');
      const label = typeof a.def.label === 'function' ? a.def.label(a.ctx) : a.def.label;
      setText(this.progressLabel, `${label}${g.queue.length ? ` (+${g.queue.length} queued)` : ''}`);
      setStyle(this.progressFill, 'width', `${Math.min(100, Math.round((a.elapsed / a.total) * 200) / 2)}%`);
    } else {
      setStyle(this.progress, 'display', 'none');
    }

    // Don't flash the pause screen while the game is taking the mouse back.
    this.relockGrace = Math.max(0, this.relockGrace - 1 / 60);
    // If the mouse was released (Esc), the real cursor takes over.
    this.cursor.setVisible(this.cursorActive());
    if (g.input.locked) this.started = true;
    // Item portraits, a few a frame as they're asked for.
    drawIcons();
    // The tutorial panel steps aside while a window is open.
    if (this.root.classList.contains('has-window') !== this.open.size > 0) this.root.classList.toggle('has-window', this.open.size > 0);
    if (!this.altSeen && g.input.locked && g.input.keys.has('AltLeft')) this.showAltHint();
    // Tooltips follow the in-game cursor, and go when it does (and stay out of the way of a drag).
    this.tooltip.check();
    if (this.cursor.isVisible) this.tooltip.place(this.cursor.x, this.cursor.y);
    else if (g.input.locked) this.tooltip.reset();
    if (this.windowDrag) this.tooltip.reset();
    if (this.windowDrag && g.input.locked) this.dragWindowTo(this.cursor.x, this.cursor.y);
    if (this.open.has('map')) this.mapView.frame();
    // Your character in the inventory window, as you are now.
    if (this.open.has('character')) {
      const held = g.activeItem();
      this.preview.show(g.player, `${JSON.stringify(g.equipped)}|${held?.type ?? ''}|${g.player.rig ? 1 : 0}`);
      this.preview.render(1 / 60);
    }
    setStyle(this.startEl, 'display', this.started ? 'none' : 'flex');
    const showPause = this.started && !g.input.locked && !this.anyWindowOpen() && !this.wantsRelock && this.relockGrace <= 0 && !this.modalOpen;
    setStyle(this.pauseEl, 'display', showPause ? 'flex' : 'none');
    if (showPause) {
      (this.pauseEl.querySelector('[data-act="skip-tutorial"]') as HTMLElement).style.display = g.quests?.active ? '' : 'none';
      // Offered once the tutorial's off, or its house quest is gone from the log.
      const home = g.quests?.quests.find((q) => q.id === 'home');
      (this.pauseEl.querySelector('[data-act="restart-tutorial"]') as HTMLElement).style.display = g.quests && (g.quests.off || !home) ? '' : 'none';
    }

    // Live windows refresh a few times per second.
    this.refreshTimer -= 1 / 60;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 0.5;
      if (this.open.has('crafting')) this.render('crafting');
      if (this.open.has('skills')) this.render('skills');
      if (this.open.has('store') && this.storeObj) {
        const s = this.storeObj;
        if (Math.hypot(s.x - p.pos.x, s.z - p.pos.z) > 6 || !g.world.objects.has(s.id)) this.close('store');
        else this.render('store');
      }
      if (this.open.has('shipyard') && this.slipObj) {
        const s = this.slipObj;
        if (Math.hypot(s.x - p.pos.x, s.z - p.pos.z) > 30 || !g.world.objects.has(s.id)) this.close('shipyard');
        else this.render('shipyard');
      }
      if (this.open.has('container') && this.container) {
        const c = this.container;
        if (Math.hypot(c.x - p.pos.x, c.z - p.pos.z) > 5 || (c.kind === 'cart' ? !g.world.carts.includes(c) : !g.world.objects.has(c.id))) this.close('container');
      }
    }
  }

  /** Re-render inventory-dependent UI. */
  refresh() {
    this.renderHotbar();
    // Static windows keep their DOM (and any half-typed form input).
    for (const n of this.open) if (n !== 'help' && n !== 'dev') this.render(n);
  }

  private renderHotbar() {
    const g = this.g;
    const active = g.activeItem();
    const key = JSON.stringify([g.hotbar, active?.uid, g.hotbar.map((t) => (t ? g.inv.count(t) : 0))]);
    if (key === this.lastRefreshKey) return;
    this.lastRefreshKey = key;
    this.hotbarEl.innerHTML = '';
    g.hotbar.forEach((type, i) => {
      const count = type ? g.inv.count(type) : 0;
      const slot = el('div', `slot${active && type === active.type ? ' active' : ''}${type && !count ? ' empty' : ''}`);
      slot.innerHTML = `<span class="slot-key">${i + 1}</span>${type ? `<span class="slot-icon">${itemIcon(type)}</span>` : ''}${count > 1 ? `<span class="slot-count">${count}</span>` : ''}`;
      slot.title = type
        ? `${itemDef(type).name} — click to use, drag to move, right-click to clear`
        : 'Empty — drag an item here from your inventory';
      this.wireSlot(slot, i, type);
      this.hotbarEl.appendChild(slot);
    });
    const a = el('div', 'active-label', active ? `${itemDef(active.type).icon} ${esc(itemName(active))} <small>QL ${active.ql.toFixed(1)}${active.dmg > 0 ? `, dmg ${active.dmg.toFixed(1)}` : ''}</small>` : 'Bare hands');
    a.dataset.tip = active ? itemTip(active, 1) : '<b>Bare hands</b><br>Pick things up, forage and gather stones. Pick a tool with 1-9.';
    this.hotbarEl.appendChild(a);
  }

  private wireSlot(slot: HTMLElement, i: number, type: string | null) {
    const g = this.g;
    slot.addEventListener('click', () => g.useHotbar(i));
    slot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      g.bindHotbar(i, null);
    });
    if (type) {
      slot.draggable = true;
      slot.addEventListener('dragstart', (e) => {
        e.dataTransfer!.setData(DRAG_SLOT, String(i));
        e.dataTransfer!.effectAllowed = 'move';
      });
      // Dropped somewhere that isn't a slot: take it off the bar.
      slot.addEventListener('dragend', (e) => {
        if (e.dataTransfer!.dropEffect === 'none' && g.hotbar[i] === type) g.bindHotbar(i, null);
      });
    }
    slot.addEventListener('dragover', (e) => {
      const types = e.dataTransfer!.types;
      if (!types.includes(DRAG_ITEM) && !types.includes(DRAG_SLOT)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = types.includes(DRAG_SLOT) ? 'move' : 'copy';
      slot.classList.add('drop-target');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drop-target'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drop-target');
      const item = e.dataTransfer!.getData(DRAG_ITEM);
      const from = e.dataTransfer!.getData(DRAG_SLOT);
      if (item) g.bindHotbar(i, item);
      else if (from !== '') g.swapHotbar(Number(from), i);
    });
  }

  private frame(name: WindowName, title: string, body: HTMLElement | string) {
    const w = this.windows.get(name)!;
    // Swapping the DOM between mousedown and mouseup swallows the click, so
    // hold off while a button is pressed in this window and redraw afterwards.
    if (this.pressedWindow === name) {
      this.pendingRender.add(name);
      return;
    }
    const b = el('div', 'window-body');
    if (typeof body === 'string') b.innerHTML = body;
    else b.appendChild(body);
    // Skip identical redraws: no flicker, and hover/focus survive. Rows carry
    // their item uids in data attributes, so equal HTML means equal targets.
    const html = title + b.innerHTML;
    if (this.lastHtml.get(name) === html && w.firstChild) return;
    this.lastHtml.set(name, html);
    const scroll = w.querySelector('.window-body')?.scrollTop ?? 0;
    w.innerHTML = '';
    const head = el('div', 'window-head', `<span>${title}</span>`);
    // Drag a window by its title bar; it stays where you put it.
    this.movable(w, name, head);
    const x = el('button', 'close', '✕');
    x.dataset.tip = 'Close';
    x.addEventListener('click', () => this.close(name));
    head.appendChild(x);
    w.append(head, b);
    b.scrollTop = scroll;
  }

  private render(name: WindowName) {
    switch (name) {
      case 'inventory': return this.renderInventory();
      case 'character': return this.renderCharacter();
      case 'crafting': return this.renderCrafting();
      case 'skills': return this.renderSkills();
      case 'build': return this.renderBuild();
      case 'help': return this.renderHelp();
      case 'container': return this.renderContainer();
      case 'store': return this.renderStore();
      case 'shipyard': return this.renderShipyard();
      case 'dev': return this.renderDev();
      case 'journal': return this.renderJournal();
      case 'quests': return this.renderQuests();
      case 'map': this.mapView.mount(this.windows.get('map')!); return;
    }
  }

  private itemRow(items: Item[], actions: { label: string; fn: (it: Item) => void; all?: boolean }[]): HTMLElement {
    const g = this.g;
    const best = items[0];
    const def = itemDef(best.type);
    const row = el('div', `item-row${g.activeUid !== null && items.some((i) => i.uid === g.activeUid) ? ' active' : ''}`);
    row.dataset.uids = items.map((i) => i.uid).join(',');
    const weight = items.length * def.weight;
    const ql = items.length > 1 ? `QL ${items.at(-1)!.ql.toFixed(0)}–${best.ql.toFixed(0)}` : `QL ${best.ql.toFixed(1)}`;
    row.innerHTML = `<span class="icon">${itemIcon(best.type)}</span>
      <span class="name">${esc(itemName(best))}${items.length > 1 ? ` <b>×${items.length}</b>` : ''}
        <small>${ql}${def.holds ? ` · ${best.contents?.length ?? 0}/${def.holds.max} arrows` : ''}${def.sips ? ` · ${best.fill ?? 0}/${def.sips} drinks` : ''}${def.carry ? ` · +${def.carry} kg capacity` : ''}${def.tool && best.dmg > 0 ? ` · dmg ${best.dmg.toFixed(1)}` : ''}${best.quenched ? ' · hardened' : ''}${best.hot ? ` · <span class="warn">glowing, ${Math.ceil(best.hot)}s to quench</span>` : ''} · ${weight.toFixed(1)} kg</small></span>`;
    row.dataset.tip = itemTip(best, items.length);
    const btns = el('span', 'btns');
    for (const a of actions) {
      const b = el('button', '', a.label);
      b.addEventListener('click', (e) => { e.stopPropagation(); a.fn(best); });
      btns.appendChild(b);
    }
    row.appendChild(btns);
    row.addEventListener('mouseenter', () => { this.hoveredItem = best.uid; });
    if (!def.noPickup) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer!.setData(DRAG_ITEM, best.type);
        e.dataTransfer!.effectAllowed = 'copy';
        this.hotbarEl.classList.add('dragging');
      });
      row.addEventListener('dragend', () => this.hotbarEl.classList.remove('dragging'));
    }
    row.addEventListener('mouseleave', () => { if (this.hoveredItem === best.uid) this.hoveredItem = null; });
    return row;
  }

  private renderInventory() {
    const g = this.g;
    const body = el('div');
    const w = g.inv.weight();
    const carrying = el('div', 'inv-weight', `Carrying <b>${w.toFixed(1)}</b> / ${g.carryCapacity()} kg${w > g.carryCapacity() ? ' — <span class="warn">overloaded, you move slowly</span>' : ''} · Purse: <b>${fmtCoins(g.coins)}</b> coins`);
    carrying.dataset.tip = weightTip(g.inv.items, g.carryCapacity(), 'Over this you move slowly.');
    body.appendChild(carrying);
    body.appendChild(el('div', 'hint', 'Click <b>Use</b> to equip an item (tools, seeds, dirt…). Drag an item onto the hotbar, or hover over it and press <b>1-9</b>, to add it there.'));
    const groups = g.inv.grouped().sort((a, b) => itemDef(a.type).name.localeCompare(itemDef(b.type).name));
    if (!groups.length) body.appendChild(el('div', 'empty', 'Your pack is empty.'));
    const chest = this.container?.kind === 'structure' || this.container?.kind === 'cart' ? this.container : null;
    for (const grp of groups) {
      const def = itemDef(grp.type);
      const actions: { label: string; fn: (it: Item) => void }[] = [];
      const isActive = grp.items.some((i) => i.uid === g.activeUid);
      if (def.wear) {
        const on = grp.items.some((i) => g.equipped[def.wear!.slot] === i.uid);
        actions.push(on ? { label: 'Take off', fn: () => g.takeOff(def.wear!.slot) } : { label: 'Wear', fn: (it) => g.putOn(it.uid) });
      } else actions.push({ label: isActive ? 'Unuse' : 'Use', fn: (it) => g.setActive(isActive ? null : it.uid) });
      if (def.food) actions.push({ label: def.food.verb ?? (def.food.nutrition || def.food.effect ? 'Eat' : 'Drink'), fn: (it) => g.eat(it.uid) });
      if (def.sips) actions.push({ label: 'Drink', fn: (it) => g.drinkCanteen(it.uid) });
      if (def.holds) {
        actions.push({ label: 'Load arrows', fn: (it) => { const n = g.loadQuiver(it); g.msg(n ? `You slide ${n} arrow(s) into the quiver.` : 'No arrows in your pack to load (or the quiver is full).', 'info'); g.dressPlayer(); } });
        actions.push({ label: 'Unload', fn: (it) => { const n = g.unloadQuiver(it); g.msg(`You take ${n} arrow(s) out of the quiver.`, 'info'); g.dressPlayer(); } });
      }
      if (def.places) actions.push({ label: 'Place', fn: (it) => g.startPlacingItem(it) });
      if (def.cart || def.vessel) actions.push({ label: 'Set down', fn: (it) => g.setDownCart(it) });
      if (grp.type === 'bandage') actions.push({ label: 'Apply', fn: () => g.applyBandage() });
      if (!isIdentified(grp.type)) actions.push({ label: 'Study', fn: (it) => g.request(ACTION_MAP.study, { g, t: { kind: 'none' }, item: it }) });
      if (chest) {
        actions.push({ label: 'Store', fn: (it) => g.putIntoContainer(chest, [it.uid]) });
        if (grp.items.length > 1) actions.push({ label: 'Store all', fn: () => g.putIntoContainer(chest, grp.items.map((i) => i.uid)) });
      } else {
        actions.push({ label: 'Drop', fn: (it) => g.dropItems([it.uid]) });
        if (grp.items.length > 1) actions.push({ label: 'Drop all', fn: () => g.dropItems(grp.items.map((i) => i.uid)) });
      }
      const row = this.itemRow(grp.items, actions);
      if (grp.items.length > 1) {
        const open = this.expanded.has(grp.type);
        const tog = el('button', 'expand', open ? '▾' : '▸');
        tog.title = 'Show individual items';
        tog.addEventListener('click', (e) => {
          e.stopPropagation();
          if (open) this.expanded.delete(grp.type); else this.expanded.add(grp.type);
          this.renderInventory();
        });
        row.prepend(tog);
      } else {
        row.prepend(el('span', 'expand'));
      }
      body.appendChild(row);
      if (this.expanded.has(grp.type)) {
        for (const it of grp.items) {
          const sub = el('div', `item-sub${it.uid === g.activeUid ? ' active' : ''}`,
            `QL ${it.ql.toFixed(1)}${it.dmg > 0 ? ` · dmg ${it.dmg.toFixed(1)}` : ''}`);
          sub.dataset.uid = String(it.uid);
          const u = el('button', '', it.uid === g.activeUid ? 'Unuse' : 'Use');
          u.addEventListener('click', () => g.setActive(it.uid === g.activeUid ? null : it.uid));
          const d = el('button', '', 'Drop');
          d.addEventListener('click', () => g.dropItems([it.uid]));
          sub.append(u, d);
          body.appendChild(sub);
        }
      }
    }
    this.frame('inventory', 'Backpack', body);
  }

  /** Tab / I: your backpack and your character, together. */
  toggleInventory() {
    if (this.open.has('inventory') || this.open.has('character')) { this.close('inventory'); this.close('character'); }
    else { this.show('character'); this.show('inventory'); }
  }

  /** Let something be dragged onto the hotbar to bind its kind of item there. */
  private dragToHotbar(e: HTMLElement, type: string) {
    e.draggable = true;
    e.addEventListener('dragstart', (ev) => {
      ev.dataTransfer!.setData(DRAG_ITEM, type);
      ev.dataTransfer!.effectAllowed = 'copy';
      this.hotbarEl.classList.add('dragging');
    });
    e.addEventListener('dragend', () => this.hotbarEl.classList.remove('dragging'));
  }

  private renderCharacter() {
    this.frame('character', 'Character', this.characterLayout());
    // The portrait's canvas lives on across redraws: put it back in its place.
    const view = this.windows.get('character')!.querySelector('.char-view');
    if (view && !view.contains(this.preview.canvas)) view.appendChild(this.preview.canvas);
  }

  /** The character window: you and what you wear and carry in hand, your pack, and your skills. */
  private characterLayout(): HTMLElement {
    const g = this.g;
    const layout = el('div', 'char-layout');
    const me = el('div', 'char-col');
    me.appendChild(el('div', 'char-view'));
    const slots = el('div', 'eq-slots');
    for (const slot of WEAR_SLOTS) {
      const it = g.worn(slot);
      const box = el('div', `eq-slot${it ? ' filled' : ''}`, `<span class="eq-label">${WEAR_SLOT_NAMES[slot]}</span>
        <span class="eq-icon">${it ? itemIcon(it.type) : ''}</span><span class="eq-name">${it ? esc(itemName(it)) : 'Nothing'}</span>`);
      box.dataset.tip = it ? itemTip(it, 1) : `<b>${WEAR_SLOT_NAMES[slot]}</b><br>Nothing worn here. Clothing is made from hides (Crafting → Clothing) and takes some of the force of a blow.`;
      if (it) {
        this.dragToHotbar(box, it.type);
        const off = el('button', 'eq-off', '✕');
        off.dataset.tip = 'Take it off';
        off.addEventListener('click', () => g.takeOff(slot));
        box.appendChild(off);
      }
      slots.appendChild(box);
    }
    me.appendChild(slots);
    // In hand, and the tools on your hotbar.
    const held = g.activeItem();
    const hand = el('div', `eq-slot eq-hand${held ? ' filled' : ''}`, `<span class="eq-label">In hand</span>
      <span class="eq-icon">${held ? itemIcon(held.type) : '✋'}</span><span class="eq-name">${held ? esc(itemName(held)) : 'Bare hands'}</span>`);
    hand.dataset.tip = held ? itemTip(held, 1) : '<b>Bare hands</b><br>Pick things up, forage and gather stones. Choose a tool from the hotbar (1-9) to use it.';
    me.appendChild(hand);
    const tools = g.inv.items.filter((i) => itemDef(i.type).tool);
    const seen = new Set<string>();
    const belt = el('div', 'eq-tools');
    for (const t of tools.sort((a, b) => b.ql - a.ql)) {
      if (seen.has(t.type)) continue;
      seen.add(t.type);
      const chip = el('span', `eq-tool${held?.uid === t.uid ? ' on' : ''}`, itemIcon(t.type));
      chip.dataset.tip = itemTip(t, 1);
      chip.addEventListener('click', () => g.setActive(t.uid));
      this.dragToHotbar(chip, t.type);
      belt.appendChild(chip);
    }
    if (!seen.size) belt.appendChild(el('span', 'eq-none', 'No tools yet'));
    me.appendChild(el('div', 'eq-head', 'Tools'));
    me.appendChild(belt);
    const armor = g.armor();
    const prot = el('div', 'eq-armor', `Protection <b>${Math.round(armor * 100)}%</b>`);
    prot.dataset.tip = 'How much of an animal\'s blow your clothing takes. Each piece adds some; better quality adds more.';
    me.appendChild(prot);


    const skills = el('div', 'skills-col');
    skills.appendChild(el('div', 'eq-head', 'Skills'));
    for (const k of (Object.keys(SKILLS) as SkillId[]).sort((a, b) => g.skills.get(b) - g.skills.get(a))) {
      const v = g.skills.get(k);
      const row = el('div', 'mini-skill', `<span>${SKILLS[k]}</span><b>${v.toFixed(1)}</b><div class="mini-bar"><div style="width:${v}%"></div></div>`);
      row.dataset.tip = skillTip(k, v);
      skills.appendChild(row);
    }
    layout.append(me, skills);
    return layout;
  }

  private renderContainer() {
    const g = this.g;
    const c = this.container;
    if (!c) return;
    const items = c.kind === 'pile' ? c.items : (c.items ??= []);
    const body = el('div');
    const cap = c.kind === 'structure' ? STRUCTURES[c.type].container : c.kind === 'cart' ? vesselOf(c).capacity : undefined;
    const w = items.reduce((a, i) => a + itemDef(i.type).weight, 0);
    const held = el('div', 'inv-weight', `${items.length} items · ${w.toFixed(1)}${cap ? ` / ${cap}` : ''} kg`);
    held.dataset.tip = weightTip(items, cap, cap ? 'It holds no more than this.' : '');
    body.appendChild(held);
    const all = el('button', 'wide', 'Take everything you can carry');
    all.addEventListener('click', () => g.takeFromPile(c, [...items]));
    body.appendChild(all);
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const arr = groups.get(it.type) ?? [];
      arr.push(it);
      groups.set(it.type, arr);
    }
    for (const [, list] of groups) {
      list.sort((a, b) => b.ql - a.ql);
      const def = itemDef(list[0].type);
      const actions = def.noPickup ? [] : [
        { label: 'Take', fn: (it: Item) => g.takeFromPile(c, [it]) },
        ...(list.length > 1 ? [{ label: 'Take all', fn: () => g.takeFromPile(c, [...list]) }] : []),
      ];
      body.appendChild(this.itemRow(list, actions));
    }
    const title = c.kind === 'pile' ? 'Pile on the ground' : c.kind === 'cart' ? vesselOf(c).name : STRUCTURES[c.type].name;
    this.frame('container', title, body);
  }

  /**
   * The shipyard: the ship on the slip (how far on, and what the next step
   * needs), or, with the slip free, a ship to draw up: a medieval type to
   * start from, then its length, beam, planking, masts, rig, castles and deck,
   * with what she'll be like and everything she'll take to build.
   */
  /** At a ship's helm or aboard her: the wind (where it comes from, round her bow), her point of sailing, sail and speed. */
  private updateWindGauge(g: Game) {
    const k = g.boat?.ship ? g.boat : g.shipUnder();
    setStyle(this.windEl, 'display', k ? '' : 'none');
    if (!k?.ship) return;
    const w = g.windOn(k), d = k.ship.design, sail = k.ship.sail ?? 0, kn = (k.ship.speed ?? 0) * 1.944;
    // The arrow points from where the wind comes (round her, bow up), toward her.
    const arrow = this.windEl.querySelector('.wg-arrow') as SVGGElement;
    const deg = (w.rel * 180 / Math.PI).toFixed(1);
    if (arrow.getAttribute('transform') !== `rotate(${deg})`) arrow.setAttribute('transform', `rotate(${deg})`);
    // The arc she can't sail in (her rig's no-go zone, round her bow).
    const nogo = this.windEl.querySelector('.wg-nogo') as SVGPathElement, a = pointsTo(d.rig) * Math.PI / 180, r = 46;
    const arc = `M0,0 L${(-Math.sin(a) * r).toFixed(1)},${(-Math.cos(a) * r).toFixed(1)} A${r},${r} 0 0 1 ${(Math.sin(a) * r).toFixed(1)},${(-Math.cos(a) * r).toFixed(1)} Z`;
    if (nogo.getAttribute('d') !== arc) nogo.setAttribute('d', arc);
    const sailName = sail < -0.02 ? 'sails aback' : sail < 0.02 ? 'sails furled' : sail < 0.3 ? 'a little sail' : sail < 0.7 ? 'half sail' : sail < 0.97 ? 'most sail' : 'full sail';
    const drawing = sail > 0.02 ? ` · drawing ${Math.round(Math.min(1, w.drawing) * 100)}%` : '';
    const oars = shipStats(d).row && Math.abs(sail) > 0.02 ? ' · oars out' : '';
    setHTML(this.windEl.querySelector('.wg-text') as HTMLElement,
      `<b>${windName(w.strength)}</b> ${w.from} (${w.strength.toFixed(0)} m/s)<br>${w.point}<br>${sailName}${drawing}${oars}<br>${kn.toFixed(1)} knots${g.boat === k ? '' : ' · helm lashed'}`);
  }

  private renderShipyard() {
    const g = this.g, slip = this.slipObj;
    if (!slip) return;
    const body = el('div', 'shipyard');
    const onSlip = g.shipOn(slip);
    if (onSlip?.ship) {
      const s = onSlip.ship, d = s.design, total = totalSteps(d), n = nextStep(d, s.done);
      body.appendChild(el('div', 'build-desc', `On the slip: a <b>${esc(d.type.toLowerCase())}</b>, ${shipLength(d)} m. ${s.done} of ${total} steps done.`));
      const bar = el('div', 'ship-progress'); bar.appendChild(el('i')).setAttribute('style', `width:${(100 * s.done / total).toFixed(1)}%`); body.appendChild(bar);
      if (n) {
        body.appendChild(el('div', 'build-desc', `Next: <b>${esc(n.stage.name)}</b>${n.stage.steps > 1 ? ` (${n.index + 1} of ${n.stage.steps})` : ''}, with a ${esc(n.stage.tool)}. Aim at her to work.`));
        const mats = el('div', 'build-mats');
        for (const m of n.stage.per) { const have = g.inv.count(m.item); mats.appendChild(el('span', `mat-chip ${have >= m.count ? 'ok' : 'no'}`, `${itemIcon(m.item, 'chip-img')}<b>${m.count}</b> ${esc(itemDef(m.item).name.toLowerCase())} (${have})`)); }
        body.appendChild(mats);
      } else body.appendChild(el('div', 'build-desc', s.launching !== undefined ? 'She\'s going down the ways!' : 'She\'s finished. Aim at her and launch her!'));
      this.frame('shipyard', 'Shipyard', body);
      return;
    }
    const d = this.shipDraft, maxL = STRUCTURES[slip.type].slip ?? 26;
    settle(d);
    const st = shipStats(d), ok = allowed(d);
    const pick = (label: string, opts: [string, string][], cur: string, set: (v: string) => void) => {
      const row = el('div', 'ship-row');
      row.appendChild(el('span', 'ship-label', label));
      for (const [v, name] of opts) {
        const b = el('button', `ship-opt${v === cur ? ' on' : ''}`, name);
        b.addEventListener('click', () => { set(v); this.render('shipyard'); });
        row.appendChild(b);
      }
      body.appendChild(row);
    };
    // Where to start: the medieval types.
    const presets = el('div', 'ship-row');
    presets.appendChild(el('span', 'ship-label', 'Type'));
    for (const p of SHIP_PRESETS) {
      const big = shipLength(p.design) > maxL;
      const b = el('button', `ship-opt${p.design.type === d.type ? ' on' : ''}${big ? ' off' : ''}`, p.design.type);
      if (big) b.title = `Too long for this slip (${shipLength(p.design)} m): build a great slipway.`;
      b.addEventListener('click', () => { this.shipDraft = { ...p.design }; this.render('shipyard'); });
      presets.appendChild(b);
    }
    body.appendChild(presets);
    const blurb = SHIP_PRESETS.find((p) => p.design.type === d.type)?.blurb;
    if (blurb) body.appendChild(el('div', 'build-desc', esc(blurb)));
    pick('Length', [3, 4, 5, 6, 7, 8].filter((b) => b * 4 + 2 <= maxL).map((b) => [`${b}`, `${b * 4 + 2} m`]), `${Math.min(d.bays, Math.floor((maxL - 2) / 4))}`, (v) => { d.bays = +v; });
    if (shipLength(d) > maxL) body.appendChild(el('div', 'build-desc warn', `At ${shipLength(d)} m she's too long for this slip (it takes up to ${maxL} m): choose a shorter length, or build her on a great slipway.`));
    pick('Beam', [['narrow', 'Narrow'], ['medium', 'Medium'], ['broad', 'Broad']], d.beam, (v) => { d.beam = v as ShipDesign['beam']; });
    pick('Planking', [['clinker', 'Clinker'], ['carvel', 'Carvel']], d.build, (v) => { d.build = v as ShipDesign['build']; });
    pick('Masts', ok.masts.map((m) => [`${m}`, ['One', 'Two (main, mizzen)', 'Three (fore, main, mizzen)'][m - 1]]), `${d.masts}`, (v) => { d.masts = +v as ShipDesign['masts']; });
    pick('Rig', ok.rigs.map((r) => [r, r === 'square' ? 'Square sails' : r === 'lateen' ? 'Lateens' : 'Mixed (square, lateen mizzen)']), d.rig, (v) => { d.rig = v as ShipDesign['rig']; });
    pick('Deck', [['open', 'Open hold'], ['decked', 'Decked']], d.decked ? 'decked' : 'open', (v) => { d.decked = v === 'decked'; });
    pick('Castles', ok.castles.map((c) => [`${c}`, ['None', 'Sterncastle', 'Fore and aft', 'Great castles'][c]]), `${d.castles}`, (v) => { d.castles = +v as ShipDesign['castles']; });
    pick('Oars', [['no', 'Sail only'], ['yes', 'Oars too']], d.oars ? 'yes' : 'no', (v) => { d.oars = v === 'yes'; });
    const turning = st.turn > 0.3 ? 'nimble' : st.turn > 0.2 ? 'handy' : st.turn > 0.14 ? 'steady' : 'slow to turn';
    body.appendChild(el('div', 'ship-stats', `<span><b>${st.L} m</b> long, <b>${st.B.toFixed(1)} m</b> beam</span><span>Draws <b>${st.draft.toFixed(1)} m</b></span><span>Cargo <b>${(st.capacity / 1000).toFixed(1)} t</b></span><span>About <b>${st.knots} knots</b>, ${turning}</span><span>A crew of <b>${st.crew}</b>${st.oarsmen ? ` (${st.oarsmen} at the oars)` : ''}</span><span><b>${totalSteps(d)}</b> steps to build</span>`));
    const mats = el('div', 'build-mats');
    for (const [item, count] of Object.entries(shipMaterials(d))) {
      const have = g.inv.count(item);
      mats.appendChild(el('span', `mat-chip ${have >= count ? 'ok' : 'no'}`, `${itemIcon(item, 'chip-img')}<b>${count}</b> ${esc(itemDef(item).name.toLowerCase())}`));
    }
    body.appendChild(el('div', 'ship-label', 'She will take, in all (brought a stage at a time):'));
    body.appendChild(mats);
    const go = el('button', 'build-place', 'Lay her down');
    go.addEventListener('click', () => { if (g.layDownShip(slip, d)) this.close('shipyard'); });
    body.appendChild(go);
    this.frame('shipyard', 'Shipyard', body);
  }

  /** The village storehouse: its treasury, its work orders, and its goods to buy and sell. */
  private renderStore() {
    const g = this.g, s = this.storeObj;
    if (!s) return;
    const eco = g.economy, v = eco.villageOf(s);
    const body = el('div');
    if (!v) { body.appendChild(el('div', 'empty', 'This storehouse belongs to no village.')); this.frame('store', 'Storehouse', body); return; }
    const l = eco.ledger(v);
    const meals = eco.meals(v), pop = eco.population(v);
    body.appendChild(el('div', 'store-head',
      `<span>Your purse: <b>${fmtCoins(g.coins)}</b> coins</span><span>Village treasury: <b>${fmtCoins(l.treasury)}</b></span>`
      + `<span>Food: <b>${Math.floor(meals)}</b> meals for ${pop} people${meals < pop ? ' <span class="warn">(running short)</span>' : ''}${l.hungry ? ` · <span class="warn">${l.hungry} went hungry today</span>` : ''}</span>`));
    const btn = (label: string, tip: string, fn: () => void, off = false) => {
      const b = el('button', '', label);
      b.dataset.tip = tip;
      if (off) b.setAttribute('disabled', '');
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); this.refresh(); });
      return b;
    };
    // Work you've taken on here.
    const mine = eco.orders.filter((o) => o.village === `${v.cx},${v.cz}`);
    if (mine.length) {
      body.appendChild(el('h3', '', 'Your work orders'));
      for (const o of mine) {
        const have = g.inv.count(o.item);
        const row = el('div', 'item-row');
        row.innerHTML = `<span class="icon">${itemIcon(o.item)}</span><span class="name">${esc(itemDef(o.item).name)} <b>${o.delivered}/${o.count}</b>`
          + `<small>${o.each} coins each, +${o.bonus} when done · you have ${have}</small></span>`;
        const b = el('span', 'btns');
        b.append(
          btn('Deliver', `Hand over what you have (up to ${o.count - o.delivered}), and get paid.`, () => eco.sell(v, g.inv.ofType(o.item).slice(0, o.count - o.delivered)), have === 0),
          btn('Drop', 'Give up this work order.', () => eco.dropOrder(o)),
        );
        row.appendChild(b);
        body.appendChild(row);
      }
    }
    // What the village wants brought in.
    const open = eco.openOrders(v).slice(0, 8);
    body.appendChild(el('h3', '', 'Work wanted'));
    body.appendChild(el('div', 'hint', 'The village is short of these. Take on an order and bring them here: paid per item, with a bonus when it\'s done. It\'s the work its own people do, open to you.'));
    if (!open.length) body.appendChild(el('div', 'empty', 'Nothing wanted just now: the stores are full.'));
    for (const o of open) {
      const row = el('div', 'item-row');
      const who = o.job ? JOB_WORDS[o.job] : 'bought in from merchants (bring your own)';
      row.innerHTML = `<span class="icon">${itemIcon(o.item)}</span><span class="name">${o.count} × ${esc(itemDef(o.item).name)}`
        + `<small>${esc(who)} · ${o.each} coins each, +${o.bonus} bonus</small></span>`;
      const b = el('span', 'btns');
      b.append(btn('Take on', 'Take on this work order. Your work orders are listed in the quest log (J).', () => eco.takeOrder(o)));
      row.appendChild(b);
      body.appendChild(row);
    }
    // Goods: what's in store, what it wants, what it pays and asks.
    body.appendChild(el('h3', '', 'Goods'));
    body.appendChild(el('div', 'hint', 'Prices follow supply and demand: what the village is short of, it pays well for (and charges well for).'));
    const goods = Object.keys(GOODS).sort((a, b) => itemDef(a).name.localeCompare(itemDef(b).name));
    for (const item of goods) {
      const stock = eco.stock(v, item), want = eco.want(v, item), have = g.inv.count(item);
      if (!stock && !have) continue;
      const buy = eco.price(v, item, 'buy'), sell = eco.price(v, item, 'sell');
      const row = el('div', 'item-row');
      row.innerHTML = `<span class="icon">${itemIcon(item)}</span><span class="name">${esc(itemDef(item).name)} <b>${stock}</b><small>wants ${want} · buy ${buy} · sells to it for ${sell}${have ? ` · you have ${have}` : ''}</small></span>`;
      const b = el('span', 'btns');
      b.append(
        btn(`Buy (${buy})`, `Buy one for ${buy} coins.`, () => eco.buy(v, item), !stock || g.coins < buy),
        btn('Sell 1', `Sell one for ${sell} coins.`, () => eco.sell(v, g.inv.ofType(item).slice(-1)), !have),
        btn('Sell all', `Sell all ${have} for about ${fmtCoins(sell * have)} coins.`, () => eco.sell(v, g.inv.ofType(item)), have < 2),
      );
      row.appendChild(b);
      body.appendChild(row);
    }
    this.frame('store', `${esc(v.name)} storehouse`, body);
  }

  private recipeRow(r: Recipe): HTMLElement {
    const g = this.g;
    const tool = g.toolFor(r.tool);
    const problem = craftProblem(g, r, tool);
    const row = el('div', `recipe${problem ? ' blocked' : ''}`);
    const out = itemDef(r.output.item);
    const inputs = r.inputs.map((i) => {
      const have = g.usableCount(i.item);
      return `<span class="${have >= i.count ? 'ok' : 'no'}">${itemDef(i.item).icon} ${i.count} ${esc(itemDef(i.item).name.toLowerCase())} (${have})</span>`;
    }).join(' ');
    const reqs: string[] = [];
    if (r.tool) reqs.push(`<span class="${tool ? 'ok' : 'no'}">tool: ${r.tool}${tool ? ` (${esc(itemName(tool))})` : ''}</span>`);
    for (const s of r.stations ?? []) reqs.push(`<span class="${g.stationNear(s) ? 'ok' : 'no'}">near ${STATION_NAMES[s]}</span>`);
    for (const k of r.needs ?? []) {
      const t = g.toolFor(k);
      reqs.push(`<span class="${t ? 'ok' : 'no'}">in pack: ${TOOL_NAMES[k]}${t ? ` (${esc(itemName(t))})` : ''}</span>`);
    }
    row.dataset.tip = `<b>${esc(r.name)}</b><br>${esc(out.desc)}<br><span class="tip-facts">${SKILLS[r.skill]}: ${esc(SKILL_INFO[r.skill])}${problem ? `<br>${esc(problem)}` : ''}</span>`;
    const lvl = g.skills.get(r.skill);
    const chance = Math.round(g.skills.successChance(r.skill, r.difficulty, tool?.ql ?? 0) * 100);
    row.innerHTML = `
      <div class="recipe-head"><span class="icon">${itemIcon(r.output.item)}</span><b>${esc(r.name)}</b>${r.output.count > 1 ? ` ×${r.output.count}` : ''}
        <small>${SKILLS[r.skill]} ${lvl.toFixed(1)} · difficulty ${r.difficulty}${RECIPE_MINIGAMES[r.id] ? ` · hands-on: ${minigameVerb(RECIPE_MINIGAMES[r.id])}` : ` · ~${chance}% success`}</small></div>
      <div class="recipe-in">${inputs}</div>
      ${reqs.length ? `<div class="recipe-req">${reqs.join(' · ')}</div>` : ''}`;
    const btns = el('div', 'btns');
    for (const n of [1, 5]) {
      const b = el('button', '', `Craft ×${n}`);
      b.disabled = !!problem;
      b.addEventListener('click', () => g.craft(r, n));
      btns.appendChild(b);
    }
    // Once you've mastered it, skip the hands-on work at a quality cost.
    if (RECIPE_MINIGAMES[r.id]) {
      const quick = el('button', 'quick', 'Quick ×5');
      const ok = g.canQuick(r.skill, r.difficulty);
      quick.disabled = !!problem || !ok;
      quick.title = ok ? 'Skip the hands-on work. Lower quality.' : `Unlocks at ${SKILLS[r.skill]} ${r.difficulty + QUICK_MARGIN}`;
      quick.addEventListener('click', () => g.craft(r, 5, true));
      btns.appendChild(quick);
    }
    row.appendChild(btns);
    if (problem) row.title = problem;
    return row;
  }

  private renderCrafting() {
    const body = el('div');
    const cats = [...new Set(RECIPES.map((r) => r.category))];
    const tabs = el('div', 'tabs');
    for (const c of cats) {
      const b = el('button', c === this.craftCategory ? 'on' : '', c);
      b.addEventListener('click', () => { this.craftCategory = c; this.renderCrafting(); });
      tabs.appendChild(b);
    }
    body.appendChild(tabs);
    body.appendChild(el('div', 'craft-intro', `
      <b>Crafting is hands-on.</b> When you craft, the view moves to the workstation and you do the job yourself with the mouse — sawing, hammering, twisting, stirring.
      <ul>
        <li>The first time you try each kind of work you get a short guide and an extra-forgiving practice run.</li>
        <li><b>How well you do</b> sets most of the quality. Your <b>skill</b> makes the work easier and limits how good the result can be; better <b>tools and materials</b> help too.</li>
        <li><b>Right-click</b> stops working. Once you're skilled at something, <b>Quick ×5</b> skips the hands-on part for slightly lower quality.</li>
      </ul>`));
    for (const r of RECIPES.filter((r) => r.category === this.craftCategory)) body.appendChild(this.recipeRow(r));
    this.frame('crafting', 'Crafting', body);
  }

  private renderSkills() {
    const g = this.g;
    const rows = (Object.keys(SKILLS) as SkillId[]).map((k) => {
      const v = g.skills.get(k);
      return `<div class="skill" data-tip="${escAttr(skillTip(k, v))}"><span>${SKILLS[k]}</span><div class="skill-bar"><div style="width:${v}%"></div></div><b>${v.toFixed(2)}</b></div>`;
    }).join('');
    this.frame('skills', 'Skills', `<div class="hint">Skills rise slowly through use, fastest on tasks close to your level.</div>${rows}`);
  }

  private renderBuild() {
    const g = this.g;
    const body = el('div');
    body.appendChild(el('div', 'hint', 'Choose a piece: an outline follows your aim and snaps to nearby floors, walls and roofs. Left-click to place it (you can keep placing more), use the wheel or Q/E to rotate, and right-click to stop. Then aim at a placed outline with the right tool and click to build it.'));
    const cats = [...new Set(BUILDABLE.map((d) => d.category))];
    for (const cat of cats) {
      body.appendChild(el('h3', '', cat));
      const grid = el('div', 'build-grid');
      for (const def of BUILDABLE.filter((d) => d.category === cat)) {
        const card = el('div', 'build-card');
        // What it needs, as pictures: green when you have enough, red when you don't.
        let ready = true;
        const mats = def.materials.map((m) => {
          const have = g.inv.count(m.item);
          if (have < m.count) ready = false;
          return `<span class="mat-chip ${have >= m.count ? 'ok' : 'no'}" data-tip="${escAttr(`<b>${itemDef(m.item).name}</b>: you have ${have}, need ${m.count}`)}">${itemIcon(m.item, 'chip-img')}<b>${m.count}</b> ${esc(itemDef(m.item).name.toLowerCase())}</span>`;
        }).join('');
        const tool = def.tool ? g.toolFor(def.tool) : undefined;
        if (def.tool && !tool) ready = false;
        const { min, max } = pieceBounds(def);
        const size = `${(max.x - min.x).toFixed(1)} × ${(max.z - min.z).toFixed(1)} m, ${(max.y - min.y).toFixed(1)} m tall`.replace(/\.0/g, '');
        const lvl = g.skills.get(def.skill);
        card.innerHTML = `
          <div class="build-pic">${pieceIcon(def.id, def.icon)}</div>
          <div class="build-info">
            <div class="build-name">${def.name}${ready ? '<span class="build-ready">Ready to build</span>' : ''}</div>
            <div class="build-desc">${esc(def.desc)}</div>
            <div class="build-mats">${mats}</div>
            <div class="build-meta">
              ${def.tool ? `<span class="${tool ? 'ok' : 'no'}">Tool: ${def.tool}${tool ? '' : ' (you have none)'}</span>` : '<span class="ok">No tool needed</span>'}
              <span data-tip="Your ${SKILLS[def.skill]} skill against how hard this is to build. Below the difficulty, the work is less forgiving.">${SKILLS[def.skill]} ${Math.floor(lvl)} · difficulty ${def.difficulty}</span>
              <span>${size}</span>
              <span>${def.snap ? 'Snaps to other pieces' : 'Freestanding'}</span>
            </div>
          </div>`;
        const b = el('button', 'build-place', 'Place');
        b.dataset.tip = 'Pick it up as an outline to place in the world. Then build it with the materials above.';
        b.addEventListener('click', () => {
          g.startPlacing(def);
          this.close('build');
        });
        card.appendChild(b);
        grid.appendChild(card);
      }
      body.appendChild(grid);
    }
    this.frame('build', 'Build', body);
  }

  private renderDev() {
    const g = this.g;
    const body = el('div', 'dev');
    body.appendChild(el('div', 'hint', 'Cheats for testing. Toggles are remembered in this browser and apply to every world. Press <b>`</b> or <b>F2</b> to open or close.'));

    // The debug report: what the game logged, repaired and counted, this session and last.
    body.appendChild(el('h3', '', 'Debug report'));
    const errs = telemetry.errors, heals = [...telemetry.counters].filter(([k]) => k.startsWith('heal:')).reduce((n, [, v]) => n + v, 0);
    body.appendChild(el('div', 'hint', `This session: ${telemetry.entries.length} log entries, <b>${errs}</b> error(s), <b>${heals}</b> automatic repair(s).${telemetry.previous ? ` Previous session ${telemetry.previous.cleanExit ? 'ended normally' : '<b>ended unexpectedly</b>'}.` : ''} Send the report along with any bug you hit.`));
    const recent = telemetry.entries.filter((e) => e.level !== 'event' || e.cat === 'quest').slice(-8).reverse();
    if (recent.length) body.appendChild(el('div', 'dev-log', recent.map((e) => `<div class="dev-log-${e.level}"><span>${e.t.toFixed(0)}s</span> <b>${e.level}</b> ${esc(e.cat)}: ${esc(e.msg)}</div>`).join('')));
    const report = () => JSON.stringify(telemetry.report({ player: { pos: g.player.pos.toArray().map((v) => +v.toFixed(2)), riding: !!g.riding, working: g.working?.def.id ?? null, action: g.action?.def.id ?? null }, perf: { fps: perf.fps, worst: Math.round(perf.worst), average: perf.average.slice(0, 8) } }), null, 1);
    const repRow = el('div', 'dev-time');
    repRow.append(
      this.devButton('Download report', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([report()], { type: 'application/json' }));
        a.download = `survivalcrafter-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }),
      this.devButton('Copy report', () => { navigator.clipboard?.writeText(report()).then(() => this.log('Debug report copied.', 'info'), () => this.log('Couldn\'t copy: use Download instead.', 'fail')); }),
      this.devButton('Run repairs now', () => { const n = g.selfHeal('asked from the dev console', true); this.log(n ? `Repaired ${n} problem(s): see the report.` : 'Nothing needed repairing.', 'info'); this.refresh(); }),
    );
    body.appendChild(repRow);

    body.appendChild(el('h3', '', 'Toggles'));
    const grid = el('div', 'dev-toggles');
    for (const [key, f] of Object.entries(DEV_FLAGS) as [DevFlag, { label: string; desc: string }][]) {
      const row = el('label', 'dev-toggle');
      row.title = f.desc;
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = g.dev.on(key);
      cb.addEventListener('change', () => {
        g.dev.set(key, cb.checked);
        this.log(`[dev] ${f.label} ${cb.checked ? 'on' : 'off'}.`, 'info');
      });
      row.append(cb, el('span', '', `${f.label}<small>${esc(f.desc)}</small>`));
      grid.appendChild(row);
    }
    body.appendChild(grid);

    body.appendChild(el('h3', '', 'Time'));
    const timeRow = el('div', 'dev-row');
    timeRow.appendChild(el('span', '', 'Speed'));
    // (Buttons, not a dropdown: the in-game cursor can't open a browser's own menus.)
    for (const [v, label] of [[0, 'Frozen'], [1, 'Normal'], [5, '5×'], [20, '20×'], [100, '100×']] as [number, string][]) {
      const b = this.devButton(label, () => { g.dev.setTimeScale(v); this.log(`[dev] Time speed: ${label}.`, 'info'); this.refresh(); });
      if (g.dev.timeScale === v) b.classList.add('dev-on');
      timeRow.appendChild(b);
    }
    for (const [label, f] of [['Dawn', 0.25], ['Noon', 0.5], ['Dusk', 0.77], ['Midnight', 0]] as [string, number][]) {
      timeRow.appendChild(this.devButton(label, () => devCommands.setTime(g, f)));
    }
    body.appendChild(timeRow);

    body.appendChild(el('h3', '', 'Give item'));
    // Pick an item from the grid (filtered by kind), set how many and how good, and Give.
    const kinds: [string, (d: typeof ITEMS[string]) => boolean][] = [
      ['All', () => true], ['Tools', (d) => !!d.tool], ['Food', (d) => !!d.food], ['Wearables', (d) => !!d.wear],
      ['Materials', (d) => !d.tool && !d.food && !d.wear && !d.places], ['Placeables', (d) => !!d.places],
    ];
    const kindRow = el('div', 'dev-row');
    for (const [k] of kinds) {
      const b = this.devButton(k, () => { this.devGive.kind = k; this.refresh(); });
      if (this.devGive.kind === k) b.classList.add('dev-on');
      kindRow.appendChild(b);
    }
    body.appendChild(kindRow);
    const filter = kinds.find(([k]) => k === this.devGive.kind)?.[1] ?? (() => true);
    const gridItems = el('div', 'dev-items');
    for (const d of Object.values(ITEMS).filter(filter).sort((a, b) => a.name.localeCompare(b.name))) {
      const b = el('button', d.id === this.devGive.type ? 'dev-on' : '', `${itemIcon(d.id, 'chip-img')} ${esc(d.name)}`);
      b.addEventListener('click', () => { this.devGive.type = d.id; this.refresh(); });
      gridItems.appendChild(b);
    }
    body.appendChild(gridItems);
    const giveRow = el('div', 'dev-row');
    giveRow.append(
      el('span', '', `<b>${esc(itemDef(this.devGive.type).name)}</b>`),
      el('span', '', 'Count'), this.devStepper(this.devGive.count, 1, 500, (v) => { this.devGive.count = v; }),
      el('span', '', 'QL'), this.devStepper(this.devGive.ql, 1, 100, (v) => { this.devGive.ql = v; }),
      this.devButton('Give', () => { devCommands.give(g, this.devGive.type, this.devGive.count, this.devGive.ql); this.log(`[dev] Gave ${this.devGive.count} × ${itemDef(this.devGive.type).name} (QL ${this.devGive.ql}).`, 'good'); }),
    );
    body.appendChild(giveRow);

    body.appendChild(el('h3', '', 'Player &amp; world'));
    const skillRow = el('div', 'dev-row');
    skillRow.append(el('span', '', 'All skills to'), this.devStepper(this.devSkill, 1, 99, (v) => { this.devSkill = v; }),
      this.devButton('Set', () => devCommands.setSkills(g, this.devSkill)));
    body.appendChild(skillRow);
    const misc = el('div', 'dev-row');
    misc.append(
      this.devButton('Refill needs', () => devCommands.refill(g)),
      this.devButton('Teleport home', () => devCommands.teleportHome(g)),
      this.devButton('Teleport to village', () => devCommands.teleportVillage(g)),
      this.devButton('Teleport to town', () => devCommands.teleportVillage(g, 'town')),
      this.devButton('Teleport to castle', () => devCommands.teleportVillage(g, 'city')),
      this.devButton('Teleport to port', () => devCommands.teleportVillage(g, 'port')),
      this.devButton('Grow everything', () => devCommands.growEverything(g)),
      this.devButton('Spawn deer', () => devCommands.spawnAnimal(g, 'deer')),
      this.devButton('Spawn boar', () => devCommands.spawnAnimal(g, 'boar')),
      this.devButton('Spawn horse', () => devCommands.spawnAnimal(g, 'horse')),
      this.devButton('Spawn ox', () => devCommands.spawnAnimal(g, 'ox')),
      this.devButton('Clear inventory', () => devCommands.clearInventory(g)),
    );
    body.appendChild(misc);
    this.frame('dev', 'Dev console', body);
  }

  private devButton(label: string, fn: () => void): HTMLButtonElement {
    const b = el('button', '', label);
    b.addEventListener('click', fn);
    return b;
  }

  /** A number set with −/+ buttons (works with the in-game cursor, unlike a typed field). */
  private devStepper(value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
    const box = el('span', 'dev-stepper');
    let v = value;
    const show = el('b', '', String(v));
    const step = (d: number) => this.devButton(d > 0 ? `+${d}` : String(d), () => { v = Math.max(min, Math.min(max, v + d)); show.textContent = String(v); onChange(v); });
    box.append(step(-10), step(-1), show, step(1), step(10));
    return box;
  }

  /** Your quests: ones offered to take up, ones under way (tracked on screen or not), and ones done. */
  /** The quest being walked through (accepted, now to be pointed out), on your first time in the quest log. */
  private coachQuest: string | null = null;

  private renderQuests() {
    const g = this.g, log = g.quests;
    const body = el('div');
    body.appendChild(el('div', 'hint', 'You can have multiple quests active. <b>Track</b> the one you\'re working on to mark its objectives in the world. <b>Pinned</b> quests show in the panel on screen; unpin one to hide it (you keep your progress).'));
    // Village work orders you've taken on.
    if (g.economy.orders.length) {
      body.appendChild(el('h3', '', 'Village work orders'));
      for (const o of g.economy.orders) {
        body.appendChild(el('div', 'quest-row quest-active', `<div class="quest-row-head"><b>${o.count} × ${esc(itemDef(o.item).name)} for ${esc(o.villageName)}</b> <small>${o.delivered}/${o.count} delivered</small></div>`
          + `<div class="quest-summary">Bring them to ${esc(o.villageName)}'s storehouse (Trade and work orders). ${o.each} coins each, +${o.bonus} when done. You have ${g.inv.count(o.item)}.</div>`));
      }
    }
    if (!log || !log.quests.length) {
      body.appendChild(el('div', 'quest-none', 'No quests yet.'));
      this.frame('quests', 'Quests', body);
      return;
    }
    const button = (label: string, tip: string, fn: () => void, cls = '') => {
      const b = el('button', cls, label);
      b.dataset.tip = tip;
      b.addEventListener('click', () => { fn(); this.refresh(); });
      return b;
    };
    // Your first time here with a new quest: walk through taking it up and pointing it out.
    const coaching = g.tips.has('quest_intro') && !g.tips.has('quest_coached');
    const coach = (row: HTMLElement, b: HTMLElement, step: number, html: string) => {
      b.classList.add('coach-pulse');
      const c = el('div', 'quest-coach', `<b>Step ${step} of 2.</b> ${html}`);
      row.appendChild(c);
    };
    const section = (title: string, list: typeof log.quests) => {
      if (!list.length) return;
      body.appendChild(el('h3', '', title));
      for (const q of list) {
        const d = log.def(q);
        const row = el('div', `quest-row quest-${q.status}${q === log.focused ? ' quest-focused' : ''}`);
        let html = `<div class="quest-row-head"><b>${d.title}</b>`;
        if (q.status === 'active') html += ` <small>step ${Math.min(q.step + 1, d.steps.length)} of ${d.steps.length}</small>`;
        if (q === log.focused) html += ' <span class="quest-tag">◎ Tracking</span>';
        html += `</div><div class="quest-summary">${d.summary}</div>`;
        if (q.status === 'active') {
          // The steps: done, the one you're on (with its progress), still to come.
          html += '<ol class="quest-steps">';
          // (A long quest shows where you are: the last step done, this one, and the next two.)
          d.steps.forEach((st, i) => {
            if (i < q.step - 1 || i > q.step + 2) return;
            if (i < q.step) html += `<li class="done" value="${i + 1}">${st.title}</li>`;
            else if (i === q.step) {
              const pr = log.progressOf(g, q);
              html += `<li class="now" value="${i + 1}">${st.title}${Array.isArray(pr) ? ` <small>(${pr[0]} / ${pr[1]})</small>` : ''}<div class="quest-step-text">${st.text}</div></li>`;
            } else html += `<li class="later" value="${i + 1}">${st.title}</li>`;
          });
          html += '</ol>';
          const more = d.steps.length - (q.step + 3);
          if (more > 0) html += `<div class="quest-more">…and ${more} more step${more > 1 ? 's' : ''}</div>`;
        } else if (q.status === 'done') {
          html += `<div class="quest-outro">${d.outro.text}</div>`;
        }
        row.innerHTML = html;
        const btns = el('div', 'btns');
        let coachOn: [HTMLElement, number, string] | null = null;
        if (q.status === 'offered') {
          const accept = button('Accept', 'Take up this quest (it is pinned on screen)', () => { log.accept(q.id); if (coaching) this.coachQuest = q.id; });
          btns.append(accept, button('Accept, don\'t pin', 'Take it up but keep it out of the panel for now', () => log.accept(q.id, false)));
          if (coaching && !this.coachQuest) coachOn = [accept, 1, '<b>Accept</b> takes up the quest. It\'s pinned to the panel on the right.'];
        } else if (q.status === 'active') {
          btns.append(q.tracked
            ? button('Unpin', 'Take it off the panel on screen (it keeps its progress)', () => log.setTracked(q.id, false))
            : button('Pin', 'Show it in the panel on screen', () => log.setTracked(q.id, true)));
          if (q !== log.focused) {
            const point = button('Track', 'Mark its targets in the world (one quest is tracked at a time)', () => {
              log.focus(q.id);
              if (coaching && this.coachQuest === q.id) {
                g.tips.add('quest_coached');
                this.coachQuest = null;
                this.log(`Now tracking: ${d.title}. Follow the blue rings and the arrow. To switch back, open your quests (L) and track another one.`, 'good');
              }
            });
            btns.append(point);
            if (coaching && this.coachQuest === q.id) coachOn = [point, 2, `<b>Track</b> it to mark its targets in the world (blue rings and an arrow). You track one quest at a time; your house waits until you switch back.`];
          }
        }
        if (btns.childElementCount) row.appendChild(btns);
        if (coachOn) coach(row, coachOn[0], coachOn[1], coachOn[2]);
        body.appendChild(row);
      }
    };
    section('New', log.quests.filter((q) => q.status === 'offered'));
    // (The quest being walked through comes first, where you'll see it.)
    section('Under way', log.quests.filter((q) => q.status === 'active').sort((a, b) => +(b.id === this.coachQuest) - +(a.id === this.coachQuest)));
    section('Done', log.quests.filter((q) => q.status === 'done'));
    this.frame('quests', 'Quests', body);
  }

  private renderJournal() {
    const g = this.g;
    const species = Object.keys(IDENTIFY);
    const known = species.filter((t) => isIdentified(t)).length;
    const groups: [string, string[]][] = [
      ['Mushrooms', species.filter((t) => ['mushroom', 'chanterelle', 'red_cap', 'pale_cap'].includes(t))],
      ['Herbs & wild plants', species.filter((t) => !['mushroom', 'chanterelle', 'red_cap', 'pale_cap'].includes(t))],
    ];
    const where = (t: string) => (g.knowledge.seen[t]?.biomes ?? []).map((b) => BIOME_NAMES[b]).join(', ');
    let html = `<div class="hint">Every wild species you have come across. Identify them by picking with care, by studying them, or by handling enough of them. ${known}/${species.length} identified.</div>`;
    for (const [title, list] of groups) {
      html += `<h3>${title}</h3>`;
      for (const t of list) {
        const d = itemDef(t);
        const seen = g.knowledge.seen[t];
        if (isIdentified(t)) {
          const danger = d.food?.effect === 'nausea' || d.food?.effect === 'poison' || d.food?.effect === 'severe_poison';
          html += `<div class="journal-entry"><div><span class="icon">${d.icon}</span><b>${esc(d.name)}</b>${danger ? ' <span class="bad">poisonous</span>' : ''}</div>
            <div class="journal-look">${esc(d.unknownName ?? '')}${seen ? ` · found on ${where(t)} (${seen.count} picked)` : ''}</div>
            <div>${esc(d.desc)}</div></div>`;
        } else if (seen) {
          html += `<div class="journal-entry unknown"><div><span class="icon">${d.icon}</span><b>${esc(d.unknownName ?? '?')}</b> <small>unidentified</small></div>
            <div class="journal-look">Found on ${where(t)} (${seen.count} picked). Study it from your inventory to learn what it is.</div></div>`;
        } else {
          html += `<div class="journal-entry missing"><span class="icon">❔</span> Not yet found</div>`;
        }
      }
    }
    this.frame('journal', 'Field journal', html);
  }

  private renderHelp() {
    const replay = el('button', 'wide', 'Replay the crafting guides');
    replay.addEventListener('click', () => {
      this.g.tutorials.reset();
      replay.textContent = 'Done \u2014 each kind of work will show its guide again';
    });
    this.frame('help', 'Survival guide', GUIDE_HTML);
    this.windows.get('help')!.querySelector('.window-body')!.appendChild(replay);
  }
}

/** Ask the player for a save file. */
export function pickFile(then: (file: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gz,.json,application/json,application/gzip';
  input.onchange = () => { const f = input.files?.[0]; if (f) then(f); };
  input.click();
}

/** Hover text for an item: what it is, its quality and weight, and what it does. */
function itemTip(it: Item, count: number): string {
  const d = itemDef(it.type);
  const lines = [`<b>${esc(itemName(it))}</b>${count > 1 ? ` ×${count}` : ''}`, esc(typeDesc(it.type))];
  const facts = [`QL ${it.ql.toFixed(1)}`, `${(d.weight * count).toFixed(1)} kg`];
  if (d.tool) facts.push(`${TOOL_NAMES[d.tool]}${d.toolPower ? `, power ${d.toolPower}` : ''}`);
  if (d.damage) facts.push(`${d.damage} damage`);
  if (d.wear) facts.push(`worn on the ${d.wear.slot}, takes ${Math.round(d.wear.armor * (0.6 + it.ql / 125) * 100)}% of a blow`);
  if (d.food) facts.push(`${d.food.nutrition} food${d.food.water ? `, ${d.food.water} water` : ''}`);
  if (d.fuel) facts.push(`burns ${Math.round(d.fuel / 60)} min`);
  if (d.tool && it.dmg > 0) facts.push(`worn ${it.dmg.toFixed(0)}%`);
  lines.push(`<span class="tip-facts">${facts.join(' · ')}</span>`);
  return lines.join('<br>');
}

/** Hover text for a skill: what it does, and where you are with it. */
function skillTip(k: SkillId, v: number): string {
  const stage = v < 10 ? 'Novice' : v < 25 ? 'Apprentice' : v < 50 ? 'Journeyman' : v < 75 ? 'Expert' : 'Master';
  return `<b>${SKILLS[k]}</b> · ${v.toFixed(2)} (${stage})<br>${SKILL_INFO[k]}<br><span class="tip-facts">Rises with use, fastest on work close to your level. Higher skill: faster work, fewer failures, better quality.</span>`;
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** Hover text for a load: what weighs the most, heaviest first. */
function weightTip(items: Item[], cap: number | undefined, capNote: string): string {
  const by = new Map<string, { n: number; kg: number }>();
  let total = 0;
  for (const it of items) {
    const kg = itemDef(it.type).weight;
    const e = by.get(it.type) ?? { n: 0, kg: 0 };
    e.n++; e.kg += kg; total += kg;
    by.set(it.type, e);
  }
  if (!total) return '<b>Weight</b><br>Nothing here yet.';
  const rows = [...by].sort((a, b) => b[1].kg - a[1].kg);
  const top = rows.slice(0, 6), rest = rows.slice(6).reduce((a, [, e]) => a + e.kg, 0);
  const line = (name: string, kg: number) => `<div class="wt-row"><span>${name}</span><b>${kg.toFixed(1)} kg</b><i style="width:${Math.max(2, (kg / total) * 100)}%"></i></div>`;
  return `<b>Weight</b> · ${total.toFixed(1)}${cap ? ` / ${cap}` : ''} kg${cap ? ` (${Math.round((total / cap) * 100)}%)` : ''}
    ${top.map(([type, e]) => line(`${esc(itemDef(type).name)}${e.n > 1 ? ` ×${e.n}` : ''}`, e.kg)).join('')}
    ${rest > 0 ? line(`${rows.length - 6} other kinds`, rest) : ''}
    ${capNote ? `<span class="tip-facts">${capNote}</span>` : ''}`;
}

// ---------- touching the page only when something changes
function setText(e: HTMLElement, v: string) { if (e.textContent !== v) e.textContent = v; }
const htmlCache = new WeakMap<HTMLElement, string>();
function setHTML(e: HTMLElement, v: string) { if (htmlCache.get(e) !== v) { htmlCache.set(e, v); e.innerHTML = v; } }
function setStyle(e: HTMLElement, prop: 'width' | 'display', v: string) { if (e.style[prop] !== v) e.style[prop] = v; }
function setData(e: HTMLElement, key: string, v: string) { if (e.dataset[key] !== v) e.dataset[key] = v; }
/** Identity of what's aimed at (its kind and which one). */
function targetKey(t: Target): string {
  switch (t.kind) {
    case 'object': return `o${t.obj.id}`;
    case 'animal': return `a${t.animal.id}`;
    case 'rock': return `r${t.rock.key}`;
    case 'cart': return `c${t.cart.id}`;
    case 'terrain': return `t${t.mat}`;
    default: return t.kind;
  }
}
