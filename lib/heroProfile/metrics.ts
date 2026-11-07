// Hero metrics for the roster profile (Milestone O §3.1). One pure function per
// metric. Each takes the hero's base stats, its accuracy at the selected rank,
// and a boon count, and returns null when the data needed is missing:
// unknown is never 0.

import { calculateStatsAtBoon, heroResistAtBoon, type HeroBaseStats } from "@/lib/heroStats";
import type { Direction } from "./percentiles";

/** Late game: about 30,000 souls spent is boon 30 (BOON_THRESHOLDS). */
export const EVAL_BOON = 30;

export type MetricGroup = "gun" | "melee" | "vitality" | "spirit";

export type HeroMetricInput = {
  stats: HeroBaseStats;
  /** Share of shots that land at the selected rank, 0-1; null = no data. */
  accuracy: number | null;
};

export type HeroMetricDef = {
  id: HeroMetricId;
  group: MetricGroup;
  label: string;
  direction: Direction;
  /** The group's headline metric. */
  lead: boolean;
  /** Changes with the selected rank (uses accuracy). */
  rankAware: boolean;
  value: (input: HeroMetricInput, boon: number) => number | null;
};

const positive = (v: number): number | null => (v > 0 && Number.isFinite(v) ? v : null);
const nonNegative = (v: number): number | null => (v >= 0 && Number.isFinite(v) ? v : null);

/**
 * Valve's sustained DPS (reload included) at `boon`. Boon growth scales
 * per-bullet damage, so the reload uptime ratio in dpsWithReload carries over.
 * dpsWithReload 0 means no weapon data: unknown.
 */
export function sustainedDps(stats: HeroBaseStats, boon: number): number | null {
  if (!(stats.dpsWithReload > 0) || !(stats.bulletDamage > 0)) return null;
  const atBoon = calculateStatsAtBoon(stats, boon);
  return positive((stats.dpsWithReload * atBoon.bulletDamage) / stats.bulletDamage);
}

/** Sustained DPS x the share of shots that land. */
export function landedDps(input: HeroMetricInput, boon: number): number | null {
  const dps = sustainedDps(input.stats, boon);
  return dps != null && input.accuracy != null && input.accuracy > 0 ? dps * input.accuracy : null;
}

/** Spirit power from boons alone (items are not counted; base spirit power is 0). */
function boonSpiritPower(stats: HeroBaseStats, boon: number): number {
  return calculateStatsAtBoon(stats, boon).spiritPower;
}

function resistAt(stats: HeroBaseStats, boon: number) {
  return heroResistAtBoon(stats, boon, boonSpiritPower(stats, boon));
}

/** Health / (1 - resist): the raw damage it takes to kill the hero. */
function effectiveHp(health: number, resistPoints: number): number | null {
  const share = resistPoints / 100;
  return share < 1 ? positive(health / (1 - share)) : null;
}

function maxHealthAt(stats: HeroBaseStats, boon: number): number | null {
  return stats.maxHealth > 0 ? positive(calculateStatsAtBoon(stats, boon).maxHealth) : null;
}

export type HeroMetricId =
  | "landedDps"
  | "sustainedDps"
  | "damagePerBullet"
  | "fireRate"
  | "clipSize"
  | "reloadTime"
  | "gunGrowth"
  | "lightMelee"
  | "heavyMelee"
  | "maxHealth"
  | "bulletResist"
  | "spiritResist"
  | "ehpBullet"
  | "ehpSpirit"
  | "healthRegen"
  | "moveSpeed"
  | "boonSpiritPower";

/**
 * The §3.1 metric table, in display order. Kit spirit and weapon scaling join
 * in O.3, once ability values at T3 and cast gates exist.
 */
export const HERO_METRICS: ReadonlyArray<HeroMetricDef> = [
  {
    id: "landedDps",
    group: "gun",
    label: "Landed DPS",
    direction: "higher",
    lead: true,
    rankAware: true,
    value: landedDps,
  },
  {
    id: "sustainedDps",
    group: "gun",
    label: "Sustained DPS (on paper)",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) => sustainedDps(stats, b),
  },
  {
    id: "damagePerBullet",
    group: "gun",
    label: "Damage per bullet",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) =>
      stats.bulletDamage > 0 ? positive(calculateStatsAtBoon(stats, b).bulletDamage) : null,
  },
  {
    id: "fireRate",
    group: "gun",
    label: "Fire rate",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }) => positive(stats.bulletsPerSecond),
  },
  {
    id: "clipSize",
    group: "gun",
    label: "Clip size",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }) => positive(stats.ammo),
  },
  {
    id: "reloadTime",
    group: "gun",
    label: "Reload time",
    direction: "lower",
    lead: false,
    rankAware: false,
    value: ({ stats }) => positive(stats.reloadTime),
  },
  {
    id: "gunGrowth",
    group: "gun",
    label: "Gun growth from boons",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) => {
      const atBoon = sustainedDps(stats, b);
      const atZero = sustainedDps(stats, 0);
      return atBoon != null && atZero != null ? atBoon / atZero - 1 : null;
    },
  },
  {
    id: "lightMelee",
    group: "melee",
    label: "Light melee",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) =>
      stats.lightMeleeDamage > 0 ? positive(calculateStatsAtBoon(stats, b).lightMeleeDamage) : null,
  },
  {
    id: "heavyMelee",
    group: "melee",
    label: "Heavy melee",
    direction: "higher",
    lead: true,
    rankAware: false,
    value: ({ stats }, b) =>
      stats.heavyMeleeDamage > 0 ? positive(calculateStatsAtBoon(stats, b).heavyMeleeDamage) : null,
  },
  {
    id: "maxHealth",
    group: "vitality",
    label: "Max health",
    direction: "higher",
    lead: true,
    rankAware: false,
    value: ({ stats }, b) => maxHealthAt(stats, b),
  },
  {
    id: "bulletResist",
    group: "vitality",
    label: "Bullet resist",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) => resistAt(stats, b).bullet,
  },
  {
    id: "spiritResist",
    group: "vitality",
    label: "Spirit resist",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) => resistAt(stats, b).spirit,
  },
  {
    id: "ehpBullet",
    group: "vitality",
    label: "Effective HP vs bullets",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) => {
      const hp = maxHealthAt(stats, b);
      return hp != null ? effectiveHp(hp, resistAt(stats, b).bullet) : null;
    },
  },
  {
    id: "ehpSpirit",
    group: "vitality",
    label: "Effective HP vs spirit",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) => {
      const hp = maxHealthAt(stats, b);
      return hp != null ? effectiveHp(hp, resistAt(stats, b).spirit) : null;
    },
  },
  {
    id: "healthRegen",
    group: "vitality",
    label: "Health regen",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }) => nonNegative(stats.healthRegen),
  },
  {
    id: "moveSpeed",
    group: "vitality",
    label: "Move speed",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }) => positive(stats.moveSpeed),
  },
  {
    id: "boonSpiritPower",
    group: "spirit",
    label: "Spirit power from boons",
    direction: "higher",
    // The spirit lead is kit spirit scaling (§3.1), which lands in O.3.
    lead: false,
    rankAware: false,
    value: ({ stats }, b) => nonNegative(boonSpiritPower(stats, b)),
  },
];
