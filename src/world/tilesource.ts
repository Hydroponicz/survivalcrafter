import type { TileData, TileSource } from './worldgen';

/** A small pool of workers making map tiles, nearest-asked first. */
export class WorkerTiles implements TileSource {
  private workers: { w: Worker; busy: boolean }[] = [];
  private queue: { tx: number; tz: number }[] = [];
  /** Where you are, so the queue serves the nearest tiles first. */
  focus = { x: 0, z: 0 };

  constructor(private seed: number, private onTile: (d: TileData, lod: Float32Array) => void, tileSize: number) {
    this.tileSize = tileSize;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./tileworker.ts', import.meta.url), { type: 'module' });
      const slot = { w, busy: false };
      w.onmessage = (e: MessageEvent<{ d: TileData; lod: Float32Array }>) => {
        slot.busy = false;
        this.onTile(e.data.d, e.data.lod);
        this.pump();
      };
      this.workers.push(slot);
    }
  }
  private tileSize: number;

  request(tx: number, tz: number) {
    this.queue.push({ tx, tz });
    this.pump();
  }

  private pump() {
    for (const slot of this.workers) {
      if (slot.busy || !this.queue.length) continue;
      // Nearest first.
      let best = 0, bd = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const q = this.queue[i];
        const d = Math.hypot((q.tx + 0.5) * this.tileSize - this.focus.x, (q.tz + 0.5) * this.tileSize - this.focus.z);
        if (d < bd) { bd = d; best = i; }
      }
      const q = this.queue.splice(best, 1)[0];
      slot.busy = true;
      slot.w.postMessage({ seed: this.seed, tx: q.tx, tz: q.tz });
    }
  }

  dispose() { for (const s of this.workers) s.w.terminate(); }
}
