# Engine Design Notes (lib/engine/)

Moved out of CLAUDE.md so it is loaded only when working on the engine. This is
the design record for Milestone E's hero-aware basket scoring and everything
built on it since: gun need and accuracy, range falloff, defence split, item
coverage audit, published scaling coefficients, proc classes, shred/anti-heal,
and the positive-synergy table. Read the section for the code you are touching
before changing it; most entries record a bug that already happened once.

Originally titled "Milestone E Design Decisions (locked before coding)".

## Origin and architecture

Portfolio-theory-inspired itemization scoring, scoped across two research
passes, a `data-verifier` spike, and a direct read of the real `lib/engine/`
and `lib/analyticsStore.ts` code (full reasoning in session history — this
section captures the decisions, not the exploration). The direct-code pass
corrected and shrank the original scope in two important ways, both folded in
below.

**Correction 1 — empirical data is already integrated, not just "available."**
`lib/analyticsStore.ts` (`getItemAnalytics()`/`getHeroAnalytics()`) and
`lib/api/analyticsApi.ts` already fetch, cache, and fail-open against
`/v1/analytics/item-stats` and `/v1/analytics/hero-stats` — real per-item
`{ matches, wins, losses, winRate }`, joined via `Item.numericId` (which
already exists on `Item` specifically for this join, per
`lib/itemNormalizer.ts:97`). This is already wired into `/items` display
pages (`app/items/page.tsx`, `app/items/[id]/page.tsx`) but **never
consumed by scoring**. This means Milestone E can ship a real (small,
explicitly bounded) empirical adjustment term on day one instead of
deferring all empirical signal to Milestone F — see the marginal-value
design below. Milestone F's scope narrows accordingly: it's specifically
about per-match item-_combination_/covariance analysis from
`/v1/matches/{id}/metadata` (genuine correlation between item choices),
since single-item empirical win rate is no longer a gap.

**Note on the fixture gate.** `npm run mini` chains BOTH harnesses —
`package.json` defines it as `npx tsx src/scripts/mini.ts && npx tsx
lib/engine/__fixtures__/mini.ts`. They are two separate runners with
separate assertion counts and separate `process.exit(1)` paths, not one
suite: `src/scripts/mini.ts` covers `lib/scoring/` + guide data, and
`lib/engine/__fixtures__/mini.ts` covers `lib/engine/`. New Milestone E
fixtures belong in the engine harness. Both must pass for the gate to pass;
`&&` means an early failure in the first masks the second, so read the whole
output, not just the exit code.

**Architecture:**

- Lives in `lib/engine/` (the WIP staged-pipeline surface), not
  `lib/scoring/` — `ItemCandidate.categoryValues` is already a continuous
  per-`ScoreCategory` vector, the shared representation Milestone F needs to
  plug covariance coefficients into later without restructuring anything
- No `Item` → `ItemCandidate` adapter exists yet — `lib/engine/` currently
  only runs against synthetic fixture candidates. New:
  `lib/engine/itemAdapter.ts::toItemCandidate(item: Item): ItemCandidate`,
  and `ItemCandidate` needs a new `numericId: number` field (from
  `Item.numericId`) specifically for the `ItemAnalytics` join
- `damage` splits into `gunDamage`/`spiritDamage` in `SCORE_CATEGORIES`/
  `ItemCandidate.categoryValues` — a single `damage` dimension can't tell a
  spirit-leaning hero's needs from a gun-leaning hero's. Verified low-risk:
  `baseCategoryStage`'s `INTENT_TO_CATEGORY` maps `burst` → both new
  categories at full weight each (not split), which preserves every existing
  `lib/engine/__fixtures__/mini.ts` assertion exactly, since a candidate's
  combined damage contribution is invariant to how it's divided between the
  two — TypeScript's `Record<ScoreCategory, number>` on `ItemCandidate` will
  also compile-error every fixture object that isn't updated, so the
  refactor is safe-by-construction under strict mode
- Need-vector derivation (`lib/engine/heroNeed.ts::deriveHeroNeedVector()`)
  outputs `Readonly<Record<ScoreCategory, number>>` directly — it does NOT
  go through `EngineInput.intent`/`IntentKey`/`normalizeIntent()`, which
  stays untouched to protect the existing player-preset-driven
  `recommendItems()` path and its five passing fixtures. Mechanical where
  the data supports it (gun/spirit lean from summed `spiritScaling`/
  `weaponScaling` in `lib/abilityCoefficients.ts`; tankiness/mobility from
  cross-hero z-scored `HeroBaseStats`); explicitly stubbed neutral, not
  faked, where it doesn't yet (sustain/utility — deferred to Milestone G; sustain now comes
  from the kit, G3)
- Basket selection (`lib/engine/basketSelect.ts::constructBasket()`) is
  greedy budgeted-maximum-coverage: marginal value per candidate =
  need-vector coverage gain (diminishing per category) + category-bonus
  threshold gain (reusing `lib/categoryBonuses.ts`'s
  `isApproachingSignificantBonus`/`getCurrentBonusTier`, the same logic
  `scoreItems.ts` already applies) + an optional, small, explicitly-bounded
  empirical term from `ItemAnalytics.winRate` (via the join above) — this is
  what makes the algorithm trade off concentrating souls in one category
  (game-native bonus ladder) against diversifying for a multi-category hero
  need, instead of hand-waving a "risk" number, while also folding in real
  empirical data from day one
- The marginal-value function is composed as pluggable additive terms
  (`baseMarginalValue + Σ adjustments`) so Milestone F's later per-item-pair
  covariance output can add one more term without touching the greedy loop,
  the need-vector deriver, or the UI
- New UI surface (`HeroBasketSuggestion.tsx`) is additive/opt-in in
  `BuildClient.tsx`, not a replacement for `SuggestedItemsPanel.tsx`'s
  existing `scoreItems()` path — keeps this revertible and in its own PR,
  consistent with the "AI layer changes and scoring changes must be in
  separate PRs" rule (this isn't AI, but the same separation logic applies
  to "new joint-selection scoring" vs. "existing independent-ranking
  scoring")
- Fixtures are synthetic/hermetic (matching the existing pattern) — no live
  API calls inside the fixture run itself, including for the analytics term
  (pass a synthetic `Map<number, ItemAnalytics>`, don't call
  `getItemAnalytics()` from a fixture). A one-time live fetch against a real
  hero (e.g. Lady Geist, the motivating example) is a manual sanity check
  during implementation, not an automated fixture

**Two decisions that emerged during implementation (both fixture-locked):**

- **Relevance gate.** `categoryBonusTerm`/`analyticsTerm` return `null` unless
  the candidate covers some un-met need. Without it the investment bonus alone
  could make an item with zero relevance score positive, so the basket bought
  filler purely because its price tipped a category over a tier line (and
  `"no-positive-value"` became unreachable). The investment bonus is a reason
  to prefer one _useful_ item over another, never to buy a useless one.
- **Gun need is an INDEPENDENT signal, not a share of the damage budget.**
  `spiritDamage` comes from ability scaling coefficients; `gunDamage` comes
  from the hero's own gun DPS versus the roster. These are genuinely
  independent in Deadlock — a hero's abilities can scale 100% off spirit
  while their gun is still among the best in the game, and gun items scale
  that gun regardless of what the abilities do. Splitting one budget between
  two shares forces those facts to compete and wrongly reads a spirit hero as
  having no gun need. Two rules fall out of the live data:
  - **Measure gun strength as damage × fire rate, never damage alone.** Paige
    has the roster's highest per-shot damage (35.0) at 1.67 shots/s; Calico
    does 1.8 at 42.86 shots/s. Only the product is comparable.
  - **Gun need is NOT compensating** (unlike tankiness/mobility): a strong gun
    steers you toward gun items, because weapon items scale the gun you
    already have. `MIN_GUN_FACTOR` floors it so the worst gun stays reachable
    (zero would be dropped by the relevance gate — every hero has a gun).
  - **Nominal gun DPS is discounted by observed shot accuracy**, optionally at
    the player's own rank — see "Gun accuracy" below.

## Gun accuracy (rank-aware)

`/v1/analytics/hero-stats` carries `total_shots_hit`/`total_shots_missed`, and
`?bucket=avg_badge` partitions every hero by rank (bucket = `tier * 10 +
subrank`, bucket 0 = unranked; ~38 heroes × 67 buckets). `getHeroAccuracy()`
in `lib/analyticsStore.ts` aggregates these into per-hero pooled + per-tier
accuracy; `resolveAccuracyAtRank()` flattens it for one rank. Rank tier names
come from `/v1/assets/ranks` (`getRankTiers()`) — **fetch them, never hardcode**:
they are 0 Obscurus, 1 Initiate, 2 Seeker, 3 Acolyte, 4 Sentinel, 5 Mystic,
6 Ritualist, 7 Emissary, 8 Oracle, 9 Phantom, 10 Ascendant, 11 Eternus, which
are easy to misremember.

Why it matters: nominal DPS assumes every shot lands, systematically
over-rating spread weapons whose fire rate counts each pellet. Verified live —
accuracy spans 38.7% (Vyper) to 62.4% (Silver), and the discount reorders gun
need substantially: Vyper 1.72 → 1.33, Calico 1.32 → 1.13, while Lady Geist
rises 1.07 → 1.30 because her shots actually connect.

Two things to preserve when touching this:

- **Discount the hero AND the roster with the same policy.** Gun strength is a
  z-score against the roster; comparing a discounted hero to nominal peers is
  meaningless.
- **Missing accuracy ≠ zero accuracy, and "inapplicable" ≠ "unknown".** Absence
  from the accuracy map covers TWO cases that must not be conflated:
  - **Accuracy inapplicable** — the weapon's shots are not counted discretely,
    so it cannot miss. Verified live: Graves alone, with an analytics row over
    536,097 matches reporting `total_shots_hit` 0 AND `total_shots_missed` 0.
    Flagged via `WEAPON_PROFILE_OVERRIDES`' `cannotMiss` in `heroNeed.ts` and
    treated as 1.0. Her range weakness is priced by the falloff term instead
    (see below) — charging a miss penalty too would double-count it.
  - **Accuracy unknown** — no analytics row at all. Verified live: 5 heroes
    (Deadman Danny, Solomon, Violet, Nurse Harrow, Baba), all recent additions
    with no match data. These fall back to the median of heroes that DO have
    data — never 1.0, which would leave them undiscounted while every peer is
    discounted, inflating them into looking like the roster's best gun.

  This bit during implementation: treating all absences as `cannotMiss` pinned
  Violet and Nurse Harrow at the maximum gun need of 2.000, **above Drifter**,
  the roster's actual best gun. A hero missing from analytics is the common
  case, not an edge case — check which of the two you're in.

Emergent and correct, not coded in: Calico's gun need _falls_ at higher rank
(1.16 Initiate → 1.10 Eternus) while Geist's rises (1.25 → 1.38), because
Calico's accuracy improves only +4.2pp across ranks against Geist's +12.6pp —
a spread weapon benefits less from better aim than a precision one.

**`weapon_info` — partially wired.** `GET /v1/assets/items/{weapon_class}`
(class name is on `hero.items.weapon_primary`) returns a `weapon_info` block
holding ground truth the accuracy ratio only approximates. One piece of it is
now consumed; two are deliberately not, because they need a design decision
this repo hasn't made:

- **Wired.** `damage_per_second_with_reload` — Valve's own sustained-DPS
  figure, reload downtime included — flows through
  `fetchHeroStats` → `HeroBaseStats.dpsWithReload` →
  `heroNeed.ts::nominalGunDps()`, which discounts the naive
  `bulletDamage × bulletsPerSecond` product by the ratio
  `dpsWithReload / (bulletDamage × bulletsPerSecond)` at base (boon 0), then
  applies that ratio to the boon-scaled product — so boon growth and reload
  downtime stay two independently-correct effects instead of getting
  conflated. Verified live against Graves: naive 35.3 vs 20.2 with reload (the
  documented 43% overstatement), ratio 0.572, matching exactly. A hero with no
  reload data (`dpsWithReload` 0 — the pre-existing fixture default, or any
  real hero whose `weapon_info` fetch failed) gets ratio 1, i.e. no discount:
  the same fail-open policy this module already applies to missing accuracy
  data.
- **Wired.** The range/falloff profile — `damage_falloff_start_range` /
  `_end_range` / `_start_scale` / `_end_scale` plus the hard `range` cap — flows
  through `fetchHeroStats` (converted to **metres** there, ÷39.37, so no
  consumer repeats the divisor) → `HeroBaseStats` → `heroNeed.ts`'s
  `rangeEfficiency()`. See "Range falloff" below.
- **Captured in the raw API type, NOT surfaced into `HeroBaseStats` or scoring
  yet** — `lib/api/deadlockApi.ts`'s `WeaponItemRaw["weapon_info"]` documents
  it, but no consumer exists:
  - `bullets` — pellets per shot. Calico is `bullets: 9`, which is _why_ she
    reads 43.5% accuracy: it is a shotgun, not bad aim. Verified live it is
    already baked into `bullets_per_second` (bullets_per_second =
    shots_per_second × bullets), so it is NOT needed for the DPS math above —
    only useful as an explanatory signal, not a required input. Do NOT multiply
    by it: that would inflate shotgun heroes ~9×.

## Range falloff (wired, with one hand-authored exception)

Nominal DPS assumes every shot deals full damage regardless of distance.
`rangeEfficiency()` in `heroNeed.ts` turns a weapon's falloff curve into one
expected-damage multiplier over `ENGAGEMENT_RANGE_WEIGHTS`, an assumed 5–30m
distribution of engagement ranges.

**Those weights are an ASSUMPTION, not a measurement** — no endpoint reports
engagement distance, so nothing in the data can settle them. They are the
"lane-typical" calibration (55% of weight inside 17m). Retune in that one
constant; a fixture locks the 0.55 figure so a change forces a decision.

