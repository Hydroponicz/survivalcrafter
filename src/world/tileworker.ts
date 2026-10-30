import { BaseLand, buildTile, tileLodColors } from './worldgen';

// Makes map tiles off the main thread, so walking into new land never stalls
// the game: the tile's simulation, plus the colours for its distant land.

let seed = NaN;
let base: BaseLand | null = null;

self.onmessage = (e: MessageEvent<{ seed: number; tx: number; tz: number }>) => {
  const { tx, tz } = e.data;
  if (e.data.seed !== seed || !base) { seed = e.data.seed; base = new BaseLand(seed); }
  const d = buildTile(seed, tx, tz, base);
  const lod = tileLodColors(d);
  const buffers = [d.H, d.dep, d.flow, d.kind, d.S, d.climBase, d.moist, d.reaches, lod].map((a) => a.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage({ d, lod }, buffers);
};
