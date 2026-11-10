import * as THREE from 'three';
import { cylinderUV, surfaceMat, worldUV, type Surface } from './surfaces';

// The fire making kit (a bow drill and its makings), in parts: a fireboard
// with burnt sockets and their notches, a spindle, a bow strung with cordage,
// a handhold, a nest of tinder and a leather pouch. Shared by the kit as you
// carry it (bundled up) and the bow drill laid out on the ground to make fire
// (game/minigames/firedrill). Simple shapes, in the game's own surfaces, for
// now: better models and textures are to come.

const FIBER = 0xc9b07a, FIBER_DARK = 0xa08a58, CORD = 0xd8c8a0, HIDE = 0x7a5232, CHAR = 0x1a120c, STONE = 0x7d7870;

/** A part in a photographed surface (shared material: never disposed with the part). */
function tex(geo: THREE.BufferGeometry, surface: Surface, tint?: number): THREE.Mesh {
  if (geo instanceof THREE.CylinderGeometry) cylinderUV(geo, surface); else worldUV(geo, surface);
  const m = new THREE.Mesh(geo, surfaceMat(surface, tint));
  m.castShadow = m.receiveShadow = true;
  m.userData.sharedMat = true;
  return m;
}
const plain = (geo: THREE.BufferGeometry, color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra }));
  m.castShadow = m.receiveShadow = true;
  return m;
};

/** The fireboard: a split board, three sockets burnt into its top near one edge, each with its notch down the side. Long along x, top at y = 0.03. */
export function fireboard(): THREE.Group {
  const g = new THREE.Group();
  const board = tex(new THREE.BoxGeometry(0.46, 0.03, 0.1), 'planks', 0xc8a070);
  board.position.y = 0.015;
  g.add(board);
  for (const [k, x] of [-0.08, 0.04, 0.15].entries()) {
    // The socket (darker for the older ones), and the notch cut from it to the edge, where the dust gathers.
    const sock = plain(new THREE.CylinderGeometry(0.016, 0.012, 0.006, 12), k === 0 ? 0x2a1a10 : CHAR);
    sock.position.set(x, 0.031, 0.025);
    g.add(sock);
    const notch = plain(new THREE.BoxGeometry(0.012, 0.03, 0.03), CHAR);
    notch.position.set(x, 0.015, 0.042);
    g.add(notch);
    if (k > 0) { const ring = plain(new THREE.RingGeometry(0.016, 0.022, 12).rotateX(-Math.PI / 2), 0x4a2e18); ring.position.set(x, 0.0315, 0.025); g.add(ring); }
  }
  return g;
}

/** The spindle: a straight dry stick, rounded at the top, blunt and blackened at the foot. Upright, foot at y = 0. */
export function spindle(len = 0.3): THREE.Group {
  const g = new THREE.Group();
  const shaft = tex(new THREE.CylinderGeometry(0.011, 0.012, len, 8), 'rough_wood', 0xd8c09a);
  shaft.position.y = len / 2;
  g.add(shaft);
  const top = tex(new THREE.SphereGeometry(0.011, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), 'rough_wood', 0xd8c09a);
  top.position.y = len;
  g.add(top);
  const foot = plain(new THREE.CylinderGeometry(0.012, 0.009, 0.02, 8), CHAR);
  foot.position.y = 0.01;
  g.add(foot);
  return g;
}

/** The bow: a bent green stick, its ends bound with cordage. Along x, the curve bowing toward -z; returns its ends too. */
export function bowStave(len = 0.56): { group: THREE.Group; tips: [THREE.Vector3, THREE.Vector3] } {
  const g = new THREE.Group();
  const a = new THREE.Vector3(-len / 2, 0, 0), b = new THREE.Vector3(len / 2, 0, 0);
  const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(0, 0.01, -0.09), b);
  const stave = tex(new THREE.TubeGeometry(curve, 20, 0.011, 7, false), 'rough_wood', 0x9a7a52);
  g.add(stave);
  // A side twig left on, and the bindings at each end.
  const twig = tex(new THREE.CylinderGeometry(0.004, 0.006, 0.05, 5), 'rough_wood', 0x9a7a52);
  twig.position.set(0.08, 0.012, -0.075); twig.rotation.set(0.4, 0, -0.9);
  g.add(twig);
  for (const p of [a, b]) {
    const wrap = plain(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 8).rotateZ(Math.PI / 2), CORD);
    wrap.position.copy(p).add(new THREE.Vector3(Math.sign(-p.x) * 0.015, 0, 0));
    g.add(wrap);
  }
  return { group: g, tips: [a.clone().add(new THREE.Vector3(0.02, 0, 0)), b.clone().add(new THREE.Vector3(-0.02, 0, 0))] };
}

