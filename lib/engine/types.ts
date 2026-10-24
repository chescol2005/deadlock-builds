import type { ItemAnalytics } from "../analyticsStore";
import type { ItemCategory } from "../items";
import type { HeroPairLift } from "./pairLift";

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
  /**
   * Share of this item's scored magnitude that needs a shot to CONNECT but
   * whose rate is fixed by a cooldown, in [0, 1] (Mystic Shot and the other
   * ProcChance-100 cooldown-gated bullet effects).
   *
   * Distinct from `procReliance` because it earns a different hero-side
   * multiplier: accuracy ALONE, never fire rate. Firing faster cannot make an
   * 8s cooldown come up more often, but missing still wastes the charge.
   */
  hitDependence: number;
  tags: ReadonlyArray<string>;
  /**
   * DIRECT shop components (`Item.componentItems`). Buying this item while
   * holding one consumes it: the price drops by the component's cost and this
   * item's stats REPLACE the component's (verified 2026-10-20 against
   * deadlock.wiki/Items and the live item API). Omitted = no components.
   */
  componentIds?: ReadonlyArray<string>;
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
  /** This basket's picks so far, in order (owned items are never here). */
  picked: ReadonlyArray<ItemCandidate>;
  /**
   * Everything currently held: owned items plus picks, minus components an
   * upgrade consumed. `coverage` and `soulsPerCategory` are sums over it.
   * Omitted (hand-built test states) = same as `picked`.
   */
  held?: ReadonlyArray<ItemCandidate>;
  /** Category values summed over everything HELD (owned + picks − consumed). */
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
  /**
   * How reliably this hero lands individual shots, relative to the roster.
   * 1 = roster-average, >1 better. Scales `hitDependence` items only.
   *
   * ALWAYS passed in (derived by `deriveHitReliabilityFactor` in heroNeed.ts).
   * Omitted, the hit-reliability term is inert.
   */
  hitReliabilityFactor?: number;
  /**
   * Items the player ALREADY OWNS, itemId -> display name. They are excluded
   * from the candidates, so without this `synergyTerm` could only see pairs
   * completed inside the basket and would miss the common case: owning Heroic
   * Aura and being offered Mystic Shot. Omitted => only basket picks count.
   */
  ownedItemNames?: ReadonlyMap<string, string>;
  /**
   * This hero's slice of the measured pair-lift table (Milestone F), from
   * `heroPairLift` in pairLift.ts. ALWAYS passed in: the committed table is
   * loaded server-side and sliced per hero, never read inside the engine.
   * Omitted => pairTerm is inert and synergyTerm's hand rules are never
   * overridden.
   */
  pairLift?: HeroPairLift;
  /**
   * Items already owned, as candidates (valued like the candidates). They seed
   * the basket's coverage, investment souls and held set, and an upgrade can
   * consume them. Empty when nothing is owned.
   */
  owned: ReadonlyArray<ItemCandidate>;
  /**
   * Slots the coverage target spans: owned items + free slots (`maxItems`).
   * Owned coverage counts toward the target, so the target must cover the whole
   * build, not just the free slots. Equals `maxItems` when nothing is owned.
   */
  targetSlots: number;
  /**
   * This hero's measured shop-category split (heroCategorySplit.json), already
   * floored. Drives `categorySplitTerm`; omitted => that term is inert.
   */
  categorySplit?: {
    gun: number;
    spirit: number;
    vitality: number;
    /** e.g. "Oracle+ players (last 30 days)" — quoted in the reason. */
    scope: string;
    /**
     * What the shares measure, quoted in the reason after `scope`: e.g. "buy in
     * the first 10 minutes" for a phase split. Omitted => "end games with".
     */
    basis?: string;
  };
  /**
   * Game phase of this basket (categorySplit.phaseForSouls), set by the hero
   * pipeline. Tempo pricing applies in the laning phase ("early") only.
   * Omitted = no tempo.
   */
  phase?: "early" | "mid" | "late";
  /**
   * The laning phase's souls (the player's total souls at this checkpoint),
   * which laning tempo prices an item's share of. Set with `phase` "early".
   */
  laningSouls?: number;
  /**
   * Souls each shop may take in this basket: the measured phase split × the
   * basket's budget × (1 + SHOP_BUDGET_SLACK). Set only when the caller asks
   * to spend by shop (makeBasketContext `spendByShop`) and a split is known;
   * omitted = one shared budget.
   */
  shopBudgets?: Readonly<Record<ItemCategory, number>>;
  /**
   * Share of high-rank matches in which this hero buys each item (Item.id) in
   * the current phase (heroPhaseItems.json). Drives `phaseItemTerm`; omitted
   * => inert.
   */
  phaseItems?: {
    rates: Readonly<Record<string, number>>;
    /** e.g. "Oracle+ players (last 30 days)" — quoted in the reason. */
    scope: string;
    /** e.g. "buy it in the first 10 minutes" — quoted in the reason. */
    basis: string;
  };
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
  /** What this pick actually costs: `item.cost` minus consumed components. */
  effectiveCost: number;
  /** itemIds of held components this pick consumed (upgrade path); usually empty. */
  consumes: ReadonlyArray<string>;
  /** Running total of `effectiveCost`. */
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
