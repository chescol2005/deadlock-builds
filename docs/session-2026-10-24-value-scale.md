# Session record 2026-10-24: the value-scale stack, and the plan from here

**Scope:** the work between coverage PRs 1+2 (#91, #92) and the "Start from a suggested
build" UI (Work 2d). It landed as three stacked PRs, #94 ← #95 ← #96, merged to `main` at
`3d9d6b4`. The design record is in
`.claude/skills/scoring-engine-dev/engine-design-notes.md` (sections "Hero-relative damage
and soft saturation", "One value scale", "Spend like real players" and "What players on
this hero buy"). The measured results are in `docs/starter-build-use-cases.md` §5.7.

## 1. The problem

After coverage PRs 1+2 the starter build passed 11 of the 24 M1 phase checks (the
gun / spirit / vitality mix per hero and phase, compared with real Oracle+ play). Early
builds looked alike across heroes (M2 failed), and mid builds overlapped heavily (M3:
0.373). Item values lived on different scales: gun damage, spirit damage, health and
utility were each scored in their own units, so the basket could not trade them off
fairly.

## 2. What was tried, in order

| Step                         | Idea                                                                                        | Outcome                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Soft saturation (alone)      | Coverage saturates (`T(1 − e^(−c/T))`) instead of a hard cap                                | Rejected on its own: no gain without a shared value scale. Kept as part of the scale |
| Hero-relative damage (alone) | Price damage in % of the hero's own DPS                                                     | Superseded by the full scale (prototype branch deleted; commit `79db9fd`)            |
| One value scale              | Every stat and effect in % of the hero's fight value in a 10 s trade                        | Level with `main` alone (M1 12/24), but it made the next steps possible              |
| Split-guided shop budgets    | Each shop gets its measured phase share of the souls (+15% slack); unused souls are pooled  | M1 24/24 with the scale                                                              |
| Laning tempo (user's point)  | In the laning phase only, an item's ranking price grows with its share of the phase's souls | Keeps 3,200 rushes out of lane                                                       |
| Phase items                  | Capped signal from what Oracle+ players on this hero buy per phase                          | Real-top-10 overlap: early 18 → 42 picks, mid 3/50 → 37/53                           |
| Upgrade credit               | Credit an early item for the upgrade it leads to                                            | Dropped: the phase-item signal already covered it                                    |

## 3. What shipped

- **#94, one value scale.** `heroDamage.ts` (damage through the hero's own weapon and kit,
  casts per trade) and `heroFight.ts` (health, resist, barrier, healing, CC, mobility,
  economy). +1% effective HP is worth +1% DPS; the rest uses named exchange rates. Every
  effect estimate carries a `unit` and a `quantity`. `Item.innateStats` separates
  always-on stats from conditional ones. Coverage saturates, and `coversNeed()` gates
  relevance at 2% of one slot.
- **#95, spend like real players.** Shop budgets (increment basis for the early / mid
  purchase splits, cumulative for the final split), laning tempo, and
  `StarterPhase.buyOrder` (cheapest first, components before their upgrades).
- **#96, what players on this hero buy.** `heroPhaseItems.json` (written by
  `npm run fit-category-split`), `phaseItemTerm` (relevance-gated bonus, a penalty capped
  at half the coverage gain), live fixtures O1 / O2 / T1, and the ratchet update.

### Bugs found and fixed along the way

- "Outgoing damage penalty" is the buyer's own drawback (Golden Goose Egg, Cursed Relic)
  unless the item applies it as a timed debuff (Inhibitor, Haunting Shot).
- The headshot bonus is flat damage per cooldown, not a percentage.
- Melee Lifesteal heals once per cooldown, not on every hit.
- Wraith's Card Trick was counted at 75 damage per second.
- Burst Fire's always-on fire rate was discounted as if it were conditional.
- Audit, blocking: a hero with unknown health valued all defence at 0. Now the survival
  model is set only when health and move speed are known.
- Audit, correctness: budgets ignored owned items in the late phase, and the
  "rarely bought" penalty could stop a basket early. Both are fixed and covered by engine
  fixtures section 24.

## 4. Results (live, Fixture 13)

