// lib/engine/heroNeed.ts
//
// Derives a hero's `HeroNeedVector` (types.ts) — what stats that hero's kit
// actually wants — from data already sitting in the codebase: the hero's
// abilities, its base stats, and the full hero roster for cross-hero
// normalization. This feeds `constructBasket()` (basketSelect.ts) as the
// target coverage a build should aim for.
//
// Design constraints (CLAUDE.md, scoring-engine-dev skill):
// - Pure function. No fetch, no Date.now()/Math.random(), no mutation of any
//   input, no imports from lib/coach/.
// - TypeScript strict: zero `any`.
// - Deterministic: same inputs -> same output, always.
// - Never return NaN/Infinity. Every branch below is individually guarded,
//   and a final sanitization pass catches anything that slips through.
//
// Honesty over completeness: only gunDamage/spiritDamage and
// tankiness/mobility are backed by a real derivation below. sustain/utility
// are NOT derivable from data currently on HeroAbility/HeroBaseStats — see
// the dedicated comment at NEUTRAL_BASELINE's use for why, and do not treat
// their stubbed value as measured signal.

import type { HeroAbility } from "../abilityCoefficients";
import type { HeroBaseStats } from "../heroStats";
import { calculateStatsAtBoon } from "../heroStats";
import type { HeroNeedVector, ScoreCategory } from "./types";
import { SCORE_CATEGORIES } from "./types";

// ─── Named constants ────────────────────────────────────────────────────────

// Baseline relative weight for a category with no informative signal either
// way. Used as: (a) the stubbed value for sustain/utility/economy (see file
// header), and (b) the "no adjustment" center point that tankiness/mobility
// shift away from once cross-hero normalization has something to say.
const NEUTRAL_BASELINE = 1;

// Full relative weight for a damage category whose signal is maximal — a kit
// scaling entirely off one power type, or a roster-best gun. Sized so a
// mid-strength signal lands near NEUTRAL_BASELINE (1), i.e. "no stronger than
// the stubbed categories," while a standout signal visibly outweighs them.
const DAMAGE_NEED_MAGNITUDE = 2;

// Spirit and gun damage needs are derived from SEPARATE, INDEPENDENT sources
// rather than split as two shares of one budget:
//
//   spiritDamage <- ability scaling coefficients (what the kit scales off)
//   gunDamage    <- the hero's own gun DPS vs. the roster (what the gun is worth)
//
// These genuinely are independent in Deadlock. A hero's abilities can scale
// 100% off spirit while their gun is still one of the best in the game, and
// gun items scale the gun regardless of what the abilities do. Lady Geist is
// exactly this case, verified against live API data: every one of her
// abilities is spirit-scaling (Essence Bomb 1.22, Malice 0.558, Life Drain
// 0.3225, zero weapon scaling) AND her gun gains +1.00 damage per boon,
// ranking 7th of 38 heroes for DPS gained from boons. Treating damage as one
// budget split between two shares would force those facts to compete and would
// wrongly read her as having no gun need at all.
//
// Gun strength MUST be measured as damage x fire rate, never damage alone:
// across the live roster Paige has the highest per-shot damage (35.0) at
// 1.67 shots/s while Calico does 1.8 at 42.86 shots/s. Only the product is
// comparable between heroes.
const GUN_EVAL_BOON = 35;

// Floor on the gun factor. Every Deadlock hero carries a gun and can build
// weapon items, so a gun need of exactly zero is never correct — and zero is
// not merely "low priority" downstream, it is UNREACHABLE: makeBasketContext
// turns a zero need into a zero coverage target, every gun item then scores
// zero coverage gain, and basketSelect's relevance gate drops all of them.
// The floor keeps the worst gun in the roster reachable while still ranking it
// far below the best.
const MIN_GUN_FACTOR = 0.15;

