# Milestone H: planned big items

**Status:** APPROVED 2026-10-28, with every recommendation in §6 accepted as written.
Per "Testing Expectations", no engine code changes until these criteria are approved;
change this doc first if an expectation needs to change.

**Scope:** `lib/engine/basketSelect.ts` (how a phase's basket is chosen), the starter
build and the `/build` hero basket that both use it, their fixtures and baselines, and
the plain-English reason a big pick shows. Follows the item scoring review's accepted
gaps C5 and C6 (`docs/item-scoring-review.md` §2.2).

## 1. The problem

The basket picks greedily by value per soul (or per slot when slots bind). That made
early builds look like real play (800-soul basics first), but a greedy per-soul pick can
never **save up**. A 3,200-soul item that is worth more than three 800-soul items, yet
less per soul, is never bought early. C5 tried exempting rush items from the laning tempo
and the shop cap: it changed nothing, because the cheap items still win first and the
souls are gone by the time the big item is considered.

## 2. Measured gap (step 0, 2026-10-28)

`buildStarterBuild` for all 44 heroes, empty build, against each hero's real Oracle+
buy rates (`heroPhaseItems.json`, last 30 days):

| Check                                                                                    | Today      |
| ---------------------------------------------------------------------------------------- | ---------- |
| Early rush: real 3,200+ items bought early by ≥ 20% of players, held at the early phase  | **0 / 24** |
| T1 on all heroes: engine's early share of souls in 3,200+ items within 15 points of real | 22 / 44    |
| Engine's early share in 3,200+ items, any hero                                           | 0% for all |
| Mid: 6,400+ items bought in mid by ≥ 20%, held by the mid phase                          | 1 / 10     |
| Late: 6,400+ items in the hero's real late top 3, held by the late phase                 | 21 / 52    |

- **Early rushes** missed most: Radiant Regeneration (Baba, Celeste, Lady Geist, Shiv,
  Violet, Yamato), Cultist Sacrifice (Billy, Pocket, Rat King, Seven, Venator), Rapid
  Recharge (Holliday, Sinclair, Vindicta), Tesla Bullets (Graves, Ivy, Wraith), Torment
  Pulse (Mo & Krill, Victor), Headhunter (Bebop, Paradox), Sharpshooter (Grey Talon,
  Paradox), Express Shot (Viscous). Real early shares in 3,200+ items run up to 36%.
- **Late tier-4** missed most: Boundless Spirit (5 heroes), Unstoppable (4), Ricochet (4),
  Divine Barrier, Mercurial Magnum, Spirit Burn, Siphon Bullets, Spiritual Overflow
  (2 each), and others.
- The three reference heroes in the known-gap list (T1: Seven, Lady Geist, Wraith) are
  three of the 22 heroes failing T1.

## 3. Approach: compare anchored plans

For each phase, after today's greedy basket is built:

1. **Anchor candidates.** Take the few unowned big items (early: cost ≥ 3,200; mid and
   late: ≥ 6,400) with the highest value for this hero by today's terms, at most
   `ANCHOR_CANDIDATES` (proposed 4).
2. **Anchored plans.** For each candidate, build the basket with that item bought first
   (its cost reserved), then fill the rest with today's greedy loop.
3. **Choose.** Keep the plan with the highest total value. An anchored plan replaces the
   greedy one only if it beats it by more than `ANCHOR_MARGIN` (proposed 5%), so small
   value differences never flip a build.
4. **Explain.** The anchored pick carries a plain reason: "Worth saving for: more value
   than the cheaper items it replaces."

Why this approach:

- **It plugs into today's loop.** Every rule that holds for a greedy basket (budget,
  slots, components, terms) holds inside each plan, because each plan is a greedy basket.
- **It stays deterministic and explainable.** A fixed candidate list, a total order on
  ties, and a recorded reason.
- **It is cheap.** At most 5 greedy runs per phase.

Rejected alternatives:

- **Rank by raw value.** This was the original loop: big all-rounders won every early
  pick, the opposite failure (coverage-model PR 1).
- **An exact knapsack.** The terms are not additive (coverage saturates, pairs interact),
  so an exact solver would need a different value model.
- **Hand-listed rush items per hero.** This is not tied to the hero's kit, and it goes
  stale with every patch.

**Total value** of a plan is the sum of its picks' marginal values, as the greedy loop
already computes them. A risk to check in step 3: per-pick bonuses capped per slot
(phase items, analytics) favour plans with more items. If that keeps anchors from ever
winning, the comparison uses coverage value only and records why.

## 4. Acceptance criteria

### 4.1 Targets (fail today; the milestone closes when they pass)

