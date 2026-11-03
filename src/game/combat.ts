import * as THREE from 'three';
import { itemDef, makeItem, type Item } from '../data/items';
import { ANIMALS, type AnimalObj } from '../world/world';
import type { Clip } from './character';
import type { Game } from './game';
import type { SwingKind } from './tools';

// Fighting, as it happens: swing your weapon (or fists) and it lands on what's
// in front of you, within reach; draw a bow and loose an arrow that flies,
// drops and strikes what it meets. Beasts fight back the same way: a boar
// lowers its head, winds up and lunges, and if you're still there when it
// comes, it gores you (step back or aside and it misses).

/** How a swing goes for what's in your hand: how long, when it lands, its reach and arc, and the body's clip. */
interface SwingStyle { dur: number; impactAt: number; reach: number; arc: number; clip: Clip; kind: SwingKind; stamina: number }

const FISTS: SwingStyle = { dur: 0.5, impactAt: 0.5, reach: 1.6, arc: 0.9, clip: 'attack_one', kind: 'reach', stamina: 2 };

function styleOf(it: Item | undefined): SwingStyle {
  if (!it) return FISTS;
  const tool = itemDef(it.type).tool;
  switch (tool) {
    case 'weapon':
      // A spear thrusts far but narrow; a sword cuts wider and quicker.
      return it.type.includes('spear')
        ? { dur: 0.75, impactAt: 0.5, reach: 3.0, arc: 0.55, clip: 'attack_two', kind: 'reach', stamina: 5 }
        : { dur: 0.6, impactAt: 0.5, reach: 2.6, arc: 1.0, clip: 'attack_one', kind: 'chop', stamina: 5 };
    case 'knife': return { dur: 0.45, impactAt: 0.5, reach: 1.9, arc: 0.9, clip: 'attack_one', kind: 'reach', stamina: 3 };
    case 'hatchet': case 'pickaxe': case 'hammer': case 'shovel': case 'hoe': case 'scythe': case 'saw': case 'tongs':
      return { dur: 0.85, impactAt: 0.55, reach: 2.3, arc: 0.9, clip: 'attack_two', kind: 'chop', stamina: 6 };
    default: return FISTS;
  }
}

/** An arrow in flight. */
interface Arrow { mesh: THREE.Object3D; pos: THREE.Vector3; vel: THREE.Vector3; dmg: number; ql: number; life: number }

/** Seconds after the last blow struck or taken that you're still "in a fight". */
const FIGHT_CALM = 6;
/** A full draw takes this long. */
const DRAW_TIME = 0.9;

export class Combat {
  /** When you last struck, were struck, or a beast came for you (game seconds). */
  lastFight = -1e9;
  private swing: { t: number; style: SwingStyle; hit: boolean; item?: Item; weak: boolean } | null = null;
  private cooldown = 0;
  /** The bow's draw, 0..1, while you hold the button. */
  draw = 0;
  private drawing = false;
  private arrows: Arrow[] = [];
  private arrowGeo: THREE.BufferGeometry | null = null;

  constructor(private g: Game) {}

  /** Still in a fight: a blow struck or taken lately, or a beast after you near by. */
  inCombat(): boolean {
    const g = this.g, p = g.player.pos;
    if (g.elapsed - this.lastFight < FIGHT_CALM) return true;
    return g.world.animals.some((a) => a.state === 'attack' && Math.hypot(a.x - p.x, a.z - p.z) < 20);
  }

  /** Busy with a swing or a drawn bow (other work waits). */
  get busy(): boolean { return !!this.swing || this.drawing; }

  /** The left button, pressed: swing what you hold, or start drawing the bow. */
  press(): boolean {
    const g = this.g, it = g.activeItem();
    if (it && itemDef(it.type).tool === 'bow') {
      if (g.inv.count('arrow') === 0) { g.msg('You have no arrows. Make some: a shaft, a flint and a feather make three (Primitive).', 'fail'); return true; }
      this.drawing = true;
      this.draw = 0;
      return true;
    }
    if (this.swing || this.cooldown > 0) return true;
    const style = styleOf(it && itemDef(it.type).tool ? it : undefined);
    const weak = g.player.stamina < style.stamina;
    g.player.stamina = Math.max(0, g.player.stamina - style.stamina);
    this.swing = { t: 0, style, hit: false, item: it && itemDef(it.type).tool ? it : undefined, weak };
    return true;
  }

