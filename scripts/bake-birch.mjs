// Bake the birch model (assets-src/models/birch.glb) into src/world/models/birch.ts:
// its trunk and branches, simplified for the game, and where its leaves are,
// as clumps for the game's own low-poly leaves. Run: node scripts/bake-birch.mjs
//
// The model is one mesh with its leaves joined onto the twigs. Bark is a
// smooth surface, while leaves meet their twigs at sharp creases, so the wood
// is found by growing out from the foot of the trunk across gentle edges
// only; everything else is leaf.

import { NodeIO } from '@gltf-transform/core';
import { weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { writeFileSync } from 'node:fs';

const SRC = 'assets-src/models/birch.glb', OUT = 'src/world/models/birch.ts';
/** Steepest crease (degrees) still counted as the same piece of bark. */
const CREASE = 45;
/** Triangles to keep in the trunk and branches. */
const TRUNK_TRIS = 800;
/** How many leaf clumps. */
const CLUMPS = 9;
/** Height of the whole tree in model units (the game's trees are about 6 units tall, scaled per tree). */
const HEIGHT = 6.2;

await MeshoptSimplifier.ready;
const io = new NodeIO();
const doc = await io.read(SRC);
await doc.transform(weld());
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray(), I = prim.getIndices().getArray();
const nt = I.length / 3;

// Face normals, and which faces share each edge.
const N = new Float32Array(nt * 3);
for (let t = 0; t < nt; t++) {
  const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
  N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
}
const ek = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
const edges = new Map();
for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
  const e = ek(I[t * 3 + k], I[t * 3 + (k + 1) % 3]);
  let l = edges.get(e);
  if (!l) edges.set(e, (l = []));
  l.push(t);
}
// Grow the wood from the lowest face.
let start = 0, low = Infinity;
for (let t = 0; t < nt; t++) { const y = P[I[t * 3] * 3 + 1]; if (y < low) { low = y; start = t; } }
const cosMax = Math.cos((CREASE * Math.PI) / 180);
const wood = new Uint8Array(nt);
wood[start] = 1;
for (const q = [start]; q.length;) {
  const t = q.pop();
  for (let k = 0; k < 3; k++) for (const u of edges.get(ek(I[t * 3 + k], I[t * 3 + (k + 1) % 3]))) {
    if (wood[u] || N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2] < cosMax) continue;
    wood[u] = 1; q.push(u);
  }
}

// Leaves: each leaf face's centre, weighted by its area (only in the
// crown: lower down, what isn't counted as bark is just its rough patches).
let yLo = Infinity, yHi = -Infinity;
for (let v = 1; v < P.length; v += 3) { yLo = Math.min(yLo, P[v]); yHi = Math.max(yHi, P[v]); }
const crownFrom = yLo + (yHi - yLo) * 0.45;
const pts = [];
for (let t = 0; t < nt; t++) {
  if (wood[t] || P[I[t * 3] * 3 + 1] < crownFrom) continue;
  const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  pts.push([(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3, area]);
}
// Grouped into clumps (k-means, started from points spread far apart).
const centres = [pts[0].slice(0, 3)];
while (centres.length < CLUMPS) {
  let best = null, bd = -1;
  for (const p of pts) {
    const d = Math.min(...centres.map((c) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    if (d > bd) { bd = d; best = p; }
  }
  centres.push(best.slice(0, 3));
}
let groups = [];
for (let it = 0; it < 30; it++) {
  groups = centres.map(() => []);
  for (const p of pts) {
    let bi = 0, bd = Infinity;
    centres.forEach((c, i) => { const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]); if (d < bd) { bd = d; bi = i; } });
    groups[bi].push(p);
  }
  groups.forEach((g, i) => {
    if (!g.length) return;
    const w = g.reduce((s, p) => s + p[3], 0) || 1;
    centres[i] = [0, 1, 2].map((a) => g.reduce((s, p) => s + p[a] * p[3], 0) / w);
  });
}
// Each clump's size: how far its leaves spread along each axis.
const clumps = groups.filter((g) => g.length > 3).map((g, i) => {
  const c = centres[groups.indexOf(g)], w = g.reduce((s, p) => s + p[3], 0) || 1;
  const spread = [0, 1, 2].map((a) => Math.sqrt(g.reduce((s, p) => s + (p[a] - c[a]) ** 2 * p[3], 0) / w));
  return { c, r: spread.map((s) => Math.max(0.05, s * 1.9)), weight: w };
});

// The wood alone, simplified.
const woodIdx = [];
for (let t = 0; t < nt; t++) if (wood[t]) woodIdx.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(woodIdx)).setBuffer(doc.getRoot().listBuffers()[0]));
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: TRUNK_TRIS / (woodIdx.length / 3), error: 0.02 }));
const WP = prim.getAttribute('POSITION').getArray(), WI = prim.getIndices().getArray();

