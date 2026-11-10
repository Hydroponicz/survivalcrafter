import * as THREE from 'three';
import { cylinderUV, surfaceMat, worldUV, type Surface } from './surfaces';
import { vesselModel } from './view';

// Pieces put together from real parts, step by step, rather than built up in
// courses like a wall: a campfire is a ring of stones laid two at a time, a
// nest of kindling in the middle and sticks leaned over it; a dugout is a pair
// of chocks, the great trunk rolled onto them, stakes to hold it, and then
// burnt and chopped hollow a bed of kindling at a time. Each step uses one of
// the piece's materials, in the order they're listed (see data/structures),
// so a piece has exactly as many steps as materials.
//
// Shared by the world (a piece half built shows the parts in place, and the
// rest as a blueprint) and the building work (you carry in the step's parts
// and set them where their ghost glows).

export interface AssemblyStep {
  /** What you do at this step, said in the work's instructions. */
  label: string;
  /** What you carry in and set down, at its final place in the piece's frame. */
  carry: () => THREE.Object3D;
  /** How the piece looks for this step once it's done (if not just what was carried in: kindling burns away and leaves the hollow). */
  result?: () => THREE.Object3D;
  /** Earlier steps whose parts this one takes the place of (the trunk, burnt deeper). */
  replaces?: number[];
}

const part = (geo: THREE.BufferGeometry, surface: Surface | null, color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
  let m: THREE.Material;
  if (surface) {
    if (geo instanceof THREE.CylinderGeometry) cylinderUV(geo, surface); else worldUV(geo, surface);
    m = surfaceMat(surface, color).clone();
  } else m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
};

/** A stick from a to b (piece frame). */
function stick(a: THREE.Vector3, b: THREE.Vector3, r: number, color = 0x8a6a48): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = part(new THREE.CylinderGeometry(r * 0.8, r, len, 6), 'rough_wood', color);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** A small repeatable random. */
const rnd = (i: number) => { const s = Math.sin(i * 91.7 + 13.1) * 43758.5453; return s - Math.floor(s); };

// ---------- the campfire: a ring of eight stones, a nest of kindling, a teepee of sticks
const RING = 0.47, STONES = 8;
function fireStone(k: number): THREE.Mesh {
  const s = 0.12 + rnd(k) * 0.04;
  const geo = new THREE.DodecahedronGeometry(s, 0).scale(1.25, 0.7, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.85 + rnd(k * 31 + i) * 0.3), p.getY(i), p.getZ(i) * (0.85 + rnd(k * 17 + i) * 0.3));
  geo.computeVertexNormals();
  const tone = 0x6f6a62 + Math.round(rnd(k + 5) * 3) * 0x080808;
  const m = part(geo, null, tone, { flatShading: true });
  const a = (k / STONES) * Math.PI * 2 + (rnd(k + 2) - 0.5) * 0.15;
  m.position.set(Math.cos(a) * RING, s * 0.5, Math.sin(a) * RING);
  m.rotation.y = -a + (rnd(k + 9) - 0.5) * 0.5;
  return m;
}
function stonePair(i: number): THREE.Object3D {
  const g = new THREE.Group();
  g.add(fireStone(i * 2), fireStone(i * 2 + 1));
  return g;
}
/** Tinder and fine kindling, a nest in the middle of the ring. */
function kindlingNest(): THREE.Object3D {
  const g = new THREE.Group();
  const grass = part(new THREE.ConeGeometry(0.13, 0.12, 9), null, 0xc9b07a, { flatShading: true });
  grass.position.y = 0.06;
  g.add(grass);
  for (let k = 0; k < 14; k++) {
    const a = rnd(k) * Math.PI * 2, r = 0.05 + rnd(k + 40) * 0.12, l = 0.18 + rnd(k + 80) * 0.12;
    const c = new THREE.Vector3(Math.cos(a) * r, 0.03 + rnd(k + 7) * 0.05, Math.sin(a) * r);
    const d = new THREE.Vector3(Math.cos(a + 1.6), (rnd(k + 3) - 0.5) * 0.4, Math.sin(a + 1.6)).normalize().multiplyScalar(l / 2);
    g.add(stick(c.clone().sub(d), c.clone().add(d), 0.008, 0xa08460));
  }
  return g;
}
/** Sticks leaned in over the nest, meeting at the top: half of the teepee (`half` 0 or 1). */
function teepee(half: number): THREE.Object3D {
  const g = new THREE.Group();
  const top = new THREE.Vector3(0, 0.72, 0);
  for (let k = 0; k < 4; k++) {
    const a = ((k * 2 + half) / 8) * Math.PI * 2 + 0.2;
    const foot = new THREE.Vector3(Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3);
    const tip = top.clone().add(new THREE.Vector3(-Math.cos(a) * 0.04, (rnd(k + half * 9) - 0.5) * 0.06, -Math.sin(a) * 0.04));
    g.add(stick(foot, tip, 0.024 - half * 0.004));
  }
  return g;
}

