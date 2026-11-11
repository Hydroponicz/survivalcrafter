import * as THREE from 'three';
import { CharacterRig, characterLoaded } from '../game/character';
import type { Player } from '../game/player';

// The character window's portrait: a copy of your character, standing at
// ease and slowly turning, drawn into its own little canvas.

export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 0.75, 0.1, 20);
  private figure: THREE.Object3D | null = null;
  /** The animated body (standing at ease), when the model has loaded. */
  private rig: CharacterRig | null = null;
  private key = '';
  private angle = 0.5;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'char-canvas';
    this.canvas.width = 480;
    this.canvas.height = 640;
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3020, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 3, 3);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xc8d8ff, 1.2);
    rim.position.set(-2, 2, -3);
    this.scene.add(rim);
    // A worn patch of ground to stand on.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2c2a20, roughness: 1, transparent: true, opacity: 0.85 }));
    this.scene.add(disc);
    this.camera.position.set(0, 1.15, 4.4);
    this.camera.lookAt(0, 0.92, 0);
  }

  /**
   * Show a copy of the model, posed at rest. `key` says when it needs copying
   * again (what's worn and held changed).
   */
  show(player: Player, key: string) {
    if (key === this.key && this.figure) return;
    this.key = key;
    if (this.figure) this.scene.remove(this.figure);
    const g = characterLoaded();
    if (player.rig && g) {
      // Your body, in what you're wearing and with what you're holding, at ease.
      this.rig ??= new CharacterRig(g);
      this.rig.setColours(player.wornColours);
      this.rig.hand.clear();
      const held = player.heldItem.clone(true);
      held.visible = true;
      this.rig.hand.add(held);
      this.figure = this.rig.root;
      this.scene.add(this.figure);
      return;
    }
    const f = player.blocks.clone(true);
    f.visible = true;
    f.position.set(0, 0, 0);
    f.rotation.set(0, 0, 0);
    for (const name of ['legL', 'legR', 'upper', 'head']) f.getObjectByName(name)?.rotation.set(0, 0, 0);
    // Arms hang loose, the tool hand a little forward.
    f.getObjectByName('armL')?.rotation.set(0, 0, 0.08);
    f.getObjectByName('armR')?.rotation.set(-0.3, 0, -0.08);
    f.traverse((o) => { o.visible = true; });
    this.figure = f;
    this.scene.add(f);
  }

  render(dt: number) {
    if (!this.figure || !this.canvas.isConnected) return;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setPixelRatio(1);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      } catch { return; }
    }
    this.angle += dt * 0.5;
    this.rig?.update(dt, { kind: 'loop', clip: 'idle' });
    this.figure.rotation.y = this.angle;
    this.renderer.render(this.scene, this.camera);
  }
}

/**
 * The HUD's portrait: your character's head and shoulders, at ease, in what
 * you're wearing, drawn small and only now and then (it hardly changes).
 */
export class PortraitView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(24, 0.8, 0.05, 10);
  private rig: CharacterRig | null = null;
  private key = '';
  private wait = 0;
  private failed = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'portrait-canvas';
    this.canvas.width = 160;
    this.canvas.height = 200;
    this.scene.add(new THREE.HemisphereLight(0xfff0d8, 0x3a2a18, 1.7));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.4);
    key.position.set(1.5, 2.5, 2.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc890, 1.4);
    rim.position.set(-2, 1.5, -2);
    this.scene.add(rim);
  }

  /** Draw it again if what you wear changed, else now and then (the idle sway). */
  update(player: Player, key: string, dt: number) {
    if (this.failed || !this.canvas.isConnected) return;
    const g = characterLoaded();
    if (!g || !player.rig) return;
    if (!this.rig) {
      this.rig = new CharacterRig(g);
      this.scene.add(this.rig.root);
      this.rig.root.rotation.y = 0.35;
      // Head and shoulders: frame the head from the model's own bones.
      const head = this.rig.head;
      this.rig.update(0.01, { kind: 'loop', clip: 'idle' });
      this.rig.root.updateMatrixWorld(true);
      const at = new THREE.Vector3();
      (head ?? this.rig.root).getWorldPosition(at);
      if (!head) at.y = 1.55;
      this.camera.position.set(at.x + 0.12, at.y + 0.03, at.z + 1.05);
      this.camera.lookAt(at.x, at.y - 0.05, at.z);
    }
    const changed = key !== this.key;
    if (changed) { this.key = key; this.rig.setColours(player.wornColours); }
    this.wait -= dt;
    if (!changed && this.wait > 0) return;
    this.wait = 0.25;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setPixelRatio(1);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      } catch { this.failed = true; return; }
    }
    this.rig.update(0.25, { kind: 'loop', clip: 'idle' });
    this.renderer.render(this.scene, this.camera);
  }
}
