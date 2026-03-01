// lib/engine/stages/baseCategoryStage.ts
//
// Stage 1: Base Category Score
//
// Computes a weighted dot product of item categoryValues against normalized
// player intent. This is the primary deterministic signal — no heuristics,
// no tag-matching, no conditional logic beyond the math.
//
// Score formula per category:
//   contribution = categoryValue * intentWeight
//
// Final stage total = sum of all category contributions

import type {
  EngineInput,
  ItemCandidate,
  ScoreCategory,
  ScoringStage,
  StageScore,
} from "../types";
import { SCORE_CATEGORIES } from "../types";

// Intent key → ScoreCategory mapping.
// Not all intent keys map 1:1 to score categories; this makes the
// relationship explicit rather than relying on string coincidence.
const INTENT_TO_CATEGORY: Readonly<Record<string, ScoreCategory>> = {
  burst:    "damage",
  sustain:  "sustain",    // now distinct
  tank:     "tankiness",  // now distinct
  mobility: "mobility",
  utility:  "utility",
} as const;

export const baseCategoryStage: ScoringStage = {
  stageId: "baseCategoryStage",

  score(input: EngineInput, candidate: ItemCandidate): StageScore {
    const byCategory: Partial<Record<ScoreCategory, number>> = {};
    const reasons: string[] = [];
    let total = 0;

    for (const cat of SCORE_CATEGORIES) {
      const rawValue = candidate.categoryValues[cat];
      if (!Number.isFinite(rawValue) || rawValue === 0) continue;

      // Sum all intent weights that map to this category.
      let intentWeight = 0;
      for (const [intentKey, weight] of Object.entries(input.intent)) {
        if (INTENT_TO_CATEGORY[intentKey] === cat) {
          intentWeight += weight;
        }
      }

      // Economy category is unweighted by intent — it's always considered.
      // Items with economy value are always partially credited.
      const effectiveWeight =
        cat === "economy" ? 1 : intentWeight;

      if (effectiveWeight === 0) continue;

      const contribution = rawValue * effectiveWeight;
      byCategory[cat] = contribution;
      total += contribution;

      reasons.push(
        `${cat}: ${rawValue.toFixed(2)} × ${effectiveWeight.toFixed(3)} = ${contribution.toFixed(3)}`
      );
    }

    return {
      stageId: "baseCategoryStage",
      byCategory,
      total,
      reasons,
    };
  },
};