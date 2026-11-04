import { SEA, type WorldGen } from '../world/worldgen';
import type { Zone } from '../world/climate';

// The world map: the land you've seen, drawn in ink on an old parchment
// scroll. The world is cut into 32 m cells; those within sight of where
// you've been are "explored", and each is drawn once (a few a frame) from the
// world's own map data: hill shading and contours in sepia, water in a muted
// wash with an inked shore and a ripple line offshore, little trees for the
// woods, peaks for the high ground, tufts for marsh, stipple for sand and
// heath. Drawn cells live in 512 m chunk images, so showing the map is just a
// few images scaled into place, with the edge of the known world fading
// softly into blank parchment. Only which cells are explored is saved; the
// pictures are redrawn from the world (it's the same every time).

/** Size of an exploration cell (metres), and the chunks of cells kept as one image. */
const CELL = 32;
const CHUNK = 16;
/** Map pixels per metre in the chunk images (2 m a pixel). */
const RES = 0.5;
const CELL_PX = CELL * RES;
const CHUNK_PX = CELL_PX * CHUNK;
/** How far around you counts as seen (metres). */
/** With the map closed, only cells this near you are drawn (m). */
const NEAR = 260;
const REVEAL = 72;

const OFF = 2 ** 20, SPAN = 2 ** 21;
const cellKey = (cx: number, cz: number) => (cz + OFF) * SPAN + (cx + OFF);
const cellX = (k: number) => (k % SPAN) - OFF;
const cellZ = (k: number) => Math.floor(k / SPAN) - OFF;
const chunkKey = (cx: number, cz: number) => cellKey(Math.floor(cx / CHUNK), Math.floor(cz / CHUNK));

/** Parchment, ink, and the washes for each kind of ground. */
const INK: [number, number, number] = [74, 50, 30];
const WATER: [number, number, number] = [146, 168, 158];
const ZONE_TINT: Record<Zone, [number, number, number]> = {
  meadow: [218, 210, 160], broadleaf: [210, 204, 154], conifer: [200, 198, 152], heath: [226, 206, 176],
  marsh: [212, 210, 168], beach: [240, 225, 184], alpine: [222, 212, 188], snow: [244, 238, 226],
};

