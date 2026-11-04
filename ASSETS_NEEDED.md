# Assets still needed

Everything below is currently drawn procedurally (simple shapes) or synthesized
(beeps). Upload replacements and they get wired in. Highest impact first in
each list.

## Models (`.glb`, put in `assets-src/models/`)

Tools are held with the grip at the origin, handle up, working end forward.
Animals should be rigged if possible (walk, run, idle, graze, death).

**Animals** (biggest visual win)
- `horse.glb` (also used saddled when tamed), `ox.glb` (with a yoke when tamed)
- `deer.glb`, `boar.glb`

**Carts and gear worn on the body**
- `hand_cart.glb` (two wheels, handles behind), `ox_cart.glb` (solid wheels, shafts forward)
- `hide_backpack.glb`, `quiver.glb` (with arrows showing), `hide_canteen.glb`
- `saddle.glb` (on a tamed horse), `ox_yoke.glb`

**Character animations** (same rig as the character)
- `ride` (sitting astride a horse: it currently uses the crouch pose)
- `sit` (chairs, benches), `sleep` (lying in bed)
- `bow_draw` / `bow_shoot`, `push_cart`, `lead_animal`, `drink_canteen`
- `swim`, `carry_heavy` (a log on the shoulder)

**Iron tools and weapons** (the stone ones are done)
- `iron_hatchet.glb`, `iron_pickaxe.glb`, `iron_shovel.glb`, `iron_hammer.glb`, `iron_knife.glb`
- `stone_hoe.glb`, `iron_hoe.glb`, `wooden_hammer.glb` (mallet)
- `saw.glb`, `scythe.glb`, `iron_sword.glb`, `iron_tongs.glb`
- `bow.glb`, `arrow.glb`, `torch.glb`

**Building**
- `cabin_log.glb` (one cabin log, ~2.3 m, for log walls; a second variation is a bonus)

**Stations and smithy**
- `chopping_block.glb`, `forge.glb`, `bellows.glb`, `stone_anvil.glb`
- `workbench.glb`, `quern.glb`, `chest.glb`, `bed.glb`
- `crucible.glb`, `clay_jar.glb`

**Furniture** (made at the workbench)
- `stool`, `chair`, `bench`, `rocking_chair`, `armchair`
- `side_table`, `table`, `dining_table`, `writing_desk`
- `shelf`, `cupboard`, `dresser`, `barrel`, `tool_rack`
- `hide_rug`, `potted_plant`, `spinning_wheel`, `fine_bed` (four-poster)

**Trees and world props**
- `apple_tree.glb` (small orchard tree; apples separate or as a variant)
- `boulder.glb` (2–3 variations), `fallen_log.glb`, `berry_bush.glb`
- Forage: `fiber_grass`, `small_rocks`, `fallen_branch`, `flint`, `driftwood`, `reeds`, `apple`,
  mushrooms (`brown_cap`, `fly_agaric`, `death_cap`, `chanterelle`),
  herbs (`yarrow`, `hemlock`, `mint`, `wild_onion`, `wild_wheat`)
- `wheat_crop` (growth stages)

**Villages** (the houses are built from the normal building pieces, so better wall, roof and log models improve them too)
- `well.glb` (stone ring, posts, winch, small roof; currently simple shapes)
- `water_trough.glb` (for animal pens), `hay_bale.glb`, `signpost.glb` (village name at the roads in)
- `thatch_roof` piece variant with overhanging eaves (village houses use the plain 45° roof)

## Textures (PBR: `_color`, `_normal`, `_orm`, in `public/textures/`)

- `terrain/sandstone_*` (sandstone ground currently reuses rock)
- `building/bark_*` and `building/end_grain_*` (log ends, chopping block, cart wheels)
- `props/hide_leather_*` (backpack, quiver, canteen, saddle, rugs, armchair, clothing)
- `props/cloth_*` (linen: beds, bandages, saddle blanket)
- `props/iron_*` (forged metal: tools, anvil, cart wheel rims, hinges)
- `props/clay_fired_*` (jars, crucible)
- `animals/horse_*`, `animals/ox_*`, `animals/deer_*`, `animals/boar_*` (if the models come untextured)
- `building/roof_shingles_*` (optional: a second roof style)
- `terrain/dirt_path_*` (packed, trodden dirt for village paths; they use the plain dirt ground now)

## Sounds (`.ogg`/`.mp3`, mono, in `public/sounds/`; ×3 = give 3–5 takes)

**Footsteps** (none exist yet: biggest win)
- `footstep_grass` ×3, `footstep_dirt` ×3, `footstep_stone` ×3, `footstep_sand` ×3,
  `footstep_wood` ×3, `footstep_water` ×3, `land` ×2

**Ambience loops** (30–90 s, seamless)
- `wind`, `birds`, `night` (crickets), `river`, `frogs`, `fire_loop`, `forge_roar`, `rain`

**Horses, oxen and carts**
- `hooves_walk` (loop), `hooves_gallop` (loop), `horse_neigh` ×2, `horse_snort` ×2, `horse_eat` (crunching an apple)
- `ox_moo` ×2, `ox_snort`, `cart_roll` (loop: wooden wheels on ground), `cart_creak` ×2, `harness_jingle`

**Woodcutting and building**
- `chop` ×3, `creak`, `crash`, `split` ×3 (log splitting on the block), `wood_drop` ×2,
  `hammer_nail` ×3, `saw` ×2, `whittle` ×2, `plank_set` ×2 (setting a plank in place)

**Stone and earth**
- `clink` ×3, `knap` ×3, `dig` ×3, `hoe` ×2 (tilling and levelling), `rock_break`

**Smithing**
- `anvil` ×3, `bellows` ×2, `quench`

**Gathering, crafting and gear**
- `pick_plant` ×3, `pick_rock` ×2, `pick_apple` ×2, `bush_rustle` ×2, `rope_twist` ×2, `bowdrill`,
  `fire_ignite`, `pour_water`, `drink` ×2, `eat` ×3,
  `canteen_fill`, `canteen_drink`, `backpack_rustle`, `arrow_into_quiver` ×2

**Combat and animals**
- `swing` ×2, `hit_flesh` ×3, `bow_draw`, `bow_release`, `arrow_hit` ×2, `player_hurt` ×2,
  `boar_grunt` ×3, `boar_squeal`, `deer_call`, `deer_run`

**Interface**
- `ui_click`, `ui_open`, `map_open` (parchment unrolling), `quest_new`, `quest_complete`,
  `craft_done`, `level_up`, `taming_success`, `door_open`, `door_close`

Free sources: Freesound (CC0 filter), Pixabay Sound Effects, Sonniss GDC bundles,
Poly Haven / ambientCG (textures, CC0), Meshy (models).
