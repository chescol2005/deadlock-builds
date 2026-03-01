 // lib/engine/stages/intentWeightStage.ts
//
// Stage 2: Intent Tag Bonus
//
// Rewards items whose tags align with the player's dominant intent.
// This is an additive bonus on top of baseCategoryStage — not a multiplier.
// Keeping it additive preserves score comparability and explainability.
//
// Design constraints:
// - Bonus is bounded: max contribution is TAG_BONUS_PER_MATCH * MAX_TAGS_SCORED
// - Only the dominant intent (highest normalized weight) drives tag matching
// - Ties in dominant intent are broken by INTENT_KEYS order (deterministic)
// - Tags are matched case-insensitively
// - No tag match = zero score from this stage (not penalized)

import type {
  EngineInput,
  IntentKey,
  ItemCandidate,
  ScoringStage,
  StageScore,
} from "../types";
import { INTENT_KEYS } from "../types";

// How much score each matching tag contributes.
// Keep this smaller than a typical baseCategoryStage contribution so the
// tag bonus influences ranking without overriding stat-based scoring.
const TAG_BONUS_PER_MATCH = 0.05;

// Cap the number of tags scored to prevent tag-stuffed items from
// dominating purely on quantity.
const MAX_TAGS_SCORED = 3;

// Canonical tag sets per intent key.
// Tags are lowercase. Items must include at least one of these to qualify.
const INTENT_TAGS: Readonly<Record<IntentKey, ReadonlyArray<string>>> = {
  burst:    ["burst", "nuke", "one-shot", "amp", "damage"],
  sustain:  ["sustain", "lifesteal", "regen", "heal", "drain"],
  tank:     ["tank", "armor", "shield", "barrier", "endure"],
  mobility: ["mobility", "dash", "speed", "blink", "move"],
  utility:  ["utility", "slow", "silence", "stun", "debuff", "cc"],
};

function getDominantIntent(intent: EngineInput["intent"]): IntentKey {
  let best: IntentKey = INTENT_KEYS[0];
  let bestWeight = -1;

  // INTENT_KEYS order provides deterministic tie-breaking
  for (const key of INTENT_KEYS) {
    const w = intent[key];
    if (Number.isFinite(w) && w > bestWeight) {
      bestWeight = w;
      best = key;
    }
  }

  return best;
}

export const intentWeightStage: ScoringStage = {
  stageId: "intentWeightStage",

  score(input: EngineInput, candidate: ItemCandidate): StageScore {
    const dominantIntent = getDominantIntent(input.intent);
    const dominantWeight = input.intent[dominantIntent];
    const targetTags = INTENT_TAGS[dominantIntent];

    const normalizedCandidateTags = candidate.tags.map((t) => t.toLowerCase());

    let matchCount = 0;
    const matchedTags: string[] = [];

    for (const tag of targetTags) {
      if (matchCount >= MAX_TAGS_SCORED) break;
      if (normalizedCandidateTags.includes(tag)) {
        matchedTags.push(tag);
        matchCount++;
      }
    }

    if (matchCount === 0) {
      return {
        stageId: "intentWeightStage",
        byCategory: {},
        total: 0,
        reasons: [`no tag match for dominant intent: ${dominantIntent}`],
      };
    }

    // Scale bonus by dominant intent weight so a weakly-held intent
    // produces a proportionally smaller bonus.
    const bonus = TAG_BONUS_PER_MATCH * matchCount * dominantWeight;

    return {
      stageId: "intentWeightStage",
      byCategory: {},  // tag bonus doesn't attribute to a specific category
      total: bonus,
      reasons: [
        `dominant intent: ${dominantIntent} (weight ${dominantWeight.toFixed(3)})`,
        `matched tags [${matchedTags.join(", ")}]: ${matchCount} × ${TAG_BONUS_PER_MATCH} × ${dominantWeight.toFixed(3)} = ${bonus.toFixed(4)}`,
      ],
    };
  },
};