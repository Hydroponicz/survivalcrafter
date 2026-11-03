// Bake the player character: the rigged model from Meshy comes as one GLB per
// animation, each with its own copy of the mesh. This keeps one copy of the
// mesh and skeleton and gathers every animation onto it, as named clips:
//
//   node scripts/bake-character.mjs
//
// reads assets-src/models/character/*.glb and writes public/models/character.glb.
// Clips play in place (the hips keep their height but not their drift across
// the ground: the game moves the body itself), scale keys and unchanging
// keys are dropped, and the file is compressed (meshopt).

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { readdirSync, statSync } from 'node:fs';

const SRC = 'assets-src/models/character';
const OUT = 'public/models/character.glb';
/** Source file → clip name (as the game asks for it). */
const CLIPS = {
  movementanim_idle: 'idle', movementanim_walk: 'walk', movementanim_run: 'run', movementanim_sprint2: 'sprint',
  movementanim_sprint: 'sprint_long', movementanim_walkbackwards: 'walk_back', movementanim_strafeleft: 'strafe_left',
  movementanim_straferight: 'strafe_right', movementanim_jump: 'jump', movementanim_interact_pickup: 'pickup',
  crouchanim_idle: 'crouch_idle', crouchanim_walk: 'crouch_walk',
  gatheranim_choptree: 'chop', gatheranim_minerock: 'mine', gatheranim_gatherplant: 'gather', gatheranim_harvestsickle: 'sickle',
  buildinganim_hammer: 'hammer', buildanim_place: 'place', craft_workbenchanim: 'craft',
  anim_drink: 'drink', anim_eat: 'eat', anim_interact: 'interact',
  attackanim_onehand: 'attack_one', attackanim_twohanded: 'attack_two', attackanim_block: 'block',
  attackanim_takedamage: 'hurt', attackanim_death: 'death',
};

/** Where one part of the body gives way to the next (metres, in the bind pose). */
const HAND_X = 0.665, NECK_Y = 1.455, BOOT_Y = 0.40, HEM_Y = 0.86, BELT = [0.975, 1.035];

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(`${SRC}/movementanim_idle.glb`);
const root = doc.getRoot();
for (const a of root.listAnimations()) a.dispose();
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.glb')).sort()) {
  const key = file.replace('.glb', '');
  const name = CLIPS[key];
  if (!name) { console.warn(`skipping ${file} (no clip name)`); continue; }
  const src = await io.read(`${SRC}/${file}`);
  for (const a of src.getRoot().listAnimations()) {
    const clip = doc.createAnimation(name);
    for (const ch of a.listChannels()) {
      const bone = ch.getTargetNode().getName(), path = ch.getTargetPath();
      const node = nodes.get(bone);
      if (!node || path === 'scale') continue;
      const s = ch.getSampler(), inp = s.getInput(), out = s.getOutput();
      const values = out.getArray().slice();
      if (path === 'translation') {
        if (bone !== 'mixamorig:Hips') {
          // Bones keep their length: skip unless it really changes.
          const rest = node.getTranslation();
          let moves = false;
          for (let i = 0; i < values.length; i += 3) if (Math.hypot(values[i] - rest[0], values[i + 1] - rest[1], values[i + 2] - rest[2]) > 1e-3) moves = true;
          if (!moves) continue;
        } else {
          // In place: the hips bob up and down but don't wander across the ground.
          for (let i = 0; i < values.length; i += 3) { values[i] = 0; values[i + 2] = 0; }
        }
      }
      const input = doc.createAccessor().setType('SCALAR').setArray(inp.getArray().slice()).setBuffer(buffer);
      const output = doc.createAccessor().setType(out.getType()).setArray(values).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
      clip.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    }
    console.log(name.padEnd(14), `${a.listChannels()[0].getSampler().getInput().getMax([])[0].toFixed(2)} s`, `${clip.listChannels().length} channels`);
  }
}

