import * as THREE from 'three';
import { Minigame, type MgInput } from './core';
import { CordageGame } from './cordage';
import { CrankGame, type CrankVariant } from './crank';
import { CarveGame, CenterGame, HeatGame, PlaceGame, type HeatVariant, type PlaceVariant } from './shape';
import { StrikeGame, type StrikeVariant } from './strike';
import { BellowsGame, BowDrillGame, SawGame } from './stroke';
import type { Input } from '../input';

export type MinigameSpec =
  | { kind: 'saw'; cuts: number }
  | { kind: 'bowdrill' }
  | { kind: 'bellows' }
  | { kind: 'crank'; variant: CrankVariant; turns: number }
  | { kind: 'strike'; variant: StrikeVariant; hits: number }
  | { kind: 'carve'; passes: number; wide?: boolean }
  | { kind: 'heat'; variant: HeatVariant }
  | { kind: 'place'; variant: PlaceVariant; count: number }
  | { kind: 'center' }
  | { kind: 'cord'; plies: number };

export function createMinigame(spec: MinigameSpec, ease: number): Minigame {
  switch (spec.kind) {
    case 'saw': return new SawGame(ease, spec.cuts);
    case 'bowdrill': return new BowDrillGame(ease);
    case 'bellows': return new BellowsGame(ease);
    case 'crank': return new CrankGame(ease, spec.variant, spec.turns);
    case 'strike': return new StrikeGame(ease, spec.variant, spec.hits);
    case 'carve': return new CarveGame(ease, spec.passes, spec.wide);
    case 'heat': return new HeatGame(ease, spec.variant);
    case 'place': return new PlaceGame(ease, spec.variant, spec.count);
    case 'center': return new CenterGame(ease);
    case 'cord': return new CordageGame(ease, spec.plies);
  }
}

/** The hands-on work for each recipe. */
export const RECIPE_MINIGAMES: Record<string, MinigameSpec> = {
  cordage: { kind: 'cord', plies: 6 },
  stone_knife: { kind: 'strike', variant: 'knap', hits: 3 },
  stone_hatchet: { kind: 'strike', variant: 'knap', hits: 4 },
  stone_pickaxe: { kind: 'strike', variant: 'knap', hits: 5 },
  stone_hammer: { kind: 'strike', variant: 'knap', hits: 4 },
  stone_spear: { kind: 'strike', variant: 'knap', hits: 4 },
  kindling_branch: { kind: 'carve', passes: 1 },
  shaft: { kind: 'carve', passes: 2 },
  kindling_log: { kind: 'strike', variant: 'split', hits: 3 },
  split_planks: { kind: 'strike', variant: 'split', hits: 3 },
  saw_planks: { kind: 'saw', cuts: 2 },
  wooden_shovel: { kind: 'carve', passes: 2, wide: true },
  clay_jar: { kind: 'center' },
  fire_jar: { kind: 'heat', variant: 'fire' },
  mortar: { kind: 'crank', variant: 'stir', turns: 3 },
  smelt_iron: { kind: 'bellows' },
  iron_knife: { kind: 'strike', variant: 'forge', hits: 4 },
  iron_hatchet: { kind: 'strike', variant: 'forge', hits: 5 },
  iron_pickaxe: { kind: 'strike', variant: 'forge', hits: 6 },
  iron_hammer: { kind: 'strike', variant: 'forge', hits: 4 },
  iron_shovel: { kind: 'strike', variant: 'forge', hits: 5 },
  saw: { kind: 'strike', variant: 'forge', hits: 6 },
  scythe: { kind: 'strike', variant: 'forge', hits: 6 },
  iron_sword: { kind: 'strike', variant: 'forge', hits: 7 },
  roast_mushroom: { kind: 'heat', variant: 'roast' },
  cooked_meat: { kind: 'heat', variant: 'roast' },
  bread: { kind: 'heat', variant: 'bake' },
  mint_tea: { kind: 'heat', variant: 'brew' },
  flour: { kind: 'crank', variant: 'grind', turns: 4 },
  dough: { kind: 'crank', variant: 'stir', turns: 3 },
  poultice: { kind: 'crank', variant: 'pound', turns: 3 },
  hearty_stew: { kind: 'crank', variant: 'stir', turns: 4 },
};

/** The hands-on work for one building step, by the material it uses. */
export function buildStepMinigame(material: string): MinigameSpec {
  switch (material) {
    case 'log': return { kind: 'place', variant: 'log', count: 1 };
    case 'rock_shard':
    case 'mortar':
    case 'clay':
      return { kind: 'place', variant: 'stone', count: 1 };
    case 'branch': return { kind: 'place', variant: 'stick', count: 1 };
    default: return { kind: 'strike', variant: 'nail', hits: 2 };
  }
}

/** One-word description for UI hints. */
export function minigameVerb(spec: MinigameSpec): string {
  switch (spec.kind) {
    case 'saw': return 'saw';
    case 'bowdrill': return 'bow drill';
    case 'bellows': return 'bellows';
    case 'crank': return { grind: 'grind', stir: 'stir', pound: 'pound' }[spec.variant];
    case 'cord': return 'twist and wrap';
    case 'strike': return { split: 'split', knap: 'knap', forge: 'hammer', nail: 'nail' }[spec.variant];
    case 'carve': return 'carve';
    case 'heat': return { roast: 'cook', bake: 'bake', fire: 'fire', brew: 'brew' }[spec.variant];
    case 'place': return 'lay';
    case 'center': return 'throw';
  }
}

