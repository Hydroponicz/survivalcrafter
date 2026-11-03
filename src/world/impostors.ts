import * as THREE from 'three';
import { leafMaterial, SPECIES, treeGeometries, TREES, type Species } from './trees';

// Distant trees as impostors: each kind of tree, at full detail, is drawn once
// from eight sides into a picture atlas; far off, a tree is a single card
// turned to face you showing the side you'd see. It looks like the real tree
// (the same model, leaves and colours), it's lit by the same sun and haze,
// and it costs two triangles.

const VIEWS = 8;
const CELL = 256;

export class ImpostorAtlas {
  /** All the pictures: a row per kind of tree, a column per side. */
  readonly target = new THREE.WebGLRenderTarget(CELL * VIEWS, CELL * SPECIES.length, {
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace,
  });
  /** Each kind's card: sized to its tree, with its row in the atlas. */
  readonly cards = {} as Record<Species, THREE.BufferGeometry>;
  readonly material: THREE.MeshStandardMaterial;
  baked = false;

  constructor(near: { value: THREE.Vector3 }) {
    for (const [row, k] of SPECIES.entries()) {
      const g = treeGeometries(k, 1);
      const box = new THREE.Box3().setFromBufferAttribute(g.trunk.attributes.position as THREE.BufferAttribute);
      box.union(new THREE.Box3().setFromBufferAttribute(g.leaves.attributes.position as THREE.BufferAttribute));
      const half = Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z) * 1.04;
      const lo = Math.min(0, box.min.y), hi = box.max.y * 1.02;
      // A card from the ground up, as wide as the tree turned any way.
      const card = new THREE.PlaneGeometry(half * 2, hi - lo).translate(0, (hi + lo) / 2, 0);
      card.setAttribute('aRow', new THREE.Float32BufferAttribute(new Array(4).fill(row), 1));
      card.userData = { half, lo, hi };
      this.cards[k] = card;
      g.trunk.dispose(); g.leaves.dispose();
    }
    this.target.texture.wrapS = this.target.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.material = new THREE.MeshStandardMaterial({ map: this.target.texture, alphaTest: 0.42, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uNear = near;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform vec3 uNear;
attribute float aRow;
varying vec2 vCell;`)
        // Facing the camera, turning about the upright: pick the picture for the side we see.
        .replace('#include <beginnormal_vertex>', `
  vec3 iRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCam = cameraPosition - iRoot;
  vec2 flat2 = normalize(toCam.xz + vec2(1e-5, 0.0));
  vec3 iRight = vec3(flat2.y, 0.0, -flat2.x);
  float iScaleX = length(instanceMatrix[0].xyz), iScaleY = length(instanceMatrix[1].xyz);
  float iYaw = atan(instanceMatrix[0].z, instanceMatrix[0].x);
  float side = atan(flat2.x, flat2.y) + iYaw;
  float frame = mod(floor(side / ${(Math.PI * 2 / VIEWS).toFixed(6)} + 0.5), ${VIEWS}.0);
  vCell = vec2(frame, aRow);
  vec3 objectNormal = normalize(vec3(flat2.x, 1.1, flat2.y));`)
        .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalize( mat3( viewMatrix ) * objectNormal );')
        .replace('#include <project_vertex>', `
  vec3 iWorld = iRoot + iRight * position.x * iScaleX + vec3(0.0, position.y * iScaleY, 0.0);
  vec4 mvPosition = viewMatrix * vec4(iWorld, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Within the circle the real trees fill, none.
  if (distance(iRoot.xz, uNear.xy) < uNear.z) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCell;')
        .replace('#include <map_fragment>', `
  vec2 cellUv = (vCell + vMapUv) / vec2(${VIEWS}.0, ${SPECIES.length}.0);
  vec4 sampledDiffuseColor = texture2D( map, cellUv );
  diffuseColor *= sampledDiffuseColor;`);
    };
  }

  /** Take the pictures (once, with the game's renderer). */
  bake(renderer: THREE.WebGLRenderer) {
    if (this.baked) return;
    const scene = new THREE.Scene();
    // Soft, even light: the game's sun and sky do the rest.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(0.4, 1, 0.6);
    scene.add(key);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
    const prev = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), colour: renderer.getClearColor(new THREE.Color()), scissor: renderer.getScissorTest() };
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x4a5a3a, 0);
    renderer.clear();
    renderer.setScissorTest(true);
    for (const [row, k] of SPECIES.entries()) {
      const g = treeGeometries(k, 1);
      const trunk = new THREE.Mesh(g.trunk, new THREE.MeshStandardMaterial({ color: TREES[k].bark, roughness: 0.9 }));
      const lm = leafMaterial(g.leaves);
      lm.color.set(TREES[k].leaf);
      const leaves = new THREE.Mesh(g.leaves, lm);
      const tree = new THREE.Group();
      tree.add(trunk, leaves);
      scene.add(tree);
      const { half, lo, hi } = this.cards[k].userData as { half: number; lo: number; hi: number };
      cam.left = -half; cam.right = half; cam.bottom = lo; cam.top = hi;
      cam.updateProjectionMatrix();
      for (let v = 0; v < VIEWS; v++) {
        // Seen from this side (matching the card's choice of picture).
        const a = (v / VIEWS) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        cam.position.copy(dir).multiplyScalar(60);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, 0, 0);
        renderer.setViewport(v * CELL, row * CELL, CELL, CELL);
        renderer.setScissor(v * CELL, row * CELL, CELL, CELL);
        renderer.render(scene, cam);
      }
      scene.remove(tree);
      g.trunk.dispose(); g.leaves.dispose(); trunk.material.dispose(); lm.dispose();
    }
    renderer.setScissorTest(prev.scissor);
    renderer.setRenderTarget(prev.target);
    renderer.setClearColor(prev.colour, prev.alpha);
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
    this.baked = true;
  }
}
