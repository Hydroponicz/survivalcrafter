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
| G / J / M | Survey for forage / field journal / sound on-off |
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
- **Life underfoot.** Grass sways in the wind around you, coloured by the local climate, with
  flowers in the meadows, ferns under the woods, reeds and cattails along the banks and in the
  shallows, purple-flowering heather on the dry heath and pebbles on rock and shore. Boulders (coloured like the
  bedrock they broke from) and mossy fallen trees lie further out. Fireflies drift over damp ground
  on warm nights.
- **A soundscape from real recordings.** Wind that rises with altitude and on open ground, birdsong
  by day (busiest in the woods and at dawn), crickets at night, frogs in the marshes and a babbling
  brook near rivers. Drop royalty-free recordings into `public/sounds/` and list them in
  `sounds.json` (see `public/sounds/README.md` for names and where to find them); until then
  ambience is silent and effects use small synthesized sounds.
- **A living sky.** A physically based sky (Rayleigh and Mie scattering) with drifting clouds lights the
  world: it's captured as an environment map so everything picks up skylight and water reflects it.
  Distant hills fade into the real horizon colour, sunrise and sunset glow warm with long shadows, stars
  come out at night, and mist pools in the valleys around dawn and lifts by midmorning.
- **An endless world.** The land goes on forever in every direction: continents, coastlines, seas
  and islands, mountain ranges up to ~480 m with snow-capped peaks, big lakes and river networks. The
  map is made in 1 km tiles as you travel (each weathered by simulated rain, drained by rivers and given
  a climate, with a wide overlap so neighbouring tiles join seamlessly), in background workers so the
  game never stalls. The detailed, diggable voxel terrain streams in around you in 16 m chunks; beyond
  it the land stays visible to the horizon as low-detail distant terrain. Trees, bushes, forage and
  animals are generated region by region as you approach; saves keep only what you changed.
- **Trees at real scale.** Full-grown trees stand 12–20 m (with the odd giant), mixed with younger
  trees and saplings, in stands and clearings set by the climate. Big trees take longer to fell and
  give more logs.
- **Weathered, eroded landscapes.** Each world is shaped by simulated rain: ~170,000 droplets run
  downhill, carving gullies into the mountains and laying sediment along valley floors. Soil is thick
  where sediment settled and thin where water stripped it; clay lines the well-watered valley bottoms.
- **Mountains that look like mountains.** Ranges rise from broad massifs with long foothill slopes;
  their ridges curve and branch into spurs with rounded crests, and over-steep crags slump to a natural
  angle with scree gathered below. Above the trees the crests are bare, banded rock; snow lies on the
  gentle ground and drifts into gullies, while the wind scours the ridges and steep faces show through.
- **Climate and vegetation zones.** A prevailing wind brings rain in off the sea; it falls on windward
  slopes and leaves a dry rain shadow behind the ranges, and the air cools with height. Together they
  decide what grows: broadleaf woods on the wet lowlands, grassland, pine forest higher up, dry heath in
  the lee, marsh by the water, stunted alpine pines near the tree line and snow on the peaks. Grass is lush
  or straw-coloured with the rain, and rivers run bigger on the wet side. Examine the ground to read it.
- **Geology you can read.** Beneath the soil, grey granite, tan sandstone and dark shale lie in beds
  that tilt and fold gently across the land, so the same band runs along a cliff and across a gully.
  Iron comes as rusty ironstone seams near the base of certain shale beds (plus a few deep veins in the
  granite): find an outcrop and follow it. Soil is thin on ridges and deep in hollows, fast rivers run
  over gravel, and scree piles up below cliffs.
- **Rivers and lakes.** Drainage is worked out for the whole continent: streams start where enough rain
  gathers, join into rivers that carve their channels down to the sea, and basins fill into lakes deep
  enough to swim in. River beds are sand and grit, lake beds silty clay, and the banks are where you dig
  clay. Drink from any of them; wading through a stream slows you down.
- **Voxel terrain you can reshape anywhere.** The world is a smooth voxel landscape (Surface Nets on a
  1 m grid, like Enshrouded). With a shovel you **dig**, **raise**, **smooth** and **level ground to your
  feet** (Valheim-style); a pickaxe mines rock in any direction, so you can tunnel into hills, find caves
  and dig out **iron veins**. Every 0.5 m³ you remove becomes an item, and filling hollows uses the dirt
  you carry. A ring on the ground shows the area your tool will work.
