# Suggested starter build: use cases and acceptance criteria

**Status:** APPROVED 2026-10-20, with every recommendation in section 7 accepted as
written. Fixtures (2b) are written from this version; change this doc first if an
expectation needs to change (see "Testing Expectations" in CLAUDE.md).
**Drafted:** 2026-10-20 · **Feature:** competitive-analysis.md recommendation 6 ·
**Work item:** Work 2 (PRs 2a docs → 2b pipeline + fixtures → 2c engine → 2d UI)

## 1. What the feature is

A new player picks a hero and presses **"Start from a suggested build"**. They get a
complete, phased build with early, mid and late items. Every item says in plain English
why it is there, and the build is tailored to the hero and to anything the player already
owns. It is deterministic: it is the existing basket engine (`constructBasket()`) run at
fixed soul checkpoints, each phase building on the last. It is not AI, and it is not
copied from popular builds.

It is the precursor to M6's Beginner / Aggressive / Safe templates. It must stay
independent of `SuggestedItemsPanel` / `scoreItems()` (CLAUDE.md data flow).

## 2. Definitions

### 2.1 Soul checkpoints

A checkpoint is the cumulative souls a typical player has earned by a game minute. Boons
cost no souls (deadlock.wiki/Boon: level is "based on a hero's total gathered souls"), so
the souls available for items at a checkpoint are the checkpoint souls minus what earlier
phases cost. This is the same rule as the planner's basket budget,
`boonSouls − cost of owned items`.

| Phase | Game minute                | Souls (snapped to a boon threshold) | Planner boon slider (`--boon` in `npm run probe`) | Measured mean net worth, all ranks / Oracle+ |
| ----- | -------------------------- | ----------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| Early | ~9–10 (laning ends ~8 min) | **5,900**                           | 10                                                | 5,995 at 9:00 · ~6,950 at 10:00 / ~7,580     |
| Mid   | ~19–20                     | **16,700**                          | 22                                                | 17,553 at 20:00 / 18,975                     |
| Late  | ~29–30                     | **30,000**                          | 29                                                | 30,766 at 30:00 / 32,543                     |

Sources, accessed 2026-10-20:

- `GET /v1/analytics/player-performance-curve?resolution=0&min_unix_timestamp=<now−30d>`
  (`net_worth_avg` by game second; add `&min_average_badge=80` for Oracle+). It covers
  ~2.2M matches, and its standard deviation is roughly ±15% of the mean.
- Laning ends at about 8 minutes: deadlock.wiki/Souls.
- Median match length is about 37 minutes pooled and about 33–34 minutes at Oracle+
  (`/v1/analytics/game-stats`). About 80% of matches reach 30:00, so "late" is reached by
  most players. A "full build" at about 45,000 souls (40:00) is reached by only a third
  of matches, so it is not a phase.
- Checkpoints are snapped to `BOON_THRESHOLDS` souls so that the build planner's boon
  slider shows exactly the souls the phase was built for. Three numbering schemes exist:
  the planner slider (0–35, used above and by the probe), `BOON_THRESHOLDS.boonLevel`
  (slider + 1), and the wiki (slider). Souls agree everywhere, so the docs and fixtures
  quote souls.

### 2.2 Reference heroes

These heroes are the fixed set used by the fixtures and the item scoring review. Each
archetype comes from the API `hero_type` and tags.

| Archetype                         | Heroes            | Why                                                     |
| --------------------------------- | ----------------- | ------------------------------------------------------- |
| Spirit caster                     | Seven, Lady Geist | Damage is mostly ability coefficients                   |
| Gun carry / proc platform         | Haze              | Fast-firing gun hero; bullet procs should matter        |
| Gun/spirit hybrid marksman        | Wraith, Infernus  | Both damage types matter                                |
| Tank / brawler                    | Abrams, Warden    | Durability and close range                              |
| No measured pair data (edge case) | Deadman Danny     | 0 entries in `pairLiftTable.json` (Solomon is the same) |

## 3. Use cases

- **UC1, new player, empty build.** Picks a hero from the homepage, lands on
  `/build/[heroId]` and presses "Start from a suggested build". The build fills with
  early, mid and late items, placed in the Early / Mid / Late game-plan categories.
  The early items are marked active. Each item shows a one-line reason. Simplified view
  shows the reason; Advanced also shows the term breakdown.
