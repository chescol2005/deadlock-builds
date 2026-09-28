// lib/engine/itemAdapter.ts
//
// Bridges the real `Item` shape (lib/items.ts, populated from the live
// Deadlock API via lib/itemNormalizer.ts) into the engine's `ItemCandidate`
// shape (lib/engine/types.ts). Until Milestone E, lib/engine/* had only ever
// been exercised against hand-built fixture candidates — this is the first
// place a real Item's `stats` bag (an untyped `Record<string, number>` of raw
// API property keys) gets turned into the engine's typed `categoryValues`.
//
// Design constraints (CLAUDE.md, scoring-engine-dev skill):
// - Pure functions only. No fetch, no Date.now()/Math.random(), no mutation
//   of the input Item, no imports from lib/coach/.
// - TypeScript strict: zero `any`.
// - Unmapped stat keys are ignored silently (see STAT_KEY_TO_SCORE below) —
//   that is NOT a bug. `item.stats` is a large, only partially catalogued
//   surface (lib/statLabels.ts notes ~318 distinct keys observed across
//   shopable items at time of writing); widening this table as more keys get
//   verified is expected and safe.

import type { Item, ItemStats } from "../items";
import { estimateEffectValues } from "./effectEstimator";
import type { ItemCandidate, ScoreCategory } from "./types";
import { SCORE_CATEGORIES } from "./types";

// ─── Per-key weighting ──────────────────────────────────────────────────────
//
// Raw stat values live on very different numeric scales depending on what
// they represent — e.g. `BonusHealth: 300` (flat, hundreds) vs
// `TechResist: 12` (a percent, tens) vs `BonusHealthRegen: 3` (flat, ones).
// Summed unweighted into one categoryValue, a single flat-health item would
// swamp every percent-based item sharing its category. These three weight
// classes are a first-pass, explicitly documented heuristic that brings
// stats onto a roughly comparable order of magnitude — they are NOT derived
// from real win-rate/impact data (that's the Milestone F `itemAnalytics`
// seam described in types.ts's `BasketContext`). Retune per-key once that
// data exists; until then, keep the reasoning visible here rather than
// burying magic numbers at each call site.
const WEIGHT_LARGE_FLAT = 0.1; // hundreds-scale flat stats (e.g. BonusHealth ~150-400) — scaled down to match percent-stat magnitude
const WEIGHT_BASELINE = 1; // percent stats and medium-magnitude flat stats (~5-40) — used near as-is
const WEIGHT_TINY_FLAT = 3; // ones-scale flat stats (regen/sec, m/s, charge counts) — scaled up so they don't vanish next to a 10-30% stat

// Percent stats whose benefit is real but CONDITIONAL or NARROW — headshot
// damage only if you land headshots, melee damage only in builds that melee,
// long-range damage only past a range threshold, and narrow resists (status,
// melee, slow) which cover far less incoming damage than bullet/spirit resist
// does. Discounted relative to unconditional percentages rather than excluded.
const WEIGHT_CONDITIONAL = 0.4;

// Clip size raises DPS only INDIRECTLY, by deferring reloads. Weighted below
// even the conditional class because the effect is second-order: verified
// against Titanic Magazine, whose `BonusClipSizePercent: 100` at 0.4 produced
// 40 points — nearly 3x the 14 from its actual damage percentage, which
// inverted the item's real priorities.
const WEIGHT_CLIP_SIZE = 0.15;

// Stamina charges are single digits (1-2 observed) but each is a whole extra
// dash, so they are weighted above the ones-scale default. Calibrated against
// the existing mobility band: Sprint Boots (BonusMoveSpeed 2.75) scores 8.25,
// so +1 stamina at 4 lands an 800-soul stamina item alongside an 800-soul
// move-speed item rather than an order of magnitude above it.
const WEIGHT_STAMINA = 4;

interface StatMapping {
  category: ScoreCategory;
  weight: number;
}