- **Valheim-style planning, Wurm-style building.** Pick a piece (B) and a ghost follows your aim,
  snapping floors to floors, walls to floor edges and wall tops, roofs onto walls; rotate with the mouse
  wheel or Q/E and keep placing. Each placed plan must then be built with "Continue building", spending
  one material per step with the right tool and skill — so quality and failure still matter.
- **Foraging you can see.** Fiber grass, wild wheat, fallen branches, driftwood, pebbles, reeds,
  mushrooms and herbs grow on the ground where they belong (meadow, forest floor, shore, wetland) and
  regrow over time away from where you're looking. Rare finds only catch your eye once your Foraging is
  high enough — or press **G** to survey: nearby finds glow, gold for ones you'd normally miss.
- **Learning what you pick.** Wild mushrooms and herbs start unidentified, known only by their look
  ("red spotted mushroom"). Recognise them as you pick (Herbalism), **Study** them, or learn by handling
  enough. Some are poisonous — eating an unknown one is a gamble; a yarrow poultice draws out poison.
  Mint tea and hearty stew reward knowing your plants. The field journal (**J**) records it all.
- **Slopes with feedback.** Gentle hills are just tiring; steep ones slow you and drain stamina; slopes
  over about 42° can't be climbed. Pushing into them sends pebbles and dust skittering down and your
  character scrabbles; standing on one, you slide down on your heels. You can always walk across or down
  — dig steps with a shovel or pickaxe to make your own way up.
- **Chopping trees you can feel.** Every swing is a blow: wind up, drive the axe in, and the hit lands
  at the bottom of the stroke with a thunk, flying chips, falling leaves, camera shake and a shudder
  through the tree. A V-notch deepens with each hit (and stays if you walk away). When it's through,
  the tree creaks, topples away from you with gathering speed and crashes down in a cloud of dust,
  leaving a stump and the logs where the trunk landed. First person shows your arm and axe; third person
  shows a two-handed overhead swing. Mining and digging get their own swings too. M toggles sound.
- **Hands-on crafting and building (Schedule 1–style).** Crafting and building steps are 3D minigames at
  the workstation: draw a saw along the line to cut planks, split logs and knap stone with timed strikes,
  carve shafts along a guide, pump the bellows to hold smelting heat, hammer hot iron on the anvil before it
  cools, twist and wrap two-ply cordage (splicing in fibre as strands run thin), turn the quern, stir and pound, throw clay on the wheel, cook over the fire without burning it,
  nail planks, lay stones and stack logs, and start fires with a bow drill. Performance sets most of the
  quality; skill makes the work more forgiving and caps the quality. At skill 10 above a task's difficulty
  you can Quick craft/build to skip the minigame at a quality cost. Right-click stops working.
- **A smithy you set up yourself.** Bellows, anvils and a quench trough are crafted (hands-on) as heavy
  items with their own quality, carried, and placed from your pack with a ghost preview; pick them back up
  to move them. Bellows must sit against a forge's side or the forge can't get hot enough for metal.
  Smelting needs a fired clay crucible and tongs; smithing needs an anvil in reach. Better bellows heat
  faster and hold the band more easily, a better anvil widens the strike timing, and both cap the quality
  you can reach (an iron anvil, cast from eight lumps, beats any stone one). Fresh forgings come out
  glowing: quench them in the trough before they cool (dip, lift before the steel cracks) to harden them.
- **Production chains.** Fiber → cordage → stone tools → logs → planks/shafts → shovel → clay → forge +
  bellows + anvil + crucible + tongs → iron ore → lumps → iron tools → quench. Fields → wheat → quern → flour + jar of water → dough → bread.
- **Survival.** Food, water, stamina and health. Fires need fuel and kindling. Boars fight back. Death
  drops your belongings where you fell; build a bed to set your home.

## Project layout

```
src/
  data/       items, skills, recipes, structures (pure data — easy to extend)
  world/      voxel terrain (generation, erosion, meshing, sculpting), world entities, noise, rendering
  game/       game loop, player/camera, actions, inventory, input, sky
  game/minigames/  the hands-on crafting and building minigames
  ui/         HUD, windows, context menu
```

Adding content is mostly data: new items go in `data/items.ts`, recipes in `data/recipes.ts`,
building pieces (with their colliders and snap points) in `data/structures.ts`, and new interactions in `game/actions.ts`.
