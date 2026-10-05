// lib/engine/effectEstimator.ts
//
// Rough value estimates for items whose worth is an ACTIVE or PROC EFFECT
// rather than a stat bonus.
//
// Why this exists: an audit of all 156 live items found 26 (17%) scoring
// exactly zero. Some were simply unmapped stat keys (fixed in itemAdapter.ts),
// but the rest — Tesla Bullets, Ricochet, Toxic Bullets, Alchemical Fire … —
// carry no stat bonus at all. Their entire value is "15% chance to chain 33
// damage to 4 targets". A zero score is not merely inaccurate: downstream a
// zero-coverage candidate is dropped by basketSelect's relevance gate, so
// those items could never be recommended to anyone.
//
// ─── READ THIS BEFORE TRUSTING A NUMBER FROM THIS MODULE ────────────────────
//
// These are ESTIMATES, not measurements. Everything in itemAdapter.ts's
// STAT_KEY_TO_SCORE is a value Valve publishes directly; everything here is
// inferred from effect parameters using assumptions that are documented per
// estimator but are NOT verified against game outcomes. They deliberately do
// not model: target count actually hit, positioning, whether a slow or a DoT
// converts into a kill, or how a proc interacts with the rest of a build.
//
// Consequently every estimate is scaled by EFFECT_CONFIDENCE so an inferred
// value cannot outrank a comparable measured stat. The goal is to move these
// items from "invisible" to "roughly right", not to price them precisely.
//
// ─── WHAT THIS MODULE STRUCTURALLY CANNOT VALUE ─────────────────────────────
//
// Some items are worth little on their own and a great deal in context. That
// is not an estimator that needs tuning — it is value this function cannot see,
// because it receives one item's stats and nothing else. Three real cases,
// confirmed against play knowledge rather than inferred from the data:
//
// 1. COUNTER-PICKS. Armor Piercing Rounds is bought specifically to answer
//    Plated Armor. Its worth is a function of the ENEMY's build, so it scores
//    near the bottom of its tier here and always will. `EngineInput` already
//    carries an unused `matchContext` field — that is the natural home for
//    enemy-composition input, and the correct fix.
//
// 2. COMBO ENABLERS. Vortex Web pulls a group into one spot; its value is
//    almost entirely in what you follow up with — Ivy's ultimate plus grasping
//    vines plus Alchemical Fire, Paradox bomb setups, Doorman dragging several
//    enemies through a door. Its slow and dash-denial ARE scored below, but the
//    grouping that makes it a build-defining pick is interaction value between
//    items and a hero's kit. The mirror of `lib/scoring/antiSynergy.ts`'s
//    hand-authored conflict table — a positive-synergy table — is the shape
//    that fits, and it belongs beside that file rather than here.
//
// 3. ABILITY-DEPENDENT EFFECTS. Echo Shard's reset is worth whatever the
//    ability it resets is worth. It gets a generic floor below; a real number
//    needs the hero's ability list.
//
// The common thread is that all three are INTERACTION value, which is exactly
// the item-covariance layer this project scoped as Milestone F. Do not try to
// close the gap by inflating the per-item constants here — that trades a known
// underestimate for an unknown overestimate on every hero who is not running
// the combo.
//
// Design constraints (CLAUDE.md, scoring-engine-dev skill):
// - Pure functions. No fetch, no Date.now()/Math.random(), no mutation.
// - TypeScript strict: zero `any`. No imports from lib/coach/.
// - Deterministic: same inputs -> same output, always.

import type { ItemStats } from "../items";
import type { ScoreCategory } from "./types";

/**
 * Global discount applied to every estimate in this module.
 *
 * Halving keeps an inferred effect value below a comparable directly-measured
 * stat, which is the intended ordering: when the engine must choose between an
 * item whose value we KNOW and one whose value we GUESSED, it should prefer
 * the known quantity at equal nominal magnitude.
 */
const EFFECT_CONFIDENCE = 0.5;

/**
 * Weight for raw heal/absorb amounts (hundreds-scale), matching
 * WEIGHT_LARGE_FLAT in itemAdapter.ts so a 325 heal and 325 max health land in
 * the same band.
 */
const HEAL_WEIGHT = 0.1;

