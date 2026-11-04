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

/**
 * Foam, drawn here rather than loaded: red is a web of bubbles (the bright
 * rims between cells, at two sizes), green a soft blotchy coverage that
 * breaks the foam into patches and streaks. Tiles seamlessly.
 */
function makeFoamTexture(): THREE.Texture {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // Bubble rims: distance between the nearest and second-nearest cell points (wrapping).
  const cells = (n: number) => {
    const pts = Array.from({ length: n * n }, () => [rand(), rand()]);
    return (u: number, v: number) => {
      const cx = Math.floor(u * n), cy = Math.floor(v * n);
      let d1 = 9, d2 = 9;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, gy = cy + dy;
        const p = pts[(((gy % n) + n) % n) * n + (((gx % n) + n) % n)];
        const d = Math.hypot((gx + p[0]) / n - u, (gy + p[1]) / n - v) * n;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      return d2 - d1; // 0 on a rim, larger inside a bubble
    };
  };
  const big = cells(14), small = cells(38);
  // Smooth tileable value noise for coverage.
  const vn = (n: number) => {
    const g = Array.from({ length: n * n }, () => rand());
    return (u: number, v: number) => {
      const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
      const at = (a: number, b: number) => g[((b % n + n) % n) * n + ((a % n + n) % n)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx, b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const c1 = vn(5), c2 = vn(11);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const rim = Math.max(1 - big(u, v) / 0.7, 0.85 * (1 - small(u, v) / 0.55), 0);
      const k = (y * S + x) * 4;
      data[k] = Math.round(Math.min(1, rim) * 255);
      data[k + 1] = Math.round((c1(u, v) * 0.65 + c2(u, v) * 0.35) * 255);
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
const foamTex = { value: null as THREE.Texture | null };

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
    foamTex.value ??= makeFoamTexture();
    shader.uniforms.uFoam = foamTex;
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
${o.rapids ? 'attribute float foam;\nattribute vec2 flow;\nvarying float vFoam;\nvarying vec2 vFlow;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWaterDepth = ${attr ? 'depth' : '0.0'};
${o.rapids ? 'vFoam = foam;\nvFlow = flow;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWaterPos;
varying float vWaterDepth;
${o.rapids ? `varying float vFoam;
varying vec2 vFlow;` : ''}
uniform float uWaterTime;
uniform sampler2D uWaterNormals;
uniform sampler2D uFoam;
// Foam where 'amount' (0..1) calls for it: the bubble web fills in from its
// rims as the amount rises, broken into patches, soft at the edges.
// The same, with the clumping taken from a separate (larger) sample.
float foamAt2(vec4 f, float cover, float amount) {
  float a = clamp(amount, 0.0, 1.0);
  // Clumps where the coverage runs high (more of them as the amount rises),
  // feathered at their edges, each a mass of bubbles brightest on the rims.
  float clump = smoothstep(0.82 - 0.45 * a, 1.12 - 0.45 * a, cover);
  return clump * mix(0.45, 1.0, smoothstep(0.2, 0.8, f.r));
}
float foamAt(vec4 f, float amount) {
  return foamAt2(f, f.g, amount);
}
uniform sampler2D uSeaFloor;
uniform vec4 uSeaArea;
vec2 waterRipple(vec2 p, float scale, vec2 drift) {
  return texture2D(uWaterNormals, p / scale + drift * uWaterTime).xy * 2.0 - 1.0;
}
${o.rapids ? `// A texture carried along by the current: two copies drifting downstream,
// each restarting in turn while the other is showing, so it never smears.
float carried(vec2 p, float scale, float speed, int ch) {
  float t = uWaterTime * 0.2;
  float a = fract(t), b = fract(t + 0.5);
  vec2 f = vFlow * speed / scale;
  vec4 s0 = texture2D(uWaterNormals, p / scale - f * a);
  vec4 s1 = texture2D(uWaterNormals, p / scale - f * b + 0.37);
  float v0 = ch == 0 ? s0.r : s0.g, v1 = ch == 0 ? s1.r : s1.g;
  // Blend the two, keeping the contrast even through the blend (no pulsing).
  float w = abs(2.0 * a - 1.0);
  return 0.5 + (mix(v0, v1, w) - 0.5) / sqrt(w * w + (1.0 - w) * (1.0 - w));
}
// The foam texture carried downstream the same way.
vec4 carriedFoam(vec2 p, float scale, float speed) {
  float t = uWaterTime * 0.2;
  float a = fract(t), b = fract(t + 0.5);
  vec2 f = vFlow * speed / scale;
  vec4 s0 = texture2D(uFoam, p / scale - f * a);
  vec4 s1 = texture2D(uFoam, p / scale - f * b + 0.37);
  return mix(s0, s1, abs(2.0 * a - 1.0));
}` : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float wd = vWaterDepth;
  ${attr ? '' : `{
    vec2 sf = (vWaterPos.xz - uSeaArea.xy) / uSeaArea.z;
    wd = (sf.x < 0.0 || sf.y < 0.0 || sf.x > 1.0 || sf.y > 1.0) ? ${MAX_DEPTH.toFixed(1)} : texture2D(uSeaFloor, sf).r * ${MAX_DEPTH.toFixed(1)};
  }`}
  wd = max(wd, 0.0);
  // Light is soaked up with depth: clear and pale-green over the shallows, deep blue far down.
  vec3 shallowCol = vec3(0.055, 0.30, 0.27);
  vec3 midCol = vec3(0.02, 0.13, 0.17);
  vec3 deepCol = vec3(0.008, 0.04, 0.075);
  ${o.fresh ? `// Fresh water is darker and peatier, turning to the sea's colours as a
  // river nears sea level (an estuary), so there's no line where it meets it.
  float freshness = smoothstep(0.4, 3.0, vWaterPos.y);
  shallowCol = mix(shallowCol, vec3(0.045, 0.13, 0.10), freshness);
  midCol = mix(midCol, vec3(0.015, 0.06, 0.065), freshness);
  deepCol = mix(deepCol, vec3(0.006, 0.025, 0.04), freshness);` : ''}
  vec3 wc = mix(shallowCol, midCol, 1.0 - exp(-wd / 1.8));
  wc = mix(wc, deepCol, 1.0 - exp(-wd / 9.0));
  float wa = mix(${o.fresh ? 'mix(0.2, 0.4, freshness)' : '0.2'}, 0.93, smoothstep(0.0, 2.6, wd));
  // Foam lapping at the water's edge: a lacy fringe of bubbles that slowly
  // washes in and out, thinning away from the shore.
  vec4 sf = texture2D(uFoam, vWaterPos.xz / 3.2 + vec2(0.004, 0.003) * uWaterTime);
  float wash = 0.75 + 0.25 * sin(uWaterTime * 0.6 + sf.g * 6.0);
  float shore = foamAt(sf, (1.0 - smoothstep(0.0, 0.45, wd)) * wash) * ${o.fresh ? '0.35' : '0.75'};
  ${o.rapids ? `// White water down the rapids, carried along with the current: thicker
  // where the stream falls hardest, opening into streaks and patches below.
  // Bubbles, gathered into clumps from a larger, separate sample (so their
  // pattern doesn't repeat), all carried along with the current.
  vec4 rf = carriedFoam(vWaterPos.xz, 2.2, 3.0);
  float cover = carriedFoam(vWaterPos.xz, 7.0, 2.0).g * 0.6 + carriedFoam(vWaterPos.xz + 3.1, 3.3, 3.0).g * 0.4;
  shore = max(shore, foamAt2(rf, cover, vFoam * 0.85) * 0.72);
  // Churned water is paler all through, not just where the bubbles are.
  wc = mix(wc, vec3(0.42, 0.5, 0.52), vFoam * (0.25 + 0.25 * rf.g));
  wa = mix(wa, 0.9, vFoam * 0.5);` : ''}
  // Far off the bubbles are too small to see; foam reads as a soft paleness.
  shore *= mix(1.0, 0.6, smoothstep(40.0, 160.0, length(vWaterPos - cameraPosition)));
  // Foam is white with a little of the water's colour through it, never glaring.
  diffuseColor.rgb = mix(wc, mix(vec3(0.78, 0.82, 0.84), wc * 3.0, 0.15), shore);
  diffuseColor.a = mix(wa, 0.9, shore);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    // Ripples at three scales drifting different ways, gentler far off (where
    // they'd only shimmer) and in the shallows.
    vec2 r = waterRipple(vWaterPos.xz, 31.0, vec2(0.011, 0.006)) * 0.5
      + waterRipple(vWaterPos.xz, 9.0, vec2(-0.018, 0.021)) * 0.35
      + waterRipple(vWaterPos.xz, 113.0, vec2(0.004, -0.003)) * 0.45;
    ${o.rapids ? `// Running water: ripples swept along with the current.
    float run = clamp(length(vFlow), 0.0, 1.0);
    vec2 rr = vec2(carried(vWaterPos.xz, 5.0, 3.0, 0), carried(vWaterPos.xz + 2.3, 5.0, 3.0, 1)) * 2.0 - 1.0;
    r = mix(r, rr * 0.5, run * 0.6);` : ''}
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
  /** A redraw under way: worked a band of rows a frame into a spare map, which is swapped in when it's done. */
  private job: { x0: number; z0: number; row: number; buf: Uint8Array } | null = null;

  update(x: number, z: number, dt: number, ground: (x: number, z: number) => number, sea: number) {
    const span = SeaFloor.N * SeaFloor.CELL;
    const step = span / 8;
    const cx = Math.round(x / step) * step, cz = Math.round(z / step) * step;
    this.wait -= dt;
    const moved = cx !== this.cx || cz !== this.cz;
    if (moved || (this.dirty && this.wait <= 0 && !this.job)) {
      // (Begun again from the top if you've moved on meanwhile.)
      this.cx = cx; this.cz = cz; this.dirty = false; this.wait = 4;
      this.job = { x0: cx - span / 2, z0: cz - span / 2, row: 0, buf: this.job?.buf ?? new Uint8Array(SeaFloor.N * SeaFloor.N) };
    }
    const job = this.job;
    if (!job) return;
    const N = SeaFloor.N, C = SeaFloor.CELL;
    // The first map is made whole (there's nothing to show yet); after that, 32 rows a frame (16 frames).
    const first = !Number.isFinite(this.area.value.x) || this.area.value.x === 1e9;
    const end = first ? N : Math.min(N, job.row + 32);
    for (let j = job.row; j < end; j++) {
      for (let i = 0; i < N; i++) {
        const h = ground(job.x0 + (i + 0.5) * C, job.z0 + (j + 0.5) * C);
        const d = Number.isNaN(h) ? MAX_DEPTH : Math.max(0, Math.min(MAX_DEPTH, sea - h));
        job.buf[j * N + i] = Math.round((d / MAX_DEPTH) * 255);
      }
    }
    job.row = end;
    if (job.row < N) return;
    this.data.set(job.buf);
    this.texture.value.needsUpdate = true;
    this.area.value.set(job.x0, job.z0, span, 0);
    this.job = null;
  }
}

export const seaFloor = new SeaFloor();
