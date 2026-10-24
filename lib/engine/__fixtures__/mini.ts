// lib/engine/__fixtures__/mini.ts
//
// Smoke test + regression harness for the scoring engine.
// Uses the real stage implementations — not stubs.
//
// Run with:  npx ts-node --project tsconfig.json lib/engine/__fixtures__/mini.ts
// or wire into a test runner script if added to package.json.

import type { ItemAnalytics } from "../../analyticsStore";
import type { HeroAbility, AbilityUpgradeTier } from "../../abilityCoefficients";
import type { HeroBaseStats } from "../../heroStats";
import type { Item } from "../../items";
import {
  analyticsTerm,
  categoryBonusTerm,
  CATEGORY_SPLIT_MAX_FRACTION,
  categorySplitTerm,
  constructBasket,
  coverageTerm,
  DEFAULT_BASKET_TERMS,
  effectiveCost,
  initialBasketState,
  hitReliabilityTerm,
  makeBasketContext,
  PAIR_LIFT_MAX_FRACTION,
  pairTerm,
  rankingPrice,
  saturate,
  procPlatformTerm,
  SYNERGY_MAX_FRACTION,
  synergyTerm,
} from "../basketSelect";
import pairLiftTableJson from "../data/pairLiftTable.json";
import categorySplitTableJson from "../data/heroCategorySplit.json";
import {
  adjustSplitForAccuracy,
  applyCategorySplit,
  CATEGORY_FAMILIES,
  flooredShares,
  heroCategorySplit,
  MAX_ACCURACY_RATIO,
  EARLY_PHASE_MAX_SOULS,
  MID_PHASE_MAX_SOULS,
  PROFILE_CATEGORIES,
  applyStatProfile,
  phaseForSouls,
  phaseView,
  MIN_FAMILY_SHARE,
} from "../categorySplit";
import type { CategorySplitTable, HeroCategorySplit } from "../categorySplit";
import {
  componentClosure,
  estimateTau2,
  fitHeroPairs,
  heroPairLift,
  MIN_GROUP_MATCHES,
  pairInteraction,
  pairLiftFor,
  pairLiftKey,
  pairStatKey,
  poolInteractions,
  removeItemEffects,
  shrinkTowardZero,
} from "../pairLift";
import type {
  FitItem,
  HeroPairLift,
  PairInteraction,
  PairLiftEntry,
  PairLiftTable,
  PairStratum,
  WinCell,
} from "../pairLift";
import { findSynergyRules, SYNERGY_RULES } from "../synergy";
import { ANTI_SYNERGY_RULES } from "../../scoring/antiSynergy";
import { estimateEffectValues } from "../effectEstimator";
import {
  abilityDps,
  castsPerTrade,
  CONDITIONAL_DAMAGE_WEIGHT,
  damageValues,
  HEADSHOT_IN_TRADE,
  MAX_CASTS_PER_TRADE,
  sustainedGunDps,
  TRADE_GAP_SECONDS,
  TRADE_SECONDS,
} from "../heroDamage";
import type { HeroDamageModel } from "../heroDamage";
import { estimateFightValue, fightValues } from "../heroFight";
import { normalizeItem } from "../../itemNormalizer";
import { deriveHeroDamageModel } from "../heroBasket";
import { recommendItems } from "../engine";
import { deriveHeroNeedVector } from "../heroNeed";
import { resolveScaledStats, toItemCandidate } from "../itemAdapter";
import { baseCategoryStage } from "../stages/baseCategoryStage";
import { intentWeightStage } from "../stages/intentWeightStage";
import type {
  BasketState,
  EngineInput,
  EngineOutput,
  ItemCandidate,
  ScoreCategory,
} from "../types";
import { SCORE_CATEGORIES } from "../types";

// ---------------------------------------------
// Candidates
// ---------------------------------------------
// NOTE (Milestone E): `damage` was split into `gunDamage`/`spiritDamage`, and
// `numericId`/`category` were added to ItemCandidate. Each item below keeps its
// original damage value in exactly ONE of the two new categories, which leaves
// every assertion in this file scoring identically to the pre-split version —
// `burst` intent maps to both damage categories at full weight, so the total is
// invariant to the split. See stages/baseCategoryStage.ts.
const candidates: ReadonlyArray<ItemCandidate> = [
  {
    itemId: "item_a",
    numericId: 900101,
    name: "Burst Blade",
    category: "gun",
    cost: 3000,
    categoryValues: {
      gunDamage: 80,
      spiritDamage: 0,
      bonusHealth: 10,
      resist: 0,
      shield: 0,
      gunShred: 0,
      spiritShred: 0,
      antiHeal: 0,
      sustain: 0,
      mobility: 5,
      utility: 0,
      economy: 0,
    },
    // 0 = no per-hit mechanic, so procPlatformTerm stays inert here and every
    // pre-existing assertion in this file is unaffected.
    procReliance: 0,
    hitDependence: 0,
    tags: ["burst", "damage"],
  },
  {
    itemId: "item_b",
    numericId: 900102,
    name: "Tank Shield",
    category: "vitality",
    cost: 2800,
    categoryValues: {
      gunDamage: 10,
      spiritDamage: 0,
      bonusHealth: 60,
      resist: 30,
      shield: 0,
      gunShred: 0,
      spiritShred: 0,
      antiHeal: 0,
      sustain: 0,
      mobility: 0,
      utility: 0,
      economy: 0,
    },
    // 0 = no per-hit mechanic, so procPlatformTerm stays inert here and every
    // pre-existing assertion in this file is unaffected.
    procReliance: 0,
    hitDependence: 0,
    tags: ["tank", "armor"],
  },
  {
    itemId: "item_c",
    numericId: 900103,
    name: "Balanced Boots",
    category: "vitality",
    cost: 2500,
    categoryValues: {
      gunDamage: 40,
      spiritDamage: 0,
      bonusHealth: 20,
      resist: 0,
      shield: 0,
      gunShred: 0,
      spiritShred: 0,
      antiHeal: 0,
      sustain: 20,
      mobility: 20,
      utility: 0,
      economy: 0,
    },
    // 0 = no per-hit mechanic, so procPlatformTerm stays inert here and every
    // pre-existing assertion in this file is unaffected.
    procReliance: 0,
    hitDependence: 0,
    tags: ["mobility", "speed"],
  },
  {
    itemId: "item_d",
    numericId: 900104,
    name: "Lifedrain Pendant",
    category: "spirit",
    cost: 3200,
    categoryValues: {
      gunDamage: 0,
      spiritDamage: 20,
      bonusHealth: 0,
      resist: 0,
      shield: 0,
      gunShred: 0,
      spiritShred: 0,
      antiHeal: 0,
      sustain: 95,
      mobility: 0,
      utility: 10,
      economy: 5,
    },
    // 0 = no per-hit mechanic, so procPlatformTerm stays inert here and every
    // pre-existing assertion in this file is unaffected.
    procReliance: 0,
    hitDependence: 0,
    tags: ["sustain", "lifesteal", "heal"],
  },
];

// ---------------------------------------------
// Test Cases
// ---------------------------------------------
type TestCase = {
  label: string;
  input: EngineInput;
  expect: {
    topItemId: string;
    minFinalScore?: number;
  };
};

const testCases: TestCase[] = [
  {
    label: "Pure burst intent → Burst Blade wins",
    input: {
      heroId: "hero_test",
      intent: { burst: 1, sustain: 0, tank: 0, mobility: 0, utility: 0 },
      currentItems: [],
    },
    expect: { topItemId: "item_a" },
  },
  {
    label: "Pure tank intent → Tank Shield wins",
    input: {
      heroId: "hero_test",
      intent: { burst: 0, sustain: 0, tank: 1, mobility: 0, utility: 0 },
      currentItems: [],
    },
    expect: { topItemId: "item_b" },
  },
  {
    label: "Pure sustain intent → Lifedrain Pendant wins",
    input: {
      heroId: "hero_test",
      intent: { burst: 0, sustain: 1, tank: 0, mobility: 0, utility: 0 },
      currentItems: [],
    },
    expect: { topItemId: "item_d" },
  },
  {
    label: "Pure mobility intent → Balanced Boots wins",
    input: {
      heroId: "hero_test",
      intent: { burst: 0, sustain: 0, tank: 0, mobility: 1, utility: 0 },
      currentItems: [],
    },
    expect: { topItemId: "item_c" },
  },
  {
    label: "Even intent → deterministic sort (finalScore desc, cost asc, itemId asc)",
    input: {
      heroId: "hero_test",
      intent: { burst: 1, sustain: 1, tank: 1, mobility: 1, utility: 1 },
      currentItems: [],
    },
    // With equal weights normalized to 0.2 each, item_d has high survivability
    // + economy + utility. Top item is score-dependent — just assert it's stable.
    expect: { topItemId: "item_d" },
  },
];

// ---------------------------------------------
// Runner
// ---------------------------------------------
let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const output: EngineOutput = recommendItems(tc.input, candidates, [
    baseCategoryStage,
    intentWeightStage,
  ]);

  const top = output.recommendations[0];
  const topId = top?.item.itemId;

  const ok =
    topId === tc.expect.topItemId &&
    (tc.expect.minFinalScore === undefined || (top?.finalScore ?? 0) >= tc.expect.minFinalScore);

  if (ok) {
    console.log(`  ✅ ${tc.label}`);
    passed++;
  } else {
    console.error(`  ❌ ${tc.label}`);
    console.error(`     expected top: ${tc.expect.topItemId}, got: ${topId}`);
    console.error(
      `     scores: ${output.recommendations.map((r) => `${r.item.itemId}=${r.finalScore.toFixed(4)}`).join(" | ")}`,
    );
    failed++;
  }
}

// ---------------------------------------------
// Milestone E fixtures
// ---------------------------------------------
// These cover the three new modules: itemAdapter (Item -> ItemCandidate),
// heroNeed (hero kit -> need vector) and basketSelect (joint greedy selection).
// All synthetic/hermetic — no live API calls, per the fixture convention.

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    if (detail) console.error(`     ${detail}`);
    failed++;
  }
}

function zeroValues(): Record<ScoreCategory, number> {
  const out = {} as Record<ScoreCategory, number>;
  for (const cat of SCORE_CATEGORIES) out[cat] = 0;
  return out;
}

// ── itemAdapter ──────────────────────────────────────────────────────────────
console.log("\n6. itemAdapter: Item -> ItemCandidate");
{
  const item: Item = {
    id: "test_spirit_item",
    numericId: 4242,
    name: "Test Spirit Item",
    category: "spirit",
    tier: 2,
    cost: 1250,
    tags: ["burst"],
    stats: {
      TechPower: 15, // -> spiritDamage, baseline weight
      BonusHealth: 200, // -> bonusHealth, large-flat weight (0.1) => 20
      BulletResist: 12, // -> resist, baseline weight — a SEPARATE category
      CombatBarrier: 300, // -> shield, large-flat weight (0.1) => 30
      ThisKeyIsNotMapped: 999, // must be ignored, not guessed into a category
      // Sentinels, NOT debuffs — verified across all 156 live items:
      // AbilityCooldownBetweenCharge is -1 on 156/156 and ChannelMoveSpeed is
      // -1 on 155/156. Scoring them charged a phantom penalty to every item.
      AbilityCooldownBetweenCharge: -1,
      ChannelMoveSpeed: -1,
    },
    statScaling: {},
  };

  const candidate = toItemCandidate(item);

  assert(candidate.itemId === "test_spirit_item", "adapter carries id through");
  assert(candidate.numericId === 4242, "adapter carries numericId (the analytics join key)");
  assert(candidate.category === "spirit", "adapter carries shop category");
  assert(
    candidate.categoryValues.spiritDamage === 15,
    "TechPower maps to spiritDamage at baseline weight",
    `Got: ${candidate.categoryValues.spiritDamage}`,
  );
  assert(
    candidate.categoryValues.bonusHealth === 20,
    "BonusHealth 200 scales to bonusHealth 20 (large-flat weight)",
    `Got: ${candidate.categoryValues.bonusHealth}`,
  );
  // Flat health and % resist must land in DIFFERENT categories: effective HP is
  // health/(1-resist), so resist multiplies the pool you already own and is
  // worth ~2x more absolute EHP to the roster's beefiest hero than its
  // squishiest. Collapsing them would hide that.
  assert(
    candidate.categoryValues.resist === 12,
    "BulletResist lands in `resist`, not pooled with flat health",
    `Got: ${candidate.categoryValues.resist}`,
  );
  // Barrier absorb is a THIRD defensive kind — a fixed pool that doesn't scale
  // with max health, making it cheap EHP for low-health heroes. All three
  // barrier keys were unmapped before, scoring every barrier item at zero for
  // its barrier (Reactive Barrier's whole 325 absorb was invisible, leaving it
  // net-negative and effectively unbuyable).
  assert(
    candidate.categoryValues.shield === 30,
    "CombatBarrier maps to `shield` (was previously unmapped and scored nothing)",
    `Got: ${candidate.categoryValues.shield}`,
  );
  // Sentinel values must not be scored as debuffs.
  assert(
    candidate.categoryValues.mobility === 0 && candidate.categoryValues.utility === 0,
    "-1 sentinels (ChannelMoveSpeed / AbilityCooldownBetweenCharge) score nothing, not a penalty",
    `mobility=${candidate.categoryValues.mobility}, utility=${candidate.categoryValues.utility}`,
  );

  // `SpiritPower` is a second key for the same stat as `TechPower` — verified
  // live, the two never co-occur (17 items use one, 6 the other, none both).
  // Only TechPower was mapped, silently zeroing spirit power on those 6 items.
  const altSpirit = toItemCandidate({
    ...item,
    stats: { SpiritPower: 20 },
    statScaling: {},
  });
  assert(
    altSpirit.categoryValues.spiritDamage === 20,
    "`SpiritPower` scores as spirit damage, same as its `TechPower` alias",
    `Got: ${altSpirit.categoryValues.spiritDamage}`,
  );

  // Fire rate multiplies weapon DPS directly and sits on 17 live items; it was
  // unmapped, which is why Rapid Rounds (whose ONLY stat is BonusFireRate)
  // scored zero and could never be recommended.
  const fireRate = toItemCandidate({ ...item, stats: { BonusFireRate: 9 } });
  assert(
    fireRate.categoryValues.gunDamage === 9,
    "`BonusFireRate` scores as gun damage (was unmapped, zeroing Rapid Rounds)",
    `Got: ${fireRate.categoryValues.gunDamage}`,
  );

  const total = SCORE_CATEGORIES.reduce((sum, cat) => sum + candidate.categoryValues[cat], 0);
  assert(
    total === 77,
    "unmapped stat keys and sentinels contribute nothing anywhere",
    `Expected 77 (15 spirit + 20 health + 12 resist + 30 shield), got ${total}`,
  );
  assert(
    SCORE_CATEGORIES.every((cat) => Number.isFinite(candidate.categoryValues[cat])),
    "every ScoreCategory is present and finite",
  );
}

// ── effectEstimator ──────────────────────────────────────────────────────────
console.log("\n6b. effectEstimator: proc/active items are no longer invisible");
{
  // An item whose ENTIRE value is a proc must not score zero. Zero is not
  // "cheap" downstream — basketSelect's relevance gate drops zero-coverage
  // candidates outright, so such an item could never be recommended.
  // Modelled on Tesla Bullets: 15% chance to chain 33 damage to 4 targets.
  const proc = toItemCandidate({
    id: "proc_item",
    numericId: 5001,
    name: "Chain Proc",
    category: "gun",
    tier: 3,
    cost: 3200,
    tags: [],
    stats: { DamagePerChain: 33, ChainCount: 4, ProcChance: 15 },
    statScaling: {},
  });
  assert(
    proc.categoryValues.gunDamage > 0,
    "an item whose only value is a proc effect scores above zero",
    `Got: ${proc.categoryValues.gunDamage}`,
  );

  // Expected value, then halved by EFFECT_CONFIDENCE. Targets: the hit one plus
  // 0.4 of each further jump (most land on creeps in a trade, 2026-10-24):
  // 33 x (1 + 0.4 x 3) x 0.15 = 10.89 -> 5.445.
  assert(
    Math.abs(proc.categoryValues.gunDamage - 5.445) < 0.001,
    "proc value is expected-value math (dmg x targets x chance), then confidence-discounted",
    `Got: ${proc.categoryValues.gunDamage}`,
  );

  // An inferred value must not outrank an equal measured one — the engine
  // should prefer a known quantity over a guessed one at equal magnitude.
  const measured = toItemCandidate({
    id: "measured_item",
    numericId: 5002,
    name: "Measured",
    category: "gun",
    tier: 3,
    cost: 3200,
    tags: [],
    stats: { WeaponPower: 19.8 },
    statScaling: {},
  });
  assert(
    measured.categoryValues.gunDamage > proc.categoryValues.gunDamage,
    "a measured stat outranks an inferred effect of the same nominal size",
    `measured=${measured.categoryValues.gunDamage}, inferred=${proc.categoryValues.gunDamage}`,
  );

  // Enemy resist reduction is stored NEGATIVE (it lowers the target's stat) but
  // is OFFENSIVE value to the buyer. Mapping it as a plain stat would subtract,
  // exactly inverting its worth — hence the sign-corrected estimator. It lands
  // in `spiritShred`, NOT `spiritDamage`: past a certain enemy resist level,
  // more damage stops converting and only shred unlocks it, so the two are not
  // substitutes and need separate coverage targets.
  const shred = toItemCandidate({
    id: "shred_item",
    numericId: 5003,
    name: "Shred",
    category: "spirit",
    tier: 4,
    cost: 6400,
    tags: [],
    stats: { MagicResistReduction: -9, TechArmorDamageReduction: -6 },
    statScaling: {},
  });
  assert(
    shred.categoryValues.spiritShred > 0 && shred.categoryValues.spiritDamage === 0,
    "enemy resist reduction is OFFENSIVE value, scored as spiritShred not spiritDamage",
    `shred=${shred.categoryValues.spiritShred}, damage=${shred.categoryValues.spiritDamage}`,
  );

  // Bullet shred must not land in the spirit bucket — it does nothing for a
  // spirit-scaling hero's abilities, which is why the two are separate.
  const bulletShred = toItemCandidate({
    id: "bshred",
    numericId: 5007,
    name: "BShred",
    category: "gun",
    tier: 3,
    cost: 3200,
    tags: [],
    stats: { BulletArmorReduction: -10 },
    statScaling: {},
  });
  assert(
    bulletShred.categoryValues.gunShred > 0 && bulletShred.categoryValues.spiritShred === 0,
    "bullet shred and spirit shred are tracked separately by damage type",
    `gun=${bulletShred.categoryValues.gunShred}, spirit=${bulletShred.categoryValues.spiritShred}`,
  );

  // Anti-heal is its own requirement: against a healing enemy, raw damage can
  // fail to out-pace sustain at any amount. The two heal-penalty keys are
  // always paired at the same value, so the larger is taken, never the sum.
  const antiHeal = toItemCandidate({
    id: "antiheal",
    numericId: 5008,
    name: "AntiHeal",
    category: "gun",
    tier: 3,
    cost: 3200,
    tags: [],
    stats: { HealAmpReceivePenaltyPercent: -35, HealAmpRegenPenaltyPercent: -35 },
    statScaling: {},
  });
  assert(
    antiHeal.categoryValues.antiHeal > 0,
    "healing reduction scores in its own antiHeal category",
    `Got: ${antiHeal.categoryValues.antiHeal}`,
  );
  const antiHealSingle = toItemCandidate({
    id: "antiheal2",
    numericId: 5009,
    name: "AntiHeal2",
    category: "gun",
    tier: 3,
    cost: 3200,
    tags: [],
    stats: { HealAmpReceivePenaltyPercent: -35 },
    statScaling: {},
  });
  assert(
    antiHeal.categoryValues.antiHeal === antiHealSingle.categoryValues.antiHeal,
    "...and the always-paired heal-penalty keys are not double-counted",
    `paired=${antiHeal.categoryValues.antiHeal}, single=${antiHealSingle.categoryValues.antiHeal}`,
  );

  // Reducing an enemy's damage OUTPUT protects you; it is not shred and must
  // not be credited as offence.
  const outputCut = toItemCandidate({
    id: "outcut",
    numericId: 5010,
    name: "OutCut",
    category: "spirit",
    tier: 4,
    cost: 6400,
    tags: [],
    stats: { TechPowerReduction: -30 },
    statScaling: {},
  });
  assert(
    outputCut.categoryValues.utility > 0 && outputCut.categoryValues.spiritShred === 0,
    "cutting enemy damage OUTPUT is defensive utility, not shred",
    `utility=${outputCut.categoryValues.utility}, shred=${outputCut.categoryValues.spiritShred}`,
  );

  // AoE weapon effects clear jungle camps faster, which is souls.
  const aoe = toItemCandidate({
    id: "aoe",
    numericId: 5011,
    name: "Aoe",
    category: "gun",
    tier: 4,
    cost: 6400,
    tags: [],
    stats: { RicochetDamagePercent: 65 },
    statScaling: {},
  });
  assert(
    aoe.categoryValues.economy > 0,
    "an AoE weapon effect earns economy value for faster jungle clear",
    `Got: ${aoe.categoryValues.economy}`,
  );

  // A genuine self-debuff must still register as a real cost.
  const selfDebuff = toItemCandidate({
    id: "debuff_item",
    numericId: 5004,
    name: "Heavy",
    category: "gun",
    tier: 3,
    cost: 3200,
    tags: [],
    stats: { BonusMoveSpeed: -0.5 },
    statScaling: {},
  });
  assert(
    selfDebuff.categoryValues.mobility < 0,
    "a real self-debuff (negative move speed) still scores as a cost",
    `Got: ${selfDebuff.categoryValues.mobility}`,
  );

  // An ability cooldown RESET (Echo Shard) is worth more than a percentage CDR
  // roll on the same ability, since it removes the cooldown outright. The
  // credited value is a generic FLOOR: the true worth depends on which ability
  // is reset, which this layer cannot see.
  const reset = estimateEffectValues({ ImbuedCooldownMultiplier: 1 });
  assert(
    reset.length === 1 && reset[0].category === "utility" && reset[0].value > 0,
    "an ability cooldown reset scores as utility (Echo Shard was 10.0 total without it)",
    JSON.stringify(reset),
  );

  // Soul generation must outweigh a farming penalty on the same item.
  // Trophy Collector grants 18 souls/min per stack (16 stacks) AND carries
  // `NonPlayerBonusWeaponPower: -15`. The penalty was scored while the soul
  // income was unmapped, leaving a soul-generating item at economy -6.0.
  const earner = toItemCandidate({
    id: "earner",
    numericId: 5005,
    name: "Earner",
    category: "vitality",
    tier: 2,
    cost: 1600,
    tags: [],
    stats: { StackingGoldPerMinute: 18, MaxStacks: 16, NonPlayerBonusWeaponPower: -15 },
    statScaling: {},
  });
  assert(
    earner.categoryValues.economy > 0,
    "an item that generates souls scores positive economy despite a farming penalty",
    `Got: ${earner.categoryValues.economy}`,
  );

  // The penalty must still be subtracted — it is a real drawback, not noise.
  const earnerNoPenalty = toItemCandidate({
    id: "earner2",
    numericId: 5006,
    name: "Earner2",
    category: "vitality",
    tier: 2,
    cost: 1600,
    tags: [],
    stats: { StackingGoldPerMinute: 18, MaxStacks: 16 },
    statScaling: {},
  });
  assert(
    earnerNoPenalty.categoryValues.economy > earner.categoryValues.economy,
    "...and the farming penalty is still subtracted rather than ignored",
    `withPenalty=${earner.categoryValues.economy}, without=${earnerNoPenalty.categoryValues.economy}`,
  );

  // `MaxStacks: 9999` is an uncapped sentinel; crediting it literally would let
  // one counter dominate every other contribution in the catalogue.
  const uncapped = estimateEffectValues({ StackingGoldPerMinute: 18, MaxStacks: 9999 });
  const capped = estimateEffectValues({ StackingGoldPerMinute: 18, MaxStacks: 16 });
  assert(
    uncapped.length === 1 && capped.length === 1 && uncapped[0].value === capped[0].value,
    "an uncapped MaxStacks sentinel is clamped to a plausible ceiling",
    `uncapped=${uncapped[0]?.value}, capped=${capped[0]?.value}`,
  );

  // An item with no recognised effect cluster yields no estimates — silence
  // must not be mistaken for a computed zero.
  assert(
    estimateEffectValues({ BonusHealth: 200 }).length === 0,
    "a pure stat item produces no effect estimates at all",
  );
}

