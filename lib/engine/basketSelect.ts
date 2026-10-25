// lib/engine/basketSelect.ts
//
// Milestone E: JOINT basket selection.
//
// `recommendItems()` (engine.ts) scores every candidate INDEPENDENTLY, which
// means the 1st, 2nd and 3rd spirit-power item all rank the same way — nothing
// in that pass knows the hero already has enough spirit power. This module
// solves the other problem: given a hero need vector and a soul budget, pick a
// SET of items that jointly covers the need.
//
// Algorithm: greedy budgeted maximum coverage. Each iteration scores every
// still-affordable candidate by its MARGINAL value given what is already in the
// basket, picks the best, folds it into the state, and repeats. Greedy is used
// deliberately over an exact knapsack/ILP solve: it is O(items × slots), it is
// trivially deterministic, and — because coverage is submodular (diminishing
// returns, see `coverageTerm`) — it carries the standard (1 − 1/e) worst-case
// guarantee for budgeted maximum coverage (strictly, for the coverage term
// alone: `synergyTerm` and `pairTerm` are supermodular, and pairTerm's
// negative values make the objective non-monotone, so the bound is approximate
// once they are enabled; their small caps keep the deviation small). An upgrade
// that consumes a held component can also LOWER coverage in a category (its stats
// replace the component's), another source of non-monotonicity. Exactness is not
// worth the determinism and explainability cost here.
//
// Design constraints (CLAUDE.md + scoring-engine-dev skill, non-negotiable):
// - PURE. Same inputs → same output. No Date.now(), no Math.random(), no
//   network, no global mutable state. Analytics data is PASSED IN via
//   `ctx.itemAnalytics` — this module never fetches it.
// - DETERMINISTIC. Ties are broken by the same total order as engine.ts /
//   scoreItems.ts: value desc → cost asc → itemId asc. Input array order is
//   never load-bearing.
// - EXPLAINABLE. Every contribution to a pick's marginal value is recorded as a
//   `MarginalTerm` with a human-readable `reason`, the same bar as
//   `scoreItems.ts`'s `scoreBreakdown` / `reason`.
// - NO AI. Zero imports from `lib/coach/`. Terms are plain arithmetic.
//
// Extension seam: `constructBasket` takes `terms` (default
// `DEFAULT_BASKET_TERMS`). The Milestone F measured item-pair term,
// `pairTerm`, plugged in this way as one more `MarginalTermFn` with no change
// to the loop.

import type { ItemAnalytics } from "../analyticsStore";
import { MAX_ACTIVE_ITEMS } from "../buildUtils";
import {
  CATEGORY_BONUS_TIERS,
  getCurrentBonusTier,
  isApproachingSignificantBonus,
} from "../categoryBonuses";
import type { ItemCategory } from "../items";
import { componentClosure, pairLiftIn } from "./pairLift";
import { flooredShares } from "./categorySplit";
import type { CategoryShares } from "./categorySplit";
import type { PairLiftEntry } from "./pairLift";
import { findSynergyRules } from "./synergy";
import type {
  BasketContext,
  BasketPick,
  BasketResult,
  BasketState,
  HeroNeedVector,
  ItemCandidate,
  MarginalTerm,
  MarginalTermFn,
  ScoreCategory,
} from "./types";
import { SCORE_CATEGORIES, SCORE_CATEGORY_PLAIN } from "./types";

// ─── Tunable constants ───────────────────────────────────────────────────────

/**
 * Default per-slot coverage target, in the same raw magnitude units as
 * `ItemCandidate.categoryValues` (which run roughly 0–100 per category).
 *
 * WHAT THIS CONTROLS: where diminishing returns kick in. `makeBasketContext`
 * spreads `coverageTargetPerSlot × targetSlots` across the categories in
 * proportion to the need vector; as a category's cumulative coverage approaches
 * its share, further items in that category earn less and less (`saturate`)
 * and the basket is pushed to spread elsewhere.
 *
 * WHAT THIS DOES NOT CONTROL: the relative ordering of items WITHIN a single
 * category. Two gun items are ranked against each other by their raw
 * `categoryValues` regardless of this number — it only decides how many of them
 * the basket wants before it starts looking at other categories.
 *
 * 50 was chosen so a mid-tier item (roughly 20–40 in its main category) takes
 * about two items to satisfy one slot's worth of a category's share. Raised to
 * 75 with the value scale (2026-10-24): item values are now % of the hero's
 * fight value (heroDamage.ts / heroFight.ts), and 1.5x was the best of a
 * 0.5–3x sweep against the measured phase expectations (M1–M3) with the
 * exponential curve below.
 */
const DEFAULT_COVERAGE_TARGET_PER_SLOT = 75;

/**
 * Slack on each shop's budget (BasketContext.shopBudgets): a shop may take its
 * measured share of the phase's souls plus 15%, so an item a little over the
 * line (a 3,200 item against a 3,000 budget) is not blocked. 15% was the best
 * of 0 / 15 / 30% against M1–M3 (2026-10-21).
 */
export const SHOP_BUDGET_SLACK = 0.15;

/**
 * Laning tempo (rankingPrice): souls saved toward an item give nothing until it
 * is bought, and that window is when a laner gets punished. In the laning phase
 * an item's ranking price grows by its share of the phase's souls × this
 * factor: a 3,200 item at 5,900 souls needs ~54% more value per soul than an
 * 800 item. Laning only: in later phases saving for 6,400 items is normal and
 * the factor broke late-game fidelity (2026-10-24 sweep).
 */
export const LANING_TEMPO = 1;

/**
 * Weight of `phaseItemTerm`: at a 100% buy rate it is worth this many slots of
 * coverage. 2 was the best of 0.25–2 against M1–M3 and the real-top-10 overlap
 * (O1/O2) on 2026-10-24; at 1 the mid phase matched 32 of 50 real picks, at 2
 * 39 of 53.
 */
export const PHASE_ITEM_WEIGHT = 2;
/**
 * Buy rate subtracted before weighting: items players on this hero rarely buy
 * in this phase (under 10%, or unlisted = under 2%) get a mild penalty. Fixed
 * Headshot Booster appearing in 3 of 8 early builds while real players rarely
 * buy it early.
 */
export const PHASE_ITEM_BASELINE = 0.1;
/** The rarely-bought penalty is at most this share of the item's coverage gain. */
export const PHASE_ITEM_PENALTY_MAX_SHARE = 0.5;

/**
 * Hard ceiling on `categoryBonusTerm`, as a fraction of one slot's coverage
 * scale. The category bonus is a deliberate COUNTERWEIGHT to coverage
 * (concentrate souls vs. spread them) — at 15% of a slot it can reorder two
 * candidates whose coverage gains are close, but it can never outweigh a
 * genuinely larger coverage gain. Bounding it as a fraction (rather than an
 * absolute number) keeps the balance intact if `coverageTargetPerSlot` is
 * retuned.
 */
const CATEGORY_BONUS_MAX_FRACTION = 0.15;

/**
 * Crossing the `isSignificant` investment tier (4,800 souls — see
 * `CATEGORY_BONUS_TIERS` in lib/categoryBonuses.ts; NOT re-hardcoded here) is
 * by far the largest real payoff in the shop's investment system, so it gets
 * the full bonus budget.
 */
const CROSS_SIGNIFICANT_TIER_FRACTION = 0.15;

/** Crossing any other investment tier: a real but much smaller stat jump. */
const CROSS_TIER_FRACTION = 0.08;

/**
 * Landing in the band immediately BELOW the significant tier (what
 * `isApproachingSignificantBonus()` reports) without crossing it. Smallest
 * award — it is a setup move, not a realised gain.
 */
const APPROACH_SIGNIFICANT_FRACTION = 0.05;

/**
 * Minimum observed matches before an item's win rate is trusted at all.
 *
 * Below this the rate is dominated by sampling noise: at 200 matches the
 * standard error of a ~50% rate is ~3.5pp, which is already the same order as
 * the entire real spread between items. Anything thinner would let a handful of
 * games move a build.
 */
const ANALYTICS_MIN_MATCHES = 200;

/**
 * Win-rate deviation (from 50%) at which the analytics term saturates.
 * Real item win rates cluster within a few points of even; ±10pp is well past
 * the plausible range, so this clamp only ever fires on outliers or
 * unrepresentative samples.
 */
