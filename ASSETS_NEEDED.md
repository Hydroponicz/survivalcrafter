# Assets still needed

Everything below is currently drawn procedurally (simple shapes) or synthesized
(beeps). Upload replacements and they get wired in. Highest impact first in
each list.

## Models (`.glb`, put in `assets-src/models/`)

Tools are held with the grip at the origin, handle up, working end forward.

**Animals** (biggest visual win; ideally rigged with walk/run/idle/attack/death)
- `deer.glb`
- `boar.glb`

**Iron tools and weapons** (the stone ones are done)
- `iron_hatchet.glb`, `iron_pickaxe.glb`, `iron_shovel.glb`, `iron_hammer.glb`, `iron_knife.glb`
- `stone_hoe.glb`, `iron_hoe.glb`
- `wooden_hammer.glb` (mallet)
- `saw.glb`, `scythe.glb`, `iron_sword.glb`, `iron_tongs.glb`
- `bow.glb`, `arrow.glb`
- `torch.glb`

**Stations and smithy**
- `chopping_block.glb` (log stump with axe marks)
- `forge.glb`, `bellows.glb`, `stone_anvil.glb`
- `workbench.glb`, `quern.glb`
- `chest.glb`, `bed.glb`
- `crucible.glb`, `clay_jar.glb`

**Furniture** (made at the workbench)
- `stool`, `chair`, `bench`, `rocking_chair`, `armchair`
- `side_table`, `table`, `dining_table`, `writing_desk`
- `shelf`, `cupboard`, `dresser`, `barrel`, `tool_rack`
- `hide_rug`, `potted_plant`, `spinning_wheel`, `fine_bed` (four-poster)

**World props**
- `boulder.glb` (2–3 variations), `fallen_log.glb`
- `berry_bush.glb`
- Forage: `fiber_grass`, `small_rocks`, `fallen_branch`, `flint`, `driftwood`, `reeds`,
  mushrooms (`brown_cap`, `fly_agaric`, `death_cap`, `chanterelle`),
  herbs (`yarrow`, `hemlock`, `mint`, `wild_onion`, `wild_wheat`)
- `wheat_crop` (growth stages)

## Textures (PBR: `_color`, `_normal`, `_orm`, in `public/textures/`)

- `terrain/sandstone_*` (sandstone ground currently reuses rock)
- `building/bark_*` (log ends and sides: chopping block, log walls' cut ends)
- `building/end_grain_*` (sawn log faces)
- `props/hide_leather_*` (rugs, armchair, bed, clothing)
- `props/cloth_*` (linen for beds and bandages)
- `props/iron_*` (forged metal: tools, anvil, hinges)
- `props/clay_fired_*` (jars, crucible)
- `building/roof_shingles_*` (optional: a second roof style)

## Sounds (`.ogg`/`.mp3`, mono, in `public/sounds/`; ×3 = give 3–5 takes)

**Footsteps** (none exist yet: biggest win)
- `footstep_grass` ×3, `footstep_dirt` ×3, `footstep_stone` ×3, `footstep_sand` ×3,
  `footstep_wood` ×3, `footstep_water` ×3, `land` ×2

**Ambience loops** (30–90 s, seamless)
- `wind`, `birds`, `night` (crickets), `river`, `frogs`, `fire_loop`, `forge_roar`, `rain`

**Woodcutting and building**
- `chop` ×3, `creak`, `crash`, `split` ×3, `wood_drop` ×2, `hammer_nail` ×3, `saw` ×2, `whittle` ×2

**Stone and earth**
- `clink` ×3, `knap` ×3, `dig` ×3, `hoe` ×2, `rock_break`

**Smithing**
- `anvil` ×3, `bellows` ×2, `quench`

**Gathering and crafting**
- `pick_plant` ×3, `pick_rock` ×2, `bush_rustle` ×2, `rope_twist` ×2, `bowdrill`,
  `fire_ignite`, `pour_water`, `drink` ×2, `eat` ×3

**Combat and animals**
- `swing` ×2, `hit_flesh` ×3, `bow_draw`, `bow_release`, `arrow_hit` ×2, `player_hurt` ×2,
  `boar_grunt` ×3, `boar_squeal`, `deer_call`, `deer_run`

**Interface**
- `ui_click`, `ui_open`, `map_open` (parchment unrolling), `quest_complete`, `craft_done`,
  `level_up`, `door_open`, `door_close`

Free sources: Freesound (CC0 filter), Pixabay Sound Effects, Sonniss GDC bundles,
Poly Haven / ambientCG (textures, CC0), Meshy (models).
