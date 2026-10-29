import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small low-poly props for forageable things, with colours baked into the
// vertices so each species is a single instanced draw.

function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

function mushroom(cap: number, stem: number, capR: number, capH: number, stemH: number, spots?: number, skirt?: number) {
  const parts = [
    paint(new THREE.CylinderGeometry(capR * 0.3, capR * 0.38, stemH, 6).translate(0, stemH / 2, 0), stem),
    paint(new THREE.SphereGeometry(capR, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, capH / capR, 1).translate(0, stemH, 0), cap),
  ];
  if (spots) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, r = capR * 0.55;
      parts.push(paint(new THREE.SphereGeometry(capR * 0.13, 4, 3).translate(Math.cos(a) * r, stemH + capH * 0.75, Math.sin(a) * r), spots));
    }
  }
  if (skirt) parts.push(paint(new THREE.CylinderGeometry(capR * 0.45, capR * 0.32, 0.02, 7).translate(0, stemH * 0.7, 0), skirt));
  return merge(parts);
}

/** A cluster of a few mushrooms. */
function cluster(make: () => THREE.BufferGeometry, offsets: [number, number, number][]) {
  return merge(offsets.map(([x, z, s]) => make().scale(s, s, s).translate(x, 0, z)));
}

function grassTuft(color: number, tip: number, blades: number, h: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const r = 0.06 + (i % 3) * 0.04;
    const hh = h * (0.7 + ((i * 37) % 10) / 30);
    const blade = paint(new THREE.ConeGeometry(0.025, hh, 3).translate(0, hh / 2, 0), i % 2 ? color : tip);
    blade.rotateZ(Math.cos(a) * 0.25).rotateX(Math.sin(a) * 0.25).translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    parts.push(blade);
  }
  return merge(parts);
}

function umbel(stem: number, flower: number, h: number, heads: number, spotted?: number) {
  const parts = [paint(new THREE.CylinderGeometry(0.012, 0.018, h, 4).translate(0, h / 2, 0), stem)];
  if (spotted) {
    for (let i = 0; i < 4; i++) parts.push(paint(new THREE.SphereGeometry(0.02, 4, 3).scale(1, 1.6, 1).translate(0.012, h * (0.15 + i * 0.15), 0), spotted));
  }
  for (let i = 0; i < heads; i++) {
    const a = (i / heads) * Math.PI * 2;
    const r = heads > 1 ? 0.07 : 0;
    parts.push(paint(new THREE.CylinderGeometry(0.07, 0.05, 0.03, 7).translate(Math.cos(a) * r, h + 0.02, Math.sin(a) * r), flower));
  }
  // feathery leaves near the base
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(paint(new THREE.ConeGeometry(0.03, 0.22, 3).rotateZ(1.1).rotateY(a).translate(Math.cos(a) * 0.08, 0.08, Math.sin(a) * 0.08), stem));
  }
  return merge(parts);
}

