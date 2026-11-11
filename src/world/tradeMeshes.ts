import * as THREE from 'three';
import type { Surface } from './surfaces';
import { SIGNS } from '../data/tradePieces';

// Models for the trades' signs and yards (data/tradePieces). Origin at the
// bottom centre, front toward +z (for a sign: out from the wall it's hung on).

type Tex = (geo: THREE.BufferGeometry, surface: Surface, x?: number, y?: number, z?: number, opts?: { turn?: boolean; tint?: number; parent?: THREE.Object3D }) => THREE.Mesh;
type Add = (geo: THREE.BufferGeometry, color: number, x?: number, y?: number, z?: number, extra?: THREE.MeshStandardMaterialParameters, parent?: THREE.Object3D) => THREE.Mesh;

const IRON = 0x2a2826, iron = { metalness: 0.6, roughness: 0.5 };
const rnd = (i: number) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

// ---------- the emblems: flat silhouettes, drawn in the sign's own plane (u across, v up; metres)
type Part = { pts: [number, number][]; color: number } | { circle: [number, number, number]; color: number };
const P = (color: number, ...pts: [number, number][]): Part => ({ pts, color });
const C = (color: number, u: number, v: number, r: number): Part => ({ circle: [u, v, r], color });
const ell = (u: number, v: number, ru: number, rv: number, n = 14): [number, number][] => Array.from({ length: n }, (_, k) => [u + Math.cos((k / n) * Math.PI * 2) * ru, v + Math.sin((k / n) * Math.PI * 2) * rv] as [number, number]);

