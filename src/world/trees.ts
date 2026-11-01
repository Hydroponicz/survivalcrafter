import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Zone } from './climate';
import { mulberry32, Simplex } from './noise';
import { BaseLand } from './worldgen';
import { BIRCH } from './models/birch';

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
  // Its trunk and branches come from a model (see models/birch.ts).
  birch: { bark: 0xd8d4c8, leaf: 0x7aa33e, grown: 2.4, trunk: BIRCH.trunk, hardness: 1.0, difficulty: 10 },
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
export function treeGeometries(species: Species, detail: 0 | 1 = 1, standIn = false): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  const sides = detail ? 7 : 4, coneSides = detail ? 7 : 5, ico = detail;
  const t = TREES[species].trunk;
  if (species === 'birch') return birchGeometries(detail, standIn);
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

/** Kinds whose trunk and branches come from a model (rather than a plain tapering trunk). */
export const MODEL_TRUNK: Partial<Record<Species, true>> = { birch: true };

/**
 * The birch, from its model: the real trunk and branches near you (a plain
 * tapering trunk from afar), with low-poly leaf clumps where the model's
 * leaves were (the biggest few from afar). The model is flat front to back,
 * so each clump is made nearly as deep as it is wide.
 */
function birchGeometries(detail: 0 | 1, standIn = false): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  let trunk: THREE.BufferGeometry;
  if (detail) {
    trunk = new THREE.BufferGeometry();
    trunk.setAttribute('position', new THREE.Float32BufferAttribute(BIRCH.positions, 3));
    trunk.setIndex(BIRCH.indices);
    trunk.computeVertexNormals();
  } else if (standIn) {
    // Far off: a plain trunk running on up into the crown.
    const t = BIRCH.trunk, top = Math.max(t.h, ...BIRCH.clumps.map((c) => c[1]));
    trunk = new THREE.CylinderGeometry(t.r1 * 0.6, t.r0, top, 4, 1, true).translate(0, top / 2, 0);
  } else {
    // Further off: a plain trunk tapering up through the crown, and a thin
    // limb out to each clump, leaving the trunk at its own height and rising
    // toward the clump as branches do.
    const t = BIRCH.trunk, top = Math.max(...BIRCH.clumps.map((c) => c[1]));
    const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(t.r1 * 0.3, t.r0, top, 5, 1, true).translate(0, top / 2, 0).toNonIndexed()];
    for (const [x, y, z] of BIRCH.clumps) {
      const out = Math.hypot(x, z);
      const from = new THREE.Vector3(0, Math.max(t.h * 0.85, Math.min(y - 0.3, y - out * 0.85)), 0);
      const to = new THREE.Vector3(x, y, z), len = to.distanceTo(from);
      const limb = new THREE.CylinderGeometry(t.r1 * 0.12, t.r1 * 0.35, len, 3, 1, true).translate(0, len / 2, 0);
      limb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
      parts.push(limb.translate(from.x, from.y, from.z).toNonIndexed());
    }
    trunk = mergeGeometries(parts)!;
  }
  const clumps = detail || !standIn ? BIRCH.clumps : BIRCH.clumps.slice(0, 5);
  // A little fuller than the model's own leaves, so the clumps run together into a crown.
  const F = detail ? 1.35 : 1.6;
  const radii = (rx: number, ry: number, rz: number) => [rx * F, ry * F, Math.max(rz, rx * 0.85) * F];
  if (!detail && !standIn) {
    // Further off: the same kind of crown, in fewer twigs of bigger leaves.
    return { trunk, leaves: leafClusters(clumps.map(([x, y, z, rx, ry, rz]) => [x, y, z, ...radii(rx, ry, rz)]), 2711, 0.3) };
  }
  if (!detail) {
    // Far off (the distant forests), plain clumps: the leaves are too small to make out.
    const parts = clumps.map(([x, y, z, rx, ry, rz]) => {
      const [a, b, c] = radii(rx, ry, rz);
      return new THREE.IcosahedronGeometry(1, 0).scale(a, b, c).translate(x, y, z);
    });
    return { trunk, leaves: withColour(mergeGeometries(parts)!, 1) };
  }
  return { trunk, leaves: leafClusters(clumps.map(([x, y, z, rx, ry, rz]) => [x, y, z, ...radii(rx, ry, rz)]), 2711) };
}

/**
 * The material for a kind of tree's leaves (white: each tree's tint comes as
 * its instance colour). Leaves made of separate leaves (they carry their own
 * shades) are seen from both sides, lit as their clump's rounded surface
 * from either side (not turned dark on the back, as a flat card would be).
 */
export function leafMaterial(leaves: THREE.BufferGeometry): THREE.MeshStandardMaterial {
  if (!leaves.attributes.color) return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true });
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('normal *= faceDirection;', ''); };
  m.customProgramCacheKey = () => 'leaf-clusters';
  return m;
}

/** A geometry all one shade (as vertex colours), so it can share a material with leaves that vary. */
function withColour(g: THREE.BufferGeometry, v: number): THREE.BufferGeometry {
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(v), 3));
  return g;
}

