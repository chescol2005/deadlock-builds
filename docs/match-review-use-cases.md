# Match review (lane phase): use cases and acceptance criteria

**Status:** BUILT 2026-10-27 (PRs #123–#127). Approved 2026-10-26 with every
recommendation in §9 accepted; changed since with the user's sign-off: the last-hit rule
(§4.1), the coach order and one veteran line (§6). Change this doc first if an
expectation needs to change (see "Testing Expectations" in CLAUDE.md).
**Work items:** MR0 (this doc) → MR1 lane facts + fixtures → MR2 coach lane insights (AI
layer, separate PR) → MR3 page → MR4 close. Later: MR5, an optional Anthropic key.

## 1. What the feature is

A player has just finished a match and wants to know how their lane went. They open
**Match review**, paste the match ID, and click their hero in the match. They get a short
lane report covering the first 9 minutes, compared with their two lane opponents and
their lane partner. Under it, the coach points out the one or two things that mattered
most, in plain English.

The report is deterministic. The numbers come straight from the match data, and the
coach uses approved templates and the existing validator, as on `/build`. There is no AI
model in v1. An optional Anthropic key for model wording comes later (§8).

The data comes from `GET https://api.deadlock-api.com/v1/matches/{match_id}/metadata`.
The visitor's browser calls it directly (§5).

## 2. Inputs

| Input            | Required | Notes                                                                                                                                                                                                                                         |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match ID         | yes      | A positive integer. The in-game match history shows it.                                                                                                                                                                                       |
| Hero             | yes      | Picked from the match's heroes after it loads, grouped by lane. Each hero is played once per match, so the hero identifies the player.                                                                                                        |
| deadlock-api key | no       | Cached matches load without it. A match the API has not fetched yet comes from Steam, which allows 3 requests an hour per IP without a key and 300 an hour with one. The key is sent only to api.deadlock-api.com, as the `X-API-KEY` header. |

The URL keeps the match ID and hero (`/match?id=…&hero=…`) so a review can be shared.
It never contains the key.

## 3. Definitions

- **Lane.** A player's `assigned_lane`: 1 = York (yellow), 4 = Broadway (blue), 6 =
  Greenwich (green), from `/v1/assets/generic-data` `lane_info` and deadlock.wiki/Lanes.
  Each lane holds two players from each team (verified on 3 matches, no missing values).
- **Lane opponents.** The two enemy-team players with the same `assigned_lane`.
- **Lane partner.** The other player on your team with the same `assigned_lane`.
- **Snapshots.** `stats[]` entries at `time_stamp_s` 180, 360, 540, 720, 900, then every
  300 s, plus one at the match end. The values are running totals (verified non-decreasing
  for 36 players). Use the snapshot `creep_kills`, never the top-level `last_hits`, which
  counts something else (144 against 54 in one match).
- **Lane end.** The 9:00 snapshot (`time_stamp_s` 540). The wiki defines no hard end.
  deadlock.wiki/Souls puts it at about 8 minutes (the source the starter build already
  uses), and the first Guardian fell at 6:35–8:19 in the three verified matches. Guardian
  damage resistance reaches 0% at 6:00 and is gone entirely at 12:00
  (deadlock.wiki/Lane_Guardian). 9:00 is the first snapshot after the lane usually
  breaks. 3:00 and 6:00 show how the lane developed, and the veteran table adds 12:00.
- **Supported matches.** Normal 6v6 matches (`game_mode` 1) that reached 9:00. Street
  Brawl, abandoned or short matches, and matches missing the 9:00 snapshot get a plain
  message saying why there is no lane review. They never get a partial report presented
  as complete.

## 4. What the report shows (the facts)

All values are at lane end unless a time is given.

| Fact              | Definition                                                                                                                                                                                                                                                                                            | Shown as                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Souls             | `net_worth` at 3:00, 6:00 and 9:00, for you, your partner and each opponent                                                                                                                                                                                                                           | A small table, plus the gap to the opponent average |
| Lane soul gap     | (you + partner) − (opponent 1 + opponent 2) at 9:00                                                                                                                                                                                                                                                   | "Your lane was 1,200 souls ahead"                   |
| Last hits         | `creep_kills` and `creep_kills / possible_creeps`. `possible_creeps` is undocumented, so the share is only compared between the four lane players, never shown as an absolute grade.                                                                                                                  | "38 of 57 troopers (67%)"                           |
| Denies            | `denies`, compared with the opponents                                                                                                                                                                                                                                                                 | Count                                               |
| Deaths            | Each `death_details` entry before 9:00: its time and the killer's hero (`killer_player_slot` → that player's hero). A death is a **gank** if the killer is not one of your lane opponents. A slot that matches no player shows as "troopers or a structure" (not seen in the sample, handled anyway). | "Died at 5:19 to Haze (gank)"                       |
| Trades            | `player_damage` dealt against `player_damage_taken`                                                                                                                                                                                                                                                   | Dealt / taken and the ratio                         |
| Accuracy          | `shots_hit / (shots_hit + shots_missed)`                                                                                                                                                                                                                                                              | Percent (veteran view only)                         |
| Items by lane end | Entries of `items[]` whose `item_id` is a shop item (`/v1/assets/items` `type === "upgrade"`; ability unlocks share the list), bought before 9:00 and not sold by then (`sold_time_s` 0 = still held). Components sold into an upgrade drop out.                                                      | Item icons with prices                              |

