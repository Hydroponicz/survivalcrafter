# Sounds

Drop recordings in this folder and list them in `sounds.json`. The game picks them
up on the next load. Anything left empty is silent (ambience) or uses the built-in
synthesized version (effects).

## Ambient loops

These play continuously and fade in and out with where you are. Use seamless
loops of about 30–90 s.

| Name    | What it should be                                  | When it plays                                   |
|---------|----------------------------------------------------|-------------------------------------------------|
| `wind`  | Wind through open country, no birds                | Always, louder up high and on open ground       |
| `river` | A small stream or brook babbling over stones       | Near running rivers (not still lakes)           |
| `birds` | Woodland birdsong in daytime, no wind or traffic   | By day, busiest in woods and at dawn            |
| `night` | Crickets / night insects                           | At night in warm, grassy places                 |
| `frogs` | Frogs in a pond or marsh                           | At night in marshes and by water                |

## Effects (optional)

`chop` (axe biting wood), `glance` (a dull knock), `clink` (pick on stone),
`creak` (a tree starting to fall), `crash` (a tree hitting the ground). List
several files to vary them, e.g. `"chop": ["chop1.ogg", "chop2.ogg"]`.

## Where to find good royalty-free recordings

- **Freesound** (freesound.org): filter by license **Creative Commons 0** (no
  attribution needed). Search e.g. "stream loop", "forest birds ambience",
  "crickets night loop", "frogs pond", "wind field loop", "axe chop wood".
- **Pixabay Sound Effects** (pixabay.com/sound-effects): free for commercial use,
  no attribution required.
- **Sonniss GDC Game Audio Bundles** (sonniss.com/gameaudiogdc): large free,
  royalty-free packs of professional field recordings.

Check each file's license before adding it, and if a license asks for credit,
add it to the credits list below.

## Tips

- `.ogg` or `.mp3`, mono, 96–128 kbps keeps files small for the web build.
- Trim loops so the end runs smoothly into the start (most sites have "loop"
  versions, or fade the ends in an editor like Audacity).
- Recordings differ in loudness: if one is too loud, lower it in the editor, or
  tweak `AMBIENCE_VOLUME` in `src/game/sound.ts`.

## Credits

(none yet)
