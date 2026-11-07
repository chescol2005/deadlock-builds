# Milestone O: hero roster percentiles

**Status:** APPROVED 2026-11-06 (O.0). Decisions on §6 are recorded there. Scope decisions
from the user, 2026-11-06:

- late game means about 30,000 souls spent, which is **boon 30** (`BOON_THRESHOLDS`);
- heroes are compared against the **filtered roster** (`fetchVisibleHeroes()`, the same
  set `heroNeed` normalizes against);
- vitality includes **base resists and health**;
- abilities are ranked against **every ability in the game** (from the filtered roster);
- ranks are **display-only**. They don't feed scoring. Builds around specific abilities are
  a possible later milestone (§8).

Per "Testing Expectations", change this doc first if an expectation needs to change.

**Scope:** a pure module that ranks each hero against the roster on gun, melee, vitality
and spirit scaling, and each ability against every ability. Covers the resist fetch it needs
(`lib/api/deadlockApi.ts`, `lib/heroStats.ts`), a new `lib/heroProfile/`, a frozen ability
snapshot for fixtures, and a "Roster Rank" section on `/heroes/[id]`. Doesn't touch
`lib/scoring/` or `lib/engine/` behaviour.

## 1. The problem

A player picking a hero has no quick way to see what the hero's kit rewards late. The hero
page shows raw numbers (730 HP, 1.1 spirit per boon) with nothing to compare them to. The
engine already compares heroes against the roster (`heroNeed.ts` z-scores), but only to
weight the item basket, and none of it is visible.

The goal: "Graves at 30k souls: gun DPS 31st of 38, kit spirit scaling 3rd of 38, so build
spirit." Every number traces back to API data.

## 2. Data

### 2.1 Already available (`HeroBaseStats`, `HeroAbility`)

| Group    | Fields                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Gun      | `bulletDamage`, `bulletDamagePerBoon`, `bulletsPerSecond`, `ammo`, `reloadTime`, `dpsWithReload`                                            |
| Melee    | `lightMeleeDamage`, `heavyMeleeDamage`, per-boon growth                                                                                     |
| Vitality | `maxHealth`, `maxHealthPerBoon`, `healthRegen`, `moveSpeed`                                                                                 |
| Spirit   | `spiritPowerPerBoon` (base spirit power is always 0)                                                                                        |
| Ability  | `baseDamage`, `spiritScaling`, `weaponScaling`, `cooldown`, `damageSeconds`, `charges`, `upgrades[].statChanges` (with `scale`/`scaleStat`) |

### 2.2 To add: resists (checked live 2026-11-06, `/v1/assets/heroes`)

Resists are sparse. Most heroes have none, so most heroes tie on these metrics.

- **Starting resists** (`starting_stats`): `bullet_armor_damage_reduction` and
  `tech_armor_damage_reduction`. Only 3 heroes have one: Lash spirit +10, Pocket spirit -15,
  Baba bullet -7 / spirit +8. (Negative values are real.)
- **Per-boon resists** (`standard_level_up_upgrades`):
  `MODIFIER_VALUE_BULLET_ARMOR_DAMAGE_RESIST` and `MODIFIER_VALUE_TECH_RESIST`. Only 4
  heroes have one: Dynamo bullet 0.625, Kelvin spirit 0.625, McGinnis spirit 0.35, Bebop
  bullet 0.3.
- **Spirit-scaled resists** (`scaling_stats`, keyed by the resist stat, with
  `scaling_stat: "ETechPower"`): Venator 0.12178 on both resists, and Baba 0.05 on spirit
  resist. Found during O.1.
- **Units verified 2026-11-06** against deadlock.wiki/Damage_Resistance and each hero's page.
  All values are percentage points. Dynamo 0.625 × 35 = 21.9 "At Max Boon", Bebop 10.5 and
  McGinnis 12.3 also match. Per the wiki, starting, boon and spirit-scaled resists **add**:
  "Boon and Spirit scaling resistances stack additively". Item resist stacks multiplicatively
  on top, `1 − (1 − a)(1 − b)`, but that's out of scope here. The page is marked "under
  construction".
- **At boon 30, live** (spirit power from boons only): Dynamo bullet 18.75, Kelvin spirit
  18.75, McGinnis spirit 10.5, Lash spirit 10, Bebop bullet 9, Baba bullet −7 / spirit 9.65,
  Venator 4.02 / 4.02, Pocket spirit −15. Every other hero is 0 / 0.
- **Only the hero's own resists count.** Ability resists aren't included, such as Kelvin's
  Ice Path +35% bullet resist or McGinnis's Medicinal Specter T3 +40% spirit resist.

New `HeroBaseStats` fields, all required, in percentage points: `bulletResist`,
`bulletResistPerBoon`, `bulletResistPerSpirit`, `spiritResist`, `spiritResistPerBoon` and
`spiritResistPerSpirit`. They're read by `heroResistAtBoon(base, boon, spiritPower)` in
`lib/heroStats.ts`. The frozen engine snapshot predates them, so `loadFrozen` backfills 0
(`HERO_RESIST_DEFAULTS`). `heroNeed` doesn't read them, so engine baselines don't move. The
O.2 fixtures need real resists, so `abilityRoster.json` (§7.1) also carries every roster
hero's fresh `baseStats`.

### 2.2.1 HP scaling and other spirit-scaled stats (checked live 2026-11-06)

**HP scaling.** Health grows only with boons (`MODIFIER_VALUE_BASE_HEALTH_FROM_LEVEL`). No
hero's max health scales with spirit power. The growth varies a lot: 27 per boon (Mina) to 65
(Mo & Krill), or +111% (Vindicta) to +224% (Warden) from boon 0 to boon 30. Both are now
metrics (§3.1). The user asked for it, 2026-11-06.

**`scaling_stats` has more than resists.** These hero stats grow with spirit power:

