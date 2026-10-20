# Competitive Analysis — Deadlock companion sites

_Snapshot: 2026-10-18 (patch "City Never Sleeps" / 2026-10-16 minor). Branch `competitive-analysis`._

Sites reviewed: [statlocker.gg](https://statlocker.gg/) (+ its sister build site
[buildlocker.gg](https://buildlocker.gg/)), [tracklock.gg](https://tracklock.gg/),
[buildlock.io](https://buildlock.io/), [deadlocklabs.gg](https://deadlocklabs.gg/),
[deadlock-api.com/analytics](https://deadlock-api.com/analytics/heroes).

---

## TL;DR

1. **The market is crowded with trackers, not planners.** Four of the five competitors are, at
   heart, match-data products: player profiles, tier lists, win rates, leaderboards, a free
   desktop app with live lobby scouting. They compete on data volume and polish, and two of
   them have heavyweight backing (Tracklock is now part of **U.GG**; Statlocker has partnered
   with **Dotabuff**).
2. **Every competitor answers "what do good players buy?" Nobody answers "what should _I_ buy
   next, given what I already own, and why?"** All their recommendations are descriptive
   statistics (most-bought, highest win rate, win-probability-added). None reason about the
   build in front of the user.
3. **That gap is our competitive advantage.** Foundry is the only site that has a
   deterministic, hero-aware engine conditioned on the user's current build and soul budget.
   It shows a plain-English reason for each pick, does ability-coefficient spirit-scaling math,
   and wraps it all in a new-player-first UI. Our edge is **understanding**, not data.
4. **Data is not our moat and never will be.** We consume the same public deadlock-api.com
   floor everyone else does. Statlocker goes further: it ingests replays and runs a companion
   app ("client-side detail the API never returns"). We should not try to win the tracker race.
5. **Our biggest weaknesses are shell, not engine.** We have no site navigation. The homepage
   is a splash screen. The build planner doesn't work on mobile. The guides aren't linked from
   anywhere. We have no per-page SEO, and new users land on an **empty** build. Competitors
   are far ahead on wayfinding, and these fixes are cheap.
6. **The closest functional threats are deadlock-api.com's Build Designer and Statlocker's
   Build Lab.**
   - **Build Designer:** time-staged item columns with a "Suggested" pick per stage and
     confidence intervals.
   - **Build Lab:** "construct a build and see its computed stats."
   - Both prove the planner niche is real. Both are statistical rather than explanatory.

---

## Method and caveats

- Pages were fetched as server-rendered HTML. Statlocker, Buildlocker's editor pages, BUILDLOCK
  and parts of Tracklock are **client-rendered JS shells**, so the interactive UIs could not be
  observed in some places:
  - Build Lab
  - Build Exporter
  - filters
  - charts
  - colour palettes

  Where a claim relies on a site's own marketing copy rather than an observed UI, it says so.

- **deadlocklabs.gg returned HTTP 403** to automated fetches, and the Wayback Machine was not
  reachable. Its section comes from search-indexed pages on its own domain (`/about`, `/app`,
  `/tools/*`, `/builds/create`, `/arcade/*`) and is the least verified.
- **Recommended follow-up:** spend 30 minutes in a real browser on Statlocker's Build Lab and
  Build Exporter, deadlock-api's Build Designer, and Deadlock Labs' `/builds/create`. Those
  are the three tools closest to ours, and their editors could not be inspected here.

---

## Landscape at a glance

| Site                          | What it really is                                                   | Backing / funnel                                                               | Build tooling                                                                                                           | New-player focus                                                            |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Statlocker** (+Buildlocker) | Deepest tracker: proprietary models, replay timelines, ~50 features | Dotabuff partnership; free desktop companion (also on Overwolf)                | Build Lab (computed stats, unobserved), in-game Exporter, build library with grades and rank splits                     | `/new-players`, "Coming from Dota/League", shop speedrun game               |
| **Tracklock**                 | Classic tracker on U.GG's design system                             | **U.GG network**; Windows app is the #1 nav item; Discord                      | Stats-generated hero builds + pro feed; **no planner, no community builds**                                             | One-line explainer per build section ("Buy in order from left to right")    |
| **BUILDLOCK**                 | Personal brand / editorial site of pro POSHYPOP                     | Upcoming paid "BUILDLOCK PRO"; coaching, merch funnels                         | Curated builds with reasoning; user "Build Lab" is **"Coming soon"**                                                    | Ranks explainer; "why it works" editorial                                   |
| **Deadlock Labs**             | Tracker + wiki + "coaching tool" + arcade                           | Free desktop overlay (lobby scouting, follow-a-build in game), Twitch overlays | Community build creator (`/builds/create`), build library in overlay                                                    | Wiki, arcade games (Deadle, draft trainer)                                  |
| **deadlock-api.com**          | Open-data stats portal **and our upstream data provider**           | Patreon + sponsors (incl. Statlocker); powers ~32 tracker sites                | **Build Designer**: time-staged columns, per-stage "Suggested" pick, ±CI win rate, save + copy link                     | Natural-language search ("Who counters Abrams"), S–D tier list              |
| **Deadlock Foundry (us)**     | Build planner + guides with a hero-aware recommendation engine      | None yet                                                                       | Full planner: categories, phases, 12-slot actives, ability leveling, soul timeline, two suggestion engines, share links | Simplified/advanced toggle, tooltips, difficulty/archetype badges, 4 guides |

---

## Competitor profiles

### Statlocker / Buildlocker — the depth leader

- **Breadth.** It has roughly 50 features across eight areas: items, heroes, builds, matches
  and rank, leaderboards, analysis, competitive, and learning. A profile has six tabs:
  matches, performance, heroes, laning, players, awards.
- **Proprietary models.** These include:
  - a Performance Points rating
  - MVP awards
  - a win-chance curve
  - "rank luck"
  - an **item meta model** that reports "win probability added rather than raw win rate" with
    confidence intervals. "Combinations that do not reach significance are not presented as
    findings."
- **Replay-derived content.** Per-second timelines, a 3D interactive map, and "Deadlock
  puzzles": real replay situations posed as decisions, with a leaderboard.
- **Buildlocker.** It mirrors **in-game builds by their in-game build ID**. For each build it
  shows:
  - version history and win rate "since the last item change"
  - win rate and a letter grade (C+, B-) by rank band
  - an anonymised recent-games list

  Hero pages show a 12-item "recommended build" ordered by **average buy time**, a 16-step
  ability order, and situational items. Every table carries a one-line method caption.

- **Weak spots:**
  - They admit "this much depth can be intimidating."
  - The readable pages contain no prose reasoning at all.
  - Builds sit on a separate domain, which splits the hero → build flow.

### Tracklock — the polished incumbent

- U.GG-network chrome. The **desktop app is the main funnel**: buff trackers, damage meters,
  boss timers, live scouting.
- The tier list (S+…D, 80% win rate / 20% pick rate weighting) and the item table both show
  **change vs. previous patch** next to every value.
- **Hero hub tabs:** Pro Builds · Builds · Items · Skill Path · Overview & Abilities · Lore.
  The build page has archetype variants ("Recommended: DPS-Bruiser") and sections Core /
  Early / Late / Defensives / Counter Picks / Actives, **each with a one-line plain-English
  explainer**.
- **Weak spots:**
  - no user-made builds
  - no planner
  - no item detail pages: items are a dead end
  - no reasoning beyond the section captions

### BUILDLOCK — editorial, not (yet) a tool

- Curated builds by one ex-pro, "with the item order, ability order, and the reasoning behind
  each pick". This is the only competitor that explains _why_, and it does so by hand, one
  hero at a time.
- The planned "Build Lab" (import match builds, edit, publish into Deadlock) and the
  "PRO" match-build library are both unreleased. Monetisation will be freemium: one free
  build a week.
- **Lesson:** people value explained builds enough that someone is building a paywall
  around them. We generate explanations deterministically, for every hero, for free.

### Deadlock Labs — the everything-free generalist

- Advertises "100% free, no login, no paywall". Data is refreshed every 5 minutes.
- Tier lists use "relative win rate deviation from the mean". Counter and synergy data
  uses minimum-match thresholds.
- The overlay lets players **follow a community build step by step in-game**.
- Also has Twitch overlays, an interactive map, a draft counter-pick trainer, and nine
  minigames.
- Self-describes as a "coaching tool" with "personalized insights". That overlaps with our M6
  positioning, but nothing indexed shows an explanatory build engine.

### deadlock-api.com — upstream supplier and quiet competitor

- Dense analytics: 10 hero tabs, item combos up to size 4, ability-path trees, a 6v6 team
  builder with predicted win rate, and a kill heatmap.
- **Filters persist in the URL** (`?hero=84&min_rank=91&max_rank=116`). Values carry
  sparklines and period deltas, and noisy results are labelled "within noise".
- **Build Designer** is the closest analogue to our planner. It has:
  - stages 0–9m / 9–20m / 20–30m / 30m+, with soul and slot counters
  - a "Suggested" item per stage
  - candidates labelled above, below or within noise
  - a net-worth chart
  - "Copy link"
- Offers drop-in React/Vue item, tooltip and shop **UI components**, hourly data dumps, and a
  natural-language search box.
- **Strategic note:** we depend on this site for every byte of game and analytics data. That
  is a single point of failure. They also publish a planner. Their logo wall includes a site
  called "Deadlock Builds". It is unverified whether that refers to us.

---

## Feature gap matrix

✅ has it · ◐ partial · — absent · ? unobserved (JS shell / blocked)

| Capability                                        | Foundry | Statlocker | Tracklock | BUILDLOCK | DL Labs | dl-api |
| ------------------------------------------------- | :-----: | :--------: | :-------: | :-------: | :-----: | :----: |
| Interactive build planner                         |   ✅    |     ?      |     —     |   soon    |    ◐    |   ✅   |
| Recommendations conditioned on _your_ build       |   ✅    |     —      |     —     |     —     |    —    |   ◐¹   |
| Per-pick plain-English reasoning                  |   ✅    |     —      |    ◐²     |    ✅³    |    —    |   —    |
| Ability-coefficient / spirit-scaling math         |   ✅    |     ?      |     —     |     —     |    —    |   —    |
| Measured item-pair synergy                        |   ✅    |     ◐      |     —     |     —     |   ✅    |   ✅   |
| Simplified vs. advanced view                      |   ✅    |     —      |     —     |     —     |    —    |   —    |
| Educational guides (boons, lanes, farming, items) |   ✅    |     ◐      |     ◐     |     ◐     |   ✅    |   —    |
| Share link with full build state                  |   ✅    |     ?      |     —     |     —     |    ?    |   ✅   |
| Hero tier list                                    |    —    |     ✅     |    ✅     |     ◐     |   ✅    |   ✅   |
| Hero counters / matchups / synergies              |    —    |     ✅     |     —     |     —     |   ✅    |   ✅   |
| "Recommended build" one click from hero page      |    —    |     ✅     |    ✅     |    ✅     |   ✅    |   ✅   |
| Item buy timing (avg purchase time)               |    —    |     ✅     |     —     |     ◐     |    ?    |   ✅   |
| Skill path from match data                        |   —⁴    |     ✅     |    ✅     |    ✅     |    ?    |   ✅   |
| Rank filter exposed in UI                         |   —⁵    |     ✅     |    ✅     |    ✅     |   ✅    |   ✅   |
| Patch / "updated" / sample-size labels            |    —    |     ✅     |    ✅     |    ✅     |   ✅    |   ✅   |
| Export to in-game build                           |    —    |     ✅     |     —     |   soon    |    ◐    |   —    |
| Community / user-published builds                 |    —    |     ✅     |     —     |     —     |   ✅    |   —    |
| Player profiles / match history                   |    —    |     ✅     |    ✅     |    ✅     |   ✅    |   —    |
| Desktop app / overlay                             |    —    |     ✅     |    ✅     |     —     |   ✅    |   ◐    |
| Site navigation + SEO metadata                    |    —    |     ✅     |    ✅     |    ✅     |   ✅    |   ✅   |
| Mobile layout for the planner                     |    —    |     ?      |     ?     |     ?     |    ?    |   ?    |

1. Per-stage "Suggested" pick, but chosen by population win rate, not by what you own.
2. One-line section captions only ("Defensives · Increase your survivability").
3. Hand-written by one pro, a fixed set of heroes.
4. We plan skill paths manually (`AbilityLevelingPanel`) but don't show what players actually do.
5. Rank-aware accuracy exists internally (`resolveAccuracyAtRank`, `probe --rank`) but isn't a
   user-facing control.

---

## Aesthetics and wiring — what to learn

**Trust signals (everyone does this, we don't):**

- **Scope line on every data block.** For example, Buildlocker's "Top 2% of ranked · This
  season · 5,259 matches · updated 14 Oct 2026", and Tracklock's "Top 3 Heroes (2026-10-14
  Minor Patch)". Our analytics-driven numbers (item win rates, pair lift) should say which
  sample and patch they come from.
- **Method caption under each table.** One sentence such as "Core items are bought in 50% or
  more." It costs almost nothing, it is exactly our "why does this matter?" principle, and
  Buildlocker applies it more consistently than we do.
- **Noise honesty.** deadlock-api's "within noise" label and Statlocker's "not presented as
  findings". Our pair term already treats missing data as `null`, not 0. We should surface
  that distinction in the UI too.

**Density and visual language:**

- Values sit next to **coloured deltas versus the previous patch**, with sparklines in table
  cells (Tracklock, deadlock-api). Good for veterans, and it belongs in our advanced mode.
- **Letter grades and tier letters** (S–D, C+/B-) are the universal shorthand for new players.
  Our simplified mode could show a grade where advanced mode shows the number.
- **One item component everywhere:** icon, Roman-numeral tier badge and name (Tracklock). We
  render items several different ways across `/items`, `/heroes` and `/build`.

**Wiring:**

- **Global nav with dropdowns.** Every competitor has one. We have none: `app/layout.tsx`
  renders bare `children`, and `/guide/*` is reachable only by typing the URL.
- **Hero hub with tabs** (Tracklock: Pro Builds · Builds · Items · Skill Path · Overview ·
  Lore). Our `/heroes/[hero]` page is a flat list of sections with a small "Build →" link.
  It also still uses inline `style={{…}}`, which violates our Tailwind-only rule.
- **Never land on an empty state.** Competitors' hero → build click always shows a complete
  build. Our `/build/[heroId]` starts empty, which conflicts with our own success criterion:
  "a new player can pick a hero, get a working starter build".
- **Filters in the URL** (deadlock-api) make every view shareable. We already do this for
  build state. Extend it to the goal, rank and view mode.
- **Readable slugs.** Competitors use `/heroes/rat-king`. Our `/build/[heroId]` uses numeric
  ids. `/heroes` already accepts slugs, but `/build` does not.
- **SEO pattern** (Statlocker, deadlock-api): a server-rendered one-sentence answer ("Graves
  has the highest ranked win rate this patch at 56.0%") plus a FAQ block and JSON-LD on every
  hero and item page. We have one site-wide `metadata` object and no `generateMetadata`,
  sitemap or OG images.
- **Items as a hub, not a dead end.** Here we beat Tracklock: our `/items/[id]` already shows
  components and upgrades. Keep investing.

---

## Our strengths

1. **The only build-state-aware recommender.** `constructBasket()` picks a _set_ of items
   under the remaining soul budget. Its inputs are:
   - the hero's need vector (gun DPS vs. roster, ability spirit coefficients)
   - rank-aware accuracy
   - proc estimates
   - measured pair lift (Oracle+, 90 days)

   `HeroBasketSuggestion` shows a reason for each pick. No competitor does anything
   conditional on what you already own.

2. **Explainability by construction.** Deterministic, pure scoring means every suggestion has
   a breakdown. BUILDLOCK has to hand-write reasons for each hero; we generate them for every
   hero, every patch.
3. **Real stat math.** Per-ability damage using spirit-scaling coefficients, stat totals,
   damage split, soul timeline, and category investment bonuses. Statlocker's Build Lab claims
   "computed stats", but nothing else we saw computes ability damage.
4. **New-player design is in the architecture, not bolted on.**
   - simplified/advanced `viewMode`
   - shared `Tooltip`
   - difficulty and archetype badges
   - Fixture 9 enforcing the convention
   - four guides with constants verified against the wiki

   Statlocker admits it is intimidating. Tracklock gives only one-line captions.

5. **Full-fidelity share links.** The URL carries items, phases, categories, active/sell/
   optional flags and ability levels. That is richer than deadlock-api's copy-link and
   Tracklock's nothing.
6. **Engineering discipline.** Strict TypeScript, a fixture harness, and a verification
   cadence. Cheap to keep correct as Valve patches.

## Our weaknesses

1. **No app shell.**
   - no navigation
   - splash homepage
   - orphaned guides
   - no SEO
   - no OG previews, so shared links look bare in Discord, which is where builds get shared
2. **Planner is desktop-only.** `BuildClient` and the `app/build/components/*` panels contain
   effectively zero responsive breakpoints. One `sm:` appears, in `HeroBasketSuggestion`.
3. **Empty-start problem.** No default or starter build, and no "start from recommended".
4. **No meta layer.** No tier list, counters or matchups, skill path from data, buy timing,
   or patch deltas. Users must leave the site to answer "is my hero good, and what beats it?"
5. **No in-game export.** Competitors are converging on "publish to the in-game build
   browser". Without it, a user must re-enter a Foundry build by hand.
6. **Single upstream dependency.** All data comes from deadlock-api.com, which also ships a
   planner. Mitigated by caching and fail-open analytics.
7. **No distribution channel.** No Discord, desktop app, social presence or brand. Two
   competitors ride U.GG and Dotabuff traffic.
8. **Visual inconsistency.** Mixed inline styles and Tailwind, and several item renderings.

---

## Competitive advantage — the thesis

> **Foundry is the build planner that teaches.** Every other site tells you what the
> population buys. Foundry tells you what _you_ should buy next, for _your_ hero, given
> _what you already own_ and _what you can afford_. It explains why in plain English.

Why this is defensible:

- **It is a different question.** Trackers optimise "what wins on average". Our engine
  optimises "what this build is missing": coverage, shred, anti-heal, sustain, and measured
  pair interactions with items already owned. Population win rates are one input
  (`analyticsTerm`), not the answer.
- **It compounds with the architecture.** Pure, deterministic terms with recorded reasons mean
  each new signal adds explanation as well as accuracy. Hand-written editorial (BUILDLOCK)
  scales linearly with human effort. Pure statistics (Statlocker) can't say why.
- **It is the natural base for M6.** An AI coach on top of explainable, deterministic outputs
  can narrate real reasons without inventing them. Competitors who bolt AI onto win-rate
  tables have nothing structured to narrate.
- **New players are underserved.** The trackers are built for people who already understand
  the game. "No wiki required" is an open lane.

What it is **not**:

- Data volume, live overlays, player profiles or match history. Competing there means a
  desktop app and replay pipeline against U.GG and Dotabuff-backed teams. Don't.
- Pure novelty in having a planner. deadlock-api and Statlocker both have one. The moat is
  _conditional + explained + taught_, so the explanation layer must stay visible and
  first-class.

---

## Threats

| Threat                                                                                          | Likelihood | Mitigation                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Statlocker's Build Lab or deadlock-api's Build Designer adds "conditioned on owned items" logic | Medium     | Ship the explanation layer and starter builds fast. Make reasoning the visible brand.                                                                                     |
| deadlock-api.com outage or policy change                                                        | Low–Med    | Existing caching and fail-open. Evaluate their hourly data dumps as a fallback snapshot for items and heroes. Committed `pairLiftTable.json` already decouples pair data. |
| BUILDLOCK PRO normalises "explained builds" as a paid product                                   | Medium     | Ours is free, covers every hero and updates every patch. Say so explicitly in marketing copy.                                                                             |
| Valve ships an official in-game recommender or build browser upgrade                            | Low        | Lean into teaching and why: guides, coach. Valve won't do that.                                                                                                           |

---

## Recommendations

Ordered by leverage ÷ effort. Each item respects the existing architecture rules: shell/UI
work, scoring work and AI work go in separate PRs.

### Now — cheap, high-leverage (shell, no scoring changes)

1. **Global nav + real homepage.**
   - Nav: Heroes · Items · Build · Guides.
   - The homepage pitches the thesis: "the build planner that explains itself". It shows a
     hero picker above the fold.
   - This links the orphaned `/guide/*` pages.
2. **Per-page metadata + OG images.** `generateMetadata` on hero, item, build and guide pages.
   A build share link should unfurl in Discord with the hero and core items. Add a sitemap.
3. **Mobile pass on `/build`.** Stack panels below `lg`, and make `ActiveItemsGrid` and
   `ItemBrowser` touch-friendly.
4. **Hero page → Tailwind + tab hub.** Remove the inline styles. Tabs: Overview · Abilities ·
   Build · Items. Make "Build this hero" the primary CTA.
5. **Scope and method captions** on every analytics-derived number: sample, rank, patch,
   updated date. Show "not enough data" rather than blanks.

### Next — closes the new-player gap (engine-driven, separate PR)

6. **"Start from a suggested build."** Seed `/build/[heroId]` from `constructBasket()` run at
   a few soul checkpoints (e.g. early / mid / late boon levels). That gives a complete
   phased starter build with a reason on every item. It is deterministic, reuses the engine,
   and directly fulfils the CLAUDE.md success criterion. It is the precursor to M6's
   Beginner / Aggressive / Safe templates.
7. **Readable build slugs** (`/build/rat-king`), redirecting from the numeric id.
8. **Grade shorthand in simplified mode.** A letter or tier in place of raw scores and win
   rates.

### Later — meta layer (data display only, no scoring changes)

9. **Hero meta tab:** tier, counters and synergies, most-played skill path, typical buy timing,
   all from `/v1/analytics/*`. This keeps users on-site for "is my hero good / what beats
   me?" Feed counters into the coach later.
10. **Patch deltas + sparklines** in advanced mode on `/items` and `/heroes`.
11. **In-game export.** First investigate what Deadlock's build-sharing format and API allow
    (Statlocker ships an exporter; BUILDLOCK publishes under its own account). This is the
    single most-requested bridge between a web planner and actual play.

### Don't

- Don't build player profiles, match history, leaderboards or a desktop overlay. That is the
  trackers' home turf, and they have network-scale backing.
- Don't compete on raw data depth. Cite and link deadlock-api.com (and consider listing
  ourselves on its partner page) instead of re-deriving what it already offers.

---

## Sources

- Statlocker: [home](https://statlocker.gg/), [features](https://statlocker.gg/features),
  [hero library – Graves](https://statlocker.gg/heroes/hero-library/graves),
  [builds](https://statlocker.gg/builds), [items](https://statlocker.gg/items),
  [companion app](https://statlocker.gg/deadlock-companion-app)
- Buildlocker: [home](https://buildlocker.gg/),
  [Graves builds](https://buildlocker.gg/builds/hero/graves),
  [build 542786](https://buildlocker.gg/builds/build/542786)
- Tracklock: [home](https://tracklock.gg/), [tier list](https://tracklock.gg/heroes-tier-list),
  [Seven build](https://tracklock.gg/heroes/seven/build), [items](https://tracklock.gg/items),
  [pro builds](https://tracklock.gg/probuilds), [ranks](https://tracklock.gg/ranks),
  [U.GG announcement / builds article](https://tracklock.gg/articles/tracklocks-builds-just-got-even-better)
- BUILDLOCK: [home](https://buildlock.io/) (single-page app; all views read from the static
  shell)
- Deadlock Labs (indexed pages only; live fetch returned 403):
  [home](https://deadlocklabs.gg/), [about](https://deadlocklabs.gg/about/),
  [app](https://deadlocklabs.gg/app/), [create build](https://deadlocklabs.gg/builds/create/),
  [map](https://deadlocklabs.gg/tools/map/),
  [hero meta overlay](https://deadlocklabs.gg/tools/overlays/hero-meta/),
  [draft trainer](https://deadlocklabs.gg/arcade/draft/)
- deadlock-api.com: [home](https://deadlock-api.com/),
  [heroes](https://deadlock-api.com/analytics/heroes),
  [tier list](https://deadlock-api.com/analytics/heroes/tier-list),
  [Rat King](https://deadlock-api.com/analytics/heroes/rat-king),
  [items](https://deadlock-api.com/analytics/items),
  [combos](https://deadlock-api.com/analytics/items/combos),
  [Build Designer](https://deadlock-api.com/analytics/items/build-flow),
  [abilities](https://deadlock-api.com/analytics/abilities),
  [team builder](https://deadlock-api.com/analytics/team-builder),
  [leaderboard](https://deadlock-api.com/community/leaderboard)
- Ecosystem context: [1v9.gg – best Deadlock stat trackers](https://1v9.gg/blog/deadlock-best-stat-trackers),
  [ExitLag – Deadlock tracker overview](https://www.exitlag.com/blog/deadlock-tracker/)