// Into the game's frame: the foot of the trunk at the origin, the whole tree HEIGHT tall.
let minY = Infinity, maxY = -Infinity;
for (let v = 1; v < WP.length; v += 3) minY = Math.min(minY, WP[v]);
for (let v = 1; v < WP.length; v += 3) maxY = Math.max(maxY, WP[v]);
for (const k of clumps) maxY = Math.max(maxY, k.c[1] + k.r[1]);
const scale = HEIGHT / (maxY - minY);
// The trunk's axis: the middle of the wood just above the root flare.
const band = (y0, y1) => { const out = []; for (let v = 0; v < WP.length; v += 3) { const y = (WP[v + 1] - minY) * scale; if (y >= y0 && y < y1) out.push(v); } return out; };
const foot = band(0.4, 0.8);
const ax = foot.reduce((s, v) => s + WP[v], 0) / foot.length, az = foot.reduce((s, v) => s + WP[v + 2], 0) / foot.length;
const pos = [];
for (let v = 0; v < WP.length; v += 3) pos.push((WP[v] - ax) * scale, (WP[v + 1] - minY) * scale, (WP[v + 2] - az) * scale);
const leaf = clumps.map((k) => [(k.c[0] - ax) * scale, (k.c[1] - minY) * scale, (k.c[2] - az) * scale, ...k.r.map((r) => r * scale)]);

// The trunk's size, for chopping and bumping into it: its radius near the
// foot (above the flare) and where it forks, and the height of the fork.
const radiusAt = (y) => {
  const vs = band(y - 0.15, y + 0.15).map((v) => Math.hypot(pos[v], pos[v + 2])).sort((a, b) => a - b);
  return vs.length ? vs[Math.floor(vs.length * 0.6)] : 0;
};
const r0 = radiusAt(0.6);
let forkY = 1;
for (let y = 1; y < HEIGHT; y += 0.1) {
  // Where wood at this height reaches well out beyond the trunk, it has forked.
  const far = band(y - 0.05, y + 0.05).some((v) => Math.hypot(pos[v], pos[v + 2]) > r0 * 2.5);
  if (far) { forkY = y; break; }
}
const r1 = Math.min(r0 * 0.9, Math.max(r0 * 0.5, radiusAt(forkY * 0.8)));
const dims = { r0: +r0.toFixed(3), r1: +r1.toFixed(3), h: +forkY.toFixed(2) };

const round = (a, d) => a.map((v) => +v.toFixed(d));
writeFileSync(OUT, `// Made by scripts/bake-birch.mjs from assets-src/models/birch.glb: do not edit by hand.

/** The birch's trunk and branches (model units, foot at the origin), and its leaf clumps (centre x, y, z, radii x, y, z), biggest first. */
export const BIRCH = {
  positions: [${round(pos, 3).join(',')}],
  indices: [${Array.from(WI).join(',')}],
  clumps: [${leaf.sort((a, b) => b[3] * b[4] * b[5] - a[3] * a[4] * a[5]).map((c) => `[${round(c, 3).join(',')}]`).join(', ')}],
  trunk: ${JSON.stringify(dims)},
};
`);
console.log(`${OUT}: ${WI.length / 3} trunk triangles, ${leaf.length} leaf clumps, trunk`, dims, 'scale', scale.toFixed(3));
