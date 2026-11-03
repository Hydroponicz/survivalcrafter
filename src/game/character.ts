import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// The player's body: the rigged, animated model (public/models/character.glb,
// made by scripts/bake-character.mjs). It has no texture: each part of the
// body (skin, hair, tunic, trousers, boots, belt) is marked in its vertex
// colours, and coloured here, so what you wear can recolour it.

export const REGIONS = ['skin', 'hair', 'tunic', 'trousers', 'boots', 'belt'] as const;
export type Region = (typeof REGIONS)[number];

/** As you start out: plain undyed homespun and worn leather. */
export const BASE_COLOURS: Record<Region, number> = {
  skin: 0xc99474, hair: 0x3b2a1e, tunic: 0x8c7b5e, trousers: 0x5c4c3a, boots: 0x3d2c1f, belt: 0x2c2018,
};

/** How a tool sits in the right hand (in the hand bone's frame). */
export const HOLD = { pos: [0, 0.08, 0.03] as const, rot: [0, 0, -Math.PI / 2] as const };

/** Every clip in the model. */
export type Clip =
  | 'idle' | 'walk' | 'run' | 'sprint' | 'sprint_long' | 'walk_back' | 'strafe_left' | 'strafe_right' | 'jump' | 'pickup'
  | 'crouch_idle' | 'crouch_walk' | 'chop' | 'mine' | 'gather' | 'sickle' | 'hammer' | 'place' | 'craft'
  | 'drink' | 'eat' | 'interact' | 'attack_one' | 'attack_two' | 'block' | 'hurt' | 'death';

let loading: Promise<GLTF> | null = null;
let loaded: GLTF | null = null;

/** Start loading the model (once); resolves when it's ready. */
export function loadCharacter(): Promise<GLTF> {
  loading ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('models/character.glb')
    .then((g) => { loaded = g; return g; });
  return loading;
}

export function characterLoaded(): GLTF | null {
  return loaded;
}

/** A material colouring each part of the body; `colours` (one per region) can be changed at any time. */
export function characterMaterial(armsOnly = false): { material: THREE.MeshStandardMaterial; colours: THREE.Color[] } {
  const colours = REGIONS.map((r) => new THREE.Color(BASE_COLOURS[r]));
  // Cloth and skin: hardly any sheen (seen edge-on, as you look down at yourself, it would glare).
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, envMapIntensity: 0.45 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRegionCol = { value: colours };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 color;
${armsOnly ? 'attribute float arm;\nvarying float vArm;' : ''}
uniform vec3 uRegionCol[${REGIONS.length}];
varying vec3 vRegionCol;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${armsOnly ? 'vArm = arm;' : ''}
vRegionCol = uRegionCol[int(clamp(color.r * 8.0 + 0.5, 0.0, ${REGIONS.length - 1}.0))];`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRegionCol;
${armsOnly ? 'varying float vArm;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${armsOnly ? 'if (vArm < 0.5) discard;' : ''}
diffuseColor.rgb *= vRegionCol;`);
  };
  material.customProgramCacheKey = () => (armsOnly ? 'character-arms' : 'character');
  return { material, colours };
}

/** Bones of the arms and hands (not the shoulders), whose skin makes up the arms. */
const ARM_BONE = /(Left|Right)(Arm|ForeArm|Hand)/;

/** Mark each vertex by how much it belongs to an arm (for the first-person arms). */
function markArms(mesh: THREE.SkinnedMesh) {
  const geo = mesh.geometry;
  if (geo.getAttribute('arm')) return;
  const idx = geo.getAttribute('skinIndex'), wt = geo.getAttribute('skinWeight');
  const isArm = mesh.skeleton.bones.map((b) => ARM_BONE.test(b.name));
  const out = new Float32Array(idx.count);
  for (let i = 0; i < idx.count; i++) {
    let a = 0;
    for (let k = 0; k < 4; k++) if (isArm[idx.getComponent(i, k)]) a += wt.getComponent(i, k);
    out[i] = a;
  }
  geo.setAttribute('arm', new THREE.BufferAttribute(out, 1));
}

/** A fresh copy of the model (its own skeleton) with its own colours. */
export function makeFigure(g: GLTF, armsOnly = false): { root: THREE.Object3D; colours: THREE.Color[]; material: THREE.MeshStandardMaterial } {
  const root = cloneSkinned(g.scene);
  const { material, colours } = characterMaterial(armsOnly);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.SkinnedMesh;
      if (armsOnly) markArms(m);
      m.material = material;
      m.castShadow = true;
      m.receiveShadow = true;
      // The body moves about with the animation: don't let it be culled by its bind pose.
      m.frustumCulled = false;
    }
  });
  return { root, colours, material };
}

/**
 * Part of a clip played in step with a job (a swing, a reach): `from` to
 * `to` seconds into the clip, with the blow landing (or the hand arriving)
 * at `hit`.
 */
export interface Segment { from: number; hit: number; to: number }