**This is orthogonal to the accuracy discount and composes with it** — the two
are not double-counting. Accuracy measures which shots LAND (a hit at 30m is
still logged as a hit); falloff measures how much damage a landed shot deals.
Neither term can observe the other's effect.

Verified live across all 44 heroes: `damage_falloff_start_scale` is 1 and
`damage_falloff_bias` is 0.5 for **every** hero, so the curve SHAPE cannot
reorder a cross-hero z-score — `rangeEfficiency()` interpolates linearly on
that basis. If either ever varies per hero, revisit it. 40 of 44 fall to
`end_scale 0.1`; the hard `range` cap varies more than the curve does (Apollo
25m, Bebop 32m, Rem 76m, the other 41 at 178m).

**`WEAPON_PROFILE_OVERRIDES` — the falloff fields do not mean the same thing on
every weapon.** Graves' The Teacher reports 7.62m→17.02m at `end_scale` 0.5,
which reads generically as "50% damage past 17m". **It is not.** Her weapon has
no damage falloff: it deals full damage to a hard 17m cutoff and **zero** past
it, and those range fields instead drive her Build-Up per bullet (most notably
Essence Theft). Reading them generically understates her in-range damage and
overstates her out-of-range damage at the same time. Nothing in `weapon_info`
distinguishes this case, so it is hand-authored game knowledge with the same
upkeep shape as `GOAL_WEIGHTS_MAP` — if another weapon shares the quirk we
cannot detect it from data and will silently mis-model it.

Two related mechanics are deliberately NOT modelled, since both are interaction
value (Milestone F territory), not per-hero gun strength: Essence Theft's
build-up scaling off that same falloff range, and Ricochet's own damage falloff,
which is measured from the main target to the ricocheted target rather than from
the shooter.

Live result: Graves derives the roster's **lowest** gun need (0.399 of 44). That
is correct for gun items that SCALE her gun — her 17m cutoff is by far the
earliest on the roster, where a typical hero holds full damage to 18–20m and
does not bottom out until ~55m.

**But "lowest gun need" is NOT the same as "no gun items", and the scalar hides
a real distinction.** Graves has genuine gun builds (confirmed from play, not
inferred from data): Heroic Aura + Mystic Shot ± Toxic Bullets as the normal
route into gun investment, and a Ricochet + Toxic Bullets ± Tesla Bullets build.
Verified against the live basket, those items rank 10th, 38th, 29th, 17th and
45th of 54 gun items for her — Mystic Shot and Tesla Bullets clearly too low.

Two hero×item interactions the per-item model structurally cannot see:

- **Proc frequency is not hero-aware.** Tesla Bullets is `ProcChance 15` /
  `ProcCooldown 0.2`; Toxic Bullets is `BuildUpPerShot 1.28`. Expected procs per
  second scales with SHOTS per second and with hit reliability, and Graves fires
  9.8/s and cannot miss — near the roster's best proc platform. The estimator
  applies one flat expected value for every hero.
- **Spirit-scaling procs are not spirit-aware.** Mystic Shot (`ProcChance 100`,
  `ProcBonusMagicDamage 40`) converts spirit power into gun-triggered damage and
  is priced as a flat `spiritDamage 27` with zero gunDamage. On a 100%-spirit
  kit that is a systematic underestimate.

So the right reading for a hero like this is "don't buy gun items that scale the
gun; DO buy per-hit proc items."

**Gap 1 is now BUILT; gap 2 is not.** `procPlatformTerm` in `basketSelect.ts`
scales a per-hit item by how well a hero lands hits, composed from two halves
kept deliberately apart:

- `ItemCandidate.procReliance` (hero-independent, `itemAdapter.ts`) — the share
  of an item's scored magnitude delivered per weapon hit, from the `perHit` flag
  on `EffectEstimate`.
- `BasketContext.procPlatformFactor` (hero-specific,
  `heroNeed.ts::deriveProcPlatformFactor`) — bullets landed per second versus
  the roster, bounded by `PROC_PLATFORM_SWING`.

Splitting it this way is what keeps per-item constants from being inflated to
compensate for one hero. The term is relevance-gated and roster-average-neutral:
factor 1.0 contributes exactly nothing, so it reorders per-hit items rather than
blanket-boosting them. Live: Graves is 2nd of 44 on proc platform (1.207) while
last on gun need — the divergence this exists to express.

**Honest limits of that fix, measured not assumed.** It moved her items only
modestly (Ricochet 17→14, Toxic Bullets 29→26, Tesla Bullets 45→44) and moved
**Mystic Shot not at all** (38→38). The term is bounded to 10% of one slot by
design, and more importantly it is not what holds Mystic Shot down:

**Gap 2 — spirit-scaling procs are still not spirit-aware.** Mystic Shot
(`ProcChance 100`, `ProcBonusMagicDamage 40`) converts spirit power into
gun-triggered damage and is priced as a flat `spiritDamage 27` regardless of the
buyer's spirit. That is the dominant reason it under-ranks on a 100%-spirit kit,
and it needs the item's value to scale with hero spirit power — a genuine
hero×item product, i.e. Milestone F. **Do NOT close it by raising
`PROC_PLATFORM_MAX_FRACTION`** — that inflates every per-hit item on every
high-fire-rate hero to fix one item's scaling, trading a known underestimate for
an unknown overestimate.

Known imprecision in the factor itself: `bulletsPerSecond` counts PELLETS, so
shotguns read high (Calico tops the roster at 1.350 on 42.9 pellets/s). Right
for per-bullet procs, wrong for per-SHOT build-ups like Toxic Bullets'
`BuildUpPerShot`; separating them needs `bullets` on `HeroBaseStats`.

What the floor already buys: gun items are not suppressed for her despite the
lowest need — 3 of 11 live basket picks are gun items, Spiritual Overflow among
them at #2, found via its spirit stats.

## Defence: flat health and % resist are separate categories

`tankiness` was split into `bonusHealth`/`resist` because they are not
interchangeable per hero. Effective HP is `health / (1 - resist)`, so a
percentage resist multiplies the pool a hero already owns: verified live, the
same +20% resist buys the roster's beefiest hero +801 EHP but its squishiest
only +401 — exactly 2x for identical spend. Resistance items really are weaker
on low-health heroes.

Defence resolves on two independent axes that compose:

- **How much** (`deriveDefensiveNeed`, compensating): below-average health →
  higher total defensive need.
- **Which kind** (`deriveHealthShare`, EHP-driven): below-average health →
  weighted toward flat health, both because it is worth more directly and
  because it raises the pool that later resist multiplies. Above-average
  health inverts.

Health is measured at max boon, not base — the two disagree about who is
squishy: Silver's base 830 is mid-roster, but at +28/boon she ends up 5th
lowest at cap.

Live result: Mina (1605 HP) 1.72 health / 0.96 resist; Graves (1885) 1.39 /
1.00; Mo & Krill (3205) 0.30 / 0.72.

**Barriers/shields are a THIRD defensive kind**, not a flavour of health.
`CombatBarrier`, `VexBarrierCombatBarrier` and `GuardianWardCombatBarrier` map
to the `shield` category. A barrier is a fixed absorb pool that does not scale
with max health, so — like flat health, unlike % resist — it is worth
proportionally more to a low-health hero, and it is cheaper per point of
effective HP (Reactive Barrier 325 absorb / 1,600 souls ≈ 4.9 souls per EHP vs
Fortitude 375 health / 3,200 ≈ 8.5). Offsetting that, barriers are
cooldown-gated and temporary (45-60s cooldowns, 8-10s durations), so
`SHIELD_SHARE_OF_FLAT` holds them to a minority of the flat-EHP budget rather
than letting them displace permanent health outright.

**These three keys were entirely unmapped before**, which scored every barrier
item at zero for its barrier: Reactive Barrier's whole 325 absorb was invisible,
leaving the item net-negative and effectively unbuyable. When adding an item
archetype, check that its defining stat key is actually in
`STAT_KEY_TO_SCORE` — an unmapped key fails silently.

## Item scoring coverage audit (all 156 live items)

A full audit found **26 items (17%) scoring exactly zero** — invisible to the
basket, since a zero-coverage candidate is dropped by the relevance gate. All
26 are now non-zero; the catalogue has **0 zero-scoring items** and exactly one
negative (Weighted Shots, correctly, for its real `BonusMoveSpeed: -0.5`).
Three distinct causes, each needing a different fix:

1. **A duplicate key for a stat already mapped.** `SpiritPower` is a second
   name for `TechPower`; verified live, the two NEVER co-occur (17 items use
   one, 6 the other, none both). Only `TechPower` was mapped, so 6 items lost
   all their spirit power.
2. **Meaningful stats never mapped** — `BonusFireRate` (17 items, multiplies
   weapon DPS directly), `BonusClipSizePercent`, `BonusMeleeDamagePercent`,
   `Stamina`/`StaminaCooldownReduction`, `TechRange`/`RadiusMultiplier`,
   `HeadShotBonusDamage`, `BonusAbilityDurationPercent`.
3. **Value that is an active/proc effect, not a stat** — see
   `lib/engine/effectEstimator.ts`.

**`effectEstimator.ts` produces ESTIMATES, not measurements.** Items like Tesla
Bullets carry no stat bonus at all; their worth is "15% chance to chain 33
damage to 4 targets". The estimator turns such parameter clusters into
expected-value contributions (`33 × 4 × 0.15 = 19.8`), then scales everything by
`EFFECT_CONFIDENCE = 0.5` so an inferred value can never outrank a comparable
measured stat. It deliberately does not model target count actually hit,
positioning, or whether a slow converts into a kill. Every estimate carries a
`basis` string so it is never an unexplained number.

## Item values are NOT flat — read the published scaling coefficients

`properties[key].scale_function.stat_scale` is Valve's own coefficient, and
`parseStats` used to discard it, keeping only `value` — which is just the BASE
of a scaling expression. Mystic Shot's `ProcBonusMagicDamage` is
**`40 + 0.9 x spirit power`**, not 40.

Measured live across all 173 shopable items: **29 `ETechPower`-scaled
properties on 22 items, median 1.5x understatement at 100 spirit power**, up to
3.3x (Mystic Shot), 2.9x (Mercurial Magnum), 2.7x (Spirit Snatch). It reaches
well past damage — Reactive Barrier's absorb is `325 + 1.8 x spirit` (325 ->
505), so the barrier souls-per-EHP figures above are understated for spirit
heroes.

Now captured by `lib/itemNormalizer.ts` into `Item.statScaling` and applied by
`lib/engine/itemAdapter.ts::resolveScaledStats(item, ctx?)`. Additive, the same
convention as `calculateAbilityDamage` (`value += stat x scale`). **Omitting
`ctx` returns the unscaled base**, so every hero-free caller and fixture is
byte-identical to before.

**Only 2 of the 8 published scaling types have a non-circular source**, and the
split is the whole design:

| Type                                                                                                         | Supplied by                                       | Resolved?                         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------- |
| `ETechPower`                                                                                                 | hero spirit + `TechPower`/`SpiritPower` items     | yes — 29 props, 22 items          |
| `ELevelUpBoons`                                                                                              | hero boon level                                   | yes — 8 props                     |
| `EItemCooldown` (99), `ETechDuration` (54), `ETechRange` (51), `EHealingOutput` (27), `EChannelDuration` (2) | OTHER ITEMS                                       | only from the already-owned build |
| `EBuildUpRate` (7)                                                                                           | nothing — no supplier key exists in the catalogue | captured, never applied           |

The item-supplied types resolve against the **already-owned build, never the
basket under construction**: an item's value must not depend on which other
items the basket happens to pick, or selection becomes circular.
Candidate-on-candidate scaling is item x item — Milestone F, deliberately not
modelled here.

Two traps when touching this:

- **Preserve the sign.** Alchemical Fire's `BulletArmorReduction` is -7 scaling
  at -0.055, so scaling makes the shred STRONGER (more negative). Clamping to
  positive silently inverts every enemy-debuff item — see the sign-convention
  warning above.
- **Only the single-stat form carries a coefficient.**
  `scale_function_multi_stats` publishes `scaling_stats` with NO `stat_scale`,
  so there is nothing to read and inventing one would be fabricating data.

**`SpiritPower` is a second API name for `TechPower`** — and the two modules
disagreed. `lib/buildCalculations.ts`'s `SPIRIT_POWER_KEYS` listed only
`TechPower` while the engine's `STAT_KEY_TO_SCORE` counted both, so
`totalSpiritPower` silently dropped up to 20 per item. Verified live: 19 items
use `TechPower`, 6 use `SpiritPower` (Counterspell, Mystic Shot, Healing Nova,
Alchemical Fire, Arcane Surge, Veil Walker), **none use both**, so summing both
cannot double-count. It compounded on Mystic Shot, which is both a
`SpiritPower` item AND `ETechPower`-scaled: undercounting spirit power
under-resolved that item's own scaling. **When a duplicate key is found, fix
EVERY module that reads it** — fixing one and not the other is worse than
fixing neither, because the two then disagree silently.

