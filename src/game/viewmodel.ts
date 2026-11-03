import * as THREE from 'three';
import type { ToolKind } from '../data/items';
import { buildToolMesh, HELD_ITEMS, swingPose, type SwingKind } from './tools';
import { CharacterRig, HOLD, type Pose as BodyPose, type Region } from './character';

// The first-person arm and tool, drawn in its own pass on top of the world so
// it never clips into the tree you're chopping.

export interface ViewSwing { kind: SwingKind; phase: number; impactAt: number }

/** A hand pose in camera space: position and rotation (x tips the tool forward/back, z tilts it sideways). */
interface Pose { p: [number, number, number]; r: [number, number, number] }

const REST: Pose = { p: [0.3, -0.32, -0.62], r: [-0.25, 0.15, -0.3] };
const POSES: Record<SwingKind, { up: Pose; hit: Pose }> = {
  // Axe and pick: wound up high over the right shoulder, driven down into the middle of the view.
  chop: { up: { p: [0.3, -0.1, -0.6], r: [0.95, 0.35, -0.8] }, hit: { p: [0.05, -0.24, -0.72], r: [-1.2, -0.2, 0.35] } },
  // Shovel: lift, then stab down and forward.
  dig: { up: { p: [0.26, -0.2, -0.5], r: [0.2, 0.1, -0.15] }, hit: { p: [0.12, -0.5, -0.8], r: [-0.9, 0, -0.05] } },
  reach: { up: REST, hit: { p: [0.18, -0.36, -0.82], r: [-0.8, 0, -0.1] } },
};

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 10);
  private hemi = new THREE.HemisphereLight(0xc8dcff, 0x5a4a32, 1.0);
  private sun = new THREE.DirectionalLight(0xfff1dc, 2);
  private hand = new THREE.Group();
  private forearm: THREE.Mesh;
  private tool = new THREE.Group();
  private toolKey = '';
  private bob = 0;
  /** 1 = lowered out of view, 0 = up. */
  lower = 1;
  /**
   * Your own arms (from the animated body), drawn on top of the world so they
   * never clip into what you're working on. They do just what your body does;
   * looking ahead, they're tipped up into view a little (a swing at waist
   * height would otherwise be out of sight), and looking down they line up
   * with your body.
   */
  private arms: CharacterRig | null = null;
  private armsTool = new THREE.Group();
  private armsToolKey = '';
  /** How much further off than true the arms are drawn (so what's in hand doesn't fill the view). */
  private armsReach = 0.1;
  /** Elbow, off the bottom-right corner: the forearm runs from here to the hand. */
  private elbow = new THREE.Vector3(0.5, -0.85, -0.5);

  constructor() {
    this.scene.add(this.hemi, this.sun, this.camera);
    this.sun.position.set(0.5, 1, 0.6);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.09), new THREE.MeshStandardMaterial({ color: 0xd9a982, roughness: 0.8 }));
    this.hand.add(fist);
    // Unit-length sleeve along +Z, stretched each frame between elbow and wrist.
    this.forearm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1).translate(0, 0, 0.5), new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 0.9 }));
    this.camera.add(this.hand, this.forearm);
  }

  useArms(rig: CharacterRig) {
    this.arms = rig;
    this.scene.add(rig.root);
    this.armsTool.position.set(HOLD.pos[0], HOLD.pos[1], HOLD.pos[2]);
    this.armsTool.rotation.set(HOLD.rot[0], HOLD.rot[1], HOLD.rot[2]);
    rig.hand.add(this.armsTool);
    this.hand.visible = this.forearm.visible = false;
  }

  get hasArms(): boolean {
    return !!this.arms;
  }

  /**
   * The arms this frame: the body's pose, where the body stands and faces,
   * the eye they're seen from and the camera.
   */
  updateArms(dt: number, show: boolean, pose: BodyPose | null, blend: number, body: THREE.Object3D, eye: THREE.Vector3, pitch: number,
    cam: THREE.PerspectiveCamera, tool: { kind: ToolKind | undefined; type?: string }, colours: Partial<Record<Region, number>>, light: { hemi: number; sun: number }) {
    const rig = this.arms;
    if (!rig) return;
    this.hemi.intensity = light.hemi;
    this.sun.intensity = light.sun;
    this.lower = show ? 0 : 1;
    rig.root.visible = show;
    if (!show || !pose) return;
    const key = `${tool.kind}:${tool.type}`;
    if (key !== this.armsToolKey) {
      this.armsToolKey = key;
      this.armsTool.clear();
      if (tool.kind || (tool.type && HELD_ITEMS.has(tool.type))) this.armsTool.add(buildToolMesh(tool.kind, tool.type));
      // A torch held at ease would sit right under your nose: smaller, and with the hand further off.
      this.armsTool.scale.setScalar(tool.type === 'torch' ? 0.7 : 1);
      this.armsReach = tool.type === 'torch' ? 0.3 : 0.1;
    }
    rig.setColours(colours);
    rig.update(dt, pose, blend);
    // Seen from the world camera (same place, same lens).
    this.camera.position.copy(cam.position);
    this.camera.quaternion.copy(cam.quaternion);
    if (this.camera.fov !== cam.fov || this.camera.near !== 0.03) { this.camera.fov = cam.fov; this.camera.near = 0.03; this.camera.updateProjectionMatrix(); }
    // Stand with the body, tipped back about the eyes by more the further up you look.
    const tilt = 0.6 * THREE.MathUtils.clamp((pitch + 0.9) / 0.9, 0, 1);
    const yaw = body.rotation.y;
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const q = new THREE.Quaternion().setFromAxisAngle(right, tilt);
    rig.root.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    rig.root.position.copy(body.position).sub(eye).applyQuaternion(q).add(eye);
    // A little further off than true, so a tool doesn't fill the view.
    rig.root.position.x += Math.sin(yaw) * this.armsReach;
    rig.root.position.z += Math.cos(yaw) * this.armsReach;
    rig.head.scale.setScalar(0.001);
  }

  setTool(kind: ToolKind | undefined, itemType?: string) {
    const key = `${kind}:${itemType}`;
    if (key === this.toolKey) return;
    this.toolKey = key;
    this.hand.remove(this.tool);
    this.tool = buildToolMesh(kind, itemType);
    this.tool.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = false; });
    // Gripped low on the handle, blade facing away from you.
    this.tool.rotation.y = Math.PI;
    this.tool.position.y = -0.05;
    this.hand.add(this.tool);
  }

  /**
   * @param show whether hands should be visible at all
   * @param swing current action swing, if any
   * @param moving walking speed 0..1 for bob
   */
  update(dt: number, show: boolean, swing: ViewSwing | null, moving: number, light: { hemi: number; sun: number }) {
    this.hemi.intensity = light.hemi;
    this.sun.intensity = light.sun;
    this.lower += ((show ? 0 : 1) - this.lower) * Math.min(1, dt * 10);
    this.bob += dt * (4 + moving * 6);
    const bobY = Math.sin(this.bob * 2) * 0.008 * (0.3 + moving);
    const bobX = Math.cos(this.bob) * 0.01 * (0.3 + moving);

    const p = [...REST.p] as [number, number, number];
    const r = [...REST.r] as [number, number, number];
    if (swing) {
      const { raise, drive, jolt } = swingPose(swing.kind, swing.phase, swing.impactAt);
      const { up, hit } = POSES[swing.kind];
      for (let k = 0; k < 3; k++) {
        p[k] += (up.p[k] - REST.p[k]) * raise + (hit.p[k] - REST.p[k]) * drive;
        r[k] += (up.r[k] - REST.r[k]) * raise + (hit.r[k] - REST.r[k]) * drive;
      }
      // The blade stops dead in the wood and shudders.
      if (jolt > 0) {
        p[1] += jolt * 0.025;
        r[0] += (Math.random() - 0.5) * 0.08 * jolt;
        r[2] += (Math.random() - 0.5) * 0.08 * jolt;
      }
    }
    this.hand.position.set(p[0] + bobX, p[1] + bobY - this.lower * 0.7, p[2]);
    this.hand.rotation.set(r[0], r[1], r[2]);
    // Forearm from the off-screen elbow to the wrist.
    const wrist = this.hand.position;
    const elbow = this.elbow.clone().add(new THREE.Vector3(0, -this.lower * 0.7, 0));
    this.forearm.position.copy(elbow);
    this.forearm.lookAt(this.camera.localToWorld(wrist.clone()));
    this.forearm.scale.z = elbow.distanceTo(wrist);
  }

  render(renderer: THREE.WebGLRenderer) {
    if (this.lower > 0.98) return;
    const aspect = window.innerWidth / window.innerHeight;
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}
