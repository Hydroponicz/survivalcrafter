import * as THREE from 'three';
import type { Village } from './villages';

// The lights of the night, kept cheap. Nothing here is a real light: windows
// glow through one shared material (a whole town's windows stay one draw),
// lanterns are instanced (a draw for all their glass, one for their frames,
// one for the posts), and every flame and lamp gets a soft halo from one
// shared set of points (one draw). Only the few nearest of them borrow one of
// the scene's handful of real lights (see View.updateFires), so the ground
// round you is lit too.

/** How much it's night (0 by day, 1 in the dark), from the time of day. */
export function nightAmount(dayFraction: number): number {
  const f = dayFraction;
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // Lamps are lit through the dusk and put out at dawn.
  return Math.max(ss(0.72, 0.8, f), 1 - ss(0.2, 0.27, f));
}

/** Window panes: dark glass by day, warm lamplight behind them at night. Shared by every window. */
export const WINDOW_GLOW = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.35, metalness: 0.1, emissive: 0xff8a30, emissiveIntensity: 0 });
/** A lantern's glass (and a ship's): lit at night. */
export const LANTERN_GLASS = new THREE.MeshStandardMaterial({ color: 0xffe0a8, roughness: 0.4, emissive: 0xffb050, emissiveIntensity: 0.15 });
const IRON = new THREE.MeshStandardMaterial({ color: 0x24201c, roughness: 0.6, metalness: 0.5 });
const POST = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.95 });
for (const m of [WINDOW_GLOW, LANTERN_GLASS, IRON, POST]) m.userData.shared = true;

/** Turn the lamps up (or down) for the time of day. */
export function setNight(n: number) {
  WINDOW_GLOW.emissiveIntensity = n * 0.85;
  LANTERN_GLASS.emissiveIntensity = 0.15 + n * 2.6;
}

// ---------- the lantern itself (shared geometry)
const GLASS_GEO = new THREE.BoxGeometry(0.16, 0.22, 0.16);
const FRAME_GEO = (() => {
  // A cap and a base of iron, four corner rods and a ring to hang it by: merged into one.
  const parts: THREE.BufferGeometry[] = [
    new THREE.ConeGeometry(0.14, 0.1, 4).rotateY(Math.PI / 4).translate(0, 0.16, 0),
    new THREE.BoxGeometry(0.19, 0.03, 0.19).translate(0, -0.12, 0),
    new THREE.TorusGeometry(0.035, 0.008, 4, 10).translate(0, 0.24, 0),
  ];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(new THREE.BoxGeometry(0.018, 0.24, 0.018).translate(x * 0.085, 0, z * 0.085));
  const merged = mergeAll(parts);
  return merged;
})();
const POST_GEO = (() => mergeAll([
  new THREE.CylinderGeometry(0.06, 0.075, 2.6, 7).translate(0, 1.3, 0),
  new THREE.BoxGeometry(0.5, 0.06, 0.06).translate(0.22, 2.55, 0),
]))();

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let base = 0;
  for (const p of parts) {
    const g = p.index ? p : p;
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < P.count; i++) idx.push(i + base);
    base += P.count;
    p.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/** A lantern as a little group (for a ship's stern or a hand): glass and frame. */
export function lanternModel(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(GLASS_GEO, LANTERN_GLASS);
  const frame = new THREE.Mesh(FRAME_GEO, IRON);
  frame.castShadow = true;
  g.add(glass, frame);
  for (const c of [glass, frame]) c.geometry.userData.shared = true;
  return g;
}

