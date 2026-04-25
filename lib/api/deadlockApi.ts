import type { HeroBaseStats } from "@/lib/heroStats";

const BASE_URL = "https://assets.deadlock-api.com";

// ─── Hero stats ──────────────────────────────────────────────────────────────

type HeroStartingStats = Record<string, { value: number } | undefined>;

type HeroLevelUpgrades = {
  MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL?: number;
  MODIFIER_VALUE_BASE_HEALTH_FROM_LEVEL?: number;
  MODIFIER_VALUE_BASE_MELEE_DAMAGE_FROM_LEVEL?: number;
  MODIFIER_VALUE_TECH_POWER?: number;
};

type HeroV2Raw = {
  id: number;
  starting_stats?: HeroStartingStats;
  standard_level_up_upgrades?: HeroLevelUpgrades;
};

function statVal(stats: HeroStartingStats | undefined, key: string): number {
  return stats?.[key]?.value ?? 0;
}

export async function fetchHeroStats(heroId: number): Promise<HeroBaseStats> {
  const res = await fetch(`${BASE_URL}/v2/heroes/${heroId}`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`[deadlockApi] fetchHeroStats ${heroId} failed: ${res.status}`);
  }

  const d = (await res.json()) as HeroV2Raw;
  const ss = d.starting_stats;
  const lu = d.standard_level_up_upgrades ?? {};

  const meleePBoon = lu.MODIFIER_VALUE_BASE_MELEE_DAMAGE_FROM_LEVEL ?? 0;

  return {
    heroId: d.id,
    bulletDamage: 0,
    bulletDamagePerBoon: lu.MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL ?? 0,
    bulletsPerSecond: 0,
    reloadTime: 0,
    ammo: 0,
    lightMeleeDamage: statVal(ss, "light_melee_damage"),
    lightMeleePerBoon: meleePBoon,
    heavyMeleeDamage: statVal(ss, "heavy_melee_damage"),
    heavyMeleePerBoon: meleePBoon,
    maxHealth: statVal(ss, "max_health"),
    maxHealthPerBoon: lu.MODIFIER_VALUE_BASE_HEALTH_FROM_LEVEL ?? 0,
    healthRegen: statVal(ss, "base_health_regen"),
    moveSpeed: statVal(ss, "max_move_speed"),
    spiritPower: statVal(ss, "weapon_power"),
    spiritPowerPerBoon: lu.MODIFIER_VALUE_TECH_POWER ?? 0,
  };
}

// ─── Hero ability items ───────────────────────────────────────────────────────

export type AbilityPropertyScaleFunction = {
  specific_stat_scale_type?: string;
  stat_scale?: number;
};

export type AbilityProperty = {
  value: number | string;
  css_class?: string;
  scale_function?: AbilityPropertyScaleFunction;
  label?: string;
  postfix?: string;
  disable_value?: string;
};

export type AbilityUpgradeEntry = {
  property_upgrades?: Array<{
    name: string;
    bonus: string | number;
  }>;
};

export type HeroAbilityRaw = {
  id: number;
  class_name: string;
  name: string;
  ability_type?: string;
  image?: string;
  image_webp?: string;
  properties?: Record<string, AbilityProperty>;
  upgrades?: AbilityUpgradeEntry[];
  description?: Record<string, string>;
  behaviours?: string[];
};

export async function fetchHeroAbilityItems(heroId: number): Promise<HeroAbilityRaw[]> {
  try {
    const res = await fetch(`${BASE_URL}/v2/items/by-hero-id/${heroId}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      console.error(`[deadlockApi] fetchHeroAbilityItems ${heroId}: ${res.status}`);
      return [];
    }
    const all = (await res.json()) as HeroAbilityRaw[];
    return all.filter((it) => it.ability_type === "signature" || it.ability_type === "ultimate");
  } catch (err) {
    console.error("[deadlockApi] fetchHeroAbilityItems error:", err);
    return [];
  }
}

export type UpgradeV2Raw = {
  id: number;
  class_name: string;
  name: string;
  type: string;
  item_slot_type: "weapon" | "vitality" | "spirit";
  item_tier: 1 | 2 | 3 | 4;
  cost: number;
  shopable?: boolean;
  disabled?: boolean;
  is_active_item?: boolean;
  activation?: string;
  component_items?: string[];
  image?: string;
  image_webp?: string;
  shop_image?: string | null;
  shop_image_webp?: string | null;
  shop_image_small?: string | null;
  shop_image_small_webp?: string | null;
  properties?: Record<
    string,
    {
      value: string | number | null;
      label?: string;
      postfix?: string;
      css_class?: string;
      disable_value?: string;
    }
  >;
  [k: string]: unknown;
};

export async function fetchAllItems(): Promise<UpgradeV2Raw[]> {
  try {
    const res = await fetch(`${BASE_URL}/v2/items`, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[deadlockApi] fetchAllItems failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const all = (await res.json()) as UpgradeV2Raw[];
    return all.filter(
      (it) =>
        it.type === "upgrade" && it.shopable === true && it.disabled !== true && it.item_tier <= 4,
    );
  } catch (err) {
    console.error("[deadlockApi] fetchAllItems error:", err);
    return [];
  }
}