| Stat (`scaling_stats` key)      | Heroes, per point of spirit power                                 | In this milestone                            |
| ------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| `EBaseHealthRegen`              | Victor 0.08                                                       | **Yes**, in health regen (§3.1)              |
| `E*ArmorDamageReduction`        | Venator 0.122 both, Baba 0.05 spirit                              | Yes, in resists (§2.2)                       |
| `EBulletDamage`                 | Solomon 0.14, Grey Talon 0.08, Vindicta 0.022                     | **Yes**: damage per bullet, DPS              |
| `EClipSize`                     | Haze 0.5, Yamato 0.15                                             | **Yes**: clip size, DPS                      |
| `EFireRate`, `ERoundsPerSecond` | Warden: one bonus written two ways (0.21% × 3.81 = 0.008 shots/s) | **Yes**, `ERoundsPerSecond` only             |
| `EHeavyMeleeDamage`             | Paige 0.45                                                        | **Yes**: heavy melee                         |
| `EMaxMoveSpeed`, `ESprintSpeed` | Grey Talon, Vyper, Sinclair; Wraith sprint                        | **Yes** for move speed; sprint has no metric |

The user decided 2026-11-06 that these count. Every coefficient matched its hero's
deadlock.wiki infobox that day. All are a **flat amount per spirit point**, in the stat's
own unit ("base + (Spirit Power × coefficient)", deadlock.wiki/Spirit_Power). They apply at
boon spirit power `SP = spiritPowerPerBoon × B`, with no items, like resists and regen.

New `HeroBaseStats` fields: `healthRegenPerSpirit`, `bulletDamagePerSpirit`,
`clipPerSpirit`, `bulletsPerSecondPerSpirit`, `heavyMeleePerSpirit` and
`moveSpeedPerSpirit`. `EFireRate` is never read, since it restates `ERoundsPerSecond` as a
percent. `HERO_RESIST_DEFAULTS` is renamed `HERO_PROFILE_STAT_DEFAULTS`, since it no longer
covers only resists.

Live effect at boon 30 (2026-11-06), on-paper sustained DPS: Solomon 38.1 → 42.8, Grey
Talon 65.1 → 70.2, Haze 45.7 → 51.6 (clip 25 → 32.5), Warden 55.4 → 57.6, and Yamato 77.0 →
97.1 (clip 12 → 17). Paige's heavy melee goes from 156 to 171. **Yamato's clip gain is
approximate**: hers is one of the 12 weapons the cycle model can't reproduce (§3.1 notes).

### 2.3 Not in scope

Sprint speed, stamina, dash distance, and the gun's falloff and range. All of it is in the API
and can join later as rows in the metric table (§3) without touching the design.

## 3. Metrics (evaluated at `EVAL_BOON = 30`)

`B = 30`. Each metric is shown with its boon 0 value next to it for context, but ranked at
boon 30.

### 3.1 Hero metrics

| Group    | Metric                   | Formula                                                                                                | Better |
| -------- | ------------------------ | ------------------------------------------------------------------------------------------------------ | ------ |
| Gun      | **Landed DPS** (lead)    | sustained DPS × `accuracy(hero, rank)` (§3.4)                                                          | higher |
| Gun      | Sustained DPS (on paper) | `dpsWithReload × cycleDps(gun at B) / cycleDps(base gun)`, anchored to Valve (notes)                   | higher |
| Gun      | Damage per bullet        | `bulletDamage + bulletDamagePerBoon·B + bulletDamagePerSpirit·SP`                                      | higher |
| Gun      | Fire rate                | `bulletsPerSecond + bulletsPerSecondPerSpirit·SP`                                                      | higher |
| Gun      | Clip size                | `ammo + clipPerSpirit·SP`                                                                              | higher |
| Gun      | Reload time              | `reloadTime`                                                                                           | lower  |
| Gun      | Gun growth               | sustained DPS at B ÷ at 0, minus 1                                                                     | higher |
| Melee    | Light melee              | `lightMeleeDamage + lightMeleePerBoon·B`                                                               | higher |
| Melee    | **Heavy melee** (lead)   | `heavyMeleeDamage + heavyMeleePerBoon·B + heavyMeleePerSpirit·SP`                                      | higher |
| Vitality | **Max health** (lead)    | `maxHealth + maxHealthPerBoon·B`                                                                       | higher |
| Vitality | Health per boon          | `maxHealthPerBoon` (HP scaling; 27 Mina to 65 Mo & Krill, live)                                        | higher |
| Vitality | Health growth            | health at B ÷ at 0, minus 1 (Warden +224% vs Vindicta +111%, live)                                     | higher |
| Vitality | Bullet resist            | `bulletResist + bulletResistPerBoon·B` (combination rule per §2.2)                                     | higher |
| Vitality | Spirit resist            | `spiritResist + spiritResistPerBoon·B`                                                                 | higher |
| Vitality | Effective HP vs bullets  | `health / (1 − bulletResist)`                                                                          | higher |
| Vitality | Effective HP vs spirit   | `health / (1 − spiritResist)`                                                                          | higher |
| Vitality | Health regen, move speed | regen + `healthRegenPerSpirit` × boon spirit power (Victor 0.08); move speed + `moveSpeedPerSpirit`·SP | higher |
| Spirit   | Spirit power from boons  | `spiritPowerPerBoon·B`                                                                                 | higher |
| Spirit   | **Kit spirit scaling**   | Σ over damaging abilities: `spiritScaling(T3) × damagePerCastFactor × castsInFight(cooldown(T3), F)`   | higher |
| Spirit   | Kit weapon scaling       | same, with `weaponScaling`                                                                             | higher |

Notes:

- **Landed DPS leads the gun group.** Damage per bullet alone ranks Paige (35.0 per shot) far
  above Calico (1.8 per pellet at 42.86/s). Only damage × fire rate compares fairly (see
  `heroNeed.ts`), and only damage that lands counts, at the viewer's rank (§3.4). On-paper
  sustained DPS (100% accuracy) stays as a second row, so the gap between the two is
  visible.
