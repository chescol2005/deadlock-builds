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
import { damagePerCastFactor } from "../abilityCoefficients";
import type { HeroAbility } from "../abilityCoefficients";
import type { HeroBaseStats } from "../heroStats";
import { calculateStatsAtBoon } from "../heroStats";
import type { HeroDamageModel } from "./heroDamage";
import { abilityChargeCredit, heroDps } from "./heroDamage";
import { ownedGapHeal } from "./heroFight";
import { BOON_THRESHOLDS } from "../boonSystem";
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
import {
  adjustSplitForAccuracy,
  applyCategorySplit,
  applyStatProfile,
  phaseForSouls,
  phaseView,
  FINAL_SPLIT_BASIS,
} from "./categorySplit";
import type { GamePhase, HeroCategorySplit } from "./categorySplit";
import { phaseItemBasis } from "./phaseItems";
import type { HeroPhaseItems } from "./phaseItems";
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
   * This hero's per-phase item buy rates (heroPhaseItems.json slice). Omitted
   * (too few matches, or the table failed to load) => phaseItemTerm inert.
   */
  phaseItems?: HeroPhaseItems;
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
  //
  // PHASE-AWARE (coverage-model PR 2): the basket shops in the phase its souls
  // put it in (phaseForSouls), so it follows what players buy THEN — early
  // purchases differ a lot from the final inventory (Oracle+ Seven: 44% gun in
  // the first 10 minutes, 17% by the end). The phase's stat profile also sets
  // the categories the kit cannot derive (antiHeal, sustain, utility, economy,
  // mobility), which were a flat placeholder for every hero.
  const view = input.categorySplit
    ? phaseView(input.categorySplit, phaseForSouls(input.souls))
    : null;
  let split = view
    ? {
        ...view.shares,
        scope: input.categorySplit?.scope ?? "",
        basis: view.basis,
        rankTier: input.categorySplit?.rankTier ?? 0,
      }
    : undefined;
  if (split && input.heroAccuracy) {
    const atRank = gunAccuracyByHeroId?.get(heroId);
    const atSplit = resolveAccuracyAtRank(input.heroAccuracy, split.rankTier).get(heroId);
    if (atRank !== undefined && atSplit !== undefined && atSplit > 0) {
      split = adjustSplitForAccuracy(split, atRank / atSplit);
    }
  }
  const mode = input.categorySplitMode ?? "both";

  const kitNeed = deriveHeroNeedVector({
    abilities: heroAbilities,
    baseStats: heroBaseStats,
    roster: heroRoster,
    gunAccuracyByHeroId,
  });
  const needVector =
    mode === "term-only"
      ? kitNeed
      : applyStatProfile(applyCategorySplit(kitNeed, split), view?.profile);

  const ownedIds = new Set(ownedItems.map((i) => i.id));

  // Item values are NOT flat — Mystic Shot's proc is `40 + 0.9 x spirit
  // power`, so pricing it at 40 understates it ~3.3x at 100 spirit. Resolve
  // the published coefficients against what the player actually has.
  //
  // Both inputs come from the hero and the ALREADY-OWNED build, never from
  // the candidates being chosen: an item's value must not depend on which
  // other items the basket happens to pick, or selection becomes circular.
  // One value scale (2026-10-24): every item stat and effect is priced in %
  // of THIS hero's fight value, through its own weapon, ability kit, health
  // and move speed (heroDamage.ts, heroFight.ts). Undefined model (no usable
  // weapon data) = the hero-agnostic valuation.
  const damageModel = deriveHeroDamageModel({
    baseStats: heroBaseStats,
    abilities: heroAbilities,
    boonLevel: input.boonLevel,
    spiritPower: input.spiritPower,
    accuracy: resolveHeroAccuracy(heroId, gunAccuracyByHeroId),
    // The phase this basket shops in, so charges are priced in the same phase.
    phase: phaseForSouls(input.souls),
  });
  // Candidates' recovery is priced on top of what the owned build already
  // heals; owned items on top of base regen only, never on top of themselves.
  const heroDamage = withOwnedGapHeal(damageModel, heroBaseStats.healthRegen, ownedItems);
  const ownedHeroDamage = withOwnedGapHeal(damageModel, heroBaseStats.healthRegen, []);
  const valuation = {
    spiritPower: input.spiritPower,
    boonLevel: input.boonLevel,
    ...(heroDamage ? { heroDamage } : {}),
  };
  const candidates = toItemCandidates(
    allItems.filter((i) => !ownedIds.has(i.id)),
    valuation,
  );
  // Owned items, valued the same way: they seed the basket's coverage and
  // investment souls, and an upgrade candidate can consume them (PR 2c).
  const ownedCandidates = toItemCandidates(ownedItems, {
    ...valuation,
    ...(ownedHeroDamage ? { heroDamage: ownedHeroDamage } : {}),
  });

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
    phase: phaseForSouls(input.souls),
    laningSouls: input.souls,
    // The late phase (and a hero with no phase data) uses the FINAL split: a
    // cumulative share, so the budgets count souls already held per shop.
    splitBasis: view?.basis === FINAL_SPLIT_BASIS ? "cumulative" : "increment",
    // An empty phase (no item above the table's floor) is "no signal", not
    // "nobody buys anything".
    phaseItems:
      input.phaseItems && Object.keys(input.phaseItems[phaseForSouls(input.souls)]).length > 0
        ? {
            rates: input.phaseItems[phaseForSouls(input.souls)],
            scope: input.phaseItems.scope,
            basis: phaseItemBasis(phaseForSouls(input.souls)),
          }
        : undefined,
    // Spend each shop's measured phase share (shop budgets); the split term's
    // nudge is inert then. The ablation modes keep the old nudge.
    spendByShop: mode === "both",
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

