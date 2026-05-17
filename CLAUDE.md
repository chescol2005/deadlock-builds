# Deadlock Foundry — Claude Code Project Memory

Competitive companion platform for Valve's game Deadlock.
Built with Next.js App Router, TypeScript strict mode,
Tailwind CSS, deployed on Vercel.

---

## Architecture Rules (NON-NEGOTIABLE)

- TypeScript strict mode: zero `any`, zero suppressed errors
- No business logic in page files — components and lib only
- All build state flows through the herold route (Build-05 contract)
- Deterministic-first: NO AI logic in scoring, calculations,
  or data pipeline — ever
- AI layer changes and scoring changes must be in separate PRs
- All scoring functions are pure — same inputs always same output

---

## Before Every Commit (mandatory, in this order)

```bash
npx prettier --write .
npx tsc --noEmit
npx next build
npm run mini
```

Kill dev server before finishing any session.
Never use `git add .` — stage files explicitly.

---

## Production API — Verified Function Signatures

These were verified by mini.ts. Do not guess — use these exactly.

```typescript
// Items
item.id; // string identifier (NOT item.classname)
item.category; // "gun" | "spirit" | "vitality" (NOT "weapon")

// Scoring
scoreItems(items, goal, currentBuild); // 3 args, not 4

// Build utils
resolveAddItem(currentBuild, newItem); // 2 args
getConsumedComponents(currentBuild); // 1 arg
getEffectiveAddCost(item, currentBuild, allItems); // 3 args

// Boon system
getBoonThreshold(0); // returns boonLevel: 1 (not 0)
// Consumed components after upgrade: size === 1 (tracked)

// Serializer
BuildState.heroId; // "heroId" not "herold"
```

---

## Data Source

All game data: `https://assets.deadlock-api.com` (unauthenticated)

```typescript
GET / v2 / items; // all items
GET / v2 / items / by - slot - type / { slot }; // weapon | spirit | vitality
GET / v2 / heroes / { id }; // hero stats + scaling
GET / v2 / items / by - hero - id / { id }; // hero abilities
```

### Item field names (commonly confused)

```typescript
// Images — use shop fields NOT image fields:
item.shop_image_webp; // ✓ correct shop icon
item.shop_image; // ✓ fallback
item.image_webp; // ✗ wrong — generic mod art

// Upgrade chain:
item.component_items; // string[] of classnames this builds FROM
item.upgradesInto; // string[] derived post-normalization

// Category:
item.item_slot_type; // "weapon" | "spirit" | "vitality" in API
item.category; // "gun" | "spirit" | "vitality" normalized
```

### Spirit scaling coefficient location

```typescript
// Two patterns in the API — check BOTH:
scaleFn?.class_name === "scale_function_tech_damage" || scaleType === "ETechPower";
```

### Stat key mappings

```typescript
// Spirit Power
TechPower; // flat spirit power
TechPowerPercent; // % spirit power bonus

// Health
BonusHealth; // flat health
BonusHealthRegen; // health regen
OutOfCombatHealthRegen;

// Weapon
WeaponPower; // weapon damage %
BulletDamage; // flat bullet damage

// Resist
BulletArmorDamageReduction;
TechArmorDamageReduction;
```

---

## Game Mechanics (verified against deadlock.wiki)

```typescript
// Item tiers
VALID_TIERS = [1, 2, 3, 4]; // tier 5 = Street Brawl only

// Ability upgrades
ABILITY_UPGRADE_COSTS = [1, 2, 5]; // ability points per tier
ABILITY_MAX_LEVEL = 3;

// Economy
SELL_REFUND_RATE = 0.5; // 50% of item cost
MAX_ACTIVE_ITEMS = 12; // active build cap
GAME_PLAN_CAP = null; // game plan is unlimited

// Investment bonus
SIGNIFICANT_THRESHOLD = 4800; // souls — big stat jump
MAX_INVESTMENT = 28800; // souls — bonus caps here

// Boon thresholds (key values)
ABILITY_UNLOCK_1 = 600; // souls
ABILITY_UNLOCK_2 = 1200;
ABILITY_UNLOCK_3 = 2100;
ULTIMATE_UNLOCK = 3600; // boon level 7
// getBoonThreshold(0) returns boonLevel: 1

// Known spirit scaling coefficients (Graves)
// Jar of Dead: 0.35
// Grasping Hands: 1.6
// Shoulder Charge: 1.4
// Seismic Impact: 2.325
```

---

## Key Files Reference