export function forageGeometry(species: string): THREE.BufferGeometry {
  switch (species) {
    case 'fiber_grass':
      return grassTuft(0x6f9a3c, 0xa8b45a, 9, 0.45);
    case 'reeds': {
      const parts = [grassTuft(0x5b7d3a, 0x6f8f44, 7, 0.9)];
      for (const [x, z] of [[0.04, 0], [-0.05, 0.05], [0, -0.06]]) {
        parts.push(paint(new THREE.CylinderGeometry(0.01, 0.01, 1.0, 3).translate(x, 0.5, z), 0x6f8f44));
        parts.push(paint(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 5).translate(x, 1.02, z), 0x5a3a22));
      }
      return merge(parts);
    }
    case 'wild_wheat': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * 0.07, z = Math.sin(a) * 0.07;
        parts.push(paint(new THREE.CylinderGeometry(0.008, 0.01, 0.6, 3).translate(x, 0.3, z), 0x9aa64a));
        parts.push(paint(new THREE.SphereGeometry(0.03, 4, 3).scale(1, 2.5, 1).translate(x, 0.65, z), 0xd8bf62));
      }
      return merge(parts);
    }
    case 'fallen_branch':
    case 'driftwood': {
      const wood = species === 'driftwood' ? 0xb8ab94 : 0x5c4027;
      return merge([
        paint(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 5).rotateZ(Math.PI / 2).translate(0, 0.05, 0), wood),
        paint(new THREE.CylinderGeometry(0.02, 0.03, 0.45, 4).rotateZ(Math.PI / 2).rotateY(0.7).translate(0.25, 0.05, 0.12), wood),
      ]);
    }
    case 'pebbles':
      return merge([
        paint(new THREE.DodecahedronGeometry(0.09).scale(1, 0.6, 1).translate(0, 0.04, 0), 0x8d8a85),
        paint(new THREE.DodecahedronGeometry(0.07).scale(1, 0.6, 1).translate(0.15, 0.03, 0.05), 0x77746f),
        paint(new THREE.DodecahedronGeometry(0.06).scale(1, 0.6, 1).translate(-0.1, 0.03, 0.12), 0x9e9a92),
      ]);
    case 'penny_bun':
      return cluster(() => mushroom(0x7a4f2a, 0xe8dcc0, 0.09, 0.07, 0.09), [[0, 0, 1], [0.12, 0.05, 0.75]]);
    case 'fly_agaric':
      return cluster(() => mushroom(0xc8241c, 0xf2ece0, 0.1, 0.06, 0.14, 0xffffff), [[0, 0, 1], [-0.13, 0.06, 0.7]]);
    case 'death_cap':
      return mushroom(0xc9cfa8, 0xf0f0e6, 0.08, 0.05, 0.13, undefined, 0xf4f4ea);
    case 'chanterelle':
      return cluster(() => merge([
        paint(new THREE.CylinderGeometry(0.02, 0.015, 0.06, 5).translate(0, 0.03, 0), 0xe8a23a),
        paint(new THREE.ConeGeometry(0.07, 0.07, 7, 1, true).rotateX(Math.PI).translate(0, 0.09, 0), 0xf0b040),
      ]), [[0, 0, 1], [0.08, 0.06, 0.8], [-0.07, 0.05, 0.9]]);
    case 'yarrow':
      return umbel(0x5f8a40, 0xf4f1e2, 0.4, 3);
    case 'hemlock':
      return umbel(0x5a7d3c, 0xf8f6ec, 0.7, 4, 0x7a2e5a);
    case 'mint': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push(paint(new THREE.SphereGeometry(0.05, 5, 3).scale(1, 0.3, 0.7).rotateY(a).translate(Math.cos(a) * 0.07, 0.08 + (i % 3) * 0.05, Math.sin(a) * 0.07), 0x4fb34a));
      }
      parts.push(paint(new THREE.CylinderGeometry(0.01, 0.01, 0.22, 3).translate(0, 0.11, 0), 0x3f7a32));
      return merge(parts);
    }
    case 'wild_onion':
      return merge([
        grassTuft(0x5f9a42, 0x6fae4a, 6, 0.32),
        paint(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 3).translate(0, 0.22, 0), 0x6fae4a),
        paint(new THREE.IcosahedronGeometry(0.05, 0).translate(0, 0.47, 0), 0x9b5ac8),
      ]);
    default:
      return paint(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 0.1, 0), 0xff00ff);
  }
}

/** Mushrooms and herbs are drawn a little larger than life so they read at standing height. */
export function forageScale(category: string): number {
  return category === 'mushroom' ? 1.6 : category === 'herb' ? 1.3 : category === 'food' ? 1.15 : 1;
}

/** Rough height of each prop (before scaling), for targeting and markers. */
export function forageHeight(species: string): number {
  return ({ reeds: 1.0, hemlock: 0.75, wild_wheat: 0.7, wild_onion: 0.5, yarrow: 0.45, fiber_grass: 0.4 } as Record<string, number>)[species] ?? 0.25;
}