// Explicit STAT_KEY -> ScoreCategory table.
//
// Sourced from CLAUDE.md's "Stat key mappings" section, which is authoritative
// for this repo (it documents upstream API renames, e.g. the old `BulletDamage`
// key no longer exists — replaced by `BaseAttackDamagePercent`). A handful of
// additional keys with an unambiguous name and a shared-code precedent in
// lib/statLabels.ts are included too, called out individually below.
//
// A key that is NOT in this table is ignored, not guessed at — see
// deriveCategoryValues.
const STAT_KEY_TO_SCORE: Readonly<Record<string, StatMapping>> = {
  // ── spiritDamage ──
  TechPower: { category: "spiritDamage", weight: WEIGHT_BASELINE }, // flat spirit power — CLAUDE.md
  TechPowerPercent: { category: "spiritDamage", weight: WEIGHT_BASELINE }, // % spirit power bonus — CLAUDE.md
  // `SpiritPower` is a SECOND key for the same stat as `TechPower`. Verified
  // across all 156 live items: the two never co-occur (17 items use TechPower,
  // 6 use SpiritPower, zero use both). Only TechPower was mapped, so those 6
  // items silently lost all their spirit power — Counterspell (20), Arcane
  // Surge (20), Alchemical Fire (10), Veil Walker (10), Healing Nova (8),
  // Mystic Shot (7).
  SpiritPower: { category: "spiritDamage", weight: WEIGHT_BASELINE },
  // Further aliases/variants for spirit power and spirit damage, each found
  // unscored during the full-catalogue scrub. Without these, Mystic Reverb
  // (TechDamagePercent 50) scored 8.0 total at 6,400 souls and Surge of Power
  // (ImbuedTechPower 28) scored 5.3 at 3,200 — both far below their tier.
  TechDamagePercent: { category: "spiritDamage", weight: WEIGHT_BASELINE },
  ImbuedTechPower: { category: "spiritDamage", weight: WEIGHT_BASELINE },
  BonusSpirit: { category: "spiritDamage", weight: WEIGHT_BASELINE },
  BonusSpiritForChargedAbilities: { category: "spiritDamage", weight: WEIGHT_CONDITIONAL },
  // % of the target's max health as damage — strong, but only against
  // high-health targets, so discounted rather than taken at face value.
  MaxHealthDamage: { category: "spiritDamage", weight: WEIGHT_CONDITIONAL },
  MagicIncreasePerStack: { category: "spiritDamage", weight: WEIGHT_CONDITIONAL }, // Escalating Exposure ramps per stack

  // ── gunDamage ──
  WeaponPower: { category: "gunDamage", weight: WEIGHT_BASELINE }, // weapon damage % — CLAUDE.md
  BaseAttackDamagePercent: { category: "gunDamage", weight: WEIGHT_BASELINE }, // weapon damage % — replaces the removed BulletDamage key, CLAUDE.md
  // Fire rate multiplies weapon DPS directly and appears on 17 live items
  // (values 5-35) — it was entirely unmapped, which is why an 800-soul item
  // like Rapid Rounds, whose ONLY stat is BonusFireRate, scored zero.
  BonusFireRate: { category: "gunDamage", weight: WEIGHT_BASELINE },
  // `FireRateBonus` is a THIRD spelling of the same concept (Surge of Power
  // carries it). Aliasing is common in this data — check for variants before
  // assuming a key is missing.
  FireRateBonus: { category: "gunDamage", weight: WEIGHT_BASELINE },
  // Range-conditional weapon power. Long Range's entire purpose is
  // `LongRangeBonusWeaponPower: 40`; unmapped, it scored 2.3 total at 1,600.
  LongRangeBonusWeaponPower: { category: "gunDamage", weight: WEIGHT_CONDITIONAL },
  CloseRangeBonusWeaponPower: { category: "gunDamage", weight: WEIGHT_CONDITIONAL },
  // Clip size raises sustained DPS by delaying reload downtime. Weighted below
  // raw damage: a bigger magazine only helps while a fight lasts long enough
  // to empty the old one.
  BonusClipSizePercent: { category: "gunDamage", weight: WEIGHT_CLIP_SIZE },
  BonusClipSize: { category: "gunDamage", weight: WEIGHT_TINY_FLAT },
  HeadShotBonusDamage: { category: "gunDamage", weight: WEIGHT_CONDITIONAL }, // conditional on landing headshots
  // Ramping / proc-conditional weapon damage, each found unscored by the
  // scrub: Intensifying Magazine ramps to +45% after sustained fire, Express
  // Shot's bonus rides on a proc.
  BaseAttackDamagePercentAtMaxDuration: { category: "gunDamage", weight: WEIGHT_CONDITIONAL },
  ProcBaseAttackDamagePercent: { category: "gunDamage", weight: WEIGHT_CONDITIONAL },
  ReloadSpeedMultipler: { category: "gunDamage", weight: WEIGHT_CONDITIONAL }, // API's spelling, not a typo here
  BonusMeleeDamagePercent: { category: "gunDamage", weight: WEIGHT_CONDITIONAL }, // melee is a minority of most builds' damage

  // ── bonusHealth (flat max health) ──
  // Kept separate from `resist` because the two are not interchangeable per
  // hero — see the SCORE_CATEGORIES comment in types.ts for the EHP math.
  BonusHealth: { category: "bonusHealth", weight: WEIGHT_LARGE_FLAT }, // flat health — CLAUDE.md; hundreds-scale, needs the large-flat divisor

  // ── resist (% damage reduction) ──
  // BROAD resists — these cover the bulk of incoming damage, so full weight.
  BulletResist: { category: "resist", weight: WEIGHT_BASELINE }, // % bullet damage resistance — CLAUDE.md
  TechResist: { category: "resist", weight: WEIGHT_BASELINE }, // % spirit damage resistance — CLAUDE.md
  // NARROW resists — each covers a small slice of incoming damage or only
  // shortens crowd control, so they are not worth a point of bullet/spirit
  // resist. Verified by the scrub: at full weight, Blood Tribute's
  // `StatusResistancePercent: 35` alone put it at 96 total for 3,200 souls,
  // the highest value-per-soul in the catalogue by a wide margin.
  StatusResistancePercent: { category: "resist", weight: WEIGHT_CONDITIONAL },
  MeleeResistPercent: { category: "resist", weight: WEIGHT_CONDITIONAL },
  DegenResistance: { category: "resist", weight: WEIGHT_CONDITIONAL },
  SlowResistancePercent: { category: "resist", weight: WEIGHT_CONDITIONAL },
  InnateStatusResistancePercent: { category: "resist", weight: WEIGHT_CONDITIONAL },
  // Deflection returns/negates a share of incoming damage — a genuine
  // mitigation stat. Plated Armor (T4, 6,400) scored only 13.0 without it,
  // because `DeflectionPercent: 30` and `BulletProcDeflectionPercent: 50` were
  // both unmapped.
  DeflectionPercent: { category: "resist", weight: WEIGHT_BASELINE },
  BulletProcDeflectionPercent: { category: "resist", weight: WEIGHT_CONDITIONAL },

  // ── sustain ──
  BonusHealthRegen: { category: "sustain", weight: WEIGHT_TINY_FLAT }, // flat regen/sec — CLAUDE.md; ones-scale
  OutOfCombatHealthRegen: { category: "sustain", weight: WEIGHT_TINY_FLAT }, // CLAUDE.md; ones-scale
  BulletLifesteal: { category: "sustain", weight: WEIGHT_BASELINE }, // lib/statLabels.ts
  TechLifesteal: { category: "sustain", weight: WEIGHT_BASELINE }, // lib/statLabels.ts
  BulletLifestealPercent: { category: "sustain", weight: WEIGHT_BASELINE }, // lib/statLabels.ts
  AbilityLifestealPercentHero: { category: "sustain", weight: WEIGHT_BASELINE }, // lib/statLabels.ts
  ImbueAbilityLifesteal: { category: "sustain", weight: WEIGHT_BASELINE }, // found unmapped on Mystic Reverb during the scrub
  HealLifePercentOutOfCombat: { category: "sustain", weight: WEIGHT_BASELINE },
  HealPercentAmount: { category: "sustain", weight: WEIGHT_BASELINE }, // Rescue Beam's channelled heal

  // ── mobility ──
  MoveSpeed: { category: "mobility", weight: WEIGHT_TINY_FLAT }, // flat m/s bonus — low single digits
  BonusMoveSpeed: { category: "mobility", weight: WEIGHT_TINY_FLAT }, // lib/statLabels.ts
  ActiveBonusMoveSpeed: { category: "mobility", weight: WEIGHT_TINY_FLAT }, // lib/statLabels.ts
  BonusSprintSpeed: { category: "mobility", weight: WEIGHT_TINY_FLAT }, // lib/statLabels.ts
  // Stamina is the dash/jump resource — mobility in practice. Previously
  // unmapped, which zeroed Extra Stamina and Stamina Mastery outright.
  Stamina: { category: "mobility", weight: WEIGHT_STAMINA },
  // These two are PERCENTAGES (12-18 and ~23 observed), not ones-scale counts —
  // weighting them like flat stats put Stamina Mastery at mobility 93 against
  // Sprint Boots' 8.25, an 11x distortion. Percent-scale weight instead.
  StaminaCooldownReduction: { category: "mobility", weight: WEIGHT_CONDITIONAL },
  AirMoveIncreasePercent: { category: "mobility", weight: WEIGHT_CONDITIONAL },
  // ChannelMoveSpeed intentionally omitted — see the sentinel note below.

  // ── shield (barrier absorb) ──
  // Barriers are a THIRD kind of defence, distinct from both flat health and
  // % resist: a fixed pool of absorb that does not scale with max health at
  // all. That makes them cheap effective HP — Reactive Barrier is 325 absorb
  // for 1,600 souls (~4.9 souls/EHP) against Fortitude's 375 health for 3,200
  // (~8.5 souls/EHP) — and proportionally most valuable to low-health heroes,
  // who gain the least from % resist. Offsetting that, they are cooldown-gated
  // and temporary rather than permanent stats, so they are NOT worth a flat
  // health point one-for-one; see SHIELD_SHARE_OF_FLAT in heroNeed.ts.
  //
  // Hundreds-scale like BonusHealth (250-600 observed), so same weight class.
  // Three distinct keys carry the same concept — verified across live items:
  // CombatBarrier (7 items), VexBarrierCombatBarrier (2), GuardianWardCombatBarrier (1).
  // ALL of these were previously unmapped, which scored every barrier item at
  // zero for its barrier: Reactive Barrier's entire 325 absorb was invisible,
  // leaving it net-negative and effectively unbuyable.
  CombatBarrier: { category: "shield", weight: WEIGHT_LARGE_FLAT },
  VexBarrierCombatBarrier: { category: "shield", weight: WEIGHT_LARGE_FLAT },
  GuardianWardCombatBarrier: { category: "shield", weight: WEIGHT_LARGE_FLAT },

  // ── utility ──
  CooldownReduction: { category: "utility", weight: WEIGHT_BASELINE }, // % CDR — lib/statLabels.ts
  BonusAbilityCharges: { category: "utility", weight: WEIGHT_TINY_FLAT }, // flat charge count, typically +1 — lib/statLabels.ts
  // Ability reach/size and duration — real spirit-build utility, on 12 and 6
  // items respectively, previously unmapped (Mystic Expansion and Duration
  // Extender both scored zero as a result).
  TechRangeMultiplier: { category: "utility", weight: WEIGHT_CONDITIONAL },
  TechRadiusMultiplier: { category: "utility", weight: WEIGHT_CONDITIONAL },
  BonusAbilityDurationPercent: { category: "utility", weight: WEIGHT_BASELINE },

  // DELIBERATELY NOT MAPPED — sentinel values, not stats. Verified across all
  // 156 live items: `AbilityCooldownBetweenCharge` is -1 on 156/156,
  // `ChannelMoveSpeed` is -1 on 155/156, and `AbilityCharges` is 0 on 156/156.
  // These are "not applicable" placeholders. Mapping them scored a phantom
  // penalty on EVERY item (-3 utility and -3 mobility at TINY_FLAT weight),
  // which silently understated the real utility/mobility of any item that had
  // some. Do not re-add them without checking their value distribution first.

  // ── economy ──
  // Bonuses that apply only against NON-PLAYERS are farming stats: they speed
  // up clearing creeps and jungle camps, which converts into souls. This is
  // the genuine economy signal the category was waiting for — before the
  // scrub, `economy` was 0 on all 156 items, so Monster Rounds (a pure
  // farming item) scored 3.0 total at 800 souls.
  // All discounted: these percentages are large (25-30) but apply ONLY to
  // creeps and jungle camps, never to enemy heroes. At full weight Monster
  // Rounds jumped to 38 total / 47.5 per 1k souls — the best rate in the
  // catalogue — which overstates a pure farming item.
  NonPlayerBonusWeaponPower: { category: "economy", weight: WEIGHT_CONDITIONAL },
  NonPlayerBulletResist: { category: "economy", weight: WEIGHT_CONDITIONAL },
  BonusWeaponPowerNonPlayer: { category: "economy", weight: WEIGHT_CONDITIONAL },
  WeaponPowerPerStackNonHero: { category: "economy", weight: WEIGHT_CONDITIONAL },
};

