// One hero's roster profile as plain, serializable data for the hero page
// (Milestone O.4). Pure: built from rankRoster / rankAbilities output, so the
// server computes it and the client section only renders.

import type { AbilityPool, CastGate } from "./abilities";
import type { AbilityProfile } from "./abilityRanks";
import type { CdrSetup } from "./cdr";
import type { FightLength } from "./fight";
import { EVAL_BOON, HERO_METRICS, type HeroMetricId, type MetricGroup } from "./metrics";
import type { HeroProfile, LateGameLean } from "./profile";

export type RankCell = { rank: number; n: number; percentile: number | null };

export type MetricRow = {
  id: HeroMetricId;
  label: string;
  group: MetricGroup;
  lead: boolean;
  rankAware: boolean;
  value: number | null;
  boon0: number | null;
  rank: RankCell | null;
};

export type CdrRow = {
  setupId: string;
  label: string;
  souls: number;
  thisAbilityOnly: boolean;
  casts: Record<FightLength, number>;
  gain: Record<FightLength, number>;
  best: Record<FightLength, boolean>;
};

export type AbilityRow = {
  classname: string;
  name: string;
  isUltimate: boolean;
  pool: AbilityPool;
  gate: CastGate["kind"];
  casts: Record<FightLength, number | null>;
  /** Channel only: seconds of damage per fight. */
  damageSeconds: Record<FightLength, number> | null;
  scalingPerCast: number | null;
  scalingPerCastRank: RankCell | null;
  scaling: Record<FightLength, number | null>;
  scalingRank: Record<FightLength, RankCell | null>;
  baseDamagePerCast: number | null;
  baseDamageRank: RankCell | null;
  /** Empty unless the ability is in the CDR spotlight (§3.3). */
  cdr: CdrRow[];
  /** Resource gate only: extra throws per fight from +10% fire rate. */
  fireRateStep: Record<FightLength, number> | null;
};

export type HeroRankView = {
  heroId: number;
  evalBoon: number;
  rosterSize: number;
  rankTier: number | null;
  accuracy: number | null;
  accuracyEstimated: boolean;
  lean: LateGameLean | null;
  scalesIntoLongFights: boolean;
  metrics: MetricRow[];
  abilities: AbilityRow[];
};

const cell = (r: RankCell | null | undefined): RankCell | null =>
  r ? { rank: r.rank, n: r.n, percentile: r.percentile } : null;

/**
 * The view for `heroId`, or null when the hero isn't in the ranked roster.
 * Metrics follow HERO_METRICS order; abilities follow the hero's slot order.
 */
export function heroRankView(input: {
  heroId: number;
  profiles: ReadonlyMap<number, HeroProfile>;
  abilities: ReadonlyMap<string, AbilityProfile>;
  /** The hero's ability class names in slot order. */
  abilityOrder: ReadonlyArray<string>;
  cdrSetups: ReadonlyArray<CdrSetup>;
  rankTier: number | null;
}): HeroRankView | null {
  const profile = input.profiles.get(input.heroId);
  if (!profile) return null;

  const metrics: MetricRow[] = HERO_METRICS.map((def) => {
    const m = profile.metrics[def.id];
    return {
      id: def.id,
      label: def.label,
      group: def.group,
      lead: def.lead,
      rankAware: def.rankAware,
      value: m.value,
      boon0: m.boon0,
      rank: cell(m.rank),
    };
  });

  const setupById = new Map(input.cdrSetups.map((s) => [s.id, s]));
  const abilities: AbilityRow[] = input.abilityOrder.flatMap((classname) => {
    const p = input.abilities.get(classname);
    if (!p) return [];
    const cdr: CdrRow[] = [];
    if (p.cdr) {
      for (const [i, shortRow] of p.cdr.fights.short.setups.entries()) {
        const longRow = p.cdr.fights.long.setups[i];
        const setup = setupById.get(shortRow.setupId);
        if (!setup || !longRow) continue;
        cdr.push({
          setupId: setup.id,
          label: setup.label,
          souls: setup.souls,
          thisAbilityOnly: setup.thisAbilityOnly,
          casts: { short: shortRow.casts, long: longRow.casts },
          gain: { short: shortRow.gain, long: longRow.gain },
          best: { short: shortRow.best, long: longRow.best },
        });
      }
    }
    return [
      {
        classname,
        name: p.ability.name,
        isUltimate: p.ability.isUltimate,
        pool: p.ability.pool,
        gate: p.ability.gate.kind,
        casts: p.casts,
        damageSeconds: p.damageSeconds,
        scalingPerCast: p.metrics.scalingPerCast.value,
        scalingPerCastRank: cell(p.metrics.scalingPerCast.rank),
        scaling: { short: p.metrics.scalingShort.value, long: p.metrics.scalingLong.value },
        scalingRank: {
          short: cell(p.metrics.scalingShort.rank),
          long: cell(p.metrics.scalingLong.rank),
        },
        baseDamagePerCast: p.metrics.baseDamagePerCast.value,
        baseDamageRank: cell(p.metrics.baseDamagePerCast.rank),
        cdr,
        fireRateStep: p.cdr?.fireRateStep ?? null,
      },
    ];
  });

  return {
    heroId: input.heroId,
    evalBoon: EVAL_BOON,
    rosterSize: input.profiles.size,
    rankTier: input.rankTier,
    accuracy: profile.accuracy,
    accuracyEstimated: profile.accuracyEstimated,
    lean: profile.lean,
    scalesIntoLongFights: profile.scalesIntoLongFights,
    metrics,
    abilities,
  };
}

/** `?rank=` -> a tier in `validTiers`, else null (All ranks). */
export function parseRankParam(
  raw: string | string[] | undefined,
  validTiers: ReadonlyArray<number>,
): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || !/^[0-9]+$/.test(value)) return null;
  const tier = Number(value);
  return validTiers.includes(tier) ? tier : null;
}