// ---------- the dugout: chocks, the trunk, stakes, then burnt and chopped hollow
const TRUNK_R = 0.44, TRUNK_L = 4.8, CHOCK_R = 0.11, TRUNK_Y = CHOCK_R * 1.3 + TRUNK_R;
function chocks(): THREE.Object3D {
  const g = new THREE.Group();
  for (const z of [-1.5, 1.5]) {
    const c = part(new THREE.CylinderGeometry(CHOCK_R, CHOCK_R, 1.3, 9).rotateZ(Math.PI / 2), 'rough_wood', 0x8a6a48);
    c.position.set(0, CHOCK_R * 0.8, z);
    g.add(c);
  }
  return g;
}
/** The great trunk on its chocks: round, or (once the work on it starts) hewn flat along the top with a charred hollow `depth` deep in it. */
/** How high the trunk's top is once it's been worked `depth` deep (round, before). */
const trunkTop = (depth: number) => TRUNK_Y + (depth <= 0 ? TRUNK_R : TRUNK_R - (0.07 + 0.08 * depth));

function trunk(depth: number): THREE.Object3D {
  const g = new THREE.Group();
  let log: THREE.Mesh, endShape: THREE.Shape | null = null;
  if (depth <= 0) {
    log = part(new THREE.CylinderGeometry(TRUNK_R, TRUNK_R * 1.04, TRUNK_L, 16).rotateX(Math.PI / 2), 'rough_wood', 0x7a5a3c);
  } else {
    // The round of the log with its top cut off flat (lower the deeper it's worked).
    const yc = TRUNK_R - (0.07 + 0.08 * depth), xc = Math.sqrt(TRUNK_R * TRUNK_R - yc * yc);
    const t0 = Math.atan2(yc, xc), sweep = Math.PI + 2 * t0, pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) { const a = t0 - sweep * (i / 24); pts.push(new THREE.Vector2(Math.cos(a) * TRUNK_R, Math.sin(a) * TRUNK_R)); }
    endShape = new THREE.Shape(pts);
    const geo = new THREE.ExtrudeGeometry(endShape, { depth: TRUNK_L, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -TRUNK_L / 2);
    log = part(geo, 'rough_wood', 0x7a5a3c);
    const top = trunkTop(depth);
    // Hewn pale wood across the top, and in it the hollow: charred black, widening as it's burnt deeper.
    const hewn = part(new THREE.BoxGeometry(xc * 1.96, 0.006, TRUNK_L * 0.985), null, 0xc49a68);
    hewn.position.y = top + 0.003;
    const w = xc * (0.6 + 0.9 * depth), len = 3.2 + depth * 1.0;
    const char = part(new THREE.BoxGeometry(w, 0.006, len), null, 0x1a120d);
    char.position.y = top + 0.006;
    const inner = part(new THREE.BoxGeometry(w * 0.6, 0.006, len * 0.92), null, 0x0b0806);
    inner.position.y = top + 0.008;
    g.add(hewn, char, inner);
  }
  log.position.y = TRUNK_Y;
  g.add(log);
  for (const z of [-TRUNK_L / 2, TRUNK_L / 2]) {
    // The end grain (cut off flat at the top too, once it's hewn).
    const end = part(endShape ? new THREE.ShapeGeometry(endShape).scale(0.98, 0.98, 1) : new THREE.CircleGeometry(TRUNK_R * 0.98, 16), null, 0xc8a070);
    end.position.set(0, TRUNK_Y, z + Math.sign(z) * 0.003);
    end.rotation.y = z > 0 ? 0 : Math.PI;
    g.add(end);
  }
  return g;
}
/** Split stakes driven either side, so the trunk can't roll as you work it. */
function stakes(): THREE.Object3D {
  const g = new THREE.Group();
  for (const z of [-1.5, 1.5]) for (const x of [-1, 1]) {
    const s = part(new THREE.BoxGeometry(0.07, 0.6, 0.09), 'rough_wood', 0x9a7a52);
    s.position.set(x * (TRUNK_R + 0.06), 0.28, z + 0.12);
    s.rotation.z = -x * 0.12;
    g.add(s);
  }
  return g;
}
/** A bed of kindling laid along the top, to burn the hollow deeper. */
function kindlingBed(depth: number): THREE.Object3D {
  const g = new THREE.Group();
  const y = trunkTop(depth) + 0.02;
  for (let k = 0; k < 9; k++) {
    const x = (rnd(k) - 0.5) * 0.25, z0 = -1.7 + rnd(k + 20) * 0.4, z1 = 1.7 - rnd(k + 40) * 0.4;
    g.add(stick(new THREE.Vector3(x, y + rnd(k + 60) * 0.04, z0), new THREE.Vector3(x + (rnd(k + 70) - 0.5) * 0.1, y + rnd(k + 80) * 0.04, z1), 0.016, 0xa08460));
  }
  return g;
}
/** The finished hull, on the chocks. */
function hull(): THREE.Object3D {
  const g = new THREE.Group();
  const m = vesselModel('dugout', false);
  m.position.y = CHOCK_R * 1.3;
  g.add(m);
  return g;
}

