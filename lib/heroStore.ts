import { fetchHeroStats } from "@/lib/api/deadlockApi";
import type { HeroBaseStats } from "@/lib/heroStats";

const heroStatsCache = new Map<number, HeroBaseStats>();

export async function getHeroStats(heroId: number): Promise<HeroBaseStats | null> {
  const cached = heroStatsCache.get(heroId);
  if (cached) return cached;

  try {
    const stats = await fetchHeroStats(heroId);
    heroStatsCache.set(heroId, stats);
    return stats;
  } catch (err) {
    console.error(`[heroStore] getHeroStats ${heroId} failed:`, err);
    return null;
  }
}
