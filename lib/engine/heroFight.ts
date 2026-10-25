// lib/engine/heroFight.ts — every NON-damage stat and effect priced in the same
// unit as heroDamage.ts's damage: % of this hero's fight value in a trade.
//
// Why ("one value scale", 2026-10-24): damage was already "% of this hero's
// DPS", but sustain, mobility, utility and economy were raw stat sums several
// times larger per soul, so the cheapest way to "cover need" was always an
// economy or sustain item (Lady Geist, need 128 spirit: Extra Spirit 7.4 vs
// Monster Rounds 21.1). The need cannot fix a unit mismatch.
//
// A 1v1 trade is won by the side whose DPS × effective HP is larger, so +1%
// DPS and +1% effective HP are worth the same. Mobility, utility and economy
// have no such identity and convert through the explicit exchange rates below.
//
// Mechanics (data-verifier, 2026-10-20; deadlock.wiki Resistance / Lifesteal /
// Move_Speed / Damage_Barrier / Ability_Cooldown):
// - bullet / spirit resist multiply damage taken by (1 − r); melee also takes
//   bullet resist; barrier absorbs AFTER resist, so it is raw HP;
// - lifesteal % returns that share of damage dealt (to heroes: full rate);
// - move speed bonuses diminish, sprint is additive; Stamina is charges (of 3);
// - StaminaCooldownReduction is a stamina REGEN-rate %, can be negative;
// - TechRange and TechRadius are always paired: counted once.
//
// Pure: same inputs, same output.

import type { ItemStats } from "../items";
import type { ScoreCategory } from "./types";
import type { EffectEstimate } from "./effectEstimator";
import {
  castsPerTrade,
  MELEE_HITS_PER_TRADE,
  MELEE_LANDS,
  TRADE_GAP_SECONDS,
  TRADE_SECONDS,
} from "./heroDamage";

export interface HeroFightModel {
  maxHealth: number;
  moveSpeed: number;
  /** Landed gun DPS and ability DPS (heroDamage.heroDps). */
  gunDps: number;
  abilityDps: number;
}

/** Seconds of a trade: converts per-second healing into effective HP. */
export const FIGHT_SECONDS = TRADE_SECONDS;
/** Share of incoming damage by type (no measured split yet). */
const INCOMING_BULLET = 0.5;
const INCOMING_SPIRIT = 0.5;
const INCOMING_MELEE = 0.1;
/** Weight for stats only up some of the time (actives, out of combat, temporary barrier). */
const CONDITIONAL = 0.4;
/** Exchange rates for the categories with no fight-value identity. */
const MOBILITY_PER_SPEED_PERCENT = 0.5; // 1% move speed ≈ 0.5% fight value (chase / escape)
const SPRINT_PER_SPEED_PERCENT = 0.25;
const STAMINA_CHARGE_VALUE = 10; // +1 of 3 dash charges
const CHARGE_UPTIME = 0.3; // +1 ability charge ≈ +30% of that ability's uptime
const FARM_TO_FIGHT = 0.5; // 1% faster farming ≈ 0.5% fight value later
const PROC_DEFLECT_SHARE = 0.1; // on-hit prevention: share of bullet damage it can stop
const CC_RESIST_RATE = 0.1; // 1% debuff / slow resist ≈ 0.1% fight value
const OUT_OF_COMBAT_SHARE = 0.5; // share of a trade spent out of combat (regen ticks)
const CHANNEL_HEAL_RATE = 0.25; // channelled heal (Rescue Beam) % ≈ 0.25% per point
const STAMINA_REGEN_RATE = 0.2; // 1% stamina regen ≈ 0.2% fight value
const AIR_MOVE_RATE = 0.1; // 1% air dash / jump distance ≈ 0.1% fight value
const REACH_RATE = 0.25; // 1% ability range / radius ≈ 0.25% of the ability share
const CREEP_RESIST_FARM_RATE = 0.2; // 1% bullet resist vs creeps ≈ 0.2% faster farming
const STACKS_HELD = 3; // typical stacks of a per-stack creep-damage bonus
const DASH_DENIAL_RATE = 0.1; // 1% enemy dash reduction ≈ 0.1% fight value
const CONDITIONAL_SOULS_RATE = 0.02; // 1% bonus souls on a specific trigger ≈ 0.02% fight value
const SPIRIT_CUT_RATE = 0.5; // 1 point of enemy spirit power / damage cut ≈ 0.5% of their spirit damage