export const ASSEMBLIES: Record<string, AssemblyStep[]> = {
  // 4 small rocks, then 3 branches.
  campfire: [
    ...[0, 1, 2, 3].map((i) => ({ label: i ? 'Set the next two stones in the ring' : 'Set two stones: the start of a ring to hold the fire', carry: () => stonePair(i) })),
    { label: 'Break up a branch into kindling and lay it, with dry grass, in the middle of the ring', carry: kindlingNest },
    { label: 'Lean sticks in over the kindling', carry: () => teepee(0) },
    { label: 'Lean in the rest of the sticks: a teepee, ready to light', carry: () => teepee(1) },
  ],
  // 3 logs, then 4 kindling.
  dugout: [
    { label: 'Lay two chocks across, to rest the trunk on', carry: chocks },
    { label: 'Roll the great trunk onto the chocks', carry: () => trunk(0) },
    { label: 'Drive split stakes either side, so it can\'t roll', carry: stakes },
    ...[1, 2, 3].map((k) => ({
      label: k === 1 ? 'Lay kindling along the top and burn it, then chop out the charred wood' : 'Burn the hollow deeper, and chop out the char again',
      carry: () => kindlingBed((k - 1) / 3), result: () => trunk(k / 3), replaces: [k === 1 ? 1 : k + 1],
    })),
    { label: 'One last burn, and shape it out: the hull of your canoe', carry: () => kindlingBed(1), result: hull, replaces: [5] },
  ],
};

/** The piece as it stands after `done` steps: every part in place that hasn't been replaced since. */
export function assembled(type: string, done: number): THREE.Group {
  const steps = ASSEMBLIES[type], g = new THREE.Group();
  const gone = new Set<number>();
  for (let i = 0; i < done; i++) for (const r of steps[i].replaces ?? []) gone.add(r);
  for (let i = 0; i < done; i++) if (!gone.has(i)) g.add((steps[i].result ?? steps[i].carry)());
  return g;
}

/** What's still to come after `done` steps (as it'll finally stand), for the blueprint. */
export function toCome(type: string, done: number): THREE.Group {
  const steps = ASSEMBLIES[type], g = new THREE.Group();
  const gone = new Set<number>();
  for (let i = 0; i < steps.length; i++) for (const r of steps[i].replaces ?? []) gone.add(r);
  for (let i = done; i < steps.length; i++) if (!gone.has(i)) g.add((steps[i].result ?? steps[i].carry)());
  return g;
}
