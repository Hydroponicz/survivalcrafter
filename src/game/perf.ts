/**
 * Frame timing: frames per second, the slowest frame each second (what you
 * feel as a stutter), and where the time went in it, by named section.
 */
export class FrameStats {
  /** Frames drawn in the last full second. */
  fps = 0;
  /** The longest gap between frames in the last full second (ms). */
  worst = 0;
  /** The sections that took longest in the slowest frame of the last full second, longest first. */
  worstParts: [string, number][] = [];
  /** Average time per frame for each section over the last full second (ms). */
  average: [string, number][] = [];

  private frame = new Map<string, number>();
  private sum = new Map<string, number>();
  private frames = 0;
  private windowStart = -1;
  private last = -1;
  private maxGap = 0;
  private maxParts: [string, number][] = [];
  /** Time spent outside frames (e.g. a tile arriving from a worker) since the last frame. */
  private between = new Map<string, number>();

  /** Time a piece of work as part of this frame. */
  time<T>(name: string, f: () => T): T {
    const t0 = performance.now();
    try { return f(); } finally { this.add(name, performance.now() - t0); }
  }

  add(name: string, ms: number) {
    this.frame.set(name, (this.frame.get(name) ?? 0) + ms);
  }

  /** Time work done between frames (it still delays the next one). */
  timeBetween<T>(name: string, f: () => T): T {
    const t0 = performance.now();
    try { return f(); } finally { this.between.set(name, (this.between.get(name) ?? 0) + performance.now() - t0); }
  }

  /** At the start of a frame. */
  begin() {
    this.frame.clear();
    for (const [k, v] of this.between) this.frame.set(k, v);
    this.between.clear();
  }

  /** At the end of a frame. */
  end() {
    const now = performance.now();
    if (this.windowStart < 0) { this.windowStart = now; this.last = now; }
    const gap = now - this.last;
    this.last = now;
    this.frames++;
    for (const [k, v] of this.frame) this.sum.set(k, (this.sum.get(k) ?? 0) + v);
    if (gap > this.maxGap) {
      this.maxGap = gap;
      this.maxParts = [...this.frame].sort((a, b) => b[1] - a[1]);
    }
    if (now - this.windowStart >= 1000) {
      const secs = (now - this.windowStart) / 1000;
      this.fps = Math.round(this.frames / secs);
      this.worst = this.maxGap;
      this.worstParts = this.maxParts;
      this.average = [...this.sum].map(([k, v]) => [k, v / this.frames] as [string, number]).sort((a, b) => b[1] - a[1]);
      this.windowStart = now;
      this.frames = 0;
      this.maxGap = 0;
      this.maxParts = [];
      this.sum.clear();
    }
  }
}

/** The game's frame timing (one game at a time). */
export const perf = new FrameStats();
