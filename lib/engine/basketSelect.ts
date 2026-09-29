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
// guarantee for budgeted maximum coverage. Exactness is not worth the
// determinism and explainability cost here.
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
// `DEFAULT_BASKET_TERMS`). A Milestone F empirical item-pair/covariance term
// plugs in as one more `MarginalTermFn` with no change to the loop.

import type { ItemAnalytics } from "../analyticsStore";
import { MAX_ACTIVE_ITEMS } from "../buildUtils";
import {
  CATEGORY_BONUS_TIERS,
  getCurrentBonusTier,
  isApproachingSignificantBonus,
} from "../categoryBonuses";
import type { ItemCategory } from "../items";
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
import { SCORE_CATEGORIES } from "./types";

// ─── Tunable constants ───────────────────────────────────────────────────────

/**
 * Default per-slot coverage target, in the same raw magnitude units as
 * `ItemCandidate.categoryValues` (which run roughly 0–100 per category).
 *
 * WHAT THIS CONTROLS: where diminishing returns kick in. `makeBasketContext`
 * spreads `coverageTargetPerSlot × maxItems` across the categories in
 * proportion to the need vector; once a category's cumulative coverage reaches
 * its share, further items in that category stop earning coverage value and the
 * basket is pushed to spread elsewhere.
 *
 * WHAT THIS DOES NOT CONTROL: the relative ordering of items WITHIN a single
 * category. Two gun items are ranked against each other by their raw
 * `categoryValues` regardless of this number — it only decides how many of them
 * the basket wants before it starts looking at other categories.
 *
 * 50 is chosen so a mid-tier item (roughly 20–40 in its main category) takes
 * about two items to satisfy one slot's worth of a category's share, which
 * keeps a 12-slot basket from collapsing onto a single category.
 */
const DEFAULT_COVERAGE_TARGET_PER_SLOT = 50;

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
 * the per-slot scale is read back as `sum(target) / maxItems`. Every bounded
 * term is expressed as a fraction of this so the terms stay in proportion to
 * each other no matter how the scale is tuned.
 */
function coverageScalePerSlot(ctx: BasketContext): number {
  if (ctx.maxItems <= 0) return 0;

  let totalTarget = 0;
  for (const cat of SCORE_CATEGORIES) {
    const t = ctx.target[cat];
    if (Number.isFinite(t)) totalTarget += t;
  }

  return totalTarget / ctx.maxItems;
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
 * scaled by `coverageTargetPerSlot × maxItems`, producing a per-category target
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

  const totalTarget = perSlot * maxItems;
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
  };
}

// ─── Marginal value terms ────────────────────────────────────────────────────

