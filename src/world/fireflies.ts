import * as THREE from 'three';
import type { Terrain } from './terrain';

const N = 70;

/** A soft round glow for each light. */
function glow(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
const RADIUS = 20;

/** Fireflies drifting low over damp ground on warm nights, each blinking on its own rhythm. */
export class Fireflies {
  readonly points: THREE.Points;
  private pos = new Float32Array(N * 3);
  private col = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private phase = new Float32Array(N);
  private rate = new Float32Array(N);
  private spawned = false;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.3, map: glow(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    for (let i = 0; i < N; i++) { this.phase[i] = Math.random() * 10; this.rate[i] = 0.6 + Math.random() * 1.2; }
  }

  private place(i: number, cam: THREE.Vector3, t: Terrain) {
    const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * (RADIUS - 3);
    const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = Math.max(t.heightAt(x, z), t.waterAt(x, z)) + 0.3 + Math.random() * 1.6;
    this.pos[i * 3 + 2] = z;
  }

  /** `level` 0..1: how many are about (night, damp, sheltered). */
  update(dt: number, time: number, cam: THREE.Vector3, t: Terrain, level: number) {
    this.points.visible = level > 0.02;
    if (!this.points.visible) { this.spawned = false; return; }
    if (!this.spawned) { for (let i = 0; i < N; i++) this.place(i, cam, t); this.spawned = true; }
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      // Lazy wandering.
      for (let k = 0; k < 3; k++) {
        this.vel[j + k] += (Math.random() - 0.5) * dt * (k === 1 ? 0.8 : 2);
        this.vel[j + k] *= 1 - dt * 0.8;
        this.pos[j + k] += this.vel[j + k] * dt;
      }
      const ground = t.heightAt(this.pos[j], this.pos[j + 2]);
      if (this.pos[j + 1] < ground + 0.2) this.vel[j + 1] += dt * 2;
      if (this.pos[j + 1] > ground + 2.5) this.vel[j + 1] -= dt * 2;
      if (Math.hypot(this.pos[j] - cam.x, this.pos[j + 2] - cam.z) > RADIUS) this.place(i, cam, t);
      // Only some of them are out tonight; each blinks slowly.
      const on = i < N * level ? Math.pow(Math.max(0, Math.sin(time * this.rate[i] + this.phase[i])), 6) : 0;
      this.col[j] = 0.75 * on; this.col[j + 1] = 1.0 * on; this.col[j + 2] = 0.3 * on;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
