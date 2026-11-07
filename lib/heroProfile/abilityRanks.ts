// Every damaging ability in the filtered roster, ranked at T3 (Milestone O §3.5).
// Spirit- and weapon-scaled abilities rank in separate pools (different units);
// base damage per cast ranks across every damaging ability. Pure and
// deterministic: the same kits in any order give the same output.

import type { HeroAccuracy } from "@/lib/analyticsStore";
import type { HeroBaseStats } from "@/lib/heroStats";
import { accuracyAtRank } from "./accuracy";
import {
  castsInFight,
  channelSeconds,
  scalingCoefficient,
  type AbilityT3,
  type CastContext,
} from "./abilities";
import { cdrImpact, CDR_SPOTLIGHT_PERCENTILE, type CdrImpact, type CdrSetup } from "./cdr";
import { FIGHT_LENGTHS, type FightLength } from "./fight";
import { percentileRanks, type MetricRank } from "./percentiles";

export type AbilityMetricId =
  | "scalingPerCast"
  | "scalingShort"
  | "scalingLong"
  | "baseDamagePerCast";

export const ABILITY_METRIC_IDS: ReadonlyArray<AbilityMetricId> = [
  "scalingPerCast",
  "scalingShort",
  "scalingLong",
  "baseDamagePerCast",
];

export type AbilityMetricResult = { value: number | null; rank: MetricRank | null };

export type AbilityProfile = {
  ability: AbilityT3;
  /** Avg casts per fight (cast-equivalents for a channel); null = unknown. */
  casts: Record<FightLength, number | null>;
  /** Channel gate only: seconds of damage per fight. */
  damageSeconds: Record<FightLength, number> | null;
  metrics: Record<AbilityMetricId, AbilityMetricResult>;
  /** CDR annotation (§3.3): set only for spotlight abilities. Never changes a rank. */
  cdr: CdrImpact | null;
};

export type RosterKit = {
  heroId: number;
  stats: HeroBaseStats;
  abilities: ReadonlyArray<AbilityT3>;
};

export type RankAbilitiesInput = {
  kits: ReadonlyArray<RosterKit>;
  accuracy: ReadonlyMap<number, HeroAccuracy>;
  /** Rank tier for accuracy (Card Trick's cards); null = all ranks pooled. */
  rankTier: number | null;
  /** The live CDR ladder (cdrLadder()); empty = no annotations. */
  cdrSetups: ReadonlyArray<CdrSetup>;
};

/** Ranks every ability of every kit. Keyed by ability class name. */
export function rankAbilities(input: RankAbilitiesInput): Map<string, AbilityProfile> {
  const accuracy = accuracyAtRank(
    input.accuracy,
    input.kits.map((k) => k.heroId),
    input.rankTier,
  );
  const rows: Array<{
    ability: AbilityT3;
    ctx: CastContext;
    casts: Record<FightLength, number | null>;
    values: Record<AbilityMetricId, number | null>;
  }> = [];

  for (const kit of input.kits) {
    const ctx: CastContext = {
      accuracy: accuracy.get(kit.heroId)?.accuracy ?? null,
      bulletsPerSecond: kit.stats.bulletsPerSecond,
    };
    for (const ability of kit.abilities) {
      const casts = {
        short: castsInFight(ability, FIGHT_LENGTHS.short, ctx),
        long: castsInFight(ability, FIGHT_LENGTHS.long, ctx),
      };
      const coef = scalingCoefficient(ability);
      const perCast = coef != null ? coef * ability.perCastFactor : null;
      rows.push({
        ability,
        ctx,
        casts,
        values: {
          scalingPerCast: perCast,
          scalingShort: perCast != null && casts.short != null ? perCast * casts.short : null,
          scalingLong: perCast != null && casts.long != null ? perCast * casts.long : null,
          baseDamagePerCast:
            ability.pool !== "utility" && ability.baseDamage > 0
              ? ability.baseDamage * ability.perCastFactor
              : null,
        },
      });
    }
  }

  // Scaling metrics rank within the ability's own pool; base damage across all.
  const ranks = new Map<AbilityMetricId, Map<string, MetricRank | null>>();
  for (const id of ABILITY_METRIC_IDS) {
    const merged = new Map<string, MetricRank | null>();
    const pools: ReadonlyArray<ReadonlyArray<AbilityT3["pool"]>> =
      id === "baseDamagePerCast" ? [["spirit", "weapon", "unscaled"]] : [["spirit"], ["weapon"]];
    for (const pool of pools) {
      const entries = rows
        .filter((r) => pool.includes(r.ability.pool))
        .map((r) => ({ key: r.ability.classname, value: r.values[id] }));
      for (const [k, v] of percentileRanks(entries, "higher")) merged.set(k, v);
    }
    ranks.set(id, merged);
  }

  const out = new Map<string, AbilityProfile>();
  for (const row of [...rows].sort((a, b) =>
    a.ability.classname.localeCompare(b.ability.classname),
  )) {
    const key = row.ability.classname;
    const metrics = {} as Record<AbilityMetricId, AbilityMetricResult>;
    for (const id of ABILITY_METRIC_IDS) {
      metrics[id] = { value: row.values[id], rank: ranks.get(id)?.get(key) ?? null };
    }
    const spotlight = (metrics.scalingPerCast.rank?.percentile ?? -1) >= CDR_SPOTLIGHT_PERCENTILE;
    const gate = row.ability.gate;
    out.set(key, {
      ability: row.ability,
      casts: row.casts,
      damageSeconds:
        gate.kind === "channel"
          ? {
              short: channelSeconds(gate, FIGHT_LENGTHS.short),
              long: channelSeconds(gate, FIGHT_LENGTHS.long),
            }
          : null,
      metrics,
      cdr:
        spotlight && input.cdrSetups.length > 0
          ? cdrImpact(row.ability, row.ctx, input.cdrSetups)
          : null,
    });
  }
  return out;
}
