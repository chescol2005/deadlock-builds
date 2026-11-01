# Milestone K: Lady Geist's mid build after a rush

**Status:** approved 2026-11-01, with every recommendation in §5 accepted as written. Per "Testing Expectations", no engine or
fixture change until these criteria are approved; change this doc first if an expectation
needs to change.

**Scope:** what heal amplification (Healing Booster, Healing Tempo) multiplies in
`lib/engine/heroFight.ts`, an engine fixture for it, and the live guards it moves (O2, M3)
in `src/scripts/starterBuildFixtures.ts`. Follows Milestone J (`docs/milestone-j.md` §3.1),
which found that O2's drop is a real engine gap, not an averaging effect.

## 1. The problem

Most Lady Geists rush Radiant Regeneration (63%), and so does the starter build. Against
the players who rush, her mid build matches 2 of the 7 real top-10 mid buys:

| Lady Geists who rush buy in mid (share of rushers) | The engine's mid build |
| -------------------------------------------------- | ---------------------- |
| Healing Booster 69%                                | Kinetic Dash           |
| Kinetic Dash 67%                                   | Fleetfoot              |
| Spirit Resilience 57%                              | Enduring Speed         |
| Berserker 47%                                      | Spirit Lifesteal       |
| Extra Stamina 43%                                  | Arcane Surge           |
| Recharging Rush 37%                                | Compress Cooldown      |
| Fleetfoot 36%                                      | Extra Health           |

## 2. Diagnosis (2026-11-01)

Probe at the mid checkpoint (boon 22), owning the early build (Radiant Regeneration, Extra
Regen, Monster Rounds, Mystic Burst):

| Item              | First-pick rank | Why it loses                                                                                                                                                                                                                                                                                                |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Healing Booster   | 150 of 151      | It is worth 1.5 (sustain). Heal amp multiplies only her kit heal (Life Drain, ~81 HP per trade) and owned lifesteal. Radiant Regeneration's heal per cast and timed regeneration are not counted, so the item falls under the relevance gate and the 53% "players on this hero buy it" bonus never applies. |
| Spirit Resilience | 7               | Valued well (83.6), but a 3,200 item at the mid phase's flat popularity bonus loses per soul to 1,600 items.                                                                                                                                                                                                |
| Berserker         | 12              | Same (66.8).                                                                                                                                                                                                                                                                                                |

### 2.1 What Healing Booster amplifies (data-verifier, 2026-11-01)

`heroFight.ts` and the G3 design note leave all item regen out of heal amp, citing the wiki.
The wiki (deadlock.wiki/Healing_Booster, updated 2026-10-30) excludes only constant regen:

- "Healing booster affects Health Regen only if it's a temporary effect." It "does not
  affect constant regen acquired from most items."
- Its amplified-items list includes Radiant Regeneration, Mystic Regeneration, Healing Rite,
  Healing Nova, Restorative Shot, Headhunter, Lifestrike, Melee Lifesteal, Veil Walker and
  Dispel Magic, plus bullet and spirit lifesteal.
- Lady Geist's Life Drain and Soul Exchange are amplified.

So the engine under-counts what heal amp multiplies for any hero holding a temporary-heal
item. Lady Geist after a Radiant Regeneration rush is the biggest case.

## 3. Candidate fixes, measured on a scratch change

**A. Heal amp counts the owned items' temporary heals.** The heals the effect estimator
already prices (per cast, per proc, timed regeneration, burst heals), added to
`ownedTradeHealHp`. Flat regen stays out, as the wiki says.

**B. Scale the mid popularity bonus by price.** `PHASE_ITEM_PRICE_EXPONENT.mid` above 0,
re-tested against the rush groups (Milestone I left it at 0 against all players).

| Change         | M1 mean (≤ 0.13) | M3 (≤ 0.077 + 0.01) | O2 (≥ 0.692 − 0.01) | Other live fixtures | Recorded builds changed |
| -------------- | ---------------- | ------------------- | ------------------- | ------------------- | ----------------------- |
| Today          | 0.127            | 0.079               | 36 / 52 = 0.692     | pass                | —                       |
| B, mid 0.25    | 0.127            | 0.079               | 0.692               | P4 fails (35 < 37)  | —                       |
| B, mid 0.5     | 0.131 ✗          | 0.088 ✗             | 0.725               | P4 fails            | —                       |
| B, mid 1       | 0.131 ✗          | 0.074               | 0.706               | pass                | —                       |
| **A**          | **0.125**        | **0.072**           | **37 / 52 = 0.712** | **pass**            | **4 of 72**             |
| A + B, mid 0.5 | 0.129            | 0.083               | 0.712               | P4 fails            | —                       |
| A + B, mid 1   | 0.130            | 0.082               | 0.692               | pass                | 36 of 72                |