/**
 * This hero's shot accuracy: its own measured value at the player's rank, else
 * the roster median (missing data is not zero), else 1 when nothing is known.
 */
function resolveHeroAccuracy(
  heroId: number,
  accuracyByHeroId: ReadonlyMap<number, number> | undefined,
): number {
  const own = accuracyByHeroId?.get(heroId);
  if (typeof own === "number" && Number.isFinite(own) && own > 0) return Math.min(1, own);
  const known = [...(accuracyByHeroId?.values() ?? [])]
    .filter((a) => Number.isFinite(a) && a > 0)
    .sort((a, b) => a - b);
  return known.length > 0 ? Math.min(1, known[Math.floor(known.length / 2)]) : 1;
}

/**
 * The model with `survival.ownedGapHeal` set: HP the hero's base regen and the
 * owned items restore between trades, so a candidate's recovery is priced on
 * top of it (Milestone G2a). From the hero and the ALREADY-OWNED build only.
 */
export function withOwnedGapHeal(
  model: HeroDamageModel | undefined,
  baseRegen: number,
  ownedItems: ReadonlyArray<Item>,
): HeroDamageModel | undefined {
  if (!model?.survival) return model;
  const dps = heroDps(model);
  // A component another owned item upgrades from was consumed: count it once.
  const consumed = new Set(ownedItems.flatMap((i) => i.componentItems ?? []));
  const active = ownedItems.filter((i) => !consumed.has(i.id));
  const healHp = ownedGapHeal(baseRegen, active, {
    maxHealth: model.survival.maxHealth,
    moveSpeed: model.survival.moveSpeed,
    gunDps: dps.gun,
    abilityDps: dps.ability,
  });
  return { ...model, survival: { ...model.survival, ownedGapHeal: healHp } };
}

/**
 * The hero's damage and survival model at this boon level and spirit power, or
 * undefined when its weapon or ability kit does not parse (the valuation then
 * stays hero-agnostic: missing data is not zero). Without a damaging ability,
 * every spirit-power item would price at 0 and drop behind the relevance gate
 * (audit 2026-10-24). `survival` is set only when health and move speed are
 * known; otherwise non-damage stats keep the hero-agnostic valuation instead
 * of all pricing at 0.
 */
export function deriveHeroDamageModel(input: {
  baseStats: HeroBaseStats;
  abilities: ReadonlyArray<HeroAbility>;
  boonLevel: number;
  spiritPower: number;
  accuracy: number;
  /**
   * The phase the basket shops in (upgrade-charge credit, R2c). runHeroBasket
   * passes phaseForSouls(souls); omitted, it is the boon level's own souls.
   */
  phase?: GamePhase;
}): HeroDamageModel | undefined {
  const { baseStats } = input;
  const phase = input.phase ?? phaseForSouls(BOON_THRESHOLDS[input.boonLevel]?.souls ?? 0);
  const atBoon = calculateStatsAtBoon(baseStats, input.boonLevel);
  const perShot = atBoon.bulletDamage;
  const rate = baseStats.bulletsPerSecond;
  const clip = baseStats.ammo;
  const reload = baseStats.reloadTime;
  if (!(perShot > 0 && rate > 0 && clip > 0 && reload >= 0)) return undefined;
  const damaging = input.abilities.some((a) => (a.baseDamage ?? 0) > 0 && (a.cooldown ?? 0) > 0);
  if (!damaging) return undefined;
  const maxHealth = atBoon.maxHealth;
  const moveSpeed = baseStats.moveSpeed;
  const survivalKnown =
    Number.isFinite(maxHealth) && maxHealth > 0 && Number.isFinite(moveSpeed) && moveSpeed > 0;
  // The API's with-reload DPS includes a small per-clip delay beyond
  // clip / rate + reload (~0.25 s, data-verifier 2026-10-20). Recover it from
  // the BASE stats so the model reproduces the API's own sustained DPS.
  const baseCycle =
    baseStats.dpsWithReload > 0 ? (clip * baseStats.bulletDamage) / baseStats.dpsWithReload : 0;
  const overhead = baseCycle > 0 ? Math.max(0, baseCycle - clip / rate - reload) : 0;
  return {
    gun: { perShot, shotsPerSecond: rate, clip, reload, overhead },
    accuracy: input.accuracy,
    // Per cast: a DPS ability deals its rate for `damageSeconds` (item scoring
    // review C1; Siphon Life 22 DPS x 4 s, not 22).
    abilities: input.abilities.map((a) => {
      const perCast = damagePerCastFactor(a);
      const chargeCredit = abilityChargeCredit(a, phase);
      return {
        baseDamage: a.baseDamage != null ? a.baseDamage * perCast : null,
        spiritScaling: a.spiritScaling != null ? a.spiritScaling * perCast : null,
        cooldown: a.cooldown,
        ...(a.damageSeconds != null ? { seconds: a.damageSeconds } : {}),
        ...(chargeCredit > 0 ? { chargeCredit } : {}),
      };
    }),
    spiritPower: input.spiritPower,
    ...(atBoon.lightMeleeDamage > 0 ? { meleeDamage: atBoon.lightMeleeDamage } : {}),
    ...(survivalKnown ? { survival: { maxHealth, moveSpeed } } : {}),
  };
}