// Assumed distribution of gun-combat engagement ranges, in metres, used to turn
// a weapon's damage-falloff curve into one expected-damage multiplier.
//
// These weights are an ASSUMPTION, not a measurement. No endpoint on
// deadlock-api.com reports engagement distance, so nothing in the data can
// settle them; they are the "lane-typical" calibration, deliberately weighted
// toward mid-range lane fights. Retune HERE, in one place, rather than
// scattering range constants through the module. Weights must sum to 1.
//
// What the choice controls: for a weapon with a hard cutoff, the multiplier is
// exactly the share of weight inside that cutoff. For Graves (17m) this
// distribution puts 55% of engagements in range, so her multiplier is 0.550.
const ENGAGEMENT_RANGE_WEIGHTS: ReadonlyArray<readonly [metres: number, weight: number]> = [
  [5, 0.08],
  [10, 0.2],
  [15, 0.27],
  [20, 0.22],
  [25, 0.15],
  [30, 0.08],
];

// Per-weapon corrections where the generic reading of the API data is wrong.
//
// Hand-authored game knowledge, with the same upkeep shape as GOAL_WEIGHTS_MAP:
// nothing in weapon_info distinguishes either case below, so if another weapon
// shares a quirk we cannot detect it from data and would silently mis-model it.
// One table rather than two sets, so a newly-identified weapon cannot be added
// to one list and forgotten in the other.
type WeaponProfileOverride = {
  // The damage_falloff_* fields are NOT a damage curve: the weapon deals full
  // damage out to falloffEndRange and ZERO past it.
  //
  // Graves' The Teacher reports 7.62m->17.02m at end_scale 0.5, which reads
  // generically as "50% damage past 17m". It is not: her weapon has no damage
  // falloff, and those range fields drive her Build-Up per bullet (most notably
  // Essence Theft) instead. Reading them generically understates her in-range
  // damage AND overstates her out-of-range damage simultaneously.
  readonly hardCutoffAtFalloffEnd?: boolean;
  // Shots are not counted discretely, so the weapon cannot miss and observed
  // accuracy is not merely missing but inapplicable.
  //
  // Verified live: Graves has an analytics row over 536,097 matches reporting
  // total_shots_hit = 0 AND total_shots_missed = 0. This is NOT the same as a
  // hero absent from analytics altogether — see the fallback in effectiveGunDps.
  readonly cannotMiss?: boolean;
};
const WEAPON_PROFILE_OVERRIDES: ReadonlyMap<string, WeaponProfileOverride> = new Map([
  // Graves — The Teacher
  ["citadel_weapon_necro_set", { hardCutoffAtFalloffEnd: true, cannotMiss: true }],
]);

// How far a fully-clamped z-score moves the proc-platform factor from 1.0:
// the roster's best per-hit platform reads 1.35 and the worst 0.65, a ~2x
// spread. Deliberately bounded well below the coverage term's influence — this
// adjusts the ranking among per-hit items, it does not decide the basket.
const PROC_PLATFORM_SWING = 0.35;

// Floor on the range multiplier, for exactly the MIN_GUN_FACTOR reason: a
// multiplier of 0 would zero a hero's effective gun DPS, which then gets
// filtered out of the roster baseline entirely rather than merely ranking last.
const MIN_RANGE_EFFICIENCY = 0.05;

// Cross-hero normalization needs at least 2 heroes to compute a standard
// deviation at all.
const MIN_ROSTER_FOR_NORMALIZATION = 2;

// Clamp z-scores before applying them. Deadlock's hero roster has real
// outliers (e.g. very low/high base health heroes) whose raw z-score could
// otherwise dominate the vector; +/-3 std deviations is already a ~99.7th
// percentile bound, so anything beyond it is capped rather than allowed to
// grow unbounded.
const Z_SCORE_CLAMP = 3;

// How far a fully-clamped z-score (magnitude Z_SCORE_CLAMP) shifts a
// defensive/mobility need away from baseline: the squishiest hero lands at
// 1 + 0.6 = 1.6 and the beefiest at 1 - 0.6 = 0.4, a ~4x spread.
const DEFENSIVE_NEED_SWING = 0.6;

// Floor on any defensive/mobility need. Same hazard as MIN_GUN_FACTOR: zero is
// not "low priority" downstream, it is UNREACHABLE (zero need -> zero coverage
// target -> zero coverage gain -> dropped by basketSelect's relevance gate).
// Without this the roster's beefiest hero derives a defensive need of exactly 0
// and would never be recommended a single health or resist item — verified live
// against Mo & Krill, the highest-health hero. Even the tankiest hero buys
// vitality items; being naturally durable lowers the priority, never to nil.
const MIN_DEFENSIVE_NEED = 0.4;

