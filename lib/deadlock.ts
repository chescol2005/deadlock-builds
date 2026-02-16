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
};

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
};

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