const ANALYTICS_WINRATE_CLAMP = 0.1;

/**
 * Hard ceiling on `analyticsTerm`, as a fraction of one slot's coverage scale.
 *
 * Deliberately the SMALLEST term (6% of a slot vs. the category bonus's 15%).
 * Win rate is real observational data but it is NOT causal: an item's win rate
 * reflects who buys it, on which heroes, and how far into a winning game they
 * were when they could afford it — not the item's isolated contribution. It is
 * allowed to break near-ties between stat-equivalent items and nothing more.
 */
const ANALYTICS_MAX_FRACTION = 0.06;

/**
 * Hard ceiling on `procPlatformTerm`, as a fraction of one slot's coverage.
 *
 * Sized between the category bonus (15%) and the analytics nudge (6%): the
 * mechanism is a real, mechanical one — a proc fires per bullet, so hits per
 * second genuinely multiply it — but how much of a hero's fight time is spent
 * shooting, in range, on a target is not modelled. Enough to reorder the
 * per-hit items for a hero whose whole gun identity is procs; never enough to
 * override stat coverage.
 */
const PROC_PLATFORM_MAX_FRACTION = 0.1;

/**
 * Hard ceiling on `synergyTerm`, as a fraction of one slot's coverage.
 *
 * The pair table is hand-authored and unmeasured, so it is bounded no higher
 * than the measured proc-platform term (0.10) and below the game-native
 * category bonus (0.15). The bonus is FLAT (like the category bonus, unlike
 * the proc terms), so a relevant paired item can beat one with up to 0.10 of a
 * slot more coverage gain — never a larger gap.
 */
export const SYNERGY_MAX_FRACTION = 0.1;

/**
 * Hard ceiling on `pairTerm`, as a fraction of one slot's coverage.
 *
 * Between the single-item win-rate nudge (0.06) and the hand-authored synergy /
 * proc terms (0.10). It is better controlled than a raw win rate: per hero,
 * banded by final net worth, shrunk, and with each item's own effect removed.
 * But it is still observational. Part of a measured lift is context the engine
 * cannot see, above all the enemy team: anti-spirit items pair "well" with gun
 * items because both get bought against spirit-heavy teams (engine-design-notes,
 * "Pair lift table"). SCALED by the measured lift, symmetric: a measurably bad
 * pair is pushed down as far as a good one is pushed up. At saturation it can
 * beat an item with up to 0.08 of a slot MORE coverage (and a +cap candidate
 * against a -cap one, a 0.16 gap), never a larger one.
 */
export const PAIR_LIFT_MAX_FRACTION = 0.08;

/**
 * Summed lift (log odds) at which pairTerm saturates. About 0.3 is roughly 7
 * win-rate points near 50%, at the top of what the fitted table holds
 * (strong pairs sit around 0.15-0.35), so one strong partner nearly saturates
 * and several cannot stack past the cap.
 */
const PAIR_LIFT_SATURATION = 0.3;

/** Log odds to approximate win-rate points near 50% (p(1 - p) = 0.25, x100). */
const LOG_ODDS_TO_POINTS_AT_EVEN = 25;

/** Max categories named in a coverage `reason` before it is truncated. */
const MAX_REASON_CATEGORIES = 3;

/**
 * Souls threshold of the `isSignificant` investment tier, DERIVED from
 * `lib/categoryBonuses.ts` rather than restated as a literal.
 *
 * CLAUDE.md documents this as 4,800, but writing `4800` here would create a
 * second source of truth that silently rots when Valve patches the tier table.
 * Reading it off the table means a patched threshold flows through for free.
 * `Infinity` if the table ever has no significant tier — every comparison below
 * then simply never fires.
 */