/**
 * Runs one minigame: feeds it mouse input, draws its HUD panel and pointer,
 * and renders its diorama over the dimmed world.
 */
export class MinigameSession {
  readonly mg: Minigame;
  private panel: HTMLElement;
  private pointer: HTMLElement;
  private hintEl: HTMLElement;
  private px = window.innerWidth / 2;
  private py = window.innerHeight / 2;
  private wasDown = false;
  private elapsed = 0;
  private ended = false;
  private endDelay = -1;
  private shade: THREE.Mesh;
  private shadeScene = new THREE.Scene();
  private shadeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(spec: MinigameSpec, ease: number, root: HTMLElement, private onEnd: (perf: number | null, seconds: number) => void, private label: string) {
    this.mg = createMinigame(spec, ease);
    this.shade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x0b0a08, transparent: true, opacity: 0.66, depthTest: false }));
    this.shade.position.z = -0.5; // inside the ortho camera's 0..1 depth range
    this.shadeScene.add(this.shade);
    this.panel = document.createElement('div');
    this.panel.className = 'mg-panel';
    root.appendChild(this.panel);
    this.pointer = document.createElement('div');
    this.pointer.className = 'ui-cursor';
    root.appendChild(this.pointer);
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'mg-hint';
    root.appendChild(this.hintEl);
    this.renderPanel();
  }

  update(dt: number, input: Input) {
    if (this.ended) return;
    const clicks = input.takeClicks();
    if (clicks.includes(2)) { this.end(null); return; }
    this.elapsed += dt;
    const down = input.held.has(0);
    this.px = Math.max(0, Math.min(window.innerWidth - 1, this.px + input.mouseDX));
    this.py = Math.max(0, Math.min(window.innerHeight - 1, this.py + input.mouseDY));
    const i: MgInput = {
      dx: input.mouseDX, dy: input.mouseDY, wheel: input.wheel,
      down, pressed: clicks.includes(0), released: this.wasDown && !down,
      x: this.px, y: this.py,
      ndc: new THREE.Vector2((this.px / window.innerWidth) * 2 - 1, -(this.py / window.innerHeight) * 2 + 1),
    };
    this.wasDown = down;
    input.mouseDX = input.mouseDY = input.wheel = 0;
    if (this.endDelay >= 0) {
      // Let the last moment of the job show before returning to the world.
      this.mg.tick(dt, { ...i, down: false, pressed: false, dx: 0, dy: 0 });
      this.endDelay -= dt;
      if (this.endDelay < 0) this.end(this.mg.performance());
    } else {
      this.mg.tick(dt, i);
      if (this.mg.done) this.endDelay = 0.7;
    }
    this.pointer.style.display = this.mg.showPointer ? 'block' : 'none';
    this.pointer.style.transform = `translate(${this.px}px, ${this.py}px)`;
    this.renderPanel();
  }

  /** Called when the mouse is released (Esc): stop working. */
  cancel() {
    if (!this.ended) this.end(null);
  }

  private end(perf: number | null) {
    this.ended = true;
    this.panel.remove();
    this.pointer.remove();
    this.hintEl.remove();
    this.mg.dispose();
    this.onEnd(perf, this.elapsed);
  }

  render(renderer: THREE.WebGLRenderer) {
    if (this.ended) return;
    this.mg.resize();
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.shadeScene, this.shadeCam);
    renderer.clearDepth();
    renderer.render(this.mg.scene, this.mg.camera);
    renderer.autoClear = true;
  }

  private renderPanel() {
    const m = this.mg;
    const meters = m.meters().map((mt) => {
      const band = mt.band ? `<div class="mg-band" style="left:${mt.band[0] * 100}%;width:${(mt.band[1] - mt.band[0]) * 100}%"></div>` : '';
      return `<div class="mg-meter"><span>${mt.label}</span><div class="mg-track">${band}<div class="mg-fill" style="width:${Math.max(0, Math.min(1, mt.value)) * 100}%;background:${mt.color ?? '#e8b562'}"></div></div></div>`;
    }).join('');
    const perf = m.performance();
    const grade = perf > 0.85 ? 'Excellent' : perf > 0.65 ? 'Good' : perf > 0.4 ? 'Fair' : 'Poor';
    const fb = m.feedback ? `<div class="mg-feedback ${m.feedback.good ? 'good' : 'bad'}">${m.feedback.text}</div>` : '';
    this.panel.innerHTML = `
      <div class="mg-title">${m.title} <small>${this.label}</small></div>
      <div class="mg-how">${m.instructions}</div>
      <div class="mg-meter"><span>Progress</span><div class="mg-track"><div class="mg-fill" style="width:${m.progress * 100}%"></div></div></div>
      ${meters}
      <div class="mg-foot"><span>Work: <b>${grade}</b></span><span>Right-click to stop</span></div>
      ${fb}`;
    const h = m.hint();
    this.hintEl.style.display = h ? 'block' : 'none';
    if (h) {
      this.hintEl.textContent = h.text;
      this.hintEl.style.transform = `translate(${h.x}px, ${h.y}px)`;
    }
  }
}
