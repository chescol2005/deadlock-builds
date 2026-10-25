# Milestone G: kit and sustain enrichment

**Status:** APPROVED 2026-10-25. Per "Testing Expectations", no scoring
code changes until these criteria are approved; change this doc first if an expectation
needs to change.

**Scope:** `lib/engine/heroFight.ts` (how healing is valued), `lib/abilityCoefficients.ts`
and `lib/engine/heroNeed.ts` (a hero's own self-healing), the measured phase stat
profile (`npm run fit-category-split`), and retiring the hero-tags plan.

## 1. Why G changed

The queued scope (engine-design-notes.md, "G — need-vector enrichment") was two pieces:

- read ability upgrade text for a sustain signal;
- map `hero.tags` / `hero_type` / `gun_tag` to need categories.

Both feed the five need categories the kit cannot derive: anti-heal, sustain, utility,
economy and mobility. Since Milestone F, `applyStatProfile` replaces those five with the
measured per-phase stat profile, and all 44 heroes have one. As written, G would change no
live basket.

The real gap is on the value side. `heroFight.ts` counts healing over one 10 s trade
(`TRADE_SECONDS`), so regen and lifesteal are worth little. That is why the C4 refit
failed in the item scoring review: in fight-value units a tank's late sustain share fell
from about 9% to about 2%, and Abrams' late build moved from 0.02 to 0.22 away from real
play (`docs/item-scoring-review.md` §2.2).

## 2. Phase 0 findings

### 2.1 Game data (data-verifier, 2026-10-25)

Sources: `/v1/assets/heroes`, `/v1/assets/items`, `/v1/assets/items/by-hero-id/{id}`;
deadlock.wiki Healing, Healing_Booster, Health_Regen, Lifesteal, Healbane and Fortitude
pages, all read 2026-10-25.

**Hero-kit self-healing.**

- **Coverage.** 30+ heroes have a self-heal somewhere in their kit. Base values are mostly
  0: the heal is unlocked or raised by an upgrade tier (`upgrades[i].property_upgrades`).
  The parser must read both.
- **Key families**, by ability count across the 44 heroes:
  - lifesteal on damage: `LifeStealPercentOnHit` 5, `BulletLifestealPercent` 4,
    `AbilityLifestealPercentHero` 3, `MeleeLifesteal` 2, `TechLifestealPercent` 2, and
    seven single-use variants;
  - flat heal: `HealAmount` 8, `HealOnHit` 3, `HealFixedHealth` 2, `HeartHeal`,
    `HealPerPickup`, `RakeHealPerKill`, `HealRegen`;
  - heal over time: `BonusHealthRegen` 6, `MaxHealthRegen` 5, `HealingPerSecond` 2,
    `HealthRegen` 2, `HealMaxHealthPercent`; `TotalHealthRegen` (Victor) is a total over a
    duration, not a rate;
  - % of missing or max HP: `MissingHealthPercentHeal`, `MissingHPHeal`, `HealOnKillPct`,
    `HealMaxHealth`, `MaxHealthHealOnCast`;
  - damage-to-heal multipliers: `LifeDrainHealthMult` (Lady Geist), `DamageHealMult`
    (Mo & Krill), `HealingFactor` (Abrams Siphon Life 70%), `HealPctVsHeroes` (Lash).
- **Not self-heal.** The property keys don't say whether the caster or an ally is healed;
  only the description does. So a short, named exclusion list is needed:
  - ally-only heals: Paige Rallying Charge, McGinnis Medicinal Specter, Rem Lil Helpers,
    Kelvin Frost Grenade;
  - enemy anti-heal debuffs, stored negative (`HealAmpReceivePenaltyPercent`);
  - creep-only ratios (`*NonHero*`);
  - name collisions such as `StaminaRegenReduction` and `MaxHealthDamage`;
  - inert keys with base 0 and no upgrade (Wraith Full Auto, Pocket Barrage).
- **Spirit scaling.** Healing scales through `scale_function_healing_spirit_scale`
  (`EHealingOutput`). Its spirit coefficient comes only from an `EAddToScale` upgrade, not
  from the `ETechPower` pattern the damage parser checks.

**Heal amplification exists and is unpriced.**

- `HealAmpCastPercent` / `HealAmpRegenPercent` are on Healing Booster (+20%) and Healing
  Tempo (+25%). Nothing in `lib/` reads them.
- Wiki: amp multiplies healing from abilities, items and lifesteal. It "does not affect
  constant regen acquired from most items", and Healing Tempo excludes innate regen and
  passive lifesteal.

**Regen between trades.**

- Hero damage dealt or taken holds out-of-combat regen off for 4 s (0.5 s for trooper
  damage). In a 30 s gap it ticks for about 26 s unless creeps keep resetting it.
- The wiki doesn't say whether `BonusHealthRegen` ticks in combat. We assume it always
  ticks, as the code does today.
- Fortitude has a 10 s `RestoreDelay`. The %/s reading of `HealLifePercentOutOfCombat` in
  `heroFight.ts` is unverified.
- Lifesteal works at 100% against heroes. Against non-heroes it is 60% for bullets and 40%
  for spirit and melee, so it recovers some HP while farming between trades.

**Item healing keys `heroFight.ts` does not price.** The seven keys it prices all exist
with the meaning the code assumes. About 18 shopable healing keys are not priced at all:

- the heal-amp pair;
- `Regeneration` (Mystic and Radiant Regeneration);
- `BonusSpiritLifesteal` (Spiritual Overflow);
- `ActiveBonusLifesteal` (Vampiric Burst);
- `AbilityLifestealPercentHeroPassive` (Infuser);
- `HealthStealPctHero` (Siphon Bullets);
- `HealPercentPerHeadshot` (Headhunter);
- `HealOnKill`, `HealOnActivate`, `HealOnSuccess`, `ParrySuccessHealPercentage`,
  `HealFromHero`, `HealingPerCast`, `HealOnVeil`, `HealAmount` (Mystic Conduit),
  `LifestealHealPercent`.

This is a second cause of undervalued sustain, alongside the one-trade horizon.

**Hero tags.**

- `tags` are 116 distinct flavour words, some of them jokes ("zZzzZ").
- `hero_type` (marksman / mystic / brawler / assassin) puts spirit-heavy Infernus and Mina
  under marksman.
- `gun_tag` describes the weapon.

None is a usable sustain or role signal. Retiring the mapping is confirmed.

## 3. Acceptance criteria

Gates on every scoring PR below, unchanged from the item scoring review:

- **M1** phase fidelity stays 24 / 24.
- **Mean L1** distance to real play stays <= 0.12.
- **M3** and **O2** stay within their ratchets (0.01 noise band).
- **Baselines.** Every changed basket in `npm run baseline` is listed and explained in the
  PR body.
- **Audit.** `scoring-auditor` and `/code-review` findings are addressed.

### 3.1 Healing over more than one trade (PRs G2a and G2b)

Two scoring PRs, so each baseline diff is reviewed on its own: **G2a** is the horizon
(G2-1 to G2-6), **G2b** prices the unpriced healing keys (G2-7).

Healing restores HP during the trade and in the recovery gap before the next one
(`TRADE_GAP_SECONDS`, 30 s). Today only the trade counts.

| ID   | Criterion                                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G2-1 | Healing that keeps working between trades (regen, out-of-combat regen) is valued over the trade plus the gap, using a named horizon constant with its reasoning in a comment.                                                          |
| G2-2 | Recovery is capped at the HP a trade costs: healing past full health is worth nothing. The cap is a named constant.                                                                                                                    |
| G2-3 | Healing that needs damage dealt (lifesteal) counts in the trade at full rate. In the gap it counts only at the non-hero rate (farming), on a named share of the gap. Out-of-combat regen starts 4 s after the trade (Fortitude: 10 s). |
| G2-7 | Every shopable healing key in §2.1's unpriced list is priced, or listed in the PR with the reason it is left out (e.g. covered by `effectEstimator`, or inert). Lookup fixture: each key is priced or deliberately excluded.           |
| G2-4 | Damage, resist, health and every non-healing stat keep exactly their current value. Engine fixture: a damage item and a resist item value the same before and after.                                                                   |
| G2-5 | Value grows with the healing amount and flattens at the cap. Engine fixture: doubling regen less than doubles its value once over the cap.                                                                                             |
| G2-6 | Live: no reference hero's late basket moves further from real play by more than 0.05 L1.                                                                                                                                               |

### 3.2 A hero's own self-healing (PR G3)

| ID   | Criterion                                                                                                                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G3-1 | The kit parser records each ability's self-heal (base and per-upgrade, spirit scaling from `EAddToScale` upgrades) from the key families in §2.1. It skips the named ally-only abilities, negative anti-heal keys, `*NonHero*` ratios and inert keys. |
| G3-2 | Fixture: each known self-healer in §2.1 has kit heal > 0; a hero with no healing ability has exactly 0.                                                                                                                                               |
| G3-3 | The kit-derived sustain need replaces the neutral stub only for a hero with no measured profile. The live baskets of the 44 profiled heroes don't change from this criterion.                                                                         |
| G3-4 | Its direction is set by the data: across the profiled heroes, kit heal must rank-correlate positively with the measured sustain share (Spearman > 0, reported in the PR). If not, G3-3 is not shipped.                                                |
| G3-5 | `HealAmpCastPercent` / `HealAmpRegenPercent` are valued on the healing they amplify: kit heals, lifesteal and item active heals, but not item regen (wiki). Fixture: a self-healer values Healing Booster above a hero with no healing.               |

### 3.3 Retry the profile refit (PR G4)

| ID   | Criterion                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| G4-1 | The phase stat profile is refitted in fight-value units with G2's healing horizon.                            |
| G4-2 | Abrams' late L1 stays <= 0.10 (C4 reached 0.22), on top of the gates above.                                   |
| G4-3 | If any gate fails, the refit is not shipped: the measurements go in §4 as an accepted gap, as with C4 and C5. |
| G4-4 | When it ships, the refitted table and the updated baselines land in the same PR.                              |

### 3.4 Closing G (PR G5)

- The hero-tags mapping is retired: `tags` are flavour text ("Arsonist"), and the measured
  profile covers role. Recorded in engine-design-notes.md.
- The `heroNeed.ts` "NOT derivable yet" comment is updated to what G derived.
- CLAUDE.md milestone row and follow-ups, and a session record.

**Out of scope** (stay under "After Milestone F" in CLAUDE.md): planned big items, in-phase
upgrades (H2), real ability tiers for charge credit.

## 4. Results

**G2a: healing between trades (2026-10-25).** Shipped.

- **Live gates unchanged:**

  | Measure    | Result  |
  | ---------- | ------- |
  | M1         | 24 / 24 |
  | Mean L1    | 0.114   |
  | M3         | 0.080   |
  | O2         | 0.760   |
  | G2-6 moves | none    |

  No reference checkpoint moved.

- **Baselines.** 14 of 72 changed:
  - 10 relabel a headline from category bonus to coverage (Extra Regen 9, Healing
    Booster 1);
  - three late picks swap: Lady Geist Enchanter's Emblem → Bullet Lifesteal, Seven
    Greater Expansion → Superior Cooldown, Wraith Mystic Vulnerability → Arcane Surge;
  - two (Warden late, Wraith late owning early) change only term values, with the same
    items.
- **G2-2 applies to the whole build.** Recovery is priced on top of what the hero's base
  regen and the owned items already restore (`ownedGapHeal`).
- **A first version failed the gate.**
  - What it did: it took out-of-combat delays off the whole gap.
  - The effect: Fortitude got 22.5% of HP and beat Colossus for Abrams late. Abrams late
    moved 0.02 → 0.22, Infernus mid 0.12 → 0.25, and the mean L1 rose to 0.130.
  - The fix: the delay now runs inside the quiet stretch of the gap.

**G2b: unpriced healing keys (2026-10-25).** Shipped.

- **Priced:**
  - Vampiric Burst, Spiritual Overflow and Infuser lifesteal;
  - Restorative Shot, Radiant Regeneration, Dispel Magic and Veil Walker heals, per proc
    per cooldown; the last two are situational (0.4);
  - Headhunter's % max HP per headshot, scaled by the hero's gun share;
  - Lifestrike's fixed heal per melee hit;
  - Mystic / Radiant Regeneration.
  - Timed lifesteal counts in the trade, not between trades.
  - Engine fixture 29 checks every healing key in the frozen catalogue.
- **Left out, with reasons** (`UNPRICED_HEALING_KEYS`):
  - parry heals (Rebuttal, Counterspell) and Healbane's kill heal: no measured parry or
    kill rate;
  - Lifestrike's % of melee damage;
  - heals against creeps (`HealFromNPC`, `NonHeroHealPct`);
  - heal amp: G3-5.

  Mystic Conduit (`HealAmount`) is not in the current catalogue.

- **Live gates unchanged:** M1 24 / 24, mean L1 0.114, M3 0.080, O2 0.760.
- **Baselines.** 9 of 72 changed:
  - 4 relabel a headline to coverage, with the same items (Restorative Shot, Mystic
    Regeneration);
  - Abrams buys Restorative Shot early and Lifestrike late, as real Abrams players do;
  - Haze late takes Headhunter;
  - Infernus late swaps Escalating Exposure for Dispel Magic and three smaller items;
  - Lady Geist boon 22 owning early changes only term values.

**G2c: Siphon Bullets (2026-10-25).** Shipped. The wiki page the user supplied settles
the mechanics: each steal (at most once per 1.2 s) deals 2.5% of the target's max HP and
heals the buyer by the same amount (counted once), at one rate for both halves: once per
1.2 s, or fewer if the hero lands fewer shots; the heal is scaled by the gun share. The
enemy's max HP is the 2,500 reference
Toxic Bullets uses. Enemy health grows over the game, so both items are under-priced late
(follow-up: scale with boon). `StealPerHit` / `StealPerKill` are flags; the kill steal was
removed on 2026-03-06. Live gates unchanged; Siphon enters 4 of 72 baselines (Haze and
Warden late).

**G3: a hero's own self-healing (2026-10-25).** Shipped.

- **G3-1 / G3-2: parsed.** `HeroAbility.selfHeals` from `KIT_SELF_HEAL_KEYS`, skipping the
  ally-only abilities and kill-gated heals. `KIT_HEAL_SHARE` counts Card Trick's Heart heal
  as one suit in four. Engine fixture 30 checks:
  - the six frozen self-healers heal > 0 per trade;
  - Seven heals exactly 0.
- **G3-4: direction from data.** Across the 42 parseable profiled heroes (live kits), kit
  heal rank-correlates positively with the measured sustain share. Spearman: early 0.395,
  mid 0.381, late 0.306. So G3-3 shipped.
- **G3-3: fallback only.** Kit heal raises the sustain need, from neutral up to +50% at 20%
  of max HP per trade. Only heroes with no measured profile are affected, so there is no
  live change.
- **G3-5: heal amp priced.** Healing Booster and Healing Tempo get amp × the healing the
  hero has (kit heal plus owned lifesteal), never item regen.
  - Live: mean L1 0.114 → 0.111, O2 0.760 → 0.780, Abrams mid 0.14 → 0.06.
  - M3 rose 0.080 → 0.088 (limit 0.086), because Abrams and Lady Geist now buy Healing
    Booster mid, as their real players do (21% and 53%). **The user approved raising M3's
    baseline 0.076 → 0.0781** (measured overlap 0.08802) (docs/starter-build-use-cases.md M3).
  - Baselines: 6 of 72 changed, all Healing Booster for Abrams and Lady Geist. Abrams'
    starter moves Booster from late to mid, and its late phase swaps Colossus for Phantom
    Strike.

**G4: profile refit in fight-value units (2026-10-25).** Shipped. G4-1 to G4-4 pass.

- `fitCategorySplit.ts` values each phase's purchases in the hero's own fight value at the
  phase checkpoint, with G2a's healing horizon and G3's kit heal. This is now the default;
  `--item-units` gives the old mode.
- **Same window as the previous table** (09-30 → 10-25, `--days 25`). Splits drift ≤ 0.001,
  so the change is the units.
- **Gates:**

  | Measure                   | Before  | After   |
  | ------------------------- | ------- | ------- |
  | M1                        | 24 / 24 | 24 / 24 |
  | Mean L1                   | 0.111   | 0.102   |
  | Abrams late (G4-2 ≤ 0.10) | 0.02    | 0.02    |
  | Lady Geist late           | 0.28    | 0.11    |
  | Seven late                | 0.10    | 0.06    |
  | Deadman Danny mid         | 0.02    | 0.08    |
  | M3                        | 0.088   | 0.077   |
  | O2                        | 0.780   | 0.816   |

- **Ratchets locked:** M3 baseline 0.077, lowered from G3's 0.0781 (the pre-G3 value was
  0.076); O2 baseline 0.731 → 0.816 (measured 0.780 before, 0.816 after).
- **Recorded in the table:** `method.profileUnits` is `"fight-value"`. Drifter and Solomon
  (no parseable damage model) are fitted in item units, listed in `method.itemUnitHeroes`.
- **Profile shift** (mean of 44 heroes):
  - sustain falls (late 10.4% → 4.9%);
  - mobility rises (late 5.4% → 15.9%; up to 38% for Paige, Kelvin, Warden, Bebop, Lash
    and Lady Geist early or mid), because move-speed riders count in fight units;
  - gun damage rises (late 15.2% → 24.3%).
- **Baselines.** 36 of 72 changed (G4-4: table and baselines in one PR). Gained: Extra
  Stamina, Guardian Ward, Enduring Speed. Lost: Spirit Resilience, Superior Cooldown,
  Cultist Sacrifice.
