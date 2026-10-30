import * as THREE from 'three';
import { WATER_LEVEL } from '../world/terrain';

const NIGHT = new THREE.Color(0x070b18);
const DAY = new THREE.Color(0x8ab8e0);
const DUSK = new THREE.Color(0xe08a55);

/** Sun, moon, stars, fog and water, driven by the time of day. */
export class Sky {
  sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  moon = new THREE.DirectionalLight(0x8899cc, 0.0);
  hemi = new THREE.HemisphereLight(0xc8dcff, 0x5a4a32, 1.0);
  private sunDisc: THREE.Mesh;
  private stars: THREE.Points;
  readonly water: THREE.Mesh;
  private waterTex: THREE.Texture;
  private bg = new THREE.Color();

  constructor(private scene: THREE.Scene, worldSize: number) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);
    scene.fog = new THREE.Fog(DAY.getHex(), 60, 320);
    scene.background = this.bg;

    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }));
    scene.add(this.sunDisc);

    const starGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random());
      pts.push(Math.sin(v) * Math.cos(u) * 600, Math.cos(v) * 600, Math.sin(v) * Math.sin(u) * 600);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true }));
    scene.add(this.stars);

    this.waterTex = makeWaterNormal();
    this.waterTex.wrapS = this.waterTex.wrapT = THREE.RepeatWrapping;
    this.waterTex.repeat.set(worldSize / 8, worldSize / 8);
    const wm = new THREE.MeshStandardMaterial({
      color: 0x2a5f7d, transparent: true, opacity: 0.78, roughness: 0.12, metalness: 0.15,
      normalMap: this.waterTex, normalScale: new THREE.Vector2(0.35, 0.35),
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(worldSize * 3, worldSize * 3), wm);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(worldSize / 2, WATER_LEVEL - 0.05, worldSize / 2);
    this.water.receiveShadow = true;
    scene.add(this.water);
  }

  update(dayFraction: number, playerPos: THREE.Vector3, time: number) {
    const ang = (dayFraction - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const dir = new THREE.Vector3(Math.cos(ang), elev, 0.35).normalize();
    const day = THREE.MathUtils.clamp(elev * 3 + 0.3, 0, 1);
    const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) * 4, 0, 1);

    this.sun.position.copy(playerPos).addScaledVector(dir, 120);
    this.sun.target.position.copy(playerPos);
    this.sun.intensity = 3.0 * day;
    this.sun.color.setHSL(0.1, 0.6, 0.6 + day * 0.3);
    this.sun.visible = elev > -0.05;
    this.moon.position.copy(playerPos).addScaledVector(dir, -120);
    this.moon.target.position.copy(playerPos);
    this.moon.intensity = 0.35 * (1 - day);
    this.hemi.intensity = 0.25 + 1.1 * day;

    this.bg.copy(NIGHT).lerp(DAY, day).lerp(DUSK, dusk * 0.45 * Math.max(day, 0.4));
    (this.scene.fog as THREE.Fog).color.copy(this.bg);
    this.sunDisc.position.copy(playerPos).addScaledVector(dir, 560);
    this.sunDisc.visible = elev > -0.1;
    this.stars.position.copy(playerPos);
    (this.stars.material as THREE.PointsMaterial).opacity = 1 - day;
    this.stars.visible = day < 0.95;

    this.waterTex.offset.set(time * 0.01, time * 0.006);
  }
}

function makeWaterNormal(): THREE.Texture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const h = (x: number, y: number) =>
    Math.sin((x / S) * Math.PI * 2 * 3) * 0.5 + Math.sin(((x + y) / S) * Math.PI * 2 * 5) * 0.3 +
    Math.sin((y / S) * Math.PI * 2 * 4 + Math.sin((x / S) * Math.PI * 4)) * 0.4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const i = (y * S + x) * 4;
      img.data[i] = 128 + dx * 90;
      img.data[i + 1] = 128 + dy * 90;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
