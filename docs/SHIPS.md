# Boats and ships: plan

From a log hollowed out by fire to a three-masted ship built on a slip, on one
set of systems, so each new craft is mostly data.

## Did they have dry docks in medieval times?

Mostly no: a dry dock is a late arrival.

- **Antiquity** had something like it. Ptolemaic Egypt dug a pit by the Nile
  to build a giant galley in (3rd century BC), and Greek and Roman navies kept
  their warships in **ship sheds**: long roofed slipways to haul them out on.
- **Medieval Europe** built ships on the open shore or a riverbank, or on a
  **slipway**. A slipway is a sloped bed of timbers running down into the
  water; the hull grows on blocks and wedges on it and slides in at launch.
  Big ports had **shipyards** around their slips: Venice's **Arsenal**
  (from 1104, with roofed slips) could build a galley a day by the 1500s, a
  production line centuries ahead of anywhere else.
- **Repairs** were made by **careening**: beaching the ship at high tide and
  heeling it over to reach the bottom. A **grid iron** (a timber frame on the
  foreshore that a ship settles onto as the tide falls) did the same job.
- **The first dry dock in England** was built at Portsmouth in **1495** for
  Henry VII: a pit with timber-and-stone walls and gates, pumped dry. That is
  the very end of the Middle Ages.

So for the game: the **shipyard with a slipway** is the medieval centrepiece
(and the place big ships are built). A **dry dock** can be a late, expensive
upgrade, for repairing big hulls without careening. A **careening beach or
grid iron** is the cheap way to repair.

## The systems (built now)

Everything you can load and move that isn't an animal is a **vessel**
(`src/data/vessels.ts`). Carts and boats are rows in one table:

| Field | What it says |
|---|---|
| `medium` | `land` (on wheels) or `water` (it floats) |
| `capacity` | kg it holds (a container like a chest, opened from the vessel) |
| `hit` | its size, for aiming at it |
| `move` | how it moves: `push` (by hand, at that walking speed), `hitch` (to an ox), `water` (paddle, pole or oars: speed, turn, the gear it needs) |
| `draft` | how deep it sits: it can't go where the water is shallower |
| `seats` | where people sit (the first is the steerer) |
| `stand` | you stand on it (a raft) rather than kneel in it |
| `fragile`, `repair` | how easily running aground wears the hull, and what patches it |
| `item` | carried in a pack as this item (else it stays in the world) |

The shared code handles every vessel: placing it in the world, saving it,
aiming at it, opening its hold, dragging it, boarding it, steering it,
running aground, and stepping ashore.

**Hulls are built in place.** A boat is a build piece (`STRUCTURES`) worked
step by step like a wall. Its `becomes` field names the vessel it turns into
when finished. The dugout works this way now. The shipyard's big ships will
too, only built from many pieces.

## Phase 1 (done): the dugout canoe

- **Make it:** Build menu → Boats → Dugout canoe. Place it near the water.
  Work it with a hatchet: 3 logs (one good tree) and 4 kindling (the fire
  that chars the wood to scoop out).
