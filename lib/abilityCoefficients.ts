import type { HeroAbilityRaw } from "@/lib/api/deadlockApi";
import type { SignatureSlot } from "@/lib/deadlock";
import type { AbilityLevel } from "@/lib/deadlock";
import { STAT_PROPERTY_LABELS } from "@/lib/statLabels";

export type AbilityUpgradeTier = {
  pointCost: 1 | 2 | 5;
  description: string;
  statChanges: Array<{
    stat: string;
    delta: string;
    /** True when the bonus adds to the property's scaling, not its base value. */
    scale?: boolean;
    /** For a scale bonus: the stat it scales with (ETechPower, EBaseWeaponDamageIncrease). */
    scaleStat?: string;
  }>;
};

export type HeroAbility = {
  classname: string;
  name: string;
  slot: SignatureSlot;
  icon?: string;
  isUltimate: boolean;
  damageType: "spirit" | "weapon" | "mixed" | "none";
  baseDamage: number | null;
  spiritScaling: number | null;
  weaponScaling: number | null;
  cooldown: number | null;
  duration: number | null;
  castRange: number | null;
  passive: string | null;
  active: string | null;
  upgrades: [AbilityUpgradeTier, AbilityUpgradeTier, AbilityUpgradeTier];
  /** The property `baseDamage` was read from (e.g. "Damage", "DPS"). */
  damageKey?: string;
  /**
   * Set when `baseDamage` / `spiritScaling` are a RATE (a DPS key): one cast
   * deals them for this many seconds. Absent = per hit, or a rate whose
   * duration the API doesn't give (then a cast counts as one second, as before).
   */
  damageSeconds?: number;
  /** Base charges (AbilityCharges >= 1): charged-ability items apply to it. */
  charges?: number;
};

// Damage keys that are a rate: one cast deals the value per second.
const PER_SECOND_DAMAGE = /(DPS|PerSecond)$/;

/** True when the ability's damage is a per-second rate (a DPS key). */
export function isDamageRate(ability: Pick<HeroAbility, "damageKey">): boolean {
  return ability.damageKey != null && PER_SECOND_DAMAGE.test(ability.damageKey);
}

/** Damage per cast: base, or rate x seconds. Pure; see `damageSeconds`. */
export function damagePerCastFactor(ability: Pick<HeroAbility, "damageSeconds">): number {
  return ability.damageSeconds != null && ability.damageSeconds > 0 ? ability.damageSeconds : 1;
}

export const TIER_POINT_COSTS = [1, 2, 5] as const;

// Ability level is capped at 3 tiers (1/2/5 point costs above) — see CLAUDE.md
// ABILITY_MAX_LEVEL. Reused here to guard the fixed-length `upgrades` tuple
// indexing in calculateAbilityDamage below.
export const ABILITY_MAX_LEVEL: AbilityLevel = 3;

function formatPropertyUpgrade(name: string, bonus: string | number): string {
  // Labels moved to lib/statLabels.ts (a superset of the ability-only map that
  // used to live here, widened to cover item stat keys too). Behaviour here is
  // unchanged: unrecognized keys still fall back to the raw key.
  const label = STAT_PROPERTY_LABELS[name] ?? name;
  const value = typeof bonus === "number" ? bonus : parseFloat(bonus);
  const sign = value >= 0 ? "+" : "";

  if (name.includes("Cooldown") || name.includes("Duration")) {
    return `${sign}${value}s ${label}`;
  }
  if (
    name.includes("Percent") ||
    name.includes("Lifesteal") ||
    name.includes("Rate") ||
    name.includes("Resistance")
  ) {
    return `${sign}${value}% ${label}`;
  }
  return `${sign}${value} ${label}`;
}

