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
  **Built (R1, 2026-10-25):** `lib/engine/__fixtures__/frozen/` holds a pinned
  snapshot of the live inputs (`npm run capture-inputs`) and 72 recorded baseline
  baskets (`baselines.json`: the 8 reference heroes x boon 5/10/16/22/29, the
  starter build). Engine harness section 25 fails on
  any change; review it with `npm run baseline`, accept it with
  `npm run baseline -- --update`, and describe the diff in the PR body. Live
  ratchets (M3, O2) carry a 0.01 noise band; M1's mean distance must stay <= 0.12.

---

## Production API — Verified Function Signatures

Verified by mini.ts. Do not guess — use these exactly.

```typescript
// Items
item.id; // string identifier (NOT item.classname)
item.category; // "gun" | "spirit" | "vitality" (NOT "weapon")

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
hero.complexity; // number, 1-4 (Sinclair is 4) — Valve's official difficulty rating
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
- The site is dark-only (`color-scheme: dark` in `globals.css`, Work 3b): design
  panels for the dark zinc + amber theme, never for a light one
- Touch: tap targets get `pointer-coarse:min-h-10 pointer-coarse:min-w-10` (40px
  on touch screens, desktop size unchanged); `InfoTooltip` opens on tap. `/build`
  stacks its four panels below `xl` (Fixture 16)
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
  `HeroBasketSuggestion` and `StarterBuildPanel`, driven by a single `viewMode` state in
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
copy quality or AI-coach hooks (the coach exists since M6: lib/coach/, CoachPanel) — those two remain
manual review, not a fixture guarantee.

---

## Key Files Reference

Actual tree root is `lib/` and `app/` (no `src/` prefix), except `src/scripts/`:
the fixture runner `mini.ts` (+ `starterBuildFixtures.ts`, Fixture 13: live
starter-build fixtures from `docs/starter-build-use-cases.md`), `basketProbe.ts`
(live basket check), `basketData.ts` (live loader shared by the probe and
Fixture 13, mirroring `app/build/[heroId]/page.tsx`),
`bigItemChecks.ts` (Milestone H's big-item measures P1–P5 for Fixture 13),
`pairProbe.ts` (measured item-pair interaction for one hero, Milestone F),
`fitPairTable.ts` (writes the committed pair-lift table), `fitCategorySplit.ts`
(writes the committed per-hero gun/spirit/vitality split), their shared loader
`pairData.ts`, `heroRoleCheck.ts` (`npm run role-check`: checks `lib/heroRoles.ts` against
measured net worth, jungle share and damage, M6.0b), `synergyReport.ts` (+ `synergyReport.client.js`; writes the
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
lib/abilityCoefficients.ts    — HeroAbility, calculateAbilityDamage()
lib/statLabels.ts             — STAT_PROPERTY_LABELS (stat key → plain label)
lib/heroRoles.ts              — HERO_ROLES: each hero's team role (carry / off-carry /
                                support / initiator / tank / hybrid), from high-level
                                players' videos checked against match data (M6.0b,
                                docs/milestone-m6.md §4). For the coach; NOT a scoring input
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
  basketSelect.ts             — constructBasket(), makeBasketContext() (owned items seed
                                coverage; effectiveCost(): upgrades consume owned
                                direct components and cost the difference;
                                picks ranked by value / rankingPrice(): per soul
                                when souls are tight, per slot when slots bind;
                                laning tempo; shop budgets from the measured phase
                                split), coverageTerm (saturating) + coversNeed()
                                relevance gate, categoryBonusTerm/procPlatformTerm/
                                hitReliabilityTerm/synergyTerm/pairTerm/
                                analyticsTerm/phaseItemTerm. New terms plug in as
                                one more MarginalTermFn — no change to the loop.
                                basketPlans() (Milestone H): the greedy basket vs one
                                per big-item anchor (bought first); an anchored plan
                                wins only when worth > ANCHOR_MARGIN more
  heroDamage.ts               — one value scale, damage half: % of this hero's
                                trade DPS through its own weapon and kit
                                (sustainedGunDps, castsPerTrade, damageValues)
  enemyHealth.ts              — a typical enemy's max health at these souls / boon level
                                (2026-10-25): roster base x (1 + vitality bonus) + item
                                health, rates measured into heroPhaseItems.json; prices
                                Toxic / Siphon Bullets (REFERENCE_ENEMY_HEALTH = fallback)
  kitHeal.ts                  — a hero's own self-healing in HP per trade (Milestone G3),
                                from HeroAbility.selfHeals; prices heal amp and the
                                sustain need for heroes with no measured profile
  heroFight.ts                — one value scale, everything else: health, resist,
                                healing, CC, mobility, economy in % of fight value
                                (fightValues, estimateFightValue)
  synergy.ts                  — SYNERGY_RULES: hand-authored positive item-pair
                                table, consumed by synergyTerm (see "Positive
                                synergy" in engine-design-notes.md)
  effectEstimator.ts          — expected-value ESTIMATES for proc/active effects
                                that carry no stat (Tesla Bullets etc.), each with
                                a `unit` + `quantity` for the value scale
  pairLift.ts                 — Milestone F: pure pair-interaction fitting math +
                                PairLiftTable types; heroPairLift() (one hero's
                                slice, built server-side), pairLiftIn()/
                                pairLiftFor() lookups (null = no data, never 0)
  data/pairLiftTable.json     — GENERATED by `npm run fit-pairs`, committed;
                                per-hero measured pair lift (Oracle+, 90 days).
                                Sliced per hero in page.tsx (heroPairLift) and
                                read by pairTerm. Prettier-ignored
  categorySplit.ts            — measured per-hero gun/spirit/vitality soul split:
                                heroCategorySplit() slice, applyCategorySplit()
                                (redistributes the kit need between the three
                                families); phaseView()/phaseForSouls() pick the
                                early/mid/late split, applyStatProfile() sets the
                                five non-family categories from the phase's
                                measured stat profile; categorySplitTerm in
                                basketSelect.ts steers the build's shop split
  data/heroCategorySplit.json — GENERATED by `npm run fit-category-split`,
                                committed (Oracle+, 30 days: final split, early/
                                mid purchase splits, per-phase stat profiles).
                                Sliced per hero in page.tsx. Prettier-ignored
  phaseItems.ts               — heroPhaseItems() slice + types for what Oracle+
                                players on each hero buy per phase; read by
                                phaseItemTerm (population data, capped)
  data/heroPhaseItems.json    — GENERATED by `npm run fit-category-split` (same
                                run), committed; per hero x phase item buy rates.
                                Sliced per hero in page.tsx. Prettier-ignored
  heroBasket.ts               — runHeroBasket(): THE hero-basket pipeline (need
                                vector → accuracy → candidates → context →
                                constructBasket). BuildClient, the probe and the
                                starter build all call it; never re-inline it
  starterBuild.ts             — buildStarterBuild(): runHeroBasket chained at
                                STARTER_PHASE_BOON_LEVELS (early/mid/late =
                                5,900/16,700/30,000 souls), buyOrder cheapest
                                first, each phase owning
                                the earlier picks (Work 2; live in /build via
                                StarterBuildPanel since 2d)
lib/starterBuildApply.ts      — applyStarterBuild(): StarterBuild → planner items +
                                phase/active flags (owned kept, trade-ins leave,
                                early active up to 12, upgrades keep their
                                component's slot); isAppliedBuild(),
                                itemsRemovedByApply() for the UC3 confirm
lib/basketReasons.ts          — headlineTerm()/headlineReason(): which reason a
                                pick headlines in the simplified view (positive,
                                never population data; MarginalTerm.plain first;
                                a saved-up big item's "anchor" reason first, H3)
lib/seo.ts                    — page metadata helpers (heroPageMetadata,
                                itemPageMetadata, buildPageMetadata, guideMetadata),
                                share-preview data (buildPreview, decodeBuildParam),
                                sitemapEntries(), siteUrl() (Work 3a)
lib/ogAssets.ts               — fetchImageDataUri(): fail-open image inlining for
                                share-preview renders (PNG/JPEG/GIF only, Satori)
lib/analyticsStore.ts         — getItemAnalytics(), getHeroAnalytics() — cached,
                                fail-open match-analytics (win rate, matches) from
                                /v1/analytics/*; ItemAnalytics.itemId joins to
                                Item.numericId, NOT Item.id. Already wired into
                                /items display pages and the basket's analyticsTerm.
                                Also getHeroAccuracy()/resolveAccuracyAtRank() (shot
                                accuracy per hero per rank tier) and getRankTiers()
lib/coach/                    — the build coach (M6, docs/milestone-m6.md): pure, imports
                                nothing from lib/engine / lib/scoring / app (Fixture 18).
                                coachTypes (facts), triggerRules (18 insights x trigger x
                                audience, priority: 12 build + 7 lane insights on the
                                match_reviewed trigger), sessionMemory (never repeat),
                                templates (approved wording, new player / veteran),
                                responseValidator (word limits, fact-only numbers and items,
                                no internal terms). getCoachMessage (one per build action),
                                getCoachMessages (up to 2 per match review). Templates only;
                                no model yet
lib/coachContext.ts           — buildCoachContext(): the ONE bridge from a build to the coach
                                (M6.3): facts from the build, basket plain reasons, anti-
                                synergies, roles; upgrade-aware (Fixture 19)
lib/matchReview/              — the match review's lane facts (docs/match-review-use-
                                cases.md): parseMatchMetadata() (unknown JSON -> typed match;
                                missing or mistyped fields rejected, never read as 0),
                                laneReview() (one hero's 9:00 lane against its two lane
                                opponents and partner, the §4.1 judgements, or a typed
                                no-review reason), parsePlayerId() (Steam profile link,
                                SteamID64 via BigInt, friend code, SteamID3/2 -> account id;
                                custom /id/ links refused) and parseMatchHistory() (recent
                                normal matches, newest 10), and benchmark.ts (MRB1: the per-
                                hero performance curve's 9:00 point, your starting-rank tier as
                                the default bracket, a one-std judgement for five stats).
                                Pure; imports only itself and the
                                Item type (Fixtures 21 and 23, offline; a pinned real match
                                in __fixtures__/)
lib/matchReviewCoachContext.ts — buildMatchCoachContext(): the ONE bridge from a lane report
                                to the coach (MR2): lane facts with game-clock times, souls
                                rounded to 50, and typicalSoulsFact() from a loaded benchmark
                                (MRB3; Fixture 22)
app/components/                — cross-route shared UI (Milestone C):
  Tooltip.tsx                 — Tooltip, InfoTooltip — sanctioned title= replacement
  AudienceTabs.tsx             — reusable two(+)-audience tab switcher
  HeroDifficultyBadge.tsx      — HeroDifficultyBadge, HeroArchetypeTags
  SiteNav.tsx                  — sticky global nav, mounted in app/layout.tsx;
                                collapses to a menu below md
  HomeHeroPicker.tsx           — homepage hero grid → /build/[heroId]
app/api/og/build/route.tsx    — share-preview image (?hero=&build=): hero art +
                                up to 6 items; the site's generic card without a hero
app/sitemap.ts, app/robots.ts — sitemap (static routes, guides, hero/build/item
                                pages; never share links) and robots
app/page.tsx                  — homepage: pitch, hero picker, how-it-works,
                                guides strip (fetch fails open to a /heroes link)
app/guide/page.tsx            — guides index (cards from GUIDES)
app/match/                    — the match review page (MR3): page.tsx (server: heroes +
                                shop items), MatchReviewClient (lookup, hero picker, review,
                                coach), matchApi.ts (the ONE browser fetch of match metadata;
                                the optional deadlock-api key goes only there, as X-API-KEY,
                                never to an app route, localStorage or the URL: Fixture 23),
                                matchMessages.ts (plain wording for every error), and
                                presentational panels in components/ (LaneBenchmarkPanel:
                                you against a typical player, rank picker; MRB2)
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
  HeroBasketSuggestion.tsx     — hero-need basket (Milestone E): a SET of items
                                chosen together. Presentational only — receives a
                                BasketResult via props, computes nothing. Sits
                                The one suggestion surface since the goal-based
                                SuggestedItemsPanel / scoreItems was retired (R3).
                                Prices picks at BasketPick.effectiveCost and names
                                the owned component an upgrade trades in
  CoachPanel.tsx               — the coach in /build (M6.5): latest tip, dismiss, mute (per
                                visitor, useSyncExternalStore over localStorage), "Review my
                                build". Presentational; BuildClient queues a coach event from
                                each action handler and freezes the answer (Fixture 20)
  StarterBuildPanel.tsx        — "Start from a suggested build" (Work 2d): early /
                                mid / late columns in buy order, a plain-English
                                reason per item, apply + inline trade-in confirm.
                                Presentational; BuildClient computes the build
  basketDisplay.tsx            — CATEGORY_STYLES, fmt(), TermBreakdown shared by
                                the two basket panels
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

Every page exports `metadata` or `generateMetadata` (Fixture 15). Titles are
bare ("Boons Guide"): the root layout's template adds "| Deadlock Foundry".
Page metadata comes from `lib/seo.ts`; a page's own `openGraph` replaces the
layout's, so spread `BASE_OPEN_GRAPH` into it.

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
  table" and "Synergy audit report" in engine-design-notes.md. Also refresh
  the category split with `npm run fit-category-split` and review its diff
  hero by hero ("Measured category split" in engine-design-notes.md). The same
  run rewrites `heroPhaseItems.json`; review its top early / mid items per hero
  ("What players on this hero buy" in engine-design-notes.md). After any refit,
  `npm run capture-inputs -- --tables-only` then `npm run baseline` shows what the
  new tables change; commit the updated baselines with the refit. Since G4 the stat
  profile is fitted in each hero's fight-value units (`method.profileUnits`). The fitter
  refuses to run without shot accuracy, and lists heroes it had to fit in item units
  (`method.itemUnitHeroes`). The same run writes the enemy health rates
  (`heroPhaseItems.json` top-level `enemyHealth`); check they stay close, and that engine
  section 31's calibration (3,300–4,600 at a 45k-soul build) still passes.
- **On the same monthly cadence, run `npm run role-check`.** It reports heroes whose measured
  mid-game net worth or damage contradicts their primary role in `lib/heroRoles.ts` (jungle
  share is printed for context). A flag is for the user to decide; never change a role
  silently. Add any newly released hero to the table (Fixture 17 warns until you do).
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
  ├─ heroPairLift(pairLiftTable.json, heroId)   committed offline fit, sliced
  │                                to this hero on the server (null = inert)
  ├─ heroCategorySplit(heroCategorySplit.json, heroId)  measured gun/spirit/
  │                                vitality split, same pattern (null = kit only)
  └─ heroPhaseItems(heroPhaseItems.json, heroId)  per-phase item buy rates,
                                   same pattern (null = phaseItemTerm inert)
        │ props
        ▼
app/build/BuildClient.tsx  (client — owns ALL build state, derives via useMemo)
  ├─ itemStatTotals / totalSpiritPower / boonSouls ← buildItems + boon slider
  └─ heroBasket useMemo   → lib/engine/heroBasket.ts runHeroBasket():
                            deriveHeroNeedVector + proc/hit factors →
                            toItemCandidates(unowned items) →
                            makeBasketContext(+ pairLift slice) →
                            constructBasket()
                            → HeroBasketSuggestion (presentational only)
  └─ starter build memos  → lib/engine/starterBuild.ts buildStarterBuild()
                            (the same function chained at fixed checkpoints,
                            independent of the boon slider) →
                            lib/starterBuildApply.ts on apply →
                            StarterBuildPanel (presentational only)
```