const SIGNIFICANT_THRESHOLD: number =
  CATEGORY_BONUS_TIERS.find((tier) => tier.isSignificant)?.soulsThreshold ??
  Number.POSITIVE_INFINITY;

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Coerces an untrusted external number to a finite, non-negative value. */
function safeNonNegative(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function zeroCoverage(): Record<ScoreCategory, number> {
  const out = {} as Record<ScoreCategory, number>;
  for (const cat of SCORE_CATEGORIES) out[cat] = 0;
  return out;
}

/**
 * Shop categories, written as an exhaustive object literal rather than an
 * array so TypeScript fails the build if `ItemCategory` ever gains a member.
 */
function zeroSoulsPerCategory(): Record<ItemCategory, number> {
  return { gun: 0, spirit: 0, vitality: 0 };
}

/** Deterministic thousands separator — never `toLocaleString`, which is locale-dependent. */
function formatSouls(souls: number): string {
  return Math.round(souls)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Recovers `coverageTargetPerSlot` from a context.
 *
 * `BasketContext` stores the already-scaled `target`, not the raw option, so
 * the per-slot scale is read back as `sum(target) / targetSlots`. Every bounded
 * term is expressed as a fraction of this so the terms stay in proportion to
 * each other no matter how the scale is tuned.
 */
function coverageScalePerSlot(ctx: BasketContext): number {
  // The target spans owned + free slots (ctx.targetSlots), not free slots alone.
  const slots = ctx.targetSlots;
  if (slots <= 0) return 0;

  let totalTarget = 0;
  for (const cat of SCORE_CATEGORIES) {
    const t = ctx.target[cat];
    if (Number.isFinite(t)) totalTarget += t;
  }

  return totalTarget / slots;
}

/** Reads a candidate's value for one category, guarding untrusted numbers. */
function candidateValue(candidate: ItemCandidate, cat: ScoreCategory): number {
  const raw = candidate.categoryValues[cat];
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

// ─── Context construction ────────────────────────────────────────────────────

/**
 * Builds the immutable per-run context for `constructBasket`.
 *
 * The key job here is UNIT RECONCILIATION. `HeroNeedVector` values are relative
 * weights (a hero needing "twice as much spirit damage as mobility"), while
 * `ItemCandidate.categoryValues` are raw magnitudes. Comparing them directly
 * would be meaningless, so the need vector is normalized to sum to 1 and then
 * scaled by `coverageTargetPerSlot × targetSlots` (owned + free slots), producing a per-category target
 * expressed in the same units as `categoryValues`.
 *
 * Degenerate input is handled without dividing by zero: an all-zero (or
 * all-invalid) need vector falls back to an EVEN target across every category,
 * which is the honest reading of "no stated preference".
 */
export function makeBasketContext(opts: {
  needVector: HeroNeedVector;
  soulBudget: number;
  maxItems?: number;
  coverageTargetPerSlot?: number;
  itemAnalytics?: ReadonlyMap<number, ItemAnalytics>;
  /** See BasketContext.procPlatformFactor. Omitted => procPlatformTerm inert. */
  procPlatformFactor?: number;
  /** See BasketContext.hitReliabilityFactor. Omitted => the term is inert. */
  hitReliabilityFactor?: number;
  /** See BasketContext.ownedItemNames. Omitted => synergy sees basket picks only. */
  ownedItemNames?: ReadonlyMap<string, string>;
  /** See BasketContext.pairLift. Omitted => pairTerm inert, hand rules never overridden. */
  pairLift?: BasketContext["pairLift"];
  /**
   * Items already owned, valued like the candidates. Their coverage and souls
   * seed the basket and an upgrade can consume them. Omitted => nothing owned,
   * and the context is exactly what it was before owned coverage existed.
   */
  ownedCandidates?: ReadonlyArray<ItemCandidate>;
  /** Measured shop-category split for this hero; omitted => categorySplitTerm inert. */
  categorySplit?: CategoryShares & { scope: string; basis?: string };
  /** See BasketContext.phase. Omitted => no tempo pricing. */
  phase?: BasketContext["phase"];
  /** See BasketContext.laningSouls. Omitted => the basket's soul budget. */
  laningSouls?: number;
  /**
   * What the split's shares measure. "increment" (default): what players buy
   * in this window (early / mid purchase splits), so the budgets split this
   * basket's souls. "cumulative": what they hold (the final split), so the
   * budgets top each shop up to its share of owned + basket souls.
   */
  splitBasis?: "increment" | "cumulative";
  /**
   * Spend each shop's measured share of the budget (BasketContext.shopBudgets)
   * instead of nudging toward it with categorySplitTerm. Needs categorySplit.
   */
  spendByShop?: boolean;
  /** See BasketContext.phaseItems. Omitted => phaseItemTerm inert. */
  phaseItems?: BasketContext["phaseItems"];
}): BasketContext {
  const maxItemsRaw = opts.maxItems;
  const maxItems =
    typeof maxItemsRaw === "number" && Number.isFinite(maxItemsRaw) && maxItemsRaw >= 0
      ? Math.floor(maxItemsRaw)
      : MAX_ACTIVE_ITEMS;

  const perSlot = safeNonNegative(opts.coverageTargetPerSlot, DEFAULT_COVERAGE_TARGET_PER_SLOT);
  const soulBudget = safeNonNegative(opts.soulBudget, 0);

  // Sanitize the need vector first so both the normalization and the value
  // echoed back on `BasketResult.needVector` are finite and non-negative.
  const needVector = zeroCoverage();
  let needSum = 0;
  for (const cat of SCORE_CATEGORIES) {
    const raw = opts.needVector[cat];
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    needVector[cat] = value;
    needSum += value;
  }

  // Sorted by itemId so the caller's owned order is never load-bearing.
  const owned = sanitizeCandidates(opts.ownedCandidates ?? []).sort((a, b) =>
    a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
  );
  // Owned coverage counts toward the target, so the target spans the whole
  // build (owned + free slots). With nothing owned this is maxItems, as before.
  const targetSlots = maxItems + owned.length;
  const totalTarget = perSlot * targetSlots;
  const target = zeroCoverage();

  if (needSum > 0) {
    for (const cat of SCORE_CATEGORIES) {
      target[cat] = (needVector[cat] / needSum) * totalTarget;
    }
  } else {
    // Degenerate all-zero need vector: spread the target evenly rather than
    // dividing by zero. SCORE_CATEGORIES is a non-empty const tuple.
    const even = totalTarget / SCORE_CATEGORIES.length;
    for (const cat of SCORE_CATEGORIES) target[cat] = even;
  }

  return {
    needVector,
    target,
    soulBudget,
    maxItems,
    itemAnalytics: opts.itemAnalytics,
    // Sanitized here so a non-finite factor degrades to "inert" rather than
    // poisoning every candidate's marginal value with NaN.
    procPlatformFactor:
      typeof opts.procPlatformFactor === "number" && Number.isFinite(opts.procPlatformFactor)
        ? opts.procPlatformFactor
        : undefined,
    hitReliabilityFactor:
      typeof opts.hitReliabilityFactor === "number" && Number.isFinite(opts.hitReliabilityFactor)
        ? opts.hitReliabilityFactor
        : undefined,
    ownedItemNames: opts.ownedItemNames,
    pairLift: opts.pairLift,
    owned,
    targetSlots,
    // RAW shares (validated): the floor exists for need-vector reachability only;
    // the term and its reason use what players actually buy or hold.
    categorySplit:
      opts.categorySplit && flooredShares(opts.categorySplit)
        ? {
            gun: opts.categorySplit.gun,
            spirit: opts.categorySplit.spirit,
            vitality: opts.categorySplit.vitality,
            scope: opts.categorySplit.scope,
            basis: opts.categorySplit.basis,
          }
        : undefined,
    phase: opts.phase,
    phaseItems: opts.phaseItems,
    laningSouls:
      opts.phase === "early"
        ? safeNonNegative(opts.laningSouls, soulBudget) || undefined
        : undefined,
    shopBudgets: opts.spendByShop
      ? shopBudgetsFor(opts.categorySplit, soulBudget, owned, opts.splitBasis ?? "increment")
      : undefined,
  };
}

// ─── Upgrade components ──────────────────────────────────────────────────────

/**
 * What `candidate` costs given what is held, and which held items it consumes.
 *
 * Verified 2026-10-20 (deadlock.wiki/Items, /Shop; live /v1/assets/items):
 * buying an upgrade consumes its DIRECT components that you hold, and the price
 * drops by exactly their cost. Only direct components count (every chain
 * upgrades one step at a time), matching `getEffectiveAddCost` in buildUtils.
 * Never below 0.
 */
export function effectiveCost(
  candidate: ItemCandidate,
  held: ReadonlyArray<ItemCandidate>,
): { cost: number; consumes: ItemCandidate[] } {
  const componentIds = candidate.componentIds ?? [];
  if (componentIds.length === 0) return { cost: candidate.cost, consumes: [] };
  const wanted = new Set(componentIds);
  const consumes = held.filter((h) => wanted.has(h.itemId));
  const discount = consumes.reduce((sum, c) => sum + c.cost, 0);
  return { cost: Math.max(0, candidate.cost - discount), consumes };
}

function heldOf(state: BasketState): ReadonlyArray<ItemCandidate> {
  return state.held ?? state.picked;
}

/**
 * The state before the first pick: owned items seed coverage, investment souls
 * and the held set. `spent` is the basket's own spend, starting at 0, because
 * the caller already took owned costs out of `soulBudget`. Exported so
 * basketProbe's first-pick ranking starts exactly where `constructBasket` does.
 */
/**
 * Souls each shop may take in a basket (BasketContext.shopBudgets), or
 * undefined when the split is missing or invalid (budgets off). Shares are
 * normalised to sum to 1 (they are rounded and accuracy-adjusted upstream). A
 * "cumulative" split (the final inventory) tops each shop up to its share of
 * owned + basket souls, so souls already held per shop count; an "increment"
 * split (purchases in this window) splits the basket's souls alone.
 */
function shopBudgetsFor(
  split: (CategoryShares & { scope: string }) | undefined,
  soulBudget: number,
  owned: ReadonlyArray<ItemCandidate>,
  basis: "increment" | "cumulative",
): Readonly<Record<ItemCategory, number>> | undefined {
  if (!split || !flooredShares(split)) return undefined;
  const total = split.gun + split.spirit + split.vitality;
  if (!(total > 0)) return undefined;
  const ownedSouls: Record<ItemCategory, number> = { gun: 0, spirit: 0, vitality: 0 };
  if (basis === "cumulative") for (const o of owned) ownedSouls[o.category] += o.cost;
  const pool = soulBudget + ownedSouls.gun + ownedSouls.spirit + ownedSouls.vitality;
  const budget = (cat: ItemCategory) =>
    Math.max(0, (split[cat] / total) * pool - ownedSouls[cat]) * (1 + SHOP_BUDGET_SLACK);
  return { gun: budget("gun"), spirit: budget("spirit"), vitality: budget("vitality") };
}

export function initialBasketState(ctx: BasketContext): BasketState {
  const coverage = zeroCoverage();
  const soulsPerCategory = zeroSoulsPerCategory();
  for (const o of ctx.owned) {
    for (const cat of SCORE_CATEGORIES) coverage[cat] += candidateValue(o, cat);
    soulsPerCategory[o.category] += o.cost;
  }
  return { picked: [], held: [...ctx.owned], coverage, soulsPerCategory, spent: 0 };
}

/**
 * Transitive component closures for every item in `items`, computed once.
 * `componentClosure` excludes the item itself.
 */
export function componentClosures(
  items: ReadonlyArray<ItemCandidate>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const direct = new Map<string, ReadonlyArray<string>>();
  for (const c of items)
    if (c.componentIds && c.componentIds.length > 0) direct.set(c.itemId, c.componentIds);
  const out = new Map<string, ReadonlySet<string>>();
  for (const c of items)
    out.set(
      c.itemId,
      componentClosure(c.itemId, (x) => direct.get(x)),
    );
  return out;
}

/**
 * H2 (docs/starter-build-use-cases.md): one basket never PICKS an item together
 * with its own component, and never buys a component of something already held.
 * Upgrading an OWNED component is the normal upgrade path and is allowed. Only
 * direct components are consumed (verified game rule), so an owned
 * grand-component (A in A→B→C) can stay held next to C.
 */
export function blockedByComponents(
  candidate: ItemCandidate,
  state: BasketState,
  closures: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  for (const h of heldOf(state)) {
    if (closures.get(h.itemId)?.has(candidate.itemId)) return true;
  }
  const own = closures.get(candidate.itemId);
  if (own) for (const p of state.picked) if (own.has(p.itemId)) return true;
  return false;
}

// ─── Marginal value terms ────────────────────────────────────────────────────

/**
 * The core term: coverage gain with DIMINISHING RETURNS.
 *
 *   gain = Σ_cat [ U(covered + itemValue) − U(covered) ],  U(c) = T(1 − e^(−c/T))
 *
 * `U` saturates toward the category's target T: each further unit is worth a
 * little less, so the 3rd spirit-power item pays off less than the 1st and the
 * greedy loop spreads across categories. It replaced a hard `min(T, c)` clamp
 * (2026-10-24): with hero-relative values a gun hero's first gun items hit the
 * clamp and further gun was worth exactly 0 (Haze bought 0% gun mid-game).
 * See "One value scale" in engine-design-notes.md.
 *
 * U is concave and increasing, so total coverage stays a submodular set
 * function and greedy keeps its (1 − 1/e) approximation guarantee.
 */
export function saturate(covered: number, target: number): number {
  if (!(target > 0)) return 0;
  return target * (1 - Math.exp(-Math.max(0, covered) / target));
}

/**
 * Shared clamped-coverage-gain computation.
 *
 * Extracted because `categoryBonusTerm` needs the same number as a RELEVANCE
 * GATE (see there). Terms stay independent — neither reads the other's output;
 * they just both derive from `(candidate, state, ctx)`, which is what keeps
 * every term individually pure and order-insensitive.
 *
 * Returns the total gain plus the per-category split, sorted largest-first with
 * category name ascending as tiebreak so reason strings are byte-identical
 * across runs.
 */
function computeCoverageGain(
  candidate: ItemCandidate,
  state: BasketState,
  ctx: BasketContext,
): { total: number; perCategory: Array<{ cat: ScoreCategory; gain: number }> } {
  let total = 0;
  const perCategory: Array<{ cat: ScoreCategory; gain: number }> = [];

  // An upgrade's stats REPLACE the components it consumes (Arctic Blast's
  // TechResist 10 vs Cold Front's 6 is not 16), so their coverage comes off.
  const { consumes } = effectiveCost(candidate, heldOf(state));

  for (const cat of SCORE_CATEGORIES) {
    const itemValue = candidateValue(candidate, cat);
    let consumedValue = 0;
    for (const c of consumes) consumedValue += candidateValue(c, cat);
    if (itemValue === 0 && consumedValue === 0) continue;

    const target = Number.isFinite(ctx.target[cat]) ? ctx.target[cat] : 0;
    const covered = Number.isFinite(state.coverage[cat]) ? state.coverage[cat] : 0;

    const before = saturate(covered, target);
    const after = saturate(Math.max(0, covered - consumedValue) + itemValue, target);
    const catGain = after - before;

    // A consumed component can make a category's gain negative; it still
    // counts toward the total, but only positive gains are named in reasons.
    total += catGain;
    if (catGain > 0) perCategory.push({ cat, gain: catGain });
  }

  perCategory.sort((a, b) => {
    if (b.gain !== a.gain) return b.gain - a.gain;
    return a.cat.localeCompare(b.cat);
  });

  return { total, perCategory };
}

/**
 * Smallest coverage gain, as a fraction of one slot's coverage, that counts as
 * "covers some need" for the relevance gates (`coversNeed`). With the hard cap
 * a full category gained exactly 0; the saturating curve never quite reaches 0,
 * so without a threshold every bounded term (category bonus, synergy, pair
 * lift, analytics, ...) could promote an item whose real gain is ~0 (audit
 * 2026-10-24). 2% was the best of 0 / 2 / 5 / 10% against M1–M3 and O2 with
 * the full stack (2026-10-24); it still rejects a category covered far past
 * its target (the saturated-synergy relevance fixture).
 */
export const RELEVANCE_MIN_GAIN_FRACTION = 0.02;

/**
 * The relevance gate shared by every adjustment term: true when the candidate's
 * coverage gain is at least RELEVANCE_MIN_GAIN_FRACTION of one slot's coverage.
 * Adjustment terms are reasons to prefer one useful item over another, never a
 * reason to buy one that covers (almost) nothing.
 */
export function coversNeed(
  candidate: ItemCandidate,
  state: BasketState,
  ctx: BasketContext,
): boolean {
  const gain = computeCoverageGain(candidate, state, ctx).total;
  return gain > RELEVANCE_MIN_GAIN_FRACTION * coverageScalePerSlot(ctx);
}

/** "Adds the gun damage and health this hero still needs." (largest gains first) */
function plainCoverage(cats: ReadonlyArray<ScoreCategory>): string {
  const names = cats.slice(0, 2).map((c) => SCORE_CATEGORY_PLAIN[c]);
  if (names.length === 0) return "Fills a gap in what this hero needs.";
  return `Adds the ${names.join(" and ")} this hero still needs.`;
}

export const coverageTerm: MarginalTermFn = {
  termId: "coverage",

  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null {
    const { total: gain, perCategory: perCategoryGain } = computeCoverageGain(
      candidate,
      state,
      ctx,
    );

    if (gain <= 0) return null;

    const named = perCategoryGain
      .slice(0, MAX_REASON_CATEGORIES)
      .map((entry) => `${entry.cat} +${entry.gain.toFixed(1)}`);
    const hidden = perCategoryGain.length - named.length;
    const suffix = hidden > 0 ? `, +${hidden} more` : "";

    return {
      termId: "coverage",
      value: gain,
      reason: `Covers ${gain.toFixed(1)} of remaining need (${named.join(", ")}${suffix})`,
      plain: plainCoverage(perCategoryGain.map((entry) => entry.cat)),
    };
  },
};

/**
 * The concentration counterweight, deliberately in tension with `coverageTerm`.
 *
 * Deadlock's shop pays an investment bonus for souls CONCENTRATED in one
 * category, which directly opposes coverage's incentive to spread. This term
 * awards a bounded bonus when a purchase moves its shop category toward or
 * across an investment tier, so the basket does not scatter 1,000 souls across
 * three categories and collect no bonus at all.
 *
 * Tier thresholds are read from `lib/categoryBonuses.ts` via
 * `getCurrentBonusTier()` / `isApproachingSignificantBonus()` — never
 * re-hardcoded here, so a Valve patch to the tier table flows through.
 *
 * Additive and bounded (see CATEGORY_BONUS_MAX_FRACTION), following the
 * additive-bonus pattern in `lib/scoring/scoreItems.ts`: recorded as its own
 * term for explainability, never folded into or mutating the coverage value.
 *
 * RELEVANCE GATE (`coversNeed`): the bonus only applies to a candidate that also
 * delivers a real share of un-met coverage. Without the gate an item with zero relevance to the hero
 * could be bought purely because its price tag happens to tip a category over a
 * tier line, which is a bad recommendation and would also mask the
 * `"no-positive-value"` stop reason (every item would stay positive forever).
 * The investment bonus is a reason to prefer ONE useful item over another
 * useful item — never a reason to buy a useless one.
 */
export const categoryBonusTerm: MarginalTermFn = {
  termId: "categoryBonus",

  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null {
    const scale = coverageScalePerSlot(ctx);
    if (scale <= 0) return null;

    // Souls actually paid: an upgrade of a held component costs the difference.
    const paid = effectiveCost(candidate, heldOf(state)).cost;
    const cost = Number.isFinite(paid) && paid > 0 ? paid : 0;
    if (cost === 0) return null;

    if (!coversNeed(candidate, state, ctx)) return null;

    const rawBefore = state.soulsPerCategory[candidate.category];
    const before = Number.isFinite(rawBefore) && rawBefore > 0 ? rawBefore : 0;
    const after = before + cost;

    const tierBefore = getCurrentBonusTier(before);
    const tierAfter = getCurrentBonusTier(after);
    const crossed = tierAfter !== null && tierBefore?.soulsThreshold !== tierAfter.soulsThreshold;

    let fraction = 0;
    let detail = "";
    let plain = "";

    if (crossed && tierAfter !== null) {
      // A single purchase can jump several tiers at once, so credit the highest
      // tier reached — and treat the significant tier as earned if it was
      // passed on the way, even when the item lands above it.
      const passedSignificant = before < SIGNIFICANT_THRESHOLD && after >= SIGNIFICANT_THRESHOLD;

      if (passedSignificant) {
        fraction = CROSS_SIGNIFICANT_TIER_FRACTION;
        detail = `crosses the ${formatSouls(SIGNIFICANT_THRESHOLD)} significant investment tier`;
        plain = `Takes your ${candidate.category} spending past ${formatSouls(SIGNIFICANT_THRESHOLD)} souls, unlocking the shop's big ${candidate.category} bonus.`;
      } else {
        fraction = CROSS_TIER_FRACTION;
        detail = `crosses the ${formatSouls(tierAfter.soulsThreshold)} investment tier`;
        plain = `Takes your ${candidate.category} spending past ${formatSouls(tierAfter.soulsThreshold)} souls, unlocking the next ${candidate.category} bonus.`;
      }
    } else if (isApproachingSignificantBonus(after) && !isApproachingSignificantBonus(before)) {
      fraction = APPROACH_SIGNIFICANT_FRACTION;
      detail = "moves into range of the significant investment tier";
      plain = `Brings your ${candidate.category} spending close to the shop's big ${candidate.category} bonus.`;
    }

    if (fraction <= 0) return null;

    const value = Math.min(fraction, CATEGORY_BONUS_MAX_FRACTION) * scale;

    return {
      termId: "categoryBonus",
      value,
      reason: `${candidate.category} souls ${formatSouls(before)} → ${formatSouls(after)} ${detail} (+${value.toFixed(2)})`,
      plain,
    };
  },
};

/**
 * Real empirical win rate — deliberately the smallest term in the system.
 *
 * IMPORTANT INTERPRETATION CAVEAT: this is OBSERVATIONAL data, not causal. An
 * item's win rate reflects WHO buys it (which heroes, which skill brackets) and
 * WHEN they buy it (a 6,300-soul item is disproportionately bought by players
 * who were already ahead), not the item's isolated contribution to winning.
 * Treating it as a causal effect would systematically over-rank expensive
 * late-game items. It is therefore centred on 0.5 (a 50%-win-rate item
 * contributes exactly nothing), clamped, and capped at a small fraction of a
 * slot's coverage scale so it nudges ranking between stat-equivalent items
 * instead of overriding the deterministic stat-based terms.
 *
 * Returns null — contributing nothing — when there is no analytics map, no
 * entry for this item, the sample is thinner than ANALYTICS_MIN_MATCHES, the
 * rate is exactly even, or the candidate delivers no un-met coverage. That last
 * gate matches `categoryBonusTerm`'s: a win-rate nudge is a tiebreaker between
 * useful items, never grounds for buying an item the hero has no need for.
 */
export const analyticsTerm: MarginalTermFn = {
  termId: "analytics",

  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null {
    const analytics = ctx.itemAnalytics;
    if (!analytics) return null;

    if (!coversNeed(candidate, state, ctx)) return null;

    const entry = analytics.get(candidate.numericId);
    if (!entry) return null;

    const matches = entry.matches;
    if (!Number.isFinite(matches) || matches < ANALYTICS_MIN_MATCHES) return null;

    const winRate = entry.winRate;
    if (!Number.isFinite(winRate)) return null;

    const rawSignal = winRate - 0.5;
    const clamped = Math.max(
      -ANALYTICS_WINRATE_CLAMP,
      Math.min(ANALYTICS_WINRATE_CLAMP, rawSignal),
    );
    if (clamped === 0) return null;

    const scale = coverageScalePerSlot(ctx);
    if (scale <= 0) return null;

    const value = (clamped / ANALYTICS_WINRATE_CLAMP) * ANALYTICS_MAX_FRACTION * scale;
    const sign = value >= 0 ? "+" : "";

    return {
      termId: "analytics",
      value,
      reason: `${(winRate * 100).toFixed(1)}% win rate over ${formatSouls(matches)} matches (${sign}${value.toFixed(2)}) — observational, not causal`,
    };
  },
};

/**
 * Default term stack, in evaluation order.
 *
 * Order does not affect the total (the terms are summed) but it does fix the
 * order of `BasketPick.terms`, which the UI renders top-to-bottom: the dominant
 * stat signal first, then the concentration counterweight, then the small
 * empirical nudge.
 */
/**
 * Scales a per-hit item by how good THIS hero is at landing hits.
 *
 * Closes a real gap: `categoryValues` is hero-independent, so a bullet proc is
 * valued identically for a hero firing 9.8 shots/s who cannot miss and one
 * firing 1.7 shots/s at 40% accuracy. Verified live against Graves, whose
 * actual gun builds (Mystic Shot, Toxic Bullets, Ricochet, Tesla Bullets) are
 * all per-hit items, yet ranked 38th, 29th, 17th and 45th of 54 gun items for
 * her because her per-shot damage and range are both poor.
 *
 * Both halves are needed and neither is sufficient: `candidate.procReliance`
 * (hero-independent, from itemAdapter) says how much of the item rides on
 * landing bullets, and `ctx.procPlatformFactor` (hero-specific, from
 * heroNeed's deriveProcPlatformFactor) says how well this hero does that.
 *
 * Relevance-gated exactly like `analyticsTerm`: an item covering no un-met need
 * gets nothing, so this can never make an irrelevant item worth buying — it
 * only reorders items that are already useful. Bounded by
 * PROC_PLATFORM_MAX_FRACTION of one slot's coverage for the same reason.
 */
export const procPlatformTerm: MarginalTermFn = {
  termId: "proc-platform",

  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null {
    const factor = ctx.procPlatformFactor;
    // Omitted => inert. An absent factor must never silently bias a basket.
    if (typeof factor !== "number" || !Number.isFinite(factor)) return null;

    const reliance = candidate.procReliance;
    if (!Number.isFinite(reliance) || reliance <= 0) return null;

    if (!coversNeed(candidate, state, ctx)) return null;

    // Relative to a roster-average platform. Exactly average contributes
    // nothing, which keeps this a differential signal rather than a blanket
    // bonus for every per-hit item.
    const delta = factor - 1;
    if (delta === 0) return null;

    const scale = coverageScalePerSlot(ctx);
    if (scale <= 0) return null;

    const value = delta * reliance * PROC_PLATFORM_MAX_FRACTION * scale;
    if (!Number.isFinite(value) || value === 0) return null;

    const pct = Math.round(reliance * 100);
    const sign = value >= 0 ? "+" : "";
    return {
      termId: "proc-platform",
      value,
      reason:
        `${sign}${value.toFixed(2)}: ${pct}% of this item's value is per-hit, and this hero ` +
        `lands hits ${factor >= 1 ? "better" : "worse"} than roster average (x${factor.toFixed(2)})`,
      plain:
        factor >= 1
          ? "This hero lands its shots well, so this item's on-hit effects pay off."
          : "This hero lands fewer shots than most, so this item's on-hit effects are worth less.",
    };
  },
};

/**
 * Scales a cooldown-gated bullet effect by how reliably this hero connects.
 *
 * The sibling of `procPlatformTerm`, deliberately separate because the two
 * multiply different item-side shares by different hero-side signals:
 *
 *  - per-bullet procs (`procReliance`) scale with fire rate x accuracy
 *  - cooldown-gated procs (`hitDependence`) scale with accuracy ALONE
 *
 * Mystic Shot is the case that forced the split: it is consumed by FIRING, so
 * a miss spends the charge and starts the 8s cooldown regardless, but firing
 * faster cannot make the cooldown come up more often. Graves lands at the top
 * of this term via `cannotMiss`, which is also the documented in-game
 * exception — her Mystic bullet is never wasted on a miss.
 *
 * Same guards as the other adjustment terms: relevance-gated, neutral at
 * roster average, inert when the factor is absent, and bounded by
 * PROC_PLATFORM_MAX_FRACTION of one slot's coverage.
 */
export const hitReliabilityTerm: MarginalTermFn = {
  termId: "hit-reliability",

  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null {
    const factor = ctx.hitReliabilityFactor;
    if (typeof factor !== "number" || !Number.isFinite(factor)) return null;

    const dependence = candidate.hitDependence;
    if (!Number.isFinite(dependence) || dependence <= 0) return null;

    if (!coversNeed(candidate, state, ctx)) return null;

    const delta = factor - 1;
    if (delta === 0) return null;

    const scale = coverageScalePerSlot(ctx);
    if (scale <= 0) return null;

    const value = delta * dependence * PROC_PLATFORM_MAX_FRACTION * scale;
    if (!Number.isFinite(value) || value === 0) return null;

    const pct = Math.round(dependence * 100);
    const sign = value >= 0 ? "+" : "";
    return {
      termId: "hit-reliability",
      value,
      reason:
        `${sign}${value.toFixed(2)}: ${pct}% of this item's value is a cooldown-gated shot ` +
        `that is wasted on a miss, and this hero connects ` +
        `${factor >= 1 ? "better" : "worse"} than roster average (x${factor.toFixed(2)})`,
      plain:
        factor >= 1
          ? "This hero rarely misses, so this item's empowered shot is rarely wasted."
          : "This hero misses more than most, so this item's empowered shot is often wasted.",
    };
  },
};

/**
 * The measurement the basket uses for a pair: a significant entry, else a
 * precisely measured SYNERGY_RULES pair (rulePairs). Both pairTerm and the
 * synergyTerm override read THIS, so a hand rule is skipped exactly when
 * pairTerm takes the pair over: never counted twice, never silently dropped.
 */
function measuredPair(
  lift: BasketContext["pairLift"],
  idA: string,
  idB: string,
): PairLiftEntry | null {
  if (!lift) return null;
  return pairLiftIn(lift.pairs, idA, idB) ?? pairLiftIn(lift.rulePairs, idA, idB);
}

/**
 * Items a candidate can pair with: everything currently HELD (owned items plus
 * this basket's picks, minus components an upgrade consumed), excluding the
 * components this candidate would itself consume. itemId -> display name. Never
 * other not-yet-picked candidates: that would make selection circular.
 *
 * Without `ctx.owned` (callers that pass only names) it falls back to
 * `ownedItemNames` plus picks, as before owned coverage existed.
 */
function pairPartners(
  candidate: ItemCandidate,
  state: BasketState,
  ctx: BasketContext,
): Map<string, string> {
  if (ctx.owned.length === 0) {
    const partners = new Map<string, string>(ctx.ownedItemNames ?? []);
    for (const p of state.picked) partners.set(p.itemId, p.name);
    return partners;
  }
  const held = heldOf(state);
  const consumed = new Set(effectiveCost(candidate, held).consumes.map((c) => c.itemId));
  const partners = new Map<string, string>();
  for (const h of held) if (!consumed.has(h.itemId)) partners.set(h.itemId, h.name);
  return partners;
}

/**
 * Rewards completing a known item PAIR (see lib/engine/synergy.ts), the first
 * term to read `state.picked`.
 *
 * MEASURED WINS (Milestone F): a rule is skipped for a hero when the basket
 * has a measurement of that pair (`measuredPair`: a significant entry, or a
 * precise `rulePairs` entry), even a measured ~0. pairTerm then credits the
 * pair with exactly that measurement and explains it, so the pair is never
 * counted twice and never silently loses its bonus. A rule with no
 * measurement (a rarely co-bought pair, a little-played hero) keeps firing.
 */
export const synergyTerm: MarginalTermFn = {
  termId: "synergy",

  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null {
    const partnerNames = pairPartners(candidate, state, ctx);

    const lift = ctx.pairLift;
    const rules = findSynergyRules(candidate.itemId, new Set(partnerNames.keys())).filter(
      (rule) => measuredPair(lift, rule.itemIds[0], rule.itemIds[1]) === null,
    );
    if (rules.length === 0) return null;

    if (!coversNeed(candidate, state, ctx)) return null;

    const scale = coverageScalePerSlot(ctx);
    if (scale <= 0) return null;

    let strength = 0;
    for (const rule of rules) strength += rule.strength;

    const value = Math.min(1, strength) * SYNERGY_MAX_FRACTION * scale;
    if (!Number.isFinite(value) || value === 0) return null;

    // Partner names in the same order as `rules` (partner id ascending).
    const names: string[] = [];
    for (const rule of rules) {
      const partnerId = rule.itemIds[0] === candidate.itemId ? rule.itemIds[1] : rule.itemIds[0];
      names.push(partnerNames.get(partnerId) ?? partnerId);
    }

    return {
      termId: "synergy",
      value,
      reason: `+${value.toFixed(2)}: pairs with ${names.join(", ")}, already in your build or this basket — ${rules[0].reason}`,
      plain: `Works well with ${names.join(" and ")}, which this build already has or is buying.`,
    };
  },
};

/**
 * Measured pair lift (Milestone F): how much better (or worse) players of THIS
 * hero did when they owned a candidate together with one of its partners
 * (owned items and basket picks), beyond what the two items predict on their
 * own. Read via `measuredPair` from this hero's slice of the committed table
 * (src/scripts/fitPairTable.ts): significant pairs, plus precisely measured
 * hand-rule pairs, which is how an overridden SYNERGY_RULES pair still gets
 * its measured value and a reason.
 *
 * Guards, matching the other adjustment terms:
 *  - inert without `ctx.pairLift`, and a pair absent from the table counts as
 *    NO SIGNAL, never as zero;
 *  - relevance-gated: never a reason to buy an item that covers no need;
 *  - bounded: the partners' lifts are summed, then saturate at
 *    PAIR_LIFT_SATURATION, so value is in +/- PAIR_LIFT_MAX_FRACTION of a slot;
 *  - the reason states what was measured and its scope, and never calls it
 *    synergy: the data shows correlation within wealth bands, not mechanism.
 *
 * Supermodular like synergyTerm (only the second item of a pair is credited),
 * with the same caveat on the greedy bound.
 */
export const pairTerm: MarginalTermFn = {
  termId: "pair-lift",

  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null {
    const lift = ctx.pairLift;
    if (!lift) return null;

    const partners = pairPartners(candidate, state, ctx);
    const hits: Array<{ name: string; entry: PairLiftEntry }> = [];
    // Code-unit order: deterministic sum and reason, whatever the Map order.
    for (const id of [...partners.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))) {
      const entry = measuredPair(lift, candidate.itemId, id);
      if (entry && Number.isFinite(entry.lift)) {
        hits.push({ name: partners.get(id) ?? id, entry });
      }
    }
    if (hits.length === 0) return null;

    if (!coversNeed(candidate, state, ctx)) return null;

    const scale = coverageScalePerSlot(ctx);
    if (scale <= 0) return null;

    let sum = 0;
    for (const h of hits) sum += h.entry.lift;
    const signal = Math.max(-1, Math.min(1, sum / PAIR_LIFT_SATURATION));
    const value = signal * PAIR_LIFT_MAX_FRACTION * scale;
    if (!Number.isFinite(value) || value === 0) return null;

    const points = Math.abs(sum) * LOG_ODDS_TO_POINTS_AT_EVEN;
    const sign = value >= 0 ? "+" : "";
    return {
      termId: "pair-lift",
      value,
      reason:
        `${sign}${value.toFixed(2)}: players on this hero who also built ${hits.map((h) => h.name).join(", ")} ` +
        `won roughly ${points.toFixed(1)} points ${sum >= 0 ? "more" : "less"} often than the items predict ` +
        `separately (${lift.scope}; measured, not proof the items combine)`,
      plain:
        sum >= 0
          ? `Players on this hero who pair it with ${hits.map((h) => h.name).join(" and ")} win more often.`
          : `Players on this hero who pair it with ${hits.map((h) => h.name).join(" and ")} win less often.`,
    };
  },
};

/**
 * Share of one slot's coverage that `categorySplitTerm` can add or subtract at
 * most. That bound needs a single purchase to move the build's whole soul split,
 * which the prior below rules out; in practice a pick moves it by a few percent,
 * so the term lands at about 0.01–0.07 of a slot, in line with `synergyTerm` and
 * `pairTerm`. Chosen 2026-10-20 after trying 0.25 / 0.5 / 1.0 against Fixture
 * 13's leans; see "Measured category split" in engine-design-notes.md.
 */
export const CATEGORY_SPLIT_MAX_FRACTION = 0.5;

/**
 * Pseudo-souls, spread exactly at the target split, added to the held build
 * before reading its current shares. An empty build therefore sits AT the
 * target, so a first pick is neutral (no fixed, cost-blind bonus or penalty),
 * and a small build is not read as wildly off-split after one item.
 */
export const CATEGORY_SPLIT_PRIOR_SOULS = 6400;

/** Below this normalized gain the term is noise and is not shown at all. */
const CATEGORY_SPLIT_MIN_GAIN = 0.002;

const SHOP_CATEGORIES = ["gun", "spirit", "vitality"] as const;

/**
 * Normalized gain in [-1, 1] for spending `paid` souls in `category`:
 * (target share − current share) × the fraction of the resulting build those
 * souls make up. Positive when the category is under its measured share,
 * negative when over, scaled by how much the purchase moves the split. Current
 * shares include the target-shaped prior (see CATEGORY_SPLIT_PRIOR_SOULS).
 */
function splitGain(
  souls: Readonly<Record<ItemCategory, number>>,
  target: CategoryShares,
  category: ItemCategory,
  paid: number,
): number {
  const withPrior = SHOP_CATEGORIES.map(
    (c) => Math.max(0, souls[c]) + CATEGORY_SPLIT_PRIOR_SOULS * target[c],
  );
  const total = withPrior.reduce((sum, v) => sum + v, 0);
  if (!(total > 0)) return 0;
  const current = withPrior[SHOP_CATEGORIES.indexOf(category)] / total;
  return (target[category] - current) * (paid / (total + paid));
}

/**
 * Steers the build's souls per SHOP category (gun / spirit / vitality) toward
 * what high-rank players on this hero buy in the current phase, or end games
 * holding in the late game (heroCategorySplit.json, phaseView).
 * Positive when the candidate moves the held build's soul split toward that,
 * negative when it moves it further away. Counts what is held (owned items
 * included) and the souls actually paid (upgrades at the difference).
 *
 * Why a term and not only the need vector: the need vector works in STAT
 * categories, and shop category is not stat category (Infuser is a vitality
 * item that mostly gives spirit and sustain), so need weights only loosely move
 * souls between shops. The measurement is in shop-category souls, so it is
 * applied there. Relevance-gated like `categoryBonusTerm`: never a reason to
 * buy an item that covers nothing. This is population data, so it is never the
 * headline reason in the simplified view (lib/basketReasons.ts headlineTerm).
 */
export const categorySplitTerm: MarginalTermFn = {
  termId: "category-split",

  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null {
    const split = ctx.categorySplit;
    if (!split) return null;
    // Shop budgets already spend the measured split; the nudge would double it.
    if (ctx.shopBudgets) return null;
    const scale = coverageScalePerSlot(ctx);
    if (scale <= 0) return null;
    const paid = effectiveCost(candidate, heldOf(state)).cost;
    if (!(paid > 0)) return null;
    if (!coversNeed(candidate, state, ctx)) return null;

    const gain = splitGain(state.soulsPerCategory, split, candidate.category, paid);
    if (Math.abs(gain) < CATEGORY_SPLIT_MIN_GAIN) return null;

    const pct = Math.round(split[candidate.category] * 100);
    const basis = split.basis ?? "end games with";
    const reason =
      gain > 0
        ? `Moves your build toward what ${split.scope} ${basis} on this hero (${pct}% ${candidate.category})`
        : `Moves your build further from what ${split.scope} ${basis} on this hero (${pct}% ${candidate.category})`;
    return {
      termId: "category-split",
      value: gain * CATEGORY_SPLIT_MAX_FRACTION * scale,
      reason,
    };
  },
};

/**
 * What high-rank players on THIS hero buy in THIS phase (heroPhaseItems.json):
 * PHASE_ITEM_WEIGHT × one slot's coverage × (buy rate − PHASE_ITEM_BASELINE).
 * It captures kit synergies item maths cannot see (Abrams opens melee items,
 * Lady Geist regen, Wraith Quicksilver Reload), and it is strong: up to 1.8
 * slots of coverage at a 100% buy rate.
 * - The bonus (rate above the baseline) is relevance-gated (`coversNeed`):
 *   popularity never buys an item covering under 2% of a slot.
 * - The penalty (rarely bought) needs no gate and is capped at half the item's
 *   own coverage gain, so it reorders useful items but never pushes one to ≤ 0
 *   (which would stop the basket with souls unspent) and has no cliff at the
 *   gate (audit 2026-10-24).
 * Population data, so HeroBasketSuggestion never makes it the headline reason.
 */
export const phaseItemTerm: MarginalTermFn = {
  termId: "phase-item",

  evaluate(candidate: ItemCandidate, state: BasketState, ctx: BasketContext): MarginalTerm | null {
    const table = ctx.phaseItems;
    if (!table) return null;
    const listed = table.rates[candidate.itemId];
    const rate = typeof listed === "number" && listed > 0 ? Math.min(1, listed) : 0;
    const scale = coverageScalePerSlot(ctx);
    if (!(scale > 0)) return null;
    const raw = PHASE_ITEM_WEIGHT * scale * (rate - PHASE_ITEM_BASELINE);
    let value: number;
    if (raw > 0) {
      if (!coversNeed(candidate, state, ctx)) return null;
      value = raw;
    } else {
      const gain = Math.max(0, computeCoverageGain(candidate, state, ctx).total);
      value = -Math.min(-raw, PHASE_ITEM_PENALTY_MAX_SHARE * gain);
    }
    if (!Number.isFinite(value) || value === 0) return null;
    return {
      termId: "phase-item",
      value,
      reason:
        rate > 0
          ? `${Math.round(rate * 100)}% of ${table.scope} on this hero ${table.basis}`
          : `Rarely bought by ${table.scope} on this hero at this point (under 2%)`,
    };
  },
};

export const DEFAULT_BASKET_TERMS: ReadonlyArray<MarginalTermFn> = [
  coverageTerm,
  categoryBonusTerm,
  categorySplitTerm,
  phaseItemTerm,
  procPlatformTerm,
  hitReliabilityTerm,
  synergyTerm,
  pairTerm,
  analyticsTerm,
];

// ─── Greedy basket construction ──────────────────────────────────────────────

/**
 * What a candidate "costs" for ranking: its effective price, but never less
 * than the souls available per free slot.
 *
 * Budgeted maximum coverage is classically solved greedily by value PER COST.
 * Here there are two budgets, souls and slots. When souls are tight (early: 5,900
 * souls, 12 slots ≈ 490 per slot) every item costs more than a slot's share, so
 * this is value per soul and 800-soul basics compete fairly with 3,200-soul
 * all-rounders, as real early builds do. When slots bind (late: souls per slot
 * above an item's price) cheap items are charged a full slot's share, so the
 * ranking becomes value per slot and strong tier-4 items still win. An upgrade's
 * lower effective cost counts in its favour. Never below 1 (no division by 0).
 */
export function rankingPrice(
  effectiveCost: number,
  budgetLeft: number,
  slotsLeft: number,
  laningSouls?: number,
): number {
  const perSlot = Math.max(0, budgetLeft) / Math.max(1, slotsLeft);
  // Laning tempo (LANING_TEMPO): pass the phase's souls in the laning phase.
  const tempo =
    laningSouls !== undefined && laningSouls > 0
      ? 1 + LANING_TEMPO * (Math.max(0, effectiveCost) / laningSouls)
      : 1;
  return Math.max(1, effectiveCost * tempo, perSlot);
}

/**
 * True if candidate `a` should outrank candidate `b`, given each one's ranking
 * score (marginal value ÷ `rankingPrice`).
 *
 * A STRICT TOTAL ORDER:
 *   1. ranking score, descending
 *   2. cost, ascending (cheaper item wins an equal-value tie)
 *   3. itemId, ascending (final tiebreaker — guarantees total order)
 *
 * Because step 3 can never tie for distinct items, the winner is independent of
 * the order candidates arrive in. Nothing here reads array position.
 */
function outranks(a: ItemCandidate, aValue: number, b: ItemCandidate, bValue: number): boolean {
  if (aValue !== bValue) return aValue > bValue;
  if (a.cost !== b.cost) return a.cost < b.cost;
  return a.itemId.localeCompare(b.itemId) < 0;
}

/**
 * Filters the incoming candidate list to the entries the loop can actually
 * reason about: finite non-negative cost, and one entry per `itemId` (an item
 * cannot be bought twice, and duplicate ids would break the total order that
 * makes tie-breaking deterministic).
 */
function sanitizeCandidates(candidates: ReadonlyArray<ItemCandidate>): ItemCandidate[] {
  const seen = new Set<string>();
  const out: ItemCandidate[] = [];

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.cost) || candidate.cost < 0) continue;
    if (seen.has(candidate.itemId)) continue;
    seen.add(candidate.itemId);
    out.push(candidate);
  }

  return out;
}

