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
                                scoring-engine-dev skill; fixtures run via `npm run mini`
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
  SuggestedItemsPanel.tsx     — AI-adjacent suggestions
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

| Milestone | Status    | What it built                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | ✅ Closed | Hero Explorer MVP                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M2        | ✅ Closed | Build Planner UI                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M3        | ✅ Closed | URL persistence + share links                                                                                                                                                                                                                                                                                                                                                                                                                 |
| M4        | ✅ Closed | Real item data + scoring engine                                                                                                                                                                                                                                                                                                                                                                                                               |
| M5a       | ✅ Closed | Game plan structure, phases, active grid                                                                                                                                                                                                                                                                                                                                                                                                      |
| M5b       | ✅ Closed | Hero stats, boon system, ability panel                                                                                                                                                                                                                                                                                                                                                                                                        |
| M5c       | ✅ Closed | Farming guide page (`/guide/farming`)                                                                                                                                                                                                                                                                                                                                                                                                         |
| A         | ✅ Closed | Ship-integrity fixes: CLAUDE.md drift, dead `lib/engine/` reconciliation, self-test IIFE removal, doc sync, homepage/metadata fix, fetch-waterfall parallelization                                                                                                                                                                                                                                                                            |
| B         | ✅ Closed | State/component health: `assignmentMap` derived via `useMemo`, business logic extracted to `lib/buildUtils.ts`, `CategoryManager` decomposed into 8 files, slot-cap/cleanup fixtures                                                                                                                                                                                                                                                          |
| C         | ✅ Closed | New player UX foundations: shared Tooltip/AudienceTabs components, tooltip copy retrofit, simplified/advanced toggle, `/build` onboarding, hero difficulty/archetype tags, UX checklist fixture (`mini.ts` Fixture 9)                                                                                                                                                                                                                         |
| D         | ✅ Closed | Guide content expansion: boons (`/guide/boons`), itemization (`/guide/itemization`), lane mechanics (`/guide/lanes`) pages; `Minimap`/`PhaseTimeline` generalized into `app/guide/components/` and reused across all 4 guide pages; `mini.ts` extended to `lib/farming` + new guide data (72 → 88 fixtures); data-verifier cadence documented (see "Data Verification Cadence" above — no durable scheduler exists for actual automation yet) |
| M6        | ⏸ Queued  | AI coach layer + skill path planner (sequenced after Milestone C so it has UX surfaces to attach to)                                                                                                                                                                                                                                                                                                                                          |

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
