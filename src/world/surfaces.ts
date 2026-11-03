import * as THREE from 'three';

// Photographed surfaces for things built (planks, logs, thatch, stone): each a
// colour map, an OpenGL normal map and AO/rough/metal packed in one, loaded
// the first time something uses it. Geometry gets UVs measured in metres
// (see `worldUV`), so a texture keeps its real size on any piece.

/** Each surface: where its maps are, the metres one repeat covers, and its colour until they load. */
const SURFACES = {
  planks: { url: 'textures/building/wood_planks', size: 2, base: 0x8a6440 },
  dark_planks: { url: 'textures/building/dark_wooden_planks', size: 2, base: 0x4e3424 },
  log_wall: { url: 'textures/building/log_wall', size: 2.6, base: 0x5a3c2a },
  rough_wood: { url: 'textures/building/rough_wood', size: 1.2, base: 0x6e665c },
  thatch: { url: 'textures/building/thatch_roof', size: 2, base: 0xa08c5a },
  stone: { url: 'textures/terrain/rock', size: 2.4, base: 0x8a8782 },
  stone_wall: { url: 'textures/building/rough_stone_wall', size: 2.2, base: 0x8a8070 },
  foundation: { url: 'textures/building/stone_foundation', size: 2.4, base: 0xa08a70 },
} as const;
export type Surface = keyof typeof SURFACES;

const loader = typeof document === 'undefined' ? null : new THREE.TextureLoader();
type Maps = { map: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture };
/** Each surface's maps once all three have loaded, and the materials waiting on them. */
const loaded = new Map<Surface, Maps>();
const waiting = new Map<Surface, THREE.MeshStandardMaterial[]>();

function withMaps(m: THREE.MeshStandardMaterial, t: Maps, tint: number) {
  m.map = t.map; m.normalMap = t.normal; m.aoMap = t.orm; m.roughnessMap = t.orm;
  m.roughness = 1;
  m.color.setHex(tint);
  m.needsUpdate = true;
}

function load(s: Surface) {
  const { url } = SURFACES[s];
  const one = (file: string, colour: boolean) => new Promise<THREE.Texture>((done, fail) => loader!.load(`${url}_${file}.jpg`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    done(t);
  }, undefined, fail));
  Promise.all([one('color', true), one('normal', false), one('orm', false)]).then(([map, normal, orm]) => {
    const t = { map, normal, orm };
    loaded.set(s, t);
    for (const m of waiting.get(s) ?? []) withMaps(m, t, m.userData.tint);
    waiting.delete(s);
  }, (e) => console.warn('Could not load surface', s, e));
}

/** Whether any surface's textures are still on their way (pictures drawn now would come out plain). */
export function surfacesLoading(): boolean {
  return waiting.size > 0;
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
/**
 * The material for a surface, tinted (shared: don't change it). Until its
 * maps have loaded it's a plain colour, so nothing shows black meanwhile.
 */
export function surfaceMat(s: Surface, tint = 0xffffff): THREE.MeshStandardMaterial {
  const key = `${s}:${tint}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(SURFACES[s].base).multiply(new THREE.Color(tint)), roughness: 0.9, metalness: 0 });
    m.userData.tint = tint;
    const t = loaded.get(s);
    if (t) withMaps(m, t, tint);
    else if (loader) {
      if (!waiting.has(s)) { waiting.set(s, []); load(s); }
      waiting.get(s)!.push(m);
    }
    mats.set(key, m);
  }
  return m;
}

/**
 * Give a geometry UVs in metres over the surface's repeat: each face is
 * projected along the axis it faces most (so a box's sides, top and ends each
 * get the texture at its real size). `turn` swaps U and V, for grain running
 * the other way.
 */
export function worldUV(geo: THREE.BufferGeometry, s: Surface, turn = false): THREE.BufferGeometry {
  const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
  const k = 1 / SURFACES[s].size;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    if (turn) [u, v] = [v, u];
    uv[i * 2] = u * k;
    uv[i * 2 + 1] = v * k;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** A cylinder's UVs in metres: around it, and along it. */
export function cylinderUV(geo: THREE.CylinderGeometry, s: Surface): THREE.CylinderGeometry {
  const { radiusTop, radiusBottom, height } = geo.parameters;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute, k = 1 / SURFACES[s].size;
  const round = Math.PI * (radiusTop + radiusBottom);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * round * k, uv.getY(i) * height * k);
  uv.needsUpdate = true;
  return geo;
}
