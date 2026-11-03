// Telemetry: a rolling log of what happened in this session (events, warnings,
// errors, slow frames and self-repairs), with counters, kept in memory and
// saved now and then so the next session can see how the last one ended.
//
// It never leaves the browser. In game: Dev console (` or F2) → Debug report,
// to download or copy it; from the browser console: window.__debug.report().

export type Level = 'event' | 'info' | 'warn' | 'error' | 'heal' | 'perf';

export interface Entry {
  /** Seconds since the session began. */
  t: number;
  level: Level;
  /** What part of the game it's about (e.g. 'taming', 'action', 'save', 'frame'). */
  cat: string;
  msg: string;
  data?: unknown;
}

interface Saved {
  id: string;
  started: string;
  meta: Record<string, unknown>;
  /** Set when the page is closed normally; still false after a crash or a killed tab. */
  cleanExit: boolean;
  counters: Record<string, number>;
  entries: Entry[];
}

const KEY = 'survivalcrafter.telemetry.v1';
const MAX = 800;
const KEEP = 300;

class Telemetry {
  readonly id = Math.random().toString(36).slice(2, 10);
  readonly started = new Date().toISOString();
  private t0 = performance.now();
  entries: Entry[] = [];
  counters = new Map<string, number>();
  meta: Record<string, unknown> = {};
  /** How the previous session ended (from storage), if there was one. */
  previous: Saved | null = null;
  private dirty = false;
  private installed = false;
  /** The same message logged over and over (an error every frame) is counted, not repeated. */
  private repeats = new Map<string, { n: number; last: number }>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.previous = JSON.parse(raw) as Saved;
    } catch { /* storage unavailable or corrupt */ }
  }

  /** Seconds since the session began. */
  now(): number {
    return Math.round((performance.now() - this.t0) / 10) / 100;
  }

  log(level: Level, cat: string, msg: string, data?: unknown) {
    const key = `${level}|${cat}|${msg}`;
    const r = this.repeats.get(key), t = this.now();
    if (r && t - r.last < 10) { r.n++; r.last = t; this.count(`repeat:${cat}`); return; }
    if (r && r.n > 0) this.entries.push({ t, level, cat, msg: `(the previous message repeated ${r.n} more times)` });
    this.repeats.set(key, { n: 0, last: t });
    this.entries.push({ t, level, cat, msg, data: safe(data) });
    if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX);
    this.count(`${level}:${cat}`);
    this.dirty = true;
    if (level === 'error' || level === 'heal') this.persist();
  }

  event(cat: string, msg: string, data?: unknown) { this.log('event', cat, msg, data); }
  info(cat: string, msg: string, data?: unknown) { this.log('info', cat, msg, data); }
  warn(cat: string, msg: string, data?: unknown) { this.log('warn', cat, msg, data); }
  error(cat: string, msg: string, data?: unknown) { this.log('error', cat, msg, data); }
  heal(cat: string, msg: string, data?: unknown) { this.log('heal', cat, msg, data); }

  count(name: string, n = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + n);
  }

  /** Errors logged this session. */
  get errors(): number {
    let n = 0;
    for (const [k, v] of this.counters) if (k.startsWith('error:')) n += v;
    return n;
  }

  /** Catch what would otherwise only reach the browser console: uncaught errors, rejected promises, console errors. */
  install() {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    window.addEventListener('error', (e) => this.error('uncaught', e.message || String(e.error), { at: `${e.filename}:${e.lineno}:${e.colno}`, stack: stackOf(e.error) }));
    window.addEventListener('unhandledrejection', (e) => this.error('promise', String(e.reason?.message ?? e.reason), { stack: stackOf(e.reason) }));
    for (const lvl of ['error', 'warn'] as const) {
      const orig = console[lvl].bind(console);
      console[lvl] = (...args: unknown[]) => {
        orig(...args);
        // (WebGL driver chatter is noise, not our problem.)
        const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : '')).join(' ').slice(0, 300);
        if (/GL_|WebGL|THREE\.WebGLRenderer|Mismatch/.test(text)) return;
        this.log(lvl, 'console', text, args.find((a) => a instanceof Error) ? { stack: stackOf(args.find((a) => a instanceof Error)) } : undefined);
      };
    }
    window.addEventListener('pagehide', () => this.persist(true));
    setInterval(() => { if (this.dirty) this.persist(); }, 20000);
    const prev = this.previous;
    if (prev) {
      const errs = Object.entries(prev.counters).filter(([k]) => k.startsWith('error:')).reduce((a, [, v]) => a + v, 0);
      if (!prev.cleanExit) this.warn('session', 'The previous session ended unexpectedly (a crash, a frozen tab, or the tab was killed).', { previous: prev.id, started: prev.started });
      if (errs) this.warn('session', `The previous session logged ${errs} error(s). Its log is kept in the debug report.`);
    }
    this.info('session', 'Session started', { id: this.id, ua: navigator.userAgent, screen: `${screen.width}x${screen.height}@${devicePixelRatio}` });
  }

  /** Save the recent log (and whether this session ended cleanly) for the next session to read. */
  persist(cleanExit = false) {
    this.dirty = false;
    try {
      const s: Saved = { id: this.id, started: this.started, meta: this.meta, cleanExit, counters: Object.fromEntries(this.counters), entries: this.entries.slice(-KEEP) };
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch { /* storage full or unavailable */ }
  }

  /** Everything, for a bug report. */
  report(extra: Record<string, unknown> = {}) {
    return {
      kind: 'survivalcrafter-debug-report',
      made: new Date().toISOString(),
      session: { id: this.id, started: this.started, seconds: this.now(), errors: this.errors },
      meta: this.meta,
      ...extra,
      counters: Object.fromEntries([...this.counters].sort()),
      entries: this.entries,
      previousSession: this.previous,
    };
  }
}

function stackOf(e: unknown): string | undefined {
  return e instanceof Error && e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : undefined;
}

/** Keep logged data small and plain (no cycles, no huge objects). */
function safe(d: unknown): unknown {
  if (d === undefined) return undefined;
  try {
    const s = JSON.stringify(d, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v));
    return s && s.length > 2000 ? `${s.slice(0, 2000)}…` : JSON.parse(s ?? 'null');
  } catch {
    return String(d);
  }
}

export const telemetry = new Telemetry();
