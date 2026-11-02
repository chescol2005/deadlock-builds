# Session record 2026-11-02: Milestone L (3,200-soul items in the mid build)

**Scope:** PRs #150–#152. Criteria, measurements and results are in `docs/milestone-l.md`.
It follows Milestone K (`docs/session-2026-11-01-milestone-k.md`), which left Spirit
Resilience and Berserker out of Lady Geist's mid build.

## Shipped

| PR   | What                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #150 | Use cases (L0): diagnosis, data check of both items, ten fixes measured on a scratch change, criteria. Signed off.                                                                             |
| #151 | Engine (L1): slot horizon (`slotHorizonSouls`, `rankingPrice`), 25% mid shop overshoot with a note; engine §35, L-L1, L-L2; O2 0.891, Warden mid off the known gaps, P5 floor 1; 52 baselines. |
| #152 | Close (L2): engine design notes (new section, ranking note), CLAUDE.md, this record.                                                                                                           |

## Decisions made with the user

- **Plan approved as proposed:** use cases first, `data-verifier` on both items, and
  measuring the candidate fixes before choosing one.
- **L0 approved with every §5 recommendation:**
  - fix A (half mid horizon, late horizon, 25% overshoot);
  - Berserker stays a known gap;
  - P5 floor 2 → 1;
  - 52 recorded builds accepted;
  - the low-health resist stays unpriced.

## Results

|                                   | Before (Milestone K) | After   |
| --------------------------------- | -------------------- | ------- |
| Spirit Resilience, Lady Geist mid | not held             | held    |
| Mid 3,200+ soul share (real 0.57) | 0.35                 | 0.49    |
| O2                                | 0.712                | 0.891   |
| M3                                | 0.072                | 0.071   |
| M1 mean                           | 0.125                | 0.123   |
| P5                                | 2                    | 1       |
| Recorded builds changed           | —                    | 52 / 72 |

## Caught on the way

- **The gap was not Lady Geist's alone.** Every hero's mid phase was ranked per soul.
  Seven, Lady Geist and Warden held no 3,200 item in mid.
- **A mid horizon alone cost three late 6,400 items.** With fewer, bigger mid items, the
  late phase filled its free slots cheaply. The same horizon in late fixed it.
- **The data check found an unpriced stat.** Spirit Resilience's extra resist below half
  health (`TechResistBelowThreshold`) isn't priced. Pricing it alone changed no mid build.
- **`scoring-auditor` on L1:**
  - an overshooting pick carried no reason; it now has a note;
  - unknown souls gave the largest horizon; they now give none;
  - the late horizon is calibrated only at the 30,000 checkpoint (recorded).
- **Python on Windows writes CRLF in text mode.** The scratch edits now pass
  `newline=""`.

## Open

- Berserker in Lady Geist's mid build (conflicts with M1's average-split comparison).
- The slot horizon between checkpoints (slider 23–28).
- T1 against the rush groups, or retire it.
- Post-patch refit (2026-10-30 patch), then rerun `fit-rush-groups`.
- P1 9 / 24 and P5 1 / 10 stay known gaps; MR5, beyond the lane, M7, M8.
