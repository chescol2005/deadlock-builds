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
npx prettier --check .   # mirrors CI; fix with --write on the listed files only
npx tsc --noEmit
npx eslint .             # 0 errors required
npx next build           # judge by exit code, not log noise
npm run mini             # read BOTH harness summary lines
```

Kill dev server before finishing any session.
Never use `git add .` — stage files explicitly.
Paste `mini.ts` fixture output in every PR body before merge.

---

## Testing Expectations

Agreed 2026-10-20, before the post-F roadmap work. The goal: future logic
changes have to meet written expectations, not just compile.

- **No new test framework.** Fixtures stay in the two existing harnesses:
  `src/scripts/mini.ts` (app, live API data) and
  `lib/engine/__fixtures__/mini.ts` (engine, synthetic inputs). `npm run mini`
  runs both, and CI requires both to pass.
- **Every work item ships with fixtures sized to it.** UI/shell work gets a few
  integrity fixtures, e.g. every nav link resolves to a real `app/**/page.tsx`,
  every guide is linked, and new panels join Fixture 9's checklist lists. Logic
  work gets behavioural fixtures.
- **Known gap: real-hero basket behaviour.** Engine fixtures prove each term on
  made-up items. Nothing yet asserts that _real_ heroes get sensible baskets;
  that is only eyeballed with `npm run probe`. Close it as follows.
- **Suggested starter build (competitive-analysis rec. 6): use cases first.**
  Before any engine code, write the use cases / acceptance criteria and get the
  user's sign-off. Then encode them as live-data basket fixtures, per hero
  archetype at early / mid / late soul checkpoints:
  - stays within the soul budget;
  - never pairs an item with its own component;
  - every pick has a reason;
  - same input gives the same basket;
  - spirit heroes lean spirit, gun heroes lean gun;
  - later phases build on earlier ones rather than replace them.
- **Item scoring review (gates closing Milestone F):** build on those fixtures
  with recorded baseline baskets for a fixed set of heroes × soul levels. Any
  scoring change then shows up as a deliberate, reviewed diff, not silent drift.
  Assert invariants by default; snapshot exact baskets only where intended.

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

The old `https://assets.deadlock-api.com/v2/...` host is **gone**. It used to
301-redirect here, but as of 2026-10-17 its DNS returns NXDOMAIN, so any
reference to it is dead and should be rewritten to the host above. Match
analytics live on the same host, under `/v1/analytics/*`.

### Deadlock MCP server (dev-time only)

`.mcp.json` registers `https://api.deadlock-api.com/v1/mcp` as the `deadlock`
MCP server; each collaborator approves it on first load. It gives Claude Code
sessions read-only DuckDB SQL over hourly snapshots of the API database
(`mcp__deadlock__execute_query`, `list_heroes`, `list_items`, `list_patches`,
...). Use it for ad-hoc checks and `data-verifier` cross-checks, e.g. scoping a
question to a patch with `list_patches`. Never call it from app code or the data
pipeline: the app reads the REST API above. It is rate-limited (30 queries/min,
400/day), so bulk pulls still go through the REST API or the data dumps.
Always add a `start_time` range to `match_player` queries, or they scan every file.

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

Actual tree root is `lib/` and `app/` (no `src/` prefix), except `src/scripts/`:
the fixture runner `mini.ts`, `basketProbe.ts` (live basket check),
`pairProbe.ts` (measured item-pair interaction for one hero, Milestone F),
`fitPairTable.ts` (writes the committed pair-lift table), their shared loader
`pairData.ts`, `synergyReport.ts` (+ `synergyReport.client.js`; writes the
gitignored `reports/synergy-audit.html`, published as a private artifact), and
`syncBoonData.ts`.

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
lib/navigation.ts             — NAV_SECTIONS, GUIDES, isActiveSection(): the ONE
                                list of site sections/guides (site nav). SiteNav, the
                                /guide index and the homepage map over it; mini.ts
                                Fixture 12 fails if a guide folder is missing here