/** Stat keys `fightValues` prices; itemAdapter skips its heuristic for them in hero mode. */
export const HERO_FIGHT_KEYS: ReadonlySet<string> = new Set([
  "BonusHealth",
  "BulletResist",
  "TechResist",
  "StatusResistancePercent",
  "InnateStatusResistancePercent",
  "MeleeResistPercent",
  "SlowResistancePercent",
  "DeflectionPercent",
  "BulletProcDeflectionPercent",
  "CombatBarrier",
  "VexBarrierCombatBarrier",
  "GuardianWardCombatBarrier",
  "BonusHealthRegen",
  "OutOfCombatHealthRegen",
  "HealLifePercentOutOfCombat",
  "BulletLifestealPercent",
  "AbilityLifestealPercentHero",
  "ImbueAbilityLifesteal",
  "HealPercentAmount",
  "BonusMoveSpeed",
  "ActiveBonusMoveSpeed",
  "BonusSprintSpeed",
  "Stamina",
  "StaminaCooldownReduction",
  "AirMoveIncreasePercent",
  "CooldownReduction",
  "BonusAbilityCharges",
  "BonusAbilityDurationPercent",
  "TechRangeMultiplier",
  "TechRadiusMultiplier",
  "NonPlayerBonusWeaponPower",
  "NonPlayerBulletResist",
  "WeaponPowerPerStackNonHero",
]);

