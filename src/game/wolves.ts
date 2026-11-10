// Wolves: packs that den in the forests at the foot of the mountains. By day
// they lie up at the den (leave them be and they leave you be; strike one and
// the pack turns on you). After sunset they go out hunting: the pack ranges
// far across the country through the night, often on your scent, toward
// wherever you are, and runs you down on sight. They're afraid of fire: hold
// a lit torch, or stand in the light of a campfire, a torch, a brazier or a
// lantern, and they keep off at the edge of the light, circling, and shy away
// if they come too close. Kept off by the light for long enough (SPOOK_GIVE_UP
// seconds), the pack gives you up for the night and goes home to its den.
//
// A pack is a den and a place where it is now (worked out whether you're near
// or not); close to you, its wolves are real animals in the world (they
// fight, bleed and can be butchered like any other), and its den a lair of
// rocks with a dark mouth.

import * as THREE from 'three';
import { STRUCTURES } from '../data/structures';
import { hash2 } from '../world/noise';
import { SEA, TILE } from '../world/worldgen';
import type { AnimalObj } from '../world/world';
import type { Game } from './game';
import { telemetry } from './telemetry';

/** Dens are planned one (at most) per square of this size. */
const DEN_CELL = 640;
/** Dens this near you get their pack (and the pack is kept). */
const FIND_R = 1800;
/** A pack's wolves are real animals within this distance of you; its den is drawn within DRAW_R. */
const SHOW_R = 150, DRAW_R = 420;
/** How far a pack ranges from its den at night, and how fast it travels (m/s) out of your sight. */
const RANGE = 1500, TROT = 2.8;
/** Night, as a share of the day (from sunset to dawn). */
const isNight = (f: number) => f > 0.765 || f < 0.225;
/** How long a lost wolf takes to be replaced (game days). */
const REGROW_DAYS = 1.5;
/** A carried torch keeps them this far off you (m). */
const HELD_LIGHT = 5.5;
/** Held off by the light this long (s), a pack gives up the hunt and goes home to its den till the next night. */
const SPOOK_GIVE_UP = 10;
/** A spell in the light is forgotten if the pack hasn't been near one for this long (s). */
const SPOOK_FORGET = 20;

export interface Den { key: string; x: number; z: number; yaw: number }
export interface Pack {
  id: number;
  den: Den;
  /** Where the pack is now, and where it's heading. */
  x: number; z: number;
  goal: { x: number; z: number } | null;
  /** Wolves in it now, and when the next pup grows up to replace one lost. */
  members: number;
  max: number;
  regrowAt: number;
  /** Seconds this night its wolves have been held off by the light, and when they last were (game.elapsed). */
  spooked?: number;
  spookedAt?: number;
  /** Given up the hunt (spooked by the light): home to the den for the rest of the night. */
  retreat?: boolean;
}

export class Wolves {
  packs: Pack[] = [];
  private nextId = 1;
  private dens = new Map<string, Den | null>();
  private findT = 0;
  /** The pack's wolves in the world (by pack id). */
  private live = new Map<number, AnimalObj[]>();
  readonly group = Object.assign(new THREE.Group(), { name: 'wolf dens' });
  private denMeshes = new Map<string, THREE.Group>();
  private howledNight = -1;
  /** A wolf shying from your light just now (so it's said once, not every frame). */
  private shiedAt = -99;

  constructor(private g: Game) {}

  private get night() { return isNight(this.g.world.dayFraction); }

  update(dt: number) {
    const g = this.g, p = g.player.pos;
    this.findT -= dt;
    if (this.findT <= 0) { this.findT = 8; this.findDens(); }
    const night = this.night && !g.dev.on('peaceful');
    for (const pk of this.packs) {
      this.regrow(pk);
      // Morning: a pack that gave up last night hunts again tonight.
      if (!night && (pk.retreat || pk.spooked)) { pk.retreat = false; pk.spooked = 0; }
      const wolves = this.live.get(pk.id);
      const d = Math.hypot(pk.x - p.x, pk.z - p.z);
      if (wolves) {
        // On the ground near you: the pack is where its wolves are.
        const alive = wolves.filter((a) => g.world.animals.includes(a));
        this.live.set(pk.id, alive);
        if (alive.length) { pk.x = alive.reduce((s, a) => s + a.x, 0) / alive.length; pk.z = alive.reduce((s, a) => s + a.z, 0) / alive.length; }
        if (!alive.length || Math.hypot(pk.x - p.x, pk.z - p.z) > SHOW_R + 60) this.dismiss(pk);
        continue;
      }
      // Out of sight: the pack goes about its night (or home for the day).
      this.travel(pk, dt, night);
      if (d < SHOW_R && pk.members > 0) this.summon(pk);
    }
    // At nightfall, the howling (if there's a pack within earshot).
    const day = g.world.day;
    if (night && this.howledNight !== day && g.world.dayFraction > 0.5) {
      const near = this.packs.find((pk) => pk.members > 0 && Math.hypot(pk.den.x - p.x, pk.den.z - p.z) < FIND_R);
      if (near) {
        this.howledNight = day;
        g.msg('Wolves howl somewhere off in the hills. Night has fallen: keep to the firelight.', 'warn');
        telemetry.event('wolves', 'Howling at nightfall');
      }
    }
    this.drawDens();
  }

