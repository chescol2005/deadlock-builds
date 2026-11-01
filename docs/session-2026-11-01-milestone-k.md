# Session record 2026-11-01: Milestone K (Lady Geist's mid build after a rush)

**Scope:** PRs #147–#149. Criteria, measurements and results are in `docs/milestone-k.md`.
It follows Milestone J (`docs/session-2026-10-31-milestone-j.md`), which found the gap.

## Shipped

| PR   | What                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| #147 | Use cases (K0): diagnosis, wiki check, fixes A and B measured on a scratch change, criteria. Signed off.                                           |
| #148 | Engine (K1): `tradeHealHp`, heal amp counts owned temporary heals (not Siphon); K-1/K-2/K-3 engine fixture, K-L1; O2 0.712, M3 0.072; 4 baselines. |
| #149 | Close (K2): engine design notes (G3 note corrected, new section), CLAUDE.md, this record.                                                          |

## Decisions made with the user

- **Plan approved as proposed:** use cases first, `data-verifier` on the wiki, measure
  candidate fixes before choosing.
- **K0 approved with every §5 recommendation:** fix A only; Spirit Resilience and Berserker
  stay a known gap; Wraith's late Healing Booster accepted; no special handling for the
  pre-patch frozen inputs.

## Results

|                                 | Before (Milestone J) | After  |
| ------------------------------- | -------------------- | ------ |
| Healing Booster, Lady Geist mid | rank 150 of 151      | held   |
| O2                              | 0.692                | 0.712  |
| M3                              | 0.079 (≤ 0.077)      | 0.072  |
| M1 mean                         | 0.127                | 0.125  |
| Recorded builds changed         | —                    | 4 / 72 |

## Caught on the way

- G3's note said the wiki leaves all item regen out of heal amp. The wiki excludes only
  constant regen and names Radiant / Mystic Regeneration as amplified.
- The effect estimator halves estimated quantities (`EFFECT_CONFIDENCE`); the first engine
  fixture expected the raw tooltip heal and failed. The amp base uses the same discounted
  HP the item is valued on.
- `scoring-auditor`: an owned Siphon Bullets would have entered the amp base without the
  hero's landed shots or enemy health, and the wiki doesn't list it. Left out.

## Open

- Spirit Resilience and Berserker in Lady Geist's mid build (3,200-soul mid items).
- T1 against the rush groups, or retire it.
- Post-patch refit (2026-10-30 patch), then rerun `fit-rush-groups`.
- P1 9 / 24 and P5 2 / 10 stay known gaps; MR5, beyond the lane, M7, M8.
