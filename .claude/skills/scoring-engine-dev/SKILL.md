---
name: scoring-engine-dev
description: >
  Author and modify the deterministic scoring engine for Deadlock Foundry.
  Use this skill whenever touching lib/scoring/scoreItems.ts,
  lib/scoring/goalWeights.ts, lib/scoring/antiSynergy.ts, lib/categoryBonuses.ts,
  lib/engine/engine.ts, lib/engine/stages/*, lib/engine/basketSelect.ts,
  lib/engine/heroNeed.ts, lib/engine/itemAdapter.ts,
  lib/engine/effectEstimator.ts, lib/engine/synergy.ts, or
  lib/engine/types.ts. Also use when adding a new build goal or item tag,
  changing tag weights, adding a scoring stage or basket marginal term,
  adjusting the investment/category bonus, or debugging why item ranking or
  suggestions look wrong or non-deterministic. Trigger on "scoring", "score
  items", "goal weights", "anti-synergy", "ranking", "suggested items",
  "engine stage", "basket", "need vector", "marginal term", "synergy", "hero
  need", or "why is this item ranked here". Read this BEFORE writing
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

> **Engine design record:** [engine-design-notes.md](engine-design-notes.md),
> next to this file. It is the full Milestone E-onward design history (moved out
> of CLAUDE.md). Read the section for the code you are touching before changing
> anything in `lib/engine/`.

---

## Three scoring surfaces — know which you're in

- **`lib/scoring/scoreItems.ts`** — the shipped independent ranker.
  `ScoredItem[]` with a per-tag `scoreBreakdown` and a human `reason`.
  Tag-weight based.
- **`lib/engine/engine.ts` + `stages/*`** — a staged pipeline
  (`ScoringStage[]`, `EngineInput` → `EngineOutput`) with `SCORE_CATEGORIES`
  and `IntentWeights`. Each stage implements `score(input, candidate): StageScore`.
- **Basket selection** — `constructBasket()` in `lib/engine/basketSelect.ts`:
  greedy joint selection of a SET of items against a hero need vector
  (`heroNeed.ts`), with `Item` → `ItemCandidate` via `itemAdapter.ts` /
  `effectEstimator.ts`. Marginal value is a sum of pluggable `MarginalTermFn`
  terms. Wired into `app/build/BuildClient.tsx` through `HeroBasketSuggestion`.

All must obey the rules above. When adding logic, put it in the surface that
already owns that concept; don't duplicate a weight table across them.

**Fixtures:** `lib/scoring/` is covered by `src/scripts/mini.ts`; `lib/engine/`
by a SEPARATE harness, `lib/engine/__fixtures__/mini.ts`. `npm run mini` chains
both — read the whole output, since a failure in the first masks the second.

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

## Adding a basket term (MarginalTermFn)

Terms live in `basketSelect.ts` and are summed by the greedy loop. Checklist,
each item with the existing term that shows it:

- [ ] **Bounded** as a fraction of one slot: `value = ... * X_MAX_FRACTION *
coverageScalePerSlot(ctx)` with a named `*_MAX_FRACTION` constant whose
      doc comment places it relative to the others (category bonus 0.15,
      synergy 0.10, proc-platform 0.10, analytics 0.06). See `analyticsTerm`.
- [ ] **Relevance-gated:** `if (computeCoverageGain(...).total <= 0) return null`
      so a bonus can never make a useless item worth buying. See `synergyTerm`.
- [ ] **Inert when its input is absent:** the input is an optional
      `BasketContext` field, sanitized in `makeBasketContext` (non-finite becomes
      `undefined`), and `evaluate` returns null without it. See
      `procPlatformTerm` / `hitReliabilityTerm`.
- [ ] **Differential signals are neutral at roster average:** factor 1 gives
      `delta === 0` and null, contributing nothing. See `procPlatformTerm`.
- [ ] **State FLAT or SCALED, and say honestly what it can override.** A flat
      bonus (`categoryBonusTerm`, `synergyTerm`) can beat an item with up to
      that fraction of a slot MORE coverage, not merely break ties. A scaled
      one (`procPlatformTerm`) is bounded by `delta * share * fraction`.
- [ ] **Inputs come from the hero and the ALREADY-OWNED build, never from other
      candidates** (circular selection). Owned items are not candidates and
      never appear in `state.picked`, so anything depending on them must come
      through ctx; see `ownedItemNames` in `synergyTerm`.
- [ ] **Registered in `DEFAULT_BASKET_TERMS`**, and the production call site in
      `app/build/BuildClient.tsx` checked: this changes live baskets.
- [ ] **Reason string names the concrete cause** (numbers, partner names, the
      mechanism) and is deterministic: no `toLocaleString`, no unsorted iteration.
- [ ] Engine fixture covers: fires, inert when absent, neutral at average,
      relevance gate, and the cap.

---

## Recurring bug classes in lib/engine

Each points to the section of [engine-design-notes.md](engine-design-notes.md)
(this skill's reference file, moved out of CLAUDE.md) that explains it. Do not
re-derive them.

- **Every per-hero signal needs a floor above zero** (`MIN_GUN_FACTOR`,
  `MIN_DEFENSIVE_NEED`); zero is unreachable behind the relevance gate. Notes —
  bold paragraph "Gun need is an INDEPENDENT signal" (under "Origin and architecture")
  and section "Item scoring coverage audit".
- **Missing data is not zero, and "unknown" is not "inapplicable".** See "Gun
  accuracy (rank-aware)".
- **Sentinel values constant across the whole catalogue are not stats.** Check
  a key's distribution before mapping it. Notes — section "Item scoring coverage audit".
- **Enemy-debuff keys are stored negative**; check the sign convention before
  adding to `STAT_KEY_TO_SCORE`. Notes — bold paragraph "Enemy resist reduction is
  offensive value stored as a negative" (under "Non-substitutable categories").
- **Duplicate stat keys** (`SpiritPower`/`TechPower`) must be fixed in EVERY
  module that reads them. See "Item values are NOT flat".
- **Calibrate a new percent stat** against an existing item in the same
  category. Notes — bold paragraph "Watch the scale when mapping a percent stat"
  (under "Non-substitutable categories").
- **Don't inflate per-item constants to fix pair/context value**; that is
  Milestone F. Notes — section `A "proc" is not always per-bullet — check for a cooldown`
  and bold paragraph "Some item value is CONTEXTUAL" (under "Non-substitutable categories").

---

## Live sanity check

After a behaviour change, do a one-time check against real API data: write a
throwaway `src/scripts/_tmp*.ts` that imports and calls the lib functions
(never reimplements them), run it with `npx tsx`, and delete it immediately.
Fixtures stay hermetic, with no live calls inside them. If the result matters
(rank moves, derived values), record it in engine-design-notes.md with the
numbers.

---

## Before you're done (mandatory)

Any scoring change requires a regression fixture. Hand off to the
**fixture-driven-dev** skill:

- [ ] Added/updated a fixture case for the new behavior (don't remove existing cases).
- [ ] Fixture is in the right harness: `src/scripts/mini.ts` for `lib/scoring/`,
      `lib/engine/__fixtures__/mini.ts` for `lib/engine/`.
- [ ] `npm run mini` passes BOTH harnesses (read the full output, not just the
      exit code).
- [ ] No import from `lib/coach/`; no AI logic added.
- [ ] Scoring changes are in their own PR, separate from any AI-layer change.
- [ ] `npx tsc --noEmit` clean (zero `any`).
