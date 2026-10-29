# Session record 2026-10-28: Match review polish and Milestone H (planned big items)

**Scope:** PRs #128–#133. Criteria, results and accepted gaps are in
`docs/milestone-h.md`.

## Shipped

| PR   | What                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #128 | Match review polish: recent matches from a Steam ID, and the hero picker collapses once a hero is chosen.                                                                     |
| #129 | Milestone H use cases and acceptance criteria (H0), signed off.                                                                                                               |
| #130 | Fixtures first (H1): P1–P5 big-item measures (`bigItemChecks.ts`) in Fixture 13's known-gap ratchet; engine section 32.                                                       |
| #131 | Anchored plans (H2): `basketPlans` compares the greedy basket with one plan per big-item anchor. 2 of 72 baselines change (Haze late: Siphon Bullets; Wraith late: Ricochet). |
| #132 | "Worth saving up for" headlines a saved-up pick (H3). No scoring change.                                                                                                      |
| #133 | Close (H4): this record, the doc's results, C5 / C6 re-accepted, engine design notes, CLAUDE.md.                                                                              |

## Decisions made with the user

- **Ship + deeper model.** After H2's measurements, ship the anchored plans and then try
  valuing an early plan by its effect on the whole build.
- **Lookahead dropped** (X1). Measured on all 44 heroes: small gains, mostly false
  rushes, guards broken even at a 5% margin. The cause is the value model, not the search.

## Results

| ID                        | Before  | At close | Target |
| ------------------------- | ------- | -------- | ------ |
| P1 early rushes held      | 0 / 24  | 1 / 24   | 12     |
| P2 early big-item share   | 22 / 44 | 22 / 44  | 33     |
| P4 late top-3 tier-4 held | 21 / 52 | 26 / 52  | 32     |
| P5 mid tier-4 held        | 1 / 10  | 2 / 10   | 4      |

## Caught on the way

- The new fixture labels clashed with existing P1 / P2 / H3 labels; Milestone H's are
  prefixed "H" / "H-anchor".
- The greedy loop's doc comment had drifted above `basketPlans`; moved back.
- PR #131's body said Siphon Bullets was among Haze's top-3 misses. Checked against the
  buy rates (24%, Haze's 5th most common late buy) and corrected.

## Open

- The value model: what a rush item is worth to a hero whose players rush it.
- MR5 (model wording; per-field number checks first), match benchmarks, M7, M8.
