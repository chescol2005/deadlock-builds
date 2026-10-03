import type { HeroBaseStats } from "@/lib/heroStats";

const BASE_URL = "https://api.deadlock-api.com/v1/assets";

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
  items?: { weapon_primary?: string };
};

// Minimal shape of the weapon *item* response — bullet/reload/ammo stats do
// NOT live on the hero's `starting_stats`, they live on the item referenced by
// `hero.items.weapon_primary`. Deliberately not `UpgradeV2Raw`: different shape.
type WeaponItemRaw = {
  weapon_info?: {
    bullet_damage?: number;
    bullets_per_second?: number;
    reload_duration?: number;
    clip_size?: number;
    // Valve's own sustained-DPS figure, reload downtime included. Verified
    // live against Graves (hero 76, `citadel_weapon_necro_set`): 35.29
    // nominal (bullet_damage x bullets_per_second) vs 20.20 here, a 43%
    // overstatement the naive product doesn't catch. Consumed by
    // fetchHeroStats -> HeroBaseStats.dpsWithReload -> heroNeed.ts.
    damage_per_second_with_reload?: number;
    // Pellets per shot (verified live: Calico = 9, Graves = 1). Already baked
    // into bullets_per_second (bullets_per_second = shots_per_second x
    // bullets, verified live), so NOT needed for DPS math — it is only an
    // explanatory signal for why a shotgun-style hero's accuracy reads low.
    // Not yet surfaced past this raw type; no consumer exists.
    bullets?: number;
    // Range falloff curve, in source units (divide by 39.37 for metres).
    // Damage holds at damage_falloff_start_scale out to start_range, then
    // scales to damage_falloff_end_scale -- the fraction RETAINED -- by
    // end_range. Verified live across all 44 live heroes: start_scale is 1 and
    // damage_falloff_bias is 0.5 for every single one, so the curve SHAPE
    // cannot reorder heroes and lib/engine/heroNeed.ts interpolates linearly.
    // If either ever varies per hero, that assumption needs revisiting.
    //
    // CAUTION: these fields do NOT mean the same thing on every weapon.
    // Graves' The Teacher (citadel_weapon_necro_set) reports 300->670 at
    // end_scale 0.5, but her weapon has NO damage falloff: it deals full
    // damage to a hard 17m (= end_range) cutoff and ZERO beyond it, and these
    // range fields instead drive her Build-Up per bullet (most notably Essence
    // Theft). Nothing in the payload distinguishes that case, so it is a
    // hand-authored exception -- see HARD_CUTOFF_WEAPON_CLASSES in
    // lib/engine/heroNeed.ts.
    damage_falloff_start_range?: number;
    damage_falloff_end_range?: number;
    damage_falloff_start_scale?: number;
    damage_falloff_end_scale?: number;
    // Hard travel cap: the weapon deals nothing past this. Varies far more
    // than the falloff curve does (verified live: Apollo 25m, Bebop 32m,
    // Rem 76m, all 41 others 178m).
    range?: number;
  };
};

// Source units per metre, for the weapon range fields above.
const SOURCE_UNITS_PER_METRE = 39.37;

/** Source units -> metres. Absent/non-finite reads as 0, i.e. "unknown". */
function metres(sourceUnits: number | undefined): number {
  return typeof sourceUnits === "number" && Number.isFinite(sourceUnits)
    ? sourceUnits / SOURCE_UNITS_PER_METRE
    : 0;
}

function statVal(stats: HeroStartingStats | undefined, key: string): number {
  return stats?.[key]?.value ?? 0;
}

/**
 * Fetches the hero's primary weapon item to read its `weapon_info` block.
 * Fails open (returns undefined) — this is enrichment data, so a missing
 * `weapon_primary`, a failed request, or an absent `weapon_info` must not
 * break the hero stats fetch.
 */
async function fetchWeaponInfo(
  className: string | undefined,
): Promise<WeaponItemRaw["weapon_info"] | undefined> {
  if (!className) return undefined;
  try {
    const res = await fetch(`${BASE_URL}/items/${className}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      console.error(`[deadlockApi] fetchWeaponInfo ${className}: ${res.status}`);
      return undefined;
    }
    const weapon = (await res.json()) as WeaponItemRaw;
    return weapon.weapon_info;
  } catch (err) {
    console.error("[deadlockApi] fetchWeaponInfo error:", err);
    return undefined;
  }
}

export async function fetchHeroStats(heroId: number): Promise<HeroBaseStats> {
  const res = await fetch(`${BASE_URL}/heroes/${heroId}`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`[deadlockApi] fetchHeroStats ${heroId} failed: ${res.status}`);
  }

  const d = (await res.json()) as HeroV2Raw;
  const ss = d.starting_stats;
  const lu = d.standard_level_up_upgrades ?? {};

  const meleePBoon = lu.MODIFIER_VALUE_BASE_MELEE_DAMAGE_FROM_LEVEL ?? 0;

  // Weapon stats live on a separate item object, not on starting_stats.
  const weaponInfo = await fetchWeaponInfo(d.items?.weapon_primary);

  return {
    heroId: d.id,
    bulletDamage: weaponInfo?.bullet_damage ?? 0,
    bulletDamagePerBoon: lu.MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL ?? 0,
    bulletsPerSecond: weaponInfo?.bullets_per_second ?? 0,
    reloadTime: weaponInfo?.reload_duration ?? 0,
    ammo: weaponInfo?.clip_size ?? 0,
    dpsWithReload: weaponInfo?.damage_per_second_with_reload ?? 0,
    weaponClass: d.items?.weapon_primary ?? "",
    // Converted to metres here so no downstream consumer has to remember the
    // source-unit divisor. start_scale defaults to 1 (full damage before
    // falloff begins) rather than 0, which would read as a weapon that deals
    // nothing at point blank.
    falloffStartRange: metres(weaponInfo?.damage_falloff_start_range),
    falloffEndRange: metres(weaponInfo?.damage_falloff_end_range),
    falloffStartScale: weaponInfo?.damage_falloff_start_scale ?? 1,
    falloffEndScale: weaponInfo?.damage_falloff_end_scale ?? 1,
    maxRange: metres(weaponInfo?.range),
    lightMeleeDamage: statVal(ss, "light_melee_damage"),
    lightMeleePerBoon: meleePBoon,
    heavyMeleeDamage: statVal(ss, "heavy_melee_damage"),
    heavyMeleePerBoon: meleePBoon,
    maxHealth: statVal(ss, "max_health"),
    maxHealthPerBoon: lu.MODIFIER_VALUE_BASE_HEALTH_FROM_LEVEL ?? 0,
    healthRegen: statVal(ss, "base_health_regen"),
    moveSpeed: statVal(ss, "max_move_speed"),
    // No raw base-spirit-power key exists in starting_stats: spirit power is
    // purely investment-driven via items/boons (see spiritPowerPerBoon below).
    // This previously read "weapon_power", whose display_stat_name is
    // "EWeaponPower" — a different, always-0 stat that was mislabeled here.
    spiritPower: 0,
    spiritPowerPerBoon: lu.MODIFIER_VALUE_TECH_POWER ?? 0,
  };
}

// ─── Hero ability items ───────────────────────────────────────────────────────

export type AbilityPropertyScaleFunction = {
  class_name?: string;
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
    const res = await fetch(`${BASE_URL}/items/by-hero-id/${heroId}`, {
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
    const res = await fetch(`${BASE_URL}/items`, { cache: "no-store" });
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