function safeNum(v: number | string | undefined | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function buildUpgradeTier(
  raw: HeroAbilityRaw["upgrades"],
  index: 0 | 1 | 2,
  descriptionMap: Record<string, string>,
): AbilityUpgradeTier {
  const pointCost = TIER_POINT_COSTS[index];
  const entry = raw?.[index];

  const descKey = `t${index + 1}_desc` as keyof typeof descriptionMap;
  const apiDescription = descriptionMap[descKey] ?? "";

  const statChanges: AbilityUpgradeTier["statChanges"] =
    entry?.property_upgrades?.map((pu) => ({
      stat: pu.name,
      delta: String(pu.bonus),
      ...(pu.upgrade_type === "EAddToScale" ? { scale: true } : {}),
      ...(pu.upgrade_type === "EAddToScale" && pu.scale_stat_filter
        ? { scaleStat: pu.scale_stat_filter }
        : {}),
    })) ?? [];

  const description =
    apiDescription.trim().length > 0
      ? apiDescription
      : (entry?.property_upgrades
          ?.map((pu) => formatPropertyUpgrade(pu.name, pu.bonus))
          .join(", ") ?? "");

  return { pointCost, description, statChanges };
}

// Modifiers that carry a damage css class but are not the ability's own hit
// (Abrams WeaponDamageBonus, Haze DamageBonusFixedPerStack, Wraith
// SpadeDamageBonus, Lady Geist BloodSpillDPSPercent / SelfDamagePct).
const NOT_ABILITY_DAMAGE = /(Percent|Pct|Bonus)/;
// Where a rate's duration lives, in order of preference (data-verifier and live
// API, 2026-10-25: Siphon Life AbilityDuration 4, Lightning Ball MaxLifetime 5,
// Afterburn BurnDuration 3).
const DAMAGE_SECONDS_KEYS = ["AbilityDuration", "MaxLifetime", "BurnDuration"] as const;

function isSpiritScaled(p: {
  scale_function?: { class_name?: string; specific_stat_scale_type?: string };
}) {
  const fn = p.scale_function;
  return (
    fn?.class_name === "scale_function_tech_damage" || fn?.specific_stat_scale_type === "ETechPower"
  );
}

export function mapApiAbilityToHeroAbility(raw: HeroAbilityRaw, slot: SignatureSlot): HeroAbility {
  const props = raw.properties ?? {};

  // The ability's own damage (item scoring review C1, docs/item-scoring-review.md
  // §1.3; "the first damage-class property" picked modifiers and zero
  // placeholders). Among damage-class properties that aren't modifiers:
  //   1. a positive one keyed exactly "Damage" (Baba Threadsap: Damage 50, not
  //      the scaled 8 per bullet that follows it);
  //   2. else a positive spirit-scaled one (Deadman Danny Jettison Fuel:
  //      ScorchDamage, not the weapon-scaled DPS), else the first positive one;
  //   3. else a zero-base one that an upgrade raises (Haze Fixation ProcDamage:
  //      0 until T1 adds 40 + 0.8 spirit), so its upgrades still apply.
  // Checked roster-wide on 2026-10-25: 139 of 176 abilities unchanged, every
  // change reviewed (PR R2a).
  const upgraded = new Set(
    (raw.upgrades ?? []).flatMap((u) => (u.property_upgrades ?? []).map((pu) => pu.name)),
  );
  const damageClass = Object.entries(props).filter(
    ([key, p]) =>
      typeof p.css_class === "string" &&
      (p.css_class.includes("tech_damage") || p.css_class.includes("bullet_damage")) &&
      !NOT_ABILITY_DAMAGE.test(key),
  );
  const positive = damageClass.filter(([, p]) => (safeNum(p.value) ?? 0) > 0);
  const damageEntry =
    positive.find(([key]) => key === "Damage") ??
    positive.find(([, p]) => isSpiritScaled(p)) ??
    positive[0] ??
    damageClass.find(([key, p]) => safeNum(p.value) == null && upgraded.has(key));
  const damageKey = damageEntry?.[0];
  const damageProp = damageEntry?.[1];
  const damageSeconds =
    damageKey && PER_SECOND_DAMAGE.test(damageKey)
      ? DAMAGE_SECONDS_KEYS.map((k) => safeNum(props[k]?.value)).find((v) => v != null && v > 0)
      : undefined;

  const baseDamage = damageProp ? safeNum(damageProp.value) : null;

  const scaleFn = damageProp?.scale_function;
  const scaleType = scaleFn?.specific_stat_scale_type;
  const scaleVal = scaleFn?.stat_scale ?? null;

  const isSpiritScale = damageProp ? isSpiritScaled(damageProp) : false;
  const isWeaponScale = scaleType !== undefined && !isSpiritScale;

  const spiritScaling = isSpiritScale && scaleVal != null ? scaleVal : null;
  const weaponScaling = isWeaponScale && scaleVal != null ? scaleVal : null;

  let damageType: HeroAbility["damageType"] = "none";
  if (spiritScaling != null && weaponScaling != null) damageType = "mixed";
  else if (spiritScaling != null) damageType = "spirit";
  else if (weaponScaling != null) damageType = "weapon";
  else if (damageProp) damageType = "spirit"; // has damage but no identified scale

  const cdProp = props["AbilityCooldown"];
  const cooldown = cdProp ? safeNum(cdProp.value) : null;

  const durProp = props["AbilityDuration"];
  const duration = durProp ? safeNum(durProp.value) : null;

  const rangeProp = props["AbilityCastRange"];
  const castRange = rangeProp ? safeNum(rangeProp.value) : null;

  const desc = raw.description ?? {};
  const passive = desc["passive"] ?? null;
  const active = desc["active"] ?? null;

  const upgrades: [AbilityUpgradeTier, AbilityUpgradeTier, AbilityUpgradeTier] = [
    buildUpgradeTier(raw.upgrades, 0, desc),
    buildUpgradeTier(raw.upgrades, 1, desc),
    buildUpgradeTier(raw.upgrades, 2, desc),
  ];

  return {
    classname: raw.class_name,
    name: raw.name,
    slot,
    icon: raw.image_webp ?? raw.image,
    isUltimate: raw.ability_type === "ultimate",
    damageType,
    baseDamage,
    spiritScaling,
    weaponScaling,
    cooldown,
    duration,
    castRange,
    passive,
    active,
    upgrades,
    ...(damageKey ? { damageKey } : {}),
    ...(damageSeconds != null ? { damageSeconds } : {}),
    ...((safeNum(props["AbilityCharges"]?.value) ?? 0) >= 1
      ? { charges: safeNum(props["AbilityCharges"]?.value) ?? 1 }
      : {}),
  };
}

export function mapHeroAbilities(
  rawAbilities: HeroAbilityRaw[],
  heroItems: Record<string, string> | undefined,
): HeroAbility[] {
  if (!heroItems) return [];

  const slots: SignatureSlot[] = ["signature1", "signature2", "signature3", "signature4"];
  const byClass = new Map<string, HeroAbilityRaw>(rawAbilities.map((a) => [a.class_name, a]));

  return slots.flatMap((slot) => {
    const cls = heroItems[slot];
    if (!cls) return [];
    const raw = byClass.get(cls);
    if (!raw) return [];
    return [mapApiAbilityToHeroAbility(raw, slot)];
  });
}

// Cumulative point cost to reach each ability level
const LEVEL_POINT_COSTS: Record<AbilityLevel, number> = { 0: 0, 1: 1, 2: 3, 3: 8 };

export function totalPointsSpent(
  abilityLevels: Partial<Record<SignatureSlot, AbilityLevel>>,
): number {
  const slots: SignatureSlot[] = ["signature1", "signature2", "signature3", "signature4"];
  let total = 0;
  for (const slot of slots) {
    const level = abilityLevels[slot] ?? 0;
    total += LEVEL_POINT_COSTS[level];
  }
  return total;
}

export function pointCostForNextLevel(currentLevel: AbilityLevel): number {
  const next = (currentLevel + 1) as AbilityLevel;
  return LEVEL_POINT_COSTS[next] - LEVEL_POINT_COSTS[currentLevel];
}

export function calculateAbilityDamage(
  ability: HeroAbility,
  abilityLevel: AbilityLevel,
  spiritPower: number,
  weaponDamage: number,
): number | null {
  // A zero-base key that only upgrades raise (Haze Fixation) still projects.
  if (ability.baseDamage == null && ability.damageKey == null) return null;

  let damage = ability.baseDamage ?? 0;

  if (ability.spiritScaling != null) {
    damage += spiritPower * ability.spiritScaling;
  }
  if (ability.weaponScaling != null) {
    damage += weaponDamage * ability.weaponScaling;
  }

  // Apply upgrade bonuses for purchased tiers (abilityLevel = number of tiers bought).
  // Clamp defensively — `upgrades` is a fixed 3-element tuple, and an out-of-range
  // level (> ABILITY_MAX_LEVEL) would otherwise index past it and throw.
  const clampedLevel = Math.min(Math.max(abilityLevel, 0), ABILITY_MAX_LEVEL);
  for (let tier = 0; tier < clampedLevel; tier++) {
    const upgrade = ability.upgrades[tier as 0 | 1 | 2];
    for (const change of upgrade.statChanges) {
      // Bonuses to the ability's own damage property (DPS, DamagePerChain...,
      // not only "Damage"). A scale bonus adds to the spirit coefficient.
      if (change.stat !== ability.damageKey) continue;
      const delta = parseFloat(change.delta);
      if (!Number.isFinite(delta)) continue;
      if (!change.scale) damage += delta;
      else if (!change.scaleStat || change.scaleStat === "ETechPower")
        damage += spiritPower * delta;
      else if (change.scaleStat === "EBaseWeaponDamageIncrease") damage += weaponDamage * delta;
      // Any other scale stat is unknown: added nothing rather than guessed.
    }
  }

  return Math.round(damage * 10) / 10;
}
