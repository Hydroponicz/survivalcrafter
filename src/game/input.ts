export class Input {
  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** Wheel turned with Ctrl held: zooms the third-person camera (the plain wheel cycles the hotbar). */
  zoom = 0;
  locked = false;
  /** Mouse buttons currently held down (while the mouse is captured). */
  held = new Set<number>();
  private pressed = new Set<string>();
  private clicks: number[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      // (Alt shows the cursor: don't let it also open the browser's menu bar.)
      if (['Space', 'Tab', 'F1', 'F2', 'AltLeft', 'ControlLeft'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'AltLeft') e.preventDefault(); });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.clicks.push(e.button);
      this.held.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.held.delete(e.button));
    // Block the browser menu everywhere, not just on the canvas: on Windows it opens on
    // mouseup, after our action menu has already released the mouse over the UI.
    document.addEventListener('contextmenu', (e) => {
      if (!isTyping(e)) e.preventDefault();
    });
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      // Shift turns the wheel sideways in some browsers, so fall back to deltaX.
      const d = Math.sign(e.deltaY || e.deltaX);
      // Ctrl+wheel would zoom the page: take it for the camera instead.
      if (e.ctrlKey) { e.preventDefault(); this.zoom += d; } else this.wheel += d;
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.held.clear(); }
    });
  }

  lock() {
    if (!this.locked) this.canvas.requestPointerLock()?.catch?.(() => {});
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  /** True once per key press. */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  takeClicks(): number[] {
    const c = this.clicks;
    this.clicks = [];
    return c;
  }

  endFrame() {
    this.mouseDX = this.mouseDY = this.wheel = this.zoom = 0;
    this.pressed.clear();
  }
}

function isTyping(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
