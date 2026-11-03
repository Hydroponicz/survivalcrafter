import * as THREE from 'three';
import { Sky as SkyMesh } from 'three/examples/jsm/objects/Sky.js';
import { WATER_LEVEL } from '../world/terrain';
import { makeWaterMaterial } from '../world/water';

// The sky, sun and atmosphere. A physically based sky (Rayleigh and Mie
// scattering, with drifting clouds) lights the world: every few seconds it's
// captured as an environment map, so everything picks up skylight and the
// water reflects it. Distant land fades into the actual horizon colour, and
// mist pools in the valleys around dawn.

/**
 * Atmospheric haze. Reuses the linear fog's two uniforms: `near` is the haze
 * density and `far` the strength of low-lying mist (see the patched fog
 * shader chunks below).
 */
export class Haze extends THREE.Fog {
  private mistK = 0;
  private seen = 1;
  constructor(color: THREE.ColorRepresentation) {
    super(color, 0.003, 0);
  }
  get density() { return this.near; }
  set density(v: number) { this.near = v; }
  get mist() { return this.mistK; }
  set mist(v: number) { this.mistK = Math.min(1.99, Math.max(0, v)); this.pack(); }
  /** How much of the sun you can see past the land (0..1): the haze only glows toward it if it's there to light it. */
  get sunSeen() { return this.seen; }
  set sunSeen(v: number) { this.seen = Math.min(1, Math.max(0, v)); this.pack(); }
  // Every material shares only the fog's colour and two numbers, so the far
  // one carries both: the sun's visibility in hundredths times two, plus the mist.
  private pack() { this.far = Math.round(this.seen * 100) * 2 + this.mistK; }
}

/** Mist lies below this height (metres) and thins out above it. */
const MIST_TOP = 9;

/** How far off the stars are drawn (metres): inside the camera's far plane (7 km), past the furthest land. */
const STAR_R = 6500;

