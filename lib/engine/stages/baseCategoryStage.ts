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

import type { EngineInput, ItemCandidate, ScoreCategory, ScoringStage, StageScore } from "../types";
import { SCORE_CATEGORIES } from "../types";

// Intent key → ScoreCategory mapping.
// Not all intent keys map 1:1 to score categories; this makes the
// relationship explicit rather than relying on string coincidence.
//
// `burst` maps to BOTH damage categories at FULL weight each (not split
// between them). The gunDamage/spiritDamage split exists so a hero need
// vector can distinguish them (Milestone E) — it is not a signal that a
// generic "burst" intent cares about one more than the other. Mapping both at
// full weight makes a candidate's total damage contribution invariant to how
// it divides damage between the two, which is what keeps the pre-split
// fixtures valid.
const INTENT_TO_CATEGORIES: Readonly<Record<string, ReadonlyArray<ScoreCategory>>> = {
  // Shred serves the same goal as raw damage for a generic offensive intent,
  // so it maps alongside it here; the split exists for the hero-need vector's
  // coverage targets (see types.ts), not for this preset-driven path.
  burst: ["gunDamage", "spiritDamage", "gunShred", "spiritShred"],
  sustain: ["sustain"],
  // Same reasoning as `burst` above: `tankiness` split into bonusHealth/resist
  // so a hero need vector can weight them differently (EHP is multiplicative —
  // see types.ts), but a generic "tank" intent wants both at full weight, which
  // keeps a candidate's total defensive contribution invariant to the split.
  tank: ["bonusHealth", "resist", "shield"],
  mobility: ["mobility"],
  utility: ["utility", "antiHeal"],
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
        if (INTENT_TO_CATEGORIES[intentKey]?.includes(cat)) {
          intentWeight += weight;
        }
      }

      // Economy category is unweighted by intent — it's always considered.
      // Items with economy value are always partially credited.
      const effectiveWeight = cat === "economy" ? 1 : intentWeight;

      if (effectiveWeight === 0) continue;

      const contribution = rawValue * effectiveWeight;
      byCategory[cat] = contribution;
      total += contribution;

      reasons.push(
        `${cat}: ${rawValue.toFixed(2)} × ${effectiveWeight.toFixed(3)} = ${contribution.toFixed(3)}`,
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
