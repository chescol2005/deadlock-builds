# Session record 2026-10-26/27: Match review (lane phase)

**Scope:** PRs #123–#127. The use cases, criteria and decisions are in
`docs/match-review-use-cases.md`.

## Shipped

| PR   | What                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #123 | Use cases and acceptance criteria (MR0), checked against the live API and deadlock.wiki by `data-verifier`, signed off.                                                                                    |
| #124 | Lane facts (`lib/matchReview/`, MR1): parse the match metadata, the 9:00 lane report against both lane opponents and the partner, the judgements, typed no-review reasons. Fixture 21, offline.            |
| #125 | Coach lane insights (MR2, AI layer only): six insights on `match_reviewed`, at most two per review, approved wording; the bridge `lib/matchReviewCoachContext.ts`. Fixture 22.                             |
| #126 | The `/match` page (MR3): lookup with an optional deadlock-api key, hero picker by lane, report and coach, plain error wording, nav and sitemap. Fixture 23. Checked in a production build at 1366 and 375. |
| #127 | Close (MR4): CLAUDE.md, this record, the doc marked built.                                                                                                                                                 |

## Decisions made with the user

- **Both keys.** The deadlock-api key now (fetching new matches from Steam: 3 an hour
  per IP without it, 300 with it). An Anthropic key later (MR5), for model wording of the
  same facts.
- **A separate page**, `/match`, as its own nav section. Lane end at 9:00. Benchmarks
  later.
- **Missed last hits** compares with the opponents' average, not the better opponent:
  the better-opponent rule flagged 8 of 12 players in a real match.
- **Coach wording** approved as drafted, in the order causes before summary. The veteran
  "behind at 9:00" line gained "Farm safe camps until your next item." so every warning
  gives a fix.

## Caught on the way

- **Top-level `last_hits` is not the snapshot's `creep_kills`** (144 against 54 in one
  match). The report uses the snapshot.
- **Ability unlocks share the `items[]` list.** The planner's shop catalogue separates
  them: all 221 shop rows in the fixture match resolved, none of the 180 ability rows.
- **Floating point at the thresholds:** 110 / 100 − 1 is a hair above 0.10. Thresholds
  compare with a tolerance, so an exact edge is "even".
- **Missing data:** an absent death list or `sold_time_s` was first read as "none"; the
  audit caught it, and the parser now rejects it. An unknown last-hit share is `null`,
  never "did not miss".
- **An unnamed ganker** fell back to the no-gank advice; it is now "an enemy".
- **The generated Denies tooltip** described Dota's deny (killing your own creep);
  Deadlock's is shooting the enemy's soul orb.
- **Layout:** the report grid overflowed by 42 px on desktop and by 610 px in the phone's
  advanced view; `minmax(0,1fr)` and `grid-cols-1` fixed both.

## Open

See CLAUDE.md "After the match review: open follow-ups": MR5 (model wording, after
per-field number checks), benchmarks, beyond the lane, recent matches, phone layout.