**What this did and did not change, measured.** Graves' basket composition
shifted (Spiritual Overflow out; Diviner's Kevlar and Crippling Headshot in),
and Mystic Shot's modelled `spiritDamage` went 27 -> 72 at 100 spirit and 117
at 200. But its RANK among her 53 gun items barely moved (38 -> 37 at 200
spirit): the increase is real and correct, yet still short of the items above
it. Coverage saturation is NOT the cause — the per-slot spiritDamage target is
428.6, far above any of these values.

That remaining delta is the honest boundary of per-item valuation. The builds
this came from are described as PAIRS — "Heroic Aura + Mystic Shot", "Ricochet +
Toxic Bullets + Tesla" — and pair value is exactly what a per-item model
cannot represent, no matter how accurate each item's own coefficient is. With
scaling and proc frequency both now correct, the leftover genuinely is
Milestone F. **Do not chase it by inflating per-item numbers that are now
verifiably right.**

## A "proc" is not always per-bullet — check for a cooldown

`ProcChance` alone does not tell you how often an effect fires. The catalogue
separates two mechanically different things cleanly (verified live across all
10 `ProcChance` items):

| Pattern                                              | Items                                                                                                 | Throughput                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| `ProcChance` 100 **with** non-zero `AbilityCooldown` | Mystic Shot (8s), Headhunter (8s), Headshot Booster (9s), Restorative Shot (6s), Haunting Shot (2.5s) | one buffed bullet per COOLDOWN |
| `ProcChance` < 100, no `AbilityCooldown`             | Tesla Bullets (15%), Lucky Shot (25%), Armor Piercer (55%), Infinite Rounds (65%)                     | a roll on EVERY bullet         |

Mystic Shot is the clearest case, and its real mechanic is: **+7 spirit power
passive, plus your next bullet deals `40 + 0.9 x spirit power` bonus spirit
damage — then an 8s cooldown. The bullet must HIT, and the charge cannot be
banked unless you stop shooting.** Note `activation` is `"passive"` and
`is_active_item` is `false` on it, so **the activation fields do NOT identify
this class** — the `AbilityCooldown` is the discriminator.

Only the second kind may be flagged `perHit`. Flagging the first credited a
high-fire-rate hero for a trigger rate they cannot influence: firing 9.8
shots/s instead of 1.7 does not make an 8s cooldown come up more often. Fixed
via `addProc` in `effectEstimator.ts`, which routes cooldown-gated clusters to
`add` and genuine per-bullet rolls to `addPerHit`.

**Known unit inconsistency, deliberately NOT "fixed" by guessing.** The
estimator has no common time basis: a cooldown-gated effect's magnitude (Mystic
Shot's 40, scoring 20 after `EFFECT_CONFIDENCE`) sits in the same
`categoryValues` sum as a per-bullet effect's magnitude (Tesla's 9.9). On a
rate basis those are nowhere near equivalent — Tesla at ~1.5 procs/s hugely
out-throughputs Mystic Shot's 0.125/s — so the model currently **over**-values
once-per-8s effects relative to per-bullet ones. Establishing a real rate basis
means normalising every effect class in the module against a reference cadence,
which would change every estimate in it. Not attempted here rather than trading
a known, documented bias for an unknown one.

**This reversed an earlier conclusion in this file's history, which is worth
recording.** Mystic Shot's low rank (38th of 53 gun items for Graves) was first
read as the model under-valuing it, and the scaling-coefficient fix above was
expected to lift it. The coefficient fix IS correct — `40 + 0.9 x spirit` is
the real per-trigger damage — but once the 8s gate is accounted for, the
throughput modelling was over-stating the item, not under-stating it. Its rank
may simply be right. Its real-world worth plausibly rests on things this model
does not price: the flat +7 spirit passive, a low 1,600 cost, and pairing with
Heroic Aura — and **pair value is Milestone F, not a per-item coefficient.**
Do not "correct" a rank toward a play-derived expectation without first
establishing which mechanism is actually wrong.

### A cooldown-gated proc is wasted on a MISS — scale it by accuracy

Mystic Shot activates when you FIRE, not when you connect: miss and the charge
is spent and the 8s cooldown starts anyway. So its expected value per cooldown
scales with hit reliability — **accuracy only, never fire rate**, because the
cooldown fixes the rate. That is the opposite split from a per-bullet proc:

| Item-side share                   | Hero-side multiplier | Term                 |
| --------------------------------- | -------------------- | -------------------- |
| `procReliance` (per-bullet rolls) | fire rate x accuracy | `procPlatformTerm`   |
| `hitDependence` (cooldown-gated)  | accuracy ALONE       | `hitReliabilityTerm` |

**Graves is the documented in-game exception** — her Mystic bullet is not
wasted on a miss — and she needs no special case: `cannotMiss` already resolves
her to accuracy 1.0, which puts her 1st of 44 on `deriveHitReliabilityFactor`
(1.350) for exactly the right reason. **Silver lands 2nd (1.129) purely from
having the roster's best measured accuracy**, and is the only OTHER hero the
wiki names as exempt (while transformed with Lycan Curse) — emergent agreement,
not coded in. Silver's exemption is conditional on the transform, so it is
deliberately not modelled.

Live: Mystic Shot moves 39th -> 35th of Graves' gun items, `hitDependence` 0.84.

Known imprecision: measured accuracy counts PELLETS, so a spreadshot hero reads
low — but the Mystic pellet on a spreadshot weapon is always fired at the
crosshair CENTRE, making it more reliable than their pellet accuracy implies.
This therefore understates cooldown-gated procs on shotgun heroes.

**Mystic Shot interaction facts — all Milestone F, none encodable per-item.**
Recorded so nobody tries to express them as a per-item constant:

- **It cannot crit or headshot**, so headshot/crit items do not amplify it.
- **It is NOT affected by Ricochet.** Worth stating plainly because Ricochet
  and Mystic Shot are easy to assume combo: they do not.
- **The Mystic bullet lands BEFORE regular bullets**, which makes debuff
  ordering matter: Bullet Resist Shredder applies first and amplifies the
  weapon damage, while Crippling Headshot's spirit-resist reduction applies
  after and does NOT amplify Mystic Shot's spirit damage.
- It is immune to evasion.
- On explosive alternate-fire weapons it deals no area damage — only spirit
  damage to the enemy closest to impact.

## Non-substitutable categories: shred and anti-heal

`gunShred` / `spiritShred` / `antiHeal` exist for the same reason `resist` was
split from `bonusHealth`: they are **requirements, not damage sources**. Past a
certain enemy resist level, more damage items stop converting into damage dealt
and only shred unlocks it; against a healing enemy, raw damage can fail to
out-pace sustain at any amount. Separate coverage targets make the basket buy
_some_ rather than stacking pure damage. `SHRED_SHARE_OF_DAMAGE` deliberately
holds shred below the damage need it unlocks — the category guarantees
coverage, it does not make shred a co-equal damage source.

Shred is split by damage type because bullet shred does nothing for a
spirit-scaling hero's abilities. Shred need is derived from the matching damage
need; **anti-heal is a flat baseline**, because whether you need it depends on
the ENEMY having healing — a real number needs `EngineInput.matchContext`.

Two distinctions that are easy to get wrong:

- **Resist reduction ≠ output reduction.** `MagicResistReduction` and
  `TechArmorDamageReduction` make the target take more damage (shred).
  `TechPowerReduction` and `TechDamageReduction` cut the target's own damage
  output — that is defensive utility, and grouping it with shred credits it as
  offence.
- **The two anti-heal keys are always paired.** `HealAmpReceivePenaltyPercent`
  and `HealAmpRegenPenaltyPercent` carry the same value on every live item
  (both -35 on Toxic Bullets, both -70 on Spirit Burn). Take the larger, never
  the sum, or one effect is counted twice.

**AoE weapon effects earn economy**, not just damage: Ricochet's bounce and
Split Shot's extra bullets hit several jungle creeps per shot, which is farming
speed and therefore souls.

**Some item value is CONTEXTUAL and cannot be scored per-item — do not try.**
Three real cases (confirmed against play knowledge, not inferred from data),
each scoring near the bottom of its tier and correctly so:

- **Counter-picks.** Armor Piercing Rounds exists to answer Plated Armor; its
  worth is a function of the ENEMY's build. `EngineInput.matchContext` is
  declared and unused — that is the right home for enemy composition.
- **Combo enablers.** Vortex Web pulls a group into one spot; its value is in
  the follow-up (Ivy's ultimate + grasping vines + Alchemical Fire, Paradox
  bomb setups, Doorman dragging several enemies through a door). Its slow and
  dash-denial ARE scored; the grouping is interaction value. The item×item part
  (Vortex Web + Alchemical Fire) is now in the positive-synergy table — see
  below; the item×hero-ability part (Ivy, Paradox, Doorman) is not.
- **Ability-dependent effects.** Echo Shard resets an imbued ability's
  cooldown, so it is worth whatever that ability is worth. It gets a generic
  floor; a real number needs the hero's ability list.

All three are interaction value — the item-covariance layer scoped as Milestone
F. **Do not close the gap by inflating per-item constants**: that trades a known
underestimate for an unknown overestimate on every hero not running the combo.

**A low score is not automatically a bug.** Spirit Shielding scoring 55.5 at
T2 — above the T4 vitality median — was flagged as a suspected over-score, but
it is correct: it is a genuinely strong item on low-health heroes, and the model
already reflects that, ranking it 10th of 54 vitality items for the roster's
squishiest hero versus 22nd for its tankiest. Check whether a flagged outlier
is actually wrong before retuning toward it.

**Enemy resist reduction is offensive value stored as a negative.**
`BulletArmorReduction`, `MagicResistReduction`, `TechArmorDamageReduction` and
`BulletResistReduction` lower the TARGET's stat. Mapping them in
`STAT_KEY_TO_SCORE` would subtract from the buyer's score, exactly inverting
their worth — which is why they are sign-corrected in the estimator instead.
**Check the sign convention before mapping any new key.**

**Watch the scale when mapping a percent stat.** `StaminaCooldownReduction`
(12-18) was first weighted like a ones-scale flat stat, putting Stamina Mastery
at mobility 93 against Sprint Boots' 8.25 — an 11x distortion. Calibrate a new
key against an existing item in the same category before trusting it.

**Sentinel values are not debuffs.** `AbilityCooldownBetweenCharge` is `-1` on
156/156 live items, `ChannelMoveSpeed` is `-1` on 155/156, and `AbilityCharges`
is `0` on 156/156 — they mean "not applicable". They were previously mapped and
scored, charging a phantom −3 utility and −3 mobility to EVERY item and
silently understating the real utility/mobility of any item that had some
(Guardian Ward read 5.3 mobility instead of 8.3). They are now deliberately
excluded, with a note in `itemAdapter.ts`. **Check a key's value distribution
across all items before mapping it** — a constant value across the whole
catalogue is a sentinel, not a stat.

**`MIN_DEFENSIVE_NEED` exists for the same reason as `MIN_GUN_FACTOR`.** Before
it, the roster's tankiest hero derived exactly 0.00/0.00 and would never have
been offered a single vitality item — zero is unreachable downstream, not
merely low. Being naturally durable lowers the priority, never to nil. **Any
new per-hero signal added to this module needs the same floor — it is the
recurring bug class here.**

**Live validation (real API data).** Lady Geist's kit is 100% spirit-scaling
(Essence Bomb 1.22, Malice 0.558, Life Drain 0.3225, zero weapon scaling) AND
her gun gains +1.00 damage/boon, ranking 7th of 38 for DPS gained from boons
— so she correctly derives a need for BOTH (spirit 2.00, gun 1.07). Gun
quality spans 6.3× across the roster, and the derivation separates it
cleanly: Drifter (best gun) 2.00, Geist 1.07, Infernus 0.71, Graves (worst)
0.65 — note Infernus and Geist are both pure-spirit heroes, separated only by
gun quality. Her `moveSpeed` 6.3 is below roster average so mobility reads
high (1.60); `maxHealth` 880 is above average so tankiness reads low (0.15)
under the compensating interpretation.

## Positive synergy (hand-authored pair table)

`lib/engine/synergy.ts`'s `SYNERGY_RULES` is the mirror of `ANTI_SYNERGY_RULES`:
unordered item pairs, consumed by `synergyTerm` in `basketSelect.ts` — the first
term to read `state.picked`. When a candidate's partner is already in the
basket **or already owned by the player** (`BasketContext.ownedItemNames`, fed
from `BuildClient`'s build — owned items are never candidates, so without it the
commonest case, "I own Heroic Aura, should I buy Mystic Shot?", was invisible),
the candidate earns `SYNERGY_MAX_FRACTION` (0.10) of one slot's coverage.
Relevance-gated like every adjustment term, and clamped so several partners
cannot stack past one cap.

The bonus is **flat**, like `categoryBonusTerm` and unlike the proc terms. So
it can beat an item whose coverage gain is up to 0.10 of a slot larger, not
just break exact ties. It still can't make an item worth buying when it covers
nothing.

This is the hand-authored half of interaction value, NOT Milestone F: it only
encodes pairs confirmed from play, and it does not measure how much a pair is
worth. Milestone F's covariance term is still the way to get real numbers.

Current entries (class names verified live): Heroic Aura + Mystic Shot,
Ricochet + Toxic Bullets, Vortex Web + Alchemical Fire. Two exclusions are
deliberate: Tesla Bullets is only an optional third piece of the Ricochet
build, and **Ricochet + Mystic Shot must never be added**, because Mystic Shot
is not affected by Ricochet.

Two limits you should know about:

- **Greedy is myopic.** Only the SECOND item of a pair gets boosted. The first
  pick earns nothing for a partner that might be picked later, so a pair whose
  first half wouldn't be picked on its own merits is never completed.
- **The approximation guarantee is weakened.** Synergy is supermodular, so once
  this term is enabled the (1 − 1/e) guarantee holds only approximately. The
  small cap is what keeps the deviation small. Don't raise the cap without
  re-examining this.

**Measured live (Graves, boon 15, 9,800 souls, pooled accuracy):** owning Heroic
Aura gives Mystic Shot the full +5.00 synergy and moves it from 59th to 51st of
all candidates on the first iteration, and from 18th to 15th of the gun items.
It **still does not enter the basket.** That is the cap working as intended:
the table says the pair exists, not how much it is worth. Closing the rest of
that gap needs a measured pair value (Milestone F), not a bigger
`SYNERGY_MAX_FRACTION`.

Add an entry only from confirmed play knowledge, and verify its class name
against the live API first. A wrong id fails silently, because the rule just
never matches.

