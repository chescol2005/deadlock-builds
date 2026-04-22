import type { Item, ItemCategory, ItemTag } from "../items";
import type { BuildGoal } from "./goalWeights";
import { getWeightsForGoal } from "./goalWeights";
import { isApproachingSignificantBonus } from "../categoryBonuses";

export type ScoredItemBreakdown = Record<ItemTag, number> & { thresholdBonus: number };

export type ScoredItem = {
  item: Item;
  score: number;
  scoreBreakdown: ScoredItemBreakdown;
  reason: string;
};

const ALL_TAGS: ItemTag[] = ["burst", "sustain", "tankiness", "mobility", "utility", "dps"];

function buildReason(breakdown: ScoredItemBreakdown): string {
  const contributing = ALL_TAGS.filter((t) => breakdown[t] > 0).sort(
    (a, b) => breakdown[b] - breakdown[a],
  );

  const top = contributing.slice(0, 2);
  if (top.length === 0) return "No matching tags for this goal";

  const labels: Record<ItemTag, string> = {
    burst: "Strong burst damage",
    sustain: "Good sustain",
    tankiness: "Solid tankiness",
    mobility: "High mobility",
    utility: "Good utility",
    dps: "High DPS",
  };

  return top.map((t) => labels[t]).join(", ");
}

export function scoreItems(items: Item[], goal: BuildGoal, currentBuild: Item[]): ScoredItem[] {
  const weights = getWeightsForGoal(goal);
  const buildIds = new Set(currentBuild.map((i) => i.id));

  const soulsPerCategory: Record<ItemCategory, number> = { gun: 0, vitality: 0, spirit: 0 };
  for (const it of currentBuild) soulsPerCategory[it.category] += it.cost;

  const scored: ScoredItem[] = items
    .filter((item) => !buildIds.has(item.id))
    .map((item) => {
      const scoreBreakdown: ScoredItemBreakdown = {
        ...(Object.fromEntries(ALL_TAGS.map((tag) => [tag, 0])) as Record<ItemTag, number>),
        thresholdBonus: 0,
      };

      let score = 0;
      for (const tag of item.tags) {
        const contribution = weights[tag];
        scoreBreakdown[tag] = contribution;
        score += contribution;
      }

      // Items in a category approaching the 4,800 significant bonus get a 1.3x multiplier.
      // This pushes toward locking in the investment bonus — additive context, not a change
      // to the base tag weights.
      const soulsInCategory = soulsPerCategory[item.category];
      if (isApproachingSignificantBonus(soulsInCategory)) {
        const bonus = score * 0.3;
        scoreBreakdown.thresholdBonus = bonus;
        score += bonus;
      }

      let reason = buildReason(scoreBreakdown);

      if (soulsInCategory < 4800 && soulsInCategory + item.cost >= 4800) {
        reason += " — reaches investment bonus threshold!";
      }

      return { item, score, scoreBreakdown, reason };
    });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.item.cost !== b.item.cost) return a.item.cost - b.item.cost;
    return a.item.id.localeCompare(b.item.id);
  });

  return scored;
}

// Dev-mode fixture assertion — runs once at module load in non-production environments.
if (process.env.NODE_ENV !== "production") {
  const fixture: Item[] = [
    {
      id: "fixture-burst",
      name: "Burst Blade",
      category: "gun",
      tier: 3,
      cost: 3000,
      tags: ["burst", "dps"],
      stats: { bulletDamage: 80 },
    },
    {
      id: "fixture-tank",
      name: "Iron Wall",
      category: "vitality",
      tier: 3,
      cost: 3000,
      tags: ["tankiness"],
      stats: { maxHealth: 300 },
    },
  ];

  const results = scoreItems(fixture, "burst", []);
  if (results[0]?.item.id !== "fixture-burst") {
    console.error(
      "[scoreItems fixture] FAILED: expected 'fixture-burst' as top result for burst goal, got:",
      results[0]?.item.id,
    );
  }

  // Verify exclusion: burst blade already in build should not appear
  const withExclusion = scoreItems(fixture, "burst", [
    {
      id: "fixture-burst",
      name: "Burst Blade",
      category: "gun",
      tier: 3,
      cost: 3000,
      tags: ["burst", "dps"],
      stats: { bulletDamage: 80 },
    },
  ]);
  if (withExclusion.some((r) => r.item.id === "fixture-burst")) {
    console.error(
      "[scoreItems fixture] FAILED: 'fixture-burst' should be excluded when already in currentBuild",
    );
  }

  // Verify threshold bonus: gun item scores higher when gun souls in 3200-4799 range
  const thresholdBuild: Item[] = [
    {
      id: "fixture-gun-spend",
      name: "Gun Spend",
      category: "gun",
      tier: 3,
      cost: 3200,
      tags: ["dps"],
      stats: {},
    },
  ];
  const baseScore = scoreItems(fixture, "burst", []).find(
    (r) => r.item.id === "fixture-burst",
  )!.score;
  const boostedScore = scoreItems(fixture, "burst", thresholdBuild).find(
    (r) => r.item.id === "fixture-burst",
  )!.score;
  if (boostedScore <= baseScore) {
    console.error(
      "[scoreItems fixture] FAILED: gun item should score higher when approaching 4800 threshold",
    );
  }
}