- **UC2, player already owns items.** The starter build keeps everything the player has
  and fills around it. Owned items count toward coverage and budget. Nothing owned is
  removed or replaced.
- **UC3, re-running.** Pressing the button again with the same hero, rank and owned items
  gives exactly the same build. If the build has changed since, the player confirms
  before anything is overwritten.
- **UC4, missing data.** If match analytics are down, or the hero has no pair data, the
  starter build is still produced from the hero's kit alone, and nothing claims a
  measured effect it doesn't have.
- **UC5, sharing.** The result is an ordinary build. The share link reproduces it, and
  no new URL format is needed.

## 4. Acceptance criteria

Each criterion is either a **hard rule**, which fixtures enforce and which blocks merge,
or an **expected lean**, which describes good behaviour and is tracked by the ratchet in
section 6.

### 4.1 Hard rules (for every reference hero, at every phase)

- **H1 Budget.** Total cost of owned items plus phases 1..n is at most the checkpoint
  souls of phase n. Upgrades are priced at their effective cost (component discount,
  `getEffectiveAddCost`).
- **H2 No component pairs.** A phase never holds an item together with its own component,
  directly or transitively (`componentClosure`). Buying an upgrade whose component was
  bought in an earlier phase is the normal upgrade path. It is allowed, priced at the
  effective cost, and the component is shown as consumed.
- **H3 A reason on every item.** Every item has at least one plain-English reason with a
  non-zero contribution.
- **H4 Deterministic.** Two runs with identical inputs give deep-equal output.
- **H5 Phases build on each other.** Late contains mid, and mid contains early, except
  components consumed by an upgrade. No item appears twice.
- **H6 Legal items only.** No tier 5 (Street Brawl), nothing disabled or not in the shop.
  At most 12 active items (`MAX_ACTIVE_ITEMS`); later-phase items go into the game plan,
  which has no cap.
- **H7 Owned items respected.** Owned items are kept, never re-suggested, and count
  toward both budget and coverage (UC2).
- **H8 Every hero.** Every visible hero, not just the reference set, gets a non-empty
  early phase.
- **H9 Fails open.** Without analytics or pair data the build still satisfies H1–H8.

### 4.2 Expected leans

- **L1 Spirit casters lean spirit.** For Seven and Lady Geist, the share of souls spent
  on spirit is at least the share spent on gun, in every phase.
- **L2 Gun heroes lean gun.** For Haze, the gun share is at least the spirit share in
  every phase.
- **L3 Tanks get durability.** For Abrams and Warden, vitality is at least 30% of
  late-phase souls.
- **L4 Archetypes differ.** A spirit caster's and the gun hero's late builds share at
  most half their items (Jaccard ≤ 0.5).
- **L5 The early phase uses its souls.** At least 2 items, and less than 800 souls (the
  cheapest item) left unspent.
- **L6 Upgrade paths appear.** Across the reference set, at least one later phase
  upgrades an earlier phase's component.

> **L1–L3 are retired** by §4.3 (approved 2026-10-20). They were hand-written
> direction rules, and high-rank data shows they are partly wrong. Oracle+ Seven players
> lean GUN in the first 10 minutes (44% gun vs 30% spirit), and lean spirit only later. L4,
> L5 and L6 stay.

### 4.3 Measured phase expectations (APPROVED 2026-10-20)

These replace L1–L3 with expectations measured from Oracle+ play. Everything goes through
the same ratchet (§6): a failing key must be listed in `KNOWN_LEAN_GAPS`, and a listed key
that starts passing must be removed.

**Real phase splits.** A phase split is the share of item souls per shop category
(gun / spirit / vitality), from `/v1/analytics/item-stats` with `hero_ids`,
`min_average_badge=80` and the last 30 days:

| Phase | Measured from (real play)                                                     | Compared with (engine)               |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------ |
| Early | items **bought** in 0–10 min (`max_bought_at_s=600`), Σ purchases × cost      | items the early phase adds           |
| Mid   | items **bought** in 10–20 min (`min_bought_at_s=600`, `max_bought_at_s=1200`) | items the mid phase adds             |
| Late  | **final inventory**, (bought − sold) × cost (`heroCategorySplit.json`)        | everything held after the late phase |

The checkpoints line up: 5,900 souls is about 9–10 minutes and 16,700 about 19–20
minutes (§2.1). The early and mid splits get committed alongside the final one, refreshed
by `npm run fit-category-split`.

