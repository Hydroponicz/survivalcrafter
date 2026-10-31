import { BaseLand, buildTile, LOD_N, tileLodColors } from './worldgen';

// Makes map tiles off the main thread, so walking into new land never stalls
// the game: the tile's simulation, plus the colours and ground texture
// weights for its distant land.

let seed = NaN;
let base: BaseLand | null = null;

self.onmessage = (e: MessageEvent<{ seed: number; tx: number; tz: number }>) => {
  const { tx, tz } = e.data;
  if (e.data.seed !== seed || !base) { seed = e.data.seed; base = new BaseLand(seed); }
  const d = buildTile(seed, tx, tz, base);
  // Distant land colours, then its ground texture weights, in one array.
  const layers = new Float32Array(LOD_N * LOD_N * 4);
  const cols = tileLodColors(d, layers);
  const lod = new Float32Array(cols.length + layers.length);
  lod.set(cols);
  lod.set(layers, cols.length);
  const buffers = [d.H, d.dep, d.flow, d.kind, d.S, d.climBase, d.moist, d.reaches, lod].map((a) => a.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage({ d, lod }, buffers);
};
