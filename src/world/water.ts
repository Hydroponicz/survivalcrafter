import * as THREE from 'three';

// Water: one look for the sea, lakes and rivers. Colour comes from depth, as
// in real water: clear over the shallows (you see the sand and stones through
// it), turning green-blue and then deep blue as the bottom drops away. Foam
// laps along the shore, ripples at three scales drift across the surface (so
// no tiling shows), and the sky and sun reflect off it, strongest at a
// glancing angle. How deep it is comes from the ground under each vertex for
// rivers and lakes, and from a map of the sea floor around you for the sea.

/** Seconds, for the moving ripples and foam (the game sets it each frame). */
export const waterTime = { value: 0 };

/** Deepest water the sea-floor map records (metres); deeper all looks the same. */
const MAX_DEPTH = 25.5;

const flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
flatNormal.needsUpdate = true;
const normals = { value: flatNormal as THREE.Texture };
let loading = false;
function loadNormals() {
  if (loading || typeof document === 'undefined') return;
  loading = true;
  new THREE.TextureLoader().load('textures/waternormals.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    normals.value = t;
  });
}

export interface WaterOptions {
  /** Where the depth comes from: a `depth` vertex attribute, or the sea-floor map. */
  depth: 'attribute' | 'seafloor';
  /** Rivers and lakes: fresh water is darker and peatier than the sea, with less surf. */
  fresh?: boolean;
  /** Rivers: white water where a `foam` vertex attribute says the stream runs steep. */
  rapids?: boolean;
  /** Further changes to the shader (e.g. the distant land's hole), applied after the water's. */
  extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  /** Tells three apart materials whose `extra` differs. */
  key?: string;
}

