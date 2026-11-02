# Milestone N: self-damage triggers (Lady Geist)

**Status:** approved 2026-11-02 (PR #153), with every recommendation in §5 accepted.

- The user added that Berserker is a key Lady Geist item, so the mid-build gap (§3.1) is a
  priority follow-up, not an accepted one.
- Deadman Danny's Close The Deal joined the table after the user's tests (§2.3).

Per "Testing Expectations", change this doc first if an expectation needs to change.

**Scope:** a hero's own self-damage as an input to item value: Berserker's stacks and the
spirit resist that cuts the self-damage. That means the ability parser
(`lib/abilityCoefficients.ts`), the survival model (`lib/engine/kitHeal.ts`,
`lib/engine/heroBasket.ts`), Berserker's price in `lib/engine/itemAdapter.ts` and spirit
resist in `lib/engine/heroFight.ts`, plus an engine fixture. Follows Milestone L
(`docs/milestone-l.md` §5.2), which left Berserker out of Lady Geist's mid build.

## 1. The problem

Lady Geist's Malice and Essence Bomb damage her. The user's point (2026-11-02):

- she procs Berserker with her own abilities and keeps its stacks up;
- Malice also amplifies her damage on the enemy;
- spirit resist cuts what each cast costs her.

The engine ignores all of this:

- `SelfDamagePct` is parsed only as "not ability damage".
- Berserker is credited the same 5 of 10 stacks for every hero (`effectiveStacks`,
  `effectEstimator.ts`).
- Spirit resist is priced only against enemy damage.

47% of her Radiant Regeneration rushers buy Berserker in mid (`heroRushGroups.json`). The
engine's mid build doesn't.

## 2. Data

### 2.1 In-game tests (the user, 2026-11-02, sandbox, max boons and abilities)

All tests were cast from full health. "Spirit resist" is her total.

| Test                         | Max HP | Spirit resist | Self-damage              | Rule                        |
| ---------------------------- | ------ | ------------- | ------------------------ | --------------------------- |
| Malice                       | 3,768  | 1%            | 337                      | 9% × 3,768 × 0.99 = 336     |
| Malice                       | 3,768  | 31%           | 235                      | 9% × 3,768 × 0.69 = 234     |
| Essence Bomb (244 impact)    | 3,768  | 1%            | 72                       | 30% × 244 × 0.99 = 72.5     |
| Essence Bomb (244 impact)    | 3,768  | 31%           | 50                       | 30% × 244 × 0.69 = 50.5     |
| Full combo, Malice then bomb | 4,738  | 1%            | 423 + 100 (bomb hit 337) | 422; 30% × 337 × 0.99 = 100 |
| Full combo, Malice then bomb | 3,988  | 31%           | 249 + 71                 | 248; implies ~343 impact    |

Also observed:

- **Berserker:** the buff is granted at the moment Malice hits her. It lasted 10.0–10.7s
  after the last stack, longer than a trade.
- **Quicksilver Reload** and **Radiant Regeneration** (Mystic Regeneration buff) proc on
  the same cast.
- **Healing:** Radiant Regeneration's heal, plus Healing Booster's amp on it, made about
  730 of the ~770 healing in the first combo. In a sandbox at full health, healing stops
  at full, so the heal size isn't measurable this way.
- **Berserker counts damage before resists** (the user; also deadlock.wiki/Berserker).
  So spirit resist costs no stacks; it only lowers the health she pays for them.

### 2.2 API and wiki (data-verifier, 2026-11-02)

- **Malice:** `SelfDamagePct` 9.
  - The wiki says the base is her _current_ health. Every test above was cast at full
    health, so the tests can't tell current health from max health.
  - Spirit-type, mitigable, and not lethal.
- **Essence Bomb:** `SelfDamagePct` 30. The wiki says 30% of the damage the bomb would
  deal, Spirit-type and mitigable. That matches the tests.
- **The key doesn't say what the percent is of.** The same key, `SelfDamagePct`, is
  current health on Malice and own damage on the bomb.
  - Self-damage keys on other heroes are listed below. Their basis is not verified on the
    wiki, so N leaves them unpriced (unknown is not zero: those heroes keep today's
    pricing):
    - Victor (66), Aura of Suffering: `SelfDamagePercentage` 70, `SelfDPS` 15;
    - Bebop (15), Sticky Bomb: `SelfDamagePercent` 20;
    - Rutger (49, disabled), rocket: `SelfDamagePercent` 50;
    - Deadman Danny (78), Chimera Mk1: `MaxHealthSelfDamagePercent` 10;
    - Deadman Danny (78), Close The Deal: `SelfDamagePercent` 25.

    The user then tested Deadman Danny (§2.3).

- **Berserker** (`upgrade_berserker`, 3,200):
  - `DamageToStack` 120, `WeaponPowerPerStack` 7, `MaxStacks` 10, `DamageDuration` 10.
  - Per the wiki, a new stack refreshes every stack's duration.
  - The wiki does not mention self-damage; the user's log shows it counts.
- **Other items that trigger on damage taken.** None needs N:
  - Weapon Shielding and Spirit Shielding count only damage from enemy heroes.
  - Witchmail, Spellbreaker and Cheat Death react to individual hits.
- **Radiant Regeneration was changed in the 2026-10-30 patch:**
  - `HealingPerCast` 65 → 40;
  - boon scaling 1.7 → 1.4;
  - regeneration scaling 0.035 → 0.025;
  - the cast heal now only works in combat.

  The frozen inputs and the committed tables predate the patch. This is the
  already-queued post-patch refit, not N.

### 2.3 Deadman Danny (the user, 2026-11-02, boon 0, 876 max HP, from full health)

| Ability        | Spirit resist          | Self-damage                                | Rule                                          |
| -------------- | ---------------------- | ------------------------------------------ | --------------------------------------------- |
| Chimera Mk1    | 0% (35% bullet resist) | 87                                         | 10% × 876 = 87.6; bullet resist does nothing  |
| Chimera Mk1    | 30%                    | 61                                         | 10% × 876 × 0.70 = 61.3                       |
| Close The Deal | 30%                    | 1 per tick (6 dealt), 28 final (160 dealt) | 25% of its damage × 0.70 (6 → 1.05, 160 → 28) |

- **Chimera Mk1** only hurts him when the OVERHEATING buff runs out, with a 1.3s
  self-stun. The user confirmed that overheating is a misplay, so it stays unpriced:
  pricing it would reward a mistake.
- **Close The Deal** joins the verified table: 25% of its own damage. On a 135s cooldown
  it costs him about 4 HP per trade, so it barely moves his items.
- **Victor and Bebop** are untested, so they stay unpriced.

## 3. Candidate change, measured on a scratch copy

On frozen inputs (2026-10-25), with the starter build's owned items at each checkpoint:

- **Self-damage per trade, before resist.** Uses the same trade model as kit healing
  (`castsPerTrade`, `TRADE_DAMAGE_TAKEN_SHARE`):
  - Malice: 9% × health per cast. The first cast is at full health; later casts at 75%,
    mid-trade.
  - Essence Bomb: 30% × its own damage per cast (`baseDamage + spiritScaling ×
spirit power`).
  - Only the abilities verified in §2.2 count.
  - Lady Geist's results:

    | Checkpoint | Max HP | At trade start | Later in the trade | Total |
    | ---------- | ------ | -------------- | ------------------ | ----- |
    | Early      | 1,390  | 156            | 63                 | 219   |
    | Mid        | 2,002  | 216            | 90                 | 306   |
    | Late       | 2,359  | 258            | 106                | 364   |

  - Check against §2.1, at the test's 4,738 HP and ~146 spirit power: Malice 426 (log 423
    at 1%), bomb 95 (log implies ~101 before resist; Malice's 7% amp on the bomb accounts
    for most of the gap).

