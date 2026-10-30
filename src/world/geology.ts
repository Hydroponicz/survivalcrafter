import { hash2, mulberry32, Simplex } from './noise';

// Bedrock geology. The island sits on a granite basement under a stack of
// sedimentary beds (sandstone and shale) that dip gently one way and are
// folded a little, so the same band can be followed along a cliff or across
// a gully. Iron comes as ironstone: a seam near the base of some shale beds.

export const enum Rock { Granite, Sandstone, Shale, Ironstone }

/** Average thickness of one bed (metres). */
const BED = 5;

export class Strata {
  private fold: Simplex;
  private seam: Simplex;
  private dipX: number;
  private dipZ: number;
  private seed: number;

  constructor(seed: number) {
    const rand = mulberry32(seed ^ 0x6e01);
    this.fold = new Simplex(seed + 777);
    this.seam = new Simplex(seed + 778);
    const a = rand() * Math.PI * 2, dip = 0.01 + rand() * 0.025;
    this.dipX = Math.cos(a) * dip;
    this.dipZ = Math.sin(a) * dip;
    this.seed = seed;
  }

  /** How much the beds are pushed up or down at a column (the same all the way down). */
  foldAt(x: number, z: number): number {
    return x * this.dipX + z * this.dipZ + this.fold.fbm(x * 0.004, z * 0.004, 2) * 18;
  }

  /** Which rock is at a point; pass `fold` from foldAt() when sampling a whole column. */
  at(x: number, y: number, z: number, fold = this.foldAt(x, z)): Rock {
    // Bedding "height": tilted and folded, so beds rise and fall across the land.
    const v = y + fold;
    // Deep down is the granite basement.
    if (v < -20) return Rock.Granite;
    const L = Math.floor(v / BED);
    const r = hash2(L, 31, this.seed);
    const kind = r < 0.4 ? Rock.Granite : r < 0.68 ? Rock.Sandstone : Rock.Shale;
    if (kind === Rock.Shale && r > 0.82) {
      // Ironstone: the lower third of this shale bed, in lenses along it.
      const frac = v / BED - L;
      if (frac < 0.35 && this.seam.noise3(x * 0.04, y * 0.06, z * 0.04) > -0.1) return Rock.Ironstone;
    }
    return kind;
  }
}
