// lib/engine/categorySplit.ts — measured per-hero gun / spirit / vitality split.
//
// Why this exists: a hero's kit cannot tell archetypes apart. Nearly every
// ability scales off spirit, so the kit-derived spiritDamage need was the 2.00
// cap for 37 of 43 heroes, and spirit-scaling magnitude ranks Abrams (4.33)
// above Seven (2.03). High-rank purchase data separates them clearly: Haze ends
// games with 54% of item souls in gun and 15% in spirit, Kelvin with 3% / 72%,
// Abrams with 49% in vitality (data-verifier, Oracle+, 2026-10-20). See
// "Measured category split" in engine-design-notes.md.
//
// The split is a PRIOR on how much of the build each shop category deserves.
// What the kit still decides: the health / resist / shield ratio inside
// vitality, every category outside the three families (antiHeal, mobility,
// sustain, utility, economy), and the families' combined weight against those.
// (Shred is a fixed fraction of damage in heroNeed.ts, so the kit does not
// decide it either way.) `applyCategorySplit` only REDISTRIBUTES the need
// vector between the three families.
//
// The split is measured at Oracle+, where players land more shots. So the gun
// share is scaled by the hero's accuracy at the player's rank relative to
// Oracle+ (`adjustSplitForAccuracy`, applied in runHeroBasket) before it is
// used: the rank selector still moves gun vs spirit/vitality, as it did before.
//
// The table is GENERATED offline by `npm run fit-category-split`
// (src/scripts/fitCategorySplit.ts), committed, and sliced per hero on the
// server, exactly like the pair-lift table. Pure: nothing here fetches.

import type { HeroNeedVector, ScoreCategory } from "./types";

export interface CategoryShares {
  /** Fractions of final-inventory item souls, summing to 1. */
  gun: number;
  spirit: number;
  vitality: number;
}

export interface HeroCategorySplit extends CategoryShares {
  /** Matches behind the measurement. */
  matches: number;
  /** Human-readable scope, e.g. "Oracle+ players (last 30 days)". */
  scope: string;
  /** Rank tier the split was measured at (minAverageBadge / 10, e.g. 8 = Oracle). */
  rankTier: number;
}

export interface CategorySplitTable {
  version: 1;
  generated: string;
  window: { from: string; to: string };
  method: {
    minAverageBadge: number;
    minRankName: string;
    days: number;
    minMatches: number;
    measure: string;
  };
  heroes: Record<string, { gun: number; spirit: number; vitality: number; matches: number }>;
}

/**
 * Which need-vector categories each shop-category family scales. Categories not
 * listed (antiHeal, mobility, sustain, utility, economy) are left untouched:
 * they are bought from every shop category, so a shop split says nothing about
 * them.
 */
export const CATEGORY_FAMILIES: Readonly<
  Record<keyof CategoryShares, ReadonlyArray<ScoreCategory>>
> = {
  gun: ["gunDamage", "gunShred"],
  spirit: ["spiritDamage", "spiritShred"],
  vitality: ["bonusHealth", "resist", "shield"],
};

/**
 * Floor on any family's measured share before it is applied. Same hazard as
 * MIN_GUN_FACTOR in heroNeed.ts: a family that gets zero target is UNREACHABLE
 * (zero target → zero coverage gain → dropped by the relevance gate), and every
 * hero can still use some of each. Mo & Krill end games with 0.6% gun.
 */
export const MIN_FAMILY_SHARE = 0.08;

/** This hero's measured split, or null when the table has none (thin data). */
export function heroCategorySplit(
  table: CategorySplitTable,
  heroId: number,
): HeroCategorySplit | null {
  const row = table.heroes[String(heroId)];
  if (!row) return null;
  const { gun, spirit, vitality, matches } = row;
  const total = gun + spirit + vitality;
  if (![gun, spirit, vitality, total].every((v) => Number.isFinite(v) && v >= 0) || total <= 0) {
    return null;
  }
  return {
    gun: gun / total,
    spirit: spirit / total,
    vitality: vitality / total,
    matches,
    scope: `${table.method.minRankName}+ players (last ${table.method.days} days)`,
    rankTier: Math.floor(table.method.minAverageBadge / 10),
  };
}

