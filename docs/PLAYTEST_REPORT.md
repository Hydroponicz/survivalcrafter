# Playtest report: full systems sweep, bug hunt and optimisation

Survivalcrafter, `preview` branch. Automated playtests in a headless browser
(software rendering, so **CPU numbers are meaningful, GPU numbers are not**),
seeds 777 and 9001. Every system was driven through the game's own actions, the
same way a player triggers them.

## 1. What was tested

| Area | Result |
|---|---|
| New game boot, tutorial quest | Pass: quest active, starting kit, morning start |
| Foraging (instant pickup) | Pass: picked at once, no progress bar |
| Crafting (stone knife, torch, cordage, hatchet) | Pass (cordage only failed once, right after the test teleported the player into a bush: a test artefact) |
| Felling a tree | Pass: 16–18 s with a stone hatchet; 3 logs and branches on a pile; stump left |
| Stumps (solid, dug out) | Pass: 23 s with a wooden shovel |
| Building (plan, materials, build) | Pass |
| Fire (fuel, light) | Pass |
| Combat (boar charge, kill, butcher) | Pass: 1–2 damage taken, 5 meat and a hide |
| Horse (feed apples, tame, ride) | Pass: tamed after 2–3 apples, rides |
| Ox (tame) | Pass: 3–4 tries at the base 20% |
| Village, town, castle city (all pieces placed, people, stores, trade, talk) | Pass: 422 / 1,451 / 3,109 pieces, 18 / 21 / 31 people, nobody stuck |
| Economy (buy, sell, work orders, treasury) | Pass |
| Traders on the roads | Pass: 16 traders moving between 10 settlements, 24–36 goods aboard |
| Save, reload | Pass: purse, ledgers, traders, inventory, tamed animals |
| Three-day soak in a town | Pass after fixes: no errors, steady memory, 0 missed meals |
| Long journey through 6 settlements | Pass: objects stream in and out, scene stays bounded, 0–1 tiles made on the spot |

## 2. Bugs found and fixed

1. **Traders stalled the game.** To pick a destination, a trader looked up the
   neighbours of settlements kilometres away, which made those parts of the map
   be worked out on the spot: **7.4 ms a frame on average and hitches of 2.5–3.5
   s.** Now they only travel between settlements whose map is already made (the
   rest are requested in the background) and wait when far from you.
2. **Villagers "rescued" you.** A villager walking into you set off the
   stuck-in-the-ground watchdog, which moved you ("You scramble free.").
   People no longer count as ground.
3. **Towns starved by day 3** (15 missed meals). The morning merchants bought
   one meal a head; everyone eats two. Now two, and towns and cities collect
   market dues to pay for it. Result over three days: 0 missed meals.
4. **Far-off flocks and fields kept costing.** Every penned sheep and every crop
   you'd ever seen was drawn and had its ground height looked up, which made
   ground kilometres away be generated. Now only those within about 230 m.
5. **New wild animals caused 30–60 ms spikes** (their zone was read from the
   voxel ground 70–220 m away). Read from the world map instead; wild animals
   more than 150 m off now wait instead of wandering.
6. **Villagers' crafting flooded the debug log**, burying real problems.

## 3. Performance

CPU time per frame while walking (rendering excluded):

| Where | Before avg | After avg | After 95th % | Worst frame before → after | Draw calls (after) |
|---|---|---|---|---|---|
| Wilderness | 10.4 ms | **2.6 ms** | 10.2 ms | 2,516 → 39 ms | 375 |
| Village (18 people) | 9.3 ms | **2.9 ms** | 9.8 ms | 3,549 → 20 ms | 699 |
| Town (21 people) | 3.7 ms | **3.0 ms** | 9.8 ms | 90 → 19 ms | 787 (was 1,570) |
| Castle city (31 people) | 4.3 ms | **4.2 ms** | ~15 ms | 128 → 35–60 ms | 1,092 |

What changed beyond the bugs: furniture, stalls, storehouses and workbenches
are now merged into the building batches (town draw calls halved); grass
generation tests each plant only against building pieces in its own 2 m square
(town grass spikes 31 ms → ~10); the sea-floor map is redrawn over 16 frames
(61 ms spikes gone); a city's people are dressed two a frame (44 ms spike gone).

**What's left** (in order of impact):
- **Distant land tiles** are built on the main thread (20–45 ms, once per 1 km
  tile as you travel). Moving that mesh build into the tile worker would remove
  the largest remaining spike.
- **Grass patches** in a dense town cost 8–12 ms each to generate (52,000 ground
  lookups across 12 patches). Halving the patch size, or caching ground height
  per patch, would bring it under the 3 ms budget.