lib/engine/                   — engine scoring surface, parallel to lib/scoring/.
                                Its basket path is live in /build (heroBasket);
                                the staged recommendItems() pipeline is not
                                wired in. See scoring-engine-dev skill and
                                its engine-design-notes.md. Its fixtures live in
                                `lib/engine/__fixtures__/mini.ts`, a SEPARATE harness from
                                `src/scripts/mini.ts`; `npm run mini` chains both
  types.ts                    — SCORE_CATEGORIES (gunDamage/spiritDamage/gunShred/
                                spiritShred/antiHeal/bonusHealth/resist/shield/
                                sustain/mobility/utility/economy), ItemCandidate,
                                HeroNeedVector, BasketResult, MarginalTermFn
  heroNeed.ts                 — deriveHeroNeedVector() (Milestone E). spiritDamage
                                from ability coefficients; gunDamage from the hero's
                                own gun DPS (damage x fire rate) vs roster — two
                                INDEPENDENT signals, not one split budget
  itemAdapter.ts              — toItemCandidate(), toItemCandidates() — Item bridge
  basketSelect.ts             — constructBasket(), makeBasketContext(),
                                coverageTerm/categoryBonusTerm/procPlatformTerm/
                                hitReliabilityTerm/synergyTerm/pairTerm/
                                analyticsTerm. New terms plug in as one more
                                MarginalTermFn — no change to the greedy loop
  synergy.ts                  — SYNERGY_RULES: hand-authored positive item-pair
                                table, consumed by synergyTerm (see "Positive
                                synergy" in engine-design-notes.md)
  effectEstimator.ts          — expected-value ESTIMATES for proc/active effects
                                that carry no stat (Tesla Bullets etc.)
  pairLift.ts                 — Milestone F: pure pair-interaction fitting math +
                                PairLiftTable types; heroPairLift() (one hero's
                                slice, built server-side), pairLiftIn()/
                                pairLiftFor() lookups (null = no data, never 0)
  data/pairLiftTable.json     — GENERATED by `npm run fit-pairs`, committed;
                                per-hero measured pair lift (Oracle+, 90 days).
                                Sliced per hero in page.tsx (heroPairLift) and
                                read by pairTerm. Prettier-ignored
lib/analyticsStore.ts         — getItemAnalytics(), getHeroAnalytics() — cached,
                                fail-open match-analytics (win rate, matches) from
                                /v1/analytics/*; ItemAnalytics.itemId joins to
                                Item.numericId, NOT Item.id. Already wired into
                                /items display pages and the basket's analyticsTerm.
                                Also getHeroAccuracy()/resolveAccuracyAtRank() (shot
                                accuracy per hero per rank tier) and getRankTiers()
lib/coach/                    — AI coach module (M6) — not yet created, keep isolated
app/components/                — cross-route shared UI (Milestone C):
  Tooltip.tsx                 — Tooltip, InfoTooltip — sanctioned title= replacement
  AudienceTabs.tsx             — reusable two(+)-audience tab switcher
  HeroDifficultyBadge.tsx      — HeroDifficultyBadge, HeroArchetypeTags
  SiteNav.tsx                  — sticky global nav, mounted in app/layout.tsx;
                                collapses to a menu below md
  HomeHeroPicker.tsx           — homepage hero grid → /build/[heroId]
app/page.tsx                  — homepage: pitch, hero picker, how-it-works,
                                guides strip (fetch fails open to a /heroes link)
app/guide/page.tsx            — guides index (cards from GUIDES)
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

Every page gets the global `SiteNav`. `/guide/*` pages are linked from it, from
the `/guide` index and from the homepage. To add a guide, add its entry to
`GUIDES` in `lib/navigation.ts`; Fixture 12 enforces this.

---

## Skills & Agents

Project skills live in `.claude/skills/`, sub-agents in `.claude/agents/`.

**Skills** (invoke via `/skill-name` or auto-triggered by task context):

| Skill                      | Use for                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `deadlock-api-integration` | Fetching/normalizing API data, field-name bugs, spirit scaling                         |
| `scoring-engine-dev`       | Writing/changing `lib/scoring/` or `lib/engine/` logic; holds `engine-design-notes.md` |
| `ship-check`               | Pre-commit/pre-PR gate: prettier → tsc → build → mini                                  |
| `fixture-driven-dev`       | Writing/running `mini.ts` regression fixtures                                          |
| `coach-prompting`          | Designing/validating AI coach prompts (M6, `lib/coach/`)                               |
| `guide-page-skill`         | Building new `/guide/*` educational pages                                              |
| `wireframe-to-component`   | Turning a sketch/mockup into a component spec                                          |

**Sub-agents** (delegate via the Agent tool):

| Agent             | Tools             | Use for                                                        |
| ----------------- | ----------------- | -------------------------------------------------------------- |
| `data-verifier`   | read-only + web   | Cross-check code against live API / wiki, report discrepancies |
| `scoring-auditor` | read-only         | Audit a scoring/engine diff for architecture-rule compliance   |
| `panel-builder`   | read + edit/write | Scaffold a new build/guide panel to convention                 |

`data-verifier` can also use the `deadlock` MCP server (see "Data Source") when
the session has it approved.

**Product strategy:** `docs/competitive-analysis.md` compares the competitor
sites (feature gaps, prioritized recommendations). Read it before scoping a
new user-facing milestone.

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
- **On the same monthly cadence, and after any major item patch,** refresh
  the measured pair table with `npm run fit-pairs`. Review the `fits` block in
  the diff (matches, pairs kept and tau per hero) before committing. Then run
  `npm run synergy-report` and republish the private "Deadlock Synergy Audit"
  artifact to its existing link (never commit the HTML). See "Pair lift
  table" and "Synergy audit report" in engine-design-notes.md.
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

### Data flow (build planner)

```
app/build/[heroId]/page.tsx  (server, one Promise.all — no waterfall)
  ├─ getItems()                    all shop items (lib/itemStore, cached)
  ├─ fetchHeroById / fetchHeroAbilityItems → mapHeroAbilities()  hero kit
  ├─ getHeroStats(heroId)          HeroBaseStats incl. weapon_info DPS/falloff
  ├─ fetchVisibleHeroesEnriched()  hero cards + roster base stats (z-scores)
  ├─ getItemAnalytics / getHeroAccuracy / getRankTiers   /v1/analytics/*,
  │                                fail-open (empty map = no signal)
  └─ heroPairLift(pairLiftTable.json, heroId)   committed offline fit, sliced
                                   to this hero on the server (null = inert)
        │ props
        ▼
app/build/BuildClient.tsx  (client — owns ALL build state, derives via useMemo)
  ├─ itemStatTotals / totalSpiritPower / boonSouls ← buildItems + boon slider
  ├─ SuggestedItemsPanel  → scoreItems(allItems, goal, build)
  │                         lib/scoring: independent per-item rank vs a goal
  └─ heroBasket useMemo   → lib/engine: deriveHeroNeedVector + proc/hit
                            factors → toItemCandidates(unowned items) →
                            makeBasketContext(+ pairLift slice) →
                            constructBasket()
                            → HeroBasketSuggestion (presentational only)
```

The two suggestion paths are independent and must stay so: neither reads the
other's output. Engine inputs come from the hero and the already-owned build;
the basket's soul budget is `boonSouls − cost of owned items`.

---

## Milestone History

| Milestone | Status    | What it built                                                                                                                                       |
| --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | ✅ Closed | Hero Explorer MVP                                                                                                                                   |
| M2        | ✅ Closed | Build Planner UI                                                                                                                                    |
| M3        | ✅ Closed | URL persistence + share links                                                                                                                       |
| M4        | ✅ Closed | Real item data + scoring engine                                                                                                                     |
| M5a       | ✅ Closed | Game plan structure, phases, active grid                                                                                                            |
| M5b       | ✅ Closed | Hero stats, boon system, ability panel                                                                                                              |
| M5c       | ✅ Closed | Farming guide page (`/guide/farming`)                                                                                                               |
| A         | ✅ Closed | Ship-integrity fixes: CLAUDE.md drift, `lib/engine/` reconciliation, fetch-waterfall parallelization                                                |
| B         | ✅ Closed | State/component health: derived `assignmentMap`, `lib/buildUtils.ts`, `CategoryManager` split into 8 files                                          |
| C         | ✅ Closed | New player UX: shared Tooltip/AudienceTabs, simplified/advanced toggle, difficulty/archetype tags, Fixture 9                                        |
| D         | ✅ Closed | Guides: boons, itemization, lanes; shared `Minimap`/`PhaseTimeline`; data-verifier cadence                                                          |
| E         | ✅ Closed | Hero-aware basket scoring in `lib/engine/` + `HeroBasketSuggestion` (additive to `SuggestedItemsPanel`) — see engine-design-notes.md                |
| F         | 🚧 Active | Measured item-pair term (`pairTerm`, Oracle+ 90-day table) live in the basket; synergy audit report (private artifact) — see engine-design-notes.md |
| G         | ⏸ Queued  | Need-vector enrichment (stretch) — full scope in engine-design-notes.md                                                                             |
| M6        | ⏸ Queued  | AI coach layer + skill path planner (`lib/coach/`) — see M6 Design Decisions                                                                        |

### ⚠️ Reminder: item scoring review gates closing Milestone F

Milestone F stays 🚧 Active until a thorough item scoring review is done.
That review comes **after** these three pieces of work, in this order (numbers
are the recommendation numbers in `docs/competitive-analysis.md`):

1. ✅ Global nav + real homepage (rec. 1): links the orphaned `/guide/*` pages (#85)
2. "Start from a suggested build" (rec. 6): seed `/build/[heroId]` from
   `constructBasket()` at early / mid / late soul checkpoints. Use cases are
   approved in `docs/starter-build-use-cases.md`. Order: 2b pipeline + fixtures
   → 2c engine (owned coverage, components) → **need-vector fix pulled forward
   from the scoring review** (its own scoring PR, works off leans L1–L4) → 2d
   UI. The UI must not ship while every hero gets the same build (finding F1).
3. Per-page metadata / OG images (rec. 2) + mobile pass on `/build` (rec. 3)

Then, **before marking F ✅ Closed**, do the item scoring review. Cover both
suggestion paths: `lib/scoring/` (`scoreItems`, goal weights, anti-synergy) and
`lib/engine/` (basket terms incl. `pairTerm`, need vector, item adapter). Check
live baskets with `npm run probe` across heroes and boon levels. Also run the
`scoring-auditor` and `data-verifier` agents, and refresh the pair table + synergy
audit report first if the data is over a month old. Use the baseline
baskets and live basket fixtures described in "Testing Expectations". When
the review is done, update the F row above and delete this reminder.

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

## Engine Design Notes (lib/engine/) — moved

The full design record for the basket engine (Milestone E onward, ~700
lines) lives in
**`.claude/skills/scoring-engine-dev/engine-design-notes.md`**. It is kept
out of this file so it only loads for engine work. **Read the relevant section
before changing anything in `lib/engine/`, `lib/analyticsStore.ts`'s accuracy
code, or `lib/itemNormalizer.ts`'s stat scaling** — most entries record a bug
that already happened once.

Sections: Origin and architecture · Gun accuracy (rank-aware) · Range falloff ·
Defence (flat health vs % resist vs shields) · Item scoring coverage audit ·
Item values are NOT flat (published scaling coefficients) · A "proc" is not
always per-bullet · Non-substitutable categories (shred, anti-heal) · Positive
synergy (hand-authored pair table) · Milestone F spike (measured pair
interaction) · Pair lift table · Pair term in the basket (pairTerm, Oracle+,
measured wins over hand rules) · Synergy audit report (handPairs, rule-reason
review).

The five rules that bite most often (details in the notes):

- Every per-hero signal needs a floor above zero (`MIN_GUN_FACTOR`,
  `MIN_DEFENSIVE_NEED`): zero is unreachable behind the relevance gate.
- Missing data is not zero, and "unknown" is not "inapplicable".
- Check a stat key's value distribution and sign before mapping it: catalogue-
  wide constants are sentinels, enemy debuffs are stored negative.
- Item value from the already-owned build only, never from other candidates.
- Pair and context value is Milestone F: do not inflate per-item constants to
  fake it.

**Live check:** to see what the basket picks for a real hero, run
`npm run probe -- <hero> [--owned a,b] [--boon N] [--rank T] [--item x]`
(`src/scripts/basketProbe.ts`, `--help` for details). It mirrors
`BuildClient`'s `heroBasket` pipeline on live API data, so don't write a
throwaway script for this — and if that pipeline changes, update the probe.

---

## Common Bugs to Check

1. Image field: always `shop_image_webp` not `image_webp`
2. Item identifier: `item.id` not `item.classname`
3. Category value: `"gun"` not `"weapon"`
4. Spirit scaling: check BOTH `class_name` and `scaleType`
5. Prettier: CI checks formatting on ALL files — run `prettier --check .`, `--write` only changed files (never bare `--write .`). If `--check` flags dozens
   of files you never touched on Windows, it's CRLF from a checkout that predates
   `.gitattributes`. `prettier --check --end-of-line auto .` passing confirms
   that's all it is. Fix by re-checking-out those files with a clean tree. Do NOT
   `--write` them.
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

GitHub Actions (`.github/workflows/ci.yml`) runs on pull requests to `main`,
pushes to `main`, and manual dispatch — NOT on every push to a feature branch.
It runs on every PR, docs-only included: `ci` is a required status check in the
`main` ruleset, so a PR that skips the workflow can never merge. Do not re-add
`paths-ignore` to `ci.yml`.

1. Format (Prettier) — fails if any file not formatted
2. Typecheck (tsc --noEmit)
3. Lint (ESLint)
4. Build (next build)
5. Fixture (mini.ts — regression cases; check current count via `npm run mini` rather than trusting a hardcoded number here)

All five must pass. Run locally before pushing.
