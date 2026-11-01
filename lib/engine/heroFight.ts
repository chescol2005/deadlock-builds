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
  DEFAULT_PROC_COOLDOWN_S,
  estimateEffectValues,
  REFERENCE_ENEMY_HEALTH,
} from "./effectEstimator";
import {
  castsPerTrade,
  HEADSHOT_IN_TRADE,
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
  /**
   * Ability DPS weighted by each ability's charge credit (0-1, see
   * heroDamage.abilityChargeCredit): the share extra charges help (Extra Charge,
   * Rapid Recharge). Omitted = all ability DPS, as before.
   */
  chargedAbilityDps?: number;
  /**
   * HP the hero's base regen and the owned build already restore between
   * trades (`ownedGapHeal`). An item's recovery is priced on top of it, so
   * healing past full is worth nothing for the build as a whole. Omitted = 0.
   */
  ownedGapHeal?: number;
  /**
   * Landed shots per second through this hero's weapon, for cooldown-gated gun
   * procs (Siphon Bullets). Omitted = the proc's cooldown is never the limit.
   */
  landedShotsPerSecond?: number;
  /**
   * HP per trade that heal amplification multiplies (Milestone G3-5): the
   * hero's kit heals plus the owned items' lifesteal and temporary heals
   * (Milestone K). Flat regen is left out: deadlock.wiki Healing_Booster says
   * amp "does not affect constant regen acquired from most items", but lists
   * Radiant / Mystic Regeneration, Healing Rite and Healing Nova as amplified
   * (data-verifier, 2026-11-01). Omitted = 0 (amp then prices at 0).
   */
  ampableHealHp?: number;
  /**
   * A typical enemy's max health now (enemyHealth.ts), for heals priced in % of
   * the target's max health (Siphon Bullets). Omitted = REFERENCE_ENEMY_HEALTH.
   */
  enemyHealth?: number;
}

/** Seconds of a trade: converts per-second healing into effective HP. */
export const FIGHT_SECONDS = TRADE_SECONDS;

// ─── Healing between trades (Milestone G, PR G2a) ──────────────────────────
//
// Counting healing over one 10 s trade made regen and lifesteal worth little,
// which is why the C4 profile refit failed (docs/item-scoring-review.md §2.2).
// Healing also restores HP in the gap before the next trade (TRADE_GAP_SECONDS),
// so the next trade starts healthier. That RECOVERY is priced separately from
// in-trade healing (docs/milestone-g.md §3.1):
// - regen ticks the whole gap;
// - out-of-combat regen ticks only in the quiet stretch of the gap (not
//   farming: creep damage resets it), after its delay within that stretch
//   (wiki Health_Regen: 4 s after hero damage; an item's own RestoreDelay,
//   Fortitude 10 s, wins);
// - the cap is for the whole build: recovery is priced on top of what the
//   hero's base regen and the owned items already restore (ownedGapHeal);
// - lifesteal heals in the gap only while farming, at the non-hero rate
//   (wiki Lifesteal: bullet 60%, spirit 40%).
// Damage, health, resist and every other stat are unchanged.

/** Recovery HP is worth this share of in-trade effective HP: not every gap ends in another trade, and backing or a sprite can refill HP instead. */
export const RECOVERY_WEIGHT = 0.5;
/** HP a trade typically costs, in % of max HP: healing past full is worth nothing, so recovery saturates here. */
export const RECOVERY_CAP_PCT = 50;
/** Seconds after hero damage before out-of-combat regen starts (deadlock.wiki Health_Regen, 2026-10-25). */
const OUT_OF_COMBAT_DELAY = 4;
/** Share of the gap spent farming creeps: lifesteal heals then, and creep damage keeps out-of-combat regen off. */
const GAP_FARM_SHARE = 0.5;
/** Lifesteal against non-hero units (deadlock.wiki Lifesteal, 2026-10-25). */
const NON_HERO_BULLET_LIFESTEAL = 0.6;
const NON_HERO_SPIRIT_LIFESTEAL = 0.4;

const saturated = (healHp: number, hp: number) =>
  RECOVERY_WEIGHT * RECOVERY_CAP_PCT * (1 - Math.exp(-((healHp / hp) * 100) / RECOVERY_CAP_PCT));

