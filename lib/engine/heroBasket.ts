// lib/engine/heroBasket.ts — the hero-need basket pipeline, in one pure function.
//
// need vector → rank-aware accuracy → candidates → context → constructBasket().
// This used to live inline in BuildClient's `heroBasket` useMemo, copied by
// src/scripts/basketProbe.ts. It is extracted so the planner, the probe, the
// starter build (starterBuild.ts) and the live fixtures all run the SAME
// pipeline and cannot drift apart. Behaviour is unchanged by the extraction.
//
// Pure: same inputs, same output. All data arrives as arguments; nothing is
// fetched here.

import type { Item } from "../items";
import type { HeroAbility } from "../abilityCoefficients";
import type { HeroBaseStats } from "../heroStats";
import type { HeroAccuracy, ItemAnalytics } from "../analyticsStore";
import { resolveAccuracyAtRank } from "../analyticsStore";
import { MAX_ACTIVE_ITEMS } from "../buildUtils";
import { constructBasket, makeBasketContext } from "./basketSelect";
import {
  deriveHeroNeedVector,
  deriveHitReliabilityFactor,
  deriveProcPlatformFactor,
} from "./heroNeed";
import { toItemCandidates } from "./itemAdapter";
import type { HeroPairLift } from "./pairLift";
import { adjustSplitForAccuracy, applyCategorySplit } from "./categorySplit";
import type { HeroCategorySplit } from "./categorySplit";
import type { BasketContext, BasketResult, HeroNeedVector, ItemCandidate } from "./types";

export interface HeroBasketInputs {
  heroAbilities: ReadonlyArray<HeroAbility>;
  heroBaseStats: HeroBaseStats;
  /** Base stats of every visible hero; the need vector z-scores against it. */
  heroRoster: ReadonlyArray<HeroBaseStats>;
  /** Every shop item. Owned items are filtered out here, not by the caller. */
  allItems: ReadonlyArray<Item>;
  /** Items already in the build. They are never candidates and their cost is committed. */
  ownedItems: ReadonlyArray<Item>;
  /** Cumulative souls at this point in the game (BOON_THRESHOLDS[boonLevel].souls). */
  souls: number;
  /** Planner boon slider index; scales candidates' published coefficients. */
  boonLevel: number;
  /** The hero's total spirit power including owned items; scales candidates. */
  spiritPower: number;
  itemAnalytics?: ReadonlyMap<number, ItemAnalytics>;
  /** Omitted => no accuracy discount (nominal gun DPS), as before. */
  heroAccuracy?: ReadonlyMap<number, HeroAccuracy>;
  /** Rank tier for accuracy; null = pooled across ranks. */
  rankTier: number | null;
  /** This hero's measured pair-lift slice; omitted => pairTerm inert. */
  pairLift?: HeroPairLift;
  /**
   * This hero's measured gun / spirit / vitality split (heroCategorySplit.json).
   * Redistributes the kit-derived need between those families; omitted (thin
   * data) => the kit-only need vector, unchanged.
   */
  categorySplit?: HeroCategorySplit;
  /**
   * Ablation switch for before/after checks (basketProbe): apply the split to
   * the need vector only, to the basket term only, or both (default).
   */
  categorySplitMode?: "both" | "need-only" | "term-only";
}

export interface HeroBasketRun {
  basket: BasketResult;
  ctx: BasketContext;
  candidates: ReadonlyArray<ItemCandidate>;
  needVector: HeroNeedVector;
  procPlatformFactor: number;
  hitReliabilityFactor: number;
}