const GOLD = 0xe2b24a, STEEL = 0xb8bcc4, WOOD = 0x8a5a2a, CREAM = 0xf2e6c8;
const EMBLEMS: Record<string, Part[]> = {
  // A felling axe.
  woodcutter: [P(WOOD, [-0.02, -0.17], [0.02, -0.17], [0.025, 0.12], [-0.015, 0.12]), P(STEEL, [-0.01, 0.06], [0.11, 0.02], [0.14, 0.1], [0.11, 0.18], [-0.01, 0.15])],
  // An anvil, a hammer above it.
  smith: [P(STEEL, [-0.16, 0.0], [-0.06, -0.01], [-0.05, -0.05], [-0.03, -0.09], [-0.08, -0.14], [0.1, -0.14], [0.05, -0.09], [0.07, -0.05], [0.12, -0.02], [0.13, 0.03], [-0.08, 0.04]),
    P(WOOD, [-0.005, 0.06], [0.015, 0.06], [0.015, 0.2], [-0.005, 0.2]), P(STEEL, [-0.06, 0.15], [0.07, 0.15], [0.07, 0.2], [-0.06, 0.2])],
  // A round loaf, scored, and an ear of wheat.
  baker: [P(0xc88a3e, ...ell(0, -0.03, 0.15, 0.09)), P(0x8a5520, [-0.08, 0.0], [-0.05, -0.08], [-0.035, -0.08], [-0.065, 0.0]), P(0x8a5520, [0.0, 0.03], [0.03, -0.09], [0.045, -0.09], [0.015, 0.03]),
    P(GOLD, [-0.005, 0.07], [0.005, 0.07], [0.005, 0.2], [-0.005, 0.2]), ...[0, 1, 2].map((k) => P(GOLD, ...ell(0.02, 0.1 + k * 0.035, 0.015, 0.012, 8))), ...[0, 1, 2].map((k) => P(GOLD, ...ell(-0.02, 0.115 + k * 0.035, 0.015, 0.012, 8)))],
  // A ham, the bone showing, and a cleaver.
  butcher: [P(0xb04848, [-0.14, 0.02], [-0.06, 0.1], [0.04, 0.08], [0.07, 0.0], [0.02, -0.1], [-0.1, -0.08]), P(CREAM, [0.06, 0.02], [0.13, 0.05], [0.14, 0.02], [0.07, -0.02]), C(CREAM, 0.145, 0.035, 0.022),
    P(STEEL, [-0.04, 0.12], [0.08, 0.12], [0.08, 0.2], [-0.04, 0.2]), P(WOOD, [0.08, 0.15], [0.15, 0.15], [0.15, 0.17], [0.08, 0.17])],
  // A sheaf of wheat, tied.
  farmer: [...[-0.06, -0.03, 0, 0.03, 0.06].map((u) => P(GOLD, [u - 0.006, -0.17], [u + 0.006, -0.17], [u * 1.6 + 0.006, 0.08], [u * 1.6 - 0.006, 0.08])),
    ...[-0.1, -0.05, 0, 0.05, 0.1].map((u) => P(GOLD, ...ell(u, 0.12, 0.025, 0.055, 10))), P(0x8a3a1e, [-0.07, -0.05], [0.07, -0.05], [0.07, -0.02], [-0.07, -0.02])],
  // A sheep.
  shepherd: [...[[-0.07, 0.0], [0.0, 0.03], [0.07, 0.0], [-0.04, -0.04], [0.04, -0.04], [0.0, -0.02]].map(([u, v]) => C(CREAM, u, v, 0.06)), P(0x2a2420, ...ell(0.13, 0.04, 0.045, 0.035, 10)),
    ...[-0.07, -0.02, 0.04, 0.08].map((u) => P(0x2a2420, [u - 0.008, -0.13], [u + 0.008, -0.13], [u + 0.008, -0.08], [u - 0.008, -0.08]))],
  // A hand saw.
  carpenter: [P(STEEL, [-0.13, 0.04], [0.09, 0.07], [0.09, -0.03], [-0.13, -0.0]), ...Array.from({ length: 9 }, (_, k) => P(STEEL, [-0.12 + k * 0.024, -0.0 - k * 0.003], [-0.108 + k * 0.024, -0.025 - k * 0.003], [-0.096 + k * 0.024, -0.003 - k * 0.003])),
    P(WOOD, [0.09, 0.08], [0.17, 0.09], [0.17, -0.05], [0.09, -0.04])],
  // A jug.
  potter: [P(0xb8653a, [-0.04, 0.16], [0.04, 0.16], [0.035, 0.11], [0.1, 0.04], [0.11, -0.05], [0.06, -0.15], [-0.06, -0.15], [-0.11, -0.05], [-0.1, 0.04], [-0.035, 0.11]),
    P(0xe0b07a, [-0.1, 0.0], [0.1, 0.0], [0.1, 0.02], [-0.1, 0.02]), P(0xb8653a, [0.09, 0.05], [0.15, 0.04], [0.15, -0.04], [0.1, -0.05], [0.1, -0.03], [0.13, -0.02], [0.13, 0.03], [0.09, 0.03])],
  // A tankard of ale, foaming.
  innkeeper: [P(0x9a6a3a, [-0.08, -0.15], [0.07, -0.15], [0.08, 0.1], [-0.09, 0.1]), P(CREAM, ...ell(-0.005, 0.11, 0.1, 0.045)), C(CREAM, -0.06, 0.14, 0.035), C(CREAM, 0.04, 0.14, 0.03),
    P(0x9a6a3a, [0.08, 0.06], [0.15, 0.05], [0.15, -0.09], [0.08, -0.1], [0.08, -0.07], [0.12, -0.065], [0.12, 0.025], [0.08, 0.03]), P(0x6a4422, [-0.08, -0.05], [0.07, -0.05], [0.07, -0.03], [-0.08, -0.03])],
  // Scales.
  merchant: [P(GOLD, [-0.007, -0.16], [0.007, -0.16], [0.007, 0.14], [-0.007, 0.14]), P(GOLD, [-0.15, 0.12], [0.15, 0.12], [0.15, 0.14], [-0.15, 0.14]), P(GOLD, [-0.05, -0.17], [0.05, -0.17], [0.05, -0.15], [-0.05, -0.15]),
    ...[-1, 1].map((s) => P(GOLD, [s * 0.14 - 0.06, -0.02], [s * 0.14 + 0.06, -0.02], [s * 0.14 + 0.04, -0.05], [s * 0.14 - 0.04, -0.05])),
    ...[-1, 1].flatMap((s) => [P(GOLD, [s * 0.14 - 0.004, 0.12], [s * 0.14 + 0.004, 0.12], [s * 0.14 + 0.055, -0.02], [s * 0.14 + 0.047, -0.02]), P(GOLD, [s * 0.14 - 0.004, 0.12], [s * 0.14 + 0.004, 0.12], [s * 0.14 - 0.047, -0.02], [s * 0.14 - 0.055, -0.02])])],
  // A fish.
  dockhand: [P(0x7a9ab0, ...ell(-0.02, 0, 0.12, 0.06, 16)), P(0x7a9ab0, [0.08, 0], [0.17, 0.07], [0.15, 0], [0.17, -0.07]), C(0x1a1a1a, -0.09, 0.015, 0.012), P(0x4a6a80, [-0.04, 0.05], [0.03, 0.05], [0.0, 0.09])],
};