- **M1 Phase fidelity.** For each reference hero and each phase, the engine's phase split
  is within an L1 distance of **0.30** of the real one. For example, 15 points off in two
  categories just passes. Keys are `M1:<hero>:<phase>`.
- **M2 Early diversity.** Across the 8 reference heroes there are at least **4 distinct
  early phases**, and no single item is in **all 8** early phases.
- **M3 Mid-game overlap only falls.** Mean pairwise Jaccard of the reference heroes' mid
  phases is at most a recorded baseline. The baseline lives in the fixture and can only be
  lowered (a numeric ratchet).

**Baseline, 2026-10-20** (`main` at `d7dc373`): real vs engine split, gun/spirit/vitality %,
with L1 distance.

| Hero          | Early: real → engine (d)   | Mid: real → engine (d)     | Late: real → engine (d)    |
| ------------- | -------------------------- | -------------------------- | -------------------------- |
| Seven         | 44/30/26 → 57/43/0 (0.52)  | 16/52/31 → 31/0/69 (1.04)  | 17/48/35 → 22/8/70 (0.80)  |
| Lady Geist    | 18/62/20 → 57/43/0 (0.79)  | 28/38/34 → 31/8/62 (0.61)  | 28/41/31 → 22/11/68 (0.74) |
| Haze          | 62/16/22 → 86/14/0 (0.47)  | 44/25/31 → 31/0/69 (0.76)  | 54/15/30 → 27/24/49 (0.55) |
| Wraith        | 48/38/14 → 57/43/0 (0.27)  | 43/29/28 → 31/0/69 (0.82)  | 46/28/26 → 22/32/46 (0.49) |
| Infernus      | 36/40/24 → 57/43/0 (0.48)  | 33/36/31 → 31/0/69 (0.77)  | 36/37/27 → 22/41/38 (0.29) |
| Abrams        | 59/15/27 → 57/29/14 (0.28) | 29/25/45 → 29/29/43 (0.07) | 30/21/49 → 43/16/41 (0.26) |
| Warden        | 71/14/15 → 57/29/14 (0.30) | 24/42/35 → 31/8/62 (0.68)  | 38/30/33 → 22/30/49 (0.33) |
| Deadman Danny | 49/29/22 → 57/43/0 (0.45)  | 25/39/36 → 31/0/69 (0.79)  | 24/47/29 → 43/32/24 (0.38) |

5 of the 24 M1 keys pass today. Every hero's early phase is Blood Tribute + Cold Front +
one other, so M2 fails. The worst gap is the mid phase: real players spend 25–52% on
spirit there, while the engine's mid phase usually buys none.

**Plan** (approved 2026-10-20). PR 1: value per soul in the basket, plus the phase data and
the M fixtures. PR 2: a per-phase measured stat profile replacing the five flat
placeholder categories. Both PRs are scoring changes and are audited.

**Real-play overlap (added 2026-10-24, with the value-scale stack).** Measured against
`heroPhaseItems.json`: per hero and phase, the share of Oracle+ matches in which the hero
bought each item (same window as the split, `npm run fit-category-split`).

- **O1 Real openers.** Each reference hero's early phase has at least **2** items from
  the hero's real top 10 early buys. Keys `O1:<hero>`.
- **O2 Real mid buys.** The share of the reference heroes' mid picks that are in the
  hero's real 10–20 minute top 10 is at least a recorded baseline. The baseline lives in
  the fixture and can only be raised (a numeric ratchet).
- **T1 Tempo.** The early phase's share of souls in 3,200+ items is within **15 points**
  of real play. Keys `T1:<hero>`. Saving for a 3,200 item leaves a laner weak; real
  Oracle+ early buys put 1–14% of souls into such items, except deliberate rushes.

O1 and O2 read the same table as the engine's `phaseItemTerm`, so they check the engine
follows real play without breaking M1–M3 and the hard rules. They do not judge it on its
own.

## 5. What today's engine does

These are probe results on live data, 2026-10-20 (`npm run probe`), with the engine
unchanged. They are why some leans start out failing.

### 5.1 Chained sweep at the checkpoints

For this sweep, each phase was probed with `--owned` set to the earlier phases' picks.
Pooled rank, no goal.