- **Sustained DPS is anchored to Valve.** `cycleDps` is the engine's `sustainedGunDps` with
  its per-clip overhead recovered from the base stats. It measures only how much damage,
  clip and fire-rate changes help. Valve's `dpsWithReload` sets the base. Without the
  anchor, the cycle's base lands **19–79% below Valve's for 12 of 44 heroes** (frozen
  roster): Calico −79%, Pocket −65%, Shiv −62%, Mo & Krill and Yamato −55%, Baba −39%,
  Drifter −37%, Abrams −29%, Rat King −21% and Silver −19%, plus Lash and Seven at about 0%.
  Those are spread and per-shell-reload weapons, where `bullets_per_second` counts pellets
  but `clip` counts shots, so the derived overhead clamps at 0. With the anchor, every hero
  with no spirit-scaled gun stats gets exactly `dpsWithReload × damage ratio`, and a fixture
  checks all 44. The engine builds its `GunProfile` the same unanchored way
  (`heroBasket.ts`), so item scoring likely undervalues gun items for those heroes. That's a
  separate scoring PR (§8).
- **Unknown is not zero.** `dpsWithReload === 0` means no weapon data. That hero is left out
  of the gun rankings and shows "—". The same rule applies to any other missing value.
- **Kit spirit scaling** means "damage per fight gained per point of spirit power", with
  every ability at T3. It's computed for two fight lengths, `F` (§3.2), each ranked
  separately.

### 3.2 Fight length: short and long

The user asked for both, 2026-11-06. Kits with short cooldowns gain in long fights, because
they cast again. Kits built on one big cast don't. Comparing the two ranks shows that.

| Fight     | `F`                         | Casts per ability (fractional) |
| --------- | --------------------------- | ------------------------------ |
| **Short** | `TRADE_SECONDS` (10 s)      | `castsInFight(ability, 10)`    |
| **Long**  | `LONG_FIGHT_SECONDS` (30 s) | `castsInFight(ability, 30)`    |

**Casts are fractional on purpose** (the user, 2026-11-06, after weighing whole casts against
fractional ones). A fraction isn't half a cast. It's the **average over many fights**. A
12 s ability in a 10 s fight is sometimes up (1 cast) and sometimes not (0), and the average
is the honest per-fight value. Fractions keep rankings stable across small cooldown patches.
Whole casts are left out entirely, including best-case ranges in the UI. The page labels the
number "avg casts per fight".

**There's no blanket cast cap** (the user, 2026-11-06: Card Trick late game "can really use
many cards"). The engine caps every ability at 2 casts per 10 s (`MAX_CASTS_PER_TRADE`),
because a few abilities' listed "cooldown" isn't what limits them. The profile models what
does limit each ability instead (§3.2.1). The engine keeps its cap. Bringing the same model
to item pricing is a separate scoring PR (§8).

`castsInFight(ability, F)` is pure, in `lib/heroProfile/fight.ts`. It picks the ability's
**cast gate** from API fields, then counts casts. Each step below uses the base rule:

- **Base rule**, `castsFromCooldown(cd, F)`. No cooldown is 1 cast. Below the fight length,
  `cd < F`, it's `F / cd`. At or above it, `cd ≥ F`, it's `min(1, TRADE_GAP_SECONDS / cd)`,
  the engine's readiness weight. This is the engine's `castsPerTrade` without the cap, so the
  two agree exactly for any `cd ≥ 5` at `F = 10`.

#### 3.2.1 Cast gates

Checked across the filtered roster, 2026-11-06, and again on the O.3 snapshot
(`abilityRoster.json`, 2026-11-07). Only the abilities named below fall outside the cooldown
gate.

| Gate         | Detected by (API, at T3)                                                                    | Casts in a fight of `F` s                                                                    | Roster cases                                   |
| ------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Cooldown** | default                                                                                     | `castsFromCooldown(cd, F)`                                                                   | nearly all; Mirage Djinn's Mark (2.75 s)       |
| **Resource** | `ResourcePerCard` and `CardResourcePerBulletHit` present                                    | banked + generated, capped by throw rate (below)                                             | Wraith Card Trick                              |
| **Battery**  | `StoredDamageHealthPercentRequired > 0`                                                     | 1 (the charge assumed full at the start); recharge from damage taken not modelled (below)    | Victor Pain Battery (40% of max HP per charge) |
| **Charges**  | `AbilityCharges ≥ 2`, `AbilityCooldownBetweenCharge > 0` and **no** `AbilityCooldown`       | `(charges − 1) + castsFromCooldown(chargeRestore, F)`                                        | Graves Jar of Dead (4 charges, 13 s)           |
| **Channel**  | per-second damage key (`isDamageRate`), duration > 0 and **cooldown shorter than duration** | damage seconds = `min(F, castsFromCooldown(cd + duration, F) × duration)`, in place of casts | Victor Aura of Suffering (8 s, 2 s cooldown)   |

**Detection tightened in O.3** (the roster survey, 2026-11-07). The first-draft rules caught
more than the roster cases they named:

- the charges rule also caught 7 ordinary cooldown abilities with 2 charges and a short
  between-charge delay (Kelvin Frost Grenade, Holliday Powder Keg, Vindicta Assassinate, Shiv
  Serrated Knives, Vyper Screwjab Dagger, Venator Snap Trap, Violet Living Ink). Only Jar of
  Dead has no `AbilityCooldown` at all, so its restore time is what limits it;
- the channel rule also caught 7 rate abilities whose cooldown is longer than their duration
  (Arctic Beam, Siphon Life, Flame Dash, Life Drain, Entangling Thorns, Last Stand, Leech
  Therapy). For those the cooldown is the gate, and `damagePerCastFactor` already counts the
  seconds. Only Aura of Suffering's 2 s cooldown is shorter than its 8 s channel.

**Battery gate (Pain Battery), found in O.3.** The first draft counted Pain Battery as a 2 s
cooldown: 5 casts per short fight, 15 per long one. The wiki says otherwise
(deadlock.wiki/Victor, 2026-11-07): "Taking any damage passively charges up your Pain
Battery", and "It takes damage equal to 40% of Victor's Max HP to gain a charge". CDR lowers
that share, `40% × (1 − CDR)`. The API carries it as `StoredDamageHealthPercentRequired 40`.
The model has no damage-taken-per-fight input, so for now the gate counts **one charge per
fight**, assumed full at the start. That's conservative and pending the user's call (§6 Q10).
The 2 s figure put Victor's kit at 17.2, double the next hero's. With the battery gate it's
8.4, still first, carried by Aura of Suffering.

