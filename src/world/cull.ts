import * as THREE from 'three';

/**
 * What the camera can see, for things that sort out their own instances (the
 * near trees, the grass) rather than leave it to three.js, which can only keep
 * or drop a whole instanced mesh at once.
 *
 * Tests are a little generous, so a set worked out once stays good while you
 * turn a few degrees or take a step or two; `version` changes only when the
 * view has moved past that, and only then need sets be redone.
 */
export class ViewCull {
  /** Bumped whenever the view has moved enough that sets should be redone. */
  version = 0;
  private planes = Array.from({ length: 6 }, () => new THREE.Plane());
  private frustum = new THREE.Frustum();
  private m = new THREE.Matrix4();
  private at = new THREE.Vector3(NaN, NaN, NaN);
  private dir = new THREE.Vector3();
  private sinTurn: number;
  /** Where shadows fall from a point (ground metres per metre of height), so things just out of view still cast into it. */
  readonly shadow = new THREE.Vector3();

  /** Degrees the view may turn, and metres it may move, before sets are redone. */
  constructor(readonly turn = 5, readonly step = 2) {
    this.sinTurn = Math.sin((turn * Math.PI) / 180) * 1.2;
  }

  update(cam: THREE.PerspectiveCamera, sunDir?: THREE.Vector3) {
    const d = cam.getWorldDirection(new THREE.Vector3());
    const p = cam.getWorldPosition(new THREE.Vector3());
    if (p.distanceTo(this.at) < this.step && d.dot(this.dir) > Math.cos((this.turn * Math.PI) / 180)) return;
    this.at.copy(p);
    this.dir.copy(d);
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (let i = 0; i < 6; i++) this.planes[i].copy(this.frustum.planes[i]);
    if (sunDir && sunDir.y > 0.05) {
      // Shadows fall away from the sun, longer the lower it is (capped).
      const k = Math.min(3, Math.sqrt(1 - sunDir.y * sunDir.y) / sunDir.y);
      this.shadow.set(-sunDir.x, 0, -sunDir.z).normalize().multiplyScalar(k);
    } else this.shadow.set(0, 0, 0);
    this.version++;
  }

  /** Whether a sphere is (near enough) in view. */
  sphere(x: number, y: number, z: number, r: number): boolean {
    const a = this.at;
    // Room for the turn and step allowed before the next redo.
    r += this.step + Math.hypot(x - a.x, y - a.y, z - a.z) * this.sinTurn;
    const P = this.planes;
    for (let i = 0; i < 6; i++) {
      const n = P[i].normal;
      if (n.x * x + n.y * y + n.z * z + P[i].constant < -r) return false;
    }
    return true;
  }

  /**
   * Whether a sphere, or the shadow it casts (`height` metres tall, standing
   * on the ground below its centre), could be in view.
   */
  caster(x: number, y: number, z: number, r: number, height: number): boolean {
    if (this.sphere(x, y, z, r)) return true;
    const s = this.shadow;
    if (!s.x && !s.z) return false;
    const L = height;
    return this.sphere(x + s.x * L * 0.5, y - height * 0.25, z + s.z * L * 0.5, r + L * 0.3)
      || this.sphere(x + s.x * L, y - height * 0.5, z + s.z * L, r + L * 0.3);
  }
}