function emptyCategoryValues(): Record<ScoreCategory, number> {
  const values = {} as Record<ScoreCategory, number>;
  for (const cat of SCORE_CATEGORIES) values[cat] = 0;
  return values;
}

function deriveCategoryValues(stats: ItemStats): Record<ScoreCategory, number> {
  const values = emptyCategoryValues();

  // Effect/proc estimates are layered ON TOP of the measured stats below, and
  // are already discounted by EFFECT_CONFIDENCE inside the estimator so an
  // inferred value cannot outrank a comparable measured one. Without this, an
  // item whose entire worth is an active — Tesla Bullets, Ricochet, Toxic
  // Bullets — scores zero and is dropped by basketSelect's relevance gate.
  // See effectEstimator.ts for what these numbers do and do not model.
  for (const estimate of estimateEffectValues(stats)) {
    values[estimate.category] += estimate.value;
  }

  for (const [key, rawValue] of Object.entries(stats)) {
    // Defensive: lib/itemNormalizer.ts's parseStats should already guarantee
    // finite numbers, but this adapter does not assume upstream invariants.
    if (!Number.isFinite(rawValue)) continue;

    const mapping = STAT_KEY_TO_SCORE[key];
    if (!mapping) continue; // unmapped key — ignored silently, never guessed

    // Negative values are legitimate here: lib/itemNormalizer.ts deliberately
    // keeps them (debuff-tradeoff items — a stat boosted at another stat's
    // expense). A negative contribution correctly pulls that category down;
    // it is signal, not an error case.
    values[mapping.category] += rawValue * mapping.weight;
  }

  return values;
}

export function toItemCandidate(item: Item): ItemCandidate {
  return {
    itemId: item.id,
    numericId: item.numericId,
    name: item.name,
    category: item.category,
    cost: item.cost,
    categoryValues: deriveCategoryValues(item.stats),
    tags: item.tags,
  };
}

export function toItemCandidates(items: ReadonlyArray<Item>): ItemCandidate[] {
  return items.map(toItemCandidate);
}
