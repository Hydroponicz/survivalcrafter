# Textures

- `waternormals.jpg`: tileable water normal map from the three.js examples
  (https://github.com/mrdoob/three.js/tree/dev/examples/textures), MIT licence.
- `terrain/*.jpg`: ground textures from Poly Haven (https://polyhaven.com), all CC0: "Leafy Grass" (grass),
  "Dirt" (dirt), "Dense Sand" (sand), "Gravel" (gravel), "Rocks Ground 01" (rock) and "Snow 02" (snow).
  Web copies at 1K; the 2K originals are in `assets-src/textures/<name>/`.

## Adding a ground texture

Download the 2K set from a CC0 site (Diffuse JPG, Normal (GL), AO/Rough/Metal JPG), put the originals in
`assets-src/textures/<name>/`, and save 1K web copies here as `terrain/<name>_color.jpg`,
`<name>_normal.jpg` and `<name>_orm.jpg`. Then add the name to `GROUNDS` in `src/world/groundtex.ts` and
map materials to it in `GROUND_OF` in `src/world/terrain.ts`.
