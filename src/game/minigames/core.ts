import * as THREE from 'three';
import type { Gesture } from './tutorials';

// Hands-on crafting, in the spirit of Schedule 1: the view closes in on the
// workstation and you do the work yourself with the mouse. Each minigame is a
// small 3D diorama drawn over the (dimmed) world. How well you do sets most of
// the result's quality; your skill makes the work more forgiving.

export interface MgInput {
  /** Mouse movement this frame, in pixels. */
  dx: number;
  dy: number;
  /** Left button held / pressed this frame / released this frame. */
  down: boolean;
  pressed: boolean;
  released: boolean;
  wheel: number;
  /** In-game pointer in pixels and in normalised device coordinates. */
  x: number;
  y: number;
  ndc: THREE.Vector2;
}

export interface Meter {
  label: string;
  value: number; // 0..1
  /** Target band to keep the value in, if any. */
  band?: [number, number];
  color?: string;
}

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

export abstract class Minigame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.02, 60);
  /** 0..1: how far through the job you are. */
  progress = 0;
  done = false;
  /** Whether the in-game pointer is drawn. */
  showPointer = true;
  abstract readonly title: string;
  abstract readonly instructions: string;
  feedback: { text: string; good: boolean; t: number } | null = null;
  private perfSum = 0;
  private perfWeight = 0;
  protected time = 0;
  private particles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  protected raycaster = new THREE.Raycaster();

  /**
   * `ease` (0.15..1) comes from skill and tool: higher means wider sweet spots,
   * slower drift and more forgiving timing.
   */
  constructor(protected readonly ease: number) {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x403020, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 3, 2);
    this.scene.add(key);
    this.scene.add(this.camera);
  }

  abstract update(dt: number, i: MgInput): void;

  /** A short label floating by the work, saying what to do next. */
  hint(): { x: number; y: number; text: string; gesture?: Gesture } | null {
    return null;
  }

  /** Gauges shown in the HUD panel. */
  meters(): Meter[] {
    return [];
  }

  tick(dt: number, i: MgInput) {
    this.time += dt;
    if (this.feedback) {
      this.feedback.t -= dt;
      if (this.feedback.t <= 0) this.feedback = null;
    }
    for (const p of [...this.particles]) {
      p.life -= dt;
      p.vel.y -= 4 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 5;
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, p.life * 2);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(this.particles.indexOf(p), 1);
      }
    }
    this.update(dt, i);
  }

  /** Record how well something went (0..1), weighted by how much of it there was. */
  protected sample(quality: number, weight = 1) {
    this.perfSum += Math.max(0, Math.min(1, quality)) * weight;
    this.perfWeight += weight;
  }

  /** Overall performance 0..1. */
  performance(): number {
    return this.perfWeight > 0 ? this.perfSum / this.perfWeight : 0.5;
  }

  protected say(text: string, good: boolean, t = 0.9) {
    this.feedback = { text, good, t };
  }

  /** Little bits flying off: chips, sparks, flour. */
  protected burst(at: THREE.Vector3, color: number, n = 8, speed = 1.2, emissive = false) {
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.015),
        mat(color, { transparent: true, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive ? 2 : 0 }));
      m.position.copy(at);
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5 + 0.3, (Math.random() - 0.5) * 2).multiplyScalar(speed);
      this.scene.add(m);
      this.particles.push({ mesh: m, vel: v, life: 0.5 + Math.random() * 0.4 });
    }
  }

  /** Where the pointer ray meets a horizontal plane at height y. */
  protected onPlaneY(ndc: THREE.Vector2, y: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const r = this.raycaster.ray;
    if (Math.abs(r.direction.y) < 1e-4) return null;
    const t = (y - r.origin.y) / r.direction.y;
    return t > 0 ? r.origin.clone().addScaledVector(r.direction, t) : null;
  }

  /** Where the pointer ray meets a vertical plane at depth z. */
  protected onPlaneZ(ndc: THREE.Vector2, z: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const r = this.raycaster.ray;
    if (Math.abs(r.direction.z) < 1e-4) return null;
    const t = (z - r.origin.z) / r.direction.z;
    return t > 0 ? r.origin.clone().addScaledVector(r.direction, t) : null;
  }

  /** Screen position (pixels) of a point in the diorama. */
  protected toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  protected look(from: [number, number, number], at: [number, number, number]) {
    this.camera.position.set(...from);
    this.camera.lookAt(...at);
    this.camera.updateMatrixWorld();
  }

  resize() {
    const aspect = window.innerWidth / window.innerHeight;
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m.dispose();
      }
    });
  }
}

// ---------- prop helpers shared by the minigames
export { mat };

export function box(w: number, h: number, d: number, color: number, extra?: THREE.MeshStandardMaterialParameters) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra));
}

export function cyl(rTop: number, rBot: number, h: number, color: number, seg = 12, extra?: THREE.MeshStandardMaterialParameters) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat(color, extra));
}

/** A log lying along X. */
export function logMesh(len: number, r: number, bark = 0x5a3c22) {
  const g = new THREE.Group();
  const body = cyl(r, r, len, bark, 14);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  for (const s of [-1, 1]) {
    const end = cyl(r * 0.97, r * 0.97, 0.01, 0xc89a62, 14);
    end.rotation.z = Math.PI / 2;
    end.position.x = (s * len) / 2;
    g.add(end);
  }
  return g;
}

/** A wooden bench/table top with legs; top surface at y = 0. */
export function benchMesh(w = 2.2, d = 1.1) {
  const g = new THREE.Group();
  const top = box(w, 0.08, d, 0x7a5634);
  top.position.y = -0.04;
  g.add(top);
  for (const [x, z] of [[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]]) {
    const leg = box(0.08, 0.8, 0.08, 0x5e4026);
    leg.position.set(x, -0.48, z);
    g.add(leg);
  }
  return g;
}

/** A ring marker lying flat or facing the camera. */
export function ringMesh(r: number, color: number, thickness = 0.008) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, thickness, 6, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
  m.renderOrder = 10;
  return m;
}

/** A campfire: stone ring, logs and a flickering flame with its own light. */
export function fireMesh(): { group: THREE.Group; flicker: (t: number, strength?: number) => void } {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07), mat(0x77736c, { flatShading: true }));
    s.position.set(Math.cos(a) * 0.22, 0.03, Math.sin(a) * 0.22);
    g.add(s);
  }
  for (let i = 0; i < 3; i++) {
    const l = cyl(0.025, 0.025, 0.36, 0x4a2f1a, 6);
    l.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI);
    l.position.y = 0.04;
    g.add(l);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 7),
    new THREE.MeshStandardMaterial({ color: 0xffa030, emissive: 0xff6000, emissiveIntensity: 2.5, transparent: true, opacity: 0.85 }));
  flame.position.y = 0.2;
  g.add(flame);
  const light = new THREE.PointLight(0xff8a30, 3, 3, 1.5);
  light.position.y = 0.35;
  g.add(light);
  return {
    group: g,
    flicker: (t: number, strength = 1) => {
      const s = (0.8 + Math.sin(t * 17) * 0.1 + Math.sin(t * 7.3) * 0.08) * strength;
      flame.scale.set(s, s * (1.1 + Math.sin(t * 11) * 0.15), s);
      light.intensity = 2.5 * strength + Math.sin(t * 13) * 0.4;
    },
  };
}

/** Clamp helper. */
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
