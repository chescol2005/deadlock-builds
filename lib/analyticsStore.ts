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

import {
  fetchHeroStatsByBadgeRows,
  fetchHeroStatsRows,
  fetchItemStatsRows,
  fetchRankTiers,
} from "./api/analyticsApi";
import type { HeroStatsRowRaw, ItemStatsRowRaw, RankTierRaw } from "./api/analyticsApi";

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

/**
 * Observed shot accuracy for one hero: landed shots / shots fired.
 *
 * INTERPRETATION — this is a blunt observational ratio, not a skill measure:
 * - It is confounded with weapon type. Spread/shotgun weapons count each pellet,
 *   so heroes like Calico (43.5% over 4.3B shots) read low BECAUSE their nominal
 *   fire rate assumes every pellet lands. That confound is exactly what makes
 *   this useful for discounting nominal gun DPS — but it means a low number does
 *   NOT mean "players are bad on this hero".
 * - It is confounded with who plays the hero and how, not only with aim.
 * Verified live: spans 38.7% (Vyper) to 62.4% (Silver) across the roster.
 */
export type HeroAccuracy = {
  heroId: number;
  /** Pooled across every rank — the fallback when the player states no rank. */
  pooled: number;
  /** Accuracy per rank TIER (1-11). Sparse: a tier with no data is absent. */
  byRankTier: ReadonlyMap<number, number>;
  /** Total shots observed. Gate on this — some heroes have none (verified: Graves). */
  shots: number;
};

/**
 * Minimum shots fired before a hero's accuracy is treated as usable signal.
 *
 * Set well below the typical per-hero volume (hundreds of millions) but above
 * zero, so the real case this excludes is a hero with no shot data at all
 * rather than a hero with a merely thin sample.
 */
const MIN_SHOTS_FOR_ACCURACY = 100_000;

let heroAnalyticsCache: Map<number, HeroAnalytics> | null = null;
let itemAnalyticsCache: Map<number, ItemAnalytics> | null = null;
let heroAccuracyCache: Map<number, HeroAccuracy> | null = null;
let rankTiersCache: RankTierRaw[] | null = null;

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

/**
 * Per-hero shot accuracy, overall and broken down by rank tier.
 *
 * Aggregates the badge-bucketed hero-stats rows: bucket is `tier * 10 + subrank`
 * (bucket 0 = unranked), so subranks are summed into their tier. Heroes below
 * MIN_SHOTS_FOR_ACCURACY are omitted entirely rather than reported as 0%
 * accuracy — a hero with no shot data has UNKNOWN accuracy, and treating that
 * as zero would wrongly zero out their gun value downstream.
 */
export async function getHeroAccuracy(): Promise<Map<number, HeroAccuracy>> {
  if (heroAccuracyCache) return heroAccuracyCache;

  const rows = await fetchHeroStatsByBadgeRows();

  type Acc = { hit: number; missed: number; byTier: Map<number, { hit: number; missed: number }> };
  const raw = new Map<number, Acc>();

  for (const row of rows) {
    const heroId = Number(row.hero_id);
    if (!Number.isFinite(heroId)) continue;

    const hit = Number(row.total_shots_hit ?? 0);
    const missed = Number(row.total_shots_missed ?? 0);
    if (!Number.isFinite(hit) || !Number.isFinite(missed)) continue;

    const entry = raw.get(heroId) ?? { hit: 0, missed: 0, byTier: new Map() };
    entry.hit += hit;
    entry.missed += missed;

    // bucket 0 is unranked/unknown — it still counts toward the pooled total
    // but cannot be attributed to a tier.
    const bucket = Number(row.bucket);
    if (Number.isFinite(bucket) && bucket > 0) {
      const tier = Math.floor(bucket / 10);
      const t = entry.byTier.get(tier) ?? { hit: 0, missed: 0 };
      t.hit += hit;
      t.missed += missed;
      entry.byTier.set(tier, t);
    }

    raw.set(heroId, entry);
  }

  const out = new Map<number, HeroAccuracy>();
  for (const [heroId, entry] of raw) {
    const shots = entry.hit + entry.missed;
    if (shots < MIN_SHOTS_FOR_ACCURACY) continue;

    const byRankTier = new Map<number, number>();
    for (const [tier, t] of entry.byTier) {
      const tierShots = t.hit + t.missed;
      if (tierShots >= MIN_SHOTS_FOR_ACCURACY) byRankTier.set(tier, t.hit / tierShots);
    }

    out.set(heroId, { heroId, pooled: entry.hit / shots, byRankTier, shots });
  }

  // Same fail-open contract as the other getters: an empty result means the
  // request failed, so don't poison a no-TTL cache with it.
  if (out.size === 0) return out;

  console.log(`[analyticsStore] loaded shot accuracy for ${out.size} heroes`);
  heroAccuracyCache = out;
  return heroAccuracyCache;
}

/** Rank tiers (0 Obscurus … 11 Eternus), fetched not hardcoded. */
export async function getRankTiers(): Promise<RankTierRaw[]> {
  if (rankTiersCache) return rankTiersCache;

  const tiers = await fetchRankTiers();
  if (tiers.length === 0) return tiers;

  rankTiersCache = tiers;
  return rankTiersCache;
}

/**
 * Flattens per-hero accuracy to a plain `heroId -> accuracy` map at one rank.
 *
 * `rankTier` null (or a tier a hero has no data for) falls back to that hero's
 * pooled accuracy, so selecting a rank can only ever refine the estimate.
 */
export function resolveAccuracyAtRank(
  accuracy: ReadonlyMap<number, HeroAccuracy>,
  rankTier: number | null,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [heroId, entry] of accuracy) {
    const atRank = rankTier == null ? undefined : entry.byRankTier.get(rankTier);
    out.set(heroId, atRank ?? entry.pooled);
  }
  return out;
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
