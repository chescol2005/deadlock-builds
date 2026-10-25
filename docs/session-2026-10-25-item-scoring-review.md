# Session record 2026-10-25: starter build UI, Work 3, and the item scoring review

**Scope:** PRs #97–#107. This session shipped the "Start from a suggested build" UI
(Work 2d), page metadata and the phone / touch pass (Work 3), and the item scoring
review that closed Milestone F. The details live in `docs/item-scoring-review.md`
(criteria, results and accepted gaps) and `.claude/skills/scoring-engine-dev/engine-design-notes.md`.

## Shipped

| PR   | What                                                                                                                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #97  | Session record for the value-scale stack (`docs/session-2026-10-24-value-scale.md`).                                                                                                                                                                                       |
| #98  | Work 2d: `StarterBuildPanel` shows early / mid / late picks in buy order with plain-English reasons (`MarginalTerm.plain`). Applying keeps owned items and trades in components after a confirm. Fixed a starter build that rebuilt on every click.                        |
| #99  | Work 3a: per-page metadata and a title template. `/api/og/build` share previews show the hero and the build's items. `sitemap.xml` (253 URLs) and `robots.txt`. Production picks up `deadlockfoundry.com` automatically.                                                   |
| #100 | Work 3b: `/build` stacks below xl; touch drag works by press-and-hold; 40 px tap targets on touch screens; tap tooltips; the site is dark-only. Fixed a production-only React #185 loop on every touch drag: a phase section closed while the drag was over its own items. |
| #101 | Review criteria (approved) and data-cadence fixes: lane bounties for the 09-16 patch, plus citations.                                                                                                                                                                      |
| #102 | R1: frozen inputs and 77 recorded baseline baskets (`npm run baseline`). Live ratchets get a noise band. Post-patch category split and phase items.                                                                                                                        |
| #103 | R2a: DPS abilities priced per cast (Lightning Ball 75 × 5 s); damage upgrades apply; modifiers aren't read as damage. Mystic Reverb is a proc. Valuations for the four heuristic stat keys. Roster-wide check: 139 of 176 abilities unchanged.                             |
| #104 | R2b: phase-profile refit (C4) and early-rush exemption (C5) measured and held back; live sweep (C6) accepted gaps recorded.                                                                                                                                                |
| #105 | R2c: partial credit for ability charges granted by an upgrade tier (Life Drain T3: 0 early, half mid, full late).                                                                                                                                                          |
| #106 | R3: the goal-based `scoreItems` / Suggested Items panel retired (slot-derived tags, false reasons). The shop shows upgrade prices with owned components traded in. Anti-synergy trimmed to the two real diminishing-returns pairs.                                         |
| #107 | R4: the measured pair reason shows as a labelled line, never the headline. Milestone F closed.                                                                                                                                                                             |

## Results (live Fixture 13, reference heroes)

| Measure                       | Start of review | End     |
| ----------------------------- | --------------- | ------- |
| M1 phase fidelity             | 24 / 24         | 24 / 24 |
| Mean distance to real play    | 0.113           | 0.114   |
| M3 mid overlap (lower better) | 0.096           | 0.080   |
| O2 mid picks in real top 10   | 0.679           | 0.760   |

The review mostly fixed **what the engine believes about items**: ability damage, procs,
charges and melee. It held fit to real play steady. Two changes that would have improved
some measures, the C4 profile refit and the C5 rush exemption, were measured, failed the
gate, and are recorded as accepted gaps.

## Decisions made with the user

- **C2 criterion amended.** Mystic Reverb is priced as its text says (at least 100 per
  proc), so for Haze it outranks Surge of Power. It is picked in no baseline basket.
- **R2c charge credit.** A named per-phase table, not one derived from ability points.
- **R3: `scoreItems` retired.** Anti-synergy keeps Leech + Vampiric Burst (with no
  "bought twice" note: the shared component only discounts the other upgrade) and Cold
  Front + Slowing Hex.

## Open after F

See CLAUDE.md "After Milestone F": planned big items (rushes, tier-4), sustain valued
over more than one trade before the profile refit, in-phase upgrades (H2), real ability
tiers for charge credit, item tags, and the narrow Hero Basket column.
