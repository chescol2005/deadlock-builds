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
// `applyCategorySplit` REDISTRIBUTES the need vector between the three
// families; the kit still decides the health / resist / shield ratio inside
// vitality. (Shred is a fixed fraction of damage in heroNeed.ts.)
//
// Per phase (coverage-model PR 2): `phaseView` picks the early / mid PURCHASE
// split or the final split by the build's souls, and `applyStatProfile` sets
// the five categories outside the families (antiHeal, mobility, sustain,
// utility, economy) from the phase's measured stat profile; the families fill
// the rest. Without phase data both fall back to the whole-game split and the
// kit's own values for those five.
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

/** Shares of the 12 score categories, summing to 1. */
export type StatProfile = Readonly<Record<ScoreCategory, number>>;

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
  /**
   * Per-phase data, when the table has it (coverage-model PR 2): the early and
   * mid purchase splits (the base gun/spirit/vitality fields are the late,
   * final-inventory split) and the measured stat profile for each phase.
   */
  phases?: {
    early: CategoryShares;
    mid: CategoryShares;
    profile: { early: StatProfile; mid: StatProfile; late: StatProfile };
  };
}

export type GamePhase = "early" | "mid" | "late";

/**
 * Cumulative souls at 10 and 20 minutes on the live mean net-worth curve
 * (/v1/analytics/player-performance-curve, all ranks, 2026-10-20; see
 * docs/starter-build-use-cases.md §2.1). They match the windows the phase data
 * is measured over: purchases in 0–10 min, in 10–20 min, and the final inventory.
 */
export const EARLY_PHASE_MAX_SOULS = 6950;
export const MID_PHASE_MAX_SOULS = 17550;

/** Which measured phase a basket at `souls` cumulative souls is shopping in. */
export function phaseForSouls(souls: number): GamePhase {
  if (souls <= EARLY_PHASE_MAX_SOULS) return "early";
  if (souls <= MID_PHASE_MAX_SOULS) return "mid";
  return "late";
}

/** The categories the kit cannot derive (stubbed or weak), set from the measured profile. */
export const PROFILE_CATEGORIES: ReadonlyArray<ScoreCategory> = [
  "antiHeal",
  "sustain",
  "utility",
  "economy",
  "mobility",
];

/** Floor on a profile category's share of the need, so none becomes unreachable. */
export const MIN_PROFILE_SHARE = 0.01;

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
  heroes: Record<
    string,
    {
      gun: number;
      spirit: number;
      vitality: number;
      matches: number;
      /**
       * Shares of item souls BOUGHT in 0–10 min / 10–20 min (Σ purchases × cost,
       * not net of sells: early buys that are later sold still are early buys).
       * Read by `phaseView` for the early / mid basket, and by the starter-build
       * fixtures' measured phase expectations (M1, docs/starter-build-use-cases.md
       * §4.3).
       */
      early?: CategoryShares;
      mid?: CategoryShares;
      /**
       * Measured STAT profile per phase: shares of the 12 score categories that
       * the phase's purchases (early, mid) or the final inventory (late)
       * covered. Gives the categories the kit cannot derive a measured weight.
       */
      profile?: { early: StatProfile; mid: StatProfile; late: StatProfile };
    }
  >;
}

/** Measured phase splits for one hero: early / mid purchases, late = final inventory. */
export interface HeroPhaseSplits {
  early: CategoryShares;
  mid: CategoryShares;
  late: CategoryShares;
}

function validShares(s: CategoryShares | undefined): CategoryShares | null {
  if (!s) return null;
  const total = s.gun + s.spirit + s.vitality;
  if (![s.gun, s.spirit, s.vitality].every((v) => Number.isFinite(v) && v >= 0) || !(total > 0)) {
    return null;
  }
  return { gun: s.gun / total, spirit: s.spirit / total, vitality: s.vitality / total };
}