/**
 * Crowns of real leaves rather than solid blobs, built the way foliage
 * grows: from where each branch ends (a clump: centre and radii), a spray of
 * thin twigs reaches out every way, each carrying small leaves along it,
 * alternating side to side and turned up and out toward the light. There's
 * sky between the twigs, so a crown looks light and open, not solid. Leaves
 * are lit partly as the clump's rounded surface and partly as themselves, so
 * the crown keeps a sunny and a shaded side without looking flat; each spray
 * and each leaf is a slightly different shade.
 */
function leafClusters(clumps: number[][], seed: number, fewer = 1): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const up = V(0, 1, 0);
  const push = (pts: THREE.Vector3[], n: THREE.Vector3[], c: number[]) => {
    for (let k = 0; k < pts.length; k++) { pos.push(pts[k].x, pts[k].y, pts[k].z); nor.push(n[k].x, n[k].y, n[k].z); col.push(c[0], c[1], c[2]); }
  };
  for (const [cx, cy, cz, rx, ry, rz] of clumps) {
    const c = V(cx, cy, cz);
    // Away from the trunk: the clump's own outward lean.
    const out = V(cx, 0, cz).normalize();
    const size = Math.cbrt(rx * ry * rz);
    const sprays = Math.max(3, Math.round(Math.min(30, Math.max(14, 34 * size)) * fewer));
    for (let s = 0; s < sprays; s++) {
      const dir = V(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      if (dir.lengthSq() > 1 || dir.lengthSq() < 0.02) { s--; continue; }
      dir.normalize().addScaledVector(up, 0.35).addScaledVector(out, 0.4).normalize();
      const reach = 0.85 + 0.3 * rnd();
      const start = c.clone().addScaledVector(V(dir.x * rx, dir.y * ry, dir.z * rz), 0.12);
      const end = c.clone().add(V(dir.x * rx, dir.y * ry, dir.z * rz).multiplyScalar(reach));
      const along = end.clone().sub(start), len = along.length();
      along.normalize();
      const side0 = V().crossVectors(along, up);
      if (side0.lengthSq() < 1e-4) side0.set(1, 0, 0);
      side0.normalize();
      const shade = 0.86 + 0.24 * rnd(), warm = 0.05 * (rnd() - 0.3);
      // The twig itself: a thin dark sliver.
      const tw = 0.012;
      push([start.clone().addScaledVector(side0, -tw), start.clone().addScaledVector(side0, tw), end.clone(),
      ], [up, up, up], [0.32, 0.3, 0.28]);
      // Its leaves, alternating sides, with a few clustered at the tip.
      const n = Math.max(3, Math.round(Math.max(7, Math.round(len / 0.055)) * fewer));
      for (let k = 0; k < n + 3; k++) {
        const t = k < n ? 0.22 + 0.78 * (k / n) : 1;
        const sideSign = k % 2 ? 1 : -1;
        const p = start.clone().lerp(end, t).addScaledVector(V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5), 0.03);
        // Out from the twig at an angle, drooping a little.
        const spin = (rnd() - 0.5) * 1.2 + (k >= n ? (k - n) * 2.1 : 0);
        const side = side0.clone().applyAxisAngle(along, spin).multiplyScalar(sideSign);
        const a = along.clone().multiplyScalar(0.55).add(side).addScaledVector(up, -0.15).normalize();
        // Facing up and out, toward the light.
        const face = up.clone().multiplyScalar(0.75).addScaledVector(dir, 0.45).add(V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.5)).normalize();
        const b = V().crossVectors(face, a).normalize();
        a.crossVectors(b, face).normalize();
        const L = (0.12 + 0.06 * rnd()) / Math.sqrt(fewer), W = L * (0.52 + 0.12 * rnd());
        const base = p, tip = p.clone().addScaledVector(a, L);
        const mid = p.clone().addScaledVector(a, L * 0.42).addScaledVector(face, -W * 0.15);
        const e1 = mid.clone().addScaledVector(b, W / 2), e2 = mid.clone().addScaledVector(b, -W / 2);
        // Lit half as the clump's surface, half as the leaf itself.
        const q = mid.clone().sub(c);
        const nc = V(q.x / (rx * rx), q.y / (ry * ry), q.z / (rz * rz)).normalize().multiplyScalar(0.55).addScaledVector(face, 0.45).normalize();
        const v = shade * (0.92 + 0.16 * rnd());
        push([base, e1, tip, base, tip, e2], [nc, nc, nc, nc, nc, nc], [v + warm, v + warm * 0.6, v - warm]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
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
  private berries: Simplex;
  constructor(seed: number) {
    this.land = new BaseLand(seed);
    this.wild = new Simplex(seed + 1250);
    this.berries = new Simplex(seed + 1260);
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

  /**
   * Berry bushes per 4 m² at a point: in patches (a sunny bank, a woodland
   * edge), mostly where the trees thin out and let the light in, and none
   * at all across most of the land.
   */
  bushes(zone: Zone, x: number, z: number): number {
    const patch = smooth01((this.berries.fbm(x / 70 + 3.3, z / 70, 2) - 0.35) / 0.2);
    if (patch <= 0) return 0;
    const sun = 1 - smooth01((this.density(zone, x, z) - 0.03) / 0.12);
    return VEGETATION[zone].bushes * 2 * patch * (0.1 + 0.9 * sun);
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
