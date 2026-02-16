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
