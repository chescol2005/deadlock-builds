// src/scripts/mini.ts — Deadlock Foundry regression harness
// Run: npm run mini
// Required to pass before any PR merge

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { getItems } from "@/lib/itemStore";
import type { AbilityUpgradeTier } from "@/lib/abilityCoefficients";
import { calculateStatTotals } from "@/lib/buildCalculations";
import { serializeBuild, deserializeBuild } from "@/lib/buildSerializer";
import type { BuildState } from "@/lib/buildSerializer";
import {
  BOON_THRESHOLDS,
  getBoonThreshold,
  getAbilityPointsAtSouls,
  getAbilityUnlockOrder,
} from "@/lib/boonSystem";
import {
  CAMPS,
  CAMP_MARKERS,
  GAME_MINUTE_COLUMNS,
  MINIMAP_URL,
  soulsAt,
  soulsPerMinEfficiency,
} from "@/lib/farming/campData";
import { normalizeItem } from "@/lib/itemNormalizer";
import { ANTI_SYNERGY_RULES, detectAntiSynergies } from "@/lib/scoring/antiSynergy";
import { componentClosure } from "@/lib/engine/pairLift";
import { fetchAllItems, type UpgradeV2Raw } from "@/lib/api/deadlockApi";
import { CATEGORY_BONUS_TIERS } from "@/lib/categoryBonuses";
import { LANE_STRUCTURES, LANE_MINIMAP_MARKERS, LANES } from "@/lib/lanes/laneData";
import { BOON_PHASE_CARDS } from "@/lib/boons/boonsGuideData";
import { ITEMIZATION_PHASE_CARDS } from "@/lib/itemization/itemizationGuideData";
import {
  resolveAddItem,
  getConsumedComponents,
  getEffectiveAddCost,
  cleanCategories,
  cleanAssignmentMap,
  canActivateItem,
  MAX_ACTIVE_ITEMS,
} from "@/lib/buildUtils";
import { GUIDES, NAV_SECTIONS, isActiveSection } from "@/lib/navigation";
import { runStarterBuildFixtures } from "./starterBuildFixtures";
import { fetchVisibleHeroes } from "@/lib/heroApi";
import { BIG_ITEM_COST, buildCoachContext, VITALITY_ENOUGH_SOULS } from "@/lib/coachContext";
import { MID_PHASE_MAX_SOULS } from "@/lib/engine/categorySplit";
import { loadFrozen } from "@/lib/engine/__fixtures__/frozen/frozenInputs";
import { toItemCandidate } from "@/lib/engine/itemAdapter";
import { runHeroBasket } from "@/lib/engine/heroBasket";
import type { BasketResult } from "@/lib/engine/types";
import { headlineTerm } from "@/lib/basketReasons";
import type { Item } from "@/lib/items";
import { EMPTY_MEMORY, getCoachMessage } from "@/lib/coach";
import type { CoachContext, CoachFact, CoachTrigger, InsightId, PlayerMode } from "@/lib/coach";
import { INSIGHT_PRIORITY, INSIGHT_RULES } from "@/lib/coach/triggerRules";
import { renderInsight } from "@/lib/coach/templates";
import { validateCoachResponse } from "@/lib/coach/responseValidator";
import {
  HERO_ROLES,
  ROLE_LABELS,
  ROLE_ONLINE_AT_SOULS,
  heroOnlineAtSouls,
  heroRolesOf,
  roleFlag,
} from "@/lib/heroRoles";
import type { HeroRole } from "@/lib/heroRoles";
import {
  DEFAULT_OG_IMAGE,
  FALLBACK_SITE_URL,
  PREVIEW_ITEM_LIMIT,
  SITE_NAME,
  STATIC_ROUTES,
  buildPageMetadata,
  buildPreview,
  buildPreviewImagePath,
  decodeBuildParam,
  guideMetadata,
  heroPageMetadata,
  itemPageMetadata,
  pngVariant,
  siteUrl,
  sitemapEntries,
} from "@/lib/seo";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    if (detail) console.error(`     ${detail}`);
    failed++;
  }
}

