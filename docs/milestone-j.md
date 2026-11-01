# Milestone J: rush-aware fidelity guards

**Status:** APPROVED 2026-10-31, with every recommendation in §5 accepted as written. Per "Testing Expectations", no fixture or
script changes until these criteria are approved; change this doc first if an expectation
needs to change.

**Scope:** the starter-build fidelity guards M1 (gun / spirit / vitality split per phase)
and O2 (mid picks in the real mid top 10) in `src/scripts/starterBuildFixtures.ts`, and a
new committed table they read. **No engine change:** `lib/engine/` and its data tables are
untouched, so the recorded baselines cannot move. Follows Milestone I
(`docs/milestone-i.md` §4.2), which re-baselined both guards.

## 1. The problem

Milestone I made the starter build rush a big item where most of a hero's players do.
Two guards then failed and were loosened:

- **M1:** the mean split distance to real play went up from ≤ 0.13 to ≤ 0.14, and
  `M1:Seven:early` was listed as a known gap.
- **O2:** the mid-pick overlap went down from ≥ 0.796 to ≥ 0.731.

The reason given was that both compare one build with the average of all players, rushers
and non-rushers mixed. A build that rushes can't match that average. The follow-up was to
compare each build with the players who made the same choice, then restore the old limits.

## 2. Measuring rushers separately (2026-10-31)

### 2.1 Which data can tell them apart

| Source                                                                 | Rushers vs non-rushers? |
| ---------------------------------------------------------------------- | ----------------------- |
| `item-stats` (today's tables), `include_item_ids` / `exclude_item_ids` | No                      |
| `item-flow-stats`, `locked_item_ids` + `locked_columns=0`              | Yes                     |

- **`item-stats` can't split them.** Its include / exclude filters match players who
  bought the item at any time in the match. The buy-time window only filters the rows that
  come back. For Seven, 15,426 players bought Cultist Sacrifice before 10:00, and 20,641
  bought it at some point.
- **`item-flow-stats` can.** Its locked build path keeps only players who bought the item
  in the early column. It returns per-phase purchase counts for that group, with no
  sampling and no cap.
- **Non-rushers are the difference.** Subtracting the locked call from the unfiltered one,
  node by node, gives the players who did not rush. The locked nodes are a strict subset
  (no count above the unfiltered one), and the totals match `hero-stats`.

`data-verifier` confirmed this on 2026-10-31 (Seven and Lady Geist, the committed tables'
window, Oracle+).

### 2.2 Caveats

- **The early column ends at 9:00, not 10:00.** `item-flow` uses fixed columns (0–9, 9–20,
  20–30, 30+ min); `phase_interval_s` is ignored. Its early column equals `item-stats` with
  `max_bought_at_s=539` exactly. A rush bought between 9 and 10 minutes counts as mid.
  - Measured against all players (§3, "All players, item-flow"), this moves M1's mean by
    0.001 and O2 not at all.
- **Purchases, not holdings.** Both sources count a component and the upgrade built from
  it. Today's tables do the same, so this doesn't change the comparison.
- **No late column.** `item-flow` counts purchases, not what is held at the end. The late
  M1 key keeps today's final-inventory split for both groups. The late keys didn't move in
  Milestone I, and the two rushing heroes' are within the limit (Seven 0.11, Lady Geist
  0.23).

## 3. Results on the current build (no code change)

The 8 reference heroes. "Group" compares each hero's build with the players who made the
same early choice about the hero's top early 3,200+ item, the item the majority rule
uses: rushers when the build rushes, non-rushers when it doesn't.

| Reference                | M1 mean   | M1 keys > 0.30          | O2                  |
| ------------------------ | --------- | ----------------------- | ------------------- |
| Committed tables (today) | 0.139     | Seven early, Warden mid | 38 / 52 = 0.731     |
| All players, item-flow   | 0.140     | Seven early, Warden mid | 38 / 52 = 0.731     |
| **Group, item-flow**     | **0.127** | Warden mid              | **36 / 52 = 0.692** |

Only Seven (Cultist Sacrifice, 55%) and Lady Geist (Radiant Regeneration, 63%) rush. The
other six heroes' non-rusher groups are 89–99% of their players, so their numbers barely
move.

| Hero, phase       | Engine split (gun / spirit / vitality) | All players            | Same-choice group      |
| ----------------- | -------------------------------------- | ---------------------- | ---------------------- |
| Seven, early      | 57 / 14 / 29                           | 45 / 30 / 26, d = 0.30 | 61 / 20 / 19, d = 0.20 |
| Lady Geist, early | 14 / 71 / 14                           | 17 / 63 / 21, d = 0.17 | 10 / 75 / 15, d = 0.08 |
| Lady Geist, mid   | 31 / 31 / 38                           | 27 / 40 / 33, d = 0.18 | 36 / 29 / 36, d = 0.10 |

### 3.1 What this shows

- **M1 was an averaging effect.** Against the same-choice group, the mean is 0.127, under
  the old 0.13 limit. Seven's early key passes (0.20).
