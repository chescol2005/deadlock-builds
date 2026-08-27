# Deadlock Foundry Skill

## When to use this skill

Use whenever working on any file in the deadlock-foundry repo.
Read this entire file before writing any code or making any plan.

---

## Product Context

Deadlock Foundry is a competitive companion for Valve's Deadlock.
Two audiences: **new players** (need guidance, plain language, reduced
complexity) and **veterans** (want full control and stat transparency).

The AI coach (M6) is a **proactive guide** — it warns as you build,
not only when asked. It lives in `src/lib/coach/` and never touches
scoring logic.

---

## Critical Game Mechanic Constants

```typescript
ABILITY_UPGRADE_COSTS = [1, 2, 5]; // NOT [1, 3, 5]
ABILITY_MAX_LEVEL = 3; // NOT 5
VALID_TIERS = [1, 2, 3, 4]; // tier 5 = Street Brawl only
SELL_REFUND_RATE = 0.5; // 50%, NOT 80%
MAX_ACTIVE_ITEMS = 12;
GAME_PLAN_CAP = null; // unlimited
SIGNIFICANT_THRESHOLD = 4800; // souls investment bonus
ULTIMATE_UNLOCK = 3600; // boon level 7
```

---

## API Field Names (commonly confused)

```typescript
// Images — shop fields ONLY:
item.shop_image_webp; // ✓ use this
item.shop_image; // ✓ fallback
item.image_webp; // ✗ never — generic mod art

// Identifiers:
item.id; // ✓ string identifier
item.classname; // ✗ do not use as identifier

// Category:
item.category; // "gun" | "spirit" | "vitality" (normalized)
item.item_slot_type; // "weapon" | "spirit" | "vitality" (raw API)

// Upgrade chain:
item.component_items; // string[] classnames this builds FROM
```

---

## Stat Key Mappings

```typescript
// Spirit Power
TechPower; // flat spirit power
TechPowerPercent; // % spirit power bonus

// Health
BonusHealth;
BonusHealthRegen;
OutOfCombatHealthRegen;

// Weapon
WeaponPower; // weapon damage %
BaseAttackDamagePercent; // weapon damage % (was BulletDamage — renamed upstream)

// Resist
BulletResist; // % bullet damage resistance
TechResist; // % spirit damage resistance
StatusResistancePercent;
DegenResistance;
MeleeResistPercent;
```

---

## Spirit Scaling — Check Both Patterns

```typescript
// Pattern 1:
scaleFn?.class_name === "scale_function_tech_damage";

// Pattern 2:
scaleType === "ETechPower";

// Always check both. Never assume one pattern covers all items.
```

---

## Component Scaffolding Rules

When creating any new component or panel:

1. **File location**: `src/app/build/components/PascalCase.tsx`
2. **Props**: explicit TypeScript interface above the component
3. **State**: `useMemo` for derived values — never `useState` for computed
4. **Styling**: Tailwind only — no inline styles, no CSS modules
5. **Icons**: `lucide-react` only
6. **Loading**: use skeleton pattern consistent with `ItemBrowser.tsx`
7. **Tooltips**: use shared `<Tooltip>` wrapper — never raw `title`
8. **New player support**: accept optional `simplified?: boolean` prop
   that hides advanced controls

### New Player UX — Verify Before Marking Complete

- [ ] Works with zero prior game knowledge?
- [ ] Plain-English label or tooltip explaining the concept?
- [ ] Complexity hidden behind toggle or progressive reveal?
- [ ] AI coach has a hook to surface guidance here?

---

## Scoring Architecture (deterministic — never change without separate PR)

```
baseCategoryStage.ts  →  intentWeightStage.ts  →  scoreItems()
```

- `survivability` is split into `tankiness` and `sustain`
- `SCORE_CATEGORIES` in `types.ts` and `INTENT_TO_CATEGORY` in
  `baseCategoryStage.ts` must stay in sync
- AI coach changes and scoring changes must be in **separate PRs**

---

## Before Every Commit (mandatory, in this order)

```bash
npx prettier --write .
npx tsc --noEmit
npx next build
npm run mini
```

- Kill dev server before finishing any session
- Never `git add .` — stage files explicitly
- Paste mini.ts output in PR body before merge

---

## Common Bugs — Check These Every Time

1. `shop_image_webp` not `image_webp`
2. `item.id` not `item.classname`
3. `"gun"` not `"weapon"` for category
4. Spirit scaling: check BOTH patterns (see above)
5. Run Prettier on ALL files — CI fails on formatting
6. Turbopack lock: `rm -rf .next`
7. gh CLI: `--field "labels[]=value"` syntax
8. Never read localStorage during SSR (hydration mismatch)
9. 12-slot cap = ACTIVE items only, game plan is unlimited
10. Boon level: `getBoonThreshold(0)` returns boonLevel 1
11. Ability costs: 1/2/5, ability max level 3
12. Tier 5 items: exclude from standard build planner

---

## M6 Coach Module Rules

- Coach lives in `src/lib/coach/` — zero imports from
  `src/lib/scoring/`
- Coach is proactive: warn on item add, not only on user prompt
- Prompt design is validated in Claude.ai Artifacts first,
  then implemented
- Coach responses are narrative strings — never modify BuildState
- New player mode gets simplified coach language automatically
