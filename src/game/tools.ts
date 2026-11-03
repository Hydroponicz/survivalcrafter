import * as THREE from 'three';
import type { ToolKind } from '../data/items';
import { STONE_HAMMER } from './models/stone_hammer';
import { STONE_HATCHET } from './models/stone_hatchet';
import { STONE_KNIFE } from './models/stone_knife';
import { STONE_PICKAXE } from './models/stone_pickaxe';
import { STONE_SPEAR } from './models/stone_spear';
import { WOODEN_SHOVEL } from './models/wooden_shovel';
import { WOODEN_TONGS } from './models/wooden_tongs';

// Hand-tool models shared by the third-person character and the first-person
// view. Each is built with the grip at the origin, the handle running up +Y,
// and the working end (blade, point) facing +Z.

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

/** Tools made from models (see scripts/bake-props.mjs): already gripped at the origin, handle up +Y, working end +Z. */
const MODELS: Record<string, { positions: number[]; indices: number[]; colors: number[] }> = {
  stone_knife: STONE_KNIFE, stone_hatchet: STONE_HATCHET, stone_pickaxe: STONE_PICKAXE, stone_hammer: STONE_HAMMER,
  wooden_shovel: WOODEN_SHOVEL, stone_spear: STONE_SPEAR, wooden_tongs: WOODEN_TONGS,
};
const modelGeos = new Map<string, THREE.BufferGeometry>();
const modelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

export function buildToolMesh(kind: ToolKind | undefined, itemType?: string): THREE.Group {
  if (itemType === 'torch') return buildTorch();
  const g = new THREE.Group();
  if (!kind) return g;
  const model = itemType ? MODELS[itemType] : undefined;
  if (model) {
    let geo = modelGeos.get(itemType!);
    if (!geo) {
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(model.positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(model.colors, 3));
      geo.setIndex(model.indices);
      geo.computeVertexNormals();
      modelGeos.set(itemType!, geo);
    }
    const mesh = new THREE.Mesh(geo, modelMat);
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  }
  const stone = itemType?.startsWith('stone') || itemType === 'wooden_shovel';
  const wood = mat(0x7a5634);
  const head = stone ? mat(0x7f7b74, { flatShading: true }) : mat(0x9aa0a6, { metalness: 0.65, roughness: 0.35 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const handle = (len: number, r = 0.018) => add(new THREE.CylinderGeometry(r * 0.9, r, len, 7), wood, 0, len / 2 - 0.08, 0);

  switch (kind) {
    case 'hatchet': {
      handle(0.62);
      if (stone) {
        add(new THREE.DodecahedronGeometry(0.07, 0), head, 0, 0.5, 0.06).scale.set(0.55, 1.1, 1.4);
        add(new THREE.CylinderGeometry(0.024, 0.024, 0.07, 6), mat(0xc9b07a), 0, 0.5, 0); // lashing
      } else {
        // An iron bit: thick at the eye, thin and wide at the edge.
        const shape = new THREE.Shape();
        shape.moveTo(-0.03, -0.035);
        shape.lineTo(0.13, -0.075);
        shape.quadraticCurveTo(0.155, 0, 0.13, 0.075);
        shape.lineTo(-0.03, 0.035);
        shape.lineTo(-0.03, -0.035);
        const bit = add(new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 }), head, -0.011, 0.5, 0);
        bit.rotation.y = -Math.PI / 2;
        bit.position.set(-0.011, 0.5, 0.02);
        add(new THREE.BoxGeometry(0.04, 0.07, 0.05), head, 0, 0.5, -0.01); // poll
      }
      break;
    }
    case 'pickaxe': {
      handle(0.68);
      const pickHead = new THREE.Group();
      for (const s of [-1, 1]) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.2, 6), head);
        spike.rotation.x = (s * Math.PI) / 2 + s * 0.25;
        spike.position.set(0, -0.02, s * 0.1);
        spike.castShadow = true;
        pickHead.add(spike);
      }
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.06), head);
      pickHead.add(eye);
      pickHead.position.y = 0.56;
      g.add(pickHead);
      break;
    }
    case 'shovel': {
      handle(0.85);
      add(new THREE.BoxGeometry(0.06, 0.03, 0.03), wood, 0, 0.78, 0); // T-grip
      const blade = add(new THREE.BoxGeometry(0.18, 0.22, 0.012), stone ? mat(0x9a7650) : head, 0, -0.17, 0.01);
      blade.rotation.x = 0.12;
      break;
    }
    case 'hoe': {
      // A long shaft with a flat blade set across its end, like an adze: the edge faces the ground.
      handle(1.05, 0.016);
      if (stone) {
        const blade = add(new THREE.DodecahedronGeometry(0.08, 0), mat(0x8a857c, { flatShading: true }), 0, 0.93, 0.1);
        blade.scale.set(1.0, 0.22, 1.25);
        blade.rotation.x = -0.12;
        add(new THREE.CylinderGeometry(0.024, 0.024, 0.08, 6), mat(0xc9b07a), 0, 0.93, 0); // lashing
      } else {
        // An iron blade: a socket round the shaft, a neck, and a wide thin plate.
        add(new THREE.CylinderGeometry(0.024, 0.022, 0.08, 8), head, 0, 0.93, 0);
        add(new THREE.BoxGeometry(0.03, 0.02, 0.07), head, 0, 0.93, 0.05);
        const plate = add(new THREE.BoxGeometry(0.17, 0.008, 0.13), head, 0, 0.91, 0.14);
        plate.rotation.x = -0.18;
      }
      break;
    }
    case 'hammer':
      handle(0.42);
      if (itemType === 'wooden_hammer') {
        // A mallet: a squared block of rough plank across the end of the shaft.
        add(new THREE.BoxGeometry(0.075, 0.075, 0.15), mat(0x6e5a44, { roughness: 0.95 }), 0, 0.35, 0.0);
        break;
      }
      add(stone ? new THREE.DodecahedronGeometry(0.05, 0) : new THREE.BoxGeometry(0.06, 0.06, 0.13), head, 0, 0.34, 0.02);
      break;
    case 'bow': {
      // A curved stave held at its middle (the grip at the origin), strung with cordage.
      const stave = add(new THREE.TorusGeometry(0.55, 0.014, 6, 24, 1.5).rotateZ(Math.PI - 0.75), wood, 0.47, 0, 0);
      stave.castShadow = true;
      add(new THREE.CylinderGeometry(0.003, 0.003, 0.75, 4), mat(0xd8c8a0), 0.06, 0, 0);
      add(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 7), mat(0x5a3c22), 0, 0, 0); // the grip, wrapped
      break;
    }
    case 'knife':
      add(new THREE.BoxGeometry(0.03, 0.1, 0.03), wood, 0, 0.0, 0);
      add(new THREE.ConeGeometry(0.018, 0.16, 4).scale(1, 1, 0.35), head, 0, 0.13, 0);
      break;
    case 'saw':
      add(new THREE.BoxGeometry(0.035, 0.11, 0.05), wood, 0, 0, 0);
      add(new THREE.BoxGeometry(0.004, 0.08, 0.42), head, 0, 0.02, 0.24);
      break;
    case 'scythe': {
      handle(1.0);
      const blade = add(new THREE.BoxGeometry(0.01, 0.04, 0.42), head, 0, 0.88, 0.2);
      blade.rotation.x = -0.25;
      break;
    }
    case 'weapon':
      if (itemType === 'stone_spear') {
        handle(1.2, 0.016);
        add(new THREE.ConeGeometry(0.03, 0.14, 5).scale(1, 1, 0.5), head, 0, 1.14, 0);
      } else {
        add(new THREE.BoxGeometry(0.03, 0.14, 0.03), wood, 0, 0, 0);
        add(new THREE.BoxGeometry(0.14, 0.025, 0.03), head, 0, 0.08, 0);
        add(new THREE.BoxGeometry(0.012, 0.62, 0.045), head, 0, 0.4, 0);
      }
      break;
    case 'tongs': {
      const m = itemType === 'wooden_tongs' ? wood : mat(0x3a3a3c, { metalness: 0.6, roughness: 0.5 });
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.014, 0.5, 0.014), m, sx * 0.012, 0.18, 0, 0, 0, sx * 0.03);
      break;
    }
    case 'crucible':
      add(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 10), mat(0x55504a), 0, 0.05, 0);
      break;
  }
  return g;
}

