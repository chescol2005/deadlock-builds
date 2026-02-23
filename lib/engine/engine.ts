// Deterministic scoring engine entry point.
// lib/engine/engine.ts
import type {
  EngineInput,
  EngineOutput,
  ItemCandidate,
  ItemRecommendation,
  ScoringStage,
  ScoreCategory,
} from "./types";
import { SCORE_CATEGORIES } from "./types";

// Deterministic scoring engine entry point.
export function recommendItems(
  input: EngineInput,
  candidates: ReadonlyArray<ItemCandidate>,
  stages: ReadonlyArray<ScoringStage>
): EngineOutput {
  const normalizedIntent = normalizeIntent(input.intent);

  const recommendations: ItemRecommendation[] = candidates.map((candidate) => {
    const stageScores = stages.map((s) =>
      s.score({ ...input, intent: normalizedIntent }, candidate)
    );

    const breakdown = aggregateStageScores(stageScores);
    const finalScore = breakdown.total;

    const reasons = stageScores.flatMap((s) => s.reasons);

    return {
      item: candidate,
      finalScore,
      breakdown,
      stageScores,
      reasons,
    };
  });

  recommendations.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (a.item.cost !== b.item.cost) return a.item.cost - b.item.cost;
    return a.item.itemId.localeCompare(b.item.itemId);
  });

  return {
    version: 1,
    normalizedIntent,
    recommendations,
  };
}

function normalizeIntent(intent: EngineInput["intent"]): EngineInput["intent"] {
  const entries = Object.entries(intent) as Array<[string, number]>;
  const sum = entries.reduce((acc, [, v]) => acc + (Number.isFinite(v) ? v : 0), 0);

  // Fail safe: if all weights are 0/invalid, return as-is (or equally distribute later)
  if (sum <= 0) return intent;

  // Preserve keys; normalize values deterministically
  return Object.fromEntries(
    entries.map(([k, v]) => [k, (Number.isFinite(v) ? v : 0) / sum])
  ) as EngineInput["intent"];
}

function aggregateStageScores(stageScores: ReadonlyArray<{ byCategory: Partial<Record<ScoreCategory, number>>; total: number }>) {
  const byCategory: Partial<Record<ScoreCategory, number>> = {};
  let total = 0;

  for (const s of stageScores) {
    total += s.total;

    for (const cat of SCORE_CATEGORIES) {
      const v = s.byCategory[cat];
      if (typeof v === "number" && Number.isFinite(v)) {
        byCategory[cat] = (byCategory[cat] ?? 0) + v;
      }
    }
  }

  return { byCategory, total };
}