**Resource gate (Card Trick).** The API's per-hit values × `CardResourceGenPctScale` (85%) are
exactly the wiki's rates: 4 × 0.85 = 3.4% of a card per body shot, 5.1% per headshot, 8.5%
per light melee and 21.25% per heavy melee (deadlock.wiki/Wraith, checked 2026-11-06).

- generated cards = `F × bulletsPerSecond × accuracy × CardResourcePerBulletHit × scale ÷
ResourcePerCard`. That counts body shots only, a conservative choice. Melee and headshots
  are left out;
- banked cards = `AbilityCharges` at T3 (2 + 2 = 4), assumed full when the fight starts;
- the result is capped at `F / cd`, using the 0.6 s throw cooldown, which CDR doesn't affect
  (wiki);
- `accuracy` is `accuracy(hero, rank)`, the same rank-aware value landed DPS uses (§3.4);
- `bulletsPerSecond` is the base value. Boons don't change fire rate, and ranks are item-free;
- worked example, Wraith at 50% accuracy: 10.58 × 0.5 × 3.4 / 100 = 0.18 cards/s, so about
  5.8 throws in a short fight and 9.4 in a long one. Under the engine's cap it was 2 and 6.

**Charges gate (Jar of Dead).** The extra charges are assumed banked at the start of the
fight, and one charge comes back every `AbilityCooldownBetweenCharge` seconds. The wiki
gives Jar of Dead "Charge Cooldown 13s", plus a second condition: 12 "death" per charge,
from kills. That second condition isn't modeled.

**Channel gate (Aura of Suffering).** Damage is DPS × seconds of uptime, not per cast. The
cycle is assumed to be the duration plus the cooldown, with the cooldown starting after the
channel ends. That gives 8 s of damage in a short fight and 24 s in a long one. Without this
gate, a 2 s cooldown × 8 s duration would credit 16 s of damage in a 10 s fight under the
engine's cap, and 40 s with no cap. The DPS used is the wiki's "Max DPS" figure, since the
aura ramps up to its maximum. The engine's damage key reads `MinDPS` (13), so the profile
reads the matching `MaxDPS` property instead: 58 + 34 at T3 = 92, × 0.72 spirit. Its T2
upgrade spells the min key `MinDps`, which matches nothing; that doesn't affect the max. The
wiki gives no ramp time and doesn't say when the cooldown starts (checked 2026-11-07), so
both stay in-game checks.

**Gate assumptions to check in game, later in the milestone** (§6 Q5; O.3 shipped without them, the user, 2026-11-07):

- Card Trick: the bank of 4 cards is full at the start of a fight;
- Jar of Dead: a charge comes back in 13 s;
- Aura of Suffering: the cooldown starts when the channel ends, and the channel ramps to
  max DPS fast enough that using max DPS is fair.

**Charges on cooldown-gated abilities** (charges ≥ 2 that share one cooldown) count as the
engine counts them, with no extra casts. That's a known gap, listed in §8.

| Ability (gate)              | Short (10 s)  | Long (30 s)    |
| --------------------------- | ------------- | -------------- |
| 6 s cooldown                | 1.67          | 5              |
| 12 s cooldown               | 1             | 2.5            |
| 25 s cooldown               | 1             | 1.2            |
| 120 s ultimate              | 0.25          | 0.25           |
| Pain Battery (battery gate) | 1             | 1              |
| Card Trick, 50% accuracy    | 5.8           | 9.4            |
| Jar of Dead, 4 × 13 s       | 4             | 5.31           |
| Aura of Suffering (seconds) | 8 s of damage | 24 s of damage |

**This is a model of a fight, not a measurement.** 30 s is a long teamfight, and the
constant is open to tuning.

The late-game lean (§4.1) uses the **short** fight. The page shows the long-fight rank next
to it, plus a "scales into long fights" note when the long rank is higher by
`LONG_FIGHT_NOTE_DELTA = 15` percentile points or more.

### 3.3 Cooldown reduction impact

