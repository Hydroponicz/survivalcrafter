// Tooltips: hover anything with a `data-tip` (HTML) or a `title` and a box
// with more about it follows the pointer. Works with the real mouse and with
// the in-game cursor (which replays hovers as mouseover events).

export class Tooltip {
  readonly el: HTMLElement;
  private target: Element | null = null;
  /** Where the pointer last was (to find what's under it again after a redraw). */
  private px = 0;
  private py = 0;
  /** Which side of the pointer the box sits (kept until it no longer fits, so it doesn't hop about). */
  private left = false;
  private above = false;
  private tip = '';

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    root.appendChild(this.el);
    // While the game holds the mouse, the in-game cursor drives the tooltip
    // (its hovers are replayed events); the real mouse's events then report
    // where the pointer was when it was captured, and would tug the box there.
    const real = (e: MouseEvent) => e.isTrusted && !!document.pointerLockElement;
    document.addEventListener('mouseover', (e) => { if (!real(e)) this.over(e.target as Element | null, e.clientX, e.clientY); });
    document.addEventListener('mousemove', (e) => { if (this.target && !real(e)) this.place(e.clientX, e.clientY); });
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
    // (A window redrawn under the pointer gives the same tip again: leave it be.)
    if (this.tip !== tip) { this.tip = tip; this.el.innerHTML = tip; this.left = this.above = false; }
    this.el.style.display = 'block';
    this.place(x, y);
  }

  /** Keep the box by the pointer, inside the screen. */
  place(x: number, y: number) {
    this.px = x; this.py = y;
    if (this.el.style.display !== 'block') return;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    // Right of and below the pointer unless it won't fit; once moved, it stays
    // on that side until it fits back comfortably (no flipping at the edge).
    if (!this.left && x + 16 + w > window.innerWidth) this.left = true;
    else if (this.left && x + 16 + w < window.innerWidth - 40) this.left = false;
    if (!this.above && y + 18 + h > window.innerHeight) this.above = true;
    else if (this.above && y + 18 + h < window.innerHeight - 40) this.above = false;
    const left = this.left ? x - 12 - w : x + 16;
    const top = this.above ? y - 10 - h : y + 18;
    const t = `translate(${Math.round(Math.max(4, left))}px, ${Math.round(Math.max(4, top))}px)`;
    if (this.el.style.transform !== t) this.el.style.transform = t;
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