- **Launch it:** grab it and drag it down into the water (slowly: it's heavy).
- **Paddle it:** a paddle (carved from a plank and a shaft with a knife) gives
  full speed; without one you scoop with your hands.
  - W/S: paddle ahead or back.
  - A/D: steer.
  - Shift: dig in (tiring).
  - X: step ashore, or over the side if there's no shore in reach.
- **Use it:** it holds 160 kg (open it like a cart). It runs aground in water
  shallower than 22 cm.

## Next phases

**2. More small craft (done).** Each is a row in the table, a model and a
build piece or recipe:

| Craft | Made from | Drive | Holds | Character |
|---|---|---|---|---|
| Log raft | 6 logs, 4 cordage (hatchet) | punt pole, standing | 300 kg | slow; the pole can't reach the bottom past 2.6 m deep |
| Reed boat | 24 plant fiber, 6 cordage (knife) | paddle | 90 kg | carried in your pack (18 kg); tears on the bottom |
| Coracle | 8 branches, 2 hides, 3 cordage (Crafting) | paddle | 60 kg | carried (12 kg); one person; spins on the spot |
| Skin boat (currach) | 8 shafts, 6 hides, 6 cordage (knife) | paddle | 240 kg | fast for its weight; the hide can tear |
| Rowing boat | 10 refined planks, 4 planks, 4 shafts (hammer) | a pair of oars | 450 kg | fastest and sturdiest |

What came with them:
- **Gear for each drive:** a paddle, a punt pole, or a pair of oars, all from
  Crafting. Without the right gear you scoop with your hands at about a third
  of the speed.
- **Standing or kneeling:** you stand on a raft's deck and kneel in a hull.
- **Small boats carry:** pick them up into your pack and set them down at the
  water.
- **Hull wear:** running aground hard wears a hull, more for fragile ones. A
  worn hull leaks and is slower; a wrecked one is swamped and throws you out.
  Patch it ashore with its own material: fiber for reeds, hide for
  hide-covered boats, a log for a dugout, a refined plank for a planked boat.

**3. The shipyard and its slipway (done)**

**The slipway** (Build menu, Boats: 10 logs and 10 planks, with a hatchet) is
a 28 m bed of timbers on piles. It runs down the shore into water at least
1.6 m deep at its far end, and turns itself toward the deepest water while you
place it. Aim at it to open the **shipyard**.

**The shipyard window** is where you draw up a ship:
- **Type** to start from:
  - Longship
  - Knarr
  - Cog
  - Hulk
  - Caravel
- **What you can change:**
  - length (14 to 26 m)
  - beam (narrow, medium or broad)
  - planking (clinker or carvel)
  - masts (one or two)
  - rig (square or lateen)
  - castles (none, sterncastle, or fore and aft)
  - deck (open hold or decked)
- **What it shows:** she's worked out as you choose. Length and beam, draft,
  cargo in tonnes, speed in knots and handiness, steps to build, and every
  material she'll take.

**Laying her down** sets up the keel blocks. Aim at her and work through the
stages in order:

| Stage | Tool | Done by |
|---|---|---|
| Keel | hatchet | hewing |
| Stem and sternpost | hatchet | hewing |
| A frame for each bay | saw | sawing |
| Planking for each bay | hammer | riveting or nailing, with fiber caulking |
| Deck (if decked) | hammer | nailing |
| Castles | hammer | nailing |
| Masts | hatchet | hewing |
| Sails | knife | sewing wool |
| Rudder | hammer | fitting |

Each step takes its materials, and the ship grows on the slip as you go:
- the keel and posts
- ribs on the open frame
- the planked hull, bay by bay, then its strakes and wale
- the deck, castles, masts with shrouds, square or lateen sails, and a
  steering oar or sternpost rudder

**Launching:** she slides down the ways, gathering speed, and settles to her
waterline beyond the slip's end.

**Sailing:** take the helm, up on the sterncastle if she has one.
- **W** makes more sail and **S** shortens it (and backs her off).
- She gathers way and loses it slowly.
- **A/D** work the rudder.

What came out in testing:

| Ship | Speed | Cargo | Turning |
|---|---|---|---|
| Cog | about 3.9 knots | 43 t | steady (63° in 6 s) |
| Caravel | about 6.4 knots | 26 t | nimble (97° in 6 s) |
| Longship | about 7.2 knots | 14 t | handy (70° in 6 s) |

The longship draws only 0.6 m, so she can be run up on a beach.

**Repairs:** a ship's bottom can only be reached when she's careened (run
aground on a beach) or on a slip. Patch it with refined planks.

**Then:** wind, walking on deck and oars on big ships came in phases 4 and 5.

**4. Sailing (done; crews still to come)**

**The wind:** it comes from the region's prevailing wind (the one that
already drives the climate). Over the hours it veers and backs up to 60°
either side of that, and rises and falls between a light air and a strong
breeze (about 2 to 12 m/s). The grass sways with it, and it's loud out on
the water.

