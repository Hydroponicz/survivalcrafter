# Survivalcrafter

A browser-based survival crafting sandbox in the spirit of **Wurm Online** — slow, deep, skill-driven —
with the immediacy of Minecraft/Enshrouded. Built with Three.js + TypeScript + Vite and deployable to Vercel as a static site.

## Play locally

```bash
npm install
npm run dev
```

Open the printed URL, pick **New world** (optionally enter a seed), and click into the game to capture the mouse.

## Deploy to Vercel

The repo includes `vercel.json` (framework: Vite, output: `dist`). Either import the GitHub repo in the
Vercel dashboard, or from the CLI:

```bash
npx vercel --prod
```

No server is needed — the world and your character save to the browser's `localStorage`.

## Controls

| Key | Action |
| --- | --- |
| WASD / Shift / Space | Move / sprint / jump |
| Mouse | Look |
| **V** | Toggle first / third person (mouse wheel zooms in third person) |
| Left click / E | Default action on what you're looking at |
| Right click / F | Action menu (choose with mouse or 1-9) |
| 1-9 / 0 | Activate hotbar item / bare hands |
| R / X | Repeat last action / stop current action |
| I or Tab, C, B, K, H | Inventory, Crafting, Build, Skills, Help |

## What makes it "Wurm-like"

- **Timed actions with skill checks.** Everything takes time, can fail, and trains one of 15 skills
  (woodcutting, mining, digging, carpentry, smithing, cooking, farming, fighting…). Skills rise from 1
  toward 100 with steep diminishing returns, and you learn most from tasks near your level.
- **Item quality (QL) and damage.** Every item is an individual with its own QL. Results depend on skill,
  tool QL and material QL. Tools wear out and eventually break.
- **The active item decides your options.** Activate a shovel and the action menu offers Dig, Flatten,
  Cultivate; a pickaxe offers Mine; bare hands forage.
- **Terraforming on tile corners.** The land is a tile grid with heights on corners (in decimetres).
  Digging lowers the highlighted corner by 1 dm and gives you dirt/sand/clay. Under the soil is a rock
  layer that needs a pickaxe — and may hold iron ore. Buildings need flat ground, so you flatten first.
- **Incremental construction.** Lay out a plan (B), then "Continue building", spending one material per
  step. Walls and fences run along tile edges; everything else sits on tiles.
- **Production chains.** Fiber → cordage → stone tools → logs → planks/shafts → shovel → clay → forge +
  anvil → iron ore → lumps → iron tools. Fields → wheat → quern → flour + jar of water → dough → bread.
- **Survival.** Food, water, stamina and health. Fires need fuel and kindling. Boars fight back. Death
  drops your belongings where you fell; build a bed to set your home.

## Project layout

```
src/
  data/       items, skills, recipes, structures (pure data — easy to extend)
  world/      terrain heightmap + rock layer, world entities, noise, rendering
  game/       game loop, player/camera, actions, inventory, input, sky
  ui/         HUD, windows, context menu
```

Adding content is mostly data: new items go in `data/items.ts`, recipes in `data/recipes.ts`,
buildings in `data/structures.ts`, and new interactions in `game/actions.ts`.
