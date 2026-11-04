# Assets still needed

Everything not marked **done** is drawn procedurally (simple shapes), or synthesized
(beeps), or missing. Upload replacements and they get wired in. Within each list,
the highest-impact items come first. Tiers: **A** = seen constantly, biggest visual or
audio win; **B** = seen often; **C** = nice to have.

Already in: the player/villager character (rigged, 27 clips), oak, maple, pine,
spruce, beech, birch and willow trees, the stone tools (knife, hatchet, pickaxe,
hammer, spear), the wooden shovel and tongs, campfire, iron anvil and wooden bucket;
textures for terrain (grass, dirt, field, mud, clay, sand, gravel, rock, shale,
ironstone, snow) and building (planks, dark planks, log wall, rough wood, rough
stone wall, stone foundation, thatch). No sounds yet.

---

## 1. Rigged models and their animations

Put rigged models in `assets-src/models/` (`.glb`, with every clip in the one file,
named as below). Loops are marked ⟳. Clips should start and end in a neutral pose
so they blend; "in place" means no root motion (the game moves the body).

### 1a. Humanoid: the player and every villager (one rig, `character.glb`)

The player and all villagers share this body; villagers are recoloured. A second
body (female) and a few head or hair variants on the **same skeleton** would
make crowds read far better (Tier A).

**Have (27):** idle⟳, walk⟳, run⟳, sprint⟳, sprint_long⟳, walk_back⟳, strafe_left⟳,
strafe_right⟳, jump, pickup, crouch_idle⟳, crouch_walk⟳, chop, mine, gather, sickle,
hammer, place, craft⟳, drink, eat⟳, interact⟳, attack_one, attack_two, block, hurt, death.

**Needed, Tier A** (in use now with a stand-in clip):
| Clip | Used for | Stand-in today |
|---|---|---|
| `sleep` ⟳ (lying on the back, slow breathing) | everyone in bed at night | idle, rotated flat |
| `sit` ⟳ (on a bench/chair/stool) + `sit_down`, `stand_up` | lunch and evenings on benches, tavern, great hall, pews | standing idle |
| `ride_idle` ⟳, `ride_walk` ⟳, `ride_gallop` ⟳ (astride, reins) | riding a horse | crouch_idle |
| `push_cart` ⟳ (walking, both hands low on handles) | hand cart, every travelling trader | walk |
| `dig` (shovel: thrust, lever, throw) | digging, digging out stumps, villagers ploughing | mine |
| `hoe` (short chopping strokes at the ground) | tilling, levelling, weeding | mine |
| `sow` ⟳ (scattering seed from a bag) | sowing (player and farmers) | gather |
| `talk` ⟳ (gesturing while speaking, 2–3 variants) | villagers chatting, merchants, mayor holding court, elder at doors | interact |
| `pray` ⟳ (kneel, hands together) + `kneel_down`, `rise` | priest at the altar, pews | interact |
| `guard_idle` ⟳ (weapon at rest, weight shifting) + `guard_walk` ⟳ | guards at gates and on rounds | idle, walk |

**Needed, Tier B:**
- Work: `saw` ⟳ (two-handed back and forth), `whittle` ⟳ (seated, knife), `knead` ⟳ (dough on a table),
  `grind` ⟳ (turning a quern handle), `stir` ⟳ (pot over a fire), `split_log` (overhead axe onto the
  block; chop is close), `shear` ⟳ (bent over a sheep), `butcher` ⟳ (kneeling, knife), `smith_strike` ⟳
  (hammer on the anvil: hammer is close), `bellows` ⟳, `quench` (dip and hold), `fish` (future)
- Carrying: `carry_heavy_idle` ⟳ / `carry_heavy_walk` ⟳ (a log on the shoulder), `carry_box` ⟳ (goods to the stores)
- Animals: `lead_animal` ⟳ (walking with a halter rope), `feed_animal` (offering from the palm), `mount`, `dismount`
- Social: `wave`, `bow` (greeting the lord), `cheer`, `toast` (raising a cup), `drink_cup` (tavern; drink is
  a canteen gulp), `haggle` ⟳, `laugh`, `point`