// How a hero's defensive need divides between flat health and % resist.
// An average-health hero splits evenly; the swing moves a fully-clamped
// z-score to 0.75/0.25 either way. Bounded well short of 0/1 because neither
// item type is ever worthless — resist on a squishy hero is less efficient,
// not useless, and a zero need would be dropped entirely by basketSelect's
// relevance gate.
// Of the flat-EHP portion of a hero's defensive need (i.e. everything that is
// not % resist), how much goes to barrier/shield items rather than flat health.
//
// Barriers are cheaper per point of effective HP — Reactive Barrier is 325
// absorb for 1,600 souls against Fortitude's 375 health for 3,200 — and, like
// flat health, they do not scale with the health pool, so both are worth
// proportionally more to low-health heroes. That is why shield tracks the same
// health-share axis rather than getting its own.
//
// Held to a minority share because barriers are cooldown-gated and temporary
// (45-60s cooldowns, 8-10s durations observed) rather than permanent stats, so
// they should not displace flat health outright despite the better raw rate.
// This is a judgement call on how those two effects trade off, not a measured
// value.
const SHIELD_SHARE_OF_FLAT = 0.4;

// Shred need as a fraction of the damage need it unlocks. A build wants SOME
// shred rather than shred stacked as hard as raw damage: the point of the
// separate category is to guarantee coverage, not to make shred a co-equal
// damage source.
const SHRED_SHARE_OF_DAMAGE = 0.35;

const NEUTRAL_HEALTH_SHARE = 0.5;
const HEALTH_SHARE_SWING = 0.25;
const MIN_HEALTH_SHARE = 0.25;
const MAX_HEALTH_SHARE = 0.75;

// ─── gunDamage / spiritDamage — mechanically derivable ─────────────────────
//
// Strongest signal in this module: HeroAbility carries real Valve-parsed
// `spiritScaling` / `weaponScaling` coefficients (see
// mapApiAbilityToHeroAbility in lib/abilityCoefficients.ts). Summing their
// magnitudes across a hero's kit and taking the proportional split is a
// direct read of how much that hero's damage output scales off each power
// type — no inference required.
/**
 * How much this hero's ability kit scales off spirit, in [0, 1].
 *
 * Returns null when the kit carries no usable scaling signal at all, so the
 * caller can fall back rather than reading a fabricated 0.5 as measured.
 */
function deriveAbilitySpiritShare(abilities: ReadonlyArray<HeroAbility>): number | null {
  let spiritTotal = 0;
  let weaponTotal = 0;

  for (const ability of abilities) {
    if (ability.spiritScaling != null) spiritTotal += Math.abs(ability.spiritScaling);
    if (ability.weaponScaling != null) weaponTotal += Math.abs(ability.weaponScaling);
  }

  if (spiritTotal + weaponTotal > 0) {
    return spiritTotal / (spiritTotal + weaponTotal);
  }

  // No parsed scaling coefficients anywhere in the kit (e.g. a purely
  // passive/utility hero, or a gap in the raw API's scale_function data).
  // Fall back to `damageType` as weaker, corroborating-only signal — it is a
  // categorical tag rather than a magnitude, so "mixed" is split evenly and
  // "none" casts no vote.
  let spiritVotes = 0;
  let weaponVotes = 0;
  for (const ability of abilities) {
    if (ability.damageType === "spirit") spiritVotes += 1;
    else if (ability.damageType === "weapon") weaponVotes += 1;
    else if (ability.damageType === "mixed") {
      spiritVotes += 0.5;
      weaponVotes += 0.5;
    }
    // damageType === "none" contributes no vote either way
  }

  if (spiritVotes + weaponVotes > 0) {
    return spiritVotes / (spiritVotes + weaponVotes);
  }

  // Truly no signal at all (empty kit, or every ability is damageType "none").
  return null;
}

