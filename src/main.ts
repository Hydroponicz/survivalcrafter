import './style.css';
import { RECIPES } from './data/recipes';
import { STRUCTURES } from './data/structures';
import { Game, OLD_SAVE_KEY } from './game/game';
import { UI } from './ui/ui';
import { World } from './world/world';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const menu = document.getElementById('menu')!;
const status = document.getElementById('menu-status')!;
const cont = document.getElementById('continue') as HTMLButtonElement;
const newBtn = document.getElementById('new') as HTMLButtonElement;
const seedInput = document.getElementById('seed') as HTMLInputElement;

if (Game.hasSave()) cont.style.display = '';
try {
  if (localStorage.getItem(OLD_SAVE_KEY)) {
    status.textContent = 'The world is now made of voxels, so worlds from the old tile terrain can no longer be loaded. Start a new world to play.';
    localStorage.removeItem(OLD_SAVE_KEY);
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

function launch(make: () => Game | null) {
  status.textContent = 'Shaping the land…';
  // Let the status paint before the heavy generation work.
  setTimeout(() => {
    const game = make();
    if (!game) { status.textContent = 'Could not load that save.'; return; }
    game.ui = new UI(game);
    menu.remove();
    game.start();
    canvas.addEventListener('click', () => {
      if (!game.ui.anyWindowOpen()) game.input.lock();
    });
    game.input.lock();
    // Handy for debugging from the browser console.
    Object.assign(window, { game, __recipes: RECIPES, __data: { STRUCTURES }, __World: World });
  }, 30);
}

cont.addEventListener('click', () => launch(() => Game.loadSave(canvas)));
newBtn.addEventListener('click', () => {
  if (Game.hasSave() && !confirm('Start a new world? Your current save will be overwritten.')) return;
  const seed = seedFrom(seedInput.value);
  launch(() => {
    const world = new World(seed);
    world.generate();
    const g = new Game(canvas, world);
    g.newCharacter();
    g.msg(`World seed: ${seed}`, 'info');
    return g;
  });
});