  // ---------- the dens
  /** Plan the dens round you (from map tiles already made), and give each its pack. */
  private findDens() {
    const p = this.g.player.pos, r = Math.ceil(FIND_R / DEN_CELL);
    const cx = Math.floor(p.x / DEN_CELL), cz = Math.floor(p.z / DEN_CELL);
    for (let j = cz - r; j <= cz + r; j++) for (let i = cx - r; i <= cx + r; i++) {
      const den = this.denIn(i, j);
      if (!den || Math.hypot(den.x - p.x, den.z - p.z) > FIND_R || this.packs.some((pk) => pk.den.key === den.key)) continue;
      const max = 3 + Math.floor(hash2(i, j, 5151) * 2);
      this.packs.push({ id: this.nextId++, den, x: den.x, z: den.z, goal: null, members: max, max, regrowAt: 0 });
      telemetry.event('wolves', `A pack of ${max} dens at ${Math.round(den.x)}, ${Math.round(den.z)}`);
    }
  }

  /**
   * A square's den, if it has one: a spot in the forest (broadleaf or
   * conifer), level enough to lie up on, at the foot of rising mountain
   * ground, away from settlements and from where you began. Its mouth faces
   * away from the slope.
   */
  private denIn(cx: number, cz: number): Den | null {
    const key = `${cx},${cz}`;
    if (this.dens.has(key)) return this.dens.get(key)!;
    const g = this.g, gen = g.world.terrain.gen, seed = gen.seed;
    // (Only from map tiles already made: asking for others would make them on the spot.)
    for (let tz = Math.floor((cz * DEN_CELL - 200) / TILE); tz <= Math.floor(((cz + 1) * DEN_CELL + 200) / TILE); tz++) {
      for (let tx = Math.floor((cx * DEN_CELL - 200) / TILE); tx <= Math.floor(((cx + 1) * DEN_CELL + 200) / TILE); tx++) if (!gen.hasTile(tx, tz)) return null;
    }
    let den: Den | null = null;
    if (hash2(cx, cz, seed ^ 0xd3a1) < 0.7) {
      let best = 0;
      for (let k = 0; k < 18; k++) {
        const x = cx * DEN_CELL + 60 + hash2(cx * 5 + k, cz, 801) * (DEN_CELL - 120), z = cz * DEN_CELL + 60 + hash2(cx, cz * 7 + k, 802) * (DEN_CELL - 120);
        const h = gen.height(x, z);
        if (h < SEA + 6 || h > 160 || !Number.isNaN(gen.water(x, z, h))) continue;
        const zone = gen.zone(x, z, h);
        if (zone !== 'conifer' && zone !== 'broadleaf') continue;
        if (Math.hypot(x - g.world.spawn.x, z - g.world.spawn.z) < 420) continue;
        let level = true;
        for (let a = 0; a < 6 && level; a++) if (Math.abs(gen.height(x + Math.cos(a) * 6, z + Math.sin(a) * 6) - h) > 2.6) level = false;
        if (!level) continue;
        // The mountain behind it: how far the ground climbs within 150 m, and which way.
        let rise = 0, upX = 0, upZ = 0;
        for (const r of [50, 100, 150]) for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2, d = gen.height(x + Math.cos(ang) * r, z + Math.sin(ang) * r) - h;
          if (d > rise) { rise = d; upX = Math.cos(ang); upZ = Math.sin(ang); }
        }
        if (rise < 32 || rise < best) continue;
        if (g.world.terrain.villages.knownAround(x, z, 120).length) continue;
        best = rise;
        den = { key, x, z, yaw: Math.atan2(-upX, -upZ) };
      }
    }
    this.dens.set(key, den);
    return den;
  }

  /** Draw the dens near you: a heap of boulders against the slope, a dark mouth, bones about it. */
  private drawDens() {
    const p = this.g.player.pos, t = this.g.world.terrain;
    for (const pk of this.packs) {
      const den = pk.den, d = Math.hypot(den.x - p.x, den.z - p.z);
      let m = this.denMeshes.get(den.key);
      if (d < DRAW_R && !m) {
        m = denModel(den.key);
        m.position.set(den.x, t.heightAt(den.x, den.z), den.z);
        m.rotation.y = den.yaw;
        this.group.add(m);
        this.denMeshes.set(den.key, m);
      } else if (d > DRAW_R + 40 && m) {
        this.group.remove(m);
        m.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
        this.denMeshes.delete(den.key);
      }
    }
  }

  // ---------- the pack, out of sight
  private regrow(pk: Pack) {
    const day = this.g.world.time / (20 * 60);
    if (pk.members >= pk.max) { pk.regrowAt = 0; return; }
    if (!pk.regrowAt) pk.regrowAt = day + REGROW_DAYS;
    if (day >= pk.regrowAt && !this.night && !this.live.has(pk.id)) { pk.members++; pk.regrowAt = 0; }
  }

  /** By night the pack ranges far, often toward you; by day it goes home to its den. */
  private travel(pk: Pack, dt: number, night: boolean) {
    const p = this.g.player.pos, gen = this.g.world.terrain.gen;
    if (night && !pk.retreat) {
      if (!pk.goal || Math.hypot(pk.goal.x - pk.x, pk.goal.z - pk.z) < 20) {
        // On your trail (most nights, if you're within its range), or off across the country.
        if (Math.hypot(p.x - pk.den.x, p.z - pk.den.z) < RANGE + 400 && Math.random() < 0.6) {
          pk.goal = { x: p.x + (Math.random() - 0.5) * 60, z: p.z + (Math.random() - 0.5) * 60 };
        } else {
          for (let k = 0; k < 6; k++) {
            const a = Math.random() * Math.PI * 2, r = 300 + Math.random() * (RANGE - 300);
            const x = pk.den.x + Math.cos(a) * r, z = pk.den.z + Math.sin(a) * r;
            const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
            if (!gen.hasTile(tx, tz)) continue;
            const h = gen.height(x, z);
            if (h > SEA + 1 && Number.isNaN(gen.water(x, z, h))) { pk.goal = { x, z }; break; }
          }
        }
      }
    } else pk.goal = { x: pk.den.x, z: pk.den.z };
    if (!pk.goal) return;
    const dx = pk.goal.x - pk.x, dz = pk.goal.z - pk.z, l = Math.hypot(dx, dz);
    if (l < 1) return;
    const step = Math.min(l, TROT * (night && !pk.retreat ? 1 : 1.2) * dt);
    pk.x += (dx / l) * step; pk.z += (dz / l) * step;
  }

  /** The pack comes into sight: its wolves, real animals, gathered about where it is. */
  private summon(pk: Pack) {
    const w = this.g.world, t = w.terrain, out: AnimalObj[] = [];
    for (let k = 0; k < pk.members; k++) {
      const a = (k / pk.members) * Math.PI * 2, x = pk.x + Math.cos(a) * 3, z = pk.z + Math.sin(a) * 3;
      if (t.heightAt(x, z) < t.waterAt(x, z) + 0.2) continue;
      const wolf = w.spawnAnimal('wolf', x, z);
      wolf.pack = pk.id;
      wolf.state = 'wander'; wolf.timer = 2;
      out.push(wolf);
    }
    this.live.set(pk.id, out);
  }

  /** Out of sight again: back to a place on the map (its wolves' hurts heal while it's away). */
  private dismiss(pk: Pack) {
    const w = this.g.world, wolves = this.live.get(pk.id) ?? [];
    w.animals = w.animals.filter((a) => !wolves.includes(a));
    this.live.delete(pk.id);
  }

  /** A wolf killed: one fewer in its pack (a pup grows up to replace it, in time). */
  killed(a: AnimalObj) {
    const pk = this.packs.find((x) => x.id === a.pack);
    if (!pk) return;
    pk.members = Math.max(0, pk.members - 1);
    const live = this.live.get(pk.id);
    if (live) this.live.set(pk.id, live.filter((x) => x !== a));
    telemetry.event('wolves', `A wolf killed (${pk.members} left in its pack)`);
  }

  /** A wolf struck: its whole pack (those close) turns on you, day or night. */
  provoked(a: AnimalObj) {
    const pk = this.packs.find((x) => x.id === a.pack);
    if (pk) pk.retreat = false;
    for (const o of this.g.world.animals) if (o.pack !== undefined && o.pack === a.pack && Math.hypot(o.x - a.x, o.z - a.z) < 50) { o.state = 'attack'; o.timer = 25; }
  }

  // ---------- light
  /**
   * The light you're in, if any: a torch in your hand, or a lit fire, torch,
   * brazier or lantern you're standing within reach of. Wolves won't come in
   * to it. Returns the light's middle and how far they keep off it.
   */
  lightAround(x: number, z: number): { x: number; z: number; r: number } | null {
    const g = this.g;
    if (g.activeItem()?.type === 'torch') return { x: g.player.pos.x, z: g.player.pos.z, r: HELD_LIGHT };
    let best: { x: number; z: number; r: number } | null = null;
    for (const o of g.world.near(x, z, 18)) {
      if (o.kind !== 'structure' || !o.lit || !o.built) continue;
      const def = STRUCTURES[o.type];
      if (!def.burns && !def.glow) continue;
      // The bigger the fire, the wider the ring it keeps clear.
      const r = 4 + 5 * (def.glow?.strength ?? 1);
      if (Math.hypot(o.x - x, o.z - z) <= r && (!best || r > best.r)) best = { x: o.x, z: o.z, r };
    }
    return best;
  }

  // ---------- a wolf on the ground
  /**
   * A wolf's mind, a frame at a time (before the common animal movement): by
   * night it hunts you, but holds off at the edge of any light you're in,
   * circling, and shies away if it comes too close; by day it keeps to its
   * den unless you've struck one of its pack. True if it's chosen where to go
   * (the common code then moves it); false to leave it to the usual states
   * (the charge and bite of 'attack', idling about the den).
   */
  steer(a: AnimalObj, _dt: number, toP: number): boolean {
    const g = this.g, p = g.player.pos;
    const pk = a.pack !== undefined ? this.packs.find((x) => x.id === a.pack) : undefined;
    const light = this.lightAround(p.x, p.z);
    const night = this.night && !g.dev.on('peaceful');
    // Afraid of the light, whatever else: keep off its edge, and shy from it.
    if (light && !pk?.retreat && (night || a.state === 'attack') && toP < light.r + 16) {
      const dl = Math.hypot(a.x - light.x, a.z - light.z) || 1;
      const ox = (a.x - light.x) / dl, oz = (a.z - light.z) / dl;
      if (pk && !pk.retreat) this.spook(pk);
      if (dl < light.r + 2) {
        a.state = 'flee'; a.timer = 1.5; a.windup = 0;
        a.dirX = ox; a.dirZ = oz; a.speed = ANIMALSPEED * 1.1;
        if (g.elapsed - this.shiedAt > 6 && toP < 25) { this.shiedAt = g.elapsed; g.msg('The wolf shies away from the light, snarling.', 'info'); }
      } else {
        // Circling just outside the light, waiting.
        a.state = 'wander'; a.timer = 2;
        const side = (a.id & 1) ? 1 : -1;
        const want = light.r + 7, pull = (dl - want) / 6;
        a.dirX = -oz * side - ox * pull; a.dirZ = ox * side - oz * pull;
        const l = Math.hypot(a.dirX, a.dirZ) || 1;
        a.dirX /= l; a.dirZ /= l; a.speed = 2.2;
      }
      return true;
    }
    if (a.state === 'attack') return false;
    // Given up for the night: off home at a lope, and lie up at the den.
    if (pk?.retreat) {
      const dd = Math.hypot(pk.den.x - a.x, pk.den.z - a.z);
      if (dd <= 14) return false;
      a.state = 'wander'; a.timer = 2;
      a.dirX = (pk.den.x - a.x) / dd; a.dirZ = (pk.den.z - a.z) / dd; a.speed = ANIMALSPEED * 0.8;
      return true;
    }
    if (night) {
      // On the hunt: within sight of you it closes in to bite; further off it follows your scent.
      if (toP < 60 && !g.dev.on('peaceful')) {
        a.state = 'attack'; a.timer = 20;
        if (!g.tips.has('wolves')) {
          g.tips.add('wolves');
          g.ui.showNotice('Wolves!',
            `<p>A pack of <b>wolves</b> is hunting you. Wolves den in the forests at the foot of the mountains and lie up there by day, but <b>after sunset</b> they range far across the country, and they'll follow your scent.</p>
            <p>They're <b>afraid of fire</b>. Hold a lit <b>torch</b>, or stand in the light of a lit <b>campfire</b>, torch, brazier or lantern, and they'll keep off at the edge of the light. Hold them off for about <b>ten seconds</b> and they <b>give up</b>: the pack slinks back to its den and stays there for the rest of the night. Ring your camp with torches and keep the fire going through the night.</p>
            <p>You can fight them: they're quick, and they bite hard, and when you strike one, its pack turns on you (even one slinking home). They'll do the same by day if you attack them at the den.</p>`,
            'Stay in the light', () => {}, { kind: 'lesson' });
        }
        return false;
      }
      const l = toP || 1;
      a.state = 'wander'; a.timer = 2;
      a.dirX = (p.x - a.x) / l; a.dirZ = (p.z - a.z) / l; a.speed = 3.6;
      return true;
    }
    // By day: home to the den, and lie about it.
    if (pk) {
      const dd = Math.hypot(pk.den.x - a.x, pk.den.z - a.z);
      if (dd > 14) {
        a.state = 'wander'; a.timer = 2;
        a.dirX = (pk.den.x - a.x) / dd; a.dirZ = (pk.den.z - a.z) / dd; a.speed = 3;
        return true;
      }
    }
    return false;
  }

  /** A pack held off by the light a moment longer (counted once a frame, whichever of its wolves sees it); long enough, and it goes home. */
  private spook(pk: Pack) {
    const g = this.g, now = g.elapsed, last = pk.spookedAt ?? -1e9;
    if (now === last) return;
    const dt = now - last;
    pk.spooked = dt > SPOOK_FORGET ? 0 : (pk.spooked ?? 0) + Math.min(dt, 0.5);
    pk.spookedAt = now;
    if (pk.spooked < SPOOK_GIVE_UP) return;
    pk.retreat = true; pk.goal = { x: pk.den.x, z: pk.den.z };
    for (const o of this.live.get(pk.id) ?? []) if (o.state === 'attack') { o.state = 'wander'; o.timer = 2; o.windup = 0; }
    g.msg('The wolves give up on you and slink off into the dark, back toward their den.', 'info');
    telemetry.event('wolves', `A pack gives up, spooked by the light, and goes home`);
  }

  serialize() {
    return { packs: this.packs, nextId: this.nextId };
  }

  load(data?: { packs: Pack[]; nextId: number }) {
    if (!data) return;
    this.packs = data.packs ?? [];
    this.nextId = data.nextId ?? this.packs.length + 1;
  }
}