## Milestone F spike: measured item-pair interaction (2026-10-18)

Tool: `npm run pair-probe -- <hero> [--rank T] [--pair a,b]`
(`src/scripts/pairProbe.ts`). Read-only. Nothing it computes feeds the engine.

**Data source: no match ingestion needed.** `/v1/analytics/item-permutation-stats?comb_size=2&hero_id=N`
returns pre-aggregated pair wins/losses per hero, with the same filters as
`item-stats` and `hero-stats` (time window, badge, final net worth). A
`data-verifier` pass read the server SQL
(github.com/deadlock-api/deadlock-api,
`api/src/routes/v1/analytics/item_permutation_stats.rs`) and established:

- **Pairs are ORDERED by purchase** (`[bought first, bought second]`), so an
  unordered pair can be two rows. Sum both orders. Fetch with `min_matches=1`:
  the default floor of 20 applies per ordered row and silently drops the rarer
  order.
- **"Owned" means ever purchased in that match.** Sold items and consumed
  components count. Component → upgrade pairs (Improved Spirit + Soaring
  Spirit) are therefore mechanical, not synergy, and must be dropped through the
  transitive `componentItems` closure.
- **`item-stats` counts purchases, pairs count player-matches.** A rebuy
  counts twice in singles. This is a small mismatch: a derived 2x2 cell that
  goes out of range is skipped, not guessed.
- **Pin `min_unix_timestamp`/`max_unix_timestamp` explicitly on every call.**
  The default "30 days ago" moves between calls (about 0.1% drift).
- `item-stats`' own `bucket=net_worth_by_*` is net worth AT PURCHASE, which is
  not the same as the `min_networth`/`max_networth` filter (FINAL net worth).
  Only the filter exists on the pair endpoint, so stratify with the filter.
- Size: about 1.4 MB and 19k ordered rows per hero per stratum. That suits an
  offline fitter, not a page load.

**Method.** For each pair, a 2x2 table of this hero's players (has A) x (has
B), with "neither" taken from `hero-stats`. The interaction is the log odds
ratio `logit(AB) − logit(A only) − logit(B only) + logit(neither)`, which is
zero when the pair is exactly what its two items predict on their own. It is
computed raw and within six final-net-worth bands (pooled by inverse variance).
It is then shrunk toward 0 (empirical Bayes, method of moments). Finally each
item's mean effect across all its pairs is removed (`pairOnly`).

**Results (30 days, all ranks, pairs with ≥ 500 co-owning matches).**

|                               | Graves        | Haze          | Infernus      |
| ----------------------------- | ------------- | ------------- | ------------- |
| pairs ranked                  | 6,207         | 5,772         | 5,313         |
| raw vs banded correlation     | 0.81          | 0.61          | 0.55          |
| sign flips when banded        | 19%           | 28%           | 28%           |
| banded \|z\| > 3              | 1,074         | 1,004         | 703           |
| tau (real spread) / median se | 0.074 / 0.044 | 0.074 / 0.043 | 0.069 / 0.053 |

**Findings.**

1. **There is real pair structure.** Spread beyond sampling noise (tau) is
   about 0.07 log odds on every hero, and roughly a sixth of pairs sit at |z| > 3. Strong pairs move win rate by about 4–8 points after shrinkage.
2. **The wealth confound is large and must be controlled.** Banding by final
   net worth flips the sign of a fifth to a quarter of pairs. On Infernus,
   Ricochet with Toxic Bullets goes from +0.319 raw to +0.115 banded. A raw pair
   win rate is not usable.
3. **Item-wide effects are small.** The largest is Warp Stone at −0.06 on
   Graves. Removing them barely changes the top pairs, so the top results are
   pair-specific rather than one item bought in a bad game state.
4. **Pair value is hero-specific.** Ricochet + Toxic Bullets measures +0.115 ±
   0.012 on Infernus (about +2.8 points) but 0.000 on Graves and Haze, with
   tight se. A hero-agnostic constant like `SYNERGY_RULES`' `strength: 1` cannot
   express this.
5. **Hand table check.** Mystic Shot + Heroic Aura on Graves is −0.001 ± 0.009
   banded: no measurable interaction beyond the two items' separate value
   (`pairOnly` +0.04). Ricochet + Toxic Bullets: see 4. Vortex Web + Alchemical
   Fire is almost never co-bought on these three heroes (5–110 matches), so it
   is untested here.
6. **Residual confound this endpoint cannot remove: enemy composition.**
   Graves' top positives are Spirit Resilience / Healbane / Cursed Relic in
   combination, which reads as "both items answer the same enemy team" rather
   than one item amplifying the other. The pair endpoint has no enemy-hero
   filter, and the engine has no enemy input (`matchContext` is unbuilt).
   Purchase timing (an item bought then sold still counts) is a second residual
   confound.

