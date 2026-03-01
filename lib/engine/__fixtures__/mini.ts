// lib/engine/__fixtures__/mini.ts
//
// Smoke test + regression harness for the scoring engine.
// Uses the real stage implementations — not stubs.
//
// Run with:  npx ts-node --project tsconfig.json lib/engine/__fixtures__/mini.ts
// or wire into a test runner script if added to package.json.

import { recommendItems } from "../engine";
import { baseCategoryStage } from "../stages/baseCategoryStage";
import { intentWeightStage } from "../stages/intentWeightStage";
import type { EngineInput, EngineOutput, ItemCandidate } from "../types";

// ---------------------------------------------
// Candidates
// ---------------------------------------------
const candidates: ReadonlyArray<ItemCandidate> = [
  {
    itemId: "item_a",
    name: "Burst Blade",
    cost: 3000,
    categoryValues: { damage: 80, tankiness: 10, sustain: 0, mobility: 5, utility: 0, economy: 0 },
    tags: ["burst", "damage"],
  },
  {
    itemId: "item_b",
    name: "Tank Shield",
    cost: 2800,
    categoryValues: { damage: 10, tankiness: 90, sustain: 0, mobility: 0, utility: 0, economy: 0 },
    tags: ["tank", "armor"],
  },
  {
    itemId: "item_c",
    name: "Balanced Boots",
    cost: 2500,
    categoryValues: { damage: 40, tankiness: 20, sustain: 20, mobility: 20, utility: 0, economy: 0 },
    tags: ["mobility", "speed"],
  },
  {
    itemId: "item_d",
    name: "Lifedrain Pendant",
    cost: 3200,
    categoryValues: { damage: 20, tankiness: 0, sustain: 95, mobility: 0, utility: 10, economy: 5 },
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

  const ok = topId === tc.expect.topItemId &&
    (tc.expect.minFinalScore === undefined || (top?.finalScore ?? 0) >= tc.expect.minFinalScore);

  if (ok) {
    console.log(`  ✅ ${tc.label}`);
    passed++;
  } else {
    console.error(`  ❌ ${tc.label}`);
    console.error(`     expected top: ${tc.expect.topItemId}, got: ${topId}`);
    console.error(`     scores: ${output.recommendations.map(r => `${r.item.itemId}=${r.finalScore.toFixed(4)}`).join(" | ")}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

// ---------------------------------------------
// Verbose dump for the first test case (burst)
// ---------------------------------------------
console.log("\n--- Verbose output: pure burst ---");
const verboseOutput: EngineOutput = recommendItems(
  testCases[0].input,
  candidates,
  [baseCategoryStage, intentWeightStage]
);
console.log(JSON.stringify(verboseOutput, null, 2));