/** How a tool is swung for an action. */
export type SwingKind = 'chop' | 'dig' | 'reach';

/**
 * Pose curve for a swing, phase 0..1 → { raise: 1 = wound up overhead, 0 = rest/struck; drive: how far the
 * strike has gone through; jolt: kick at the moment of impact }.
 * Wind-up eases in, the strike is fast, then a short recoil and recovery.
 */
export function swingPose(kind: SwingKind, phase: number, impactAt: number) {
  const ease = (t: number) => t * t * (3 - 2 * t);
  const p = Math.max(0, Math.min(1, phase));
  if (kind === 'reach') {
    const k = Math.sin(p * Math.PI);
    return { raise: 0, drive: k * 0.6, jolt: 0 };
  }
  const windEnd = impactAt - 0.12;
  if (p < windEnd) return { raise: ease(p / windEnd), drive: 0, jolt: 0 };
  if (p < impactAt) {
    const t = (p - windEnd) / (impactAt - windEnd);
    return { raise: 1 - t * t, drive: t * t, jolt: 0 };
  }
  const after = (p - impactAt) / (1 - impactAt);
  const jolt = Math.max(0, 1 - after * 4);
  return { raise: 0, drive: 1 - ease(after), jolt };
}

/** Something held that's not a tool but still shows in the hand (a torch). */
export const HELD_ITEMS = new Set(['torch']);

const torchFlame = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const torchCore = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

/** A torch: a branch with a wrapped head, burning (the flame flickers on its own). */
function buildTorch(): THREE.Group {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.5, 7).translate(0, 0.17, 0), mat(0x6b4a2c));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.03, 0.12, 8).translate(0, 0.44, 0), mat(0x3a2a1c, { roughness: 1 }));
  stick.castShadow = head.castShadow = true;
  // Soft teardrops of flame: an orange glow round a bright heart.
  const flame = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8).translate(0, 0.75, 0).scale(0.055, 0.12, 0.055), torchFlame);
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).translate(0, 0.7, 0).scale(0.026, 0.065, 0.026), torchCore);
  flame.position.y = core.position.y = 0.47;
  flame.renderOrder = core.renderOrder = 5;
  const seed = Math.random() * 100;
  flame.onBeforeRender = () => {
    const t = performance.now() / 1000 + seed;
    const s = 1 + Math.sin(t * 17) * 0.12 + Math.sin(t * 7.3) * 0.08;
    flame.scale.set(1 + Math.sin(t * 11) * 0.1, s, 1 + Math.cos(t * 13) * 0.1);
    flame.rotation.z = Math.sin(t * 5.1) * 0.12;
    core.scale.set(1, 0.9 + Math.sin(t * 19) * 0.15, 1);
  };
  g.add(stick, head, flame, core);
  // Held up, rather than pointing ahead like a tool.
  g.rotation.z = -1.1;
  g.userData.torch = true;
  return g;
}
