# Textures

- `waternormals.jpg`: tileable water normal map from the three.js examples
  (https://github.com/mrdoob/three.js/tree/dev/examples/textures), MIT licence.
- `terrain/grass_*.jpg`: "Leafy Grass" from Poly Haven (https://polyhaven.com), CC0. Colour at 2K,
  normal (OpenGL) and AO/roughness/metal at 1K, re-encoded from the originals in
  `assets-src/textures/grass/`.

## Adding a ground texture

Download the 2K set from a CC0 site (Diffuse JPG, Normal (GL), AO/Rough/Metal JPG), put the originals in
`assets-src/textures/<name>/`, and save web copies here as `terrain/<name>_color.jpg`,
`<name>_normal.jpg` and `<name>_orm.jpg`.