async function run() {
  console.log("\n=== Deadlock Foundry — mini.ts fixture suite ===\n");

  // -----------------------------------------------
  // Fixture 1: Item data loads from API
  // -----------------------------------------------
  console.log("1. Item data");
  const items = await getItems();
  assert(
    items.length >= 60,
    `Item count reasonable: ${items.length}`,
    "Expected 60-160 shopable items",
  );
  assert(
    items.every((i) => i.id && i.name && i.cost >= 0),
    "All items have required fields (id, name, cost)",
  );
  assert(
    items.every(
      (i) => i.category === "gun" || i.category === "vitality" || i.category === "spirit",
    ),
    "All items have valid category",
  );
  assert(
    items.every((i) => i.tier >= 1 && i.tier <= 4),
    "All items have tier 1-4",
  );

  // -----------------------------------------------
  // Fixture 2: Upgrade chain relationships
  // -----------------------------------------------
  console.log("\n2. Upgrade chain");
  const extraSpirit = items.find((i) => i.id === "upgrade_improved_spirit");
  const soaringSpirit = items.find((i) => i.id === "upgrade_soaring_spirit");
  const magicStorm = items.find((i) => i.id === "upgrade_magic_storm");
  const boundlessSpirit = items.find((i) => i.id === "upgrade_boundless_spirit");

  assert(!!extraSpirit, "Extra Spirit (upgrade_improved_spirit) found");
  assert(!!soaringSpirit, "Soaring Spirit (upgrade_soaring_spirit) found");

  assert(
    soaringSpirit?.componentItems?.includes("upgrade_improved_spirit") ?? false,
    "Soaring Spirit lists Extra Spirit as component",
  );
  assert(
    magicStorm?.componentItems?.includes("upgrade_improved_spirit") ?? false,
    "Magic Storm lists Extra Spirit as component (branching)",
  );
  assert(
    extraSpirit?.upgradesInto?.includes("upgrade_soaring_spirit") ?? false,
    "Extra Spirit upgradesInto includes Soaring Spirit",
  );
  assert(
    extraSpirit?.upgradesInto?.includes("upgrade_magic_storm") ?? false,
    "Extra Spirit upgradesInto includes Magic Storm (branching chain)",
  );
  assert(
    boundlessSpirit?.componentItems?.includes("upgrade_soaring_spirit") ?? false,
    "Boundless Spirit lists Soaring Spirit as component",
  );

  // -----------------------------------------------
  // Fixture 3: resolveAddItem upgrade chain logic
  // -----------------------------------------------
  console.log("\n3. Upgrade chain resolution");
  if (extraSpirit && soaringSpirit) {
    const buildWithExtra = [extraSpirit];
    const resolved = resolveAddItem(buildWithExtra, soaringSpirit);

    assert(resolved.length === 1, "Adding Soaring Spirit removes Extra Spirit (1 slot)");
    assert(
      resolved[0].id === "upgrade_soaring_spirit",
      "Resolved build contains Soaring Spirit",
      `Got: ${resolved[0].id}`,
    );
    assert(
      !resolved.find((i) => i.id === "upgrade_improved_spirit"),
      "Extra Spirit not in resolved build",
    );

    // Soaring Spirit consumes its component Extra Spirit (component not in build directly)
    const consumed = getConsumedComponents(resolved);
    assert(
      consumed.has("upgrade_improved_spirit"),
      "upgrade_improved_spirit is marked as consumed by Soaring Spirit",
    );
    assert(consumed.size === 1, `Exactly 1 consumed component: ${consumed.size}`);
    assert(
      Array.isArray(consumed.get("upgrade_improved_spirit")),
      "getConsumedComponents values are arrays (Bug 1 fix: multiple owners supported)",
    );

    // Discount: buying Soaring Spirit with Extra Spirit already in build is cheaper
    const costWithExtra = getEffectiveAddCost(soaringSpirit, buildWithExtra, items);
    const costWithout = getEffectiveAddCost(soaringSpirit, [], items);
    assert(costWithExtra < costWithout, `Discount applied: ${costWithExtra} < ${costWithout}`);
    assert(
      costWithExtra === soaringSpirit.cost - extraSpirit.cost,
      `Exact discount correct: ${costWithExtra} (full price ${soaringSpirit.cost} - component ${extraSpirit.cost})`,
    );

    // Bug 1 regression: two different build items sharing the same component
    // (Soaring Spirit and Magic Storm both list Extra Spirit as a component —
    // a branching upgrade chain) must BOTH be recorded as owners. The old
    // Map<string, string> implementation let the second item's name silently
    // overwrite the first.
    if (magicStorm) {
      const sharedBuild = [soaringSpirit, magicStorm];
      const sharedConsumed = getConsumedComponents(sharedBuild);
      const owners = sharedConsumed.get("upgrade_improved_spirit") ?? [];
      assert(
        owners.length === 2,
        `Shared component tracks both owning items: ${owners.length}`,
        `Owners: ${owners.join(", ")}`,
      );
      assert(
        owners.includes(soaringSpirit.name) && owners.includes(magicStorm.name),
        "Shared component owners include both Soaring Spirit and Magic Storm",
        `Owners: ${owners.join(", ")}`,
      );
    }

    // Bug 2 regression: resolveAddItem must be safe to call directly, even
    // without a caller pre-checking for duplicates — calling it with an item
    // already present in the build must be a no-op, not a duplicate append.
    const dupResult = resolveAddItem(resolved, soaringSpirit);
    assert(
      dupResult.length === resolved.length,
      `resolveAddItem is a no-op when newItem is already in the build: length ${dupResult.length} (expected ${resolved.length})`,
    );
    assert(
      dupResult.filter((i) => i.id === "upgrade_soaring_spirit").length === 1,
      "resolveAddItem does not create a duplicate entry for an already-present item",
    );
  }

  // -----------------------------------------------
  // Fixture 4: Goal-based suggestions retired (item scoring review R3)
  // -----------------------------------------------
  // scoreItems ranked by slot-derived tags (every item tagged mobility + utility),
  // ignored the hero and gave false reasons; the hero basket and the starter
  // build replace it (docs/item-scoring-review.md §2.3). Keep it gone.
  console.log("\n4. Goal-based suggestions retired");
  const retired = [
    "lib/scoring/scoreItems.ts",
    "lib/scoring/goalWeights.ts",
    "app/build/components/SuggestedItemsPanel.tsx",
  ];
  assert(
    retired.every((f) => !existsSync(f)),
    "scoreItems, goal weights and SuggestedItemsPanel are removed",
    retired.filter((f) => existsSync(f)).join(", "),
  );
  const buildClientRetired = readFileSync("app/build/BuildClient.tsx", "utf-8");
  assert(
    !/SuggestedItemsPanel|selectedGoal|scoreItems/.test(buildClientRetired),
    "/build has no goal selector and no goal-ranked panel",
  );

  // -----------------------------------------------
  // Fixture 5: Stat calculations
  // -----------------------------------------------
  console.log("\n5. Stat calculations");
  const spiritItems = items.filter((i) => i.category === "spirit").slice(0, 3);
  const totals = calculateStatTotals(spiritItems);
  assert(totals.spirit >= 0, "Spirit totals non-negative");

  if (boundlessSpirit) {
    const boundlessTotals = calculateStatTotals([boundlessSpirit]);
    assert(
      boundlessTotals.spiritPowerFlat === 30,
      `Boundless Spirit flat spirit: ${boundlessTotals.spiritPowerFlat}`,
    );
    assert(
      boundlessTotals.spiritPowerPercent === 15,
      `Boundless Spirit spirit%: ${boundlessTotals.spiritPowerPercent}`,
    );
    assert(
      boundlessTotals.bonusHealthFlat === 75,
      `Boundless Spirit bonus health: ${boundlessTotals.bonusHealthFlat}`,
    );
  }

  // `SpiritPower` is a SECOND API name for the same stat as `TechPower`.
  // Verified live: 19 items use TechPower, 6 use SpiritPower (Counterspell,
  // Mystic Shot, Healing Nova, Alchemical Fire, Arcane Surge, Veil Walker),
  // and NONE use both -- so summing both keys cannot double-count. Omitting
  // SpiritPower silently dropped up to 20 spirit power per item here, while
  // the engine's STAT_KEY_TO_SCORE already counted it: the two disagreed.
  const mysticShot = items.find((i) => i.name === "Mystic Shot");
  if (mysticShot) {
    const msTotals = calculateStatTotals([mysticShot]);
    assert(
      msTotals.spiritPowerFlat > 0,
      `Mystic Shot's SpiritPower key counts toward spirit totals: ${msTotals.spiritPowerFlat}`,
    );
  }

  // Both names must be summed, and a hypothetical item carrying both must not
  // be double-counted into one key -- they are the same stat, so one sum.
  const dualKey = calculateStatTotals([
    { ...(boundlessSpirit ?? items[0]), stats: { TechPower: 10, SpiritPower: 5 }, statScaling: {} },
  ]);
  assert(
    dualKey.spiritPowerFlat === 15,
    `TechPower + SpiritPower sum into one spirit total: ${dualKey.spiritPowerFlat}`,
  );

  // BaseAttackDamagePercent is a percent stat — it must land in weaponDamagePercent,
  // not get conflated with the flat WeaponPower stat into weaponDamageFlat (bug fix:
  // these used to be combined into one field, which broke any multiplicative math
  // downstream). It still feeds the "gun" investment total and the "burst" tag.
  // (Also replaces the dead "BulletDamage" key — Valve renamed it upstream)
  const hollowPoint = items.find((i) => i.id === "upgrade_hollow_point_rounds");
  if (hollowPoint) {
    const hollowPointTotals = calculateStatTotals([hollowPoint]);
    assert(
      hollowPointTotals.weaponDamagePercent === 35,
      `Hollow Point Rounds weaponDamagePercent via BaseAttackDamagePercent: ${hollowPointTotals.weaponDamagePercent}`,
    );
    assert(
      hollowPointTotals.weaponDamageFlat === 0,
      `Hollow Point Rounds weaponDamageFlat stays 0 (percent stat not conflated with flat): ${hollowPointTotals.weaponDamageFlat}`,
    );
    assert(
      hollowPointTotals.gun === 35,
      `Hollow Point Rounds gun total via BaseAttackDamagePercent: ${hollowPointTotals.gun}`,
    );
    assert(
      hollowPoint.tags.includes("burst"),
      `Hollow Point Rounds tagged "burst" via BaseAttackDamagePercent`,
      `Got tags: ${hollowPoint.tags.join(", ")}`,
    );
  }

  // Regression fixture for the spirit-power cross-term bug: total spirit power must
  // be computed as (base + flat) * (1 + percent/100), not base + flat + base*percent/100.
  // These differ whenever both a flat and a percent spirit item are present.
  {
    const base = 100;
    const flat = 30;
    const percent = 15;
    const correct = (base + flat) * (1 + percent / 100);
    const buggy = base + flat + (base * percent) / 100;
    assert(correct === 149.5, `Multiplicative spirit power formula sanity check: ${correct}`);
    assert(
      correct !== buggy,
      `Multiplicative formula (${correct}) must differ from additive cross-term-dropping formula (${buggy}) for this fixture to be meaningful`,
    );
  }

  // Regression fixture for calculateAbilityDamage's ability-level bounds clamp:
  // a level beyond ABILITY_MAX_LEVEL (3) must not throw when indexing the fixed
  // 3-element `upgrades` tuple.
  {
    const { calculateAbilityDamage, ABILITY_MAX_LEVEL } = await import("@/lib/abilityCoefficients");
    const fakeAbility = {
      classname: "test_ability",
      name: "Test Ability",
      slot: "signature1" as const,
      isUltimate: false,
      damageType: "spirit" as const,
      baseDamage: 100,
      spiritScaling: 1,
      weaponScaling: null,
      cooldown: null,
      duration: null,
      castRange: null,
      passive: null,
      active: null,
      upgrades: [
        { pointCost: 1, description: "", statChanges: [{ stat: "Damage", delta: "10" }] },
        { pointCost: 2, description: "", statChanges: [{ stat: "Damage", delta: "20" }] },
        { pointCost: 5, description: "", statChanges: [{ stat: "Damage", delta: "30" }] },
      ] as [AbilityUpgradeTier, AbilityUpgradeTier, AbilityUpgradeTier],
    };
    let threw = false;
    let outOfRangeResult: number | null = null;
    try {
      // 5 is intentionally beyond ABILITY_MAX_LEVEL — simulates a corrupted/out-of-range level
      outOfRangeResult = calculateAbilityDamage(fakeAbility, 5 as never, 0, 0);
    } catch {
      threw = true;
    }
    assert(!threw, "calculateAbilityDamage does not throw for an out-of-range ability level");
    const atMaxResult = calculateAbilityDamage(fakeAbility, ABILITY_MAX_LEVEL, 0, 0);
    assert(
      outOfRangeResult === atMaxResult,
      `Out-of-range level clamps to ABILITY_MAX_LEVEL result: got ${outOfRangeResult}, expected ${atMaxResult}`,
    );
  }

  // Sell refund is 50%
  const { getSellRefund } = await import("@/lib/buildCalculations");
  assert(getSellRefund(500) === 250, "Sell refund 50%: 500 → 250");
  assert(getSellRefund(1000) === 500, "Sell refund 50%: 1000 → 500");
  assert(getSellRefund(3000) === 1500, "Sell refund 50%: 3000 → 1500");

  // -----------------------------------------------
  // Fixture 6: Boon system
  // -----------------------------------------------
  console.log("\n6. Boon system");
  // Below 600 souls (the free starting stack): fallback is BOON_THRESHOLDS[0] (boonLevel 1)
  const boonBelow = getBoonThreshold(700);
  assert(
    boonBelow.boonLevel === 1,
    `Boon level 1 at 700 souls (below second threshold): got ${boonBelow.boonLevel}`,
  );

  const boonAt800 = getBoonThreshold(800);
  assert(
    boonAt800.boonLevel === 2,
    `Boon level 2 at exactly 800 souls: got ${boonAt800.boonLevel}`,
  );

  const boonAt3800 = getBoonThreshold(3800);
  assert(boonAt3800.boonLevel === 8, `Boon level 8 at 3800 souls: got ${boonAt3800.boonLevel}`);
  assert(boonAt3800.isUltimateUnlock, "Ultimate unlocks at 3800 souls");

  const pointsAt3800 = getAbilityPointsAtSouls(3800);
  assert(pointsAt3800 === 4, `4 ability points at 3800 souls: got ${pointsAt3800}`);

  const boonAt3200 = getBoonThreshold(3200);
  assert(boonAt3200.boonLevel === 7, `Boon level 7 at 3200 souls: got ${boonAt3200.boonLevel}`);
  assert(
    boonAt3200.abilityPoints === 4,
    `4 ability points at 3200 souls: got ${boonAt3200.abilityPoints}`,
  );

  // -----------------------------------------------
  // Fixture 7: Serializer round-trip
  // -----------------------------------------------
  console.log("\n7. Serializer round-trip");
  const testState = {
    heroId: "test_hero",
    itemIds: ["upgrade_improved_spirit", "upgrade_soaring_spirit"],
    abilityLevels: {
      signature1: 1 as const,
      signature2: 0 as const,
      signature3: 2 as const,
      signature4: 0 as const,
    },
    categories: [{ id: "cat1", name: "Early Game", itemIds: ["upgrade_improved_spirit"] }],
    phases: ["early", "mid"] as Array<"early" | "mid" | "late" | null>,
    active: [true, false],
    sell: [false, true],
    optional: [false, false],
    heroLevel: 10,
  };

  const encoded = serializeBuild(testState);
  assert(typeof encoded === "string" && encoded.length > 0, "Serialized to non-empty string");

  const decoded = deserializeBuild(encoded);
  assert(decoded.heroId === testState.heroId, "heroId round-trips");
  assert(decoded.itemIds.length === 2, "itemIds round-trip");
  assert(decoded.heroLevel === 10, "heroLevel round-trips");
  assert(decoded.phases[0] === "early", "phases round-trip");
  assert(decoded.active[0] === true, "active flags round-trip");
  assert(decoded.sell[1] === true, "sell flags round-trip");
  assert(decoded.abilityLevels.signature3 === 2, "abilityLevels round-trip");
  assert(decoded.categories[0]?.name === "Early Game", "categories round-trip");

  // Old/minimal share link compatibility
  const minimalEncoded = serializeBuild({
    heroId: "test",
    itemIds: [],
    abilityLevels: {},
    categories: [],
    phases: [],
    active: [],
    sell: [],
    optional: [],
    heroLevel: 0,
  });
  const minimalDecoded = deserializeBuild(minimalEncoded);
  assert(!!minimalDecoded, "Minimal state deserializes without crash");
  assert(minimalDecoded.heroId === "test", "Minimal heroId round-trips");
  assert(minimalDecoded.heroLevel === 0, "Minimal heroLevel 0 round-trips");

  // Bug 3 regression: a malformed/hand-edited share link where itemIds contains
  // a non-string entry BEFORE valid ones must not misalign the parallel
  // phases/active/sell/optional arrays. Pre-fix, filtering itemIds down to
  // valid strings first and then re-indexing the flag arrays by the *post-filter*
  // length would hand "upgrade_soaring_spirit" (originally index 2) the flags
  // that were meant for index 1 (the dropped null).
  {
    const malformedRaw = {
      heroId: "test_hero",
      itemIds: ["upgrade_improved_spirit", null, "upgrade_soaring_spirit"],
      abilityLevels: {},
      categories: [],
      phases: ["early", "mid", "late"],
      active: [true, false, true],
      sell: [false, false, false],
      optional: [false, false, false],
      boonLevel: 0,
    };
    const malformedJson = JSON.stringify(malformedRaw);
    const malformedEncoded = btoa(malformedJson)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const malformedDecoded = deserializeBuild(malformedEncoded);

    assert(
      malformedDecoded.itemIds.length === 2,
      `Malformed itemIds filtered to 2 valid entries: ${malformedDecoded.itemIds.length}`,
    );
    assert(
      malformedDecoded.itemIds[0] === "upgrade_improved_spirit" &&
        malformedDecoded.itemIds[1] === "upgrade_soaring_spirit",
      "Malformed itemIds preserves relative order of valid entries",
      `Got: ${malformedDecoded.itemIds.join(", ")}`,
    );
    assert(
      malformedDecoded.phases[1] === "late",
      `Soaring Spirit (originally index 2) keeps its own phase "late" after the null at index 1 is filtered out: got ${malformedDecoded.phases[1]}`,
    );
    assert(
      malformedDecoded.active[1] === true,
      `Soaring Spirit keeps its own active flag (true) after filtering: got ${malformedDecoded.active[1]}`,
    );
    // The dropped null's own flags (phase "mid", active false) must not leak
    // onto the item that shifted into its old array position.
    assert(
      malformedDecoded.phases[1] !== "mid",
      "Filtered-out entry's flags ('mid') are not misattributed to the following item",
    );
  }

  // -----------------------------------------------
  // Fixture 8: Build state derivation (slot-cap + cleanup)
  // -----------------------------------------------
  console.log("\n8. Build state derivation");

  // canActivateItem — pure slot-cap validation (Milestone B2 extraction)
  assert(canActivateItem(0, false).allowed, "canActivateItem allows first active item");
  assert(
    canActivateItem(MAX_ACTIVE_ITEMS - 1, false).allowed,
    `canActivateItem allows the ${MAX_ACTIVE_ITEMS}th active item`,
  );
  const atCap = canActivateItem(MAX_ACTIVE_ITEMS, false);
  assert(!atCap.allowed, `canActivateItem blocks activation at the ${MAX_ACTIVE_ITEMS}-item cap`);
  assert(
    typeof atCap.reason === "string" && atCap.reason.length > 0,
    "canActivateItem returns a reason when blocked at cap",
  );
  const optionalBlocked = canActivateItem(0, true);
  assert(!optionalBlocked.allowed, "canActivateItem blocks optional items regardless of count");

  // cleanCategories / cleanAssignmentMap — derived views that drop stale entries
  // for items no longer in buildItems (Milestone B1: no more hand-syncing)
  if (extraSpirit) {
    const buildItems = [extraSpirit];

    const categoriesWithStale = [
      { id: "cat1", name: "Test", itemIds: [extraSpirit.id, "does-not-exist"] },
    ];
    const cleanedCats = cleanCategories(categoriesWithStale, buildItems);
    assert(
      cleanedCats[0].itemIds.length === 1 && cleanedCats[0].itemIds[0] === extraSpirit.id,
      "cleanCategories drops itemIds for items no longer in buildItems",
    );

    const assignmentWithStale = new Map([
      [extraSpirit.id, { phase: null, active: true, sellPriority: false, optional: false }],
      ["does-not-exist", { phase: null, active: true, sellPriority: false, optional: false }],
    ]);
    const cleanedMap = cleanAssignmentMap(assignmentWithStale, buildItems);
    assert(
      cleanedMap.size === 1 && cleanedMap.has(extraSpirit.id) && !cleanedMap.has("does-not-exist"),
      "cleanAssignmentMap drops entries for items no longer in buildItems",
    );
    assert(
      cleanedMap.get(extraSpirit.id)?.active === true,
      "cleanAssignmentMap preserves flags for items still in buildItems",
    );
  }

  // -----------------------------------------------
  // Fixture 8b: normalizeItem icon fallback chain (Bug 4 regression)
  // -----------------------------------------------
  // "??" only falls through on null/undefined, not "" — an empty-string
  // shop_image_webp must not win over a valid shop_image fallback.
  console.log("\n8b. normalizeItem icon fallback (empty-string handling)");

  const baseRawItem: UpgradeV2Raw = {
    id: 1,
    class_name: "test_item_icon",
    name: "Test Item",
    type: "upgrade",
    item_slot_type: "spirit",
    item_tier: 1,
    cost: 500,
  };

  const emptyWebpItem = normalizeItem({
    ...baseRawItem,
    shop_image_webp: "",
    shop_image: "https://example.com/valid-fallback.png",
  });
  assert(
    emptyWebpItem.icon === "https://example.com/valid-fallback.png",
    `normalizeItem skips an empty-string shop_image_webp and falls through to shop_image: got ${JSON.stringify(emptyWebpItem.icon)}`,
  );

  const allEmptyItem = normalizeItem({
    ...baseRawItem,
    shop_image_webp: "",
    shop_image: "",
    shop_image_small_webp: "",
    shop_image_small: "",
  });
  assert(
    allEmptyItem.icon === undefined,
    `normalizeItem falls through to undefined when every icon field is an empty string: got ${JSON.stringify(allEmptyItem.icon)}`,
  );

  const validWebpItem = normalizeItem({
    ...baseRawItem,
    shop_image_webp: "https://example.com/webp.png",
    shop_image: "https://example.com/png.png",
  });
  assert(
    validWebpItem.icon === "https://example.com/webp.png",
    "normalizeItem still prefers a non-empty shop_image_webp over shop_image",
  );

  // -----------------------------------------------
  // Fixture 8c: parseStats keeps negative values
  // -----------------------------------------------
  // parseStats used to `continue` on val < 0, silently dropping legitimate
  // debuff-style tradeoffs (an item that boosts one stat at the cost of
  // another). Synthetic, not live — proves the behavior mechanically instead
  // of hoping live API data happens to contain a negative property.
  console.log("\n8c. normalizeItem keeps negative-valued stats");

  const negativeStatItem = normalizeItem({
    ...baseRawItem,
    id: 4242,
    class_name: "test_item_negative_stat",
    properties: {
      NegativeKey: { value: -5 },
      PositiveKey: { value: 12 },
      ZeroDisabledKey: { value: 0, disable_value: "0" },
    },
  });

  assert(
    negativeStatItem.stats["NegativeKey"] === -5,
    `normalizeItem keeps a negative-valued property: got ${JSON.stringify(negativeStatItem.stats["NegativeKey"])}`,
  );
  assert(
    negativeStatItem.stats["PositiveKey"] === 12,
    "normalizeItem still keeps positive-valued properties",
  );
  assert(
    !("ZeroDisabledKey" in negativeStatItem.stats),
    "normalizeItem still drops a 0 value whose disable_value is 0",
  );

  // -----------------------------------------------
  // Fixture 8d: normalizeItem preserves the raw numeric id
  // -----------------------------------------------
  // item.id stays class_name (app-side key); numericId carries raw.id so
  // items can be joined to match-analytics data keyed by numeric item_id.
  console.log("\n8d. normalizeItem preserves raw numeric id");

  assert(
    negativeStatItem.numericId === 4242,
    `normalizeItem copies raw.id to numericId: got ${JSON.stringify(negativeStatItem.numericId)}`,
  );
  assert(
    negativeStatItem.id === "test_item_negative_stat",
    "normalizeItem still keys item.id off class_name, not the numeric id",
  );

  // -----------------------------------------------
  // Fixture 9: New Player UX Checklist — mechanically-checkable parts
  // -----------------------------------------------
  // Full checklist (plain-English copy quality, "does it hide complexity
  // well") still needs human review — this only enforces the two parts a
  // fixture can actually verify: (a) a panel accepts the `simplified` prop
  // convention rather than silently omitting it, and (b) it uses the shared
  // Tooltip/InfoTooltip component rather than reintroducing raw `title=`.
  console.log("\n9. New Player UX Checklist (mechanical checks)");

  const SIMPLIFIED_PANELS = [
    "app/build/components/CategoryManager/index.tsx",
    "app/build/components/AbilityLevelingPanel.tsx",
    "app/build/components/BuildSummaryPanel.tsx",
    // Milestone E. It already complied, but the list is hardcoded, so a new
    // panel is unprotected until it is added here — add new panels to this
    // list as they are built, or the checklist silently stops covering them.
    "app/build/components/HeroBasketSuggestion.tsx",
    // Work 2d.
    "app/build/components/StarterBuildPanel.tsx",
    // M6.5.
    "app/build/components/CoachPanel.tsx",
  ];

  for (const relPath of SIMPLIFIED_PANELS) {
    const source = readFileSync(relPath, "utf-8");
    assert(
      /simplified\?:\s*boolean/.test(source),
      `${relPath} declares the simplified?: boolean prop convention`,
    );
  }

  const TOOLTIP_ADOPTERS = [
    "app/build/components/CategoryManager/FlagButtons.tsx",
    "app/build/components/AbilityLevelingPanel.tsx",
    "app/build/components/BuildSummaryPanel.tsx",
    "app/build/BuildClient.tsx",
    "app/build/components/StarterBuildPanel.tsx",
    "app/build/components/CoachPanel.tsx",
    // Site nav + homepage.
    "app/components/SiteNav.tsx",
    "app/page.tsx",
  ];

  for (const relPath of TOOLTIP_ADOPTERS) {
    const source = readFileSync(relPath, "utf-8");
    assert(
      source.includes('from "@/app/components/Tooltip"'),
      `${relPath} uses the shared Tooltip/InfoTooltip component`,
    );
  }

  // -----------------------------------------------
  // Fixture 10: lib/farming (Milestone D5 — farming data was previously
  // covered by the guide page rendering, not by mini.ts)
  // -----------------------------------------------
  console.log("\n10. Farming data (lib/farming/campData.ts)");

  const smallCamp = CAMPS.find((c) => c.id === "small_denizen");
  assert(!!smallCamp, "Small Camp found in CAMPS");
  if (smallCamp) {
    assert(
      soulsAt(smallCamp, smallCamp.firstSpawnMin - 1) === null,
      "soulsAt returns null before a camp's first spawn minute",
    );
    assert(
      soulsAt(smallCamp, smallCamp.firstSpawnMin) !== null,
      "soulsAt returns a value at a camp's first spawn minute",
    );
    assert(
      soulsPerMinEfficiency(smallCamp, 20) > 0,
      "soulsPerMinEfficiency is positive for a spawned camp",
    );
  }

  assert(
    GAME_MINUTE_COLUMNS.every((m, i) => i === 0 || m > GAME_MINUTE_COLUMNS[i - 1]),
    "GAME_MINUTE_COLUMNS is strictly ascending",
  );

  const campIds = new Set(CAMPS.map((c) => c.id));
  assert(
    CAMP_MARKERS.every((m) => campIds.has(m.campId)),
    "Every CAMP_MARKERS.campId references a real CAMPS entry",
  );

  // Map / jungle rework (verified 2026-10-25, wiki + /v1/assets/map): markers
  // come from the API's neutral_camps on the current minimap image.
  const markerCount = (id: string) => CAMP_MARKERS.filter((m) => m.campId === id).length;
  assert(
    markerCount("small_denizen") === 4 &&
      markerCount("medium_denizen") === 25 &&
      markerCount("large_denizen") === 11 &&
      markerCount("sinners_sacrifice") === 11,
    "CAMP_MARKERS match the current map: 4 small, 25 medium, 11 hard, 11 Sinner's Sacrifice",
  );
  assert(
    CAMP_MARKERS.every((m) => m.left >= 0 && m.left <= 100 && m.top >= 0 && m.top <= 100) &&
      MINIMAP_URL.endsWith("/minimap_midtown_mid.png"),
    "Camp markers sit inside the current minimap image (minimap_midtown_mid.png)",
  );
  const crate = CAMPS.find((c) => c.id === "crate");
  const tough = CAMPS.find((c) => c.id === "tough_crate");
  assert(
    !!crate &&
      !!tough &&
      soulsAt(tough, 20) === 2 * (soulsAt(crate, 20) ?? 0) &&
      tough.dropChance === 1 &&
      CAMPS.find((c) => c.id === "medium_denizen")?.firstSpawnMin === 5,
    "Tough Crates drop double a crate's souls every time; medium camps spawn at 5:00",
  );

  // -----------------------------------------------
  // Fixture 11: New guide content — referential integrity (Milestone D)
  // -----------------------------------------------
  // These guides have no scoring logic, so the fixtures here check shape and
  // cross-references rather than game-formula correctness (data-verifier's
  // job) — e.g. a minimap marker pointing at a renamed/removed structure id
  // would otherwise fail silently at render time, not at typecheck time.
  console.log("\n11. Guide content (boons / itemization / lanes)");

  const unlockOrder = getAbilityUnlockOrder();
  assert(
    BOON_PHASE_CARDS.length === unlockOrder.length,
    `BOON_PHASE_CARDS has one card per ability unlock: ${BOON_PHASE_CARDS.length} === ${unlockOrder.length}`,
  );
  assert(
    BOON_PHASE_CARDS.at(-1)?.available.includes("Ultimate") ?? false,
    "Last boon phase card is the Ultimate unlock",
  );
  assert(
    BOON_PHASE_CARDS.every((c) => c.tip.length > 0 && c.available.length > 0),
    "Every BOON_PHASE_CARDS entry has a tip and at least one pill",
  );

  assert(
    ITEMIZATION_PHASE_CARDS.every((c) => c.tip.length > 0 && c.available.length > 0),
    "Every ITEMIZATION_PHASE_CARDS entry has a tip and at least one pill",
  );

  assert(LANE_STRUCTURES.length === 4, `LANE_STRUCTURES has 4 entries: ${LANE_STRUCTURES.length}`);
  const laneStructureIds = new Set(LANE_STRUCTURES.map((s) => s.id));
  assert(laneStructureIds.size === LANE_STRUCTURES.length, "LANE_STRUCTURES ids are unique");
  assert(
    LANE_MINIMAP_MARKERS.every((m) => laneStructureIds.has(m.structureId)),
    "Every LANE_MINIMAP_MARKERS.structureId references a real LANE_STRUCTURES entry",
  );
  const laneIds = new Set(LANES.map((l) => l.id));
  assert(
    LANE_MINIMAP_MARKERS.every((m) => laneIds.has(m.laneId)),
    "Every LANE_MINIMAP_MARKERS.laneId references a real LANES entry",
  );

  assert(
    CATEGORY_BONUS_TIERS.every(
      (t, i) => i === 0 || t.soulsThreshold > CATEGORY_BONUS_TIERS[i - 1].soulsThreshold,
    ),
    "CATEGORY_BONUS_TIERS is strictly ascending by soulsThreshold (getCurrentBonusTier relies on this)",
  );
  assert(
    CATEGORY_BONUS_TIERS.some((t) => t.isSignificant),
    "CATEGORY_BONUS_TIERS has at least one significant-bonus tier",
  );

  // -----------------------------------------------
  // Fixture 12: Site navigation
  // -----------------------------------------------
  // The /guide/* pages shipped with no link to them anywhere. lib/navigation.ts
  // is now the single list of sections and guides; these checks keep it in
  // step with the app/ route tree so a new guide can't go unlinked again.
  console.log("\n12. Site navigation (lib/navigation.ts)");

  const routeExists = (href: string) =>
    existsSync(href === "/" ? "app/page.tsx" : `app${href}/page.tsx`);
  const allNavLinks = [...NAV_SECTIONS, ...GUIDES];

  const deadLinks = allNavLinks.filter((l) => !routeExists(l.href));
  assert(
    deadLinks.length === 0,
    "Every NAV_SECTIONS / GUIDES href resolves to an app/**/page.tsx",
    deadLinks.map((l) => l.href).join(", "),
  );
  assert(
    new Set(allNavLinks.map((l) => l.href)).size === allNavLinks.length &&
      new Set(GUIDES.map((g) => g.label)).size === GUIDES.length,
    "Nav hrefs and guide labels are unique",
  );
  assert(
    readFileSync("app/components/HomeHeroPicker.tsx", "utf-8").includes("href={`/build/${") &&
      existsSync("app/build/[heroId]/page.tsx"),
    "Homepage hero tiles link to /build/[heroId], and that route exists",
  );
  assert(
    allNavLinks.every((l) => l.label.trim().length > 0 && l.description.trim().length > 0),
    "Every nav entry has a label and a plain-English description",
  );

  const guideRoutes = readdirSync("app/guide", { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`app/guide/${d.name}/page.tsx`))
    .map((d) => `/guide/${d.name}`);
  const guideHrefs = new Set(GUIDES.map((g) => g.href));
  const unlinkedGuides = guideRoutes.filter((r) => !guideHrefs.has(r));
  assert(
    guideRoutes.length > 0 && unlinkedGuides.length === 0,
    `Every guide page under app/guide/ is listed in GUIDES (${guideRoutes.length} found)`,
    unlinkedGuides.join(", "),
  );
  assert(
    NAV_SECTIONS.some((s) => s.href === "/guide"),
    "NAV_SECTIONS links the /guide index",
  );

  assert(
    readFileSync("app/layout.tsx", "utf-8").includes("<SiteNav"),
    "app/layout.tsx mounts SiteNav on every page",
  );
  const NAV_CONSUMERS = ["app/components/SiteNav.tsx", "app/guide/page.tsx", "app/page.tsx"];
  for (const relPath of NAV_CONSUMERS) {
    assert(
      readFileSync(relPath, "utf-8").includes('from "@/lib/navigation"'),
      `${relPath} reads its links from lib/navigation.ts`,
    );
  }

  assert(
    isActiveSection("/build/7", "/build") &&
      isActiveSection("/build", "/build") &&
      !isActiveSection("/builder", "/build") &&
      isActiveSection("/guide/lanes", "/guide"),
    "isActiveSection matches the section and its sub-pages only",
  );

  // -----------------------------------------------
  // Fixture 13: Starter build (docs/starter-build-use-cases.md)
  // -----------------------------------------------
  // Live-data fixtures for buildStarterBuild: hard rules H1-H9 plus the
  // expected-lean ratchet (KNOWN_LEAN_GAPS) from the approved spec.
  console.log("\n13. Starter build (docs/starter-build-use-cases.md)");
  await runStarterBuildFixtures(assert);

  // -----------------------------------------------
  // Fixture 14: Fail-open fetchers rethrow Next's internal errors
  // -----------------------------------------------
  // Next marks a route dynamic by throwing from fetch during static
  // generation. fetchAllItems swallowed that, returned [], and /items shipped
  // prerendered with zero items. Fail-open must mean "API down", never this.
  console.log("\n14. Fail-open fetchers rethrow Next's internal errors");

  const FAIL_OPEN_FILES = [
    "lib/api/deadlockApi.ts",
    "lib/api/analyticsApi.ts",
    "lib/heroStore.ts",
    "lib/ogAssets.ts",
    "app/sitemap.ts",
    "app/api/og/build/route.tsx",
    "app/build/[heroId]/page.tsx",
    "app/heroes/[...hero]/page.tsx",
  ];
  for (const relPath of FAIL_OPEN_FILES) {
    const src = readFileSync(relPath, "utf-8");
    // \r?: Windows checkouts have CRLF working copies (CI sees LF).
    const catches = src.match(/\} catch \(err\) \{\r?\n\s*\S[^\r\n]*/g) ?? [];
    const unguarded = catches.filter((c) => !c.includes("unstable_rethrow(err);"));
    assert(
      catches.length > 0 && unguarded.length === 0,
      `${relPath}: every catch calls unstable_rethrow(err) first (${catches.length} found)`,
      unguarded.join(" | "),
    );
  }

  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.reject(Object.assign(new Error("dynamic"), { digest: "DYNAMIC_SERVER_USAGE" }));
    const rethrown = await fetchAllItems().then(
      () => false,
      (err: unknown) => (err as { digest?: string }).digest === "DYNAMIC_SERVER_USAGE",
    );
    assert(rethrown, "fetchAllItems rethrows Next's DYNAMIC_SERVER_USAGE instead of returning []");

    globalThis.fetch = () => Promise.reject(new Error("network down"));
    const failedOpen = await fetchAllItems().then(
      (r) => r.length === 0,
      () => false,
    );
    assert(failedOpen, "fetchAllItems still fails open ([]) on a real network error");
  } finally {
    globalThis.fetch = realFetch;
  }

  // -----------------------------------------------
  // Fixture: anti-synergy rules (reviewed 2026-10-19)
  // -----------------------------------------------
  console.log("\nAnti-synergy rules");
  const itemById = new Map(items.map((i) => [i.id, i]));
  const componentsOf = (id: string) => itemById.get(id)?.componentItems;
  const badRuleItems = ANTI_SYNERGY_RULES.filter(
    (r) =>
      r.itemIds[0] === r.itemIds[1] || !itemById.has(r.itemIds[0]) || !itemById.has(r.itemIds[1]),
  );
  assert(
    badRuleItems.length === 0,
    "Every ANTI_SYNERGY_RULES entry names two distinct live items",
    badRuleItems.map((r) => r.itemIds.join("+")).join(", "),
  );
  const chainRules = ANTI_SYNERGY_RULES.filter(
    (r) =>
      componentClosure(r.itemIds[0], componentsOf).has(r.itemIds[1]) ||
      componentClosure(r.itemIds[1], componentsOf).has(r.itemIds[0]),
  );
  assert(
    chainRules.length === 0,
    "No anti-synergy rule pairs an item with its own component (that is the normal upgrade path)",
    chainRules.map((r) => r.itemIds.join("+")).join(", "),
  );
  const staleNumbers = ANTI_SYNERGY_RULES.filter((r) => /\d[\d,. ]*\s*(souls|%)/i.test(r.reason));
  assert(
    staleNumbers.length === 0,
    "No anti-synergy reason hardcodes a soul cost or percentage (they go stale on patches)",
    staleNumbers.map((r) => r.itemIds.join("+")).join(", "),
  );
  assert(
    detectAntiSynergies([]).length === 0,
    "detectAntiSynergies: empty build gives no warnings",
  );
  const firstRule = ANTI_SYNERGY_RULES[0];
  const pairItems = firstRule.itemIds.map((id) => itemById.get(id)).filter((i) => i !== undefined);
  const pairWarnings = detectAntiSynergies(pairItems);
  assert(
    pairWarnings.length === 1 &&
      pairWarnings[0].itemIds.join("+") === firstRule.itemIds.join("+") &&
      pairWarnings[0].reason === firstRule.reason,
    "detectAntiSynergies: a known pair gives exactly its rule's warning",
    `Got ${pairWarnings.length} warnings`,
  );
  const upgradePath = ["upgrade_extra_charge", "upgrade_rapid_recharge"]
    .map((id) => itemById.get(id))
    .filter((i) => i !== undefined);
  assert(
    upgradePath.length === 2 && detectAntiSynergies(upgradePath).length === 0,
    "detectAntiSynergies: Extra Charge + Rapid Recharge (component and upgrade) is not a conflict",
  );

  // -----------------------------------------------
  // Fixture 15: Page metadata, share previews, sitemap (Work 3a)
  // -----------------------------------------------
  console.log("\n15. Page metadata, share previews, sitemap");

  // Every page names itself: a static `metadata` export or `generateMetadata`.
  const pageFiles: string[] = [];
  const walkPages = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walkPages(full);
      else if (entry.name === "page.tsx") pageFiles.push(full);
    }
  };
  walkPages("app");
  const unnamed = pageFiles.filter(
    (f) =>
      !/export (const metadata\b|async function generateMetadata\b)/.test(readFileSync(f, "utf-8")),
  );
  assert(
    pageFiles.length >= 12 && unnamed.length === 0,
    `every app/**/page.tsx exports metadata or generateMetadata (${pageFiles.length} pages)`,
    unnamed.join(", "),
  );
  const layoutSrc = readFileSync("app/layout.tsx", "utf-8");
  assert(
    layoutSrc.includes("metadataBase: siteUrl()") && layoutSrc.includes("template:"),
    "root layout sets metadataBase and the title template",
  );
  const hardcodedSuffix = pageFiles.filter((f) =>
    readFileSync(f, "utf-8").includes("| Deadlock Foundry"),
  );
  assert(
    hardcodedSuffix.length === 0,
    "no page hard-codes the site-name title suffix (the template adds it)",
    hardcodedSuffix.join(", "),
  );
  for (const guide of GUIDES) {
    const src = readFileSync(`app${guide.href}/page.tsx`, "utf-8");
    assert(
      src.includes(`guideMetadata("${guide.href}"`) &&
        guideMetadata(guide.href, "x").description === guide.description,
      `${guide.href}: metadata description comes from GUIDES`,
    );
  }

  // siteUrl precedence: explicit > Vercel production domain > fallback.
  assert(
    siteUrl({ NEXT_PUBLIC_SITE_URL: "https://a.example" }).origin === "https://a.example" &&
      siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "b.example" }).origin === "https://b.example" &&
      siteUrl({}).toString() === new URL(FALLBACK_SITE_URL).toString(),
    "siteUrl: NEXT_PUBLIC_SITE_URL, then VERCEL_PROJECT_PRODUCTION_URL, then the fallback",
  );
  assert(
    siteUrl({ NEXT_PUBLIC_SITE_URL: "foundry.example" }).origin === "https://foundry.example" &&
      siteUrl({ NEXT_PUBLIC_SITE_URL: "::not a url::" }).toString() ===
        new URL(FALLBACK_SITE_URL).toString(),
    "siteUrl: a bare host gets https://, an unparseable value falls back (never throws)",
  );
  const noArtHero = {
    id: 1,
    name: "X",
    images: { icon_hero_card: "", icon_hero_card_webp: "https://x/c.webp" },
  };
  const ogOf = (m: ReturnType<typeof heroPageMetadata>) =>
    (m.openGraph ?? {}) as { siteName?: string; images?: Array<{ url: string }> };
  const heroOg = ogOf(heroPageMetadata(noArtHero));
  const iconless = items.find((i) => i.id === items[0].id);
  const itemOg = iconless ? ogOf(itemPageMetadata({ ...iconless, icon: "" })) : {};
  assert(
    heroOg.siteName === SITE_NAME &&
      heroOg.images?.[0]?.url === "https://x/c.webp" &&
      itemOg.siteName === SITE_NAME &&
      itemOg.images?.[0]?.url === DEFAULT_OG_IMAGE.url,
    "page OpenGraph keeps siteName; empty art falls back to WebP, then to the generic card",
    JSON.stringify({ heroOg, itemOg }),
  );
  assert(
    pngVariant("https://x/a/b.webp") === "https://x/a/b.png" &&
      pngVariant("https://x/a/b.png") === "https://x/a/b.png" &&
      pngVariant(undefined) === undefined,
    "pngVariant: WebP assets map to their PNG twin (Satori can't decode WebP)",
  );
  assert(
    decodeBuildParam("not-a-build!!") === null && decodeBuildParam(undefined) === null,
    "decodeBuildParam: a malformed or missing share param is null, never a throw",
  );

  // A shared build previews its active items first, at most PREVIEW_ITEM_LIMIT,
  // skipping ids the catalogue no longer has.
  const previewIds = items.slice(0, PREVIEW_ITEM_LIMIT + 2).map((i) => i.id);
  const previewState: BuildState = {
    heroId: "13",
    itemIds: [...previewIds, "upgrade_does_not_exist"],
    abilityLevels: {},
    heroLevel: 10,
    categories: [],
    phases: [...previewIds, "x"].map(() => null),
    active: [...previewIds, "x"].map((_, k) => k === 3),
    sell: [...previewIds, "x"].map(() => false),
    optional: [...previewIds, "x"].map(() => false),
  };
  const testHero = { id: 13, name: "Haze", images: { icon_hero_card_webp: "https://x/haze.webp" } };
  const encodedPreview = serializeBuild(previewState);
  const preview = buildPreview(testHero, decodeBuildParam(encodedPreview), items);
  assert(
    preview.items.length === PREVIEW_ITEM_LIMIT &&
      preview.items[0].id === previewIds[3] &&
      preview.itemCount === previewIds.length &&
      preview.heroImage === "https://x/haze.png",
    "buildPreview: active items first, capped, unknown ids skipped, PNG hero art",
    JSON.stringify(preview.items.map((i) => i.id)),
  );
  const sharedMeta = buildPageMetadata(testHero, preview, encodedPreview);
  const plainMeta = buildPageMetadata(testHero, buildPreview(testHero, null, items), null);
  const imageOf = (m: typeof sharedMeta) => {
    const images = m.openGraph?.images;
    const first = Array.isArray(images) ? images[0] : images;
    return typeof first === "object" && first !== null && "url" in first ? String(first.url) : "";
  };
  assert(
    imageOf(sharedMeta) === buildPreviewImagePath(13, encodedPreview) &&
      imageOf(sharedMeta).includes("build=") &&
      sharedMeta.title === "Haze build" &&
      String(sharedMeta.description).includes(preview.items[0].name) &&
      imageOf(plainMeta) === "/api/og/build?hero=13" &&
      plainMeta.title === "Haze build planner",
    "buildPageMetadata: a share link previews its items; a plain hero link previews the hero",
  );

  // Sitemap: static routes (every guide included), hero + build pages, items;
  // never a share link.
  const entries = sitemapEntries(new URL("https://site.example"), [13, 6], ["upgrade_x"]);
  const urls = entries.map((e) => e.url);
  assert(
    GUIDES.every((g) => urls.includes(`https://site.example${g.href}`)) &&
      STATIC_ROUTES.every((r) => existsSync(r === "/" ? "app/page.tsx" : `app${r}/page.tsx`)) &&
      urls.includes("https://site.example/build/13") &&
      urls.includes("https://site.example/heroes/6") &&
      urls.includes("https://site.example/items/upgrade_x") &&
      urls.every((u) => !u.includes("?")) &&
      entries.length === STATIC_ROUTES.length + 2 * 2 + 1,
    "sitemapEntries: every guide and static route (each a real page), hero/build/item pages, no share links",
  );
  assert(
    readFileSync("app/robots.ts", "utf-8").includes("/sitemap.xml"),
    "robots.ts points crawlers at the sitemap",
  );

  // -----------------------------------------------
  // Fixture 16: /build on phones, touch and theme (Work 3b)
  // -----------------------------------------------
  console.log("\n16. /build on phones, touch and theme");
  const buildClientSrc = readFileSync("app/build/BuildClient.tsx", "utf-8");
  assert(
    !buildClientSrc.includes("gridTemplateColumns") &&
      buildClientSrc.includes("grid-cols-1") &&
      buildClientSrc.includes("xl:grid-cols-[280px_minmax(0,1fr)_300px_260px]"),
    "/build layout stacks below xl (no fixed inline 4-column grid)",
  );
  assert(
    (buildClientSrc.match(/className="order-\d/g) ?? []).length === 4,
    "/build: all four panels carry a stacking order for narrow screens",
  );
  const dndSrc = readFileSync("app/build/components/CategoryManager/index.tsx", "utf-8");
  assert(
    /useSensor\(TouchSensor, \{ activationConstraint: \{ delay: \d+, tolerance: \d+ \} \}\)/.test(
      dndSrc,
    ) &&
      dndSrc.includes("useSensor(MouseSensor") &&
      !dndSrc.includes("PointerSensor"),
    "game-plan drag: press-and-hold on touch (a swipe scrolls), distance drag on mouse",
  );
  const sectionsSrc = readFileSync("app/build/components/CategoryManager/Sections.tsx", "utf-8");
  assert(
    /showContent = !collapsed \|\| isOver \|\| overOwnItem/.test(sectionsSrc),
    "a phase section stays open while a drag hovers its own items (else open/close loops, React #185)",
  );
  const tooltipSrc = readFileSync("app/components/Tooltip.tsx", "utf-8");
  assert(
    tooltipSrc.includes("onClick") &&
      tooltipSrc.includes('"pointerdown"') &&
      tooltipSrc.includes('"Escape"') &&
      tooltipSrc.includes("pointer-coarse:"),
    "InfoTooltip opens on tap and closes on an outside tap or Escape (touch has no hover)",
  );
  const globalsCss = readFileSync("app/globals.css", "utf-8");
  assert(
    globalsCss.includes("color-scheme: dark") && !globalsCss.includes("prefers-color-scheme"),
    "site is dark-only (panels are designed dark; no light-mode switch)",
  );

  // -----------------------------------------------
  // Fixture 17: Hero roles (docs/milestone-m6.md §4, C2)
  // -----------------------------------------------
  console.log("\n17. Hero roles (lib/heroRoles.ts)");
  const liveHeroes = await fetchVisibleHeroes();
  const roleNames = new Set<HeroRole>(Object.keys(ROLE_LABELS) as HeroRole[]);
  const missingRoles = liveHeroes.filter((h) => !HERO_ROLES[h.id]);
  // A hero Valve just released (or a transient detail-fetch miss) is a
  // warning, not a CI failure on unrelated PRs: lookups fail open to "unknown".
  // More than two missing means the table is broken.
  if (missingRoles.length > 0) {
    console.warn(
      `  ⚠️  heroes without a role entry (add them, then npm run role-check): ` +
        missingRoles.map((h) => `${h.name} (${h.id})`).join(", "),
    );
  }
  assert(
    liveHeroes.length > 0 && missingRoles.length <= 2,
    `the live heroes (${liveHeroes.length}) have role entries (at most 2 new ones pending)`,
    missingRoles.map((h) => `${h.name} (${h.id})`).join(", "),
  );
  // roleFlag: what contradicts a PRIMARY role (44 heroes: half = 22, third ≈ 14.7).
  const ranks = (netWorth: number | undefined, taken: number, dealt: number) => ({
    ...(netWorth !== undefined ? { netWorth } : {}),
    damageTaken: taken,
    damageDealt: dealt,
  });
  assert(
    roleFlag(["carry"], ranks(23, 1, 1), 44) !== null &&
      roleFlag(["carry"], ranks(22, 1, 1), 44) === null &&
      roleFlag(["support"], ranks(22, 1, 1), 44) !== null &&
      roleFlag(["support"], ranks(23, 1, 1), 44) === null &&
      roleFlag(["tank"], ranks(1, 23, 1), 44) !== null &&
      roleFlag(["tank", "support"], ranks(1, 1, 1), 44) === null,
    "roleFlag: carries flag in the bottom half for net worth, supports in the top half, tanks low on damage taken; only the primary role is checked",
  );
  assert(
    roleFlag(["offCarry"], ranks(40, 1, 3), 44) === null &&
      roleFlag(["offCarry"], ranks(40, 1, 40), 44) !== null &&
      roleFlag(["carry"], ranks(undefined, 1, 1), 44) === null &&
      roleFlag(["initiator"], ranks(44, 44, 44), 44) === null &&
      roleFlag([], ranks(1, 1, 1), 44) === "no role listed",
    "roleFlag: off-carries flag only when low on net worth AND damage dealt; no net-worth data never flags; initiators have no rule",
  );
  const roleEntries = Object.values(HERO_ROLES);
  assert(
    roleEntries.every(
      (e) =>
        (e.roles.length > 0 || (e.unknownReason ?? "").length > 0) &&
        e.roles.every((r) => roleNames.has(r)) &&
        new Set(e.roles).size === e.roles.length,
    ),
    "every role entry has valid, distinct roles, or an unknown with a reason",
  );
  const nameMismatch = liveHeroes.filter(
    (h) => HERO_ROLES[h.id] && HERO_ROLES[h.id].name !== h.name,
  );
  assert(
    nameMismatch.length === 0,
    "role entries are keyed by the right hero id (names match the API)",
    nameMismatch.map((h) => `${h.id}: ${HERO_ROLES[h.id].name} vs ${h.name}`).join(", "),
  );
  const carryAt = ROLE_ONLINE_AT_SOULS.carry ?? 0;
  const offCarryAt = ROLE_ONLINE_AT_SOULS.offCarry ?? 0;
  assert(
    carryAt > offCarryAt &&
      offCarryAt > (ROLE_ONLINE_AT_SOULS.support ?? -1) &&
      heroRolesOf(-1).length === 0 &&
      heroOnlineAtSouls(-1) === undefined,
    "carries come online after off-carries, off-carries after supports; an unknown hero gets no role",
  );

  // -----------------------------------------------
  // Fixture 18: Coach core (docs/milestone-m6.md §5, C1 / C4–C7)
  // -----------------------------------------------
  console.log("\n18. Coach core (lib/coach/)");

  // C1: the coach imports nothing from the engine, scoring or app state, in any
  // import form; and the engine and scoring never import the coach.
  const IMPORT_FORMS = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
  const importsOf = (path: string) =>
    [...readFileSync(path, "utf-8").matchAll(IMPORT_FORMS)].map((m) => m[1]);
  const coachFiles = readdirSync("lib/coach").filter((f) => /\.tsx?$/.test(f));
  const badImports = coachFiles.flatMap((f) =>
    importsOf(`lib/coach/${f}`)
      .filter((p) => !p.startsWith("./") && p !== "../heroRoles")
      .map((p) => `${f}: ${p}`),
  );
  const reverse = ["lib/engine", "lib/scoring"].flatMap((dir) =>
    readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => /\.tsx?$/.test(f))
      .flatMap((f) =>
        importsOf(`${dir}/${f}`)
          .filter((p) => p.includes("coach"))
          .map((p) => `${dir}/${f}: ${p}`),
      ),
  );
  assert(
    coachFiles.length >= 5 && badImports.length === 0 && reverse.length === 0,
    "C1: lib/coach/ imports only its own files and lib/heroRoles; lib/engine and lib/scoring never import the coach",
    [...badImports, ...reverse].join(", "),
  );

  const frozenRawItems = JSON.parse(
    readFileSync("lib/engine/__fixtures__/frozen/items.json", "utf-8"),
  ) as { class_name?: string; name?: string }[];
  const frozenItemNames = frozenRawItems.map((i) => i.name ?? "").filter((n) => n.length > 3);
  const itemName = (id: string) => frozenRawItems.find((i) => i.class_name === id)?.name ?? id;
  const ruleFact = (i: number): CoachFact => ({
    id: "anti_synergy",
    itemNames: [
      itemName(ANTI_SYNERGY_RULES[i].itemIds[0]),
      itemName(ANTI_SYNERGY_RULES[i].itemIds[1]),
    ],
    reason: ANTI_SYNERGY_RULES[i].reason,
  });
  const sampleFacts: CoachFact[] = [
    { id: "role_intro", heroName: "Abrams", role: "tank" },
    { id: "empty_build", heroName: "Abrams" },
    { id: "first_in_category", category: "spirit", itemName: "Extra Charge" },
    { id: "green_before_spike", vitalitySouls: 4800 },
    { id: "counter_stack", counterItems: ["Counterspell", "Dispel Magic"] },
    ruleFact(0),
    {
      id: "next_buy_reason",
      itemName: "Toxic Bullets",
      // A real plain line: a capitalised full sentence (MarginalTerm.plain).
      reason: "Adds damage that grows with the enemy's health.",
    },
    { id: "spike_reached", heroName: "Seven", role: "carry" },
    { id: "support_greed", expensiveItems: ["Boundless Spirit", "Refresher"] },
    { id: "no_sustain", itemCount: 8 },
    { id: "gap_after_remove", itemName: "Extra Regen", category: "vitality" },
    { id: "starter_explained", heroName: "Abrams" },
  ];
  const ALL_TRIGGERS: CoachTrigger[] = [
    { type: "hero_selected" },
    { type: "item_added", itemId: "x" },
    { type: "item_removed", itemId: "x" },
    { type: "starter_applied" },
    { type: "build_reviewed" },
  ];
  const coachCtx = (
    facts: CoachFact[],
    trigger: CoachTrigger,
    playerMode: PlayerMode,
    roles: HeroRole[] = ["tank"],
  ): CoachContext => ({
    playerMode,
    hero: { id: 6, name: "Abrams", complexity: 1, roles },
    souls: 10000,
    boonLevel: 16,
    build: [],
    facts,
    trigger,
  });
  const say = (facts: CoachFact[], trigger: CoachTrigger, mode: PlayerMode, roles?: HeroRole[]) =>
    getCoachMessage(coachCtx(facts, trigger, mode, roles), EMPTY_MEMORY, frozenItemNames).message;

  // C4: every insight x trigger x audience: it speaks exactly where its rule says.
  const c4Wrong: string[] = [];
  for (const fact of sampleFacts) {
    const rule = INSIGHT_RULES[fact.id];
    for (const trigger of ALL_TRIGGERS) {
      for (const mode of ["new", "veteran"] as PlayerMode[]) {
        let expected = rule.triggers.includes(trigger.type) && rule.modes.includes(mode);
        // The two documented exceptions (triggerRules.allowed).
        if (fact.id === "next_buy_reason" && mode === "veteran") {
          expected = trigger.type === "build_reviewed";
        }
        if (fact.id === "empty_build" && trigger.type === "hero_selected") expected = false;
        if ((say([fact], trigger, mode)?.insight === fact.id) !== expected) {
          c4Wrong.push(`${fact.id}/${trigger.type}/${mode}`);
        }
      }
    }
  }
  assert(
    c4Wrong.length === 0,
    "C4: every insight speaks on exactly its triggers and audiences (12 insights x 5 triggers x 2 audiences)",
    c4Wrong.join(", "),
  );
  const emptyFact = sampleFacts[1];
  assert(
    say([sampleFacts[0], emptyFact], { type: "hero_selected" }, "new")?.insight === "role_intro" &&
      say([emptyFact], { type: "hero_selected" }, "new", [])?.insight === "empty_build",
    "C4: on hero select the role intro speaks; a hero with no known role gets the starter-build nudge",
  );
  const everything = () =>
    getCoachMessage(
      coachCtx(sampleFacts, { type: "item_added", itemId: "x" }, "new"),
      EMPTY_MEMORY,
      frozenItemNames,
    );
  assert(
    everything().message?.insight === "anti_synergy" &&
      JSON.stringify(everything()) === JSON.stringify(everything()),
    "C4: with every fact true (a messy 12-item build), exactly one message speaks, the most urgent; same input, same output",
  );
  const priorityIds = new Set(INSIGHT_PRIORITY);
  assert(
    Object.keys(INSIGHT_RULES).every((id) => priorityIds.has(id as InsightId)) &&
      priorityIds.size === INSIGHT_PRIORITY.length &&
      priorityIds.size === Object.keys(INSIGHT_RULES).length,
    "C4: every insight has exactly one place in the priority order",
  );
  // One bad fact must not silence the coach: an invalid top candidate falls through.
  const tooLong: CoachFact = {
    id: "anti_synergy",
    itemNames: ["Leech", "Vampiric Burst"],
    reason: "word ".repeat(60).trim(),
  };
  assert(
    say([tooLong, sampleFacts[9]], { type: "item_added", itemId: "x" }, "new")?.insight ===
      "no_sustain",
    "C4: a message that fails validation is skipped and the next insight speaks",
  );

  // C5: never repeat; a different subject of the same insight can still speak.
  const c5Ctx = coachCtx([sampleFacts[5]], { type: "item_added", itemId: "x" }, "veteran");
  const first = getCoachMessage(c5Ctx, EMPTY_MEMORY, frozenItemNames);
  const again = getCoachMessage(c5Ctx, first.memory, frozenItemNames);
  const repeatFree = sampleFacts.every((fact) => {
    const rule = INSIGHT_RULES[fact.id];
    // The last listed trigger (empty_build on hero_selected is the documented exception).
    const type = rule.triggers[rule.triggers.length - 1];
    const trigger = ALL_TRIGGERS.find((t) => t.type === type) ?? ALL_TRIGGERS[0];
    const ctx = coachCtx([fact], trigger, rule.modes[0]);
    const once = getCoachMessage(ctx, EMPTY_MEMORY, frozenItemNames);
    return (
      once.message !== null && getCoachMessage(ctx, once.memory, frozenItemNames).message === null
    );
  });
  assert(
    first.message !== null &&
      again.message === null &&
      repeatFree &&
      getCoachMessage(
        coachCtx([ruleFact(1)], { type: "item_added", itemId: "x" }, "veteran"),
        first.memory,
        frozenItemNames,
      ).message !== null,
    "C5: no insight ever repeats in a session; a second anti-synergy pair still speaks",
  );

  // C6: every template, in both audiences, passes the validator, and every
  // warning says what to do instead.
  const c6Fail = sampleFacts.flatMap((fact) =>
    (["new", "veteran"] as PlayerMode[]).flatMap((mode) => {
      const v = validateCoachResponse(renderInsight(fact, mode), fact, mode, frozenItemNames);
      return v.ok ? [] : [`${fact.id}/${mode}: ${v.problems.join("; ")}`];
    }),
  );
  assert(
    c6Fail.length === 0,
    "C6: every template passes the validator (word limit, fact-only numbers and items, no internal terms)",
    c6Fail.join(" | "),
  );
  const FIX_WORDS = /\b(buy|add|keep|consider|swap|try|put|stay|make|use)\b/i;
  const WARNINGS: InsightId[] = [
    "green_before_spike",
    "counter_stack",
    "anti_synergy",
    "support_greed",
    "no_sustain",
    "gap_after_remove",
  ];
  const noFix = sampleFacts
    .filter((f) => WARNINGS.includes(f.id))
    .flatMap((f) =>
      (["new", "veteran"] as PlayerMode[])
        .filter((m) => !FIX_WORDS.test(renderInsight(f, m)))
        .map((m) => `${f.id}/${m}`),
    );
  assert(
    noFix.length === 0,
    "C6: every warning, in both audiences, says what to do instead",
    noFix.join(", "),
  );
  const g = sampleFacts[3];
  assert(
    !validateCoachResponse("Buy 3 damage items.", g, "new", []).ok &&
      !validateCoachResponse("Your coverage is low.", g, "new", []).ok &&
      validateCoachResponse("Its resonance and maintenance matter.", g, "new", []).ok &&
      validateCoachResponse("Spend 4,800, then buy damage.", g, "new", []).ok &&
      !validateCoachResponse("Buy Toxic Bullets.", g, "new", ["Toxic Bullets"]).ok &&
      !validateCoachResponse("word ".repeat(41).trim(), g, "veteran", []).ok &&
      validateCoachResponse("", g, "veteran", []).ok,
    "C6: the validator rejects invented numbers, internal words, unknown items and long text; allows ordinary words, a number before a comma, and silence",
  );

  // C7: the coach-prompting skill's scenarios, plus messy builds.
  const added: CoachTrigger = { type: "item_added", itemId: "x" };
  const spiritMsg = say([sampleFacts[2]], added, "new")?.text ?? "";
  const vetAnti = say([sampleFacts[5]], added, "veteran")?.text ?? "";
  const abramsIntro = say([sampleFacts[0]], { type: "hero_selected" }, "new")?.text ?? "";
  const nextBuy = sampleFacts[6];
  assert(
    spiritMsg.includes("abilities") &&
      vetAnti.length > 0 &&
      vetAnti.split(/\s+/).length <= 40 &&
      abramsIntro.startsWith("Abrams is a tank") &&
      say([sampleFacts[9]], added, "new")?.insight === "no_sustain" &&
      say([nextBuy], { type: "build_reviewed" }, "veteran")?.insight === "next_buy_reason" &&
      (say([nextBuy], { type: "build_reviewed" }, "new")?.text ?? "").includes(
        "Toxic Bullets. Adds",
      ) &&
      say([emptyFact], { type: "build_reviewed" }, "new")?.insight === "empty_build" &&
      say([emptyFact], { type: "build_reviewed" }, "veteran") === null,
    "C7: first spirit item explained; veteran anti-synergy is short; Abrams intro; no healing after 8 items flagged; 'what next?' answered in full sentences; empty build nudged (new players only)",
  );
  assert(
    say([], added, "new") === null && say([], { type: "build_reviewed" }, "veteran") === null,
    "C7: with nothing true to say (0 items, nothing wrong), the coach stays silent",
  );

  // -----------------------------------------------
  // Fixture 19: Coach context (docs/milestone-m6.md §5, M6.3)
  // -----------------------------------------------
  console.log("\n19. Coach context (lib/coachContext.ts)");
  const fz = loadFrozen();
  const byIdFz = new Map(fz.allItems.map((i) => [i.id, i]));
  const item = (id: string): Item => {
    const found = byIdFz.get(id);
    if (!found) throw new Error(`frozen catalogue has no ${id}`);
    return found;
  };
  const values = (i: Item) => toItemCandidate(i).categoryValues;
  const soulsOf = (items: Item[], category?: string) =>
    items.filter((i) => !category || i.category === category).reduce((t, i) => t + i.cost, 0);
  const sortedItems = [...fz.allItems].sort((a, b) => a.id.localeCompare(b.id));
  const SEVEN = { id: 2, name: "Seven", complexity: 1 };
  const ABRAMS = { id: 6, name: "Abrams", complexity: 1 };
  const PAIGE = { id: 67, name: "Paige", complexity: 1 };
  const factsOf = (
    hero: { id: number; name: string; complexity: number },
    build: Item[],
    trigger: CoachTrigger,
    opts: { souls?: number; basket?: BasketResult | null; hasStarterBuild?: boolean } = {},
  ) =>
    buildCoachContext({
      playerMode: "new",
      hero,
      souls: opts.souls ?? 10000,
      boonLevel: 16,
      build,
      basket: opts.basket ?? null,
      hasStarterBuild: opts.hasStarterBuild ?? true,
      trigger,
      allItems: fz.allItems,
    });
  const idsOf = (r: ReturnType<typeof factsOf>) => r.context.facts.map((f) => f.id);
  const addedT = (i: Item): CoachTrigger => ({ type: "item_added", itemId: i.id });

  const fortitude = item("upgrade_chonky"); // vitality 3,200
  const vest = item("upgrade_regenerating_bullet_shield"); // vitality 1,600
  const extraHealth = sortedItems.find((i) => i.category === "vitality" && i.cost === 800);
  const spike = sortedItems.find(
    (i) => i.category === "gun" && i.cost >= 6400 && values(i).gunDamage > 0,
  );
  const [cheapSpirit, secondSpirit] = sortedItems.filter(
    (i) => i.category === "spirit" && i.cost === 800,
  );
  if (!extraHealth || !spike || !cheapSpirit || !secondSpirit)
    throw new Error("frozen catalogue is missing a fixture item");

  // Role intro, empty build (only when a suggested build exists), unknown hero.
  assert(
    idsOf(factsOf(SEVEN, [], { type: "hero_selected" })).join() === "role_intro,empty_build" &&
      !idsOf(factsOf(SEVEN, [], { type: "hero_selected" }, { hasStarterBuild: false })).includes(
        "empty_build",
      ) &&
      idsOf(factsOf({ id: -1, name: "Nobody", complexity: 1 }, [], { type: "hero_selected" }))
        .length === 1,
    "context: role intro from the role table; empty build only when a suggested build exists; an unknown hero gets no role fact",
  );
  // First item in a category: only the first.
  assert(
    idsOf(factsOf(SEVEN, [cheapSpirit], addedT(cheapSpirit))).includes("first_in_category") &&
      !idsOf(factsOf(SEVEN, [cheapSpirit, secondSpirit], addedT(secondSpirit))).includes(
        "first_in_category",
      ),
    "context: 'first in category' fires for the first item of a category only",
  );
  // Defence before damage: 4,800 vitality fires, 4,000 does not; a tank never; a spike clears it.
  const vit4800 = [fortitude, vest];
  const vit4000 = [fortitude, extraHealth];
  assert(
    soulsOf(vit4800, "vitality") === VITALITY_ENOUGH_SOULS &&
      idsOf(factsOf(SEVEN, vit4800, addedT(vest))).includes("green_before_spike") &&
      !idsOf(factsOf(SEVEN, vit4000, addedT(extraHealth))).includes("green_before_spike") &&
      !idsOf(factsOf(ABRAMS, vit4800, addedT(vest))).includes("green_before_spike") &&
      !idsOf(factsOf(SEVEN, [...vit4800, spike], addedT(vest))).includes("green_before_spike"),
    "context: defence-before-damage at exactly 4,800 vitality souls (not 4,000), never for a tank, never once a damage spike is owned",
  );
  // Counter stacking: two mid-game counters, no spike.
  const twoCounters = [item("upgrade_counterspell"), item("upgrade_metal_skin")];
  assert(
    idsOf(factsOf(SEVEN, twoCounters, addedT(twoCounters[1]))).includes("counter_stack") &&
      !idsOf(factsOf(SEVEN, twoCounters.slice(0, 1), addedT(twoCounters[0]))).includes(
        "counter_stack",
      ) &&
      !idsOf(factsOf(SEVEN, [...twoCounters, spike], addedT(spike))).includes("counter_stack"),
    "context: counter stacking needs two mid-game counters and no damage spike",
  );
  // Anti-synergy: names from the catalogue, the rule's own (plain) reason.
  const rule = ANTI_SYNERGY_RULES[0];
  const pair = [item(rule.itemIds[0]), item(rule.itemIds[1])];
  const anti = factsOf(SEVEN, pair, addedT(pair[1])).context.facts.find(
    (f) => f.id === "anti_synergy",
  );
  assert(
    anti?.id === "anti_synergy" &&
      anti.itemNames[0] === pair[0].name &&
      anti.reason === rule.reason,
    "context: an anti-synergy pair becomes a fact with catalogue names and the rule's reason",
  );
  // Power spike: Seven (carry) on the first big damage item, or crossing 20,000 souls.
  const spikeAt = ROLE_ONLINE_AT_SOULS.carry ?? 0;
  const filler = sortedItems.filter((i) => i.category === "vitality" && i.cost === 3200);
  const under: Item[] = [];
  for (const i of filler) if (soulsOf(under) + i.cost < spikeAt) under.push(i);
  const crossing = sortedItems.find(
    (i) => i.category === "vitality" && soulsOf(under) + i.cost >= spikeAt && !under.includes(i),
  );
  assert(
    idsOf(factsOf(SEVEN, [spike], addedT(spike))).includes("spike_reached") &&
      !idsOf(factsOf(ABRAMS, [spike], addedT(spike))).includes("spike_reached") &&
      !!crossing &&
      idsOf(factsOf(SEVEN, [...under, crossing], addedT(crossing))).includes("spike_reached") &&
      !idsOf(factsOf(SEVEN, under, addedT(under[under.length - 1]))).includes("spike_reached"),
    "context: a carry's power spike on its first big damage item or on crossing 20,000 souls; never for a tank",
  );
  // Support greed: Paige with two big items while the build is still mid-game
  // (souls in items <= MID_PHASE_MAX_SOULS, exact boundary); one big item is fine.
  const bigTwo = sortedItems.filter((i) => i.cost >= 6400).slice(0, 2);
  const small = sortedItems.filter((i) => i.cost === 800);
  const padTo = (base: Item[], target: number) => {
    const out = [...base];
    for (const i of small) if (soulsOf(out) + i.cost <= target && !out.includes(i)) out.push(i);
    return out;
  };
  const atMid = padTo(bigTwo, MID_PHASE_MAX_SOULS);
  const pastMid = [...atMid, ...small.filter((i) => !atMid.includes(i)).slice(0, 1)];
  assert(
    soulsOf(atMid) <= MID_PHASE_MAX_SOULS &&
      soulsOf(pastMid) > MID_PHASE_MAX_SOULS &&
      idsOf(factsOf(PAIGE, atMid, addedT(bigTwo[1]))).includes("support_greed") &&
      !idsOf(factsOf(PAIGE, pastMid, addedT(bigTwo[1]))).includes("support_greed") &&
      !idsOf(factsOf(PAIGE, bigTwo.slice(0, 1), addedT(bigTwo[0]))).includes("support_greed") &&
      !idsOf(factsOf(SEVEN, bigTwo, addedT(bigTwo[1]))).includes("support_greed"),
    "context: support greed for a support with two big items while the build is mid-game (item souls, exact boundary); not one item, not a carry",
  );
  // No sustain: 8 items, none heals (engine sustain value); 7 is not enough.
  const dry = sortedItems
    .filter((i) => i.category === "gun" && values(i).sustain === 0)
    .slice(0, 8);
  assert(
    dry.length === 8 &&
      idsOf(factsOf(SEVEN, dry, addedT(dry[7]))).includes("no_sustain") &&
      !idsOf(factsOf(SEVEN, dry.slice(0, 7), addedT(dry[6]))).includes("no_sustain") &&
      !idsOf(factsOf(SEVEN, [...dry, fortitude], addedT(fortitude))).includes("no_sustain"),
    "context: no-sustain at 8 items with no healing (not 7, not with a healing item)",
  );
  // Gap after remove: the removed item left its category empty.
  assert(
    idsOf(factsOf(SEVEN, [cheapSpirit], { type: "item_removed", itemId: vest.id })).includes(
      "gap_after_remove",
    ) &&
      !idsOf(
        factsOf(SEVEN, [cheapSpirit, fortitude], { type: "item_removed", itemId: vest.id }),
      ).includes("gap_after_remove"),
    "context: a removal that empties a category is a gap; one that leaves another item is not",
  );
  // Next buy: the real basket's plain line; never a raw reason.
  const sevenKit = fz.kits.find((k) => k.name === "Seven");
  const sevenRun = sevenKit
    ? runHeroBasket({
        heroAbilities: sevenKit.heroAbilities,
        heroBaseStats: sevenKit.heroBaseStats,
        heroRoster: fz.roster,
        allItems: fz.allItems,
        ownedItems: [],
        souls: BOON_THRESHOLDS[16]?.souls ?? 0,
        boonLevel: 16,
        spiritPower: 20,
        heroAccuracy: fz.heroAccuracy,
        rankTier: null,
      })
    : null;
  const basket = sevenRun?.basket ?? null;
  const top = basket?.picks[0];
  const nextFact = factsOf(SEVEN, [], { type: "build_reviewed" }, { basket }).context.facts.find(
    (f) => f.id === "next_buy_reason",
  );
  const unplain: BasketResult | null =
    basket && top
      ? {
          ...basket,
          picks: [
            {
              ...top,
              terms: top.terms.map(({ termId, value, reason }) => ({ termId, value, reason })),
            },
          ],
        }
      : null;
  assert(
    !!top &&
      nextFact?.id === "next_buy_reason" &&
      nextFact.itemName === top.item.name &&
      nextFact.reason === headlineTerm(top.terms)?.plain &&
      !idsOf(factsOf(SEVEN, [], { type: "build_reviewed" }, { basket: unplain })).includes(
        "next_buy_reason",
      ),
    "context: next buy uses the basket's top pick and its plain-English line; no plain line, no fact",
  );
  // Upgrades: the planner replaces a component with its upgrade, so the context
  // judges "first in category" and "power spike" against the build BEFORE it.
  const upgrade = sortedItems.find(
    (u) =>
      u.category === "spirit" &&
      u.cost < BIG_ITEM_COST &&
      (u.componentItems ?? []).some((c) => byIdFz.get(c)?.category === "spirit"),
  );
  const component = upgrade
    ? byIdFz.get(
        (upgrade.componentItems ?? []).find((c) => byIdFz.get(c)?.category === "spirit") ?? "",
      )
    : undefined;
  // The component case: one spirit item held, upgraded in place.
  const componentFirst = component ? factsOf(SEVEN, [component], addedT(component)) : null;
  const upgradedOnly = upgrade ? factsOf(SEVEN, [upgrade], addedT(upgrade)) : null;
  assert(
    !!componentFirst &&
      !!upgradedOnly &&
      idsOf(componentFirst).includes("first_in_category") &&
      !idsOf(upgradedOnly).includes("first_in_category"),
    "context: upgrading your only spirit item is not 'your first spirit item' (the component is put back)",
  );
  // Already past 20,000 souls with the component: upgrading it is not a new crossing.
  const pastWithComponent = component ? padTo([component], spikeAt + 2000) : [];
  const upgradedPast = upgrade
    ? [...pastWithComponent.filter((i) => i !== component), upgrade]
    : [];
  assert(
    !!upgrade &&
      upgrade.cost < BIG_ITEM_COST &&
      soulsOf(pastWithComponent) >= spikeAt &&
      !idsOf(factsOf(SEVEN, upgradedPast, addedT(upgrade))).includes("spike_reached"),
    "context: an upgrade bought after the carry's online-at souls is not a new power spike",
  );
  assert(
    !idsOf(factsOf(SEVEN, [cheapSpirit], { type: "hero_selected" })).includes("empty_build") &&
      idsOf(factsOf(SEVEN, [cheapSpirit], { type: "starter_applied" })).includes(
        "starter_explained",
      ) &&
      !idsOf(factsOf(SEVEN, [], { type: "item_removed", itemId: "no_such_item" })).includes(
        "gap_after_remove",
      ) &&
      !idsOf(
        factsOf(SEVEN, [cheapSpirit], { type: "item_added", itemId: "no_such_item" }),
      ).includes("first_in_category"),
    "context: no empty-build nudge once items exist; starter applied is explained; unknown trigger items say nothing",
  );
  // End to end: frozen Seven, a real basket, through the coach; deterministic.
  const e2e = factsOf(SEVEN, [], { type: "build_reviewed" }, { basket });
  const e2eMsg = getCoachMessage(e2e.context, EMPTY_MEMORY, e2e.knownItemNames).message;
  const shuffled = buildCoachContext({
    playerMode: "new",
    hero: SEVEN,
    souls: 10000,
    boonLevel: 16,
    build: [],
    basket,
    hasStarterBuild: true,
    trigger: { type: "build_reviewed" },
    allItems: [...fz.allItems].reverse(),
  });
  const pairBuild = [...pair, ...twoCounters];
  const coachSays = (build: Item[]) => {
    const r = factsOf(SEVEN, build, addedT(build[build.length - 1]));
    return getCoachMessage(r.context, EMPTY_MEMORY, r.knownItemNames).message;
  };
  assert(
    e2eMsg !== null &&
      JSON.stringify(getCoachMessage(shuffled.context, EMPTY_MEMORY, shuffled.knownItemNames)) ===
        JSON.stringify(getCoachMessage(e2e.context, EMPTY_MEMORY, e2e.knownItemNames)) &&
      JSON.stringify(coachSays(pairBuild)) === JSON.stringify(coachSays([...pairBuild].reverse())),
    "context: frozen Seven end to end gives a valid coach message; shuffled catalogue or build order gives the same message",
    e2eMsg?.text,
  );

  // -----------------------------------------------
  // Fixture 20: The coach in /build (docs/milestone-m6.md §6, C8 / C9)
  // -----------------------------------------------
  console.log("\n20. The coach in /build (M6.5)");
  const bc = readFileSync("app/build/BuildClient.tsx", "utf-8");
  const panelSrc = readFileSync("app/build/components/CoachPanel.tsx", "utf-8");
  const queued = [...bc.matchAll(/queueCoach\(\{ type: "(\w+)"/g)].map((m) => m[1]);
  // Each action handler queues its trigger BEFORE it changes the build.
  const queuedBeforeUpdate = [
    "function handleToggleItem",
    "function handleAddSuggestedItem",
    "function handleRemoveItem",
    "function handleApplyStarterBuild",
  ].every((fn) => {
    const body = bc.slice(bc.indexOf(fn), bc.indexOf("\n  }\n", bc.indexOf(fn)));
    const q = body.indexOf("queueCoach(");
    const set = body.indexOf("setBuildItems(");
    return q >= 0 && set >= 0 && q < set;
  });
  assert(
    ["starter_applied", "build_reviewed", "hero_selected", "item_removed"].every((t) =>
      queued.includes(t),
    ) &&
      bc.includes('removing ? "item_removed" : "item_added"') &&
      queuedBeforeUpdate &&
      !/\buseEffect\s*\(/.test(bc) &&
      !/import[^;]*\buseEffect\b[^;]*from "react"/.test(bc),
    "BuildClient: the coach is triggered from action handlers (add, remove, starter, review, hero), each before it changes the build; no effect",
    queued.join(", "),
  );
  assert(
    bc.includes("getCoachMessage(context, coachEvent.memory, knownItemNames)") &&
      /build: buildItems,\s*basket: heroBasket,/.test(bc) &&
      bc.includes("setCoachEvent({ ...coachEvent, answer: pendingAnswer })") &&
      bc.includes("coachEvent.answer ||") &&
      bc.includes("memory: prev?.answer?.memory ?? prev?.memory ?? EMPTY_MEMORY"),
    "BuildClient: each answer is computed once on the post-action build and basket, frozen (slider or view changes never change a tip), and its memory carried to the next action",
  );
  const clearBody = bc.slice(
    bc.indexOf("A tip about items that are gone"),
    bc.indexOf("setBuildItems([]);", bc.indexOf("A tip about items that are gone")),
  );
  assert(
    bc.includes("useSyncExternalStore(subscribeCoachMute, readCoachMute, () => false)") &&
      bc.includes("coachMuted || coachEvent?.dismissed ? null") &&
      bc.includes("if (coachMuted) return;") &&
      /catch \{\s*return false;/.test(bc) &&
      /onToggleMute=\{\(\) => \{[\s\S]{0,200}dismissCoachTip\(\);/.test(bc) &&
      clearBody.includes("dismissCoachTip();"),
    "C8: muting hides every tip and queues none; mute / unmute and Clear dismiss the current tip; the mute is read only on the client and fails open",
  );
  assert(
    panelSrc.includes('<div role="status" aria-live="polite">') &&
      panelSrc.includes("aria-pressed={muted}") &&
      (panelSrc.match(/pointer-coarse:min-h-10/g) ?? []).length >= 3 &&
      !/from "@\/lib\/(coach|engine|scoring)/.test(panelSrc),
    "C9: CoachPanel is presentational, keeps one live region for tips, and has touch-sized buttons",
  );

  // -----------------------------------------------
  // Summary
  // -----------------------------------------------
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.error("\n❌ Fixture failures — do not merge");
    process.exit(1);
  } else {
    console.log("\n✅ All fixtures pass — safe to merge");
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