/** A wolf's running speed (for shying from the light). */
const ANIMALSPEED = 6.4;

/** A den: boulders heaped against the slope, a dark hollow under them, gnawed bones about the mouth. */
function denModel(key: string): THREE.Group {
  const g = new THREE.Group();
  let s = 0;
  for (const ch of key) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const stone = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.95, flatShading: true });
  const moss = new THREE.MeshStandardMaterial({ color: 0x4e5a38, roughness: 1, flatShading: true });
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI * 0.85 + (k / 8) * Math.PI * 1.7, r = 2.4 + rnd() * 0.8;
    const b = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1 + rnd() * 0.8, 0), k % 3 ? stone : moss);
    b.position.set(Math.sin(a) * r, 0.6 + rnd() * 0.6, -Math.cos(a) * r * 0.8 - 0.8);
    b.rotation.set(rnd() * 3, rnd() * 3, 0);
    b.scale.y = 0.75;
    b.castShadow = b.receiveShadow = true;
    g.add(b);
  }
  // The roof of the lair over its mouth, and the dark within.
  const roof = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2, 0), stone);
  roof.position.set(0, 2.0, -1.4); roof.scale.set(1.3, 0.55, 1.1); roof.castShadow = true;
  g.add(roof);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0c0a08 }));
  mouth.position.set(0, 0, -0.6); mouth.scale.set(1.1, 1.05, 0.6);
  g.add(mouth);
  // Bones, and a trodden patch before it.
  const bone = new THREE.MeshStandardMaterial({ color: 0xe0d8c4, roughness: 0.7 });
  for (let k = 0; k < 6; k++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.35 + rnd() * 0.25, 5), bone);
    b.position.set((rnd() - 0.5) * 3, 0.04, 0.6 + rnd() * 1.8);
    b.rotation.set(Math.PI / 2, rnd() * 3, 0);
    g.add(b);
  }
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6).scale(1, 0.8, 1.3), bone);
  skull.position.set(0.9, 0.1, 1.2);
  g.add(skull);
  const trodden = new THREE.Mesh(new THREE.CircleGeometry(2.6, 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a3c2c, roughness: 1 }));
  trodden.position.set(0, 0.03, 1.0);
  trodden.receiveShadow = true;
  g.add(trodden);
  return g;
}
