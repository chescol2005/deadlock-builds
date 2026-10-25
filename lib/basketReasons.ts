// lib/basketReasons.ts — which of a basket pick's reasons to headline. Shared by
// HeroBasketSuggestion and StarterBuildPanel so both explain picks the same way.

import type { MarginalTerm } from "./engine/types";

// Terms that report what OTHER players do (population data). They stay visible
// in the advanced breakdown, but the simplified view's single headline reason is
// always about this hero and this build, never "because others buy it".
export const POPULATION_TERMS: ReadonlySet<string> = new Set([
  "category-split",
  "analytics",
  "phase-item",
]);

/** The headline sentence for a pick: the term's plain-English line, else its exact reason. */
export function headlineReason(terms: ReadonlyArray<MarginalTerm>): string | null {
  const top = headlineTerm(terms);
  return top ? (top.plain ?? top.reason) : null;
}

// Bookkeeping notes with no value of their own (a pick bought from the pooled
// shop budget): shown in the breakdown, never a reason to buy.
const NOTE_TERMS: ReadonlySet<string> = new Set(["shop-budget"]);

/**
 * The highest-value positive term that is not population data (population data
 * only when nothing else is positive). Null when no term argues FOR the pick.
 */
export function headlineTerm(terms: ReadonlyArray<MarginalTerm>): MarginalTerm | null {
  const positive = terms.filter((t) => t.value > 0 && !NOTE_TERMS.has(t.termId));
  const own = positive.filter((t) => !POPULATION_TERMS.has(t.termId));
  const pool = own.length > 0 ? own : positive;
  if (pool.length === 0) return null;
  return pool.reduce((best, t) => (t.value > best.value ? t : best), pool[0]);
}
