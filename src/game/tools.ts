import * as THREE from 'three';
import type { ToolKind } from '../data/items';

// Hand-tool models shared by the third-person character and the first-person
// view. Each is built with the grip at the origin, the handle running up +Y,
// and the working end (blade, point) facing +Z.

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

export function buildToolMesh(kind: ToolKind | undefined, itemType?: string): THREE.Group {
  const g = new THREE.Group();
  if (!kind) return g;
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
    case 'hammer':
      handle(0.42);
      add(stone ? new THREE.DodecahedronGeometry(0.05, 0) : new THREE.BoxGeometry(0.06, 0.06, 0.13), head, 0, 0.34, 0.02);
      break;
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
