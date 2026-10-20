# Suggested starter build: use cases and acceptance criteria

**Status:** DRAFT, awaiting sign-off. Do not write engine code for this feature until
this doc is approved (see "Testing Expectations" in CLAUDE.md).
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
- **F3. The basket doesn't know about components.** It has no `componentItems` handling,
  so it can't plan an upgrade path (L6). It could also pick an item together with its own
  component (H2), and it prices an upgrade of an owned component at full cost (H1). None
  of this was seen in the sweep, but nothing prevents it.
- **F4. Large items crowd out small ones.** Picks favour 3,200 and 6,400 items. At 2,000
  souls (slider 4) the basket buys a single 1,600 item. At the 5,900 early checkpoint it
  uses its souls well (3 items, 300 left), so L5 passes there.
- **F5. Hard rules H1, H4, H5 and H6 already hold** in the sweep, as far as the probe
  shows. Fixtures still have to prove them.

### 5.3 Leans scored against the sweep

| Lean                          | Today | Detail                                                               |
| ----------------------------- | ----- | -------------------------------------------------------------------- |
| L1 spirit casters lean spirit | ❌    | Seven and Lady Geist early: gun 3,200 > spirit 2,400 (passes by mid) |
| L2 Haze leans gun             | ❌    | Mid cumulative: spirit 7,200 > gun 6,400                             |
| L3 tanks get durability       | ❌    | Abrams and Warden late vitality: 800 / 29,600 = 2.7%                 |
| L4 archetypes differ          | ❌    | Seven vs Haze late Jaccard 0.64; Seven vs Abrams 0.80                |
| L5 early phase uses souls     | ✅    | 3 items, 300 souls left, for every hero                              |
| L6 upgrade paths appear       | ❌    | None in any chain                                                    |

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