| Hero          | Early (5,900)                                  | + Mid (16,700)                                | + Late (30,000)                                    |
| ------------- | ---------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Seven         | Blood Tribute, Cold Front, Spirit Strike       | Arctic Blast, Cultist Sacrifice, Grit         | Spiritual Overflow, Ethereal Shift, Monster Rounds |
| Lady Geist    | Blood Tribute, Cold Front, Spirit Strike       | Arctic Blast, Cultist Sacrifice, Healing Rite | Spiritual Overflow, Ethereal Shift, Monster Rounds |
| Haze          | Blood Tribute, Spirit Shielding, Spirit Strike | Arctic Blast, Cultist Sacrifice, Grit         | Spiritual Overflow, Cheat Death, Monster Rounds    |
| Wraith        | Blood Tribute, Cold Front, Spirit Strike       | Arctic Blast, Cultist Sacrifice, Grit         | Spiritual Overflow, Cheat Death, Monster Rounds    |
| Infernus      | Cultist Sacrifice, Cold Front, Spirit Strike   | Arctic Blast, Blood Tribute, Extra Health     | Spiritual Overflow, Ethereal Shift, Monster Rounds |
| Abrams        | Blood Tribute, Cold Front, Spirit Strike       | Arctic Blast, Cultist Sacrifice, Healing Rite | Spiritual Overflow, Ethereal Shift, Monster Rounds |
| Warden        | Blood Tribute, Cold Front, Spirit Strike       | Arctic Blast, Cultist Sacrifice, Healing Rite | Spiritual Overflow, Spirit Burn, Monster Rounds    |
| Deadman Danny | Blood Tribute, Cold Front, Spirit Strike       | Arctic Blast, Cultist Sacrifice, Grit         | Spiritual Overflow, Ethereal Shift, Monster Rounds |

Every phase stopped on budget: 5,600 + 10,400 + 13,600 = 29,600 of 30,000 souls.

### 5.2 Findings