function makeResult(
  ctx: BasketContext,
  picks: ReadonlyArray<BasketPick>,
  coverage: Readonly<Record<ScoreCategory, number>>,
  totalCost: number,
  stopReason: BasketResult["stopReason"],
): BasketResult {
  const unmetNeed = zeroCoverage();
  for (const cat of SCORE_CATEGORIES) {
    unmetNeed[cat] = Math.max(0, ctx.target[cat] - coverage[cat]);
  }

  return {
    version: 1,
    needVector: ctx.needVector,
    target: ctx.target,
    picks,
    totalCost,
    coverage,
    unmetNeed,
    stopReason,
  };
}

/**
 * Greedy budgeted maximum coverage over `candidates`.
 *
 * Each iteration: score every still-affordable, not-yet-picked candidate by the
 * sum of `terms[].evaluate(...)`, take the best under the total order in
 * `outranks`, fold it into the state, repeat.
 *
 * Stop reasons, in the precedence the loop applies them:
 * - `"no-candidates"` — nothing to consider before the first pick (empty list,
 *   or everything filtered out by `sanitizeCandidates`).
 * - `"slots"` — no free slot is left (`ctx.maxItems`, net of slots freed by
 *   consumed components) and nothing slot-neutral is worth buying.
 * - `"budget"` — no remaining candidate fits in `soulBudget − spent`. This also
 *   covers exhausting the pool after at least one pick: the spec reserves
 *   `"no-candidates"` for the pre-first-pick case, and "nothing left that fits"
 *   is vacuously true when nothing is left.
 * - `"no-positive-value"` — the best affordable candidate's marginal value is
 *   `<= 0`, i.e. it would add nothing (all its coverage already satisfied) or
 *   would be a net negative once the analytics nudge is applied.
 */