/**
 * Divisor turning `SlowPercent × SlowDuration` into the same band as other
 * utility contributions (CDR is ~5-20 at baseline weight). A 30% slow for 3.5s
 * yields 105/10 ≈ 10.5 before the confidence discount.
 */
const SLOW_DIVISOR = 10;

/**
 * Utility credited per second of HARD crowd control (silence, stun).
 *
 * Hard CC removes a target from a fight outright rather than degrading them,
 * so a second of it is worth far more than a second of slow. Sized so
 * Silencer's 2.5s silence contributes ~10 after the confidence discount —
 * comparable to a strong CDR roll, which matches its role as a T4 pick.
 */
const HARD_CC_PER_SECOND = 8;

/**
 * Utility credited for a full ability-cooldown reset (Echo Shard).
 *
 * Sized above a strong CooldownReduction roll (those run 5-20) because a reset
 * is strictly better than a percentage on the same ability. Held well below
 * what a reset on a long-cooldown ultimate is genuinely worth, since the payoff
 * is entirely build-dependent — see the call site.
 */
const ABILITY_RESET_UTILITY = 30;

/**
 * Plausible in-game ceiling for a stack counter.
 *
 * `MaxStacks` is 9999 on some items — an "uncapped" sentinel, not a real
 * target. Clamping stops an unbounded counter from dominating every score.
 * 16 is the highest genuine cap observed across the live catalogue.
 */
const STACK_PLAUSIBLE_MAX = 16;

/**
 * Fraction of maximum stacks a player actually holds on average.
 *
 * Stacks accrue over a match and are often lost on death, so crediting an item
 * at full stacks describes a best case rather than a typical one. A judgement
 * call, not a measured rate.
 */
const STACK_REALIZATION = 0.5;

/**
 * Divisor turning gold-per-minute into the economy band.
 *
 * Trophy Collector's 18/min per stack across 16 stacks is 288/min at full
 * stacks — a whole extra item every 10-20 minutes. After realization and this
 * divisor it lands above the farming-speed items (which sit near 10-12),
 * which is the correct ordering: generating souls outright beats clearing
 * creeps slightly faster.
 */
const GOLD_PER_MINUTE_DIVISOR = 5;

/**
 * Discount for percentage soul bonuses that fire only on a specific, rare
 * trigger (Cultist Sacrifice's `BonusSoulsPct: 180` applies to one sacrificed
 * target, not to income generally). Taken at face value it would dwarf every
 * other economy contribution in the catalogue.
 */
const CONDITIONAL_SOULS_WEIGHT = 0.08;

/**
 * Scale for AoE-weapon farming value. Ricochet's 65% bounce and Split Shot's
 * 5 bullets both clear a jungle camp meaningfully faster; sized to sit
 * alongside the dedicated farming items (~10-12 economy) without displacing
 * an item bought purely to farm.
 */
const AOE_FARM_SCALE = 0.25;

/** Mirrors itemAdapter's WEIGHT_TINY_FLAT — ones-scale stats need scaling up. */
const TINY_FLAT_SCALE = 3;

/** Mirrors itemAdapter's WEIGHT_CONDITIONAL — narrow/conditional percentages. */
const CONDITIONAL_SCALE = 0.4;

/**
 * Stacks to credit an item for, given its `MaxStacks`.
 *
 * Clamped to a plausible ceiling (9999 appears as an "uncapped" sentinel) and
 * then scaled by how many stacks a player realistically holds.
 */
function effectiveStacks(stats: ItemStats): number {
  const max = stats["MaxStacks"];
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) return 1;
  return Math.min(max, STACK_PLAUSIBLE_MAX) * STACK_REALIZATION;
}

/** Longest cooldown credited as "repeatable" before uptime weighting bites. */
const MIN_COOLDOWN_FOR_UPTIME = 1;

export type EffectEstimate = {
  category: ScoreCategory;
  value: number;
  /** Human-readable derivation, so an estimate is never an unexplained number. */
  basis: string;
  /**
   * True when this estimate's value is delivered PER WEAPON HIT (a bullet proc,
   * an on-hit build-up, a per-shot bounce) rather than by a flat stat or a
   * cooldown-gated active.
   *
   * The value itself is deliberately hero-independent — the estimator never
   * sees a hero. This flag is what lets a later, hero-aware consumer scale it:
   * the same proc is worth more to a high-fire-rate, reliably-hitting hero than
   * to a slow single-shot one. See `procReliance` in itemAdapter.ts and
   * `procPlatformTerm` in basketSelect.ts.
   */
  perHit?: boolean;
};