- **F1. The builds are nearly hero-agnostic.** Eight heroes across four archetypes get
  almost the same nine items. The need vectors show why: `spiritDamage` need is 2.00 (the
  cap) for every hero checked (Seven, Haze, Abrams, Wraith). Haze, a gun assassin, has
  the lowest `gunDamage` need of the four (0.72, against Abrams' 1.39). Abrams, a tank,
  has the lowest `bonusHealth` need (0.46). This belongs to the item scoring review,
  not to this feature, but this feature makes it visible to every new player.
- **F2. Owned items don't count toward coverage.** `constructBasket` starts coverage at
  zero. Owned items only feed synergy and pair partners and the spirit-power scaling of
  candidates. A later phase therefore can't see what the earlier phases already cover.
  H7 requires fixing this, as a scoring change in 2c.
- **F3. The basket doesn't know about components.** It has no `componentItems` handling.
  Upgrades still happen by accident: in 7 of the 8 chains a later phase buys an upgrade
  of an earlier-phase component (Cold Front → Arctic Blast). The engine charges that
  upgrade at full cost and keeps the consumed component in the build, so it double-counts
  the component's souls and its slot (H1). Nothing stops it picking an item together with
  its own component in the same phase (H2), though the sweep never did. _(Corrected
  2026-10-20 from Fixture 13: the first draft said no upgrade paths appear.)_
- **F4. Large items crowd out small ones.** Picks favour 3,200 and 6,400 items. At 2,000
  souls (slider 4) the basket buys a single 1,600 item. At the 5,900 early checkpoint it
  uses its souls well (3 items, 300 left), so L5 passes there.
- **F5. Hard rules H1, H4, H5 and H6 already hold** in the sweep, as far as the probe
  shows. Fixtures still have to prove them.
- **F6. The 12-item cap applies to the whole starter build, not just active items.**
  Each phase's `maxItems` is `12 − everything owned so far`. H6 caps only active items
  and lets later phases go into the game plan, which has no cap. This doesn't bite
  today: builds come out at 9 items. It does bite when the player already owns a lot
  (UC2): owning 8 items leaves early at most 4, and then mid and late come out empty.
  Fix in 2c with a starter-specific cap. _(Found by the 2b `scoring-auditor` review.)_

### 5.3 Leans scored against the sweep

| Lean                          | Today | Detail                                                                                                                     |
| ----------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| L1 spirit casters lean spirit | ❌    | Seven and Lady Geist early: gun 3,200 > spirit 2,400 (passes by mid)                                                       |
| L2 Haze leans gun             | ❌    | Mid cumulative: spirit 7,200 > gun 6,400                                                                                   |
| L3 tanks get durability       | ❌    | Abrams and Warden late vitality: 800 / 29,600 = 2.7%                                                                       |
| L4 archetypes differ          | ❌    | Seven vs Haze late Jaccard 0.64 (Lady Geist vs Haze passes at exactly 0.50; Seven vs Abrams, not a measured pair, is 0.80) |
| L5 early phase uses souls     | ✅    | 3 items, 300 souls left, for every hero                                                                                    |
| L6 upgrade paths appear       | ✅    | 7 chains upgrade an earlier component, e.g. Cold Front → Arctic Blast (by accident; see F3)                                |

Fixture 13 (`src/scripts/starterBuildFixtures.ts`) measures these against live data;
its `KNOWN_LEAN_GAPS` list is the current truth.

### 5.4 After PR 2c (owned coverage, effective upgrade cost, consumed components)

F2 and F3 are fixed. F6 is resolved as the **held** cap: consumed components now free
their slots, and with no selling in v1 (§7 Q4), 12 held items is the in-game limit. An
uncapped game plan would recommend items the player has no room to hold. So the
fixture's H6 check stays "owned + phase items held ≤ 12".

| Hero          | Early (5,900)                                  | + Mid (16,700)                                | + Late (30,000)                               |
| ------------- | ---------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| Seven         | Blood Tribute, Cold Front, Spirit Strike       | Infuser, Cultist Sacrifice, Grit              | Cheat Death, Inhibitor, Mystic Expansion      |
| Lady Geist    | Blood Tribute, Cold Front, Spirit Strike       | Infuser, Cultist Sacrifice, Mystic Expansion  | Spirit Burn, Inhibitor, Grit                  |
| Haze          | Blood Tribute, Spirit Shielding, Spirit Strike | Arctic Blast, Cultist Sacrifice, Extra Health | Infuser, Spirit Burn, Mystic Expansion        |
| Wraith        | Blood Tribute, Cold Front, Spirit Strike       | Infuser, Cultist Sacrifice, Grit              | Cheat Death, Inhibitor, Mystic Expansion      |
| Infernus      | Cultist Sacrifice, Cold Front, Spirit Strike   | Infuser, Fury Trance, Mystic Expansion        | Spirit Burn, Divine Barrier, Golden Goose Egg |
| Abrams        | Blood Tribute, Cold Front, Spirit Strike       | Infuser, Cultist Sacrifice, Mystic Expansion  | Spirit Burn, Inhibitor, Grit                  |
| Warden        | Blood Tribute, Cold Front, Spirit Strike       | Infuser, Cultist Sacrifice, Mystic Expansion  | Spirit Burn, Inhibitor, Close Quarters        |
| Deadman Danny | Blood Tribute, Cold Front, Spirit Strike       | Infuser, Cultist Sacrifice, Grit              | Cheat Death, Inhibitor, Mystic Expansion      |

Later phases now see what earlier phases cover, so they fill other needs instead of
buying more of the same:

| Lean                              | After 2c   | Detail                                           |
| --------------------------------- | ---------- | ------------------------------------------------ |
| L1 Seven / Lady Geist lean spirit | ❌ (worse) | Seven late held: gun 6,400 > spirit 3,200        |
| L2 Haze leans gun                 | ❌ (worse) | Late held: spirit 14,400 > gun 6,400             |
| L3 tanks get durability           | ✅         | Abrams 45.9%, Warden 43.2% (was 2.7%)            |
| L4 archetypes differ              | ✅         | Seven/Haze 0.38 (was 0.64); Lady Geist/Haze 0.50 |
| L5 early phase uses souls         | ✅         | Unchanged: early has nothing owned               |
| L6 upgrade paths appear           | ❌ (newly) | See below                                        |

L1 and L2 got worse for the reason in F1. The need vector gives `spiritDamage` the same
share for every hero, about 17% of the target. Once owned items fill that share, the
basket moves on to other categories. That is the need-vector PR's job.

**L6 passed only because of F3's double count.** Arctic Blast's full stats were stacked on
top of Cold Front's. With upgrade stats replacing the component's, an upgrade adds only
the _difference_. The basket picks by value rather than value per soul, and a freed slot
is worth nothing until slots run out. So a fresh item beats an upgrade. Making upgrades
win needs a soul-efficiency or slot-pressure signal. That is a scoring design decision,
not a bug fix.

**Decision (2026-10-20):** L6 goes back on `KNOWN_LEAN_GAPS` as an explained exception to
"the list only shrinks", because its earlier pass was not real. The upgrade-efficiency
signal is a separate scoring item after the need-vector PR. Known gaps after 2c: L1 Seven
and Lady Geist, L2 Haze, L6.

### 5.5 After the need-vector PR (measured category split)

F1's cause is confirmed: the kit measures what TYPE of scaling a hero has, and nearly every
ability scales off spirit. High-rank final inventories separate heroes clearly instead,
for example Haze 54% gun, Kelvin 72% spirit, Abrams 49% vitality. That split is now
committed (`lib/engine/data/heroCategorySplit.json`, `npm run fit-category-split`) and
applied as a prior in three steps: the gun share is adjusted for the player's rank, the
need families are rescaled, and a bounded `categorySplitTerm` is added. See "Measured
category split" in engine-design-notes.md.

| Hero          | Early (5,900)                              | + Mid (16,700)                                                                      | + Late (30,000)                                                                |
| ------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Seven         | Blood Tribute, Cold Front, Spirit Strike   | Infuser, Cultist Sacrifice, Grit                                                    | Cheat Death, Inhibitor, Guardian Ward (upgrades Grit)                          |
| Lady Geist    | Blood Tribute, Cold Front, Spirit Strike   | Cultist Sacrifice, Infuser, Mystic Expansion                                        | Cheat Death, Inhibitor, Grit                                                   |
| Haze          | Blood Tribute, Kinetic Dash, Spirit Strike | Leech, Cultist Sacrifice, Grit                                                      | Spirit Burn, Inhibitor, Spirit Shielding (upgrades Grit)                       |
| Wraith        | Blood Tribute, Cold Front, Spirit Strike   | Cultist Sacrifice, Healing Tempo, Grit                                              | Inhibitor, Spirit Burn, Mystic Expansion                                       |
| Infernus      | Blood Tribute, Cold Front, Spirit Strike   | Cultist Sacrifice, Leech, Grit                                                      | Spirit Burn, Superior Duration, Stamina Mastery, Guardian Ward (upgrades Grit) |
| Abrams        | Blood Tribute, Cold Front, Grit            | Cultist Sacrifice, Fury Trance, Superior Duration, Spirit Shielding (upgrades Grit) | Cheat Death, Crippling Headshot, Healing Rite                                  |
| Warden        | Blood Tribute, Cold Front, Extra Health    | Healing Tempo, Cultist Sacrifice, Mystic Expansion                                  | Spirit Burn, Juggernaut, Grit                                                  |
| Deadman Danny | Blood Tribute, Cold Front, Spirit Strike   | Infuser, Cultist Sacrifice, Grit                                                    | Spirit Burn, Crippling Headshot, Mystic Expansion                              |

Leans now: **L2, L3, L4 and L6 pass.** L6 is a real upgrade, priced at the difference:
four chains upgrade Grit. Across all heroes, the mid/late basket's shop split moved closer
to the measured split (mean L1 0.458 → 0.336).

**Still failing or weak:**

- **L1** (Seven and Lady Geist lean spirit).
- **Early-game sameness:** every reference hero still opens Blood Tribute + Cold Front,
  because the term is neutral on a first pick by design.
- **Mid-game sameness:** 8 distinct baskets at slider 22, against 10 on `main`.

The cause is in the coverage model. All-rounder items whose shop is not their stat
(Infuser, Spiritual Overflow, Cultist Sacrifice) score highly for everyone, and five
stubbed neutral categories hold about 45% of every hero's target. That needs a
coverage-model change, so whether 2d waits for it is an open question for the user.
Known gaps: L1 Seven, L1 Lady Geist.

### 5.6 After coverage-model PRs 1 and 2 (value per soul, phase-aware split)

PR 1 ranks picks by value per soul (or per slot when slots bind). PR 2 uses the phase's
own measured split and replaces the five placeholder categories with a measured
per-phase stat profile. Real vs engine split, gun/spirit/vitality %, with L1 distance
(✅ = within 0.30):

| Hero          | Early: real → engine (d)      | Mid: real → engine (d)        | Late: real → engine (d)       |
| ------------- | ----------------------------- | ----------------------------- | ----------------------------- |
| Seven         | 44/30/26 → 43/29/29 (0.05) ✅ | 17/52/32 → 15/31/54 (0.45)    | 17/48/35 → 22/38/41 (0.20) ✅ |
| Lady Geist    | 18/62/21 → 14/43/43 (0.45)    | 28/38/34 → 46/23/31 (0.36)    | 28/41/31 → 34/31/34 (0.20) ✅ |
| Haze          | 62/16/22 → 29/29/43 (0.67)    | 44/25/31 → 36/14/50 (0.38)    | 54/15/30 → 27/35/38 (0.55)    |
| Wraith        | 48/38/14 → 29/43/29 (0.40)    | 43/29/28 → 38/23/38 (0.21) ✅ | 46/28/26 → 29/43/29 (0.35)    |
| Infernus      | 36/40/24 → 29/43/29 (0.14) ✅ | 33/36/31 → 15/23/62 (0.61)    | 36/37/27 → 50/25/25 (0.27) ✅ |
| Abrams        | 59/15/27 → 43/14/43 (0.32)    | 29/25/46 → 29/36/36 (0.21) ✅ | 30/21/49 → 29/41/29 (0.41)    |
| Warden        | 71/14/15 → 43/29/29 (0.57)    | 24/42/35 → 31/31/38 (0.22) ✅ | 38/30/33 → 27/32/41 (0.22) ✅ |
| Deadman Danny | 49/29/22 → 29/43/29 (0.41)    | 25/39/36 → 31/31/38 (0.17) ✅ | 24/47/29 → 16/43/41 (0.24) ✅ |

- **M1:** 11 of 24 pass (6 before). The engine's mid phase now buys spirit (14–36%)
  instead of none.
- **M2:** still fails; one item is in every early phase.
- **M3:** mid overlap 0.377 → 0.373; the baseline is lowered to 0.38.
- L4, L5 and L6 still pass.

**Approved exception (user, 2026-10-20).** §4.3's merge gate asked for no regressions.
Four keys that passed before now fail: Wraith early, Abrams early and late, Warden early.
The user accepted them for the net gain, and they are listed in `KNOWN_LEAN_GAPS`.

**Why they fail.** The early phase is under-gun for gun openers (Haze 29% vs 62%, Warden
43% vs 71%). Two follow-ups were measured and not merged: hero-relative damage values and
soft saturation of the coverage caps. Both showed the same cause. Categories are valued
in different units, so the need vector cannot steer picks: damage is "% of DPS" while
sustain, mobility, utility and economy are raw stat sums, several times larger per soul.
Putting every category on one value scale is the next step (pulled forward from the item
scoring review). Details in "Hero-relative damage and soft saturation" in
engine-design-notes.md.

### 5.7 After the value-scale stack (one value scale, spend like real players, phase items)

Three stacked PRs, landed together (user decision 2026-10-24):

1. **One value scale.** Every item stat and effect is priced in % of this hero's fight
   value in a 10 s trade. Damage goes through the hero's own weapon and kit; health,
   resist, healing, CC and economy through named identities and exchange rates.
   Coverage saturates instead of hitting a hard cap. Eight valuation bugs were fixed on
   the way.
2. **Spend like real players.** Each shop takes its measured phase share of the souls
   (+15% slack, leftovers pooled). In the laning phase, expensive items cost more per
   soul (tempo). Each phase lists picks cheapest first.
3. **What players on this hero buy.** A bounded nudge from Oracle+ buy rates per hero and
   phase, which captures kit synergies item maths cannot see.

| Measure                             | `main` before | After the stack                                   |
| ----------------------------------- | ------------- | ------------------------------------------------- |
| M1 phase fidelity                   | 11 / 24       | **24 / 24** (the 4 accepted regressions are back) |
| M2 early diversity                  | ❌            | ✅                                                |
| M3 mid overlap                      | 0.373         | **0.093**                                         |
| Mean L1 to real play (24 keys)      | 0.336         | **0.108**                                         |
| O1 early picks in the real top 10   | —             | 8 / 8 heroes, 42 picks (18 without the signal)    |
| O2 mid picks in the real top 10     | —             | 37 / 53 (3 / 50 without)                          |
| T1 early 3,200+ share within 15 pts | —             | 5 / 8                                             |

Early phase (5,900 souls), cheapest first:

| Hero       | Early build                                                                                                    | Real top early buys (% of matches)                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Haze       | Rapid Rounds, Extra Spirit, Extra Health, Extended Magazine, Headshot Booster, Active Reload                   | Rapid Rounds 89, Swift Striker 84, Active Reload 76, Extra Spirit 74               |
| Abrams     | Close Quarters, Melee Lifesteal, Extra Regen, Monster Rounds, Spirit Strike, Stalker                           | Close Quarters 84, Melee Charge 73, Melee Lifesteal 63, Extra Regen 59, Stalker 58 |
| Lady Geist | Mystic Regeneration, Extra Regen, Mystic Burst, Monster Rounds, Extra Spirit, Mystic Expansion, Extra Charge   | Mystic Regeneration 91, Extra Regen 76, Mystic Burst 67, Radiant Regeneration 62   |
| Wraith     | Monster Rounds, Rapid Rounds, Extra Spirit, Extra Regen, High-Velocity Rounds, Quicksilver Reload              | Quicksilver Reload 94, Monster Rounds 89, Rapid Rounds 62                          |
| Warden     | High-Velocity Rounds, Extended Magazine, Monster Rounds, Rapid Rounds, Extra Regen, Extra Spirit, Sprint Boots | High-Velocity Rounds 89, Opening Rounds 86, Extended Magazine 60                   |

Later phases follow real upgrade paths: Rapid Rounds → Swift Striker / Burst Fire,
Mystic Regeneration → Radiant Regeneration, Quicksilver Reload → Mercurial Magnum,
High-Velocity Rounds → Express Shot, Close Quarters → Point Blank.

**Known gaps (in the ratchet):** T1 for Seven, Lady Geist and Wraith. Real players rush
one 3,200 item early (Cultist Sacrifice, Radiant Regeneration, Tesla Bullets). The shop
budget keeps it out of the early phase, so it arrives a phase later as an upgrade.

**Left for the item scoring review:** Haze's mid phase still misses Surge of Power (54% of
real Haze players buy it at 10–20 min). The phase stat profile was fitted in the old
units. A few stat keys keep heuristic weights in hero mode. M1 keys near the 0.30 line
(Lady Geist late, 0.27–0.32 across settings) flip with small changes, so read the mean
L1 alongside the pass count.

