// Bake the tree models (assets-src/models/<tree>.glb) into src/world/models/<tree>.ts:
// each tree's trunk and branches, simplified for the game, and where its
// foliage is, for the game's own leaves and needles.
// Run: node scripts/bake-trees.mjs [tree ...]   (all of them by default)
//
// The models come as one mesh each, leaves and all, so the wood is picked out
// first, one of two ways:
//  - 'crease': bark is a smooth surface while leaves meet their twigs at sharp
//    creases, so the wood is grown out from the foot of the trunk across
//    gentle edges only (works where leaves are joined onto the twigs);
//  - 'biggest': where the leaves are separate pieces, the wood is simply the
//    biggest piece.
// Everything else is foliage. For a broadleaf tree that's grouped into
// clumps (where the game grows its leafy sprays); for a conifer, it's the
// outline of the crown, how far the branches reach at each height (where the
// game grows its whorls of needled branches).

import { NodeIO } from '@gltf-transform/core';
import { weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { writeFileSync } from 'node:fs';

/** Height of a whole tree in model units (the game's trees are about 6 units tall, scaled per tree). */
const HEIGHT = 6.2;

const TREES = {
  birch: { wood: 'crease', crease: 45, trim: { r: 0.03, flat: 0.08, from: 0.4 }, trunkTris: 800, foliage: 'clumps', clumps: 9, crownFrom: 0.45 },
  oak: { wood: 'biggest', trim: { r: 0.03, flat: 0.08, from: 0.3 }, trunkTris: 1400, foliage: 'clumps', clumps: 14, crownFrom: 0.3 },
  maple: { wood: 'crease', crease: 45, trim: { r: 0.03, flat: 0.08, from: 0.35 }, trunkTris: 900, foliage: 'clumps', clumps: 12, crownFrom: 0.3 },
  spruce: { wood: 'crease', crease: 45, trunkTris: 300, foliage: 'profile' },
  pine: { wood: 'crease', crease: 45, trunkTris: 120, foliage: 'profile' },
};

await MeshoptSimplifier.ready;
const io = new NodeIO();
const only = process.argv.slice(2);
for (const [name, cfg] of Object.entries(TREES)) {
  if (only.length && !only.includes(name)) continue;
  await bake(name, cfg);
}

function trimBlades(P, I, wood, { r, flat, from }) {
  const nt = I.length / 3;
  let yLo = Infinity, yHi = -Infinity;
  for (let v = 1; v < P.length; v += 3) { yLo = Math.min(yLo, P[v]); yHi = Math.max(yHi, P[v]); }
  const R = r * (yHi - yLo), above = yLo + (yHi - yLo) * from;
  const C = new Float32Array(nt * 3), N = new Float32Array(nt * 3), A = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l; A[t] = l / 2;
    for (let k = 0; k < 3; k++) C[t * 3 + k] = (P[a + k] + P[b + k] + P[c + k]) / 3;
  }
  const ek = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
  const edges = new Map();
  for (let t = 0; t < nt; t++) if (wood[t]) for (let k = 0; k < 3; k++) {
    const e = ek(I[t * 3 + k], I[t * 3 + (k + 1) % 3]);
    let l = edges.get(e);
    if (!l) edges.set(e, (l = []));
    l.push(t);
  }
  const near = (t, each) => {
    const seen = new Set([t]);
    for (const q = [t]; q.length;) {
      const f = q.pop();
      each(f);
      for (let k = 0; k < 3; k++) for (const u of edges.get(ek(I[f * 3 + k], I[f * 3 + (k + 1) % 3]))) {
        if (seen.has(u) || Math.hypot(C[u * 3] - C[t * 3], C[u * 3 + 1] - C[t * 3 + 1], C[u * 3 + 2] - C[t * 3 + 2]) > R) continue;
        seen.add(u); q.push(u);
      }
    }
  };
  const blade = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    if (!wood[t] || C[t * 3 + 1] < above) continue;
    // The spread of normals: the eigenvalues of their (area-weighted) scatter.
    const M = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
    near(t, (f) => {
      const x = N[f * 3], y = N[f * 3 + 1], z = N[f * 3 + 2], w = A[f];
      M[0] += w * x * x; M[1] += w * x * y; M[2] += w * x * z; M[3] += w * y * y; M[4] += w * y * z; M[5] += w * z * z;
    });
    const tr = M[0] + M[3] + M[5] || 1;
    // Largest eigenvalue by power iteration; the rest is the spread off it.
    let v = [N[t * 3], N[t * 3 + 1], N[t * 3 + 2]], l1 = 0;
    for (let it = 0; it < 20; it++) {
      const m = [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[1] * v[0] + M[3] * v[1] + M[4] * v[2], M[2] * v[0] + M[4] * v[1] + M[5] * v[2]];
      l1 = Math.hypot(...m) || 1;
      v = m.map((x) => x / l1);
    }
    if ((tr - l1) / tr < flat) blade[t] = 1;
  }
  for (let t = 0; t < nt; t++) if (blade[t]) wood[t] = 0;
  // Keep what still joins the foot.
  let start = -1, low = Infinity;
  for (let t = 0; t < nt; t++) if (wood[t] && C[t * 3 + 1] < low) { low = C[t * 3 + 1]; start = t; }
  const keep = new Uint8Array(nt);
  keep[start] = 1;
  for (const q = [start]; q.length;) {
    const f = q.pop();
    for (let k = 0; k < 3; k++) for (const u of edges.get(ek(I[f * 3 + k], I[f * 3 + (k + 1) % 3]))) if (wood[u] && !keep[u]) { keep[u] = 1; q.push(u); }
  }
  let n0 = 0, n1 = 0;
  for (let t = 0; t < nt; t++) { n0 += wood[t]; wood[t] = keep[t]; n1 += keep[t]; }
  console.log(`  trimmed: ${blade.reduce((a, b) => a + b, 0)} flat faces, ${n0 - n1} cut off; ${n1} wood faces left`);
}