const num = (x: number | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const clampPct = (r: number) => Math.min(90, Math.max(-90, r)) / 100;

/** Non-damage category values in % of this hero's fight value. */
export function fightValues(
  stats: ItemStats,
  m: HeroFightModel,
  innate?: ReadonlySet<string>,
): Partial<Record<ScoreCategory, number>> {
  const s = (k: string) => num(stats[k]);
  const hp = m.maxHealth > 0 ? m.maxHealth : 0;
  const dps = m.gunDps + m.abilityDps;
  if (!(hp > 0) || !(dps > 0)) return {};
  const gunShare = m.gunDps / dps;
  const abilityShare = m.abilityDps / dps;
  // A stat on an item with a cooldown is conditional unless the API lists it
  // as INNATE (always on).
  // Same rule as heroDamage.damageValues: cooldown OR a timed effect.
  const timed = s("AbilityCooldown") > 0 || s("AbilityDuration") > 0;
  const cond = (k: string) => (timed && !innate?.has(k) ? CONDITIONAL : 1);
  const out: Partial<Record<ScoreCategory, number>> = {};

  // bonusHealth: % more HP.
  if (s("BonusHealth")) out.bonusHealth = (s("BonusHealth") / hp) * 100;

  // resist: % more effective HP against the assumed incoming mix.
  const rb = clampPct(s("BulletResist") * cond("BulletResist"));
  const rs = clampPct(s("TechResist") * cond("TechResist"));
  const taken = INCOMING_BULLET * (1 - rb) + INCOMING_SPIRIT * (1 - rs);
  let resist = taken > 0 ? (1 / taken - 1) * 100 : 0;
  const rm = clampPct(s("MeleeResistPercent"));
  resist += INCOMING_MELEE * CONDITIONAL * (rm / (1 - rm)) * 100;
  resist += INCOMING_BULLET * CONDITIONAL * clampPct(s("DeflectionPercent")) * 100;
  resist += INCOMING_BULLET * PROC_DEFLECT_SHARE * clampPct(s("BulletProcDeflectionPercent")) * 100;
  // Debuff / slow resist: shortens CC; a small fixed rate.
  resist +=
    CC_RESIST_RATE *
    (s("StatusResistancePercent") * cond("StatusResistancePercent") +
      s("InnateStatusResistancePercent") +
      s("SlowResistancePercent") * CONDITIONAL);
  if (resist) out.resist = resist;

  // shield: barrier HP is raw effective HP (absorbs after resist), temporary.
  const barrier =
    s("CombatBarrier") + s("VexBarrierCombatBarrier") + s("GuardianWardCombatBarrier");
  if (barrier) out.shield = (barrier / hp) * 100 * CONDITIONAL;

  // sustain: healing over a trade, as % of HP.
  const healPerSecond =
    s("BonusHealthRegen") +
    CONDITIONAL * OUT_OF_COMBAT_SHARE * s("OutOfCombatHealthRegen") +
    CONDITIONAL * OUT_OF_COMBAT_SHARE * (s("HealLifePercentOutOfCombat") / 100) * hp +
    (s("BulletLifestealPercent") / 100) * m.gunDps * cond("BulletLifestealPercent") +
    (s("AbilityLifestealPercentHero") / 100) * m.abilityDps * cond("AbilityLifestealPercentHero") +
    CONDITIONAL * (s("ImbueAbilityLifesteal") / 100) * m.abilityDps;
  let sustain = ((healPerSecond * FIGHT_SECONDS) / hp) * 100;
  sustain += CONDITIONAL * CHANNEL_HEAL_RATE * s("HealPercentAmount");
  if (sustain) out.sustain = sustain;

  // mobility: exchange rate on % move speed, sprint and dash charges.
  const speed = m.moveSpeed > 0 ? m.moveSpeed : 0;
  const perSpeed = (mps: number) => (speed > 0 ? (mps / speed) * 100 : 0);
  const mobility =
    MOBILITY_PER_SPEED_PERCENT *
      perSpeed(s("BonusMoveSpeed") + CONDITIONAL * s("ActiveBonusMoveSpeed")) +
    SPRINT_PER_SPEED_PERCENT * perSpeed(s("BonusSprintSpeed")) +
    STAMINA_CHARGE_VALUE * s("Stamina") +
    STAMINA_REGEN_RATE * s("StaminaCooldownReduction") +
    AIR_MOVE_RATE * s("AirMoveIncreasePercent");
  if (mobility) out.mobility = mobility;

  // utility: cooldown, charges, duration and reach act on ability damage.
  const cdr = clampPct(s("CooldownReduction"));
  const utility =
    abilityShare * (cdr / (1 - cdr)) * 100 +
    abilityShare * CHARGE_UPTIME * 100 * s("BonusAbilityCharges") * cond("BonusAbilityCharges") +
    abilityShare * CONDITIONAL * s("BonusAbilityDurationPercent") +
    abilityShare * REACH_RATE * Math.max(s("TechRangeMultiplier"), s("TechRadiusMultiplier"));
  if (utility) out.utility = utility;

  // economy: faster farming (creep-only damage and resist) via an exchange rate.
  const farm =
    gunShare * s("NonPlayerBonusWeaponPower") +
    CREEP_RESIST_FARM_RATE * s("NonPlayerBulletResist") +
    gunShare * CONDITIONAL * s("WeaponPowerPerStackNonHero") * STACKS_HELD;
  if (farm) out.economy = FARM_TO_FIGHT * farm;

  return out;
}

/** A movement slow is worth this fraction of a stun of the same duration. */
const SLOW_TO_STUN = 0.25;
/** Share of an enemy's effective HP in a trade that comes from their healing. */
const ENEMY_HEAL_SHARE = 0.2;
/** Typical soul income per minute (5,900 souls at ~9.5 min, 16,700 at ~20). */
const REFERENCE_SOULS_PER_MINUTE = 800;
/** Damaging abilities a hero has (an ability reset doubles one of them). */
const ABILITIES_PER_HERO = 4;

/**
 * A non-damage effect estimate (effectEstimator `unit` + `quantity`) in % of
 * this hero's fight value. Null for units this does not convert (damage units
 * go through itemAdapter's estimateDps).
 */
export function estimateFightValue(
  e: EffectEstimate,
  stats: ItemStats,
  m: HeroFightModel,
): number | null {
  if (!e.unit || e.quantity === undefined) return null;
  const q = e.quantity;
  const hp = m.maxHealth;
  const dps = m.gunDps + m.abilityDps;
  if (!(hp > 0) || !(dps > 0)) return null;
  const abilityShare = m.abilityDps / dps;
  const cooldown = num(stats.AbilityCooldown);
  const duration = num(stats.AbilityDuration);
  // Share of trades the effect is ready for, and share of a trade it lasts.
  const ready = cooldown > 0 ? Math.min(1, TRADE_GAP_SECONDS / cooldown) : 1;
  const lasts = duration > 0 ? Math.min(1, duration / FIGHT_SECONDS) : 1;
  const speed = m.moveSpeed > 0 ? m.moveSpeed : 0;
  switch (e.unit) {
    case "heal": {
      const regen = num(stats.RegenDuration);
      const landed = regen > 0 ? Math.min(1, FIGHT_SECONDS / regen) : 1;
      return (q / hp) * 100 * ready * landed;
    }
    case "healPerSecond":
      return ((q * FIGHT_SECONDS * lasts) / hp) * 100 * ready;
    case "healPerMeleeHit": {
      // Cooldown-gated ("your next melee attack heals"): at most one heal per
      // cooldown, and only when a melee lands.
      const heals = Math.min(
        MELEE_HITS_PER_TRADE,
        cooldown > 0 ? castsPerTrade(cooldown) : MELEE_HITS_PER_TRADE,
      );
      return ((q * heals * MELEE_LANDS) / hp) * 100;
    }
    case "health":
      return (q / hp) * 100;
    case "ccSeconds":
      return (q / FIGHT_SECONDS) * 100 * ready;
    case "slowPercentSeconds":
      return SLOW_TO_STUN * (q / 100 / FIGHT_SECONDS) * 100 * ready;
    case "slowPercent":
      return SLOW_TO_STUN * (q / 100) * lasts * 100 * ready;
    case "fireRateSlowPercent":
      return INCOMING_BULLET * q * lasts * ready;
    case "dashDenialPercent":
      return DASH_DENIAL_RATE * q * ready;
    case "enemyDamageCutPercent": {
      // A debuff lasts its DebuffDuration (Inhibitor 5 s, Haunting Shot 4 s).
      const debuff = num(stats.DebuffDuration);
      const window = debuff > 0 ? Math.min(1, debuff / FIGHT_SECONDS) : lasts;
      return q * window * ready;
    }
    case "selfDamageCutPercent": {
      // Split across the two damage estimates by this hero's damage shares.
      const share = e.category === "gunDamage" ? m.gunDps / dps : abilityShare;
      const on = cooldown > 0 ? lasts * ready : 1; // active window, or always while held
      return -q * share * on;
    }
    case "enemySpiritCut":
      return INCOMING_SPIRIT * SPIRIT_CUT_RATE * q * ready;
    case "healCutPercent":
      return ENEMY_HEAL_SHARE * q;
    case "farmPercent":
      return FARM_TO_FIGHT * q;
    case "soulsPerMinute":
      return FARM_TO_FIGHT * (q / REFERENCE_SOULS_PER_MINUTE) * 100;
    case "soulsPercentConditional":
      return CONDITIONAL_SOULS_RATE * q;
    case "sprintSpeed":
      return speed > 0 ? SPRINT_PER_SPEED_PERCENT * (q / speed) * 100 : null;
    case "abilityReachPercent":
      return abilityShare * REACH_RATE * q;
    case "abilityReset":
      return abilityShare * (100 / ABILITIES_PER_HERO) * q * ready;
    default:
      return null;
  }
}

/** Shred estimate (enemy resist reduced by r%) as % of this hero's DPS. */
export function shredValue(category: "gunShred" | "spiritShred", r: number, m: HeroFightModel) {
  const dps = m.gunDps + m.abilityDps;
  if (!(dps > 0)) return 0;
  return r * ((category === "gunShred" ? m.gunDps : m.abilityDps) / dps);
}