/**
 * NOMINAL gun DPS at max boon — the quantity gun items multiply, assuming every
 * shot lands AND the hero never stops shooting to reload.
 *
 * Uses `calculateStatsAtBoon` rather than re-deriving the boon formula, and
 * multiplies by fire rate because per-shot damage alone is not comparable
 * between heroes (see the GUN_EVAL_BOON comment above).
 *
 * Discounted by a reload-efficiency ratio computed from the hero's own base
 * (boon-0) stats: Valve's `dpsWithReload` versus the naive
 * bulletDamage x bulletsPerSecond product this function used to return
 * unmodified. Verified live against Graves: the naive product overstates her
 * sustained DPS by 43% (35.3 vs 20.2) because her clip empties every ~4s
 * against a 2.8s reload. Applying the RATIO (not the raw with-reload figure)
 * to the boon-scaled burst DPS keeps boon growth and reload downtime as two
 * independently-correct effects instead of conflating them.
 *
 * A hero with no reload data (`dpsWithReload <= 0` — every pre-existing
 * fixture, and any real hero whose weapon_info fetch failed) gets ratio 1: no
 * discount, matching this function's behavior before this field existed. This
 * is the same fail-open policy this module already applies to missing
 * accuracy data.
 */
function nominalGunDps(stats: HeroBaseStats): number {
  const scaled = calculateStatsAtBoon(stats, GUN_EVAL_BOON);
  const burstDps = scaled.bulletDamage * stats.bulletsPerSecond;
  if (!(burstDps > 0)) return 0;

  const baseBurstDps = stats.bulletDamage * stats.bulletsPerSecond;
  const reloadEfficiency =
    stats.dpsWithReload > 0 && baseBurstDps > 0
      ? Math.min(1, stats.dpsWithReload / baseBurstDps)
      : 1;

  const dps = burstDps * reloadEfficiency;
  return Number.isFinite(dps) && dps > 0 ? dps : 0;
}

/** Median of a non-empty numeric list. Deterministic (sorts a copy). */
function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Fraction of this weapon's damage that lands at distance `d` metres.
 *
 * Linear between start and end because damage_falloff_bias is 0.5 on all 44
 * live heroes (verified) — a uniform shape cannot reorder a cross-hero z-score,
 * so a more faithful curve would add precision the ranking cannot use.
 *
 * Fails open at 1 (no discount) when the profile is missing or degenerate,
 * matching how this module already treats absent reload and accuracy data.
 */
function damageScaleAtRange(stats: HeroBaseStats, d: number): number {
  if (WEAPON_PROFILE_OVERRIDES.get(stats.weaponClass)?.hardCutoffAtFalloffEnd) {
    // No falloff — full damage inside the cutoff, nothing at all outside it.
    return stats.falloffEndRange > 0 && d > stats.falloffEndRange ? 0 : 1;
  }

  if (stats.maxRange > 0 && d > stats.maxRange) return 0;

  // No usable profile -> treat as flat. Guards the no-weapon_info case (all
  // zeros) and any inverted/degenerate range pair.
  if (!(stats.falloffEndRange > stats.falloffStartRange)) return 1;

  if (d <= stats.falloffStartRange) return stats.falloffStartScale;
  if (d >= stats.falloffEndRange) return stats.falloffEndScale;

  const t = (d - stats.falloffStartRange) / (stats.falloffEndRange - stats.falloffStartRange);
  return stats.falloffStartScale + (stats.falloffEndScale - stats.falloffStartScale) * t;
}

/**
 * Expected share of nominal damage this weapon lands, over
 * ENGAGEMENT_RANGE_WEIGHTS.
 *
 * This is ORTHOGONAL to the accuracy discount below and composes with it
 * multiplicatively, which is why applying both is not double-counting:
 * accuracy measures which shots LAND (a hit at 30m is still logged as a hit),
 * while this measures how much damage a landed shot actually deals. Neither
 * term can see the other's effect.
 */
function rangeEfficiency(stats: HeroBaseStats): number {
  const expected = ENGAGEMENT_RANGE_WEIGHTS.reduce(
    (acc, [d, w]) => acc + w * damageScaleAtRange(stats, d),
    0,
  );
  if (!Number.isFinite(expected)) return 1;
  return Math.max(MIN_RANGE_EFFICIENCY, Math.min(1, expected));
}