src/lib/items.ts — Item, ItemAssignment,
ItemPhase, BuildCategory types
src/lib/deadlock.ts — re-exports, AbilityLevel type
src/lib/buildCalculations.ts — all pure calc functions
calculateStatTotals()
calculateDamageSplit()
calculateSoulTimeline()
getSkillPathGrid()
src/lib/buildSerializer.ts — BuildState type,
serializeBuild()
deserializeBuild()
getItemAssignments()
src/lib/buildUtils.ts — resolveAddItem()
getConsumedComponents()
getEffectiveAddCost()
src/lib/itemStore.ts — getItems() with cache,
deriveUpgradesInto()
src/lib/itemNormalizer.ts — normalizeItem()
src/lib/api/deadlockApi.ts — fetchAllItems()
fetchHeroStats()
fetchHeroAbilityItems()
src/lib/boonSystem.ts — BOON_THRESHOLDS const
getBoonThreshold()
getAbilityPointsAtSouls()
src/lib/heroStats.ts — HeroBaseStats type
calculateStatsAtBoon()
src/lib/heroStore.ts — getHeroStats() with cache
src/lib/abilityCoefficients.ts — HeroAbility type
calculateAbilityDamage()
PROPERTY_LABELS map
src/lib/scoring/scoreItems.ts — scoreItems() pure function
src/lib/scoring/goalWeights.ts — GOAL_WEIGHTS_MAP const
src/lib/scoring/antiSynergy.ts — detectAntiSynergies()
src/lib/categoryBonuses.ts — CATEGORY_BONUS_TIERS const
src/lib/boonSystem.ts — BOON_THRESHOLDS const
src/app/build/[herold]/page.tsx — server component,
fetches items + hero data
src/app/build/BuildClient.tsx — single state source of truth,
all route state lives here
src/app/build/components/
ItemBrowser.tsx — item shop grid
CategoryManager.tsx — drag-and-drop categories
ActiveItemsGrid.tsx — 12-slot active build
BuildSummaryPanel.tsx — right panel stats
AbilityLevelingPanel.tsx — ability cards + upgrades
SoulTimeline.tsx — soul economy timeline
SuggestedItemsPanel.tsx — AI-adjacent suggestions

---

## State Architecture

```typescript
// BuildClient owns all route state:
buildItems: Item[]                    // all items in game plan
assignmentMap: Map<string, {          // per-item flags
  phase: 'early'|'mid'|'late'|null
  active: boolean
  sellPriority: boolean
  optional: boolean
}>
categories: BuildCategory[]           // user-created categories
abilityLevels: AbilityLevels          // ability upgrade levels
manualBoonLevel: number               // 0-35
selectedGoal: BuildGoal               // scoring goal

// Derived (useMemo — never useState):
activeCount         // active items count (cap at 12)
itemStatTotals      // from calculateStatTotals()
totalSpiritPower    // base + flat + percent
consumedComponents  // from getConsumedComponents()
```

---

## Milestone History

| Milestone | Status    | What it built                            |
| --------- | --------- | ---------------------------------------- |
| M1        | ✅ Closed | Hero Explorer MVP                        |
| M2        | ✅ Closed | Build Planner UI                         |
| M3        | ✅ Closed | URL persistence + share links            |
| M4        | ✅ Closed | Real item data + scoring engine          |
| M5a       | ✅ Closed | Game plan structure, phases, active grid |
| M5b       | ✅ Closed | Hero stats, boon system, ability panel   |
| M6        | 🔜 Next   | AI coach layer + skill path planner      |

---

## Common Bugs to Check

1. **Image field**: always `shop_image_webp` not `image_webp`
2. **Item identifier**: `item.id` not `item.classname`
3. **Category value**: `"gun"` not `"weapon"`
4. **Spirit scaling**: check BOTH `class_name` and `scaleType`
5. **Prettier**: run on ALL files before committing or CI fails
6. **Dev server lock**: `rm -rf .next` to clear Turbopack lock
7. **gh CLI labels**: `--field "labels[]=value"` syntax
8. **Hydration**: never read localStorage during SSR
9. **Slot cap**: 12 applies to ACTIVE items, not game plan
10. **Sell refund**: 50% not 80%
11. **Ability costs**: 1/2/5 points not 1/3/5
12. **Tier 5 items**: exclude from standard build planner

---

## CI Pipeline

GitHub Actions runs on every push:

1. Format (Prettier) — fails if any file not formatted
2. Typecheck (tsc --noEmit)
3. Lint (ESLint)
4. Build (next build)

All four must pass. Run locally before pushing.

---

## M6 Preview (next milestone)

- AI coach narrative layer (separate from scoring)
- Tracklock-style skill path planner grid
- Per-ability DPS impact when items added
- Plan-08 ability unlock timeline interactivity
