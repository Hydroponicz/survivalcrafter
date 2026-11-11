// How long the graphics card takes to draw a frame, measured on the card
// itself (WebGL2 timer queries). The answer for a frame arrives a frame or
// two later, so a few queries are kept in flight. Where the browser doesn't
// offer the timer (some do not, for privacy), `supported` is false.

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export class GpuTimer {
  readonly supported: boolean;
  private ext: TimerExt | null = null;
  private free: WebGLQuery[] = [];
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** Milliseconds of the frames measured in the current second, and the last full second's results. */
  private window: number[] = [];
  private windowStart = 0;
  /** The last full second: average and slowest frame on the card (ms), or -1 before any. */
  avg = -1;
  worst = -1;
  /** A running average over the last minute (for the debug report). */
  minute: number[] = [];

  constructor(private gl: WebGL2RenderingContext) {
    try { this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null; } catch { this.ext = null; }
    this.supported = !!this.ext;
  }

  /** Start timing what's drawn next (call before the frame's draw). */
  begin() {
    if (!this.ext || this.active) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  /** Stop timing (after the draw), and collect any answers that have come back. */
  end() {
    const gl = this.gl, ext = this.ext;
    if (!ext) return;
    if (this.active) { gl.endQuery(ext.TIME_ELAPSED_EXT); this.pending.push(this.active); this.active = null; }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) this.window.push(ns / 1e6);
      this.free.push(q);
    }
    // (Too many outstanding: the card is far behind; let the oldest go.)
    if (this.pending.length > 6) this.free.push(this.pending.shift()!);
    const now = performance.now();
    if (!this.windowStart) this.windowStart = now;
    if (now - this.windowStart >= 1000 && this.window.length) {
      this.avg = this.window.reduce((a, b) => a + b, 0) / this.window.length;
      this.worst = Math.max(...this.window);
      this.minute.push(this.avg);
      if (this.minute.length > 60) this.minute.shift();
      this.window = [];
      this.windowStart = now;
    }
  }
}
