import './style.css';
import { telemetry } from './game/telemetry';
// First: catch errors and keep a log from the very start (see game/telemetry).
telemetry.install();
import { itemName, typeName } from './data/items';
import { RECIPES } from './data/recipes';
import { ACTION_MAP } from './game/actions';
import { createMinigame } from './game/minigames';
import { STRUCTURES } from './data/structures';
import { Game, OLD_SAVES } from './game/game';
import { pickFile, UI } from './ui/ui';
import { GUIDE_HTML } from './ui/guide';
import { GraphicsSettings } from './game/graphics';
import { Sound } from './game/sound';
import { keepStorage } from './game/storage';
import { World } from './world/world';
import { WorldGen } from './world/worldgen';
import { prepareTiles } from './world/tilesource';
import { perf } from './game/perf';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const menu = document.getElementById('menu')!;
const fade = document.getElementById('tour-fade')!;
const status = document.getElementById('menu-status')!;
const cont = document.getElementById('continue') as HTMLButtonElement;
const seedInput = document.getElementById('seed') as HTMLInputElement;
const $ = (id: string) => document.getElementById(id) as HTMLButtonElement;

// ---------- the loading screen (until the menu's world, or a game, is ready)
const loading = document.getElementById('loading')!;
function loadStep(text: string, share: number) {
  document.getElementById('load-text')!.textContent = text;
  document.getElementById('load-fill')!.style.transform = `scaleX(${share})`;
}
/** Let the loading screen paint before the next heavy step. */
const paint = () => new Promise((r) => setTimeout(r, 30));
function loadDone() {
  loadStep('', 1);
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 900);
}
/** Show the menu (and end the loading screen). */
function revealMenu() {
  menu.classList.remove('waiting');
  if (loading.isConnected && !loading.classList.contains('done')) loadDone();
}

// Starting a game reloads the page with what to start written down, so the
// world touring behind the menu is gone and the game starts afresh.
const LAUNCH = 'survivalcrafter.launch';
type Launch = { kind: 'new'; seed: number } | { kind: 'continue' };
function relaunch(l: Launch) {
  try { sessionStorage.setItem(LAUNCH, JSON.stringify(l)); } catch { /* fall through: started below */ }
  location.reload();
}
function takeLaunch(): Launch | null {
  try {
    const l = sessionStorage.getItem(LAUNCH);
    sessionStorage.removeItem(LAUNCH);
    return l ? JSON.parse(l) as Launch : null;
  } catch { return null; }
}

try {
  for (const [key, why] of OLD_SAVES) {
    if (!localStorage.getItem(key)) continue;
    status.textContent = why;
    localStorage.removeItem(key);
  }
} catch { /* storage unavailable */ }

