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
}

export const QUALITY: Record<Quality, QualityLevel> = {
  low: { label: 'Low', pixelRatio: 0.75, shadowSize: 0, shadowEvery: 1, plants: 0.4, viewTiles: 2 },
  medium: { label: 'Medium', pixelRatio: 1, shadowSize: 1024, shadowEvery: 2, plants: 0.7, viewTiles: 3 },
  high: { label: 'High', pixelRatio: 2, shadowSize: 2048, shadowEvery: 1, plants: 1, viewTiles: 3 },
};

/** Frame rate caps on offer (0: as fast as the screen refreshes). */
export const FPS_CAPS = [30, 60, 120, 0];

export class GraphicsSettings {
  quality: Quality = 'medium';
  fpsCap = 60;

  constructor() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      if (data.quality in QUALITY) this.quality = data.quality;
      if (FPS_CAPS.includes(data.fpsCap)) this.fpsCap = data.fpsCap;
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

  get fpsLabel() { return this.fpsCap ? `${this.fpsCap} fps` : 'Unlimited'; }

  private persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ quality: this.quality, fpsCap: this.fpsCap })); } catch { /* private mode */ }
  }
}
