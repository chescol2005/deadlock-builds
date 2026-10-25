---
name: fixture-driven-dev
description: >
  Write, run, and extend fixture-based regression tests for Deadlock
  Foundry using the mini.ts harness. Use this skill whenever adding new
  scoring logic, fixing a bug in buildUtils or buildCalculations, adding
  a new item category or goal weight, changing the BuildState shape,
  working on the boon system, or any time you need to verify that a code
  change didn't break existing behavior. Also use when asked to "add a
  fixture", "write a regression test", "validate a fix", or "check if
  mini passes". Always run mini.ts before marking any task complete.
  This skill is mandatory before any PR is opened.
---

# Fixture-Driven Development Skill

## What mini.ts Is

`npm run mini` is the project's regression harness. It runs deterministic
fixtures against the core lib functions and prints pass/fail summaries. It is
the final gate before any merge. Fixture counts change constantly — never
hardcode one; read the summary lines.

```bash
npm run mini          # standard run
npx tsx src/scripts/mini.ts       # first harness only
npx tsx lib/engine/__fixtures__/mini.ts   # engine harness only
```

Output must be pasted in the PR body before merge. Every PR.

---

## Two harnesses

`npm run mini` = `npx tsx src/scripts/mini.ts && npx tsx lib/engine/__fixtures__/mini.ts`.

| Harness                           | Covers                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `src/scripts/mini.ts`             | `lib/scoring`, build utils/calculations/serializer, boons, normalizer, guide data |
| `lib/engine/__fixtures__/mini.ts` | `lib/engine` (hero need, basket selection, effect estimator, item adapter)        |

New fixtures go in the harness that covers the code you changed. Each prints its
own summary (`=== N passed, 0 failed ===` and `N passed, 0 failed`). Because of
`&&`, a failure in the first hides the second — **read BOTH summary lines**,
not just the exit code. The first harness loads live item data via
`getItems()`; the engine harness must not touch the network.

### Engine fixture conventions

- **Hermetic.** No live API calls; pass synthetic inputs (e.g. a synthetic
  `Map<number, ItemAnalytics>`, never `getItemAnalytics()`).
- **One `HeroBaseStats` literal: `mkHero()`.** When adding a field to
  `HeroBaseStats`, default it in `mkHero()` to a value meaning "no adjustment",
  so existing fixtures that spread-override other fields
  (`{ ...mkHero(...), bulletDamage }`) are not silently changed.
- **Behaviour-flip fixtures run with and without the term**, e.g.
  `DEFAULT_BASKET_TERMS.filter((t) => t.termId !== "x")`, with the numbers
  worked out beforehand so the flip is real, not coincidental.
- **No debug console output** left in fixtures beyond the pass/fail lines.

---

## When to Run mini.ts

Run after **any** change to these files:

```
src/lib/buildUtils.ts
src/lib/buildCalculations.ts
src/lib/buildSerializer.ts
lib/scoring/antiSynergy.ts
lib/engine/* (also check `npm run baseline`)
src/lib/boonSystem.ts
src/lib/heroStats.ts
src/lib/abilityCoefficients.ts
src/lib/categoryBonuses.ts
src/lib/itemNormalizer.ts
```

Also run after any change to **types** — a type change that seems
safe often breaks downstream pure functions in non-obvious ways.

---

## Fixture Case Anatomy

Each fixture case has this shape:

```typescript
interface FixtureCase {
  name: string; // descriptive, searchable
  description: string; // what behavior is being tested
  fn: () => FixtureResult; // the test function
}

interface FixtureResult {
  passed: boolean;
  actual: unknown;
  expected: unknown;
  message?: string; // shown on failure
}
```

A minimal fixture case:

```typescript
{
  name: "resolveAddItem — adds tier 1 gun to empty build",
  description: "Resolves adding a tier-1 gun item to an empty BuildState",
  fn: () => {
    const item = MOCK_GUN_T1;
    const build = EMPTY_BUILD;
    const result = resolveAddItem(build, item);
    const passed = result.buildItems.length === 1 &&
                   result.buildItems[0].id === item.id;
    return {
      passed,
      actual: result.buildItems.length,
      expected: 1,
    };
  },
}
```

---

## Mock Data Patterns

Always use the canonical mock objects. Do not create one-off test items
inline — they diverge from real API shape and cause false passes.

```typescript
// Canonical mocks (define once at top of mini.ts, reuse everywhere)

const EMPTY_BUILD: BuildState = {
  heroId: "hero-1",
  buildItems: [],
  assignmentMap: new Map(),
  categories: [],
  abilityLevels: {},
  manualBoonLevel: 0,
};

const MOCK_GUN_T1: Item = {
  id: "item-gun-t1",
  name: "Basic Magazine",
  category: "gun",
  tier: 1,
  cost: 500,
  shop_image_webp: "/mock.webp",
  shop_image: "/mock.png",
  component_items: [],
  // ... all required fields with realistic values
};

const MOCK_SPIRIT_T2: Item = {
  /* ... */
};
const MOCK_VITALITY_T2: Item = {
  /* ... */
};
const MOCK_GUN_T3_UPGRADES_T1: Item = {
  // item that component_items includes MOCK_GUN_T1.id
};
```

