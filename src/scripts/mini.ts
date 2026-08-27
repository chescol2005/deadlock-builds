// src/scripts/mini.ts — Deadlock Foundry regression harness
// Run: npm run mini
// Required to pass before any PR merge

import { readFileSync } from "node:fs";
import { getItems } from "@/lib/itemStore";
import type { AbilityUpgradeTier } from "@/lib/abilityCoefficients";
import { scoreItems } from "@/lib/scoring/scoreItems";
import { calculateStatTotals } from "@/lib/buildCalculations";
import { serializeBuild, deserializeBuild } from "@/lib/buildSerializer";
import { getBoonThreshold, getAbilityPointsAtSouls, getAbilityUnlockOrder } from "@/lib/boonSystem";
import {
  CAMPS,
  CAMP_MARKERS,
  GAME_MINUTE_COLUMNS,
  soulsAt,
  soulsPerMinEfficiency,
} from "@/lib/farming/campData";
import { normalizeItem } from "@/lib/itemNormalizer";
import type { UpgradeV2Raw } from "@/lib/api/deadlockApi";
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
  // Fixture 4: Scoring engine
  // -----------------------------------------------
  console.log("\n4. Scoring engine");
  const dpsResults = scoreItems(items, "dps", []);
  assert(dpsResults.length > 0, "scoreItems returns results for DPS goal");
  assert(
    dpsResults[0].item.category === "gun",
    "Top DPS item is gun category",
    `Got: ${dpsResults[0].item.category}`,
  );
  assert(
    dpsResults.every((r, i) => i === 0 || r.score <= dpsResults[i - 1].score),
    "Results are sorted descending by score (ties allowed)",
  );
  assert(
    typeof dpsResults[0].reason === "string" && dpsResults[0].reason.length > 0,
    "Reason string populated",
  );

  // Tie-breaking: equal-score items must resolve by cost ascending, then id ascending
  const tiedGroups = new Map<number, typeof dpsResults>();
  for (const r of dpsResults) {
    const group = tiedGroups.get(r.score) ?? [];
    group.push(r);
    tiedGroups.set(r.score, group);
  }
  const exampleTie = [...tiedGroups.values()].find((g) => g.length > 1);
  assert(!!exampleTie, "At least one score tie exists in DPS results (exercises tie-break path)");
  if (exampleTie) {
    const sortedByRule = [...exampleTie].sort(
      (a, b) => a.item.cost - b.item.cost || a.item.id.localeCompare(b.item.id),
    );
    assert(
      exampleTie.every((r, i) => r.item.id === sortedByRule[i].item.id),
      "Tied scores resolve by cost ascending, then id ascending",
      `Tied group: ${exampleTie.map((r) => `${r.item.id}(${r.item.cost})`).join(", ")}`,
    );
  }

  const tankResults = scoreItems(items, "tank", []);
  assert(
    tankResults[0].item.category === "vitality",
    "Top Tank item is vitality category",
    `Got: ${tankResults[0].item.category}`,
  );

  // Items already in build are excluded from results
  const firstDps = dpsResults[0].item;
  const dpsExcluded = scoreItems(items, "dps", [firstDps]);
  assert(
    !dpsExcluded.find((r) => r.item.id === firstDps.id),
    "Item already in build is excluded from results",
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
    "app/build/components/SuggestedItemsPanel.tsx",
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
    "app/build/components/SuggestedItemsPanel.tsx",
    "app/build/components/BuildSummaryPanel.tsx",
    "app/build/BuildClient.tsx",
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
