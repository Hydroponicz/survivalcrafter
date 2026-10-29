import { ITEMS, itemDef, itemName, type Item } from '../data/items';
import { RECIPES, STATION_NAMES, type Recipe } from '../data/recipes';
import { SKILLS, type SkillId } from '../data/skills';
import { STRUCTURE_LIST, STRUCTURES, totalMaterials } from '../data/structures';
import { craftProblem, type ActionDef, type Ctx, type Target } from '../game/actions';
import { DEV_FLAGS, devCommands, type DevFlag } from '../game/dev';
import type { Game, MsgKind } from '../game/game';
import { CARRY_CAPACITY } from '../game/inventory';
import { TILE_NAMES } from '../world/terrain';
import { ANIMALS, type PileObj, type StructureObj } from '../world/world';

type WindowName = 'inventory' | 'crafting' | 'skills' | 'build' | 'help' | 'container' | 'dev';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

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
  private statusEl: HTMLElement;
  private logEl: HTMLElement;
  private menuEl: HTMLElement;
  private pauseEl: HTMLElement;
  private deathEl: HTMLElement;
  private damageEl: HTMLElement;
  private container: StructureObj | PileObj | null = null;
  private craftCategory = 'Primitive';
  private expanded = new Set<string>();
  private refreshTimer = 0;
  private lastRefreshKey = '';
  private devGive = { type: 'log', count: 10, ql: 50 };
  private devSkill = 50;

  constructor(private g: Game) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = '';
    const hud = el('div', 'hud');
    hud.innerHTML = `
      <div class="crosshair"></div>
      <div class="target"><div class="target-name"></div><div class="target-hint"></div></div>
      <div class="progress"><div class="progress-label"></div><div class="progress-bar"><div class="progress-fill"></div></div></div>
      <div class="clock"></div>
      <div class="status"></div>
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
    this.statusEl = hud.querySelector('.status')!;
    this.logEl = hud.querySelector('.log')!;
    const bars = hud.querySelector('.bars')!;
    for (const [k, label] of [['health', 'Health'], ['food', 'Food'], ['water', 'Water'], ['stamina', 'Stamina']]) {
      const b = el('div', `bar bar-${k}`, `<span>${label}</span><div class="bar-fill"></div>`);
      bars.appendChild(b);
      this.bars[k] = b.querySelector('.bar-fill')!;
    }

    for (const name of ['inventory', 'crafting', 'skills', 'build', 'help', 'container', 'dev'] as WindowName[]) {
      const w = el('div', `window window-${name}`);
      w.style.display = 'none';
      w.addEventListener('mousedown', (e) => e.stopPropagation());
      this.root.appendChild(w);
      this.windows.set(name, w);
    }

    this.menuEl = el('div', 'context-menu');
    this.menuEl.style.display = 'none';
    this.root.appendChild(this.menuEl);

    this.pauseEl = el('div', 'pause', `
      <div class="pause-box">
        <h2>Paused</h2>
        <p>Click to return to the wilderness</p>
        <div class="pause-buttons">
          <button data-act="resume">Resume</button>
          <button data-act="save">Save game</button>
          <button data-act="help">Controls &amp; guide</button>
          <button data-act="new" class="danger">Abandon world</button>
        </div>
      </div>`);
    this.pauseEl.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (act === 'save') { g.save(); this.log('Game saved.', 'good'); return; }
      if (act === 'help') { this.toggle('help'); return; }
      if (act === 'new') {
        if (confirm('Abandon this world and start a new one? Your save will be deleted.')) {
          g.abandon();
        }
        return;
      }
      g.input.lock();
    });
    this.root.appendChild(this.pauseEl);
    this.deathEl = el('div', 'death', '<h1>You have died</h1><p>You wake at your home. Your belongings lie where you fell.</p>');
    this.root.appendChild(this.deathEl);
    this.damageEl = el('div', 'damage');
    this.root.appendChild(this.damageEl);

    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('mousedown', (e) => {
      if (this.menuOpen && !this.menuEl.contains(e.target as Node)) this.closeMenu();
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

  show(name: WindowName) {
    this.open.add(name);
    this.windows.get(name)!.style.display = 'flex';
    this.g.input.unlock();
    this.render(name);
  }

  close(name: WindowName) {
    this.open.delete(name);
    this.windows.get(name)!.style.display = 'none';
    if (name === 'container') this.container = null;
    if (name === 'inventory') this.hoveredItem = null;
    if (!this.anyWindowOpen()) this.wantsRelock = true;
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

  openContainer(o: StructureObj | PileObj) {
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
    this.g.input.unlock();
  }

  closeMenu() {
    this.menuEl.style.display = 'none';
    this.menuOpen = false;
    if (!this.anyWindowOpen()) this.wantsRelock = true;
  }

  describeTarget(t: Target): string {
    const g = this.g;
    switch (t.kind) {
      case 'tile': {
        const tt = g.world.terrain.tileType(t.tx, t.tz);
        const crop = g.world.crops.get(t.tz * g.world.terrain.size + t.tx);
        return `${TILE_NAMES[tt]}${crop ? ' (wheat)' : ''}`;
      }
      case 'water': return 'Water';
      case 'animal': return ANIMALS[t.animal.species].name;
      case 'none': return '';
      case 'object': {
        const o = t.obj;
        if (o.kind === 'tree') return `${o.species[0].toUpperCase()}${o.species.slice(1)} tree${o.age < 0.3 ? ' (young)' : ''}`;
        if (o.kind === 'bush') return o.ripe ? 'Berry bush (ripe)' : 'Berry bush';
        if (o.kind === 'pile') {
          const corpse = o.items.find((i) => i.type === 'corpse');
          if (corpse) return itemName(corpse)[0].toUpperCase() + itemName(corpse).slice(1);
          return o.items.length === 1 ? itemName(o.items[0]) : `Pile of ${o.items.length} items`;
        }
        const def = STRUCTURES[o.type];
        if (!o.built) {
          const done = Object.values(o.consumed).reduce((a, b) => a + b, 0);
          return `Unfinished ${def.name.toLowerCase()} (${Math.round((done / totalMaterials(def)) * 100)}%)`;
        }
        return `${def.name}${def.burns ? (o.lit ? ' — burning' : ' — cold') : ''}${def.gate ? (o.open ? ' (open)' : ' (closed)') : ''}`;
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

  showDeath() {
    this.deathEl.classList.add('show');
    setTimeout(() => this.deathEl.classList.remove('show'), 4000);
  }

  // ---------- per-frame HUD
  update() {
    const g = this.g, p = g.player;
    this.bars.health.style.width = `${p.health}%`;
    this.bars.food.style.width = `${p.food}%`;
    this.bars.water.style.width = `${p.water}%`;
    this.bars.stamina.style.width = `${p.stamina}%`;

    const f = g.world.dayFraction;
    const mins = Math.floor(f * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0'), mm = String(mins % 60).padStart(2, '0');
    this.clockEl.textContent = `Day ${g.world.day} · ${hh}:${mm}${f > 0.78 || f < 0.22 ? ' · night' : ''}`;

    const status: string[] = [];
    if (g.dev.anyActive) status.push('<span class="dev-badge">DEV</span>');
    if (p.food < 20) status.push('<span class="warn">Hungry</span>');
    if (p.water < 20) status.push('<span class="warn">Thirsty</span>');
    if (p.stamina < 10) status.push('<span class="warn">Exhausted</span>');
    const w = g.inv.weight();
    if (w > CARRY_CAPACITY) status.push(`<span class="warn">Overloaded ${w.toFixed(0)}/${CARRY_CAPACITY} kg</span>`);
    if (p.swimming) status.push('Swimming');
    if (g.placing) status.push(`Placing: ${g.placing.name} — LMB place, RMB cancel${g.placing.placement === 'edge' ? ' (aim near a tile edge)' : ''}`);
    if (g.placement && !g.placement.valid) status.push(`<span class="warn">${esc(g.placement.reason)}</span>`);
    this.statusEl.innerHTML = status.join(' · ');

    const t = g.target;
    if (t && !g.placing) {
      this.targetEl.textContent = this.describeTarget(t);
      const opts = g.actionsFor(t);
      const first = opts.find((o) => !o.problem) ?? opts[0];
      this.hintEl.innerHTML = first ? `<b>LMB</b> ${esc(first.label)} &nbsp; <b>RMB</b> more` : '';
    } else {
      this.targetEl.textContent = '';
      this.hintEl.textContent = '';
    }

    const a = g.action;
    if (a) {
      this.progress.style.display = 'block';
      const label = typeof a.def.label === 'function' ? a.def.label(a.ctx) : a.def.label;
      this.progressLabel.textContent = `${label}${g.queue.length ? ` (+${g.queue.length} queued)` : ''}`;
      this.progressFill.style.width = `${Math.min(100, (a.elapsed / a.total) * 100)}%`;
    } else {
      this.progress.style.display = 'none';
    }

    const showPause = !g.input.locked && !this.anyWindowOpen();
    this.pauseEl.style.display = showPause ? 'flex' : 'none';

    // Live windows refresh a few times per second.
    this.refreshTimer -= 1 / 60;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 0.5;
      if (this.open.has('crafting')) this.render('crafting');
      if (this.open.has('skills')) this.render('skills');
      if (this.open.has('container') && this.container) {
        const c = this.container;
        if (Math.hypot(c.x - p.pos.x, c.z - p.pos.z) > 5 || !g.world.objects.has(c.id)) this.close('container');
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
      slot.innerHTML = `<span class="slot-key">${i + 1}</span>${type ? `<span class="slot-icon">${itemDef(type).icon}</span>` : ''}${count > 1 ? `<span class="slot-count">${count}</span>` : ''}`;
      slot.title = type ? itemDef(type).name : 'Empty — hover an item in your inventory and press this number';
      this.hotbarEl.appendChild(slot);
    });
    const a = el('div', 'active-label', active ? `${itemDef(active.type).icon} ${esc(itemName(active))} <small>QL ${active.ql.toFixed(1)}${active.dmg > 0 ? `, dmg ${active.dmg.toFixed(1)}` : ''}</small>` : 'Bare hands');
    this.hotbarEl.appendChild(a);
  }

  private frame(name: WindowName, title: string, body: HTMLElement | string) {
    const w = this.windows.get(name)!;
    const scroll = w.querySelector('.window-body')?.scrollTop ?? 0;
    w.innerHTML = '';
    const head = el('div', 'window-head', `<span>${title}</span>`);
    const x = el('button', 'close', '✕');
    x.addEventListener('click', () => this.close(name));
    head.appendChild(x);
    const b = el('div', 'window-body');
    if (typeof body === 'string') b.innerHTML = body;
    else b.appendChild(body);
    w.append(head, b);
    b.scrollTop = scroll;
  }

  private render(name: WindowName) {
    switch (name) {
      case 'inventory': return this.renderInventory();
      case 'crafting': return this.renderCrafting();
      case 'skills': return this.renderSkills();
      case 'build': return this.renderBuild();
      case 'help': return this.renderHelp();
      case 'container': return this.renderContainer();
      case 'dev': return this.renderDev();
    }
  }

  private itemRow(items: Item[], actions: { label: string; fn: (it: Item) => void; all?: boolean }[]): HTMLElement {
    const g = this.g;
    const best = items[0];
    const def = itemDef(best.type);
    const row = el('div', `item-row${g.activeUid !== null && items.some((i) => i.uid === g.activeUid) ? ' active' : ''}`);
    const weight = items.length * def.weight;
    const ql = items.length > 1 ? `QL ${items.at(-1)!.ql.toFixed(0)}–${best.ql.toFixed(0)}` : `QL ${best.ql.toFixed(1)}`;
    row.innerHTML = `<span class="icon">${def.icon}</span>
      <span class="name">${esc(itemName(best))}${items.length > 1 ? ` <b>×${items.length}</b>` : ''}
        <small>${ql}${def.tool && best.dmg > 0 ? ` · dmg ${best.dmg.toFixed(1)}` : ''} · ${weight.toFixed(1)} kg</small></span>`;
    row.title = def.desc;
    const btns = el('span', 'btns');
    for (const a of actions) {
      const b = el('button', '', a.label);
      b.addEventListener('click', (e) => { e.stopPropagation(); a.fn(best); });
      btns.appendChild(b);
    }
    row.appendChild(btns);
    row.addEventListener('mouseenter', () => { this.hoveredItem = best.uid; });
    row.addEventListener('mouseleave', () => { if (this.hoveredItem === best.uid) this.hoveredItem = null; });
    return row;
  }

  private renderInventory() {
    const g = this.g;
    const body = el('div');
    const w = g.inv.weight();
    body.appendChild(el('div', 'inv-weight', `Carrying <b>${w.toFixed(1)}</b> / ${CARRY_CAPACITY} kg${w > CARRY_CAPACITY ? ' — <span class="warn">overloaded, you move slowly</span>' : ''}`));
    body.appendChild(el('div', 'hint', 'Click <b>Use</b> to make an item your active item (tools, seeds, dirt…). Hover an item and press <b>1-9</b> to bind it to the hotbar.'));
    const groups = g.inv.grouped().sort((a, b) => itemDef(a.type).name.localeCompare(itemDef(b.type).name));
    if (!groups.length) body.appendChild(el('div', 'empty', 'Your pack is empty.'));
    const chest = this.container?.kind === 'structure' ? this.container : null;
    for (const grp of groups) {
      const def = itemDef(grp.type);
      const actions: { label: string; fn: (it: Item) => void }[] = [];
      const isActive = grp.items.some((i) => i.uid === g.activeUid);
      actions.push({ label: isActive ? 'Unuse' : 'Use', fn: (it) => g.setActive(isActive ? null : it.uid) });
      if (def.food) actions.push({ label: def.food.nutrition ? 'Eat' : 'Drink', fn: (it) => g.eat(it.uid) });
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
          const u = el('button', '', it.uid === g.activeUid ? 'Unuse' : 'Use');
          u.addEventListener('click', () => g.setActive(it.uid === g.activeUid ? null : it.uid));
          const d = el('button', '', 'Drop');
          d.addEventListener('click', () => g.dropItems([it.uid]));
          sub.append(u, d);
          body.appendChild(sub);
        }
      }
    }
    this.frame('inventory', 'Inventory', body);
  }

  private renderContainer() {
    const g = this.g;
    const c = this.container;
    if (!c) return;
    const items = c.kind === 'pile' ? c.items : (c.items ??= []);
    const body = el('div');
    const cap = c.kind === 'structure' ? STRUCTURES[c.type].container : undefined;
    const w = items.reduce((a, i) => a + itemDef(i.type).weight, 0);
    body.appendChild(el('div', 'inv-weight', `${items.length} items · ${w.toFixed(1)}${cap ? ` / ${cap}` : ''} kg`));
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
    const title = c.kind === 'pile' ? 'Pile on the ground' : STRUCTURES[c.type].name;
    this.frame('container', title, body);
  }

  private recipeRow(r: Recipe): HTMLElement {
    const g = this.g;
    const tool = g.toolFor(r.tool);
    const problem = craftProblem(g, r, tool);
    const row = el('div', `recipe${problem ? ' blocked' : ''}`);
    const out = itemDef(r.output.item);
    const inputs = r.inputs.map((i) => {
      const have = g.inv.count(i.item);
      return `<span class="${have >= i.count ? 'ok' : 'no'}">${itemDef(i.item).icon} ${i.count} ${esc(itemDef(i.item).name.toLowerCase())} (${have})</span>`;
    }).join(' ');
    const reqs: string[] = [];
    if (r.tool) reqs.push(`<span class="${tool ? 'ok' : 'no'}">tool: ${r.tool}${tool ? ` (${esc(itemName(tool))})` : ''}</span>`);
    for (const s of r.stations ?? []) reqs.push(`<span class="${g.stationNear(s) ? 'ok' : 'no'}">near ${STATION_NAMES[s]}</span>`);
    const lvl = g.skills.get(r.skill);
    const chance = Math.round(g.skills.successChance(r.skill, r.difficulty, tool?.ql ?? 0) * 100);
    row.innerHTML = `
      <div class="recipe-head"><span class="icon">${out.icon}</span><b>${esc(r.name)}</b>${r.output.count > 1 ? ` ×${r.output.count}` : ''}
        <small>${SKILLS[r.skill]} ${lvl.toFixed(1)} · difficulty ${r.difficulty} · ~${chance}% success</small></div>
      <div class="recipe-in">${inputs}</div>
      ${reqs.length ? `<div class="recipe-req">${reqs.join(' · ')}</div>` : ''}`;
    const btns = el('div', 'btns');
    for (const n of [1, 5]) {
      const b = el('button', '', `Craft ×${n}`);
      b.disabled = !!problem;
      b.addEventListener('click', () => g.craft(r, n));
      btns.appendChild(b);
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
    body.appendChild(el('div', 'hint', 'Crafting takes time and can fail. Quality depends on your skill, your tool and your materials. Actions queue up — keep working while you wait.'));
    for (const r of RECIPES.filter((r) => r.category === this.craftCategory)) body.appendChild(this.recipeRow(r));
    this.frame('crafting', 'Crafting', body);
  }

  private renderSkills() {
    const g = this.g;
    const rows = (Object.keys(SKILLS) as SkillId[]).map((k) => {
      const v = g.skills.get(k);
      return `<div class="skill"><span>${SKILLS[k]}</span><div class="skill-bar"><div style="width:${v}%"></div></div><b>${v.toFixed(2)}</b></div>`;
    }).join('');
    this.frame('skills', 'Skills', `<div class="hint">Skills rise slowly through use, fastest on tasks close to your level.</div>${rows}`);
  }

  private renderBuild() {
    const g = this.g;
    const body = el('div');
    body.appendChild(el('div', 'hint', 'Pick a structure to lay out its plan, then use <b>Continue building</b> on the plan, adding one material per step. Walls and fences go on tile edges; everything else sits on a tile. Hold Shift while placing to place several.'));
    for (const def of STRUCTURE_LIST) {
      const row = el('div', 'recipe');
      const mats = def.materials.map((m) => {
        const have = g.inv.count(m.item);
        return `<span class="${have >= m.count ? 'ok' : 'no'}">${itemDef(m.item).icon} ${m.count} ${esc(itemDef(m.item).name.toLowerCase())} (${have})</span>`;
      }).join(' ');
      const tool = def.tool ? g.toolFor(def.tool) : undefined;
      row.innerHTML = `
        <div class="recipe-head"><span class="icon">${def.icon}</span><b>${def.name}</b>
          <small>${SKILLS[def.skill]} · difficulty ${def.difficulty} · ${def.placement === 'edge' ? 'tile edge' : 'tile'} · max slope ${def.maxSlope} dm</small></div>
        <div class="recipe-desc">${esc(def.desc)}</div>
        <div class="recipe-in">${mats}</div>
        ${def.tool ? `<div class="recipe-req"><span class="${tool ? 'ok' : 'no'}">tool: ${def.tool}</span></div>` : ''}`;
      const b = el('button', '', 'Plan');
      b.addEventListener('click', () => {
        g.startPlacing(def);
        this.close('build');
      });
      const btns = el('div', 'btns');
      btns.appendChild(b);
      row.appendChild(btns);
      body.appendChild(row);
    }
    this.frame('build', 'Build', body);
  }

  private renderDev() {
    const g = this.g;
    const body = el('div', 'dev');
    body.appendChild(el('div', 'hint', 'Cheats for testing. Toggles are remembered in this browser and apply to every world. Press <b>`</b> or <b>F2</b> to open or close.'));

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
    const speed = el('select');
    for (const [v, label] of [[0, 'Frozen'], [1, 'Normal'], [5, '5×'], [20, '20×'], [100, '100×']] as [number, string][]) {
      const o = el('option', '', label);
      o.value = String(v);
      if (g.dev.timeScale === v) o.selected = true;
      speed.appendChild(o);
    }
    speed.addEventListener('change', () => g.dev.setTimeScale(Number(speed.value)));
    timeRow.appendChild(speed);
    for (const [label, f] of [['Dawn', 0.25], ['Noon', 0.5], ['Dusk', 0.77], ['Midnight', 0]] as [string, number][]) {
      timeRow.appendChild(this.devButton(label, () => devCommands.setTime(g, f)));
    }
    body.appendChild(timeRow);

    body.appendChild(el('h3', '', 'Give item'));
    const giveRow = el('div', 'dev-row');
    const sel = el('select');
    for (const d of Object.values(ITEMS).sort((a, b) => a.name.localeCompare(b.name))) {
      const o = el('option', '', `${d.icon} ${esc(d.name)}`);
      o.value = d.id;
      if (d.id === this.devGive.type) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { this.devGive.type = sel.value; });
    const count = this.devNumber(this.devGive.count, 1, 500, (v) => { this.devGive.count = v; });
    const ql = this.devNumber(this.devGive.ql, 1, 100, (v) => { this.devGive.ql = v; });
    giveRow.append(sel, el('span', '', '×'), count, el('span', '', 'QL'), ql,
      this.devButton('Give', () => devCommands.give(g, this.devGive.type, this.devGive.count, this.devGive.ql)));
    body.appendChild(giveRow);

    body.appendChild(el('h3', '', 'Player &amp; world'));
    const skillRow = el('div', 'dev-row');
    skillRow.append(el('span', '', 'All skills to'), this.devNumber(this.devSkill, 1, 99, (v) => { this.devSkill = v; }),
      this.devButton('Set', () => devCommands.setSkills(g, this.devSkill)));
    body.appendChild(skillRow);
    const misc = el('div', 'dev-row');
    misc.append(
      this.devButton('Refill needs', () => devCommands.refill(g)),
      this.devButton('Teleport home', () => devCommands.teleportHome(g)),
      this.devButton('Grow everything', () => devCommands.growEverything(g)),
      this.devButton('Spawn deer', () => devCommands.spawnAnimal(g, 'deer')),
      this.devButton('Spawn boar', () => devCommands.spawnAnimal(g, 'boar')),
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

  private devNumber(value: number, min: number, max: number, onChange: (v: number) => void): HTMLInputElement {
    const inp = el('input');
    inp.type = 'number';
    inp.min = String(min);
    inp.max = String(max);
    inp.value = String(value);
    inp.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, Number(inp.value) || min));
      inp.value = String(v);
      onChange(v);
    });
    return inp;
  }

  private renderHelp() {
    this.frame('help', 'Survival guide', `
      <h3>Controls</h3>
      <table class="keys">
        <tr><td>WASD / Shift / Space</td><td>Move / sprint / jump</td></tr>
        <tr><td>Mouse</td><td>Look (click the game to capture the mouse)</td></tr>
        <tr><td>V</td><td>Toggle first / third person · mouse wheel zooms in third person</td></tr>
        <tr><td>Left click / E</td><td>Do the default action on what you're looking at</td></tr>
        <tr><td>Right click / F</td><td>Open the action menu (pick with mouse or 1-9)</td></tr>
        <tr><td>1-9 · 0</td><td>Activate hotbar item · bare hands</td></tr>
        <tr><td>R</td><td>Repeat last action · X: stop current action</td></tr>
        <tr><td>I / Tab · C · B · K</td><td>Inventory · Crafting · Build · Skills</td></tr>
        <tr><td>H · Esc</td><td>This guide · release mouse / close windows</td></tr>
        <tr><td>&#96; or F2</td><td>Dev console (cheats: instant crafting, no needs, fly…)</td></tr>
      </table>
      <h3>How this world works</h3>
      <p>Like Wurm Online, everything you do is a <b>timed action</b> that uses a <b>skill</b>. Skills start at 1 and rise slowly with practice. Higher skill means faster work, fewer failures and better <b>quality (QL)</b>. Every item has its own QL; good tools and good materials make good products.</p>
      <p>The <b>active item</b> decides what you can do. Holding a shovel lets you dig and flatten the tile corner you are aiming at; a pickaxe mines rock; a hatchet fells trees. Bare hands forage, pick berries and gather stones.</p>
      <p>The land is made of tiles with heights at their corners. <b>Digging</b> lowers the highlighted corner by 1 dm and gives you dirt, sand or clay. Below the soil lies rock: you need a pickaxe to go deeper, and rock may hide <b>iron ore</b>. Most buildings need flat ground, so terraform first.</p>
      <h3>Getting started</h3>
      <ol>
        <li><b>Forage</b> grass tiles (bare hands) for plant fiber, branches, berries, mushrooms and seeds.</li>
        <li><b>Gather loose stones</b> on grey rock tiles (usually on hills and cliffs).</li>
        <li>Craft <b>cordage</b> from fiber, then a <b>stone hatchet</b>, <b>stone pickaxe</b> and <b>stone hammer</b>.</li>
        <li>Fell trees for <b>logs</b> (heavy — they drop on the ground). Split them into <b>planks</b>; carve branches into <b>shafts</b>; make a <b>wooden shovel</b>.</li>
        <li>Build a <b>campfire</b> (B), add fuel, and light it with <b>kindling</b>. Cook mushrooms and meat; fire clay jars.</li>
        <li>Dig <b>clay</b> by the water, build a <b>forge</b> and <b>stone anvil</b>, mine <b>iron ore</b>, smelt it, and smith iron tools.</li>
        <li><b>Cultivate</b> fields with a shovel, <b>sow</b> wheat seeds, tend them, harvest, grind flour at a <b>quern</b>, and bake <b>bread</b>.</li>
        <li>Hunt deer and boar (careful — boars fight back), <b>butcher</b> them with a knife for meat and hides, and build a <b>bed</b> to set your home.</li>
      </ol>
      <p>Watch your <b>food</b> and <b>water</b>: drink from lakes (aim at water), and eat cooked food — higher QL food is more nourishing. Your game saves automatically.</p>`);
  }
}
