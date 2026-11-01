import { BaseLand, buildTile, LOD_N, tileLodColors } from './worldgen';
import { planStandIns } from './farforest';
import { TreeCover } from './trees';

// Makes map tiles off the main thread, so walking into new land never stalls
// the game: the tile's simulation, plus the colours and ground texture
// weights for its distant land.

let seed = NaN;
let base: BaseLand | null = null;
let cover: TreeCover | null = null;

self.onmessage = (e: MessageEvent<{ seed: number; tx: number; tz: number }>) => {
  const { tx, tz } = e.data;
  if (e.data.seed !== seed || !base) { seed = e.data.seed; base = new BaseLand(seed); cover = new TreeCover(seed); }
  const d = buildTile(seed, tx, tz, base);
  // Distant land colours, then its ground texture weights, in one array.
  const layers = new Float32Array(LOD_N * LOD_N * 4);
  const cols = tileLodColors(d, layers);
  const lod = new Float32Array(cols.length + layers.length);
  lod.set(cols);
  lod.set(layers, cols.length);
  // Where its distant forests stand, too.
  const forest = planStandIns(seed, cover!, d);
  const buffers = [d.H, d.dep, d.flow, d.kind, d.S, d.climBase, d.moist, d.reaches, lod, ...forest.flatMap((f) => [f.mats, f.cols])].map((a) => a.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage({ d, lod, forest }, buffers);
};
