# Session record 2026-10-31: Milestone J (rush-aware fidelity guards)

**Scope:** PRs #144–#146. Criteria, measurements and results are in
`docs/milestone-j.md`. It follows Milestone I (`docs/session-2026-10-31-milestone-i.md`),
which re-baselined M1 and O2.

## Shipped

| PR   | What                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #144 | Use cases (J0): which data can split rushers, the measurement on today's build, criteria. Signed off.                                                                       |
| #145 | Fixtures (J1): `fitRushGroups.ts` + `heroRushGroups.json`, `rushGroups.ts`, M1 / O2 against the same-choice group, M1 ≤ 0.13 restored, O2 0.692, G1 / G2. No engine change. |
| #146 | Close (J2): `milestone-i.md` §4.2, engine design notes, CLAUDE.md, this record.                                                                                             |

## Decisions made with the user

- **Plan approved as proposed:** `item-flow-stats` as the source, split on the majority
  rule's rush item, the table under `src/scripts/data/`, pinned to the committed tables'
  window.
- **O2 against the group at 0.692** (§5 question 1, recommendation accepted). The measured
  drop is a real engine gap, so the guard compares with the right players at the honest
  number, and the gap is an open follow-up.

## Results

|                  | Before (Milestone I)      | After                   |
| ---------------- | ------------------------- | ----------------------- |
| M1 mean          | 0.139 (limit 0.14)        | 0.127 (limit 0.13)      |
| `M1:Seven:early` | known gap, d = 0.30       | passes, d = 0.20        |
| O2               | 0.731 against all players | 0.692 against the group |

## Caught on the way

- `item-stats`' `include_item_ids` ignores the buy-time window, so it can't tell an early
  rusher from a late buyer. `data-verifier` confirmed the `item-flow` locked path and
  the subtraction reconcile exactly.
- `item-flow`'s early column ends at 9:00. Measured against all players, it moved M1 by
  0.001 and O2 not at all.
- The first table kept items bought by ≥ 2% of players and gave an M1 mean of 0.132; the
  tail matters. At 0.5% it matches the every-node measurement.
- Milestone I's explanation for O2 (a rushing build buys skipped basics in mid) didn't
  hold up: compared with rushers, the gap widened.
- The first `ci` wait on #144 matched the previous commit's passing run. The merge loop
  now checks the PR head commit first.

## Open

- Lady Geist's mid build after a rush (engine), then raise O2.
- T1 against the rush groups, or retire it in favour of the majority rule.
- Post-patch refit (2026-10-30 patch): then rerun `fit-rush-groups`.
- P1 9 / 24 and P5 2 / 10 stay known gaps; MR5, beyond the lane, M7, M8.
