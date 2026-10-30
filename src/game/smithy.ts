import type { StructureObj } from '../world/world';
import type { Smithy } from './game';

/** Seconds a freshly forged tool stays hot enough to quench. */
export const HOT_TIME = 90;

// How smithy equipment helps the work. Each piece's grade (0..1) comes from
// its quality; an iron anvil starts well above any stone one.

/** 0..1: how forgiving an anvil is to strike on. */
export function anvilGrade(a: StructureObj): number {
  return a.type === 'iron_anvil' ? 0.45 + 0.55 * (a.ql / 100) : 0.1 + 0.35 * (a.ql / 100);
}

/** 0..1: how hard and steadily bellows blow. */
export function bellowsGrade(b: StructureObj): number {
  return 0.2 + 0.8 * (b.ql / 100);
}

/** Best quality you can smelt or forge with this equipment. */
export function smithyCap(s: Smithy, anvil: boolean): number {
  const heat = s.bellows ? 25 + 0.85 * s.bellows.ql : 0;
  if (!anvil) return heat;
  const face = s.anvil ? (s.anvil.type === 'iron_anvil' ? 35 + 0.7 * s.anvil.ql : 15 + 0.45 * s.anvil.ql) : 0;
  return Math.min(heat, face);
}
