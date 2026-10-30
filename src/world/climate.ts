import { mulberry32, Simplex } from './noise';

// Climate: temperature from height (and a little latitude), moisture from a
// prevailing wind. Humid air blows in off the sea; where the land forces it
// up it cools and rains, so windward slopes are wet and the far side of a
// range lies in a dry rain shadow. Vegetation follows from the two.

export type Zone = 'beach' | 'marsh' | 'broadleaf' | 'conifer' | 'meadow' | 'heath' | 'alpine' | 'snow';

export const ZONE_NAMES: Record<Zone, string> = {
  beach: 'Shore',
  marsh: 'Marshland',
  broadleaf: 'Broadleaf woodland',
  conifer: 'Pine forest',
  meadow: 'Grassland',
  heath: 'Dry heath',
  alpine: 'Alpine scrub',
  snow: 'Snowfield',
};

/** Air cools about this much (0..1 scale) per metre of height: snow lies from roughly 240 m. */
export const LAPSE = 1 / 380;
/** Colder than this and snow lies. */
export const SNOW_TEMP = 0.12;

export interface Climate {
  /** Sea-level-adjusted base temperature per column (0 cold .. 1 warm), before height. */
  base: Float32Array;
  /** Wetness per column, 0 (parched) .. 1 (soaked). */
  moist: Float32Array;
  /** Rain falling per column, averaging 1 (feeds the rivers). */
  rain: Float32Array;
  /** Direction the wind blows toward (unit vector). */
  wind: [number, number];
}

/** Temperature at a height, from a column's base. */
export const tempAt = (base: number, y: number) => base - Math.max(0, y) * LAPSE;

/**
 * How rain (as the march below produces it on an 8 m map) is spread over
 * land: [rain, share of land with less]. Wetness is judged against this fixed
 * curve rather than per map, so neighbouring map tiles agree.
 */
const RAIN_CURVE: [number, number][] = [[0.0212, 0.05], [0.0225, 0.2], [0.0254, 0.5], [0.0319, 0.8], [3.34, 0.95], [12, 1]];
const RAIN_MID = 0.0254;
function rainRank(r: number): number {
  if (r <= RAIN_CURVE[0][0]) return RAIN_CURVE[0][1] * Math.max(0, r / RAIN_CURVE[0][0]);
  for (let k = 1; k < RAIN_CURVE.length; k++) {
    const [r1, p1] = RAIN_CURVE[k], [r0, p0] = RAIN_CURVE[k - 1];
    if (r <= r1) return p0 + (p1 - p0) * (Math.log(r / r0) / Math.log(r1 / r0));
  }
  return 1;
}

/**
 * Climate for a `w`×`w` map whose first cell sits at world (ox, oz), `cell`
 * metres apart. Wind and the patchy variations are fixed in world space.
 */
export function climate(H: Float32Array, w: number, seed: number, sea: number, ox = 0, oz = 0, cell = 1): Climate {
  const n = w * w;
  const rand = mulberry32(seed ^ 0xc11a7e);
  const noise = new Simplex(seed + 4242);
  const a = rand() * Math.PI * 2;
  const wx = Math.cos(a), wz = Math.sin(a);
  const height = (x: number, z: number) => {
    const ix = Math.max(0, Math.min(w - 1, Math.round(x))), iz = Math.max(0, Math.min(w - 1, Math.round(z)));
    return H[iz * w + ix];
  };

  // March streamlines of air across the island along the wind.
  const rain = new Float32Array(n);
  const diag = w * 1.5;
  const cx = w / 2, cz = w / 2;
  for (let s = -diag / 2; s <= diag / 2; s += 1) {
    // Start upwind, offset sideways by s.
    let x = cx - wx * diag / 2 - wz * s, z = cz - wz * diag / 2 + wx * s;
    let humid = 1;
    let prev = sea;
    for (let t = 0; t < diag; t++, x += wx, z += wz) {
      if (x < 0 || z < 0 || x > w - 1 || z > w - 1) { humid = 1; prev = sea; continue; }
      const h = Math.max(sea, height(x, z));
      const over = h <= sea + 0.05;
      // Over water the air picks moisture back up.
      if (over) humid = Math.min(1, humid + 0.02);
      const rise = Math.max(0, h - prev);
      const fall = (0.004 + rise * 0.09) * humid;
      humid = Math.max(0, humid - fall);
      if (!over) humid += (0.25 - humid) * 0.002; // a little moisture from plants and soil
      prev = h;
      rain[Math.round(z) * w + Math.round(x)] += 0.02 + fall * 10;
    }
  }
  // Rain drifts and spreads: blur it.
  const blur = (src: Float32Array, r: number) => {
    const tmp = new Float32Array(n), out = new Float32Array(n);
    for (let z = 0; z < w; z++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[z * w + Math.max(0, Math.min(w - 1, x))];
      for (let x = 0; x < w; x++) {
        tmp[z * w + x] = acc / (2 * r + 1);
        acc += src[z * w + Math.min(w - 1, x + r + 1)] - src[z * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let z = -r; z <= r; z++) acc += tmp[Math.max(0, Math.min(w - 1, z)) * w + x];
      for (let z = 0; z < w; z++) {
        out[z * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(w - 1, z + r + 1) * w + x] - tmp[Math.max(0, z - r) * w + x];
      }
    }
    return out;
  };
  const r1 = blur(blur(rain, 5), 5);
  const moist = new Float32Array(n), base = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ox + (i % w) * cell, z = oz + ((i / w) | 0) * cell;
    // Wetness: how this spot's rain compares with typical rain (dry heath at the
    // low end, soaked woodland at the high), with some patchy variation.
    moist[i] = Math.max(0, Math.min(1, 0.15 + 0.75 * rainRank(r1[i]) + noise.fbm(x / 650, z / 650, 3) * 0.12));
    r1[i] = Math.max(0.15, Math.min(8, r1[i] / RAIN_MID));
    // Slow warm and cool spells across the land, and patchy variation.
    base[i] = 0.8 + Math.sin(z / 9000) * 0.04 + noise.fbm(x / 1000 + 50, z / 1000, 2) * 0.06;
  }
  return { base, moist, rain: r1, wind: [wx, wz] };
}

/** Vegetation zone from climate and terrain. */
export function zoneOf(temp: number, moist: number, h: number, sea: number, nearWater: boolean, slope: number): Zone {
  if (temp < SNOW_TEMP) return 'snow';
  if (h < sea + 1.2 && !nearWater) return 'beach';
  if (temp < 0.3) return 'alpine';
  if (nearWater && moist > 0.55 && slope < 0.3 && h < sea + 8) return 'marsh';
  if (moist < 0.3) return 'heath';
  if (temp < 0.48) return 'conifer';
  if (moist > 0.52) return 'broadleaf';
  return 'meadow';
}