/** A trade's sign: an iron bracket out from the wall, the painted board hung from it, the emblem cut out on both faces. */
function sign(trade: string, tex: Tex, add: Add) {
  const s = SIGNS[trade];
  // The bracket: a bar out from the wall, a brace under it, a plate on the wall.
  add(new THREE.BoxGeometry(0.04, 0.04, 0.78), IRON, 0, 0.32, 0.39, iron);
  const brace = add(new THREE.BoxGeometry(0.03, 0.03, 0.5), IRON, 0, 0.16, 0.2, iron);
  brace.rotation.x = 0.62;
  add(new THREE.BoxGeometry(0.1, 0.44, 0.03), IRON, 0, 0.14, 0.015, iron);
  add(new THREE.SphereGeometry(0.03, 8, 6), IRON, 0, 0.32, 0.79, iron);
  // The board, on two rings, framed.
  for (const z of [0.2, 0.68]) add(new THREE.TorusGeometry(0.03, 0.007, 4, 8), IRON, 0, 0.27, z, iron);
  add(new THREE.BoxGeometry(0.035, 0.46, 0.6), s.board, 0, 0.0, 0.44, { roughness: 0.85 });
  for (const [h, w, y, z] of [[0.03, 0.66, 0.24, 0.44], [0.03, 0.66, -0.24, 0.44], [0.5, 0.03, 0, 0.13], [0.5, 0.03, 0, 0.75]] as [number, number, number, number][]) {
    tex(new THREE.BoxGeometry(0.05, h, w), 'rough_wood', 0, y, z);
  }
  // The emblem, raised a little off both faces.
  const parts = EMBLEMS[trade] ?? [];
  for (const side of [-1, 1]) {
    for (const p of parts) {
      let shape: THREE.Shape;
      if ('circle' in p) { shape = new THREE.Shape(); shape.absarc(p.circle[0], p.circle[1], p.circle[2], 0, Math.PI * 2, false); }
      else shape = new THREE.Shape(p.pts.map(([u, v]) => new THREE.Vector2(u, v)));
      // Drawn in the u-v plane, then turned to stand in the board's plane (u along the board, out from the wall).
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false }).translate(0, 0, -0.006).rotateY(side * Math.PI / 2);
      const m = add(geo, p.color, side * 0.025, 0.0, 0.44, { roughness: 0.6, metalness: p.color === GOLD || p.color === STEEL ? 0.4 : 0 });
      m.scale.set(1, 1.25, 1.25);
      m.castShadow = false;
    }
  }
}

