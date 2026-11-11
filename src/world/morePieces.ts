import * as THREE from 'three';
import type { Surface } from './surfaces';
import { STRUCTURES } from '../data/structures';

// Models of the newer building pieces (data/structures: more ways to build,
// decor, and the waterside pieces), in the same photographed surfaces as the
// rest: planks, rough wood, thatch, stone. Origin at the bottom centre, front
// toward +z.

type Tex = (geo: THREE.BufferGeometry, surface: Surface, x?: number, y?: number, z?: number, opts?: { turn?: boolean; tint?: number; parent?: THREE.Object3D }) => THREE.Mesh;
type Add = (geo: THREE.BufferGeometry, color: number, x?: number, y?: number, z?: number, extra?: THREE.MeshStandardMaterialParameters, parent?: THREE.Object3D) => THREE.Mesh;

const IRON = 0x2e2c2a, BEAM = 0x3a2a1c, PLASTER = 0xe6dcc6, DAUB = 0xc9b48e, ROPE = 0x8a7a5a, WATER = 0x3f6f8a;
const iron = { metalness: 0.6, roughness: 0.5 };
/** A small hash for placing stones and flowers the same way every time. */
const rnd = (i: number) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

/** Build a newer piece's model into its group; false if it isn't one of them. */
export function morePieceMesh(type: string, g: THREE.Group, tex: Tex, add: Add, state: { lit?: boolean; open?: boolean }): boolean {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  /** A round rod between two points. */
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, surface: Surface = 'rough_wood', parent?: THREE.Object3D) => {
    const m = tex(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 7), surface, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, { parent });
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  /** A coloured rod (iron, rope) between two points. */
  const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: number, extra?: THREE.MeshStandardMaterialParameters) => {
    const m = add(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6), color, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, extra);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  /** Each of the piece's own boxes, solid in a surface (for blocky masonry). */
  const solid = (surface: Surface, tint?: number) => {
    for (const b of STRUCTURES[type].boxes) tex(new THREE.BoxGeometry(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2), surface, b.c[0], b.c[1], b.c[2], { tint });
  };
  /** A fire burning at a height (flickered by the view while it's lit). */
  const flame = (y: number, r: number, h: number) => {
    if (!state.lit) return;
    const f = add(new THREE.ConeGeometry(r, h, 7), 0xffa030, 0, y + h / 2, 0, { emissive: 0xff6a00, emissiveIntensity: 2.5, transparent: true, opacity: 0.85 });
    f.castShadow = false;
    f.userData.flame = true;
  };
  /** A 45° roof slab rising toward +z, covered in courses of shingles or slates. */
  const coursedRoof = (surface: Surface, tint: number, courses: number) => {
    const len = Math.SQRT2 * 2;
    const deck = tex(new THREE.BoxGeometry(2, 0.08, len), 'dark_planks', 0, 1, 0);
    deck.rotation.x = -Math.PI / 4;
    for (let k = 0; k < courses; k++) {
      const t = (k + 0.5) / courses, c = tex(new THREE.BoxGeometry(2.1, 0.05, len / courses + 0.08), surface, (k % 2) * 0.04 - 0.02, 2 * t + 0.07, -1 + 2 * t - 0.07, { tint, turn: true });
      c.rotation.x = -Math.PI / 4 - 0.06;
    }
  };

  switch (type) {
    // ---------- floors
    case 'stone_floor': {
      tex(new THREE.BoxGeometry(2, 0.18, 2), 'stone', 0, 0.09, 0, { tint: 0xb8b2a8 });
      // Flags of different sizes: their joints.
      for (const x of [-0.35, 0.4]) add(new THREE.BoxGeometry(0.025, 0.01, 2), 0x4a4640, x, 0.185, 0, { roughness: 1 });
      for (const [x0, x1, z] of [[-1, -0.35, -0.3], [-0.35, 0.4, 0.45], [0.4, 1, -0.55], [-1, -0.35, 0.6], [0.4, 1, 0.3]]) {
        add(new THREE.BoxGeometry(x1 - x0, 0.01, 0.025), 0x4a4640, (x0 + x1) / 2, 0.185, z, { roughness: 1 });
      }
      tex(new THREE.BoxGeometry(2, 0.02, 2), 'stone', 0, 0.19, 0, { tint: 0xd0cac0 });
      return true;
    }
    case 'timber_platform': {
      tex(new THREE.BoxGeometry(2, 0.2, 2), 'dark_planks', 0, 0.9, 0, { turn: true });
      for (const x of [-0.85, 0.85]) for (const z of [-0.85, 0.85]) tex(new THREE.BoxGeometry(0.2, 0.8, 0.2), 'rough_wood', x, 0.4, z);
      for (const x of [-0.85, 0.85]) { const b = tex(new THREE.BoxGeometry(0.06, 0.1, 2.1), 'rough_wood', x, 0.45, 0); b.rotation.x = 0.36; }
      return true;
    }

    // ---------- walls
    case 'wattle_wall': {
      add(new THREE.BoxGeometry(1.8, 1.86, 0.14), DAUB, 0, 1, 0, { roughness: 1 });
      // Where the daub has fallen away near the foot: the woven wattle under it.
      for (let k = 0; k < 4; k++) tex(new THREE.CylinderGeometry(0.018, 0.018, 1.8, 5).rotateZ(Math.PI / 2), 'rough_wood', 0, 0.12 + k * 0.06, (k % 2 ? 1 : -1) * 0.075);
      for (const x of [-0.95, 0.95]) tex(new THREE.BoxGeometry(0.12, 2, 0.18), 'rough_wood', x, 1, 0);
      for (const y of [0.05, 1.95]) tex(new THREE.BoxGeometry(1.9, 0.1, 0.18), 'rough_wood', 0, y, 0, { turn: true });
      return true;
    }
    case 'timber_frame_wall': {
      add(new THREE.BoxGeometry(1.96, 1.96, 0.2), PLASTER, 0, 1, 0, { roughness: 1 });
      const beam = (w: number, h: number, x: number, y: number, rz = 0) => { const b = add(new THREE.BoxGeometry(w, h, 0.24), BEAM, x, y, 0, { roughness: 0.9 }); b.rotation.z = rz; };
      for (const x of [-0.93, 0.93]) beam(0.14, 2, x, 1);
      beam(2, 0.14, 0, 0.07); beam(2, 0.14, 0, 1.93); beam(2, 0.1, 0, 1.0);
      beam(0.1, 0.9, 0, 1.45);
      // Braces from the corners up into the middle rail.
      beam(0.1, 1.25, -0.48, 0.52, -0.9); beam(0.1, 1.25, 0.48, 0.52, 0.9);
      return true;
    }
    case 'half_wall':
      tex(new THREE.BoxGeometry(1.9, 0.9, 0.12), 'dark_planks', 0, 0.48, 0);
      for (const x of [-0.95, 0.95]) tex(new THREE.BoxGeometry(0.1, 1, 0.18), 'rough_wood', x, 0.5, 0);
      tex(new THREE.BoxGeometry(2, 0.08, 0.22), 'rough_wood', 0, 0.96, 0, { turn: true });
      return true;
    case 'stone_half_wall':
      tex(new THREE.BoxGeometry(2, 0.9, 0.4), 'stone_wall', 0, 0.45, 0);
      tex(new THREE.BoxGeometry(2.04, 0.1, 0.46), 'stone', 0, 0.95, 0, { tint: 0xd8d4cc });
      return true;
    case 'stone_window_wall': {
      for (const [w, h, x, y] of [[2, 0.9, 0, 0.45], [2, 0.4, 0, 1.8], [0.55, 0.7, -0.725, 1.25], [0.55, 0.7, 0.725, 1.25]]) tex(new THREE.BoxGeometry(w, h, 0.4), 'stone_wall', x, y, 0);
      tex(new THREE.BoxGeometry(1.2, 0.1, 0.44), 'rough_wood', 0, 1.65, 0, { turn: true });
      tex(new THREE.BoxGeometry(1.0, 0.06, 0.48), 'stone', 0, 0.93, 0, { tint: 0xd8d4cc });
      tex(new THREE.BoxGeometry(0.05, 0.62, 0.06), 'rough_wood', 0, 1.25, 0);
      tex(new THREE.BoxGeometry(0.9, 0.05, 0.06), 'rough_wood', 0, 1.25, 0, { turn: true });
      tex(new THREE.BoxGeometry(2.04, 0.1, 0.44), 'stone', 0, 1.95, 0, { tint: 0xd8d4cc });
      return true;
    }
    case 'palisade': {
      // Logs set upright and sharpened, with a rail behind to hold them.
      for (let i = 0; i < 8; i++) {
        const x = -0.875 + i * 0.25, h = 2.7 + rnd(i) * 0.2;
        tex(new THREE.CylinderGeometry(0.125, 0.135, h, 9), 'rough_wood', x, h / 2, 0);
        tex(new THREE.ConeGeometry(0.125, 0.35, 9), 'rough_wood', x, h + 0.17, 0);
      }
      for (const y of [0.6, 2.1]) tex(new THREE.BoxGeometry(2, 0.12, 0.08), 'rough_wood', 0, y, -0.17, { turn: true });
      return true;
    }
    case 'stone_pillar':
      tex(new THREE.BoxGeometry(0.5, 0.14, 0.5), 'stone', 0, 0.07, 0, { tint: 0xd0ccc4 });
      tex(new THREE.BoxGeometry(0.4, 1.72, 0.4), 'stone_wall', 0, 1, 0);
      tex(new THREE.BoxGeometry(0.5, 0.14, 0.5), 'stone', 0, 1.93, 0, { tint: 0xd0ccc4 });
      return true;
    case 'stone_arch': {
      for (const x of [-0.85, 0.85]) tex(new THREE.BoxGeometry(0.3, 2, 0.4), 'stone_wall', x, 1, 0);
      // The arch: a round head springing from the piers, the spandrels filled up to the top.
      const sh = new THREE.Shape([V(-0.7, 1.2, 0), V(-0.7, 2, 0), V(0.7, 2, 0), V(0.7, 1.2, 0)].map((v) => new THREE.Vector2(v.x, v.y)));
      sh.absarc(0, 1.2, 0.7, 0, Math.PI, false);
      tex(new THREE.ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -0.2), 'stone_wall', 0, 0, 0);
      tex(new THREE.BoxGeometry(2.04, 0.1, 0.44), 'stone', 0, 1.95, 0, { tint: 0xd8d4cc });
      return true;
    }
    case 'chimney':
      tex(new THREE.BoxGeometry(0.8, 2, 0.8), 'stone_wall', 0, 1, 0);
      add(new THREE.BoxGeometry(0.5, 0.02, 0.5), 0x141210, 0, 2.001, 0, { roughness: 1 });
      return true;

    // ---------- doorways and doors
    case 'wood_doorway':
      for (const x of [-0.775, 0.775]) tex(new THREE.BoxGeometry(0.45, 2, 0.14), 'dark_planks', x, 1, 0);
      tex(new THREE.BoxGeometry(1.1, 0.1, 0.14), 'dark_planks', 0, 1.95, 0, { turn: true });
      for (const x of [-0.58, 0.58]) tex(new THREE.BoxGeometry(0.1, 1.95, 0.2), 'rough_wood', x, 0.975, 0);
      tex(new THREE.BoxGeometry(1.26, 0.1, 0.2), 'rough_wood', 0, 1.9, 0, { turn: true });
      return true;
    case 'stone_doorway':
      for (const x of [-0.775, 0.775]) tex(new THREE.BoxGeometry(0.45, 2, 0.4), 'stone_wall', x, 1, 0);
      tex(new THREE.BoxGeometry(1.2, 0.1, 0.42), 'stone', 0, 1.95, 0, { tint: 0xd8d4cc });
      tex(new THREE.BoxGeometry(0.2, 0.12, 0.44), 'stone', 0, 1.94, 0, { tint: 0xc8c2b8 });
      return true;
    case 'stone_door': {
      for (const x of [-0.75, 0.75]) tex(new THREE.BoxGeometry(0.5, 2, 0.4), 'stone_wall', x, 1, 0);
      const hinge = new THREE.Group();
      hinge.position.set(-0.5, 0, 0);
      tex(new THREE.BoxGeometry(1, 1.95, 0.1), 'dark_planks', 0.5, 0.98, 0, { turn: true, parent: hinge });
      for (const y of [0.4, 1.0, 1.6]) add(new THREE.BoxGeometry(0.9, 0.06, 0.02), IRON, 0.5, y, 0.06, iron, hinge);
      add(new THREE.TorusGeometry(0.05, 0.01, 4, 10), IRON, 0.85, 1.0, 0.08, iron, hinge);
      if (state.open) hinge.rotation.y = -Math.PI / 2;
      g.add(hinge);
      return true;
    }
    case 'trapdoor': {
      for (const b of STRUCTURES.trapdoor.openBoxes!) tex(new THREE.BoxGeometry(b.h[0] * 2, 0.2, b.h[2] * 2), 'dark_planks', b.c[0], 0.1, b.c[2], { turn: true });
      // The hatch, hinged along its back edge: flat when shut, standing up when open.
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.2, -0.45);
      tex(new THREE.BoxGeometry(0.9, 0.08, 0.9), 'planks', 0, -0.04, 0.45, { turn: true, parent: hinge });
      add(new THREE.TorusGeometry(0.05, 0.01, 4, 10).rotateX(Math.PI / 2), IRON, 0, 0.005, 0.8, iron, hinge);
      if (state.open) hinge.rotation.x = -Math.PI / 2;
      g.add(hinge);
      return true;
    }
    case 'railing':
      for (const x of [-0.98, 0.98]) tex(new THREE.BoxGeometry(0.08, 1, 0.08), 'rough_wood', x, 0.5, 0);
      for (const y of [0.08, 0.96]) tex(new THREE.BoxGeometry(2, 0.07, 0.08), 'rough_wood', 0, y, 0, { turn: true });
      for (let k = 0; k < 9; k++) tex(new THREE.CylinderGeometry(0.022, 0.03, 0.84, 7), 'planks', -0.8 + k * 0.2, 0.52, 0);
      return true;
    case 'dry_stone_wall': {
      tex(new THREE.BoxGeometry(2, 0.8, 0.56), 'stone_wall', 0, 0.4, 0, { tint: 0xa8a49a });
      for (let k = 0; k < 9; k++) {
        const st = tex(new THREE.DodecahedronGeometry(0.16 + rnd(k) * 0.05), 'stone', -0.9 + k * 0.225, 0.88, (rnd(k + 9) - 0.5) * 0.1, { tint: 0x9a968e });
        st.scale.set(1.1, 0.7, 1.4); st.rotation.y = rnd(k + 3) * 3;
      }
      return true;
    }
    case 'wattle_fence': {
      for (let k = 0; k <= 5; k++) tex(new THREE.CylinderGeometry(0.03, 0.035, 1.1, 6), 'rough_wood', -1 + k * 0.4, 0.55, 0);
      for (let r = 0; r < 7; r++) add(new THREE.BoxGeometry(2, 0.07, 0.04), 0x6b5233, 0, 0.18 + r * 0.12, (r % 2 ? 1 : -1) * 0.02, { roughness: 1 });
      return true;
    }

    // ---------- roofs and stairs
    case 'shingle_roof':
      coursedRoof('rough_wood', 0x9a7a5a, 8);
      return true;
    case 'slate_roof':
      coursedRoof('stone', 0x5c6068, 9);
      return true;
    case 'stone_gable': {
      const tri = new THREE.Shape([new THREE.Vector2(-1, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 2)]);
      tex(new THREE.ExtrudeGeometry(tri, { depth: 0.4, bevelEnabled: false }).translate(0, 0, -0.2), 'stone_wall', 0, 0, 0);
      return true;
    }
    case 'stone_stairs':
      for (let k = 0; k < 8; k++) {
        const h = (k + 1) * 0.25;
        tex(new THREE.BoxGeometry(2, h, 0.25), 'stone_wall', 0, h / 2, -1 + (k + 0.5) * 0.25);
        tex(new THREE.BoxGeometry(2.02, 0.04, 0.29), 'stone', 0, h - 0.02, -1 + (k + 0.5) * 0.25 + 0.02, { tint: 0xd0ccc4 });
      }
      return true;
    case 'ladder':
      for (const x of [-0.23, 0.23]) tex(new THREE.CylinderGeometry(0.03, 0.035, 2.6, 7), 'rough_wood', x, 1.3, 0);
      for (let k = 0; k < 8; k++) tex(new THREE.CylinderGeometry(0.018, 0.018, 0.46, 6).rotateZ(Math.PI / 2), 'rough_wood', 0, 0.3 + k * 0.3, 0);
      return true;

    // ---------- decor
    case 'brazier': {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        bar(V(Math.cos(a) * 0.12, 0.75, Math.sin(a) * 0.12), V(Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28), 0.018, IRON, iron);
      }
      add(new THREE.CylinderGeometry(0.3, 0.16, 0.24, 12, 1, true), IRON, 0, 0.86, 0, { ...iron, side: THREE.DoubleSide });
      add(new THREE.TorusGeometry(0.3, 0.015, 4, 16).rotateX(Math.PI / 2), IRON, 0, 0.98, 0, iron);
      add(new THREE.CircleGeometry(0.24, 12).rotateX(-Math.PI / 2), state.lit ? 0x8a2a08 : 0x1c1814, 0, 0.92, 0, { roughness: 1, emissive: state.lit ? 0x601800 : 0x000000 });
      flame(0.9, 0.2, 0.45);
      return true;
    }
    case 'banner': {
      tex(new THREE.CylinderGeometry(0.035, 0.045, 3, 8), 'rough_wood', 0, 1.5, 0);
      tex(new THREE.CylinderGeometry(0.022, 0.022, 0.9, 6).rotateZ(Math.PI / 2), 'rough_wood', 0, 2.85, 0.06);
      add(new THREE.SphereGeometry(0.05, 8, 6), 0xb89030, 0, 3.03, 0, iron);
      add(new THREE.BoxGeometry(0.8, 1.5, 0.02), 0x8a1c1c, 0, 2.08, 0.07, { roughness: 1 });
      add(new THREE.BoxGeometry(0.3, 0.36, 0.025), 0xd8b030, 0, 2.3, 0.075, { roughness: 0.8 });
      // A swallowtail at the foot.
      for (const x of [-0.2, 0.2]) { const t = add(new THREE.ConeGeometry(0.2, 0.3, 3), 0x8a1c1c, x, 1.2, 0.07, { roughness: 1 }); t.rotation.z = Math.PI; t.scale.z = 0.05; }
      return true;
    }
    case 'charcoal_kiln': {
      // A clamp: a dome of turf and earth over logs stood on end, a few log ends showing at the foot, a smoking vent at the top.
      add(new THREE.SphereGeometry(0.95, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.95, 1), 0x4a3a28, 0, 0, 0, { roughness: 1, flatShading: true });
      add(new THREE.SphereGeometry(0.97, 18, 6, 0, Math.PI * 2, 0, 0.55).scale(1, 0.95, 1), 0x4e6a32, 0, 0, 0, { roughness: 1, flatShading: true });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.3;
        tex(new THREE.CylinderGeometry(0.07, 0.07, 0.35, 6).rotateZ(Math.PI / 2).rotateY(-a), 'rough_wood', Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.9);
      }
      add(new THREE.CylinderGeometry(0.12, 0.15, 0.08, 10), 0x1a1410, 0, 0.9, 0, { roughness: 1 });
      return true;
    }
    case 'woodpile': {
      for (let r = 0; r < 3; r++) for (let k = 0; k < 6 - r; k++) {
        const l = tex(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 7).rotateX(Math.PI / 2), 'rough_wood', -0.65 + r * 0.13 + k * 0.26, 0.1 + r * 0.18, 0);
        l.rotation.y = (rnd(r * 7 + k) - 0.5) * 0.15;
      }
      for (const x of [-0.85, 0.85]) tex(new THREE.BoxGeometry(0.08, 1, 0.08), 'rough_wood', x, 0.5, -0.32);
      const roof = tex(new THREE.BoxGeometry(1.9, 0.05, 0.9), 'dark_planks', 0, 0.98, 0.02, { turn: true });
      roof.rotation.x = 0.3;
      return true;
    }
    case 'haystack':
      tex(new THREE.CylinderGeometry(0.85, 0.9, 0.95, 16), 'thatch', 0, 0.48, 0);
      tex(new THREE.ConeGeometry(0.92, 0.7, 16), 'thatch', 0, 1.3, 0);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 5), 0x6e5a3a, 0, 1.75, 0);
      return true;
    case 'scarecrow': {
      tex(new THREE.CylinderGeometry(0.035, 0.04, 1.9, 7), 'rough_wood', 0, 0.95, 0);
      tex(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6).rotateZ(Math.PI / 2), 'rough_wood', 0, 1.45, 0);
      add(new THREE.BoxGeometry(0.42, 0.6, 0.22), 0x5a4a6a, 0, 1.3, 0, { roughness: 1 });
      for (const x of [-0.42, 0.42]) add(new THREE.BoxGeometry(0.4, 0.14, 0.14), 0x5a4a6a, x, 1.45, 0, { roughness: 1 });
      for (const x of [-0.65, 0.65]) add(new THREE.ConeGeometry(0.06, 0.16, 6).rotateZ(x > 0 ? -Math.PI / 2 : Math.PI / 2), 0xc8a860, x, 1.45, 0, { roughness: 1 });
      add(new THREE.SphereGeometry(0.15, 10, 8), 0xc8b48a, 0, 1.78, 0, { roughness: 1 });
      add(new THREE.ConeGeometry(0.2, 0.28, 10), 0x3a3028, 0, 2.0, 0, { roughness: 1 });
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 12), 0x3a3028, 0, 1.88, 0, { roughness: 1 });
      return true;
    }
    case 'signpost': {
      tex(new THREE.CylinderGeometry(0.05, 0.06, 2, 7), 'rough_wood', 0, 1, 0);
      for (const [y, a] of [[1.75, 0.3], [1.5, -1.2], [1.25, 2.2]] as const) {
        const arm = new THREE.Group();
        arm.position.y = y; arm.rotation.y = a;
        tex(new THREE.BoxGeometry(0.62, 0.14, 0.03), 'planks', 0.36, 0, 0, { turn: true, parent: arm });
        const tip = tex(new THREE.BoxGeometry(0.1, 0.1, 0.03), 'planks', 0.68, 0, 0, { parent: arm });
        tip.rotation.z = Math.PI / 4;
        g.add(arm);
      }
      return true;
    }
    case 'animal_trough':
      tex(new THREE.BoxGeometry(1.6, 0.36, 0.55), 'rough_wood', 0, 0.18, 0);
      for (const z of [-0.26, 0.26]) tex(new THREE.BoxGeometry(1.6, 0.14, 0.05), 'rough_wood', 0, 0.43, z, { turn: true });
      for (const x of [-0.78, 0.78]) tex(new THREE.BoxGeometry(0.05, 0.14, 0.55), 'rough_wood', x, 0.43, 0);
      add(new THREE.BoxGeometry(1.5, 0.02, 0.46), WATER, 0, 0.44, 0, { roughness: 0.15 });
      return true;
    case 'planter': {
      for (const z of [-0.43, 0.43]) tex(new THREE.BoxGeometry(1.8, 0.4, 0.05), 'planks', 0, 0.2, z, { turn: true });
      for (const x of [-0.88, 0.88]) tex(new THREE.BoxGeometry(0.05, 0.4, 0.86), 'planks', x, 0.2, 0);
      add(new THREE.BoxGeometry(1.72, 0.04, 0.82), 0x4a3424, 0, 0.36, 0, { roughness: 1 });
      const colours = [0xd04a5a, 0xe8c040, 0x9a5ad0, 0xf0f0e8, 0xe87a30];
      for (let k = 0; k < 14; k++) {
        const x = -0.75 + (k % 7) * 0.25 + (rnd(k) - 0.5) * 0.08, z = (k < 7 ? -0.18 : 0.18) + (rnd(k + 20) - 0.5) * 0.1, h = 0.15 + rnd(k + 40) * 0.12;
        add(new THREE.CylinderGeometry(0.008, 0.01, h, 4), 0x3e6a2a, x, 0.38 + h / 2, z);
        add(new THREE.IcosahedronGeometry(0.06, 0).scale(1, 0.6, 1), 0x4f7a35, x, 0.4, z, { flatShading: true });
        add(new THREE.SphereGeometry(0.04, 6, 5), colours[k % colours.length], x, 0.38 + h, z, { roughness: 0.8 });
      }
      return true;
    }
    case 'statue': {
      const st = { tint: 0xd0ccc4 };
      tex(new THREE.BoxGeometry(0.9, 0.6, 0.9), 'stone', 0, 0.3, 0, st);
      tex(new THREE.BoxGeometry(0.96, 0.08, 0.96), 'stone', 0, 0.62, 0, st);
      tex(new THREE.CylinderGeometry(0.2, 0.34, 1.3, 12), 'stone', 0, 1.31, 0, st);
      tex(new THREE.SphereGeometry(0.24, 10, 8).scale(1.25, 0.7, 0.9), 'stone', 0, 1.92, 0, st);
      tex(new THREE.SphereGeometry(0.13, 10, 8), 'stone', 0, 2.17, 0.02, st);
      // Hands clasped over a book, held before the chest.
      tex(new THREE.BoxGeometry(0.22, 0.28, 0.07), 'stone', 0, 1.6, 0.24, st);
      for (const x of [-0.22, 0.22]) { const arm = tex(new THREE.CylinderGeometry(0.06, 0.07, 0.42, 8), 'stone', x, 1.66, 0.12, st); arm.rotation.x = -0.9; arm.rotation.z = -x * 2; }
      return true;
    }
    case 'fountain': {
      const st = { tint: 0xd0ccc4 };
      tex(new THREE.CylinderGeometry(1.3, 1.35, 0.6, 28, 1, true), 'stone', 0, 0.3, 0, st);
      tex(new THREE.TorusGeometry(1.25, 0.09, 6, 28).rotateX(Math.PI / 2), 'stone', 0, 0.6, 0, st);
      add(new THREE.CircleGeometry(1.2, 28).rotateX(-Math.PI / 2), WATER, 0, 0.48, 0, { roughness: 0.1, metalness: 0.1 });
      tex(new THREE.CylinderGeometry(0.15, 0.22, 1.3, 12), 'stone', 0, 0.95, 0, st);
      tex(new THREE.CylinderGeometry(0.5, 0.15, 0.2, 16), 'stone', 0, 1.6, 0, st);
      add(new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2), WATER, 0, 1.69, 0, { roughness: 0.1 });
      tex(new THREE.SphereGeometry(0.1, 10, 8), 'stone', 0, 1.82, 0, st);
      return true;
    }

    // ---------- waterside
    case 'quay': {
      tex(new THREE.BoxGeometry(2, 4.88, 2), 'stone_wall', 0, 2.44, 0, { tint: 0xb8b0a4 });
      tex(new THREE.BoxGeometry(2.06, 0.14, 2.06), 'stone', 0, 4.93, 0, { tint: 0xd0ccc4 });
      // Weed and slime where the water laps (its surface is 1 m below the top).
      add(new THREE.BoxGeometry(2.02, 0.5, 2.02), 0x34402c, 0, 3.85, 0, { roughness: 1 });
      return true;
    }
    case 'quay_steps':
      solid('stone_wall', 0xb8b0a4);
      for (let k = 0; k < 4; k++) tex(new THREE.BoxGeometry(2.02, 0.05, 0.52), 'stone', 0, 3.8 + 0.3 * (k + 1) - 0.02, 1 - 0.5 * (k + 1) + 0.25, { tint: 0xd0ccc4 });
      add(new THREE.BoxGeometry(2.02, 0.5, 2.02), 0x34402c, 0, 3.6, 0, { roughness: 1 });
      return true;
    case 'breakwater': {
      tex(new THREE.BoxGeometry(2, 4.2, 2), 'stone', 0, 2.1, 0, { tint: 0x8a8680 });
      for (let k = 0; k < 14; k++) {
        const r = 0.3 + rnd(k) * 0.2, x = (rnd(k + 1) - 0.5) * 1.7, z = (rnd(k + 2) - 0.5) * 1.7;
        const st = tex(new THREE.DodecahedronGeometry(r), 'stone', x, 4.6 - r * 0.8, z, { tint: 0x8a8680 + Math.floor(rnd(k + 3) * 3) * 0x080808 });
        st.rotation.set(rnd(k + 4) * 3, rnd(k + 5) * 3, 0);
        st.scale.y = 0.7;
      }
      return true;
    }
    case 'jetty':
    case 'jetty_ladder': {
      tex(new THREE.BoxGeometry(2, 0.2, 2), 'dark_planks', 0, 6.9, 0, { turn: true });
      for (const x of [-0.85, 0.85]) for (const z of [-0.85, 0.85]) tex(new THREE.CylinderGeometry(0.12, 0.13, 6.9, 9), 'rough_wood', x, 3.45, z);
      for (const x of [-0.85, 0.85]) tex(new THREE.BoxGeometry(0.1, 0.16, 2), 'rough_wood', x, 6.72, 0);
      for (const z of [-0.85, 0.85]) { const b = tex(new THREE.BoxGeometry(2.2, 0.08, 0.06), 'rough_wood', 0, 5.9, z, { turn: true }); b.rotation.z = 0.5; }
      if (type === 'jetty_ladder') {
        // Rails standing up past the deck to grab, rungs down into the water.
        for (const x of [-0.25, 0.25]) tex(new THREE.CylinderGeometry(0.03, 0.035, 3.0, 7), 'rough_wood', x, 6.1, 1.06);
        for (let k = 0; k < 7; k++) tex(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6).rotateZ(Math.PI / 2), 'rough_wood', 0, 5.0 + k * 0.3, 1.06);
      }
      return true;
    }
    case 'mooring_post':
      tex(new THREE.CylinderGeometry(0.13, 0.15, 0.86, 10), 'rough_wood', 0, 0.43, 0);
      tex(new THREE.CylinderGeometry(0.15, 0.13, 0.08, 10), 'rough_wood', 0, 0.9, 0);
      add(new THREE.TorusGeometry(0.16, 0.03, 6, 14).rotateX(Math.PI / 2), ROPE, 0, 0.62, 0, { roughness: 1 });
      add(new THREE.TorusGeometry(0.16, 0.03, 6, 14).rotateX(Math.PI / 2), ROPE, 0, 0.68, 0, { roughness: 1 });
      return true;
    case 'bollard':
      tex(new THREE.CylinderGeometry(0.16, 0.2, 0.6, 12), 'stone', 0, 0.3, 0, { tint: 0xc8c2b8 });
      tex(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 'stone', 0, 0.6, 0, { tint: 0xc8c2b8 });
      add(new THREE.TorusGeometry(0.1, 0.018, 6, 14), IRON, 0, 0.36, 0.2, iron);
      return true;
    case 'harbour_beacon': {
      tex(new THREE.CylinderGeometry(0.42, 0.5, 3.2, 14), 'stone_wall', 0, 1.6, 0);
      tex(new THREE.CylinderGeometry(0.52, 0.52, 0.12, 14), 'stone', 0, 3.22, 0, { tint: 0xd0ccc4 });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        bar(V(Math.cos(a) * 0.22, 3.28, Math.sin(a) * 0.22), V(Math.cos(a) * 0.42, 3.75, Math.sin(a) * 0.42), 0.02, IRON, iron);
      }
      add(new THREE.TorusGeometry(0.42, 0.02, 4, 18).rotateX(Math.PI / 2), IRON, 0, 3.75, 0, iron);
      add(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12), state.lit ? 0x8a2a08 : 0x1c1814, 0, 3.32, 0, { roughness: 1, emissive: state.lit ? 0x601800 : 0x000000 });
      flame(3.35, 0.33, 0.8);
      return true;
    }
    case 'harbour_crane': {
      // The housing, the great treadwheel on its axle, and the jib out over the water.
      for (const x of [-1.1, 1.1]) for (const z of [-0.9, 0.9]) tex(new THREE.BoxGeometry(0.2, 3.2, 0.2), 'rough_wood', x, 1.6, z);
      tex(new THREE.BoxGeometry(2.4, 0.2, 2.0), 'dark_planks', 0, 0.1, 0, { turn: true });
      const roofL = tex(new THREE.BoxGeometry(2.6, 0.08, 1.3), 'rough_wood', 0, 3.4, -0.5, { tint: 0x9a7a5a }); roofL.rotation.x = 0.5;
      const roofR = tex(new THREE.BoxGeometry(2.6, 0.08, 1.3), 'rough_wood', 0, 3.4, 0.5, { tint: 0x9a7a5a }); roofR.rotation.x = -0.5;
      for (const x of [-0.6, 0.6]) {
        const rim = tex(new THREE.TorusGeometry(1.35, 0.06, 6, 28), 'rough_wood', x, 1.55, 0); rim.rotation.y = Math.PI / 2;
        for (let k = 0; k < 6; k++) { const sp = tex(new THREE.BoxGeometry(0.06, 2.7, 0.06), 'rough_wood', x, 1.55, 0); sp.rotation.x = (k / 6) * Math.PI; }
      }
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; tex(new THREE.BoxGeometry(1.25, 0.04, 0.16), 'planks', 0, 1.55 + Math.sin(a) * 1.32, Math.cos(a) * 1.32, { turn: true }).rotation.x = -a; }
      tex(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8).rotateZ(Math.PI / 2), 'rough_wood', 0, 1.55, 0);
      rod(V(0, 2.4, 0.6), V(0, 4.4, 3.8), 0.14);
      rod(V(0, 0.2, 0.9), V(0, 4.3, 3.6), 0.07);
      bar(V(0, 4.35, 3.8), V(0, 1.6, 3.8), 0.015, ROPE, { roughness: 1 });
      add(new THREE.TorusGeometry(0.07, 0.015, 4, 10), IRON, 0, 1.55, 3.8, iron);
      return true;
    }
    case 'net_rack': {
      for (const x of [-1.05, 1.05]) tex(new THREE.CylinderGeometry(0.04, 0.05, 1.8, 7), 'rough_wood', x, 0.9, 0);
      tex(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6).rotateZ(Math.PI / 2), 'rough_wood', 0, 1.75, 0);
      // The net, hung in a sag: a mesh of cords.
      for (let k = 0; k <= 10; k++) add(new THREE.BoxGeometry(0.012, 1.3 - Math.sin((k / 10) * Math.PI) * 0.2, 0.012), 0x5a5040, -1 + k * 0.2, 1.08 + Math.sin((k / 10) * Math.PI) * 0.1, 0.03, { roughness: 1 });
      for (let r = 0; r < 7; r++) add(new THREE.BoxGeometry(2, 0.012, 0.012), 0x5a5040, 0, 0.55 + r * 0.18, 0.03, { roughness: 1 });
      for (const [x, z] of [[-0.6, 0.2], [0.5, 0.25]]) add(new THREE.TorusGeometry(0.12, 0.03, 6, 12).rotateX(Math.PI / 2), 0xb08a40, x, 0.04, z, { roughness: 1 });
      return true;
    }
  }
  return false;
}