/**
 * Shares with every family floored at MIN_FAMILY_SHARE, then renormalized to
 * sum 1 (so a floored family can end slightly under the floor, e.g. 0.075).
 * Null when any share is not a finite non-negative number, so a bad input is
 * "no split", never a zero.
 */
export function flooredShares(shares: CategoryShares): CategoryShares | null {
  const raw = [shares.gun, shares.spirit, shares.vitality];
  if (!raw.every((v) => Number.isFinite(v) && v >= 0)) return null;
  const floored = {
    gun: Math.max(MIN_FAMILY_SHARE, shares.gun),
    spirit: Math.max(MIN_FAMILY_SHARE, shares.spirit),
    vitality: Math.max(MIN_FAMILY_SHARE, shares.vitality),
  };
  const total = floored.gun + floored.spirit + floored.vitality;
  return {
    gun: floored.gun / total,
    spirit: floored.spirit / total,
    vitality: floored.vitality / total,
  };
}

/**
 * Redistributes the kit-derived need vector between the gun / spirit / vitality
 * families so their totals follow the measured split, keeping:
 * - the combined total of the three families (so the families' weight against
 *   the untouched categories is unchanged),
 * - every ratio inside a family (health vs resist vs shield, damage vs shred),
 * - every other category exactly.
 *
 * A family whose kit total is 0 cannot be scaled (no ratio to keep), so its
 * desired share is spread evenly over its categories. Without a split the
 * vector is returned unchanged.
 */
export function applyCategorySplit(
  need: HeroNeedVector,
  split: CategoryShares | null | undefined,
): HeroNeedVector {
  const shares = split ? flooredShares(split) : null;
  if (!shares) return need;
  const families = Object.keys(CATEGORY_FAMILIES) as Array<keyof CategoryShares>;

  const familyTotal = (f: keyof CategoryShares) =>
    CATEGORY_FAMILIES[f].reduce((s, cat) => s + Math.max(0, need[cat]), 0);
  const combined = families.reduce((s, f) => s + familyTotal(f), 0);
  if (!(combined > 0)) return need;

  const out: Record<ScoreCategory, number> = { ...need };
  for (const f of families) {
    const desired = combined * shares[f];
    const current = familyTotal(f);
    const cats = CATEGORY_FAMILIES[f];
    for (const cat of cats) {
      out[cat] = current > 0 ? (Math.max(0, need[cat]) / current) * desired : desired / cats.length;
    }
  }
  return out;
}

/** Bounds on the accuracy ratio, so a thin accuracy row cannot swing the split far. */
export const MIN_ACCURACY_RATIO = 0.5;
export const MAX_ACCURACY_RATIO = 1.5;

/**
 * Scales the gun share by `accuracyRatio` (the hero's shot accuracy at the
 * player's rank ÷ at the split's rank, Oracle+) and renormalizes. Gun items are
 * worth less to a player who lands fewer shots, which is the effect the
 * kit-derived gun need had before the split replaced the family balance.
 * A non-finite or non-positive ratio means "unknown" and leaves the split as is.
 */
export function adjustSplitForAccuracy<T extends CategoryShares>(
  split: T,
  accuracyRatio: number,
): T {
  if (!(Number.isFinite(accuracyRatio) && accuracyRatio > 0)) return split;
  const r = Math.min(MAX_ACCURACY_RATIO, Math.max(MIN_ACCURACY_RATIO, accuracyRatio));
  const gun = split.gun * r;
  const total = gun + split.spirit + split.vitality;
  if (!(total > 0)) return split;
  return {
    ...split,
    gun: gun / total,
    spirit: split.spirit / total,
    vitality: split.vitality / total,
  };
}
