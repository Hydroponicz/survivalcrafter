// Tooltips: hover anything with a `data-tip` (HTML) or a `title` and a box
// with more about it follows the pointer. Works with the real mouse and with
// the in-game cursor (which replays hovers as mouseover events).

export class Tooltip {
  readonly el: HTMLElement;
  private target: Element | null = null;
  /** Where the pointer last was (to find what's under it again after a redraw). */
  private px = 0;
  private py = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    root.appendChild(this.el);
    document.addEventListener('mouseover', (e) => this.over(e.target as Element | null, e.clientX, e.clientY));
    document.addEventListener('mousemove', (e) => { if (this.target) this.place(e.clientX, e.clientY); });
  }

  private over(el: Element | null, x: number, y: number) {
    this.px = x; this.py = y;
    const t = el?.closest?.('[data-tip], [title]') ?? null;
    if (t === this.target) return;
    this.target = t;
    if (!t) { this.hide(); return; }
    // Our box replaces the browser's own (which wouldn't show under a captured mouse anyway).
    const title = t.getAttribute('title');
    if (title) { (t as HTMLElement).dataset.tip ??= escapeHtml(title); t.removeAttribute('title'); }
    const tip = (t as HTMLElement).dataset.tip;
    if (!tip) { this.hide(); return; }
    this.el.innerHTML = tip;
    this.el.style.display = 'block';
    this.place(x, y);
  }

  /** Keep the box by the pointer, inside the screen. */
  place(x: number, y: number) {
    this.px = x; this.py = y;
    if (this.el.style.display !== 'block') return;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const left = x + 16 + w > window.innerWidth ? x - 12 - w : x + 16;
    const top = y + 18 + h > window.innerHeight ? y - 10 - h : y + 18;
    this.el.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
  }

  /** Hide unless the thing hovered is still on the page (windows close, menus redraw). */
  check() {
    if (!this.target || this.target.isConnected) return;
    // Redrawn under a still pointer: show whatever is there now.
    this.target = null;
    this.over(document.elementFromPoint(this.px, this.py), this.px, this.py);
  }

  hide() {
    this.el.style.display = 'none';
  }

  /** Forget what's hovered (the pointer went back to steering the camera). */
  reset() {
    this.target = null;
    this.hide();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