There is one suggestion path: the hero basket (and the starter build, which
chains it). The goal-based `scoreItems` path was retired in the item scoring
review (R3, 2026-10-25). Engine inputs come from the hero and the already-owned
build; the basket's soul budget is `boonSouls − cost of owned items`.

---

## Milestone History

| Milestone | Status    | What it built                                                                                                                                                                            |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | ✅ Closed | Hero Explorer MVP                                                                                                                                                                        |
| M2        | ✅ Closed | Build Planner UI                                                                                                                                                                         |
| M3        | ✅ Closed | URL persistence + share links                                                                                                                                                            |
| M4        | ✅ Closed | Real item data + scoring engine                                                                                                                                                          |
| M5a       | ✅ Closed | Game plan structure, phases, active grid                                                                                                                                                 |
| M5b       | ✅ Closed | Hero stats, boon system, ability panel                                                                                                                                                   |
| M5c       | ✅ Closed | Farming guide page (`/guide/farming`)                                                                                                                                                    |
| A         | ✅ Closed | Ship-integrity fixes: CLAUDE.md drift, `lib/engine/` reconciliation, fetch-waterfall parallelization                                                                                     |
| B         | ✅ Closed | State/component health: derived `assignmentMap`, `lib/buildUtils.ts`, `CategoryManager` split into 8 files                                                                               |
| C         | ✅ Closed | New player UX: shared Tooltip/AudienceTabs, simplified/advanced toggle, difficulty/archetype tags, Fixture 9                                                                             |
| D         | ✅ Closed | Guides: boons, itemization, lanes; shared `Minimap`/`PhaseTimeline`; data-verifier cadence                                                                                               |
| E         | ✅ Closed | Hero-aware basket scoring in `lib/engine/` + `HeroBasketSuggestion` — see engine-design-notes.md                                                                                         |
| F         | ✅ Closed | Measured item-pair term (`pairTerm`) + synergy audit; starter build; item scoring review (`docs/item-scoring-review.md`, R1–R4: baselines, value-scale fixes, `scoreItems` retired)      |
| G         | ✅ Closed | Kit and sustain enrichment: healing between trades, unpriced healing keys + Siphon Bullets, kit self-heal + heal amp, profile refit in fight-value units (`docs/milestone-g.md`)         |
| M6        | ✅ Closed | Build coach: hero role table (checked against data), coach core with approved template wording, context builder, CoachPanel in `/build` (`docs/milestone-m6.md`)                         |
| M7        | ⏸ Queued  | Beginner / Aggressive / Safe starter templates with coach annotations (engine work, moved out of M6)                                                                                     |
| M8        | ⏸ Queued  | Skill-path planner from match data, on the existing grid (moved out of M6)                                                                                                               |
| MR        | ✅ Closed | Match review (`/match`): lane facts from match metadata, six coach lane insights, the page with an optional deadlock-api key (`docs/match-review-use-cases.md`, PRs #123–#127)           |
| MRB       | ✅ Closed | Match review benchmarks: you against a typical player on your hero at 9:00, rank picker defaulting to your starting rank, coach souls line (§10, PRs #134–#138)                          |
| H         | ✅ Closed | Planned big items: anchored plans in the basket (save up for a big item when the plan is worth more), "worth saving up for" reason; lookahead tried and rejected (`docs/milestone-h.md`) |
| MR5       | ⏸ Queued  | Optional Anthropic key: a model rewords the lane facts in the browser; needs per-field number checks in the validator first                                                              |

### After Milestones F and G: open follow-ups

Milestone F closed on 2026-10-25 with the item scoring review (PRs #101–#107; criteria,
results and accepted gaps in `docs/item-scoring-review.md`). Milestone G closed the same
day (PRs #108–#114; `docs/milestone-g.md`). Open, in no fixed order:

- **Rush items: the value model.** Milestone H's anchored plans let the basket save up
  (late tier-4 items held 21 → 26 / 52), but real early rushes stay under-bought (1 / 24):
  the value model rates a few cheap basics close to one rush item. Neither a slot cost nor
  whole-build lookahead fixed it (`docs/milestone-h.md` §7, C5 / C6 re-accepted).
- **In-phase upgrades.** H2 keeps Rapid Rounds → Swift Striker (84% of real Haze players
  build it early) out of one phase.
- **Real ability tiers.** Use BuildClient's actual ability tiers for upgrade-granted
  charges (R2c) and kit self-heal (G3), instead of the per-phase prior.
- **Unmeasured healing constants.** `RECOVERY_WEIGHT`, `GAP_FARM_SHARE` and
  `SITUATIONAL_HEAL_SHARE` are reasoned, not fitted (G2a / G2b).
- **Unmeasured ambush share.** `AMBUSH_OPEN_SHARE` (Shadow Weave, 2026-10-31) is reasoned.
- **Post-patch refit (2026-10-30 patch).** Frozen inputs and the committed tables predate
  it. After 1–2 weeks of matches: fit-pairs, fit-category-split, capture-inputs, baseline.
- **Unpriced healing.** Parry and kill heals have no measured rate
  (`UNPRICED_HEALING_KEYS`). Heals against creeps between trades are not modelled.
- **Item tags.** `Item.tags` are slot-derived and only feed the unwired staged pipeline.
- **Narrow Hero Basket column.** Item names truncate in the 260 px right column of
  `/build` at 1366.

### After the match review: open follow-ups

The match review closed on 2026-10-27 (PRs #123–#127; `docs/match-review-use-cases.md`,
session record `docs/session-2026-10-27-match-review.md`). Open:

- **MR5, model wording.** The validator allows any digit run found in a fact's text
  fields; make number checks per field before a model writes lane messages.
- **Benchmarks.** Built 2026-10-29 (§10, PRs #134–#138). Open: the curve covers the last
  30 days, not the match's patch; and the team-average badge in match metadata has been 0
  since about 2026-08-17, so the default bracket is the player's own starting rank.
- **Beyond the lane.** Mid-game, objectives, item timings against the starter build.
- **Phone layout.** Built: the hero picker collapses once a hero is chosen. The recent
  matches list (10 rows) still sits above the report on phones; collapse it too if it
  gets in the way.

---

## M6 Design Decisions (locked before coding; M6 closed 2026-10-25)

Built as planned in `docs/milestone-m6.md`, with three user decisions: templates first (no
model, so no Claude.ai prompt sandbox yet; a model comes later for free-form questions), on
for everyone with a mute, and the role table checked against match data. Per-ability damage
impact, the skill-path planner (M8) and the Beginner / Aggressive / Safe templates (M7) were
moved out of M6.

- AI coach is **proactive** — surfaces warnings as items are added,
  not only when the user asks
- Coach module lives in `lib/coach/` — zero imports from scoring or the engine; full plan and decisions in `docs/milestone-m6.md` (approved 2026-10-25: templates first, on for everyone, role table checked against data)
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
review) · One basket pipeline, and the starter build (runHeroBasket,
buildStarterBuild, Work 2) · Owned coverage and upgrade components · Measured
category split (heroCategorySplit.json, categorySplitTerm) · Ranking by value per
binding resource · Phase-aware split and measured stat profile · Hero-relative damage
and soft saturation · One value scale (heroDamage.ts, heroFight.ts) · Spend like real
players (shop budgets, laning tempo, buy order) · What players on this hero buy
(phaseItems.ts, phaseItemTerm) · Planned big items (basketPlans, Milestone H).

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
15. Fail-open fetch `catch`: call `unstable_rethrow(err)` (from `next/navigation`)
    first. Next marks routes dynamic by throwing from `fetch`; swallowing it
    prerendered `/items` with zero items. Fixture 14 enforces this
16. Drag-and-drop loops (React #185, production only): a droppable that opens on
    hover must stay open while the drag is over its own children, or opening it
    moves `over` onto a child, it closes, and dnd-kit re-renders forever
    (`CollapsibleFixedSection`, Fixture 16). Test touch drags on a prod build

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
