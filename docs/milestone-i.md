# Milestone I: rush-item value

**Status:** APPROVED 2026-10-31, with every recommendation in §6 accepted as written. Per "Testing Expectations", no
engine code changes until these criteria are approved; change this doc first if an
expectation needs to change.

**Scope:** `phaseItemTerm` in `lib/engine/basketSelect.ts` (how much "players on this
hero buy it now" is worth), the starter build and `/build` hero basket that use it, their
fixtures and baselines. Follows Milestone H (`docs/milestone-h.md` §7), which left real
early rushes at 1 / 24 and named the value model as the cause.

## 1. The problem

Milestone H let the basket save up for a big item when the plan built around it is worth
more. Real early rushes still almost never win: every rush plan is worth 7–40% less than
the cheap-items plan (Seven: 294 against 361). Milestone H put this down to the value
model rating cheap basics close to one rush item. The diagnosis below finds the exact
cause.

## 2. Diagnosis (2026-10-29)

All 24 real early rushes (3,200+ items bought in the first 10 minutes by at least 20% of
a hero's Oracle+ players), early phase (5,900 souls), empty build, live data. Each
item's value on an empty build, split by term:

| Term                    | Rush item (mean of 24) | Typical first basic pick |
| ----------------------- | ---------------------- | ------------------------ |
| Coverage (hero's needs) | 42                     | 10–27                    |
| Phase item (population) | 48                     | 100–113                  |
| Total                   | 96 (3,200 souls)       | 113–150 (800 souls)      |

- **The hero's own needs value a rush item fairly.** Coverage per 1,000 souls is about
  even: Cultist Sacrifice 14.8 (47.5 per 3,200), Monster Rounds 13.6 (10.9 per 800), for
  Seven.
- **The population term is flat per item.** It is
  `PHASE_ITEM_WEIGHT × slot scale × (buy rate − 10%)`, whatever the item costs. Monster
  Rounds (Seven's most bought early item) gets +113; Cultist Sacrifice (55% of Seven
  players) gets +67.
- **That flat bonus decides both the ranking and the plans.** Picks are ranked by value per
  soul, so an 800-soul item's bonus counts four times as much per soul. A plan of four
  basics collects four bonuses against the rush plan's one.
- **So what the term rewards is buying the same items as real players, not spending
  souls like them.** The fidelity checks (P2, the shop budgets) already measure
  spending in souls.

## 3. Approach: cost-scaled population value

Scale the positive part of `phaseItemTerm` by the item's price relative to what this
hero's players typically pay per item in this phase:

```
value = PHASE_ITEM_WEIGHT × slot scale × (rate − PHASE_ITEM_BASELINE) × (cost / refCost)^α
refCost = Σ rate × cost / Σ rate   over this hero's listed items in this phase
```

- **`refCost`** is the average price of what this hero's players buy in this phase. An
  item at that price keeps today's value. Cheaper items get less, pricier items more. The
  term's overall size per phase stays about the same, and it is measured, not a constant.
- **`α`** sets how strongly cost counts. At 0 the term is exactly today's; at 1 it is
  proportional to souls. I2 sweeps α (0, 0.25, 0.5, 0.75, 1) with `PHASE_ITEM_WEIGHT`
  (today's 2 and a few around it) and ships the best setting that passes every guard.
- **The penalty side stays as it is** (rarely bought: capped at half the item's coverage).
  Only items the hero's players actually buy gain, so a rush comes only where real players
  rush.
- **Upgrades price at their effective cost** (what the player pays after the component),
  the same price the ranking uses.

Why this approach:

- **It fixes the measured cause** and leaves the parts that work alone: coverage, the
  anchored plans and the shop budgets.
- **No new data and no new term.** It uses the same buy-rate table, and the same
  determinism and explainability.
- **It is one parameter from today.** α = 0 is the current engine, so the sweep shows the
  trade-off exactly.

Rejected alternatives:

- **Hand-pricing each rush item's effect.** The diagnosis shows coverage is already about
  even per soul. It would be 9 items of guesswork for no measured gap.
- **A "measured rush" bonus on top.** This adds a second population term next to one that
  is already mis-shaped.
- **Lookahead or slot costs.** Measured and rejected in Milestone H.

## 4. Acceptance criteria

### 4.1 Targets (Milestone H's, carried over; the milestone closes when they pass)

| ID  | Criterion                                                                                  | Today   | Target    |
| --- | ------------------------------------------------------------------------------------------ | ------- | --------- |
| P1  | Real early rushes held at the early phase                                                  | 1 / 24  | ≥ 12 / 24 |
| P2  | Heroes within 15 points of real early share in 3,200+ items (both directions)              | 22 / 44 | ≥ 33 / 44 |
| P3  | The reference T1 known gaps (Seven, Lady Geist, Wraith) pass, and leave the known-gap list | 0 / 3   | ≥ 2 / 3   |
| P4  | Late tier-4 in the real top 3, held by the late phase                                      | 26 / 52 | ≥ 32 / 52 |
| P5  | Mid 6,400+ items (≥ 20% of players), held by the mid phase                                 | 2 / 10  | ≥ 4 / 10  |

### 4.2 Guards (pass today; must still pass)

- **No false rushes (new, P6).** Count the early 3,200+ picks that fewer than 10% of the
  hero's players buy early, over all 44 heroes. It must not rise above today's count
  (measured in I1). P2 already fails heroes that rush when their players don't.
- **Hard rules H1–H9** (`docs/starter-build-use-cases.md`) and the leans L1–L6.
- **Fidelity ratchets:** M1 phase checks stay 24 / 24; mean L1 to real play ≤ 0.12;
  O1 8 / 8; O2 ≥ 0.816 and M3 ≤ 0.077 (each within the 0.01 live noise band).
- **Baselines:** every changed baseline basket is reviewed in the PR body.
- **Speed:** unchanged in kind. The reference price is one sum per phase.

### 4.3 Explainability

- The phase-item reason keeps saying what share of players buy the item. It stays
  population data, so it never headlines. A rush still headlines "Worth saving up for"
  (Milestone H3).
- The veteran breakdown shows the price factor, e.g. "55% of Oracle+ players on this hero
  buy it in the first 10 minutes (×1.9 for its price)".

## 5. Work items

| PR  | What                                                                                                 | Kind     |
| --- | ---------------------------------------------------------------------------------------------------- | -------- |
| I0  | This doc (sign-off)                                                                                  | docs     |
| I1  | Fixtures first: P6 false-rush counter in the known-gap ratchet; engine unit cases for the cost scale | fixtures |
| I2  | The cost-scaled term, α × weight sweep, baselines diff, probe updated; `scoring-auditor`             | scoring  |
| I3  | Close: engine-design-notes.md, C5 / C6 resolved or re-accepted, CLAUDE.md, session record            | docs     |

## 6. Open questions for sign-off

Each carries a recommendation; approving the doc as written accepts them.

1. **Reference price.** The rate-weighted average price of this hero's purchases in this
   phase. **Recommendation:** yes. It is measured per hero, and an average-priced item
   keeps today's value.
2. **Penalty side unchanged.** **Recommendation:** yes. Cost-scaling the penalty would
   punish rarely bought big items twice (they already rank low per soul).
3. **Choosing α and the weight.** **Recommendation:** pick the setting that passes every
   guard with the most P1 + P2. Record the full sweep in §7, as Milestone H did.
4. **If no setting reaches the targets without breaking a guard.** **Recommendation:**
   ship the best guard-passing setting if it improves P1 or P2. Otherwise ship nothing
   and record the numbers, as the lookahead was in H.
