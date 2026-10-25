# Session record 2026-10-25: Milestone G (kit and sustain enrichment)

**Scope:** PRs #108–#114. Criteria, measurements and accepted gaps are in
`docs/milestone-g.md`. The design record is in
`.claude/skills/scoring-engine-dev/engine-design-notes.md` ("Healing between trades",
"A hero's own self-healing", "Profile in fight-value units").

## Why G changed

The queued G (parse ability upgrades for sustain, map hero tags to categories) would have
changed no live basket: since F, the measured stat profile sets those categories for all
44 heroes. The real weakness was how sustain is valued. Healing counted over one 10 s
trade, which is why the C4 profile refit failed in the item scoring review.

## Shipped

| PR   | What                                                                                                                                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #108 | G0 / G1: scope and acceptance criteria. The data check found hero self-heal keys, about 18 unpriced item healing keys, an unpriced heal amp, regen timing, and that hero tags are flavour text.                                         |
| #109 | G2a: healing between trades. Regen, out-of-combat regen (after its delay, in the quiet stretch), lifesteal while farming, and heals over time count in the 30 s gap, weighted 0.5 and capped for the whole build. Live gates unchanged. |
| #110 | G2b: the unpriced healing keys are priced (active / passive lifesteal, per-proc heals, Regeneration, Headhunter, Lifestrike) or listed with reasons. Fixture 29 scans the catalogue.                                                    |
| #111 | G2c: Siphon Bullets, from the wiki page the user supplied. 2.5% of the target's max HP per steal (once per 1.2 s), damage plus heal counted once.                                                                                       |
| #112 | G3: a hero's own self-healing parsed from its kit (`kitHeal.ts`). Heal amp priced on it. Sustain need for heroes with no profile (Spearman 0.40 / 0.38 / 0.31 against measured sustain).                                                |
| #113 | G4: phase stat profile refitted in fight-value units (the C4 retry). Mean L1 0.111 → 0.102; Abrams late stays 0.02.                                                                                                                     |
| #114 | G5: G closed; hero-tags mapping retired; follow-ups and this record.                                                                                                                                                                    |

## Results (live Fixture 13, reference heroes)

| Measure                       | Start of G | End     |
| ----------------------------- | ---------- | ------- |
| M1 phase fidelity             | 24 / 24    | 24 / 24 |
| Mean distance to real play    | 0.114      | 0.102   |
| M3 mid overlap (lower better) | 0.080      | 0.077   |
| O2 mid picks in real top 10   | 0.760      | 0.816   |

## Decisions made with the user

- **G re-scoped** to kit and sustain enrichment, with G2 split into G2a (horizon) and G2b
  (keys).
- **Siphon Bullets.** Base item only (Enhanced / Corrupted ignored). `StealPerKill` and
  `StealPerHit` are flags. Enemy max HP is the 2,500 reference Toxic Bullets uses. The user
  noted enemy health grows over the game, so that is a follow-up.
- **M3 raised once** for G3 (0.076 → 0.0781), because Abrams and Lady Geist buy Healing
  Booster mid in real play. G4 then lowered it to 0.077.

## Caught on the way

- **G2a, first version.** It took out-of-combat delays off the whole gap, which gave
  Fortitude 22.5% of HP. It beat Colossus for Abrams late (0.02 → 0.22). Fixed: the delay
  runs inside the quiet stretch.
- **G3, Card Trick.** It counted every Card Trick card as a heal; only Heart cards heal
  (one suit in four).
- **G3, need magnitudes.** Kit heal entered the need vector before `applyStatProfile`,
  whose rescale changed profiled heroes' magnitudes. Now it enters only without a profile.

## Open after G

See CLAUDE.md "After Milestones F and G":

- planned big items;
- in-phase upgrades;
- real ability tiers (charges and kit heal);
- enemy health over the game;
- unmeasured healing constants;
- unpriced parry, kill and creep heals;
- item tags;
- the narrow Hero Basket column.