**How each rig takes it:** speed under sail depends on the wind's angle off
her bow, from a polar curve for each rig (`sailPolar` in `data/ships.ts`),
and on its strength (best at a fresh breeze, 8 m/s).
- **Square:** can't sail closer than about 62° to the wind. Best with the wind
  on the quarter or astern.
- **Lateen:** points up to about 42°. Best on a beam reach; runs poorly.
- **Mixed** (the carrack): about 52°, and good on every point once she bears
  off.
- **Oars:** drive her at any angle, even in a calm. The oarsmen row when you
  make sail, and the faster of oars and sail wins.

Measured, in knots at a fresh breeze, by angle off the wind:

| Ship | 50° | 70° | 90° | 120° | 150° | 180° |
|---|---|---|---|---|---|---|
| Cog (square) | 0 | 0.7 | 2.3 | 3.4 | 3.8 | 3.7 |
| Caravel (lateen) | 2.0 | 5.1 | 6.0 | 6.2 | 5.6 | 4.8 |
| Carrack (mixed) | 0 | 3.3 | 5.1 | 6.6 | 6.9 | 6.6 |
| Galley (oars too) | 6.4 | 7.5 | 8.8 | 9.1 | 8.2 | 7.0 |

In a calm the galley still rows at 6.4 knots; the cog barely drifts (0.3).

**Her sails:** each is braced round to the wind. A square yard is squared
when she runs, and braced round (lee yardarm aft) as she comes up to the
wind. A lateen swings out to leeward. Square sails reef up to the yard as you
shorten sail; a lateen is furled along its yard. She heels a little to the
wind.

**The wind gauge** shows at the helm or anywhere aboard:
- where the wind comes from round her bow, and the arc she can't point into
- the wind's name and strength, and her point of sailing (in irons,
  close-hauled, beam reach, broad reach, running)
- how much sail is set and how well it's drawing, and her speed in knots

**Leaving the helm:** **X** leaves the helm with the rudder lashed. She keeps
her way and her sails as set, holding her course until she runs aground
(then her sails are left flogging). Her state (`sail`, `speed`) is saved
with her.

**Walking aboard:** her deck is a moving floor. Whoever stands aboard is
carried with her as she moves and turns, so you can walk the deck, climb to
the castles and go down into the hold under way. Aim at her and **Take the
helm** to steer again. **X** aboard goes ashore if there's land in reach,
else over the side.

**Still to come (the hooks are in):**
- **Crews:** hire sailors in port towns (villagers with a `sailor` role) to
  row and work the sails.
  - `ShipBuild.crew` holds the hands aboard. It's unset for now, which means
    a full crew.
  - `shipHands(design, crew)` turns that into the share of the sails and oars
    that are worked. Sail power and rowing speed already scale by it.
  - A short-handed ship will set less sail and row slower. A big ship with
    one man aboard will barely move.
  - The shipyard already shows the crew each design needs.
- **Trade by sea:** the traders' system extended to ships between port towns.
  A ship carries tonnes where a cart carries a few hundred kg.
- **The dry dock:** for repairing big hulls without careening.

**5. Ship types (done)**

The shipyard starts from nine medieval types. Each one is a set of choices you
can change.