/** A small deterministic hash (0..1) for placing symbols. */
function hash(x: number, z: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class WorldMap {
  readonly explored = new Set<number>();
  /** Explored cells not drawn yet. */
  private pending = new Set<number>();
  private chunks = new Map<number, HTMLCanvasElement>();
  /** Each drawn cell's ground (per 8 m block) and water (per pixel), to draw its symbols again. */
  private cells = new Map<number, { zones: Zone[]; wet: Uint8Array }>();
  private timer = 0;
  private soft: HTMLCanvasElement | null = null;
  /** Bumped when something new is drawn (the view redraws). */
  version = 0;

  constructor(private gen: WorldGen) {}

  load(keys: number[] | undefined) {
    for (const k of keys ?? []) { this.explored.add(k); this.pending.add(k); }
  }

  /** Pending cells in drawing order (re-sorted every half second), and whether the map was open then. */
  private queue: number[] = [];
  private wasOpen = false;
  private pinnedAny = false;

  serialize(): number[] {
    return [...this.explored];
  }

  /** Mark what's in sight of a point, and draw a few cells (more while the map is open). */
  update(dt: number, x: number, z: number, open: boolean) {
    this.timer -= dt;
    if (this.timer <= 0 || open !== this.wasOpen) {
      this.timer = 0.5;
      const c0x = Math.floor((x - REVEAL) / CELL), c1x = Math.floor((x + REVEAL) / CELL);
      const c0z = Math.floor((z - REVEAL) / CELL), c1z = Math.floor((z + REVEAL) / CELL);
      for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
        const dx = Math.max(cx * CELL - x, 0, x - (cx + 1) * CELL), dz = Math.max(cz * CELL - z, 0, z - (cz + 1) * CELL);
        if (dx * dx + dz * dz > REVEAL * REVEAL) continue;
        const k = cellKey(cx, cz);
        if (!this.explored.has(k)) { this.explored.add(k); this.pending.add(k); }
      }
      // What to draw next, nearest first: sorted now and then, not every frame. With the map
      // closed, only what's round you (cells from an earlier visit wait until you look, or come back).
      this.queue = [...this.pending]
        .map((k) => ({ k, d: Math.hypot((cellX(k) + 0.5) * CELL - x, (cellZ(k) + 0.5) * CELL - z) }))
        .filter((e) => open || e.d < NEAR)
        .sort((a, b) => a.d - b.d)
        .map((e) => e.k);
      this.wasOpen = open;
    }
    this.draw(open ? 8 : 2, open);
  }

  /** Draw queued cells within a time budget (one a frame with the map closed). Far ones (from an earlier visit) ask for their land while the map is open. */
  private draw(budgetMs: number, open: boolean) {
    if (!this.queue.length) { if (this.pinnedAny && !open) { this.gen.unpinAll(); this.pinnedAny = false; } return; }
    const start = performance.now();
    let asked = 0, drawn = 0;
    for (let i = 0; i < this.queue.length; i++) {
      if (performance.now() - start > budgetMs || (!open && drawn >= 1)) break;
      const k = this.queue[i];
      if (!this.pending.has(k)) { this.queue.splice(i--, 1); continue; }
      const cx = cellX(k), cz = cellZ(k);
      const x0 = cx * CELL, z0 = cz * CELL;
      const ready = this.gen.covered(x0, z0) && this.gen.covered(x0 + CELL, z0) && this.gen.covered(x0, z0 + CELL) && this.gen.covered(x0 + CELL, z0 + CELL);
      if (!ready) {
        // Land from an earlier visit: fetch it in the background (a few tiles at a time) while you look.
        if (open && asked < 4) {
          for (const [tx, tz] of this.gen.tilesAround(x0 + CELL / 2, z0 + CELL / 2, CELL)) { this.gen.want(tx, tz); this.gen.pin(tx, tz); }
          this.pinnedAny = true;
          asked++;
        }
        // (With the map closed, a cell whose land isn't here waits for the next sort.)
        if (!open) { this.queue.splice(i--, 1); }
        continue;
      }
      this.drawCell(cx, cz);
      this.pending.delete(k);
      this.queue.splice(i--, 1);
      drawn++;
      this.version++;
    }
    if (this.pinnedAny && (!this.pending.size || !open)) { this.gen.unpinAll(); this.pinnedAny = false; }
  }

  private chunk(cx: number, cz: number): HTMLCanvasElement {
    const k = chunkKey(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = CHUNK_PX;
      this.chunks.set(k, c);
    }
    return c;
  }

  /** One cell, in ink on parchment. */
  private drawCell(cx: number, cz: number) {
    const gen = this.gen, N = CELL_PX, B = 3, M = N + B * 2, step = 1 / RES;
    const x0 = cx * CELL, z0 = cz * CELL;
    // Heights and water over the cell and a little border (for shading, contours and shores).
    const h = new Float32Array(M * M), wet = new Uint8Array(M * M);
    // Heights every other pixel (4 m), filled in between: the map's heights are smooth at that scale.
    const Mc = Math.ceil(M / 2) + 1, hc = new Float32Array(Mc * Mc);
    for (let j = 0; j < Mc; j++) for (let i = 0; i < Mc; i++) hc[j * Mc + i] = gen.mapHeight(x0 + (i * 2 - B + 0.5) * step, z0 + (j * 2 - B + 0.5) * step);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const fi = i / 2, fj = j / 2, i0 = Math.floor(fi), j0 = Math.floor(fj), u = fi - i0, v = fj - j0;
      const a00 = hc[j0 * Mc + i0], a10 = hc[j0 * Mc + Math.min(Mc - 1, i0 + 1)], a01 = hc[Math.min(Mc - 1, j0 + 1) * Mc + i0], a11 = hc[Math.min(Mc - 1, j0 + 1) * Mc + Math.min(Mc - 1, i0 + 1)];
      h[j * M + i] = (a00 * (1 - u) + a10 * u) * (1 - v) + (a01 * (1 - u) + a11 * u) * v;
    }
    // Fresh water: only look pixel by pixel where a river or lake is near the cell at all.
    const mid = gen.river(x0 + CELL / 2, z0 + CELL / 2);
    const riverNear = !!mid && mid.d < mid.r + CELL;
    let lakeNear = false;
    for (let b = 0; b <= 4 && !lakeNear; b++) for (let a = 0; a <= 4; a++) {
      if (!Number.isNaN(gen.lakeSurface(x0 - 8 + a * 12, z0 - 8 + b * 12))) { lakeNear = true; break; }
    }
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const hh = h[j * M + i];
      let w = hh < SEA;
      if (!w && (lakeNear || riverNear)) {
        const x = x0 + (i - B + 0.5) * step, z = z0 + (j - B + 0.5) * step;
        if (lakeNear) w = !Number.isNaN(gen.lakeSurface(x, z));
        if (!w && riverNear) { const ch = gen.channel(x, z, hh); w = !!ch && ch.d < ch.r; }
      }
      wet[j * M + i] = w ? 1 : 0;
    }
    // What grows here, a block at a time (8 m).
    const zones: Zone[] = [];
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
      const x = x0 + (a + 0.5) * 8, z = z0 + (b + 0.5) * 8;
      zones.push(gen.zone(x, z, gen.mapHeight(x, z), gen.mapSlope(x, z)));
    }
    const canvas = this.chunk(cx, cz), ctx = canvas.getContext('2d')!;
    const ox = (((cx % CHUNK) + CHUNK) % CHUNK) * N, oz = (((cz % CHUNK) + CHUNK) % CHUNK) * N;
    const img = ctx.createImageData(N, N), px = img.data;
    const H = (i: number, j: number) => h[(j + B) * M + i + B];
    const W = (i: number, j: number) => wet[(j + B) * M + i + B];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = (j * N + i) * 4;
      let [r, g, bl] = ZONE_TINT[zones[Math.floor(j / 4) * 4 + Math.floor(i / 4)]];
      const hh = H(i, j);
      if (W(i, j)) {
        // Water: a muted wash, deeper further from shore; an inked shoreline, and a ripple line a little way out.
        let near = 9;
        for (let b = -B; b <= B; b++) for (let a = -B; a <= B; a++) if (!W(i + a, j + b)) near = Math.min(near, Math.hypot(a, b));
        [r, g, bl] = WATER;
        if (near <= 1.01) [r, g, bl] = [70, 78, 74];
        else if (near > 2.2 && near < 3.2) [r, g, bl] = [118, 140, 132];
      } else {
        // Hill shading from the north-west, in sepia.
        const gx = H(i + 1, j) - H(i - 1, j), gz = H(i, j + 1) - H(i, j - 1);
        const shade = Math.max(-1, Math.min(1, (gx + gz) * 0.6));
        const k = Math.max(0, shade) * 0.55;
        r += (INK[0] - r) * k; g += (INK[1] - g) * k; bl += (INK[2] - bl) * k;
        if (shade < 0) { r += (255 - r) * -shade * 0.15; g += (250 - g) * -shade * 0.15; bl += (230 - bl) * -shade * 0.15; }
        // Contours every 25 m (heavier every 100 m).
        const band = Math.floor(hh / 25);
        if (band !== Math.floor(H(i + 1, j) / 25) || band !== Math.floor(H(i, j + 1) / 25)) {
          const heavy = Math.floor(hh / 100) !== Math.floor(H(i + 1, j) / 100) || Math.floor(hh / 100) !== Math.floor(H(i, j + 1) / 100);
          const a = heavy ? 0.55 : 0.28;
          r += (INK[0] - r) * a; g += (INK[1] - g) * a; bl += (INK[2] - bl) * a;
        }
        // Stipple for sand and heath.
        const z = zones[Math.floor(j / 4) * 4 + Math.floor(i / 4)];
        if ((z === 'beach' || z === 'heath') && hash(cx * N + i, cz * N + j, 3) < 0.025) { r *= 0.72; g *= 0.7; bl *= 0.64; }
      }
      // The paper's grain.
      const grain = 0.94 + 0.06 * hash(cx * N + i, cz * N + j, 7);
      px[o] = r * grain; px[o + 1] = g * grain; px[o + 2] = bl * grain; px[o + 3] = 255;
    }
    ctx.putImageData(img, ox, oz);
    const cellWet = new Uint8Array(N * N);
    for (let jj = 0; jj < N; jj++) for (let ii = 0; ii < N; ii++) cellWet[jj * N + ii] = W(ii, jj);
    this.cells.set(cellKey(cx, cz), { zones, wet: cellWet });
    // Symbols spill a little over a cell's edge: draw this cell's, and its neighbours' again over the new ground.
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) this.drawSymbols(cx + a, cz + b, cx, cz);
  }

  /**
   * A cell's symbols (little trees in the woods, peaks on the heights, tufts
   * in the marsh, grass in the meadows), clipped to the cell just drawn.
   */
  private drawSymbols(cx: number, cz: number, intoX: number, intoZ: number) {
    const c = this.cells.get(cellKey(cx, cz));
    if (!c) return;
    const N = CELL_PX;
    // Draw into the chunk holding the newly drawn cell, positioned relative to it.
    const canvas = this.chunk(intoX, intoZ), ctx = canvas.getContext('2d')!;
    const ox = (((intoX % CHUNK) + CHUNK) % CHUNK) * N + (cx - intoX) * N, oz = (((intoZ % CHUNK) + CHUNK) % CHUNK) * N + (cz - intoZ) * N;
    ctx.save();
    // Only over the new cell (the others are already right).
    ctx.beginPath();
    ctx.rect((((intoX % CHUNK) + CHUNK) % CHUNK) * N, (((intoZ % CHUNK) + CHUNK) % CHUNK) * N, N, N);
    ctx.clip();
    ctx.translate(ox, oz);
    ctx.strokeStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},0.75)`;
    ctx.fillStyle = `rgba(${INK[0] + 40},${INK[1] + 55},${INK[2] + 15},0.35)`;
    ctx.lineWidth = 0.7;
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
      const zone = c.zones[b * 4 + a];
      for (let s = 0; s < 2; s++) {
        const u = hash(cx * 4 + a, cz * 4 + b, 11 + s), v = hash(cx * 4 + a, cz * 4 + b, 21 + s);
        const i = a * 4 + u * 4, j = b * 4 + v * 4;
        if (c.wet[Math.min(N - 1, Math.floor(j)) * N + Math.min(N - 1, Math.floor(i))]) continue;
        const roll = hash(cx * 4 + a, cz * 4 + b, 31 + s);
        if (zone === 'meadow' && roll < 0.22) {
          // Grass: a couple of short ticks.
          ctx.beginPath(); ctx.moveTo(i - 0.8, j); ctx.lineTo(i - 1.2, j - 1.4); ctx.moveTo(i + 0.4, j); ctx.lineTo(i + 0.7, j - 1.6); ctx.stroke();
        } else if (zone === 'broadleaf' && roll < (s === 0 ? 0.7 : 0.2)) {
          ctx.beginPath(); ctx.arc(i, j - 1.2, 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(i, j + 0.3); ctx.lineTo(i, j + 1.6); ctx.stroke();
        } else if (zone === 'conifer' && roll < (s === 0 ? 0.75 : 0.25)) {
          ctx.beginPath(); ctx.moveTo(i, j - 2.6); ctx.lineTo(i - 1.4, j + 0.8); ctx.lineTo(i + 1.4, j + 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if ((zone === 'alpine' || zone === 'snow') && s === 0 && roll < 0.35) {
          ctx.beginPath(); ctx.moveTo(i - 2.6, j + 1.2); ctx.lineTo(i, j - 2.4); ctx.lineTo(i + 2.6, j + 1.2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(i, j - 2.4); ctx.lineTo(i + 0.9, j + 1.2); ctx.stroke();
        } else if (zone === 'marsh' && roll < 0.5) {
          ctx.beginPath();
          ctx.moveTo(i - 1, j); ctx.lineTo(i - 1.6, j - 1.5); ctx.moveTo(i, j); ctx.lineTo(i, j - 2); ctx.moveTo(i + 1, j); ctx.lineTo(i + 1.6, j - 1.5);
          ctx.moveTo(i - 1.8, j + 0.2); ctx.lineTo(i + 1.8, j + 0.2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /**
   * Draw the known world onto a canvas: centred on (cx, cz) at `scale`
   * pixels a metre, the edge of what's explored fading into the parchment.
   */
  paint(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cz: number, scale: number) {
    ctx.clearRect(0, 0, w, h);
    const left = cx - w / 2 / scale, top = cz - h / 2 / scale;
    const toX = (x: number) => (x - left) * scale, toY = (z: number) => (z - top) * scale;
    // The chunk images in view.
    const span = CHUNK * CELL;
    ctx.imageSmoothingEnabled = scale * (1 / RES) < 2;
    for (let kz = Math.floor(top / span); kz <= Math.floor((top + h / scale) / span); kz++) {
      for (let kx = Math.floor(left / span); kx <= Math.floor((left + w / scale) / span); kx++) {
        const c = this.chunks.get(cellKey(kx, kz));
        if (c) ctx.drawImage(c, toX(kx * span), toY(kz * span), span * scale + 0.5, span * scale + 0.5);
      }
    }
    // Fade out what isn't explored: a mask of explored cells, blurred, kept from the drawing.
    const c0x = Math.floor(left / CELL) - 1, c0z = Math.floor(top / CELL) - 1;
    const nx = Math.ceil(w / scale / CELL) + 3, nz = Math.ceil(h / scale / CELL) + 3;
    if (nx > 2000 || nz > 2000) return;
    // The mask at 4 pixels a cell, softened by hand (a box blur run twice, each way: close to a gaussian).
    const R = 4, mw = nx * R, mh = nz * R;
    let a = new Float32Array(mw * mh);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!this.explored.has(cellKey(c0x + i, c0z + j))) continue;
      for (let b = 0; b < R; b++) a.fill(1, (j * R + b) * mw + i * R, (j * R + b) * mw + i * R + R);
    }
    const blur = (src: Float32Array, horiz: boolean, r: number) => {
      const out = new Float32Array(src.length), n = horiz ? mw : mh, lines = horiz ? mh : mw;
      for (let l = 0; l < lines; l++) {
        let sum = 0;
        const at = (k: number) => (horiz ? l * mw + k : k * mw + l);
        for (let k = -r; k <= r; k++) sum += src[at(Math.min(n - 1, Math.max(0, k)))];
        for (let k = 0; k < n; k++) {
          out[at(k)] = sum / (2 * r + 1);
          sum += src[at(Math.min(n - 1, k + r + 1))] - src[at(Math.max(0, k - r))];
        }
      }
      return out;
    };
    for (let pass = 0; pass < 2; pass++) { a = blur(a, true, 5); a = blur(a, false, 5); }
    const mask = (this.soft ??= document.createElement('canvas'));
    if (mask.width !== mw || mask.height !== mh) { mask.width = mw; mask.height = mh; }
    const mctx = mask.getContext('2d')!, mimg = mctx.createImageData(mw, mh);
    // A ragged, inky edge: the fade roughened by noise fixed to the land (so it doesn't swim as you pan).
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
      const k = j * mw + i, v = a[k];
      if (v <= 0) continue;
      const gx = c0x * R + i, gz = c0z * R + j;
      const n = (hash(gx >> 1, gz >> 1, 41) + hash(gx >> 2, gz >> 2, 43) + hash(gx >> 3, gz >> 3, 47)) / 3 - 0.5;
      const t = Math.max(0, Math.min(1, (v - 0.5) * 2.2 + 0.5 + n * 0.9 * (1 - Math.abs(v - 0.5) * 2)));
      mimg.data[k * 4 + 3] = t * t * (3 - 2 * t) * 255;
    }
    mctx.putImageData(mimg, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mask, toX(c0x * CELL), toY(c0z * CELL), nx * CELL * scale, nz * CELL * scale);
    ctx.restore();
  }
}