  /** Whether a left click should fight rather than do the usual job: a weapon or bow in hand, or an animal under your aim. */
  wantsClick(): boolean {
    const g = this.g, it = g.activeItem(), tool = it ? itemDef(it.type).tool : undefined;
    return tool === 'weapon' || tool === 'bow' || g.target?.kind === 'animal';
  }

  update(dt: number) {
    const g = this.g, p = g.player;
    this.cooldown = Math.max(0, this.cooldown - dt);

    // A swing: the body goes through it, and the blow lands partway.
    const s = this.swing;
    if (s) {
      s.t += dt;
      const phase = Math.min(1, s.t / s.style.dur);
      p.swingAnim = { kind: s.style.kind, phase, impactAt: s.style.impactAt };
      p.work = { clip: s.style.clip, phase, impactAt: s.style.impactAt };
      if (!s.hit && phase >= s.style.impactAt) { s.hit = true; this.land(s.style, s.item, s.weak); }
      if (phase >= 1) { this.swing = null; this.cooldown = s.style.dur * 0.15; }
    }

    // The bow: draw while held, loose on release.
    const it = g.activeItem();
    if (this.drawing) {
      if (!it || itemDef(it.type).tool !== 'bow') { this.drawing = false; this.draw = 0; }
      else if (g.input.held.has(0)) {
        this.draw = Math.min(1, this.draw + dt / DRAW_TIME);
        p.work = { clip: 'attack_one', phase: 0.15 + 0.4 * this.draw, impactAt: 0.6 };
      } else {
        if (this.draw > 0.2) this.loose(it);
        else g.msg('You let the string go slack.', 'info');
        this.drawing = false;
        this.draw = 0;
      }
    }
    // Steady your aim as you draw: the view narrows a little.
    const fov = 72 - 10 * this.draw;
    if (Math.abs(g.camera.fov - fov) > 0.05) { g.camera.fov += (fov - g.camera.fov) * Math.min(1, dt * 12); g.camera.updateProjectionMatrix(); }

    this.fly(dt);
  }