- **Berserker's stacks** are the average held over a trade: min(10, self-damage stacks
  at the start + (later self-damage stacks + enemy stacks) × t). This is a ramp over the
  trade.
  - Enemy damage ramps to the cap by the end of the trade, which reproduces today's 5 of
    10 for a hero with no self-damage.
  - A variant ramped enemy damage from `TRADE_DAMAGE_TAKEN_SHARE` × max HP instead. It
    changed no recorded build, so the simpler form is kept.
  - Lady Geist mid: 1.37× today's stacks. Berserker's gun value 14.5 → 19.9; total 20.7 →
    26.1 % fight value.
- **Spirit resist** also saves its share of her self-damage: + rs × self-damage / max HP,
  in % fight value. Spirit Resilience in her mid: 27.5 → 34.4.

| Variant                                  | Recorded builds changed         | Lady Geist mid build                 |
| ---------------------------------------- | ------------------------------- | ------------------------------------ |
| Self-damage stacks only                  | 0 / 72                          | unchanged                            |
| + spirit resist saving (**recommended**) | 2 / 72, both Lady Geist (below) | unchanged                            |
| + Berserker value × 1.25 / 1.5 / 2       | —                               | unchanged                            |
| + Berserker value × 2.5                  | —                               | unchanged; Berserker enters **late** |

The two changed builds (recommended variant):

- Lady Geist, boon 16, nothing owned: Cardio Calibrator, Soaring Spirit and Extra Health
  → Spirit Resilience and Improved Spirit. Her rushers buy Spirit Resilience at 57% in
  mid.
- Lady Geist, boon 29, early items owned: Siphon Bullets and Soaring Spirit → Damage
  Recycler and Fleetfoot.

Live guards with the recommended variant are all unchanged:

- M1 mean 0.123, M3 0.071, O2 41 / 46 = 0.891;
- L-L2 0.49, L-L1, K-L1;
- P4 37, P5 1.

The live harness passed 488 / 0. The engine harness passed 395 with 1 failure, the
recorded-build check above.

### 3.1 Why Berserker still misses the mid build

It's the gun budget, not the price. Her measured mid split gives the gun shop 27.2% of
11,100 souls, 3,472 with the 15% slack.

- Kinetic Dash (1,600) ranks first in mid at 43 per 1,000 souls, mostly from the phase
  term (her players buy it).