The simplified view shows the souls, the soul gap, deaths and items. The veteran view
adds last hits, denies, trades, accuracy and the per-snapshot table.

### 4.1 Ahead, even or behind

These starting thresholds are easy to tune. The fixtures assert the classification, not
the wording.

| Judgement         | Rule                                                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Soul lead (you)   | Your souls against the opponent average at 9:00: **ahead** if more than 10% above, **behind** if more than 10% below, else **even**. 10% is about 600 souls at 9:00.                                                                                                 |
| Lane result       | The same rule applied to the lane soul gap, against the opponents' total                                                                                                                                                                                             |
| Fell behind early | Behind at 6:00 by the same rule                                                                                                                                                                                                                                      |
| Costly deaths     | Two or more deaths before 9:00                                                                                                                                                                                                                                       |
| Won / lost trades | Dealt / taken above 1.25 = won, below 0.8 = lost, else even                                                                                                                                                                                                          |
| Last hits         | Your last-hit share against the average of your two lane opponents: more than 10 points lower = **missed last hits**. Changed 2026-10-27 (MR1): against the better opponent it flagged 8 of 12 players in the fixture match; the average flags the 3 clear laggards. |

## 5. The key and privacy

- **Browser only.** The page fetches match metadata from the visitor's browser (the API
  allows any origin). Our server never receives the key or makes the call. On Vercel,
  a server-side call would also share one IP's Steam limit (3 an hour) across every
  visitor.
- **Never stored or logged.** The key lives in memory. It is kept in `sessionStorage`
  only if the visitor ticks "Remember for this tab". It never goes in `localStorage`,
  cookies, the URL or analytics.
- **No identities.** The report shows heroes, never account IDs or player names.
- **Plain errors.** Bad ID; not found (404 `Match metadata not found.`); Steam busy (503
  with `Retry-After`: say when to retry, and that a key raises the limit); unsupported
  mode; network failure. None of them is a crash or a blank page.

## 6. Coach lane insights (MR2, AI-layer PR)

These are new `CoachFact` kinds in `lib/coach/`, plus templates for new players and
veterans, with the same validator (word limits, numbers and items only from the fact, no
internal terms). They answer one trigger, `match_reviewed`, in both audiences. Each
message shows once per review. The coach shows at most two, in this order (approved in
MR2, 2026-10-27: the causes come before the summary, which the page already shows):

1. `lane_deaths`: two or more deaths, with times. A gank is called out.
2. `fell_behind_early`: behind at 6:00, and whether you caught up by 9:00.
3. `lost_trades`: dealt / taken below 0.8.
4. `missed_last_hits`: last-hit share well below the opponents' average.
5. `lane_result`: ahead, even or behind at 9:00, with the soul gap.
6. `strong_lane`: ahead with no deaths, in place of `lane_result`. Praise is also
   coaching.