/**
 * The core term: coverage gain with DIMINISHING RETURNS.
 *
 *   gain = Σ_cat [ min(target, covered + itemValue) − min(target, covered) ]
 *
 * The `min` clamp is what makes this work. Once a category's cumulative
 * coverage reaches its target, additional items in that category contribute
 * nothing — the 3rd spirit-power item stops paying off — so the greedy loop is
 * pushed to spread across categories and cover a multi-category hero need.
 *
 * That clamp also makes total coverage a submodular set function, which is what
 * gives greedy its (1 − 1/e) approximation guarantee.
 */
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

  for (const cat of SCORE_CATEGORIES) {
    const itemValue = candidateValue(candidate, cat);
    if (itemValue === 0) continue;

    const target = Number.isFinite(ctx.target[cat]) ? ctx.target[cat] : 0;
    const covered = Number.isFinite(state.coverage[cat]) ? state.coverage[cat] : 0;

    const before = Math.min(target, covered);
    const after = Math.min(target, covered + itemValue);
    const catGain = after - before;

    if (catGain > 0) {
      total += catGain;
      perCategory.push({ cat, gain: catGain });
    }
  }

  perCategory.sort((a, b) => {
    if (b.gain !== a.gain) return b.gain - a.gain;
    return a.cat.localeCompare(b.cat);
  });

  return { total, perCategory };
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
 * RELEVANCE GATE: the bonus only applies to a candidate that also delivers some
 * un-met coverage. Without the gate an item with zero relevance to the hero
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

    const cost = Number.isFinite(candidate.cost) && candidate.cost > 0 ? candidate.cost : 0;
    if (cost === 0) return null;

    if (computeCoverageGain(candidate, state, ctx).total <= 0) return null;

    const rawBefore = state.soulsPerCategory[candidate.category];
    const before = Number.isFinite(rawBefore) && rawBefore > 0 ? rawBefore : 0;
    const after = before + cost;

    const tierBefore = getCurrentBonusTier(before);
    const tierAfter = getCurrentBonusTier(after);
    const crossed = tierAfter !== null && tierBefore?.soulsThreshold !== tierAfter.soulsThreshold;

    let fraction = 0;
    let detail = "";

    if (crossed && tierAfter !== null) {
      // A single purchase can jump several tiers at once, so credit the highest
      // tier reached — and treat the significant tier as earned if it was
      // passed on the way, even when the item lands above it.
      const passedSignificant = before < SIGNIFICANT_THRESHOLD && after >= SIGNIFICANT_THRESHOLD;

      if (passedSignificant) {
        fraction = CROSS_SIGNIFICANT_TIER_FRACTION;
        detail = `crosses the ${formatSouls(SIGNIFICANT_THRESHOLD)} significant investment tier`;
      } else {
        fraction = CROSS_TIER_FRACTION;
        detail = `crosses the ${formatSouls(tierAfter.soulsThreshold)} investment tier`;
      }
    } else if (isApproachingSignificantBonus(after) && !isApproachingSignificantBonus(before)) {
      fraction = APPROACH_SIGNIFICANT_FRACTION;
      detail = "moves into range of the significant investment tier";
    }

    if (fraction <= 0) return null;

    const value = Math.min(fraction, CATEGORY_BONUS_MAX_FRACTION) * scale;

    return {
      termId: "categoryBonus",
      value,
      reason: `${candidate.category} souls ${formatSouls(before)} → ${formatSouls(after)} ${detail} (+${value.toFixed(2)})`,
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

    if (computeCoverageGain(candidate, state, ctx).total <= 0) return null;

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
export const DEFAULT_BASKET_TERMS: ReadonlyArray<MarginalTermFn> = [
  coverageTerm,
  categoryBonusTerm,
  analyticsTerm,
];

// ─── Greedy basket construction ──────────────────────────────────────────────

/**
 * True if candidate `a` should outrank candidate `b`.
 *
 * A STRICT TOTAL ORDER, mirroring engine.ts / scoreItems.ts exactly:
 *   1. marginal value, descending
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
 * - `"slots"` — the basket reached `ctx.maxItems`.
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
  const remaining = sanitizeCandidates(candidates);

  let coverage = zeroCoverage();
  let soulsPerCategory = zeroSoulsPerCategory();
  let spent = 0;

  const picks: BasketPick[] = [];
  const picked: ItemCandidate[] = [];

  if (remaining.length === 0) {
    return makeResult(ctx, picks, coverage, spent, "no-candidates");
  }

  let stopReason: BasketResult["stopReason"] = "budget";

  for (;;) {
    if (picks.length >= ctx.maxItems) {
      stopReason = "slots";
      break;
    }

    const budgetLeft = ctx.soulBudget - spent;

    // Snapshot: `picked` is appended to below, so copy it rather than handing
    // terms a reference to an array that will mutate under them. Bounded by
    // MAX_ACTIVE_ITEMS, so the copy is free.
    const state: BasketState = { picked: [...picked], coverage, soulsPerCategory, spent };

    let bestIndex = -1;
    let bestValue = 0;
    let bestTerms: MarginalTerm[] = [];
    let sawAffordable = false;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      if (candidate.cost > budgetLeft) continue;
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

      if (bestIndex === -1 || outranks(candidate, value, remaining[bestIndex], bestValue)) {
        bestIndex = i;
        bestValue = value;
        bestTerms = candidateTerms;
      }
    }

    if (!sawAffordable) {
      stopReason = "budget";
      break;
    }

    if (bestIndex === -1 || bestValue <= 0) {
      stopReason = "no-positive-value";
      break;
    }

    const chosen = remaining[bestIndex];

    // Immutable state advance: terms only ever see a snapshot, so a term cannot
    // observe a half-updated basket regardless of evaluation order.
    const nextCoverage = zeroCoverage();
    for (const cat of SCORE_CATEGORIES) {
      nextCoverage[cat] = coverage[cat] + candidateValue(chosen, cat);
    }

    const nextSouls = { ...soulsPerCategory };
    nextSouls[chosen.category] += chosen.cost;

    coverage = nextCoverage;
    soulsPerCategory = nextSouls;
    spent += chosen.cost;

    picked.push(chosen);
    picks.push({
      item: chosen,
      marginalValue: bestValue,
      terms: bestTerms,
      coverageAfter: nextCoverage,
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