export const SEGMENTS: Partial<Record<Clip, Segment>> = {
  chop: { from: 0.25, hit: 1.6, to: 2.05 },
  mine: { from: 0.5, hit: 1.5, to: 2.6 },
  sickle: { from: 0.3, hit: 1.1, to: 2.0 },
  attack_one: { from: 0.3, hit: 1.6, to: 2.3 },
  attack_two: { from: 0.3, hit: 1.4, to: 2.5 },
  pickup: { from: 0.1, hit: 0.8, to: 1.5 },
  place: { from: 0.6, hit: 2.0, to: 2.6 },
  jump: { from: 0.85, hit: 1.2, to: 1.75 },
  hurt: { from: 0.2, hit: 0.6, to: 1.9 },
};

/** How fast each walking clip goes over the ground as made (m/s), so feet don't skate. */
const GAIT: Partial<Record<Clip, number>> = {
  walk: 1.25, run: 2.6, sprint: 4.0, crouch_walk: 0.85, walk_back: 0.95, strafe_left: 1.1, strafe_right: 1.1,
};

/** Where in a segment a job is (`phase` 0..1, the blow at `impactAt`). */
export function segmentTime(s: Segment, phase: number, impactAt: number): number {
  const p = Math.max(0, Math.min(1, phase));
  return p < impactAt ? s.from + (s.hit - s.from) * (p / Math.max(1e-3, impactAt)) : s.hit + (s.to - s.hit) * ((p - impactAt) / Math.max(1e-3, 1 - impactAt));
}

/** What the body should be doing this frame. */
export type Pose =
  | { kind: 'loop'; clip: Clip; speed?: number }
  | { kind: 'move'; clip: Clip; groundSpeed: number }
  | { kind: 'scrub'; clip: Clip; time: number };

/**
 * One animated body: the model, its mixer and a clip for each thing it does.
 * Each frame, say what it should be doing (`pose`); it blends across.
 */
export class CharacterRig {
  readonly root: THREE.Object3D;
  readonly colours: THREE.Color[];
  readonly mixer: THREE.AnimationMixer;
  /** The right hand (hold things here) and the head. */
  readonly hand: THREE.Object3D;
  readonly head: THREE.Object3D;
  private actions = new Map<Clip, THREE.AnimationAction>();
  private current: Clip | null = null;
  /** Fading out, with how much of it is left. */
  private fading = new Map<Clip, number>();
  private weight = new Map<Clip, number>();

  /** The upper arms (fold them away to hide the arms, hands and whatever they hold). */
  readonly arms: THREE.Object3D[];

  constructor(g: GLTF, armsOnly = false) {
    const f = makeFigure(g, armsOnly);
    this.root = f.root;
    this.colours = f.colours;
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const clip of g.animations) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.actions.set(clip.name as Clip, a);
    }
    this.hand = this.root.getObjectByName('mixamorigRightHand')!;
    this.head = this.root.getObjectByName('mixamorigHead')!;
    this.arms = ['mixamorigLeftArm', 'mixamorigRightArm'].map((n) => this.root.getObjectByName(n)!);
  }

  has(clip: Clip): boolean {
    return this.actions.has(clip);
  }

  setColours(colours: Partial<Record<Region, number>>) {
    REGIONS.forEach((r, i) => this.colours[i].set(colours[r] ?? BASE_COLOURS[r]));
  }

  /** Show what the body should be doing, blending from what it was over `blend` seconds. */
  update(dt: number, pose: Pose, blend = 0.18) {
    const a = this.actions.get(pose.clip);
    if (!a) { this.mixer.update(dt); return; }
    if (pose.clip !== this.current) {
      if (this.current) this.fading.set(this.current, this.weight.get(this.current) ?? 1);
      this.fading.delete(pose.clip);
      // Loops and gaits pick up where they would be; a job starts where it's told.
      if (pose.kind !== 'scrub' && !this.weight.get(pose.clip)) a.time = 0;
      this.current = pose.clip;
    }
    // Blend weights: the current clip rises, the others fall away.
    const step = blend > 0 ? dt / blend : 1;
    const cur = Math.min(1, (this.weight.get(pose.clip) ?? 0) + step);
    this.weight.set(pose.clip, cur);
    for (const [clip, w] of this.fading) {
      const nw = Math.max(0, w - step);
      if (nw <= 0) { this.fading.delete(clip); this.weight.set(clip, 0); this.actions.get(clip)!.setEffectiveWeight(0); }
      else { this.fading.set(clip, nw); this.weight.set(clip, nw); }
    }
    // Normalise so the pose is always a whole one.
    let total = cur;
    for (const w of this.fading.values()) total += w;
    a.setEffectiveWeight(cur / total);
    for (const [clip, w] of this.fading) this.actions.get(clip)!.setEffectiveWeight(w / total);

    if (pose.kind === 'scrub') {
      a.paused = true;
      a.time = pose.time;
    } else {
      a.paused = false;
      const natural = GAIT[pose.clip];
      a.timeScale = pose.kind === 'move' && natural ? THREE.MathUtils.clamp(pose.groundSpeed / natural, 0.55, 1.7) : pose.kind === 'loop' ? pose.speed ?? 1 : 1;
    }
    for (const clip of this.fading.keys()) this.actions.get(clip)!.paused = false;
    this.mixer.update(dt);
  }
}
