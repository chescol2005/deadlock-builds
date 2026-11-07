// Hero roster profile (Milestone O): every hero's metrics ranked against the
// filtered roster, plus the late-game lean. Pure and deterministic; display
// only, never an input to scoring (docs/milestone-o.md §8).

import type { HeroAccuracy } from "@/lib/analyticsStore";
import type { HeroBaseStats } from "@/lib/heroStats";
import type { AbilityT3 } from "./abilities";
import { accuracyAtRank } from "./accuracy";
import { EVAL_BOON, HERO_METRICS, type HeroMetricId } from "./metrics";
import { percentileRanks, type MetricRank } from "./percentiles";

export type HeroMetricResult = {
  /** The value at EVAL_BOON, ranked. Null = unknown for this hero. */
  value: number | null;
  /** The value at boon 0, for context. Not ranked. */
  boon0: number | null;
  rank: MetricRank | null;
};

export type HeroProfile = {
  heroId: number;
  /** Gun accuracy used for rank-aware metrics; null = no roster data at all. */
  accuracy: number | null;
  /** True when this hero had no accuracy data and got the roster median. */
  accuracyEstimated: boolean;
  metrics: Record<HeroMetricId, HeroMetricResult>;
  /** §4.1, from landed DPS and short-fight kit spirit scaling. Null = a lead is unknown. */
  lean: LateGameLean | null;
  /**
   * "Scales into long fights": the long-fight kit spirit percentile is at least
   * LONG_FIGHT_NOTE_DELTA above the short-fight one (§3.2).
   */
  scalesIntoLongFights: boolean;
};

export type RosterProfileInput = {
  /** The filtered roster (fetchVisibleHeroes), one entry per hero. */
  roster: ReadonlyArray<HeroBaseStats>;
  accuracy: ReadonlyMap<number, HeroAccuracy>;
  /** Rank tier for accuracy; null = all ranks pooled. */
  rankTier: number | null;
  /** Each hero's kit at T3 (kitAtT3), by hero id. A hero without one has unknown kit metrics. */
  kits?: ReadonlyMap<number, ReadonlyArray<AbilityT3>>;
};

/** Percentile points the long-fight kit rank must gain for the long-fight note (§3.2). */
export const LONG_FIGHT_NOTE_DELTA = 15;

/** Ranks every roster hero on every §3.1 metric. Keyed by hero id. */
export function rankRoster(input: RosterProfileInput): Map<number, HeroProfile> {
  const heroIds = input.roster.map((s) => s.heroId);
  const accuracy = accuracyAtRank(input.accuracy, heroIds, input.rankTier);

  const values = new Map<HeroMetricId, Map<number, { now: number | null; boon0: number | null }>>();
  for (const def of HERO_METRICS) {
    const perHero = new Map<number, { now: number | null; boon0: number | null }>();
    for (const stats of input.roster) {
      const metricInput = {
        stats,
        accuracy: accuracy.get(stats.heroId)?.accuracy ?? null,
        kit: input.kits?.get(stats.heroId) ?? null,
      };
      perHero.set(stats.heroId, {
        now: def.value(metricInput, EVAL_BOON),
        boon0: def.value(metricInput, 0),
      });
    }
    values.set(def.id, perHero);
  }

  const ranks = new Map<HeroMetricId, Map<number, MetricRank | null>>();
  for (const def of HERO_METRICS) {
    const perHero = values.get(def.id);
    const entries = heroIds.map((key) => ({ key, value: perHero?.get(key)?.now ?? null }));
    ranks.set(def.id, percentileRanks(entries, def.direction));
  }

  const out = new Map<number, HeroProfile>();
  for (const heroId of heroIds) {
    const metrics = {} as Record<HeroMetricId, HeroMetricResult>;
    for (const def of HERO_METRICS) {
      const v = values.get(def.id)?.get(heroId);
      metrics[def.id] = {
        value: v?.now ?? null,
        boon0: v?.boon0 ?? null,
        rank: ranks.get(def.id)?.get(heroId) ?? null,
      };
    }
    const acc = accuracy.get(heroId);
    const spiritShort = metrics.kitSpiritShort.rank?.percentile ?? null;
    const spiritLong = metrics.kitSpiritLong.rank?.percentile ?? null;
    out.set(heroId, {
      heroId,
      accuracy: acc?.accuracy ?? null,
      accuracyEstimated: acc?.estimated ?? false,
      metrics,
      lean: lateGameLean(metrics.landedDps.rank?.percentile ?? null, spiritShort),
      scalesIntoLongFights:
        spiritShort != null &&
        spiritLong != null &&
        spiritLong - spiritShort >= LONG_FIGHT_NOTE_DELTA,
    });
  }
  return out;
}

// ─── Late-game lean (§4.1): fixed rules, no AI ──────────────────────────────

/** A lead percentile at or above this is strong. Approved 2026-11-06. */
export const LEAN_STRONG = 65;
/** A lead percentile below this is weak. Approved 2026-11-06. */
export const LEAN_WEAK = 50;

export type LateGameLean = "gun" | "spirit" | "hybrid" | "flexible";

/**
 * From the gun lead (landed DPS at the selected rank) and spirit lead (short-
 * fight kit spirit scaling) percentiles. Null when either is unknown: no lean
 * is shown rather than a guessed one.
 */
export function lateGameLean(gun: number | null, spirit: number | null): LateGameLean | null {
  if (gun == null || spirit == null) return null;
  if (gun >= LEAN_STRONG && spirit >= LEAN_STRONG) return "hybrid";
  if (gun >= LEAN_STRONG && spirit < LEAN_WEAK) return "gun";
  if (spirit >= LEAN_STRONG && gun < LEAN_WEAK) return "spirit";
  return "flexible";
}
