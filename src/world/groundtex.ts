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

let shared: GroundTextures | null = null;
/** The one set of ground textures, shared by the near and distant terrain. */
export function groundTextures(): GroundTextures {
  return shared ??= new GroundTextures();
}

/** Give a shader the ground texture uniforms (see GROUND_GLSL). */
export function groundUniforms(shader: THREE.WebGLProgramParametersWithUniforms) {
  const gt = groundTextures();
  shader.uniforms.gColor = { value: gt.color };
  shader.uniforms.gNormal = { value: gt.normal };
  shader.uniforms.gOrm = { value: gt.orm };
  shader.uniforms.gAvg = { value: gt.avg };
  shader.uniforms.gScale = { value: gt.scale };
}

/**
 * Fragment shader code for blending ground layers. Needs `vWPos` (world
 * position). `groundLayer(i, w, bw, mixAB, near)` adds layer i at weight w,
 * projected along the world axes by weights `bw` (triplanar), into gPat (its
 * colour pattern, relative to its average), gNrm (bumps, world space; only if
 * near > 0) and gOrmV (AO, roughness, metal).
 */
export const GROUND_GLSL = `
uniform highp sampler2DArray gColor;
uniform highp sampler2DArray gNormal;
uniform highp sampler2DArray gOrm;
uniform vec3 gAvg[${GROUNDS.length}];
uniform float gScale[${GROUNDS.length}];
vec3 gPat; vec3 gNrm; vec3 gOrmV;
void groundLayer(int i, float w, vec3 bw, float mixAB, float near) {
  float s = 1.0 / gScale[i];
  float L = float(i);
  vec3 c = vec3(0.0), n = vec3(0.0), o = vec3(0.0);
  if (bw.y > 0.02) {
    vec2 a = vWPos.xz * s, b = mat2(0.8, -0.6, 0.6, 0.8) * vWPos.xz * s * 0.71 + 0.37;
    c += bw.y * mix(texture(gColor, vec3(a, L)).rgb, texture(gColor, vec3(b, L)).rgb, mixAB);
    o += bw.y * mix(texture(gOrm, vec3(a, L)).rgb, texture(gOrm, vec3(b, L)).rgb, mixAB);
    if (near > 0.0) { vec2 t = mix(texture(gNormal, vec3(a, L)).xy, texture(gNormal, vec3(b, L)).xy, mixAB) * 2.0 - 1.0; n += bw.y * vec3(t.x, 0.0, t.y); }
  }
  if (bw.x > 0.02) {
    vec2 a = vWPos.zy * s;
    c += bw.x * texture(gColor, vec3(a, L)).rgb;
    o += bw.x * texture(gOrm, vec3(a, L)).rgb;
    if (near > 0.0) { vec2 t = texture(gNormal, vec3(a, L)).xy * 2.0 - 1.0; n += bw.x * vec3(0.0, t.y, t.x); }
  }
  if (bw.z > 0.02) {
    vec2 a = vWPos.xy * s;
    c += bw.z * texture(gColor, vec3(a, L)).rgb;
    o += bw.z * texture(gOrm, vec3(a, L)).rgb;
    if (near > 0.0) { vec2 t = texture(gNormal, vec3(a, L)).xy * 2.0 - 1.0; n += bw.z * vec3(t.x, t.y, 0.0); }
  }
  gPat += w * c / max(gAvg[i], vec3(0.01));
  gNrm += w * n;
  gOrmV += w * o;
}`;