/**
 * EFFECTIVE gun DPS — nominal DPS discounted by how much of it actually lands.
 *
 * Why this matters: nominal DPS assumes perfect accuracy, which systematically
 * over-rates spread/shotgun weapons whose fire rate counts every pellet.
 * Verified live: Calico's nominal DPS is among the highest in the roster, but
 * only 43.5% of her shots land (over 4.3B shots), so gun items buy her far less
 * than the raw number implies. Discounting makes heroes comparable on damage
 * that actually connects.
 *
 * Also discounted by rangeEfficiency() — see that function for why the two
 * terms compose rather than double-count.
 *
 * `accuracyByHeroId` is passed IN (never fetched here — this module stays pure)
 * and is keyed by `HeroBaseStats.heroId`. A hero absent from it falls into one
 * of TWO genuinely different cases, which must not be conflated:
 *
 *  1. The weapon cannot miss (WEAPON_PROFILE_OVERRIDES `cannotMiss`) — shots
 *     are not counted discretely, so accuracy is inapplicable, not unknown.
 *     Treated as 1.0. Its range weakness is carried by rangeEfficiency() from
 *     real weapon data, so charging a miss penalty too would double-count.
 *     Verified live: Graves alone, hit = 0 AND miss = 0 over 536,097 matches.
 *
 *  2. The hero has no analytics row at all — genuinely UNKNOWN accuracy.
 *     Verified live: 5 such heroes (Deadman Danny, Solomon, Violet, Nurse
 *     Harrow, Baba), all recent additions with no match data yet. These fall
 *     back to the median accuracy of heroes that DO have data, deliberately
 *     NOT to 1.0 — leaving them undiscounted while every peer is discounted
 *     inflates them to the top of the roster's gun need, which is exactly the
 *     bug this split exists to prevent.
 */
function effectiveGunDps(
  stats: HeroBaseStats,
  accuracyByHeroId: ReadonlyMap<number, number> | undefined,
  fallbackAccuracy: number | null,
): number {
  const nominal = nominalGunDps(stats) * rangeEfficiency(stats);
  if (!accuracyByHeroId) return nominal; // no accuracy data supplied at all

  const cannotMiss = WEAPON_PROFILE_OVERRIDES.get(stats.weaponClass)?.cannotMiss === true;
  const raw = accuracyByHeroId.get(stats.heroId) ?? (cannotMiss ? 1 : fallbackAccuracy);
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return nominal;

  return nominal * Math.min(1, raw);
}

/**
 * How good this hero is as a platform for PER-HIT item effects, relative to
 * the roster, in [1 - PROC_PLATFORM_SWING, 1 + PROC_PLATFORM_SWING].
 *
 * Why this is a separate signal from gun need: a bullet proc's worth scales
 * with how many bullets land per second, NOT with how much damage each one
 * does. The two can point opposite ways, and Graves is the clearest case —
 * lowest gun need on the roster (3.6 damage per shot, 17m cutoff) while firing
 * 9.8 shots/s and being unable to miss, which makes her one of the best proc
 * platforms in the game. Confirmed from play: her gun builds run Mystic Shot,
 * Toxic Bullets, Ricochet and Tesla Bullets — all per-hit items — rather than
 * raw weapon-damage scaling.
 *
 * Deliberately NOT discounted by range falloff: the question here is how often
 * an effect triggers while she is in a fight she can actually participate in.
 * Her range limit already lowers her gun need; charging it again here would
 * double-count the same weakness, which is the bug this module keeps hitting.
 *
 * Known imprecision, documented rather than hidden: `bulletsPerSecond` counts
 * PELLETS (verified: bullets_per_second = shots_per_second x bullets), so a
 * shotgun reads high here. That is right for per-bullet procs (more pellets =
 * more proc rolls) and wrong for per-SHOT build-ups like Toxic Bullets'
 * `BuildUpPerShot`. Separating them needs `bullets`, which is captured in
 * WeaponItemRaw but not surfaced onto HeroBaseStats — see CLAUDE.md.
 */