// ── heroNeed ─────────────────────────────────────────────────────────────────
console.log("\n7. heroNeed: hero kit -> need vector");

const EMPTY_TIER: AbilityUpgradeTier = { pointCost: 1, description: "", statChanges: [] };

function mkAbility(spiritScaling: number | null, weaponScaling: number | null): HeroAbility {
  return {
    classname: "ability_test",
    name: "Test Ability",
    slot: "signature1",
    isUltimate: false,
    damageType: spiritScaling != null ? "spirit" : weaponScaling != null ? "weapon" : "none",
    baseDamage: 100,
    spiritScaling,
    weaponScaling,
    cooldown: null,
    duration: null,
    castRange: null,
    passive: null,
    active: null,
    upgrades: [EMPTY_TIER, { ...EMPTY_TIER, pointCost: 2 }, { ...EMPTY_TIER, pointCost: 5 }],
  };
}

function mkHero(heroId: number, maxHealth: number, moveSpeed: number): HeroBaseStats {
  return {
    heroId,
    bulletDamage: 10,
    bulletDamagePerBoon: 1,
    bulletsPerSecond: 5,
    reloadTime: 2,
    ammo: 20,
    // 0 = "no reload data" -- nominalGunDps treats this as ratio 1 (no
    // discount), so every existing fixture below keeps its exact prior
    // behavior. Fixtures testing the reload discount override this directly.
    dpsWithReload: 0,
    // No weapon class and an all-zero falloff profile = "no weapon_info data",
    // which rangeEfficiency() treats as flat (multiplier 1, no discount), so
    // every pre-existing fixture below keeps its exact prior behavior.
    // Fixtures testing the range discount override these directly.
    weaponClass: "",
    falloffStartRange: 0,
    falloffEndRange: 0,
    falloffStartScale: 1,
    falloffEndScale: 1,
    maxRange: 0,
    lightMeleeDamage: 60,
    lightMeleePerBoon: 2,
    heavyMeleeDamage: 100,
    heavyMeleePerBoon: 3,
    maxHealth,
    maxHealthPerBoon: 30,
    healthRegen: 2,
    moveSpeed,
    spiritPower: 0,
    spiritPowerPerBoon: 0,
  };
}

{
  const roster = [
    mkHero(1, 500, 7),
    mkHero(2, 600, 7),
    mkHero(3, 700, 8),
    mkHero(4, 800, 8),
    mkHero(5, 900, 9),
  ];

  // A kit that scales entirely off spirit power.
  const spiritHero = deriveHeroNeedVector({
    abilities: [mkAbility(1.2, null), mkAbility(0.8, null), mkAbility(1.0, null)],
    baseStats: mkHero(3, 700, 8),
    roster,
  });
  assert(
    spiritHero.spiritDamage > spiritHero.gunDamage,
    "spirit-scaling kit needs spiritDamage over gunDamage",
    `spirit=${spiritHero.spiritDamage}, gun=${spiritHero.gunDamage}`,
  );
  // A pure-spirit kit must NOT drive gunDamage to exactly zero. Zero is not
  // "low priority" downstream — makeBasketContext turns it into a zero coverage
  // target, and basketSelect's relevance gate then rejects every gun item, so a
  // spirit hero could never be shown one. Every Deadlock hero carries a gun.
  assert(
    spiritHero.gunDamage > 0,
    "a purely spirit-scaling kit still leaves gun items reachable (non-zero need)",
    `Got: ${spiritHero.gunDamage}`,
  );
}

// Gun need is an INDEPENDENT signal from ability scaling: it comes from the
// hero's own weapon relative to the roster, not from what their abilities
// scale off. Verified against live API data — Lady Geist's abilities are 100%
// spirit-scaling AND her gun gains +1.00 damage/boon, ranking 7th of 38 for
// DPS gained from boons. Both facts must survive into the vector at once.
{
  // Identical, wholly spirit-scaling kits — only the GUN differs.
  const spiritKit = [mkAbility(1.2, null), mkAbility(0.8, null)];

  // Fire rate is what makes gun strength comparable between heroes: the
  // "big gun" hero deals less per shot than the roster's outlier but fires
  // far faster. Damage alone would rank these two backwards.
  const bigGun = { ...mkHero(1, 700, 8), bulletDamage: 20, bulletDamagePerBoon: 1.0 };
  bigGun.bulletsPerSecond = 6;
  const popGun = { ...mkHero(2, 700, 8), bulletDamage: 30, bulletDamagePerBoon: 0.05 };
  popGun.bulletsPerSecond = 1;

  const gunRoster = [bigGun, popGun, mkHero(3, 700, 8), mkHero(4, 700, 8)];

  const strongGunHero = deriveHeroNeedVector({
    abilities: spiritKit,
    baseStats: bigGun,
    roster: gunRoster,
  });
  const weakGunHero = deriveHeroNeedVector({
    abilities: spiritKit,
    baseStats: popGun,
    roster: gunRoster,
  });

  assert(
    strongGunHero.gunDamage > weakGunHero.gunDamage,
    "a hero with a better gun gets a higher gunDamage need than one with a worse gun",
    `strong=${strongGunHero.gunDamage}, weak=${weakGunHero.gunDamage}`,
  );
  assert(
    strongGunHero.spiritDamage === weakGunHero.spiritDamage,
    "...and gun quality does not disturb the ability-derived spirit need",
    `strong=${strongGunHero.spiritDamage}, weak=${weakGunHero.spiritDamage}`,
  );
  assert(
    strongGunHero.spiritDamage > 0 && strongGunHero.gunDamage > 0,
    "a spirit-scaling hero with a strong gun needs BOTH — the signals are independent",
    JSON.stringify({
      spirit: strongGunHero.spiritDamage,
      gun: strongGunHero.gunDamage,
    }),
  );

  // ── Accuracy discount ──
  // Nominal DPS assumes every shot lands, which over-rates spread weapons whose
  // fire rate counts each pellet. Verified live: Calico's nominal DPS is near
  // the top of the roster but only 43.5% of her shots connect (over 4.3B
  // shots), so gun items buy her far less than the raw number implies.
  {
    // Same gun on paper; only the hit rate differs.
    const sprayer = { ...mkHero(10, 700, 8), bulletDamage: 20, bulletDamagePerBoon: 1.0 };
    sprayer.bulletsPerSecond = 6;
    const marksman = { ...mkHero(11, 700, 8), bulletDamage: 20, bulletDamagePerBoon: 1.0 };
    marksman.bulletsPerSecond = 6;
    const accRoster = [sprayer, marksman, mkHero(12, 700, 8), mkHero(13, 700, 8)];

    const accuracy = new Map<number, number>([
      [10, 0.4], // sprays pellets, most miss
      [11, 0.62], // lands most shots
      [12, 0.5],
      [13, 0.5],
    ]);

    const sprayerNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: sprayer,
      roster: accRoster,
      gunAccuracyByHeroId: accuracy,
    });
    const marksmanNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: marksman,
      roster: accRoster,
      gunAccuracyByHeroId: accuracy,
    });

    assert(
      marksmanNeed.gunDamage > sprayerNeed.gunDamage,
      "identical guns diverge on accuracy — the one that lands shots is worth investing in",
      `marksman=${marksmanNeed.gunDamage}, sprayer=${sprayerNeed.gunDamage}`,
    );

    // A hero with no accuracy data and NO cannot-miss override has genuinely
    // UNKNOWN accuracy and must not be left undiscounted while every peer is
    // discounted — that would inflate them into looking like the best gun in
    // the roster. Verified live: 5 heroes are in this state (Deadman Danny,
    // Solomon, Violet, Nurse Harrow, Baba — all recent additions with no match
    // data), so this is the common case, not an edge case.
    const unknown = { ...mkHero(14, 700, 8), bulletDamage: 20, bulletDamagePerBoon: 1.0 };
    unknown.bulletsPerSecond = 6;
    const withUnknown = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: unknown,
      roster: [...accRoster, unknown],
      gunAccuracyByHeroId: accuracy, // deliberately has no entry for hero 14
    });
    assert(
      Number.isFinite(withUnknown.gunDamage) &&
        withUnknown.gunDamage <= marksmanNeed.gunDamage + 1e-9,
      "a hero with no accuracy data and no cannot-miss override falls back to median, never to an undiscounted advantage",
      `unknown=${withUnknown.gunDamage}, marksman=${marksmanNeed.gunDamage}`,
    );

    // The cannot-miss override is what separates "accuracy inapplicable" from
    // "accuracy unknown". Same gun, same absence from the map, different
    // meaning — and it must resolve to exactly an explicit 1.0 entry.
    const beam = { ...unknown, heroId: 15, weaponClass: "citadel_weapon_necro_set" };
    const beamRoster = [...accRoster, beam];
    const beamNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: beam,
      roster: beamRoster,
      gunAccuracyByHeroId: accuracy, // no entry for hero 15 either
    });
    const beamExplicit = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: beam,
      roster: beamRoster,
      gunAccuracyByHeroId: new Map([...accuracy, [15, 1]]),
    });
    assert(
      Math.abs(beamNeed.gunDamage - beamExplicit.gunDamage) < 1e-9,
      "a cannot-miss weapon absent from the accuracy map resolves to exactly an explicit 1.0 entry, not the median",
      `absent=${beamNeed.gunDamage}, explicit1.0=${beamExplicit.gunDamage}`,
    );

    // Rank enters as a different accuracy map for the same hero: higher-ranked
    // players land more, so gun items are worth more to them.
    const lowRank = new Map<number, number>([...accuracy, [11, 0.45]]);
    const highRank = new Map<number, number>([...accuracy, [11, 0.7]]);
    const atLow = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: marksman,
      roster: accRoster,
      gunAccuracyByHeroId: lowRank,
    });
    const atHigh = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: marksman,
      roster: accRoster,
      gunAccuracyByHeroId: highRank,
    });
    assert(
      atHigh.gunDamage > atLow.gunDamage,
      "the same hero needs gun items more at a rank where players land more shots",
      `high=${atHigh.gunDamage}, low=${atLow.gunDamage}`,
    );

    // Omitting the map entirely must stay valid — accuracy is enrichment, and
    // the analytics fetchers fail open.
    const noAccuracy = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: marksman,
      roster: accRoster,
    });
    assert(
      Number.isFinite(noAccuracy.gunDamage) && noAccuracy.gunDamage > 0,
      "with no accuracy data supplied at all, gun need still derives from nominal DPS",
      `Got: ${noAccuracy.gunDamage}`,
    );
  }

  // ── Reload-adjusted DPS ──
  // bulletDamage x bulletsPerSecond assumes the hero never stops shooting to
  // reload. Verified live: Graves' naive product overstates her sustained DPS
  // by 43% (35.3 vs Valve's own dpsWithReload of 20.2) because her clip
  // empties every ~4s against a 2.8s reload. dpsWithReload lets nominalGunDps
  // correct for that without re-deriving Valve's own reload formula.
  {
    // Same nominal gun on paper -- only reload efficiency differs.
    const fastReload = { ...mkHero(20, 700, 8), bulletDamage: 10, bulletsPerSecond: 5 };
    fastReload.dpsWithReload = 48; // barely discounted: 48/50 = 96% uptime
    const slowReload = { ...mkHero(21, 700, 8), bulletDamage: 10, bulletsPerSecond: 5 };
    slowReload.dpsWithReload = 25; // heavy downtime: 25/50 = 50% uptime

    const reloadRoster = [fastReload, slowReload, mkHero(22, 700, 8), mkHero(23, 700, 8)];

    const fastNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: fastReload,
      roster: reloadRoster,
    });
    const slowNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: slowReload,
      roster: reloadRoster,
    });
    assert(
      fastNeed.gunDamage > slowNeed.gunDamage,
      "identical nominal guns diverge on reload uptime -- less time reloading is worth investing in more",
      `fast=${fastNeed.gunDamage}, slow=${slowNeed.gunDamage}`,
    );

    // A malformed/impossible dpsWithReload above the nominal product must not
    // INFLATE gun need past what the nominal product itself would give --
    // mirrors the same Math.min(1, ...) clamp effectiveGunDps applies to
    // accuracy above 100%.
    const overstated = { ...mkHero(26, 700, 8), bulletDamage: 10, bulletsPerSecond: 5 };
    overstated.dpsWithReload = 999;
    const overstatedNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: overstated,
      roster: [overstated, mkHero(27, 700, 8)],
    });
    const nominalNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: mkHero(26, 700, 8),
      roster: [mkHero(26, 700, 8), mkHero(27, 700, 8)],
    });
    assert(
      overstatedNeed.gunDamage <= nominalNeed.gunDamage + 1e-9,
      "a dpsWithReload above the nominal product is clamped, never allowed to inflate gun need past nominal",
      `overstated=${overstatedNeed.gunDamage}, nominal=${nominalNeed.gunDamage}`,
    );

    // Every fixture above this point predates dpsWithReload (mkHero defaults
    // it to 0) and must be completely unaffected -- this is the fail-open
    // guarantee the rest of this file's gun-need assertions depend on.
    const noReloadData = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: mkHero(24, 700, 8),
      roster: [mkHero(24, 700, 8), mkHero(25, 700, 8)],
    });
    assert(
      Number.isFinite(noReloadData.gunDamage) && noReloadData.gunDamage > 0,
      "with no reload data supplied (dpsWithReload = 0), gun need still derives from the nominal product unmodified",
      `Got: ${noReloadData.gunDamage}`,
    );
  }

  // ── Range-falloff discount ──
  // A weapon that loses damage at range lands less of its nominal DPS. This is
  // ORTHOGONAL to accuracy: accuracy says which shots hit, falloff says how
  // much a hit deals, so both apply without double-counting.
  {
    // Short-range vs long-range, identical guns otherwise. Falloff ranges are
    // in METRES (converted at fetch time), against ENGAGEMENT_RANGE_WEIGHTS'
    // 5-30m band.
    const shortRange = {
      ...mkHero(30, 700, 8),
      falloffStartRange: 8,
      falloffEndRange: 18,
      falloffEndScale: 0.1,
      maxRange: 178,
    };
    const longRange = {
      ...mkHero(31, 700, 8),
      falloffStartRange: 22,
      falloffEndRange: 58,
      falloffEndScale: 0.1,
      maxRange: 178,
    };
    const rangeRoster = [shortRange, longRange, mkHero(32, 700, 8), mkHero(33, 700, 8)];

    const shortNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: shortRange,
      roster: rangeRoster,
    });
    const longNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: longRange,
      roster: rangeRoster,
    });
    assert(
      longNeed.gunDamage > shortNeed.gunDamage,
      "identical guns diverge on range profile -- the one that holds damage at range is worth investing in more",
      `long=${longNeed.gunDamage}, short=${shortNeed.gunDamage}`,
    );

    // HARD_CUTOFF_WEAPON_CLASSES: Graves' The Teacher deals FULL damage inside
    // 17m and ZERO past it. Read generically, end_scale 0.5 would instead say
    // "50% damage past 17m" -- understating her in-range damage and
    // overstating her out-of-range damage simultaneously. The exception must
    // actually bite, so these two must not score the same.
    const teacher = {
      ...mkHero(34, 700, 8),
      weaponClass: "citadel_weapon_necro_set",
      falloffStartRange: 7.62,
      falloffEndRange: 17.02,
      falloffEndScale: 0.5,
      maxRange: 178,
    };
    // Both variants share ONE roster: compared against a roster of neutral
    // (no-falloff) heroes only, each is such an outlier that the z-score
    // saturates Z_SCORE_CLAMP and both floor to MIN_GUN_FACTOR, hiding the very
    // difference under test. Same baseline for both is also the correct
    // comparison -- gun need is relative to the roster.
    const asIfGeneric = { ...teacher, heroId: 44, weaponClass: "some_other_weapon" };
    const cutoffRoster = [teacher, asIfGeneric, mkHero(35, 700, 8), mkHero(36, 700, 8)];
    const teacherNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: teacher,
      roster: cutoffRoster,
    });
    const genericNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: asIfGeneric,
      roster: cutoffRoster,
    });
    assert(
      Math.abs(teacherNeed.gunDamage - genericNeed.gunDamage) > 1e-9,
      "a hard-cutoff weapon is NOT scored as a generic falloff curve -- the hand-authored exception changes the result",
      `teacher=${teacherNeed.gunDamage}, asGeneric=${genericNeed.gunDamage}`,
    );

    // The multiplier for a hard-cutoff weapon is exactly the share of
    // ENGAGEMENT_RANGE_WEIGHTS inside the cutoff. At 17m that is the 5/10/15m
    // buckets = 0.08 + 0.20 + 0.27 = 0.55. Locking the calibration: if the
    // weights are retuned, this is the assertion that should force a decision.
    const inRangeShare = 0.08 + 0.2 + 0.27;
    const wideCutoff = { ...teacher, heroId: 37, falloffEndRange: 999 };
    const wideRoster = [wideCutoff, mkHero(35, 700, 8), mkHero(36, 700, 8)];
    const wideNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: wideCutoff,
      roster: wideRoster,
    });
    assert(
      inRangeShare === 0.55 && wideNeed.gunDamage > teacherNeed.gunDamage,
      "the 17m cutoff keeps only the 0.55 weight inside range, so a wider cutoff on the same gun scores strictly higher",
      `inRangeShare=${inRangeShare}, wide=${wideNeed.gunDamage}, cutoff17m=${teacherNeed.gunDamage}`,
    );

    // Past maxRange a generic weapon deals nothing, but MIN_RANGE_EFFICIENCY
    // must keep the multiplier off exactly 0 -- a 0 would drop the hero out of
    // the roster baseline entirely instead of merely ranking them last. Same
    // hazard class as MIN_GUN_FACTOR.
    const unusable = { ...mkHero(38, 700, 8), maxRange: 1, falloffEndRange: 0 };
    const unusableNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: unusable,
      roster: [unusable, mkHero(39, 700, 8), mkHero(40, 700, 8)],
    });
    assert(
      unusableNeed.gunDamage > 0,
      "a weapon unusable at every sampled range still floors strictly above zero, never dropping out of the comparison",
      `Got: ${unusableNeed.gunDamage}`,
    );

    // Fail-open: every fixture predating this change leaves the falloff fields
    // at mkHero's zeros, which must read as "unknown" -> flat, no discount.
    const noRangeData = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: mkHero(41, 700, 8),
      roster: [mkHero(41, 700, 8), mkHero(42, 700, 8)],
    });
    assert(
      Number.isFinite(noRangeData.gunDamage) && noRangeData.gunDamage > 0,
      "with no falloff data supplied, gun need derives unmodified (no silent zero-damage weapon)",
      `Got: ${noRangeData.gunDamage}`,
    );
  }

  // ── Cannot-miss accuracy fallback ──
  // A hero absent from the accuracy map has no shot data at all, which means a
  // weapon whose shots are not counted discretely -- one that cannot miss.
  // Verified live: Graves alone, hit = 0 AND miss = 0 over 536,097 matches.
  // Previously this fell back to the roster median (0.515), charging her a
  // fabricated ~48% miss rate that was really standing in for the range
  // weakness rangeEfficiency() now carries from real weapon data.
  {
    // The cannot-miss hero carries the override; the comparison hero is an
    // identical gun measured at a poor 40%.
    const beamHero = { ...mkHero(50, 700, 8), weaponClass: "citadel_weapon_necro_set" };
    const measured = mkHero(51, 700, 8);
    const accRoster = [beamHero, measured];
    const accuracy = new Map<number, number>([[51, 0.4]]);

    const beamNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: beamHero,
      roster: accRoster,
      gunAccuracyByHeroId: accuracy,
    });
    const measuredNeed = deriveHeroNeedVector({
      abilities: spiritKit,
      baseStats: measured,
      roster: accRoster,
      gunAccuracyByHeroId: accuracy,
    });
    assert(
      beamNeed.gunDamage > measuredNeed.gunDamage,
      "a cannot-miss weapon outranks an identical gun measured at 40% accuracy",
      `beam=${beamNeed.gunDamage}, measured=${measuredNeed.gunDamage}`,
    );
  }

  // The mirror case — same shape, weapon scaling instead.
  const gunHero = deriveHeroNeedVector({
    abilities: [mkAbility(null, 1.2), mkAbility(null, 0.8)],
    baseStats: mkHero(3, 700, 8),
    roster: gunRoster,
  });
  assert(
    gunHero.gunDamage > gunHero.spiritDamage,
    "weapon-scaling kit needs gunDamage over spiritDamage",
    `gun=${gunHero.gunDamage}, spirit=${gunHero.spiritDamage}`,
  );

  // Compensating direction: the squishiest hero in the roster should carry a
  // HIGHER tankiness need than the beefiest. This encodes a deliberate design
  // judgement (see heroNeed.ts) — if that call is ever reversed, this fails.
  const healthRoster = [
    mkHero(1, 500, 7),
    mkHero(2, 600, 7),
    mkHero(3, 700, 8),
    mkHero(4, 800, 8),
    mkHero(5, 900, 9),
  ];
  const squishy = deriveHeroNeedVector({
    abilities: [mkAbility(1, null)],
    baseStats: mkHero(1, 500, 7),
    roster: healthRoster,
  });
  const beefy = deriveHeroNeedVector({
    abilities: [mkAbility(1, null)],
    baseStats: mkHero(5, 900, 9),
    roster: healthRoster,
  });
  assert(
    squishy.bonusHealth + squishy.resist > beefy.bonusHealth + beefy.resist,
    "low-health hero gets a higher total defensive need than a high-health hero",
    `squishy=${squishy.bonusHealth + squishy.resist}, beefy=${beefy.bonusHealth + beefy.resist}`,
  );

  // HOW MUCH defence (above) and WHICH KIND (here) are separate axes.
  // Effective HP is health/(1-resist), so % resist multiplies the pool a hero
  // already owns: the same +20% resist buys the roster's beefiest hero roughly
  // twice the absolute EHP it buys the squishiest (verified live: +801 vs
  // +401). So resistance items really are weaker on low-health heroes, and a
  // squishy hero should want raw health first — both for the direct value and
  // to raise the pool that later resist multiplies.
  // The invariant is FLAT EHP (health + barriers, neither of which scales with
  // the health pool) versus % resist (which multiplies it). Both flat sources
  // are compared together — splitting the flat budget between health and
  // shield must not change which KIND of defence a hero is steered toward.
  const squishyFlat = squishy.bonusHealth + squishy.shield;
  const beefyFlat = beefy.bonusHealth + beefy.shield;
  assert(
    squishyFlat > squishy.resist,
    "a squishy hero wants flat EHP (health + barriers) over % resist",
    `flat=${squishyFlat}, resist=${squishy.resist}`,
  );
  assert(
    beefy.resist > beefyFlat,
    "a high-health hero wants % resist over flat EHP (their pool makes it efficient)",
    `flat=${beefyFlat}, resist=${beefy.resist}`,
  );
  assert(
    squishy.resist > 0 && beefy.bonusHealth > 0,
    "neither defensive type is ever driven to zero — less efficient is not useless",
    `squishyResist=${squishy.resist}, beefyHealth=${beefy.bonusHealth}`,
  );

  // Even the roster's tankiest hero must keep a reachable defensive need.
  // Zero is unreachable downstream (relevance gate), so a naturally durable
  // hero would otherwise never be offered a single health or resist item —
  // verified live against Mo & Krill, the highest-health hero, who derived
  // exactly 0.00/0.00 before this floor existed.
  const tankiestRoster = [
    mkHero(1, 500, 7),
    mkHero(2, 520, 7),
    mkHero(3, 540, 7),
    mkHero(9, 3000, 7),
  ];
  const tankiest = deriveHeroNeedVector({
    abilities: [mkAbility(1, null)],
    baseStats: mkHero(9, 3000, 7),
    roster: tankiestRoster,
  });
  assert(
    tankiest.bonusHealth > 0 && tankiest.resist > 0 && tankiest.shield > 0,
    "an extreme-outlier tanky hero still has a non-zero defensive need (stays reachable)",
    `health=${tankiest.bonusHealth}, resist=${tankiest.resist}, shield=${tankiest.shield}`,
  );

  // Barriers are flat effective HP that does not scale with the health pool,
  // so — like flat health, and unlike % resist — they are worth proportionally
  // more to a low-health hero. A squishy hero should therefore want barrier
  // items more than a beefy one does.
  assert(
    squishy.shield > beefy.shield,
    "a squishy hero wants barrier/shield items more than a high-health hero",
    `squishy=${squishy.shield}, beefy=${beefy.shield}`,
  );
  assert(
    squishy.shield > squishy.resist * 0.5,
    "for a squishy hero, cheap flat barrier EHP is a serious competitor to % resist",
    `shield=${squishy.shield}, resist=${squishy.resist}`,
  );

  // Degenerate inputs must degrade gracefully, never NaN.
  const noSignal = deriveHeroNeedVector({
    abilities: [],
    baseStats: mkHero(1, 500, 7),
    roster: [],
  });
  assert(
    SCORE_CATEGORIES.every((cat) => Number.isFinite(noSignal[cat])),
    "empty abilities + empty roster still yields a finite vector (no NaN)",
    JSON.stringify(noSignal),
  );
  assert(
    noSignal.gunDamage === noSignal.spiritDamage,
    "with no scaling signal at all, damage need is split evenly",
  );
}