For strong abilities, the page shows how much each cooldown reduction (CDR) setup adds: the
extra average casts per fight, and the damage gain that brings. (The user, 2026-11-06: "if an
ability is powerful enough, consider the impact of cooldown reduction items to get more
casts.")

**Which abilities.** Abilities in the top quarter of their pool on scaling per cast
(`CDR_SPOTLIGHT_PERCENTILE = 75`, §3.5).

**Gain.** For a setup with total reduction `r`: casts with the reduction applied per gate (table below) against
casts without it, in each fight length. The damage gain is the ratio minus 1, since
damage per cast doesn't change. Gains are smooth, except across the flat stretch in §3.2.
For example, a 12 s ability in a short fight gains only +1.6% from Compress Cooldown, because
9.84 s is barely under 10 s. In a long fight it gains +22% (2.5 → 3.05 casts).

What CDR shortens depends on the gate (§3.2.1):

| Gate     | What CDR changes                                                                                                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cooldown | `cd × (1 − r)`                                                                                                                                                                                                                                                                                                                         |
| Channel  | the cooldown part of the cycle only, `duration + cd × (1 − r)`                                                                                                                                                                                                                                                                         |
| Charges  | the charge restore time. Assumed: the wiki says CDR cuts Jar of Dead's "death" cost and doesn't mention its 13 s                                                                                                                                                                                                                       |
| Resource | card **generation** speeds up by `1 + 0.85 × r`, and the 0.6 s throw cooldown doesn't change. That fits the wiki's one example, Transcendent's 25% taking a card from "30 => 24 shots" (29.4 ÷ 1.2125 = 24.3), and the API's 85% `CardResourceGenPctScale` on `ETechCooldown`. Unverified beyond that, so it's checked in game (§6 Q5) |

**Fire rate (resource gate only).** Card Trick's casts also grow with fire rate, the user's
point about late game. So the page shows the extra cards per fight from each +10% fire rate.
It's linear in `bulletsPerSecond`, and an annotation only, like CDR. A fire-rate item ladder
is a follow-up (§8).

**Item setups (hand-authored ladder, values read live).** Each setup's CDR % is read from the
live item's `properties.CooldownReduction` by class name, so a patch moves the numbers
without a code change. Which items count, and how they combine, is written down from
deadlock.wiki (checked 2026-11-06):

- CDR from several items **multiplies**: total = `1 − Π(1 − rᵢ)`. Superior 20% + Spellslinger
  5% = 24%, not 25% (deadlock.wiki/Cooldown_Reduction, which states no cap).
- Compress → Superior → Transcendent Cooldown is **one upgrade line**: each consumes the one
  before, so a build holds only one of them.

| Setup                                | Items (class name)                                                      | CDR (live 2026-11-06) | Souls  |
| ------------------------------------ | ----------------------------------------------------------------------- | --------------------- | ------ |
| Compress Cooldown, on this ability   | `upgrade_magic_tempo`. It "imbues" one ability, so it only counts there | 18%                   | 1,600  |
| Superior Cooldown                    | `upgrade_cooldown_reduction`                                            | 20%                   | 3,200  |
| Transcendent Cooldown                | `upgrade_transcendent_cooldown`                                         | 25%                   | 6,400  |
| Transcendent Cooldown + Spellslinger | `upgrade_transcendent_cooldown` + `upgrade_enchanted_holsters`          | 28.75%                | 12,800 |

Each setup's souls are its full cost, counting the components it builds from: Superior is
3,200, which includes the Compress it consumes.

Left out, with the reason:

- **Enchanter's Emblem** (5%) only works while above 65% health. Conditional, so it's noted
  in the page's tooltip and not in the ladder;
- **Witchmail** cuts seconds off a random ability's cooldown when the hero takes heavy spirit
  hits. It isn't a % CDR, even though the API lists `CooldownReduction 7`;
- **Mystic Conduit** (40%) is tier 5, Street Brawl only (CLAUDE.md);
- ability upgrade tiers that cut cooldown are already in the T3 cooldown (§3.5).

**Output per ability**, for each fight length: avg casts per fight with no items, then one
row per setup showing casts with the setup, the damage gain, and gain per 1,000 souls. The
setup with the best gain per soul is highlighted. For example: "Transcendent Cooldown (6,400):
2.5 → 3.33 casts in a long fight, +33%". A setup that adds nothing says so. All of
this is a display annotation. It doesn't change any rank. Ranks stay item-free (§3), so
heroes are compared on the same footing.

### 3.4 Rank-aware accuracy

The user, 2026-11-06: lower-ranked players likely aim worse than higher-ranked ones. The
live data agrees (`getHeroAccuracy()`, shots hit ÷ shots fired, 2026-11-06). Accuracy rises
with rank for nearly every hero, but by very different amounts:

| Hero       | Initiate (1) | Mystic (5) | Phantom (9) | Eternus (11) | Change |
| ---------- | ------------ | ---------- | ----------- | ------------ | ------ |
| Lady Geist | 53.6%        | 59.6%      | 63.5%       | 66.6%        | +13.0  |
| Yamato     | 50.1%        | 56.4%      | 60.6%       | 63.3%        | +13.2  |
| Viscous    | 48.4%        | 52.5%      | 55.8%       | 60.5%        | +12.1  |
| Wraith     | 49.4%        | 54.7%      | 55.9%       | 54.8%        | +5.4   |
| Bebop      | 49.6%        | 52.1%      | 52.7%       | 53.2%        | +3.6   |
| Lash       | 47.4%        | 50.2%      | 50.8%       | 50.3%        | +2.9   |
| **Shiv**   | 50.1%        | 48.5%      | 45.3%       | 45.4%        | −4.7   |

Since the slopes differ, **landed DPS can reorder heroes by rank**, and that's the point of
the feature. The model doesn't assume accuracy rises with rank: Shiv's falls, and Wraith's
peaks at Phantom.

**How it's computed.** `accuracy(hero, rank)` reuses `resolveAccuracyAtRank(accuracy,
rankTier)` from `lib/analyticsStore.ts`, unchanged:

- `rank = null` (the default, "All ranks") uses each hero's pooled accuracy;
- a rank tier where a hero has fewer than 100,000 shots (`MIN_SHOTS_FOR_ACCURACY`) falls back
  to that hero's pooled value. Choosing a rank can only refine the estimate, never break it;
- a hero with no accuracy data at all, as Graves has none live, gets the **median of the
  roster at that rank**. Ties go to the lower value, so the result doesn't depend on
  roster order. The page marks that value "estimated".

**Where it applies.** Only to things that depend on landing bullets:

- the landed DPS lead metric, and so the lean's `G` (§4.1). **The lean is rank-aware**: the
  same hero can lean Flexible at Initiate and Gun at Eternus;
- Card Trick's card generation (§3.2.1);
- not abilities. The API has no ability hit rates, so every ability is assumed to land. So
  at low ranks, gun numbers carry an aim penalty and ability numbers don't. Part of that is
  real, since many abilities are easier to land than sustained fire, but part is the model.
  The page says so wherever accuracy applies.

**What the data measures.** `total_shots_hit` counts every hit, not only hits on heroes. So
heroes who farm a lot, or have spread weapons (Calico's 9 pellets), read differently than
their duel accuracy would. It's the same data `heroNeed` already uses, with the same caveat.

**UI.** A rank picker on `/heroes/[id]` and `/heroes/compare`, with tier names from
`getRankTiers()`: "All ranks", then Obscurus through Eternus. It's a `?rank=<tier>` URL
parameter, so the server ranks for that tier and the link is shareable. It defaults to "All
ranks". The picker follows the build planner's rank selector.

### 3.5 Ability metrics

The pool is every damaging ability of every hero in the filtered roster (about 176).
Abilities with no damage property are labelled "utility" and not ranked.

Spirit and weapon coefficients are different units (damage per spirit power vs. per % weapon
damage), so they get **separate pools**: spirit-scaled abilities rank against spirit-scaled
ones, weapon-scaled against weapon-scaled. Ultimates stay in the same pool as other
abilities; the per-fight metrics are what keep that fair.

| Metric                      | Formula (all at T3)                                   | Better |
| --------------------------- | ----------------------------------------------------- | ------ |
| **Scaling per cast** (lead) | coefficient × `damagePerCastFactor`                   | higher |
| Scaling per fight (short)   | scaling per cast × `castsInFight(ability, 10)` (§3.2) | higher |
| Scaling per fight (long)    | scaling per cast × `castsInFight(ability, 30)` (§3.2) | higher |
| Base damage per cast        | `baseDamage(T3) × damagePerCastFactor`                | higher |

"At T3" means base values plus every upgrade tier's `statChanges` for the damage key: flat
bonuses go to the base, `scale: true` bonuses go to the coefficient, and `AbilityCooldown`
deltas go to the cooldown. O.3 reuses `calculateAbilityDamage` at level 3 if it already does
this, and adds a pure helper next to it if not.

**This ranks each ability's ceiling.** At 30k souls a hero has 26 ability points, and maxing
all four abilities costs 32. So the ranks show each ability fully upgraded, not a full kit at
30k. The UI says so.

## 4. Ranking method

For one metric over a pool of `n` heroes or abilities with known values:

- `rank` = 1 + the number of entries strictly better;
- `percentile` = (number strictly worse + 0.5 × (number equal − 1)) ÷ (n − 1) × 100. The best
  entry gets 100 and the worst gets 0; tied entries share the same value;
- with `n < 2` there's no percentile, and the UI shows "—";
- for "lower is better" metrics, the comparison is reversed;
- **display order is fixed**: sort by value, then by hero id (or ability classname). Shuffling
  the input never changes the output.

The UI shows rank and percentile together: "7th of 38 · top 16%". `n` is always shown,
because 38 heroes is a small sample.

### 4.1 Late-game lean (fixed rules, no AI)

From the two lead percentiles, gun landed DPS at the selected rank (`G`, §3.4) and kit
spirit scaling (`S`):

| Rule                  | Lean     |
| --------------------- | -------- |
| `G ≥ 65` and `S < 50` | Gun      |
| `S ≥ 65` and `G < 50` | Spirit   |
| `G ≥ 65` and `S ≥ 65` | Hybrid   |
| otherwise             | Flexible |

The thresholds are named constants (`LEAN_STRONG = 65`, `LEAN_WEAK = 50`), approved
2026-11-06. `S` is the short-fight kit spirit scaling (§3.2). The lean is a plain fact the M6 coach can quote later through
`coachContext.ts`. That bridge isn't part of this milestone.

## 5. Architecture

```
fetchVisibleHeroesEnriched() ─┐                       lib/heroProfile/
  (roster HeroBaseStats)      ├─► server page ──► rankRoster(roster, kits)  ──► RosterProfile