- **Castle cities draw about 1,100 calls.** Merging batches over 64 m instead of
  32 m, and simple stand-in models for buildings beyond 150 m, would roughly
  halve that.
- **31 animated villagers cost 1.3–1.7 ms.** Animating those beyond 40 m at a
  lower rate (now beyond 60 m) is a cheap further win.
- Load: about 10 map tiles (5–6 s) are built before a new world starts; this was
  there before these features.

### Follow-up: a 14-minute flight (player debug log, seed 135298584)

The log showed a 1.1 s stall in the trader update, then frames of 6–38 s while
flying, getting worse. Replaying the flight on the same seed (8 minutes of fast
flight, about 2.5 km) and reading the code turned up:
- **Traders planning settlements' neighbours on the spot** (the 1.1 s stall): a
  destination is only used once the map is ready for its whole neighbourhood.
- **Meshes freed from the scene but not from the graphics card**: every door a
  villager opened or shut, every fire lit, every trader's cart that came and
  went, every region unloaded left its geometry in GPU memory, so the longer you
  travelled, the fuller it got. Everything is now freed; GPU geometry holds steady
  (322–357 over 10 minutes of town life with frequent rendering).
- In the replay itself, CPU frames stayed smooth (median 17 ms, worst 48–135 ms),
  memory steady (390–585 MB, no climb), every cache bounded, and the save stayed
  small (65 KB, 13 ms).
- The debug log now ignores gaps while the tab is in the background, and records
  GPU geometry, texture and draw-call counts with each slow frame.

## 4. What the data says about play

- **Towns can't feed themselves.** By design they have no fields; three days in, a
  town's treasury fell from 900 to 443 coins buying grain, before market dues
  were added. Food is the economy's real engine: whoever moves grain from the
  villages to the towns (traders, or you) holds the economy up.
- **Traders start nearly empty.** Settlements begin with little to spare, so for
  the first in-game day traders mostly carry a few bags of seed. Surplus builds
  as fields ripen (a crop takes about half a day).
- **Iron is the scarcest thing.** Nobody mines; smiths are idle once the day's 2–3
  imported lumps are used. A clear opening for the player (and for a miner job).
- **Work orders are the player's best income**, paying 4–67 coins an item for what
  a village lacks (iron tools pay best, then bread, furniture, hides and planks). A
  hot meal at the tavern costs about 20.
- **Nothing reacts to the player taking things.** You can loot village house
  chests, kill penned sheep, take furniture: no one notices.
- **Upper floors and towers can't be reached**: no stairs or ladders exist.
- **Busy places look the same**: every villager is the player's body recoloured,
  and many poses are stand-ins (lying flat on the idle pose to sleep, standing
  to eat lunch on a bench).

## 5. Design ideas

**Living economy**
- **Granaries and famine.** Show each settlement's food in days (on the map and at
  the storehouse). Let a town run short when roads are cut or harvests fail, with
  prices spiking and work orders for food paying double: a reason to haul grain.
- **Miners and charcoal burners.** Iron mines in the hills near castle cities, a
  charcoal burner in the woods; the smith's output then depends on real supply.
- **Trader encounters.** Stop a trader on the road to buy from or sell to their
  cart; hire on as an escort for a cut of the profit; later, bandits on the roads.
- **Seasons.** Spring sowing, autumn harvest, a winter where food stored matters.

**Belonging somewhere**
- **Reputation per settlement**, earned through work orders and trade, spent on
  discounts, a bed at the tavern, a plot to build on, an audience with the lord.
- **Take over a job properly.** Apprentice to the smith or carpenter; when a
  villager retires or dies, take their house, tools and place in the economy.
- **Buy or rent a house** in a village or town; a market stall of your own.

**Law and order**
- **Ownership.** House chests and penned animals belong to someone; guards or
  villagers react to theft and killing (warnings, fines, being barred from the
  town). The castle's guards finally have a job.
- **The lord's quests.** Clear wolves off a road, deliver tribute, escort a cart to
  another town: the castle becomes a quest hub.

**Onboarding**
- **"Find a village" quest** when the tutorial ends, pointing down the nearest
  road; signposts at road junctions with distances.
- **Teach work orders** the first time you open a storehouse.

**Building**
- **Stairs and ladders** (needed by the towns, and by players building their own
  two-storey houses), **half-timbered walls**, **slate roofs**, **cobbles** as a
  placeable path.

## 6. Assets

The complete list of models (with every animation each rigged model needs),
textures and sounds is in [`ASSETS_NEEDED.md`](../ASSETS_NEEDED.md), ranked by
how much each would improve what players see and hear most.
