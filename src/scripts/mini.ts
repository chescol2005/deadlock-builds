// src/scripts/mini.ts — Deadlock Foundry regression harness
// Run: npm run mini
// Required to pass before any PR merge

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { getItems } from "@/lib/itemStore";
import type { AbilityUpgradeTier } from "@/lib/abilityCoefficients";
import { calculateStatTotals } from "@/lib/buildCalculations";
import { serializeBuild, deserializeBuild } from "@/lib/buildSerializer";
import type { BuildState } from "@/lib/buildSerializer";
import { getBoonThreshold, getAbilityPointsAtSouls, getAbilityUnlockOrder } from "@/lib/boonSystem";
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
