import * as THREE from 'three';
import type { Surface } from './surfaces';

// Models of the fine furniture (data/furniture), in sawn planks with hide,
// iron, clay and greenery where they have them. Built from simple shapes for
// now: each fills the space of the real thing and reads as what it is. Front
// is +z (a chair's back is at -z).

type Tex = (geo: THREE.BufferGeometry, surface: Surface, x?: number, y?: number, z?: number, opts?: { turn?: boolean; tint?: number; parent?: THREE.Object3D }) => THREE.Mesh;
type Add = (geo: THREE.BufferGeometry, color: number, x?: number, y?: number, z?: number, extra?: THREE.MeshStandardMaterialParameters, parent?: THREE.Object3D) => THREE.Mesh;

const HIDE = 0x8a5e3a, HIDE_DARK = 0x6e4628, IRON = 0x3a3a3c, CLAY = 0xa0583a, LEAF = 0x4f7a35, STUFFING = 0xc8b48a;
const iron = { metalness: 0.6, roughness: 0.45 };
const rnd2 = (i: number) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

/** Build the model of a piece of furniture into its group; false if it isn't one. */
export function furnitureMesh(type: string, g: THREE.Group, tex: Tex, add: Add): boolean {
  /** A sawn board. */
  const board = (w: number, h: number, d: number, x: number, y: number, z: number, turn = false) => tex(new THREE.BoxGeometry(w, h, d), 'planks', x, y, z, { turn });
  /** A turned leg standing on the floor. */
  const leg = (x: number, z: number, h: number, r = 0.028) => tex(new THREE.CylinderGeometry(r * 0.8, r, h, 8), 'planks', x, h / 2, z);
  /** A round rod between two points. */
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, surface: Surface = 'planks') => {
    const len = a.distanceTo(b);
    const m = tex(new THREE.CylinderGeometry(r, r, len, 6), surface, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  /** A coloured rod (a string, a wire) between two points. */
  const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: number) => {
    const m = add(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 4), color, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, { roughness: 0.8 });
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  const knob = (x: number, y: number, z: number, r = 0.02) => add(new THREE.SphereGeometry(r, 8, 6), IRON, x, y, z, iron);

  switch (type) {
    case 'stool': {
      tex(new THREE.CylinderGeometry(0.2, 0.2, 0.045, 18), 'planks', 0, 0.45, 0);
      // Three legs splayed out under the seat.
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        rod(V(Math.cos(a) * 0.1, 0.44, Math.sin(a) * 0.1), V(Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19), 0.022);
      }
      return true;
    }
    case 'chair':
      board(0.46, 0.05, 0.46, 0, 0.45, 0, true);
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) leg(x, z, 0.45, 0.024);
      for (const x of [-0.2, 0.2]) tex(new THREE.BoxGeometry(0.045, 0.5, 0.045), 'planks', x, 0.72, -0.2);
      for (const y of [0.62, 0.8, 0.95]) board(0.44, 0.07, 0.03, 0, y, -0.2, true);
      return true;
    case 'bench':
      board(1.5, 0.05, 0.34, 0, 0.44, 0, true);
      for (const x of [-0.62, 0.62]) {
        board(0.05, 0.42, 0.3, x, 0.21, 0);
      }
      board(1.24, 0.06, 0.03, 0, 0.18, 0, true);
      return true;
    case 'rocking_chair': {
      // Curved runners under it, front to back.
      for (const x of [-0.24, 0.24]) {
        const runner = new THREE.TorusGeometry(1.1, 0.024, 6, 20, 0.85).rotateZ(-Math.PI / 2 - 0.425).rotateY(Math.PI / 2);
        tex(runner, 'planks', x, 1.13, 0);
      }
      board(0.5, 0.05, 0.48, 0, 0.45, 0, true);
      for (const [x, z] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) rod(V(x, 0.44, z), V(x, 0.05, z), 0.022);
      // A tall spindle back, leaning a little.
      const back = new THREE.Group();
      back.position.set(0, 0.45, -0.23);
      back.rotation.x = -0.18;
      for (const x of [-0.22, 0.22]) tex(new THREE.CylinderGeometry(0.022, 0.025, 0.85, 8), 'planks', x, 0.42, 0, { parent: back });
      for (let k = 0; k < 6; k++) tex(new THREE.CylinderGeometry(0.009, 0.009, 0.62, 6), 'planks', -0.15 + k * 0.06, 0.4, 0, { parent: back });
      tex(new THREE.BoxGeometry(0.52, 0.09, 0.04), 'planks', 0, 0.8, 0, { parent: back, turn: true });
      tex(new THREE.BoxGeometry(0.46, 0.04, 0.03), 'planks', 0, 0.08, 0, { parent: back, turn: true });
      // Arms on turned posts.
      for (const x of [-0.25, 0.25]) {
        board(0.06, 0.03, 0.5, x, 0.68, 0.0);
        rod(V(x, 0.46, 0.2), V(x, 0.67, 0.2), 0.016);
      }
      g.add(back);
      return true;
    }
    case 'armchair':
      board(0.84, 0.3, 0.78, 0, 0.17, 0);
      for (const [x, z] of [[-0.38, -0.34], [0.38, -0.34], [-0.38, 0.34], [0.38, 0.34]]) leg(x, z, 0.06, 0.03);
      add(new THREE.BoxGeometry(0.62, 0.16, 0.64), HIDE, 0, 0.4, 0.04, { roughness: 0.95 });
      add(new THREE.BoxGeometry(0.66, 0.6, 0.16), HIDE, 0, 0.72, -0.31, { roughness: 0.95 });
      for (const x of [-0.36, 0.36]) {
        add(new THREE.BoxGeometry(0.12, 0.26, 0.74), HIDE_DARK, x, 0.45, 0, { roughness: 0.95 });
        board(0.14, 0.03, 0.76, x, 0.6, 0);
      }
      return true;
    case 'side_table':
      board(0.5, 0.04, 0.5, 0, 0.6, 0, true);
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) leg(x, z, 0.58, 0.022);
      board(0.44, 0.03, 0.44, 0, 0.18, 0, true);
      return true;
    case 'table':
      board(1.4, 0.06, 0.9, 0, 0.77, 0, true);
      for (const [x, z] of [[-0.62, -0.37], [0.62, -0.37], [-0.62, 0.37], [0.62, 0.37]]) tex(new THREE.BoxGeometry(0.07, 0.74, 0.07), 'planks', x, 0.37, z);
      board(1.26, 0.08, 0.03, 0, 0.68, -0.37, true);
      board(1.26, 0.08, 0.03, 0, 0.68, 0.37, true);
      return true;
    case 'dining_table':
      board(2.3, 0.07, 1.0, 0, 0.77, 0, true);
      for (const x of [-1.0, 0, 1.0]) for (const z of [-0.4, 0.4]) {
        leg(x, z, 0.74, 0.035);
        add(new THREE.SphereGeometry(0.045, 10, 8), 0x7a5634, x, 0.3, z);
      }
      for (const z of [-0.4, 0.4]) board(2.1, 0.09, 0.035, 0, 0.68, z, true);
      board(2.0, 0.04, 0.05, 0, 0.14, 0, true);
      return true;
    case 'writing_desk': {
      for (const [x, z] of [[-0.55, -0.28], [0.55, -0.28], [-0.55, 0.28], [0.55, 0.28]]) leg(x, z, 0.58, 0.026);
      board(1.2, 0.18, 0.6, 0, 0.66, 0);
      // Drawer fronts and pulls.
      for (const x of [-0.3, 0.3]) { board(0.5, 0.12, 0.02, x, 0.66, 0.305); knob(x, 0.66, 0.325); }
      const top = board(1.2, 0.035, 0.5, 0, 0.79, 0.04, true);
      top.rotation.x = 0.12;
      // The raised back with its pigeonholes.
      board(1.2, 0.36, 0.2, 0, 0.98, -0.22);
      for (let k = 0; k <= 4; k++) board(0.02, 0.3, 0.2, -0.5 + k * 0.25, 0.98, -0.11);
      board(1.0, 0.02, 0.2, 0, 0.98, -0.11, true);
      return true;
    }
    case 'shelf': {
      for (const x of [-0.58, 0.58]) board(0.04, 1.5, 0.32, x, 0.75, 0);
      for (const y of [0.04, 0.5, 0.97, 1.46]) board(1.16, 0.035, 0.3, 0, y, 0, true);
      board(1.2, 1.5, 0.02, 0, 0.75, -0.15);
      // Things set out on it: bound books, a jar or two.
      const books = [0x6b3a24, 0x4a3a2a, 0x7a5a32, 0x3a4a3a, 0x5a2a2a, 0x8a6a3a];
      let x = -0.5;
      for (let k = 0; k < 9; k++) {
        const w = 0.04 + ((k * 7) % 3) * 0.012, h = 0.22 + ((k * 5) % 4) * 0.03;
        add(new THREE.BoxGeometry(w, h, 0.2), books[k % books.length], x + w / 2, 0.52 + h / 2, 0.02, { roughness: 0.9 });
        x += w + 0.006;
      }
      for (const [jx, jy] of [[0.2, 1.0], [0.35, 1.0], [-0.3, 0.06]]) {
        add(new THREE.CylinderGeometry(0.05, 0.045, 0.16, 12), CLAY, jx, jy + 0.08, 0.02, { roughness: 0.9 });
      }
      return true;
    }
    case 'cupboard':
      board(1.1, 1.8, 0.56, 0, 0.9, 0);
      for (const s of [-1, 1]) {
        board(0.53, 1.62, 0.025, s * 0.275, 0.92, 0.29);
        knob(s * 0.05, 0.95, 0.31, 0.022);
      }
      board(1.16, 0.05, 0.6, 0, 1.82, 0, true);
      return true;
    case 'dresser':
      board(1.1, 0.86, 0.5, 0, 0.47, 0);
      board(1.16, 0.04, 0.54, 0, 0.92, 0, true);
      for (let k = 0; k < 4; k++) {
        const y = 0.16 + k * 0.2;
        board(1.02, 0.17, 0.02, 0, y, 0.255, true);
        for (const x of [-0.28, 0.28]) knob(x, y, 0.275);
      }
      for (const [x, z] of [[-0.5, -0.2], [0.5, -0.2], [-0.5, 0.2], [0.5, 0.2]]) leg(x, z, 0.05, 0.03);
      return true;
    case 'barrel':
      tex(new THREE.CylinderGeometry(0.27, 0.27, 0.84, 18), 'planks', 0, 0.42, 0);
      for (const y of [0.1, 0.32, 0.52, 0.74]) add(new THREE.TorusGeometry(0.275, 0.012, 6, 24).rotateX(Math.PI / 2), IRON, 0, y, 0, iron);
      tex(new THREE.CircleGeometry(0.26, 18).rotateX(-Math.PI / 2), 'planks', 0, 0.845, 0);
      return true;
    case 'tool_rack':
      for (const x of [-0.55, 0.55]) {
        board(0.06, 1.5, 0.06, x, 0.75, 0);
        board(0.08, 0.04, 0.32, x, 0.02, 0);
      }
      for (const y of [0.45, 1.25]) board(1.16, 0.08, 0.04, 0, y, 0, true);
      for (let k = 0; k < 6; k++) rod(V(-0.45 + k * 0.18, 1.25, 0.02), V(-0.45 + k * 0.18, 1.29, 0.14), 0.012);
      return true;
    case 'hide_rug': {
      const g = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2).scale(0.9, 1, 0.6);
      add(g, HIDE, 0, 0.012, 0, { roughness: 1 });
      add(new THREE.RingGeometry(0.93, 1, 24).rotateX(-Math.PI / 2).scale(0.9, 1, 0.6), HIDE_DARK, 0, 0.014, 0, { roughness: 1 });
      return true;
    }
    case 'potted_plant': {
      const pot = new THREE.LatheGeometry([new THREE.Vector2(0.09, 0), new THREE.Vector2(0.12, 0.05), new THREE.Vector2(0.15, 0.26), new THREE.Vector2(0.16, 0.28), new THREE.Vector2(0.14, 0.28)], 18);
      add(pot, CLAY, 0, 0, 0, { roughness: 0.9, side: THREE.DoubleSide });
      add(new THREE.CircleGeometry(0.14, 16).rotateX(-Math.PI / 2), 0x4a3424, 0, 0.26, 0, { roughness: 1 });
      add(new THREE.CylinderGeometry(0.015, 0.02, 0.28, 6), 0x5a4030, 0, 0.4, 0);
      add(new THREE.IcosahedronGeometry(0.17, 1).scale(1, 0.85, 1), LEAF, 0, 0.62, 0, { flatShading: true, roughness: 0.9 });
      add(new THREE.IcosahedronGeometry(0.1, 1), LEAF, 0.09, 0.52, 0.05, { flatShading: true, roughness: 0.9 });
      return true;
    }
    case 'spinning_wheel': {
      // The bench, on three legs.
      board(0.9, 0.06, 0.24, 0, 0.36, 0, true);
      for (const [x, z] of [[-0.38, 0], [0.38, -0.1], [0.38, 0.1]]) rod(V(x * 0.9, 0.35, z * 0.6), V(x, 0, z), 0.018);
      // Uprights holding the great wheel.
      for (const z of [-0.07, 0.07]) rod(V(0.22, 0.38, z), V(0.22, 0.66, z), 0.018);
      const wheel = new THREE.Group();
      wheel.position.set(0.22, 0.66, 0);
      tex(new THREE.TorusGeometry(0.3, 0.018, 6, 28), 'planks', 0, 0, 0, { parent: wheel });
      for (let k = 0; k < 8; k++) {
        const s = tex(new THREE.BoxGeometry(0.012, 0.6, 0.012), 'planks', 0, 0, 0, { parent: wheel });
        s.rotation.z = (k / 8) * Math.PI;
      }
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10).rotateX(Math.PI / 2), 0x6a4a2a, 0, 0, 0, {}, wheel);
      // The spindle and the distaff.
      rod(V(-0.3, 0.38, 0), V(-0.3, 0.6, 0), 0.016);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8).rotateZ(Math.PI / 2), STUFFING, -0.3, 0.62, 0);
      rod(V(-0.4, 0.38, -0.05), V(-0.44, 0.95, -0.05), 0.012);
      add(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.6, 1), STUFFING, -0.44, 0.92, -0.05, { roughness: 1 });
      g.add(wheel);
      return true;
    }
    case 'fine_bed': {
      board(1.2, 0.28, 2.1, 0, 0.26, 0, true);
      add(new THREE.BoxGeometry(1.1, 0.18, 2.0), STUFFING, 0, 0.49, 0, { roughness: 1 });
      add(new THREE.BoxGeometry(1.12, 0.05, 1.3), HIDE, 0, 0.6, 0.32, { roughness: 1 });
      add(new THREE.BoxGeometry(0.5, 0.1, 0.3), 0xe0d4b8, 0, 0.63, -0.78, { roughness: 1 });
      // Four turned posts and the rails along the top.
      for (const x of [-0.58, 0.58]) for (const z of [-1.03, 1.03]) leg(x, z, 1.9, 0.04);
      for (const x of [-0.58, 0.58]) board(0.05, 0.06, 2.1, x, 1.88, 0);
      for (const z of [-1.03, 1.03]) board(1.2, 0.06, 0.05, 0, 1.88, z, true);
      board(1.16, 0.5, 0.04, 0, 0.75, -1.03, true);
      return true;
    }
    // ---------- more seats
    case 'footstool':
      add(new THREE.BoxGeometry(0.42, 0.12, 0.32), HIDE, 0, 0.28, 0, { roughness: 1 });
      board(0.44, 0.04, 0.34, 0, 0.2, 0, true);
      for (const [x, z] of [[-0.18, -0.13], [0.18, -0.13], [-0.18, 0.13], [0.18, 0.13]]) leg(x, z, 0.19, 0.022);
      return true;
    case 'pew':
      board(1.96, 0.05, 0.36, 0, 0.45, 0.04, true);
      for (const x of [-0.95, 0.95]) { board(0.06, 0.9, 0.46, x, 0.45, 0); }
      board(1.92, 0.5, 0.04, 0, 0.72, -0.2, true);
      board(1.92, 0.05, 0.08, 0, 0.98, -0.2, true);
      return true;
    case 'throne': {
      board(0.84, 0.1, 0.7, 0, 0.45, 0.04, true);
      board(0.84, 0.4, 0.7, 0, 0.2, 0.04);
      add(new THREE.BoxGeometry(0.72, 0.08, 0.6), 0x8a1c1c, 0, 0.54, 0.06, { roughness: 1 });
      board(0.84, 1.15, 0.1, 0, 1.05, -0.32);
      for (const x of [-0.42, 0.42]) { board(0.08, 0.3, 0.66, x, 0.65, 0.04); tex(new THREE.SphereGeometry(0.05, 8, 6), 'planks', x, 0.82, 0.36); }
      // A carved crest on the back, gilded.
      add(new THREE.ConeGeometry(0.12, 0.2, 4), 0xb89030, 0, 1.72, -0.32, iron);
      for (const x of [-0.36, 0.36]) add(new THREE.SphereGeometry(0.05, 8, 6), 0xb89030, x, 1.65, -0.32, iron);
      return true;
    }
    // ---------- more tables
    case 'round_table':
      tex(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 24), 'planks', 0, 0.74, 0);
      tex(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 10), 'planks', 0, 0.37, 0);
      for (let k = 0; k < 4; k++) { const f = board(0.5, 0.05, 0.08, 0, 0.03, 0, true); f.rotation.y = (k / 4) * Math.PI; }
      return true;
    case 'trestle_table':
      board(2.0, 0.05, 0.8, 0, 0.74, 0, true);
      for (const x of [-0.75, 0.75]) {
        for (const s of [-1, 1]) rod(V(x, 0.72, 0), V(x, 0, s * 0.32), 0.03);
        board(0.06, 0.06, 0.66, x, 0.3, 0);
      }
      return true;
    case 'map_table': {
      board(1.5, 0.06, 1.0, 0, 0.84, 0, true);
      for (const [x, z] of [[-0.68, -0.43], [0.68, -0.43], [-0.68, 0.43], [0.68, 0.43]]) leg(x, z, 0.82, 0.035);
      add(new THREE.BoxGeometry(1.2, 0.01, 0.76), 0xc8ac80, 0, 0.875, 0, { roughness: 1 });
      // The coast drawn on it: land and the sea, and a ship's course.
      add(new THREE.BoxGeometry(0.5, 0.004, 0.4), 0x7a8a50, -0.3, 0.882, -0.1, { roughness: 1 });
      add(new THREE.BoxGeometry(0.3, 0.004, 0.25), 0x7a8a50, 0.35, 0.882, 0.18, { roughness: 1 });
      add(new THREE.BoxGeometry(0.5, 0.004, 0.008), 0x8a1c1c, 0.05, 0.884, 0.1, { roughness: 1 }).rotation.y = 0.5;
      for (const [x, z] of [[-0.55, -0.33], [0.55, -0.33], [-0.55, 0.33], [0.55, 0.33]]) tex(new THREE.DodecahedronGeometry(0.035), 'stone', x, 0.9, z);
      return true;
    }
    case 'chess_table': {
      board(0.68, 0.05, 0.68, 0, 0.74, 0, true);
      for (const [x, z] of [[-0.29, -0.29], [0.29, -0.29], [-0.29, 0.29], [0.29, 0.29]]) leg(x, z, 0.72, 0.026);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) add(new THREE.BoxGeometry(0.06, 0.004, 0.06), 0x3a2a1c, -0.21 + i * 0.06, 0.767, -0.21 + j * 0.06, { roughness: 0.8 });
      for (let k = 0; k < 8; k++) {
        add(new THREE.CylinderGeometry(0.012, 0.018, 0.05, 8), 0xe8dcc0, -0.21 + k * 0.06, 0.79, -0.21, { roughness: 0.6 });
        add(new THREE.CylinderGeometry(0.012, 0.018, 0.05, 8), 0x2a2018, -0.21 + k * 0.06, 0.79, 0.21, { roughness: 0.6 });
      }
      return true;
    }
    case 'lectern': {
      tex(new THREE.CylinderGeometry(0.05, 0.07, 1.0, 8), 'planks', 0, 0.5, 0);
      board(0.4, 0.04, 0.4, 0, 0.02, 0, true);
      const top = board(0.5, 0.04, 0.4, 0, 1.08, 0, true);
      top.rotation.x = 0.45;
      const book = add(new THREE.BoxGeometry(0.42, 0.05, 0.3), 0x6a2a1a, 0, 1.12, 0.02, { roughness: 1 });
      book.rotation.x = 0.45;
      const pages = add(new THREE.BoxGeometry(0.38, 0.02, 0.27), 0xe8dcc0, 0, 1.15, 0.01, { roughness: 1 });
      pages.rotation.x = 0.45;
      return true;
    }
    // ---------- beds
    case 'straw_bed':
      board(0.9, 0.08, 1.9, 0, 0.04, 0, true);
      add(new THREE.BoxGeometry(0.84, 0.14, 1.82), 0xc8b070, 0, 0.15, 0, { roughness: 1 });
      add(new THREE.BoxGeometry(0.8, 0.03, 0.9), HIDE, 0, 0.23, 0.35, { roughness: 1 });
      return true;
    case 'bunk_bed': {
      for (const x of [-0.48, 0.48]) for (const z of [-0.93, 0.93]) board(0.06, 1.7, 0.06, x, 0.85, z);
      for (const y of [0.25, 1.15]) {
        board(1.0, 0.08, 1.9, 0, y, 0, true);
        add(new THREE.BoxGeometry(0.9, 0.12, 1.8), STUFFING, 0, y + 0.1, 0, { roughness: 1 });
        add(new THREE.BoxGeometry(0.88, 0.03, 0.9), HIDE, 0, y + 0.17, 0.4, { roughness: 1 });
      }
      board(0.04, 0.04, 1.9, 0.48, 1.45, 0);
      for (let k = 0; k < 4; k++) rod(V(0.52, 0.3 + k * 0.3, 0.6), V(0.52, 0.3 + k * 0.3, 0.9), 0.015);
      return true;
    }
    case 'cradle': {
      board(0.44, 0.04, 0.8, 0, 0.18, 0, true);
      for (const x of [-0.21, 0.21]) board(0.03, 0.26, 0.8, x, 0.32, 0);
      for (const z of [-0.39, 0.39]) board(0.44, 0.34, 0.03, 0, 0.36, z, true);
      for (const z of [-0.3, 0.3]) {
        const r = new THREE.TorusGeometry(0.4, 0.02, 5, 14, 1.2).rotateZ(-Math.PI / 2 - 0.6).rotateY(Math.PI / 2);
        tex(r, 'planks', 0, 0.42, z).rotation.y = Math.PI / 2;
      }
      add(new THREE.BoxGeometry(0.38, 0.06, 0.5), 0x8a9ab8, 0, 0.24, 0.1, { roughness: 1 });
      return true;
    }
    // ---------- storage
    case 'wardrobe':
      board(1.2, 1.9, 0.6, 0, 1.0, 0);
      board(1.26, 0.08, 0.66, 0, 1.97, 0, true);
      for (const x of [-0.3, 0.3]) board(0.56, 1.7, 0.02, x, 1.0, 0.31);
      for (const x of [-0.04, 0.04]) knob(x, 1.0, 0.33);
      for (const y of [0.4, 1.6]) for (const x of [-0.56, 0.56]) add(new THREE.BoxGeometry(0.1, 0.03, 0.01), IRON, x, y, 0.325, iron);
      for (const [x, z] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) leg(x, z, 0.06, 0.035);
      return true;
    case 'crate':
      board(0.66, 0.56, 0.66, 0, 0.3, 0);
      for (const sx of [-1, 1]) for (const y of [0.06, 0.54]) board(0.7, 0.07, 0.03, 0, y, sx * 0.34, true);
      for (const sx of [-1, 1]) { const b = board(0.04, 0.7, 0.06, 0, 0.3, sx * 0.34); b.rotation.z = 0.75; }
      return true;
    case 'wine_rack': {
      board(1.1, 1.5, 0.04, 0, 0.75, -0.18);
      for (const x of [-0.53, 0.53]) board(0.04, 1.5, 0.4, x, 0.75, 0);
      for (let r = 0; r <= 4; r++) board(1.06, 0.03, 0.4, 0, 0.02 + r * 0.36, 0, true);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
        const j = add(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 10).rotateX(Math.PI / 2), CLAY, -0.39 + k * 0.26, 0.12 + r * 0.36, 0.02, { roughness: 0.9 });
        j.castShadow = false;
      }
      return true;
    }
    case 'wall_shelf':
      board(1.0, 0.04, 0.24, 0, 1.3, 0, true);
      for (const x of [-0.4, 0.4]) { const br = board(0.03, 0.2, 0.2, x, 1.2, -0.02); br.rotation.x = 0.3; }
      for (const [x, h] of [[-0.3, 0.2], [-0.05, 0.14], [0.25, 0.24]]) add(new THREE.CylinderGeometry(h * 0.35, h * 0.3, h, 10), CLAY, x, 1.32 + h / 2, 0, { roughness: 0.9 });
      return true;
    // ---------- the household
    case 'washstand':
      board(0.56, 0.04, 0.44, 0, 0.82, 0, true);
      for (const [x, z] of [[-0.24, -0.18], [0.24, -0.18], [-0.24, 0.18], [0.24, 0.18]]) leg(x, z, 0.8, 0.022);
      board(0.5, 0.03, 0.38, 0, 0.3, 0, true);
      add(new THREE.LatheGeometry([new THREE.Vector2(0.06, 0), new THREE.Vector2(0.18, 0.04), new THREE.Vector2(0.2, 0.1)], 16), CLAY, 0, 0.84, 0, { side: THREE.DoubleSide, roughness: 0.9 });
      add(new THREE.CylinderGeometry(0.17, 0.17, 0.01, 16), 0x3f6f8a, 0, 0.92, 0, { roughness: 0.1 });
      add(new THREE.LatheGeometry([new THREE.Vector2(0.04, 0), new THREE.Vector2(0.07, 0.08), new THREE.Vector2(0.05, 0.2), new THREE.Vector2(0.04, 0.22)], 12), CLAY, 0.18, 0.31, 0, { roughness: 0.9 });
      return true;
    case 'bathtub': {
      tex(new THREE.CylinderGeometry(0.4, 0.36, 0.58, 18, 1, true).scale(1, 1, 1.85), 'planks', 0, 0.3, 0);
      add(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 18).scale(1, 1, 1.85), 0x5a4030, 0, 0.03, 0);
      add(new THREE.CylinderGeometry(0.37, 0.37, 0.02, 18).scale(1, 1, 1.85), 0x3f6f8a, 0, 0.42, 0, { roughness: 0.1 });
      for (const y of [0.1, 0.5]) add(new THREE.TorusGeometry(0.39, 0.012, 5, 24).rotateX(Math.PI / 2).scale(1, 1, 1.85), IRON, 0, y, 0, iron);
      return true;
    }
    case 'cauldron': {
      add(new THREE.SphereGeometry(0.32, 16, 10, 0, Math.PI * 2, Math.PI / 2.6, Math.PI / 1.6), IRON, 0, 0.42, 0, { ...iron, side: THREE.DoubleSide });
      add(new THREE.TorusGeometry(0.29, 0.02, 6, 20).rotateX(Math.PI / 2), IRON, 0, 0.55, 0, iron);
      add(new THREE.CircleGeometry(0.27, 16).rotateX(-Math.PI / 2), 0x6a5a3a, 0, 0.5, 0, { roughness: 0.4 });
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; add(new THREE.CylinderGeometry(0.02, 0.025, 0.2, 6), IRON, Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2, iron); }
      const handle = add(new THREE.TorusGeometry(0.3, 0.008, 4, 16, Math.PI), IRON, 0, 0.56, 0, iron);
      handle.rotation.y = Math.PI / 2;
      return true;
    }
    case 'butter_churn':
      tex(new THREE.CylinderGeometry(0.15, 0.2, 0.72, 14), 'planks', 0, 0.36, 0);
      for (const y of [0.12, 0.6]) add(new THREE.TorusGeometry(0.17 + (0.6 - y) * 0.06, 0.01, 5, 18).rotateX(Math.PI / 2), IRON, 0, y, 0, iron);
      tex(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 14), 'planks', 0, 0.73, 0);
      tex(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), 'planks', 0, 0.95, 0);
      return true;
    case 'loom': {
      for (const x of [-0.6, 0.6]) { const u = board(0.07, 1.6, 0.07, x, 0.8, -0.05); u.rotation.x = -0.12; }
      for (const x of [-0.6, 0.6]) board(0.06, 0.06, 0.7, x, 0.03, 0);
      board(1.3, 0.08, 0.08, 0, 1.55, -0.14, true);
      // The cloth woven so far (from the top), the warp threads below it, and the loom weights hanging.
      add(new THREE.BoxGeometry(1.1, 0.6, 0.01), 0x7a5a9a, 0, 1.22, -0.1, { roughness: 1 }).rotation.x = -0.12;
      for (let k = 0; k < 18; k++) add(new THREE.BoxGeometry(0.004, 0.65, 0.004), 0xd8ccb0, -0.53 + k * 0.0625, 0.6, -0.02, { roughness: 1 }).rotation.x = -0.12;
      for (let k = 0; k < 9; k++) add(new THREE.SphereGeometry(0.035, 6, 5), CLAY, -0.5 + k * 0.125, 0.26, 0.02, { roughness: 1 });
      return true;
    }
    case 'coat_rack':
      tex(new THREE.CylinderGeometry(0.03, 0.04, 1.75, 8), 'planks', 0, 0.875, 0);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; rod(V(0, 0.05, 0), V(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22), 0.02); }
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; rod(V(0, 1.6, 0), V(Math.cos(a) * 0.14, 1.66, Math.sin(a) * 0.14), 0.012); }
      add(new THREE.CylinderGeometry(0.1, 0.28, 0.95, 12, 1, true), 0x3a4a5a, 0, 1.12, 0.08, { roughness: 1, side: THREE.DoubleSide });
      add(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 12), 0x5a3a24, -0.08, 1.74, -0.05, { roughness: 1 });
      return true;
    // ---------- the hall
    case 'weapon_rack': {
      for (const x of [-0.55, 0.55]) board(0.06, 1.5, 0.06, x, 0.75, -0.08);
      board(1.16, 0.08, 0.2, 0, 0.1, 0, true);
      board(1.16, 0.06, 0.06, 0, 1.2, -0.08, true);
      for (let k = 0; k < 4; k++) {
        const x = -0.4 + k * 0.22;
        tex(new THREE.CylinderGeometry(0.016, 0.018, 1.55, 6), 'planks', x, 0.85, 0.02);
        add(new THREE.ConeGeometry(0.035, 0.18, 4), IRON, x, 1.7, 0.02, iron);
      }
      // A sword, point down, against the end.
      add(new THREE.BoxGeometry(0.04, 0.8, 0.008), 0xb8bcc0, 0.45, 0.6, 0.03, { metalness: 0.8, roughness: 0.3 });
      add(new THREE.BoxGeometry(0.18, 0.03, 0.03), IRON, 0.45, 1.02, 0.03, iron);
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 6), 0x3a2a1c, 0.45, 1.11, 0.03);
      return true;
    }
    case 'armor_stand': {
      tex(new THREE.CylinderGeometry(0.035, 0.04, 1.5, 8), 'planks', 0, 0.75, 0);
      board(0.5, 0.05, 0.3, 0, 0.025, 0, true);
      board(0.5, 0.05, 0.06, 0, 1.38, 0, true);
      add(new THREE.CylinderGeometry(0.19, 0.17, 0.62, 12), HIDE_DARK, 0, 1.08, 0, { roughness: 0.9 });
      add(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), 0x8a8e92, 0, 1.55, 0, { metalness: 0.7, roughness: 0.35 });
      add(new THREE.BoxGeometry(0.03, 0.1, 0.03), 0x8a8e92, 0, 1.5, 0.13, iron);
      const shield = add(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 18).rotateX(Math.PI / 2), 0x8a1c1c, -0.32, 0.85, 0.06, { roughness: 0.9 });
      shield.rotation.y = -0.4;
      add(new THREE.SphereGeometry(0.06, 8, 6), IRON, -0.33, 0.85, 0.09, iron);
      return true;
    }
    case 'tapestry': {
      tex(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6).rotateZ(Math.PI / 2), 'planks', 0, 2.27, 0);
      add(new THREE.BoxGeometry(1.36, 1.7, 0.02), 0x2a4a3a, 0, 1.4, 0, { roughness: 1 });
      add(new THREE.BoxGeometry(1.26, 1.6, 0.025), 0x8a2a2a, 0, 1.4, 0, { roughness: 1 });
      add(new THREE.BoxGeometry(1.1, 1.44, 0.03), 0x3a5a3a, 0, 1.4, 0, { roughness: 1 });
      // A stag under a tree, and a hunter.
      add(new THREE.SphereGeometry(0.22, 8, 6).scale(1, 1, 0.1), 0x2a3a20, -0.25, 1.75, 0.02, { roughness: 1 });
      add(new THREE.BoxGeometry(0.04, 0.4, 0.02), 0x5a3a24, -0.25, 1.45, 0.02, { roughness: 1 });
      add(new THREE.BoxGeometry(0.3, 0.14, 0.02), 0xc8a060, 0.15, 1.2, 0.02, { roughness: 1 });
      add(new THREE.BoxGeometry(0.06, 0.16, 0.02), 0xc8a060, 0.27, 1.32, 0.02, { roughness: 1 });
      add(new THREE.BoxGeometry(0.08, 0.28, 0.02), 0x8a1c1c, -0.4, 1.0, 0.02, { roughness: 1 });
      for (let k = 0; k < 9; k++) add(new THREE.BoxGeometry(0.02, 0.08, 0.01), 0xd8b030, -0.6 + k * 0.15, 0.51, 0, { roughness: 1 });
      return true;
    }
    case 'flower_box': {
      board(0.8, 0.18, 0.22, 0, 0.09, 0);
      add(new THREE.BoxGeometry(0.74, 0.02, 0.18), 0x4a3424, 0, 0.18, 0, { roughness: 1 });
      const colours = [0xd04a5a, 0xe8c040, 0x9a5ad0, 0xf0f0e8];
      for (let k = 0; k < 7; k++) {
        const x = -0.3 + k * 0.1;
        add(new THREE.IcosahedronGeometry(0.05, 0), LEAF, x, 0.21, 0, { flatShading: true });
        add(new THREE.SphereGeometry(0.03, 6, 5), colours[k % 4], x, 0.27, (k % 2 ? 0.03 : -0.03), { roughness: 0.8 });
      }
      return true;
    }
    // ---------- the study and the workshop
    case 'bookcase': {
      board(1.2, 1.9, 0.04, 0, 0.95, -0.18);
      for (const x of [-0.58, 0.58]) board(0.04, 1.9, 0.4, x, 0.95, 0);
      for (let r = 0; r <= 4; r++) board(1.16, 0.04, 0.38, 0, 0.04 + r * 0.45, 0, true);
      const cols = [0x6a2a1a, 0x2a3a5a, 0x3a4a2a, 0x5a3a1a, 0x7a5a2a, 0x2a2018];
      for (let r = 0; r < 4; r++) {
        let x = -0.54;
        for (let k = 0; x < 0.5; k++) {
          const w = 0.04 + ((k * 7 + r * 3) % 5) * 0.012, h = 0.26 + ((k * 3 + r) % 4) * 0.03;
          const b = add(new THREE.BoxGeometry(w, h, 0.24), cols[(k + r * 2) % cols.length], x + w / 2, 0.06 + r * 0.45 + h / 2, 0.02, { roughness: 0.9 });
          if (k % 9 === 8) b.rotation.z = 0.25;
          x += w + 0.005;
        }
      }
      return true;
    }
    case 'alchemy_table': {
      board(1.4, 0.05, 0.7, 0, 0.84, 0, true);
      for (const [x, z] of [[-0.64, -0.3], [0.64, -0.3], [-0.64, 0.3], [0.64, 0.3]]) leg(x, z, 0.82, 0.03);
      // The alembic: a flask on a little brazier, its beak running into a receiver.
      add(new THREE.CylinderGeometry(0.08, 0.1, 0.1, 8), IRON, -0.35, 0.92, 0, iron);
      add(new THREE.SphereGeometry(0.11, 12, 10), 0x8ab0a0, -0.35, 1.08, 0, { transparent: true, opacity: 0.6, roughness: 0.1 });
      add(new THREE.ConeGeometry(0.06, 0.18, 10), 0x8ab0a0, -0.35, 1.25, 0, { transparent: true, opacity: 0.6, roughness: 0.1 });
      { const beak = add(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), 0x8ab0a0, -0.2, 1.17, 0, { transparent: true, opacity: 0.7 }); beak.rotation.z = 1.0; }
      add(new THREE.SphereGeometry(0.07, 10, 8), 0x8ab0a0, -0.03, 0.94, 0, { transparent: true, opacity: 0.6, roughness: 0.1 });
      for (const [x, z, h, c] of [[0.2, -0.2, 0.18, CLAY], [0.32, -0.18, 0.12, 0x3a5a3a], [0.45, -0.22, 0.2, CLAY], [0.55, 0.1, 0.1, 0x5a2a5a]] as const) add(new THREE.CylinderGeometry(0.04, 0.05, h, 10), c, x, 0.87 + h / 2, z, { roughness: 0.7 });
      add(new THREE.CylinderGeometry(0.07, 0.05, 0.08, 10), 0x9a948c, 0.25, 0.9, 0.18);
      rod(V(0.25, 0.92, 0.18), V(0.32, 1.02, 0.12), 0.012);
      add(new THREE.BoxGeometry(0.3, 0.01, 0.22), 0xd8c8a0, 0.0, 0.87, 0.2, { roughness: 1 }).rotation.y = 0.3;
      return true;
    }
    case 'armillary': {
      tex(new THREE.CylinderGeometry(0.03, 0.06, 0.4, 8), 'planks', 0, 0.2, 0);
      tex(new THREE.CylinderGeometry(0.15, 0.17, 0.04, 14), 'planks', 0, 0.02, 0);
      const sph = new THREE.Group();
      sph.position.y = 0.58; sph.rotation.z = 0.41;
      const brass = { metalness: 0.8, roughness: 0.35 };
      for (const [rx, ry] of [[0, 0], [Math.PI / 2, 0], [Math.PI / 2, Math.PI / 2], [Math.PI / 2 - 0.41, 0.6]]) { const r = add(new THREE.TorusGeometry(0.18, 0.008, 4, 28), 0xb89030, 0, 0, 0, brass, sph); r.rotation.set(rx, ry, 0); }
      add(new THREE.SphereGeometry(0.05, 10, 8), 0x3a6a9a, 0, 0, 0, { roughness: 0.6 }, sph);
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.46, 4), 0xb89030, 0, 0, 0, brass, sph);
      g.add(sph);
      return true;
    }
    case 'potters_wheel': {
      board(0.9, 0.05, 0.3, 0, 0.42, -0.25, true);
      for (const x of [-0.4, 0.4]) leg(x, -0.25, 0.4, 0.03);
      tex(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 20), 'planks', 0.0, 0.1, 0.15);
      tex(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), 'planks', 0, 0.35, 0.15);
      tex(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 18), 'planks', 0, 0.6, 0.15);
      add(new THREE.LatheGeometry([new THREE.Vector2(0.07, 0), new THREE.Vector2(0.11, 0.06), new THREE.Vector2(0.09, 0.16), new THREE.Vector2(0.06, 0.2)], 14), 0xa8683e, 0, 0.62, 0.15, { roughness: 0.6, side: THREE.DoubleSide });
      return true;
    }
    case 'grindstone': {
      for (const x of [-0.3, 0.3]) { board(0.06, 0.6, 0.06, x, 0.3, -0.18); board(0.06, 0.6, 0.06, x, 0.3, 0.18); }
      board(0.7, 0.05, 0.42, 0, 0.6, 0, true);
      tex(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 22).rotateZ(Math.PI / 2), 'stone', 0, 0.62, 0, { tint: 0xc0b8a8 });
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 6).rotateZ(Math.PI / 2), IRON, 0.05, 0.62, 0, iron);
      rod(V(0.47, 0.62, 0), V(0.47, 0.45, 0.1), 0.015, 'planks');
      return true;
    }
    case 'sawhorse':
      board(1.0, 0.07, 0.09, 0, 0.66, 0, true);
      for (const x of [-0.4, 0.4]) for (const z of [-1, 1]) rod(V(x, 0.64, 0), V(x, 0, z * 0.22), 0.025);
      board(1.4, 0.04, 0.25, 0.2, 0.72, 0, true);
      add(new THREE.BoxGeometry(0.3, 0.1, 0.005), 0xb8bcc0, 0.65, 0.78, 0.13, { metalness: 0.8, roughness: 0.3 });
      return true;
    case 'work_table': {
      board(1.6, 0.08, 0.7, 0, 0.84, 0, true);
      for (const [x, z] of [[-0.72, -0.28], [0.72, -0.28], [-0.72, 0.28], [0.72, 0.28]]) board(0.08, 0.8, 0.08, x, 0.4, z);
      board(1.5, 0.04, 0.6, 0, 0.25, 0, true);
      // A vice, a mallet, chisels, a plane, shavings.
      board(0.12, 0.14, 0.14, 0.75, 0.9, 0.3);
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 6).rotateZ(Math.PI / 2), IRON, 0.75, 0.88, 0.38, iron);
      tex(new THREE.BoxGeometry(0.12, 0.08, 0.08), 'planks', -0.4, 0.92, 0.1);
      rod(V(-0.4, 0.92, 0.1), V(-0.4, 0.9, 0.35), 0.012);
      for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.015, 0.012, 0.22), IRON, -0.1 + k * 0.04, 0.887, -0.1, iron);
      tex(new THREE.BoxGeometry(0.25, 0.07, 0.07), 'planks', 0.3, 0.915, -0.05);
      for (let k = 0; k < 6; k++) add(new THREE.TorusGeometry(0.03, 0.006, 3, 8, 4), 0xd8b880, 0.1 + rnd2(k) * 0.4, 0.885, 0.05 + rnd2(k + 3) * 0.2, { roughness: 1 });
      return true;
    }
    // ---------- the kitchen
    case 'pantry_shelf': {
      for (const x of [-0.53, 0.53]) board(0.04, 1.6, 0.38, x, 0.8, 0);
      for (let r = 0; r < 4; r++) board(1.06, 0.03, 0.38, 0, 0.1 + r * 0.45, 0, true);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
        const x = -0.38 + k * 0.25, y = 0.115 + r * 0.45, kind = (r * 4 + k) % 5;
        if (kind === 0) add(new THREE.CylinderGeometry(0.07, 0.08, 0.16, 10), CLAY, x, y + 0.08, 0, { roughness: 0.9 });
        else if (kind === 1) add(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14), 0xe8c060, x, y + 0.04, 0, { roughness: 0.7 });
        else if (kind === 2) add(new THREE.SphereGeometry(0.07, 8, 6), 0xd8c080, x, y + 0.06, 0, { roughness: 0.8 });
        else if (kind === 3) add(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 10), 0x5a3a2a, x, y + 0.1, 0, { roughness: 0.8 });
      }
      add(new THREE.SphereGeometry(0.1, 8, 6).scale(1, 1.5, 0.8), 0x8a3a2a, 0.35, 1.25, 0.1, { roughness: 0.8 });
      return true;
    }
    case 'pot_rack': {
      board(1.2, 0.06, 0.06, 0, 1.55, 0, true);
      for (const x of [-0.5, 0.5]) board(0.04, 0.2, 0.04, x, 1.62, -0.05);
      for (const [x, r] of [[-0.4, 0.13], [-0.05, 0.1], [0.3, 0.12]] as const) {
        add(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4), IRON, x, 1.47, 0, iron);
        add(new THREE.CylinderGeometry(r, r * 0.85, r * 1.2, 12, 1, true), IRON, x, 1.35 - r * 0.6, 0.02, { ...iron, side: THREE.DoubleSide });
      }
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), 0x5a3a24, 0.52, 1.35, 0.02);
      add(new THREE.SphereGeometry(0.04, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), IRON, 0.52, 1.15, 0.02, iron);
      return true;
    }
    case 'herb_rack': {
      tex(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6).rotateZ(Math.PI / 2), 'planks', 0, 1.72, 0);
      const herbs = [0x5a7a3a, 0x7a8a4a, 0x4a6a3a, 0x8a7a5a, 0x6a8a5a];
      for (let k = 0; k < 6; k++) {
        const x = -0.4 + k * 0.16;
        add(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 4), 0x8a7a5a, x, 1.68, 0);
        add(new THREE.ConeGeometry(0.06, 0.28, 7), herbs[k % 5], x, 1.5, 0, { roughness: 1, flatShading: true });
      }
      return true;
    }
    case 'keg': {
      for (const x of [-0.22, 0.22]) board(0.06, 0.18, 0.5, x, 0.09, 0);
      tex(new THREE.CylinderGeometry(0.24, 0.24, 0.6, 16).rotateZ(Math.PI / 2), 'planks', 0, 0.33, 0);
      for (const x of [-0.24, 0, 0.24]) add(new THREE.TorusGeometry(0.245, 0.01, 4, 18).rotateY(Math.PI / 2), IRON, x, 0.33, 0, iron);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6).rotateZ(Math.PI / 2), 0x6a4a2a, 0.34, 0.25, 0);
      return true;
    }
    case 'sack_pile':
      for (const [x, y, z, r] of [[-0.25, 0.2, -0.15, 0.24], [0.25, 0.2, -0.1, 0.25], [0, 0.2, 0.2, 0.23], [0, 0.48, -0.05, 0.22]] as const) {
        const sk = add(new THREE.SphereGeometry(r, 9, 7).scale(1, 0.85, 1.2), 0xb8a070, x, y, z, { roughness: 1 });
        sk.rotation.y = x * 2;
        add(new THREE.CylinderGeometry(0.04, 0.06, 0.08, 6), 0xb8a070, x, y + r * 0.8, z + r * 0.9, { roughness: 1 });
      }
      return true;
    // ---------- the bedroom
    case 'nightstand':
      board(0.44, 0.56, 0.4, 0, 0.3, 0);
      board(0.48, 0.03, 0.44, 0, 0.6, 0, true);
      board(0.38, 0.22, 0.02, 0, 0.32, 0.205);
      knob(0, 0.32, 0.22);
      add(new THREE.CylinderGeometry(0.04, 0.05, 0.02, 10), IRON, -0.1, 0.62, 0, iron);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), 0xf0e6c8, -0.1, 0.69, 0, { roughness: 0.6 });
      add(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), CLAY, 0.1, 0.66, 0.05, { roughness: 0.8 });
      return true;
    case 'clothes_chest':
      board(1.0, 0.44, 0.5, 0, 0.24, 0);
      { const lid = new THREE.CylinderGeometry(0.25, 0.25, 1.0, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.4, 1); tex(lid, 'planks', 0, 0.46, 0); }
      for (const x of [-0.35, 0.35]) add(new THREE.BoxGeometry(0.05, 0.46, 0.52), IRON, x, 0.25, 0, iron);
      add(new THREE.BoxGeometry(0.08, 0.1, 0.02), IRON, 0, 0.38, 0.26, iron);
      return true;
    case 'wool_rug': {
      add(new THREE.BoxGeometry(1.8, 0.012, 1.2), 0x8a2a1e, 0, 0.006, 0, { roughness: 1 });
      add(new THREE.BoxGeometry(1.6, 0.014, 1.0), 0xc89040, 0, 0.007, 0, { roughness: 1 });
      add(new THREE.BoxGeometry(1.4, 0.016, 0.8), 0x8a2a1e, 0, 0.008, 0, { roughness: 1 });
      for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.2, 0.018, 0.2), 0x2a3a5a, -0.45 + k * 0.3, 0.009, 0, { roughness: 1 }).rotation.y = Math.PI / 4;
      return true;
    }
    case 'mirror': {
      for (const x of [-0.27, 0.27]) { board(0.05, 1.6, 0.05, x, 0.8, 0); board(0.05, 0.04, 0.4, x, 0.02, 0); }
      const fr = new THREE.Group();
      fr.position.y = 1.0; fr.rotation.x = -0.08;
      tex(new THREE.BoxGeometry(0.46, 0.9, 0.04), 'planks', 0, 0, 0, { parent: fr });
      add(new THREE.BoxGeometry(0.38, 0.8, 0.01), 0xc8a868, 0, 0, 0.022, { metalness: 0.95, roughness: 0.12 }, fr);
      g.add(fr);
      return true;
    }
    // ---------- music
    case 'instruments': {
      // A tabor drum, and a lute leaning against it.
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 16), 0x8a5a34, 0.12, 0.14, -0.05, { roughness: 0.8 });
      add(new THREE.CircleGeometry(0.2, 16).rotateX(-Math.PI / 2), 0xe0d0b0, 0.12, 0.282, -0.05, { roughness: 1 });
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; bar(V(0.12 + Math.cos(a) * 0.2, 0.02, -0.05 + Math.sin(a) * 0.2), V(0.12 + Math.cos(a + 0.4) * 0.2, 0.26, -0.05 + Math.sin(a + 0.4) * 0.2), 0.004, 0xd8c8a0); }
      const lute = new THREE.Group();
      lute.position.set(-0.15, 0.02, 0.05); lute.rotation.z = -0.35;
      add(new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1.3, 0.6), 0x9a5a2a, 0, 0.22, 0, { roughness: 0.5 }, lute);
      add(new THREE.CircleGeometry(0.17, 16).scale(1, 1.3, 1), 0xd8b070, 0, 0.22, 0.001, { roughness: 0.6 }, lute);
      add(new THREE.CircleGeometry(0.04, 12), 0x2a1a10, 0, 0.26, 0.003, {}, lute);
      add(new THREE.BoxGeometry(0.05, 0.36, 0.03), 0x3a2414, 0, 0.6, 0.0, { roughness: 0.6 }, lute);
      add(new THREE.BoxGeometry(0.07, 0.12, 0.03), 0x3a2414, 0, 0.82, -0.03, { roughness: 0.6 }, lute).rotation.x = -0.6;
      g.add(lute);
      return true;
    }
    case 'harp': {
      board(0.4, 0.06, 0.22, 0, 0.03, 0, true);
      rod(V(-0.15, 0.06, 0), V(-0.12, 1.35, 0), 0.035);
      rod(V(0.15, 0.06, 0), V(0.0, 0.85, 0), 0.04);
      const neck = tex(new THREE.TorusGeometry(0.3, 0.03, 6, 16, Math.PI * 0.8), 'planks', 0.12, 1.1, 0);
      neck.rotation.z = Math.PI * 0.1;
      // Strings from the soundboard up to the neck, shortening toward the pillar.
      for (let k = 0; k < 9; k++) { const t = k / 8; bar(V(0.13 - t * 0.12, 0.12 + t * 0.6, 0), V(0.38 - t * 0.47, 1.12 + t * 0.2, 0), 0.003, 0xd8c8a0); }
      return true;
    }
    // ---------- the chapel
    case 'altar':
      tex(new THREE.BoxGeometry(1.6, 0.95, 0.7), 'stone', 0, 0.475, 0, { tint: 0xc8c2b8 });
      add(new THREE.BoxGeometry(1.64, 0.03, 0.74), 0xf0ece0, 0, 0.965, 0, { roughness: 1 });
      add(new THREE.BoxGeometry(1.64, 0.35, 0.01), 0xf0ece0, 0, 0.8, 0.37, { roughness: 1 });
      add(new THREE.BoxGeometry(0.4, 0.3, 0.012), 0x8a1c1c, 0, 0.78, 0.377, { roughness: 1 });
      add(new THREE.BoxGeometry(0.04, 0.4, 0.04), 0xb89030, 0, 1.18, -0.1, { metalness: 0.8, roughness: 0.3 });
      add(new THREE.BoxGeometry(0.22, 0.04, 0.04), 0xb89030, 0, 1.28, -0.1, { metalness: 0.8, roughness: 0.3 });
      for (const x of [-0.55, 0.55]) {
        add(new THREE.CylinderGeometry(0.02, 0.05, 0.3, 8), 0xb89030, x, 1.13, -0.1, { metalness: 0.8, roughness: 0.3 });
        add(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), 0xf0e6c8, x, 1.36, -0.1, { roughness: 0.6 });
      }
      return true;
    case 'font':
      tex(new THREE.BoxGeometry(0.6, 0.1, 0.6), 'stone', 0, 0.05, 0, { tint: 0xc8c2b8 });
      tex(new THREE.CylinderGeometry(0.15, 0.2, 0.6, 8), 'stone', 0, 0.4, 0, { tint: 0xc8c2b8 });
      tex(new THREE.CylinderGeometry(0.35, 0.22, 0.3, 8, 1, true), 'stone', 0, 0.85, 0, { tint: 0xc8c2b8 });
      tex(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 8), 'stone', 0, 0.71, 0, { tint: 0xc8c2b8 });
      add(new THREE.CircleGeometry(0.31, 8).rotateX(-Math.PI / 2), 0x3f6f8a, 0, 0.94, 0, { roughness: 0.1 });
      return true;
  }
  return false;
}
