// Hero + hero-ability fetching against the Deadlock assets API.
//
// Split out of lib/deadlock.ts, which CLAUDE.md scopes to "re-exports,
// AbilityLevel type" — the hero/ability pipeline had grown there as scope
// creep. lib/deadlock.ts still re-exports the public names from here so that
// existing `@/lib/deadlock` import paths keep working.

// Type-only import — erased at compile time, so this does not create a runtime
// import cycle with lib/deadlock.ts (which re-exports this module).
import type { SignatureSlot } from "./deadlock";
import { getHeroStats } from "./heroStore";
import type { HeroBaseStats } from "./heroStats";
import { getHeroAnalytics } from "./analyticsStore";
import type { HeroAnalytics } from "./analyticsStore";

const ASSETS_BASE = "https://api.deadlock-api.com/v1/assets";

// ─── Hero list / detail ───────────────────────────────────────────────────────

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
  // Difficulty (1-3, low-high) and archetype flavor tags — sourced from the
  // hero detail endpoint, which already returns them (see DeadlockHeroDetail).
  complexity?: number;
  tags?: string[];
  hero_type?: string;
} & DeadlockHeroFlags;

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

export async function fetchHeroes(): Promise<DeadlockHeroListItem[]> {
  const res = await fetch(`${ASSETS_BASE}/heroes`, {
    // Cache for 1 hour on Vercel
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch heroes: ${res.status}`);
  }

  return res.json();
}

export function slugifyHeroName(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export async function fetchHeroByName(name: string): Promise<DeadlockHeroDetail> {
  const res = await fetch(`${ASSETS_BASE}/heroes/by-name/${encodeURIComponent(name)}`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch hero ${name}: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function fetchHeroById(id: number | string): Promise<DeadlockHeroDetail> {
  const res = await fetch(`${ASSETS_BASE}/heroes/${encodeURIComponent(String(id))}`, {
    next: { revalidate: 3600 },
  });

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
          complexity: detail.complexity,
          tags: detail.tags,
          hero_type: detail.hero_type,
        };

        return merged;
      } catch {
        // Fail open on transient detail errors.
        return h;
      }
    }),
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

export type DeadlockHeroListItemEnriched = DeadlockHeroListItem & {
  baseStats?: HeroBaseStats;
  analytics?: HeroAnalytics;
};

/**
 * `fetchVisibleHeroes()` plus per-hero base stats and match analytics, for
 * pages that want a richer hero card (e.g. /heroes). Kept as a separate
 * export rather than folded into `fetchVisibleHeroes()` so existing callers
 * that only need the lighter shape aren't forced through the extra fetches.
 */
export async function fetchVisibleHeroesEnriched(): Promise<DeadlockHeroListItemEnriched[]> {
  const [heroes, heroAnalytics] = await Promise.all([fetchVisibleHeroes(), getHeroAnalytics()]);

  return Promise.all(
    heroes.map(async (h) => ({
      ...h,
      baseStats: (await getHeroStats(h.id)) ?? undefined,
      analytics: heroAnalytics.get(h.id),
    })),
  );
}

// ─── Hero abilities ───────────────────────────────────────────────────────────

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

export type HeroAbilitySlot = SignatureAbility & {
  slot: SignatureSlot;
  abilityType?: string; // "signature" | "ultimate" | "innate" | ...
};

export function getHeroSignatureSlotsFromHeroItems(
  heroItems: Record<string, string> | undefined,
  allAbilities: DeadlockAbilityItem[],
  heroId: number | string,
): HeroAbilitySlot[] {
  const hid = Number(heroId);

  // index this hero's abilities by class_name
  const byClass: Record<string, DeadlockAbilityItem> = {};
  for (const a of allAbilities) {
    if (!a?.class_name) continue;

    const belongs = Number(a.hero) === hid || (Array.isArray(a.heroes) && a.heroes.includes(hid));
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
