// src/scripts/mini.ts — Deadlock Foundry regression harness
// Run: npm run mini
// Required to pass before any PR merge

import { getItems } from "@/lib/itemStore";
import { scoreItems } from "@/lib/scoring/scoreItems";
import { calculateStatTotals } from "@/lib/buildCalculations";
import { serializeBuild, deserializeBuild } from "@/lib/buildSerializer";
import { getBoonThreshold, getAbilityPointsAtSouls } from "@/lib/boonSystem";
import { resolveAddItem, getConsumedComponents, getEffectiveAddCost } from "@/lib/buildUtils";

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

    // Discount: buying Soaring Spirit with Extra Spirit already in build is cheaper
    const costWithExtra = getEffectiveAddCost(soaringSpirit, buildWithExtra, items);
    const costWithout = getEffectiveAddCost(soaringSpirit, [], items);
    assert(costWithExtra < costWithout, `Discount applied: ${costWithExtra} < ${costWithout}`);
    assert(
      costWithExtra === soaringSpirit.cost - extraSpirit.cost,
      `Exact discount correct: ${costWithExtra} (full price ${soaringSpirit.cost} - component ${extraSpirit.cost})`,
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

  // BaseAttackDamagePercent feeds weaponDamageFlat/gun totals and the "burst" tag
  // (replaces the dead "BulletDamage" key — Valve renamed it upstream)
  const hollowPoint = items.find((i) => i.id === "upgrade_hollow_point_rounds");
  if (hollowPoint) {
    const hollowPointTotals = calculateStatTotals([hollowPoint]);
    assert(
      hollowPointTotals.weaponDamageFlat === 35,
      `Hollow Point Rounds weaponDamageFlat via BaseAttackDamagePercent: ${hollowPointTotals.weaponDamageFlat}`,
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

  // Sell refund is 50%
  const { getSellRefund } = await import("@/lib/buildCalculations");
  assert(getSellRefund(500) === 250, "Sell refund 50%: 500 → 250");
  assert(getSellRefund(1000) === 500, "Sell refund 50%: 1000 → 500");
  assert(getSellRefund(3000) === 1500, "Sell refund 50%: 3000 → 1500");

  // -----------------------------------------------
  // Fixture 6: Boon system
  // -----------------------------------------------
  console.log("\n6. Boon system");
  // At 0 souls: no threshold met, fallback is BOON_THRESHOLDS[0] (boonLevel 1)
  const boonBelow = getBoonThreshold(500);
  assert(
    boonBelow.boonLevel === 1,
    `Boon level 1 at 500 souls (below first threshold): got ${boonBelow.boonLevel}`,
  );

  const boonAt600 = getBoonThreshold(600);
  assert(
    boonAt600.boonLevel === 1,
    `Boon level 1 at exactly 600 souls: got ${boonAt600.boonLevel}`,
  );

  const boonAt3600 = getBoonThreshold(3600);
  assert(boonAt3600.boonLevel === 7, `Boon level 7 at 3600 souls: got ${boonAt3600.boonLevel}`);
  assert(boonAt3600.isUltimateUnlock, "Ultimate unlocks at 3600 souls");

  const pointsAt3600 = getAbilityPointsAtSouls(3600);
  assert(pointsAt3600 === 3, `3 ability points at 3600 souls: got ${pointsAt3600}`);

  const boonAt2800 = getBoonThreshold(2800);
  assert(boonAt2800.boonLevel === 6, `Boon level 6 at 2800 souls: got ${boonAt2800.boonLevel}`);
  assert(
    boonAt2800.abilityPoints === 3,
    `3 ability points at 2800 souls: got ${boonAt2800.abilityPoints}`,
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
    boonLevel: 10,
  };

  const encoded = serializeBuild(testState);
  assert(typeof encoded === "string" && encoded.length > 0, "Serialized to non-empty string");

  const decoded = deserializeBuild(encoded);
  assert(decoded.heroId === testState.heroId, "heroId round-trips");
  assert(decoded.itemIds.length === 2, "itemIds round-trip");
  assert(decoded.boonLevel === 10, "boonLevel round-trips");
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
    boonLevel: 0,
  });
  const minimalDecoded = deserializeBuild(minimalEncoded);
  assert(!!minimalDecoded, "Minimal state deserializes without crash");
  assert(minimalDecoded.heroId === "test", "Minimal heroId round-trips");
  assert(minimalDecoded.boonLevel === 0, "Minimal boonLevel 0 round-trips");

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
