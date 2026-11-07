// Hero metrics for the roster profile (Milestone O §3.1). One pure function per
// metric. Each takes the hero's base stats, its accuracy at the selected rank,
// and a boon count, and returns null when the data needed is missing:
// unknown is never 0.

import {
  calculateStatsAtBoon,
  healthRegenAt,
  heroResistAtBoon,
  type HeroBaseStats,
} from "@/lib/heroStats";
import { sustainedGunDps, type GunProfile } from "@/lib/engine/heroDamage";
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
 * The hero's gun at `boon`, with spirit-scaled gun stats applied at boon spirit
 * power (§2.2.1: Solomon damage, Haze clip, Warden fire rate). Null when the
 * weapon data is missing (dpsWithReload 0 = unknown).
 *
 * The per-clip overhead is recovered from the BASE stats exactly as the engine
 * does (lib/engine/heroBasket.ts), so with no spirit-scaled gun stats the cycle
 * reproduces Valve's dpsWithReload scaled by per-bullet damage.
 */
export function gunAt(stats: HeroBaseStats, boon: number): GunProfile | null {
  const { bulletDamage, bulletsPerSecond: rate0, ammo: clip0, reloadTime: reload } = stats;
  if (!(stats.dpsWithReload > 0 && bulletDamage > 0 && rate0 > 0 && clip0 > 0 && reload >= 0)) {
    return null;
  }
  const baseCycle = (clip0 * bulletDamage) / stats.dpsWithReload;
  const overhead = Math.max(0, baseCycle - clip0 / rate0 - reload);
  const sp = boonSpiritPower(stats, boon);
  return {
    perShot: calculateStatsAtBoon(stats, boon).bulletDamage + stats.bulletDamagePerSpirit * sp,
    shotsPerSecond: rate0 + stats.bulletsPerSecondPerSpirit * sp,
    clip: clip0 + stats.clipPerSpirit * sp,
    reload,
    overhead,
  };
}

/**
 * Sustained DPS (reload included) at `boon`, on paper: every bullet lands.
 *
 * Anchored to Valve's dpsWithReload: Valve's base DPS x (cycle DPS at `boon` /
 * cycle DPS at base). The cycle model only measures how much damage, clip and
 * fire-rate changes help. It is NOT trusted for the absolute number: for 12 of
 * 44 heroes (frozen roster, 2026-10-25) its base cycle lands 19-79% BELOW
 * Valve's (Calico -79%, Shiv -62%, Yamato -55%: spread and per-shell-reload
 * weapons, where bullets_per_second counts pellets but clip counts shots), so
 * the overhead clamps at 0. Anchoring keeps every hero's base exact. The engine
 * builds its GunProfile the same unanchored way (heroBasket.ts); fixing it there
 * is a separate scoring PR (docs/milestone-o.md §8).
 */
export function sustainedDps(stats: HeroBaseStats, boon: number): number | null {
  const gun = gunAt(stats, boon);
  // Boon 0 has no spirit power: the base gun Valve's dpsWithReload describes.
  const base = gunAt(stats, 0);
  if (!gun || !base) return null;
  const baseCycleDps = sustainedGunDps(base, {});
  return baseCycleDps > 0
    ? positive((stats.dpsWithReload * sustainedGunDps(gun, {})) / baseCycleDps)
    : null;
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
  | "healthPerBoon"
  | "healthGrowth"
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
      stats.bulletDamage > 0
        ? positive(
            calculateStatsAtBoon(stats, b).bulletDamage +
              stats.bulletDamagePerSpirit * boonSpiritPower(stats, b),
          )
        : null,
  },
  {
    id: "fireRate",
    group: "gun",
    label: "Fire rate",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) =>
      stats.bulletsPerSecond > 0
        ? positive(
            stats.bulletsPerSecond + stats.bulletsPerSecondPerSpirit * boonSpiritPower(stats, b),
          )
        : null,
  },
  {
    id: "clipSize",
    group: "gun",
    label: "Clip size",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) =>
      stats.ammo > 0
        ? positive(stats.ammo + stats.clipPerSpirit * boonSpiritPower(stats, b))
        : null,
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
      stats.heavyMeleeDamage > 0
        ? positive(
            calculateStatsAtBoon(stats, b).heavyMeleeDamage +
              stats.heavyMeleePerSpirit * boonSpiritPower(stats, b),
          )
        : null,
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
    // HP scaling (the user, 2026-11-06): health gained per boon, 27 (Mina) to
    // 65 (Mo & Krill) live. The same at every boon count, so boon 0 shows it too.
    id: "healthPerBoon",
    group: "vitality",
    label: "Health per boon",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }) => (stats.maxHealth > 0 ? nonNegative(stats.maxHealthPerBoon) : null),
  },
  {
    // Health at boon B over health at boon 0, minus 1: how much of the hero's
    // late-game health comes from boons (Warden +224% vs Vindicta +111%, live).
    id: "healthGrowth",
    group: "vitality",
    label: "Health growth from boons",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) => {
      const atBoon = maxHealthAt(stats, b);
      const atZero = maxHealthAt(stats, 0);
      return atBoon != null && atZero != null ? atBoon / atZero - 1 : null;
    },
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
    // Base regen plus spirit-scaled regen from boon spirit power (Victor 0.08).
    value: ({ stats }, b) => nonNegative(healthRegenAt(stats, boonSpiritPower(stats, b))),
  },
  {
    id: "moveSpeed",
    group: "vitality",
    label: "Move speed",
    direction: "higher",
    lead: false,
    rankAware: false,
    value: ({ stats }, b) =>
      stats.moveSpeed > 0
        ? positive(stats.moveSpeed + stats.moveSpeedPerSpirit * boonSpiritPower(stats, b))
        : null,
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
