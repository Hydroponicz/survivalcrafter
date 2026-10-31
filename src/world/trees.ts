import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Zone } from './climate';
import { Simplex } from './noise';
import { BaseLand } from './worldgen';

// The kinds of tree, what they look like and where they grow. Everything
// that draws, fells or places trees reads it from here, so a new kind is
// added in this one place.

export type Species = 'oak' | 'birch' | 'pine' | 'spruce' | 'beech' | 'maple' | 'willow';
export const SPECIES: Species[] = ['oak', 'birch', 'pine', 'spruce', 'beech', 'maple', 'willow'];

export interface TreeKind {
  /** Bark and leaf colours (sRGB hex). */
  bark: number; leaf: number;
  /** Model multiplier for a typical full-grown tree (the models are ~6 m tall). */
  grown: number;
  /** Trunk shape in model units (base radius, top radius, height); matches the model. */
  trunk: { r0: number; r1: number; h: number };
  /** How hard the wood is to cut, and how much skill felling it takes. */
  hardness: number; difficulty: number;
}

export const TREES: Record<Species, TreeKind> = {
  oak: { bark: 0x5a4030, leaf: 0x3f7a2c, grown: 2.7, trunk: { r0: 0.3, r1: 0.2, h: 3.4 }, hardness: 1.25, difficulty: 14 },
  birch: { bark: 0xd8d4c8, leaf: 0x7aa33e, grown: 2.4, trunk: { r0: 0.17, r1: 0.11, h: 4.6 }, hardness: 1.0, difficulty: 10 },
  pine: { bark: 0x4a3426, leaf: 0x2b5a33, grown: 3.4, trunk: { r0: 0.24, r1: 0.14, h: 4.5 }, hardness: 0.9, difficulty: 8 },
  // Tall, narrow and dark: the deep conifer woods and the slopes up to the tree line.
  spruce: { bark: 0x3d2c22, leaf: 0x1d4632, grown: 3.6, trunk: { r0: 0.26, r1: 0.12, h: 6.0 }, hardness: 0.85, difficulty: 8 },
  // Smooth grey trunks under a dense, high canopy.
  beech: { bark: 0x8b8a82, leaf: 0x4d8a2c, grown: 2.9, trunk: { r0: 0.32, r1: 0.22, h: 4.2 }, hardness: 1.3, difficulty: 15 },
  // A broad round crown, yellower green.
  maple: { bark: 0x6b5848, leaf: 0x7d9a2a, grown: 2.5, trunk: { r0: 0.27, r1: 0.18, h: 3.2 }, hardness: 1.2, difficulty: 13 },
  // Short and thick, with a drooping curtain of leaves, beside water.
  willow: { bark: 0x5b4a36, leaf: 0x8aa64a, grown: 2.3, trunk: { r0: 0.38, r1: 0.25, h: 2.8 }, hardness: 0.8, difficulty: 6 },
};

/**
 * A tree's trunk and leaves, in model units (about 6 m tall; scaled per
 * tree). `detail` 0 is a pared-down version for the distant forests.
 */
export function treeGeometries(species: Species, detail: 0 | 1 = 1): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  const sides = detail ? 7 : 4, coneSides = detail ? 7 : 5, ico = detail;
  const t = TREES[species].trunk;
  const trunk = new THREE.CylinderGeometry(t.r1, t.r0, t.h, sides, 1, !detail).translate(0, t.h / 2, 0);
  const blob = (r: number, x: number, y: number, z: number, sx = 1, sy = 1) =>
    new THREE.IcosahedronGeometry(r, ico).scale(sx, sy, sx).translate(x, y, z);
  const cone = (r: number, h: number, y: number) => new THREE.ConeGeometry(r, h, coneSides, 1, !detail).translate(0, y, 0);
  let parts: THREE.BufferGeometry[];
  switch (species) {
    case 'pine':
      parts = [0, 1, 2].map((i) => cone(1.5 - i * 0.38, 2.0, 2.4 + i * 1.25));
      break;
    case 'spruce':
      parts = detail
        ? [0, 1, 2, 3, 4].map((i) => cone(1.35 - i * 0.24, 1.9, 1.7 + i * 1.12))
        : [0, 1, 2].map((i) => cone(1.3 - i * 0.38, 2.6, 2.0 + i * 1.75));
      break;
    case 'birch':
      parts = detail ? [blob(1.15, 0, 4.4, 0, 1, 1.45), blob(0.8, 0.5, 3.6, 0.3)] : [blob(1.2, 0, 4.3, 0, 1.05, 1.5)];
      break;
    case 'beech':
      parts = detail
        ? [blob(1.9, 0, 4.7, 0), blob(1.15, 1.2, 4.0, 0.4), blob(1.1, -1.1, 4.1, -0.5), blob(1.2, 0.2, 5.8, 0.1)]
        : [blob(2.2, 0, 4.9, 0, 1.05, 1.0)];
      break;
    case 'maple':
      parts = detail ? [blob(1.9, 0, 3.9, 0, 1.15, 0.95), blob(1.2, 0.1, 5.1, -0.1)] : [blob(2.1, 0, 4.1, 0, 1.15, 1.0)];
      break;
    case 'willow': {
      // A low crown over a hanging curtain of leaves.
      const curtain = new THREE.CylinderGeometry(2.2, 2.6, 2.6, detail ? 9 : 6, 1, true).translate(0, 2.4, 0);
      parts = detail ? [blob(2.1, 0, 3.6, 0, 1.25, 0.8), curtain] : [blob(2.2, 0, 3.6, 0, 1.25, 0.8), curtain];
      break;
    }
    default: // oak
      parts = detail
        ? [blob(1.7, 0, 4.0, 0), blob(1.15, 1.1, 3.4, 0.3), blob(1.1, -0.9, 3.5, -0.6)]
        : [blob(2.1, 0.1, 3.85, -0.1, 1.05, 0.85)];
  }
  return { trunk, leaves: parts.length > 1 ? mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))! : parts[0] };
}

