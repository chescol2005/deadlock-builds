# Milestone L: 3,200-soul items in the mid build

**Status:** CLOSED 2026-11-02 (PRs #150–#152). Approved the same day, with every
recommendation in §5 accepted as written. Per
"Testing Expectations", no engine or fixture change until these criteria are approved;
change this doc first if an expectation needs to change.

**Scope:** how the basket ranks picks in the mid and late phases (`rankingPrice`) and how
strictly the mid phase holds each shop's budget (`shopBudgetsFor`, the greedy loop) in
`lib/engine/basketSelect.ts`, the horizon passed in from `lib/engine/heroBasket.ts`, an
engine fixture for both, and the live guards they move. Follows Milestone K
(`docs/milestone-k.md` §5.2), which left Spirit Resilience and Berserker out of Lady
Geist's mid build as a known gap.

## 1. The problem

Lady Geists who rush Radiant Regeneration buy two 3,200-soul items in mid: Spirit
Resilience (57%) and Berserker (47%). The engine's mid build holds neither. It is not just
her. Across the eight reference heroes, real players put 57% of their mid souls into
3,200+ items, the engine 35% (list prices; real = the players who made the build's own
rush choice, `heroRushGroups.json`, 9–20 min):

| Hero          | Real 3,200+ share | Engine   | Engine mid build (\* = 3,200+)                                                                                                        |
| ------------- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Seven         | 43%               | 0%       | Mystic Vulnerability, Healbane, Spirit Lifesteal, Duration Extender, Arcane Surge, Fleetfoot, Sprint Boots, Rusted Barrel             |
| Lady Geist    | 54%               | 0%       | Kinetic Dash, Healing Booster, Fleetfoot, Enduring Speed, Arcane Surge, Compress Cooldown, Extra Health                               |
| Haze          | 65%               | 50%      | Fortitude\*, Enduring Speed, Bullet Resist Shredder, Burst Fire\*, Titanic Magazine, Slowing Hex                                      |
| Wraith        | 72%               | 80%      | Surge of Power\*, Swift Striker, Tesla Bullets\*, Dispel Magic\*, Extended Magazine                                                   |
| Infernus      | 52%               | 29%      | Spirit Lifesteal, Toxic Bullets\*, Mystic Vulnerability, Duration Extender, Enduring Speed, Improved Spirit                           |
| Abrams        | 64%               | 57%      | Bullet Resist Shredder, Hunter's Aura\*, Battle Vest, Enchanter's Emblem, Lifestrike\*                                                |
| Warden        | 48%               | 0%       | Fleetfoot, Enduring Speed, Quicksilver Reload, Bullet Resist Shredder, Arcane Surge, Titanic Magazine, Swift Striker, Improved Spirit |
| Deadman Danny | 56%               | 67%      | Improved Spirit, Reactive Barrier, Fortitude\*, Mystic Expansion, Express Shot\*, Tankbuster\*, Extra Stamina                         |
| **Mean**      | **0.57**          | **0.35** |                                                                                                                                       |

## 2. Diagnosis (2026-11-02)

Probe at Lady Geist's mid checkpoint (boon 22), owning the early build:

| Item              | Value | Per 1,000 souls | First-pick rank | Why it isn't picked                                      |
| ----------------- | ----- | --------------- | --------------- | -------------------------------------------------------- |
| Kinetic Dash      | 95.6  | 59.8            | 1               | picked                                                   |
| Healing Booster   | 72.6  | 45.4            | 2               | picked                                                   |
| Spirit Resilience | 83.6  | 26.1            | 8               | ranked per soul, it loses to six 1,600 items             |
| Berserker         | 66.8  | 20.9            | 13              | same; also over the gun shop's budget after Kinetic Dash |

Two mechanisms keep 3,200 items out:

1. **Every mid pick is ranked per soul.** `rankingPrice` charges an item its price, or the
   souls per free slot if that is higher. The mid basket has 11,100 souls for 8 slots
   (~1,390 per slot), below every 1,600 item, so the ranking is pure value per soul: a
   1,600 item needs only half the value of a 3,200 one. But a mid slot isn't spent for
   ten minutes. It is one of the build's 12 slots for the rest of the game, and by the
   late checkpoint (30,000 souls) those slots hold 3,200–6,400 items; a cheap mid item
   is sold at half price or keeps a slot from a bigger item. Real players weigh that; the
   engine prices the slot only at today's souls.
2. **Shop budgets are lumpy for 3,200 items.** Each shop may take its measured mid share
   of the souls plus 15% (`SHOP_BUDGET_SLACK`). After one 1,600 pick, a 3,200 item rarely
   fits what is left: Lady Geist's Spirit Resilience and Healing Booster don't both fit
   the vitality budget, and Berserker misses the gun budget by about 40 souls. Warden's
   mid budget blocks every 3,200 gun item.

### 2.1 The two items (data-verifier, 2026-11-02)

Live API and deadlock.wiki agree for both. The wiki shows no 2026-10-30 change to either.

- **Spirit Resilience:** +30% spirit resist (priced), +3 out-of-combat regen (priced as
  gap healing), and **+15% more spirit resist below 50% health (`TechResistBelowThreshold`),
  not priced.** It has no heal amp.
- **Berserker:** +8% bullet resist (priced), +7% weapon damage per stack, up to 10 stacks,
  one stack per 120 damage taken, for 10 s. The engine credits 5 stacks, then halves it
  (`EFFECT_CONFIDENCE`). That is a reasoned guess, more likely over- than under-stated, so
  Berserker's value is not the problem.

## 3. Candidate fixes, measured on a scratch change

Every row ran the full live harness and, where it got that far, the recorded builds.

- **Slot horizon:** rank a mid or late pick against the souls the build will have later,
  spread over the slots left, instead of today's souls only:
  `perSlot = (budget left + horizon souls) / slots left`.
  - The mid horizon is the late checkpoint (30,000 souls), at full strength or half.
  - The late horizon is a full build: boon 35, 49,200 souls (`BOON_THRESHOLDS`).
- **Overshoot:** a mid item may exceed its shop's budget by up to 25% of its price.
  Today the limit is 0%; the scratch code counts the item at 0.75 of its price against
  the budget.
- **Low-health resist:** price `TechResistBelowThreshold` at the conditional weight
  (0.4), as the engine prices other conditional stats.
- **Rushers' rates / split:** the mid popularity bonus, or the mid shop split, taken from
  the players who made the build's rush choice (`heroRushGroups.json`), when the build
  holds the rush item.

| Change                                             | M1 mean (≤ 0.13) | M3 (≤ 0.082) | O2 (≥ 0.702)        | P4 (≥ 37) | P5 (≥ 2) | K-L1     | 3,200+ mid share (real 0.57) | Lady Geist's mid build                                                                                  |
| -------------------------------------------------- | ---------------- | ------------ | ------------------- | --------- | -------- | -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Today                                              | 0.125            | 0.072        | 37 / 52 = 0.712     | 37        | 2        | held     | 0.35                         | Kinetic Dash, Healing Booster, Fleetfoot, Enduring Speed, Arcane Surge, Compress Cooldown, Extra Health |
| Low-health resist                                  | 0.125            | 0.072        | 0.712               | 36 ✗      | 2        | held     | 0.35                         | unchanged                                                                                               |
| Rushers' rates                                     | 0.128            | 0.083 ✗      | 0.750               | 36 ✗      | 2        | held     | 0.35                         | no 3,200 item                                                                                           |
| Rushers' / non-rushers' rates                      | 0.137 ✗          | 0.091 ✗      | 0.704               | 35 ✗      | 1 ✗      | held     | 0.30                         | no 3,200 item                                                                                           |
| Overshoot alone                                    | 0.154 ✗          | 0.106 ✗      | 0.780               | 37        | 1 ✗      | held     | 0.36                         | no 3,200 item                                                                                           |
| Mid horizon, full                                  | 0.127            | 0.071        | 0.848               | 34 ✗      | 2        | ✗        | 0.53                         | Kinetic Dash, Spirit Resilience, Surge of Power, Fleetfoot, Sprint Boots                                |
| Mid horizon half + overshoot                       | 0.124            | 0.071        | 0.891               | 34 ✗      | 1 ✗      | held     | 0.49                         | as in **A** below                                                                                       |
| Mid full + late + overshoot                        | 0.124            | 0.066        | 38 / 42 = 0.905     | 37        | 2        | ✗        | 0.60                         | Kinetic Dash, Spirit Resilience, Surge of Power, Fleetfoot, Sprint Boots                                |
| Same, overshoot 40%                                | 0.144 ✗          | 0.041        | 0.927               | 39        | 2        | held     | 0.64                         | Kinetic Dash, Spirit Resilience, Healing Booster, Surge of Power, Extended Magazine                     |
| Same + rushers' mid split                          | 0.138 ✗          | 0.045        | 0.929               | 37        | 2        | held     | 0.60                         | Kinetic Dash, Spirit Resilience, Healing Booster, **Berserker**, Extra Spirit                           |
| **A: mid horizon half + late horizon + overshoot** | **0.123**        | **0.071**    | **41 / 46 = 0.891** | **37**    | **1 ✗**  | **held** | **0.49**                     | **Kinetic Dash, Healing Booster, Spirit Resilience, Fleetfoot, Arcane Surge, Extra Spirit**             |

What the measurements show:

- **The slot horizon is the lever.** It is the only change that moves the mid build
  toward real play everywhere: O2 rises from 0.712 to 0.85–0.93, and M3 holds or falls.
- **Pricing the low-health resist doesn't help.** It changes no mid build and costs one P4
  item. Spirit Resilience was already valued well (8th of 151); the price per soul was the
  issue. Leave it for a later pricing pass.
- **The rushers' rates don't help either.** They lift O2 a little, but fail M3 and P4
  and bring in no 3,200 item.
- **The late horizon is needed.** With a mid horizon alone the late phase has more free
  slots and fills them with cheap items, losing three 6,400 items (P4 34). The same rule
  at the late phase, against a full build, restores P4 to 37.
- **Overshoot is needed, but only a little.** Without it, Warden's mid stays at 0% big
  items. At 40% or more, the chunkier builds drift from the measured gun / spirit /
  vitality split and fail M1.
- **Berserker conflicts with M1.** It only lands with the rushers' mid split, and then
  Lady Geist's mid build is 46 / 8 / 46 against the rushers' average 36 / 29 / 36, which
  fails M1. M1 compares a 5-item build with an average over thousands of players, so a
  build of few big items will always sit further from it.
- **A keeps Healing Booster and adds Spirit Resilience.** 5 of Lady Geist's 6 mid picks
  are in the rushers' top 10 (today 3 of 7). Warden's known M1 mid gap closes
  (0.42 → passes).
  - The full mid horizon matches the real big-item share better (0.60). But Lady Geist
    then drops Healing Booster (69%) for Surge of Power (26%), failing Milestone K's
    K-L1.
- **A's one regression is P5, 2 → 1.** Calico's Arctic Blast (6,400, a mid buy for
  ≥ 20% of Calico players) moves from mid to late. P5 counts 10 such items over 44
  heroes and is already a known gap (target 4).
- **Recorded builds:** A changes 52 of 72, the full-horizon row 53. This is expected for a
  change to how every mid and late pick is ranked. The PR body lists them by hero.
- **One limitation stays, for the record.** Real rushers spend about 13,700 souls in 9–20
  min, while the engine's mid checkpoint (16,700 souls cumulative, Work 2) leaves 11,100.
  This doc doesn't move the checkpoints.

## 4. Acceptance criteria (L1, if A is approved)

### 4.1 Engine

| ID  | Criterion                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-1 | **Slot horizon.** In the mid and late phases, an item's ranking price is never below `(souls left + horizon souls) / slots left`. The mid horizon is half the souls from this checkpoint to the late checkpoint (30,000). The late horizon is a full build, `BOON_THRESHOLDS` boon 35 (49,200). The early phase is unchanged (laning tempo still applies). Without a phase, the horizon is 0. |
| L-2 | **Mid overshoot.** In the mid phase only, a pick may exceed its shop's budget by up to 25% of its effective price. Early and late budgets are unchanged, and the second, shared pass is unchanged.                                                                                                                                                                                            |
| L-3 | The horizon comes from the phase and the checkpoints `heroBasket` already knows, passed in on the context (no new data, no rush-group read). Pure and deterministic. New constants are named and documented: `MID_SLOT_HORIZON_SHARE = 0.5` and `MID_SHOP_OVERSHOOT = 0.25`.                                                                                                                  |
| L-4 | The probe (`basketProbe.ts`) prints the horizon, so `npm run probe` and BuildClient still agree.                                                                                                                                                                                                                                                                                              |

**Engine fixture (synthetic):**

- In the mid phase with souls per slot below both prices, a 3,200 item worth 1.6× a
  1,600 item is picked first with the horizon, and second without it.
- The early phase is unaffected.
- A mid item 20% over its shop budget is allowed; one 30% over is not.
- Late and early budgets stay strict.

### 4.2 Live guards

| ID       | Criterion                                                                                      | Today                                  | After L1                                                     |
| -------- | ---------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| L-L1     | **New:** Lady Geist's starter mid phase holds Spirit Resilience                                | not held                               | held                                                         |
| L-L2     | **New:** mean 3,200+ share of the reference heroes' mid souls, against the same-choice group's | 0.35 (real 0.57)                       | ≥ 0.45                                                       |
| K-L1     | Lady Geist's starter mid phase holds Healing Booster                                           | held                                   | held                                                         |
| O2       | Mid picks in the same-choice group's mid top 10                                                | ≥ 0.712                                | **raise baseline to the measured 0.891**                     |
| M3       | Mid-phase overlap between heroes                                                               | ≤ 0.072                                | ≤ 0.072 (0.071)                                              |
| M1       | Mean split distance; Warden mid                                                                | ≤ 0.13 (0.125); Warden mid a known gap | ≤ 0.13 (0.123); **remove Warden mid from `KNOWN_LEAN_GAPS`** |
| P4       | 6,400+ items in the real late top 3, held late                                                 | ≥ 37                                   | ≥ 37 (37)                                                    |
| P5       | 6,400+ mid buys held by the mid phase                                                          | floor 2                                | **floor lowered to 1** (Calico's Arctic Blast moves to late) |
| Baseline | Recorded builds                                                                                | 72 unchanged                           | the 52 changes accepted, listed in the PR body               |

Unchanged: the hard rules H1–H9, P1, P2, P6, the other leans and ratchets.

## 5. Open questions for sign-off

Each carries a recommendation; approving the doc as written accepts them.

1. **Fix.** **Recommendation:** A (half mid horizon, late horizon, 25% mid overshoot).
   - The full mid horizon fits the real big-item share better (0.60 vs 0.49). But it drops
     Healing Booster, Lady Geist's most-bought mid item, which Milestone K just added.
2. **Berserker.** **Recommendation:** leave it as a known gap. It needs the rushers' mid
   shop split, which puts the engine in a rush-group read it doesn't have today and fails
   M1 for Lady Geist. Revisit if M1 is ever changed to compare per-player builds, not the
   average.
3. **P5 floor 2 → 1** (Calico's Arctic Blast moves from mid to late). **Recommendation:**
   accept. Arctic Blast is still in Calico's build, P5 was already a known gap, and the
   mid build gains far more (O2 +0.18).
4. **52 of 72 recorded builds change.** **Recommendation:** accept, reviewed hero by hero
   in the L1 PR body.
5. **Spirit Resilience's low-health resist stays unpriced.** **Recommendation:** leave it
   for a later pricing pass. Priced alone it changes nothing in mid and costs a P4 item.

## 6. Work items

| PR  | What                                                                                                                                                                 | Kind   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| L0  | This doc (sign-off)                                                                                                                                                  | docs   |
| L1  | Slot horizon and mid overshoot; engine fixture; L-L1, L-L2; O2 → 0.891, Warden mid off the known gaps, P5 floor → 1; 52 baselines accepted; probe prints the horizon | engine |
| L2  | Close: engine design notes ("Ranking by value per binding resource" and "Spend like real players" updated, new section), CLAUDE.md follow-ups, session record        | docs   |

## 7. Results

### L1: slot horizon and mid shop overshoot (2026-11-02, PR #151)

- **As measured in §3, row A.** The shipped horizon depends on the souls
  (`slotHorizonSouls`), not a fixed number, and gives the same values at the checkpoints.
  Every live number matched the scratch run.
- **Live:**
  - L-L1 passes (Spirit Resilience in Lady Geist's mid build, with Healing Booster);
  - L-L2 0.49 ≥ 0.45 (real 0.57);
  - O2 41 / 46 = 0.891 (new baseline), M3 0.071, M1 mean 0.123;
  - Warden mid passes (off `KNOWN_LEAN_GAPS`), P4 37, P5 1 (new floor).
- **Engine fixture §35:**
  - horizon values and gating;
  - the 3,200 vs 1,600 order with and without the horizon;
  - overshoot at 23% (fits) and 28% (doesn't) of the price, early and late strict;
  - the overshoot note.
- **Baselines:** 52 of 72 changed, every mid and late basket and 7 starter builds; none
  in the early phase. Accepted.
- **`scoring-auditor`:** no blockers. Fixed on its review:
  - an overshooting pick now carries a zero-value `shop-budget` note;
  - unknown souls give no horizon;
  - the sweep comment says only 0.25 and 0.4 were measured;
  - the probe's early tempo uses `ctx.laningSouls`, an existing mismatch.

  Recorded as a known limit: the late horizon is calibrated only at the 30,000
  checkpoint, and slider 22 → 23 switches from the mid to the late horizon (engine
  design notes, "Slot horizon and mid overshoot").
