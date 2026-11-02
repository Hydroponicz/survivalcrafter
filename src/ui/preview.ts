import * as THREE from 'three';

// The character window's portrait: a copy of your character, standing at
// ease and slowly turning, drawn into its own little canvas.

export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 0.75, 0.1, 20);
  private figure: THREE.Object3D | null = null;
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
  show(model: THREE.Object3D, key: string) {
    if (key === this.key && this.figure) return;
    this.key = key;
    if (this.figure) this.scene.remove(this.figure);
    const f = model.clone(true);
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
    this.figure.rotation.y = this.angle;
    this.renderer.render(this.scene, this.camera);
  }
}