// ── basketSelect ─────────────────────────────────────────────────────────────
console.log("\n8. basketSelect: joint greedy basket construction");

function mkCandidate(
  itemId: string,
  numericId: number,
  category: ItemCandidate["category"],
  cost: number,
  values: Partial<Record<ScoreCategory, number>>,
): ItemCandidate {
  return {
    itemId,
    numericId,
    name: itemId,
    category,
    cost,
    categoryValues: { ...zeroValues(), ...values },
    // 0 = no per-hit mechanic, so procPlatformTerm stays inert here and every
    // pre-existing assertion in this file is unaffected.
    procReliance: 0,
    hitDependence: 0,
    tags: [],
  };
}

// Two pure-gun and two pure-spirit candidates, all equal in category value.
const basketCandidates: ItemCandidate[] = [
  mkCandidate("gun_a", 1, "gun", 1000, { gunDamage: 100 }),
  mkCandidate("gun_b", 2, "gun", 1100, { gunDamage: 100 }),
  mkCandidate("spirit_a", 3, "spirit", 1200, { spiritDamage: 100 }),
  mkCandidate("spirit_b", 4, "spirit", 1300, { spiritDamage: 100 }),
];

// Need only gun + spirit damage, equally. maxItems 2 with the default 50/slot
// target means each of the two categories targets 50 — LESS than one item
// provides (100), so a second item in the same category earns zero coverage.
// That is precisely the diminishing-returns behaviour under test.
const splitNeed = { ...zeroValues(), gunDamage: 1, spiritDamage: 1 };

{
  const ctx = makeBasketContext({ needVector: splitNeed, soulBudget: 10000, maxItems: 2 });
  const result = constructBasket(basketCandidates, ctx);

  assert(
    result.picks.length === 2,
    "basket fills both available slots",
    `Got ${result.picks.length}`,
  );
  assert(
    result.picks[0]?.item.itemId === "gun_a" && result.picks[1]?.item.itemId === "spirit_a",
    "diminishing returns force the basket to SPREAD across categories, not stack one",
    `Got: ${result.picks.map((p) => p.item.itemId).join(", ")}`,
  );
  assert(
    result.stopReason === "slots",
    "stopReason reports the slot cap",
    `Got: ${result.stopReason}`,
  );
  assert(result.totalCost === 2200, "totalCost sums the picked items", `Got: ${result.totalCost}`);
  assert(
    result.picks.every((p) => p.terms.length > 0 && p.terms.every((t) => t.reason.length > 0)),
    "every pick carries at least one explainable term with a reason",
  );

  // Order-independence: shuffling the input must not change the output. This is
  // the real determinism guarantee — a sort that reads array position would
  // pass a repeat-run check but fail this one.
  const reversed = constructBasket([...basketCandidates].reverse(), ctx);
  assert(
    JSON.stringify(reversed.picks.map((p) => p.item.itemId)) ===
      JSON.stringify(result.picks.map((p) => p.item.itemId)),
    "basket is independent of candidate input order (deterministic tie-break)",
    `reversed: ${reversed.picks.map((p) => p.item.itemId).join(", ")}`,
  );
}

{
  // Budget, not slots, is the binding constraint here.
  const ctx = makeBasketContext({ needVector: splitNeed, soulBudget: 1500, maxItems: 12 });
  const result = constructBasket(basketCandidates, ctx);

  assert(
    result.totalCost <= 1500,
    "basket never exceeds the soul budget",
    `Got: ${result.totalCost}`,
  );
  assert(
    result.stopReason === "budget",
    "stopReason reports budget exhaustion",
    `Got: ${result.stopReason}`,
  );
}

{
  const ctx = makeBasketContext({ needVector: splitNeed, soulBudget: 10000, maxItems: 12 });
  const result = constructBasket([], ctx);

  assert(result.picks.length === 0, "empty candidate pool yields an empty basket");
  assert(
    result.stopReason === "no-candidates",
    "stopReason distinguishes an empty pool",
    `Got: ${result.stopReason}`,
  );
}

{
  // Relevance gate: the investment bonus is a reason to prefer one USEFUL item
  // over another, never a reason to buy an irrelevant one. An item that covers
  // nothing the hero needs must not be bought just because its price tips a
  // category over a bonus tier — even though that crossing is worth real stats
  // in game. Without this gate the basket buys filler and "no-positive-value"
  // becomes unreachable.
  const gunOnlyNeed = { ...zeroValues(), gunDamage: 1 };
  const irrelevant = mkCandidate("vitality_filler", 99, "vitality", 900, { bonusHealth: 100 });
  const ctx = makeBasketContext({ needVector: gunOnlyNeed, soulBudget: 10000, maxItems: 12 });
  const result = constructBasket([basketCandidates[0], irrelevant], ctx);

  assert(
    result.picks.length === 1 && result.picks[0]?.item.itemId === "gun_a",
    "an item covering nothing the hero needs is not bought for its tier-crossing alone",
    `Got: ${result.picks.map((p) => p.item.itemId).join(", ")}`,
  );
  assert(
    result.stopReason === "no-positive-value",
    "stopReason reports that nothing left was worth adding",
    `Got: ${result.stopReason}`,
  );
}

{
  // unmetNeed must reflect what the basket could not cover.
  const ctx = makeBasketContext({ needVector: splitNeed, soulBudget: 0, maxItems: 12 });
  const result = constructBasket(basketCandidates, ctx);

  assert(
    result.unmetNeed.gunDamage > 0 && result.unmetNeed.spiritDamage > 0,
    "an empty basket reports the full need as unmet",
    JSON.stringify(result.unmetNeed),
  );
}

// ── analytics term: real data, but only when the sample supports it ──────────
console.log("\n9. basketSelect: empirical analytics term gating");
{
  const analytics = new Map<number, ItemAnalytics>([
    // Thin sample — must be ignored no matter how flattering the win rate.
    [1, { itemId: 1, matches: 50, wins: 45, losses: 5, winRate: 0.9 }],
    // Sample large enough to trust.
    [2, { itemId: 2, matches: 5000, wins: 3000, losses: 2000, winRate: 0.6 }],
    // Exactly even — carries no signal by construction.
    [3, { itemId: 3, matches: 5000, wins: 2500, losses: 2500, winRate: 0.5 }],
  ]);

  const ctx = makeBasketContext({
    needVector: splitNeed,
    soulBudget: 10000,
    maxItems: 12,
    itemAnalytics: analytics,
  });

  const state: BasketState = {
    picked: [],
    coverage: zeroValues(),
    soulsPerCategory: { gun: 0, spirit: 0, vitality: 0 },
    spent: 0,
  };

  const thin = analyticsTerm.evaluate(basketCandidates[0], state, ctx);
  const thick = analyticsTerm.evaluate(basketCandidates[1], state, ctx);
  const even = analyticsTerm.evaluate(basketCandidates[2], state, ctx);
  const missing = analyticsTerm.evaluate(basketCandidates[3], state, ctx);

  assert(thin === null, "win rate from too few matches is ignored (sampling noise)");
  assert(thick !== null && thick.value > 0, "a well-sampled above-even win rate contributes");
  assert(even === null, "an exactly-even win rate contributes nothing");
  assert(missing === null, "an item absent from the analytics map contributes nothing");

  // The empirical nudge must stay smaller than the deterministic stat signal —
  // it is observational, not causal, and must never dominate ranking.
  const coverageScale = 50; // default coverageTargetPerSlot
  assert(
    thick !== null && Math.abs(thick.value) < coverageScale * 0.1,
    "the analytics nudge stays small relative to one slot of coverage",
    `Got: ${thick?.value}`,
  );

  const noAnalyticsCtx = makeBasketContext({
    needVector: splitNeed,
    soulBudget: 10000,
    maxItems: 12,
  });
  assert(
    analyticsTerm.evaluate(basketCandidates[1], state, noAnalyticsCtx) === null,
    "with no analytics map supplied the term is inert (engine stays pure/offline)",
  );
}

console.log("\n10. basketSelect: per-hit proc platform term");
{
  // Same gun, same cost, same coverage -- one is a flat-stat item, the other
  // delivers most of its value per weapon hit.
  const flatItem = mkCandidate("flat_gun", 201, "gun", 1000, { gunDamage: 100 });
  const procItem = {
    ...mkCandidate("proc_gun", 202, "gun", 1000, { gunDamage: 100 }),
    procReliance: 0.8,
    hitDependence: 0,
  };

  const state: BasketState = {
    picked: [],
    coverage: zeroValues(),
    soulsPerCategory: { gun: 0, spirit: 0, vitality: 0 },
    spent: 0,
  };
  const ctxFor = (procPlatformFactor?: number) =>
    makeBasketContext({
      needVector: splitNeed,
      soulBudget: 10000,
      maxItems: 12,
      procPlatformFactor,
    });

  // A hero who lands hits better than roster average.
  const goodCtx = ctxFor(1.3);
  const procGood = procPlatformTerm.evaluate(procItem, state, goodCtx);
  const flatGood = procPlatformTerm.evaluate(flatItem, state, goodCtx);
  assert(
    procGood !== null && procGood.value > 0,
    "a per-hit item gains value for a hero who lands hits better than roster average",
    `Got: ${JSON.stringify(procGood)}`,
  );
  assert(
    flatGood === null,
    "a flat-stat item (procReliance 0) is untouched by the proc term",
    `Got: ${JSON.stringify(flatGood)}`,
  );

  // ...and loses it for a hero who lands them worse. This is a DIFFERENTIAL
  // signal, not a blanket bonus for every per-hit item.
  const procBad = procPlatformTerm.evaluate(procItem, state, ctxFor(0.7));
  assert(
    procBad !== null && procBad.value < 0,
    "the same per-hit item loses value for a hero who lands hits worse than average",
    `Got: ${JSON.stringify(procBad)}`,
  );

  // Exactly roster-average contributes nothing, so the term cannot act as a
  // silent across-the-board bonus for every proc item.
  assert(
    procPlatformTerm.evaluate(procItem, state, ctxFor(1)) === null,
    "a roster-average platform (factor 1.0) contributes nothing",
  );

  // Omitted factor => inert. An absent factor must never bias a basket.
  assert(
    procPlatformTerm.evaluate(procItem, state, ctxFor(undefined)) === null,
    "with no procPlatformFactor supplied the term is inert",
  );

  // Relevance gate, same as analyticsTerm: a per-hit item covering no un-met
  // need must not become worth buying just because the hero lands hits well.
  const irrelevantProc = {
    ...mkCandidate("proc_filler", 203, "vitality", 900, { bonusHealth: 100 }),
    procReliance: 1,
    hitDependence: 0,
  };
  const gunOnlyCtx = makeBasketContext({
    needVector: { ...splitNeed, bonusHealth: 0, resist: 0, shield: 0 },
    soulBudget: 10000,
    maxItems: 12,
    procPlatformFactor: 1.3,
  });
  assert(
    procPlatformTerm.evaluate(irrelevantProc, state, gunOnlyCtx) === null,
    "a per-hit item covering no un-met need is still rejected -- the relevance gate wins",
  );

  // Bounded: one slot of coverage must dominate the nudge, or a proc item could
  // outrank a strictly better-covering one.
  const coverage = coverageTerm.evaluate(procItem, state, goodCtx);
  assert(
    coverage !== null && procGood !== null && Math.abs(procGood.value) < coverage.value,
    "the proc nudge stays small relative to one slot of coverage",
    `proc=${procGood?.value}, coverage=${coverage?.value}`,
  );

  // Scaling is proportional to how much of the item is per-hit.
  const half = procPlatformTerm.evaluate({ ...procItem, procReliance: 0.4 }, state, goodCtx);
  assert(
    half !== null && procGood !== null && half.value < procGood.value,
    "a less per-hit-reliant item gains proportionally less",
    `half=${half?.value}, full=${procGood?.value}`,
  );
}

console.log("\n11. itemAdapter: published scaling coefficients");
{
  // Modelled on the real Mystic Shot: ProcBonusMagicDamage 40 scaling at 0.9
  // per point of spirit power, plus a flat SpiritPower 7. Verified live.
  const mysticShot: Item = {
    id: "mystic_shot",
    numericId: 7001,
    name: "Mystic Shot",
    category: "gun",
    tier: 1,
    cost: 1600,
    tags: [],
    stats: { ProcBonusMagicDamage: 40, ProcChance: 100, SpiritPower: 7 },
    statScaling: { ProcBonusMagicDamage: { scaleType: "ETechPower", statScale: 0.9 } },
  };

  // No context => unscaled base, byte-identical to the pre-scaling behaviour.
  const flat = resolveScaledStats(mysticShot);
  assert(
    flat.ProcBonusMagicDamage === 40,
    "with no valuation context the base value is returned unscaled",
    `Got: ${flat.ProcBonusMagicDamage}`,
  );

  // 40 + 0.9 x 100 = 130. Additive, matching ability scaling exactly.
  const at100 = resolveScaledStats(mysticShot, { spiritPower: 100 });
  assert(
    Math.abs(at100.ProcBonusMagicDamage - 130) < 1e-9,
    "ETechPower scaling is additive: base + statScale x spiritPower",
    `Got: ${at100.ProcBonusMagicDamage}`,
  );

  // Unscaled stats on the same item must pass through untouched.
  assert(
    at100.SpiritPower === 7 && at100.ProcChance === 100,
    "stats without a published coefficient are left exactly as-is",
    `Got: SpiritPower=${at100.SpiritPower}, ProcChance=${at100.ProcChance}`,
  );

  // A scale type with no context field (EBuildUpRate has no supplier anywhere
  // in the catalogue) must resolve to base rather than being guessed at.
  const unmapped: Item = {
    ...mysticShot,
    id: "unmapped_scale",
    statScaling: { ProcBonusMagicDamage: { scaleType: "EBuildUpRate", statScale: 5 } },
  };
  assert(
    resolveScaledStats(unmapped, { spiritPower: 100 }).ProcBonusMagicDamage === 40,
    "an unmapped scale type resolves to base -- unmapped scaling is ignored, never guessed",
  );

  // Sign preservation: Alchemical Fire's BulletArmorReduction is -7 scaling at
  // -0.055, so scaling makes the shred STRONGER (more negative). Clamping to
  // positive here would silently invert every enemy-debuff item.
  const shred: Item = {
    ...mysticShot,
    id: "alchemical_fire",
    stats: { BulletArmorReduction: -7 },
    statScaling: { BulletArmorReduction: { scaleType: "ETechPower", statScale: -0.055 } },
  };
  const shredAt100 = resolveScaledStats(shred, { spiritPower: 100 });
  assert(
    Math.abs(shredAt100.BulletArmorReduction - -12.5) < 1e-9,
    "a negative enemy-debuff value scales further negative, never flipped positive",
    `Got: ${shredAt100.BulletArmorReduction}`,
  );

  // End to end: scaling must actually raise the candidate's scored value, or
  // none of the above reaches the basket.
  const scaledCandidate = toItemCandidate(mysticShot, { spiritPower: 100 });
  const flatCandidate = toItemCandidate(mysticShot);
  assert(
    scaledCandidate.categoryValues.spiritDamage > flatCandidate.categoryValues.spiritDamage,
    "a spirit-scaled item scores strictly higher for a high-spirit hero than when priced flat",
    `scaled=${scaledCandidate.categoryValues.spiritDamage}, flat=${flatCandidate.categoryValues.spiritDamage}`,
  );

  // Zero spirit power must behave exactly like no context -- not like a
  // partially-applied scale.
  const atZero = toItemCandidate(mysticShot, { spiritPower: 0 });
  assert(
    atZero.categoryValues.spiritDamage === flatCandidate.categoryValues.spiritDamage,
    "zero spirit power resolves identically to no context at all",
    `zero=${atZero.categoryValues.spiritDamage}, flat=${flatCandidate.categoryValues.spiritDamage}`,
  );
}

