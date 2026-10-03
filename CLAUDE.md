# Deadlock Foundry — Claude Code Project Memory

Competitive companion platform for Valve's game Deadlock.
Built with Next.js App Router, TypeScript strict mode,
Tailwind CSS, deployed on Vercel.

---

## Product Philosophy (read this first)

**Primary audience split:**

- **New players** — overwhelmed by item count, don't know hero strengths,
  need guidance and progressive disclosure
- **Veterans** — want full control, scoring transparency, share links,
  deep stat math

**Core UX principles:**

- New players should never see the full complexity at once — use
  progressive disclosure (simplified view → advanced toggle)
- The AI coach is a **proactive guide**, not a reactive evaluator —
  it surfaces warnings and suggestions _as you build_, not only when asked
- Every panel should answer "why does this matter?" not just "what is this?"
- Difficulty labels, archetype tags, and plain-English tooltips are
  first-class features, not nice-to-haves

**What success looks like:**
A new player can pick a hero, get a working starter build, and understand
what each item does for them — without reading a wiki.
A veteran can tune every parameter and share a fully-annotated build URL.

---

## Architecture Rules (NON-NEGOTIABLE)

- TypeScript strict mode: zero `any`, zero suppressed errors
- No business logic in page files — components and lib only
- All build state flows through the BuildClient route (Build-05 contract)
- Deterministic-first: NO AI logic in scoring, calculations,
  or data pipeline — ever
- AI layer changes and scoring changes must be in **separate PRs**
- All scoring functions are pure — same inputs always same output
- AI coach lives in its own module: `lib/coach/` (not yet created —
  planned for M6) — never bleeds into scoring or build state

---

## Before Every Commit (mandatory, in this order)

```bash
npx prettier --write .
npx tsc --noEmit
npx next build
npm run mini
```

Kill dev server before finishing any session.
Never use `git add .` — stage files explicitly.
Paste `mini.ts` fixture output in every PR body before merge.

---

## Production API — Verified Function Signatures

Verified by mini.ts. Do not guess — use these exactly.

```typescript
// Items
item.id; // string identifier (NOT item.classname)
item.category; // "gun" | "spirit" | "vitality" (NOT "weapon")

// Scoring
scoreItems(items, goal, currentBuild); // 3 args, not 4

// Build utils
resolveAddItem(currentBuild, newItem); // 2 args
getConsumedComponents(currentBuild); // 1 arg
getEffectiveAddCost(item, currentBuild, allItems); // 3 args

// Boon system
getBoonThreshold(0); // returns boonLevel: 1 (not 0)
// Consumed components after upgrade: size === 1 (tracked)

// Serializer
BuildState.heroId; // "heroId" not "herold"
```

---

## Data Source

All game data: `https://api.deadlock-api.com/v1/assets` (unauthenticated)

`https://assets.deadlock-api.com/v2/...` still works but 301-redirects here —
call the canonical host directly, don't rely on the redirect.

```typescript
GET / v1 / assets / items; // all items
GET / v1 / assets / items / by - slot - type / { slot }; // weapon | spirit | vitality
GET / v1 / assets / heroes / { id }; // hero stats + scaling
GET / v1 / assets / items / by - hero - id / { id }; // hero abilities
```

### Item field names (commonly confused)

```typescript
item.shop_image_webp; // ✓ correct shop icon
item.shop_image; // ✓ fallback
item.image_webp; // ✗ wrong — generic mod art

item.component_items; // string[] of classnames this builds FROM
item.upgradesInto; // string[] derived post-normalization

item.item_slot_type; // "weapon" | "spirit" | "vitality" in API
item.category; // "gun" | "spirit" | "vitality" normalized
```

### Hero difficulty / archetype fields (Milestone C)