/** What grows in each climate zone: tree density per 4 m², species mix, stature, berry bushes. */
export const VEGETATION: Record<Zone, { trees: number; mix: Partial<Record<Species, number>>; stature: number; bushes: number }> = {
  broadleaf: { trees: 0.16, mix: { oak: 4, beech: 3, maple: 2, birch: 2, pine: 0.5 }, stature: 1, bushes: 0.04 },
  conifer: { trees: 0.19, mix: { pine: 5, spruce: 5, birch: 1.5, oak: 0.3 }, stature: 1, bushes: 0.02 },
  meadow: { trees: 0.012, mix: { oak: 4, maple: 2, birch: 2, pine: 1, willow: 0.5 }, stature: 1, bushes: 0.05 },
  heath: { trees: 0.008, mix: { pine: 6, birch: 3, oak: 1, spruce: 1 }, stature: 0.8, bushes: 0.03 },
  marsh: { trees: 0.03, mix: { willow: 6, birch: 4, spruce: 1 }, stature: 0.85, bushes: 0.02 },
  alpine: { trees: 0.03, mix: { spruce: 6, pine: 4, birch: 1 }, stature: 0.6, bushes: 0.01 },
  beach: { trees: 0.004, mix: { pine: 3, birch: 1 }, stature: 0.8, bushes: 0 },
  snow: { trees: 0, mix: { spruce: 1 }, stature: 0.5, bushes: 0 },
};

/** How far each zone's open country can turn into woodland where the big woods spread. */
const WOODLAND: Partial<Record<Zone, number>> = { meadow: 0.2, heath: 0.16, marsh: 0.1, alpine: 0.09, broadleaf: 0.05, conifer: 0.05 };

/**
 * Where trees grow. Climate zones set the kinds and how thickly; across that,
 * great woods spread for kilometres over open country too, and within any
 * wood, stands and clearings break it up. The near trees and the distant
 * forests both ask this, so they agree.
 */
export class TreeCover {
  private stands: Simplex;
  private woods: Simplex;
  private land: BaseLand;
  private wild: Simplex;
  constructor(seed: number) {
    this.land = new BaseLand(seed);
    this.wild = new Simplex(seed + 1250);
    this.stands = new Simplex(seed + 1234);
    this.woods = new Simplex(seed + 1240);
  }

  /**
   * How far (metres) trees keep back from the water's edge here. Banks are
   * mostly open (grass, shingle, the odd tree), but in a few wild stretches
   * the forest crowds right down to the water.
   */
  bankClearance(x: number, z: number): number {
    const wild = smooth01((this.wild.fbm(x / 2600 + 7.7, z / 2600, 2) - 0.36) / 0.14);
    return 8 * (1 - wild) + 0.5 * wild;
  }

  /** Trees per 4 m² at a point in a zone. */
  density(zone: Zone, x: number, z: number): number {
    const v = VEGETATION[zone];
    const wood = Math.max(0, Math.min(1, (this.woods.fbm(x / 1700, z / 1700, 2) + 0.15) / 0.35));
    const base = v.trees + (WOODLAND[zone] ?? 0) * wood * wood * (3 - 2 * wood);
    const f = this.stands.fbm(x * 0.02, z * 0.02, 3);
    // The great plains are open grassland: trees in scattered copses and lines, the odd wood.
    const open = this.land.open(x, z) * (1 - 0.7 * wood);
    return base * Math.max(0.15, Math.min(1.8, 1 + f * 2.2)) * (1 - 0.9 * open);
  }

  /** Which kind of tree, for a roll in 0..1. */
  pick(zone: Zone, roll: number): Species {
    const mix = VEGETATION[zone].mix;
    let total = 0;
    for (const s of SPECIES) total += mix[s] ?? 0;
    let r = roll * total;
    for (const s of SPECIES) {
      r -= mix[s] ?? 0;
      if (r < 0) return s;
    }
    return 'pine';
  }
}

const smooth01 = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