**Decision for the rest of F.** Measured pair lift is usable as a basket term
only with these guardrails: per hero; net-worth banded; shrunk; component
chains dropped; item-wide effects removed; and capped low, because finding 6
means part of any positive lift is context, not mechanism. The term's reason
string must say what was measured ("players on this hero who built both won X
points more than the two items predict"), never "synergy". Ship it as a static,
committed per-hero table generated by an offline fitter: the data cost of
about 21 calls and 7 MB per hero rules out a page-load fetch. Refresh it on the
data-verification cadence. `SYNERGY_RULES` stays until the measured term lands.
Whether it is then replaced, kept as a fallback for pairs without data, or
narrowed to mechanism-only rules is decided in that PR with the fitted table in
hand.

## Pair lift table (Milestone F, PR 2)

**Where things live.**

- `lib/engine/pairLift.ts`: all the pure math (`pairInteraction`,
  `poolInteractions`, `estimateTau2`, `shrinkTowardZero`, `removeItemEffects`,
  `componentClosure`, `fitHeroPairs`), plus the table types and the lookup
  `pairLiftFor(table, heroId, idA, idB)`. Fixtures are in
  `lib/engine/__fixtures__/mini.ts`.
- `src/scripts/pairData.ts`: the live loader shared by both scripts. It pins
  the time window, sums both purchase orders, throttles to about 150 req/min,
  and fails loudly.
- `src/scripts/fitPairTable.ts` (`npm run fit-pairs`): fits every visible
  hero and writes `lib/engine/data/pairLiftTable.json`.
- `src/scripts/pairProbe.ts` (`npm run pair-probe`): one hero with
  diagnostics, using the same math.

**What the table holds.** For each hero, only pairs that have:

- at least `minPairMatches` co-owning matches (default 300 since PR 3; 500 in
  PR 2's fit);
- `|lift| / se >= minAbsZ` (default 3);
- both items in at least `minItemPairs` fitted pairs (10).

`lift` is `pairOnly`: the log odds ratio, banded by net worth, shrunk toward
zero, with item-wide effects removed. Keys are `pairLiftKey` over `Item.id`
(class_name), lower id first. `fits` records each hero's matches, pairs fitted,
pairs kept and tau, which is what to compare when reviewing a refresh.

**`se` belongs to the banded estimate, not to `lift`.** `lift` has been
shrunk and centred, so `|lift| / se` is a ranking threshold, not a z-score, and
`lift ± se` is not a confidence interval. Don't call it "significance" in UI
copy or reasons.

**How the method was hardened in review** (scoring-auditor, PR 2):

- **Item effects are a least-squares fit, not per-item means.** The fit is
  value = grand + effect(a) + effect(b), by Gauss-Seidel with fixed sweeps.
  Means are only exact on a complete pair graph, and this graph is
  incomplete. With means, an item in one pair got a pair-only value that was
  really a statement about its partner. Under least squares that residual is
  0, and `minItemPairs` drops items whose effect is poorly determined.
- **Shrinkage is measured from zero.** tau² = mean(x²) − mean(se²), because the
  shrinkage target is 0. Centring on the sample mean would over-shrink whenever
  estimates share a nonzero mean.
- **All ordering uses code-unit order (`compareIds`), not `localeCompare`.**
  This is the same order as `pairLiftKey` and the JSON, and it does not depend
  on the machine's ICU. Duplicate class names throw.

**For PR 3: owned items only.** `pairLiftFor` is symmetric, so the types don't
enforce this. The term must look up (candidate, OWNED item) only, never
(candidate, other candidate), which is the circular-selection rule.

**Absent is not zero.** A pair missing from the table was not measured clearly
enough. That is not evidence the pair is neutral, and `pairLiftFor` returns
null, never 0, for it. The consuming term must treat null as "no signal"
(inert), in the same way as the other terms' absent inputs.

**Refreshing.** Run `npm run fit-pairs` (about 8 s per hero; the full roster
takes a few minutes, against the analytics API's 6-hour cache). A `--heroes`
subset still REPLACES the whole file, so use it only with `--dry`. The file is
in `.prettierignore`: its one-entry-per-line, sorted layout is canonical, so a
refresh diffs readably. Refresh it on the data-verification cadence in
CLAUDE.md and after any major item patch.

**PR 2's first fit, superseded by PR 3's Oracle+ refit (all ranks, 2026-10-18,
window 2026-09-18 to 2026-10-18).** 43 heroes and
19,667 kept pairs, from about 2,300 to 7,000 fitted per hero. The file is 1.77
MB. A single hero's slice is 5–87 KB (median 37 KB), which is what PR 3 should
pass to the client: never import the whole file into a client component. Kept
pairs per hero range from 54 (Violet, 99k matches) to 1,023 (Baba). About 60%
of kept pairs are positive. Tau is 0.05–0.12 on every hero (median about 0.075),
so the real pair spread found in the spike holds across the roster. The
highest-tau heroes (Baba 0.119, McGinnis 0.112, Victor 0.104) are where pair
choice matters most. A low-match hero keeps few pairs rather than noisy ones:
that is the shrinkage and the z threshold working.

**The enemy-composition confound is visible in the table, so cap PR 3
accordingly.** After least-squares item effects, Spirit Resilience
(`upgrade_tech_purge`) still has many large positive pairs with gun items: 9
partners above +0.25 on McGinnis and 7 on Dynamo, for example Ethereal Bullets
+0.34 and Blitz Bullets +0.30. An effect that applied to the item across the
board would have been removed, so this is pair-structured. It reads as "a gun
build that also bought anti-spirit defence was facing a spirit-heavy team",
which is finding 6 of the spike. The term in PR 3 will reward these pairs
anyway. Bound it like `synergyTerm` (a small fraction of a slot), and phrase
its reason as what was measured.

## Pair term in the basket (Milestone F, PR 3)

**What fires.** `pairTerm` (termId `pair-lift`, in `DEFAULT_BASKET_TERMS`
after `synergyTerm`) adds this hero's measured lift between a candidate and
each of its partners. Partners are owned items plus basket picks: the same set
as `synergyTerm`, via the shared `pairPartners`, and never other unpicked
candidates. The partners' lifts are summed and saturate at 0.3 log odds, so the
value is within ±`PAIR_LIFT_MAX_FRACTION` (0.08) of a slot. It is symmetric:
a measurably bad pair is pushed down. It is relevance-gated, inert without
`ctx.pairLift`, and a pair missing from the table is no signal. The reason
gives approximate win-rate points and the measurement's scope, and never says
"synergy".

**Higher-rank data only (product decision).** The table is fitted on matches
whose average badge is **Oracle (tier 8) or above, over 90 days**, with at
least 300 co-owning matches. Ascendant+ was the first choice, but at Ascendant+
the per-pair se is several times the real spread between pairs. Shrinkage then
zeroes almost everything: 0 pairs kept for Graves, Infernus, Baba and Violet,
and 14 for Haze, even over 90 days. Over 30 days Graves has 4,985 Ascendant+
player-matches against 858,524 at all ranks, and Eternus alone has 825. The badge filter is
the MATCH average of both teams, not the player's own rank. A 90-day window
can span balance patches: refresh after a major one.

**Measured wins over the hand rules.** The fitter also writes `rulePairs`:
each `SYNERGY_RULES` pair's measurement for every hero where its se ≤
`ruleMaxSe` (0.05), plus any hand-rule pair that is significant whatever its
se. At that precision a real effect of about 0.15 would have cleared 3 se. Both
terms read one helper, `measuredPair`, which returns the significant entry or
else the `rulePairs` entry:

- Where a measurement exists, `synergyTerm` skips the rule, even when the
  measurement is about 0, and `pairTerm` credits the pair with exactly that
  measurement. So the pair is never counted twice, and an overridden rule is
  never silently dropped: the player sees a `pair-lift` line explaining the
  measured value.
- A rule with no measurement (a rarely co-bought pair, or a little-played hero)
  keeps firing as before.

A fixture enforces the table invariant that every hand-rule pair in `heroes`
is also in `rulePairs`. This came from scoring-auditor review: the first draft
could double count, and it left 5 of the 6 overridden rules silent.

**PR 3's fitted table (2026-10-18, Oracle+, 2026-07-20 to 2026-10-18).** The PR 4
refit (window 2026-07-21 to 2026-10-19, one day later) kept 3,624 pairs: day-to-day
drift of about 5% from new matches entering the window. Expect that on every
refresh. 3,796 kept pairs across 43 heroes, 343
KB, against 19,667 at all ranks over 30 days. Coverage is uneven, and the
term is simply inert where data is thin:

- **Plenty of data:** Bebop 363, Haze 314, Drifter 257.
- **Very little:** Vyper 1, Mirage 8, Silver 8.
- **None:** Deadman Danny, Solomon and Violet (0 each; under 26k Oracle+
  matches).

Six hand-rule measurements cleared `ruleMaxSe`, so those rules are now
overridden:

| Hero     | Hand rule                    | Measured lift                            |
| -------- | ---------------------------- | ---------------------------------------- |
| Infernus | Ricochet + Toxic Bullets     | +0.105, also a significant `pairs` entry |
| Haze     | Ricochet + Toxic Bullets     | −0.048                                   |
| Graves   | Ricochet + Toxic Bullets     | +0.036                                   |
| Graves   | Heroic Aura + Mystic Shot    | +0.004                                   |
| Ivy      | Vortex Web + Alchemical Fire | −0.020                                   |
| Paige    | Vortex Web + Alchemical Fire | −0.017                                   |

The hand rules keep firing for every other hero.

**Live effect.** Probe runs with and without `--no-pair-lift`, the new
probe flag that reproduces the pre-PR 3 basket. In each case the first value
is without the pair table and the second is with it:

| Hero     | Owned              | Candidate           | Change                                                | First-pick rank |
| -------- | ------------------ | ------------------- | ----------------------------------------------------- | --------------- |
| Infernus | Ricochet           | Toxic Bullets       | hand +5.00 replaced by measured +1.40 (about 2.6 pts) | 34 → 44         |
| Graves   | Heroic Aura        | Mystic Shot         | hand +5.00 replaced by measured +0.05 (+0.004 lift)   | 51 → 56         |
| Haze     | Active Reload      | Reinforcing Casings | −3.63 (about 6.8 pts worse)                           | 68 → 79         |
| Infernus | Spiritual Overflow | Ethereal Bullets    | +2.39                                                 | 15 → 13         |
| Bebop    | Unstoppable        | Ultimate Burst      | +4.00 (saturated)                                     | 7 → 7           |

**Whole baskets were unchanged in all 5 scenarios checked.** The term moves
mid-ranked candidates but, at 0.08 of a slot (±4 coverage units against about
80 for a top pick), never displaces a clear coverage leader. That is the
intended conservatism given the enemy-composition confound. Raising
`PAIR_LIFT_MAX_FRACTION` is a one-constant change if play-testing says the
measured pairs deserve more weight; re-run these probes if you do.

## Synergy audit report (Milestone F, PR 4)

`npm run synergy-report` (`src/scripts/synergyReport.ts`, with the page script
`synergyReport.client.js`) writes `reports/synergy-audit.html`. It is
published as a PRIVATE Claude artifact, "Deadlock Synergy Audit". The product
owner treats it as a competitive asset: the HTML is gitignored, it is never
committed, and the artifact link is not recorded in this public repo. Republish
it to the same artifact after every `npm run fit-pairs`.

**Sections:**

- Each hand-authored rule (3 synergy, 4 anti-synergy since the rule fix; 5 at PR 4) with its reason, a
  mechanics review of that reason, and a per-hero verdict.
- A hero explorer listing every significant pair.
- The items that appear in the most significant pairs (likely context effects).
- Method and limits.

**Inputs:** the committed table, item and hero names from the assets API, the
two rule sets, and `RULE_REVIEW` in the generator. There are no analytics calls
and no clock, so the output is deterministic from those.

**Table v3: the audit-only `handPairs` section.** It holds every fitted
measurement of every hand-authored pair, synergy and anti, whatever its z or
se, so the report can tell "measured about 0" from "no data". The engine never
reads it, and `heroPairLift` does not expose it; a fixture pins this. The
anti-synergy rules were exported from `lib/scoring/antiSynergy.ts` for this.
Behaviour is unchanged.

**Verdict per rule and hero**, where the expected sign is positive for synergy
and negative for anti-synergy:

| Verdict      | Condition                                             |
| ------------ | ----------------------------------------------------- |
| Supported    | `abs(lift) / se >= minAbsZ` in the expected direction |
| Contradicted | `abs(lift) / se >= minAbsZ` in the opposite direction |
| No effect    | below that, with se ≤ `ruleMaxSe`                     |
| Inconclusive | below that, with larger se                            |
| No data      | not fitted                                            |

**Mechanics review of the rule reasons** (data-verifier, 2026-10-18, against
deadlock.wiki and the live item API). These were the findings on the ORIGINAL
reasons; the rules were corrected in the follow-up PR (see below):

- **Rapid Recharge + Extra Charge: WRONG.** Extra Charge is Rapid Recharge's own
  component, and the charge bonuses add up with no documented cap. The rule warns
  on the normal upgrade path.
- **Cold Front + Slowing Hex: partly wrong.** Slows stack multiplicatively with a
  2 m/s floor; there is no DR cap.
- **Leech + Vampiric Burst: partly wrong.** Lifesteal stacks multiplicatively:
  37.4% against 41%, a small loss.
- **Lucky Shot + Glass Cannon: opinion.** The cost is 12,800, not 12,400.
- **Shadow Weave + Ethereal Shift: opinion.** Shadow Weave is an ambush tool.
- **Ricochet + Toxic Bullets and Vortex Web + Alchemical Fire: sound.**
- **Heroic Aura + Mystic Shot: unverifiable opinion.**
- **Also:** the wiki says Ricochet does NOT affect Tesla Bullets, which
  contradicts `synergy.ts`' header note calling Tesla an optional third piece of
  the Ricochet/Toxic build.

**Corrected 2026-10-19 (follow-up PR "fix hand pair rules"):**

- **Rapid Recharge + Extra Charge: removed.**
- **Leech + Vampiric Burst, Cold Front + Slowing Hex: reworded** to the
  documented multiplicative stacking.
- **Lucky Shot + Glass Cannon, Shadow Weave + Ethereal Shift: reworded** as
  advice that says it isn't a mechanical conflict.
- **`synergy.ts`' Tesla Bullets note: fixed.**
- **No reason hardcodes soul costs or percentages any more.**

`src/scripts/mini.ts` now enforces three things against live item data: rules
name live items, never pair an item with its own component, and hardcode no
costs or percentages.

Measured at Oracle+, no anti-synergy pair shows a significant win-rate penalty
on any hero. Cold Front + Slowing Hex was fitted on 18 heroes and Lucky Shot +
Glass Cannon on 12, with mean lift about 0. They remain warnings about tooltips
and budget, not about lost games. `RULE_REVIEW` records the corrected verdicts.

## One basket pipeline, and the starter build (Work 2, PR 2b)

The pipeline that turns a hero and an owned build into a basket (need vector →
rank-aware accuracy → candidates → `makeBasketContext` → `constructBasket`) used
to live inline in `BuildClient`'s `heroBasket` useMemo, and `basketProbe.ts`
copied it by hand. It is now `runHeroBasket()` in `lib/engine/heroBasket.ts`.
The planner, the probe, the starter build and Fixture 13 all call it. **Do not
re-inline it.** A pipeline change made in one copy and not the other is exactly
the drift this removes. The extraction was proved behaviour-identical before
merging: the old inline code and `runHeroBasket` were run on the same live data
for every hero × 6 boon levels × 3 owned sets × 2 ranks (1,548 baskets), with 0
mismatches.

`buildStarterBuild()` (`lib/engine/starterBuild.ts`) chains `runHeroBasket` at
`STARTER_PHASE_BOON_LEVELS`: slider 10/22/29, which is 5,900/16,700/30,000 souls,
or about 10/20/30 minutes on the live mean net-worth curve. Each phase owns the
earlier phases' picks, and spirit power is recomputed from them. v0 only
chains today's engine.

The approved use cases (`docs/starter-build-use-cases.md`) found what that
exposes:

- **Near-identical builds for every archetype.** The `spiritDamage` need is
  capped at 2.00 for every hero checked, and gun and health needs look inverted
  for Haze and Abrams.
- **Owned items not credited to coverage.** `constructBasket` starts coverage at
  zero.
- **No component or upgrade-path awareness.**

Fixture 13 records the failing leans in `KNOWN_LEAN_GAPS`, a ratchet that can
only shrink. Order from here: 2c fixes owned coverage and components, then a
need-vector scoring PR works off L1–L4, and only then does 2d ship the UI.

## Owned coverage and upgrade components (Work 2, PR 2c)

**Owned items count.** Before this PR `constructBasket` started coverage at zero, and
owned items only fed synergy, pair partners and spirit-power scaling. A build that
already had spirit damage kept being offered more. Now `makeBasketContext` takes
`ownedCandidates`, valued exactly like the candidates in `runHeroBasket`. They seed
`coverage`, `soulsPerCategory` (the investment bonus counts souls already invested) and
`held`.

The coverage **target now spans `targetSlots = maxItems + owned`**, the whole build.
Seeding owned coverage while keeping the old target over free slots only would count
owned items twice: once as coverage and once as a shrunk target. `coverageScalePerSlot`
divides by `targetSlots` for the same reason. With nothing owned, `targetSlots ===
maxItems`, so behaviour is identical to before, except for the H2 rule below.

**Upgrade rules** were verified 2026-10-20 by `data-verifier` against deadlock.wiki/Items
and /Shop and the live item API:

- Buying an upgrade consumes its **direct** held components.
- It costs `cost − Σ consumed component costs`.
- Its stats **replace** the component's, never add to them. Arctic Blast's TechResist is
  10 and Cold Front's is 6; the result is 10, not 16.
- Chains upgrade one step at a time.

`effectiveCost(candidate, held)` implements this, matching `getEffectiveAddCost` in
`lib/buildUtils.ts`. The loop uses effective cost for affordability, `spent` and the
investment bonus. `computeCoverageGain` subtracts a consumed component's values before
adding the upgrade's. A category can come out negative; that counts in the total but is
never named in a reason.

**Slots.** A pick uses one slot, and each consumed component frees one. So upgrading a
held component is slot-neutral and fits even when the build is full. The stop reason is
`"slots"` whenever no free slot is left, even if a worthless slot-neutral upgrade still
fits. When only H2 exclusions remain, it is `"no-positive-value"`, not `"budget"`.

**H2.** One basket never _picks_ an item together with its own component (transitively,
via `componentClosure`), and never buys a component of something already held. Only
direct components are consumed, so an owned grand-component (A in A→B→C) can stay held
next to C. The shared helpers `initialBasketState`, `componentClosures` and
`blockedByComponents` are exported so that `basketProbe`'s first-pick ranking starts and
filters exactly like the loop.

Measured on live data against `main` (every hero × 6 boon levels × 3 owned sets):

- **Nothing owned:** 44 of 264 baskets changed. All 44 were baskets where `main`
  recommended an item **and its own component** together, e.g. Cultist Sacrifice plus
  Monster Rounds, paying twice. That was a latent bug in the live `/build` basket.
- **With owned items:** 362 of 528 changed, as intended.

In the starter build, consumed components leave the owned set between phases (the
planner's `resolveAddItem` does the same), and `StarterPhase.consumed` records them.

**Synergy partners.** `synergyTerm` and `pairTerm` now pair against what is _held_,
excluding the components the candidate itself would consume. Callers that pass only
`ownedItemNames` keep the old behaviour. Owned items are sorted by itemId, so input order
is never load-bearing.

**UI.** `HeroBasketSuggestion` shows `effectiveCost` and "Upgrades your X: you trade it
in…". An upgrade's Add button stays enabled when the build is full, because the upgrade
is slot-neutral.

**Not done here.** The basket picks by value, not value per soul, and a freed slot is
worth nothing until slots run out. With correct pricing, upgrades therefore rarely win:
lean L6 is back on `KNOWN_LEAN_GAPS` by user decision. The fix is an upgrade-efficiency
signal, planned after the need-vector PR (`docs/starter-build-use-cases.md` §5.4).

## Measured category split (need-vector PR, Work 2)

**The kit cannot tell archetypes apart.** `deriveAbilitySpiritShare` measures what TYPE of
scaling a kit has, and nearly every ability scales off spirit. So `spiritDamage` need was
the 2.00 cap for 37 of 43 heroes. Raw spirit-scaling magnitude is no fix: coefficients
depend on each ability's base damage, so Abrams (4.33) outranks Seven (2.03). The
defensive "compensating" direction (squishier heroes need more) also gave tanky Abrams
the lowest health need.

High-rank purchase data separates heroes clearly (data-verifier, Oracle+, 30 days,
2026-10-20; reproduced by the generator):

- Haze: 54% gun, 15% spirit.
- Kelvin: 3% gun, 72% spirit.
- Abrams: 49% vitality.
- Venator: 4% spirit.

API `hero_type` predicts little; Kelvin and Mo & Krill are "brawlers" that build 60–72%
spirit.

**Design (user decision: "measured prior + kit detail").** The table is
`lib/engine/data/heroCategorySplit.json`, generated by `npm run fit-category-split`
(`src/scripts/fitCategorySplit.ts`), committed, and sliced per hero in `page.tsx`, like the
pair-lift table. It measures final-inventory item souls per shop category as
`(bought − sold) × cost` from `/v1/analytics/item-stats?hero_ids=<id>`. Use `hero_ids`:
`hero_id` is silently ignored and returns catalogue-wide counts. Heroes under 2,000
matches are left out and fall back to the kit-only vector (Nurse Harrow at 340).

The generator refuses to write when:

- items or heroes failed to load (`getItems()` fails open to `[]`), or
- fewer than 80% of the committed heroes were fitted.

It warns when more than 2% of a hero's final-inventory purchases are items no longer in
the shop.

The split is applied in three steps, all in `runHeroBasket`:

1. **Rank adjustment** (`adjustSplitForAccuracy`). The split is measured at Oracle+
   (`HeroCategorySplit.rankTier` = 8). Its gun share is multiplied by this hero's
   accuracy at the player's rank divided by its accuracy at Oracle+ (clamped to
   0.5–1.5), then renormalized. Without this, the rank selector would barely move the
   basket, and a lower rank would lower spirit and vitality along with gun. Verified:
   Haze gun need is 2.33 at Initiate and 2.44 at Oracle.
2. **Need rescale** (`applyCategorySplit`). The kit-derived need is redistributed between
   the gun (damage + shred), spirit (damage + shred) and vitality (health + resist +
   shield) families. Their combined total and the health / resist / shield ratio are
   kept, and every other category is untouched. The kit still decides those parts; shred
   is a fixed fraction of damage in `heroNeed.ts` either way. Shares are floored at
   `MIN_FAMILY_SHARE` (0.08), then renormalized, so a floored family can land slightly
   under 0.08 (Mo & Krill buy 0.6% gun). A non-finite share means "no split", never a
   zero.
3. **Basket term** (`categorySplitTerm` in `basketSelect.ts`). It uses the RAW measured
   shares; the floor is only for need-vector reachability.
   - **Gain:** `(target share − current share of the candidate's shop category) ×
souls paid / (held + prior + paid)`, then `× CATEGORY_SPLIT_MAX_FRACTION (0.5) ×
per-slot scale`.
   - **Prior:** current shares include `CATEGORY_SPLIT_PRIOR_SOULS` (6,400) spread at the
     target, so a first pick on an empty build is exactly neutral. An earlier draft
     scored the empty build as maximally off-split, which gave every first pick a fixed,
     cost-blind ±0.1–0.2 slot (scoring-auditor finding).
   - **Gates:** relevance-gated like `categoryBonusTerm`; it uses souls actually paid and
     counts owned items; changes under 0.002 are dropped.
   - **Reason:** "Moves your build toward / further from what Oracle+ players (last 30
     days) end games with on this hero (48% spirit)".

**Population data is labelled and never the headline.** `HeroBasketSuggestion`'s
simplified view picks its single reason from non-population terms. `category-split` and
`analytics` stay in the advanced breakdown.

**Ablation** (live; every hero; nothing owned; sliders 10 / 22 / 29). "Mean L1" is the
mid/late basket shop split against the measured split.

| Mode      | Mean L1 | Overlap s10 / s22 / s29 | Distinct s10 / s22 / s29 (of 44) |
| --------- | ------- | ----------------------- | -------------------------------- |
| none      | 0.458   | 0.71 / 0.66 / 0.34      | 6 / 10 / 24                      |
| need-only | 0.361   | 0.61 / 0.59 / 0.35      | 7 / 8 / 33                       |
| term-only | 0.432   | 0.69 / 0.66 / 0.33      | 6 / 10 / 25                      |
| both      | 0.336   | 0.61 / 0.59 / 0.35      | 7 / 8 / 34                       |

The rescale does most of the work, and the term adds a little. Both stay: the need works
in STAT categories, the measurement is in SHOP-category souls, and all-rounder items
break the link (Infuser is a vitality-shop item that mostly gives spirit and sustain).
`npm run probe -- <hero> --split-need-only | --split-term-only | --no-category-split`
reproduces each mode.

**Leans:** L2 Haze, L3 Abrams / Warden, L4 and L6 pass. L6 is a real upgrade, e.g.
Grit → Guardian Ward at the difference.

**Still open:**

- L1 (Seven and Lady Geist lean spirit).
- Early and mid-game sameness: every reference hero still opens Blood Tribute + Cold
  Front, and slider 22 has 8 distinct baskets against 10 on `main`.

The cause is the coverage model. It prizes all-rounder items whose shop is not their stat,
and five stubbed neutral categories (antiHeal, sustain, utility, economy, mobility at 1.0)
hold about 45% of every hero's target. That needs a coverage-model change, not a weight
tweak. Also note the split is FINAL inventory, so it says nothing about lane-phase
purchases that players later sell; a per-phase table could come later.

**Refresh** monthly with `npm run fit-category-split`, alongside `npm run fit-pairs`, and
review the diff hero by hero.

## Ranking by value per binding resource (coverage-model PR 1)

The greedy loop used to rank candidates by raw marginal value, with cost only as a
tie-break. A 3,200-soul all-rounder carries more total stats than an equally efficient
800-soul item, so it always won. Every hero therefore opened with Blood Tribute, Cultist
Sacrifice or Fury Trance, while Oracle+ players open with 800-soul basics (Monster
Rounds, Extra Regen, Extra Spirit).

Budgeted maximum coverage is classically solved greedily by value PER COST. There are two
budgets here, souls and slots. So the loop now ranks by `value / rankingPrice`, where
`rankingPrice = max(effective cost, souls left / free slots, 1)`:

- **Souls tight** (early: 5,900 souls, 12 slots ≈ 490 a slot): value per soul, so cheap
  efficient items compete fairly.
- **Slots binding** (souls per slot above an item's price): cheap items are charged a
  slot's share, so the ranking becomes value per slot and strong tier-4 items still win.
- **Upgrades:** their lower effective cost counts in their favour (lean L6).
- **Stop rule:** still raw value ≤ 0, so a cheap item that covers nothing is never bought.

Live effect, alone (before PR 2):

- **M1 phase checks:** 6 → 11 of 24 pass.
- **Early phases:** 3 items → 4–5, e.g. Seven: Cold Front, Spirit Strike, Battle Vest,
  Grit, Monster Rounds.
- **Upgrade paths:** 4 → 29.
- **Regressions:** Wraith early, Abrams early and late, and Warden early now fail. Mid
  overlap went 0.377 → 0.395.

The regressions come from cheap items carrying placeholder-category stats looking
efficient for everyone, which PR 2's measured phase profile replaces. The two PRs are
stacked and merge together (user decision). Combined, four of these still regress; the
user accepted them (see the PR 2 section below). The probe ranks the same way and prints
value per 1k of price.

## Phase-aware split and measured stat profile (coverage-model PR 2)

Real purchases differ by phase much more than the whole-game split shows. Oracle+ Seven
buys 44% gun in the first 10 minutes but holds 17% gun at the end; Abrams buys 59% gun
early and 30% overall. `heroCategorySplit.json` now carries, per hero:

- the early (0–10 min) and mid (10–20 min) PURCHASE splits, using exact
  `min/max_bought_at_s` filters, not net of sells;
- a measured 12-category STAT PROFILE per phase: purchases (or the final inventory for
  late) × each item's category values, as shares. Since G4 these are the hero's own
  fight-value units (see "Profile in fight-value units" below); before, unscaled item
  values.

`runHeroBasket` picks the phase from current souls (`phaseForSouls`: 6,950 and 17,550
souls are the 10- and 20-minute marks on the net-worth curve), then:

- **Phase split:** uses that phase's split for the family rescale and the term.
- **Profile categories:** `applyStatProfile` sets antiHeal, sustain, utility, economy and
  mobility, which the kit cannot derive, from the phase profile. Those were a flat
  placeholder holding about 45% of every target. The other seven categories keep their
  kit and split proportions and fill the rest; the total is kept, and each profile
  category is floored at 1%.

**Stacked result with PR 1** (live, reference heroes):

- M1: 6 → 11 of 24 (different keys from PR 1 alone).
- Mid overlap: 0.377 → 0.373.
- L4, L5 and L6 still pass, with 28 upgrade paths.

**Merged with an approved exception (user decision 2026-10-20).** Wraith early, Abrams
early and late, and Warden early pass on `main` but fail here, and M2 fails: one item is
in every early phase. The gate asked for no regressions; the user accepted these four,
listed in `KNOWN_LEAN_GAPS`, for the net 6 → 11. The cause is ITEM
VALUATION, not the need. Haze's need is now strongly gun (gunDamage target 204 of 589),
but the gun items Oracle+ Haze players actually open with (Rapid Rounds, Swift Striker,
Active Reload: fire rate, reload, ammo) score little coverage per soul in
`itemAdapter`. Spirit and vitality items win early anyway.

Two things were tried and rejected:

- **Raising `CATEGORY_SPLIT_MAX_FRACTION`** (0.5 / 1 / 2 / 4) changed nothing.
- **A per-category value-per-soul reconciliation over the catalogue** made builds very
  diverse (mid overlap 0.18, 8 distinct early phases), but less like real play (M1 5/24),
  and gun stayed about 14% early.

### Profile in fight-value units (Milestone G4, 2026-10-25)

`fitCategorySplit.ts` now values each phase's purchases in the hero's own fight value at
the phase checkpoint, by default:

- the starter-build boon level and base spirit power;
- the kit heal;
- nothing owned;
- shot accuracy at the fitted rank.

`--item-units` restores the old hero-agnostic values. So the measured profile and the
basket now use one scale.

**Retried after G2a.** C4 failed because healing counted over one trade. With healing
between trades valued (G2a), the same refit passes. Window 09-30 → 10-25, the same as the
previous table, so data drift is ≤ 0.001 on the splits.

| Measure         | Item units | Fight units |
| --------------- | ---------- | ----------- |
| Mean L1         | 0.111      | 0.102       |
| Abrams late     | 0.02       | 0.02        |
| Lady Geist late | 0.28       | 0.11        |
| M3              | 0.088      | 0.077       |
| O2              | 0.780      | 0.816       |

**Profile shift** (mean of 44 heroes):

- sustain falls (late 10.4% → 4.9%);
- mobility rises (late 5.4% → 15.9%; Paige, Kelvin, Warden, Bebop, Lash and Lady Geist
  reach 30–38% early or mid). Every move-speed rider counts in fight units;
- gun damage rises (late 15.2% → 24.3%).

**Baselines.** 36 of 72 changed. Extra Stamina, Guardian Ward and Enduring Speed are
gained; Spirit Resilience, Superior Cooldown and Cultist Sacrifice are lost.

**Ratchets.** The live ratchets were moved to lock this in: M3 baseline 0.077, O2 0.816.

**One model.** The fitter builds each hero's model with `heroValuationModel` (heroBasket),
as `runHeroBasket` does.

**Recorded in the table:**

- `method.profileUnits` (`"fight-value"`);
- `method.itemUnitHeroes`: Drifter and Solomon, which have no parseable damage model and
  are fitted in item units with a warning.

**Safety.** The fitter refuses to run when no shot accuracy loads (it fails open to
empty, which would mean 100% accuracy).

**Accepted simplifications:**

- base spirit power with nothing owned;
- every purchase in a window valued at the window's end checkpoint;
- accuracy from the fitted rank's (Oracle) all-time bucket, not the `--days` window.

To reproduce the table: `npm run fit-category-split -- --days 25`, run on 2026-10-25.

## Hero-relative damage and soft saturation (tried alone, then superseded)

Two follow-ups to the four regressions above, each measured alone against the same gate
and each short of it. Both are now part of "One value scale" below; this section records
why neither works on its own.

- **Hero-relative damage (PR 3):** `heroDamage.ts` prices gun and spirit stats as % of
  this hero's sustained DPS. Correct in isolation, and it fixed four stat bugs (reload
  items penalised, fire rate from an active treated as permanent, Burst Fire's fire rate
  missed, the `WeaponPower` sentinel read). Gate: M1 5/24, 5 regressions, M2 passes, mid
  overlap 0.339.
- **Soft saturation** (`U(c)` replacing `min(T, c)` in `computeCoverageGain`), swept on
  top of PR 3: exponential `T(1 − e^(−c/T))` M1 9/24; clamp + tail α 0.15–0.4 M1 4–5;
  power p 0.5–0.7 M1 3–7. Every curve kept 4–5 regressions; neighbouring settings
  swung widely.

**Why neither works: categories are valued in different units, and the need cannot fix
that.** Targets are need × a constant and gain is the item's RAW value, so below the
target the need cancels out; it only sets where the curve bends. Since PR 3, damage is
"% of DPS", but sustain, mobility, utility and economy are still raw stat sums and come
out several times larger per soul. Lady Geist at 5,900 souls (spiritDamage target 128,
her largest): Extra Spirit is worth 7.4, Monster Rounds 21.1 (18 of it economy), Healing
Rite 19.6. That diagnosis led to "One value scale" and "Spend like real players" below.
Do not re-sweep caps or curves to fix the build mix: the mix is spent by shop budgets.

## One value scale (heroDamage.ts, heroFight.ts)

Every item stat and effect estimate is priced in one unit: **% of this hero's fight value
in a trade** (a 10 s fight). It replaced a heuristic sum of raw stat numbers × weight
classes, which was the root cause behind every failed coverage-model attempt (see the
section above): damage was already "% of DPS", but sustain, mobility, utility and economy
were raw sums several times larger per soul, and the need vector cannot fix a unit
mismatch. Below a category's target the need cancels out (target = need × constant, gain =
raw value), so it only ever set where the curve bends.

- **Damage** (`heroDamage.ts`): gun stats through the hero's own weapon (sustained DPS
  over clip + reload, × rank accuracy); spirit power through the hero's own ability
  coefficients. `castsPerTrade(cooldown)`: a short cooldown counts up to 2 casts, a long
  one once × min(1, 30 s ÷ cooldown). It is shared by abilities and item actives.
  Per-cooldown averaging made casters look like gun heroes (Lady Geist's kit ≈ 8 DPS),
  and Wraith's Card Trick (a 0.6 s minimum between throws; its cards come from landing
  bullets) counted 75 DPS.
