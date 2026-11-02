# Session record 2026-11-02: Milestone N (self-damage triggers)

**Scope:** PRs #153–#155. Criteria, measurements and results are in `docs/milestone-n.md`.
It follows Milestone L (`docs/session-2026-11-02-milestone-l.md`), which left Berserker
out of Lady Geist's mid build.

## Shipped

| PR   | What                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #153 | Use cases (N0): the user's in-game tests, data check, a scratch measurement, criteria. Signed off.                                                                 |
| #154 | Engine (N1): `KIT_SELF_DAMAGE`, `kitSelfDamagePerTrade`, Berserker's held stacks, spirit resist's self-damage saving, reasons; engine §36; 2 Lady Geist baselines. |
| #155 | Close (N2): engine design notes (new section), CLAUDE.md, this record.                                                                                             |

## Decisions made with the user

- **The insight came from the user:** her abilities hurt her, so she procs Berserker
  (and Radiant Regeneration) herself, while Malice amplifies her damage on the enemy.
- **The user ran combat-log tests in the sandbox:**
  - Malice, Essence Bomb and full combos, with and without Spirit Resilience;
  - Malice alone with Merge Events off;
  - Deadman Danny's Chimera Mk1 and Close The Deal.
  - The user also confirmed that Berserker counts damage before resists.
- **N0 approved with every §5 recommendation**, plus:
  - Berserker in Lady Geist's mid build is a priority follow-up (a key item for her),
    not an accepted gap;
  - Chimera Mk1's overheat hit stays out (overheating is a misplay);
  - Close The Deal joins the table.

## Results

|                                     | Before (Milestone L)           | After           |
| ----------------------------------- | ------------------------------ | --------------- |
| Berserker, Lady Geist mid (% fight) | 20.7                           | 26.1 (1.37×)    |
| Spirit Resilience, Lady Geist mid   | 27.5                           | 34.4            |
| Berserker in her mid build          | no                             | no (gun budget) |
| Recorded builds changed             | —                              | 2 / 72          |
| M1 / M3 / O2 / P4 / P5              | 0.123 / 0.071 / 0.891 / 37 / 1 | unchanged       |

## Caught on the way

- **The same key means different things.** `SelfDamagePct` is health on Malice and own
  damage on Essence Bomb. So the parser prices only a verified table.
- **The wiki says Malice costs current health**; all the tests started at full health.
  The model pays later casts at 75% health.
- **Radiant Regeneration was nerfed in the 2026-10-30 patch:**
  - per-cast heal 65 → 40;
  - boon scaling 1.7 → 1.4;
  - only in combat.

  Found by `data-verifier`; it waits for the post-patch refit.

- **Sandbox healing tests stop at full health**, so they can't measure heal size.
- **Value isn't Berserker's blocker.** Even 2.5× its value moved it only into late. The
  mid gun budget holds Kinetic Dash plus one 1,600 item.
- **`scoring-auditor` on N1:**
  - flagged Close The Deal in code before the doc had it (resolved);
  - asked for exact neutrality checks;
  - asked for the active-resist path to be tested;
  - asked that only the per-stack estimate be re-priced.

## Open

- PRIORITY: Berserker in Lady Geist's mid build (the mid gun budget).
- Victor and Bebop self-damage, untested.
- Post-patch refit; Lady Geist's fitted profile will shift (N's resist saving).
- From L: the slot horizon between checkpoints, T1 against the rush groups, P1 / P5 known
  gaps, MR5, beyond the lane, M7, M8.
