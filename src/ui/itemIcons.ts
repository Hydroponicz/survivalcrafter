import * as THREE from 'three';
import { itemDef } from '../data/items';
import { buildToolMesh } from '../game/tools';

// Item portraits: each kind of item drawn once as a little 3D picture (its
// tool model where it has one, else a simple model of the thing), kept as an
// image for the backpack, hotbar and equipment slots. Drawn on first ask, a
// few a frame; until then the item's emoji stands in.

const SIZE = 128;

let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
const scene = new THREE.Scene();
// Square on (no perspective) and framed tight to each item, so even a long thin tool fills its picture.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
const urls = new Map<string, string>();
const queued: string[] = [];
let onReady: (() => void) | null = null;

function setup(): THREE.WebGLRenderer | null {
  if (renderer || failed || typeof document === 'undefined') return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x3a3326, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 2.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 1.1);
    rim.position.set(-2.5, 1, -2);
    scene.add(rim);
  } catch {
    failed = true;
  }
  return renderer;
}

/** Called when portraits that were asked for are ready (to redraw what shows them). */
export function onIconsReady(f: () => void) { onReady = f; }

/**
 * HTML for an item's portrait: an image once it's drawn, else its emoji (and
 * it's queued to be drawn).
 */
export function itemIcon(type: string, cls = 'icon-img'): string {
  const url = urls.get(type);
  if (url) return `<img class="${cls}" src="${url}" alt="" draggable="false">`;
  if (!queued.includes(type) && !failed) queued.push(type);
  return itemDef(type).icon;
}

/** Draw a few waiting portraits (call once a frame). */
export function drawIcons(max = 3) {
  if (!queued.length || !setup()) return;
  let drew = false;
  for (let n = 0; n < max && queued.length; n++) {
    const type = queued.shift()!;
    try {
      urls.set(type, portrait(type));
      drew = true;
    } catch (e) {
      console.warn('Could not draw', type, e);
      urls.set(type, '');
    }
  }
  if (drew) onReady?.();
}

function portrait(type: string): string {
  const obj = model(type);
  // Turned to show its shape, framed to fill the picture.
  obj.rotation.y += 0.6;
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dir = new THREE.Vector3(0.35, 0.45, 1).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, sphere.radius * 3);
  camera.lookAt(sphere.center);
  camera.updateMatrixWorld();
  // The item's extent as the camera sees it: fit the view to that, with a little margin.
  const view = new THREE.Box3();
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (!(o as THREE.Mesh).isMesh || !g) return;
    const pos = g.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 400))) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      view.expandByPoint(v);
    }
  });
  const cx = (view.min.x + view.max.x) / 2, cy = (view.min.y + view.max.y) / 2;
  const half = Math.max(view.max.x - view.min.x, view.max.y - view.min.y) / 2 * 1.08;
  camera.left = cx - half; camera.right = cx + half; camera.top = cy + half; camera.bottom = cy - half;
  camera.near = 0.001; camera.far = sphere.radius * 8;
  camera.updateProjectionMatrix();
  renderer!.render(scene, camera);
  const url = renderer!.domElement.toDataURL('image/png');
  scene.remove(obj);
  return url;
}

// ---------- simple models of things
const mat = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
const mesh = (geo: THREE.BufferGeometry, color: number, o?: THREE.MeshStandardMaterialParameters) => new THREE.Mesh(geo, mat(color, o));
const group = (...parts: THREE.Object3D[]) => { const g = new THREE.Group(); g.add(...parts); return g; };
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };

/** A few of something scattered in a little heap. */
function heap(make: (i: number) => THREE.Object3D, n: number, spread: number, seed = 1): THREE.Group {
  const g = new THREE.Group();
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const o = make(i);
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread;
    o.position.set(Math.cos(a) * d, o.position.y + r() * spread * 0.3, Math.sin(a) * d);
    o.rotation.y = r() * 6;
    g.add(o);
  }
  return g;
}

