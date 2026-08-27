// Shared, plain-English labels for raw API stat/property keys.
//
// Extracted from the private PROPERTY_LABELS map that lived in
// lib/abilityCoefficients.ts, then widened into a SUPERSET so the same map can
// label item stats (`Item.stats`) as well as ability property upgrades.
//
// The item-side keys were sourced empirically: every distinct key across
// `Object.keys(item.stats)` for all shopable items (318 distinct keys at time
// of writing). The long tail is dominated by one-off, item-specific tooltip
// keys (`WatcherMaxDuration`, `JumpVelocityHidden`, …) that no shared UI would
// ever want a hand-written label for — those intentionally fall through to the
// raw-key fallback in the formatters below. What IS curated here:
//
//   1. every key from the original ability-only PROPERTY_LABELS map,
//   2. every item stat key appearing on 4+ items,
//   3. the "Stat key mappings" list documented in CLAUDE.md /
//      the deadlock-api-integration skill,
//   4. a handful of lower-frequency but player-facing economy/damage keys.
//
// NOTE: a key missing from this map is NOT an error — `formatStatValue` and
// abilityCoefficients' `formatPropertyUpgrade` both fall back to the raw key.
export const STAT_PROPERTY_LABELS: Record<string, string> = {
  // ─── Ability properties (from the original PROPERTY_LABELS) ────────────────
  AbilityCooldown: "Cooldown",
  AbilityDuration: "Duration",
  AbilityCastRange: "Cast Range",
  AbilityCharges: "Charges",
  AbilityCooldownBetweenCharge: "Charge Cooldown",
  BonusHealthRegen: "Health Regen",
  BonusMaxHealth: "Max Health",
  TechPower: "Spirit Power",
  WeaponPower: "Weapon Damage",
  BulletLifesteal: "Bullet Lifesteal",
  TechLifesteal: "Spirit Lifesteal",
  MoveSpeed: "Move Speed",
  BonusClipSize: "Clip Size",
  FireRate: "Fire Rate",
  // Renamed upstream (see CLAUDE.md) — kept so older/ability payloads still
  // render a friendly label rather than the raw key.
  BulletDamage: "Bullet Damage",
  StatusResistancePercent: "Status Resistance",
  BaseAttackDamagePercent: "Weapon Damage",
  SlowDuration: "Slow Duration",
  StunDuration: "Stun Duration",
  BonusArmor: "Bullet Resist",
  TechArmor: "Spirit Resist",

  // ─── Documented stat-key mappings not already covered above ───────────────
  TechPowerPercent: "Spirit Power",
  BonusHealth: "Bonus Health",
  OutOfCombatHealthRegen: "Out of Combat Health Regen",
  BulletResist: "Bullet Resist",
  TechResist: "Spirit Resist",
  DegenResistance: "Degen Resistance",
  MeleeResistPercent: "Melee Resist",

  // ─── Common item stat keys (4+ items) ─────────────────────────────────────
  AbilityCastDelay: "Cast Delay",
  AbilityChargeUpTime: "Charge-Up Time",
  AbilityLifestealPercentHero: "Ability Lifesteal vs Heroes",
  AbilityUnitTargetLimit: "Target Limit",
  ActiveBonusMoveSpeed: "Move Speed (Active)",
  BarrierDuration: "Barrier Duration",
  BonusAbilityDurationPercent: "Ability Duration",
  BonusBulletSpeedPercent: "Bullet Velocity",
  BonusClipSizePercent: "Clip Size",
  BonusFireRate: "Fire Rate",
  BonusMeleeDamagePercent: "Melee Damage",
  BonusMoveSpeed: "Move Speed",
  BonusSprintSpeed: "Sprint Speed",
  BuffDuration: "Buff Duration",
  BuildUpDuration: "Build-Up Duration",
  BuildUpPerShot: "Build-Up Per Shot",
  BulletArmorReduction: "Bullet Resist Reduction",
  BulletLifestealPercent: "Bullet Lifesteal",
  BulletResistReduction: "Bullet Resist Reduction",
  ChannelMoveSpeed: "Move Speed While Channeling",
  CombatBarrier: "Combat Barrier",
  CooldownReduction: "Cooldown Reduction",
  Damage: "Damage",
  DamageThreshold: "Damage Threshold",
  DebuffDuration: "Debuff Duration",
  FireRateSlow: "Fire Rate Slow",
  GroundDashReductionPercent: "Ground Dash Cost Reduction",
  HeadShotBonusDamage: "Headshot Damage",
  HealAmpReceivePenaltyPercent: "Healing Received Reduction",
  HealAmpRegenPenaltyPercent: "Health Regen Reduction",
  MagicResistReduction: "Spirit Resist Reduction",
  MaxStacks: "Max Stacks",
  MovementSpeedSlow: "Move Speed Slow",
  ProcChance: "Proc Chance",
  ProcCooldown: "Proc Cooldown",
  Radius: "Radius",
  SlowPercent: "Slow",
  SpiritPower: "Spirit Power",
  Stamina: "Stamina",
  StaminaCooldownReduction: "Stamina Recovery",
  TechArmorDamageReduction: "Spirit Armor Reduction",
  TechRadiusMultiplier: "Spirit Radius",
  TechRangeMultiplier: "Spirit Range",
  TickRate: "Tick Rate",

  // ─── Lower-frequency but player-facing keys ───────────────────────────────
  BonusAbilityCharges: "Ability Charges",
  BonusGoldPerMinute: "Bonus Souls per Minute",
  BonusSoulsPct: "Bonus Souls",
  BonusSpirit: "Spirit Power",
  CritDamagePercent: "Critical Damage",
  DPS: "DPS",
  GoldPerMinute: "Souls per Minute",
  SlowResistancePercent: "Slow Resist",
  SpiritDamage: "Spirit Damage",
  StartingGold: "Starting Souls",
  TechPowerReduction: "Spirit Power Reduction",
};

/**
 * Formats a CURRENT stat value for display — e.g. an item stat card:
 * `"15% Weapon Damage"`.
 *
 * This is the current-value sibling of `formatPropertyUpgrade` in
 * lib/abilityCoefficients.ts, which formats a DELTA (`"+15% Weapon Damage"`).
 * Same suffix-detection rules, deliberately: Cooldown/Duration keys read as
 * seconds, Percent/Lifesteal/Rate/Resistance keys as percentages, everything
 * else as a raw number.
 *
 * Unrecognized keys fall back to the raw key rather than throwing or blanking.
 */
export function formatStatValue(key: string, value: number): string {
  const label = STAT_PROPERTY_LABELS[key] ?? key;

  if (key.includes("Cooldown") || key.includes("Duration")) {
    return `${value}s ${label}`;
  }
  if (
    key.includes("Percent") ||
    key.includes("Lifesteal") ||
    key.includes("Rate") ||
    key.includes("Resistance")
  ) {
    return `${value}% ${label}`;
  }
  return `${value} ${label}`;
}
