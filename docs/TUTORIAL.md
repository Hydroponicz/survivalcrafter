# Teaching the game: lessons

The tutorial teaches each idea **at the moment it matters**, in a lesson: the
game stops and shows a picture of the idea, then explains how it works and why
it's useful. Then the player goes and does it, guided by the quest steps.

## How it works

A quest step (`src/game/quests.ts`) can carry a `lesson`:

```ts
lesson: {
  title: 'Time to make camp',
  image: 'images/tutorial/camp.jpg',    // under public/
  text: `<p>...</p>`,                    // HTML; <b> for the key words
  button: 'Let\'s make camp',
}
```

When the step completes, the lesson is queued. It's shown as soon as the player
is free to read it: not mid-action, not in a minigame, no window open. It shows
once per save (remembered in `tips` as `lesson:<quest>:<step>`). It uses
`ui.showNotice(..., { image, kind: 'lesson' })`, which anything else can call
too.

## Writing one

- **One idea per lesson**, tied to what the player just did. "Your first tree is
  down, so make camp" teaches the camp, and through it stations and benefits.
- **A picture of the real thing**, staged in the game with pieces the player can
  actually make at that point. Nothing they can't craft.
- **What, how, why:** what to build, how it opens things up (new recipes at a
  station, a benefit such as light, warmth, a bed or rest), and where to look
  next. Name keys with `KEY('B')`.
- **Then a step that does it.** The camp lesson is followed by "Set up a
  chopping block" and "Build a campfire".

## Lessons so far

| After | Lesson | Picture |
|---|---|---|
| Fell a tree | Time to make camp: stations open recipes, pieces bring benefits | `images/tutorial/camp.jpg`: campfire, chopping block, lean-to, hide tent, woodpile, drying rack, torches |

## Making a picture

The camp picture was rendered in the game. A headless browser placed the pieces
on a flat meadow at the edge of the woods in late-afternoon light, with the
player by the fire and the interface hidden. It was rendered at 1600 × 900 and
saved at 1280 × 720 (JPEG, about 240 KB). Do the same for new lessons, so the
pictures match what the player will see.