- Combat: `bow_draw` ⟳ (hold at full draw), `bow_release`, `spear_thrust`, `sword_slash_1/2`, `shield_block` ⟳,
  `dodge_back`, `stagger`
- Water: `swim` ⟳, `tread_water` ⟳, `wade` ⟳

**Tier C:** `climb_ladder` ⟳ and `climb_stairs` ⟳ (for when buildings get stairs), `open_door`, `sit_ground` ⟳,
`sleep_ground` ⟳ (bedroll), `warm_hands` ⟳ (by a fire), `sweep` ⟳, `get_up` (after a fall), `death_2`,
`death_forward`, `fall_loop` ⟳, `land_roll`.

### 1b. Horse (`horse.glb`), Tier A

Shown now as a box figure with swinging legs. Saddled and unsaddled (saddle as a separate mesh is ideal), a few coat colours or a coat texture to tint.
- `idle` ⟳ (tail swish, ear flicks), `idle_graze` ⟳ (head down eating), `walk` ⟳, `trot` ⟳, `canter` ⟳, `gallop` ⟳
- `turn_left`, `turn_right` (in place), `rear`, `buck`, `shake` (mane and body), `eat_from_hand` (apple)
- `hurt`, `death`, `lie_down`, `sleep` ⟳, `get_up`
- Ridden versions run the same gaits; a `ridden_idle` ⟳ with head toss is a bonus.

### 1c. Ox (`ox.glb`), Tier A

With and without a yoke (separate yoke mesh ideal).
- `idle` ⟳, `idle_graze` ⟳, `walk` ⟳, `trot` ⟳ (rarely), `pull` ⟳ (leaning into the yoke with a cart)
- `head_shake` (refusing to be tamed), `accept` (lowering the head: tamed), `moo`
- `hurt`, `death`, `lie_down`, `sleep` ⟳, `get_up`

### 1d. Sheep (`sheep.glb`), Tier A