export function deriveProcPlatformFactor(input: {
  baseStats: HeroBaseStats;
  roster: ReadonlyArray<HeroBaseStats>;
  gunAccuracyByHeroId?: ReadonlyMap<number, number>;
}): number {
  const { baseStats, roster, gunAccuracyByHeroId } = input;

  // Same policy for the hero and the roster, for the same reason as the gun
  // z-score: a discounted hero compared against undiscounted peers is noise.
  const hitRate = (h: HeroBaseStats): number => {
    const shots = h.bulletsPerSecond;
    if (!Number.isFinite(shots) || shots <= 0) return 0;
    if (!gunAccuracyByHeroId) return shots;

    const cannotMiss = WEAPON_PROFILE_OVERRIDES.get(h.weaponClass)?.cannotMiss === true;
    const measured = gunAccuracyByHeroId.get(h.heroId);
    if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
      return shots * Math.min(1, measured);
    }
    return cannotMiss
      ? shots
      : shots * (median(rosterAccuracies(roster, gunAccuracyByHeroId)) ?? 1);
  };

  const rosterRates = roster.map(hitRate).filter((v) => v > 0);
  const own = hitRate(baseStats);
  if (own <= 0) return 1;

  const z = computeZScore(own, rosterRates);
  const clamped = Math.max(-Z_SCORE_CLAMP, Math.min(Z_SCORE_CLAMP, z));
  return 1 + (clamped / Z_SCORE_CLAMP) * PROC_PLATFORM_SWING;
}

/** Accuracies of roster heroes that actually have measured data. */
function rosterAccuracies(
  roster: ReadonlyArray<HeroBaseStats>,
  accuracyByHeroId: ReadonlyMap<number, number>,
): number[] {
  return roster.flatMap((h) => {
    const a = accuracyByHeroId.get(h.heroId);
    return typeof a === "number" && Number.isFinite(a) && a > 0 ? [a] : [];
  });
}

/**
 * How much this hero's gun is worth investing in, in [MIN_GUN_FACTOR, 1],
 * measured against the rest of the roster.
 *
 * Unlike tankiness/mobility below, this is deliberately NOT compensating: a
 * hero with a strong gun should be steered TOWARD gun items, because weapon
 * items scale the gun they already have. Buying gun items to prop up a weak
 * gun is the losing play, which is exactly the distinction asked for — some
 * heroes' guns are worth investing in and others' are not.
 */
function deriveGunFactor(
  baseStats: HeroBaseStats,
  roster: ReadonlyArray<HeroBaseStats>,
  accuracyByHeroId?: ReadonlyMap<number, number>,
): number {
  // The fallback must be computed once from the heroes that have data, and the
  // SAME discount policy applied to the hero and to every roster member —
  // comparing a discounted hero against nominal peers would be meaningless,
  // since this is a z-score against the roster.
  const known = accuracyByHeroId
    ? roster.flatMap((h) => {
        const a = accuracyByHeroId.get(h.heroId);
        return typeof a === "number" && Number.isFinite(a) && a > 0 ? [a] : [];
      })
    : [];
  const fallback = median(known);

  const rosterDps = roster
    .map((h) => effectiveGunDps(h, accuracyByHeroId, fallback))
    .filter((v) => v > 0);
  const z = computeZScore(effectiveGunDps(baseStats, accuracyByHeroId, fallback), rosterDps);
  const clamped = Math.max(-Z_SCORE_CLAMP, Math.min(Z_SCORE_CLAMP, z));

  // Map z in [-CLAMP, +CLAMP] onto [0, 1], so an average gun sits at 0.5.
  const factor = 0.5 + (clamped / Z_SCORE_CLAMP) * 0.5;
  return Math.max(MIN_GUN_FACTOR, Math.min(1, factor));
}

// ─── tankiness / mobility — derivable via cross-hero normalization ─────────

function computeZScore(value: number, rosterValues: ReadonlyArray<number>): number {
  if (rosterValues.length < MIN_ROSTER_FOR_NORMALIZATION) return 0; // can't normalize against fewer than 2 heroes

  const mean = rosterValues.reduce((sum, v) => sum + v, 0) / rosterValues.length;
  const variance = rosterValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / rosterValues.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0; // every roster hero identical on this stat — no relative signal to extract

  return (value - mean) / stdDev;
}