console.log("\n12. effectEstimator: cooldown-gated vs per-bullet procs");
{
  // Mystic Shot: ProcChance 100 WITH an 8s AbilityCooldown = one buffed bullet,
  // then the effect is on cooldown. Throughput is one per COOLDOWN, so firing
  // faster does NOT trigger it more often -- it must not be flagged perHit, or
  // a high-fire-rate hero is credited for a rate they cannot influence.
  const gated = estimateEffectValues({
    ProcBonusMagicDamage: 40,
    ProcChance: 100,
    AbilityCooldown: 8,
  });
  assert(
    gated.length > 0 && gated.every((e) => e.perHit !== true),
    "a ProcChance-100 effect behind a cooldown is NOT flagged per-hit",
    `Got: ${JSON.stringify(gated)}`,
  );
  assert(
    gated.some((e) => e.basis.includes("once per 8s cooldown")),
    "the cooldown is named in the basis, so the estimate stays explainable",
    `Got: ${gated.map((e) => e.basis).join(" | ")}`,
  );

  // Tesla Bullets: 15% per bullet, no AbilityCooldown = a genuine per-bullet
  // roll, where firing faster really does mean more procs.
  const perBullet = estimateEffectValues({
    DamagePerChain: 33,
    ChainCount: 4,
    ProcChance: 15,
    AbilityCooldown: 0,
  });
  assert(
    perBullet.length > 0 && perBullet.some((e) => e.perHit === true),
    "a sub-100% proc with no cooldown IS flagged per-hit",
    `Got: ${JSON.stringify(perBullet)}`,
  );

  // End to end: the distinction must reach procReliance, which is what the
  // basket's proc-platform term multiplies.
  const mkProcItem = (stats: Record<string, number>): Item => ({
    id: "proc_shape",
    numericId: 7777,
    name: "Proc Shape",
    category: "gun",
    tier: 2,
    cost: 1600,
    tags: [],
    stats,
    statScaling: {},
  });
  const gatedItem = toItemCandidate(
    mkProcItem({ ProcBonusMagicDamage: 40, ProcChance: 100, AbilityCooldown: 8 }),
  );
  const perBulletItem = toItemCandidate(
    mkProcItem({ DamagePerChain: 33, ChainCount: 4, ProcChance: 15, AbilityCooldown: 0 }),
  );
  assert(
    gatedItem.procReliance === 0,
    "a cooldown-gated item has procReliance 0, so the proc-platform term leaves it alone",
    `Got: ${gatedItem.procReliance}`,
  );
  assert(
    perBulletItem.procReliance > 0,
    "a true per-bullet item keeps a non-zero procReliance",
    `Got: ${perBulletItem.procReliance}`,
  );

  // The gated effect still carries VALUE -- this change removes a wrong
  // hero-specific multiplier, it does not make the item worthless.
  assert(
    gatedItem.categoryValues.spiritDamage > 0,
    "a cooldown-gated proc is still scored above zero",
    `Got: ${gatedItem.categoryValues.spiritDamage}`,
  );
}

console.log("\n13. basketSelect: hit-reliability term (cooldown-gated procs)");
{
  const state: BasketState = {
    picked: [],
    coverage: zeroValues(),
    soulsPerCategory: { gun: 0, spirit: 0, vitality: 0 },
    spent: 0,
  };
  const base = mkCandidate("gated_gun", 301, "gun", 1000, { gunDamage: 100 });
  const gatedItem = { ...base, hitDependence: 0.8 };
  const perBulletItem = { ...base, itemId: "perhit_gun", procReliance: 0.8 };

  const ctxFor = (opts: { hit?: number; proc?: number }) =>
    makeBasketContext({
      needVector: splitNeed,
      soulBudget: 10000,
      maxItems: 12,
      hitReliabilityFactor: opts.hit,
      procPlatformFactor: opts.proc,
    });

  // A hero who connects better than average is worth more a cooldown-gated
  // shot, because a miss spends the charge regardless.
  const good = hitReliabilityTerm.evaluate(gatedItem, state, ctxFor({ hit: 1.3 }));
  assert(
    good !== null && good.value > 0,
    "a cooldown-gated bullet effect gains value for a hero who connects better than average",
    `Got: ${JSON.stringify(good)}`,
  );
  const bad = hitReliabilityTerm.evaluate(gatedItem, state, ctxFor({ hit: 0.7 }));
  assert(
    bad !== null && bad.value < 0,
    "...and loses value for one who connects worse",
    `Got: ${JSON.stringify(bad)}`,
  );

  // THE POINT OF THE SPLIT: fire rate must not touch a cooldown-gated effect,
  // and accuracy must not touch a per-bullet one through this term.
  assert(
    procPlatformTerm.evaluate(gatedItem, state, ctxFor({ proc: 1.3 })) === null,
    "the fire-rate term ignores a cooldown-gated effect -- shooting faster cannot shorten a cooldown",
  );
  assert(
    hitReliabilityTerm.evaluate(perBulletItem, state, ctxFor({ hit: 1.3 })) === null,
    "the hit-reliability term ignores a per-bullet proc, which the fire-rate term already covers",
  );

  // Standard guards, matching the sibling terms.
  assert(
    hitReliabilityTerm.evaluate(gatedItem, state, ctxFor({ hit: 1 })) === null,
    "a roster-average connector (factor 1.0) contributes nothing",
  );
  assert(
    hitReliabilityTerm.evaluate(gatedItem, state, ctxFor({})) === null,
    "with no hitReliabilityFactor supplied the term is inert",
  );
  const irrelevant = {
    ...mkCandidate("gated_filler", 302, "vitality", 900, { bonusHealth: 100 }),
    hitDependence: 1,
  };
  const gunOnly = makeBasketContext({
    needVector: { ...splitNeed, bonusHealth: 0, resist: 0, shield: 0 },
    soulBudget: 10000,
    maxItems: 12,
    hitReliabilityFactor: 1.3,
  });
  assert(
    hitReliabilityTerm.evaluate(irrelevant, state, gunOnly) === null,
    "a cooldown-gated item covering no un-met need is still rejected by the relevance gate",
  );
  const coverage = coverageTerm.evaluate(gatedItem, state, ctxFor({ hit: 1.3 }));
  assert(
    coverage !== null && good !== null && Math.abs(good.value) < coverage.value,
    "the hit-reliability nudge stays small relative to one slot of coverage",
    `hit=${good?.value}, coverage=${coverage?.value}`,
  );
}

console.log("\n14. ── Positive synergy ──");
{
  // Table integrity.
  const pairKeys = new Set<string>();
  let selfPair = false;
  let duplicatePair = false;
  let badStrength = false;
  let badPrefix = false;
  for (const rule of SYNERGY_RULES) {
    const [a, b] = rule.itemIds;
    if (a === b) selfPair = true;
    const key = [a, b].sort().join("|");
    if (pairKeys.has(key)) duplicatePair = true;
    pairKeys.add(key);
    if (!(rule.strength > 0 && rule.strength <= 1)) badStrength = true;
    if (!a.startsWith("upgrade_") || !b.startsWith("upgrade_")) badPrefix = true;
  }
  assert(!selfPair, "no synergy rule pairs an item with itself");
  assert(!duplicatePair, "no synergy pair is duplicated, in either order");
  assert(!badStrength, "every synergy strength is in (0, 1]");
  assert(!badPrefix, "every synergy item id is an upgrade_ class name");

  // findSynergyRules symmetry.
  const [sideA, sideB] = SYNERGY_RULES[0].itemIds;
  const fromA = findSynergyRules(sideA, new Set([sideB]));
  const fromB = findSynergyRules(sideB, new Set([sideA]));
  assert(
    fromA.length === 1 && fromB.length === 1 && fromA[0] === fromB[0],
    "findSynergyRules finds the same rule from either side of the pair",
  );
  assert(
    findSynergyRules(sideA, new Set<string>()).length === 0 &&
      findSynergyRules(sideA, new Set(["unrelated_item"])).length === 0,
    "findSynergyRules returns [] when the partner is not picked",
  );

  // Term behaviour.
  const gunNeed = { ...zeroValues(), gunDamage: 1 };
  const ctx = makeBasketContext({ needVector: gunNeed, soulBudget: 20000, maxItems: 4 });
  const scale = SCORE_CATEGORIES.reduce((sum, cat) => sum + ctx.target[cat], 0) / ctx.maxItems;
  const emptyState: BasketState = {
    picked: [],
    coverage: zeroValues(),
    soulsPerCategory: { gun: 0, spirit: 0, vitality: 0 },
    spent: 0,
  };
  const stateWith = (partner: ItemCandidate): BasketState => ({
    ...emptyState,
    picked: [partner],
    coverage: { ...zeroValues(), ...partner.categoryValues },
    spent: partner.cost,
  });

  const [idA, idB] = ["upgrade_aoe_root", "upgrade_thermal_detonator"];
  const candA = { ...mkCandidate(idA, 8101, "gun", 1000, { gunDamage: 20 }), name: "Vortex Web" };
  const candB = {
    ...mkCandidate(idB, 8102, "gun", 1000, { gunDamage: 20 }),
    name: "Alchemical Fire",
  };

  assert(
    synergyTerm.evaluate(candB, emptyState, ctx) === null &&
      synergyTerm.evaluate(
        candB,
        stateWith(mkCandidate("other_item", 8103, "gun", 500, {})),
        ctx,
      ) === null,
    "synergyTerm returns null when no pair partner has been picked",
  );

  const bOnA = synergyTerm.evaluate(candB, stateWith(candA), ctx);
  const aOnB = synergyTerm.evaluate(candA, stateWith(candB), ctx);
  assert(
    bOnA !== null && bOnA.value > 0 && aOnB !== null && aOnB.value > 0,
    "synergyTerm is positive when the partner is picked, in BOTH orders of the pair",
    `B|A=${bOnA?.value}, A|B=${aOnB?.value}`,
  );

  const zeroCov = { ...mkCandidate(idB, 8104, "gun", 1000, {}), name: "Alchemical Fire" };
  assert(
    synergyTerm.evaluate(zeroCov, stateWith(candA), ctx) === null,
    "relevance gate: a paired candidate with zero coverage gain gets no synergy",
  );
  // Coverage saturates smoothly (no hard cap since 2026-10-24), so "covers
  // nothing" now means value only in a category the hero has no need for.
  const unneeded = SCORE_CATEGORIES.find((c) => !(ctx.target[c] > 0));
  const offNeed = unneeded
    ? { ...mkCandidate(idB, 8105, "gun", 1000, { [unneeded]: 20 }), name: "Alchemical Fire" }
    : null;
  // And one whose category is already covered far past its target: the
  // saturating gain is under RELEVANCE_MIN_GAIN_FRACTION of a slot.
  const farPast: BasketState = {
    ...stateWith(candA),
    coverage: { ...ctx.target, gunDamage: ctx.target.gunDamage * 20 },
  };
  assert(
    synergyTerm.evaluate(candB, farPast, ctx) === null,
    "relevance gate: a paired candidate in a category covered far past its target gets no synergy",
  );
  assert(
    offNeed !== null && synergyTerm.evaluate(offNeed, stateWith(candA), ctx) === null,
    "relevance gate: a paired candidate that only covers categories the hero does not need gets no synergy",
    `unneeded category: ${unneeded}`,
  );

  assert(
    bOnA !== null &&
      aOnB !== null &&
      bOnA.value <= SYNERGY_MAX_FRACTION * scale + 1e-9 &&
      aOnB.value <= SYNERGY_MAX_FRACTION * scale + 1e-9,
    "synergy value never exceeds SYNERGY_MAX_FRACTION x per-slot scale",
    `scale=${scale}, B|A=${bOnA?.value}, A|B=${aOnB?.value}`,
  );
  assert(
    bOnA !== null && bOnA.reason.includes("Vortex Web"),
    "synergy reason names the partner already in the basket",
    `Got: ${bOnA?.reason}`,
  );

  // End to end: the bonus must flip a near-tie between partner and decoy.
  // Target per slot 50 x 4 slots = 200 gunDamage; scale 50 => bonus 5.
  // Anchor (thermal detonator) 100 is the unambiguous first pick. Second pick:
  // decoy 32 vs partner 30 (decoy ahead by 2 < bonus 5).
  const anchor = mkCandidate(idB, 8201, "gun", 1000, { gunDamage: 100 });
  const partner = mkCandidate(idA, 8202, "gun", 1000, { gunDamage: 30 });
  const decoy = mkCandidate("decoy_gun", 8203, "gun", 1000, { gunDamage: 32 });
  const pool = [decoy, partner, anchor];
  const without = constructBasket(
    pool,
    ctx,
    DEFAULT_BASKET_TERMS.filter((t) => t.termId !== "synergy"),
  );
  const withSyn = constructBasket(pool, ctx, DEFAULT_BASKET_TERMS);
  assert(
    without.picks[0]?.item.itemId === idB && withSyn.picks[0]?.item.itemId === idB,
    "e2e: the anchor is the unambiguous first pick with or without synergy",
  );
  assert(
    without.picks[1]?.item.itemId === "decoy_gun",
    "e2e: without the synergy term the slightly stronger decoy is picked second",
    `Got: ${without.picks.map((p) => p.item.itemId).join(", ")}`,
  );
  assert(
    withSyn.picks[1]?.item.itemId === idA &&
      withSyn.picks[1].terms.some((t) => t.termId === "synergy"),
    "e2e: with the default terms the synergy partner is picked second, via the synergy term",
    `Got: ${withSyn.picks.map((p) => p.item.itemId).join(", ")}`,
  );

  // Owned partners (never in state.picked) also count.
  const ownedCtx = makeBasketContext({
    needVector: gunNeed,
    soulBudget: 20000,
    maxItems: 4,
    ownedItemNames: new Map([[idB, "My Owned Fire"]]),
  });
  const ownedOnly = synergyTerm.evaluate(candA, emptyState, ownedCtx);
  assert(
    ownedOnly !== null && ownedOnly.value > 0 && ownedOnly.reason.includes("My Owned Fire"),
    "an owned partner (state.picked empty) earns synergy and is named from ownedItemNames",
    `Got: ${JSON.stringify(ownedOnly)}`,
  );
  assert(
    synergyTerm.evaluate(candA, emptyState, ctx) === null,
    "omitting ownedItemNames keeps behaviour unchanged: null with no picked partner",
  );
  const bothCtx = makeBasketContext({
    needVector: gunNeed,
    soulBudget: 20000,
    maxItems: 4,
    ownedItemNames: new Map([[idB, "Alchemical Fire"]]),
  });
  const both = synergyTerm.evaluate(candA, stateWith(candB), bothCtx);
  assert(
    both !== null && Math.abs(both.value - SYNERGY_MAX_FRACTION * scale) < 1e-9,
    "a partner both owned AND picked counts once: value equals exactly one cap",
    `Got: ${both?.value}`,
  );

  // E2E with an owned partner that is not a candidate: first pick flips.
  const ownedPartner = mkCandidate(idA, 8301, "gun", 1000, { gunDamage: 30 });
  const ownedDecoy = mkCandidate("decoy_gun_2", 8302, "gun", 1000, { gunDamage: 32 });
  const ownedPool = [ownedDecoy, ownedPartner];
  const noOwned = constructBasket(ownedPool, ctx);
  const withOwned = constructBasket(
    ownedPool,
    makeBasketContext({
      needVector: gunNeed,
      soulBudget: 20000,
      maxItems: 4,
      ownedItemNames: new Map([[idB, "Alchemical Fire"]]),
    }),
  );
  assert(
    noOwned.picks[0]?.item.itemId === "decoy_gun_2",
    "e2e owned: without ownedItemNames the slightly stronger decoy is picked first",
    `Got: ${noOwned.picks.map((p) => p.item.itemId).join(", ")}`,
  );
  assert(
    withOwned.picks[0]?.item.itemId === idA &&
      withOwned.picks[0].terms.some((t) => t.termId === "synergy"),
    "e2e owned: with an owned partner the paired candidate wins the FIRST pick via synergy",
    `Got: ${withOwned.picks.map((p) => p.item.itemId).join(", ")}; decoy=${noOwned.picks[0]?.marginalValue}, partner=${withOwned.picks[0]?.marginalValue}`,
  );
}

