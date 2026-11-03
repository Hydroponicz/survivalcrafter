// The survival guide: shown in game (H) and in the main menu's wiki.

export const GUIDE_HTML = `
      <h3>Controls</h3>
      <table class="keys">
        <tr><td>WASD / Shift / Space</td><td>Move / sprint / jump</td></tr>
        <tr><td>Z</td><td>Crouch (toggle)</td></tr>
        <tr><td>Mouse</td><td>Look (click the game to capture the mouse)</td></tr>
        <tr><td>V</td><td>Toggle first / third person · mouse wheel zooms in third person</td></tr>
        <tr><td>Left click / E</td><td>Do the default action on what you're looking at</td></tr>
        <tr><td>Right click / F</td><td>Open the action menu (pick with mouse or 1-9)</td></tr>
        <tr><td>1-9 · 0</td><td>Activate hotbar item · bare hands</td></tr>
        <tr><td>R</td><td>Repeat last action · X: stop current action</td></tr>
        <tr><td>I / Tab · C · B · K</td><td>Inventory · Crafting · Build · Skills</td></tr>
        <tr><td>Hold Left Alt</td><td>Show the cursor: hover anything for a tooltip, or drag windows and the tutorial panel where you like</td></tr>
        <tr><td>H · Esc</td><td>This guide · release mouse / close windows</td></tr>
        <tr><td>G · J · M</td><td>Survey the area for things to pick · Field journal · Sound on/off</td></tr>
        <tr><td>Mouse in windows</td><td>While a window or the action menu is open, the mouse moves an in-game cursor (the camera holds still). Esc releases the real mouse.</td></tr>
        <tr><td>&#96; or F2</td><td>Dev console (cheats: instant crafting, no needs, fly…)</td></tr>
      </table>
      <h3>How this world works</h3>
      <p>Like Wurm Online, everything you do is a <b>timed action</b> that uses a <b>skill</b>. Skills start at 1 and rise slowly with practice. Higher skill means faster work, fewer failures and better <b>quality (QL)</b>. Every item has its own QL; good tools and good materials make good products.</p>
      <p><b>Crafting and building are hands-on.</b> The view moves to the workstation and you do the job with the mouse: draw the saw along the line, strike the anvil as the ring closes, pump the bellows to hold the heat, turn the quern at a steady pace, lift the bread off the fire at the right moment. How well you do sets most of the quality; your skill makes the work more forgiving and caps the quality. Right-click stops. Once your skill is 10 above a task's difficulty you can <b>Quick</b> craft or build it, skipping the minigame at a quality cost.</p>
      <p>The <b>active item</b> decides what you can do. A shovel digs, raises, smooths and levels earth; a pickaxe mines rock and tunnels; a hatchet fells trees. Bare hands forage, pick berries and gather stones.</p>
      <p>The land is made of <b>voxels</b>: you can reshape it in any direction. The ring on the ground shows the area your tool will work. <b>Level ground</b> flattens the outer ring to the height of your feet, digging out the high parts and filling hollows with dirt from your pack. Below the soil is rock you need a pickaxe for — dig tunnels and find caves. The rock is layered: grey granite, tan <b>sandstone</b> and dark <b>shale</b> beds that tilt gently across the island, and you can follow a band along a cliff. Iron comes as rusty <b>ironstone</b> seams near the base of some shale beds: find an outcrop and follow the seam. Gravel collects in fast rivers and as scree below cliffs. Every 0.5 m³ you dig out becomes an item.</p>
      <p><b>Building</b> works like Valheim for planning: pick a piece (B) and place its ghost, snapping walls to floors, roofs to walls and so on. Then the work is Wurm-like: use <b>Continue building</b> on each plan, adding one material per step with the right tool and skill.</p>
      <h3>Getting started</h3>
      <ol>
        <li><b>Forage</b>: pick up what grows on the ground — fiber grass and wild wheat in <b>meadows</b>, branches and mushrooms on the <b>forest floor</b>, pebbles and driftwood on <b>shores</b>, reeds and mint in <b>wetlands</b>. Picked spots regrow over time elsewhere. Hold still and press <b>G</b> to <b>survey</b>: nearby finds glow, including rarer ones you'd otherwise miss (gold). Higher Foraging lets you spot rare herbs and mushrooms on your own.</li>
        <li><b>Learn what you pick.</b> Wild mushrooms and herbs start out <b>unidentified</b> — you only know what they look like. You may recognise them as you pick them (Herbalism), <b>Study</b> them from your inventory, or learn them after handling a few. Some are <b>poisonous</b>: eating an unknown one is a gamble. A <b>yarrow poultice</b> draws out poison. Your <b>field journal</b> (J) records everything you've found.</li>
        <li><b>Gather loose stones</b> on bare grey rock (cliffs and hills).</li>
        <li>Craft <b>cordage</b> from fiber, then a <b>stone hatchet</b>, <b>stone pickaxe</b> and <b>stone hammer</b>.</li>
        <li>Fell trees for <b>logs</b> (heavy — they drop on the ground). Split them into <b>planks</b>; carve branches into <b>shafts</b>; make a <b>wooden shovel</b>.</li>
        <li>Plan a <b>campfire</b> (B), build it, add fuel, and light it with <b>kindling</b>. Cook mushrooms and meat; fire clay jars.</li>
        <li>Set up a <b>smithy</b>. Dig <b>clay</b> by the water and build a <b>forge</b> (B). Then craft its equipment (Crafting → Smithy) and <b>Place</b> it from your pack: <b>bellows</b> against the forge's side (without them it can't get hot enough for metal), a <b>stone anvil</b> nearby, and a <b>quench trough</b> filled with jars of water. You also need a fired <b>crucible</b> to smelt ore in and <b>tongs</b> to handle hot metal. Mine <b>iron ore</b>, smelt it, smith iron tools, and quench them while they're still glowing to harden them. Later, cast an <b>iron anvil</b>. Better equipment makes the work easier and raises the best quality you can reach. Equipment can be picked up and moved.</li>
        <li><b>Cultivate</b> fields with a shovel, <b>sow</b> wheat seeds, tend them, harvest, grind flour at a <b>quern</b>, and bake <b>bread</b>.</li>
        <li>Hunt deer and boar (careful — boars fight back), <b>butcher</b> them with a knife for meat and hides, and build a <b>bed</b> to set your home.</li>
      </ol>
      <p>Watch your <b>food</b> and <b>water</b>: drink from lakes (aim at water), and eat cooked food — higher QL food is more nourishing. Your game saves automatically.</p>`;