Two meshes or a blend shape: **woolly** and **shorn** (the game knows each sheep's fleece).
- `idle` ⟳, `graze` ⟳, `walk` ⟳, `run` ⟳ (flock scatter), `bleat`, `held_still` ⟳ (being sheared)
- `hurt`, `death`, `lie_down`, `sleep` ⟳; a `lamb` scale variant is a bonus

### 1e. Deer (`deer.glb`), Tier B

Buck (antlers) and doe.
- `idle` ⟳, `graze` ⟳, `alert` (head up, ears forward), `walk` ⟳, `trot` ⟳, `run` ⟳ (bounding)
- `leap`, `hurt`, `death`

### 1f. Boar (`boar.glb`), Tier B

- `idle` ⟳, `root` ⟳ (snout in the ground), `walk` ⟳, `trot` ⟳, `run` ⟳
- `charge_windup` (head down, pawing: the game uses a 0.6 s wind-up), `charge` ⟳, `gore` (attack), `squeal`
- `stagger` (hit), `hurt`, `death`

### 1g. Future animals (Tier C, for planned features)
- `chicken.glb` (idle, peck⟳, walk⟳, flap, death), `dog.glb` (a companion or a herder's dog: idle, sit, walk,
  run, bark, follow), `wolf.glb` (idle, walk, run, attack, howl, death), `goat.glb`, `pig.glb`, `cow.glb`
  (village livestock variety), `cat.glb` (towns).

---

## 2. Static models (`.glb`, in `assets-src/models/`)

Tools are held with the grip at the origin, handle up, working end forward.

**Tier A: seen everywhere in villages, towns and cities**
- Building pieces (every settlement is built from these, so better versions upgrade every house at once):
  `cabin_log.glb` (one log of a log wall, ~2.3 m; a second variation is a bonus), `door.glb` (planked, iron
  hinges), `window_wall.glb` (shutters!), `roof_thatch.glb` with overhanging eaves, `roof_slate.glb` (stone
  buildings in towns), `gable.glb`, `floor.glb`, `stone_wall.glb` (dressed stone, with a version showing
  quoins for corners), `fence.glb`, `gate.glb`
- Castle: `crenellated_wall.glb` (castle wall top with battlements), `corner_tower_top.glb` (battlements and
  a conical or flat roof), `gatehouse_arch.glb` and `portcullis.glb` (the gate is an open gap now),
  `keep_roof.glb`, `banner.glb` (cloth, for the keep and towers; animated cloth is a bonus)
- Town: `market_stall.glb` (with goods; a cloth awning in 3 colours), `palisade_stakes.glb` (pointed logs:
  the palisade is log walls now), `palisade_gate.glb`, `tavern_sign.glb`, `well.glb` (a stone ring with a
  winch roof: currently simple shapes), `village_storehouse.glb`
- Carts: `hand_cart.glb` (every trader pushes one), `ox_cart.glb`
- Furniture (fills every house, the tavern, the hall): `bed.glb`, `chest.glb`, `table.glb`, `stool.glb`,
  `bench.glb`, `dining_table.glb`, `barrel.glb`, `shelf.glb`

**Tier B**
- Stations: `chopping_block.glb`, `forge.glb`, `bellows.glb`, `stone_anvil.glb`, `workbench.glb`, `quern.glb`,
  `water_trough.glb`, `crucible.glb`, `clay_jar.glb`
- Gear on the body: `hide_backpack.glb`, `quiver.glb` (arrows showing), `hide_canteen.glb`, `saddle.glb`, `ox_yoke.glb`
- Iron tools and weapons: `iron_hatchet.glb`, `iron_pickaxe.glb`, `iron_shovel.glb`, `iron_hammer.glb`,
  `iron_knife.glb`, `stone_hoe.glb`, `iron_hoe.glb`, `wooden_hammer.glb`, `saw.glb`, `scythe.glb`,
  `iron_sword.glb` (every guard carries one), `iron_tongs.glb`, `bow.glb`, `arrow.glb`, `torch.glb`
- More furniture: `chair`, `rocking_chair`, `armchair`, `side_table`, `writing_desk`, `cupboard`, `dresser`,
  `tool_rack`, `hide_rug`, `potted_plant`, `spinning_wheel`, `fine_bed` (four-poster), `altar.glb`, `pew.glb`

**Tier C: nature and small things**
- `apple_tree.glb`, `boulder.glb` (2–3 variations), `fallen_log.glb`, `berry_bush.glb`, `stump.glb`
  (cut top; 2 sizes)
- Forage: `fiber_grass`, `small_rocks`, `fallen_branch`, `flint`, `driftwood`, `reeds`, `apple`,
  mushrooms (`brown_cap`, `fly_agaric`, `death_cap`, `chanterelle`), herbs (`yarrow`, `hemlock`, `mint`,
  `wild_onion`, `wild_wheat`)
- `wheat_crop` (5 growth stages), `hay_bale.glb`, `signpost.glb` (a settlement's name at the roads in),
  `milestone.glb` (on roads), `sack.glb`, `crate.glb`, `bucket.glb`, `cauldron.glb` (tavern hearth)
- Stairs and ladders: `spiral_stair.glb`, `ladder.glb` (upper floors and towers have no way up yet)

---

## 3. Textures (PBR: `_color`, `_normal`, `_orm`, 1–2K, tileable, in `public/textures/`)

**Tier A**
- `terrain/cobbles_*` (town streets and squares: they use gravel now), `terrain/dirt_path_*` (packed, rutted
  road dirt: roads use plain dirt now), `terrain/sandstone_*` (sandstone ground reuses rock)
- `building/dressed_stone_*` (smooth cut stone for the cathedral, keep and villas, next to the rough
  stone), `building/slate_roof_*`, `building/plaster_timber_*` (half-timbered upper storeys for town
  houses: a big look upgrade)
- `characters/` clothing atlas variants (tunic, dress, robe for the priest, surcoat for guards, fine clothes
  for nobles), if the body is re-textured rather than vertex-coloured

**Tier B**
- `building/bark_*` and `building/end_grain_*` (log ends, chopping block, stumps, cart wheels)
- `props/hide_leather_*` (backpack, quiver, canteen, saddle, rugs, armchair, clothing)
- `props/cloth_*` (linen: beds, bandages, saddle blanket, market awnings, banners)
- `props/iron_*` (forged metal: tools, anvil, wheel rims, hinges, portcullis)
- `props/clay_fired_*` (jars, crucible)
- `animals/horse_*`, `animals/ox_*`, `animals/sheep_wool_*`, `animals/deer_*`, `animals/boar_*` (if models come untextured)

**Tier C**
- `building/roof_shingles_*` (a wooden-shingle roof style), `terrain/forest_floor_*` (leaf litter under woods),
  `terrain/farmland_rows_*` (furrows for ploughed fields), `decals/` (mud, blood, scorch marks)

---

## 4. Sounds (`.ogg`/`.mp3`, mono, 44.1 kHz, in `public/sounds/`; ×3 = give 3–5 takes)

**Tier A: heard all the time**
- Footsteps: `footstep_grass` ×3, `footstep_dirt` ×3, `footstep_gravel` ×3 (town streets), `footstep_stone` ×3,
  `footstep_wood` ×3 (floors), `footstep_sand` ×3, `footstep_water` ×3, `land` ×2
- Ambience loops (30–90 s, seamless): `wind`, `birds`, `night` (crickets), `river`, `frogs`, `rain`,
  `village_day` (distant voices, a cockerel, a dog), `town_day` (crowd murmur, carts on cobbles),
  `market_crowd`, `tavern_crowd` (inside), `fire_loop`, `forge_roar`
- Work: `chop` ×3, `tree_creak`, `tree_crash`, `hammer_nail` ×3, `dig` ×3, `hoe` ×2, `pick_plant` ×3, `pick_rock` ×2

**Tier B**
- Animals: `horse_neigh` ×2, `horse_snort` ×2, `hooves_walk` ⟳, `hooves_gallop` ⟳, `horse_eat`; `ox_moo` ×2, `ox_snort`;
  `sheep_bleat` ×3, `shears` ×2; `boar_grunt` ×3, `boar_squeal`; `deer_call`, `deer_run`
- Carts and roads: `cart_roll` ⟳ (wooden wheels), `cart_creak` ×2, `harness_jingle`
- Settlements: `church_bell` ×2 (dawn and dusk from the cathedral), `door_open`, `door_close`, `gate_creak`,
  `anvil_distant` ×2 (the smith, heard across the village), `saw` ×2, `well_winch`, `coins` ×2 (buying and selling)
- Crafting and gear: `split` ×3 (logs on the block), `wood_drop` ×2, `whittle` ×2, `plank_set` ×2, `rope_twist` ×2,
  `bowdrill`, `fire_ignite`, `pour_water`, `drink` ×2, `eat` ×3, `canteen_fill`, `canteen_drink`, `backpack_rustle`,
  `arrow_into_quiver` ×2, `anvil` ×3, `bellows` ×2, `quench`, `clink` ×3, `knap` ×3, `rock_break`, `quern_grind` ⟳
- Combat: `swing` ×2, `hit_flesh` ×3, `bow_draw`, `bow_release`, `arrow_hit` ×2, `player_hurt` ×2, `sword_clash` ×2

**Tier C**
- Voices (wordless barks are enough): `villager_greet` ×4 (male and female), `merchant_call` ×3 ("Fresh bread!"),
  `guard_halt`, `lord_greet`, `tavern_cheer` ×2, `priest_chant` ⟳
- Interface: `ui_click`, `ui_open`, `map_open` (parchment), `quest_new`, `quest_complete`, `craft_done`,
  `level_up`, `taming_success`, `work_order_done`
- Music (optional): `theme_day`, `theme_night`, `theme_town` (lute/recorder), `theme_castle` (2–3 min each, loopable)

---

Free sources: Freesound (CC0 filter), Pixabay Sound Effects, Sonniss GDC bundles (sounds); Poly Haven and
ambientCG (CC0 textures); Mixamo (humanoid animation clips: the character uses its rig); Meshy and Sketchfab CC0 (models).
