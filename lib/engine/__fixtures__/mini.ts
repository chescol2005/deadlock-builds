import { recommendItems } from "../engine";
import type {
  EngineInput,
  EngineOutput,
  ItemCandidate,
  ScoringStage,
  StageScore,
} from "../types";

const BASE_STAGE_ID = "base-category" as const;
const INTENT_STAGE_ID = "intent-weight" as const;

// ---------------------------------------------
// Fake Candidates
// ---------------------------------------------
const candidates: ReadonlyArray<ItemCandidate> = [
  {
    itemId: "item_a",
    name: "Burst Blade",
    cost: 3000,
    categoryValues: {
      damage: 80,
      survivability: 10,
      mobility: 5,
      utility: 0,
      economy: 0,
    },
    tags: ["damage"],
  },
  {
    itemId: "item_b",
    name: "Tank Shield",
    cost: 2800,
    categoryValues: {
      damage: 10,
      survivability: 90,
      mobility: 0,
      utility: 0,
      economy: 0,
    },
    tags: ["tank"],
  },
  {
    itemId: "item_c",
    name: "Balanced Boots",
    cost: 2500,
    categoryValues: {
      damage: 40,
      survivability: 40,
      mobility: 20,
      utility: 0,
      economy: 0,
    },
    tags: ["mobility"],
  },
];

// ---------------------------------------------
// Stage 1: Raw Category Sum
// ---------------------------------------------
const baseCategoryStage: ScoringStage = {
  stageId: BASE_STAGE_ID,
  score(_input: EngineInput, candidate: ItemCandidate): StageScore {
    const total =
      candidate.categoryValues.damage +
      candidate.categoryValues.survivability +
      candidate.categoryValues.mobility +
      candidate.categoryValues.utility +
      candidate.categoryValues.economy;

    return {
      stageId: BASE_STAGE_ID,
      byCategory: candidate.categoryValues,
      total,
      reasons: ["Base category sum"],
    };
  },
};

// ---------------------------------------------
// Stage 2: Intent-weighted Score (simple, deterministic)
// Maps intent keys -> categories in a transparent way.
// ---------------------------------------------
const intentStage: ScoringStage = {
  stageId: INTENT_STAGE_ID,
  score(input: EngineInput, candidate: ItemCandidate): StageScore {
    // NOTE: simple v1 mapping for smoke test purposes
    const weighted =
      candidate.categoryValues.damage * input.intent.burst +
      candidate.categoryValues.survivability * input.intent.tank +
      candidate.categoryValues.mobility * input.intent.mobility +
      candidate.categoryValues.utility * input.intent.utility;

    return {
      stageId: INTENT_STAGE_ID,
      byCategory: {},
      total: weighted,
      reasons: ["Intent-weighted total"],
    };
  },
};

// ---------------------------------------------
// Sample Input
// ---------------------------------------------
const input: EngineInput = {
  heroId: "hero_test",
  intent: {
    burst: 1,
    sustain: 0,
    tank: 0,
    mobility: 0,
    utility: 0,
  },
  currentItems: [],
};

// ---------------------------------------------
// Run Engine
// ---------------------------------------------
const output: EngineOutput = recommendItems(input, candidates, [
  baseCategoryStage,
  intentStage,
]);

console.log("ENGINE SMOKE TEST OUTPUT");
console.log(JSON.stringify(output, null, 2));

// Optional: quick sanity expectation
console.log("Top item:", output.recommendations[0]?.item.itemId);