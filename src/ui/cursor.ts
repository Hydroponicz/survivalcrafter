// An in-game mouse cursor for the UI while the real mouse stays captured.
//
// Releasing pointer lock to use a window flashes the pause screen, and taking
// it back makes the browser show its "press Esc to show your cursor" notice
// every time. Instead we keep the lock, move this cursor with the mouse, and
// replay clicks, hovers, scrolling and drag-and-drop onto the page elements
// under it.

const DRAG_START_PX = 5;

export class VirtualCursor {
  readonly el: HTMLElement;
  x = window.innerWidth / 2;
  y = window.innerHeight / 2;
  private visible = false;
  /** Elements currently under the cursor, innermost first. */
  private hoverChain: Element[] = [];
  private pressed: { button: number; target: Element; x: number; y: number } | null = null;
  private drag: { source: HTMLElement; dt: DataTransfer; over: Element | null; accepted: boolean; ghost: HTMLElement } | null = null;

  /**
   * `active` says whether the cursor should be driving the UI right now.
   * `onPressOutside` is called for presses on nothing interactive (e.g. to close a menu).
   */
  constructor(root: HTMLElement, private active: () => boolean, private onPress?: (target: Element | null, button: number) => boolean) {
    this.el = document.createElement('div');
    this.el.className = 'ui-cursor';
    this.el.style.display = 'none';
    root.appendChild(this.el);

    // Captured-mouse events all target the canvas. Intercept them first (capture
    // phase on window) so the game doesn't see them, and replay them on the UI.
    // Only real input: the events we replay below bubble back up to window too.
    window.addEventListener('mousedown', (e) => {
      if (!e.isTrusted || !this.active()) return;
      e.preventDefault();
      e.stopPropagation();
      this.down(e.button);
    }, true);
    window.addEventListener('mouseup', (e) => {
      if (!e.isTrusted || !this.active()) return;
      e.preventDefault();
      e.stopPropagation();
      this.up(e.button);
    }, true);
    window.addEventListener('wheel', (e) => {
      if (!e.isTrusted || !this.active()) return;
      e.stopPropagation();
      this.scroll(e.deltaY);
    }, { capture: true, passive: true });
  }

  /** Show or hide; recentres when it first appears. */
  setVisible(on: boolean) {
    if (on === this.visible) return;
    this.visible = on;
    this.el.style.display = on ? 'block' : 'none';
    if (on) {
      this.x = window.innerWidth / 2;
      this.y = window.innerHeight / 2;
      this.move(0, 0);
    } else {
      this.cancelDrag();
      this.setHover(null);
      this.pressed = null;
    }
  }

  get isVisible() { return this.visible; }

  move(dx: number, dy: number) {
    this.x = Math.max(0, Math.min(window.innerWidth - 1, this.x + dx));
    this.y = Math.max(0, Math.min(window.innerHeight - 1, this.y + dy));
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    const target = this.targetAt();

    if (this.pressed && !this.drag && this.pressed.button === 0 &&
      Math.hypot(this.x - this.pressed.x, this.y - this.pressed.y) > DRAG_START_PX) {
      this.startDrag(this.pressed.target);
    }
    if (this.drag) {
      this.drag.ghost.style.transform = `translate(${this.x + 12}px, ${this.y + 8}px)`;
      this.dragOver(target);
    }
    this.setHover(target);
  }

  /** The topmost page element under the cursor that takes pointer events. */
  private targetAt(): Element | null {
    // Look past our own cursor and drag ghost (both have pointer-events: none).
    const t = document.elementFromPoint(this.x, this.y);
    return t && t.tagName !== 'CANVAS' && t !== document.body && t !== document.documentElement ? t : null;
  }

  private fire(target: Element, type: string, button = 0, bubbles = true) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles, cancelable: true, clientX: this.x, clientY: this.y, button, buttons: button === 0 ? 1 : 2, view: window,
    }));
  }

  /** Keep `vhover` classes and mouseenter/leave in step with what's under the cursor. */
  private setHover(target: Element | null) {
    const chain: Element[] = [];
    for (let e = target; e && e !== document.body; e = e.parentElement) chain.push(e);
    for (const e of this.hoverChain) {
      if (chain.includes(e)) continue;
      e.classList.remove('vhover');
      this.fire(e, 'mouseleave', 0, false);
    }
    for (const e of chain) {
      if (this.hoverChain.includes(e)) continue;
      e.classList.add('vhover');
      this.fire(e, 'mouseenter', 0, false);
    }
    if (chain[0] !== this.hoverChain[0] && chain[0]) this.fire(chain[0], 'mouseover');
    this.hoverChain = chain;
  }

  private down(button: number) {
    const target = this.targetAt();
    if (this.onPress?.(target, button)) return;
    if (!target) return;
    this.pressed = { button, target, x: this.x, y: this.y };
    this.fire(target, 'mousedown', button);
    // Text fields and dropdowns need focus to take keyboard input.
    const field = target.closest('input, select, textarea') as HTMLElement | null;
    if (field) field.focus();
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private up(button: number) {
    const target = this.targetAt();
    const pressed = this.pressed;
    this.pressed = null;
    if (this.drag) { this.endDrag(); return; }
    if (!target) return;
    this.fire(target, 'mouseup', button);
    if (!pressed || pressed.button !== button) return;
    // A click lands on whatever both the press and release were over.
    let common: Element | null = target;
    while (common && !common.contains(pressed.target)) common = common.parentElement;
    if (!common) return;
    if (button === 0) {
      const clickable = pressed.target.closest('button, input, select, label, a') as HTMLElement | null;
      if (clickable && common.contains(clickable)) clickable.click();
      else this.fire(pressed.target, 'click');
    } else if (button === 2) {
      this.fire(pressed.target, 'contextmenu', 2);
    }
  }

  private scroll(dy: number) {
    for (let e = this.targetAt(); e; e = e.parentElement) {
      if (e instanceof HTMLElement && e.scrollHeight > e.clientHeight && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) {
        e.scrollTop += dy;
        return;
      }
    }
  }

  // ---------- simulated HTML drag and drop
  private startDrag(from: Element) {
    const source = from.closest('[draggable="true"]') as HTMLElement | null;
    if (!source) return;
    const dt = new DataTransfer();
    const start = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: this.x, clientY: this.y });
    source.dispatchEvent(start);
    if (start.defaultPrevented) return;
    const ghost = document.createElement('div');
    ghost.className = 'ui-drag-ghost';
    ghost.textContent = source.querySelector('.icon, .slot-icon')?.textContent ?? '•';
    document.getElementById('ui')!.appendChild(ghost);
    this.drag = { source, dt, over: null, accepted: false, ghost };
  }

  private dragOver(target: Element | null) {
    const d = this.drag!;
    if (target !== d.over) {
      if (d.over) d.over.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: d.dt }));
      if (target) target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: d.dt }));
      d.over = target;
    }
    d.accepted = false;
    if (target) {
      const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: d.dt, clientX: this.x, clientY: this.y });
      target.dispatchEvent(ev);
      d.accepted = ev.defaultPrevented; // a drop target accepts by cancelling dragover
    }
  }

  private endDrag() {
    const d = this.drag!;
    this.drag = null;
    d.ghost.remove();
    if (d.over && d.accepted) {
      d.over.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: d.dt, clientX: this.x, clientY: this.y }));
    } else {
      d.dt.dropEffect = 'none';
      if (d.over) d.over.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: d.dt }));
    }
    d.source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: d.dt }));
  }

  private cancelDrag() {
    if (!this.drag) return;
    this.drag.dt.dropEffect = 'none';
    this.endDrag();
  }
}