- **Everything else** (`heroFight.ts`): +1% effective HP is worth +1% DPS, because a 1v1
  is won on DPS × effective HP. Health is % of max HP; resist is the effective-HP gain
  against a 50/50 bullet/spirit mix; a barrier is raw HP (absorbed after resist); healing
  is HP over the trade plus recovery before the next one (Milestone G2a, below); CC is the share of the trade the enemy can't fight. Mobility,
  utility and economy have no identity and use named exchange rates (`FARM_TO_FIGHT`,
  `MOBILITY_PER_SPEED_PERCENT`, ...). Each effect estimate carries a `unit` + `quantity`
  (`effectEstimator.ts`) and converts in `estimateFightValue`. Engine fixture 21l checks a
  bag of the known estimator keys; add a new estimator key to that bag, since an unlisted
  one would slip through.
- **Coverage curve:** `saturate(c, T) = T(1 − e^(−c/T))` replaces `min(T, c)`. With
  hero-relative values a gun hero's first gun items hit the clamp, and further gun was
  worth 0 (Haze bought 0% gun mid-game). The target per slot went from 50 to 75 (best of a
  0.5–3× sweep).
- **Always-on vs conditional:** a stat on an item with a cooldown or a timed effect is that
  effect's buff (× 0.4) unless the API lists it in the item's INNATE tooltip section
  (`Item.innateStats`, parsed in `itemNormalizer.ts`; 136 of 156 shop items have one).
  Burst Fire's +10% fire rate is innate; its on-hit burst is not. A section with no
  `section_type` (common in live data) is NOT innate. No tooltip sections at all =
  `innateStats` undefined (unknown), treated as conditional.
