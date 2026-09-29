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
import { analyticsTerm, constructBasket, makeBasketContext } from "../basketSelect";
import { estimateEffectValues } from "../effectEstimator";
import { recommendItems } from "../engine";
import { deriveHeroNeedVector } from "../heroNeed";
import { toItemCandidate } from "../itemAdapter";
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
  });
  assert(
    proc.categoryValues.gunDamage > 0,
    "an item whose only value is a proc effect scores above zero",
    `Got: ${proc.categoryValues.gunDamage}`,
  );

  // Expected value, then halved by EFFECT_CONFIDENCE: 33 x 4 x 0.15 = 19.8 -> 9.9.
  assert(
    Math.abs(proc.categoryValues.gunDamage - 9.9) < 0.001,
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

    // A hero with NO accuracy data (verified live: Graves records zero shots)
    // must not be left undiscounted while every peer is discounted — that would
    // inflate them into looking like the best gun in the roster.
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
      "a hero with no accuracy data falls back to median, never to an undiscounted advantage",
      `unknown=${withUnknown.gunDamage}, marksman=${marksmanNeed.gunDamage}`,
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