// Direction chosen here (and the reasoning, so a reviewer can challenge it):
// a hero whose base stat sits BELOW the roster average gets a HIGHER need for
// the corresponding defensive/mobility category — the "compensating"
// interpretation, not the "lean into your strength" one. A squishy hero
// arguably needs tankiness items more than a naturally tanky hero does to
// reach a survivable floor; the same logic is applied to mobility (a
// naturally slow hero needs movement items more to reach a playable baseline)
// for internal consistency, even though the task brief only locked in the
// direction explicitly for tankiness/health. This is a judgment call, not a
// measured fact — an equally defensible "lean into your strength" vector
// would invert the sign.
function deriveDefensiveNeed(heroValue: number, rosterValues: ReadonlyArray<number>): number {
  const z = computeZScore(heroValue, rosterValues);
  const clamped = Math.max(-Z_SCORE_CLAMP, Math.min(Z_SCORE_CLAMP, z));
  const need = NEUTRAL_BASELINE - (clamped / Z_SCORE_CLAMP) * DEFENSIVE_NEED_SWING;

  // Floored at MIN_DEFENSIVE_NEED, never 0 — see that constant for why zero is
  // unreachable rather than merely low.
  return Math.max(MIN_DEFENSIVE_NEED, need);
}

/**
 * Max health at max boon — the pool that resistance multiplies.
 *
 * Uses health at boon cap rather than base health because heroes differ on BOTH
 * axes and the two disagree about who is actually squishy: verified live,
 * Silver's base 830 is mid-roster but she gains only +28/boon, leaving her 5th
 * lowest at the cap, while a lower-base hero with strong per-boon growth ends
 * up ahead of her.
 */
function healthAtMaxBoon(stats: HeroBaseStats): number {
  const scaled = calculateStatsAtBoon(stats, GUN_EVAL_BOON);
  return Number.isFinite(scaled.maxHealth) && scaled.maxHealth > 0 ? scaled.maxHealth : 0;
}

/**
 * How a hero's defensive need divides between flat health and % resistance,
 * returned as the FLAT-HEALTH share in [MIN_HEALTH_SHARE, MAX_HEALTH_SHARE].
 *
 * The mechanic: effective HP is `health / (1 - resist)`, so a percentage resist
 * multiplies the pool you already have. The absolute EHP bought by the same
 * +20% resist is therefore proportional to max health — verified live across
 * the roster, +401 EHP for the squishiest hero versus +801 for the beefiest,
 * exactly 2x for identical spend.
 *
 * So resistance items are genuinely weaker on low-health heroes, and a squishy
 * hero should buy raw health first — both because flat health is worth more to
 * them directly, and because it raises the pool that later resist multiplies.
 * Beefy heroes get the reverse: their large pool makes resist the efficient
 * purchase.
 *
 * Note this is the opposite axis from `deriveDefensiveNeed`, which decides HOW
 * MUCH defence a hero needs (compensating: squishy heroes need more). This
 * decides WHICH KIND, and the two compose.
 */
function deriveHealthShare(heroHealth: number, rosterHealth: ReadonlyArray<number>): number {
  const z = computeZScore(heroHealth, rosterHealth);
  const clamped = Math.max(-Z_SCORE_CLAMP, Math.min(Z_SCORE_CLAMP, z));

  // z < 0 (below-average health) pushes toward flat health; z > 0 toward resist.
  const share = NEUTRAL_HEALTH_SHARE - (clamped / Z_SCORE_CLAMP) * HEALTH_SHARE_SWING;
  return Math.max(MIN_HEALTH_SHARE, Math.min(MAX_HEALTH_SHARE, share));
}

// ─── sustain / utility / economy — NOT derivable yet ───────────────────────
//
// Real sustain/lifesteal signal requires parsing the free-text
// `HeroAbility.upgrades[].statChanges[].stat` / `.delta` pairs (e.g. spotting
// "Lifesteal"/"Regen" keys and summing their deltas) — deliberately out of
// scope for this milestone (tracked as Milestone G in CLAUDE.md). `utility`
// has no comparable derivable source at all on HeroBaseStats/HeroAbility.
// `economy` likewise has nothing to derive from here (mirrors
// itemAdapter.ts's stance: no invented economy signal).
//
// Returning a stubbed NEUTRAL_BASELINE for these three is deliberate and
// documented — NOT a fabricated derived number. Do not let a future edit
// quietly make this look more sophisticated than it is without an actual
// data source backing it.