- **O2 was not.** Against the rushers, Lady Geist's mid overlap falls from 4 / 7 to 2 / 7.
  - **What Lady Geists who rush buy in mid:** Healing Booster 69%, Kinetic Dash 67%,
    Spirit Resilience 57%, Berserker 47%, Extra Stamina 43%, Recharging Rush 37%.
  - **What the engine buys:** Kinetic Dash, Fleetfoot, Enduring Speed, Spirit Lifesteal,
    Arcane Surge, Compress Cooldown, Extra Health.
  - **So the drop is a real engine gap.** Milestone I's explanation was right for M1 and
    wrong for O2.
  - Seven's mid overlap is 6 / 8 against both references.

## 4. Acceptance criteria

### 4.1 The new table

- **What it holds:** for each of the 44 heroes, the early (0–9 min) and mid (9–20 min)
  purchase counts for two groups. The split is by the hero's top early 3,200+ item in
  `heroPhaseItems.json` (the majority rule's item): rushers (bought it in the first 9
  minutes) and non-rushers. Heroes with no early 3,200+ item get one group, all players.
- **How it's made:** pinned to the committed tables' window and rank (2026-09-30 to
  2026-10-25, Oracle+), so it describes the same players the engine is tuned on. Written
  by a script, `npm run fit-rush-groups`. It refuses to write after a failed or
  short fetch (the same guards as `fit-category-split`). It is refreshed with every
  `fit-category-split` run.
- **Where it lives:** `src/scripts/data/heroRushGroups.json`. Only the fixtures read it;
  the engine never does.

### 4.2 Guards

| ID  | Criterion                                                                                                                                                            | Today                | After J1                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------- |
| M1  | Early and mid keys compare with the same-choice group's split; late keys with the final split, as today                                                              | mean ≤ 0.14          | **mean ≤ 0.13 restored**           |
| M1  | `M1:Seven:early` in `KNOWN_LEAN_GAPS`                                                                                                                                | listed               | **removed** (d = 0.20)             |
| M1  | `M1:Warden:mid` in `KNOWN_LEAN_GAPS`                                                                                                                                 | listed               | stays listed (d = 0.42 either way) |
| O2  | Mid picks in the same-choice group's mid top 10                                                                                                                      | ≥ 0.731, all players | see §5 question 1                  |
| G1  | **New, offline:** the group choice picks rushers exactly when the build's early phase holds the hero's top early 3,200+ item, and all players when the hero has none | —                    | passes                             |
| G2  | **New, live:** every reference hero has an entry in the table, and the rusher and non-rusher counts sum to the all-player count                                      | —                    | passes                             |

Unchanged:

- the hard rules H1–H9;
- the other leans and ratchets (M2, M3, O1, T1, P1–P6);
- every recorded baseline basket: no engine code changes.

## 5. Open questions for sign-off

Each carries a recommendation; approving the doc as written accepts them.

1. **O2.** Against the same-choice group it is 0.692, below today's 0.731, because of
   Lady Geist's mid build (§3.1).
   - **Recommendation:** measure O2 against the group too, with its baseline at the measured
     0.692 and a comment naming the cause. A guard that compares with the wrong players
     only looks stricter. Then add "Lady Geist's mid build after a rush" to the open
     follow-ups as an engine item, separate from this milestone.
   - **Alternative:** keep O2 against all players at 0.731 until that engine fix lands.
2. **Group item.** **Recommendation:** split on the hero's top early 3,200+ item only, the
   same item the majority rule uses. A second rush item (Lady Geist: Cultist 13%) is a
   minority choice the build doesn't make.
3. **The 9:00 boundary.** **Recommendation:** accept it. Against all players it changes
   M1 by 0.001 and O2 not at all (§3).
4. **Data source for the other heroes.** **Recommendation:** fit all 44 heroes, not only
   the 8 reference heroes: 88 calls, and ready if the reference set grows.

## 6. Work items

| PR  | What                                                                                                                   | Kind     |
| --- | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| J0  | This doc (sign-off)                                                                                                    | docs     |
| J1  | `fitRushGroups.ts` + the committed table; M1 / O2 read it; restore M1 ≤ 0.13, remove `M1:Seven:early`; G1 / G2         | fixtures |
| J2  | Close: `milestone-i.md` §4.2, engine-design-notes.md, CLAUDE.md (key files, refit cadence, follow-ups), session record | docs     |

## 7. Results

### J1: rush-group table and guards (2026-10-31)

- **The table:** `npm run fit-rush-groups` wrote all 44 heroes (214 KB). It keeps items
  bought in a column by at least 0.5% of the hero's players. At 2% the dropped tail moved
  the M1 mean to 0.132, so the cut-off was lowered until it matched J0's measurement on
  every node.
- **The groups:** Seven and Lady Geist compare with their rushers (10,811 of 28,287 and
  8,165 of 17,752 matches). The other six compare with non-rushers, 89–99% of their
  players.
- **M1:** mean 0.127 ≤ 0.13, restored. `M1:Seven:early` passes (d = 0.20) and is removed
  from `KNOWN_LEAN_GAPS`. `M1:Warden:mid` stays listed (d = 0.42).
- **O2:** 36 / 52 = 0.692 against the group, the new baseline (§5 question 1).
- **G1 / G2:** pass. G2 also checks that the table's rush item is the majority rule's
  item on the committed buy rates, so a `fit-category-split` refit without a
  `fit-rush-groups` rerun fails.
- **Unchanged:** every other fixture and every baseline basket (no engine code changed).