**Field accuracy rules for mocks:**

- `item.id` must be a string (not a number)
- `item.category` must be `"gun"` | `"spirit"` | `"vitality"` (not `"weapon"`)
- `item.component_items` must be string[] of classnames (can be empty)
- Never use `item.classname` as the identifier in mock lookups

---

## Coverage Requirements

The fixture cases must cover these areas. When adding new cases,
fill gaps in this coverage map first:

### buildUtils.ts (target: 12 cases)

- [ ] `resolveAddItem` — empty build
- [ ] `resolveAddItem` — build with existing items
- [ ] `resolveAddItem` — upgrade chain resolves (component consumed)
- [ ] `resolveAddItem` — active count at cap (12) blocks active add
- [ ] `getConsumedComponents` — no upgrades (empty)
- [ ] `getConsumedComponents` — one upgrade (size === 1)
- [ ] `getConsumedComponents` — multiple upgrades
- [ ] `getEffectiveAddCost` — no components owned
- [ ] `getEffectiveAddCost` — one component owned (discount)
- [ ] `getEffectiveAddCost` — all components owned (max discount)
- [ ] Sell refund calculation (50%)
- [ ] Active vs game plan cap behavior

### buildCalculations.ts (target: 10 cases)

- [ ] `calculateStatTotals` — empty build returns hero base stats
- [ ] `calculateStatTotals` — gun items sum correctly
- [ ] `calculateStatTotals` — spirit items sum TechPower + TechPowerPercent
- [ ] `calculateDamageSplit` — pure gun build
- [ ] `calculateDamageSplit` — pure spirit build
- [ ] `calculateDamageSplit` — mixed build
- [ ] `calculateSoulTimeline` — phase breakpoints correct
- [ ] `getSkillPathGrid` — ability unlock boon levels match constants

### scoring (target: 12 cases)

- [ ] `detectAntiSynergies` — no synergy conflicts returns empty
- [ ] `detectAntiSynergies` — known conflict pair returns warning
- [ ] Tie-breaking is deterministic (same input = same order always)

### boonSystem.ts (target: 8 cases)

- [ ] `getBoonThreshold(0)` returns boonLevel 1 (not 0)
- [ ] `getBoonThreshold` — ultimate unlock at boon level 8, 3,800 souls
- [ ] Soul cost at each ability tier (600 / 1200 / 2100)
- [ ] `getAbilityPointsAtSouls` — below first threshold = 0
- [ ] `getAbilityPointsAtSouls` — at exact threshold
- [ ] `getAbilityPointsAtSouls` — between thresholds
- [ ] Boon level 35 (max) doesn't throw
- [ ] `calculateStatsAtBoon` — returns hero base stats at boon 0

### buildSerializer.ts (target: 8 cases)

- [ ] Serialize then deserialize = original BuildState (round-trip)
- [ ] Empty build serializes without error
- [ ] Build with all phases (early/mid/late) round-trips
- [ ] Sell priority flag survives round-trip
- [ ] Optional flag survives round-trip
- [ ] `BuildState.heroId` key (not "herold")
- [ ] URL string is URL-safe (no unencoded chars)
- [ ] Deserializing unknown item IDs handles gracefully

---

## Adding a New Fixture Case

1. Identify which coverage bucket the new case falls into
2. Write the case using the canonical mock objects
3. Add it to the matching harness (`mini.ts`) — **do not remove existing cases**
4. Run `npm run mini` and confirm your new case passes
5. If a previously passing case now fails, **stop and diagnose**
   before continuing — never comment out a failing fixture

---

## Diagnosing Fixture Failures

When a fixture fails, follow this order:

```
1. Read the failure message — actual vs expected
2. Run the failing function in isolation with console.log
3. Check if the mock data matches real API shape
   (common: item.id vs item.classname, category "weapon" vs "gun")
4. Check if a type change caused a silent shape mismatch
5. Check if the function signature changed (common after refactors)
   — verify against the verified signatures in CLAUDE.md
6. Fix the root cause — never adjust the fixture to match wrong behavior
```

**Red flags that mean "stop and ask":**

- More than 3 fixtures fail at once → likely a type or API change
- A serializer round-trip fixture fails → BuildState shape changed
- A scoring fixture fails on tie-breaking → determinism broken

---

## PR Checklist

Before opening any PR:

Run the full gate in `ship-check` (prettier --check, tsc, eslint, next build,
mini). Never bare `prettier --write .` — `--write` only changed files.

Paste the full `npm run mini` terminal output (both harnesses) in the PR body.
If any fixture fails, the PR must not be merged.
