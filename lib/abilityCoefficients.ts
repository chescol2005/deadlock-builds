import type { HeroAbilityRaw } from "@/lib/api/deadlockApi";
import type { SignatureSlot } from "@/lib/deadlock";
import type { AbilityLevel } from "@/lib/deadlock";

export type AbilityUpgradeTier = {
  pointCost: 1 | 2 | 5;
  description: string;
  statChanges: Array<{
    stat: string;
    delta: string;
  }>;
};

export type HeroAbility = {
  classname: string;
  name: string;
  slot: SignatureSlot;
  icon?: string;
  isUltimate: boolean;
  damageType: "spirit" | "weapon" | "mixed" | "none";
  baseDamage: number | null;
  spiritScaling: number | null;
  weaponScaling: number | null;
  cooldown: number | null;
  duration: number | null;
  castRange: number | null;
  passive: string | null;
  active: string | null;
  upgrades: [AbilityUpgradeTier, AbilityUpgradeTier, AbilityUpgradeTier];
};

const TIER_POINT_COSTS = [1, 2, 5] as const;

function safeNum(v: number | string | undefined | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function buildUpgradeTier(
  raw: HeroAbilityRaw["upgrades"],
  index: 0 | 1 | 2,
  descriptionMap: Record<string, string>,
): AbilityUpgradeTier {
  const pointCost = TIER_POINT_COSTS[index];
  const entry = raw?.[index];

  const descKey = `t${index + 1}_desc` as keyof typeof descriptionMap;
  const description = descriptionMap[descKey] ?? "";

  const statChanges: AbilityUpgradeTier["statChanges"] =
    entry?.property_upgrades?.map((pu) => ({
      stat: pu.name,
      delta: String(pu.bonus),
    })) ?? [];

  return { pointCost, description, statChanges };
}

export function mapApiAbilityToHeroAbility(raw: HeroAbilityRaw, slot: SignatureSlot): HeroAbility {
  const props = raw.properties ?? {};

  // Damage property — look for the first property with css_class containing "damage"
  const damageProp = Object.values(props).find(
    (p) =>
      typeof p.css_class === "string" &&
      (p.css_class.includes("tech_damage") || p.css_class.includes("bullet_damage")),
  );

  const baseDamage = damageProp ? safeNum(damageProp.value) : null;

  const scaleFn = damageProp?.scale_function;
  const scaleType = scaleFn?.specific_stat_scale_type;
  const scaleVal = scaleFn?.stat_scale ?? null;

  const isSpiritScale = scaleType === "ETechPower";
  const isWeaponScale = scaleType !== undefined && !isSpiritScale;

  const spiritScaling = isSpiritScale && scaleVal != null ? scaleVal : null;
  const weaponScaling = isWeaponScale && scaleVal != null ? scaleVal : null;

  let damageType: HeroAbility["damageType"] = "none";
  if (spiritScaling != null && weaponScaling != null) damageType = "mixed";
  else if (spiritScaling != null) damageType = "spirit";
  else if (weaponScaling != null) damageType = "weapon";
  else if (damageProp) damageType = "spirit"; // has damage but no identified scale

  const cdProp = props["AbilityCooldown"];
  const cooldown = cdProp ? safeNum(cdProp.value) : null;

  const durProp = props["AbilityDuration"];
  const duration = durProp ? safeNum(durProp.value) : null;

  const rangeProp = props["AbilityCastRange"];
  const castRange = rangeProp ? safeNum(rangeProp.value) : null;

  const desc = raw.description ?? {};
  const passive = desc["passive"] ?? null;
  const active = desc["active"] ?? null;

  const upgrades: [AbilityUpgradeTier, AbilityUpgradeTier, AbilityUpgradeTier] = [
    buildUpgradeTier(raw.upgrades, 0, desc),
    buildUpgradeTier(raw.upgrades, 1, desc),
    buildUpgradeTier(raw.upgrades, 2, desc),
  ];

  return {
    classname: raw.class_name,
    name: raw.name,
    slot,
    icon: raw.image_webp ?? raw.image,
    isUltimate: raw.ability_type === "ultimate",
    damageType,
    baseDamage,
    spiritScaling,
    weaponScaling,
    cooldown,
    duration,
    castRange,
    passive,
    active,
    upgrades,
  };
}

export function mapHeroAbilities(
  rawAbilities: HeroAbilityRaw[],
  heroItems: Record<string, string> | undefined,
): HeroAbility[] {
  if (!heroItems) return [];

  const slots: SignatureSlot[] = ["signature1", "signature2", "signature3", "signature4"];
  const byClass = new Map<string, HeroAbilityRaw>(rawAbilities.map((a) => [a.class_name, a]));

  return slots.flatMap((slot) => {
    const cls = heroItems[slot];
    if (!cls) return [];
    const raw = byClass.get(cls);
    if (!raw) return [];
    return [mapApiAbilityToHeroAbility(raw, slot)];
  });
}

// Cumulative point cost to reach each ability level
const LEVEL_POINT_COSTS: Record<AbilityLevel, number> = { 0: 0, 1: 1, 2: 3, 3: 8 };

export function totalPointsSpent(
  abilityLevels: Partial<Record<SignatureSlot, AbilityLevel>>,
): number {
  const slots: SignatureSlot[] = ["signature1", "signature2", "signature3", "signature4"];
  let total = 0;
  for (const slot of slots) {
    const level = abilityLevels[slot] ?? 0;
    total += LEVEL_POINT_COSTS[level];
  }
  return total;
}

export function pointCostForNextLevel(currentLevel: AbilityLevel): number {
  const next = (currentLevel + 1) as AbilityLevel;
  return LEVEL_POINT_COSTS[next] - LEVEL_POINT_COSTS[currentLevel];
}

export function calculateAbilityDamage(
  ability: HeroAbility,
  abilityLevel: AbilityLevel,
  spiritPower: number,
  weaponDamage: number,
): number | null {
  if (ability.baseDamage == null) return null;

  let damage = ability.baseDamage;

  if (ability.spiritScaling != null) {
    damage += spiritPower * ability.spiritScaling;
  }
  if (ability.weaponScaling != null) {
    damage += weaponDamage * ability.weaponScaling;
  }

  // Apply upgrade bonuses for purchased tiers (abilityLevel = number of tiers bought)
  for (let tier = 0; tier < abilityLevel; tier++) {
    const upgrade = ability.upgrades[tier as 0 | 1 | 2];
    for (const change of upgrade.statChanges) {
      // Only apply numeric damage bonuses keyed as "Damage"
      if (change.stat === "Damage") {
        const delta = parseFloat(change.delta);
        if (Number.isFinite(delta)) damage += delta;
      }
    }
  }

  return Math.round(damage * 10) / 10;
}