/** All three measured phase splits for a hero, or null when any is missing. */
export function heroPhaseSplits(table: CategorySplitTable, heroId: number): HeroPhaseSplits | null {
  const row = table.heroes[String(heroId)];
  if (!row) return null;
  const early = validShares(row.early);
  const mid = validShares(row.mid);
  const late = validShares(row);
  return early && mid && late ? { early, mid, late } : null;
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
  const early = validShares(row.early);
  const mid = validShares(row.mid);
  const profile = row.profile;
  const profileOk =
    profile !== undefined &&
    (["early", "mid", "late"] as const).every((ph) => validProfile(profile[ph]));
  return {
    gun: gun / total,
    spirit: spirit / total,
    vitality: vitality / total,
    matches,
    scope: `${table.method.minRankName}+ players (last ${table.method.days} days)`,
    rankTier: Math.floor(table.method.minAverageBadge / 10),
    ...(early && mid && profileOk && profile ? { phases: { early, mid, profile } } : {}),
  };
}

/** True when `applyStatProfile` would apply this profile (it sets the five non-family categories). */
export function hasStatProfile(p: StatProfile | null | undefined): boolean {
  return validProfile(p ?? undefined);
}

function validProfile(p: StatProfile | undefined): boolean {
  if (!p) return false;
  const values = Object.values(p);
  return (
    values.length > 0 &&
    values.every((v) => Number.isFinite(v) && v >= 0) &&
    values.some((v) => v > 0)
  );
}

/**
 * The split and stat profile for the phase a basket is shopping in. Without
 * per-phase data: the whole-game split and no profile (the PR-1 behaviour).
 */
/** phaseView basis of the FINAL (whole-game, cumulative) split. */
export const FINAL_SPLIT_BASIS = "end games with";

export function phaseView(
  split: HeroCategorySplit,
  phase: GamePhase,
): { shares: CategoryShares; profile: StatProfile | null; basis: string } {
  const final = FINAL_SPLIT_BASIS;
  if (!split.phases) return { shares: split, profile: null, basis: final };
  const profile = split.phases.profile[phase];
  if (phase === "early")
    return { shares: split.phases.early, profile, basis: "buy in the first 10 minutes" };
  if (phase === "mid")
    return { shares: split.phases.mid, profile, basis: "buy from minute 10 to 20" };
  return { shares: split, profile, basis: final };
}

/**
 * Sets the categories the kit cannot derive (PROFILE_CATEGORIES) from the
 * measured stat profile, and rescales the rest (the gun / spirit / vitality
 * families, already balanced by `applyCategorySplit`) to fill the remainder:
 * - the need's total is kept;
 * - the profile categories together take the profile's share of the total,
 *   each in the profile's proportion, floored at MIN_PROFILE_SHARE;
 * - the other categories keep their ratios to one another.
 * Without a profile the need is returned unchanged.
 */
export function applyStatProfile(
  need: HeroNeedVector,
  profile: StatProfile | null | undefined,
): HeroNeedVector {
  if (!profile || !validProfile(profile)) return need;
  const cats = Object.keys(need) as ScoreCategory[];
  const total = cats.reduce((s, c) => s + Math.max(0, need[c]), 0);
  if (!(total > 0)) return need;
  const profileSum = cats.reduce((s, c) => s + Math.max(0, profile[c] ?? 0), 0);
  if (!(profileSum > 0)) return need;
  const isProfileCat = new Set(PROFILE_CATEGORIES);
  const shares = new Map<ScoreCategory, number>();
  for (const c of PROFILE_CATEGORIES) {
    shares.set(c, Math.max(MIN_PROFILE_SHARE, Math.max(0, profile[c] ?? 0) / profileSum));
  }
  const profileShare = Math.min(
    0.9,
    [...shares.values()].reduce((s, v) => s + v, 0),
  );
  const restTotal = cats
    .filter((c) => !isProfileCat.has(c))
    .reduce((s, c) => s + Math.max(0, need[c]), 0);
  // No family need to rescale: keep the need as is rather than shrink its total.
  if (!(restTotal > 0)) return need;
  const scale = (total * (1 - profileShare)) / restTotal;
  const shareSum = [...shares.values()].reduce((s, v) => s + v, 0);
  const out: Record<ScoreCategory, number> = { ...need };
  for (const c of cats) {
    out[c] = isProfileCat.has(c)
      ? (total * profileShare * (shares.get(c) ?? 0)) / shareSum
      : Math.max(0, need[c]) * scale;
  }
  return out;
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