| Measure                                  | Before (`main` after #92) | After the stack                       |
| ---------------------------------------- | ------------------------- | ------------------------------------- |
| M1 phase fidelity                        | 11 / 24                   | **24 / 24**                           |
| M2 early builds differ across heroes     | ❌                        | ✅                                    |
| M3 mid overlap (lower = more varied)     | 0.373                     | **0.093**                             |
| Mean L1 distance to real play            | 0.336                     | **0.108**                             |
| O1 early picks in the hero's real top 10 | 18 without the signal     | **42** (8 / 8 heroes pass)            |
| O2 mid picks in the hero's real top 10   | 3 / 50 without the signal | **37 / 53**                           |
| T1 laning tempo                          | —                         | 5 / 8 (Seven, Lady Geist, Wraith gap) |

Gates at merge: app mini 295 / 0, engine mini 309 / 0, and prettier, tsc, eslint and
`next build` all clean.

## 5. Known gaps, left for the item scoring review

- Seven, Lady Geist and Wraith really do rush one 3,200 item early. The shop budgets
  defer it to the next phase (T1 known gaps).
- The phase stat profile (`applyStatProfile`) is still in the old units.
- A few stat keys still use heuristic weights in hero mode.
- Haze's mid phase misses Surge of Power.
- M1 keys near the 0.30 bar are noisy.
- O1 / O2 are measured against the same table `phaseItemTerm` reads. Fixture 13 logs the
  no-signal numbers so the signal's contribution stays visible.
- The basket is computed client-side and has not been checked in a browser yet (Work 2d
  task 5 closes this).

## 6. Execution plan

Each work item gets the usual flow: the plan is approved first, then branch, gate
(prettier → tsc → eslint → next build → mini), PR with the mini output in the body,
wait for CI, merge, delete the branch. Opus orchestrates. Scoring PRs and UI / AI PRs
stay separate.

### Work 2d: "Start from a suggested build" (approved 2026-10-24)

| #   | Task                    | Who (model)                    | What                                                                                                                                                                                                                                                                  |
| --- | ----------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Apply helper (pure)     | Opus                           | `StarterBuild` → build items + per-item phase / active. Keeps owned items, drops components consumed by upgrades, makes early items active up to 12, and puts later items in the game plan. App fixtures cover these rules, determinism and the share-link round trip |
| 2   | Shared reason helper    | Opus                           | Move the headline-reason choice (population terms are never the headline) out of `HeroBasketSuggestion` so both panels share it                                                                                                                                       |
| 3   | `StarterBuildPanel.tsx` | `panel-builder` (Sonnet)       | Presentational. Early / Mid / Late columns in buy order, a reason per item (one line simplified, term breakdown advanced), consumed components, the apply button, and an inline overwrite confirm. Joins Fixture 9's lists                                            |
| 4   | Wire into `BuildClient` | Opus                           | `useMemo` on `buildStarterBuild` with the live basket's inputs. Apply sets items and phases and moves the boon slider to the late checkpoint (30,000 souls)                                                                                                           |
| 5   | Browser check           | Opus (`/run` skill)            | Haze, Abrams and Lady Geist at desktop and phone widths: reasons render, the share link reproduces the build, the confirm appears after an edit. Kill the server afterwards                                                                                           |
| 6   | Review + ship           | `/code-review` high, then Opus | Gate, PR, CI, merge                                                                                                                                                                                                                                                   |

Defaults: preview, then apply (not a one-click fill), and the slider moves to the late
checkpoint on apply.

### Work 3: per-page metadata / OG images (rec. 2) + mobile pass on `/build` (rec. 3)

This will be planned in detail when 2d lands. Expected shape: per-route `generateMetadata`
and OG images (a hero image plus the build summary for `/build/[heroId]`), with
integrity fixtures that every page exports metadata; then a phone-width pass on `/build`,
checked in a browser.

### Item scoring review (closes Milestone F)

This will be planned in detail after Work 3. Expected shape:

1. Refresh data if over a month old: `npm run fit-pairs`, `npm run fit-category-split`,
   the synergy report (private artifact only), and `data-verifier` on `boonSystem.ts`
   and `abilityCoefficients.ts`.
2. Recorded baseline baskets for the reference heroes × soul levels, so any scoring
   change shows up as a reviewed diff.
3. Work through section 5's gaps: convert the phase stat profile to the value scale,
   replace the heuristic stat weights, look at real 3,200 rushes and Haze's Surge of
   Power.
4. Review the `lib/scoring/` path (`scoreItems`, goal weights, anti-synergy) the same way.
5. `scoring-auditor` on the result, then mark F ✅ in CLAUDE.md and delete the reminder.
