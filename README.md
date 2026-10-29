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

No server is needed — the world and your character save to the browser's `localStorage` (only the terrain
chunks you changed are stored; the rest regenerates from the seed).

## Controls

| Key | Action |
| --- | --- |
| WASD / Shift / Space | Move / sprint / jump |
| Mouse | Look |
| **V** | Toggle first / third person (mouse wheel zooms in third person) |
| Left click / E | Default action on what you're looking at |
| Right click / F | Action menu (choose with mouse or 1-9) |
| 1-9 / 0 | Activate hotbar item / bare hands (drag items from the inventory onto the hotbar to bind them) |
| R / X | Repeat last action / stop current action |
| I or Tab, C, B, K, H | Inventory, Crafting, Build, Skills, Help |
| ` or F2 | Dev console (cheats) |

## Dev console

Press **`** (backtick) or **F2** for a cheat panel, handy for testing. Toggles: instant crafting, instant actions,
always succeed, free crafting, free building, no player needs, god mode, no carry limit, no tool wear, peaceful
animals and fly mode (Space up, Q down, Shift fast). It can also change time speed or jump to a time of day, give any
item at any QL, set all skills, refill needs, teleport home, grow everything, spawn animals and clear your inventory.
Toggles are remembered per browser; a purple **DEV** badge shows while any cheat is active.

## What makes it "Wurm-like"

- **Timed actions with skill checks.** Everything takes time, can fail, and trains one of 15 skills
  (woodcutting, mining, digging, carpentry, smithing, cooking, farming, fighting…). Skills rise from 1
  toward 100 with steep diminishing returns, and you learn most from tasks near your level.
- **Item quality (QL) and damage.** Every item is an individual with its own QL. Results depend on skill,
  tool QL and material QL. Tools wear out and eventually break.
- **The active item decides your options.** Activate a shovel and the action menu offers Dig, Flatten,
  Cultivate; a pickaxe offers Mine; bare hands forage.
- **Voxel terrain you can reshape anywhere.** The world is a smooth voxel landscape (Surface Nets on a
  1 m grid, like Enshrouded). With a shovel you **dig**, **raise**, **smooth** and **level ground to your
  feet** (Valheim-style); a pickaxe mines rock in any direction, so you can tunnel into hills, find caves
  and dig out **iron veins**. Every 0.5 m³ you remove becomes an item, and filling hollows uses the dirt
  you carry. A ring on the ground shows the area your tool will work.
- **Valheim-style planning, Wurm-style building.** Pick a piece (B) and a ghost follows your aim,
  snapping floors to floors, walls to floor edges and wall tops, roofs onto walls; rotate with the mouse
  wheel or Q/E and keep placing. Each placed plan must then be built with "Continue building", spending
  one material per step with the right tool and skill — so quality and failure still matter.
- **Foraging that reads the land.** Meadows, forest floor, shores and wetlands each give different finds
  (fiber and wild seeds; branches, mushrooms and seedlings; pebbles and driftwood; reeds). Every 12 m area
  holds only two or three finds and regrows one every four minutes, so you forage by roaming, not by spamming.
- **Production chains.** Fiber → cordage → stone tools → logs → planks/shafts → shovel → clay → forge +
  anvil → iron ore → lumps → iron tools. Fields → wheat → quern → flour + jar of water → dough → bread.
- **Survival.** Food, water, stamina and health. Fires need fuel and kindling. Boars fight back. Death
  drops your belongings where you fell; build a bed to set your home.

## Project layout

```
src/
  data/       items, skills, recipes, structures (pure data — easy to extend)
  world/      voxel terrain (generation, meshing, sculpting), world entities, noise, rendering
  game/       game loop, player/camera, actions, inventory, input, sky
  ui/         HUD, windows, context menu
```

Adding content is mostly data: new items go in `data/items.ts`, recipes in `data/recipes.ts`,
building pieces (with their colliders and snap points) in `data/structures.ts`, and new interactions in `game/actions.ts`.
