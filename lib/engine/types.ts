import type { ItemAnalytics } from "../analyticsStore";
import type { ItemCategory } from "../items";

export const INTENT_KEYS = ["burst", "sustain", "tank", "mobility", "utility"] as const;

export type IntentKey = (typeof INTENT_KEYS)[number];

// `damage` was split into `gunDamage`/`spiritDamage` in Milestone E: a single
// damage dimension cannot distinguish a spirit-scaling hero's needs from a
// gun-scaling one's, which is the whole point of a hero need vector. The split
// is behaviour-preserving for the pre-existing intent-driven path — see the
// INTENT_TO_CATEGORIES note in stages/baseCategoryStage.ts.
// `tankiness` was split into `bonusHealth`/`resist` for the same reason
// `damage` was split: they are not interchangeable per hero. Effective HP is
// `health / (1 - resist)`, so a percentage resist multiplies the health pool
// you already own — the SAME +20% resist is worth ~2x more absolute EHP to the
// roster's beefiest hero than to its squishiest (verified live: +801 vs +401
// EHP). Collapsing both into one score would hide that.
export const SCORE_CATEGORIES = [
  "gunDamage",
  "spiritDamage",
  // Resist SHRED is tracked apart from raw damage because the two are not
  // substitutes: past a certain enemy resist level, more damage items stop
  // converting into damage taken and only shred unlocks it. Separate targets
  // make the basket buy some rather than stacking pure damage — the same
  // reasoning that split bonusHealth from resist. Split by damage type because
  // bullet shred does nothing for a spirit-scaling hero's abilities.
  "gunShred", // reduces enemy bullet resist/armour
  "spiritShred", // reduces enemy spirit resist/armour
  // Healing reduction. Also a non-substitutable requirement: against a healing
  // enemy, raw damage alone can fail to out-pace their sustain at any amount.
  "antiHeal",
  "bonusHealth", // flat max-health items
  "resist", // % bullet/spirit/status damage resistance
  "shield", // barrier/shield absorb (CombatBarrier & friends)
  "sustain", // lifesteal, regen, healing items
  "mobility",
  "utility",
  "economy",
] as const;

export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

export type IntentWeights = Readonly<Record<IntentKey, number>>;

export interface EngineInput {
  heroId: string;
  intent: IntentWeights;
  currentItems: ReadonlyArray<string>;
  matchContext?: Readonly<Record<string, string | number | boolean>>;
}

export interface ScoreBreakdown {
  byCategory: Partial<Record<ScoreCategory, number>>;
  total: number;
}

export interface ItemCandidate {
  itemId: string;
  /** Raw numeric API id — joins to `ItemAnalytics.itemId`. See lib/analyticsStore.ts. */
  numericId: number;
  name: string;
  /** Shop category, needed to track souls-per-category for the investment bonus. */
  category: ItemCategory;
  cost: number;
  categoryValues: Readonly<Record<ScoreCategory, number>>;
  /**
   * Share of this item's scored magnitude delivered PER WEAPON HIT, in [0, 1]
   * (bullet procs, on-hit build-ups, per-shot bounces). 0 for items with no
   * per-hit mechanic.
   *
   * Hero-independent: it says how much of the item rides on landing bullets,
   * NOT how well a given hero lands them. `procPlatformTerm` supplies the
   * hero half.
   */
  procReliance: number;
  tags: ReadonlyArray<string>;
}

export interface StageScore {
  stageId: string;
  byCategory: Partial<Record<ScoreCategory, number>>;
  total: number;
  reasons: ReadonlyArray<string>;
}

export interface ItemRecommendation {
  item: ItemCandidate;
  finalScore: number;
  breakdown: ScoreBreakdown;
  stageScores: ReadonlyArray<StageScore>;
  reasons: ReadonlyArray<string>;
}

export interface EngineOutput {
  version: 1;
  normalizedIntent: IntentWeights;
  recommendations: ReadonlyArray<ItemRecommendation>;
}

export interface ScoringStage {
  stageId: string;
  score(input: EngineInput, candidate: ItemCandidate): StageScore;
}

// ─── Milestone E: hero need vector + basket construction ─────────────────────
//
// These types support `constructBasket()` (basketSelect.ts), a JOINT selection
// pass over a whole build, as opposed to `recommendItems()` above which scores
// every candidate independently. They deliberately do NOT reuse
// `EngineInput.intent`/`IntentKey`: intent is a player-chosen preset, while a
// need vector is derived from a hero's actual kit, and conflating them would
// couple the new path to the existing one's normalization.

/**
 * A hero's derived need profile, expressed as target coverage per category.
 *
 * Values are relative weights (not normalized to sum to 1 — `constructBasket`
 * scales them into coverage units via its `coverageTargetPerSlot` option).
 */
export type HeroNeedVector = Readonly<Record<ScoreCategory, number>>;

/** One additive component of a candidate's marginal value, kept for explainability. */
export interface MarginalTerm {
  termId: string;
  value: number;
  reason: string;
}

/** Mutable-per-iteration state the greedy loop threads through each term. */
export interface BasketState {
  picked: ReadonlyArray<ItemCandidate>;
  /** Cumulative category values of everything picked so far. */
  coverage: Readonly<Record<ScoreCategory, number>>;
  /** Cumulative souls committed per shop category (drives the investment bonus). */
  soulsPerCategory: Readonly<Record<ItemCategory, number>>;
  spent: number;
}

/** Immutable per-run context. */
export interface BasketContext {
  needVector: HeroNeedVector;
  /** Scaled target coverage per category, derived from needVector. */
  target: Readonly<Record<ScoreCategory, number>>;
  soulBudget: number;
  maxItems: number;
  /**
   * Optional real win-rate data, keyed by `ItemCandidate.numericId`.
   * ALWAYS passed in — never fetched inside the engine, which must stay pure.
   */
  itemAnalytics?: ReadonlyMap<number, ItemAnalytics>;
  /**
   * How good this hero is as a platform for per-hit effects, relative to the
   * roster: shots landed per second versus peers. 1 = roster-average, >1 better.
   *
   * ALWAYS passed in (derived by `deriveProcPlatformFactor` in heroNeed.ts) —
   * never computed inside basketSelect, which sees no hero stats. Omitted, the
   * proc term is inert, so an omitted factor can never silently bias a basket.
   */
  procPlatformFactor?: number;
}

/**
 * A pluggable additive contributor to a candidate's marginal value.
 *
 * This is the Milestone F seam: an empirical item-pair/covariance term plugs in
 * here as one more entry, with no change to the greedy loop, the need-vector
 * deriver, or the UI. Every term MUST be pure — same inputs, same output.
 */
export interface MarginalTermFn {
  termId: string;
  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null;
}

export interface BasketPick {
  item: ItemCandidate;
  marginalValue: number;
  terms: ReadonlyArray<MarginalTerm>;
  /** Cumulative coverage AFTER this pick — lets the UI show progress per step. */
  coverageAfter: Readonly<Record<ScoreCategory, number>>;
  cumulativeCost: number;
}

export interface BasketResult {
  version: 1;
  needVector: HeroNeedVector;
  target: Readonly<Record<ScoreCategory, number>>;
  picks: ReadonlyArray<BasketPick>;
  totalCost: number;
  coverage: Readonly<Record<ScoreCategory, number>>;
  /** Per-category shortfall vs. `target`, floored at 0. Drives "still needs…" copy. */
  unmetNeed: Readonly<Record<ScoreCategory, number>>;
  /** Why the loop stopped — surfaced in the UI so an empty/short basket is explainable. */
  stopReason: "budget" | "slots" | "no-positive-value" | "no-candidates";
}
