// Developer / cheat settings. Stored per browser, separate from the world save.

import { itemDef, makeItem } from '../data/items';
import type { SkillId } from '../data/skills';
import { ANIMALS, CROP_STAGE_TIME, CROP_STAGES, DAY_LENGTH, type AnimalSpecies } from '../world/world';
import type { Game } from './game';

const DEV_KEY = 'survivalcrafter.dev.v1';

export const DEV_FLAGS = {
  instantCraft: { label: 'Instant crafting', desc: 'Crafting recipes finish immediately.' },
  instantActions: { label: 'Instant actions', desc: 'Every timed action (digging, felling, building…) finishes immediately.' },
  alwaysSucceed: { label: 'Always succeed', desc: 'Skill checks never fail.' },
  freeCraft: { label: 'Free crafting', desc: 'Ignore materials, tools and stations when crafting.' },
  freeBuild: { label: 'Free building', desc: 'Placed structures are finished instantly, no materials needed.' },
  noNeeds: { label: 'No player needs', desc: 'Food, water and stamina stay full.' },
  godMode: { label: 'God mode', desc: 'You cannot be hurt or die.' },
  noWeight: { label: 'No carry limit', desc: 'Weight never slows you down.' },
  noToolWear: { label: 'No tool wear', desc: 'Tools never take damage.' },
  peaceful: { label: 'Peaceful animals', desc: 'Animals never attack you.' },
  fly: { label: 'Fly mode', desc: 'No gravity or collisions. Space rises, Q descends, Shift goes fast.' },
} as const;

export type DevFlag = keyof typeof DEV_FLAGS;

export class DevSettings {
  flags = Object.fromEntries(Object.keys(DEV_FLAGS).map((k) => [k, false])) as Record<DevFlag, boolean>;
  /** Multiplier on world time (growth, fires, day/night). 0 freezes time. */
  timeScale = 1;

  constructor() {
    try {
      const raw = localStorage.getItem(DEV_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        for (const k of Object.keys(this.flags) as DevFlag[]) this.flags[k] = !!data.flags?.[k];
        if (typeof data.timeScale === 'number') this.timeScale = data.timeScale;
      }
    } catch { /* ignore broken settings */ }
  }

  on(flag: DevFlag): boolean {
    return this.flags[flag];
  }

  get anyActive(): boolean {
    return this.timeScale !== 1 || Object.values(this.flags).some(Boolean);
  }

  set(flag: DevFlag, value: boolean) {
    this.flags[flag] = value;
    this.persist();
  }

  setTimeScale(v: number) {
    this.timeScale = v;
    this.persist();
  }

  private persist() {
    try { localStorage.setItem(DEV_KEY, JSON.stringify({ flags: this.flags, timeScale: this.timeScale })); } catch { /* ignore */ }
  }
}

// ---------- one-shot commands

export const devCommands = {
  refill(g: Game) {
    const p = g.player;
    p.health = p.food = p.water = p.stamina = 100;
    g.msg('[dev] Health, food, water and stamina refilled.', 'info');
  },

  give(g: Game, type: string, count: number, ql: number) {
    for (let i = 0; i < count; i++) {
      const it = makeItem(type, ql);
      g.inv.add(it);
      g.autoBind(it);
    }
    g.inventoryChanged();
    g.msg(`[dev] Gave ${count} × ${itemDef(type).name} (QL ${ql}).`, 'info');
  },

  setSkills(g: Game, level: number) {
    const v = Math.max(1, Math.min(99.999, level));
    for (const k of Object.keys(g.skills.levels) as SkillId[]) g.skills.levels[k] = v;
    g.ui.refresh();
    g.msg(`[dev] All skills set to ${v}.`, 'info');
  },

  /** Jump to a time of day (0..1), staying on the current day. */
  setTime(g: Game, dayFraction: number) {
    const w = g.world;
    w.time = Math.floor(w.time / DAY_LENGTH) * DAY_LENGTH + dayFraction * DAY_LENGTH;
    g.msg(`[dev] Time set to ${String(Math.floor(dayFraction * 24)).padStart(2, '0')}:00.`, 'info');
  },

  teleportHome(g: Game) {
    const s = g.world.spawn;
    g.cancelAction();
    g.player.pos.set(s.x, g.world.terrain.heightAt(s.x, s.z) + 0.2, s.z);
    g.player.vel.set(0, 0, 0);
    g.msg('[dev] Teleported home.', 'info');
  },

  spawnAnimal(g: Game, species: AnimalSpecies) {
    const f = g.player.forward();
    const len = Math.hypot(f.x, f.z) || 1;
    const x = g.player.pos.x + (f.x / len) * 6, z = g.player.pos.z + (f.z / len) * 6;
    g.world.spawnAnimal(species, x, z);
    g.msg(`[dev] Spawned a ${ANIMALS[species].name.toLowerCase()}.`, 'info');
  },

  growEverything(g: Game) {
    const w = g.world;
    for (const c of w.crops.values()) c.planted = w.time - CROP_STAGE_TIME * CROP_STAGES * 2;
    for (const o of w.objects.values()) {
      if (o.kind === 'tree' && o.age < 1) { o.age = 1; o.branches = 3; w.changed(o); }
      if (o.kind === 'bush' && !o.ripe) { o.ripe = true; w.changed(o); }
    }
    g.forage.reset();
    g.msg('[dev] All crops ripe, trees grown, bushes and forage spots replenished.', 'info');
  },

  clearInventory(g: Game) {
    g.inv.items = [];
    g.setActive(null);
    g.inventoryChanged();
    g.msg('[dev] Inventory cleared.', 'info');
  },
};
