# Item scoring review: findings and acceptance criteria

**Status:** APPROVED 2026-10-25. This review gates closing Milestone F
(CLAUDE.md, "item scoring review gates closing Milestone F"). Per "Testing
Expectations", no scoring code changes until these criteria are approved; change this
doc first if an expectation needs to change.

**Scope:** both suggestion paths. `lib/engine/` covers the hero basket and the starter
build: terms, need vector, item adapter, effect estimates and value scale. `lib/scoring/`
covers `scoreItems`, goal weights and anti-synergy.

## 1. Phase 0 findings

### 1.1 Game data and constants (data-verifier, 2026-10-25)

- **Unchanged:** `BOON_THRESHOLDS` (all 36 rows; API `level_info` on heroes 1, 6 and 13
  shows 0 diffs), ability-slot unlocks, the ultimate unlock and ability tier costs
  1 / 2 / 5. Patches 08-12, 08-22, 09-16 and 09-29 (through the 10-14 minor update) don't
  touch them. Only the citation date in `lib/boonSystem.ts` is stale.
- **Latest patch:** 09-29-2026. Every engine-relevant item change in the retrievable
  notes already matches the live API. The full 09-29 item changelog (the "City Never
  Sleeps" page) could not be retrieved, so items added or removed on 09-29 are unverified.
- **Stale guide data (not scoring):** the 09-16 patch raised lane bounties.
  `lib/lanes/laneData.ts` still has Guardian 1,250 and Walker 3,500; the wiki shows
  1,375 and 3,675.
- **Stale comments:** `effectEstimator.ts` cites Cultist Sacrifice `BonusSoulsPct` 180
  (the patch made it 170; the code reads the live value). CLAUDE.md names
  `PROPERTY_LABELS`, which moved to `STAT_PROPERTY_LABELS` in `lib/statLabels.ts`.

### 1.2 Data tables

| Table                    | Before                 | Refit                  | Change                                                                                                   |
| ------------------------ | ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `heroCategorySplit.json` | 30 days, 09-21 → 10-21 | 25 days, 09-30 → 10-25 | Median hero split moves 0.5 pts, largest 3.6                                                             |
| `heroPhaseItems.json`    | 30 days, 09-24 → 10-24 | 25 days, 09-30 → 10-25 | Same fitter run                                                                                          |
| `pairLiftTable.json`     | 90 days, 07-21 → 10-19 | **kept**               | Post-patch only, it keeps 248 pairs for 13 heroes (now 3,624 for 40). 5 reference heroes would have none |

The refit alone pushes two live ratchets over their bars: M3 is 0.096 against a baseline
of 0.095, and O2 is 0.679 against 0.69. That is data noise, not a scoring change (see
§2.1).

### 1.3 Engine bugs found (verified in code)

Ordered by impact.

1. **Damage-per-second abilities are priced as per-cast damage.**
   - `abilityDps` (`heroDamage.ts`) multiplies the parsed damage by casts per trade.
   - For abilities whose damage property is a DPS (Seven Lightning Ball 75 and Storm
     Cloud 95, Abrams Siphon Life 22), one cast deals DPS × duration. They are
     undervalued by the duration factor.
   - These are the main damage abilities of the reference spirit caster and the tank.
2. **Damage upgrades are mostly ignored.** `calculateAbilityDamage` applies an upgrade
   only when its key is exactly `Damage`. That misses `DPS` (Lightning Ball T3, Storm
   Cloud T3, Siphon Life T3), `DamagePerChain` (Power Surge) and `ProcDamage` (Haze
   Fixation). This also changes the numbers `AbilityLevelingPanel` shows.
3. **Weapon modifiers are read as spirit base damage.** Haze Bullet Dance
   (`WeaponDamageBonus` 7) is classed as spirit damage 7. Haze Fixation
   (`DamageBonusFixedPerStack` 0.2) is classed as a 0.2-damage weapon ability.
4. **Mystic Reverb is a permanent +50% amp.** `TechDamagePercent` multiplies all ability
   damage by 1.5. It is actually a proc: 50% of one imbued ability's first hit, on a
   6.25 s cooldown.
5. **Four stat keys use heuristic weights.** Each needs its own valuation:

   | Key                              | Items                        | Plan                                                                                                                           |
   | -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
   | `BonusMeleeDamagePercent`        | 6 shop items                 | % × a named melee-share-of-trade constant. Count it only when innate; Colossus gets 7 / 37 uptime (it's on the active).        |
   | `MaxHealthDamage`                | Mystic Reverb only           | Inert (0). It isn't in the tooltip or on the wiki, so it's unconfirmed. The item's real effect is item 4.                      |
   | `MagicIncreasePerStack`          | Escalating Exposure          | Multiplicative amp on ability DPS: about 7 average stacks (≈ 31%) over a trade, capped by how many spirit hits the hero lands. |
   | `BonusSpiritForChargedAbilities` | Extra Charge, Rapid Recharge | Per hero: the bonus applies only to abilities with charges. It's 0 for Haze and Abrams; 27 of 42 heroes have one.              |

6. **Without weapon data, the old readings remain.** That path still uses the old
   readings of the flat headshot bonus, Kinetic Dash's timed fire rate and Melee
   Lifesteal's once-per-cooldown heal. All three readings are confirmed against live text.

### 1.4 Known gaps carried in

- The phase stat profile is in the old units.
- Real early 3,200 rushes on Seven, Lady Geist and Wraith (T1 known gaps).
- Haze's mid phase misses Surge of Power.
- M1 checks near the 0.30 bar are noisy.
- O1 and O2 read the table the term is tuned on.
- `scoreItems` is hero-unaware and its reasons are generic.

## 2. Acceptance criteria

### 2.1 Baselines and noise (PR R1, no scoring change)

**Done 2026-10-25 (R1).** 77 baseline cases on inputs captured 2026-10-25 (patch
09-29-2026). Post-patch ratchets: M3 0.096, O2 0.679 (36 / 53), mean L1 0.113. The gate
was checked by setting `PHASE_ITEM_WEIGHT` to 0, which changed every Abrams basket. Doubling
`LANING_TEMPO` changed **no** baseline: at these checkpoints the shop budgets already
exclude what tempo would. That matters for C5.

- **Frozen inputs.** `npm run capture-inputs` writes one pinned snapshot of the live
  inputs to `lib/engine/__fixtures__/frozen/`. It covers items, the 8 reference hero
  kits, analytics, accuracy and the three tables.
- **Baselines.** Recorded on those inputs and committed, rewritten only by
  `npm run baseline -- --update`:
  - the hero basket for the reference heroes × boon 5 / 10 / 16 / 22 / 29 × (empty, owns
    the starter's early phase);
  - the starter build;
  - the `scoreItems` top 5 per goal.
- **Gate.** The engine harness diffs against the baselines. Every scoring PR states its
  diff in the PR body.
- **Live ratchets** (M3, O2, mean L1) get a noise band:
  - M3 and O2: 0.01;
  - mean L1: 0.01.
  - Hard rules H1–H9 stay exact.
  - The precise tracking moves to the frozen baselines, which don't drift.
- **The refreshed tables (§1.2) ship in R1**, with the ratchets rebased to the
  post-patch values.

### 2.2 Engine fixes (PRs R2a / R2b, scoring)

Every R2 PR must:

- keep H1–H9, M1 24 / 24, M2, O1 8 / 8 and L4–L6 passing;
- keep M3 and O2 within their band, and mean L1 ≤ 0.12;
- show its frozen-baseline diff in the PR body, with a sentence per changed hero;
- be audited by `scoring-auditor`.

| ID  | Fix                                                                                                                                                                            | Accepted when                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | DPS-keyed abilities priced per cast as DPS × duration; damage upgrades for `DPS`, `DamagePerChain` and `ProcDamage`; weapon modifiers not read as spirit base (§1.3 items 1–3) | Engine fixtures pin Lightning Ball, Siphon Life and Power Surge per-cast damage from live-shaped data. A Fixture 13 lean shows Seven and Abrams ability DPS ≥ their old value × duration.    |
| C2  | Mystic Reverb as a proc; the four stat keys valued as in §1.3 item 5                                                                                                           | One engine fixture per key. Mystic Reverb no longer ranks above Surge of Power's spirit value for a hero with no imbue-worthy ability. Haze and Abrams get 0 from the charged-ability bonus. |
| C3  | Hero-agnostic path uses the confirmed readings (§1.3 item 6)                                                                                                                   | Fixtures on the no-weapon path.                                                                                                                                                              |
| C4  | Phase stat profile refit in fight-value units                                                                                                                                  | M1 stays 24 / 24; the per-hero diff of the anti-heal, sustain, utility, economy and mobility targets is reviewed.                                                                            |
| C5  | Early 3,200 rushes: try a data-driven exemption (an item over X% of real early buyers skips the laning tempo and shop cap)                                                     | Kept if T1 reaches ≥ 6 / 8 with M1 24 / 24 and O1 8 / 8. Otherwise T1 stays an accepted gap, recorded here with the measured cost.                                                           |
| C6  | Live sweep: `npm run probe` on all heroes × 5 boon levels                                                                                                                      | Every anomaly (Haze and Surge of Power included) is fixed or listed here as an accepted gap with a reason.                                                                                   |

### 2.3 `lib/scoring` (PR R3)

- **Findings first:**
  - how its tags rank items;
  - how often its top 5 disagree with the hero basket;
  - whether its reason strings are true for the item;
  - the anti-synergy rules checked against live items.
- **Checkpoint with the user:** fix it (hero-aware), keep it as a goal filter, or retire
  it. No code before the decision.

### 2.4 Closing F (PR R4)

- The measured pair reason appears in the simplified Hero Basket view, labelled as
  measured and never the headline.
- CLAUDE.md marks F ✅ and drops the reminder. The design notes, this doc and a session
  record in `docs/` are updated.

### 2.5 Side fixes (this PR, no scoring change)

- `laneData.ts`: Guardian 1,375 and Walker 3,675, with a citation.
- The `boonSystem.ts` citation date.
- The Cultist Sacrifice comment.
- The CLAUDE.md `PROPERTY_LABELS` reference.
