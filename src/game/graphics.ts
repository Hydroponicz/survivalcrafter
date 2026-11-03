// Graphics settings: how hard the game works your computer. Stored per
// browser, separate from the world save.

const KEY = 'survivalcrafter.graphics.v1';

export type Quality = 'low' | 'medium' | 'high';

export interface QualityLevel {
  label: string;
  /** Most screen pixels per CSS pixel (sharpness on high-DPI screens costs a lot). */
  pixelRatio: number;
  /** Sun shadow map size, or 0 for no shadows. */
  shadowSize: number;
  /** Redraw shadows every this many frames (they change slowly; every tree is drawn again for them). */
  shadowEvery: number;
  /** Share of grass, flowers and other small plants drawn. */
  plants: number;
  /** How many map tiles (1 km) of distant land to draw around you. */
  viewTiles: number;
  /** Thin distant forests by this many levels of detail (0: full). */
  forestThin: number;
}

export const QUALITY: Record<Quality, QualityLevel> = {
  low: { label: 'Low', pixelRatio: 0.75, shadowSize: 0, shadowEvery: 1, plants: 0.4, viewTiles: 2, forestThin: 1 },
  medium: { label: 'Medium', pixelRatio: 1, shadowSize: 1024, shadowEvery: 2, plants: 0.7, viewTiles: 3, forestThin: 0 },
  high: { label: 'High', pixelRatio: 2, shadowSize: 2048, shadowEvery: 1, plants: 1, viewTiles: 3, forestThin: 0 },
};

/** Frame rate caps on offer (0: as fast as the screen refreshes). */
export const FPS_CAPS = [30, 60, 120, 0];

/** Anti-aliasing: none; the GPU's own (MSAA, with smoothed cut-out edges); or that plus SMAA over the finished picture. */
export type AA = 'off' | 'standard' | 'high';
const AA_LABELS: Record<AA, string> = { off: 'Off', standard: 'Standard', high: 'High (SMAA)' };

export class GraphicsSettings {
  quality: Quality = 'medium';
  fpsCap = 60;
  aa: AA = 'standard';

  constructor() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      if (data.quality in QUALITY) this.quality = data.quality;
      if (FPS_CAPS.includes(data.fpsCap)) this.fpsCap = data.fpsCap;
      if (data.aa in AA_LABELS) this.aa = data.aa;
    } catch { /* ignore broken settings */ }
  }

  get level(): QualityLevel { return QUALITY[this.quality]; }

  nextQuality() {
    const order = Object.keys(QUALITY) as Quality[];
    this.quality = order[(order.indexOf(this.quality) + 1) % order.length];
    this.persist();
  }

  nextFpsCap() {
    this.fpsCap = FPS_CAPS[(FPS_CAPS.indexOf(this.fpsCap) + 1) % FPS_CAPS.length];
    this.persist();
  }

  nextAA() {
    const order = Object.keys(AA_LABELS) as AA[];
    this.aa = order[(order.indexOf(this.aa) + 1) % order.length];
    this.persist();
  }

  get aaLabel() { return AA_LABELS[this.aa]; }

  get fpsLabel() { return this.fpsCap ? `${this.fpsCap} fps` : 'Unlimited'; }

  private persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ quality: this.quality, fpsCap: this.fpsCap, aa: this.aa })); } catch { /* private mode */ }
  }
}
