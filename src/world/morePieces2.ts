import * as THREE from 'three';
import type { Surface } from './surfaces';

// Models of the second batch of pieces (data/structures): the harbour, the
// farm and the mill, defences, the house, gardens and paths, landmarks.
// Origin at the bottom centre, front toward +z. Parts that turn (sails, a
// waterwheel) carry `userData.spin` and are turned by the view.

type Tex = (geo: THREE.BufferGeometry, surface: Surface, x?: number, y?: number, z?: number, opts?: { turn?: boolean; tint?: number; parent?: THREE.Object3D }) => THREE.Mesh;
type Add = (geo: THREE.BufferGeometry, color: number, x?: number, y?: number, z?: number, extra?: THREE.MeshStandardMaterialParameters, parent?: THREE.Object3D) => THREE.Mesh;

const IRON = 0x2e2c2a, ROPE = 0x8a7a5a, WATER = 0x3f6f8a, LEAF = 0x3f6a2c, LEAF2 = 0x4f7a35, CANVAS = 0xe8dcc0, WOOL_RED = 0x8a1c1c, TAR = 0x1e1a16;
const iron = { metalness: 0.6, roughness: 0.5 };
const stoneT = { tint: 0xc8c2b8 };
const rnd = (i: number) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

export function morePieceMesh2(type: string, g: THREE.Group, tex: Tex, add: Add, state: { lit?: boolean; open?: boolean }): boolean {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, surface: Surface = 'rough_wood', parent?: THREE.Object3D) => {
    const m = tex(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 7), surface, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, { parent });
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: number, extra?: THREE.MeshStandardMaterialParameters, parent?: THREE.Object3D) => {
    const m = add(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6), color, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, extra, parent);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  const post = (x: number, z: number, h: number, r = 0.06, y0 = 0) => tex(new THREE.CylinderGeometry(r * 0.9, r, h, 8), 'rough_wood', x, y0 + h / 2, z);
  /** A flame (flickered by the view while lit). */
  const flame = (x: number, y: number, z: number, r: number, h: number) => {
    if (!state.lit) return;
    const f = add(new THREE.ConeGeometry(r, h, 7), 0xffa030, x, y + h / 2, z, { emissive: 0xff6a00, emissiveIntensity: 2.5, transparent: true, opacity: 0.85 });
    f.castShadow = false;
    f.userData.flame = true;
  };
  /** A pitched roof over a span: two slopes meeting at a ridge along z. */
  const pitched = (w: number, len: number, y: number, rise: number, surface: Surface, tint?: number, z = 0) => {
    const half = w / 2, slope = Math.hypot(half, rise), a = Math.atan2(rise, half);
    for (const s of [-1, 1]) {
      const r = tex(new THREE.BoxGeometry(slope + 0.15, 0.1, len), surface, s * half / 2, y + rise / 2, z, { tint });
      r.rotation.z = -s * a;
    }
  };
  /** A spinning group about an axis. */
  const spinner = (axis: 'x' | 'y' | 'z', speed: number) => { const s = new THREE.Group(); s.userData.spin = { axis, speed }; return s; };

  switch (type) {
    // ---------- the harbour
    case 'boat_shed': {
      for (const x of [-1.6, 1.6]) tex(new THREE.BoxGeometry(1.2, 0.2, 6), 'dark_planks', x, 6.9, 0, { turn: true });
      for (const x of [-2.1, 2.1]) for (const z of [-2.9, 0, 2.9]) tex(new THREE.CylinderGeometry(0.12, 0.13, 9.2, 8), 'rough_wood', x, 4.6, z);
      for (const x of [-1.1, 1.1]) for (const z of [-2.9, 2.9]) tex(new THREE.CylinderGeometry(0.1, 0.11, 6.9, 8), 'rough_wood', x, 3.45, z);
      tex(new THREE.BoxGeometry(4.3, 2.6, 0.12), 'dark_planks', 0, 8.3, -2.95);
      for (const x of [-2.1, 2.1]) tex(new THREE.BoxGeometry(0.1, 2.0, 5.8), 'dark_planks', x, 8.0, 0);
      for (const z of [-2.9, 2.9]) tex(new THREE.BoxGeometry(4.4, 0.16, 0.16), 'rough_wood', 0, 9.2, z, { turn: true });
      pitched(4.8, 6.6, 9.2, 1.6, 'thatch');
      return true;
    }
    case 'plank_bridge': {
      for (const x of [-0.7, 0.7]) tex(new THREE.CylinderGeometry(0.14, 0.14, 4, 8).rotateX(Math.PI / 2), 'rough_wood', x, -0.12, 0);
      tex(new THREE.BoxGeometry(2, 0.12, 4), 'dark_planks', 0, 0.12, 0);
      for (const x of [-0.97, 0.97]) {
        for (const z of [-1.9, -0.6, 0.6, 1.9]) tex(new THREE.BoxGeometry(0.08, 1.0, 0.08), 'rough_wood', x, 0.6, z);
        tex(new THREE.BoxGeometry(0.07, 0.07, 4), 'rough_wood', x, 1.05, 0);
      }
      return true;
    }
    case 'stone_bridge': {
      // The deck and parapets, a round arch under it, the abutments down to the bed.
      tex(new THREE.BoxGeometry(2.8, 0.3, 8), 'stone', 0, 6.85, 0, stoneT);
      for (const x of [-1.3, 1.3]) { tex(new THREE.BoxGeometry(0.2, 0.7, 8), 'stone_wall', x, 7.35, 0); tex(new THREE.BoxGeometry(0.26, 0.08, 8.04), 'stone', x, 7.72, 0, stoneT); }
      const sh = new THREE.Shape([new THREE.Vector2(-4, 0), new THREE.Vector2(-4, 6.7), new THREE.Vector2(4, 6.7), new THREE.Vector2(4, 0), new THREE.Vector2(2.8, 0)]);
      sh.absarc(0, 3.4, 2.8, 0, Math.PI, false);
      sh.lineTo(-2.8, 0);
      const arch = tex(new THREE.ExtrudeGeometry(sh, { depth: 2.8, bevelEnabled: false, curveSegments: 20 }).translate(0, 0, -1.4), 'stone_wall', 0, 0, 0);
      arch.rotation.y = Math.PI / 2;
      return true;
    }
    case 'channel_marker':
      tex(new THREE.CylinderGeometry(0.1, 0.13, 7.0, 8), 'rough_wood', 0, 3.5, 0);
      add(new THREE.CylinderGeometry(0.22, 0.2, 0.42, 12), TAR, 0, 7.0, 0, { roughness: 0.6 });
      for (const y of [6.85, 7.15]) add(new THREE.TorusGeometry(0.22, 0.012, 4, 14).rotateX(Math.PI / 2), IRON, 0, y, 0, iron);
      add(new THREE.BoxGeometry(0.3, 0.2, 0.02), WOOL_RED, 0, 6.5, 0.11, { roughness: 1 });
      return true;
    case 'waterwheel': {
      // The frame: a post and a beam carrying the axle, a sluice trough over the wheel.
      tex(new THREE.BoxGeometry(1.0, 8.0, 0.6), 'rough_wood', -1.1, 4.0, 0);
      tex(new THREE.BoxGeometry(0.3, 5.2, 0.3), 'rough_wood', 0.75, 2.6, 0);
      tex(new THREE.CylinderGeometry(0.14, 0.14, 2.4, 8).rotateZ(Math.PI / 2), 'rough_wood', -0.2, 5.2, 0);
      const wheel = spinner('x', -0.9);
      wheel.position.set(0, 5.2, 0);
      for (const x of [-0.45, 0.45]) { const rim = tex(new THREE.TorusGeometry(2.35, 0.08, 6, 32), 'rough_wood', x, 0, 0, { parent: wheel }); rim.rotation.y = Math.PI / 2; }
      for (const x of [-0.45, 0.45]) for (let k = 0; k < 4; k++) { const sp = tex(new THREE.BoxGeometry(0.1, 0.1, 4.7), 'rough_wood', x, 0, 0, { parent: wheel }); sp.rotation.x = (k / 4) * Math.PI; }
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, pad = tex(new THREE.BoxGeometry(1.0, 0.06, 0.55), 'planks', 0, Math.sin(a) * 2.35, Math.cos(a) * 2.35, { parent: wheel });
        pad.rotation.x = -a;
      }
      g.add(wheel);
      return true;
    }
    case 'fish_weir': {
      for (let k = 0; k <= 7; k++) tex(new THREE.CylinderGeometry(0.03, 0.04, 3.4, 6), 'rough_wood', -1.5 + k * (3 / 7), 1.7, 0);
      for (let r = 0; r < 12; r++) add(new THREE.BoxGeometry(3, 0.06, 0.04), 0x6b5233, 0, 1.2 + r * 0.17, (r % 2 ? 1 : -1) * 0.025, { roughness: 1 });
      // The wicker trap at its point.
      const trap = add(new THREE.ConeGeometry(0.35, 1.0, 10, 1, true).rotateX(Math.PI / 2), 0x8a6a40, 1.7, 2.9, 0.4, { roughness: 1, side: THREE.DoubleSide });
      trap.rotation.y = 0.4;
      return true;
    }
    case 'ship_anchor': {
      const a = new THREE.Group();
      a.rotation.z = 0.35;
      a.position.set(0, 0.05, 0);
      bar(V(0, 0.15, 0), V(0, 1.3, 0), 0.05, IRON, iron, a);
      const arms = add(new THREE.TorusGeometry(0.45, 0.05, 6, 16, Math.PI), IRON, 0, 0.6, 0, iron, a);
      arms.rotation.z = Math.PI;
      for (const x of [-0.45, 0.45]) add(new THREE.ConeGeometry(0.1, 0.22, 4), IRON, x, 0.7, 0, iron, a);
      tex(new THREE.BoxGeometry(0.9, 0.1, 0.1), 'rough_wood', 0, 1.15, 0, { turn: true, parent: a });
      add(new THREE.TorusGeometry(0.1, 0.025, 6, 12), IRON, 0, 1.38, 0, iron, a);
      g.add(a);
      add(new THREE.TorusGeometry(0.28, 0.05, 6, 16).rotateX(Math.PI / 2), ROPE, 0.6, 0.05, 0.1, { roughness: 1 });
      add(new THREE.TorusGeometry(0.2, 0.05, 6, 16).rotateX(Math.PI / 2), ROPE, 0.6, 0.13, 0.1, { roughness: 1 });
      return true;
    }
    case 'cargo_pile': {
      for (const [x, y, z, s] of [[-0.55, 0.3, -0.35, 0.6], [0.1, 0.3, -0.4, 0.6], [-0.25, 0.85, -0.35, 0.5]] as const) {
        tex(new THREE.BoxGeometry(s, s, s), 'planks', x, y, z);
      }
      for (const [x, z] of [[0.7, -0.3], [0.7, 0.35]]) {
        tex(new THREE.CylinderGeometry(0.26, 0.26, 0.7, 14), 'planks', x, 0.35, z);
        for (const y of [0.1, 0.6]) add(new THREE.TorusGeometry(0.265, 0.012, 4, 16).rotateX(Math.PI / 2), IRON, x, y, z, iron);
      }
      for (const [x, z] of [[-0.4, 0.4], [0.05, 0.45]]) { const b = add(new THREE.BoxGeometry(0.5, 0.35, 0.4), 0xb8a070, x, 0.18, z, { roughness: 1 }); b.rotation.y = x; }
      // A net thrown over the top.
      for (let k = 0; k < 6; k++) bar(V(-0.8 + k * 0.3, 1.12, -0.6), V(-0.8 + k * 0.3, 0.05, 0.75), 0.008, ROPE, { roughness: 1 });
      return true;
    }

    // ---------- the farm and the mill
    case 'windmill': {
      // A round stone tower, a thatched cap, the sails on a shaft facing +z.
      tex(new THREE.CylinderGeometry(1.4, 1.8, 6.0, 18), 'stone_wall', 0, 3.0, 0);
      tex(new THREE.ConeGeometry(1.75, 1.8, 18), 'thatch', 0, 6.85, 0);
      tex(new THREE.BoxGeometry(0.9, 1.6, 0.1), 'dark_planks', 0, 0.8, 1.72);
      for (const y of [2.6, 4.4]) add(new THREE.BoxGeometry(0.4, 0.5, 0.1), 0x1a1612, 0, y, 1.5 + (4.4 - y) * 0.05, { roughness: 1 });
      tex(new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8).rotateX(Math.PI / 2), 'rough_wood', 0, 6.0, 1.7);
      const sails = spinner('z', 0.6);
      sails.position.set(0, 6.0, 2.25);
      for (let k = 0; k < 4; k++) {
        const arm = new THREE.Group();
        arm.rotation.z = (k / 4) * Math.PI * 2 + 0.3;
        tex(new THREE.BoxGeometry(0.14, 5.0, 0.14), 'rough_wood', 0, 2.5, 0, { parent: arm });
        add(new THREE.BoxGeometry(0.9, 3.8, 0.03), CANVAS, 0.5, 3.0, 0.05, { roughness: 1, side: THREE.DoubleSide }, arm);
        for (let r = 0; r < 6; r++) tex(new THREE.BoxGeometry(1.0, 0.04, 0.05), 'rough_wood', 0.5, 1.2 + r * 0.72, 0.08, { turn: true, parent: arm });
        sails.add(arm);
      }
      add(new THREE.SphereGeometry(0.22, 10, 8), 0x3a2a1c, 0, 0, 0, {}, sails);
      g.add(sails);
      return true;
    }
    case 'stone_well': {
      tex(new THREE.CylinderGeometry(0.85, 0.9, 0.9, 18, 1, true), 'stone_wall', 0, 0.45, 0);
      add(new THREE.CylinderGeometry(0.66, 0.66, 0.9, 18, 1, true), 0x4a4640, 0, 0.45, 0, { side: THREE.BackSide, roughness: 1 });
      tex(new THREE.RingGeometry(0.64, 0.92, 18).rotateX(-Math.PI / 2), 'stone', 0, 0.91, 0, stoneT);
      add(new THREE.CircleGeometry(0.66, 18).rotateX(-Math.PI / 2), 0x10181c, 0, 0.35, 0, { roughness: 0.15 });
      for (const x of [-0.8, 0.8]) tex(new THREE.BoxGeometry(0.14, 2.3, 0.14), 'rough_wood', x, 1.15, 0);
      tex(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 8).rotateZ(Math.PI / 2), 'rough_wood', 0, 1.75, 0);
      bar(V(0.95, 1.75, 0), V(0.95, 1.5, 0.25), 0.02, IRON, iron);
      add(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 4), ROPE, 0.1, 1.2, 0, { roughness: 1 });
      tex(new THREE.CylinderGeometry(0.13, 0.1, 0.22, 10), 'planks', 0.1, 0.62, 0);
      pitched(1.9, 1.2, 2.3, 0.6, 'rough_wood', 0x9a7a5a);
      return true;
    }
    case 'rain_barrel':
      tex(new THREE.CylinderGeometry(0.3, 0.32, 0.9, 16), 'planks', 0, 0.45, 0);
      for (const y of [0.12, 0.45, 0.78]) add(new THREE.TorusGeometry(0.32, 0.012, 5, 20).rotateX(Math.PI / 2), IRON, 0, y, 0, iron);
      add(new THREE.CircleGeometry(0.28, 16).rotateX(-Math.PI / 2), WATER, 0, 0.86, 0, { roughness: 0.1 });
      tex(new THREE.BoxGeometry(0.1, 0.06, 0.6), 'rough_wood', 0, 0.95, -0.2);
      return true;
    case 'bread_oven': {
      tex(new THREE.BoxGeometry(1.6, 0.6, 1.6), 'stone_wall', 0, 0.3, 0);
      add(new THREE.SphereGeometry(0.75, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xa8683e, 0, 0.6, 0, { roughness: 1 });
      add(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), 0x1a1210, 0, 0.6, 0.68, { roughness: 1 });
      tex(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 8), 'stone', 0.2, 1.4, -0.25, stoneT);
      tex(new THREE.BoxGeometry(0.5, 0.06, 0.3), 'stone', 0, 0.62, 0.85, stoneT);
      flame(0, 0.62, 0.55, 0.16, 0.3);
      return true;
    }
    case 'smokehouse': {
      tex(new THREE.BoxGeometry(1.9, 1.7, 1.9), 'dark_planks', 0, 0.85, 0);
      add(new THREE.BoxGeometry(0.7, 1.3, 0.02), 0x2a1e14, 0, 0.7, 0.96, { roughness: 1 });
      pitched(2.2, 2.2, 1.7, 0.7, 'thatch');
      tex(new THREE.BoxGeometry(0.4, 0.3, 0.4), 'stone', 0, 2.5, 0, stoneT);
      // Smoke curling out of the vent, when it's going.
      if (state.lit) for (let k = 0; k < 3; k++) { const p = add(new THREE.SphereGeometry(0.2 + k * 0.08, 8, 6), 0xb0aca4, 0.05 * k, 2.8 + k * 0.35, 0, { transparent: true, opacity: 0.35 - k * 0.08, roughness: 1 }); p.castShadow = false; }
      return true;
    }
    case 'beehive': {
      for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) post(x, z, 0.45, 0.025);
      tex(new THREE.BoxGeometry(0.55, 0.05, 0.55), 'planks', 0, 0.47, 0);
      const skep = new THREE.LatheGeometry(Array.from({ length: 9 }, (_, k) => new THREE.Vector2(0.26 * Math.cos((k / 8) * Math.PI / 2) + 0.001, 0.5 * Math.sin((k / 8) * Math.PI / 2))), 16);
      tex(skep, 'thatch', 0, 0.5, 0);
      for (let k = 0; k < 4; k++) add(new THREE.TorusGeometry(0.25 - k * 0.05, 0.012, 4, 16).rotateX(Math.PI / 2), 0x8a7040, 0, 0.55 + k * 0.11, 0, { roughness: 1 });
      add(new THREE.BoxGeometry(0.08, 0.05, 0.02), 0x140e08, 0, 0.53, 0.26);
      return true;
    }
    case 'chicken_coop': {
      for (const [x, z] of [[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5]]) post(x, z, 0.5, 0.04);
      tex(new THREE.BoxGeometry(1.5, 0.6, 1.1), 'planks', 0, 0.8, 0);
      pitched(1.7, 1.3, 1.1, 0.4, 'thatch');
      add(new THREE.BoxGeometry(0.22, 0.28, 0.02), 0x1a1410, 0.4, 0.75, 0.56);
      const ramp = tex(new THREE.BoxGeometry(0.25, 0.03, 0.8), 'planks', 0.4, 0.3, 0.85);
      ramp.rotation.x = 0.65;
      for (const [x, z] of [[-0.3, 0.9], [0.0, 1.2]]) {
        add(new THREE.SphereGeometry(0.11, 8, 6).scale(1, 0.9, 1.3), 0xe8e0d0, x, 0.13, z, { roughness: 1 });
        add(new THREE.SphereGeometry(0.06, 8, 6), 0xe8e0d0, x, 0.25, z + 0.1, { roughness: 1 });
        add(new THREE.BoxGeometry(0.03, 0.05, 0.02), 0xc02020, x, 0.32, z + 0.1);
      }
      return true;
    }
    case 'dovecote': {
      tex(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 8), 'rough_wood', 0, 1.1, 0);
      tex(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 6), 'planks', 0, 2.55, 0);
      tex(new THREE.ConeGeometry(0.72, 0.6, 6), 'rough_wood', 0, 3.3, 0, { tint: 0x9a7a5a });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        for (const y of [2.35, 2.75]) add(new THREE.BoxGeometry(0.12, 0.14, 0.02), 0x1a1410, Math.sin(a) * 0.5, y, Math.cos(a) * 0.5).rotation.y = a;
      }
      add(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 0.9, 1.4), 0xd8d8e0, 0.2, 3.05, 0.35, { roughness: 1 });
      return true;
    }
    case 'drying_rack': {
      for (const x of [-0.85, 0.85]) { rod(V(x, 0, -0.25), V(x, 1.6, 0), 0.03); rod(V(x, 0, 0.25), V(x, 1.6, 0), 0.03); }
      rod(V(-0.95, 1.55, 0), V(0.95, 1.55, 0), 0.03);
      rod(V(-0.95, 1.1, 0), V(0.95, 1.1, 0), 0.025);
      add(new THREE.BoxGeometry(0.8, 0.7, 0.01), 0xa07a52, -0.35, 0.95, 0.02, { roughness: 1 }).rotation.z = 0.05;
      for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.06, 0.35 + rnd(k) * 0.1, 0.015), k % 2 ? 0x7a2a1e : 0x9a8a6a, 0.25 + k * 0.13, 1.33, 0, { roughness: 0.8 });
      return true;
    }
    case 'manger': {
      tex(new THREE.BoxGeometry(1.8, 0.35, 0.6), 'planks', 0, 0.35, 0.05);
      for (const x of [-0.85, 0.85]) post(x, -0.3, 1.0, 0.04);
      for (let k = 0; k < 9; k++) rod(V(-0.8 + k * 0.2, 0.55, 0.3), V(-0.8 + k * 0.2, 1.0, -0.3), 0.015);
      tex(new THREE.BoxGeometry(1.8, 0.05, 0.05), 'rough_wood', 0, 1.0, -0.3, { turn: true });
      for (let k = 0; k < 7; k++) add(new THREE.SphereGeometry(0.18, 7, 5).scale(1.3, 0.8, 1), 0xc8a860, -0.65 + k * 0.22, 0.85, -0.05, { roughness: 1 });
      return true;
    }

    // ---------- defences
    case 'crenellation':
      tex(new THREE.BoxGeometry(2, 0.8, 0.4), 'stone_wall', 0, 0.4, 0);
      for (const x of [-0.65, 0.65]) { tex(new THREE.BoxGeometry(0.7, 0.5, 0.4), 'stone_wall', x, 1.05, 0); tex(new THREE.BoxGeometry(0.74, 0.06, 0.44), 'stone', x, 1.32, 0, stoneT); }
      tex(new THREE.BoxGeometry(0.6, 0.06, 0.44), 'stone', 0, 0.82, 0, stoneT);
      return true;
    case 'arrow_slit_wall':
      for (const x of [-0.53, 0.53]) tex(new THREE.BoxGeometry(0.94, 2, 0.4), 'stone_wall', x, 1, 0);
      tex(new THREE.BoxGeometry(0.12, 0.8, 0.4), 'stone_wall', 0, 0.4, 0);
      tex(new THREE.BoxGeometry(0.12, 0.5, 0.4), 'stone_wall', 0, 1.75, 0);
      // The loop's splay inside.
      for (const x of [-0.09, 0.09]) { const sp = tex(new THREE.BoxGeometry(0.06, 0.7, 0.22), 'stone', x, 1.15, -0.1, stoneT); sp.rotation.y = x > 0 ? -0.5 : 0.5; }
      tex(new THREE.BoxGeometry(2.04, 0.1, 0.44), 'stone', 0, 1.95, 0, stoneT);
      return true;
    case 'portcullis': {
      for (const x of [-0.8, 0.8]) tex(new THREE.BoxGeometry(0.4, 3, 0.6), 'stone_wall', x, 1.5, 0);
      const sh = new THREE.Shape([new THREE.Vector2(-0.6, 2.2), new THREE.Vector2(-0.6, 3.0), new THREE.Vector2(0.6, 3.0), new THREE.Vector2(0.6, 2.2)]);
      sh.absarc(0, 2.2, 0.6, 0, Math.PI, false);
      tex(new THREE.ExtrudeGeometry(sh, { depth: 0.6, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -0.3), 'stone_wall', 0, 0, 0);
      tex(new THREE.BoxGeometry(2.04, 0.12, 0.66), 'stone', 0, 2.98, 0, stoneT);
      // The grille: wound up into the arch when open.
      const grille = new THREE.Group();
      grille.position.y = state.open ? 2.1 : 0;
      for (let k = 0; k < 6; k++) { bar(V(-0.5 + k * 0.2, 0.05, 0), V(-0.5 + k * 0.2, 2.6, 0), 0.025, IRON, iron, grille); add(new THREE.ConeGeometry(0.035, 0.12, 4).rotateX(Math.PI), IRON, -0.5 + k * 0.2, 0.0, 0, iron, grille); }
      for (let r = 0; r < 5; r++) add(new THREE.BoxGeometry(1.15, 0.04, 0.04), IRON, 0, 0.35 + r * 0.5, 0, iron, grille);
      g.add(grille);
      return true;
    }
    case 'stockade_gate': {
      for (const side of [-1, 1]) {
        const leaf = new THREE.Group();
        leaf.position.set(side, 0, 0);
        for (let i = 0; i < 4; i++) {
          const x = -side * (0.125 + i * 0.25), h = 2.75 + rnd(i + (side > 0 ? 9 : 0)) * 0.15;
          tex(new THREE.CylinderGeometry(0.12, 0.13, h, 9), 'rough_wood', x, h / 2, 0, { parent: leaf });
          tex(new THREE.ConeGeometry(0.12, 0.35, 9), 'rough_wood', x, h + 0.17, 0, { parent: leaf });
        }
        for (const y of [0.7, 2.1]) tex(new THREE.BoxGeometry(0.95, 0.12, 0.08), 'rough_wood', -side * 0.5, y, 0.16, { turn: true, parent: leaf });
        if (state.open) leaf.rotation.y = side * Math.PI / 2;
        g.add(leaf);
      }
      return true;
    }
    case 'barricade': {
      tex(new THREE.CylinderGeometry(0.15, 0.15, 2.0, 9).rotateZ(Math.PI / 2), 'rough_wood', 0, 0.35, 0);
      for (let k = 0; k < 7; k++) {
        const x = -0.85 + k * 0.28, s = k % 2 ? 1 : -1;
        rod(V(x, 0.05, -s * 0.45), V(x, 0.95, s * 0.45), 0.04);
        tex(new THREE.ConeGeometry(0.04, 0.12, 6), 'rough_wood', x, 0.98, s * 0.47).rotation.x = s * 0.78;
      }
      return true;
    }
    case 'training_dummy':
      tex(new THREE.CylinderGeometry(0.05, 0.06, 1.8, 7), 'rough_wood', 0, 0.9, 0);
      tex(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6).rotateZ(Math.PI / 2), 'rough_wood', 0, 1.35, 0);
      add(new THREE.CylinderGeometry(0.2, 0.18, 0.7, 10), 0x6e4628, 0, 1.15, 0, { roughness: 0.9 });
      add(new THREE.SphereGeometry(0.15, 10, 8), 0xc8b070, 0, 1.68, 0, { roughness: 1 });
      add(new THREE.CylinderGeometry(0.22, 0.1, 0.12, 10), 0xc8b070, 0, 0.75, 0, { roughness: 1 });
      return true;
    case 'archery_target': {
      for (const [x, z] of [[-0.45, -0.25], [0.45, -0.25]]) rod(V(x, 0, z), V(x * 0.5, 1.4, 0), 0.03);
      rod(V(0, 0, -0.5), V(0, 1.4, 0), 0.03);
      const boss = new THREE.Group();
      boss.position.set(0, 0.95, 0.08); boss.rotation.x = -0.15;
      tex(new THREE.CylinderGeometry(0.55, 0.55, 0.22, 20).rotateX(Math.PI / 2), 'thatch', 0, 0, 0, { parent: boss });
      [[0.5, 0xe8dcc0], [0.38, 0x2a2a2a], [0.26, 0x3a5a9a], [0.15, WOOL_RED], [0.06, 0xe8c040]].forEach(([r, c], k) => add(new THREE.CircleGeometry(r as number, 20), c as number, 0, 0, 0.112 + k * 0.002, { roughness: 1 }, boss));
      g.add(boss);
      return true;
    }

    // ---------- the house
    case 'roof_ridge': {
      const r = tex(new THREE.BoxGeometry(2.04, 0.18, 0.18), 'thatch', 0, 0.1, 0, { turn: true });
      r.rotation.x = Math.PI / 4;
      tex(new THREE.CylinderGeometry(0.06, 0.06, 2.04, 7).rotateZ(Math.PI / 2), 'rough_wood', 0, 0.2, 0);
      return true;
    }
    case 'fireplace': {
      for (const x of [-0.65, 0.65]) tex(new THREE.BoxGeometry(0.5, 1.3, 0.8), 'stone_wall', x, 0.65, -0.1);
      tex(new THREE.BoxGeometry(1.8, 0.8, 0.8), 'stone_wall', 0, 1.6, -0.1);
      tex(new THREE.BoxGeometry(1.9, 0.12, 0.9), 'stone', 0, 1.25, -0.05, stoneT);
      tex(new THREE.BoxGeometry(1.2, 0.1, 0.8), 'stone', 0, 0.05, 0.1, stoneT);
      add(new THREE.BoxGeometry(0.8, 1.2, 0.05), 0x1a1612, 0, 0.6, -0.48, { roughness: 1 });
      // Fire irons and a log or two.
      for (let k = 0; k < 3; k++) tex(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 7).rotateZ(Math.PI / 2), 'rough_wood', 0, 0.16 + (k === 2 ? 0.1 : 0), -0.15 + (k === 2 ? 0 : k * 0.15 - 0.07));
      flame(0, 0.2, -0.15, 0.26, 0.55);
      return true;
    }
    case 'lantern_post': {
      tex(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 8), 'rough_wood', 0, 1.2, 0);
      bar(V(0, 2.3, 0), V(0, 2.3, 0.35), 0.015, IRON, iron);
      bar(V(0, 2.0, 0), V(0, 2.3, 0.25), 0.012, IRON, iron);
      add(new THREE.BoxGeometry(0.18, 0.24, 0.18), state.lit ? 0xffd890 : 0x5a5a50, 0, 2.05, 0.35, { transparent: true, opacity: 0.6, emissive: state.lit ? 0xffa040 : 0, emissiveIntensity: state.lit ? 1.5 : 0 });
      add(new THREE.ConeGeometry(0.15, 0.12, 4), IRON, 0, 2.23, 0.35, iron).rotation.y = Math.PI / 4;
      add(new THREE.BoxGeometry(0.2, 0.02, 0.2), IRON, 0, 1.93, 0.35, iron);
      flame(0, 1.98, 0.35, 0.03, 0.08);
      return true;
    }
    case 'candelabrum': {
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; bar(V(0, 0.15, 0), V(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22), 0.015, IRON, iron); }
      bar(V(0, 0.1, 0), V(0, 1.3, 0), 0.02, IRON, iron);
      for (const [x, y] of [[-0.3, 1.32], [-0.15, 1.4], [0, 1.45], [0.15, 1.4], [0.3, 1.32]]) {
        bar(V(0, 1.2, 0), V(x, y - 0.05, 0), 0.01, IRON, iron);
        add(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), IRON, x, y - 0.03, 0, iron);
        add(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8), 0xf0e6c8, x, y + 0.06, 0, { roughness: 0.6 });
        flame(x, y + 0.13, 0, 0.015, 0.05);
      }
      return true;
    }
    case 'shuttered_window': {
      for (const [w, h, x, y] of [[2, 0.9, 0, 0.45], [2, 0.4, 0, 1.8], [0.55, 0.7, -0.725, 1.25], [0.55, 0.7, 0.725, 1.25]]) tex(new THREE.BoxGeometry(w, h, 0.16), 'dark_planks', x, y, 0);
      for (const [w, h, x, y, turn] of [[1.02, 0.08, 0, 0.94, true], [1.02, 0.08, 0, 1.56, true], [0.08, 0.7, -0.47, 1.25, false], [0.08, 0.7, 0.47, 1.25, false]] as [number, number, number, number, boolean][]) {
        tex(new THREE.BoxGeometry(w, h, 0.2), 'rough_wood', x, y, 0, { turn });
      }
      // Two shutters on the outside (+z), hinged at the sides of the opening.
      for (const side of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.position.set(side * 0.45, 0, 0.11);
        tex(new THREE.BoxGeometry(0.45, 0.62, 0.04), 'planks', -side * 0.225, 1.25, 0.02, { parent: hinge });
        for (const y of [1.05, 1.45]) add(new THREE.BoxGeometry(0.3, 0.03, 0.01), IRON, -side * 0.2, y, 0.045, iron, hinge);
        if (state.open) hinge.rotation.y = side * Math.PI * 0.6;
        g.add(hinge);
      }
      return true;
    }
    case 'privy': {
      tex(new THREE.BoxGeometry(1.2, 2.2, 0.12), 'dark_planks', 0, 1.1, -0.5);
      for (const x of [-0.55, 0.55]) tex(new THREE.BoxGeometry(0.12, 2.2, 1.1), 'dark_planks', x, 1.1, 0);
      tex(new THREE.BoxGeometry(1.1, 0.5, 0.4), 'planks', 0, 0.25, -0.25);
      const door = tex(new THREE.BoxGeometry(1.0, 2.0, 0.06), 'planks', 0, 1.0, 0.53);
      door.rotation.y = 0.12;
      add(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1, 0.2), 0x1a1410, 0, 1.75, 0.57);
      const roof = tex(new THREE.BoxGeometry(1.4, 0.06, 1.4), 'rough_wood', 0, 2.28, 0, { tint: 0x9a7a5a });
      roof.rotation.x = 0.15;
      return true;
    }

    // ---------- gardens and paths
    case 'cobble_path': {
      add(new THREE.BoxGeometry(2, 0.03, 2), 0x5a564e, 0, 0.015, 0, { roughness: 1 });
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
        const k = i * 9 + j, s = 0.09 + rnd(k) * 0.03;
        const c = tex(new THREE.SphereGeometry(s, 6, 4).scale(1, 0.35, 1), 'stone', -0.88 + i * 0.22 + (j % 2) * 0.1, 0.03, -0.88 + j * 0.22, { tint: 0xa8a49c - Math.floor(rnd(k + 5) * 4) * 0x0a0a0a });
        c.rotation.y = rnd(k + 7) * 3;
      }
      return true;
    }
    case 'gravel_path': {
      add(new THREE.BoxGeometry(1.8, 0.04, 1.8), 0xb8b0a0, 0, 0.02, 0, { roughness: 1 });
      for (let k = 0; k < 40; k++) add(new THREE.SphereGeometry(0.02 + rnd(k) * 0.015, 5, 3), 0x8a8478, -0.85 + rnd(k + 1) * 1.7, 0.045, -0.85 + rnd(k + 2) * 1.7, { roughness: 1 });
      for (const x of [-0.95, 0.95]) for (let k = 0; k < 6; k++) tex(new THREE.BoxGeometry(0.12, 0.08, 0.3), 'stone', x, 0.04, -0.83 + k * 0.33, stoneT);
      return true;
    }
    case 'boardwalk':
      for (const x of [-0.7, 0.7]) tex(new THREE.BoxGeometry(0.14, 0.08, 2), 'rough_wood', x, 0.04, 0);
      for (let k = 0; k < 9; k++) tex(new THREE.BoxGeometry(2, 0.06, 0.2), 'dark_planks', 0, 0.12, -0.88 + k * 0.22, { turn: true });
      return true;
    case 'stepping_stones':
      for (let k = 0; k < 4; k++) {
        const s = tex(new THREE.CylinderGeometry(0.28 + rnd(k) * 0.06, 0.3, 0.1, 9), 'stone', -0.55 + k * 0.38, 0.05, (k % 2 ? 0.25 : -0.25), stoneT);
        s.rotation.y = rnd(k + 3) * 2;
      }
      return true;
    case 'hedge': {
      add(new THREE.BoxGeometry(2, 1.15, 0.7), LEAF, 0, 0.6, 0, { roughness: 1 });
      for (let k = 0; k < 14; k++) add(new THREE.IcosahedronGeometry(0.18 + rnd(k) * 0.08, 0), k % 2 ? LEAF : LEAF2, -0.9 + rnd(k + 1) * 1.8, 0.2 + rnd(k + 2) * 1.0, (rnd(k + 3) > 0.5 ? 1 : -1) * 0.33, { flatShading: true, roughness: 1 });
      return true;
    }
    case 'topiary':
      add(new THREE.LatheGeometry([new THREE.Vector2(0.13, 0), new THREE.Vector2(0.18, 0.28), new THREE.Vector2(0.2, 0.3)], 14), 0xa0583a, 0, 0, 0, { side: THREE.DoubleSide, roughness: 0.9 });
      add(new THREE.ConeGeometry(0.33, 0.9, 10), LEAF, 0, 0.75, 0, { roughness: 1, flatShading: true });
      return true;
    case 'garden_arch': {
      for (const x of [-0.75, 0.75]) for (const z of [-0.15, 0.15]) rod(V(x, 0, z), V(x, 2.0, z), 0.025);
      for (const z of [-0.15, 0.15]) { const a = tex(new THREE.TorusGeometry(0.75, 0.025, 5, 18, Math.PI), 'rough_wood', 0, 2.0, z); a.rotation.z = 0; }
      for (let k = 0; k < 7; k++) rod(V(-0.75 + k * 0.25, 2.0 + Math.sin((k / 6) * Math.PI) * 0.7, -0.17), V(-0.75 + k * 0.25, 2.0 + Math.sin((k / 6) * Math.PI) * 0.7, 0.17), 0.015);
      for (let k = 0; k < 22; k++) {
        const t = k / 21, ang = Math.PI * (1 - t), side = t < 0.5 ? -1 : 1;
        const up = rnd(k) < 0.4, x = up ? Math.cos(ang) * 0.75 : side * 0.75, y = up ? 2.0 + Math.sin(ang) * 0.75 : 0.3 + rnd(k + 1) * 1.6;
        add(new THREE.IcosahedronGeometry(0.12, 0), LEAF, x, y, (rnd(k + 2) - 0.5) * 0.3, { flatShading: true });
        if (k % 2) add(new THREE.SphereGeometry(0.045, 6, 5), k % 4 === 1 ? 0xd03a4a : 0xf0a0b0, x + 0.05, y + 0.06, 0.12, { roughness: 0.8 });
      }
      return true;
    }
    case 'stone_bench':
      tex(new THREE.BoxGeometry(1.6, 0.1, 0.44), 'stone', 0, 0.41, 0, stoneT);
      for (const x of [-0.6, 0.6]) tex(new THREE.BoxGeometry(0.25, 0.36, 0.36), 'stone_wall', x, 0.18, 0);
      return true;
    case 'sundial':
      tex(new THREE.BoxGeometry(0.4, 0.1, 0.4), 'stone', 0, 0.05, 0, stoneT);
      tex(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 10), 'stone', 0, 0.5, 0, stoneT);
      tex(new THREE.CylinderGeometry(0.25, 0.22, 0.06, 18), 'stone', 0, 0.93, 0, stoneT);
      add(new THREE.CircleGeometry(0.22, 18).rotateX(-Math.PI / 2), 0xb08a40, 0, 0.965, 0, iron);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; add(new THREE.BoxGeometry(0.01, 0.002, 0.05), 0x3a2a10, Math.sin(a) * 0.17, 0.968, Math.cos(a) * 0.17).rotation.y = a; }
      { const gn = add(new THREE.ConeGeometry(0.1, 0.16, 3).scale(0.15, 1, 1), 0x8a6a30, 0, 1.03, 0, iron); gn.rotation.x = 0.4; }
      return true;
    case 'garden_pond': {
      add(new THREE.CircleGeometry(1.05, 24).rotateX(-Math.PI / 2), 0x2f5a6a, 0, 0.08, 0, { roughness: 0.08, metalness: 0.1 });
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, st = tex(new THREE.DodecahedronGeometry(0.16 + rnd(k) * 0.05), 'stone', Math.cos(a) * 1.12, 0.08, Math.sin(a) * 1.12, stoneT);
        st.scale.y = 0.6;
      }
      for (const [x, z] of [[0.3, -0.2], [-0.4, 0.35], [0.1, 0.5]]) {
        add(new THREE.CircleGeometry(0.12, 10, 0.3, Math.PI * 1.8).rotateX(-Math.PI / 2), 0x3e7a2a, x, 0.09, z, { roughness: 0.6 });
      }
      add(new THREE.SphereGeometry(0.05, 6, 5), 0xf0d0e0, 0.3, 0.12, -0.2, { roughness: 0.8 });
      for (let k = 0; k < 5; k++) add(new THREE.CylinderGeometry(0.01, 0.012, 0.6, 4), 0x5a7a3a, -0.9 + rnd(k) * 0.2, 0.3, -0.5 + k * 0.08);
      return true;
    }

    // ---------- landmarks, the village, the camp
    case 'standing_stone': {
      const s = tex(new THREE.BoxGeometry(0.75, 2.8, 0.45, 2, 4, 2), 'stone', 0, 1.4, 0, { tint: 0x9a968e });
      const p = s.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - (y + 1.4) * 0.12) + (rnd(i) - 0.5) * 0.06); p.setZ(i, p.getZ(i) + (rnd(i + 50) - 0.5) * 0.05); }
      s.geometry.computeVertexNormals();
      s.rotation.z = 0.05;
      return true;
    }
    case 'gravestone': {
      const sh = new THREE.Shape([new THREE.Vector2(-0.32, 0), new THREE.Vector2(0.32, 0), new THREE.Vector2(0.32, 0.6)]);
      sh.absarc(0, 0.6, 0.32, 0, Math.PI, false);
      tex(new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -0.07), 'stone', 0, 0, 0, { tint: 0xb8b4ac });
      add(new THREE.BoxGeometry(0.04, 0.3, 0.01), 0x4a4640, 0, 0.62, 0.075);
      add(new THREE.BoxGeometry(0.2, 0.04, 0.01), 0x4a4640, 0, 0.68, 0.075);
      add(new THREE.BoxGeometry(0.5, 0.04, 1.2), 0x4a6a2a, 0, 0.02, 0.7, { roughness: 1 });
      return true;
    }
    case 'wayside_cross':
      for (let k = 0; k < 3; k++) tex(new THREE.BoxGeometry(0.9 - k * 0.25, 0.15, 0.9 - k * 0.25), 'stone', 0, 0.075 + k * 0.15, 0, stoneT);
      tex(new THREE.BoxGeometry(0.16, 1.9, 0.16), 'stone', 0, 1.4, 0, stoneT);
      tex(new THREE.BoxGeometry(0.7, 0.16, 0.16), 'stone', 0, 2.0, 0, stoneT);
      return true;
    case 'shrine': {
      tex(new THREE.BoxGeometry(0.12, 1.1, 0.12), 'rough_wood', 0, 0.55, 0);
      tex(new THREE.BoxGeometry(0.6, 0.55, 0.45), 'planks', 0, 1.35, 0);
      add(new THREE.BoxGeometry(0.4, 0.4, 0.02), 0x1a1410, 0, 1.38, 0.23);
      add(new THREE.BoxGeometry(0.12, 0.25, 0.08), 0xd8c8a0, 0, 1.35, 0.18, { roughness: 0.8 });
      pitched(0.8, 0.6, 1.62, 0.25, 'rough_wood', 0x8a6a4a);
      add(new THREE.CylinderGeometry(0.04, 0.03, 0.1, 8), 0xa0583a, 0.15, 1.17, 0.26);
      for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(0.025, 6, 5), [0xe8c040, 0xd04a5a, 0xf0f0e8][k], 0.13 + k * 0.02, 1.25, 0.26);
      return true;
    }
    case 'maypole': {
      tex(new THREE.CylinderGeometry(0.07, 0.12, 6, 10), 'rough_wood', 0, 3, 0);
      add(new THREE.TorusGeometry(0.3, 0.06, 6, 16).rotateX(Math.PI / 2), LEAF2, 0, 5.8, 0, { roughness: 1 });
      for (let k = 0; k < 8; k++) add(new THREE.SphereGeometry(0.05, 6, 5), [0xe8c040, 0xd04a5a, 0xf0f0e8, 0x9a5ad0][k % 4], Math.cos(k * 0.785) * 0.3, 5.85, Math.sin(k * 0.785) * 0.3);
      const colours = [WOOL_RED, 0x2a5a9a, 0xe8c040, 0xf0f0e8, 0x3a7a3a, 0x9a5ad0];
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; bar(V(0, 5.7, 0), V(Math.cos(a) * 2.2, 0.9, Math.sin(a) * 2.2), 0.012, colours[k % 6], { roughness: 1 }); }
      return true;
    }
    case 'stocks':
      tex(new THREE.BoxGeometry(1.6, 0.08, 0.3), 'planks', 0, 0.42, -0.4);
      for (const x of [-0.7, 0.7]) post(x, -0.4, 0.42, 0.04);
      for (const x of [-0.75, 0.75]) tex(new THREE.BoxGeometry(0.12, 0.8, 0.12), 'rough_wood', x, 0.4, 0.1);
      tex(new THREE.BoxGeometry(1.5, 0.18, 0.08), 'dark_planks', 0, 0.3, 0.1, { turn: true });
      tex(new THREE.BoxGeometry(1.5, 0.18, 0.08), 'dark_planks', 0, 0.48, 0.1, { turn: true });
      for (const x of [-0.3, 0.3]) add(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10).rotateX(Math.PI / 2), 0x1a1410, x, 0.39, 0.1);
      add(new THREE.BoxGeometry(0.05, 0.1, 0.02), IRON, 0.68, 0.39, 0.15, iron);
      return true;
    case 'stall': {
      tex(new THREE.BoxGeometry(2.0, 0.85, 0.6), 'planks', 0, 0.43, -0.4);
      tex(new THREE.BoxGeometry(2.1, 0.06, 0.7), 'dark_planks', 0, 0.88, -0.4, { turn: true });
      for (const [x, z, h] of [[-0.95, -0.7, 2.0], [0.95, -0.7, 2.0], [-0.95, 0.4, 2.3], [0.95, 0.4, 2.3]]) tex(new THREE.BoxGeometry(0.08, h, 0.08), 'rough_wood', x, h / 2, z);
      for (let k = 0; k < 6; k++) { const st = add(new THREE.BoxGeometry(0.36, 0.03, 1.4), k % 2 ? 0xe8dcc0 : 0x2a5a8a, -0.9 + k * 0.36, 2.15, -0.15, { roughness: 1 }); st.rotation.x = -0.22; }
      for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.06, 0.08, 0.14, 10), 0xa0583a, -0.7 + k * 0.2, 0.98, -0.45, { roughness: 0.9 });
      for (let k = 0; k < 3; k++) { const b = add(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 10), [0x8a1c1c, 0x3a5a3a, 0xc8a060][k], 0.4 + k * 0.17, 0.98, -0.35, { roughness: 1 }); b.rotation.z = Math.PI / 2; }
      return true;
    }
    case 'hide_tent': {
      for (const z of [-1.25, 1.25]) { rod(V(-0.9, 0, z), V(0, 1.4, z), 0.03); rod(V(0.9, 0, z), V(0, 1.4, z), 0.03); }
      rod(V(0, 1.42, -1.35), V(0, 1.42, 1.35), 0.03);
      const half = Math.hypot(0.92, 1.4), a = Math.atan2(1.4, 0.92);
      for (const s of [-1, 1]) { const h = add(new THREE.BoxGeometry(half, 0.03, 2.5), 0x9a7048, s * 0.46, 0.7, 0, { roughness: 1 }); h.rotation.z = -s * a; }
      const back = new THREE.Shape([new THREE.Vector2(-0.92, 0), new THREE.Vector2(0.92, 0), new THREE.Vector2(0, 1.4)]);
      add(new THREE.ShapeGeometry(back), 0x8a6040, 0, 0, -1.25, { roughness: 1, side: THREE.DoubleSide });
      add(new THREE.BoxGeometry(0.7, 0.08, 1.8), 0x6e4a2a, 0, 0.04, -0.1, { roughness: 1 });
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 10).rotateZ(Math.PI / 2), 0xb8a070, 0, 0.12, -0.9, { roughness: 1 });
      return true;
    }
    case 'lean_to': {
      for (const x of [-0.9, 0.9]) rod(V(x, 0, -0.8), V(x, 1.3, -0.8), 0.04);
      rod(V(-1.0, 1.3, -0.8), V(1.0, 1.3, -0.8), 0.045);
      for (let k = 0; k < 9; k++) rod(V(-0.9 + k * 0.225, 1.32, -0.8), V(-0.9 + k * 0.225 + (rnd(k) - 0.5) * 0.1, 0, 0.9), 0.025);
      const th = tex(new THREE.BoxGeometry(2.1, 0.08, 2.1), 'thatch', 0, 0.68, 0.05);
      th.rotation.x = Math.atan2(1.3, 1.7);
      add(new THREE.BoxGeometry(0.8, 0.08, 1.4), 0x6a5a30, 0, 0.04, -0.2, { roughness: 1 });
      return true;
    }
    case 'bell_frame': {
      for (const x of [-0.75, 0.75]) { rod(V(x, 0, -0.3), V(x, 2.6, 0), 0.07); rod(V(x, 0, 0.3), V(x, 2.6, 0), 0.07); }
      tex(new THREE.BoxGeometry(1.7, 0.16, 0.16), 'rough_wood', 0, 2.55, 0, { turn: true });
      const bell = new THREE.LatheGeometry([new THREE.Vector2(0.001, 0.62), new THREE.Vector2(0.18, 0.6), new THREE.Vector2(0.24, 0.45), new THREE.Vector2(0.27, 0.2), new THREE.Vector2(0.35, 0.02), new THREE.Vector2(0.36, 0)], 20);
      add(bell, 0x9a7a3a, 0, 1.82, 0, { metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide });
      bar(V(0, 2.45, 0), V(0, 2.42, 0), 0.05, IRON, iron);
      bar(V(0.2, 2.5, 0), V(0.5, 0.4, 0.1), 0.01, ROPE, { roughness: 1 });
      return true;
    }
    case 'hitching_post':
      for (const x of [-0.8, 0.8]) post(x, 0, 1.0, 0.06);
      tex(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8).rotateZ(Math.PI / 2), 'rough_wood', 0, 0.95, 0);
      for (const x of [-0.4, 0.4]) add(new THREE.TorusGeometry(0.05, 0.01, 4, 10), IRON, x, 0.86, 0.05, iron);
      return true;
    case 'milestone': {
      const sh = new THREE.Shape([new THREE.Vector2(-0.2, 0), new THREE.Vector2(0.2, 0), new THREE.Vector2(0.2, 0.6)]);
      sh.absarc(0, 0.6, 0.2, 0, Math.PI, false);
      tex(new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -0.15), 'stone', 0, 0, 0, { tint: 0xc8c0b0 });
      for (const [w, y] of [[0.16, 0.55], [0.1, 0.45], [0.14, 0.35]] as const) add(new THREE.BoxGeometry(w, 0.025, 0.01), 0x3a3630, 0, y, 0.155);
      return true;
    }
  }
  return false;
}