- **Relevance gate** (`coversNeed`, `RELEVANCE_MIN_GAIN_FRACTION` = 2% of a slot): the
  saturating curve never returns exactly 0, so "covers nothing" now means a gain under 2%
  of one slot's coverage (best of 0 / 2 / 5 / 10% with the full stack). Without the threshold every bounded term could promote an item
  whose real gain is ~0 (audit 2026-10-24).
- **Missing data is not zero:** `deriveHeroDamageModel` returns no model when the weapon or
  the ability kit does not parse (live 2026-10-24: Solomon only; every spirit item would
  otherwise price at 0). It sets `survival` only when health and move speed are known, so
  defence keeps the heuristic rather than pricing at 0.

**Brought onto the scale by the item scoring review (R2a, 2026-10-25;
`docs/item-scoring-review.md` C1–C3):**

- **Ability damage per cast (C1).** `mapApiAbilityToHeroAbility` picks the ability's own
  damage property, from damage-class keys that are not modifiers (`Percent` / `Pct` /
  `Bonus`):
  1. a positive key named exactly `Damage`;
  2. else the spirit-scaled positive key, else the first positive one;
  3. else a zero-base key an upgrade raises (Haze Fixation `ProcDamage`).

  A rate key (`…DPS`, `…PerSecond`) records `damageSeconds` from `AbilityDuration`, then
  `MaxLifetime`, then `BurnDuration`. The damage model and the need vector multiply base
  and scaling by it once (`damagePerCastFactor`). The UI keeps showing the rate, labelled
  "dmg/s". Upgrades apply to the ability's own key; an `EAddToScale` bonus scales with its
  `scale_stat_filter` (spirit or weapon; unknown filters add nothing). The hero damage
  model ignores ability levels, so the upgrade fix changes only the planner's numbers.
  Checked roster-wide on 2026-10-25: 139 of 176 abilities unchanged and every change
  reviewed (PR R2a body).

- **Mystic Reverb (`TechDamagePercent`).** A proc: 50% of the strongest ability's first
  hit, at least `MinimumDamage`, once per item cooldown and at most once per cast of that
  ability. For a damage-over-time ability the first hit is one second of it. It was a
  permanent +50% to all ability damage.
- **`MaxHealthDamage`.** Inert on both paths: it is unconfirmed (in no tooltip, not on the
  wiki).
- **Escalating Exposure (`MagicIncreasePerStack`).** An amp on ability damage at half the
  stacks a trade reaches: one stack per spirit hit, at most one per 0.7 s, capped at
  `MaxStacks`.
- **Charged abilities.** `HeroAbility.charges` comes from `AbilityCharges >= 1`. Charges an
  ability WITHOUT base charges gains from an upgrade are kept apart in `upgradeCharges`
  (tier + count; live 2026-10-25: 6 abilities, e.g. Lady Geist Life Drain +3 at T3,
  Infernus Flame Dash +2 at T3). Each ability carries a 0-1 `chargeCredit`: 1 for base
  charges, `UPGRADE_CHARGE_CREDIT[tier][phase]` for upgrade charges (T2 / T3: early 0, mid
  0.5, late 1; T1: early 0.5, then 1; assumed, not measured: the basket pipeline is not
  given the player's ability levels, so using BuildClient's real tier is a follow-up), else
  0 (review R2c). The phase is the one the basket shops in (`runHeroBasket` passes it). `BonusSpiritForChargedAbilities` and
  `BonusAbilityCharges` (via `HeroFightModel.chargedAbilityDps`) weight ability DPS by it,
  so Haze and Abrams get nothing and Life Drain counts 0 early, half mid, full late.
- **Melee damage % (`BonusMeleeDamagePercent`).** % of light melee on the hits landed in a
  trade (`MELEE_HITS_PER_TRADE` x `MELEE_LANDS`, now in `heroDamage.ts`). Colossus counts
  at its 7 / 37 s active uptime.
- **No damage model (C3).**
  - A timed, non-innate fire rate is conditional (Kinetic Dash).
  - A cooldown headshot bonus is a flat proc: damage x `EFFECT_CONFIDENCE` x
    `HEADSHOT_IN_TRADE`, counted as hit-dependent.
  - Melee Lifesteal's value was always one heal; only its reason text said "per hit".
    `fitCategorySplit` values items on this path, so a refit picks up C3.

**Was open (C4), resolved in Milestone G4:** the phase stat profile in
`heroCategorySplit.json`, which sets the targets of antiHeal, sustain, utility, economy and
mobility, was fitted with hero-agnostic values in the old units. G4 refits it in
fight-value units ("Profile in fight-value units").

**Bugs found on the way** (data-verifier 2026-10-24, live item text):

