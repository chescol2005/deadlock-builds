# Session record 2026-10-31: Milestone I (rush-item value)

**Scope:** PRs #140–#143. Criteria, the sweep and the amended guards are in
`docs/milestone-i.md`. It follows Milestone H (`docs/session-2026-10-28-milestone-h.md`)
and the match review benchmarks (`docs/session-2026-10-29-match-benchmarks.md`).

## Shipped

| PR   | What                                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #140 | Use cases (I0): the diagnosis (a flat per-item population bonus), the cost-scaled approach, criteria. Signed off.                                                                             |
| #141 | Fixtures first (I1): P6 false-rush counter, ceiling 0.                                                                                                                                        |
| #142 | The change (I2): `phaseReferenceCost`, `phaseItemPriceFactor`, exponents early 1 / mid 0 / late 0.75; the doc's criteria amended first; 39 of 72 baselines; `scoring-auditor` findings fixed. |
| #143 | Close (I3): engine design notes, C5 / C6 resolved, CLAUDE.md, this record.                                                                                                                    |

## Decisions made with the user

- **Diagnose before planning.** The cause was the population term's shape, not item
  effects: coverage per soul is even between rush items and basics.
- **Rushes + amend guards.** After the sweep, the user approved replacing P2 and P3 (one
  build against the all-player average) with the majority rule. M1 mean (0.14) and O2
  (0.731) were re-baselined and `M1:Seven:early` listed, with a follow-up to measure them
  against players who made the same choice.

## Results

|                                   | Before  | After   |
| --------------------------------- | ------- | ------- |
| Majority rule (rush iff ≥ 50% do) | 37 / 44 | 43 / 44 |
| Real rushes (≥ 20%) held early    | 1 / 24  | 9 / 24  |
| Late tier-4 in the real top 3     | 28 / 52 | 37 / 52 |
| False rushes                      | 0       | 0       |

## Caught on the way

- PR #139 (2026-10-30 patch pricing) landed on `main` between turns. The I0 commits went
  to local `main` instead of the branch; they were moved to the branch before any push to
  `main`.
- Type literals: comparing a literal-typed constant with 0 fails `tsc` once it isn't 0;
  the exponent is a typed per-phase record.
- A JavaScript default parameter also applies to an explicit `undefined`, so a "no phase"
  fixture context silently became early. It uses an explicit `"none"`.
- The audit found the term's doc comment ("up to 1.8 slots") no longer true. It now
  states the uncapped ceiling.

## Open

- Rush-aware M1 / O2 tables (restore the old bars).
- P1 9 / 24 and P5 2 / 10 stay known gaps.
- MR5, beyond the lane, M7, M8.
