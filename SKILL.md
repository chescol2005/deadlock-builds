# Deadlock Foundry Skill

## When to use this skill

Use whenever working on the deadlock-builds project.

## Critical game mechanic constants

- Ability upgrade costs: 1, 2, 5 ability points
- Ability max level: 3
- Item tier max (standard): 4
- Sell refund rate: 50% (SELL_REFUND_RATE = 0.5)
- Active build max: 12 items
- Investment bonus threshold: 4,800 souls
- Ultimate unlock: boon level 7 (3,600 souls)

## API field names (commonly confused)

- Item shop icon: shop_image_webp (NOT image_webp)
- Item category: item_slot_type ('weapon'|'spirit'|'vitality')
- Upgrade chain: component_items (string[] of classnames)
- Spirit scaling: scale_function.class_name ===
  'scale_function_tech_damage'

## Stat key mappings

Spirit Power = TechPower (flat) + TechPowerPercent (%)
Bonus Health = BonusHealth
Weapon Damage = WeaponPower + BulletDamage
Health Regen = BonusHealthRegen + OutOfCombatHealthRegen

## Before every commit (mandatory)

npx prettier --write .
npx tsc --noEmit  
npx next build
npm run mini (fixture validation)

## Common bugs to check

1. component_items classnames must match item.classname exactly
2. spirit scaling: check class_name OR specific_stat_scale_type
3. Never use image_webp — use shop_image_webp
4. Labels in --field for gh api: use --field "labels[]=value"
5. Turbopack lock: rm -rf .next to clear
