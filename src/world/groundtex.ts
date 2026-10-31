import * as THREE from 'three';

// Photographed ground textures (colour, OpenGL normal map, and AO/rough/metal
// packed), one layer each in three texture arrays so the terrain shader can
// blend any of them with a handful of texture units. Each layer is laid over
// the terrain's own colour (material, climate, snow) as a pattern relative to
// the photo's average colour, so dry, lush and cold grass, or granite and
// sandstone, still differ.

/** Ground layers, in array order. */
export const GROUNDS = ['grass', 'dirt', 'sand', 'gravel', 'rock', 'snow'] as const;
export type Ground = (typeof GROUNDS)[number];
/** Metres one repeat of each layer's texture covers. */
export const GROUND_SCALE: Record<Ground, number> = { grass: 2.6, dirt: 2.4, sand: 3.2, gravel: 1.8, rock: 4.0, snow: 4.0 };

const SIZE = 1024;
const LAYERS = GROUNDS.length;

function makeArray(fill: [number, number, number, number], colour: boolean): THREE.DataArrayTexture {
  const data = new Uint8Array(SIZE * SIZE * 4 * LAYERS);
  for (let i = 0; i < data.length; i += 4) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3]; }
  const t = new THREE.DataArrayTexture(data, SIZE, SIZE, LAYERS);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export class GroundTextures {
  readonly color = makeArray([128, 128, 128, 255], true);
  readonly normal = makeArray([128, 128, 255, 255], false);
  readonly orm = makeArray([255, 230, 0, 255], false);
  /** Each layer's average colour (linear), so its pattern can be laid over other colours. */
  readonly avg = Array.from({ length: LAYERS }, () => new THREE.Vector3(0.2158, 0.2158, 0.2158)); // the grey placeholder, until each loads
  readonly scale = GROUNDS.map((g) => GROUND_SCALE[g]);

  constructor() {
    if (typeof document === 'undefined') return;
    GROUNDS.forEach((g, layer) => {
      void this.load(`textures/terrain/${g}_color.jpg`, this.color, layer, true);
      void this.load(`textures/terrain/${g}_normal.jpg`, this.normal, layer, false);
      void this.load(`textures/terrain/${g}_orm.jpg`, this.orm, layer, false);
    });
  }

  private async load(url: string, tex: THREE.DataArrayTexture, layer: number, colour: boolean) {
    try {
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob, { resizeWidth: SIZE, resizeHeight: SIZE, colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
      (tex.image.data as Uint8Array).set(px, layer * SIZE * SIZE * 4);
      tex.addLayerUpdate(layer);
      tex.needsUpdate = true;
      if (colour) {
        // Average colour, in linear light, from a sparse sample of the photo.
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4 * 97) {
          r += (px[i] / 255) ** 2.2; g += (px[i + 1] / 255) ** 2.2; b += (px[i + 2] / 255) ** 2.2; n++;
        }
        this.avg[layer].set(r / n, g / n, b / n);
      }
    } catch (e) {
      console.warn('Could not load ground texture', url, e);
    }
  }
}