// ── Milestone F: pairLift ────────────────────────────────────────────────────
console.log("\n15. Milestone F — pairLift");
{
  const EPS = 1e-9;
  const near = (x: number, y: number, eps = EPS) => Math.abs(x - y) <= eps;
  const lg = (c: WinCell) => Math.log((c.wins + 0.5) / (c.matches - c.wins + 0.5));

  // Build a stratum for items 1 and 2 from the four disjoint 2x2 groups.
  function stratumFromGroups(g: { ab: WinCell; aOnly: WinCell; bOnly: WinCell; none: WinCell }) {
    const sum = (...cs: WinCell[]): WinCell => ({
      wins: cs.reduce((s, c) => s + c.wins, 0),
      matches: cs.reduce((s, c) => s + c.matches, 0),
    });
    const st: PairStratum = {
      hero: sum(g.ab, g.aOnly, g.bOnly, g.none),
      singles: new Map<number, WinCell>([
        [1, sum(g.ab, g.aOnly)],
        [2, sum(g.ab, g.bOnly)],
      ]),
      pairs: new Map<string, WinCell>([[pairStatKey(1, 2), g.ab]]),
    };
    return st;
  }

  // Odds: none 1, A 3, B 3, AB 9 (with the +0.5 correction: w = k*l + (k-1)/2).
  const additiveGroups = {
    ab: { wins: 904, matches: 1004 },
    aOnly: { wins: 301, matches: 401 },
    bOnly: { wins: 301, matches: 401 },
    none: { wins: 100, matches: 200 },
  };
  const additive = stratumFromGroups(additiveGroups);

  // 1a. additive pair
  const addI = pairInteraction(additive, 1, 2);
  assert(
    addI !== null && near(addI.logOr, 0),
    "pairInteraction: exactly additive pair gives logOr ~ 0",
    `Got: ${addI?.logOr}`,
  );

  // 1a'. same formula by hand for a non-additive pair
  const handGroups = {
    ab: { wins: 60, matches: 100 },
    aOnly: { wins: 70, matches: 150 },
    bOnly: { wins: 40, matches: 90 },
    none: { wins: 120, matches: 300 },
  };
  const handI = pairInteraction(stratumFromGroups(handGroups), 1, 2);
  const handLogOr =
    lg(handGroups.ab) - lg(handGroups.aOnly) - lg(handGroups.bOnly) + lg(handGroups.none);
  const handVar = [handGroups.ab, handGroups.aOnly, handGroups.bOnly, handGroups.none].reduce(
    (s, c) => s + 1 / (c.wins + 0.5) + 1 / (c.matches - c.wins + 0.5),
    0,
  );
  assert(
    handI !== null && near(handI.logOr, handLogOr) && near(handI.variance, handVar),
    "pairInteraction: logOr and variance match the hand-computed formula",
    `Got: ${handI?.logOr}/${handI?.variance}, expected ${handLogOr}/${handVar}`,
  );
  assert(
    handI !== null && handI.pairMatches === 100 && near(handI.wrPair, 0.6),
    "pairInteraction: pairMatches and wrPair come from the AB cell",
  );

  // 1b. sign
  const synergyI = pairInteraction(
    stratumFromGroups({
      ab: { wins: 900, matches: 1000 },
      aOnly: { wins: 500, matches: 1000 },
      bOnly: { wins: 500, matches: 1000 },
      none: { wins: 500, matches: 1000 },
    }),
    1,
    2,
  );
  const antiI = pairInteraction(
    stratumFromGroups({
      ab: { wins: 100, matches: 1000 },
      aOnly: { wins: 500, matches: 1000 },
      bOnly: { wins: 500, matches: 1000 },
      none: { wins: 500, matches: 1000 },
    }),
    1,
    2,
  );
  assert(
    synergyI !== null && synergyI.logOr > 0,
    "pairInteraction: AB winning far above additive gives logOr > 0",
  );
  assert(
    antiI !== null && antiI.logOr < 0,
    "pairInteraction: AB winning far below additive gives logOr < 0",
  );

  // 1c. null cases
  assert(
    pairInteraction(
      stratumFromGroups({ ...additiveGroups, ab: { wins: 8, matches: 10 } }),
      1,
      2,
    ) === null,
    "pairInteraction: null when the AB group has < MIN_GROUP_MATCHES",
  );
  assert(
    pairInteraction(
      stratumFromGroups({ ...additiveGroups, none: { wins: 5, matches: MIN_GROUP_MATCHES - 1 } }),
      1,
      2,
    ) === null,
    "pairInteraction: null when the neither group has < MIN_GROUP_MATCHES",
  );
  assert(
    pairInteraction(
      stratumFromGroups({ ...additiveGroups, aOnly: { wins: 10, matches: MIN_GROUP_MATCHES } }),
      1,
      2,
    ) !== null,
    "pairInteraction: a group of exactly MIN_GROUP_MATCHES is accepted",
  );
  const negCell: PairStratum = {
    hero: { wins: 5000, matches: 10000 },
    singles: new Map<number, WinCell>([
      [1, { wins: 400, matches: 800 }],
      [2, { wins: 2000, matches: 4000 }],
    ]),
    pairs: new Map<string, WinCell>([[pairStatKey(1, 2), { wins: 500, matches: 1000 }]]),
  };
  assert(
    pairInteraction(negCell, 1, 2) === null,
    "pairInteraction: null when singles A < pair matches (negative A-only cell)",
  );
  const negWins: PairStratum = {
    ...negCell,
    singles: new Map<number, WinCell>([
      [1, { wins: 100, matches: 2000 }],
      [2, { wins: 2000, matches: 4000 }],
    ]),
  };
  assert(
    pairInteraction(negWins, 1, 2) === null,
    "pairInteraction: null when a derived cell has negative wins",
  );
  assert(
    pairInteraction({ ...additive, pairs: new Map() }, 1, 2) === null,
    "pairInteraction: null when the pair is missing",
  );
  assert(
    pairInteraction(
      { ...additive, singles: new Map([[1, additive.singles.get(1) as WinCell]]) },
      1,
      2,
    ) === null,
    "pairInteraction: null when a single is missing",
  );
  assert(pairInteraction(additive, 1, 1) === null, "pairInteraction: null when a === b");

  // 1d. symmetry
  const fwd = pairInteraction(stratumFromGroups(handGroups), 1, 2);
  const rev = pairInteraction(stratumFromGroups(handGroups), 2, 1);
  assert(
    fwd !== null && rev !== null && near(fwd.logOr, rev.logOr) && near(fwd.variance, rev.variance),
    "pairInteraction: symmetric in (a, b)",
  );

  // 1e. wrExpected
  assert(
    addI !== null &&
      addI.wrExpected > 0 &&
      addI.wrExpected < 1 &&
      Math.abs(addI.wrExpected - addI.wrPair) < 1e-3,
    "pairInteraction: wrExpected in (0,1) and ~ wrPair for a near-additive large-count case",
    `Got: expected=${addI?.wrExpected}, pair=${addI?.wrPair}`,
  );
  assert(
    synergyI !== null &&
      synergyI.wrExpected > 0 &&
      synergyI.wrExpected < 1 &&
      synergyI.wrPair > synergyI.wrExpected,
    "pairInteraction: synergistic pair wins more than wrExpected",
  );

  // 2. poolInteractions
  const mk = (logOr: number, variance: number): PairInteraction => ({
    logOr,
    variance,
    wrPair: 0.5,
    wrExpected: 0.5,
    pairMatches: 100,
  });
  const pooled = poolInteractions([mk(1, 0.5), null, mk(4, 2)]);
  // weights 2 and 0.5 -> sum 2.5, mean (2*1 + 0.5*4) / 2.5 = 1.6
  assert(
    pooled !== null && near(pooled.logOr, 1.6),
    "poolInteractions: inverse-variance weighted mean",
    `Got: ${pooled?.logOr}`,
  );
  assert(
    pooled !== null && near(pooled.se, Math.sqrt(1 / 2.5)),
    "poolInteractions: se = sqrt(1 / sum(w))",
  );
  assert(
    pooled !== null && pooled.strataUsed === 2,
    "poolInteractions: strataUsed counts non-null parts only",
  );
  assert(poolInteractions([null, null]) === null, "poolInteractions: all-null gives null");
  assert(poolInteractions([]) === null, "poolInteractions: empty input gives null");

  // 3. estimateTau2 / shrinkTowardZero (zero-centred prior: tau2 = mean(x^2) - mean(se^2))
  const tight = [
    { logOr: 0.1, se: 1 },
    { logOr: -0.1, se: 1 },
    { logOr: 0, se: 1 },
  ];
  assert(estimateTau2(tight) === 0, "estimateTau2: spread smaller than se gives 0");
  assert(
    shrinkTowardZero(0.1, 1, estimateTau2(tight)) === 0,
    "shrinkTowardZero: tau2 = 0 returns exactly 0",
  );
  const wide = [
    { logOr: -2, se: 0.1 },
    { logOr: 2, se: 0.1 },
    { logOr: 1, se: 0.1 },
    { logOr: -1, se: 0.1 },
  ];
  const tau2 = estimateTau2(wide);
  assert(
    near(tau2, 2.5 - 0.01),
    "estimateTau2: method of moments around ZERO (mean x^2 - mean se^2)",
    `Got: ${tau2}`,
  );
  const shared = estimateTau2([
    { logOr: 1, se: 0.1 },
    { logOr: 1, se: 0.1 },
    { logOr: 1, se: 0.1 },
  ]);
  assert(
    near(shared, 1 - 0.01),
    "estimateTau2: estimates sharing a nonzero mean are not over-shrunk (spread is measured from 0)",
    `Got: ${shared}`,
  );
  const sh = shrinkTowardZero(2, 0.1, tau2);
  assert(
    sh > 0 && sh < 2,
    "shrinkTowardZero: positive tau2 shrinks strictly between 0 and the estimate",
  );
  assert(
    near(sh, (2 * tau2) / (tau2 + 0.01)),
    "shrinkTowardZero: equals logOr * tau2 / (tau2 + se^2)",
  );
  assert(
    shrinkTowardZero(-2, 0.1, tau2) < 0,
    "shrinkTowardZero: preserves the sign of a negative estimate",
  );
  assert(
    estimateTau2([]) === 0 && estimateTau2([{ logOr: 5, se: 0.1 }]) === 0,
    "estimateTau2: fewer than 2 estimates gives 0",
  );

  // 4. removeItemEffects (least-squares additive item effects)
  const closeTo = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  // Purely additiveFit values on an INCOMPLETE graph: plain per-item means get
  // this wrong; least squares recovers the effects and leaves 0 residual.
  const truth: Record<string, number> = { p: 0.3, q: -0.2, r: 0.1, s: -0.4, t: 0.2 };
  const truthMean = Object.values(truth).reduce((x, y) => x + y, 0) / 5;
  const g0 = 0.05;
  const edges: Array<[string, string]> = [
    ["p", "q"],
    ["p", "r"],
    ["q", "r"],
    ["r", "s"],
    ["s", "t"],
    ["q", "t"],
  ];
  const additiveFit = removeItemEffects(
    edges.map(([a, b]) => ({ a, b, value: g0 + truth[a] + truth[b] })),
  );
  assert(
    additiveFit.pairOnly.every((v) => closeTo(v, 0)),
    "removeItemEffects: purely additiveFit values on an incomplete graph leave 0 pair-only residual",
    `Got: ${additiveFit.pairOnly.join(", ")}`,
  );
  assert(
    Object.keys(truth).every((id) =>
      closeTo(additiveFit.byItem.get(id)?.effect ?? NaN, truth[id] - truthMean),
    ) && closeTo(additiveFit.grand, g0 + 2 * truthMean),
    "removeItemEffects: recovers the item effects (mean 0) and the intercept",
  );
  // Non-additiveFit values: the least-squares normal equations say each item's
  // residuals sum to 0, and the residuals sum to 0 overall.
  const messy = [
    { a: "p", b: "q", value: 0.4 },
    { a: "p", b: "r", value: -0.1 },
    { a: "q", b: "r", value: 0.25 },
    { a: "r", b: "s", value: 0.9 },
    { a: "s", b: "t", value: -0.3 },
    { a: "q", b: "t", value: 0.05 },
    { a: "p", b: "t", value: 0.6 },
  ];
  const fitMessy = removeItemEffects(messy);
  const residualSum = (id: string) =>
    messy.reduce((s, r, i) => s + (r.a === id || r.b === id ? fitMessy.pairOnly[i] : 0), 0);
  assert(
    ["p", "q", "r", "s", "t"].every((id) => closeTo(residualSum(id), 0)) &&
      closeTo(
        fitMessy.pairOnly.reduce((x, y) => x + y, 0),
        0,
      ),
    "removeItemEffects: residuals satisfy the least-squares normal equations",
  );
  assert(
    !fitMessy.pairOnly.every((v) => closeTo(v, 0)),
    "removeItemEffects: non-additive values leave a nonzero pair-only remainder",
  );
  assert(
    closeTo(
      [...fitMessy.byItem.values()].reduce((x, e) => x + e.effect, 0),
      0,
    ) &&
      fitMessy.byItem.get("p")?.pairs === 3 &&
      fitMessy.byItem.get("s")?.pairs === 2,
    "removeItemEffects: effects have mean 0; byItem counts pairs per item",
  );
  const reversed = removeItemEffects([...messy].reverse());
  assert(
    reversed.pairOnly.every((v, i) => closeTo(v, fitMessy.pairOnly[messy.length - 1 - i])),
    "removeItemEffects: output is aligned with the input order",
  );
  // An item in ONE pair: that pair's residual is absorbed by the item's own
  // effect (the old per-item-mean version returned a number about the partner).
  const leaf = removeItemEffects([...messy, { a: "t", b: "u", value: 0.8 }]);
  assert(
    closeTo(leaf.pairOnly[messy.length], 0),
    "removeItemEffects: a single-pair item's pair has 0 pair-only residual",
    `Got: ${leaf.pairOnly[messy.length]}`,
  );

  // 5. componentClosure
  const comps: Record<string, string[]> = { t3: ["t2"], t2: ["t1"], t1: [] };
  const closure3 = componentClosure("t3", (id) => comps[id]);
  assert(
    closure3.size === 2 && closure3.has("t2") && closure3.has("t1") && !closure3.has("t3"),
    "componentClosure: 3-level chain returns every lower tier",
  );
  const cyc: Record<string, string[]> = { p: ["q"], q: ["p"] };
  const cycClosure = componentClosure("p", (id) => cyc[id]);
  assert(
    cycClosure.size === 2 && cycClosure.has("q") && cycClosure.has("p"),
    "componentClosure: a cycle terminates",
  );
  assert(
    componentClosure("nope", (id) => comps[id]).size === 0,
    "componentClosure: unknown id gives an empty set",
  );

  // 6. fitHeroPairs
  const fitItems = new Map<number, FitItem>([
    [1, { id: "a_item" }],
    [2, { id: "b_item", componentItems: ["a_item"] }],
    [3, { id: "c_item" }],
    [4, { id: "d_item" }],
    [5, { id: "e_item" }],
  ]);
  const pairWins: Array<[number, number, number]> = [
    [1, 3, 1200],
    [3, 4, 1000],
    [1, 4, 1100],
    [4, 5, 900],
    [3, 5, 1300],
  ];
  // Bands DIFFER from raw (pair wins shifted), so raw, banded and shrunk are
  // distinct numbers and a mis-wiring between them shows up.
  const mkFitStratum = (reverse: boolean, shift: number): PairStratum => {
    const pairEntries: Array<[string, WinCell]> = [
      ...pairWins.map(([x, y, w]): [string, WinCell] => [
        pairStatKey(x, y),
        { wins: w + shift * (x + y), matches: 2000 },
      ]),
      [pairStatKey(1, 2), { wins: 1500, matches: 2000 }], // component -> upgrade
      [pairStatKey(1, 99), { wins: 100, matches: 200 }], // unknown id
      [pairStatKey(2, 4), { wins: 15, matches: 30 }], // below minPairMatches
    ];
    const singleEntries: Array<[number, WinCell]> = [1, 2, 3, 4, 5].map((id) => [
      id,
      { wins: 2000, matches: 4000 },
    ]);
    return {
      hero: { wins: 5000, matches: 10000 },
      singles: new Map(reverse ? [...singleEntries].reverse() : singleEntries),
      pairs: new Map(reverse ? [...pairEntries].reverse() : pairEntries),
    };
  };
  const fit = fitHeroPairs(
    mkFitStratum(false, 0),
    [mkFitStratum(false, 15), mkFitStratum(false, -8)],
    fitItems,
    50,
  );
  const fitRev = fitHeroPairs(
    mkFitStratum(true, 0),
    [mkFitStratum(true, 15), mkFitStratum(true, -8)],
    fitItems,
    50,
  );
  assert(
    fit.droppedChain === 1,
    "fitHeroPairs: component->upgrade pair counted in droppedChain",
    `Got: ${fit.droppedChain}`,
  );
  assert(
    fit.droppedUnknown === 1,
    "fitHeroPairs: pair with an id missing from itemsByNumericId counted in droppedUnknown",
    `Got: ${fit.droppedUnknown}`,
  );
  assert(
    fit.pairs.map((p) => `${p.a}|${p.b}`).join(",") ===
      "a_item|c_item,a_item|d_item,c_item|d_item,c_item|e_item,d_item|e_item",
    "fitHeroPairs: below-minPairMatches pair silently skipped; pairs sorted by (a, b), a < b",
    `Got: ${fit.pairs.map((p) => `${p.a}|${p.b}`).join(", ")}`,
  );
  assert(
    fit.pairs.every((p) => !near(p.raw.logOr, p.banded.logOr)),
    "fitHeroPairs: banded comes from the band strata, not the raw stratum",
  );
  assert(
    fit.tau2 === estimateTau2(fit.pairs.map((p) => p.banded)),
    "fitHeroPairs: tau2 is estimated from the BANDED estimates",
  );
  assert(
    fit.pairs.every((p) => p.shrunk === shrinkTowardZero(p.banded.logOr, p.banded.se, fit.tau2)),
    "fitHeroPairs: shrunk = shrinkTowardZero(banded, se, tau2) for every pair",
  );
  const expectedPairOnly = removeItemEffects(
    fit.pairs.map((p) => ({ a: p.a, b: p.b, value: p.shrunk })),
  ).pairOnly;
  assert(
    fit.pairs.every((p, i) => p.pairOnly === expectedPairOnly[i]) &&
      fit.pairs.some((p) => Math.abs(p.pairOnly) > 1e-9),
    "fitHeroPairs: pairOnly = removeItemEffects over the shrunk values, index-aligned and nonzero",
  );
  assert(
    JSON.stringify(fit.pairs) === JSON.stringify(fitRev.pairs) &&
      fit.tau2 === fitRev.tau2 &&
      fit.droppedChain === fitRev.droppedChain &&
      fit.droppedUnknown === fitRev.droppedUnknown,
    "fitHeroPairs: identical output when strata Map insertion order is reversed",
  );
  const fitB = fitHeroPairs(mkFitStratum(false, 0), [mkFitStratum(false, 15)], fitItems, 50);
  assert(
    fitB.pairs.length === 5 && fitB.pairs.every((p) => p.banded.strataUsed === 1),
    "fitHeroPairs: banded.strataUsed reflects the number of bands supplied",
  );
  let threw = false;
  try {
    fitHeroPairs(
      mkFitStratum(false, 0),
      [],
      new Map<number, FitItem>([
        [1, { id: "dup" }],
        [3, { id: "dup" }],
      ]),
      50,
    );
  } catch {
    threw = true;
  }
  assert(threw, "fitHeroPairs: two numeric ids with one class name throws (ambiguous join)");

  // 7. pairLiftKey / pairLiftFor
  const entry: PairLiftEntry = { lift: 0.2, se: 0.05, n: 300 };
  const tbl: PairLiftTable = {
    version: 3,
    generated: "2026-01-01",
    window: { from: "2025-12-01", to: "2026-01-01" },
    method: {
      gameMode: "normal",
      netWorthBands: [0],
      minPairMatches: 100,
      minAbsZ: 3,
      minItemPairs: 10,
      minRank: 6,
      minRankName: "Oracle",
      days: 90,
      ruleMaxSe: 0.1,
    },
    fits: { "7": { matches: 1000, pairsFitted: 1, kept: 1, tau: 0.1 } },
    heroes: { "7": { "x|y": entry } },
    rulePairs: { "7": { "x|y": entry } },
    handPairs: {},
  };
  assert(
    pairLiftKey("x", "y") === "x|y" && pairLiftKey("y", "x") === "x|y",
    "pairLiftKey: order-independent, lower id first",
  );
  assert(
    pairLiftFor(tbl, 7, "x", "y") === entry && pairLiftFor(tbl, 7, "y", "x") === entry,
    "pairLiftFor: same entry in either order",
  );
  assert(pairLiftFor(tbl, 8, "x", "y") === null, "pairLiftFor: unknown hero gives null");
  assert(pairLiftFor(tbl, 7, "x", "z") === null, "pairLiftFor: unknown pair gives null");
  assert(pairLiftFor(tbl, 7, "x", "x") === null, "pairLiftFor: idA === idB gives null");
  assert(
    pairLiftFor(tbl, "7", "x", "y") === entry,
    "pairLiftFor: accepts heroId as a string as well as a number",
  );

  // 8. committed table integrity (generic: the file is regenerated by a script)
  const table = pairLiftTableJson as unknown as PairLiftTable;
  const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  assert(table.version === 3, "pairLiftTable.json: version === 3");
  assert(
    isDate(table.generated) && isDate(table.window.from) && isDate(table.window.to),
    "pairLiftTable.json: generated / window.from / window.to are YYYY-MM-DD",
  );
  assert(
    table.method.minAbsZ > 0 && table.method.minPairMatches > 0 && table.method.minItemPairs > 0,
    "pairLiftTable.json: method.minAbsZ, minPairMatches and minItemPairs are positive",
  );
  const { minRank, minRankName } = table.method;
  assert(
    table.method.days > 0 && table.method.ruleMaxSe > 0,
    "pairLiftTable.json: method.days and method.ruleMaxSe are positive",
  );
  assert(
    (minRank === null || (Number.isInteger(minRank) && minRank >= 0 && minRank <= 11)) &&
      (minRank === null
        ? minRankName === null
        : typeof minRankName === "string" && minRankName.length > 0),
    "pairLiftTable.json: minRank is null or an integer 0-11, and minRankName is set exactly when minRank is",
  );
  const heroKeys = Object.keys(table.heroes);
  assert(
    heroKeys.every((k) => /^\d+$/.test(k)),
    "pairLiftTable.json: every hero key is a numeric string",
  );
  const badFits = heroKeys.filter(
    (k) =>
      table.fits[k] === undefined || table.fits[k].kept !== Object.keys(table.heroes[k]).length,
  );
  assert(
    badFits.length === 0,
    "pairLiftTable.json: every hero has a fits entry whose kept equals its entry count",
    badFits.join(", "),
  );
  const badKeys: string[] = [];
  const badEntries: string[] = [];
  for (const k of heroKeys) {
    for (const [pk, e] of Object.entries(table.heroes[k])) {
      const parts = pk.split("|");
      if (parts.length !== 2 || parts[0] === parts[1] || !(parts[0] < parts[1])) {
        badKeys.push(`${k}:${pk}`);
      }
      if (
        !Number.isFinite(e.lift) ||
        !(e.se > 0) ||
        !Number.isInteger(e.n) ||
        e.n < table.method.minPairMatches ||
        // Strict: fitPairTable thresholds on the rounded values it writes.
        Math.abs(e.lift) / e.se < table.method.minAbsZ
      ) {
        badEntries.push(`${k}:${pk}`);
      }
    }
  }
  assert(
    badKeys.length === 0,
    "pairLiftTable.json: every pair key is `a|b` with a < b",
    badKeys.slice(0, 5).join(", "),
  );
  assert(
    badEntries.length === 0,
    "pairLiftTable.json: every entry has finite lift, se > 0, integer n >= minPairMatches, |lift|/se >= minAbsZ (strict, on the rounded values)",
    badEntries.slice(0, 5).join(", "),
  );

  const ruleHeroKeys = Object.keys(table.rulePairs);
  const badRuleHeroes = ruleHeroKeys.filter((k) => !/^\d+$/.test(k) || table.fits[k] === undefined);
  assert(
    badRuleHeroes.length === 0,
    "pairLiftTable.json: every rulePairs hero key is numeric and present in fits",
    badRuleHeroes.join(", "),
  );
  const handRuleKeys = new Set(SYNERGY_RULES.map((r) => pairLiftKey(r.itemIds[0], r.itemIds[1])));
  const badRuleKeys: string[] = [];
  const badRuleEntries: string[] = [];
  const nonRulePairs: string[] = [];
  for (const k of ruleHeroKeys) {
    for (const [pk, e] of Object.entries(table.rulePairs[k])) {
      const parts = pk.split("|");
      if (parts.length !== 2 || parts[0] === parts[1] || !(parts[0] < parts[1])) {
        badRuleKeys.push(`${k}:${pk}`);
      }
      if (
        !Number.isFinite(e.lift) ||
        !(e.se > 0) ||
        // se bound applies unless the entry is the hero's significant entry.
        (e.se > table.method.ruleMaxSe &&
          JSON.stringify(table.heroes[k]?.[pk]) !== JSON.stringify(e)) ||
        !Number.isInteger(e.n) ||
        e.n < table.method.minPairMatches
      ) {
        badRuleEntries.push(`${k}:${pk}`);
      }
      if (!handRuleKeys.has(pk)) nonRulePairs.push(`${k}:${pk}`);
    }
  }
  assert(
    badRuleKeys.length === 0,
    "pairLiftTable.json: every rulePairs key is `a|b` with a < b",
    badRuleKeys.slice(0, 5).join(", "),
  );
  assert(
    badRuleEntries.length === 0,
    "pairLiftTable.json: every rulePairs entry has finite lift, 0 < se <= ruleMaxSe (or is the significant entry), integer n >= minPairMatches",
    badRuleEntries.slice(0, 5).join(", "),
  );
  assert(
    nonRulePairs.length === 0,
    "pairLiftTable.json: every rulePairs pair is a SYNERGY_RULES pair",
    nonRulePairs.slice(0, 5).join(", "),
  );
  // Never counted twice: a hand-rule pair in heroes is also in rulePairs.
  const missingRule: string[] = [];
  for (const k of heroKeys) {
    for (const pk of Object.keys(table.heroes[k])) {
      if (handRuleKeys.has(pk) && !table.rulePairs[k]?.[pk]) missingRule.push(`${k}:${pk}`);
    }
  }
  assert(
    missingRule.length === 0,
    "pairLiftTable.json: every significant SYNERGY_RULES pair in heroes is also in rulePairs",
    missingRule.join(", "),
  );
  // handPairs (audit only): keys are hand-authored pairs (synergy or anti), on
  // fitted heroes, with valid entries; and every rulePairs entry is among them.
  const allHandKeys = new Set(
    [...SYNERGY_RULES, ...ANTI_SYNERGY_RULES].map((r) => pairLiftKey(r.itemIds[0], r.itemIds[1])),
  );
  const badHand: string[] = [];
  for (const [k, m] of Object.entries(table.handPairs)) {
    if (!/^\d+$/.test(k) || table.fits[k] === undefined) badHand.push(`hero ${k}`);
    for (const [pk, e] of Object.entries(m)) {
      if (
        !allHandKeys.has(pk) ||
        !Number.isFinite(e.lift) ||
        !(e.se > 0) ||
        !Number.isInteger(e.n) ||
        e.n < table.method.minPairMatches
      ) {
        badHand.push(`${k}:${pk}`);
      }
    }
  }
  assert(
    badHand.length === 0,
    "pairLiftTable.json: handPairs holds only hand-authored pairs on fitted heroes, with valid entries",
    badHand.slice(0, 5).join(", "),
  );
  const ruleNotInHand: string[] = [];
  for (const [k, m] of Object.entries(table.rulePairs)) {
    for (const pk of Object.keys(m))
      if (JSON.stringify(table.handPairs[k]?.[pk]) !== JSON.stringify(m[pk])) {
        ruleNotInHand.push(`${k}:${pk}`);
      }
  }
  assert(
    ruleNotInHand.length === 0,
    "pairLiftTable.json: every rulePairs entry is also in handPairs with identical values (the audit sees every override)",
    ruleNotInHand.join(", "),
  );
  const sliced = heroPairLift(table, Object.keys(table.fits)[0]) as unknown as Record<
    string,
    unknown
  >;
  assert(
    sliced !== null && !("handPairs" in sliced),
    "heroPairLift: the audit-only handPairs section never reaches the basket slice",
  );
}

