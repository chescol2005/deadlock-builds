# Session record 2026-10-29: Match review benchmarks

**Scope:** PRs #134–#138. Criteria and decisions are in `docs/match-review-use-cases.md`
§10. The day began with closing Milestone H (`docs/session-2026-10-28-milestone-h.md`).

## Shipped

| PR   | What                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #134 | Use cases (MRB0): the 9:00 performance curve per hero, the rank bracket, a one-std judgement for five stats, criteria B1–B8. Checked by `data-verifier`, signed off.                   |
| #135 | Benchmark facts (MRB1): `lib/matchReview/benchmark.ts`, the starting rank read from match metadata, a pinned curve response. Fixture 24 (B1–B6).                                       |
| #136 | The page (MRB2): `LaneBenchmarkPanel` with a rank picker, a souls sentence and a five-stat table; one fetch helper; plain fallback. B7. Checked in a production build at 1366 and 375. |
| #137 | Coach souls line (MRB3, AI layer): `typical_souls`, approved wording, after the causes and before the lane result. B8.                                                                 |
| #138 | Close (MRB4): this record, the doc marked built, CLAUDE.md.                                                                                                                            |

## Decisions made with the user

- **The rank bracket: the player picks.** A dropdown with All ranks and each tier.
- **The default is the player's own starting rank**
  (`player_rank_data.initial_display_rank`). The team-average badge was the first
  choice, but `data-verifier` found it 0 on every match since about 2026-08-17.
- **Every §10.7 recommendation accepted:** one standard deviation, the API's 30-day
  window, the same rule for five stats, a 200-snapshot floor.
- **Coach wording approved as drafted** (MRB3).

## Caught on the way

- The curve's `samples` counts player snapshots, not players or matches: relabelled.
- The doc's "Typical column in the lane table" was built as its own card, since the
  typical player isn't a lane player. Same content; the doc now says so.
- Rewriting the pinned match JSON with a JSON library reformatted 2,800 lines; replaced
  with a 12-line text insert.

## Open

- The curve is the last 30 days, not the match's patch.
- MR5 (model wording; per-field number checks first), beyond the lane, M7, M8, and the
  rush-item value model from Milestone H.