  /** The blow lands: the nearest animal in front of you, within reach. */
  private land(style: SwingStyle, item: Item | undefined, weak: boolean) {
    const g = this.g, p = g.player.pos;
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
    let best: AnimalObj | null = null, bd = Infinity;
    for (const a of g.world.animals) {
      if (a.hp <= 0) continue;
      const dx = a.x - p.x, dz = a.z - p.z, d = Math.hypot(dx, dz);
      // Reach counts to the beast's flank, not its middle.
      if (d > style.reach + 0.45) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / Math.max(1e-3, d))));
      if (d > 0.6 && ang > style.arc) continue;
      if (Math.abs(g.world.terrain.heightAt(a.x, a.z) - p.y) > 2) continue;
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) { g.sound.glance(); return; }
    const base = item ? (itemDef(item.type).damage ?? 3) * (0.6 + item.ql / 200) : 2.5;
    let dmg = base * (0.85 + g.skills.get('fighting') / 80) * (0.85 + Math.random() * 0.3);
    if (weak) { dmg *= 0.5; g.msg('You are too worn out to put any force behind it.', 'fail'); }
    if (item) g.wear(item, 0.12);
    g.sound.chop(0.7);
    this.hit(best, dmg, 'strike');
  }

  /** Something hit a beast: hurt it, stagger it, and it runs or turns on you. */
  hit(a: AnimalObj, dmg: number, how: 'strike' | 'arrow') {
    const g = this.g, d = ANIMALS[a.species], p = g.player.pos;
    this.lastFight = g.elapsed;
    a.hp -= dmg;
    a.hurt = 0.3;
    g.skills.gain('fighting', a.species === 'boar' ? 8 : 4, true, 1.5);
    if (a.hp <= 0) { g.killAnimal(a); return; }
    // Knocked back a step and staggered for a moment (an arrow just makes it flinch).
    if (how === 'strike') {
      const l = Math.hypot(a.x - p.x, a.z - p.z) || 1;
      a.x += ((a.x - p.x) / l) * 0.35; a.z += ((a.z - p.z) / l) * 0.35;
      a.stun = 0.35;
      a.windup = 0;
    }
    g.msg(`You ${how === 'arrow' ? 'shoot' : 'hit'} the ${d.name.toLowerCase()} (${Math.round(dmg)}).`, 'info');
    g.provoke(a);
  }

  /** Loose an arrow along your aim. */
  private loose(bow: Item) {
    const g = this.g;
    g.inv.take('arrow', 1);
    g.inventoryChanged();
    const dir = new THREE.Vector3();
    g.camera.getWorldDirection(dir);
    const pos = g.camera.position.clone().addScaledVector(dir, 0.6);
    const speed = 16 + 30 * this.draw;
    const dmg = (7 + 17 * this.draw) * (0.85 + g.skills.get('fighting') / 80) * (0.8 + bow.ql / 250);
    this.arrows.push({ mesh: this.arrowMesh(), pos, vel: dir.multiplyScalar(speed), dmg, ql: bow.ql, life: 6 });
    g.wear(bow, 0.05);
    g.sound.glance();
  }

  private arrowMesh(): THREE.Object3D {
    if (!this.arrowGeo) {
      const shaft = new THREE.CylinderGeometry(0.006, 0.006, 0.7, 5).rotateX(Math.PI / 2);
      this.arrowGeo = shaft;
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.arrowGeo, new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.8 })));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2e2c30, roughness: 0.4 }));
    tip.position.z = -0.37;
    const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.03, 0.09), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 1 }));
    fletch.position.z = 0.3;
    const fletch2 = fletch.clone();
    fletch2.rotation.z = Math.PI / 2;
    g.add(tip, fletch, fletch2);
    this.g.scene.add(g);
    return g;
  }

  /** Arrows in flight: falling, and striking what they meet. */
  private fly(dt: number) {
    const g = this.g, t = g.world.terrain;
    for (const ar of [...this.arrows]) {
      ar.life -= dt;
      let done = ar.life <= 0;
      // A few small steps a frame, so a fast arrow doesn't pass through a deer.
      const steps = 4;
      for (let k = 0; k < steps && !done; k++) {
        const h = dt / steps;
        ar.vel.y -= 9.8 * h;
        ar.pos.addScaledVector(ar.vel, h);
        for (const a of g.world.animals) {
          if (a.hp <= 0) continue;
          const tall = a.species === 'deer' ? 1.0 : 0.6;
          const cy = t.heightAt(a.x, a.z) + tall * 0.7;
          if (Math.hypot(ar.pos.x - a.x, (ar.pos.y - cy) * 1.4, ar.pos.z - a.z) < 0.6) {
            this.hit(a, ar.dmg, 'arrow');
            done = true;
            break;
          }
        }
        if (done) break;
        if (ar.pos.y < t.waterAt(ar.pos.x, ar.pos.z) - 0.05) { done = true; break; }
        if (t.solidAt(ar.pos.x, ar.pos.y, ar.pos.z)) {
          // Stuck in the ground: most can be pulled out and used again.
          if (Math.random() < 0.65) g.dropToGround([makeItem('arrow', ar.ql)], ar.pos.x, ar.pos.y, ar.pos.z);
          done = true;
        }
      }
      ar.mesh.position.copy(ar.pos);
      ar.mesh.lookAt(ar.pos.clone().sub(ar.vel));
      if (done) {
        ar.mesh.removeFromParent();
        this.arrows.splice(this.arrows.indexOf(ar), 1);
      }
    }
  }
}