/**
 * Value of `healHp` restored between trades, in % of fight value, on top of
 * the `owned` HP the hero and build already restore: weighted by
 * RECOVERY_WEIGHT and saturating at RECOVERY_CAP_PCT for the whole build
 * (about linear while small).
 */
export function recoveryValue(healHp: number, hp: number, owned = 0): number {
  if (!(healHp > 0) || !(hp > 0)) return 0;
  const base = owned > 0 ? owned : 0;
  return saturated(base + healHp, hp) - saturated(base, hp);
}

/** A stat on a timed item is conditional unless the API lists it as innate. */
function conditionalFor(stats: ItemStats, innate?: ReadonlySet<string>) {
  const timed = num(stats.AbilityCooldown) > 0 || num(stats.AbilityDuration) > 0;
  return (k: string) => (timed && !innate?.has(k) ? CONDITIONAL : 1);
}

/**
 * Lifesteal shares (0-1) of gun and of ability damage an item's stats give.
 * `inGap`: only always-on lifesteal counts while farming between trades; a
 * timed active (Vampiric Burst, 30 s cooldown) is not popped to farm.
 */
function lifestealShares(stats: ItemStats, innate?: ReadonlySet<string>, inGap = false) {
  const s = (k: string) => num(stats[k]);
  const cond = conditionalFor(stats, innate);
  const on = (k: string) => (inGap ? (cond(k) === 1 ? 1 : 0) : cond(k));
  // G2b: Vampiric Burst's active lifesteal (bullet), Spiritual Overflow's
  // charged spirit lifesteal, Infuser's always-on passive spirit lifesteal
  // (a separate API property from its active AbilityLifestealPercentHero).
  return {
    bullet:
      (s("BulletLifestealPercent") / 100) * on("BulletLifestealPercent") +
      (s("ActiveBonusLifesteal") / 100) * on("ActiveBonusLifesteal"),
    spirit:
      (s("AbilityLifestealPercentHero") / 100) * on("AbilityLifestealPercentHero") +
      CONDITIONAL * (s("ImbueAbilityLifesteal") / 100) +
      (s("BonusSpiritLifesteal") / 100) * on("BonusSpiritLifesteal") +
      s("AbilityLifestealPercentHeroPassive") / 100,
  };
}

/** HP an item's stats restore in the gap between trades (before weighting). */
export function gapHealHp(
  stats: ItemStats,
  m: HeroFightModel,
  innate?: ReadonlySet<string>,
): number {
  const s = (k: string) => num(stats[k]);
  const hp = m.maxHealth > 0 ? m.maxHealth : 0;
  const lifesteal = lifestealShares(stats, innate, true);
  const outOfCombatPerSecond =
    s("OutOfCombatHealthRegen") + (s("HealLifePercentOutOfCombat") / 100) * hp;
  // RestoreDelay is only on Fortitude in the catalogue (checked 2026-10-25),
  // where it is the out-of-combat delay.
  const delay = s("RestoreDelay") > 0 ? s("RestoreDelay") : OUT_OF_COMBAT_DELAY;
  return (
    s("BonusHealthRegen") * TRADE_GAP_SECONDS +
    // Out-of-combat regen starts only in the quiet stretch (not farming), and
    // its delay runs inside that stretch.
    outOfCombatPerSecond * Math.max(0, TRADE_GAP_SECONDS * (1 - GAP_FARM_SHARE) - delay) +
    GAP_FARM_SHARE *
      TRADE_GAP_SECONDS *
      (lifesteal.bullet * NON_HERO_BULLET_LIFESTEAL * m.gunDps +
        lifesteal.spirit * NON_HERO_SPIRIT_LIFESTEAL * m.abilityDps)
  );
}

/**
 * HP the owned items heal in one trade (what heal amp multiplies): lifesteal,
 * plus the temporary heals the effect estimator prices (per cast, per proc,
 * timed regeneration, burst heals; `tradeHealHp`). Flat regen stats are not
 * included (Milestone K, docs/milestone-k.md K-1 / K-2). Siphon Bullets
 * (`healPerGunProc`) is left out too: its heal is stolen max health, which amp
 * cannot add to, and the wiki's amplified-items list does not name it.
 */