// ── Milestone F: pairTerm and measured-wins override ─────────────────────────
console.log("\n16. Milestone F — pairTerm and measured-wins override");
{
  const EPS = 1e-9;
  const near = (x: number, y: number) => Math.abs(x - y) <= EPS;
  const mkEntry = (lift: number): PairLiftEntry => ({ lift, se: 0.05, n: 300 });
  const mkLift = (
    pairs: Record<string, PairLiftEntry>,
    rulePairs: Record<string, PairLiftEntry> = {},
  ): HeroPairLift => ({ pairs, rulePairs, scope: "Oracle+ matches, last 90 days" });

  const gunNeed = { ...zeroValues(), gunDamage: 1 };
  const baseOpts = { needVector: gunNeed, soulBudget: 20000, maxItems: 4 };
  const plainCtx = makeBasketContext(baseOpts);
  const scale =
    SCORE_CATEGORIES.reduce((sum, cat) => sum + plainCtx.target[cat], 0) / plainCtx.maxItems;
  const emptyState: BasketState = {
    picked: [],
    coverage: zeroValues(),
    soulsPerCategory: { gun: 0, spirit: 0, vitality: 0 },
    spent: 0,
  };
  const stateWith = (...picked: ItemCandidate[]): BasketState => ({
    ...emptyState,
    picked,
    spent: picked.reduce((s, c) => s + c.cost, 0),
  });

  const cand = { ...mkCandidate("cand_item", 9001, "gun", 1000, { gunDamage: 20 }), name: "Cand" };
  const partnerA = {
    ...mkCandidate("partner_a", 9002, "gun", 1000, { gunDamage: 20 }),
    name: "Partner A",
  };
  const ownedA = new Map([["partner_a", "Partner A"]]);
  const keyA = pairLiftKey("cand_item", "partner_a");
  const ctxFor = (
    pairs: Record<string, PairLiftEntry>,
    owned: ReadonlyMap<string, string> = ownedA,
    rulePairs: Record<string, PairLiftEntry> = {},
  ) =>
    makeBasketContext({ ...baseOpts, ownedItemNames: owned, pairLift: mkLift(pairs, rulePairs) });

  // 1. Fires, owned partner.
  const pos = pairTerm.evaluate(cand, emptyState, ctxFor({ [keyA]: mkEntry(0.15) }));
  assert(
    pos !== null &&
      pos.termId === "pair-lift" &&
      near(pos.value, (0.15 / 0.3) * PAIR_LIFT_MAX_FRACTION * scale),
    "pairTerm: lift 0.15 with an owned partner = (0.15 / 0.3) x PAIR_LIFT_MAX_FRACTION x scale",
    `Got: ${pos?.value}, expected ${(0.15 / 0.3) * PAIR_LIFT_MAX_FRACTION * scale}`,
  );

  // 2. Picked partner counts too.
  const picked = pairTerm.evaluate(
    cand,
    stateWith(partnerA),
    ctxFor({ [keyA]: mkEntry(0.15) }, new Map()),
  );
  assert(
    picked !== null && pos !== null && near(picked.value, pos.value),
    "pairTerm: a partner picked earlier in the basket counts like an owned one",
    `Got: ${picked?.value}`,
  );

  // 3. Symmetric.
  const neg = pairTerm.evaluate(cand, emptyState, ctxFor({ [keyA]: mkEntry(-0.15) }));
  assert(
    neg !== null && pos !== null && neg.value < 0 && near(neg.value, -pos.value),
    "pairTerm: negative lift gives a negative value of the same magnitude",
    `Got: ${neg?.value}`,
  );

  // 4. Saturation and netting.
  const ownedAB = new Map([
    ["partner_a", "Partner A"],
    ["partner_b", "Partner B"],
  ]);
  const keyB = pairLiftKey("cand_item", "partner_b");
  const sat = pairTerm.evaluate(
    cand,
    emptyState,
    ctxFor({ [keyA]: mkEntry(0.25), [keyB]: mkEntry(0.25) }, ownedAB),
  );
  assert(
    sat !== null && near(sat.value, PAIR_LIFT_MAX_FRACTION * scale),
    "pairTerm: two 0.25 partners saturate at exactly +PAIR_LIFT_MAX_FRACTION x scale",
    `Got: ${sat?.value}, expected ${PAIR_LIFT_MAX_FRACTION * scale}`,
  );
  const satNeg = pairTerm.evaluate(
    cand,
    emptyState,
    ctxFor({ [keyA]: mkEntry(-0.25), [keyB]: mkEntry(-0.25) }, ownedAB),
  );
  assert(
    satNeg !== null && near(satNeg.value, -PAIR_LIFT_MAX_FRACTION * scale),
    "pairTerm: two -0.25 partners saturate at exactly -PAIR_LIFT_MAX_FRACTION x scale",
    `Got: ${satNeg?.value}`,
  );
  const netted = pairTerm.evaluate(
    cand,
    emptyState,
    ctxFor({ [keyA]: mkEntry(0.25), [keyB]: mkEntry(-0.25) }, ownedAB),
  );
  assert(
    netted === null,
    "pairTerm: +0.25 and -0.25 partners net out to nothing",
    `Got: ${netted?.value}`,
  );
  const partlyNetted = pairTerm.evaluate(
    cand,
    emptyState,
    ctxFor({ [keyA]: mkEntry(0.25), [keyB]: mkEntry(-0.1) }, ownedAB),
  );
  assert(
    partlyNetted !== null &&
      near(partlyNetted.value, (0.15 / 0.3) * PAIR_LIFT_MAX_FRACTION * scale),
    "pairTerm: a positive and a negative partner sum before saturating (+0.25, -0.1 = 0.15)",
    `Got: ${partlyNetted?.value}`,
  );

  // 5. Inert.
  assert(
    pairTerm.evaluate(
      cand,
      emptyState,
      makeBasketContext({ ...baseOpts, ownedItemNames: ownedA }),
    ) === null,
    "pairTerm: null when ctx.pairLift is absent",
  );
  assert(
    pairTerm.evaluate(cand, emptyState, ctxFor({ "other_a|other_b": mkEntry(0.3) })) === null,
    "pairTerm: null when the pair is not in pairs (absent is not zero)",
  );
  const noCover = { ...mkCandidate("cand_item", 9004, "gun", 1000, {}), name: "Cand" };
  assert(
    pairTerm.evaluate(noCover, emptyState, ctxFor({ [keyA]: mkEntry(0.3) })) === null,
    "pairTerm: null when the candidate covers no unmet need (relevance gate)",
  );
  assert(
    pairTerm.evaluate(cand, emptyState, ctxFor({ [keyA]: mkEntry(0.3) }, new Map())) === null,
    "pairTerm: null when the partner is neither owned nor picked",
  );

  // 6. Determinism and wording. "B_item" sorts before "a_item" by code unit,
  // but after it under localeCompare, so this pins the ordering rule.
  const pairsU = {
    [pairLiftKey("cand_item", "B_item")]: mkEntry(0.1),
    [pairLiftKey("cand_item", "a_item")]: mkEntry(0.05),
  };
  const fwd = new Map([
    ["B_item", "Bname"],
    ["a_item", "aname"],
  ]);
  const rev = new Map([
    ["a_item", "aname"],
    ["B_item", "Bname"],
  ]);
  const tFwd = pairTerm.evaluate(cand, emptyState, ctxFor(pairsU, fwd));
  const tRev = pairTerm.evaluate(cand, emptyState, ctxFor(pairsU, rev));
  assert(
    tFwd !== null && tRev !== null && tFwd.value === tRev.value && tFwd.reason === tRev.reason,
    "pairTerm: value and reason identical when ownedItemNames is built in reversed order",
    `fwd=${tFwd?.reason}; rev=${tRev?.reason}`,
  );
  assert(
    tFwd !== null && tFwd.reason.includes("Bname, aname"),
    "pairTerm: reason names partners in code-unit id order",
    `Got: ${tFwd?.reason}`,
  );
  assert(
    tFwd !== null &&
      tFwd.reason.includes("Oracle+ matches, last 90 days") &&
      !/synergy/i.test(tFwd.reason),
    "pairTerm: reason contains the scope string and never says synergy",
    `Got: ${tFwd?.reason}`,
  );

  // 7. Measured wins over the hand rule.
  const [ruleA, ruleB] = SYNERGY_RULES[2].itemIds;
  const ruleCand = { ...mkCandidate(ruleA, 9101, "gun", 1000, { gunDamage: 20 }), name: "Rule A" };
  const ruleOwned = new Map([[ruleB, "Rule B"]]);
  const ruleKey = pairLiftKey(ruleA, ruleB);
  const ruleCtx = (pl: HeroPairLift | undefined) =>
    makeBasketContext({ ...baseOpts, ownedItemNames: ruleOwned, pairLift: pl });
  const handOnly = synergyTerm.evaluate(ruleCand, emptyState, ruleCtx(undefined));
  assert(
    handOnly !== null && near(handOnly.value, SYNERGY_MAX_FRACTION * scale),
    "synergyTerm: with ctx.pairLift absent the hand rule fires as before",
    `Got: ${handOnly?.value}`,
  );
  assert(
    synergyTerm.evaluate(ruleCand, emptyState, ruleCtx(mkLift({}, { [ruleKey]: mkEntry(0.2) }))) ===
      null,
    "synergyTerm: null for a pair present in rulePairs (measured wins)",
  );
  assert(
    synergyTerm.evaluate(ruleCand, emptyState, ruleCtx(mkLift({}, { [ruleKey]: mkEntry(0) }))) ===
      null,
    "synergyTerm: null for a pair present in rulePairs even when the measured lift is 0",
  );
  const absent = synergyTerm.evaluate(ruleCand, emptyState, ruleCtx(mkLift({}, {})));
  assert(
    absent !== null && handOnly !== null && absent.value === handOnly.value,
    "synergyTerm: fires exactly as before when the pair is absent from rulePairs",
    `Got: ${absent?.value}`,
  );
  const pairsOnly = synergyTerm.evaluate(
    ruleCand,
    emptyState,
    ruleCtx(mkLift({ [ruleKey]: mkEntry(0.2) }, {})),
  );
  assert(
    pairsOnly === null,
    "synergyTerm: a pair in pairs (even if not in rulePairs) also suppresses the hand rule: never counted twice",
  );
  // The live Graves case: a precise ~0 in rulePairs only. The hand rule is
  // skipped AND pairTerm credits exactly the measurement, with a reason.
  const ruleOnlyLift = mkLift({}, { [ruleKey]: mkEntry(0.06) });
  const overridden = pairTerm.evaluate(ruleCand, emptyState, ruleCtx(ruleOnlyLift));
  assert(
    synergyTerm.evaluate(ruleCand, emptyState, ruleCtx(ruleOnlyLift)) === null &&
      overridden !== null &&
      near(overridden.value, (0.06 / 0.3) * PAIR_LIFT_MAX_FRACTION * scale) &&
      overridden.reason.includes("Rule B"),
    "pairTerm: an overridden hand rule (rulePairs only) is credited with its measured value and explained",
    `Got: ${overridden?.value}`,
  );
  assert(
    pairTerm.evaluate(
      ruleCand,
      emptyState,
      ruleCtx(mkLift({ [ruleKey]: mkEntry(0.15) }, { [ruleKey]: mkEntry(0.06) })),
    )?.value ===
      pairTerm.evaluate(ruleCand, emptyState, ruleCtx(mkLift({ [ruleKey]: mkEntry(0.15) }, {})))
        ?.value,
    "pairTerm: a significant entry takes precedence over the rulePairs entry",
  );

  // 8. heroPairLift.
  const mkTable = (minRankName: string | null): PairLiftTable => ({
    version: 3,
    generated: "2026-01-01",
    window: { from: "2025-12-01", to: "2026-01-01" },
    method: {
      gameMode: "normal",
      netWorthBands: [0],
      minPairMatches: 100,
      minAbsZ: 3,
      minItemPairs: 10,
      minRank: minRankName === null ? null : 6,
      minRankName,
      days: 60,
      ruleMaxSe: 0.1,
    },
    fits: {
      "7": { matches: 1000, pairsFitted: 1, kept: 1, tau: 0.1 },
      "9": { matches: 1000, pairsFitted: 0, kept: 0, tau: 0 },
    },
    heroes: { "7": { "x|y": mkEntry(0.2) } },
    rulePairs: { "7": { "p|q": mkEntry(0.01) } },
    // handPairs differs from rulePairs (an extra anti-synergy key, another
    // lift) so a swap of the two sources in heroPairLift is detectable.
    handPairs: { "7": { "p|q": mkEntry(0.02), "r|s": mkEntry(-0.3) } },
  });
  const t8 = mkTable("Oracle");
  assert(heroPairLift(t8, 8) === null, "heroPairLift: null for a hero with no fits entry");
  const h7 = heroPairLift(t8, 7);
  assert(
    h7 !== null && h7.pairs["x|y"]?.lift === 0.2 && h7.rulePairs["p|q"]?.lift === 0.01,
    "heroPairLift: returns the hero's pairs and rulePairs slices",
  );
  assert(
    h7 !== null && h7.rulePairs["r|s"] === undefined && h7.rulePairs["p|q"]?.lift === 0.01,
    "heroPairLift: rulePairs comes from rulePairs, never from the audit-only handPairs",
  );
  const h9 = heroPairLift(t8, "9");
  assert(
    h9 !== null &&
      typeof h9.pairs === "object" &&
      typeof h9.rulePairs === "object" &&
      Object.keys(h9.pairs).length === 0 &&
      Object.keys(h9.rulePairs).length === 0,
    "heroPairLift: a fitted hero with no entries gets empty pairs/rulePairs objects, not undefined",
  );
  assert(
    h7 !== null && h7.scope === "Oracle+ matches, last 60 days",
    "heroPairLift: scope reads '<minRankName>+ matches, last <days> days'",
    `Got: ${h7?.scope}`,
  );
  assert(
    heroPairLift(mkTable(null), 7)?.scope === "matches, last 60 days",
    "heroPairLift: scope is 'matches, last <days> days' when minRankName is null",
  );

  // 9. Term registration.
  const synIdx = DEFAULT_BASKET_TERMS.indexOf(synergyTerm);
  assert(
    DEFAULT_BASKET_TERMS.filter((t) => t === pairTerm).length === 1 &&
      DEFAULT_BASKET_TERMS.filter((t) => t.termId === "pair-lift").length === 1 &&
      synIdx >= 0 &&
      DEFAULT_BASKET_TERMS.indexOf(pairTerm) > synIdx,
    "DEFAULT_BASKET_TERMS contains pairTerm exactly once, after synergyTerm",
  );

  // 10. End to end: a measured pair breaks a near-tie. Scale 50, decoy leads
  // by 2 coverage points; lift 0.3 saturates the term at 0.08 x 50 = 4.
  const lifted = mkCandidate("lifted_gun", 9201, "gun", 1000, { gunDamage: 30 });
  const decoy = mkCandidate("decoy_gun", 9202, "gun", 1000, { gunDamage: 32 });
  const e2ePool = [decoy, lifted];
  const e2eCtx = makeBasketContext({
    ...baseOpts,
    ownedItemNames: new Map([["owned_x", "Owned X"]]),
    pairLift: mkLift({ [pairLiftKey("lifted_gun", "owned_x")]: mkEntry(0.3) }),
  });
  const e2eWithout = constructBasket(
    e2ePool,
    e2eCtx,
    DEFAULT_BASKET_TERMS.filter((t) => t.termId !== "pair-lift"),
  );
  const e2eWith = constructBasket(e2ePool, e2eCtx);
  assert(
    e2eWithout.picks[0]?.item.itemId === "decoy_gun",
    "e2e pair-lift: without the term the slightly stronger decoy is picked first",
    `Got: ${e2eWithout.picks.map((p) => p.item.itemId).join(", ")}`,
  );
  assert(
    e2eWith.picks[0]?.item.itemId === "lifted_gun" &&
      e2eWith.picks[0].terms.some((t) => t.termId === "pair-lift"),
    "e2e pair-lift: the candidate with a measured positive pair is picked first, via a pair-lift term",
    `Got: ${e2eWith.picks.map((p) => p.item.itemId).join(", ")}`,
  );
}