export function makeWaterMaterial(o: WaterOptions): THREE.MeshStandardMaterial {
  loadNormals();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, roughness: 0.05, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = waterTime;
    shader.uniforms.uWaterNormals = normals;
    shader.uniforms.uSeaFloor = seaFloor.texture;
    shader.uniforms.uSeaArea = seaFloor.area;
    const attr = o.depth === 'attribute';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWaterPos;
varying float vWaterDepth;
${attr ? 'attribute float depth;' : ''}
${o.rapids ? 'attribute float foam;\nvarying float vFoam;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWaterDepth = ${attr ? 'depth' : '0.0'};
${o.rapids ? 'vFoam = foam;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWaterPos;
varying float vWaterDepth;
${o.rapids ? 'varying float vFoam;' : ''}
uniform float uWaterTime;
uniform sampler2D uWaterNormals;
uniform sampler2D uSeaFloor;
uniform vec4 uSeaArea;
vec2 waterRipple(vec2 p, float scale, vec2 drift) {
  return texture2D(uWaterNormals, p / scale + drift * uWaterTime).xy * 2.0 - 1.0;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float wd = vWaterDepth;
  ${attr ? '' : `{
    vec2 sf = (vWaterPos.xz - uSeaArea.xy) / uSeaArea.z;
    wd = (sf.x < 0.0 || sf.y < 0.0 || sf.x > 1.0 || sf.y > 1.0) ? ${MAX_DEPTH.toFixed(1)} : texture2D(uSeaFloor, sf).r * ${MAX_DEPTH.toFixed(1)};
  }`}
  wd = max(wd, 0.0);
  // Light is soaked up with depth: clear and pale-green over the shallows, deep blue far down.
 ${o.fresh ? `vec3 shallowCol = vec3(0.045, 0.13, 0.10);
  vec3 midCol = vec3(0.015, 0.06, 0.065);
  vec3 deepCol = vec3(0.006, 0.025, 0.04);` : `vec3 shallowCol = vec3(0.055, 0.30, 0.27);
  vec3 midCol = vec3(0.02, 0.13, 0.17);
  vec3 deepCol = vec3(0.008, 0.04, 0.075);`}
  vec3 wc = mix(shallowCol, midCol, 1.0 - exp(-wd / 1.8));
  wc = mix(wc, deepCol, 1.0 - exp(-wd / 9.0));
  float wa = mix(${o.fresh ? '0.4' : '0.2'}, 0.93, smoothstep(0.0, 2.6, wd));
  // Foam lapping at the water's edge, in broken lines that wash in and out.
  float wn = texture2D(uWaterNormals, vWaterPos.xz / 7.0 + vec2(0.013, 0.007) * uWaterTime).r;
  float wash = 0.5 + 0.5 * sin(wd * 9.0 - uWaterTime * 1.3 + wn * 5.0);
  float shore = (1.0 - smoothstep(0.0, 0.3, wd)) * smoothstep(0.45, 0.9, wash * 0.6 + wn * 0.6) * ${o.fresh ? '0.3' : '0.8'};
  ${o.rapids ? `// White water tumbling down the rapids: churning patches, never solid.
  float f1 = texture2D(uWaterNormals, vWaterPos.xz / 2.7 + vec2(0.11, 0.17) * uWaterTime).r;
  float f2 = texture2D(uWaterNormals, vWaterPos.xz / 6.1 + vec2(-0.08, 0.13) * uWaterTime).g;
  float churn = smoothstep(0.45, 0.8, f1 * 0.55 + f2 * 0.55);
  shore = max(shore, vFoam * (0.2 + 0.7 * churn));` : ''}
  diffuseColor.rgb = mix(wc, vec3(0.88, 0.92, 0.94), shore);
  diffuseColor.a = mix(wa, 0.95, shore);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    // Ripples at three scales drifting different ways, gentler far off (where
    // they'd only shimmer) and in the shallows.
    vec2 r = waterRipple(vWaterPos.xz, 31.0, vec2(0.011, 0.006)) * 0.5
      + waterRipple(vWaterPos.xz, 9.0, vec2(-0.018, 0.021)) * 0.35
      + waterRipple(vWaterPos.xz, 113.0, vec2(0.004, -0.003)) * 0.45;
    float far = length(vWaterPos - cameraPosition);
    r *= 0.42 / (1.0 + far / 260.0);
    vec3 wnrm = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    wnrm = normalize(wnrm + vec3(r.x, 0.0, r.y));
    normal = normalize((viewMatrix * vec4(wnrm, 0.0)).xyz);
  }`);
    o.extra?.(shader);
  };
  m.customProgramCacheKey = () => `water:${o.depth}:${o.rapids ? 1 : 0}:${o.fresh ? 1 : 0}:${o.key ?? ''}`;
  return m;
}

/**
 * The sea floor around you, as depth below sea level on an 8 m grid, kept
 * centred near you. Remade when you've moved on or new land has arrived.
 */
class SeaFloor {
  static readonly N = 512;
  static readonly CELL = 8;
  readonly data = new Uint8Array(SeaFloor.N * SeaFloor.N);
  readonly texture: { value: THREE.DataTexture };
  /** x0, z0, size, unused. */
  readonly area = { value: new THREE.Vector4(1e9, 1e9, 1, 0) };
  private cx = NaN;
  private cz = NaN;
  private dirty = false;
  private wait = 0;

  constructor() {
    const t = new THREE.DataTexture(this.data, SeaFloor.N, SeaFloor.N, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    this.texture = { value: t };
  }

  /** New land arrived: the map needs redoing (soon, not every time). */
  changed() { this.dirty = true; }

  /**
   * Keep the map around (x, z); `ground` gives the land height at a point (NaN
   * where unknown, counted as deep water).
   */
  update(x: number, z: number, dt: number, ground: (x: number, z: number) => number, sea: number) {
    const span = SeaFloor.N * SeaFloor.CELL;
    const step = span / 8;
    const cx = Math.round(x / step) * step, cz = Math.round(z / step) * step;
    this.wait -= dt;
    const moved = cx !== this.cx || cz !== this.cz;
    if (!moved && !(this.dirty && this.wait <= 0)) return;
    this.cx = cx; this.cz = cz; this.dirty = false; this.wait = 1.5;
    const x0 = cx - span / 2, z0 = cz - span / 2, N = SeaFloor.N, C = SeaFloor.CELL;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const h = ground(x0 + (i + 0.5) * C, z0 + (j + 0.5) * C);
        const d = Number.isNaN(h) ? MAX_DEPTH : Math.max(0, Math.min(MAX_DEPTH, sea - h));
        this.data[j * N + i] = Math.round((d / MAX_DEPTH) * 255);
      }
    }
    this.texture.value.needsUpdate = true;
    this.area.value.set(x0, z0, span, 0);
  }
}

export const seaFloor = new SeaFloor();