export function ownedTradeHealHp(
  owned: ReadonlyArray<{ stats: ItemStats; innateStats?: ReadonlyArray<string> }>,
  m: HeroFightModel,
): number {
  let total = 0;
  for (const item of owned) {
    const innate = item.innateStats ? new Set(item.innateStats) : undefined;
    const ls = lifestealShares(item.stats, innate);
    total += (ls.bullet * m.gunDps + ls.spirit * m.abilityDps) * FIGHT_SECONDS;
    for (const e of estimateEffectValues(item.stats)) {
      if (e.unit === "healPerGunProc") continue;
      const healed = tradeHealHp(e, item.stats, m);
      if (healed !== null && Number.isFinite(healed) && healed > 0) total += healed;
    }
  }
  return total;
}

/**
 * HP restored between trades by the hero's base regen and the owned items'
 * stats: the `ownedGapHeal` an item's recovery is priced on top of. Base regen
 * (`HeroBaseStats.healthRegen`) is treated as always on, like BonusHealthRegen:
 * an ASSUMPTION, since deadlock.wiki does not say whether regen ticks in combat
 * (data-verifier, 2026-10-25). Estimator heals and spirit scaling on owned items
 * are not counted (a slight under-count).
 */
export function ownedGapHeal(
  baseRegen: number,
  owned: ReadonlyArray<{ stats: ItemStats; innateStats?: ReadonlyArray<string> }>,
  m: HeroFightModel,
): number {
  let total = num(baseRegen) * TRADE_GAP_SECONDS;
  for (const item of owned) {
    total += gapHealHp(item.stats, m, item.innateStats ? new Set(item.innateStats) : undefined);
  }
  return total;
}
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
  "HealAmpCastPercent",
  "HealAmpRegenPercent",
  "ActiveBonusLifesteal",
  "BonusSpiritLifesteal",
  "AbilityLifestealPercentHeroPassive",
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
  const cond = conditionalFor(stats, innate);
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

  // sustain: healing in the trade, as % of HP, plus recovery before the next.
  // Out-of-combat regen never ticks in a trade: hero damage holds it off.
  const lifesteal = lifestealShares(stats, innate);
  const healPerSecond =
    s("BonusHealthRegen") + lifesteal.bullet * m.gunDps + lifesteal.spirit * m.abilityDps;
  let sustain = ((healPerSecond * FIGHT_SECONDS) / hp) * 100;
  sustain += CONDITIONAL * CHANNEL_HEAL_RATE * s("HealPercentAmount");
  sustain += recoveryValue(gapHealHp(stats, m, innate), hp, m.ownedGapHeal);
  // Heal amplification (Healing Booster, Healing Tempo): % more of the healing
  // the hero already has in a trade. Cast and regen amp are one stat on both
  // shop items, so the larger (after the timed-stat weight; Healing Tempo's
  // cast amp is innate, its regen amp is not) is used once.
  const amp =
    Math.max(
      s("HealAmpCastPercent") * cond("HealAmpCastPercent"),
      s("HealAmpRegenPercent") * cond("HealAmpRegenPercent"),
    ) / 100;
  const ampable = m.ampableHealHp ?? 0;
  if (amp > 0 && ampable > 0) sustain += ((amp * ampable) / hp) * 100;
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
    ((m.chargedAbilityDps ?? m.abilityDps) / dps) *
      CHARGE_UPTIME *
      100 *
      s("BonusAbilityCharges") *
      cond("BonusAbilityCharges") +
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

/** Effect-estimate units that heal the hero (`healCutPercent` cuts the enemy's). */
const HEAL_UNITS: ReadonlySet<NonNullable<EffectEstimate["unit"]>> = new Set([
  "heal",
  "healPerSecond",
  "healPerMeleeHit",
  "healPerProc",
  "healPerGunProc",
  "healPercentPerHeadshot",
]);

