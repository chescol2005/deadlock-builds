---
name: deadlock-api-integration
description: >
  Fetch, normalize, and cache game data from the Deadlock assets API
  (api.deadlock-api.com/v1/assets) for Deadlock Foundry. Use this skill whenever
  touching lib/api/deadlockApi.ts, lib/itemNormalizer.ts, lib/itemStore.ts,
  or lib/heroStore.ts, or when adding/reading any API field, mapping a raw
  API shape to a normalized type, resolving item icons, deriving item tags,
  reading spirit scaling coefficients, or debugging why an item/hero shows
  the wrong image, category, cost, or stat. Also use when the user says
  "fetch items", "normalize", "the API changed", "wrong icon", "item shape",
  or references any api.deadlock-api.com endpoint. Always consult this
  skill before trusting a field name — raw API field mistakes are the #1
  bug source in this project.
---

# Deadlock API Integration Skill

## The One Rule That Prevents Most Bugs

There are **two data shapes** and they are easy to confuse:

- **Raw API shape** (`UpgradeV2Raw`, `HeroV2Raw`, `HeroAbilityRaw` in
  `lib/api/deadlockApi.ts`) — **snake_case**, straight from the wire.
- **Normalized shape** (`Item`, `HeroBaseStats` in `lib/items.ts` /
  `lib/heroStats.ts`) — **camelCase**, what the rest of the app consumes.

`lib/itemNormalizer.ts` is the only bridge between them. Never let a raw
field leak past the normalizer, and never assume a normalized object still
has raw field names.

> Note on paths: CLAUDE.md and older skills say `src/lib/…`. The real tree
> has **no `src/`** — code is at `lib/…` and `app/…`. Use the real paths.

---

## Endpoints (unauthenticated)

Base: `https://api.deadlock-api.com` (all paths verified 200 on 2026-10-17).

> `assets.deadlock-api.com` no longer exists (DNS NXDOMAIN, no redirect).
> Never use it or `/v2/...` paths; old docs mentioning them are stale.

```
GET /v1/assets/items                      // all items (raw UpgradeV2Raw[])
GET /v1/assets/items/by-slot-type/{slot}  // slot = weapon | spirit | vitality
GET /v1/assets/heroes/{id}                // hero starting_stats + level upgrades
GET /v1/assets/items/by-hero-id/{id}      // hero ability items (signature/ultimate)
GET /v1/assets/items/{class_name}         // one item; used for a hero's weapon
GET /v1/assets/ranks                      // rank tier names (never hardcode)
GET /v1/analytics/hero-stats              // per-hero win rate, shots hit/missed
GET /v1/analytics/hero-stats?bucket=avg_badge  // same, partitioned by rank
GET /v1/analytics/item-stats              // per-item { matches, wins, winRate }
```

Analytics wrappers live in `lib/api/analyticsApi.ts` (cached via
`lib/analyticsStore.ts`, fail-open). **`ItemAnalytics.itemId` joins to
`Item.numericId`, NOT `Item.id`** (the class_name).

**Verify with curl, not WebFetch.** WebFetch summarizes and can lose exact
field names. Use `curl -s URL | node -e '...'` to inspect raw JSON.

Fetch wrappers already exist — reuse them, don't re-implement:
`fetchAllItems()`, `fetchHeroStats(id)`, `fetchHeroAbilityItems(id)` in
`lib/api/deadlockApi.ts`.

`fetchAllItems()` already filters to `type === "upgrade"`, `shopable === true`,
`disabled !== true`, `item_tier <= 4` (tier 5 = Street Brawl, excluded).

---

## Raw → Normalized field map

| Concept    | Raw (`UpgradeV2Raw`)                    | Normalized (`Item`)               |
| ---------- | --------------------------------------- | --------------------------------- |
| identifier | `class_name`                            | `id`                              |
| category   | `item_slot_type` (`"weapon"`/…)         | `category` (`"gun"`/…)            |
| tier       | `item_tier`                             | `tier`                            |
| cost       | `cost` (may be string-ish → `Number()`) | `cost`                            |
| icon       | `shop_image_webp` → `shop_image` → …    | `icon`                            |
| components | `component_items`                       | `componentItems`                  |
| stats      | `properties` (object of `{value,…}`)    | `stats` (`Record<string,number>`) |
| tags       | derived from slot + properties          | `tags`                            |

**Category mapping is not identity:** raw `"weapon"` → normalized `"gun"`;
`"vitality"` and `"spirit"` pass through. Never write `category === "weapon"`.

**Icon priority** (see `normalizeItem`): `shop_image_webp` → `shop_image` →
`shop_image_small_webp` → `shop_image_small`. Never use `image_webp` for the
shop icon — that's generic mod art, not the shop tile.