async function bake(name, cfg) {
  const SRC = `assets-src/models/${name}.glb`, OUT = `src/world/models/${name}.ts`;
  const doc = await io.read(SRC);
  await doc.transform(weld());
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray(), I = prim.getIndices().getArray();
  const nt = I.length / 3;

  // Which faces are wood.
  const wood = new Uint8Array(nt);
  if (cfg.wood === 'biggest') {
    const par = Int32Array.from({ length: P.length / 3 }, (_, i) => i);
    const f = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
    for (let t = 0; t < nt; t++) { const a = f(I[t * 3]), b = f(I[t * 3 + 1]), c = f(I[t * 3 + 2]); par[b] = a; par[f(c)] = a; }
    const count = new Map();
    for (let t = 0; t < nt; t++) { const r = f(I[t * 3]); count.set(r, (count.get(r) || 0) + 1); }
    const big = [...count].sort((a, b) => b[1] - a[1])[0][0];
    for (let t = 0; t < nt; t++) wood[t] = f(I[t * 3]) === big ? 1 : 0;
  } else {
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
    const cosMax = Math.cos((cfg.crease * Math.PI) / 180);
    wood[start] = 1;
    for (const q = [start]; q.length;) {
      const t = q.pop();
      for (let k = 0; k < 3; k++) for (const u of edges.get(ek(I[t * 3 + k], I[t * 3 + (k + 1) % 3]))) {
        if (wood[u] || N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2] < cosMax) continue;
        wood[u] = 1; q.push(u);
      }
    }
  }

  // Leaf blades still joined to the wood: flat sheets, where bark wraps round.
  // Near each face (within `trim.r` of the tree's height), how far its
  // neighbours' normals spread out of one direction; the flat ones go, and
  // then whatever no longer joins the trunk's foot.
  if (cfg.trim) trimBlades(P, I, wood, cfg.trim);

  // Foliage: each foliage face's centre, weighted by its area (only in the
  // crown: lower down, what isn't counted as wood is just rough bark).
  let yLo = Infinity, yHi = -Infinity;
  for (let v = 1; v < P.length; v += 3) { yLo = Math.min(yLo, P[v]); yHi = Math.max(yHi, P[v]); }
  const crownFrom = yLo + (yHi - yLo) * (cfg.crownFrom ?? 0.1);
  const pts = [];
  for (let t = 0; t < nt; t++) {
    if (wood[t] || P[I[t * 3] * 3 + 1] < crownFrom) continue;
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    pts.push([(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3, area]);
  }

  let clumps = [];
  if (cfg.foliage === 'clumps') {
    // Grouped into clumps (k-means, started from points spread far apart).
    const centres = [pts[0].slice(0, 3)];
    while (centres.length < cfg.clumps) {
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
    clumps = groups.filter((g) => g.length > 3).map((g) => {
      const c = centres[groups.indexOf(g)], w = g.reduce((s, p) => s + p[3], 0) || 1;
      const spread = [0, 1, 2].map((a) => Math.sqrt(g.reduce((s, p) => s + (p[a] - c[a]) ** 2 * p[3], 0) / w));
      return { c, r: spread.map((s) => Math.max(0.05, s * 1.9)) };
    });
  }

  // The wood alone, simplified.
  const woodIdx = [];
  for (let t = 0; t < nt; t++) if (wood[t]) woodIdx.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(woodIdx)).setBuffer(doc.getRoot().listBuffers()[0]));
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, cfg.trunkTris / (woodIdx.length / 3)), error: 0.02 }));
  const WP = prim.getAttribute('POSITION').getArray(), WI = prim.getIndices().getArray();

  // Into the game's frame: the foot of the trunk at the origin, the whole tree HEIGHT tall.
  let minY = Infinity, maxY = -Infinity;
  for (let v = 1; v < WP.length; v += 3) { minY = Math.min(minY, WP[v]); maxY = Math.max(maxY, WP[v]); }
  for (const k of clumps) maxY = Math.max(maxY, k.c[1] + k.r[1]);
  if (cfg.foliage === 'profile') for (const p of pts) maxY = Math.max(maxY, p[1]);
  const scale = HEIGHT / (maxY - minY);
  // Where the wood's surface crosses a height (model units, from the foot):
  // the points where its triangles' edges pass through it.
  const crossAt = (h) => {
    const y = minY + h / scale, out = [];
    for (let t = 0; t < WI.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = WI[t + k] * 3, b = WI[t + (k + 1) % 3] * 3;
      const ya = WP[a + 1], yb = WP[b + 1];
      if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
      const f = (y - ya) / (yb - ya);
      out.push([WP[a] + (WP[b] - WP[a]) * f, WP[a + 2] + (WP[b + 2] - WP[a + 2]) * f]);
    }
    return out;
  };
  // The trunk's axis: the middle of the wood just above the root flare.
  const foot = crossAt(0.6);
  const ax = foot.reduce((s, p) => s + p[0], 0) / foot.length, az = foot.reduce((s, p) => s + p[1], 0) / foot.length;
  const pos = [];
  for (let v = 0; v < WP.length; v += 3) pos.push((WP[v] - ax) * scale, (WP[v + 1] - minY) * scale, (WP[v + 2] - az) * scale);
  const leaf = clumps.map((k) => [(k.c[0] - ax) * scale, (k.c[1] - minY) * scale, (k.c[2] - az) * scale, ...k.r.map((r) => r * scale)]);

  // A conifer's crown outline: how far its foliage reaches out at each height.
  let profile = [];
  if (cfg.foliage === 'profile') {
    const step = 0.3;
    for (let y = 0; y < HEIGHT; y += step) {
      const ds = pts.filter((p) => { const py = (p[1] - minY) * scale; return py >= y && py < y + step; })
        .map((p) => Math.hypot((p[0] - ax) * scale, (p[2] - az) * scale)).sort((a, b) => a - b);
      if (ds.length < 3) continue;
      profile.push([+(y + step / 2).toFixed(2), +ds[Math.floor(ds.length * 0.9)].toFixed(2)]);
    }
  }

  // The trunk's size, for chopping and bumping into it: its radius near the
  // foot (above the flare) and where it forks, and the height of the fork.
  const radiusAt = (y) => {
    // Only the trunk's own surface, not branches reaching out at that height.
    const ds = crossAt(y).map((p) => Math.hypot((p[0] - ax) * scale, (p[1] - az) * scale)).sort((a, b) => a - b);
    const near = ds.filter((d) => d < ds[0] * 3 + 0.05);
    return near.length ? near[Math.floor(near.length * 0.6)] : 0;
  };
  const band = (y0, y1) => { const out = []; for (let v = 0; v < pos.length; v += 3) if (pos[v + 1] >= y0 && pos[v + 1] < y1) out.push(v); return out; };
  const r0 = radiusAt(0.6);
  let forkY = cfg.foliage === 'profile' ? HEIGHT * 0.6 : 1;
  if (cfg.foliage !== 'profile') {
    for (let y = 1; y < HEIGHT; y += 0.1) {
      // Where wood at this height reaches well out beyond the trunk, it has forked.
      // (A real fork: a good share of the wood out there, not a stray twig.)
      const cs = crossAt(y), out = cs.filter((p) => Math.hypot((p[0] - ax) * scale, (p[1] - az) * scale) > r0 * 2.5);
      const far = out.length >= Math.max(4, cs.length * 0.3);
      if (far) { forkY = y; break; }
    }
  }
  const r1 = Math.min(r0 * 0.9, Math.max(r0 * 0.5, radiusAt(forkY * 0.8)));
  const dims = { r0: +r0.toFixed(3), r1: +r1.toFixed(3), h: +forkY.toFixed(2) };

  const round = (a, d) => a.map((v) => +v.toFixed(d));
  const NAME = name.toUpperCase();
  writeFileSync(OUT, `// Made by scripts/bake-trees.mjs from assets-src/models/${name}.glb: do not edit by hand.

/**
 * The ${name}'s trunk and branches (model units, foot at the origin); its
 * leaf clumps (centre x, y, z, radii x, y, z, biggest first) or, for a
 * conifer, its crown outline (height, how far the branches reach); and the
 * trunk's size (for chopping).
 */
export const ${NAME} = {
  positions: [${round(pos, 3).join(',')}],
  indices: [${Array.from(WI).join(',')}],
  clumps: [${leaf.sort((a, b) => b[3] * b[4] * b[5] - a[3] * a[4] * a[5]).map((c) => `[${round(c, 3).join(',')}]`).join(', ')}] as number[][],
  profile: [${profile.map((p) => `[${p.join(',')}]`).join(', ')}] as number[][],
  trunk: ${JSON.stringify(dims)},
};
`);
  console.log(`${OUT}: ${WI.length / 3} trunk triangles, ${leaf.length} leaf clumps, ${profile.length} outline steps, trunk`, dims, 'scale', scale.toFixed(3));
}
