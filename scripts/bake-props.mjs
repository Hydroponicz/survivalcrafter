// Bake hand tools and other props (assets-src/models/<name>.glb) into
// src/game/models/<name>.ts for the game: simplified, turned to face the
// game's way, scaled to real size, and coloured part by part (the models come
// untextured). Run: node scripts/bake-props.mjs [name ...]   (all by default)
//
// A tool is turned so its handle runs up +Y from the grip (at the origin) to
// the working end, with the head facing +Z, as the game holds tools. Its long
// axis is found from the shape itself; the working end is the heavier one
// (the head's bulk), and the way the head juts out is its front. Colours go by
// where a point lies along the tool (0 at the grip end, 1 at the working
// end) and how far out from the handle it is.
//
// A prop (a station, furniture) keeps the model's up, sits on the ground at
// the origin, and is scaled to its real size.

import { NodeIO } from '@gltf-transform/core';
import { weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdirSync, writeFileSync } from 'node:fs';

// Colours as you'd pick them (sRGB), turned to the linear light the game's materials work in.
const C = Object.fromEntries(Object.entries({ steel: [0.55, 0.56, 0.58], wood: [0.48, 0.34, 0.2], darkwood: [0.36, 0.25, 0.15], stone: [0.56, 0.54, 0.5], flint: [0.36, 0.36, 0.38], cord: [0.79, 0.69, 0.48], leather: [0.37, 0.27, 0.19], iron: [0.26, 0.26, 0.28], ash: [0.2, 0.18, 0.17] }).map(([k, c]) => [k, c.map((v) => v ** 2.2)]));;

/**
 * Each tool: its length (metres), triangles, where the hand grips (share of
 * the length from the grip end), which way its working end points in the
 * model (or `pointy`: the sharp end), and its colours: rules tried in order,
 * [from, to] along the tool, optionally only beyond a distance out from the
 * handle (share of the length), and the colour.
 */
const TOOLS = {
  stone_knife: { length: 0.3, tris: 700, grip: 0.18, working: [0, -1, 0], rules: [[0.45, 0.52, 0, 'cord'], [0.52, 1, 0, 'flint'], [0, 1, 0, 'leather']] },
  stone_hatchet: { length: 0.62, tris: 700, grip: 0.1, working: [0, 1, 0], rules: [[0.72, 1, 0.06, 'stone'], [0.72, 1, 0, 'cord'], [0, 1, 0, 'wood']] },
  stone_pickaxe: { length: 0.68, tris: 700, grip: 0.1, working: [-1, 1, 0], rules: [[0.7, 1, 0.07, 'stone'], [0.7, 1, 0, 'cord'], [0, 0.12, 0, 'cord'], [0, 1, 0, 'wood']] },
  stone_hammer: { length: 0.42, tris: 600, grip: 0.12, working: [-1, 0, 0], rules: [[0.72, 1, 0, 'stone'], [0, 1, 0, 'wood']] },
  // Held near the top, the blade hanging down (as the game holds a shovel).
  wooden_shovel: { length: 0.95, tris: 500, grip: 0.08, down: true, working: [-1, 0, 0], rules: [[0, 1, 0, 'wood']] },
  // Its butt is bulkier than its point: the working end is the sharp one.
  stone_spear: { length: 1.25, tris: 500, grip: 0.4, pointy: true, rules: [[0.88, 1, 0, 'flint'], [0.82, 0.88, 0, 'cord'], [0, 1, 0, 'wood']] },
  wooden_tongs: { length: 0.5, tris: 500, grip: 0.12, rules: [[0, 1, 0, 'darkwood']] },
};

/**
 * Each prop: its width across (metres), triangles, and its colours: rules
 * tried in order, [from, to] up its height (0 ground, 1 top), [from, to] out
 * from its middle (share of half its width), and the colour.
 */
const PROPS = {
  campfire: { width: 1.2, tris: 1400, rules: [[0, 0.32, 0.55, 9, 'stone'], [0.7, 1, 0, 9, 'ash'], [0, 1, 0, 9, 'darkwood']] },
  iron_anvil: { width: 0.8, tris: 900, rules: [[0.88, 1, 0, 9, 'steel'], [0, 1, 0, 9, 'iron']] },
  wood_bucket: { width: 0.62, tris: 1400, rules: [[0.68, 1, 0, 9, 'iron'], [0.1, 0.24, 0.93, 9, 'iron'], [0.52, 0.64, 0.93, 9, 'iron'], [0, 1, 0, 9, 'wood']] },
};

const io = new NodeIO();

async function load(name, tris) {
  const doc = await io.read(`assets-src/models/${name}.glb`);
  await doc.transform(weld());
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const n = prim.getIndices().getCount() / 3;
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, tris / n), error: 0.03 }));
  return { P: Array.from(prim.getAttribute('POSITION').getArray()), I: Array.from(prim.getIndices().getArray()) };
}

