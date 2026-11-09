import * as THREE from 'three';
import { STRUCTURES, totalMaterials, type StructureDef } from '../data/structures';
import type { StructureObj } from './world';

// How far a planned piece has been built, and where: walls, roofs and most
// pieces fill from the ground up, course by course; floors (flat pieces) fill
// across, plank by plank. Shared by the world view (the built part solid, the
// rest a blueprint) and the hands-on building work (the next slot to fill).

/** The piece's size in its own frame. */
export function pieceBounds(def: StructureDef): { min: THREE.Vector3; max: THREE.Vector3 } {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const b of def.boxes) {
    min.min(new THREE.Vector3(b.c[0] - b.h[0], b.c[1] - b.h[1], b.c[2] - b.h[2]));
    max.max(new THREE.Vector3(b.c[0] + b.h[0], b.c[1] + b.h[1], b.c[2] + b.h[2]));
  }
  return { min, max };
}

/** Flat pieces (floors, a slipway) fill across their length; the rest fill upward. */
export function fillsAcross(def: StructureDef): boolean {
  const { min, max } = pieceBounds(def);
  return max.y - min.y < 0.5 && Math.max(max.x - min.x, max.z - min.z) > 1;
}

/**
 * Which way a piece fills, in its own frame: up (most pieces), or for a flat
 * one along its longer side (a floor's x; a long slipway's z, so each step is
 * a section across its ways, not a sliver down its whole length).
 */
export function fillDir(def: StructureDef): 'x' | 'y' | 'z' {
  if (!fillsAcross(def)) return 'y';
  const { min, max } = pieceBounds(def);
  return max.z - min.z > (max.x - min.x) * 1.5 ? 'z' : 'x';
}

/** Share built so far (0..1). */
export function builtShare(s: StructureObj): number {
  const def = STRUCTURES[s.type];
  return Object.values(s.consumed).reduce((a, b) => a + b, 0) / Math.max(1, totalMaterials(def));
}

/** The direction a piece fills in, in the world. */
export function fillAxis(s: StructureObj, def: StructureDef): THREE.Vector3 {
  const d = fillDir(def);
  return d === 'x' ? new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw)) : d === 'z' ? new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw)) : new THREE.Vector3(0, 1, 0);
}

/**
 * Clipping planes splitting a piece at `share` of the way through it: `built`
 * keeps the part already done, `rest` the part still to do.
 */
export function fillPlanes(s: StructureObj, share: number): { built: THREE.Plane; rest: THREE.Plane } {
  const def = STRUCTURES[s.type];
  const { min, max } = pieceBounds(def);
  const d = fillDir(def);
  const axis = fillAxis(s, def);
  const lo = min[d], hi = max[d];
  const cut = axis.dot(new THREE.Vector3(s.x, s.y, s.z)) + lo + (hi - lo) * share;
  return { built: new THREE.Plane(axis.clone().negate(), cut), rest: new THREE.Plane(axis.clone(), -cut) };
}