| ID  | Criterion                                                                                  | Today   | Target    |
| --- | ------------------------------------------------------------------------------------------ | ------- | --------- |
| P1  | Early rush held at the early phase (the §2 definition)                                     | 0 / 24  | ≥ 12 / 24 |
| P2  | T1 on all heroes (within 15 points of real early share in 3,200+ items, both directions)   | 22 / 44 | ≥ 33 / 44 |
| P3  | The reference T1 known gaps (Seven, Lady Geist, Wraith) pass, and leave the known-gap list | 0 / 3   | ≥ 2 / 3   |
| P4  | Late tier-4 in the real top 3, held by the late phase                                      | 21 / 52 | ≥ 32 / 52 |
| P5  | Mid 6,400+ items (≥ 20% of players), held by the mid phase                                 | 1 / 10  | ≥ 4 / 10  |

### 4.2 Guards (pass today; must still pass)

- **Hard rules H1–H9** (`docs/starter-build-use-cases.md`): the soul budget, never an
  item and its own component in one phase, every pick has a reason, same input gives the
  same build, later phases build on earlier ones.
- **No false rushes.** P2 counts both directions: a hero whose real players don't rush
  must not start rushing.
- **Fidelity ratchets:** M1 phase checks stay 24 / 24; mean L1 to real play ≤ 0.12;
  O1 8 / 8; O2 ≥ 0.816 and M3 ≤ 0.077 (each within the 0.01 live noise band).
- **Baselines.** Every changed baseline basket is reviewed in the PR body
  (`npm run baseline`), and accepted with `--update`.
- **Leans.** Spirit heroes still lean spirit, gun heroes gun (L1–L6).
- **Speed.** A starter build for one hero stays fast enough for the planner: measured
  before and after, at most 3× today's time.

### 4.3 Explainability

- An anchored pick's reason says it was worth saving for, in plain English, and the
  simplified view headlines it (`headlineTerm`).
- The coach's "next buy" tip reads the same plain line, so it explains a rush with no
  coach change.

## 5. Work items

| PR  | What                                                                                                     | Kind      |
| --- | -------------------------------------------------------------------------------------------------------- | --------- |
| H0  | This doc (sign-off)                                                                                      | docs      |
| H1  | Fixtures first: P1–P5 as live fixtures in the known-gap ratchet (failing keys listed), engine unit cases | fixtures  |
| H2  | Anchored plans in `basketSelect.ts`, the probe mirrored, baselines diff, live sweep; `scoring-auditor`   | scoring   |
| H3  | The "worth saving for" reason in the starter build and basket panels                                     | UI (text) |
| H4  | Close: engine-design-notes.md section, C5 / C6 resolved or re-accepted, CLAUDE.md, session record        | docs      |

## 6. Open questions for sign-off

Each carries a recommendation; approving the doc as written accepts them.

1. **Targets.** Half the early rushes (P1 ≥ 12 / 24), not all: some real rushes are
   matchup or skill choices the kit can't see. **Recommendation:** the targets in §4.1.
2. **Margin.** An anchored plan must win by more than 5%. **Recommendation:** 5%, tuned
   once in H2 and recorded.
3. **New players.** Rushing is a little riskier to execute. **Recommendation:** the same
   build in both views; the reason line explains the plan. A "safe" variant belongs to
   M7's Safe template.
4. **Scope of candidates.** Early 3,200+, mid and late 6,400+, top 4 by value.
   **Recommendation:** as stated.
5. **If P4 or P5 can't reach target without breaking a guard.** **Recommendation:** ship
   what passes the guards, record the rest as accepted gaps with the measured cost, as C5
   did.

## 7. Results

### H2: anchored plans (2026-10-28)

Shipped as designed (4 candidates, 5% margin), after a live sweep on all 44 heroes:

| ID  | Before  | After H2 | Target |
| --- | ------- | -------- | ------ |
| P1  | 0 / 24  | 1 / 24   | 12     |
| P2  | 22 / 44 | 22 / 44  | 33     |
| P4  | 21 / 52 | 26 / 52  | 32     |
| P5  | 1 / 10  | 2 / 10   | 4      |

- **Guards:** all pass. 2 of 72 baselines change, both late phases, both toward real
  play: Haze now ends with Siphon Bullets, Wraith with Ricochet. A starter build takes
  ~39 ms against ~27 ms with anchors off (1.45×, inside the 3× guard).
- **Late ceiling of this approach:** 8 or 12 candidates and no margin reach only 27 / 52.
- **Why early rushes don't come:** in the engine's own value model the rush plan is worth
  less. Seven early: seven basics 361, Cultist Sacrifice plan 295. Saving 3,200 souls
  leaves room for three more items, and the basics add up to more.
- **A slot cost in the comparison was tried and rejected.** Charging each plan a share of
  the greedy value per item for every slot it uses: at the strength where rushes start
  (f = 0.5) it matched 4 / 24, picked the wrong item (Seven: Rapid Recharge, not Cultist
  Sacrifice) and started rushing heroes whose players don't (1 false rush, 7 at f = 0.75).
  The kit model has no signal for WHICH big item a hero's players rush.
- **User decision (2026-10-28):** ship the anchored plans, then try a deeper model: value
  an early plan by its effect on the whole build (early to late), since a rush item stays
  while early basics are later sold or consumed. Floors raised to P1 1, P4 26, P5 2.