/** Null when the hero kit or item list is missing (nothing meaningful to build). */
export function runHeroBasket(input: HeroBasketInputs): HeroBasketRun | null {
  const { heroAbilities, heroBaseStats, heroRoster, allItems, ownedItems } = input;
  if (heroAbilities.length === 0 || allItems.length === 0) return null;

  // Discount each hero's nominal gun DPS by how much of it actually lands at
  // the player's own rank. Nominal DPS assumes perfect accuracy, which
  // over-rates spread weapons that count every pellet.
  const gunAccuracyByHeroId = input.heroAccuracy
    ? resolveAccuracyAtRank(input.heroAccuracy, input.rankTier)
    : undefined;

  // The measured split (when there is one) decides how much of the build goes to
  // gun vs spirit vs vitality; the kit decides the rest (see categorySplit.ts).
  // It was measured at Oracle+, so its gun share is scaled by this hero's
  // accuracy at the player's rank relative to Oracle+: gun items are worth less
  // to a player who lands fewer shots, as the kit-derived gun need modelled.
  const heroId = heroBaseStats.heroId;
  let split = input.categorySplit;
  if (split && input.heroAccuracy) {
    const atRank = gunAccuracyByHeroId?.get(heroId);
    const atSplit = resolveAccuracyAtRank(input.heroAccuracy, split.rankTier).get(heroId);
    if (atRank !== undefined && atSplit !== undefined && atSplit > 0) {
      split = adjustSplitForAccuracy(split, atRank / atSplit);
    }
  }
  const mode = input.categorySplitMode ?? "both";

  const needVector = applyCategorySplit(
    deriveHeroNeedVector({
      abilities: heroAbilities,
      baseStats: heroBaseStats,
      roster: heroRoster,
      gunAccuracyByHeroId,
    }),
    mode === "term-only" ? undefined : split,
  );

  const ownedIds = new Set(ownedItems.map((i) => i.id));

  // Item values are NOT flat — Mystic Shot's proc is `40 + 0.9 x spirit
  // power`, so pricing it at 40 understates it ~3.3x at 100 spirit. Resolve
  // the published coefficients against what the player actually has.
  //
  // Both inputs come from the hero and the ALREADY-OWNED build, never from
  // the candidates being chosen: an item's value must not depend on which
  // other items the basket happens to pick, or selection becomes circular.
  const valuation = { spiritPower: input.spiritPower, boonLevel: input.boonLevel };
  const candidates = toItemCandidates(
    allItems.filter((i) => !ownedIds.has(i.id)),
    valuation,
  );
  // Owned items, valued the same way: they seed the basket's coverage and
  // investment souls, and an upgrade candidate can consume them (PR 2c).
  const ownedCandidates = toItemCandidates(ownedItems, valuation);

  const committed = ownedItems.reduce((sum, i) => sum + i.cost, 0);

  // Separate from gun need on purpose: a bullet proc's worth scales with how
  // many bullets LAND per second, not with how hard each one hits. The two
  // genuinely diverge — a hero can have the roster's weakest gun and still be
  // one of its best platforms for per-hit items.
  const procPlatformFactor = deriveProcPlatformFactor({
    baseStats: heroBaseStats,
    roster: heroRoster,
    gunAccuracyByHeroId,
  });

  // Cooldown-gated bullet effects (Mystic Shot) are spent by FIRING, so a
  // miss wastes the charge. Accuracy only -- the cooldown fixes the rate.
  const hitReliabilityFactor = deriveHitReliabilityFactor({
    baseStats: heroBaseStats,
    roster: heroRoster,
    gunAccuracyByHeroId,
  });

  const ctx = makeBasketContext({
    needVector,
    soulBudget: Math.max(0, input.souls - committed),
    maxItems: Math.max(0, MAX_ACTIVE_ITEMS - ownedItems.length),
    itemAnalytics: input.itemAnalytics,
    procPlatformFactor,
    hitReliabilityFactor,
    // Lets synergyTerm and pairTerm credit a pair whose other half the
    // player already owns.
    ownedItemNames: new Map(ownedItems.map((i) => [i.id, i.name])),
    // Measured pair lift for this hero; also lets a precise measurement
    // override a hand-authored synergy rule ("measured wins").
    pairLift: input.pairLift,
    ownedCandidates,
    categorySplit: mode === "need-only" ? undefined : split,
  });

  return {
    basket: constructBasket(candidates, ctx),
    ctx,
    candidates,
    needVector,
    procPlatformFactor,
    hitReliabilityFactor,
  };
}
