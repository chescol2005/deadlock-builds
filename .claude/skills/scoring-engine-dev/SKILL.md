---
name: scoring-engine-dev
description: >
  Author and modify the deterministic scoring engine for Deadlock Foundry.
  Use this skill whenever touching lib/scoring/scoreItems.ts,
  lib/scoring/goalWeights.ts, lib/scoring/antiSynergy.ts, lib/categoryBonuses.ts,
  lib/engine/engine.ts, or lib/engine/stages/*. Also use when adding a new
  build goal or item tag, changing tag weights, adding a scoring stage,
  adjusting the investment/category bonus, or debugging why item ranking or
  suggestions look wrong or non-deterministic. Trigger on "scoring", "score
  items", "goal weights", "anti-synergy", "ranking", "suggested items",
  "engine stage", or "why is this item ranked here". Read this BEFORE writing
  scoring code — the architecture rules here are non-negotiable, and any
  scoring change must be paired with a fixture via the fixture-driven-dev skill.
---

# Scoring Engine Development Skill

## Non-Negotiable Architecture Rules

These come straight from CLAUDE.md and are not up for debate:

1. **Pure functions only.** Same inputs → same output, every time. No `Date.now()`,
   no `Math.random()`, no network, no reading global mutable state.
2. **Deterministic-first: NO AI logic in scoring — ever.** Scoring is the
   trustworthy, explainable core. The AI coach never participates in it.
3. **Scoring never imports from `lib/coach/`.** The dependency arrow only points
   coach → (reads pre-computed values). Never the reverse.
4. **AI-layer changes and scoring changes go in SEPARATE PRs.** If a change
   touches both, split it. Reviewers reject mixed PRs.
5. **TypeScript strict:** zero `any`, zero suppressed errors.

> Paths: real tree is `lib/…` (no `src/`), despite CLAUDE.md examples.

---

## Two scoring surfaces — know which you're in

- **`lib/scoring/scoreItems.ts`** — the shipped ranker. `ScoredItem[]` with a
  per-tag `scoreBreakdown` and a human `reason`. Tag-weight based.
- **`lib/engine/`** — a staged pipeline (`ScoringStage[]`, `EngineInput` →
  `EngineOutput`) with `SCORE_CATEGORIES` and `IntentWeights`. Each stage
  implements `score(input, candidate): StageScore`.

Both must obey the rules above. When adding logic, put it in the surface that
already owns that concept; don't duplicate a weight table across both.

---

## Verified signature (do not guess)

```typescript
scoreItems(items: Item[], goal: BuildGoal, currentBuild: Item[]): ScoredItem[]
// 3 args, not 4. currentBuild is used for exclusion + category-investment context.
```

Items already in `currentBuild` (by `item.id`) are filtered OUT of results.

---

## Deterministic tie-breaking recipe

Ranking MUST be stable — equal scores can never reorder between runs. Mirror the
existing `scoreItems` sort exactly:

```typescript
scored.sort((a, b) => {
  if (b.score !== a.score) return b.score - a.score; // 1. score desc
  if (a.item.cost !== b.item.cost) return a.item.cost - b.item.cost; // 2. cost asc
  return a.item.id.localeCompare(b.item.id); // 3. id asc (stable)
});
```

Any new ranking you add needs a final total-order tiebreaker (`id.localeCompare`
is the canonical one). A sort that can leave two items in undefined order is a bug
— the "tie-breaking is deterministic" fixture will catch it.

---

## Additive-bonus pattern (never mutate base weights)

Bonuses layer ON TOP of tag weights; they never rewrite them. Example from the
real category-investment bonus:

```typescript
// souls in this category approaching the 4,800 threshold → 1.3x multiplier
if (isApproachingSignificantBonus(soulsInCategory)) {
  const bonus = score * 0.3;
  scoreBreakdown.thresholdBonus = bonus; // recorded separately in the breakdown
  score += bonus; // added, base tag weights untouched
}
```

Always record the contribution in `scoreBreakdown` so the score stays fully
explainable — a veteran must be able to see _why_ an item ranked where it did.

Relevant constants (CLAUDE.md, verified): `SIGNIFICANT_THRESHOLD = 4800`,
`MAX_INVESTMENT = 28800`. See `lib/categoryBonuses.ts`.

---

## In-file dev fixture assertion

`scoreItems.ts` runs a self-check at module load in non-production:

```typescript
if (process.env.NODE_ENV !== "production") {
  // assert: top burst item wins for "burst" goal; excluded items don't reappear;
  // threshold bonus actually raises score. console.error on failure.
}
```

When you change scoring behavior, update these inline assertions too — they are
the fastest smoke test and run on every dev boot. They complement, not replace,
the mini.ts fixtures.

---

## Adding a goal / tag / stage — the moving parts

- **New `BuildGoal`:** add to `GOAL_WEIGHTS_MAP` in `lib/scoring/goalWeights.ts`.
  Every goal must define a weight for every `ItemTag` — the "all goals have
  weights defined" fixture enforces completeness.
- **New `ItemTag`:** update `ALL_TAGS` in `scoreItems.ts`, the `labels` map in
  `buildReason`, tag derivation in `lib/itemNormalizer.ts`, and every goal's
  weights. Miss one and items silently score 0 for it.
- **New engine stage:** implement `ScoringStage` (`stageId` + `score`), keep it
  pure, and return populated `reasons` so the breakdown stays explainable.

---

## Anti-synergy

`detectAntiSynergies()` in `lib/scoring/antiSynergy.ts` flags conflicting item
pairs. It is deterministic and additive (a penalty/warning), and — like
everything here — never calls the coach. New conflict pairs need a fixture:
"no conflicts → empty" and "known pair → warning".

---

## Before you're done (mandatory)

Any scoring change requires a regression fixture. Hand off to the
**fixture-driven-dev** skill:

- [ ] Added/updated a fixture case for the new behavior (don't remove existing cases).
- [ ] `npm run mini` passes all fixtures.
- [ ] No import from `lib/coach/`; no AI logic added.
- [ ] Scoring changes are in their own PR, separate from any AI-layer change.
- [ ] `npx tsc --noEmit` clean (zero `any`).