The approved wording lives in `lib/coach/templates.ts`. Souls and damage are rounded to
the nearest 50 and last-hit shares to whole percents. An "even" gap is rounded up, so
"within N souls" stays true. Every warning says what to do instead: the veteran "behind
at 9:00" line gained "Farm safe camps until your next item." in MR2 (user decision).

`lib/matchReview/` (the facts) must not import `lib/coach/`, and the coach must not
import `lib/matchReview/`. One bridge, `lib/matchReviewCoachContext.ts`, turns a lane
report into coach facts, like `lib/coachContext.ts` does for builds.

## 7. Acceptance criteria (each becomes a fixture)

The fixtures run on a pinned real match saved as JSON under `lib/matchReview/__fixtures__/`.
No live calls are needed in CI.

| ID  | Criterion                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Same match and hero always give the same report.                                                                                                                            |
| R2  | Lane opponents are exactly the two enemy players with your `assigned_lane`; your partner is the other teammate with it. For every hero in the fixture match.                |
| R3  | Every number in the report equals the raw snapshot value, or a stated formula of raw values (spot-checked against the JSON).                                                |
| R4  | Deaths after 9:00 are excluded. A death to a non-opponent is a gank.                                                                                                        |
| R5  | Items are shop items only, bought before 9:00 and not sold before 9:00.                                                                                                     |
| R6  | Unsupported matches (Street Brawl, no 9:00 snapshot, hero not in match) return a typed "no review" reason, never a partial report.                                          |
| R7  | The judgements in §4.1 classify the fixture lanes as expected, including at the threshold edges (synthetic cases).                                                          |
| R8  | Coach lane messages pass the validator for both audiences; the numbers in them appear in the facts.                                                                         |
| R9  | The key is never sent anywhere except api.deadlock-api.com: no `app/api` route accepts it, and the page never writes it to `localStorage` or the URL (source-scan fixture). |
| R10 | The page is in `NAV_SECTIONS`, exports metadata, has `simplified?: boolean` panels with the shared Tooltip (Fixtures 9, 12 and 15), and works at 375 px.                    |

## 8. Later (not in v1)

- **MR5: optional Anthropic key.** A Claude model rewords the same facts, or answers
  follow-up questions about them, from the visitor's browser with their own key. The
  validator still applies, and the template text shows whenever the model's answer fails
  it or there is no key. It needs a prompt sandbox before code (CLAUDE.md M6 rules). The
  validator must get stricter first: it allows any digit run found in a fact's text
  fields (a death time like "5:31" allows 5 and 31 anywhere). That is safe for templates,
  but a model could write "5 deaths" and pass. Number checks should be per field before a
  model writes lane messages (MR2 audit).
- **Benchmarks.** "A typical Oracle+ Haze has N souls at 9:00". The source exists:
  `/v1/analytics/player-performance-curve?hero_ids=…&resolution=0&min_average_badge=…`
  gives per-hero net worth and creep kills by second (e.g. Oracle+ Haze at 9:00: 6,551
  souls, 19.9 last hits, ~14.6k samples). `lane-matchup-stats` sums lane duos, so it is
  less useful per player.
- **Beyond the lane.** Mid-game, objectives, item timings against the starter build.
- **Recent matches.** Pick from your recent matches by account ID instead of pasting an
  ID. `/v1/players/{account_id}/match-history` works without a key.

## 9. Open questions for sign-off

Each question carries a recommendation. Approving the doc as-is accepts the
recommendations.

1. **Lane end at 9:00.** **Recommendation:** yes. It is the first snapshot after the
   wiki's ~8 minutes, and the starter build's early phase uses the same minute.
2. **The thresholds in §4.1.** **Recommendation:** start with them; R7 makes any later
   change visible.
3. **Remember the key.** **Recommendation:** memory only, with an opt-in "remember for
   this tab" (sessionStorage), never `localStorage`.
4. **Page name and path.** **Recommendation:** "Match review" at `/match`, as its own nav
   section.
5. **Benchmarks in v1.** The per-hero source is confirmed (§8). **Recommendation:** not
   in v1; ship the opponent comparison first, then add benchmarks as a small follow-up.
   Matching the match's rank bracket needs its own decision.
