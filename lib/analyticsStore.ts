// Normalized + cached match-analytics lookups.
//
// Same caching convention as lib/itemStore.ts / lib/heroStore.ts: a
// module-level cache with no TTL (HTTP-level revalidation is handled by the
// `next: { revalidate: 3600 }` on the fetchers). Both datasets are tiny —
// ~40 heroes, ~300 items — so we cache the whole dataset in one shot rather
// than per-id.
//
// Consumers (item table row, item detail page, hero card, hero detail page)
// all look up ONE id at a time, so these return `Map`s for O(1) lookup rather
// than arrays that every call site would have to scan.

import { fetchHeroStatsRows, fetchItemStatsRows } from "./api/analyticsApi";
import type { HeroStatsRowRaw, ItemStatsRowRaw } from "./api/analyticsApi";

export type HeroAnalytics = {
  heroId: number;
  matches: number;
  wins: number;
  losses: number;
  winRate: number; // wins / matches, 0 if matches === 0
};

export type ItemAnalytics = {
  itemId: number; // joins to Item.numericId
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  players?: number;
  avgBuyTimeS?: number;
};

let heroAnalyticsCache: Map<number, HeroAnalytics> | null = null;
let itemAnalyticsCache: Map<number, ItemAnalytics> | null = null;

function safeWinRate(wins: number, matches: number): number {
  return matches > 0 ? wins / matches : 0;
}

/**
 * Groups raw hero rows by `hero_id`, summing wins/losses/matches.
 *
 * The no-bucket default response has exactly one row per hero, so the sum is a
 * no-op there — but summing keeps this correct if a bucketed response (one row
 * per hero *per* bucket partition) is ever fetched.
 */
function aggregateByHeroId(rows: HeroStatsRowRaw[]): Map<number, HeroAnalytics> {
  const out = new Map<number, HeroAnalytics>();

  for (const row of rows) {
    const heroId = Number(row.hero_id);
    if (!Number.isFinite(heroId)) continue;

    const existing = out.get(heroId);
    if (existing) {
      existing.wins += row.wins ?? 0;
      existing.losses += row.losses ?? 0;
      existing.matches += row.matches ?? 0;
    } else {
      out.set(heroId, {
        heroId,
        wins: row.wins ?? 0,
        losses: row.losses ?? 0,
        matches: row.matches ?? 0,
        winRate: 0, // derived after all rows are summed
      });
    }
  }

  for (const entry of out.values()) {
    entry.winRate = safeWinRate(entry.wins, entry.matches);
  }

  return out;
}

/**
 * Groups raw item rows by `item_id`, summing wins/losses/matches.
 *
 * `players` and `avgBuyTimeS` are carried through from the FIRST row seen for
 * an id: they are not meaningfully summable (a player count would double-count
 * across partitions, and an average of averages is wrong), and the no-bucket
 * default case only ever has one row per id anyway.
 */
function aggregateByItemId(rows: ItemStatsRowRaw[]): Map<number, ItemAnalytics> {
  const out = new Map<number, ItemAnalytics>();

  for (const row of rows) {
    const itemId = Number(row.item_id);
    if (!Number.isFinite(itemId)) continue;

    const existing = out.get(itemId);
    if (existing) {
      existing.wins += row.wins ?? 0;
      existing.losses += row.losses ?? 0;
      existing.matches += row.matches ?? 0;
    } else {
      out.set(itemId, {
        itemId,
        wins: row.wins ?? 0,
        losses: row.losses ?? 0,
        matches: row.matches ?? 0,
        winRate: 0, // derived after all rows are summed
        players: row.players,
        avgBuyTimeS: row.avg_buy_time_s,
      });
    }
  }

  for (const entry of out.values()) {
    entry.winRate = safeWinRate(entry.wins, entry.matches);
  }

  return out;
}

export async function getHeroAnalytics(): Promise<Map<number, HeroAnalytics>> {
  if (heroAnalyticsCache) return heroAnalyticsCache;

  const rows = await fetchHeroStatsRows();
  const aggregated = aggregateByHeroId(rows);

  // The fetcher fails open with [], so an empty result means "request failed",
  // not "no heroes". Don't poison a no-TTL cache with it — leave the cache null
  // so the next caller retries.
  if (aggregated.size === 0) return aggregated;

  console.log(`[analyticsStore] loaded analytics for ${aggregated.size} heroes`);
  heroAnalyticsCache = aggregated;
  return heroAnalyticsCache;
}

export async function getItemAnalytics(): Promise<Map<number, ItemAnalytics>> {
  if (itemAnalyticsCache) return itemAnalyticsCache;

  const rows = await fetchItemStatsRows();
  const aggregated = aggregateByItemId(rows);

  // See getHeroAnalytics: [] means the request failed, so don't cache it.
  if (aggregated.size === 0) return aggregated;

  console.log(`[analyticsStore] loaded analytics for ${aggregated.size} items`);
  itemAnalyticsCache = aggregated;
  return itemAnalyticsCache;
}