| Type | Length | Build | Rig | Character |
|---|---|---|---|---|
| Longship | 26 m | narrow, clinker, open | one square sail, oars | fast and shallow (beachable) |
| Knarr | 18 m | medium, clinker, open | one square sail | the Norse trader |
| Balinger | 18 m | medium, clinker, decked, sterncastle | square sail, oars | a quick coaster |
| Cog | 22 m | broad, clinker, decked, fore and aft castles | square sail | the Hanseatic carrier |
| Galley | 30 m | narrow, carvel, decked, sterncastle | two lateens, oars | fastest and handiest, little cargo |
| Hulk | 26 m | broad, carvel, decked, sterncastle | square sail | the most cargo for her length |
| Nef | 26 m | medium, carvel, decked, fore and aft castles | two lateens | the crusaders' round ship |
| Caravel | 22 m | medium, carvel, decked, sterncastle | two lateens | quick and handy |
| Carrack | 34 m | broad, carvel, decked, great castles | three masts, mixed rig | the great ship |

New choices that came with them:
- **Oars:** a bench of four oars to a bay. She's rowed as well as sailed and is
  handier, at the cost of cargo room.
- **Three masts:** fore, main and mizzen.
- **Mixed rig:** square sails forward and a lateen on the mizzen.
- **Great castles:** a two-storey sterncastle and a high forecastle.
- **Lengths up to 34 m:** on the new **great slipway** (36 m on stone
  footings; its far end must reach water 2.2 m deep).
- **Crew figure:** the shipyard shows the crew each design will need, ready
  for crews.

Some combinations aren't allowed:
- two masts need 22 m or more, and three need 26 m
- great castles need a deck and 26 m

Oars are fitted with a saw, 3 refined planks and 4 oars a bay. Great castles
take 18 refined planks, 6 shafts and an iron fitting each.

Measured in a test:
- **Carrack:** 34 m, 135 t of cargo, about 6.9 knots, slow to turn (47° in
  6 s), 35 steps to build.
- **Galley:** 30 m, 21 t, about 9.4 knots, handy (102° in 6 s), a crew of 38
  (28 at the oars), 36 steps.

**6. Harbours (done)**

The waterside pieces (Build menu, Waterside) are set by the water: each has a
`waterside: { top }` field saying how high its top stands above the surface.
Its footings run down to the bed, and it can't go where the bed is deeper than
they reach.

| Piece | Top above water | Reaches down | Notes |
|---|---|---|---|
| Stone quay | 1.0 m | 4 m | 2×2 m block; floors and walls snap onto it |
| Quay steps | 1.0 m | 4 m | steps down to the water on the side it faces |
| Rubble breakwater | 0.6 m | 4 m | rock only, no mortar |
| Timber jetty | 0.8 m | 6.2 m | deck on four piles |
| Jetty end with ladder | 0.8 m | 6.2 m | climb out of the water |

What came with them:
- **Mooring posts and stone bollards** (`mooring`). Leave a ship's helm within
  her length of one, with little way on, and she's made fast: her sails come
  in and she stays put.
- **A harbour beacon** to light at night, a **treadwheel crane** and **net
  racks**.
- **Boats and ships bump against built pieces**, at the bow and either side of
  it, instead of sailing through quays and piles.
- **Ladders** (`climb`, a box you climb in): W climbs and S climbs down, from
  the water too, and you step off at the top. There's a stand-alone ladder for
  houses too.

Measured in a test: quays could be placed from the waterline out to 3.8 m
deep. A knarr sailed at a quay stopped against it with 3% hull wear, and
leaving her helm by a bollard moored her. Climbing the jetty ladder took you
from the water onto the deck and back along the jetty to the quay.

## Streamlining (how new things should be added)

- **Data first.** A new vessel is a row in `VESSELS`, a model in `view.ts`
  (`vesselModel`), and usually a build piece with `becomes`. No new code paths.
- **One world object per kind of thing** (vessels are `CartObj`; the `type`
  says which). They save, load and stream like the rest.
- **Capabilities, not cases.** Code asks "can it be pushed? paddled? is it
  afloat?", never "is it the dugout?". A new boat with `move.paddle` is
  paddleable for free.
- **Ships will be built from parts**, so variety comes from combining a fixed
  set of pieces (like houses), not from one hand-made model per ship.