- After Kinetic Dash, Berserker needs 1,600 + 0.75 × 3,200 = 4,000 souls, even with L's
  25% overshoot. So only a 1,600 item (Fleetfoot) fits.
- Berserker ranks 6th of 151 for the first pick (22.3 per 1,000 souls). It would need to
  beat Kinetic Dash, which even 2.5× its value doesn't do.

This is Milestone L's finding again (§3, "the rushers' mid split brings in Berserker but
fails M1"). More value for Berserker can't fix it; only the gun budget can.

## 4. Acceptance criteria (N1, if approved)

### 4.1 Engine

- `HeroAbility.selfDamage` is parsed only for the abilities verified in §2.2 (a table
  keyed by ability class name, with a cited source):
  - Malice: % of health;
  - Essence Bomb: % of its own damage;
  - Close The Deal: % of its own damage (§2.3).
  - Any other self-damage key is left unpriced and listed in the code comment. Chimera
    Mk1 is listed as left out on purpose (a misplay).
- Self-damage per trade comes from the survival model (`kitHeal.ts`) through the same trade
  model as kit healing. It is 0, not missing, for a hero without it.
- Berserker's stacks:
  - With no self-damage they are exactly today's (5 of 10), for every hero.
  - With self-damage they rise, capped at `MaxStacks`.
  - The reason line names the self-damage. As built: "~N stacks held in a fight, M more
    from your own abilities' health cost". It goes in the coverage reason (advanced view),
    not the plain line.
- Spirit resist adds rs × self-damage / max HP; 0 without self-damage.
- Engine fixture (new section 36):
  - parse: Malice 9 / health, bomb 30 / own damage, another hero's key ignored;
  - self-damage reproduces the §2.1 rule at 4,738 HP;
  - stacks: neutral at no self-damage; rise with it; capped;
  - spirit resist: neutral at no self-damage; rises with it.

### 4.2 Live guards

- M1, M3, O2, P4, P5, L-L1, L-L2 and K-L1 hold at the §3 numbers.
- Recorded builds: the 2 Lady Geist changes in §3, accepted. Nothing else moves.

## 5. Open questions for sign-off

1. **Ship the self-damage value (recommended variant)?** It prices what you showed in the
   tests, moves only Lady Geist (2 recorded builds), and raises Berserker 37% and Spirit
   Resilience 25% for her. **Recommendation: yes.**
2. **Berserker in her mid build stays a known gap?** The blocker is the gun budget (§3.1).
   **Recommendation: yes.** Revisit together with M1 against per-player builds, as L
   suggested. **Decision (the user):** yes for N, but it's a priority follow-up, since
   Berserker is a key item for her.
3. **Malice's damage amp:** not modelled. The engine values damage items in % of the
   hero's own damage, so an amp that raises all of her damage cancels out. It only matters
   for the share of fights the debuff is up, which N does not try to measure.
   **Recommendation: leave it.**
4. **Radiant Regeneration (post-patch 40 / 1.4, combat-only):** wait for the queued
   post-patch refit, which recaptures the frozen items. **Recommendation: yes.**

## 6. Work items

| PR  | What                                                  | Who                                     |
| --- | ----------------------------------------------------- | --------------------------------------- |
| N0  | This doc                                              | Opus 5.5; data-verifier (Sonnet)        |
| N1  | Engine change, engine §36, 2 baselines                | Opus 5.5; scoring-auditor (Opus) review |
| N2  | Close: engine design notes, CLAUDE.md, session record | Opus 5.5                                |

## 7. Results

### N1: self-damage triggers (2026-11-02)

- **As measured in §3** (recommended variant), plus Close The Deal (§2.3). The recorded
  builds are identical to the scratch run: 2 of 72 changed, both Lady Geist. Deadman
  Danny's didn't move (his ultimate costs him about 4 HP per trade).
- **Engine fixture §36**, 11 checks:
  - parse, including Close The Deal and the excluded Chimera Mk1;
  - per-trade self-damage, with the user's logs reproduced after resist: Malice 423,
    Essence Bomb 100, Close The Deal 28;
  - held stacks: exact neutrality, rise, cap;
  - Berserker and spirit resist with no self-damage, priced exactly as before;
  - spirit resist on an active at the conditional weight, with no note;
  - only stacks on damage taken are re-priced.
- **Live probe**, Lady Geist mid: Berserker's reason reads "~6.9 stacks held in a fight,
  1.9 more from your own abilities' health cost". It still ranks 6th of 151 and misses her
  mid build (§3.1).
- **`scoring-auditor`:**
  - Blocking: Close The Deal was in code before the doc listed it. Resolved by §2.3 / §4.1
    and a parse check.
  - Fixed on its review:
    - neutrality is now asserted exactly, not as a direction;
    - the active-resist path has a test;
    - the log checks use the logged numbers after resist;
    - only the per-stack estimate is re-priced (`damageTakenStacks` flag);
    - comments on the one-trade weighting of the resist saving, and on the
      simplifications (charges, bonus health);
    - the estimator comment's wording.
  - For N2: the next `fit-category-split` refit values Lady Geist's resist with the
    self-damage saving (the fitter builds `heroValuationModel`), so her fitted profile
    will shift.