`DeadlockHeroDetail` (single-hero fetch) already returns these — they were
being fetched and silently discarded until Milestone C wired them into
`DeadlockHeroListItem` (via `fetchVisibleHeroes`'s merge) and surfaced them
with `HeroDifficultyBadge`/`HeroArchetypeTags`:

```typescript
hero.complexity; // number, 1-3 — Valve's official difficulty rating
hero.tags; // string[] — flavor/archetype tags, e.g. ["Arsonist", "Explosive"]
hero.hero_type; // string, e.g. "marksman" — not yet surfaced in UI
```

### Spirit scaling coefficient location

```typescript
// Two patterns — check BOTH:
scaleFn?.class_name === "scale_function_tech_damage" || scaleType === "ETechPower";
```

### Stat key mappings

```typescript
TechPower; // flat spirit power
TechPowerPercent; // % spirit power bonus
BonusHealth; // flat health
BonusHealthRegen; // health regen
OutOfCombatHealthRegen;
WeaponPower; // weapon damage %
BaseAttackDamagePercent; // weapon damage % (was BulletDamage — renamed upstream, key no longer exists)
BulletResist; // % bullet damage resistance
TechResist; // % spirit damage resistance
StatusResistancePercent;
DegenResistance;
MeleeResistPercent;
```

---

## Game Mechanics (verified against deadlock.wiki)

```typescript
VALID_TIERS = [1, 2, 3, 4]; // tier 5 = Street Brawl only
ABILITY_UPGRADE_COSTS = [1, 2, 5]; // ability points per tier
ABILITY_MAX_LEVEL = 3;
SELL_REFUND_RATE = 0.5; // 50% of item cost
MAX_ACTIVE_ITEMS = 12; // active build cap
GAME_PLAN_CAP = null; // game plan is unlimited
SIGNIFICANT_THRESHOLD = 4800; // souls — investment bonus
MAX_INVESTMENT = 28800; // souls — bonus caps here
ULTIMATE_UNLOCK = 3800; // souls (boon level 8)
```

---

## Component Patterns

When scaffolding new panels or components, follow these conventions:

- **Server components** fetch data; **Client components** own interaction state
- New panels go in `app/build/components/` with PascalCase filenames
- Props are always typed with an explicit interface above the component
- `useMemo` for all derived state — never `useState` for computed values
- Tailwind only — no inline styles, no CSS modules
- Icon imports from `lucide-react` only (installed Milestone C — it was
  documented here before it was ever added to `package.json`; if a future
  convention doc references a package, verify it's actually installed)
- Loading states: **no shared skeleton pattern exists yet.** `ItemBrowser.tsx`
  does not implement one — this is still unbuilt (was never part of
  Milestone C's scope; pick it up as a standalone fix if needed)
- Tooltips: use the shared `<Tooltip>` / `<InfoTooltip>` components from
  `app/components/Tooltip.tsx` (built Milestone C). This is the sanctioned
  pattern — do not add new raw `title=` attributes for anything that needs
  explaining. A few purely mechanical/chrome titles (drag handles, rename
  affordances, flex-bar segment labels that duplicate a visible legend) were
  deliberately left as native `title` since wrapping them broke CSS `flex`
  layout or added no explanatory value — see `FlagButtons.tsx` /
  `AbilityLevelingPanel.tsx` for the retrofitted pattern to copy
- New player UX: the `simplified?: boolean` prop convention is **implemented**
  on `CategoryManager`, `AbilityLevelingPanel`, `BuildSummaryPanel`, and
  `SuggestedItemsPanel` (Milestone C), driven by a single `viewMode` state in
  `BuildClient.tsx` (default `"simplified"`). New panels should follow the
  same convention: accept `simplified?: boolean`, default `false`, and hide
  veteran-only detail (raw coefficients, soul-investment math, sell/optional
  flags) rather than duplicating the whole component

### New Player UX Checklist (for any new feature)

Before marking a component complete, verify:

- [ ] Does it work with zero prior game knowledge?
- [ ] Is there a plain-English label or tooltip explaining the concept?
- [ ] Does it hide complexity behind a toggle or progressive reveal?
- [ ] Does the AI coach have a hook to surface guidance here?

**Note:** `mini.ts` Fixture 9 mechanically enforces two of these four —
that a panel declares `simplified?: boolean` and that it imports the shared
Tooltip component rather than reintroducing raw `title=`. It cannot judge
copy quality or AI-coach hooks (M6 doesn't exist yet) — those two remain
manual review, not a fixture guarantee.

---

## Key Files Reference

Actual tree root is `lib/` and `app/` (no `src/` prefix), except the fixture
runner which lives at `src/scripts/mini.ts` — that's the one real exception.

```
lib/items.ts                  — Item, ItemAssignment, ItemPhase, BuildCategory types
lib/deadlock.ts               — re-exports, AbilityLevel type
lib/buildCalculations.ts      — calculateStatTotals(), calculateDamageSplit(),
                                calculateSoulTimeline(), getSkillPathGrid()
lib/buildSerializer.ts        — BuildState, serializeBuild(), deserializeBuild(),
                                getItemAssignments()
lib/buildUtils.ts             — resolveAddItem(), getConsumedComponents(),
                                getEffectiveAddCost(), cleanCategories(),
                                cleanAssignmentMap(), canActivateItem(),
                                MAX_ACTIVE_ITEMS
lib/itemStore.ts              — getItems() with cache, deriveUpgradesInto()
lib/itemNormalizer.ts         — normalizeItem()
lib/api/deadlockApi.ts        — fetchAllItems(), fetchHeroStats(),
                                fetchHeroAbilityItems()
lib/boonSystem.ts             — BOON_THRESHOLDS, getBoonThreshold(),
                                getAbilityPointsAtSouls()
lib/heroStats.ts              — HeroBaseStats, calculateStatsAtBoon()
lib/heroStore.ts              — getHeroStats() with cache
lib/abilityCoefficients.ts    — HeroAbility, calculateAbilityDamage(),
                                PROPERTY_LABELS
lib/scoring/scoreItems.ts     — scoreItems() pure function
lib/scoring/goalWeights.ts    — GOAL_WEIGHTS_MAP
lib/scoring/antiSynergy.ts    — detectAntiSynergies()
lib/categoryBonuses.ts        — CATEGORY_BONUS_TIERS
lib/farming/campData.ts       — camp soul values, phase cards, minimap markers
lib/lanes/laneData.ts         — lane structure HP/soul values (Milestone D3),
                                trooper wave cadence, minimap markers
lib/boons/boonsGuideData.ts   — boons guide copy, derived from boonSystem.ts
                                (Milestone D1) — not a second source of truth
lib/itemization/itemizationGuideData.ts — itemization guide copy, derived from
                                buildUtils.ts/buildCalculations.ts (Milestone D2)
lib/engine/                   — staged-pipeline scoring surface (WIP, parallel to
                                lib/scoring/, not yet wired into the app) — see
                                scoring-engine-dev skill. Its fixtures live in
                                `lib/engine/__fixtures__/mini.ts`, a SEPARATE harness from
                                `src/scripts/mini.ts`; `npm run mini` chains both
  types.ts                    — SCORE_CATEGORIES (gunDamage/spiritDamage/tankiness/
                                sustain/mobility/utility/economy), ItemCandidate,
                                HeroNeedVector, BasketResult, MarginalTermFn
  heroNeed.ts                 — deriveHeroNeedVector() (Milestone E). spiritDamage
                                from ability coefficients; gunDamage from the hero's
                                own gun DPS (damage x fire rate) vs roster — two
                                INDEPENDENT signals, not one split budget
  itemAdapter.ts              — toItemCandidate(), toItemCandidates() — Item bridge
  basketSelect.ts             — constructBasket(), makeBasketContext(),
                                coverageTerm/categoryBonusTerm/analyticsTerm.
                                Add a Milestone F covariance term as one more
                                MarginalTermFn — no change to the greedy loop
lib/analyticsStore.ts         — getItemAnalytics(), getHeroAnalytics() — cached,
                                fail-open match-analytics (win rate, matches) from
                                /v1/analytics/*; ItemAnalytics.itemId joins to
                                Item.numericId, NOT Item.id. Already wired into
                                /items display pages; unused by scoring until Milestone E.
                                Also getHeroAccuracy()/resolveAccuracyAtRank() (shot
                                accuracy per hero per rank tier) and getRankTiers()
lib/coach/                    — AI coach module (M6) — not yet created, keep isolated
app/components/                — cross-route shared UI (Milestone C):
  Tooltip.tsx                 — Tooltip, InfoTooltip — sanctioned title= replacement
  AudienceTabs.tsx             — reusable two(+)-audience tab switcher
  HeroDifficultyBadge.tsx      — HeroDifficultyBadge, HeroArchetypeTags
app/build/[heroId]/page.tsx   — server component, fetches items + hero data
app/build/BuildClient.tsx     — single state source of truth; owns viewMode
                                ("simplified" | "advanced") via AudienceTabs
app/build/components/
  ItemBrowser.tsx             — item shop grid
  BuildEmptyState.tsx          — /build onboarding copy (no hero selected yet)
  CategoryManager/            — drag-and-drop categories (decomposed Milestone B3):
                                index.tsx (orchestration + DnD handlers),
                                SortableCategory.tsx, Sections.tsx, ItemRow.tsx,
                                FlagButtons.tsx, DroppableZone.tsx, constants.ts,
                                helpers.ts
  ActiveItemsGrid.tsx         — 12-slot active build
  BuildSummaryPanel.tsx       — right panel stats
  AbilityLevelingPanel.tsx    — ability cards + upgrades
  SoulTimeline.tsx            — soul economy timeline
  SuggestedItemsPanel.tsx     — AI-adjacent suggestions (independent per-item
                                ranking via scoreItems())
  HeroBasketSuggestion.tsx     — hero-need basket (Milestone E): a SET of items
                                chosen together. Presentational only — receives a
                                BasketResult via props, computes nothing. Sits
                                alongside SuggestedItemsPanel, does not replace it
app/guide/components/          — cross-guide shared UI (Milestone D4):
  Minimap.tsx                  — generic marker-overlay minimap; callers supply
                                markers + renderMarker/renderTooltip/legend
  PhaseTimeline.tsx             — generic new-player phase-card list; callers
                                supply PhaseCard[] + pill color map
app/guide/farming/            — farming guide page + components; tabs use
                                the shared <AudienceTabs> (Milestone C); its
                                MinimapOverlay/PhaseTimeline are now thin
                                wrappers over app/guide/components/ (Milestone D4)
app/guide/lanes/               — lane mechanics guide (Milestone D3): Guardian/
                                Walker/Patron HP+souls, trooper wave cadence,
                                minimap. No "lane equilibrium" section — the
                                data-verifier agent found no deadlock.wiki
                                support for that mechanic, so it was cut
                                rather than published unverified
app/guide/boons/               — boons guide (Milestone D1): ability-unlock
                                milestones + full BOON_THRESHOLDS table
app/guide/itemization/         — itemization guide (Milestone D2): categories/
                                tiers/components/selling + CATEGORY_BONUS_TIERS
                                investment-bonus table
```

`/guide/*` pages are not yet linked from any nav or the homepage — reachable
only by direct URL. Pre-existing gap (farming had the same issue before this
milestone), not fixed here since it wasn't in Milestone D's scope.

---

## Skills & Agents

Project skills live in `.claude/skills/`, sub-agents in `.claude/agents/`.

**Skills** (invoke via `/skill-name` or auto-triggered by task context):

| Skill                      | Use for                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `deadlock-api-integration` | Fetching/normalizing API data, field-name bugs, spirit scaling |
| `scoring-engine-dev`       | Writing/changing `lib/scoring/` or `lib/engine/` logic         |
| `ship-check`               | Pre-commit/pre-PR gate: prettier → tsc → build → mini          |
| `fixture-driven-dev`       | Writing/running `mini.ts` regression fixtures                  |
| `coach-prompting`          | Designing/validating AI coach prompts (M6, `lib/coach/`)       |
| `guide-page-skill`         | Building new `/guide/*` educational pages                      |
| `wireframe-to-component`   | Turning a sketch/mockup into a component spec                  |

**Sub-agents** (delegate via the Agent tool):

| Agent             | Tools             | Use for                                                        |
| ----------------- | ----------------- | -------------------------------------------------------------- |
| `data-verifier`   | read-only + web   | Cross-check code against live API / wiki, report discrepancies |
| `scoring-auditor` | read-only         | Audit a scoring/engine diff for architecture-rule compliance   |
| `panel-builder`   | read + edit/write | Scaffold a new build/guide panel to convention                 |

---

## Data Verification Cadence (Milestone D6)

Game constants drift silently — Valve patches boon thresholds, structure HP,
and ability coefficients without this repo noticing. There is no durable
automated scheduler available to Claude Code sessions (the `CronCreate` tool
exists, but its jobs are session-scoped and auto-expire within 7 days — it
cannot carry a standing project safeguard across sessions). Until this repo
has real CI-level automation for it, treat the cadence below as a manual
checklist enforced by convention, not by a bot:

- **Before starting any milestone that touches** `lib/boonSystem.ts`,
  `lib/abilityCoefficients.ts`, `lib/categoryBonuses.ts`, or any
  `lib/[topic]/[topic]Data.ts` guide-data module — run the `data-verifier`
  agent against the relevant file(s) first, not after.
- **At minimum once a month of active development**, run `data-verifier`
  against `lib/boonSystem.ts` and `lib/abilityCoefficients.ts` even if no
  PR touches them — Valve patches land independent of this repo's own
  work cadence.
- When `data-verifier` confirms a value changed, cite the source
  (deadlock.wiki page + date, or the exact API endpoint) directly in the
  code comment next to the changed constant — see `lib/boonSystem.ts`'s
  `BOON_THRESHOLDS` for the pattern to copy.
- If a future session sets up real recurring automation for this (e.g. a
  scheduled GitHub Actions job that runs a verification script and opens an
  issue on drift), update this section to point at it and remove the
  "manual checklist" framing above.

---

## State Architecture

```typescript
// BuildClient owns all route state:
buildItems: Item[]
assignmentMap: Map<string, {
  phase: 'early' | 'mid' | 'late' | null
  active: boolean
  sellPriority: boolean
  optional: boolean
}>
categories: BuildCategory[]
abilityLevels: AbilityLevels
manualBoonLevel: number           // 0-35
selectedGoal: BuildGoal

// Derived (useMemo — never useState):
activeCount           // active items count (cap at 12)
itemStatTotals        // from calculateStatTotals()
totalSpiritPower      // base + flat + percent
consumedComponents    // from getConsumedComponents()
```

---

## Milestone History

| Milestone | Status    | What it built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | ✅ Closed | Hero Explorer MVP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| M2        | ✅ Closed | Build Planner UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| M3        | ✅ Closed | URL persistence + share links                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M4        | ✅ Closed | Real item data + scoring engine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M5a       | ✅ Closed | Game plan structure, phases, active grid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| M5b       | ✅ Closed | Hero stats, boon system, ability panel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M5c       | ✅ Closed | Farming guide page (`/guide/farming`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A         | ✅ Closed | Ship-integrity fixes: CLAUDE.md drift, dead `lib/engine/` reconciliation, self-test IIFE removal, doc sync, homepage/metadata fix, fetch-waterfall parallelization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| B         | ✅ Closed | State/component health: `assignmentMap` derived via `useMemo`, business logic extracted to `lib/buildUtils.ts`, `CategoryManager` decomposed into 8 files, slot-cap/cleanup fixtures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| C         | ✅ Closed | New player UX foundations: shared Tooltip/AudienceTabs components, tooltip copy retrofit, simplified/advanced toggle, `/build` onboarding, hero difficulty/archetype tags, UX checklist fixture (`mini.ts` Fixture 9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D         | ✅ Closed | Guide content expansion: boons (`/guide/boons`), itemization (`/guide/itemization`), lane mechanics (`/guide/lanes`) pages; `Minimap`/`PhaseTimeline` generalized into `app/guide/components/` and reused across all 4 guide pages; `mini.ts` extended to `lib/farming` + new guide data (72 → 88 fixtures); data-verifier cadence documented (see "Data Verification Cadence" above — no durable scheduler exists for actual automation yet)                                                                                                                                                                                                                                                                                                                                                            |
| M6        | ⏸ Queued  | AI coach layer + skill path planner (sequenced after Milestone C so it has UX surfaces to attach to)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| E         | ✅ Closed | Hero-Aware Basket Scoring: `lib/engine/heroNeed.ts` derives a per-hero need vector (mechanical spirit/weapon lean from real ability coefficients + cross-hero-normalized tankiness/mobility); `lib/engine/itemAdapter.ts` bridges `Item` → `ItemCandidate`; `lib/engine/basketSelect.ts` greedily selects a basket across gun/spirit/vitality that jointly covers it, trading category-bonus concentration against need-vector diversification, with a small empirical win-rate term from the existing `lib/analyticsStore.ts`. `damage` split into `gunDamage`/`spiritDamage`. New `HeroBasketSuggestion` panel wired additively into `BuildClient` (does NOT replace `SuggestedItemsPanel`). Engine fixtures 5 → 38. Validated against live Lady Geist data — see "Milestone E Design Decisions" below |
| F         | ⏸ Queued  | Item-_combination_/covariance layer: single-item empirical win rate is already handled in Milestone E via the existing `lib/analyticsStore.ts` (`ItemAnalytics.winRate`) — F is specifically about pairwise/combination correlation, which needs per-match granularity. Ingest match-level data from `deadlock-api.com`'s `/v1/matches/{id}/metadata` (item builds + purchase timing + death events + win/loss — confirmed available, unauthenticated, via `data-verifier` spike) into a category×feature design matrix, produce a static regression coefficient table offline, wire it into Milestone E's `constructBasket()` marginal-value function as one more pluggable term. Depends on Milestone E's interfaces (not its completion)                                                              |
| G         | ⏸ Queued  | Need-vector enrichment (stretch): parse `HeroAbility.upgrades[].statChanges` free text for real sustain/lifesteal signal; hand-author a `hero.tags`/`hero_type`/`gun_tag` → category mapping (same upkeep shape as `GOAL_WEIGHTS_MAP`/`ANTI_SYNERGY_RULES`). Purely additive to Milestone E's need vector, not a prerequisite for E or F                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## M6 Design Decisions (locked before coding)

- AI coach is **proactive** — surfaces warnings as items are added,
  not only when the user asks
- Coach module lives in `src/lib/coach/` — zero imports from scoring
- Coach prompt design must be prototyped and validated in Claude.ai
  Artifacts before implementation begins
- Per-ability DPS impact when items added
- Tracklock-style skill path planner grid
- Starter build templates (Beginner / Aggressive / Safe) with
  coach annotations explaining each item choice

---

## Milestone E Design Decisions (locked before coding)

Portfolio-theory-inspired itemization scoring, scoped across two research
passes, a `data-verifier` spike, and a direct read of the real `lib/engine/`

- `lib/analyticsStore.ts` code (full reasoning in session history — this
  section captures the decisions, not the exploration). The direct-code pass
  corrected and shrank the original scope in two important ways, both folded
  in below.

**Correction 1 — empirical data is already integrated, not just "available."**
`lib/analyticsStore.ts` (`getItemAnalytics()`/`getHeroAnalytics()`) and
`lib/api/analyticsApi.ts` already fetch, cache, and fail-open against
`/v1/analytics/item-stats` and `/v1/analytics/hero-stats` — real per-item
`{ matches, wins, losses, winRate }`, joined via `Item.numericId` (which
already exists on `Item` specifically for this join, per
`lib/itemNormalizer.ts:97`). This is already wired into `/items` display
pages (`app/items/page.tsx`, `app/items/[id]/page.tsx`) but **never
consumed by scoring**. This means Milestone E can ship a real (small,
explicitly bounded) empirical adjustment term on day one instead of
deferring all empirical signal to Milestone F — see the marginal-value
design below. Milestone F's scope narrows accordingly: it's specifically
about per-match item-_combination_/covariance analysis from
`/v1/matches/{id}/metadata` (genuine correlation between item choices),
since single-item empirical win rate is no longer a gap.

**Note on the fixture gate.** `npm run mini` chains BOTH harnesses —
`package.json` defines it as `npx tsx src/scripts/mini.ts && npx tsx
lib/engine/__fixtures__/mini.ts`. They are two separate runners with
separate assertion counts and separate `process.exit(1)` paths, not one
suite: `src/scripts/mini.ts` covers `lib/scoring/` + guide data, and
`lib/engine/__fixtures__/mini.ts` covers `lib/engine/`. New Milestone E
fixtures belong in the engine harness. Both must pass for the gate to pass;
`&&` means an early failure in the first masks the second, so read the whole
output, not just the exit code.

**Architecture:**

- Lives in `lib/engine/` (the WIP staged-pipeline surface), not
  `lib/scoring/` — `ItemCandidate.categoryValues` is already a continuous
  per-`ScoreCategory` vector, the shared representation Milestone F needs to
  plug covariance coefficients into later without restructuring anything
- No `Item` → `ItemCandidate` adapter exists yet — `lib/engine/` currently
  only runs against synthetic fixture candidates. New:
  `lib/engine/itemAdapter.ts::toItemCandidate(item: Item): ItemCandidate`,
  and `ItemCandidate` needs a new `numericId: number` field (from
  `Item.numericId`) specifically for the `ItemAnalytics` join
- `damage` splits into `gunDamage`/`spiritDamage` in `SCORE_CATEGORIES`/
  `ItemCandidate.categoryValues` — a single `damage` dimension can't tell a
  spirit-leaning hero's needs from a gun-leaning hero's. Verified low-risk:
  `baseCategoryStage`'s `INTENT_TO_CATEGORY` maps `burst` → both new
  categories at full weight each (not split), which preserves every existing
  `lib/engine/__fixtures__/mini.ts` assertion exactly, since a candidate's
  combined damage contribution is invariant to how it's divided between the
  two — TypeScript's `Record<ScoreCategory, number>` on `ItemCandidate` will
  also compile-error every fixture object that isn't updated, so the
  refactor is safe-by-construction under strict mode
- Need-vector derivation (`lib/engine/heroNeed.ts::deriveHeroNeedVector()`)
  outputs `Readonly<Record<ScoreCategory, number>>` directly — it does NOT
  go through `EngineInput.intent`/`IntentKey`/`normalizeIntent()`, which
  stays untouched to protect the existing player-preset-driven
  `recommendItems()` path and its five passing fixtures. Mechanical where
  the data supports it (gun/spirit lean from summed `spiritScaling`/
  `weaponScaling` in `lib/abilityCoefficients.ts`; tankiness/mobility from
  cross-hero z-scored `HeroBaseStats`); explicitly stubbed neutral, not
  faked, where it doesn't yet (sustain/utility — deferred to Milestone G)
- Basket selection (`lib/engine/basketSelect.ts::constructBasket()`) is
  greedy budgeted-maximum-coverage: marginal value per candidate =
  need-vector coverage gain (diminishing per category) + category-bonus
  threshold gain (reusing `lib/categoryBonuses.ts`'s
  `isApproachingSignificantBonus`/`getCurrentBonusTier`, the same logic
  `scoreItems.ts` already applies) + an optional, small, explicitly-bounded
  empirical term from `ItemAnalytics.winRate` (via the join above) — this is
  what makes the algorithm trade off concentrating souls in one category
  (game-native bonus ladder) against diversifying for a multi-category hero
  need, instead of hand-waving a "risk" number, while also folding in real
  empirical data from day one
- The marginal-value function is composed as pluggable additive terms
  (`baseMarginalValue + Σ adjustments`) so Milestone F's later per-item-pair
  covariance output can add one more term without touching the greedy loop,
  the need-vector deriver, or the UI
- New UI surface (`HeroBasketSuggestion.tsx`) is additive/opt-in in
  `BuildClient.tsx`, not a replacement for `SuggestedItemsPanel.tsx`'s
  existing `scoreItems()` path — keeps this revertible and in its own PR,
  consistent with the "AI layer changes and scoring changes must be in
  separate PRs" rule (this isn't AI, but the same separation logic applies
  to "new joint-selection scoring" vs. "existing independent-ranking
  scoring")
- Fixtures are synthetic/hermetic (matching the existing pattern) — no live
  API calls inside the fixture run itself, including for the analytics term
  (pass a synthetic `Map<number, ItemAnalytics>`, don't call
  `getItemAnalytics()` from a fixture). A one-time live fetch against a real
  hero (e.g. Lady Geist, the motivating example) is a manual sanity check
  during implementation, not an automated fixture

**Two decisions that emerged during implementation (both fixture-locked):**

- **Relevance gate.** `categoryBonusTerm`/`analyticsTerm` return `null` unless
  the candidate covers some un-met need. Without it the investment bonus alone
  could make an item with zero relevance score positive, so the basket bought
  filler purely because its price tipped a category over a tier line (and
  `"no-positive-value"` became unreachable). The investment bonus is a reason
  to prefer one _useful_ item over another, never to buy a useless one.
- **Gun need is an INDEPENDENT signal, not a share of the damage budget.**
  `spiritDamage` comes from ability scaling coefficients; `gunDamage` comes
  from the hero's own gun DPS versus the roster. These are genuinely
  independent in Deadlock — a hero's abilities can scale 100% off spirit
  while their gun is still among the best in the game, and gun items scale
  that gun regardless of what the abilities do. Splitting one budget between
  two shares forces those facts to compete and wrongly reads a spirit hero as
  having no gun need. Two rules fall out of the live data:
  - **Measure gun strength as damage × fire rate, never damage alone.** Paige
    has the roster's highest per-shot damage (35.0) at 1.67 shots/s; Calico
    does 1.8 at 42.86 shots/s. Only the product is comparable.
  - **Gun need is NOT compensating** (unlike tankiness/mobility): a strong gun
    steers you toward gun items, because weapon items scale the gun you
    already have. `MIN_GUN_FACTOR` floors it so the worst gun stays reachable
    (zero would be dropped by the relevance gate — every hero has a gun).
  - **Nominal gun DPS is discounted by observed shot accuracy**, optionally at
    the player's own rank — see "Gun accuracy" below.

### Gun accuracy (rank-aware)

`/v1/analytics/hero-stats` carries `total_shots_hit`/`total_shots_missed`, and
`?bucket=avg_badge` partitions every hero by rank (bucket = `tier * 10 +
subrank`, bucket 0 = unranked; ~38 heroes × 67 buckets). `getHeroAccuracy()`
in `lib/analyticsStore.ts` aggregates these into per-hero pooled + per-tier
accuracy; `resolveAccuracyAtRank()` flattens it for one rank. Rank tier names
come from `/v1/assets/ranks` (`getRankTiers()`) — **fetch them, never hardcode**:
they are 0 Obscurus, 1 Initiate, 2 Seeker, 3 Acolyte, 4 Sentinel, 5 Mystic,
6 Ritualist, 7 Emissary, 8 Oracle, 9 Phantom, 10 Ascendant, 11 Eternus, which
are easy to misremember.

Why it matters: nominal DPS assumes every shot lands, systematically
over-rating spread weapons whose fire rate counts each pellet. Verified live —
accuracy spans 38.7% (Vyper) to 62.4% (Silver), and the discount reorders gun
need substantially: Vyper 1.72 → 1.33, Calico 1.32 → 1.13, while Lady Geist
rises 1.07 → 1.30 because her shots actually connect.

Two things to preserve when touching this:

- **Discount the hero AND the roster with the same policy.** Gun strength is a
  z-score against the roster; comparing a discounted hero to nominal peers is
  meaningless.
- **Missing accuracy ≠ zero accuracy, and "inapplicable" ≠ "unknown".** Absence
  from the accuracy map covers TWO cases that must not be conflated:
  - **Accuracy inapplicable** — the weapon's shots are not counted discretely,
    so it cannot miss. Verified live: Graves alone, with an analytics row over
    536,097 matches reporting `total_shots_hit` 0 AND `total_shots_missed` 0.
    Flagged via `WEAPON_PROFILE_OVERRIDES`' `cannotMiss` in `heroNeed.ts` and
    treated as 1.0. Her range weakness is priced by the falloff term instead
    (see below) — charging a miss penalty too would double-count it.
  - **Accuracy unknown** — no analytics row at all. Verified live: 5 heroes
    (Deadman Danny, Solomon, Violet, Nurse Harrow, Baba), all recent additions
    with no match data. These fall back to the median of heroes that DO have
    data — never 1.0, which would leave them undiscounted while every peer is
    discounted, inflating them into looking like the roster's best gun.

  This bit during implementation: treating all absences as `cannotMiss` pinned
  Violet and Nurse Harrow at the maximum gun need of 2.000, **above Drifter**,
  the roster's actual best gun. A hero missing from analytics is the common
  case, not an edge case — check which of the two you're in.

Emergent and correct, not coded in: Calico's gun need _falls_ at higher rank
(1.16 Initiate → 1.10 Eternus) while Geist's rises (1.25 → 1.38), because
Calico's accuracy improves only +4.2pp across ranks against Geist's +12.6pp —
a spread weapon benefits less from better aim than a precision one.

**`weapon_info` — partially wired.** `GET /v1/assets/items/{weapon_class}`
(class name is on `hero.items.weapon_primary`) returns a `weapon_info` block
holding ground truth the accuracy ratio only approximates. One piece of it is
now consumed; two are deliberately not, because they need a design decision
this repo hasn't made:

- **Wired.** `damage_per_second_with_reload` — Valve's own sustained-DPS
  figure, reload downtime included — flows through
  `fetchHeroStats` → `HeroBaseStats.dpsWithReload` →
  `heroNeed.ts::nominalGunDps()`, which discounts the naive
  `bulletDamage × bulletsPerSecond` product by the ratio
  `dpsWithReload / (bulletDamage × bulletsPerSecond)` at base (boon 0), then
  applies that ratio to the boon-scaled product — so boon growth and reload
  downtime stay two independently-correct effects instead of getting
  conflated. Verified live against Graves: naive 35.3 vs 20.2 with reload (the
  documented 43% overstatement), ratio 0.572, matching exactly. A hero with no
  reload data (`dpsWithReload` 0 — the pre-existing fixture default, or any
  real hero whose `weapon_info` fetch failed) gets ratio 1, i.e. no discount:
  the same fail-open policy this module already applies to missing accuracy
  data.
- **Wired.** The range/falloff profile — `damage_falloff_start_range` /
  `_end_range` / `_start_scale` / `_end_scale` plus the hard `range` cap — flows
  through `fetchHeroStats` (converted to **metres** there, ÷39.37, so no
  consumer repeats the divisor) → `HeroBaseStats` → `heroNeed.ts`'s
  `rangeEfficiency()`. See "Range falloff" below.
- **Captured in the raw API type, NOT surfaced into `HeroBaseStats` or scoring
  yet** — `lib/api/deadlockApi.ts`'s `WeaponItemRaw["weapon_info"]` documents
  it, but no consumer exists:
  - `bullets` — pellets per shot. Calico is `bullets: 9`, which is _why_ she
    reads 43.5% accuracy: it is a shotgun, not bad aim. Verified live it is
    already baked into `bullets_per_second` (bullets_per_second =
    shots_per_second × bullets), so it is NOT needed for the DPS math above —
    only useful as an explanatory signal, not a required input. Do NOT multiply
    by it: that would inflate shotgun heroes ~9×.

### Range falloff (wired, with one hand-authored exception)

Nominal DPS assumes every shot deals full damage regardless of distance.
`rangeEfficiency()` in `heroNeed.ts` turns a weapon's falloff curve into one
expected-damage multiplier over `ENGAGEMENT_RANGE_WEIGHTS`, an assumed 5–30m
distribution of engagement ranges.

**Those weights are an ASSUMPTION, not a measurement** — no endpoint reports
engagement distance, so nothing in the data can settle them. They are the
"lane-typical" calibration (55% of weight inside 17m). Retune in that one
constant; a fixture locks the 0.55 figure so a change forces a decision.

**This is orthogonal to the accuracy discount and composes with it** — the two
are not double-counting. Accuracy measures which shots LAND (a hit at 30m is
still logged as a hit); falloff measures how much damage a landed shot deals.
Neither term can observe the other's effect.

Verified live across all 44 heroes: `damage_falloff_start_scale` is 1 and
`damage_falloff_bias` is 0.5 for **every** hero, so the curve SHAPE cannot
reorder a cross-hero z-score — `rangeEfficiency()` interpolates linearly on
that basis. If either ever varies per hero, revisit it. 40 of 44 fall to
`end_scale 0.1`; the hard `range` cap varies more than the curve does (Apollo
25m, Bebop 32m, Rem 76m, the other 41 at 178m).

**`WEAPON_PROFILE_OVERRIDES` — the falloff fields do not mean the same thing on
every weapon.** Graves' The Teacher reports 7.62m→17.02m at `end_scale` 0.5,
which reads generically as "50% damage past 17m". **It is not.** Her weapon has
no damage falloff: it deals full damage to a hard 17m cutoff and **zero** past
it, and those range fields instead drive her Build-Up per bullet (most notably
Essence Theft). Reading them generically understates her in-range damage and
overstates her out-of-range damage at the same time. Nothing in `weapon_info`
distinguishes this case, so it is hand-authored game knowledge with the same
upkeep shape as `GOAL_WEIGHTS_MAP` — if another weapon shares the quirk we
cannot detect it from data and will silently mis-model it.

Two related mechanics are deliberately NOT modelled, since both are interaction
value (Milestone F territory), not per-hero gun strength: Essence Theft's
build-up scaling off that same falloff range, and Ricochet's own damage falloff,
which is measured from the main target to the ricocheted target rather than from
the shooter.

Live result: Graves derives the roster's **lowest** gun need (0.399 of 44). That
is correct for gun items that SCALE her gun — her 17m cutoff is by far the
earliest on the roster, where a typical hero holds full damage to 18–20m and
does not bottom out until ~55m.

**But "lowest gun need" is NOT the same as "no gun items", and the scalar hides
a real distinction.** Graves has genuine gun builds (confirmed from play, not
inferred from data): Heroic Aura + Mystic Shot ± Toxic Bullets as the normal
route into gun investment, and a Ricochet + Toxic Bullets ± Tesla Bullets build.
Verified against the live basket, those items rank 10th, 38th, 29th, 17th and
45th of 54 gun items for her — Mystic Shot and Tesla Bullets clearly too low.

Two hero×item interactions the per-item model structurally cannot see:

- **Proc frequency is not hero-aware.** Tesla Bullets is `ProcChance 15` /
  `ProcCooldown 0.2`; Toxic Bullets is `BuildUpPerShot 1.28`. Expected procs per
  second scales with SHOTS per second and with hit reliability, and Graves fires
  9.8/s and cannot miss — near the roster's best proc platform. The estimator
  applies one flat expected value for every hero.
- **Spirit-scaling procs are not spirit-aware.** Mystic Shot (`ProcChance 100`,
  `ProcBonusMagicDamage 40`) converts spirit power into gun-triggered damage and
  is priced as a flat `spiritDamage 27` with zero gunDamage. On a 100%-spirit
  kit that is a systematic underestimate.

So the right reading for a hero like this is "don't buy gun items that scale the
gun; DO buy per-hit proc items."

**Gap 1 is now BUILT; gap 2 is not.** `procPlatformTerm` in `basketSelect.ts`
scales a per-hit item by how well a hero lands hits, composed from two halves
kept deliberately apart:

- `ItemCandidate.procReliance` (hero-independent, `itemAdapter.ts`) — the share
  of an item's scored magnitude delivered per weapon hit, from the `perHit` flag
  on `EffectEstimate`.
- `BasketContext.procPlatformFactor` (hero-specific,
  `heroNeed.ts::deriveProcPlatformFactor`) — bullets landed per second versus
  the roster, bounded by `PROC_PLATFORM_SWING`.

Splitting it this way is what keeps per-item constants from being inflated to
compensate for one hero. The term is relevance-gated and roster-average-neutral:
factor 1.0 contributes exactly nothing, so it reorders per-hit items rather than
blanket-boosting them. Live: Graves is 2nd of 44 on proc platform (1.207) while
last on gun need — the divergence this exists to express.

**Honest limits of that fix, measured not assumed.** It moved her items only
modestly (Ricochet 17→14, Toxic Bullets 29→26, Tesla Bullets 45→44) and moved
**Mystic Shot not at all** (38→38). The term is bounded to 10% of one slot by
design, and more importantly it is not what holds Mystic Shot down:

**Gap 2 — spirit-scaling procs are still not spirit-aware.** Mystic Shot
(`ProcChance 100`, `ProcBonusMagicDamage 40`) converts spirit power into
gun-triggered damage and is priced as a flat `spiritDamage 27` regardless of the
buyer's spirit. That is the dominant reason it under-ranks on a 100%-spirit kit,
and it needs the item's value to scale with hero spirit power — a genuine
hero×item product, i.e. Milestone F. **Do NOT close it by raising
`PROC_PLATFORM_MAX_FRACTION`** — that inflates every per-hit item on every
high-fire-rate hero to fix one item's scaling, trading a known underestimate for
an unknown overestimate.

Known imprecision in the factor itself: `bulletsPerSecond` counts PELLETS, so
shotguns read high (Calico tops the roster at 1.350 on 42.9 pellets/s). Right
for per-bullet procs, wrong for per-SHOT build-ups like Toxic Bullets'
`BuildUpPerShot`; separating them needs `bullets` on `HeroBaseStats`.

What the floor already buys: gun items are not suppressed for her despite the
lowest need — 3 of 11 live basket picks are gun items, Spiritual Overflow among
them at #2, found via its spirit stats.

### Defence: flat health and % resist are separate categories

`tankiness` was split into `bonusHealth`/`resist` because they are not
interchangeable per hero. Effective HP is `health / (1 - resist)`, so a
percentage resist multiplies the pool a hero already owns: verified live, the
same +20% resist buys the roster's beefiest hero +801 EHP but its squishiest
only +401 — exactly 2x for identical spend. Resistance items really are weaker
on low-health heroes.

Defence resolves on two independent axes that compose:

- **How much** (`deriveDefensiveNeed`, compensating): below-average health →
  higher total defensive need.
- **Which kind** (`deriveHealthShare`, EHP-driven): below-average health →
  weighted toward flat health, both because it is worth more directly and
  because it raises the pool that later resist multiplies. Above-average
  health inverts.

Health is measured at max boon, not base — the two disagree about who is
squishy: Silver's base 830 is mid-roster, but at +28/boon she ends up 5th
lowest at cap.

Live result: Mina (1605 HP) 1.72 health / 0.96 resist; Graves (1885) 1.39 /
1.00; Mo & Krill (3205) 0.30 / 0.72.

**Barriers/shields are a THIRD defensive kind**, not a flavour of health.
`CombatBarrier`, `VexBarrierCombatBarrier` and `GuardianWardCombatBarrier` map
to the `shield` category. A barrier is a fixed absorb pool that does not scale
with max health, so — like flat health, unlike % resist — it is worth
proportionally more to a low-health hero, and it is cheaper per point of
effective HP (Reactive Barrier 325 absorb / 1,600 souls ≈ 4.9 souls per EHP vs
Fortitude 375 health / 3,200 ≈ 8.5). Offsetting that, barriers are
cooldown-gated and temporary (45-60s cooldowns, 8-10s durations), so
`SHIELD_SHARE_OF_FLAT` holds them to a minority of the flat-EHP budget rather
than letting them displace permanent health outright.

**These three keys were entirely unmapped before**, which scored every barrier
item at zero for its barrier: Reactive Barrier's whole 325 absorb was invisible,
leaving the item net-negative and effectively unbuyable. When adding an item
archetype, check that its defining stat key is actually in
`STAT_KEY_TO_SCORE` — an unmapped key fails silently.

### Item scoring coverage audit (all 156 live items)

A full audit found **26 items (17%) scoring exactly zero** — invisible to the
basket, since a zero-coverage candidate is dropped by the relevance gate. All
26 are now non-zero; the catalogue has **0 zero-scoring items** and exactly one
negative (Weighted Shots, correctly, for its real `BonusMoveSpeed: -0.5`).
Three distinct causes, each needing a different fix:

1. **A duplicate key for a stat already mapped.** `SpiritPower` is a second
   name for `TechPower`; verified live, the two NEVER co-occur (17 items use
   one, 6 the other, none both). Only `TechPower` was mapped, so 6 items lost
   all their spirit power.
2. **Meaningful stats never mapped** — `BonusFireRate` (17 items, multiplies
   weapon DPS directly), `BonusClipSizePercent`, `BonusMeleeDamagePercent`,
   `Stamina`/`StaminaCooldownReduction`, `TechRange`/`RadiusMultiplier`,
   `HeadShotBonusDamage`, `BonusAbilityDurationPercent`.
3. **Value that is an active/proc effect, not a stat** — see
   `lib/engine/effectEstimator.ts`.

**`effectEstimator.ts` produces ESTIMATES, not measurements.** Items like Tesla
Bullets carry no stat bonus at all; their worth is "15% chance to chain 33
damage to 4 targets". The estimator turns such parameter clusters into
expected-value contributions (`33 × 4 × 0.15 = 19.8`), then scales everything by
`EFFECT_CONFIDENCE = 0.5` so an inferred value can never outrank a comparable
measured stat. It deliberately does not model target count actually hit,
positioning, or whether a slow converts into a kill. Every estimate carries a
`basis` string so it is never an unexplained number.

### Item values are NOT flat — read the published scaling coefficients

`properties[key].scale_function.stat_scale` is Valve's own coefficient, and
`parseStats` used to discard it, keeping only `value` — which is just the BASE
of a scaling expression. Mystic Shot's `ProcBonusMagicDamage` is
**`40 + 0.9 x spirit power`**, not 40.

Measured live across all 173 shopable items: **29 `ETechPower`-scaled
properties on 22 items, median 1.5x understatement at 100 spirit power**, up to
3.3x (Mystic Shot), 2.9x (Mercurial Magnum), 2.7x (Spirit Snatch). It reaches
well past damage — Reactive Barrier's absorb is `325 + 1.8 x spirit` (325 ->
505), so the barrier souls-per-EHP figures above are understated for spirit
heroes.

Now captured by `lib/itemNormalizer.ts` into `Item.statScaling` and applied by
`lib/engine/itemAdapter.ts::resolveScaledStats(item, ctx?)`. Additive, the same
convention as `calculateAbilityDamage` (`value += stat x scale`). **Omitting
`ctx` returns the unscaled base**, so every hero-free caller and fixture is
byte-identical to before.

**Only 2 of the 8 published scaling types have a non-circular source**, and the
split is the whole design:

| Type                                                                                                         | Supplied by                                       | Resolved?                         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------- |
| `ETechPower`                                                                                                 | hero spirit + `TechPower`/`SpiritPower` items     | yes — 29 props, 22 items          |
| `ELevelUpBoons`                                                                                              | hero boon level                                   | yes — 8 props                     |
| `EItemCooldown` (99), `ETechDuration` (54), `ETechRange` (51), `EHealingOutput` (27), `EChannelDuration` (2) | OTHER ITEMS                                       | only from the already-owned build |
| `EBuildUpRate` (7)                                                                                           | nothing — no supplier key exists in the catalogue | captured, never applied           |

The item-supplied types resolve against the **already-owned build, never the
basket under construction**: an item's value must not depend on which other
items the basket happens to pick, or selection becomes circular.
Candidate-on-candidate scaling is item x item — Milestone F, deliberately not
modelled here.

Two traps when touching this:

- **Preserve the sign.** Alchemical Fire's `BulletArmorReduction` is -7 scaling
  at -0.055, so scaling makes the shred STRONGER (more negative). Clamping to
  positive silently inverts every enemy-debuff item — see the sign-convention
  warning above.
- **Only the single-stat form carries a coefficient.**
  `scale_function_multi_stats` publishes `scaling_stats` with NO `stat_scale`,
  so there is nothing to read and inventing one would be fabricating data.

**`SpiritPower` is a second API name for `TechPower`** — and the two modules
disagreed. `lib/buildCalculations.ts`'s `SPIRIT_POWER_KEYS` listed only
`TechPower` while the engine's `STAT_KEY_TO_SCORE` counted both, so
`totalSpiritPower` silently dropped up to 20 per item. Verified live: 19 items
use `TechPower`, 6 use `SpiritPower` (Counterspell, Mystic Shot, Healing Nova,
Alchemical Fire, Arcane Surge, Veil Walker), **none use both**, so summing both
cannot double-count. It compounded on Mystic Shot, which is both a
`SpiritPower` item AND `ETechPower`-scaled: undercounting spirit power
under-resolved that item's own scaling. **When a duplicate key is found, fix
EVERY module that reads it** — fixing one and not the other is worse than
fixing neither, because the two then disagree silently.

**What this did and did not change, measured.** Graves' basket composition
shifted (Spiritual Overflow out; Diviner's Kevlar and Crippling Headshot in),
and Mystic Shot's modelled `spiritDamage` went 27 -> 72 at 100 spirit and 117
at 200. But its RANK among her 53 gun items barely moved (38 -> 37 at 200
spirit): the increase is real and correct, yet still short of the items above
it. Coverage saturation is NOT the cause — the per-slot spiritDamage target is
428.6, far above any of these values.

That remaining delta is the honest boundary of per-item valuation. The builds
this came from are described as PAIRS — "Heroic Aura + Mystic Shot", "Ricochet

- Toxic Bullets + Tesla" — and pair value is exactly what a per-item model
  cannot represent, no matter how accurate each item's own coefficient is. With
  scaling and proc frequency both now correct, the leftover genuinely is
  Milestone F. **Do not chase it by inflating per-item numbers that are now
  verifiably right.**

### Non-substitutable categories: shred and anti-heal

`gunShred` / `spiritShred` / `antiHeal` exist for the same reason `resist` was
split from `bonusHealth`: they are **requirements, not damage sources**. Past a
certain enemy resist level, more damage items stop converting into damage dealt
and only shred unlocks it; against a healing enemy, raw damage can fail to
out-pace sustain at any amount. Separate coverage targets make the basket buy
_some_ rather than stacking pure damage. `SHRED_SHARE_OF_DAMAGE` deliberately
holds shred below the damage need it unlocks — the category guarantees
coverage, it does not make shred a co-equal damage source.

Shred is split by damage type because bullet shred does nothing for a
spirit-scaling hero's abilities. Shred need is derived from the matching damage
need; **anti-heal is a flat baseline**, because whether you need it depends on
the ENEMY having healing — a real number needs `EngineInput.matchContext`.

Two distinctions that are easy to get wrong:

- **Resist reduction ≠ output reduction.** `MagicResistReduction` and
  `TechArmorDamageReduction` make the target take more damage (shred).
  `TechPowerReduction` and `TechDamageReduction` cut the target's own damage
  output — that is defensive utility, and grouping it with shred credits it as
  offence.
- **The two anti-heal keys are always paired.** `HealAmpReceivePenaltyPercent`
  and `HealAmpRegenPenaltyPercent` carry the same value on every live item
  (both -35 on Toxic Bullets, both -70 on Spirit Burn). Take the larger, never
  the sum, or one effect is counted twice.

**AoE weapon effects earn economy**, not just damage: Ricochet's bounce and
Split Shot's extra bullets hit several jungle creeps per shot, which is farming
speed and therefore souls.

**Some item value is CONTEXTUAL and cannot be scored per-item — do not try.**
Three real cases (confirmed against play knowledge, not inferred from data),
each scoring near the bottom of its tier and correctly so:

- **Counter-picks.** Armor Piercing Rounds exists to answer Plated Armor; its
  worth is a function of the ENEMY's build. `EngineInput.matchContext` is
  declared and unused — that is the right home for enemy composition.
- **Combo enablers.** Vortex Web pulls a group into one spot; its value is in
  the follow-up (Ivy's ultimate + grasping vines + Alchemical Fire, Paradox
  bomb setups, Doorman dragging several enemies through a door). Its slow and
  dash-denial ARE scored; the grouping is interaction value. A positive-synergy
  table mirroring `lib/scoring/antiSynergy.ts` is the shape that fits.
- **Ability-dependent effects.** Echo Shard resets an imbued ability's
  cooldown, so it is worth whatever that ability is worth. It gets a generic
  floor; a real number needs the hero's ability list.

All three are interaction value — the item-covariance layer scoped as Milestone
F. **Do not close the gap by inflating per-item constants**: that trades a known
underestimate for an unknown overestimate on every hero not running the combo.

**A low score is not automatically a bug.** Spirit Shielding scoring 55.5 at
T2 — above the T4 vitality median — was flagged as a suspected over-score, but
it is correct: it is a genuinely strong item on low-health heroes, and the model
already reflects that, ranking it 10th of 54 vitality items for the roster's
squishiest hero versus 22nd for its tankiest. Check whether a flagged outlier
is actually wrong before retuning toward it.

**Enemy resist reduction is offensive value stored as a negative.**
`BulletArmorReduction`, `MagicResistReduction`, `TechArmorDamageReduction` and
`BulletResistReduction` lower the TARGET's stat. Mapping them in
`STAT_KEY_TO_SCORE` would subtract from the buyer's score, exactly inverting
their worth — which is why they are sign-corrected in the estimator instead.
**Check the sign convention before mapping any new key.**

**Watch the scale when mapping a percent stat.** `StaminaCooldownReduction`
(12-18) was first weighted like a ones-scale flat stat, putting Stamina Mastery
at mobility 93 against Sprint Boots' 8.25 — an 11x distortion. Calibrate a new
key against an existing item in the same category before trusting it.

**Sentinel values are not debuffs.** `AbilityCooldownBetweenCharge` is `-1` on
156/156 live items, `ChannelMoveSpeed` is `-1` on 155/156, and `AbilityCharges`
is `0` on 156/156 — they mean "not applicable". They were previously mapped and
scored, charging a phantom −3 utility and −3 mobility to EVERY item and
silently understating the real utility/mobility of any item that had some
(Guardian Ward read 5.3 mobility instead of 8.3). They are now deliberately
excluded, with a note in `itemAdapter.ts`. **Check a key's value distribution
across all items before mapping it** — a constant value across the whole
catalogue is a sentinel, not a stat.

**`MIN_DEFENSIVE_NEED` exists for the same reason as `MIN_GUN_FACTOR`.** Before
it, the roster's tankiest hero derived exactly 0.00/0.00 and would never have
been offered a single vitality item — zero is unreachable downstream, not
merely low. Being naturally durable lowers the priority, never to nil. **Any
new per-hero signal added to this module needs the same floor — it is the
recurring bug class here.**

**Live validation (real API data).** Lady Geist's kit is 100% spirit-scaling
(Essence Bomb 1.22, Malice 0.558, Life Drain 0.3225, zero weapon scaling) AND
her gun gains +1.00 damage/boon, ranking 7th of 38 for DPS gained from boons
— so she correctly derives a need for BOTH (spirit 2.00, gun 1.07). Gun
quality spans 6.3× across the roster, and the derivation separates it
cleanly: Drifter (best gun) 2.00, Geist 1.07, Infernus 0.71, Graves (worst)
0.65 — note Infernus and Geist are both pure-spirit heroes, separated only by
gun quality. Her `moveSpeed` 6.3 is below roster average so mobility reads
high (1.60); `maxHealth` 880 is above average so tankiness reads low (0.15)
under the compensating interpretation.

---

## Common Bugs to Check

1. Image field: always `shop_image_webp` not `image_webp`
2. Item identifier: `item.id` not `item.classname`
3. Category value: `"gun"` not `"weapon"`
4. Spirit scaling: check BOTH `class_name` and `scaleType`
5. Prettier: run on ALL files before committing or CI fails
6. Dev server lock: `rm -rf .next` to clear Turbopack lock
7. gh CLI labels: `--field "labels[]=value"` syntax
8. Hydration: never read localStorage during SSR
9. Slot cap: 12 applies to ACTIVE items, not game plan
10. Sell refund: 50% not 80%
11. Ability costs: 1/2/5 points not 1/3/5
12. Tier 5 items: exclude from standard build planner
13. Boon level 0: `getBoonThreshold(0)` returns boonLevel 1
14. Consumed components: tracked after upgrade, size === 1

---

## CI Pipeline

GitHub Actions runs on every push:

1. Format (Prettier) — fails if any file not formatted
2. Typecheck (tsc --noEmit)
3. Lint (ESLint)
4. Build (next build)
5. Fixture (mini.ts — regression cases; check current count via `npm run mini` rather than trusting a hardcoded number here)

All five must pass. Run locally before pushing.