**Identifier:** normalized `item.id` comes from raw `class_name`. In app code
always key on `item.id`. Never `item.classname` (doesn't exist) and never the
numeric id. The raw numeric `id` is still preserved as `item.numericId` — it
exists solely to join items against match-analytics datasets keyed by numeric
`item_id`. Never use it as the app-side item key.

---

## Item stats — `properties` parsing

`normalizeItem` → `parseStats` walks `raw.properties`. A property is skipped when:
`value` is NaN, `value === disable_value`, or `value === 0 && disable_value === "0"`.
Result is a flat `Record<statKey, number>`.

**Negative values are kept, not skipped.** `parseStats` used to `continue` on
`val < 0`, which silently dropped legitimate debuff-style tradeoffs (items that
boost one stat at the cost of another). That skip was removed deliberately —
do not reintroduce it. `mini.ts` has a synthetic fixture asserting a negative
property survives normalization.

Common stat keys (kept verbatim from the API):

```
TechPower                     // flat spirit power
TechPowerPercent              // % spirit power
BonusHealth / max_health      // health (raw hero stat key is snake_case)
BonusHealthRegen, OutOfCombatHealthRegen
WeaponPower                   // weapon damage %
BaseAttackDamagePercent       // weapon damage % (was BulletDamage — Valve renamed it upstream, old key no longer exists)
BulletResist, TechResist            // % damage resist (not BulletArmorDamageReduction/TechArmorDamageReduction — those keys don't exist)
StatusResistancePercent, DegenResistance, MeleeResistPercent
BonusMoveSpeed / move_speed
BonusAbilityCharges / AbilityCharges
```

Tag derivation (`deriveTags`) keys off slot + property presence: `weapon` +
`WeaponPower` → `dps`; `vitality` → `tankiness` (+`sustain` if Regen/Lifesteal);
`spirit` + `TechPower` → `utility`; move-speed → `mobility`; charges/actives →
`burst`/`utility`. Empty tag set falls back to `["utility"]`.

---

## `weapon_info` — lives on the weapon item, not the hero

Bullet/reload/falloff stats are NOT on the hero's `starting_stats`. Fetch the
item named by `hero.items.weapon_primary` (`/v1/assets/items/{class_name}`) and
read its `weapon_info` (see `WeaponItemRaw` in `lib/api/deadlockApi.ts`).

- `bullets_per_second` already includes pellets — do NOT multiply by `bullets`.
- Falloff ranges arrive in source units; `fetchHeroStats` converts to **metres**
  (÷39.37) exactly once. Consumers must not divide again.
- `damage_per_second_with_reload` feeds `HeroBaseStats.dpsWithReload`.
- Field meaning is NOT uniform across weapons (Graves has a hard cutoff, not
  falloff). See the scoring-engine-dev skill's engine-design-notes.md "Range falloff" — don't re-derive it here.

## Item value scaling — `value` is only the base

`properties[key].scale_function.stat_scale` is Valve's scaling coefficient
(e.g. Mystic Shot `ProcBonusMagicDamage` = `40 + 0.9 x spirit`). It is captured
by `lib/itemNormalizer.ts` into `Item.statScaling`; `parseStats` `value` alone
understates scaled items. Only the single-stat form carries `stat_scale`;
`scale_function_multi_stats` has none. Preserve sign (negative = enemy debuff).

---

## Spirit scaling coefficient — check BOTH patterns

Ability spirit scaling lives on `scale_function`. Two shapes exist in the wild:

```typescript
scaleFn?.class_name === "scale_function_tech_damage" ||
  scaleFn?.specific_stat_scale_type === "ETechPower";
```

Checking only one misses roughly half the abilities. See
`lib/abilityCoefficients.ts` for how the parsed coefficient is consumed.

---

## Caching & fetch policy

- `fetchAllItems()` uses `cache: "no-store"`; hero fetches use
  `next: { revalidate: 3600 }`. Match the existing policy per endpoint — do
  not silently change caching.
- `lib/itemStore.ts` (`getItems()`) and `lib/heroStore.ts` (`getHeroStats()`)
  memoize normalized data. Read through the store; don't call `fetch*` from
  components.
- `deriveUpgradesInto()` in `itemStore` back-fills `upgradesInto` (the
  normalizer leaves it `[]`). Component→upgrade relationships are only complete
  after this pass.

---

## SSR / hydration

- Server components fetch; client components own interaction state.
- **Never read `localStorage` during SSR** — guard with an effect or a mounted
  flag, or hydration mismatches appear (CLAUDE.md common bug #8).

---

## Checklist before trusting any field

- [ ] Is this the **raw** or **normalized** shape? Name it.
- [ ] Field verified against a live response (curl the endpoint or delegate to
      the `data-verifier` agent) — not guessed.
- [ ] Category compared as `"gun"`, never `"weapon"`, in app code.
- [ ] Icon read as `item.icon` (normalized) / `shop_image_webp` (raw), never
      `image_webp`.
- [ ] Spirit scaling checks BOTH `class_name` and `specific_stat_scale_type`.
- [ ] Ran `npm run mini` after any `itemNormalizer.ts` change — normalizer
      changes ripple into scoring and stat math.