console.log("\n17. Owned coverage and upgrade components (Work 2, PR 2c)");
{
  // Upgrade rules verified 2026-10-20 (data-verifier; deadlock.wiki/Items, /Shop,
  // live /v1/assets/items): buying an upgrade consumes its DIRECT owned
  // components, costs `cost − Σ consumed component cost`, and its own stats
  // REPLACE the component's (Arctic Blast TechResist 10 vs Cold Front 6, not 16).
  const spiritNeed = { ...zeroValues(), spiritDamage: 1 };
  const comp = mkCandidate("comp", 501, "spirit", 800, { spiritDamage: 10 });
  const upg = {
    ...mkCandidate("upg", 502, "spirit", 3200, { spiritDamage: 25 }),
    componentIds: ["comp"],
  };
  const other = mkCandidate("other", 503, "spirit", 3200, { spiritDamage: 12 });

  // a. No owned items => identical context to before (target spans maxItems).
  const plain = makeBasketContext({ needVector: spiritNeed, soulBudget: 5000, maxItems: 4 });
  const plainOwnedEmpty = makeBasketContext({
    needVector: spiritNeed,
    soulBudget: 5000,
    maxItems: 4,
    ownedCandidates: [],
  });
  assert(
    JSON.stringify(plain.target) === JSON.stringify(plainOwnedEmpty.target) &&
      plain.targetSlots === 4 &&
      plainOwnedEmpty.targetSlots === 4,
    "owned coverage: with nothing owned the target is unchanged (spans maxItems)",
  );

  // b. Owned items widen the target to the whole build (owned + free slots), so
  //    owned coverage and free slots are not both counted against a shrunk target.
  const ownedCtx = makeBasketContext({
    needVector: spiritNeed,
    soulBudget: 5000,
    maxItems: 3,
    ownedCandidates: [comp],
  });
  const sumT = (c: typeof plain) => SCORE_CATEGORIES.reduce((s, k) => s + c.target[k], 0);
  assert(
    ownedCtx.targetSlots === 4 && Math.abs(sumT(ownedCtx) - sumT(plain)) < 1e-9,
    "owned coverage: 1 owned + 3 free slots spans the same target as 4 free slots",
    `targetSlots ${ownedCtx.targetSlots}, sum ${sumT(ownedCtx)} vs ${sumT(plain)}`,
  );

  // c. Owned coverage is credited: a basket that owns spirit coverage starts there.
  const withOwned = constructBasket([other], ownedCtx);
  assert(
    Math.abs(withOwned.coverage.spiritDamage - (10 + 12)) < 1e-9,
    "owned coverage: result coverage includes owned items (10 owned + 12 picked)",
    `Got ${withOwned.coverage.spiritDamage}`,
  );

  // d. Effective cost: owning the component discounts the upgrade by its cost,
  //    so an upgrade whose nominal cost exceeds the budget is still affordable.
  const tightCtx = makeBasketContext({
    needVector: spiritNeed,
    soulBudget: 2500,
    maxItems: 3,
    ownedCandidates: [comp],
  });
  const upgBasket = constructBasket([upg], tightCtx);
  const upgPick = upgBasket.picks[0];
  assert(
    upgPick?.item.itemId === "upg" &&
      upgPick.effectiveCost === 2400 &&
      upgPick.consumes.join(",") === "comp" &&
      upgBasket.totalCost === 2400,
    "components: upgrading an owned component costs 3200 − 800 = 2400 and consumes it",
    `Got pick ${upgPick?.item.itemId}, effectiveCost ${upgPick?.effectiveCost}, consumes ${upgPick?.consumes.join(",")}, total ${upgBasket.totalCost}`,
  );

  // e. The upgrade's stats REPLACE the consumed component's: coverage 25, not 35.
  assert(
    Math.abs(upgBasket.coverage.spiritDamage - 25) < 1e-9,
    "components: consumed component's coverage is removed (upgrade 25 replaces component 10)",
    `Got ${upgBasket.coverage.spiritDamage}`,
  );
  const ownedState: BasketState = {
    picked: [],
    held: [comp],
    coverage: { ...zeroValues(), spiritDamage: 10 },
    soulsPerCategory: { gun: 0, spirit: 800, vitality: 0 },
    spent: 0,
  };
  const gain = coverageTerm.evaluate(upg, ownedState, tightCtx);
  const t = tightCtx.target.spiritDamage;
  const expectedGain = saturate(10 - 10 + 25, t) - saturate(10, t);
  assert(
    gain !== null && Math.abs(gain.value - expectedGain) < 1e-9,
    "components: coverage gain of an upgrade nets out the consumed component",
    `Got ${gain?.value}, expected ${expectedGain}`,
  );
  assert(
    effectiveCost(upg, [comp]).cost === 2400 && effectiveCost(upg, []).cost === 3200,
    "effectiveCost: 2400 with the component held, full 3200 without",
  );

  // f. A slot-neutral upgrade is allowed even with no free slots left.
  const fullCtx = makeBasketContext({
    needVector: spiritNeed,
    soulBudget: 5000,
    maxItems: 0,
    ownedCandidates: [comp],
  });
  const fullBasket = constructBasket([upg, other], fullCtx);
  assert(
    fullBasket.picks.map((p) => p.item.itemId).join(",") === "upg",
    "components: with 0 free slots an upgrade of an owned component still fits (frees its slot)",
    `Got ${fullBasket.picks.map((p) => p.item.itemId).join(",")} stop ${fullBasket.stopReason}`,
  );

  // g. H2: one basket never holds an item together with its own component, and
  //    never buys a component of something already held.
  const bothCtx = makeBasketContext({ needVector: spiritNeed, soulBudget: 10000, maxItems: 4 });
  const both = constructBasket([comp, upg], bothCtx).picks.map((p) => p.item.itemId);
  assert(
    !(both.includes("comp") && both.includes("upg")),
    "components: a basket never picks an item and its own component together",
    `Got ${both.join(",")}`,
  );
  const ownsUpg = makeBasketContext({
    needVector: spiritNeed,
    soulBudget: 10000,
    maxItems: 4,
    ownedCandidates: [upg],
  });
  assert(
    !constructBasket([comp, other], ownsUpg).picks.some((p) => p.item.itemId === "comp"),
    "components: never buys a component of an item already owned",
  );

  // h. Investment bonus counts souls already invested in owned items.
  const bonusState: BasketState = { ...ownedState, coverage: zeroValues() };
  const spiritCand = mkCandidate("spirit_4000", 504, "spirit", 4000, { spiritDamage: 5 });
  const bonusOwned = categoryBonusTerm.evaluate(spiritCand, bonusState, tightCtx);
  assert(
    bonusOwned !== null && bonusOwned.reason.includes("4,800"),
    "investment bonus: 800 owned + 4,000 crosses the 4,800 significant tier",
    `Got ${bonusOwned?.reason}`,
  );

  // i. Deterministic, and input order is never load-bearing.
  const extra = mkCandidate("extra", 505, "vitality", 800, { bonusHealth: 9 });
  const multiCtx = (owned: ItemCandidate[]) =>
    makeBasketContext({
      needVector: splitNeed,
      soulBudget: 9000,
      maxItems: 4,
      ownedCandidates: owned,
    });
  const fwd = constructBasket([upg, other, spiritCand], multiCtx([comp, extra]));
  const rev = constructBasket([spiritCand, other, upg], multiCtx([extra, comp]));
  assert(
    JSON.stringify(fwd) === JSON.stringify(rev),
    "owned coverage + components: same result when owned and candidate order is reversed",
  );

  // j. Stop reasons with owned items: after the slot-neutral upgrade the full
  //    build reports "slots", and a full build with no upgrade available does too.
  assert(
    fullBasket.stopReason === "slots",
    "stop reason: full build after a slot-neutral upgrade is 'slots'",
    `Got ${fullBasket.stopReason}`,
  );
  const fullNoUpgrade = constructBasket(
    [other],
    makeBasketContext({
      needVector: spiritNeed,
      soulBudget: 5000,
      maxItems: 0,
      ownedCandidates: [comp],
    }),
  );
  assert(
    fullNoUpgrade.picks.length === 0 && fullNoUpgrade.stopReason === "slots",
    "stop reason: full build with nothing slot-neutral is 'slots'",
    `Got ${fullNoUpgrade.stopReason}`,
  );

  // k. An upgrade worse than its component in one category: that category's
  //    coverage drops (counted in the total gain, never named in the reason).
  const compR = mkCandidate("comp_r", 506, "spirit", 800, { spiritDamage: 10, resist: 8 });
  const upgR = {
    ...mkCandidate("upg_r", 507, "spirit", 3200, { spiritDamage: 25 }),
    componentIds: ["comp_r"],
  };
  const rNeed = { ...zeroValues(), spiritDamage: 1, resist: 1 };
  const rCtx = makeBasketContext({
    needVector: rNeed,
    soulBudget: 5000,
    maxItems: 3,
    ownedCandidates: [compR],
  });
  const rState = initialBasketState(rCtx);
  const rGain = coverageTerm.evaluate(upgR, rState, rCtx);
  const tS = rCtx.target.spiritDamage;
  const tR = rCtx.target.resist;
  const expectedR = saturate(25, tS) - saturate(10, tS) + (saturate(0, tR) - saturate(8, tR));
  assert(
    rGain !== null &&
      Math.abs(rGain.value - expectedR) < 1e-9 &&
      !rGain.reason.toLowerCase().includes("resist"),
    "components: a category the upgrade drops counts negative in the gain and is not named",
    `Got ${rGain?.value} (${rGain?.reason}), expected ${expectedR}`,
  );

  // l. Invariant: coverage always equals the sum over what is held.
  const heldEnd = [comp, extra]
    .filter((h) => !fwd.picks.some((p) => p.consumes.includes(h.itemId)))
    .concat(fwd.picks.map((p) => p.item));
  const sumHeld = (cat: ScoreCategory) =>
    heldEnd.reduce((s, h) => s + Math.max(0, h.categoryValues[cat]), 0);
  assert(
    SCORE_CATEGORIES.every((cat) => Math.abs(fwd.coverage[cat] - sumHeld(cat)) < 1e-9),
    "invariant: result coverage equals the sum of category values over held items",
    `picks ${fwd.picks.map((p) => p.item.itemId).join(",")}`,
  );

  // m. Only DIRECT components are consumed (verified rule): owning A in A→B→C
  //    and buying C directly pays full price and keeps A.
  const gA = mkCandidate("g_a", 508, "spirit", 800, { spiritDamage: 5 });
  const gC = {
    ...mkCandidate("g_c", 510, "spirit", 6400, { spiritDamage: 40 }),
    componentIds: ["g_b"],
  };
  const gBasket = constructBasket(
    [gC],
    makeBasketContext({
      needVector: spiritNeed,
      soulBudget: 9000,
      maxItems: 3,
      ownedCandidates: [gA],
    }),
  );
  assert(
    gBasket.picks[0]?.item.itemId === "g_c" &&
      gBasket.picks[0].effectiveCost === 6400 &&
      gBasket.picks[0].consumes.length === 0,
    "components: a grand-component is not consumed (direct components only, full price)",
    `Got ${gBasket.picks[0]?.effectiveCost} consumes ${gBasket.picks[0]?.consumes.join(",")}`,
  );

  // n. The engine itself never re-suggests an owned item.
  assert(
    !constructBasket([comp, other], ownedCtx).picks.some((p) => p.item.itemId === "comp"),
    "owned items are never candidates, even if the caller passes them",
  );
}

console.log("\n18. Measured category split (need-vector PR)");
{
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const kit = {
    ...zeroValues(),
    gunDamage: 1.2,
    gunShred: 0.4,
    spiritDamage: 2,
    spiritShred: 0.7,
    bonusHealth: 0.6,
    resist: 1,
    shield: 0.4,
    antiHeal: 1,
    mobility: 1.1,
    sustain: 1,
    utility: 1,
    economy: 1,
  };
  const fam = (v: Readonly<Record<ScoreCategory, number>>, f: "gun" | "spirit" | "vitality") =>
    CATEGORY_FAMILIES[f].reduce((sum, c) => sum + v[c], 0);
  const combined = (v: Readonly<Record<ScoreCategory, number>>) =>
    fam(v, "gun") + fam(v, "spirit") + fam(v, "vitality");

  // a. No split => the kit vector, unchanged.
  assert(
    applyCategorySplit(kit, null) === kit,
    "applyCategorySplit: no split returns the kit vector",
  );

  // b. Families follow the split; total, within-family ratios and others kept.
  const split = { gun: 0.2, spirit: 0.5, vitality: 0.3 };
  const out = applyCategorySplit(kit, split);
  assert(
    near(combined(out), combined(kit)) &&
      near(fam(out, "gun") / combined(out), 0.2) &&
      near(fam(out, "spirit") / combined(out), 0.5) &&
      near(fam(out, "vitality") / combined(out), 0.3),
    "applyCategorySplit: family totals follow the split, combined total unchanged",
  );
  assert(
    near(out.bonusHealth / out.resist, kit.bonusHealth / kit.resist) &&
      near(out.gunShred / out.gunDamage, kit.gunShred / kit.gunDamage),
    "applyCategorySplit: within-family ratios (health vs resist, shred vs damage) kept",
  );
  assert(
    (["antiHeal", "mobility", "sustain", "utility", "economy"] as const).every(
      (c) => out[c] === kit[c],
    ),
    "applyCategorySplit: categories outside the three families are untouched",
  );

  // c. Floor: a near-zero family is lifted so it stays reachable.
  const floored = flooredShares({ gun: 0.006, spirit: 0.606, vitality: 0.388 });
  assert(
    floored !== null &&
      floored.gun >= MIN_FAMILY_SHARE * 0.9 &&
      near(floored.gun + floored.spirit + floored.vitality, 1),
    "flooredShares: a 0.6% family is lifted near MIN_FAMILY_SHARE and shares still sum to 1",
    `Got ${JSON.stringify(floored)}`,
  );

  // d. A family the kit gives nothing is spread evenly over its categories.
  const noVit = { ...kit, bonusHealth: 0, resist: 0, shield: 0 };
  const spread = applyCategorySplit(noVit, split);
  assert(
    spread.bonusHealth > 0 &&
      near(spread.bonusHealth, spread.resist) &&
      near(spread.resist, spread.shield),
    "applyCategorySplit: a zero kit family gets its share spread evenly",
  );

  // e. Lookup: missing, normalized, invalid.
  const tbl: CategorySplitTable = {
    version: 1,
    generated: "2026-10-21",
    window: { from: "2026-09-21", to: "2026-10-21" },
    method: {
      minAverageBadge: 80,
      minRankName: "Oracle",
      days: 30,
      minMatches: 2000,
      measure: "x",
    },
    heroes: {
      "1": { gun: 2, spirit: 6, vitality: 2, matches: 5000 },
      "2": { gun: Number.NaN, spirit: 1, vitality: 1, matches: 5000 },
    },
  };
  const one = heroCategorySplit(tbl, 1);
  assert(
    heroCategorySplit(tbl, 9) === null &&
      heroCategorySplit(tbl, 2) === null &&
      one !== null &&
      near(one.spirit, 0.6) &&
      one.scope === "Oracle+ players (last 30 days)",
    "heroCategorySplit: null when missing or invalid; normalized shares and scope otherwise",
    JSON.stringify(one),
  );

  // f. Committed table integrity (generic: the file is regenerated by a script).
  const committed = categorySplitTableJson as unknown as CategorySplitTable;
  const rows = Object.entries(committed.heroes);
  const badRows = rows.filter(
    ([, r]) =>
      ![r.gun, r.spirit, r.vitality].every((x) => x >= 0 && x <= 1) ||
      Math.abs(r.gun + r.spirit + r.vitality - 1) > 0.01 ||
      r.matches < committed.method.minMatches,
  );
  assert(
    committed.version === 1 && rows.length >= 30 && badRows.length === 0,
    "heroCategorySplit.json: v1, >= 30 heroes, shares in [0,1] summing to ~1, matches >= minMatches",
    `rows ${rows.length}, bad ${badRows.map(([id]) => id).join(",")}`,
  );

  // g. categorySplitTerm: inert without a split; relevance-gated; signed by direction.
  const dmgNeed = { ...zeroValues(), gunDamage: 1, spiritDamage: 1 };
  const gunItem = mkCandidate("g_item", 601, "gun", 3200, { gunDamage: 20 });
  const spiritItem = mkCandidate("s_item", 602, "spirit", 3200, { spiritDamage: 20 });
  const useless = mkCandidate("u_item", 603, "spirit", 3200, {});
  // An even third each: more gun moves away from a 20% gun target, spirit toward 50%.
  const evenThirds: BasketState = {
    picked: [],
    held: [],
    coverage: zeroValues(),
    soulsPerCategory: { gun: 3200, spirit: 3200, vitality: 3200 },
    spent: 0,
  };
  const noSplitCtx = makeBasketContext({ needVector: dmgNeed, soulBudget: 20000, maxItems: 4 });
  const splitCtx = makeBasketContext({
    needVector: dmgNeed,
    soulBudget: 20000,
    maxItems: 4,
    categorySplit: {
      gun: 0.2,
      spirit: 0.5,
      vitality: 0.3,
      scope: "Oracle+ players (last 30 days)",
    },
  });
  const sPos = categorySplitTerm.evaluate(spiritItem, evenThirds, splitCtx);
  const gNeg = categorySplitTerm.evaluate(gunItem, evenThirds, splitCtx);
  const scaleS =
    SCORE_CATEGORIES.reduce((sum, c) => sum + splitCtx.target[c], 0) / splitCtx.targetSlots;
  assert(
    categorySplitTerm.evaluate(spiritItem, evenThirds, noSplitCtx) === null &&
      categorySplitTerm.evaluate(useless, evenThirds, splitCtx) === null,
    "categorySplitTerm: inert without a split, and never rewards an item that covers nothing",
  );
  assert(
    sPos !== null &&
      sPos.value > 0 &&
      sPos.reason.includes("Oracle+ players (last 30 days)") &&
      gNeg !== null &&
      gNeg.value < 0 &&
      Math.abs(sPos.value) <= CATEGORY_SPLIT_MAX_FRACTION * scaleS + 1e-9,
    "categorySplitTerm: positive toward the measured split, negative away, bounded by the max fraction",
    `spirit ${sPos?.value} (${sPos?.reason}), gun ${gNeg?.value}`,
  );
  assert(
    DEFAULT_BASKET_TERMS.includes(categorySplitTerm),
    "categorySplitTerm is registered in DEFAULT_BASKET_TERMS",
  );

  // h. Bad input is "no split", never a zero (rule: missing data is not zero).
  const nanSplit = { gun: Number.NaN, spirit: 0.5, vitality: 0.5 };
  assert(
    flooredShares(nanSplit) === null && applyCategorySplit(kit, nanSplit) === kit,
    "flooredShares / applyCategorySplit: a NaN share means no split (kit vector unchanged)",
  );

  // i. Accuracy: the split is measured at Oracle+, so lower accuracy at the
  //    player's rank lowers the gun share (and only it), renormalized.
  const base = { gun: 0.3, spirit: 0.4, vitality: 0.3 };
  const lowAcc = adjustSplitForAccuracy(base, 0.8);
  assert(
    lowAcc.gun < base.gun &&
      lowAcc.spirit > base.spirit &&
      near(lowAcc.spirit / lowAcc.vitality, base.spirit / base.vitality) &&
      near(lowAcc.gun + lowAcc.spirit + lowAcc.vitality, 1),
    "adjustSplitForAccuracy: ratio < 1 lowers only the gun share, others keep their ratio",
    JSON.stringify(lowAcc),
  );
  assert(
    adjustSplitForAccuracy(base, Number.NaN) === base &&
      near(
        adjustSplitForAccuracy(base, 100).gun,
        adjustSplitForAccuracy(base, MAX_ACCURACY_RATIO).gun,
      ),
    "adjustSplitForAccuracy: unknown ratio leaves the split, extreme ratios are clamped",
  );

  // j. Empty build: the target-shaped prior makes every first pick neutral
  //    (audit finding: no fixed, cost-blind bonus or penalty).
  const emptyState = initialBasketState(splitCtx);
  const big = mkCandidate("s_big", 604, "spirit", 6400, { spiritDamage: 20 });
  const bigGun = mkCandidate("g_big", 605, "gun", 6400, { gunDamage: 20 });
  assert(
    categorySplitTerm.evaluate(big, emptyState, splitCtx) === null &&
      categorySplitTerm.evaluate(bigGun, emptyState, splitCtx) === null,
    "categorySplitTerm: on an empty build the first pick is neutral (no term)",
  );

  // k. Owned items count: a build already heavy in spirit makes more spirit a
  //    move away, and gun a move toward, for a 30/40/30 hero.
  const ownedSpirit = mkCandidate("o_sp", 606, "spirit", 6400, { spiritDamage: 30 });
  const ownedCtx2 = makeBasketContext({
    needVector: dmgNeed,
    soulBudget: 20000,
    maxItems: 4,
    ownedCandidates: [ownedSpirit],
    categorySplit: { ...base, scope: "Oracle+ players (last 30 days)" },
  });
  const ownedState2 = initialBasketState(ownedCtx2);
  const moreSpirit = categorySplitTerm.evaluate(spiritItem, ownedState2, ownedCtx2);
  const someGun = categorySplitTerm.evaluate(gunItem, ownedState2, ownedCtx2);
  const moreGun = categorySplitTerm.evaluate(bigGun, ownedState2, ownedCtx2);
  assert(
    moreGun !== null && someGun !== null && moreGun.value > someGun.value,
    "categorySplitTerm: the effect grows with the souls a purchase moves (6400 gun > 3200 gun)",
    `6400 ${moreGun?.value}, 3200 ${someGun?.value}`,
  );
  assert(
    moreSpirit !== null && moreSpirit.value < 0 && someGun !== null && someGun.value > 0,
    "categorySplitTerm: owned items seed the split (spirit-heavy build: spirit away, gun toward)",
    `spirit ${moreSpirit?.value}, gun ${someGun?.value}`,
  );

  // l. The reason quotes the RAW measured share, not the floored one.
  const rawCtx = makeBasketContext({
    needVector: dmgNeed,
    soulBudget: 20000,
    maxItems: 4,
    categorySplit: {
      gun: 0.006,
      spirit: 0.606,
      vitality: 0.388,
      scope: "Oracle+ players (last 30 days)",
    },
  });
  const rawGun = categorySplitTerm.evaluate(gunItem, evenThirds, rawCtx);
  assert(
    rawCtx.categorySplit?.gun === 0.006 &&
      rawGun !== null &&
      rawGun.reason.includes("(1% gun)") &&
      rawGun.reason.startsWith("Moves your build further from"),
    "categorySplitTerm: reason quotes the raw share (0.6% -> 1%), worded as a move",
    rawGun?.reason,
  );

  // m. Committed table metadata is consistent.
  const days = (Date.parse(committed.window.to) - Date.parse(committed.window.from)) / 86_400_000;
  assert(
    days === committed.method.days &&
      committed.generated === committed.window.to &&
      committed.method.minRankName.length > 0 &&
      Math.floor(committed.method.minAverageBadge / 10) >= 1,
    "heroCategorySplit.json: window spans method.days, generated = window.to, rank fields set",
    `days ${days}, generated ${committed.generated}`,
  );
}