per-hero abilities ───────────┘   /heroes/[id]    rankAbilities(kits)            (plain data)
  (mapHeroAbilities)                                                                 │
                                                       HeroRosterRankSection ◄───────┘
```

- **`lib/heroProfile/metrics.ts`**: the metric table (§3), one pure function per metric.
- **`lib/heroProfile/percentiles.ts`**: `percentileRank` (§4), `rankRoster`,
  `rankAbilities` and `lateGameLean`. Pure and deterministic. Doesn't import from
  `lib/scoring/` or `lib/coach/`.
- **Data**: `/heroes/[id]` already loads this hero's stats and abilities. It also needs the
  roster's stats (`fetchVisibleHeroesEnriched()`, cached) and every roster hero's abilities.
  O.3 checks whether `fetchAbilityItems()` (one call) maps cleanly onto `HeroAbilityRaw`.
  If not, it uses `fetchHeroAbilityItems` per hero, cached hourly like `getHeroStats`.
- **UI**: `app/heroes/components/HeroRosterRankSection.tsx`, presentational and built with the
  panel-builder conventions. One bar per metric (percentile fill with value, rank and `n`),
  grouped Gun / Melee / Vitality / Spirit. Then the lean badge, then a list of the hero's
  abilities, each with its rank in its pool.

## 6. Decisions (the user, 2026-11-06)

1. **Lean thresholds**: 65 / 50, as proposed.
2. **Resist units** (§2.2): verified in O.1. They're percentage points, and starting, boon
   and spirit-scaled resist add.
3. **Per-fight metric**: casts per fight, **plus** a long-fight analysis (§3.2). Strong
   abilities also show what cooldown reduction items add (§3.3). The user briefly chose whole
   casts, then weighed the pros and cons and settled on **fractional casts** (average per
   fight) the same day. Whole casts and rounding down were both rejected. Rounding down
   scores every ability whose cooldown is longer than the fight at 0.
4. **Roster compare table**: in scope, as O.5. `/heroes/compare` is a sortable table of every
   hero × the lead metrics (short and long fight), with the lean column. The ranking runs on
   the server, and the client component only sorts (sorting by value, then hero id).
5. **No blanket cast cap** (the user, 2026-11-06, on Card Trick). Each ability's casts come
   from what actually limits it (§3.2.1). **Still open:** the in-game checks listed there
   (Card Trick's starting bank and how CDR speeds up card generation, Jar of Dead's restore
   time, Aura of Suffering's cycle). O.3 shipped with them open (the user, 2026-11-07); they come back later in the milestone, and each one only
   changes its gate's formula.
6. **Rank-aware accuracy** (the user, 2026-11-06). Gun metrics that need bullets to land
   use the hero's accuracy at the selected rank, and the page has a rank picker (§3.4).
   Abilities stay accuracy-free, because the API has no ability hit rates.
7. **HP scaling** (the user, 2026-11-06): health per boon and health growth are metrics
   (§2.2.1). Effective HP vs bullets and vs spirit was already in, built on boon 30
   health.
8. **EHP stays separate** (the user, 2026-11-06): bullet and spirit EHP are two metrics,
   with no blended headline. If a blend is ever added, it weights **spirit 65%, bullet
   35%**: `EHP_SPIRIT_WEIGHT = 0.65`, the user's call, not measured.
9. **Spirit-scaled hero stats count** (the user, 2026-11-06), at boon spirit power: damage
   per bullet, clip, fire rate, heavy melee and move speed (§2.2.1).
10. **Open: Pain Battery's casts** (found in O.3, §3.2.1). It's charged by damage Victor
    takes, 40% of max HP per charge. It counts one charge per fight until the user picks a
    model. The options are to keep one charge, or to add a damage-taken-per-fight assumption
    (unmeasured). O.3 shipped with one charge; the choice comes back later in the milestone
    (the user, 2026-11-07).

## 7. Acceptance criteria

### 7.1 Fixtures (`npm run mini`)

A new frozen snapshot, `lib/engine/__fixtures__/frozen/abilityRoster.json` (every roster
hero's `abilitiesRaw`, `heroItems` and `baseStats`), captured by `captureInputs --ability-roster`. It's a
separate file so `inputs.json` and the engine baselines don't change.

- **Bounds**: every percentile is in [0, 100]; the best entry is 100 and the worst is 0.
- **Determinism**: running `rankRoster` / `rankAbilities` on a shuffled roster gives the
  same output, compared value by value.
- **Ties**: heroes with zero resist share one percentile, and their ranks are equal.
- **Unknowns**: a hero with `dpsWithReload = 0` is left out of the gun pool, and that pool's
  `n` drops by one.
- **Direction**: reload time ranks lower-is-better.
- **Known anchors**, on the frozen roster (`inputs.json`, 44 heroes, captured 2026-10-25):
  - Mo & Krill has the top max health;
  - The Doorman tops damage per bullet at boon 30 (61.5) but not sustained DPS, and Paige
    tops it at boon 0 (35). Corrected in O.2: the first draft said Paige leads per bullet
    at boon 30 and trails Calico on DPS. The snapshot shows neither;
  - Graves has no accuracy data and gets the estimate.
- **Resist anchors**: Dynamo and Kelvin top bullet and spirit resist at boon 30. That
  snapshot predates resists, so these checks run in O.3 against `abilityRoster.json`, which
  carries fresh `baseStats`.
- **Pools**: no ability shows up in both the spirit and weapon pools; utility abilities show
  up in neither.
- **Lean**: each of the four rules in §4.1 is tested with made-up percentiles.
- **Fight length**: `castsFromCooldown(cd, 10) === castsPerTrade(cd)` for cooldowns 0, 5,
  9.99, 10, 12, 30, 120 and 200. It matches the §3.2 examples table for both fight lengths.
  Casts never go down as `F` grows or as `cd` shrinks.
- **Long ≥ short**: no ability's long-fight scaling is below its short-fight scaling.
- **CDR stacking**: the Transcendent + Spellslinger setup computes as `1 − 0.75 × 0.95`,
  and each setup's souls include its components (Superior 3,200, not 4,800).
- **CDR impact**: a 12 s ability gains +1.6% in a short fight from Compress (18%) and +22% in
  a long fight. Transcendent (25%) gives a long fight +33% (2.5 → 3.33). Card Trick's throw
  cooldown never changes, and only its generation term grows. An ability below
  `CDR_SPOTLIGHT_PERCENTILE` gets no annotation. Gain never goes down as `r` grows. Adding
  CDR never changes any rank.
- **Cast gates**: on the frozen ability snapshot, Card Trick is the only resource gate, Jar
  of Dead the only charges gate, Aura of Suffering the only channel gate, and Pain Battery
  the only battery gate (added in O.3). If the roster
  changes and that list grows, the fixture fails so the new ability gets reviewed. Every
  value in the §3.2.1 examples table matches, Card Trick at a fixed 50% accuracy.
- **No cap**: a 2 s cooldown gets 5 short-fight casts (made-up; Pain Battery turned out to be
  battery-gated, §3.2.1). For any `cd ≥ 5`,
  `castsFromCooldown(cd, 10) === castsPerTrade(cd)`.
- **Channel**: Aura of Suffering's damage seconds never exceed `F`.
- **Card Trick inputs**: throws never exceed `F / 0.6`. Card generation scales linearly
  with accuracy.
- **Rank-aware accuracy**, on the frozen `heroAccuracy` snapshot already in `inputs.json`:
  - `rank = null` uses pooled accuracy;
  - a tier below the shot minimum falls back to pooled;
  - a hero with no data gets the roster median at that rank, and shuffling the roster
    doesn't change it;
  - changing rank changes landed DPS and Card Trick, and nothing else: on-paper DPS,
    vitality, spirit and ability ranks are identical at every rank;
  - a hero whose accuracy falls with rank (Shiv in the snapshot, if it holds there) gets
    lower landed DPS at the higher rank. There's no monotonic assumption;
  - the lean is recomputed per rank, tested with a made-up roster where the lean flips
    between two tiers.
- **Live CDR values**: a ladder item missing from the live item data drops that setup and
  logs a warning. It never shows a hardcoded percentage.

### 7.2 Live guard

A `src/scripts/mini.ts` check runs on the live roster. Every hero gets a `RosterProfile`, and
no lead metric has `n < 30`. That catches a broken fetch that drops most of the roster.

## 8. Out of scope / later

- **Ranks in scoring.** Display-only for now. Feeding them into `heroNeed` or the basket
  would be a scoring PR with its own fixtures, kept separate from UI and AI-layer changes.
- **Ability-centric builds.** Pick an ability and get items that boost it most (spirit
  scaling, cooldown, duration, charges). Only possible once O.3's T3 ability values exist.
  That work would be its own milestone.
- Sprint, stamina, dash, and gun range metrics (§2.3).
- **Anchor the engine's gun model to Valve's DPS** (§3.1 notes). `heroBasket.ts` builds its
  `GunProfile` with an overhead that clamps at 0 for 12 heroes, so its sustained gun DPS is
  19–79% low for Calico, Pocket, Shiv, Mo & Krill, Yamato, Baba and others. That likely
  undervalues gun items for them. It's a scoring PR, with baseline review, and the pellet
  count (`weapon_info.bullets`) is the likely fix.
- **Cast gates in the engine** (§3.2.1). The engine still caps every ability at 2 casts per
  10 s, so item pricing undervalues Card Trick, and with it fire rate and CDR on Wraith, while
  overvaluing Aura of Suffering's damage seconds. Moving the gates into `heroDamage.ts` is a
  scoring PR, with baseline review.
- **Charges on cooldown-gated abilities** (§3.2.1): extra charges that share one cooldown
  don't add casts, the same as the engine.
- **Fire-rate item ladder** for resource-gated abilities (§3.3). Only a +10% sensitivity
  ships here.
- **Card Trick melee and headshot card generation** (§3.2.1). Body shots only, for now.
- **Ability hit rates by rank** (§3.4). Not in the API. If a source appears, abilities could
  get the same rank-aware discount as guns.
- **Rank-aware accuracy in the build planner's own stat panels.** The planner already has a
  rank picker for item scoring; reusing it for these ranks is a follow-up.
- **The engine's short-fight flat stretch** (§3.2): cooldowns from 10 to 30 s all count 1
  cast. A readiness model that separates them would be an engine (scoring) PR.
- A rank panel in the build planner (`BuildClient`).
- **Ability damage keys the shared mapper misses** (found in O.3, 2026-11-07).
  `mapApiAbilityToHeroAbility` only reads damage properties with a damage `css_class`, and
  skips keys matching `Percent|Pct|Bonus`. So:
  - **Solomon's whole kit reads as utility.** None of his damage properties carries a
    `css_class` (Setup Bishop `ImpactDamage 70`, ×2.0 spirit; Rook Battery `Damage 50`,
    ×0.9; Develop Queen `Damage 120`, ×1.6). The profile shows his kit metrics as unknown,
    and the engine prices his basket with no ability damage;
  - **Drifter's damage reads as 0.** Rend's `BonusDamage 40` (×1.4 spirit) and Stalker's
    Mark's `DotHealthPercent` are skipped.

  Fixing the mapper changes engine inputs, so it's a scoring PR with baseline review. The
  profile reads the same mapper, so its ranks follow the fix automatically.

- **The engine's Pain Battery and Aura of Suffering.** The engine counts Pain Battery as a
  2 s cooldown (capped at 2 casts per trade) and Aura at `MinDPS`. That belongs with the
  cast-gates scoring PR above.

## 9. Work items

| PR  | Item                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| O.0 | This doc, signed off                                                                                                  |
| O.1 | Resist fields: `fetchHeroStats`, `HeroBaseStats`, mini literal; data-verifier on units                                |
| O.2 | `lib/heroProfile/` hero metrics + `percentileRank` + rank-aware accuracy + lean + `castsInFight`; §7.1 hero fixtures  |
| O.3 | Ability T3 values, ability pools (short + long fight), CDR impact (§3.3), `abilityRoster.json`; §7.1 ability fixtures |
| O.4 | `HeroRosterRankSection` + rank picker (`?rank=`) on `/heroes/[id]`; §7.2 live guard                                   |
| O.5 | `/heroes/compare` sortable roster table (§6 Q4)                                                                       |
| O.x | Vercel Image Optimization off (`next.config.ts` `images.unoptimized`), §11; rides along with O.3                      |

## 10. Results

**O.3** (`lib/heroProfile/abilities.ts`, `abilityRanks.ts`, `cdr.ts`; snapshot
`abilityRoster.json`, 44 heroes, captured 2026-11-07):

- **176 abilities:** 115 in the spirit pool, 5 in the weapon pool, 7 unscaled damaging (base
  damage rank only) and 49 utility;
- **gates:** Card Trick resource, Jar of Dead charges, Aura of Suffering channel, Pain Battery
  battery; the rest are cooldown;
- **top short-fight spirit scaling per ability:** Aura of Suffering 5.76, Card Trick 5.53,
  Arctic Beam 4.90, Siphon Life 4.32;
- **top kit spirit scaling (short):** Victor 8.4, Infernus 7.0, Lady Geist 6.8, Ivy 6.7;
- **lean, all ranks:** Abrams, Lady Geist, Yamato and Seven lean hybrid. Drifter, Apollo,
  Venator and others lean gun. Infernus, Ivy, Warden and Wraith lean spirit. Solomon has no
  lean (kit unknown, §8);
- **resist anchors hold:** Dynamo tops bullet resist and Kelvin spirit resist, 18.75 each;
- **engine harness section 41:** 24 checks.

## 11. Side item: Vercel Image Optimization off (2026-11-07)

Not hero-profile work; it rides along with O.3 so it ships before the quota resets.

- **Why:** Vercel warned the project had used 75% of its Image Optimization transformations.
  A transformation is one uncached (source × width × quality × format) version.
  `assets-bucket.deadlock-api.com` sends no `Cache-Control`, so cached versions expired
  after Next 16's default `minimumCacheTTL` (4 hours). Every icon that got traffic was then
  transformed again.
- **Where:** only `HomeHeroPicker` (homepage hero grid) and `MatchIcon` (`/match` hero and
  item icons) use `next/image`. Every other page already uses plain `<img>`.
- **Change:** `images.unoptimized: true`. `<Image>` serves the source URL as is, so
  transformations drop to zero. The sources are ~10 KB WebP behind Cloudflare, shown at
  24–56 px, so optimization saved almost nothing. Fixture 16 asserts the flag.
- **Later:** if optimization comes back (e.g. for large hero art), set `minimumCacheTTL`
  to 31 days, `formats: ["image/webp"]` and `qualities: [75]`, and opt in per image
  rather than globally.
- **Speed Insights:** `@vercel/speed-insights` is installed, and `<SpeedInsights />` is
  mounted in `app/layout.tsx`, so every route reports real-user Core Web Vitals on Vercel.
  It sends nothing in local dev. That makes the effect of turning image optimization off
  measurable. Fixture 16 asserts the root layout mounts it.
