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
  faked, where it doesn't yet (sustain/utility — deferred to Milestone G)
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

## Roadmap: Milestones F and G (full scope, moved from CLAUDE.md's history table)

**F — item-combination / covariance layer (queued).** Single-item empirical
win rate is already handled in Milestone E via `lib/analyticsStore.ts`
(`ItemAnalytics.winRate`); F is specifically pairwise/combination correlation,
which needs per-match granularity. Ingest match-level data from
`/v1/matches/{id}/metadata` (item builds, purchase timing, death events,
win/loss — confirmed available and unauthenticated via a `data-verifier` spike)
into a category×feature design matrix, produce a static regression coefficient
table offline, and wire it into `constructBasket()` as one more
`MarginalTermFn`. Depends on Milestone E's interfaces, not its completion. It is
the measured counterpart to the hand-authored synergy table above.

**G — need-vector enrichment (queued, stretch).** Parse
`HeroAbility.upgrades[].statChanges` free text for a real sustain/lifesteal
signal; hand-author a `hero.tags`/`hero_type`/`gun_tag` → category mapping
(same upkeep shape as `GOAL_WEIGHTS_MAP`/`ANTI_SYNERGY_RULES`). Purely additive
to the need vector, not a prerequisite for E or F.
