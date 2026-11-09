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
| `move` | how it moves: `push` (by hand, at that walking speed), `hitch` (to an ox), `paddle` (speed, turn) |
| `draft` | how deep it sits: it can't go where the water is shallower |
| `seats` | where people sit (the first is the steerer) |
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

**2. More small craft** (rows in the table, a model each, a build piece):
- **Log raft:** logs and cordage, poled in shallow water, carries a lot, slow.
- **Coracle:** a hide over a wicker frame, light enough to carry on your back
  (an `item`), one person, spins easily.
- **Bark or hide canoe:** fast and light, fragile.
- **Rowing boat:** planks on frames, a carpenter's job: oars (a new `move`:
  `row`), two to four seats.

**3. The shipyard and its slipway**
- **The slip:** a structure on a riverbank or shore that defines a building
  berth: a cradle of blocks on a slope into the water. Its length and width
  set the largest ship it can hold.
- **The hull:** a ship is laid down on the slip and built from **modular
  pieces** that snap to the berth's grid, much like house pieces snap to each
  other:
  - **Keel** (sets the length), **stem** and **sternpost**
  - **Frames** (ribs) and **strakes** (planking: clinker for northern
    ships, carvel later)
  - **Decks**, **castles** (fore and aft), **hold** sections
  - **Mast steps** and **masts**, **yards** and **sails**, a **rudder** (a
    steering oar early, a sternpost rudder later), and **oar ports**
- **What the ship can do comes from its parts:**
  - length, beam and depth give capacity and draft
  - sail area against displacement gives speed
  - rudder and hull shape give turning
  - oar ports and benches set crew needs
  - quality comes from the parts' quality

  So a ship is a vessel whose row is **worked out** from its parts, not
  written by hand. A `ship` vessel holds its part list, and the table entry is
  computed.
- **Launching:** knock out the wedges and it slides down the slip into the
  water (a moment worth an animation and a sound).
- **Repairs:** careen it on a beach (hull damage and wear), or, late and
  expensive, build a **dry dock** next to the slip.

**4. Sailing and crews**
- **Wind:** one prevailing wind direction and strength already drives the
  climate. Under sail, speed depends on the angle to the wind (a polar curve
  per rig: square sails run before the wind, lateen and fore-and-aft rigs
  point higher).
- **Walking aboard:** the deck is a moving platform. You walk on it while it
  sails (the player's frame follows the hull), climb to the castles, and go
  down into the hold. This also gives ladders and stairs, which the towns need.
- **Crews:** hire sailors in port towns (villagers with a `sailor` role) to
  row and work the sails. Big ships need a crew to move at all.
- **Trade by sea:** the traders' system extended to ships between port towns.
  A ship carries tonnes where a cart carries a few hundred kg.

**5. Ship types to aim for** (each one a set of parts):
- **Viking-style longship:** clinker, oars and a square sail, shallow draft,
  beachable
- **Cog:** the Hanseatic trader, a high-sided clinker hull, one square sail,
  castles fore and aft
- **Hulk:** a round, roomy cargo ship
- **Galley:** oars and lateen sails, Mediterranean
- **Carrack:** the late medieval ship, three or four masts, carvel planking,
  big castles. The top of the tree, needing the dry dock era's skills.

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