| Item / key                                                                                      | Was                      | Now                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OutgoingDamagePenaltyPercent`                                                                  | always an enemy debuff   | Golden Goose Egg / Cursed Relic: the buyer's own drawback (negative damage). Inhibitor / Haunting Shot (carry `DebuffDuration`): enemy debuff. The sign alone cannot tell them apart |
| `HeadShotBonusDamage` (Headshot Booster, Headhunter)                                            | +45% weapon damage × 0.4 | flat damage on the next headshot, once per cooldown                                                                                                                                  |
| Melee Lifesteal `LifestrikeHeal`                                                                | every melee hit          | once per cooldown ("your next melee attack heals")                                                                                                                                   |
| Stalker `DPS`                                                                                   | 83% uptime               | close-range proc, conditional                                                                                                                                                        |
| Tesla Bullets / Capacitor chains                                                                | every jump hits a hero   | the hit target + 0.4 per further jump (whether `ChainCount` includes the hit target is unpublished)                                                                                  |
| Kinetic Dash `BonusFireRate`                                                                    | permanent                | timed (lasts 7 s after a dash)                                                                                                                                                       |
| Golden Goose Egg `BonusGoldPerMinute`                                                           | unmapped                 | souls per minute                                                                                                                                                                     |
| `DegenResistance`, `MoveSpeed`, `BulletLifesteal`, `TechLifesteal`, `BonusWeaponPowerNonPlayer` | mapped                   | removed: no shop item carries them                                                                                                                                                   |

Alone, the value scale does not meet the phase gate (live, 2026-10-24: M1 12/24). With
correct values, a hero's strongest category wins every early pick (Haze opened 86% gun).
The value scale decides WHICH items; "Spend like real players" (below) decides how much
of each shop.

### Healing between trades (Milestone G2a, 2026-10-25)

Healing over one 10 s trade made regen and lifesteal worth little; that sank the C4
profile refit (`docs/item-scoring-review.md` §2.2). `heroFight.ts` now adds RECOVERY:
HP restored in the 30 s gap (`TRADE_GAP_SECONDS`) before the next trade
(`docs/milestone-g.md` §3.1).

- **What heals in the gap.**
  - Regen ticks the whole gap.
  - Out-of-combat regen ticks only in the quiet stretch (`1 − GAP_FARM_SHARE` of the gap),
    after its delay _inside_ that stretch: 4 s, or an item's own `RestoreDelay`
    (Fortitude 10 s).
  - Lifesteal heals only while farming, at the non-hero rate (bullet 60%, spirit 40%).
  - A heal over time longer than the trade finishes in the gap.
- **Weight and cap.** Recovery HP is worth `RECOVERY_WEIGHT` (0.5) of in-trade HP and
  saturates at `RECOVERY_CAP_PCT` (50% of max HP, about what a trade costs).
- **Unmeasured judgment values.** `RECOVERY_WEIGHT`, `RECOVERY_CAP_PCT` and
  `GAP_FARM_SHARE` are reasoned, not fitted. G4 (the profile refit) is where they get
  tested against real play.
- **The cap is for the whole build.** Recovery is marginal over `ownedGapHeal`: the
  hero's base regen plus the owned items (`withOwnedGapHeal` in `heroBasket.ts`, from the
  already-owned build only). Out-of-combat regen no longer counts inside a trade (hero
  damage holds it off for 4 s). `ownedGapHeal` reads the owned items' raw stats only:
  estimator heals (heal-over-time actives) and spirit scaling are left out. That
  slightly under-counts owned healing, so a candidate's recovery is slightly
  over-credited.
- **Bug that already happened once.** The first version took the delay off the whole gap
  and then halved it. That gave Fortitude 10 s of regen (22.5% of HP), so it beat Colossus
  for Abrams late and freed two slots for gun items: Abrams late moved 0.02 → 0.22 and
  mean L1 0.114 → 0.130. The delay runs inside the quiet stretch (Fortitude: 5 s).
- **Result.** Live gates unchanged (M1 24/24, mean L1 0.114, M3 0.080, O2 0.760). 14 of 72
  baselines changed: 10 headline relabels (Extra Regen, Healing Booster), two with term
  values only, and three late swaps (Lady
  Geist Enchanter's Emblem → Bullet Lifesteal, Seven Greater Expansion → Superior
  Cooldown, Wraith Mystic Vulnerability → Arcane Surge). Engine fixture 28.

**G2b: healing keys that were unpriced (2026-10-25).** About 18 shopable healing keys were
read by nothing.

- **Lifesteal** (`heroFight.lifestealShares`):
  - Vampiric Burst `ActiveBonusLifesteal` is bullet lifesteal and conditional.
  - Spiritual Overflow `BonusSpiritLifesteal` is conditional.
  - Infuser `AbilityLifestealPercentHeroPassive` is always on.
  - Between trades only always-on lifesteal heals: nobody pops a 30 s active to farm.
- **Estimates** (`effectEstimator`):
  - `healPerProc`: once per cooldown, counted with `castsPerTrade`. It covers Restorative
    Shot `HealFromHero`, Radiant Regeneration `HealingPerCast`, Dispel Magic
    `HealOnActivate` and Veil Walker `HealOnVeil`. The last two are situational
    (`SITUATIONAL_HEAL_SHARE` 0.4: a debuff to purge, a veil nearby).
  - Mystic / Radiant `Regeneration` × `RegenerationDuration`: also `healPerProc`, so
    Radiant's regen and per-cast heal count on the same per-cast basis. A missing
    duration falls back to 7 s, not 0.
  - `healPercentPerHeadshot`: Headhunter, times `HEADSHOT_IN_TRADE` and the hero's gun
    share (a headshot needs the gun).
  - Lifestrike's fixed `LifestealHeal`: per melee hit, in the same loop as Melee
    Lifesteal's `LifestrikeHeal`.
- **Deliberately unpriced, with reasons:** `UNPRICED_HEALING_KEYS`.
  - Parry heals and kill heals: no measured parry or kill rate.
  - Siphon Bullets' `StealPerHit` / `StealPerKill` flags (priced in G2c, below).
  - Lifestrike's % of melee damage: the estimate has no melee damage.
  - Heals against creeps: farming heals are not modelled.
  - Heal amp: priced in G3.
- **Fixture.** Engine fixture 29 scans the frozen catalogue: every key matching
  `/Heal|Lifesteal|Regen|Steal/` must change its item's sustain, or be listed in
  `UNPRICED_HEALING_KEYS`, or be in the fixture's `NOT_HEALING` set (thresholds,
  durations, anti-heal). A new or renamed key fails it until someone decides.
- **Result.** Live gates unchanged.
  - Baselines: 9 of 72 changed.
  - Abrams buys Restorative Shot early and Lifestrike late, as real Abrams players do.
  - Haze late takes Headhunter.
  - Infernus late swaps Escalating Exposure for Dispel Magic and three smaller items.

**G2c: Siphon Bullets (2026-10-25).** deadlock.wiki (Siphon_Bullets, checked with the user)
says each steal does two things, at most once per `ProcCooldown` (1.2 s) while shooting a
hero:

- **Damage.** 2.5% of the target's max HP (`maxHealthPercentPerProc`).
- **Survival.** The buyer's max HP rises by the same amount and they are healed by it. The
  heal only fills the new max HP, so it is counted once, as `healPerGunProc` sustain,
  scaled by the gun share like Headhunter.

**One steal rate for both.** The rate is `min(1 / ProcCooldown, landed shots / s)`
(`gunProcRate` in itemAdapter, `landedShotsPerSecond` on the fight model). A
cooldown-gated proc is `requiresHit`, not `perHit`. A missing `ProcCooldown` falls back to
1.2 s, not zero.

**Enemy max HP.** Both items first used `REFERENCE_ENEMY_HEALTH` (2,500). Since
2026-10-25 they use a typical enemy's health at this point in the game ("Enemy health over
the game" below); 2,500 is only the fallback.

**Not priced:**

- `StealPerHit` and `StealPerKill` are flags. The permanent steal on kill was removed on
  2026-03-06.
- The Enhanced / Corrupted values are out of the planner's scope.

**Result.** Live gates unchanged. Siphon enters 4 of 72 baselines: Haze and Warden late,
both empty and owning early.

## A hero's own self-healing (kitHeal.ts, Milestone G3)

`docs/milestone-g.md` §3.2.

**Parser.** `mapApiAbilityToHeroAbility` records `HeroAbility.selfHeals`: each self-heal
property's base value, per-tier bonus and spirit scaling (`scale_function_healing_spirit_scale`,
or an `EAddToScale` upgrade). `KIT_SELF_HEAL_KEYS` gives each key one of these kinds:

- lifesteal on the ability's own damage, or on gun or melee damage;
- a flat heal per cast;
- a heal per second over the duration;
- % of max HP, % of max HP per second, or % of missing HP;
- % of damage taken.

**Not parsed:**

- `ALLY_HEAL_ABILITIES`: Kelvin Frost Grenade, Paige Rallying Charge, McGinnis Medicinal
  Specter, Rem Lil Helpers, Nurse Harrow Healing Needles. The keys don't say who is healed,
  only the descriptions do.
- Kill-gated heals.
- `KIT_HEAL_SHARE`: only part of some properties counts. Wraith Card Trick heals only on
  Heart cards, one random suit in four (`HeartHeal` × 0.25). Without it, Wraith's kit came
  to 21% of max HP per trade and Healing Booster flooded Wraith mid.

**Kit heal per trade.** `kitHealPerTrade` uses the damage trade model (`castsPerTrade`,
`TRADE_SECONDS`) and credits tiers by phase with `UPGRADE_CHARGE_CREDIT`. Named
assumptions:

- `MISSING_HP_SHARE` 0.5;
- `TRADE_DAMAGE_TAKEN_SHARE` 0.5.

`withKitHeal` (heroBasket) sets `survival.kitHealHp`.

**Uses:**

- **Heal amp (G3-5).** `HealAmpCastPercent` / `HealAmpRegenPercent` multiply
  `ampableHealHp`: kit heal plus the owned items' in-trade lifesteal
  (`ownedTradeHealHp`). Item regen is left out (wiki Healing_Booster). The two keys are
  one stat, so the larger is used once.
- **Sustain need (G3-3).** `kitSustainNeed` gives neutral at 0 and up to +50% at 20% of max
  HP per trade. It is used only where no measured profile exists. Across the 42 parseable
  profiled heroes, kit heal rank-correlates with the measured sustain share (Spearman 0.40 early, 0.38 mid, 0.31 late). Drifter and Solomon have no parseable damage model.

**Result:**

- **Live:** mean L1 0.114 → 0.111, O2 0.760 → 0.780, Abrams mid 0.14 → 0.06.
- **M3 rose 0.080 → 0.088.** Healing Booster mid for Abrams and Lady Geist, whose real
  players buy it 21% and 53% of the time. The user approved raising the ratchet 0.076 → 0.0781
  (measured overlap 0.08802).
- **Baselines:** 6 of 72 changed, all Healing Booster.

**Review fixes (auditor and /code-review):**

- Kit heal enters the need vector only when no measured profile applies
  (`hasStatProfile`). `applyStatProfile` rescales the whole vector by its total, so even a
  replaced sustain changed every profiled hero's magnitudes.
- Only spirit-power `EAddToScale` upgrades count as spirit scaling, and a multiplier key's
  spirit scaling is read as a percent like its base.
- A passive (cooldown 0) has no own damage to lifesteal from, as in `abilityDps`. Melee
  lifesteal is scaled by the buff's uptime.
- Ally-only abilities are keyed by class name, not display name.
- Heal amp takes the larger of the two keys after the timed-stat weight. Healing Tempo's
  cast amp is innate.

**Accepted and documented:**

- An owned Booster does not raise a candidate lifesteal item's value (owned-only
  valuation).
- `HealOnHit` / `HealPerPickup` count once per cast.
- A per-second heal with no duration counts the whole trade.
- For a hero with no profile, kit heal raises the sustain need and is also what heal amp
  prices on.

## Spend like real players (shop budgets, laning tempo, buy order)

With one value scale, a hero's strongest category wins every pick, and real builds are a
mix. `categorySplitTerm` only nudged toward the measured shop split. Five attempts to get
the mix through the coverage caps traded one failure for another (see the sections
above), so the mix is now spent directly:

- **Shop budgets** (`BasketContext.shopBudgets`, set when `runHeroBasket` passes
  `spendByShop`): each shop may take its measured phase share × 1.15
  (`SHOP_BUDGET_SLACK`, best of 0 / 15 / 30%), shares normalised to sum to 1. Early / mid
  shares are PURCHASES in that window ("increment": they split this basket's souls). The
  late phase and heroes without phase data use the FINAL split ("cumulative": each shop
  is topped up to its share of owned + basket souls, so souls already held count; the
  first version split only the increment and ignored owned items, audit 2026-10-24). The greedy loop first considers only
  items their shop can still pay for. When no shop has room for a useful pick, the
  leftover souls become one shared pool (second pass), so a phase still spends its
  budget (L5); such a pick carries a zero-value `shop-budget` reason saying so.
  `categorySplitTerm` is inert when budgets are set, since the budgets already spend the
  split. The probe's `--split-need-only` / `--split-term-only`
  ablations keep the old nudge.
- **Laning tempo** (`rankingPrice`, `LANING_TEMPO` = 1, `ctx.phase === "early"` only,
  priced on the phase's souls `ctx.laningSouls`, not on what is left after owned items).
  Souls saved toward an item give nothing until it is bought, which is when a laner is
  punished. A 3,200 item at 5,900 souls needs ~54% more value per soul than at no tempo.
  Real Oracle+ early purchases put 3–9% of souls into 3,200+ items for most heroes. The
  exceptions are deliberate rushes: Seven's Cultist Sacrifice 26%, Lady Geist's Radiant
  Regeneration 36%. Applied in every phase, tempo also penalised normal late-game 6,400
  buys and broke late fidelity, so it is laning only.
- **Buy order** (`StarterPhase.buyOrder`): each phase's picks cheapest first by souls
  paid, components before the upgrade that consumes them. It changes display order only,
  never which items are picked.

Live, with the value scale (2026-10-24): M1 23/24 (the four accepted regressions all
come back), mean L1 to real play 0.146 (`main` 0.336). Which items fill each shop is the
next section's job.

## Enemy health over the game (enemyHealth.ts, 2026-10-25)

Toxic Bullets and Siphon Bullets deal or steal % of the TARGET's max health. A fixed 2,500
under-priced them late (user, G2c). The user's sandbox screenshots set the scale: full
builds at boon 35 (~45k souls) have 3,356 (Graves) to 4,629 (Abrams) health.

**Base health alone is far too low.** The roster median at boon 35 is 2,210. Most late
health comes from the shop, and mostly from the **vitality investment bonus**
(`CATEGORY_BONUS_TIERS.healthBonus`, up to +56% of base health). Abrams: 2,515 × 1.56 +
~700 flat items ≈ 4,629.

**Formula.** `enemyHealthAt({ souls, boonLevel, roster, rates })` =
roster median base health at the boon level × (1 + vitality bonus % + item % base health)
\+ flat item health. Each shop term is a per-phase rate per soul, accumulated over the souls
spent in each phase (`EARLY_PHASE_MAX_SOULS`, `MID_PHASE_MAX_SOULS`).

**Measured rates** (`measureEnemyHealthRates`, roster-wide, every hero weighted equally):

- flat health per soul: `BonusHealth` of what Oracle+ players buy per phase
  (`heroPhaseItems.json` buy rates);
- % base health per soul: `BonusBaseHealth` (Colossus +25) and `MaxHealthLossPercent`
  (Glass Cannon −13, stored negative);
- vitality share per phase: mean of `heroCategorySplit.json` early / mid splits, and the
  final split for late.

**Rules learned:**

- An upgrade counts only what it adds over its direct components (health and price). It
  consumes them, and their own buys are counted where they happened.
- Cultist Sacrifice's and Unstable Concoction's `BonusHealth` are `ConditionallyApplied`
  (summon / per-effect) and are not the owner's health.
- The rates are roster-wide: an enemy is any hero. They travel as their own
  `runHeroBasket` input (`enemyHealthRates`, read with `enemyHealthRates(table)`), never
  inside the per-hero slice. In the first version a hero missing from the table, or
  `--no-phase-items`, silently fell back to 2,500.
- `healPerGunProc`'s quantity is now % of the target's max HP, converted in heroFight.

**Where the numbers live.** The fitter writes the rates into `heroPhaseItems.json`
(top-level `enemyHealth`). It values each phase's purchases with the COMMITTED rates, so a
refit's profile lags its own rates by one refit. The profile in the current
`heroCategorySplit.json` was fitted at the fixed 2,500; the next monthly refit picks the
rates up.

**Accepted simplifications:**

- items sold later still count;
- the late vitality share is the final inventory's (it includes earlier buys), applied to
  late souls;
- one typical enemy, not a per-matchup one.

**Curve** (frozen roster, 2026-10-25):

| Boon / souls             | 10 / 5.9k | 16 / 10.7k | 22 / 16.7k | 29 / 30k | 35 / 45k |
| ------------------------ | --------- | ---------- | ---------- | -------- | -------- |
| Enemy health (was 2,500) | 1,341     | 1,748      | 2,449      | 3,005    | 3,537    |

**Result.** Live gates unchanged (M1 mean 0.102, M3 0.077, O2 0.816). Nine of 72 baselines
changed. Toxic Bullets enters three boon-29 baskets (Abrams, Haze owning early, Lady Geist)
and leaves Infernus at boon 16. Engine section 31 holds the calibration: 3,300–4,600 at a 45k-soul
build, and mid within 15% of 2,500.

## What players on this hero buy (phaseItems.ts, phaseItemTerm)

Value scale and shop budgets decide how much of each shop and which items are strong in
general. They cannot see kit synergies: Abrams opens melee (Close Quarters 84%, Melee
Charge 73%), Lady Geist regen (Mystic Regeneration 91%: her abilities cost health),
Wraith Quicksilver Reload (94%, it pairs with her imbue), Haze fire rate (Rapid Rounds
89%, then Swift Striker). Without this signal only 17 of ~50 early picks and 3 of 50 mid
picks were in the hero's real top 10.

- **Table** (`lib/engine/data/heroPhaseItems.json`, written by `npm run fit-category-split`
  from the same purchase queries as the split): per hero and phase (0–10 / 10–20 / 20+
  min), the share of Oracle+ matches in which the hero BOUGHT each item. Items under 2%
  are left out. It is sliced per hero in `page.tsx` (`heroPhaseItems`, null = not fitted)
  and passed through BuildClient, the starter build and the probe (`--no-phase-items` for
  before/after).
- **Term** (`phaseItemTerm`): `PHASE_ITEM_WEIGHT` (2) × one slot's coverage × (buy rate −
  `PHASE_ITEM_BASELINE` 0.1). A popular item gains; one bought in under 10% of matches
  (or unlisted) gets a mild penalty. That baseline fixed Headshot Booster appearing in 3
  of 8 early builds. The bonus is relevance-gated (`coversNeed`): popularity never buys
  an item covering under 2% of a slot. The penalty needs no gate and is capped at half the
  item's own coverage gain (`PHASE_ITEM_PENALTY_MAX_SHARE`), so it never pushes a useful
  item to ≤ 0. It is strong (up to 1.8 slots at a 100% buy rate) and it is population
  data: `HeroBasketSuggestion` never makes it the headline reason in the simplified view.
  An empty phase in the table is "no signal", not "nobody buys anything".
- **Trade-off:** picks partly follow the current meta. That is what a new player starting
  a build wants, and the reason line names it as such ("89% of Oracle+ players on this
  hero buy it in the first 10 minutes"). Laning tempo is always on in the laning phase;
  for heroes too thin for the table it is the only thing keeping 3,200 rushes out.

Live, full stack (2026-10-24): M1 24/24, M2 passes, mid overlap 0.093 (`main` 0.373), mean
L1 to real play 0.108 (`main` 0.336). O1 passes for 8/8 heroes (42 early picks in the real
top 10) and O2 is 37/53. O1/O2 read the table the term is tuned on, so Fixture 13 also
logs them without the signal (18 early, 3/50 mid): that gap is the signal's contribution. T1 fails for the three real rushes (Seven, Lady Geist, Wraith):
the shop budget defers the rush to the next phase as an upgrade.

## Roadmap: Milestones F and G (full scope, moved from CLAUDE.md's history table)

**F — item-combination / covariance layer (in progress).** Single-item empirical
win rate is already handled in Milestone E via `lib/analyticsStore.ts`
(`ItemAnalytics.winRate`). F is specifically pairwise correlation. The original
plan (ingest `/v1/matches/{id}/metadata` and regress offline) is superseded: the
pre-aggregated pair endpoint above gives the same per-hero counts without
ingestion. See "Milestone F spike" for the method, results and guardrails.
Remaining work:

1. ~~An offline fitter producing a committed per-hero pair table.~~ Done in PR
   2; see "Pair lift table".
2. ~~A pure lift function with fixtures.~~ Done in PR 2.
3. ~~A `pairTerm` `MarginalTermFn` in `constructBasket()`, passed through
   `page.tsx`, `BuildClient` and `basketProbe.ts`.~~ Done in PR 3; see "Pair
   term in the basket".
4. ~~A synergy / anti-synergy audit view.~~ Done in PR 4; see "Synergy audit
   report".
5. ~~A pair reason in the simplified view.~~ Done in the item scoring review
   (R4): `measuredPairReason`, shown as a labelled "Measured" line, never the headline.

**F closed 2026-10-25** (item scoring review, `docs/item-scoring-review.md`).

It is the measured counterpart to the hand-authored synergy table above.

**G — closed 2026-10-25, re-scoped to kit and sustain enrichment** (`docs/milestone-g.md`).
The queued scope fed the five non-family need categories, but the measured stat profile
already sets those for every profiled hero. G instead fixed how sustain is valued:

- healing between trades (G2a);
- the unpriced healing keys and Siphon Bullets (G2b / G2c);
- a hero's own self-healing and heal amp (G3, "A hero's own self-healing");
- the profile refit in fight-value units (G4, "Profile in fight-value units").

**The hero-tags mapping is retired.** `tags` are 116 distinct flavour words, some of them
jokes. `hero_type` files spirit-heavy Infernus and Mina under marksman. `gun_tag` describes
the weapon. None of them carries a sustain or role signal (data-verifier, 2026-10-25).