export function constructBasket(
  candidates: ReadonlyArray<ItemCandidate>,
  ctx: BasketContext,
  terms: ReadonlyArray<MarginalTermFn> = DEFAULT_BASKET_TERMS,
): BasketResult {
  // Owned items are never candidates (H7). Callers filter them already; the
  // engine enforces it too.
  const ownedIds = new Set(ctx.owned.map((o) => o.itemId));
  const remaining = sanitizeCandidates(candidates).filter((c) => !ownedIds.has(c.itemId));

  const initial = initialBasketState(ctx);
  let held: ItemCandidate[] = [...(initial.held ?? [])];
  let coverage: Record<ScoreCategory, number> = { ...initial.coverage };
  let soulsPerCategory: Record<ItemCategory, number> = { ...initial.soulsPerCategory };
  let spent = 0;
  // Free slots. A pick takes one; every component it consumes gives one back,
  // so upgrading a held component is slot-neutral and fits even when full.
  let slotsLeft = ctx.maxItems;

  const closures = componentClosures([...ctx.owned, ...remaining]);

  const picks: BasketPick[] = [];
  const picked: ItemCandidate[] = [];

  if (remaining.length === 0) {
    return makeResult(ctx, picks, coverage, spent, "no-candidates");
  }

  let stopReason: BasketResult["stopReason"] = "budget";

  // Souls each shop has paid in this basket (BasketContext.shopBudgets).
  const shopSpent: Record<ItemCategory, number> = { gun: 0, spirit: 0, vitality: 0 };
  const laningSouls = ctx.phase === "early" ? (ctx.laningSouls ?? ctx.soulBudget) : undefined;

  for (;;) {
    const budgetLeft = ctx.soulBudget - spent;

    // Snapshot: `picked` and `held` change below, so copy them rather than
    // handing terms references to arrays that will mutate under them. Both are
    // bounded by MAX_ACTIVE_ITEMS, so the copies are free.
    const state: BasketState = {
      picked: [...picked],
      held: [...held],
      coverage,
      soulsPerCategory,
      spent,
    };

    let bestIndex = -1;
    let bestValue = 0;
    let bestScore = 0;
    let bestTerms: MarginalTerm[] = [];
    let bestCost = { cost: 0, consumes: [] as ItemCandidate[] };
    let bestPooled = false;
    let sawAffordable = false;
    let sawOverBudget = false;

    // With shop budgets, first look only at items their shop can still pay
    // for; when no shop has room for a useful pick, the souls left over are
    // one shared pool (second pass), so a phase still spends its budget.
    const passes = ctx.shopBudgets ? [ctx.shopBudgets, null] : [null];
    for (const shopBudgets of passes) {
      if (shopBudgets === null && bestIndex !== -1 && bestValue > 0) break;
      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        if (blockedByComponents(candidate, state, closures)) continue;

        const eff = effectiveCost(candidate, held);
        if (eff.cost > budgetLeft) {
          sawOverBudget = true;
          continue;
        }
        if (slotsLeft - 1 + eff.consumes.length < 0) continue;
        if (
          shopBudgets &&
          shopSpent[candidate.category] + eff.cost > shopBudgets[candidate.category]
        ) {
          continue;
        }
        sawAffordable = true;

        const candidateTerms: MarginalTerm[] = [];
        let value = 0;

        for (const term of terms) {
          const result = term.evaluate(candidate, state, ctx);
          if (result === null) continue;
          if (!Number.isFinite(result.value)) continue;
          candidateTerms.push(result);
          value += result.value;
        }

        // Rank by value per unit of the BINDING resource, not raw value (see
        // rankingPrice). Raw value let a 3,200-soul all-rounder beat an 800-soul
        // item that was just as efficient, so every hero opened the same way.
        const score = value / rankingPrice(eff.cost, budgetLeft, slotsLeft, laningSouls);
        if (bestIndex === -1 || outranks(candidate, score, remaining[bestIndex], bestScore)) {
          bestIndex = i;
          bestValue = value;
          bestScore = score;
          bestTerms = candidateTerms;
          bestCost = eff;
          bestPooled = ctx.shopBudgets !== undefined && shopBudgets === null;
        }
      }
    }

    if (!sawAffordable) {
      // Out of free slots takes precedence, as before owned coverage existed.
      // With slots left, "budget" means something was too expensive; if every
      // remaining candidate was excluded by H2 instead, nothing useful is left.
      stopReason = slotsLeft <= 0 ? "slots" : sawOverBudget ? "budget" : "no-positive-value";
      break;
    }

    if (bestIndex === -1 || bestValue <= 0) {
      // A full build where only a worthless slot-neutral upgrade fits is still
      // "full" to the player, not "nothing would help".
      stopReason = slotsLeft <= 0 ? "slots" : "no-positive-value";
      break;
    }

    const chosen = remaining[bestIndex];
    const consumedIds = new Set(bestCost.consumes.map((c) => c.itemId));

    // Immutable state advance: terms only ever see a snapshot, so a term cannot
    // observe a half-updated basket regardless of evaluation order. Consumed
    // components leave the held set and their coverage comes off.
    const nextCoverage = zeroCoverage();
    for (const cat of SCORE_CATEGORIES) {
      let consumedValue = 0;
      for (const c of bestCost.consumes) consumedValue += candidateValue(c, cat);
      nextCoverage[cat] = Math.max(0, coverage[cat] - consumedValue) + candidateValue(chosen, cat);
    }

    // Investment counts souls actually paid; a consumed component's souls were
    // already counted when it was bought, so they stay.
    const nextSouls = { ...soulsPerCategory };
    nextSouls[chosen.category] += bestCost.cost;

    coverage = nextCoverage;
    soulsPerCategory = nextSouls;
    spent += bestCost.cost;
    shopSpent[chosen.category] += bestCost.cost;
    slotsLeft += bestCost.consumes.length - 1;
    held = [...held.filter((h) => !consumedIds.has(h.itemId)), chosen];

    picked.push(chosen);
    picks.push({
      item: chosen,
      marginalValue: bestValue,
      // A pick taken from the shared pool (its shop's share of the phase is
      // spent) says so; the zero-value term never changes the ranking.
      terms: bestPooled
        ? [
            ...bestTerms,
            {
              termId: "shop-budget",
              value: 0,
              reason: `Bought from the shared pool: this phase's ${chosen.category} share is already spent`,
            },
          ]
        : bestTerms,
      coverageAfter: nextCoverage,
      effectiveCost: bestCost.cost,
      consumes: bestCost.consumes.map((c) => c.itemId),
      cumulativeCost: spent,
    });

    remaining.splice(bestIndex, 1);

    if (remaining.length === 0) {
      // Pool exhausted after at least one pick — see the stop-reason note above.
      stopReason = "budget";
      break;
    }
  }

  return makeResult(ctx, picks, coverage, spent, stopReason);
}
