// Shared re-export surface + the ability-level type family.
//
// Per CLAUDE.md this module is meant to be "re-exports, AbilityLevel type".
// The hero/ability fetching pipeline that had accreted here now lives in
// lib/heroApi.ts and is re-exported below for backward compatibility of
// existing `@/lib/deadlock` import paths.

import type { ItemTier } from "./items";

export type { Item, ItemCategory, ItemTier, ItemTag, ItemStats } from "./items";

// ─── Ability levels ───────────────────────────────────────────────────────────

export type SignatureSlot = "signature1" | "signature2" | "signature3" | "signature4";

export type AbilityLevel = 0 | 1 | 2 | 3;
export type AbilityLevels = Partial<Record<SignatureSlot, AbilityLevel>>;

// ─── Item tier pricing ────────────────────────────────────────────────────────

/** Shop cost of a tier-N item, indexed by tier (1-4). */
export const TIER_COSTS: Readonly<Record<ItemTier, number>> = {
  1: 800,
  2: 1600,
  3: 3200,
  4: 6400,
};

/** Shop cost of a tier-N item. Shared by ItemBrowser and ShopGrid. */
export function tierCost(tier: ItemTier): number {
  return TIER_COSTS[tier];
}

// ─── Hero API re-exports (canonical home: lib/heroApi.ts) ─────────────────────

export type {
  DeadlockHeroFlags,
  DeadlockHeroListItem,
  DeadlockHeroDetail,
  DeadlockAbilityItem,
  SignatureAbility,
  HeroAbilitySlot,
} from "./heroApi";

export {
  fetchHeroes,
  fetchHeroById,
  fetchHeroByName,
  fetchVisibleHeroes,
  slugifyHeroName,
  fetchAbilityItems,
  getHeroSignatureSlotsFromHeroItems,
} from "./heroApi";

// ─── Shop upgrade pipeline (legacy) ───────────────────────────────────────────
//
// NOTE: this duplicates lib/api/deadlockApi.ts `fetchAllItems()` +
// lib/itemNormalizer.ts `normalizeItem()`, and its `category` is the RAW API
// value ("weapon") rather than the normalized one ("gun") that CLAUDE.md
// mandates. /heroes has been migrated off it onto the canonical pipeline; the
// remaining consumers are app/build/page.tsx, app/build/[heroId]/page.tsx and
// app/build/BuildClient.tsx (+ ItemBrowser via BuildClient's props). Delete
// this block once those are migrated too.

const ASSETS_BASE = "https://api.deadlock-api.com/v1/assets";

export type DeadlockUpgradeItem = {
  id: number;
  class_name: string;
  name: string;

  image?: string;
  image_webp?: string;
  shop_image?: string | null;
  shop_image_webp?: string | null;

  type: "upgrade";
  item_slot_type: "weapon" | "vitality" | "spirit";
  item_tier: 1 | 2 | 3 | 4;
  cost: number;

  activation?: string; // "passive" | "active" etc
  is_active_item?: boolean;
  shopable?: boolean;

  properties?: Record<string, unknown>;
  [k: string]: unknown;
};

export async function fetchUpgradeItems(): Promise<DeadlockUpgradeItem[]> {
  const res = await fetch(`${ASSETS_BASE}/items/by-type/upgrade`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch upgrade items: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as DeadlockUpgradeItem[];
}

export type ShopCategory = "weapon" | "vitality" | "spirit";
export type ShopTier = 1 | 2 | 3 | 4;

export type ShopItem = {
  id: string;
  name: string;
  icon?: string;

  category: ShopCategory;
  tier: ShopTier;
  cost: number;

  isActive: boolean;
  shopable: boolean;

  properties?: Record<string, unknown>;
};

export function normalizeUpgradeItems(items: DeadlockUpgradeItem[]): ShopItem[] {
  const out = items
    .map((it): ShopItem | null => {
      const category = it.item_slot_type;
      if (category !== "weapon" && category !== "vitality" && category !== "spirit") return null;

      const tier = it.item_tier;
      if (tier !== 1 && tier !== 2 && tier !== 3 && tier !== 4) return null;

      const cost = Number(it.cost);
      if (!Number.isFinite(cost) || cost <= 0) return null;

      return {
        id: it.class_name,
        name: String(it.name ?? it.class_name ?? it.id),
        icon: it.shop_image_webp ?? it.shop_image ?? undefined,
        category,
        tier,
        cost,
        isActive: Boolean(it.is_active_item) || String(it.activation).toLowerCase() === "active",
        shopable: Boolean(it.shopable),
        properties: it.properties,
      };
    })
    .filter((x): x is ShopItem => x !== null);

  return out;
}