function seedFrom(text: string): number {
  if (!text.trim()) return Math.floor(Math.random() * 1e9);
  const n = Number(text);
  if (Number.isFinite(n)) return Math.floor(n);
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A new world, with the land around the start made in the background first (so the page never stalls). */
async function makeWorld(seed: number): Promise<World> {
  const gen = new WorldGen(seed);
  const s = World.roughSpawn(gen);
  await prepareTiles(gen, s.x, s.z);
  const world = new World(seed);
  world.generate(gen);
  return world;
}

function launch(make: () => Game | null | Promise<Game | null>) {
  // Ask the browser not to clear the save when the disk runs low.
  void keepStorage();
  // Let the status paint before the heavy generation work.
  setTimeout(async () => {
    const game = await make();
    if (!game) { status.textContent = 'Could not load that save.'; menuShow('main'); revealMenu(); return; }
    loadStep('Settling in…', 0.9);
    await paint();
    game.ui = new UI(game);
    menu.remove();
    fade.remove();
    game.start();
    loadDone();
    canvas.addEventListener('click', () => {
      if (!game.ui.anyWindowOpen()) game.input.lock();
    });
    game.input.lock();
    // Handy for debugging from the browser console.
    telemetry.meta = { seed: game.world.terrain.seed, gpu: gpuName(game.renderer.getContext()), build: location.hostname === 'localhost' ? 'local' : location.hostname };
    telemetry.info('session', 'World loaded', telemetry.meta);
    Object.assign(window, { __debug: telemetry, game, __recipes: RECIPES, __data: { STRUCTURES }, __World: World, __WorldGen: WorldGen, __perf: perf, __ACTIONS: ACTION_MAP, __createMinigame: createMinigame, __typeName: typeName, __itemName: itemName });
  }, 30);
}

function startGame(l: Launch) {
  if (l.kind === 'continue') {
    loadStep('Reading your save…', 0.2);
    launch(async () => Game.loadSave(canvas, await Game.readSave()));
  } else {
    loadStep('Shaping the land…', 0.15);
    launch(async () => {
      const world = await makeWorld(l.seed);
      loadStep('Planting the forests…', 0.6);
      await paint();
      const g = new Game(canvas, world);
      g.newCharacter();
      g.msg(`World seed: ${l.seed}`, 'info');
      return g;
    });
  }
}

// ---------- the menu
function menuShow(panel: string | null) {
  for (const p of menu.querySelectorAll<HTMLElement>('.menu-panel')) p.hidden = p.dataset.panel !== panel;
  if (panel === 'new') seedInput.focus();
}
menu.addEventListener('click', (e) => {
  const go = (e.target as HTMLElement).dataset.go;
  if (go) { status.textContent = ''; menuShow(go); }
});

/** The world behind the menu, once it's made. */
let backdrop: Game | null = null;
const graphics = () => backdrop?.graphics ?? new GraphicsSettings();
const sound = () => backdrop?.sound ?? new Sound();
function showSettings() {
  $('set-quality').textContent = `Graphics: ${graphics().level.label}`;
  $('set-fps').textContent = `Frame cap: ${graphics().fpsLabel}`;
  $('set-aa').textContent = `Anti-aliasing: ${graphics().aaLabel}`;
  $('set-sound').textContent = `Sound: ${sound().muted ? 'Off' : 'On'}`;
}

cont.addEventListener('click', () => relaunch({ kind: 'continue' }));
$('create').addEventListener('click', async () => {
  if (await Game.hasSave() && !confirm('Start a new world? Your current save will be overwritten.')) return;
  relaunch({ kind: 'new', seed: seedFrom(seedInput.value) });
});
seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('create').click(); });
$('load').addEventListener('click', () => pickFile(async (file) => {
  if (await Game.hasSave() && !confirm('Replace your current world with the one in that file?')) return;
  try {
    await Game.importSave(file);
    relaunch({ kind: 'continue' });
  } catch (e) {
    status.textContent = e instanceof Error ? e.message : 'Could not read that file.';
  }
}));
$('set-quality').addEventListener('click', () => {
  const g = graphics();
  g.nextQuality();
  backdrop?.applyGraphics();
  showSettings();
});
$('set-fps').addEventListener('click', () => { graphics().nextFpsCap(); showSettings(); });
$('set-aa').addEventListener('click', () => { graphics().nextAA(); backdrop?.applyGraphics(); showSettings(); });
$('set-sound').addEventListener('click', () => { const s = sound(); s.muted = !s.muted; showSettings(); });
menu.querySelector('[data-go="settings"]')!.addEventListener('click', showSettings);
menu.querySelector('.wiki-body')!.innerHTML = GUIDE_HTML;
$('exit').addEventListener('click', () => {
  // Browsers only let a page close a tab it opened itself; otherwise say goodbye.
  window.close();
  setTimeout(() => {
    backdrop?.renderer.setAnimationLoop(null);
    const bye = document.createElement('div');
    bye.className = 'goodbye';
    bye.textContent = 'Thanks for playing. You can close this tab now.';
    document.body.appendChild(bye);
  }, 200);
});

const pending = takeLaunch();
if (pending) startGame(pending);
else {
  void Game.hasSave().then((has) => { cont.disabled = !has; });
  // A random world to tour behind the menu, made behind the loading screen;
  // the menu shows once the first view of it is ready to fade in.
  setTimeout(async () => {
    try {
      loadStep('Shaping the land…', 0.1);
      const world = await makeWorld(Math.floor(Math.random() * 1e9));
      if (!menu.isConnected || takeLaunchPending()) return;
      loadStep('Planting the forests…', 0.55);
      await paint();
      backdrop = new Game(canvas, world);
      loadStep('Finding a view…', 0.8);
      await paint();
      backdrop.startTour(fade);
      Object.assign(window, { __tour: backdrop, __perf: perf });
      const shown = performance.now();
      const wait = () => {
        // (Give up waiting after a while: better the menu over a dark screen than no menu.)
        if (backdrop?.tour?.started || performance.now() - shown > 60000) revealMenu();
        else setTimeout(wait, 100);
      };
      wait();
    } catch (e) {
      console.warn('Menu backdrop failed', e);
      revealMenu();
    }
  }, 60);
}
/** Whether a game is about to start (the page is reloading into it). */
function takeLaunchPending(): boolean {
  try { return !!sessionStorage.getItem(LAUNCH); } catch { return false; }
}

/** The graphics card's name, for the debug report (when the browser will say). */
function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch { return 'unknown'; }
}