/** The main axis of a cloud of points (power iteration on its spread). */
function mainAxis(P, centre) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let v = 0; v < P.length; v += 3) {
    const d = [P[v] - centre[0], P[v + 1] - centre[1], P[v + 2] - centre[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += d[i] * d[j];
  }
  let a = [1, 0.7, 0.3];
  for (let it = 0; it < 60; it++) {
    const b = [0, 1, 2].map((i) => M[i][0] * a[0] + M[i][1] * a[1] + M[i][2] * a[2]);
    const l = Math.hypot(...b);
    a = b.map((x) => x / l);
  }
  return a;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };

async function bakeTool(name, cfg) {
  const { P, I } = await load(name, cfg.tris);
  const nv = P.length / 3;
  const centre = [0, 1, 2].map((k) => { let s = 0; for (let v = 0; v < nv; v++) s += P[v * 3 + k]; return s / nv; });
  let axis = mainAxis(P, centre);
  // Along the axis, and out from it.
  const along = (v) => (P[v * 3] - centre[0]) * axis[0] + (P[v * 3 + 1] - centre[1]) * axis[1] + (P[v * 3 + 2] - centre[2]) * axis[2];
  let lo = Infinity, hi = -Infinity;
  for (let v = 0; v < nv; v++) { const s = along(v); lo = Math.min(lo, s); hi = Math.max(hi, s); }
  const out = (v) => {
    const s = along(v);
    return [P[v * 3] - centre[0] - axis[0] * s, P[v * 3 + 1] - centre[1] - axis[1] * s, P[v * 3 + 2] - centre[2] - axis[2] * s];
  };
  // The working end is the bulkier one: more of the shape far out from the axis.
  const bulk = (end) => {
    let sum = 0;
    for (let v = 0; v < nv; v++) { const t = (along(v) - lo) / (hi - lo); if (end ? t > 0.75 : t < 0.25) sum += Math.hypot(...out(v)); }
    return sum;
  };
  // Which end works: as given (a direction in the model), the sharp end of a
  // pointed tool, or else the bulkier end (a head).
  const flip = cfg.working ? dot(axis, cfg.working) < 0 : cfg.pointy ? bulk(true) > bulk(false) : bulk(false) > bulk(true);
  if (flip) { axis = axis.map((x) => -x); [lo, hi] = [-hi, -lo]; }
  // Its front: the way the head is longest across the handle (a hatchet's
  // blade, a pick's spike, a hammer's head), toward its bigger side.
  const headPts = [];
  for (let v = 0; v < nv; v++) if ((along(v) - lo) / (hi - lo) >= 0.7) headPts.push(...out(v));
  let front = mainAxis(headPts, [0, 0, 0]);
  front = norm(cross(cross(axis, front), axis).map((x) => -x));
  if (!isFinite(front[0])) front = norm(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  let lean = 0;
  for (let k = 0; k < headPts.length; k += 3) { const d = dot(headPts.slice(k, k + 3), front); lean += d * Math.abs(d); }
  if (lean < 0 !== !!cfg.backward) front = front.map((x) => -x);
  const side = cross(axis, front);
  const len = hi - lo, k = cfg.length / len;
  const grip = lo + len * cfg.grip;
  const pos = [], col = [];
  for (let v = 0; v < nv; v++) {
    const s = along(v), o = out(v);
    // Game frame: x = side, y = along (from the grip), z = front.
    // (A tool held with its working end down is turned over, end for end.)
    const flipY = cfg.down ? -1 : 1;
    pos.push(dot(o, side) * k * flipY, (s - grip) * k * flipY, dot(o, front) * k);
    const t = (s - lo) / len, r = Math.hypot(...o) / len;
    const rule = cfg.rules.find(([a, b, rmin]) => t >= a && t <= b && r >= rmin);
    col.push(...C[rule ? rule[3] : 'wood']);
  }
  write(name, pos, I, col, `A ${name.replace(/_/g, ' ')}, held at the origin, handle up +Y, working end facing +Z (metres).`);
}

async function bakeProp(name, cfg) {
  const { P, I } = await load(name, cfg.tris);
  const nv = P.length / 3;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[v * 3 + k]); max[k] = Math.max(max[k], P[v * 3 + k]); }
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2, h = max[1] - min[1];
  const half = Math.max(max[0] - min[0], max[2] - min[2]) / 2, k = cfg.width / (half * 2);
  const pos = [], col = [];
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3] - cx, y = P[v * 3 + 1] - min[1], z = P[v * 3 + 2] - cz;
    pos.push(x * k, y * k, z * k);
    const t = y / h, r = Math.hypot(x, z) / half;
    const rule = cfg.rules.find(([a, b, r0, r1]) => t >= a && t <= b && r >= r0 && r <= r1);
    col.push(...C[rule ? rule[4] : 'wood']);
  }
  write(name, pos, I, col, `A ${name.replace(/_/g, ' ')}, standing on the ground at the origin (metres).`, 'world');
}

function write(name, pos, I, col, doc, where = 'game') {
  const round = (a, d) => a.map((v) => +v.toFixed(d));
  const NAME = name.toUpperCase();
  writeFileSync(`src/${where}/models/${name}.ts`, `// Made by scripts/bake-props.mjs from assets-src/models/${name}.glb: do not edit by hand.

/** ${doc} */
export const ${NAME} = {
  positions: [${round(pos, 4).join(',')}],
  indices: [${I.join(',')}],
  colors: [${round(col, 2).join(',')}],
};
`);
  console.log(`${name}: ${I.length / 3} triangles`);
}

await MeshoptSimplifier.ready;
const only = process.argv.slice(2);
mkdirSync('src/game/models', { recursive: true });
for (const [name, cfg] of Object.entries(TOOLS)) if (!only.length || only.includes(name)) await bakeTool(name, cfg);
for (const [name, cfg] of Object.entries(PROPS)) if (!only.length || only.includes(name)) await bakeProp(name, cfg);