let fogPatched = false;
/** Replace three's fog with aerial haze plus height-based valley mist. */
function patchFog() {
  if (fogPatched) return;
  fogPatched = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // World position without a per-vertex matrix inverse: the view rotation is orthonormal.
  vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    // fogNear: haze density (thickens with distance); fogFar: valley mist strength and how much of the sun is seen (see Haze).
    float haze = 1.0 - exp( - fogNear * fogNear * vFogDepth * vFogDepth );
    float low = smoothstep( ${MIST_TOP.toFixed(1)}, 1.0, vFogWorld.y );
    float seenQ = floor( fogFar * 0.5 );
    float sunSeen = seenQ * 0.01;
    float mist = ( fogFar - seenQ * 2.0 ) * low * ( 1.0 - exp( - vFogDepth * 0.05 ) );
    // Haze glows toward the sun (light scattered forward by the air), only in
    // that direction: the rest of the view keeps the plain sky colour.
    vec3 hazeColor = fogColor;
    // Only lit materials have the sun's light to hand (unlit ones, like the
    // building ghost or markers, keep the plain haze).
    #if NUM_DIR_LIGHTS > 0 && ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) || defined( TOON ) )
      vec3 viewDir = normalize( mat3( viewMatrix ) * ( vFogWorld - cameraPosition ) );
      float toSun = max( dot( viewDir, directionalLights[ 0 ].direction ), 0.0 );
      vec3 sunTint = directionalLights[ 0 ].color / max( max( directionalLights[ 0 ].color.r, directionalLights[ 0 ].color.g ), 1e-4 );
      // Not where the land stands between you and the sun (a ridge in front of
      // a low sun): the air in front of it is in its shadow. Land seen higher in
      // the view than the sun is in the way of it.
      vec3 viewUp = mat3( viewMatrix ) * vec3( 0.0, 1.0, 0.0 );
      float above = dot( viewDir, viewUp ) - dot( directionalLights[ 0 ].direction, viewUp );
      float lit = 1.0 - 0.92 * smoothstep( -0.005, 0.03, above );
      hazeColor += fogColor * sunTint * ( 0.6 * pow( toSun, 6.0 ) + 1.2 * pow( toSun, 40.0 ) ) * lit * sunSeen;
    #endif
    // Mist catches the light: a little paler than the haze behind it.
    vec3 mistColor = hazeColor * 1.25 + vec3( 0.02, 0.021, 0.024 );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeColor, clamp( haze, 0.0, 1.0 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, mistColor, clamp( mist, 0.0, 1.0 ) * ( 1.0 - haze ) );
    float fogFactor = 0.0;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

/** Brightness of the sky shader relative to the world's lighting (at noon). */
const SKY_EXPOSURE = 0.1;

/** The sky shader's own sunlight strength for a sun height (from three's Sky.js). */
function skySun(elev: number) {
  const zenith = Math.acos(THREE.MathUtils.clamp(elev, -1, 1));
  return Math.max(0, 1 - Math.exp(-(1.6110731556870734 - zenith) / 1.5));
}
const NOON_SKY = skySun(1);
/** Re-capture the sky for ambient light and reflections after the sun moves this far (radians, ~1.5°). */
const ENV_STEP = 0.026;
/** Seconds between samples of the horizon colour for the haze. */
const PROBE_INTERVAL = 0.5;

const NOON_SUN = new THREE.Color(1.0, 0.96, 0.9);
const LOW_SUN = new THREE.Color(1.0, 0.55, 0.3);

export class Sky {
  sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  moon = new THREE.DirectionalLight(0x8899cc, 0.0);
  hemi = new THREE.HemisphereLight(0xc8dcff, 0x5a4a32, 0.4);
  private dome = new SkyMesh();
  private stars: THREE.Points;
  readonly water: THREE.Mesh;
  readonly haze: Haze;
  /** Height of the land at a point (as far as it's known), to tell whether it hides the sun. */
  groundAt?: (x: number, z: number) => number;
  private seenTimer = 0;
  private seenTarget = 1;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envAngle = NaN;
  private probeTimer = 0;
  private probing = false;
  private skyScene = new THREE.Scene();
  private skyForEnv = new SkyMesh();
  private probe: THREE.WebGLRenderTarget;
  private probeCam = new THREE.PerspectiveCamera(90, 4, 0.1, 2000);
  private probePixels = new Uint16Array(16 * 4 * 4);
  private horizon = new THREE.Color(0x9fbad6);
  /** Towards the sun. */
  readonly sunDir = new THREE.Vector3();
  /** Eyes adapt: the sky is scaled up as the sun sinks (partly, so sunsets stay dim and warm). */
  private skyGain = { value: SKY_EXPOSURE };
  private nightHaze = new THREE.Color(0.006, 0.009, 0.018);

  constructor(private scene: THREE.Scene) {
    patchFog();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);
    this.haze = new Haze(this.horizon);
    scene.fog = this.haze;
    scene.background = null;

    // The dome follows the camera; drawn first, behind everything.
    for (const d of [this.dome, this.skyForEnv]) {
      const u = d.material.uniforms;
      u.turbidity.value = 3.2;
      u.rayleigh.value = 1.4;
      u.mieCoefficient.value = 0.004;
      u.mieDirectionalG.value = 0.82;
      u.cloudCoverage.value = 0.38;
      u.cloudDensity.value = 0.5;
      u.cloudElevation.value = 0.55;
      d.material.onBeforeCompile = (shader) => {
        shader.uniforms.skyGain = this.skyGain;
        shader.fragmentShader = 'uniform float skyGain;\n' + shader.fragmentShader.replace(
          'gl_FragColor = vec4( texColor, 1.0 );',
          'gl_FragColor = vec4( texColor * skyGain, 1.0 );',
        );
      };
    }
    this.dome.scale.setScalar(1000);
    this.dome.renderOrder = -10;
    this.dome.material.depthWrite = false;
    scene.add(this.dome);
    this.skyForEnv.scale.setScalar(1000);
    this.skyForEnv.material.uniforms.showSunDisc.value = 0;
    this.skyScene.add(this.skyForEnv);
    this.probe = new THREE.WebGLRenderTarget(16, 4, { type: THREE.HalfFloatType });

    const starGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random());
      // Just inside the far edge of the view, beyond the furthest land, so
      // mountains hide them.
      pts.push(Math.sin(v) * Math.cos(u) * STAR_R, Math.cos(v) * STAR_R, Math.sin(v) * Math.sin(u) * STAR_R);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true }));
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    const wm = makeWaterMaterial({ depth: 'seafloor' });
    // The sea reaches past the view distance and follows you (its ripples are
    // fixed to the world, so they stay put as it moves).
    const seaSize = 16000;
    const seaGeo = new THREE.PlaneGeometry(seaSize, seaSize);
    this.water = new THREE.Mesh(seaGeo, wm);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, WATER_LEVEL - 0.05, 0);
    this.water.receiveShadow = true;
    scene.add(this.water);
  }

  /**
   * How much of the sun clears the land, looking from `from` toward it
   * (0 hidden, 1 clear): walks out over the land and finds the steepest
   * rise in the way, compared with the sun's height in the sky, softened
   * over about the sun's own size so it sinks behind a ridge gradually.
   */
  private sunClear(from: THREE.Vector3, dir: THREE.Vector3): number {
    const ground = this.groundAt;
    if (!ground) return 1;
    const h = Math.hypot(dir.x, dir.z) || 1e-6, dx = dir.x / h, dz = dir.z / h;
    const sunSlope = dir.y / h;
    let worst = Infinity;
    for (let t = 20; t <= 6000; t *= 1.12) {
      const g = ground(from.x + dx * t, from.z + dz * t);
      if (!Number.isFinite(g)) continue;
      worst = Math.min(worst, sunSlope - (g - from.y) / t);
    }
    return worst === Infinity ? 1 : THREE.MathUtils.smoothstep(worst, -0.01, 0.02);
  }

  update(dayFraction: number, playerPos: THREE.Vector3, time: number, renderer?: THREE.WebGLRenderer, camera?: THREE.Camera, dt = 0) {
    const ang = (dayFraction - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const dir = this.sunDir.set(Math.cos(ang), elev, 0.35).normalize();
    const day = THREE.MathUtils.clamp(elev * 3 + 0.3, 0, 1);

    for (const d of [this.dome, this.skyForEnv]) {
      d.material.uniforms.sunPosition.value.copy(dir);
      d.material.uniforms.time.value = time;
    }
    if (camera) {
      this.dome.position.copy(camera.position);
      this.water.position.x = Math.round(camera.position.x / 960) * 960;
      this.water.position.z = Math.round(camera.position.z / 960) * 960;
    }
    this.skyGain.value = SKY_EXPOSURE * Math.pow(NOON_SKY / Math.max(skySun(elev), 0.03), 0.75);

    // Sunlight warms and weakens as it nears the horizon.
    this.sun.position.copy(playerPos).addScaledVector(dir, 120);
    this.sun.target.position.copy(playerPos);
    this.sun.intensity = 3.0 * day * THREE.MathUtils.clamp(elev * 4 + 0.15, 0, 1);
    this.sun.color.copy(LOW_SUN).lerp(NOON_SUN, THREE.MathUtils.clamp(elev * 2.5, 0, 1));
    this.sun.visible = elev > -0.05;
    this.moon.position.copy(playerPos).addScaledVector(dir, -120);
    this.moon.target.position.copy(playerPos);
    this.moon.intensity = 0.35 * (1 - day);
    this.hemi.intensity = 0.12 + 0.3 * day;

    // Whether the land (a ridge, a mountain) hides the sun from you: then the
    // air in front of you is in its shadow and doesn't glow toward it.
    this.seenTimer -= dt;
    if (this.seenTimer <= 0) {
      this.seenTimer = 0.25;
      this.seenTarget = elev < -0.03 ? 0 : this.sunClear(camera?.position ?? playerPos, dir);
    }
    const seen = this.haze.sunSeen;
    this.haze.sunSeen = dt > 0 ? seen + (this.seenTarget - seen) * Math.min(1, dt * 3) : this.seenTarget;

    this.stars.position.copy(camera?.position ?? playerPos);
    // Stars come out once the sun is down.
    const starAlpha = THREE.MathUtils.clamp(-elev * 8 + 0.15, 0, 1);
    (this.stars.material as THREE.PointsMaterial).opacity = starAlpha;
    this.stars.visible = starAlpha > 0.01;

    // Hazier at dawn and dusk; mist pools in the valleys around sunrise and lifts by midmorning.
    // Thin enough to see mountains kilometres away, thicker at dawn and dusk.
    this.haze.density = THREE.MathUtils.lerp(0.0013, 0.0008, THREE.MathUtils.clamp(elev * 2, 0, 1));
    const dawn = Math.exp(-(((dayFraction - 0.27) / 0.06) ** 2));
    const nightMist = dayFraction < 0.2 || dayFraction > 0.85 ? 0.25 : 0;
    this.haze.mist = Math.max(0.75 * dawn, nightMist, 0.08);

    if (renderer) {
      // Skylight only needs refreshing as the sun moves.
      if (!(Math.abs(ang - this.envAngle) < ENV_STEP)) { this.envAngle = ang; this.captureEnv(renderer); }
      this.probeTimer -= dt;
      if (this.probeTimer <= 0 && !this.probing) { this.probeTimer = PROBE_INTERVAL; this.probeHorizon(renderer, camera); }
    }
    this.haze.color.copy(this.horizon);
  }

  /** Capture the sky as a (small: it's smooth) environment map for skylight and reflections. */
  private captureEnv(renderer: THREE.WebGLRenderer) {
    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    const rt = this.pmrem.fromScene(this.skyScene, 0, 0.1, 2000, { size: 64 });
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
  }

  /**
   * Sample the sky just above the horizon, side-on to the sun, for the haze
   * colour. (Looking into the sun the sky is far brighter; that glow is added
   * in the fog shader in the sun's direction only, so turning your head
   * doesn't wash the whole view out.)
   */
  private probeHorizon(renderer: THREE.WebGLRenderer, _camera?: THREE.Camera) {
    const fwd = new THREE.Vector3(-this.sunDir.z, 0, this.sunDir.x);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    this.probeCam.position.set(0, 0, 0);
    this.probeCam.lookAt(fwd.x, 0.06, fwd.z);
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.probe);
    renderer.render(this.skyScene, this.probeCam);
    renderer.setRenderTarget(prevTarget);
    // Read back without stalling the GPU; the colour arrives a frame or two later.
    this.probing = true;
    renderer.readRenderTargetPixelsAsync(this.probe, 0, 0, 16, 4, this.probePixels)
      .then(() => this.applyProbe())
      .catch(() => { /* context lost or unsupported: keep the last colour */ })
      .finally(() => { this.probing = false; });
  }

  private applyProbe() {
    let r = 0, g = 0, b = 0;
    const n = 16 * 4;
    for (let i = 0; i < n; i++) {
      r += THREE.DataUtils.fromHalfFloat(this.probePixels[i * 4]);
      g += THREE.DataUtils.fromHalfFloat(this.probePixels[i * 4 + 1]);
      b += THREE.DataUtils.fromHalfFloat(this.probePixels[i * 4 + 2]);
    }
    if (Number.isFinite(r + g + b)) this.horizon.setRGB(Math.max(r / n, this.nightHaze.r), Math.max(g / n, this.nightHaze.g), Math.max(b / n, this.nightHaze.b));
  }
}

