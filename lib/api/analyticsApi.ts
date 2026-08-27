// Match-analytics fetching against the Deadlock analytics API.
//
// Sibling to lib/api/deadlockApi.ts and lib/heroApi.ts: same host, different
// path prefix (`/v1/analytics` vs `/v1/assets`). These endpoints return
// aggregate win/pick data derived from real matches — enrichment, not core
// functionality — so every fetcher here FAILS OPEN (logs and returns []).
// A dead analytics endpoint must never take down the build planner.

const ANALYTICS_BASE = "https://api.deadlock-api.com/v1/analytics";

// ─── Raw row shapes ───────────────────────────────────────────────────────────

/**
 * One row of `/v1/analytics/hero-stats`.
 *
 * With no query params (how this app calls it) the endpoint returns exactly one
 * row per hero, all with `bucket: 0`. The index signature covers the ~15 extra
 * aggregate combat totals (total_kills, total_player_damage, …) that the
 * endpoint also returns but that nothing in this app reads.
 */
export type HeroStatsRowRaw = {
  hero_id: number;
  bucket: number;
  wins: number;
  losses: number;
  matches: number;
  matches_per_bucket?: number;
  [k: string]: unknown; // many more aggregate combat totals exist; not load-bearing for this app
};

/**
 * One row of `/v1/analytics/item-stats`.
 *
 * With no query params the endpoint returns exactly one row per item
 * (~300 rows), all with `bucket: 0`. `item_id` is the raw numeric item id —
 * it joins to `Item.numericId`, NOT to `Item.id` (which is the class_name).
 */
export type ItemStatsRowRaw = {
  item_id: number;
  bucket: number;
  wins: number;
  losses: number;
  matches: number;
  players?: number;
  avg_buy_time_s?: number;
  avg_sell_time_s?: number;
  avg_buy_time_relative?: number;
  avg_sell_time_relative?: number;
};

// ─── Fetchers ─────────────────────────────────────────────────────────────────

// NOTE ON `bucket`: it is a *query parameter* this app never sets. Omitted (the
// default) it yields the one-row-per-id behaviour described above. The upstream
// OpenAPI schema allows values like `avg_badge` / `net_worth_by_5000`, which
// would partition each id across multiple rows. We never request that, but the
// normalization in lib/analyticsStore.ts groups-and-sums by id anyway so it
// stays correct if that ever changes.

export async function fetchHeroStatsRows(): Promise<HeroStatsRowRaw[]> {
  try {
    const res = await fetch(`${ANALYTICS_BASE}/hero-stats`, {
      // Cache for 1 hour on Vercel — same TTL convention as the asset fetchers.
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      console.error(`[analyticsApi] fetchHeroStatsRows failed: ${res.status} ${res.statusText}`);
      return [];
    }
    return (await res.json()) as HeroStatsRowRaw[];
  } catch (err) {
    console.error("[analyticsApi] fetchHeroStatsRows error:", err);
    return [];
  }
}

export async function fetchItemStatsRows(): Promise<ItemStatsRowRaw[]> {
  try {
    const res = await fetch(`${ANALYTICS_BASE}/item-stats`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      console.error(`[analyticsApi] fetchItemStatsRows failed: ${res.status} ${res.statusText}`);
      return [];
    }
    return (await res.json()) as ItemStatsRowRaw[];
  } catch (err) {
    console.error("[analyticsApi] fetchItemStatsRows error:", err);
    return [];
  }
}