/** The handhold: a palm-sized stone with a socket worn in its underside. */
export function handhold(): THREE.Group {
  const g = new THREE.Group();
  const stone = plain(new THREE.DodecahedronGeometry(0.035, 1).scale(1.25, 0.6, 1), STONE, { flatShading: true });
  stone.position.y = 0.02;
  g.add(stone);
  return g;
}

/** A nest of tinder: dry grass and shredded bark coiled into a bowl. */
export function tinderNest(r = 0.07): THREE.Group {
  const g = new THREE.Group();
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, rr = r * (0.7 + (k % 3) * 0.12);
    const strand = plain(new THREE.TorusGeometry(rr, 0.006, 4, 10, 2.2), k % 2 ? FIBER : FIBER_DARK);
    strand.rotation.set(Math.PI / 2 + Math.sin(a * 3) * 0.3, 0, a);
    strand.position.y = 0.015 + (k % 4) * 0.006;
    g.add(strand);
  }
  const bed = plain(new THREE.CircleGeometry(r * 0.75, 12).rotateX(-Math.PI / 2), FIBER_DARK, { side: THREE.DoubleSide });
  bed.position.y = 0.012;
  g.add(bed);
  return g;
}

/** A leather tinder pouch, drawn shut. */
export function pouch(): THREE.Group {
  const g = new THREE.Group();
  const bag = plain(new THREE.SphereGeometry(0.05, 12, 9).scale(1, 1.15, 0.85), HIDE);
  bag.position.y = 0.05;
  g.add(bag);
  const neck = plain(new THREE.CylinderGeometry(0.018, 0.026, 0.03, 10), HIDE);
  neck.position.y = 0.11;
  g.add(neck);
  const tie = plain(new THREE.TorusGeometry(0.02, 0.003, 4, 10).rotateX(Math.PI / 2), CORD);
  tie.position.y = 0.105;
  g.add(tie);
  const tuft = plain(new THREE.ConeGeometry(0.02, 0.03, 6), FIBER);
  tuft.position.y = 0.135;
  g.add(tuft);
  return g;
}

/**
 * The kit as you carry it: the fireboard with the spindle and the bow laid
 * along it, bound round twice with cordage, the handhold tucked in and the
 * tinder pouch tied on. Long along y (held upright), its middle at the origin.
 */
export function fireKitBundle(): THREE.Group {
  const g = new THREE.Group(), inner = new THREE.Group();
  const board = fireboard();
  inner.add(board);
  const sp = spindle(0.3);
  sp.rotation.z = -Math.PI / 2; sp.position.set(-0.15, 0.045, -0.02);
  inner.add(sp);
  const bow = bowStave(0.5);
  bow.group.position.set(0, 0.06, 0.02); bow.group.rotation.x = -Math.PI / 2;
  inner.add(bow.group);
  const string = plain(new THREE.CylinderGeometry(0.0025, 0.0025, 0.46, 4).rotateZ(Math.PI / 2), CORD);
  string.position.set(0, 0.06, 0.03);
  inner.add(string);
  for (const x of [-0.13, 0.13]) {
    const band = plain(new THREE.TorusGeometry(0.06, 0.005, 4, 16).rotateY(Math.PI / 2).scale(1, 0.8, 1), CORD);
    band.position.set(x, 0.035, 0.0);
    inner.add(band);
  }
  const hold = handhold();
  hold.position.set(0.18, 0.03, 0.0);
  inner.add(hold);
  const p = pouch();
  p.position.set(0.05, -0.06, 0.05); p.rotation.z = 0.3;
  inner.add(p);
  // Upright: its length along y.
  inner.rotation.z = Math.PI / 2;
  g.add(inner);
  return g;
}