// The model has no texture: paint each part of the body by what it is (skin,
// hair, tunic, trousers, boots, belt). The game colours each part (and
// recolours it for what you wear); the part is stored in the vertex colour's
// red channel as region / 8 (see REGIONS in src/game/character.ts).
const REGION = { skin: 0, hair: 1, tunic: 2, trousers: 3, boots: 4, belt: 5 };
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  const skin = root.listNodes().find((n) => n.getMesh() === mesh).getSkin();
  const joints = skin.listJoints().map((j) => j.getName().replace('mixamorig:', '').replace(/Left|Right/, '').replace(/[0-9]$/, ''));
  const out = new Float32Array(P.getCount() * 3), v = [], j = [], w = [];
  for (let i = 0; i < P.getCount(); i++) {
    P.getElement(i, v); J.getElement(i, j); W.getElement(i, w);
    let b = 0; for (let k = 1; k < 4; k++) if (w[k] > w[b]) b = k;
    const bone = joints[j[b]], [x, y, z] = v, ax = Math.abs(x);
    let r;
    // (Bind pose: a T-pose, facing +Z, feet at 0, 1.70 m tall.)
    if (ax > HAND_X || bone.startsWith('Hand')) r = 'skin';
    else if (y > NECK_Y || bone === 'Neck') r = y > 1.655 || (z < -0.035 && y > 1.53) || (z < 0.0 && y > 1.6) ? 'hair' : 'skin';
    else if (y < BOOT_Y && !bone.startsWith('Hips')) r = 'boots';
    else if (bone === 'UpLeg' || bone === 'Leg' || (bone === 'Hips' && y < HEM_Y)) r = 'trousers';
    else if (y > BELT[0] && y < BELT[1] && ax < 0.24) r = 'belt';
    else r = 'tunic';
    out[i * 3] = REGION[r] / 8;
  }
  prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(out).setBuffer(buffer));
  // Each triangle came with its own corners (and its own flat normal): join
  // them up and shade smoothly (parts of the body keep a crisp edge).
  prim.setAttribute('NORMAL', null);
  joinCorners(prim);
}

/** Merge corners at the same spot (to 0.01 mm) and part of the body into one vertex. */
function joinCorners(prim) {
  const sem = prim.listSemantics(), attrs = sem.map((k) => prim.getAttribute(k));
  const P = prim.getAttribute('POSITION'), C = prim.getAttribute('COLOR_0'), n = P.getCount();
  const remap = new Uint32Array(n), keep = [], seen = new Map(), v = [], c = [];
  for (let i = 0; i < n; i++) {
    P.getElement(i, v); C.getElement(i, c);
    const key = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)},${c[0]}`;
    let to = seen.get(key);
    if (to === undefined) { to = keep.length; keep.push(i); seen.set(key, to); }
    remap[i] = to;
  }
  attrs.forEach((a, k) => {
    const size = a.getElementSize(), src = a.getArray(), dst = new src.constructor(keep.length * size);
    keep.forEach((from, to) => { for (let e = 0; e < size; e++) dst[to * size + e] = src[from * size + e]; });
    prim.setAttribute(sem[k], doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized()));
  });
  const old = prim.getIndices(), idx = new Uint32Array(old ? old.getCount() : n);
  for (let i = 0; i < idx.length; i++) idx[i] = remap[old ? old.getScalar(i) : i];
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
  // Smooth normals: each vertex leans by the faces around it (bigger faces count more).
  const pos = prim.getAttribute('POSITION').getArray(), nrm = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c2 = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c2] - pos[a], vy = pos[c2 + 1] - pos[a + 1], vz = pos[c2 + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c2]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
  }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer));
  console.log(`joined ${n} corners into ${keep.length} vertices`);
}

await doc.transform(resample({ tolerance: 1e-4 }), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(OUT, doc);
console.log(`${OUT}: ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