/**
 * HP a heal estimate restores inside one trade, averaged over the trades it is
 * ready for; null for units that do not heal the hero. A heal's tail that ticks
 * after the trade (recovery) is not included: `estimateFightValue` prices it
 * separately, and heal amp's base is HP per trade (Milestone K). The quantity is
 * the estimator's, already discounted by EFFECT_CONFIDENCE, so heal amp multiplies
 * the same HP the item itself is valued on.
 */
export function tradeHealHp(e: EffectEstimate, stats: ItemStats, m: HeroFightModel): number | null {
  if (!e.unit || !HEAL_UNITS.has(e.unit) || e.quantity === undefined) return null;
  const q = e.quantity;
  const hp = m.maxHealth;
  const dps = m.gunDps + m.abilityDps;
  if (!(hp > 0) || !(dps > 0)) return null;
  const cooldown = num(stats.AbilityCooldown);
  const duration = num(stats.AbilityDuration);
  const ready = cooldown > 0 ? Math.min(1, TRADE_GAP_SECONDS / cooldown) : 1;
  const lasts = duration > 0 ? Math.min(1, duration / FIGHT_SECONDS) : 1;
  switch (e.unit) {
    case "heal": {
      // A heal over RegenDuration: the share that lands inside the trade.
      const regen = num(stats.RegenDuration);
      const landed = regen > 0 ? Math.min(1, FIGHT_SECONDS / regen) : 1;
      return q * landed * ready;
    }
    case "healPerSecond":
      return q * FIGHT_SECONDS * lasts * ready;
    case "healPerMeleeHit": {
      // Cooldown-gated ("your next melee attack heals"): at most one heal per
      // cooldown, and only when a melee lands.
      const heals = Math.min(
        MELEE_HITS_PER_TRADE,
        cooldown > 0 ? castsPerTrade(cooldown) : MELEE_HITS_PER_TRADE,
      );
      return q * heals * MELEE_LANDS;
    }
    case "healPerProc":
      // Cooldown-gated: castsPerTrade counts procs (and misses for long cooldowns).
      return q * castsPerTrade(cooldown);
    case "healPerGunProc": {
      // Siphon Bullets: once per ProcCooldown while shooting a hero (or less if
      // the hero lands fewer shots), scaled by the gun share like Headhunter.
      const cd = num(stats.ProcCooldown);
      const every = cd > 0 ? cd : DEFAULT_PROC_COOLDOWN_S;
      const rate = Math.min(1 / every, m.landedShotsPerSecond ?? 1 / every);
      const healPerSteal = (q / 100) * (m.enemyHealth ?? REFERENCE_ENEMY_HEALTH);
      return healPerSteal * rate * FIGHT_SECONDS * (m.gunDps / dps);
    }
    case "healPercentPerHeadshot":
      // A headshot needs the gun: scaled by this hero's gun share of damage.
      return (q / 100) * hp * castsPerTrade(cooldown) * HEADSHOT_IN_TRADE * (m.gunDps / dps);
    default:
      return null;
  }
}

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
      // A heal over time longer than the trade finishes in the gap (recovery).
      // Only the part that ticks before the next trade (TRADE_GAP_SECONDS) counts.
      const regen = num(stats.RegenDuration);
      const tail =
        regen > FIGHT_SECONDS ? Math.min(regen - FIGHT_SECONDS, TRADE_GAP_SECONDS) / regen : 0;
      return (
        ((tradeHealHp(e, stats, m) ?? 0) / hp) * 100 +
        recoveryValue(q * tail, hp, m.ownedGapHeal) * ready
      );
    }
    case "healPerSecond": {
      const afterTrade =
        q > 0 && duration > FIGHT_SECONDS
          ? Math.min(duration, FIGHT_SECONDS + TRADE_GAP_SECONDS) - FIGHT_SECONDS
          : 0;
      return (
        ((tradeHealHp(e, stats, m) ?? 0) / hp) * 100 +
        recoveryValue(q * afterTrade, hp, m.ownedGapHeal) * ready
      );
    }
    case "healPerMeleeHit":
    case "healPerProc":
    case "healPerGunProc":
    case "healPercentPerHeadshot":
      return ((tradeHealHp(e, stats, m) ?? 0) / hp) * 100;
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