function num(stats: ItemStats, key: string): number | null {
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Positive magnitude of a stat that is stored as a negative (enemy debuffs). */
function magnitude(stats: ItemStats, key: string): number {
  const v = num(stats, key);
  return v == null ? 0 : Math.abs(v);
}

/**
 * Fraction of the time a duration-limited active is up.
 *
 * Applied only to SUSTAINED effects (a burning ground patch, a temporary buff).
 * Instant effects — a burst heal, a one-shot nuke — are not divided by their
 * cooldown: they are repeatable over a match, and treating a 60s cooldown as a
 * 60x penalty would understate them badly.
 */
function uptime(stats: ItemStats): number {
  const duration = num(stats, "AbilityDuration");
  const cooldown = num(stats, "AbilityCooldown");
  if (duration == null || cooldown == null || cooldown < MIN_COOLDOWN_FOR_UPTIME) return 1;
  return Math.min(1, duration / cooldown);
}

/**
 * Estimates per-effect contributions for one item's raw stats.
 *
 * Returns [] for an item with no recognised effect cluster — silence is
 * correct there, and callers must not treat [] as "worthless".
 */
export function estimateEffectValues(stats: ItemStats): EffectEstimate[] {
  const out: EffectEstimate[] = [];
  const add = (category: ScoreCategory, raw: number, basis: string) => {
    if (!Number.isFinite(raw) || raw <= 0) return;
    out.push({ category, value: raw * EFFECT_CONFIDENCE, basis });
  };
  /** As `add`, for value delivered per weapon hit. See EffectEstimate.perHit. */
  const addPerHit = (category: ScoreCategory, raw: number, basis: string) => {
    if (!Number.isFinite(raw) || raw <= 0) return;
    out.push({ category, value: raw * EFFECT_CONFIDENCE, basis, perHit: true });
  };

  // ── Is a "proc" per-bullet, or gated behind a cooldown? ──
  // These are mechanically different and the catalogue separates them cleanly
  // (verified live across all 10 ProcChance items):
  //
  //  - ProcChance 100 WITH a non-zero AbilityCooldown = a single buffed bullet,
  //    then the effect goes on cooldown. Mystic Shot (8s), Headhunter (8s),
  //    Headshot Booster (9s), Restorative Shot (6s), Haunting Shot (2.5s).
  //    Throughput is one per COOLDOWN, not one per bullet, so firing faster
  //    does not trigger it more often.
  //  - ProcChance < 100 with no AbilityCooldown = a genuine per-bullet roll.
  //    Tesla Bullets (15%), Lucky Shot (25%), Armor Piercer (55%), Infinite
  //    Rounds (65%). Here firing faster really does mean more procs.
  //
  // Only the second kind may be flagged `perHit`. Flagging the first gave a
  // high-fire-rate hero credit for a rate they cannot influence.
  const procChance = num(stats, "ProcChance");
  const procAbilityCooldown = num(stats, "AbilityCooldown");
  const isCooldownGatedProc =
    procChance === 100 && procAbilityCooldown != null && procAbilityCooldown > 0;
  /** `addPerHit` for a true per-bullet roll, plain `add` for a cooldown-gated one. */
  const addProc = (category: ScoreCategory, raw: number, basis: string) => {
    if (isCooldownGatedProc) {
      add(category, raw, `${basis}, once per ${procAbilityCooldown}s cooldown`);
    } else {
      addPerHit(category, raw, basis);
    }
  };

  // ── Chaining bullet procs (Tesla Bullets, Capacitor) ──
  // Expected damage per triggering shot: damage x targets x P(proc).
  // Ignores ChainRadius/ChainTickRate — whether the extra targets are in range
  // is a positioning question this cannot see.
  const chainDamage = num(stats, "DamagePerChain");
  const chainCount = num(stats, "ChainCount");
  if (chainDamage != null && chainCount != null && procChance != null) {
    addProc(
      "gunDamage",
      chainDamage * chainCount * (procChance / 100),
      `${chainDamage} dmg x ${chainCount} chained targets x ${procChance}% proc`,
    );
  }

  // ── On-hit magic proc (Mystic Shot) ──
  const procMagic = num(stats, "ProcBonusMagicDamage");
  if (procMagic != null && procChance != null) {
    addProc(
      "spiritDamage",
      procMagic * (procChance / 100),
      `${procMagic} bonus spirit damage x ${procChance}% proc`,
    );
  }

  // ── Crit proc (Lucky Shot) ──
  const crit = num(stats, "CritDamagePercent");
  if (crit != null && procChance != null) {
    addProc("gunDamage", crit * (procChance / 100), `+${crit}% crit damage x ${procChance}% proc`);
  }

  // ── Damage over time (Toxic Bullets) ──
  // DotHealthPercent is % of the TARGET's max health per tick, so total is
  // scaled by tick count. Percent-of-max-health is strong against high-health
  // targets and this does not attempt to model that.
  const dotPct = num(stats, "DotHealthPercent");
  const dotDuration = num(stats, "DotDuration");
  const tickRate = num(stats, "TickRate");
  if (dotPct != null && dotDuration != null && tickRate != null && tickRate > 0) {
    const ticks = dotDuration / tickRate;
    addPerHit(
      "gunDamage",
      dotPct * ticks,
      `${dotPct}% max-health per tick x ${ticks.toFixed(0)} ticks`,
    );
  }

  // ── Ricochet ──
  // A straight fraction of weapon damage repeated onto nearby targets.
  const ricochet = num(stats, "RicochetDamagePercent");
  if (ricochet != null) {
    addPerHit("gunDamage", ricochet, `${ricochet}% of weapon damage bounced to nearby targets`);
  }

  // ── Sustained ground/area DPS (Alchemical Fire, Spirit Burn) ──
  // Uptime-weighted: a 5s burn on a 30s cooldown is not 45 sustained DPS.
  const dps = num(stats, "DPS");
  if (dps != null) {
    const up = uptime(stats);
    add("spiritDamage", dps * up, `${dps} area DPS x ${(up * 100).toFixed(0)}% uptime`);
  }

  // ── Burst damage actives (Mystic Burst, Capacitor, Quicksilver Reload) ──
  // Not divided by cooldown: a repeatable nuke keeps its per-cast value.
  const burst = num(stats, "Damage") ?? num(stats, "SpiritDamage");
  if (burst != null) {
    add("spiritDamage", burst, `${burst} burst damage per cast`);
  }
  const explosion = num(stats, "ExplosionDamage");
  if (explosion != null) {
    add("spiritDamage", explosion, `${explosion} explosion damage`);
  }

  // ── Burst heal (Healing Nova) and on-hit heal (Melee Lifesteal) ──
  const heal = num(stats, "TotalHealthRegen");
  if (heal != null) {
    add("sustain", heal * HEAL_WEIGHT, `${heal} health restored per cast`);
  }
  const lifestrike = num(stats, "LifestrikeHeal");
  if (lifestrike != null) {
    add("sustain", lifestrike * HEAL_WEIGHT, `${lifestrike} health per melee hit`);
  }

  // ── Slows / movement debuffs (Slowing Bullets, Capacitor, Cursed Relic) ──
  const slow = num(stats, "SlowPercent") ?? num(stats, "MaxSlowPercent");
  const slowDuration = num(stats, "SlowDuration") ?? num(stats, "AbilityDuration");
  if (slow != null && slowDuration != null) {
    add("utility", (slow * slowDuration) / SLOW_DIVISOR, `${slow}% slow for ${slowDuration}s`);
  }

  // ── Enemy resist/armour reduction = OFFENSIVE value ──
  // These are stored NEGATIVE because they reduce the target's stat, but they
  // amplify the buyer's damage. Mapping them naively in STAT_KEY_TO_SCORE would
  // subtract from the buyer's score, exactly inverting their worth — which is
  // why they live here, sign-corrected, rather than in the stat table.
  // Routed to the dedicated shred categories, NOT to raw damage: past a certain
  // enemy resist level more damage stops converting and only shred unlocks it,
  // so the basket needs a separate coverage target rather than treating shred
  // as interchangeable with a damage roll.
  const bulletShred =
    magnitude(stats, "BulletArmorReduction") + magnitude(stats, "BulletResistReduction");
  if (bulletShred > 0) {
    add("gunShred", bulletShred, `reduces enemy bullet resist by ${bulletShred}%`);
  }
  const spiritShred =
    magnitude(stats, "MagicResistReduction") + magnitude(stats, "TechArmorDamageReduction");
  if (spiritShred > 0) {
    add("spiritShred", spiritShred, `reduces enemy spirit resist by ${spiritShred}%`);
  }

  // NOT shred: these cut the enemy's damage OUTPUT rather than their
  // resistance, so they protect you instead of amplifying you. Grouping them
  // with shred would have credited them as offence.
  const enemyOutputCut =
    magnitude(stats, "TechPowerReduction") + magnitude(stats, "TechDamageReduction");
  if (enemyOutputCut > 0) {
    add(
      "utility",
      enemyOutputCut * CONDITIONAL_SCALE,
      `cuts enemy spirit output by ${enemyOutputCut}`,
    );
  }

  // ── Anti-heal ──
  // `HealAmpReceivePenaltyPercent` and `HealAmpRegenPenaltyPercent` are always
  // paired at the same value across the live catalogue (both -35 on Toxic
  // Bullets, both -70 on Spirit Burn), so the larger is taken rather than the
  // sum — adding them would double-count one effect.
  const healCut = Math.max(
    magnitude(stats, "HealAmpReceivePenaltyPercent"),
    magnitude(stats, "HealAmpRegenPenaltyPercent"),
  );
  if (healCut > 0) {
    add("antiHeal", healCut, `cuts enemy healing and regen by ${healCut}%`);
  }

  // ── AoE weapon effects clear jungle camps faster ──
  // Ricochet bounces to nearby targets and Split Shot fires several bullets at
  // once, so both hit multiple creeps per shot. That is farming speed, i.e.
  // souls, on top of their combat value.
  const aoeShot =
    (num(stats, "RicochetDamagePercent") ?? 0) + (num(stats, "BulletSplitShot") ?? 0) * 10;
  if (aoeShot > 0) {
    add("economy", aoeShot * AOE_FARM_SCALE, "hits several jungle creeps per shot");
  }

  // ── Hard crowd control (Silencer, stun items) ──
  // Silence and stun are among the strongest effects in the game per second
  // applied, so they are credited well above a slow of the same duration.
  // Silencer (T4, 6,400) scored only 12.0 before this, because its 2.5s
  // silence — the entire reason to buy it — was unmapped.
  const silence = num(stats, "SilenceDuration");
  if (silence != null) {
    add("utility", silence * HARD_CC_PER_SECOND, `${silence}s silence`);
  }
  const stun = num(stats, "StunDuration");
  if (stun != null) {
    add("utility", stun * HARD_CC_PER_SECOND, `${stun}s stun`);
  }

  // ── Soft crowd control: movement and fire-rate slows ──
  const moveSlow = num(stats, "MovementSpeedSlow");
  if (moveSlow != null) {
    add("utility", moveSlow / SLOW_DIVISOR, `${moveSlow}% movement slow`);
  }
  const fireRateSlow = num(stats, "FireRateSlow");
  if (fireRateSlow != null) {
    add("utility", fireRateSlow / SLOW_DIVISOR, `${fireRateSlow}% fire-rate slow`);
  }
  // Denying an enemy their dash is a real lockdown effect; stored negative
  // because it reduces the target's dash distance.
  const dashDenial = magnitude(stats, "GroundDashReductionPercent");
  if (dashDenial > 0) {
    add("utility", dashDenial / SLOW_DIVISOR, `cuts enemy dash distance by ${dashDenial}%`);
  }

  // ── Enemy output debuffs (Cursed Relic) — defensive utility ──
  const outgoingPenalty = magnitude(stats, "OutgoingDamagePenaltyPercent");
  if (outgoingPenalty > 0) {
    add("utility", outgoingPenalty, `reduces enemy damage output by ${outgoingPenalty}%`);
  }
  // (Anti-heal is handled above, in its own category — not here as utility.)

  // ── Per-stack effects ──
  // Several items grant a small bonus per accumulated stack. Credited at a
  // realistic stack count (see effectiveStacks) rather than the theoretical max.
  const stacks = effectiveStacks(stats);
  const st = stacks.toFixed(0);

  const perStack = num(stats, "WeaponPowerPerStack") ?? num(stats, "WeaponDamagePerStack");
  if (perStack != null) {
    add("gunDamage", perStack * stacks, `+${perStack}% weapon power x ~${st} stacks`);
  }
  const healPerStack = num(stats, "HealPerStack");
  if (healPerStack != null) {
    add("sustain", healPerStack * stacks * HEAL_WEIGHT, `${healPerStack} heal x ~${st} stacks`);
  }
  const sprintPerStack = num(stats, "StackingBonusSprintSpeed");
  if (sprintPerStack != null) {
    add(
      "mobility",
      sprintPerStack * stacks * TINY_FLAT_SCALE,
      `+${sprintPerStack} sprint speed x ~${st} stacks`,
    );
  }
  const reachPerStack =
    (num(stats, "StackingTechRangeMultiplier") ?? 0) +
    (num(stats, "StackingTechRadiusMultiplier") ?? 0);
  if (reachPerStack > 0) {
    add(
      "utility",
      reachPerStack * stacks * CONDITIONAL_SCALE,
      `+${reachPerStack}% ability reach x ~${st} stacks`,
    );
  }
  const healthPerStack = num(stats, "StackingBonusHealth");
  if (healthPerStack != null) {
    add(
      "bonusHealth",
      healthPerStack * stacks * HEAL_WEIGHT,
      `${healthPerStack} health x ~${st} stacks`,
    );
  }

  // ── Soul generation — the economy category's strongest signal ──
  // Trophy Collector grants 18 souls/min PER STACK up to 16 stacks. That was
  // entirely unmapped while its `NonPlayerBonusWeaponPower: -15` farming
  // penalty WAS counted, leaving a soul-generating item at economy -6.0: its
  // drawback scored and its entire purpose invisible.
  const goldPerMin = num(stats, "StackingGoldPerMinute");
  if (goldPerMin != null) {
    const perMin = goldPerMin * stacks;
    add(
      "economy",
      perMin / GOLD_PER_MINUTE_DIVISOR,
      `${goldPerMin} souls/min x ~${st} stacks = ~${perMin.toFixed(0)}/min`,
    );
  }
  const soulsPct = num(stats, "BonusSoulsPct");
  if (soulsPct != null) {
    add(
      "economy",
      soulsPct * CONDITIONAL_SOULS_WEIGHT,
      `+${soulsPct}% souls on a specific trigger`,
    );
  }

  // ── SELF-DAMAGE DRAWBACKS — a real cost, not a benefit ──
  // Some items buy power with the player's own health. Blood Tribute drains 50
  // HP/s while active; ignoring that made it the highest value-per-soul item in
  // the catalogue, which is exactly backwards for an item with a real downside.
  // Emitted as a NEGATIVE sustain contribution so the cost is visible in the
  // score rather than silently dropped.
  const selfDrain = num(stats, "HealthDrainedPerSecond");
  if (selfDrain != null && selfDrain > 0) {
    out.push({
      category: "sustain",
      value: -selfDrain * HEAL_WEIGHT * EFFECT_CONFIDENCE,
      basis: `drains ${selfDrain} of the user's own health per second`,
    });
  }

  // ── Ability cooldown RESET (Echo Shard) ──
  // Resetting an imbued ability's cooldown is worth roughly one extra cast of
  // that ability per this item's own cooldown — strictly better than a
  // percentage CDR roll on the same ability, which is why it is credited above
  // the typical CooldownReduction value (5-20).
  //
  // Deliberately generic: the true worth depends entirely on WHICH ability is
  // being reset, which this module cannot see. A hero whose best ability is a
  // long-cooldown ultimate gains far more than one with cheap, spammable
  // abilities. Treat the result as a floor on a build-dependent value, not as
  // the item's ceiling.
  if (num(stats, "ImbuedCooldownMultiplier") != null) {
    add("utility", ABILITY_RESET_UTILITY, "resets an imbued ability's cooldown");
  }

  // ── Percent damage amp (Focus Lens) ──
  const percentDamage = num(stats, "PercentDamage");
  if (percentDamage != null) {
    add("spiritDamage", percentDamage * uptime(stats), `+${percentDamage}% damage while active`);
  }

  return out;
}
