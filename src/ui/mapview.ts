import { STRUCTURES } from '../data/structures';
import { isGenerated } from '../world/world';
import type { Game } from '../game/game';
import type { WorldMap } from './worldmap';

// The map, as a scroll: an aged sheet of parchment between two wooden
// rollers, the known world inked on it. Drag to pan, wheel to zoom; your
// position is a red arrow, home a little house, the things you've built
// small inked squares; a compass rose, a scale bar and a title cartouche
// finish it off.

const INK = '#4a321e';
const RED = '#8e2a1c';

/** An aged parchment texture, made once: mottled, stained and grained. */
let paperUrl = '';
function paper(): string {
  if (paperUrl) return paperUrl;
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e6d2a6';
  ctx.fillRect(0, 0, S, S);
  // Mottling: many soft blotches, lighter and darker.
  for (let k = 0; k < 260; k++) {
    const x = Math.random() * S, y = Math.random() * S, r = 10 + Math.random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.55;
    g.addColorStop(0, dark ? 'rgba(140,100,50,0.07)' : 'rgba(255,248,225,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) { ctx.save(); ctx.translate(dx, dy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore(); }
  }
  // A few old stains with darker rims (tea, damp).
  for (let k = 0; k < 5; k++) {
    const x = Math.random() * S, y = Math.random() * S, r = 18 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
    g.addColorStop(0, 'rgba(150,105,55,0.04)');
    g.addColorStop(0.85, 'rgba(120,80,40,0.10)');
    g.addColorStop(1, 'rgba(120,80,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Fibres in the grain.
  ctx.strokeStyle = 'rgba(110,80,40,0.05)';
  for (let k = 0; k < 900; k++) {
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI, l = 3 + Math.random() * 10;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  paperUrl = c.toDataURL('image/jpeg', 0.85);
  return paperUrl;
}

export class MapView {
  private root: HTMLElement | null = null;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  /** The view: the world point at its centre, and pixels a metre. */
  private cx = 0;
  private cz = 0;
  private scale = 0.6;
  private drag: { x: number; y: number } | null = null;
  private drawn = '';

  constructor(private g: Game, private map: WorldMap) {}

  /** Build the scroll inside its window (once). */
  mount(w: HTMLElement) {
    if (this.root) return;
    w.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'map-scroll';
    root.innerHTML = `
      <div class="map-roller top"><span></span></div>
      <div class="map-sheet" style="background-image:url(${paper()})">
        <canvas class="map-canvas"></canvas>
        <div class="map-vignette"></div>
        <div class="map-buttons"><button data-map="centre" data-tip="Back to where you stand">Centre on me</button><button data-map="close" data-tip="Close the map (M)">Close</button></div>
        <div class="map-help">Drag to pan · wheel to zoom · M to close</div>
      </div>
      <div class="map-roller bottom"><span></span></div>`;
    w.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    root.querySelector('[data-map="centre"]')!.addEventListener('click', () => this.centre());
    root.querySelector('[data-map="close"]')!.addEventListener('click', () => this.g.ui.close('map'));
    // The real mouse (when the game isn't holding it): drag and wheel.
    const real = (e: MouseEvent) => e.isTrusted && !document.pointerLockElement;
    this.canvas.addEventListener('mousedown', (e) => { if (real(e)) this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mousemove', (e) => { if (real(e) && this.drag) { this.pan(e.clientX - this.drag.x, e.clientY - this.drag.y); this.drag = { x: e.clientX, y: e.clientY }; } });
    window.addEventListener('mouseup', (e) => { if (real(e)) this.drag = null; });
    this.canvas.addEventListener('wheel', (e) => { if (!document.pointerLockElement) { this.zoom(-Math.sign(e.deltaY), e.clientX, e.clientY); e.preventDefault(); } }, { passive: false });
  }

  /** Opened: centred on you. */
  opened() {
    this.centre();
  }

  centre() {
    this.cx = this.g.player.pos.x;
    this.cz = this.g.player.pos.z;
    this.drawn = '';
  }

  private pan(dx: number, dy: number) {
    this.cx -= dx / this.scale;
    this.cz -= dy / this.scale;
  }

  /** Zoom in (+1) or out (-1) about a point on screen. */
  private zoom(dir: number, sx: number, sy: number) {
    const r = this.canvas.getBoundingClientRect();
    const wx = this.cx + (sx - r.left - r.width / 2) / this.scale, wz = this.cz + (sy - r.top - r.height / 2) / this.scale;
    this.scale = Math.max(0.12, Math.min(4, this.scale * (dir > 0 ? 1.25 : 0.8)));
    this.cx = wx - (sx - r.left - r.width / 2) / this.scale;
    this.cz = wz - (sy - r.top - r.height / 2) / this.scale;
  }

  /** The in-game cursor (while the game holds the mouse): drag with the left button held, the wheel zooms. */
  input(wheel: number, held: boolean, x: number, y: number) {
    if (!this.root) return;
    const r = this.canvas.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (held && (this.drag || over)) {
      if (this.drag) this.pan(x - this.drag.x, y - this.drag.y);
      this.drag = { x, y };
    } else if (!held && document.pointerLockElement) this.drag = null;
    if (wheel && over) this.zoom(-Math.sign(wheel), x, y);
  }

  /** Redraw (each frame while open; only the parts that changed cost anything). */
  frame() {
    if (!this.root) return;
    const c = this.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.drawn = ''; }
    const p = this.g.player;
    const key = `${this.cx.toFixed(1)},${this.cz.toFixed(1)},${this.scale},${this.map.version},${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)},${p.yaw.toFixed(2)}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const ctx = this.ctx;
    this.map.paint(ctx, w, h, this.cx, this.cz, this.scale);
    const toX = (x: number) => (x - this.cx) * this.scale + w / 2, toY = (z: number) => (z - this.cz) * this.scale + h / 2;

    // The roads between settlements, and the traders on them.
    ctx.strokeStyle = 'rgba(120,86,50,0.6)'; ctx.lineWidth = Math.max(1.2, 2.4 * this.scale); ctx.lineCap = 'round';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (const road of this.g.world.terrain.villages.knownRoads()) {
      ctx.moveTo(toX(road[0].ax), toY(road[0].az));
      for (const sg of road) ctx.lineTo(toX(sg.bx), toY(sg.bz));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(40,70,110,0.9)';
    for (const tp of this.g.traders.positions()) { ctx.beginPath(); ctx.arc(toX(tp.x), toY(tp.z), 3, 0, Math.PI * 2); ctx.fill(); }
    // Villages and towns you've come near: their paths and streets, buildings, fields and name.
    for (const v of this.g.world.terrain.villages.known()) {
      if (toX(v.x) < -200 || toX(v.x) > w + 200 || toY(v.z) < -200 || toY(v.z) > h + 200) continue;
      ctx.strokeStyle = 'rgba(120,86,50,0.75)'; ctx.lineWidth = Math.max(1, 1.6 * this.scale); ctx.lineCap = 'round';
      ctx.beginPath();
      for (const sg of v.paths) { ctx.moveTo(toX(sg.ax), toY(sg.az)); ctx.lineTo(toX(sg.bx), toY(sg.bz)); }
      ctx.stroke();
      const rect = (r: { x: number; z: number; yaw: number; hx: number; hz: number }, fill: string) => {
        ctx.save();
        ctx.translate(toX(r.x), toY(r.z));
        ctx.rotate(-r.yaw);
        ctx.fillStyle = fill;
        ctx.fillRect(-r.hx * this.scale, -r.hz * this.scale, 2 * r.hx * this.scale, 2 * r.hz * this.scale);
        ctx.restore();
      };
      for (const f of v.fields) rect(f, 'rgba(140,100,50,0.35)');
      for (const p of v.paved) rect(p, 'rgba(150,140,120,0.45)');
      for (const f of v.facades) rect(f, 'rgba(96,66,40,0.8)');
      for (const hs of v.houses) rect({ x: hs.x, z: hs.z, yaw: hs.yaw, hx: hs.tiles, hz: hs.nz }, hs.kind === 'cathedral' ? 'rgba(90,80,90,0.95)' : 'rgba(74,50,30,0.85)');
      if (v.castle) rect({ ...v.castle, hx: v.castle.half, hz: v.castle.half }, 'rgba(110,100,95,0.55)');
      ctx.fillStyle = INK; ctx.font = v.kind === 'village' ? 'italic bold 13px Georgia, serif' : v.kind === 'town' ? 'italic bold 16px Georgia, serif' : 'italic bold 18px Georgia, serif'; ctx.textAlign = 'center';
      ctx.fillText(v.kind === 'town' ? `${v.name} (town)` : v.kind === 'city' ? `${v.name} (castle)` : v.kind === 'port' ? `${v.name} (port)` : v.name, toX(v.x), toY(v.z) - Math.max(14, (v.r - 10) * this.scale));
    }
    // What you've built: small inked squares.
    ctx.fillStyle = 'rgba(74,50,30,0.8)';
    for (const o of this.g.world.objects.values()) {
      if (o.kind !== 'structure' || !o.built || isGenerated(o.id)) continue;
      const s = Math.max(2, 1.6 * this.scale);
      ctx.fillRect(toX(o.x) - s / 2, toY(o.z) - s / 2, s, s);
    }
    // Where the world began (a flag), and home: your first bed (a little house).
    const o = this.g.world.origin;
    this.flag(ctx, toX(o.x), toY(o.z));
    let bed: { x: number; z: number; id: number } | null = null;
    for (const s of this.g.world.objects.values()) {
      if (s.kind === 'structure' && s.built && !isGenerated(s.id) && STRUCTURES[s.type]?.bed && (!bed || s.id < bed.id)) bed = s;
    }
    if (bed) this.house(ctx, toX(bed.x), toY(bed.z));
    // You: a red arrow pointing the way you face (north is up).
    const ax = toX(p.pos.x), ay = toY(p.pos.z), fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(fx, -fz));
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.fillStyle = RED; ctx.strokeStyle = '#3a1a10'; ctx.lineWidth = 1.2;
    ctx.fill(); ctx.stroke();
    ctx.restore();

    this.compass(ctx, w - 78, h - 86);
    this.scaleBar(ctx, 34, h - 40);
    this.cartouche(ctx, w / 2, 34);
  }

  /** The world spawn: a little pennant on a pole. */
  private flag(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.save();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x, y - 9); ctx.stroke();
    ctx.fillStyle = RED;
    ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 9, y - 6); ctx.lineTo(x, y - 3); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.font = 'italic 12px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText('World spawn', x, y + 19);
    ctx.restore();
  }

  private house(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.save();
    ctx.strokeStyle = INK; ctx.fillStyle = 'rgba(233,214,172,0.9)'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 5); ctx.lineTo(x - 6, y - 1); ctx.lineTo(x, y - 7); ctx.lineTo(x + 6, y - 1); ctx.lineTo(x + 6, y + 5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.fillRect(x - 1.5, y + 1, 3, 4);
    ctx.font = 'italic 12px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText('Home', x, y + 18);
    ctx.restore();
  }

  /** A hand-drawn compass rose. */
  private compass(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2, r0 = k % 4 === 0 ? 26 : 28;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); ctx.stroke();
    }
    // Eight points, the four great ones longer, each half shaded.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 - Math.PI / 2, long = k % 2 === 0 ? 40 : 22, wid = k % 2 === 0 ? 6 : 4;
      const tip = [Math.cos(a) * long, Math.sin(a) * long], l = [Math.cos(a - Math.PI / 2) * wid, Math.sin(a - Math.PI / 2) * wid], r = [Math.cos(a + Math.PI / 2) * wid, Math.sin(a + Math.PI / 2) * wid];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(l[0], l[1]); ctx.lineTo(tip[0], tip[1]); ctx.closePath();
      ctx.fillStyle = k === 0 ? RED : INK; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r[0], r[1]); ctx.lineTo(tip[0], tip[1]); ctx.closePath();
      ctx.fillStyle = 'rgba(233,214,172,0.95)'; ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = INK; ctx.font = 'bold 14px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText('N', 0, -46);
    ctx.font = '11px Georgia, serif';
    ctx.fillText('S', 0, 56); ctx.fillText('E', 50, 4); ctx.fillText('W', -50, 4);
    ctx.restore();
  }

  /** A scale bar in round metres. */
  private scaleBar(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const target = 160 / this.scale;
    const nice = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const len = nice * this.scale;
    ctx.save();
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, len, 6);
    for (let k = 0; k < 4; k += 2) ctx.fillRect(x + (len / 4) * k, y, len / 4, 6);
    ctx.font = 'italic 12px Georgia, serif'; ctx.textAlign = 'left';
    ctx.fillText('0', x - 3, y - 5);
    ctx.textAlign = 'right';
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x + len + 4, y - 5);
    ctx.restore();
  }

  /** The title, in a scrolled cartouche. */
  private cartouche(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.save();
    const title = 'A Chart of the Wilds', sub = `as walked by the traveller, day ${this.g.world.day}`;
    ctx.font = 'italic 22px Georgia, serif';
    const tw = Math.max(ctx.measureText(title).width, 200) + 50;
    ctx.fillStyle = 'rgba(236,220,182,0.92)'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - tw / 2, y - 20); ctx.lineTo(x + tw / 2, y - 20);
    ctx.quadraticCurveTo(x + tw / 2 + 14, y + 2, x + tw / 2, y + 24); ctx.lineTo(x - tw / 2, y + 24);
    ctx.quadraticCurveTo(x - tw / 2 - 14, y + 2, x - tw / 2, y - 20);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = 'center';
    ctx.fillText(title, x, y + 4);
    ctx.font = 'italic 11px Georgia, serif';
    ctx.fillText(sub, x, y + 18);
    ctx.restore();
  }
}