export function deriveHeroNeedVector(input: {
  abilities: ReadonlyArray<HeroAbility>;
  baseStats: HeroBaseStats;
  roster: ReadonlyArray<HeroBaseStats>; // all heroes, for cross-hero normalization
  /**
   * Observed shot accuracy keyed by `HeroBaseStats.heroId`, used to discount
   * nominal gun DPS to what actually lands. Optional: omitted, gun strength is
   * compared on nominal DPS. Resolve it at the player's own rank with
   * `resolveAccuracyAtRank()` (lib/analyticsStore.ts) — higher-ranked players
   * land more shots, so gun items are worth more to them.
   */
  gunAccuracyByHeroId?: ReadonlyMap<number, number>;
}): HeroNeedVector {
  const { abilities, baseStats, roster, gunAccuracyByHeroId } = input;

  // Two independent damage signals — see the DAMAGE_NEED_MAGNITUDE /
  // GUN_EVAL_BOON comments for why these are NOT two shares of one budget.
  const abilitySpiritShare = deriveAbilitySpiritShare(abilities);

  // Spirit need comes purely from what the abilities scale off. With no
  // scaling signal anywhere in the kit, fall back to the neutral baseline
  // rather than inventing a magnitude.
  const spiritDamage =
    abilitySpiritShare === null ? NEUTRAL_BASELINE : DAMAGE_NEED_MAGNITUDE * abilitySpiritShare;

  // Gun need comes from the hero's own gun relative to the roster, raised if
  // any ability additionally scales off weapon damage (that ability benefits
  // from the same items). Whichever source argues harder for gun items wins.
  const abilityWeaponShare = abilitySpiritShare === null ? 0 : 1 - abilitySpiritShare;
  const gunDamage =
    DAMAGE_NEED_MAGNITUDE *
    Math.max(deriveGunFactor(baseStats, roster, gunAccuracyByHeroId), abilityWeaponShare);

  // Defence resolves in two independent steps: HOW MUCH (compensating —
  // squishy heroes need more) and WHICH KIND (EHP is multiplicative, so
  // squishy heroes want flat health before resist). See deriveHealthShare.
  const rosterHealth = roster.map(healthAtMaxBoon).filter((v) => v > 0);
  const heroHealth = healthAtMaxBoon(baseStats);

  const defensiveNeed = deriveDefensiveNeed(heroHealth, rosterHealth);
  const healthShare = deriveHealthShare(heroHealth, rosterHealth);

  // The flat-EHP budget (health + shield) versus % resist, then split within
  // flat EHP between permanent health and cooldown-gated barriers.
  const flatEhpNeed = defensiveNeed * 2 * healthShare;
  const bonusHealth = flatEhpNeed * (1 - SHIELD_SHARE_OF_FLAT);
  const shield = flatEhpNeed * SHIELD_SHARE_OF_FLAT;
  const resist = defensiveNeed * 2 * (1 - healthShare);
  const mobility = deriveDefensiveNeed(
    baseStats.moveSpeed,
    roster.map((h) => h.moveSpeed),
  );

  // Shred need follows the damage type it unlocks: bullet shred does nothing
  // for a spirit-scaling hero's abilities, and vice versa. Held below the raw
  // damage need because a build wants SOME shred, not shred stacked as hard as
  // damage — the coverage target exists to guarantee the former.
  const gunShred = gunDamage * SHRED_SHARE_OF_DAMAGE;
  const spiritShred = spiritDamage * SHRED_SHARE_OF_DAMAGE;

  const vector: Record<ScoreCategory, number> = {
    gunDamage,
    spiritDamage,
    gunShred,
    spiritShred,
    // Anti-heal is an ENEMY-dependent requirement, not a property of this
    // hero's kit, so it gets a flat baseline rather than a derived value —
    // the same honesty rule as sustain/utility below. A real number needs
    // enemy composition (see EngineInput.matchContext, still unused).
    antiHeal: NEUTRAL_BASELINE,
    bonusHealth,
    resist,
    shield,
    mobility,
    sustain: NEUTRAL_BASELINE, // stubbed — see "sustain / utility / economy" section above
    utility: NEUTRAL_BASELINE, // stubbed — see "sustain / utility / economy" section above
    economy: NEUTRAL_BASELINE, // stubbed — see "sustain / utility / economy" section above
  };

  // Final safety net: every branch above is already individually guarded,
  // but this keeps the "never NaN/Infinity" contract airtight even if a
  // future edit to one branch breaks that guarantee.
  for (const cat of SCORE_CATEGORIES) {
    if (!Number.isFinite(vector[cat])) vector[cat] = NEUTRAL_BASELINE;
  }

  return vector;
}