- **A works on its own.** Healing Booster becomes Lady Geist's second mid pick (worth 72.6),
  replacing Spirit Lifesteal. Her mid overlap with rushers goes from 2 / 7 to 3 / 7. Every
  guard improves or holds, and nothing fails.
- **B doesn't pay.** Alone it fails M1, M3 or P4 (late big items) at every exponent that
  lifts O2. On top of A it adds nothing to O2 and changes 36 recorded builds.
- **The recorded builds A changes** (frozen inputs of 2026-10-25):
  - Lady Geist boon 16 and boon 22 (owning the early build): Healing Booster replaces
    Healing Rite at boon 16. At boon 22 it, Extra Spirit and Rusted Barrel replace Compress
    Cooldown and Extra Health. In these inputs Healing Booster still builds from Extra
    Regen, so it costs 800 there; the patched live data (no recipe) picks it too.
  - Lady Geist starter: Healing Booster moves from late to mid, with Extra Spirit and
    Rusted Barrel, replacing Extra Health and Compress Cooldown. Late, Surge of Power
    (26% of rushers buy it in mid) replaces Superior Cooldown.
  - Wraith starter: Healing Booster replaces Extra Stamina late. Wraith players buy it
    30% in mid and 5% late, and Extra Stamina 0% late, so this is acceptable but not an
    improvement in itself.

## 4. Acceptance criteria (K1)

### 4.1 Engine

| ID  | Criterion                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| K-1 | Heal amp multiplies the kit heal, owned lifesteal, **and the HP the owned items' temporary heals restore in a trade** (the effect estimator's heal units). Only the in-trade part counts: a heal's tail that ticks after the trade (recovery) is left out, as heal amp's base is "HP per trade". |
| K-2 | Flat regen (`BonusHealthRegen`, `OutOfCombatHealthRegen`) and enemy heal cuts are never amplified.                                                                                                                                                                                               |
| K-3 | From the already-owned build only (as today): an owned Healing Booster still does not raise a candidate heal item's value.                                                                                                                                                                       |
| K-4 | Pure and deterministic, no new constant.                                                                                                                                                                                                                                                         |

**Engine fixture (synthetic):** owning a per-cast heal item raises Healing Booster's
sustain value; owning only a flat-regen item doesn't; owning nothing leaves it unchanged.

### 4.2 Live guards

| ID       | Criterion                                                     | Today          | After K1                                 |
| -------- | ------------------------------------------------------------- | -------------- | ---------------------------------------- |
| K-L1     | **New:** Lady Geist's starter mid phase holds Healing Booster | not held       | held                                     |
| O2       | Mid picks in the same-choice group's mid top 10               | ≥ 0.692        | **raise baseline to the measured 0.712** |
| M3       | Mid-phase overlap between heroes                              | ≤ 0.077        | **lower baseline to the measured 0.072** |
| M1       | Mean split distance                                           | ≤ 0.13 (0.127) | ≤ 0.13 (0.125)                           |
| Baseline | Recorded builds                                               | 72 unchanged   | the 4 changes in §3 accepted, in PR body |

Unchanged: the hard rules H1–H9, the other leans and ratchets, and every other recorded
build.

## 5. Open questions for sign-off

Each carries a recommendation; approving the doc as written accepts them.

1. **Fix.** **Recommendation:** A only. B is dropped (§3).
2. **Spirit Resilience and Berserker.** Still out of Lady Geist's mid build: the mid phase
   prefers 1,600 items per soul. **Recommendation:** leave them as a known gap. The fix
   that would bring them in (B) costs more guards than it gains, and the mid shop budget
   is the place to look later, not this milestone.
3. **Wraith's late Healing Booster.** **Recommendation:** accept (§3).
4. **Frozen inputs predate the 2026-10-30 patch,** which cut Radiant Regeneration's heal
   per cast (65 → 40) and removed Extra Regen from Healing Booster's recipe. The live
   fixtures already run on patched data and pass. **Recommendation:** no special handling;
   the post-patch refit re-captures them.

## 6. Work items

| PR  | What                                                                                                      | Kind   |
| --- | --------------------------------------------------------------------------------------------------------- | ------ |
| K0  | This doc (sign-off)                                                                                       | docs   |
| K1  | Heal amp counts owned temporary heals; engine fixture; K-L1; O2 → 0.712, M3 → 0.072; 4 baselines accepted | engine |
| K2  | Close: engine design notes (correct the G3 note), CLAUDE.md follow-ups, session record                    | docs   |