## 6. Known failures (the ratchet)

Fixtures check every hard rule and every lean:

- **A hard rule that fails** fails the harness.
- **A lean that fails** must be listed in a `KNOWN_LEAN_GAPS` list in the fixture file,
  with a link to this doc. A failing lean that isn't listed fails the harness.
- **A listed lean that starts passing** also fails the harness, until it is removed from
  the list.

The list can only shrink. The item scoring review (CLAUDE.md, which gates closing
Milestone F) is where most of it gets worked off.

## 7. Open questions for sign-off

Each question carries a recommendation. Approving the doc as-is accepts the
recommendations.

1. **Order of work (the big one).** Shipping the button (2d) before F1 is fixed would show
   new players the same build for every hero, under a homepage that says "tailored to
   your hero's kit". **Recommendation:** do 2b and 2c as planned. Then pull the
   need-vector part of the item scoring review forward, before 2d, as its own scoring PR
   that works off L1–L4. The full review still closes Milestone F after Work 3. This
   changes the order written in CLAUDE.md, so it needs your OK.
2. **Rank used for checkpoints.** Pooled all-rank souls, or Oracle+ (about 5–8% higher)?
   **Recommendation:** pooled, because the feature is for new players.
3. **A "first buy" phase.** Should there be a fourth phase at about 3 minutes (around
   1,800 souls), before early? **Recommendation:** not in v1. Today the basket buys
   one item there (F4), and three phases are easier to read.
4. **Selling.** Should a late phase sell early items to free active slots (50% refund)?
   **Recommendation:** not in v1. The 12-active cap holds and later items go in the game
   plan. A "sell candidate" hint can come later.
5. **Goal selector (Burst, DPS, Tank...).** **Recommendation:** v1 ignores it. Goals
   belong to `scoreItems()`'s independent path, and mixing them would couple the two
   suggestion systems.
6. **Owned coverage (F2) and components (F3) in 2c.** Both are scoring changes to
   `constructBasket`, so they also change the live hero basket on `/build`, not just the
   starter build. **Recommendation:** yes, in 2c, audited by `scoring-auditor`, because
   H1, H2 and H7 can't hold without them.
7. **Lean thresholds.** Are 30% vitality for tanks (L3) and Jaccard ≤ 0.5 (L4) the right
   bars? **Recommendation:** keep them as starting points. They're easy to tune, and the
   ratchet makes any change visible.