export function tradePieceMesh(type: string, g: THREE.Group, tex: Tex, add: Add, state: { lit?: boolean }): boolean {
  if (type.startsWith('sign_')) { sign(type.slice(5), tex, add); return true; }
  switch (type) {
    case 'log_stack': {
      // Trunks in a pyramid, their sawn ends out (pale, with rings), held by stakes.
      const rows = [5, 4, 3];
      rows.forEach((n, r) => {
        for (let k = 0; k < n; k++) {
          const x = (k - (n - 1) / 2) * 0.46, y = 0.2 + r * 0.36;
          const rad = 0.17 + rnd(r * 9 + k) * 0.05;
          tex(new THREE.CylinderGeometry(rad, rad * 1.05, 1.15, 10).rotateX(Math.PI / 2), 'log_wall', x, y, 0);
          for (const s of [-1, 1]) {
            const e = add(new THREE.CircleGeometry(rad * 0.98, 12), 0xc89a62, x, y, s * 0.578, { roughness: 0.9 });
            if (s < 0) e.rotation.y = Math.PI;
            const ring = add(new THREE.RingGeometry(rad * 0.45, rad * 0.5, 12), 0x9a6e40, x, y, s * 0.581, { roughness: 1 });
            if (s < 0) ring.rotation.y = Math.PI;
          }
        }
      });
      for (const s of [-1, 1]) tex(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), 'rough_wood', s * 1.32, 0.6, 0);
      return true;
    }
    case 'sawhorse': {
      // X legs at each end, a beam across, a log on it with a saw in the cut.
      for (const x of [-0.5, 0.5]) for (const s of [-1, 1]) {
        const l = tex(new THREE.BoxGeometry(0.07, 1.0, 0.07), 'rough_wood', x, 0.42, 0);
        l.rotation.x = s * 0.45;
      }
      tex(new THREE.BoxGeometry(1.3, 0.08, 0.1), 'rough_wood', 0, 0.78, 0, { turn: true });
      tex(new THREE.CylinderGeometry(0.15, 0.16, 1.4, 10).rotateZ(Math.PI / 2), 'log_wall', 0.1, 0.98, 0);
      const saw = add(new THREE.BoxGeometry(0.6, 0.12, 0.01), 0xb8bcc4, 0.25, 1.12, 0, { ...iron });
      saw.rotation.z = 0.15;
      add(new THREE.BoxGeometry(0.14, 0.1, 0.04), 0x8a5a2a, 0.6, 1.18, 0, { roughness: 0.9 });
      // Sawdust on the ground.
      add(new THREE.CircleGeometry(0.45, 12).rotateX(-Math.PI / 2), 0xd8b882, 0.25, 0.01, 0, { roughness: 1 });
      return true;
    }
    case 'bread_oven': {
      // A stone plinth, a clay dome on it, an arched mouth at the front, a chimney at the back, a peel leaning on it.
      tex(new THREE.BoxGeometry(1.6, 0.6, 1.6), 'stone', 0, 0.3, 0, { tint: 0xc8c2b8 });
      add(new THREE.SphereGeometry(0.72, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1), 0xb88a5a, 0, 0.6, -0.05, { roughness: 1 });
      add(new THREE.BoxGeometry(0.5, 0.36, 0.3), 0xa87a4a, 0, 0.78, 0.62, { roughness: 1 });
      add(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), 0xa87a4a, 0, 0.96, 0.62, { roughness: 1 });
      const glow = state.lit ? { emissive: 0xff4a10, emissiveIntensity: 1.5 } : {};
      add(new THREE.BoxGeometry(0.3, 0.24, 0.04), state.lit ? 0x8a2a08 : 0x120a06, 0, 0.74, 0.78, { roughness: 1, ...glow });
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 10, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), state.lit ? 0x8a2a08 : 0x120a06, 0, 0.86, 0.78, { roughness: 1, ...glow });
      tex(new THREE.BoxGeometry(0.3, 0.9, 0.3), 'stone', 0, 1.35, -0.55, { tint: 0xb0a898 });
      const peel = tex(new THREE.BoxGeometry(0.04, 1.5, 0.04), 'rough_wood', 0.75, 0.75, 0.7);
      peel.rotation.z = 0.25;
      add(new THREE.BoxGeometry(0.28, 0.3, 0.02), 0xb08a5a, 0.95, 1.45, 0.7, { roughness: 1 });
      if (state.lit) {
        const f = add(new THREE.ConeGeometry(0.08, 0.18, 7), 0xffa030, 0, 0.74, 0.8, { emissive: 0xff6a00, emissiveIntensity: 2.5, transparent: true, opacity: 0.85 });
        f.castShadow = false; f.userData.flame = true;
      }
      return true;
    }
    case 'meat_rack': {
      // Two posts and a bar under a little shingled roof; hams and sides hanging from hooks.
      for (const x of [-0.85, 0.85]) tex(new THREE.BoxGeometry(0.1, 2, 0.1), 'rough_wood', x, 1, 0);
      tex(new THREE.BoxGeometry(1.9, 0.08, 0.08), 'rough_wood', 0, 1.75, 0, { turn: true });
      const roof = tex(new THREE.BoxGeometry(2.1, 0.05, 0.7), 'dark_planks', 0, 2.08, 0, { turn: true });
      roof.rotation.x = 0.25;
      [-0.6, -0.2, 0.2, 0.6].forEach((x, k) => {
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 4), IRON, x, 1.64, 0, iron);
        if (k % 2 === 0) {
          // A ham: rounded, pink-red, a bone at the top.
          add(new THREE.SphereGeometry(0.13, 10, 8).scale(1, 1.5, 0.9), 0xa04038, x, 1.32, 0, { roughness: 0.7 });
          add(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6), 0xeee0c8, x, 1.53, 0, { roughness: 0.6 });
        } else {
          // A side of bacon: long and flat, fat along its edge.
          add(new THREE.BoxGeometry(0.2, 0.5, 0.06), 0xb05048, x, 1.3, 0, { roughness: 0.7 });
          add(new THREE.BoxGeometry(0.05, 0.5, 0.065), 0xf0dcc8, x + 0.1, 1.3, 0, { roughness: 0.7 });
        }
      });
      return true;
    }
    case 'net_rack': {
      // Two poles and a bar, a net draped over it (a mesh of cords), cork floats along its foot, fish drying on a line.
      for (const x of [-1.1, 1.1]) tex(new THREE.CylinderGeometry(0.05, 0.06, 1.9, 6), 'rough_wood', x, 0.95, 0);
      tex(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 6).rotateZ(Math.PI / 2), 'rough_wood', 0, 1.75, 0);
      const net = new THREE.Group();
      for (let i = 0; i <= 14; i++) add(new THREE.BoxGeometry(0.008, 1.2, 0.008), 0x8a7a5a, -0.98 + i * 0.14, 1.15, 0.01 * Math.sin(i), { roughness: 1 }, net);
      for (let j = 0; j <= 8; j++) add(new THREE.BoxGeometry(1.96, 0.008, 0.008), 0x8a7a5a, 0, 0.55 + j * 0.15, 0, { roughness: 1 }, net);
      g.add(net);
      for (let i = 0; i < 8; i++) add(new THREE.SphereGeometry(0.05, 6, 5).scale(1, 0.7, 1), 0xd8a050, -0.9 + i * 0.26, 0.53, 0, { roughness: 1 });
      for (let i = 0; i < 4; i++) {
        const f = add(new THREE.SphereGeometry(0.07, 8, 6).scale(0.5, 1.6, 0.25), 0x8aa0b0, -0.5 + i * 0.32, 1.55, 0.06, { roughness: 0.5, metalness: 0.2 });
        f.rotation.z = 0.1 * (i - 1.5);
      }
      return true;
    }
    case 'tool_rack': {
      // A board on two legs, pegs along it: tongs, hammers, a horseshoe for luck.
      tex(new THREE.BoxGeometry(1.2, 0.5, 0.06), 'dark_planks', 0, 1.25, 0, { turn: true });
      for (const x of [-0.55, 0.55]) tex(new THREE.BoxGeometry(0.08, 1.5, 0.08), 'rough_wood', x, 0.75, -0.03);
      [-0.4, -0.15, 0.1, 0.35].forEach((x, k) => {
        add(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 5).rotateX(Math.PI / 2), 0x6a4a2a, x, 1.42, 0.06, { roughness: 1 });
        if (k % 2 === 0) {
          for (const s of [-1, 1]) { const arm = add(new THREE.BoxGeometry(0.02, 0.5, 0.02), IRON, x + s * 0.02, 1.15, 0.08, iron); arm.rotation.z = s * 0.06; }
        } else {
          add(new THREE.BoxGeometry(0.025, 0.35, 0.025), 0x8a5a2a, x, 1.22, 0.08, { roughness: 0.9 });
          add(new THREE.BoxGeometry(0.12, 0.05, 0.05), IRON, x, 1.04, 0.08, iron);
        }
      });
      const shoe = add(new THREE.TorusGeometry(0.06, 0.012, 4, 10, Math.PI * 1.4), IRON, 0, 1.38, 0.05, iron);
      shoe.rotation.z = -Math.PI * 0.2 + Math.PI;
      return true;
    }
    case 'charcoal_heap': {
      add(new THREE.ConeGeometry(0.6, 0.45, 9), 0x1a1816, 0, 0.22, 0, { roughness: 1, flatShading: true });
      for (let k = 0; k < 8; k++) add(new THREE.BoxGeometry(0.1, 0.06, 0.07), 0x22201c, Math.cos(k) * 0.55, 0.03, Math.sin(k * 1.3) * 0.5, { roughness: 1 });
      return true;
    }
    case 'flour_sacks': {
      // Three sacks leaning together, one open with flour showing.
      [[-0.3, 0, 0], [0.25, 0, 0.05], [0, 0, -0.2]].forEach(([x, , z], k) => {
        add(new THREE.SphereGeometry(0.22, 10, 8).scale(1, 1.35, 0.9), 0xc8b088, x, 0.3, z, { roughness: 1 });
        if (k < 2) add(new THREE.CylinderGeometry(0.06, 0.1, 0.12, 8), 0xb8a078, x, 0.62, z, { roughness: 1 });
        else add(new THREE.CircleGeometry(0.14, 10).rotateX(-Math.PI / 2), 0xf6f0e4, x, 0.6, z, { roughness: 1 });
      });
      return true;
    }
    case 'plough': {
      // A beam, the handles, the share and mouldboard.
      const beam = tex(new THREE.BoxGeometry(0.1, 0.1, 1.9), 'rough_wood', 0, 0.45, 0.1);
      beam.rotation.x = -0.18;
      for (const s of [-1, 1]) { const h = tex(new THREE.BoxGeometry(0.05, 0.05, 1.0), 'rough_wood', s * 0.18, 0.6, -0.75); h.rotation.x = 0.55; }
      add(new THREE.ConeGeometry(0.08, 0.35, 4).rotateX(Math.PI / 2), IRON, 0, 0.12, -0.2, iron);
      add(new THREE.BoxGeometry(0.03, 0.25, 0.35), 0x5a4a3a, 0.08, 0.2, -0.15, { roughness: 0.9 });
      return true;
    }
    case 'plank_stack': {
      // Bearers, boards in layers with sticks between, a weight on top.
      for (const z of [-0.3, 0.3]) tex(new THREE.BoxGeometry(2.1, 0.08, 0.1), 'rough_wood', 0, 0.04, z, { turn: true });
      for (let l = 0; l < 5; l++) {
        for (let k = 0; k < 3; k++) tex(new THREE.BoxGeometry(2.0, 0.04, 0.24), 'planks', 0, 0.1 + l * 0.11, -0.27 + k * 0.27, { turn: true });
        if (l < 4) for (const x of [-0.8, 0, 0.8]) tex(new THREE.BoxGeometry(0.04, 0.03, 0.8), 'rough_wood', x, 0.14 + l * 0.11, 0);
      }
      add(new THREE.DodecahedronGeometry(0.12, 0), 0x77736c, 0.3, 0.68, 0, { flatShading: true });
      return true;
    }
    case 'pot_shelf': {
      // Two shelves on posts, pots and jars of all sizes on them.
      for (const x of [-0.75, 0.75]) tex(new THREE.BoxGeometry(0.07, 1.4, 0.07), 'rough_wood', x, 0.7, 0);
      for (const y of [0.45, 1.0]) tex(new THREE.BoxGeometry(1.6, 0.04, 0.36), 'planks', 0, y, 0, { turn: true });
      let i = 0;
      for (const y of [0.47, 1.02]) for (let x = -0.6; x <= 0.6; x += 0.3) {
        const s = 0.7 + rnd(i++) * 0.5, col = [0xb8653a, 0xc8865a, 0x9a5a3a][i % 3];
        add(new THREE.SphereGeometry(0.1 * s, 10, 8).scale(1, 1.2, 1), col, x, y + 0.11 * s, 0, { roughness: 0.9 });
        add(new THREE.CylinderGeometry(0.045 * s, 0.06 * s, 0.07 * s, 10), col, x, y + 0.24 * s, 0, { roughness: 0.9 });
      }
      return true;
    }
    case 'wool_bales': {
      [[-0.32, 0.2, 0], [0.32, 0.2, 0], [0, 0.55, 0]].forEach(([x, y, z]) => {
        add(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 12).rotateZ(Math.PI / 2), 0xece4d0, x, y, z, { roughness: 1 });
        for (const dx of [-0.18, 0.18]) add(new THREE.TorusGeometry(0.225, 0.012, 4, 12).rotateY(Math.PI / 2), 0x8a6a4a, x + dx, y, z, { roughness: 1 });
      });
      return true;
    }
  }
  return false;
}