const stone = (color: number, r = 0.3) => mesh(new THREE.DodecahedronGeometry(r, 0).scale(1.2, 0.75, 1), color, { flatShading: true });
const mound = (color: number) => mesh(new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), color, { flatShading: true });
const stick = (len: number, r: number, color: number) => mesh(new THREE.CylinderGeometry(r * 0.85, r, len, 7), color);
const jar = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => {
  const pts = [[0, 0], [0.28, 0], [0.36, 0.2], [0.33, 0.45], [0.2, 0.62], [0.2, 0.72], [0.25, 0.76]].map(([x, y]) => new THREE.Vector2(x, y));
  return mesh(new THREE.LatheGeometry(pts, 20), color, { side: THREE.DoubleSide, ...o });
};
const bowl = (color: number, fill?: number) => {
  const pts = [[0, 0], [0.25, 0], [0.42, 0.18], [0.46, 0.26], [0.44, 0.27]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = group(mesh(new THREE.LatheGeometry(pts, 22), color, { side: THREE.DoubleSide }));
  if (fill !== undefined) g.add(at(mesh(new THREE.CircleGeometry(0.42, 20), fill), 0, 0.2, 0, -Math.PI / 2));
  return g;
};
const mushroom = (cap: number, stem: number, funnel = false) => {
  const capGeo = funnel ? new THREE.ConeGeometry(0.32, 0.25, 14, 1, true).rotateX(Math.PI) : new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  return group(at(stick(0.36, 0.08, stem), 0, 0.18, 0), at(mesh(capGeo, cap, { side: THREE.DoubleSide }), 0, funnel ? 0.42 : 0.32, 0));
};
const herb = (leaf: number, flower?: number) => {
  const g = group(at(stick(0.7, 0.025, 0x5a7a34), 0, 0.35, 0));
  for (let i = 0; i < 6; i++) g.add(at(mesh(new THREE.SphereGeometry(0.12, 8, 6).scale(1, 0.25, 0.5), leaf), Math.cos(i * 2.1) * 0.12, 0.15 + i * 0.08, Math.sin(i * 2.1) * 0.12, 0, i * 2.1, 0.5));
  if (flower !== undefined) g.add(at(mesh(new THREE.SphereGeometry(0.14, 10, 8).scale(1, 0.5, 1), flower), 0, 0.72, 0));
  return g;
};

function model(type: string): THREE.Object3D {
  const def = itemDef(type);
  if (def.tool) {
    // Tools as held in the hand (their model where there is one), laid at an angle.
    const t = buildToolMesh(def.tool, type);
    t.rotation.z = -0.75;
    return t;
  }
  if (def.wear) {
    const c = def.wear.colour;
    switch (def.wear.slot) {
      case 'head': return group(mesh(new THREE.SphereGeometry(0.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), c), at(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20), new THREE.Color(c).multiplyScalar(0.8).getHex()), 0, 0.02, 0));
      case 'body': return group(mesh(new THREE.BoxGeometry(0.7, 0.85, 0.32), c), at(mesh(new THREE.BoxGeometry(0.22, 0.55, 0.24), c), -0.48, 0.12, 0, 0, 0, -0.35), at(mesh(new THREE.BoxGeometry(0.22, 0.55, 0.24), c), 0.48, 0.12, 0, 0, 0, 0.35));
      case 'legs': return group(at(mesh(new THREE.BoxGeometry(0.26, 0.9, 0.26), c), -0.16, 0, 0), at(mesh(new THREE.BoxGeometry(0.26, 0.9, 0.26), c), 0.16, 0, 0), at(mesh(new THREE.BoxGeometry(0.6, 0.18, 0.28), c), 0, 0.42, 0));
      case 'feet': return group(at(mesh(new THREE.BoxGeometry(0.24, 0.4, 0.26), c), -0.18, 0.2, 0), at(mesh(new THREE.BoxGeometry(0.24, 0.14, 0.44), c), -0.18, 0.07, 0.1), at(mesh(new THREE.BoxGeometry(0.24, 0.4, 0.26), c), 0.18, 0.2, 0), at(mesh(new THREE.BoxGeometry(0.24, 0.14, 0.44), c), 0.18, 0.07, 0.1));
    }
  }
  switch (type) {
    case 'torch': { const t = buildToolMesh(undefined, 'torch'); t.rotation.set(0, 0, -0.75); return t; }
    case 'rock_shard': return heap(() => stone(0x8c8a84, 0.22), 3, 0.25, 3);
    case 'iron_ore': return heap(() => stone(0x8a4e30, 0.22), 3, 0.25, 5);
    case 'iron_lump': return mesh(new THREE.DodecahedronGeometry(0.35, 1).scale(1.3, 0.7, 1), 0x3c3c40, { metalness: 0.6, roughness: 0.5 });
    case 'dirt': return mound(0x5e4430);
    case 'sand': return mound(0xcdb98a);
    case 'clay': return mound(0x9a5a3a);
    case 'mortar': return bowl(0x6e665c, 0xb8b2a6);
    case 'branch': return group(at(stick(1.1, 0.05, 0x6b4a2c), 0, 0, 0, 0, 0, 1.2), at(stick(0.4, 0.03, 0x6b4a2c), 0.1, 0.12, 0, 0, 0, 0.4), at(mesh(new THREE.SphereGeometry(0.08, 6, 4).scale(1.4, 0.3, 0.8), 0x5d8a34), 0.18, 0.3, 0));
    case 'plant_fiber': return heap(() => at(mesh(new THREE.BoxGeometry(0.03, 0.9, 0.012), 0x9aa65a), 0, 0, 0, 0, 0, 1.35), 9, 0.1, 7);
    case 'cordage': return mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 28), 0xc8a96e);
    case 'log': return at(group(stick(1.1, 0.24, 0x5a3e28), at(mesh(new THREE.CircleGeometry(0.235, 18), 0xc89a62), 0, 0.551, 0, -Math.PI / 2)), 0, 0, 0, 0, 0, 1.3);
    case 'plank': return mesh(new THREE.BoxGeometry(1.2, 0.07, 0.28), 0xb0844e);
    case 'shaft': return at(stick(1.1, 0.035, 0xa07a4a), 0, 0, 0, 0, 0, 1.0);
    case 'kindling': return heap(() => at(mesh(new THREE.BoxGeometry(0.4, 0.04, 0.05), 0xb08a58), 0, 0, 0), 6, 0.12, 9);
    case 'sprout': return group(at(stick(0.5, 0.02, 0x6a7a3a), 0, 0.25, 0), at(mesh(new THREE.SphereGeometry(0.12, 8, 6).scale(1, 0.3, 0.6), 0x6aa040), 0.08, 0.45, 0, 0, 0, 0.4), at(mesh(new THREE.SphereGeometry(0.12, 8, 6).scale(1, 0.3, 0.6), 0x6aa040), -0.08, 0.38, 0, 0, 0, -0.4));
    case 'wheat_seeds': return heap(() => mesh(new THREE.SphereGeometry(0.05, 6, 4).scale(1.6, 1, 1), 0xd2b06a), 14, 0.22, 11);
    case 'wheat': return heap(() => group(at(stick(0.9, 0.012, 0xc8a85a), 0, 0.45, 0), at(mesh(new THREE.CapsuleGeometry(0.035, 0.16, 3, 6), 0xd8b45a), 0, 0.98, 0)), 6, 0.06, 13);
    case 'hide': return mesh(new THREE.CircleGeometry(0.55, 9).scale(1.3, 1, 1), 0x8a5e3a, { side: THREE.DoubleSide, flatShading: true });
    case 'clay_jar_unfired': case 'crucible_unfired': return jar(0x9a6a4a, { roughness: 1 });
    case 'clay_jar': return jar(0xc0703c);
    case 'crucible': { const j = jar(0x8a4a2a); j.scale.set(1.15, 0.7, 1.15); return j; }
    case 'jar_of_water': return group(jar(0xc0703c), at(mesh(new THREE.CircleGeometry(0.19, 16), 0x4a8ab0, { metalness: 0.2, roughness: 0.2 }), 0, 0.7, 0, -Math.PI / 2));
    case 'berries': return heap(() => mesh(new THREE.SphereGeometry(0.1, 10, 8), 0x3a3a8a, { roughness: 0.4 }), 9, 0.2, 15);
    case 'mushroom': return mushroom(0x8a5a32, 0xe8dcc4);
    case 'chanterelle': return mushroom(0xe0a030, 0xe8b850, true);
    case 'red_cap': return mushroom(0xc02a20, 0xf0ece0);
    case 'pale_cap': return mushroom(0xd8d4b0, 0xf0ece0);
    case 'roast_mushroom': return mushroom(0x5a3418, 0xa88a60);
    case 'yarrow': return herb(0x6a9a48, 0xf0f0e8);
    case 'hemlock': return herb(0x4a7a3a, 0xf4f4f0);
    case 'mint': return herb(0x58a058);
    case 'wild_onion': return herb(0x6aa050, 0xa060c0);
    case 'poultice': return mesh(new THREE.SphereGeometry(0.35, 12, 8).scale(1, 0.5, 1), 0x6a8a4a);
    case 'mint_tea': return bowl(0x8a5030, 0x8a9a4a);
    case 'hearty_stew': return bowl(0x6a4a30, 0x8a4a28);
    case 'raw_meat': return mesh(new THREE.BoxGeometry(0.7, 0.18, 0.45, 2, 1, 2), 0xb03a3a, { flatShading: true });
    case 'cooked_meat': return mesh(new THREE.BoxGeometry(0.65, 0.17, 0.42, 2, 1, 2), 0x7a4220, { flatShading: true });
    case 'flour': return mesh(new THREE.SphereGeometry(0.4, 12, 10).scale(1, 1.15, 1), 0xe8e0cc);
    case 'dough': return mesh(new THREE.SphereGeometry(0.4, 14, 10).scale(1, 0.5, 1), 0xe0cc9a);
    case 'bread': return mesh(new THREE.SphereGeometry(0.4, 16, 12).scale(1.5, 0.75, 1), 0xa8622a);
    case 'bellows': return group(mesh(new THREE.BoxGeometry(0.6, 0.06, 0.8), 0x8a6440), at(mesh(new THREE.BoxGeometry(0.58, 0.06, 0.78), 0x8a6440), 0, 0.25, 0, -0.25, 0, 0), at(stick(0.3, 0.05, 0x3a3a3c), 0, 0.08, 0.5, Math.PI / 2, 0, 0));
    case 'stone_anvil': return mesh(new THREE.BoxGeometry(0.8, 0.5, 0.5), 0x8a8782, { flatShading: true });
    case 'iron_anvil': return group(mesh(new THREE.BoxGeometry(0.5, 0.35, 0.35), 0x3a3a3e, { metalness: 0.5 }), at(mesh(new THREE.BoxGeometry(1.0, 0.2, 0.36), 0x45454a, { metalness: 0.5 }), 0, 0.27, 0));
    case 'quench_trough': return group(mesh(new THREE.CylinderGeometry(0.4, 0.34, 0.6, 18), 0x7a5634), at(mesh(new THREE.CircleGeometry(0.37, 18), 0x3f6f8a), 0, 0.25, 0, -Math.PI / 2));
    case 'corpse': return mesh(new THREE.CapsuleGeometry(0.25, 0.7, 4, 8).rotateZ(Math.PI / 2), 0x6a4a30);
  }
  return mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), 0x888070);
}