/** A soft round halo, drawn once. */
function haloTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,236,190,1)');
  g.addColorStop(0.18, 'rgba(255,190,110,0.75)');
  g.addColorStop(0.5, 'rgba(255,140,60,0.22)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A light the night offers the real-light pool: where, and how strong. */
export interface NightLight { x: number; y: number; z: number; strength: number }

const MAX_LANTERNS = 1024, MAX_GLOWS = 1536;
/** Villages' lanterns are hung within this distance of you, and taken down beyond the second. */
const HANG_R = 260, DROP_R = 380;

export class NightLights {
  readonly group = new THREE.Group();
  private glass: THREE.InstancedMesh;
  private frames: THREE.InstancedMesh;
  private posts: THREE.InstancedMesh;
  private glows: THREE.Points;
  private glowPos: Float32Array;
  private glowCount = 0;
  /** Villages with lanterns hung (by name), and every lantern and post placed. */
  private hung = new Map<string, { v: Village; lanterns: THREE.Vector3[]; posts: { x: number; y: number; z: number; yaw: number }[] }>();
  private dirty = true;
  private checkT = 0;
  /** This frame's offer to the real-light pool (nearest first is sorted by the view). */
  readonly lights: NightLight[] = [];

  constructor() {
    this.glass = new THREE.InstancedMesh(GLASS_GEO, LANTERN_GLASS, MAX_LANTERNS);
    this.frames = new THREE.InstancedMesh(FRAME_GEO, IRON, MAX_LANTERNS);
    this.posts = new THREE.InstancedMesh(POST_GEO, POST, 256);
    this.frames.castShadow = this.posts.castShadow = true;
    for (const m of [this.glass, this.frames, this.posts]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
    this.glowPos = new Float32Array(MAX_GLOWS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.glows = new THREE.Points(geo, new THREE.PointsMaterial({
      map: haloTexture(), size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: 0xffffff,
    }));
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 4;
    this.group.add(this.glows);
  }

  /**
   * Each frame: hang lanterns in the villages round you (now and then), and
   * gather this frame's halos: the lanterns, and whatever else is offered
   * (torches carried, ships' lanterns).
   */
  update(dt: number, night: number, px: number, pz: number, villagesNear: () => Village[], groundAt: (x: number, z: number) => number, extra: NightLight[]) {
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 1.5;
      for (const v of villagesNear()) if (!this.hung.has(v.name) && Math.hypot(v.x - px, v.z - pz) < HANG_R + v.r) { this.hang(v, groundAt); this.dirty = true; }
      for (const [k, h] of this.hung) if (Math.hypot(h.v.x - px, h.v.z - pz) > DROP_R + h.v.r) { this.hung.delete(k); this.dirty = true; }
    }
    if (this.dirty) this.rebuild();
    (this.glows.material as THREE.PointsMaterial).opacity = Math.min(1, night * 1.1);
    this.lights.length = 0;
    this.glowCount = 0;
    if (night < 0.02) { this.glows.geometry.setDrawRange(0, 0); return; }
    const add = (x: number, y: number, z: number) => {
      if (this.glowCount >= MAX_GLOWS) return;
      const i = this.glowCount++ * 3;
      this.glowPos[i] = x; this.glowPos[i + 1] = y; this.glowPos[i + 2] = z;
    };
    // The lanterns near enough to see (their halos), and the nearest few for real light.
    for (const h of this.hung.values()) {
      if (Math.hypot(h.v.x - px, h.v.z - pz) > 200 + h.v.r) continue;
      for (const l of h.lanterns) {
        const d = Math.abs(l.x - px) + Math.abs(l.z - pz);
        if (d > 220) continue;
        add(l.x, l.y, l.z);
        if (d < 45) this.lights.push({ x: l.x, y: l.y, z: l.z, strength: 0.45 * night });
      }
    }
    for (const e of extra) { add(e.x, e.y, e.z); if (Math.abs(e.x - px) + Math.abs(e.z - pz) < 45) this.lights.push({ ...e, strength: e.strength * night }); }
    const attr = this.glows.geometry.attributes.position as THREE.BufferAttribute;
    attr.needsUpdate = true;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, this.glowCount * 3);
    this.glows.geometry.setDrawRange(0, this.glowCount);
  }

  /** Lanterns for a village: one by every door (hung on the wall beside it), and posts round its square. */
  private hang(v: Village, groundAt: (x: number, z: number) => number) {
    const lanterns: THREE.Vector3[] = [], posts: { x: number; y: number; z: number; yaw: number }[] = [];
    for (const h of v.houses) {
      // The door faces out from the house's middle; hang the lantern on the wall beside it, a little above the door.
      const ox = h.door.x - h.x, oz = h.door.z - h.z, l = Math.hypot(ox, oz) || 1;
      const nx = ox / l, nz = oz / l, sx = -nz, sz = nx;
      const wx = h.door.x - nx * 0.75 + sx * 0.75, wz = h.door.z - nz * 0.75 + sz * 0.75;
      lanterns.push(new THREE.Vector3(wx, h.y + 2.15, wz));
    }
    // Lantern posts round the square (a village's fire, a town's market).
    const sq = v.square, n = v.kind === 'village' ? 3 : 6, r = Math.max(4.5, sq.r * 0.85);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.4, x = sq.x + Math.cos(a) * r, z = sq.z + Math.sin(a) * r, y = groundAt(x, z);
      const yaw = Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI;
      posts.push({ x, y, z, yaw });
      // (The lantern hangs from the post's arm, out over the square.)
      lanterns.push(new THREE.Vector3(x + Math.cos(yaw) * 0.42, y + 2.25, z - Math.sin(yaw) * 0.42));
    }
    this.hung.set(v.name, { v, lanterns, posts });
  }

  private rebuild() {
    this.dirty = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let i = 0, j = 0;
    for (const h of this.hung.values()) {
      for (const l of h.lanterns) {
        if (i >= MAX_LANTERNS) break;
        m.compose(l, q.identity(), s);
        this.glass.setMatrixAt(i, m);
        this.frames.setMatrixAt(i, m);
        i++;
      }
      for (const p of h.posts) {
        if (j >= 256) break;
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), s);
        this.posts.setMatrixAt(j++, m);
      }
    }
    this.glass.count = this.frames.count = i;
    this.posts.count = j;
    for (const im of [this.glass, this.frames, this.posts]) im.instanceMatrix.needsUpdate = true;
  }
}
