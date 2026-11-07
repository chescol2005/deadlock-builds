// Rank-aware gun accuracy for the roster profile (Milestone O §3.4).
//
// Reuses the engine's resolveAccuracyAtRank unchanged: a rank tier below the
// shot minimum falls back to the hero's pooled accuracy. On top of that, a hero
// with no accuracy data at all (Graves, live 2026-11-06) gets the lower median
// of the roster at the same rank, flagged as estimated.

import { resolveAccuracyAtRank, type HeroAccuracy } from "@/lib/analyticsStore";
import { lowerMedian } from "./percentiles";

export type ProfileAccuracy = {
  /** Share of shots that land, 0-1. */
  accuracy: number;
  /** True when the hero had no data and this is the roster median. */
  estimated: boolean;
};

/**
 * Accuracy for each hero in `heroIds` at `rankTier` (null = all ranks pooled).
 * Heroes are absent from the result only when no roster hero has any data.
 */
export function accuracyAtRank(
  accuracy: ReadonlyMap<number, HeroAccuracy>,
  heroIds: ReadonlyArray<number>,
  rankTier: number | null,
): Map<number, ProfileAccuracy> {
  const resolved = resolveAccuracyAtRank(accuracy, rankTier);
  const median = lowerMedian(heroIds.map((id) => resolved.get(id) ?? null));

  const out = new Map<number, ProfileAccuracy>();
  for (const id of heroIds) {
    const own = resolved.get(id);
    if (own != null) out.set(id, { accuracy: own, estimated: false });
    else if (median != null) out.set(id, { accuracy: median, estimated: true });
  }
  return out;
}