console.log("\n19. Ranking by value per binding resource (coverage-model PR 1)");
{
  // a. rankingPrice: per soul when souls are tight, a slot's share when slots bind.
  assert(
    rankingPrice(1600, 5900, 12) === 1600 &&
      rankingPrice(800, 24000, 6) === 4000 &&
      rankingPrice(6400, 24000, 6) === 6400 &&
      rankingPrice(0, 0, 0) === 1,
    "rankingPrice: max(effective cost, souls per free slot), never below 1",
  );

  // b. Tight souls: an efficient cheap item beats a pricier all-rounder that
  //    only has more total value (the old raw-value ranking picked the latter).
  const need = { ...zeroValues(), gunDamage: 1, spiritDamage: 1, sustain: 1 };
  const cheap = mkCandidate("cheap_eff", 701, "gun", 800, { gunDamage: 30 });
  const allRounder = mkCandidate("big_round", 702, "gun", 3200, {
    gunDamage: 30,
    spiritDamage: 25,
    sustain: 25,
  });
  const tight = makeBasketContext({ needVector: need, soulBudget: 3200, maxItems: 12 });
  const tightPick = constructBasket([cheap, allRounder], tight).picks[0]?.item.itemId;
  assert(
    tightPick === "cheap_eff",
    "ranking: with tight souls, value per soul wins (800 item at 30 beats 3200 item at 80)",
    `Got ${tightPick}`,
  );

  // c. Slots binding: plenty of souls per free slot, so the high-value item wins.
  const roomy = makeBasketContext({ needVector: need, soulBudget: 30000, maxItems: 2 });
  const roomyPick = constructBasket([cheap, allRounder], roomy).picks[0]?.item.itemId;
  assert(
    roomyPick === "big_round",
    "ranking: when slots bind (souls per slot above both prices), value per slot wins",
    `Got ${roomyPick}`,
  );

  // d. The stop rule still uses raw value: nothing worthless is bought just
  //    because it is cheap.
  const worthless = mkCandidate("worthless", 703, "gun", 100, {});
  const onlyWorthless = constructBasket([worthless], tight);
  assert(
    onlyWorthless.picks.length === 0 && onlyWorthless.stopReason === "no-positive-value",
    "ranking: a cheap item with no value is never picked",
    `Got ${onlyWorthless.picks.length} picks, ${onlyWorthless.stopReason}`,
  );

  // e. Deterministic and order-independent.
  assert(
    JSON.stringify(constructBasket([cheap, allRounder, worthless], tight)) ===
      JSON.stringify(constructBasket([worthless, allRounder, cheap], tight)),
    "ranking: same result whatever the candidate order",
  );
}

console.log("\n20. Phase-aware split and measured stat profile (coverage-model PR 2)");
{
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

  // a. Phase from souls: 10 and 20 minute marks on the net-worth curve.
  assert(
    phaseForSouls(5900) === "early" &&
      phaseForSouls(EARLY_PHASE_MAX_SOULS) === "early" &&
      phaseForSouls(16700) === "mid" &&
      phaseForSouls(MID_PHASE_MAX_SOULS + 1) === "late",
    "phaseForSouls: starter checkpoints 5,900 / 16,700 / 30,000 fall in early / mid / late",
  );

  // b. applyStatProfile: profile categories take the profile's share, total kept,
  //    the rest keep their ratios; no profile => unchanged.
  const need = {
    ...zeroValues(),
    gunDamage: 2,
    spiritDamage: 1,
    bonusHealth: 1,
    antiHeal: 1,
    sustain: 1,
    utility: 1,
    economy: 1,
    mobility: 1,
  };
  const profile = {
    ...zeroValues(),
    gunDamage: 0.5,
    sustain: 0.2,
    economy: 0.1,
    mobility: 0.05,
    antiHeal: 0.05,
    utility: 0.1,
  };
  const out = applyStatProfile(need, profile);
  const sum = (v: Readonly<Record<ScoreCategory, number>>) =>
    SCORE_CATEGORIES.reduce((s, c) => s + v[c], 0);
  const profileTotal = (v: Readonly<Record<ScoreCategory, number>>) =>
    PROFILE_CATEGORIES.reduce((s, c) => s + v[c], 0);
  assert(
    applyStatProfile(need, null) === need &&
      near(sum(out), sum(need)) &&
      near(profileTotal(out) / sum(out), 0.5) &&
      near(out.sustain / out.economy, 2) &&
      near(out.gunDamage / out.spiritDamage, 2),
    "applyStatProfile: profile categories get the measured share and mix; total and the rest's ratios kept",
    JSON.stringify(out),
  );

  // c. A profile category the players never cover still gets the floor.
  const noAntiHeal = { ...profile, antiHeal: 0 };
  const floored = applyStatProfile(need, noAntiHeal);
  assert(
    floored.antiHeal > 0,
    "applyStatProfile: a profile category with 0 share is floored above zero",
  );

  // d. phaseView: early/mid use the purchase splits, late the final split; no
  //    phase data => the whole-game split and no profile.
  const base: HeroCategorySplit = {
    gun: 0.2,
    spirit: 0.5,
    vitality: 0.3,
    matches: 5000,
    scope: "Oracle+ players (last 30 days)",
    rankTier: 8,
  };
  const withPhases: HeroCategorySplit = {
    ...base,
    phases: {
      early: { gun: 0.6, spirit: 0.2, vitality: 0.2 },
      mid: { gun: 0.3, spirit: 0.4, vitality: 0.3 },
      profile: { early: profile, mid: profile, late: profile },
    },
  };
  assert(
    phaseView(withPhases, "early").shares.gun === 0.6 &&
      phaseView(withPhases, "mid").shares.gun === 0.3 &&
      phaseView(withPhases, "late").shares.gun === 0.2 &&
      phaseView(base, "early").profile === null &&
      phaseView(base, "early").shares.gun === 0.2,
    "phaseView: per-phase split and profile when present; whole-game split otherwise",
  );

  // e. The term's reason names what the shares measure: early / mid purchases
  //    are not what players end games with (audit, 2026-10-20).
  assert(
    phaseView(withPhases, "early").basis === "buy in the first 10 minutes" &&
      phaseView(withPhases, "mid").basis === "buy from minute 10 to 20" &&
      phaseView(withPhases, "late").basis === "end games with" &&
      phaseView(base, "early").basis === "end games with",
    "phaseView: basis matches the shares (phase purchases vs final inventory)",
  );

  // f. No family need to rescale: the need comes back unchanged, total kept.
  const familyless = { ...zeroValues(), sustain: 1, economy: 1 };
  assert(
    applyStatProfile(familyless, profile) === familyless,
    "applyStatProfile: with no family need the need is returned as is",
  );
}

console.log("\n21. One value scale (hero-relative damage and fight value)");
{
  const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
  const gun = { perShot: 10, shotsPerSecond: 5, clip: 20, reload: 2, overhead: 0 };

  // a. Sustained gun DPS: per shot x clip / (clip / shots-per-second + reload).
  const base = sustainedGunDps(gun, {});
  assert(
    near(base, (10 * 20) / (20 / 5 + 2)),
    "sustainedGunDps: per shot x clip / (time to empty + reload)",
    `Got ${base}`,
  );

  // b. Each gun stat moves sustained DPS the way the mechanics say: damage % on
  //    every shot; fire rate only while firing; a bigger clip defers reloads;
  //    reload time is a signed % (negative = faster, verified live).
  const dmg = sustainedGunDps(gun, { damagePercent: 10 });
  const fire = sustainedGunDps(gun, { fireRatePercent: 10 });
  const clip = sustainedGunDps(gun, { clipPercent: 50 });
  const fasterReload = sustainedGunDps(gun, { reloadTimePercent: -35 });
  const slowerReload = sustainedGunDps(gun, { reloadTimePercent: 20 });
  assert(
    near(dmg / base, 1.1) &&
      fire / base > 1 &&
      fire / base < 1.1 &&
      clip > base &&
      fasterReload > base &&
      slowerReload < base,
    "sustainedGunDps: +10% damage = +10%; fire rate < +10% (reload untouched); clip and faster reload help; slower reload hurts",
    `dmg ${dmg / base}, fire ${fire / base}, clip ${clip / base}, reload-35 ${fasterReload / base}`,
  );

  // c. Casts per trade: short cooldowns cap at MAX_CASTS_PER_TRADE (also a
  //    resource-gated 0.6 s "cooldown" like Card Trick); long ones count once,
  //    weighted by the share of trades they are ready for; none = one cast.
  assert(
    castsPerTrade(0.6) === MAX_CASTS_PER_TRADE &&
      castsPerTrade(2.5) === MAX_CASTS_PER_TRADE &&
      near(castsPerTrade(8), TRADE_SECONDS / 8) &&
      castsPerTrade(20) === 1 &&
      near(castsPerTrade(200), TRADE_GAP_SECONDS / 200) &&
      castsPerTrade(0) === 1,
    "castsPerTrade: short cooldowns capped, long ones weighted by readiness",
    `0.6s ${castsPerTrade(0.6)}, 8s ${castsPerTrade(8)}, 200s ${castsPerTrade(200)}`,
  );

  // d. Ability DPS over a trade: (base + coefficient x SP) x casts per trade /
  //    trade; damage-free or cooldown-free abilities contribute nothing.
  const abilities = [
    { baseDamage: 100, spiritScaling: 1, cooldown: 10 },
    { baseDamage: 50, spiritScaling: 0.5, cooldown: 5 },
    { baseDamage: null, spiritScaling: 1, cooldown: 10 },
    { baseDamage: 80, spiritScaling: 1, cooldown: null },
  ];
  assert(
    near(
      abilityDps(abilities, 20),
      ((100 + 20) * castsPerTrade(10) + (50 + 10) * castsPerTrade(5)) / TRADE_SECONDS,
    ),
    "abilityDps: per-cast damage x casts per trade / trade, over damaging abilities",
    `Got ${abilityDps(abilities, 20)}`,
  );

  // e. Hero-relative: the SAME fire-rate item is worth more to a gun-reliant
  //    hero, spirit power more to an ability-reliant one (% of trade DPS).
  const gunHero: HeroDamageModel = {
    gun: { ...gun, perShot: 20 },
    accuracy: 0.5,
    abilities: [{ baseDamage: 40, spiritScaling: 0.5, cooldown: 20 }],
    spiritPower: 10,
  };
  const casterHero: HeroDamageModel = {
    gun: { ...gun, perShot: 4 },
    accuracy: 0.5,
    abilities: [
      { baseDamage: 150, spiritScaling: 1.5, cooldown: 8 },
      { baseDamage: 120, spiritScaling: 1.2, cooldown: 10 },
    ],
    spiritPower: 10,
  };
  const gunOnGunHero = damageValues({ BonusFireRate: 9 }, gunHero).gunDamage;
  const gunOnCaster = damageValues({ BonusFireRate: 9 }, casterHero).gunDamage;
  const spiritOnGunHero = damageValues({ TechPower: 10 }, gunHero).spiritDamage;
  const spiritOnCaster = damageValues({ TechPower: 10 }, casterHero).spiritDamage;
  assert(
    gunOnGunHero > gunOnCaster * 2 && spiritOnCaster > spiritOnGunHero * 2,
    "damageValues: fire rate is worth far more to the gun hero, spirit power to the caster",
    `fire rate ${gunOnGunHero.toFixed(2)} vs ${gunOnCaster.toFixed(2)}; spirit ${spiritOnCaster.toFixed(2)} vs ${spiritOnGunHero.toFixed(2)}`,
  );

  // f. Units, and the WeaponPower sentinel: +10% weapon damage on an all-gun
  //    hero is exactly 10; WeaponPower (0 on every item) is never read.
  const allGun: HeroDamageModel = { gun, accuracy: 1, abilities: [], spiritPower: 0 };
  assert(
    near(damageValues({ BaseAttackDamagePercent: 10 }, allGun).gunDamage, 10) &&
      damageValues({ WeaponPower: 50 }, allGun).gunDamage === 0,
    "damageValues: +10% weapon damage on an all-gun hero = 10; WeaponPower contributes nothing",
  );

  // g. A stat on an item with a cooldown or a timed effect is that effect's buff
  //    (Kinetic Dash, Active Reload) unless the API lists it as INNATE (Burst
  //    Fire's +10% fire rate is innate; its on-hit burst is not).
  const permanent = damageValues({ BonusFireRate: 20 }, allGun).gunDamage;
  const onCooldown = damageValues({ BonusFireRate: 20, AbilityCooldown: 12 }, allGun).gunDamage;
  const onTimer = damageValues({ BonusFireRate: 20, AbilityDuration: 7 }, allGun).gunDamage;
  const innate = damageValues(
    { BonusFireRate: 20, AbilityCooldown: 12 },
    allGun,
    new Set(["BonusFireRate"]),
  ).gunDamage;
  assert(
    onCooldown > 0 &&
      onCooldown < permanent * 0.6 &&
      near(onTimer, onCooldown) &&
      near(innate, permanent),
    "damageValues: a timed stat is discounted, an innate one on the same item is not",
    `permanent ${permanent}, cooldown ${onCooldown}, timer ${onTimer}, innate ${innate}`,
  );

  // h. A headshot bonus on a cooldown is FLAT damage once per cooldown
  //    (Headshot Booster: 45 on the next headshot, 9 s), not +45% weapon damage.
  const headshot = damageValues({ HeadShotBonusDamage: 45, AbilityCooldown: 9 }, allGun).gunDamage;
  const flatDps = (45 * castsPerTrade(9) * HEADSHOT_IN_TRADE) / TRADE_SECONDS;
  assert(
    near(headshot, (flatDps / base) * 100) && headshot < CONDITIONAL_DAMAGE_WEIGHT * 45,
    "damageValues: a cooldown headshot bonus is flat damage per cooldown, not a weapon %",
    `Got ${headshot}, flat ${(flatDps / base) * 100}`,
  );

  // i. Fight value: +1% effective HP is worth +1% DPS. Health is % of max HP;
  //    resist is % more effective HP against the incoming mix; a resist on an
  //    item with a cooldown is conditional unless innate.
  const fm = { maxHealth: 1000, moveSpeed: 7, gunDps: 30, abilityDps: 10 };
  const resist = fightValues({ BulletResist: 20 }, fm).resist ?? 0;
  const resistActive = fightValues({ BulletResist: 20, AbilityCooldown: 10 }, fm).resist ?? 0;
  const resistInnate =
    fightValues({ BulletResist: 20, AbilityCooldown: 10 }, fm, new Set(["BulletResist"])).resist ??
    0;
  assert(
    near(fightValues({ BonusHealth: 100 }, fm).bonusHealth ?? 0, 10) &&
      near(resist, (1 / (0.5 * 0.8 + 0.5) - 1) * 100) &&
      resistActive < resist &&
      near(resistInnate, resist),
    "fightValues: +100 HP on 1000 = 10; 20% bullet resist = +11.1% effective HP; timed resist discounted",
    `resist ${resist}, active ${resistActive}, innate ${resistInnate}`,
  );

  // j. OutgoingDamagePenaltyPercent: the buyer's own drawback (Golden Goose Egg,
  //    Cursed Relic: no DebuffDuration) is NEGATIVE damage value; on an enemy
  //    debuff (Inhibitor, Haunting Shot: DebuffDuration) it is positive utility.
  const selfStats = { OutgoingDamagePenaltyPercent: -15 };
  const self = estimateEffectValues(selfStats);
  const enemyStats = { OutgoingDamagePenaltyPercent: -30, DebuffDuration: 5 };
  const enemy = estimateEffectValues(enemyStats);
  assert(
    self.length === 2 &&
      self.every(
        (e) =>
          e.value < 0 &&
          e.unit === "selfDamageCutPercent" &&
          (estimateFightValue(e, selfStats, fm) ?? 0) < 0,
      ) &&
      enemy.length === 1 &&
      enemy[0].category === "utility" &&
      (estimateFightValue(enemy[0], enemyStats, fm) ?? 0) > 0,
    "outgoing damage penalty: own drawback is negative damage, an enemy debuff is positive utility",
    JSON.stringify({ self, enemy }),
  );

  // k. "Your next melee attack heals you": once per cooldown, not every hit.
  const meleeStats = { LifestrikeHeal: 100, AbilityCooldown: 8 };
  const melee = estimateEffectValues(meleeStats).find((e) => e.unit === "healPerMeleeHit");
  const meleeNoCd = estimateEffectValues({ LifestrikeHeal: 100 }).find(
    (e) => e.unit === "healPerMeleeHit",
  );
  const withCd = melee ? (estimateFightValue(melee, meleeStats, fm) ?? 0) : 0;
  const noCd = meleeNoCd ? (estimateFightValue(meleeNoCd, { LifestrikeHeal: 100 }, fm) ?? 0) : 0;
  assert(
    withCd > 0 && withCd < noCd,
    "melee heal: a cooldown-gated heal counts once per cooldown, below an every-hit heal",
    `cooldown ${withCd}, every hit ${noCd}`,
  );

  // l. Every non-damage estimate carries a unit and quantity, and converts.
  //    (Shred converts through shredValue; damage units through estimateDps.)
  const bag = {
    TotalHealthRegen: 300,
    LifestrikeHeal: 100,
    SlowPercent: 20,
    SlowDuration: 2,
    TechPowerReduction: -10,
    HealAmpReceivePenaltyPercent: -35,
    RicochetDamagePercent: 40,
    SilenceDuration: 2,
    StunDuration: 1,
    MovementSpeedSlow: 30,
    FireRateSlow: 20,
    GroundDashReductionPercent: -30,
    OutgoingDamagePenaltyPercent: -20,
    MaxStacks: 10,
    HealPerStack: 5,
    StackingBonusSprintSpeed: 0.1,
    StackingTechRangeMultiplier: 2,
    StackingBonusHealth: 10,
    StackingGoldPerMinute: 18,
    BonusSoulsPct: 100,
    BonusGoldPerMinute: 80,
    HealthDrainedPerSecond: 50,
    ImbuedCooldownMultiplier: 1,
    AbilityDuration: 5,
    AbilityCooldown: 20,
  };
  const damageUnits = new Set([
    "damage",
    "weaponPercent",
    "maxHealthPercentPerSecond",
    "dps",
    "spiritPercent",
  ]);
  const unconverted = estimateEffectValues(bag).filter(
    (e) =>
      !(e.unit && damageUnits.has(e.unit)) &&
      e.category !== "gunShred" &&
      e.category !== "spiritShred" &&
      estimateFightValue(e, bag, fm) === null,
  );
  assert(
    unconverted.length === 0,
    "every non-damage effect estimate converts to fight value",
    unconverted.map((e) => e.basis).join("; "),
  );

  // m. Innate stats come from the API's innate tooltip section; a section with
  //    no section_type (common in the live data) is NOT innate.
  const burst = normalizeItem({
    id: 1,
    class_name: "upgrade_burst_fire",
    name: "Burst Fire",
    type: "upgrade",
    item_slot_type: "weapon",
    item_tier: 3,
    cost: 3200,
    properties: { BonusFireRate: { value: "10" }, ActivatedFireRate: { value: "32" } },
    tooltip_sections: [
      { section_type: "innate", section_attributes: [{ elevated_properties: ["BonusFireRate"] }] },
      { section_attributes: [{ important_properties: ["ActivatedFireRate"] }] },
    ],
  });
  assert(
    JSON.stringify(burst.innateStats) === JSON.stringify(["BonusFireRate"]),
    "normalizeItem: innateStats lists the innate section only",
    JSON.stringify(burst.innateStats),
  );

  // n. Coverage saturates smoothly: U(0) = 0, increasing, concave, below T.
  assert(
    saturate(0, 10) === 0 &&
      saturate(5, 0) === 0 &&
      saturate(10, 10) - saturate(0, 10) > saturate(20, 10) - saturate(10, 10) &&
      saturate(20, 10) > saturate(10, 10) &&
      saturate(1e6, 10) <= 10,
    "saturate: 0 at 0, increasing and concave, never above the target",
  );

  // o. Missing data is not zero (audit 2026-10-24): unknown health gives no
  //    survival model (non-damage stats keep the heuristic, not 0), and a kit
  //    with no parsable damaging ability gives no hero model at all.
  const heroBase = mkHero(90, 800, 7);
  const kit: HeroAbility[] = [{ ...mkAbility(1, null), cooldown: 10 }];
  const modelFor = (base: HeroBaseStats, abilities: HeroAbility[]) =>
    deriveHeroDamageModel({
      baseStats: base,
      abilities,
      boonLevel: 0,
      spiritPower: 0,
      accuracy: 1,
    });
  const known = modelFor(heroBase, kit);
  const noHealth = modelFor({ ...heroBase, maxHealth: 0, maxHealthPerBoon: 0 }, kit);
  const noKit = modelFor(heroBase, [{ ...mkAbility(1, null), baseDamage: null, cooldown: 10 }]);
  const healthItem: Item = {
    id: "hp",
    numericId: 1,
    name: "hp",
    category: "vitality",
    tier: 1,
    cost: 800,
    tags: [],
    stats: { BonusHealth: 200 },
    statScaling: {},
  };
  assert(
    known?.survival?.maxHealth === 800 &&
      noHealth !== undefined &&
      noHealth.survival === undefined &&
      toItemCandidate(healthItem, { heroDamage: noHealth }).categoryValues.bonusHealth > 0 &&
      noKit === undefined,
    "deriveHeroDamageModel: unknown health = no survival model (heuristic kept); no damaging ability = no model",
    JSON.stringify({ survival: known?.survival, noHealth: noHealth?.survival, noKit }),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);

// ---------------------------------------------
// Verbose dump for the first test case (burst)
// ---------------------------------------------
console.log("\n--- Verbose output: pure burst ---");
const verboseOutput: EngineOutput = recommendItems(testCases[0].input, candidates, [
  baseCategoryStage,
  intentWeightStage,
]);
console.log(JSON.stringify(verboseOutput, null, 2));

if (failed > 0) {
  process.exit(1);
}
