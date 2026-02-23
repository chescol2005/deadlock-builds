export type DeadlockHeroFlags = {
  player_selectable?: boolean;
  disabled?: boolean;
  in_development?: boolean;
  needs_testing?: boolean;
  assigned_players_only?: boolean;
  prerelease_only?: boolean;
  limited_testing?: boolean;
};

export type DeadlockHeroListItem = {
  id: number;
  class_name: string;
  name: string;
  images?: {
    icon_image_small?: string;
    icon_image_small_webp?: string;
    icon_hero_card?: string;
    icon_hero_card_webp?: string;
  };
} & DeadlockHeroFlags;

export async function fetchHeroes(): Promise<DeadlockHeroListItem[]> {
  const res = await fetch("https://assets.deadlock-api.com/v2/heroes", {
    // Cache for 1 hour on Vercel
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch heroes: ${res.status}`);
  }

  return res.json();
}

export type DeadlockHeroDetail = {
  id: number;
  class_name: string;
  name: string;
  tags?: string[];
  hero_type?: string;
  gun_tag?: string;
  complexity?: number;
  images?: {
    icon_hero_card?: string;
    icon_hero_card_webp?: string;
    icon_image_small?: string;
    icon_image_small_webp?: string;
    background_image?: string;
    background_image_webp?: string;
  };
  starting_stats?: Record<string, { value: number; display_stat_name?: string }>;
  items?: Record<string, string>;
} & DeadlockHeroFlags;

export function slugifyHeroName(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export async function fetchHeroByName(name: string): Promise<DeadlockHeroDetail> {
  const res = await fetch(
    `https://assets.deadlock-api.com/v2/heroes/by-name/${encodeURIComponent(name)}`,
    { next: { revalidate: 3600 } }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch hero ${name}: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function fetchHeroById(id: number | string): Promise<DeadlockHeroDetail> {
  const res = await fetch(
    `https://assets.deadlock-api.com/v2/heroes/${encodeURIComponent(String(id))}`,
    { next: { revalidate: 3600 } }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch hero id=${id}: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Centralized "visible heroes" helper.
 * - Enriches list heroes with detail flags (and images fallback).
 * - Filters out heroes where player_selectable === false AND disabled === true.
 * - Sorts by name.
 * - Fails open for individual detail errors (keeps the hero).
 */
export async function fetchVisibleHeroes(): Promise<DeadlockHeroListItem[]> {
  const heroes = await fetchHeroes();

  const enriched = await Promise.all(
    heroes.map(async (h) => {
      try {
        const detail = await fetchHeroById(h.id);

        const merged: DeadlockHeroListItem = {
          id: h.id,
          name: h.name,
          class_name: h.class_name,
          images: h.images ?? detail.images,
          player_selectable: detail.player_selectable,
          disabled: detail.disabled,
          in_development: detail.in_development,
          needs_testing: detail.needs_testing,
          assigned_players_only: detail.assigned_players_only,
          prerelease_only: detail.prerelease_only,
          limited_testing: detail.limited_testing,
        };

        return merged;
      } catch {
        // Fail open on transient detail errors.
        return h;
      }
    })
  );

  const visible = enriched.filter((h) => {
    // Always exclude disabled heroes
    if (h.disabled === true) return false;

    // Exclude explicitly non-selectable heroes
    if (h.player_selectable === false) return false;

    // Optional: exclude special availability buckets
    if (h.assigned_players_only === true) return false;
    if (h.prerelease_only === true) return false;
    if (h.limited_testing === true) return false;

    // Optional: if you only want fully “released” heroes:
    // if (h.in_development === true) return false;

    return true;
  });

  visible.sort((a, b) => a.name.localeCompare(b.name));
  return visible;
}
// lib/deadlock.ts (add below your existing exports)

export type DeadlockItemApi = {
  id: number;
  class_name: string;
  name: string;
  start_trained?: boolean;
  image?: string;
  image_webp?: string;
  hero?: number | null;
  heroes?: number[];
  update_time?: number;

  type?: string; // e.g. "ability" etc per schema
  ability_type?: string; // e.g. "signature", "innate"
  behaviours?: string[];

  description?: {
    desc?: string;
    quip?: string;
    t1_desc?: string;
    t2_desc?: string;
    t3_desc?: string;
    active?: string;
    passive?: string;
  };

  properties?: Record<string, unknown>;
  tooltip_details?: unknown;
  upgrades?: unknown;
  weapon_info?: unknown;
  videos?: unknown;

  [k: string]: unknown;
};

export type ItemLite = {
  id: string; // normalized to string
  name: string;
  type?: string;
  className?: string;
  image?: string;
  imageWebp?: string;
  heroes: string[]; // hero IDs as strings
  updatedAt?: number;
};

const ASSETS_BASE = "https://assets.deadlock-api.com/v2";

export async function fetchItems(): Promise<DeadlockItemApi[]> {
  const res = await fetch(`${ASSETS_BASE}/items`, {
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch items: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as DeadlockItemApi[];
}

export function normalizeItems(items: DeadlockItemApi[]) {
  const itemsById: Record<string, ItemLite> = {};
  const itemsByHeroId: Record<string, string[]> = {};

  for (const it of items) {
    const id = String(it.id);

    const heroesRaw = Array.isArray(it.heroes) ? it.heroes : [];
    // Some responses include `hero` as a single value; merge it in if present.
    const mergedHeroes = new Set<number>();
    for (const h of heroesRaw) mergedHeroes.add(h);
    if (typeof it.hero === "number") mergedHeroes.add(it.hero);

    const heroes = Array.from(mergedHeroes).map(String);

    itemsById[id] = {
      id,
      name: it.name,
      type: typeof it.type === "string" ? it.type : undefined,
      className: typeof it.class_name === "string" ? it.class_name : undefined,
      image: typeof it.image === "string" ? it.image : undefined,
      imageWebp: typeof it.image_webp === "string" ? it.image_webp : undefined,
      heroes,
      updatedAt: typeof it.update_time === "number" ? it.update_time : undefined,
    };

    for (const heroId of heroes) {
      if (!itemsByHeroId[heroId]) itemsByHeroId[heroId] = [];
      itemsByHeroId[heroId].push(id);
    }
  }

  return { itemsById, itemsByHeroId };
}

// lib/deadlock.ts (add)

export type DeadlockUpgradeItem = {
  id: number;
  class_name: string;
  name: string;

  image?: string;
  image_webp?: string;

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

  // handy later for scoring
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
        id: String(it.id),
        name: String(it.name ?? it.class_name ?? it.id),
        icon: (it.image_webp as string | undefined) ?? (it.image as string | undefined),
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

export type DeadlockAbilityItem = {
  id: number;
  class_name: string;
  name: string;

  image?: string;
  image_webp?: string;

  type: "ability";
  ability_type?: string; // "signature" | "ultimate" | "innate" | etc

  hero?: number | null;
  heroes?: number[];

  start_trained?: boolean;
  update_time?: number;

  properties?: Record<string, unknown>;

  upgrades?: Array<{
    property_upgrades?: Array<{
      name: string;
      bonus: string | number;
      scale_stat_filter?: string;
      upgrade_type?: string;
    }>;
  }>;

  description?: Record<string, unknown>;
  tooltip_details?: unknown;
  videos?: { webm?: string; mp4?: string };

  [k: string]: unknown;
};

export async function fetchAbilityItems(): Promise<DeadlockAbilityItem[]> {
  const res = await fetch(`${ASSETS_BASE}/items/by-type/ability`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ability items: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as DeadlockAbilityItem[];
}

export type SignatureAbility = {
  id: string;
  className: string;
  name: string;
  icon?: string;

  properties?: Record<string, unknown>;
  upgrades?: DeadlockAbilityItem["upgrades"];
  description?: DeadlockAbilityItem["description"];
  videos?: DeadlockAbilityItem["videos"];
};

export type SignatureSlot = "signature1" | "signature2" | "signature3" | "signature4";

export type HeroAbilitySlot = SignatureAbility & {
  slot: SignatureSlot;
  abilityType?: string; // "signature" | "ultimate" | "innate" | ...
};

export function getHeroSignatureSlotsFromHeroItems(
  heroItems: Record<string, string> | undefined,
  allAbilities: DeadlockAbilityItem[],
  heroId: number | string
): HeroAbilitySlot[] {
  const hid = Number(heroId);

  // index this hero's abilities by class_name
  const byClass: Record<string, DeadlockAbilityItem> = {};
  for (const a of allAbilities) {
    if (!a?.class_name) continue;

    const belongs =
      Number(a.hero) === hid || (Array.isArray(a.heroes) && a.heroes.includes(hid));
    if (!belongs) continue;

    byClass[a.class_name] = a;
  }

  const slots: SignatureSlot[] = ["signature1", "signature2", "signature3", "signature4"];

  return slots
    .map((slot): HeroAbilitySlot | null => {
      const cls = heroItems?.[slot];
      if (!cls) return null;

      const a = byClass[cls];
      if (!a) return null;

      // IMPORTANT:
      // slot 4 is usually ability_type === "ultimate"
      // so we do NOT filter ability_type here; we carry it through.
      return {
        slot,
        id: String(a.id),
        className: a.class_name,
        name: a.name,
        icon: (a.image_webp as string | undefined) ?? (a.image as string | undefined),
        abilityType: typeof a.ability_type === "string" ? a.ability_type : undefined,
        properties: a.properties,
        upgrades: a.upgrades,
        description: a.description,
        videos: a.videos,
      };
    })
    .filter((x): x is HeroAbilitySlot => x !== null);
}
