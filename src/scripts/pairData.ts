// src/scripts/pairData.ts — live data loader for the pair-lift scripts
//
// Shared by pairProbe.ts and fitPairTable.ts. Fetches the three analytics
// endpoints behind lib/engine/pairLift.ts under IDENTICAL filters. Scripts
// only: unlike lib/api/analyticsApi.ts this FAILS LOUDLY, since a silent empty
// stratum would bias a fit instead of degrading a page.
//
// Verified data semantics (engine-design-notes.md, "Milestone F spike"):
// pairs are ORDERED by purchase, so both orders are summed; fetch them with
// min_matches=1, because the server's default floor of 20 applies per ORDERED row.

import type { PairStratum, WinCell } from "@/lib/engine/pairLift";
import { pairStatKey } from "@/lib/engine/pairLift";

const ANALYTICS_BASE = "https://api.deadlock-api.com/v1/analytics";
const DAY_S = 86_400;

/** Default final-net-worth band edges in souls; the last band is open-ended. */
export const DEFAULT_NET_WORTH_BANDS: ReadonlyArray<number> = [
  0, 15000, 25000, 35000, 45000, 60000,
];

export type Params = Record<string, string | number>;

interface WinRow {
  wins: number;
  matches: number;
}
interface ItemRow extends WinRow {
  item_id: number;
}
interface PairRow extends WinRow {
  item_ids: number[];
}
interface HeroRow extends WinRow {
  hero_id: number;
}

// The analytics rate limit is 200 req/min per IP, shared across endpoints.
// Spacing request STARTS by 400ms caps us at 150/min with headroom.
const MIN_REQUEST_GAP_MS = 400;
let nextSlot = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_REQUEST_GAP_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function getJson<T>(path: string, params: Params): Promise<T> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${ANALYTICS_BASE}/${path}?${qs}`;
  for (let attempt = 1; ; attempt += 1) {
    await throttle();
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as T;
    // 429 / 5xx: back off and retry a few times; anything else is a real error.
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
}

export interface StratumFilter {
  label: string;
  params: Params;
}

/**
 * The unfiltered stratum plus one per net-worth band, all over a PINNED window
 * ending at today 00:00 UTC (the API's default "30 days ago" moves between calls).
 */
export function buildStrata(opts: {
  days: number;
  /** One rank tier only (badge T0-T9). */
  rank: number | null;
  /** This rank tier and above (badge >= T0). Ignored if `rank` is set. */
  minRank?: number | null;
  bands: ReadonlyArray<number>;
}): {
  from: string;
  to: string;
  all: StratumFilter;
  bands: StratumFilter[];
} {
  const maxTs = Math.floor(Date.now() / 1000 / DAY_S) * DAY_S;
  const minTs = maxTs - opts.days * DAY_S;
  const base: Params = {
    game_mode: "normal",
    min_unix_timestamp: minTs,
    max_unix_timestamp: maxTs,
  };
  if (opts.rank !== null) {
    base.min_average_badge = opts.rank * 10;
    base.max_average_badge = opts.rank * 10 + 9;
  } else if (opts.minRank !== undefined && opts.minRank !== null) {
    // Badge is the MATCH average of both teams (tier * 10 + subtier), not the
    // individual player's rank.
    base.min_average_badge = opts.minRank * 10;
  }
  const bands = opts.bands.map((lo, k) => {
    const hi = opts.bands[k + 1];
    const params: Params = { ...base, min_networth: lo };
    if (hi !== undefined) params.max_networth = hi - 1;
    return { label: hi === undefined ? `${lo}+` : `${lo}-${hi - 1}`, params };
  });
  const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  return { from: iso(minTs), to: iso(maxTs), all: { label: "all", params: base }, bands };
}

/**
 * hero-stats takes no hero filter and returns every hero, so one call per
 * stratum serves all heroes: cache it by the stratum's params.
 */
const heroTotalsCache = new Map<string, Promise<Map<number, WinCell>>>();

function heroTotals(params: Params): Promise<Map<number, WinCell>> {
  const key = JSON.stringify(params);
  let hit = heroTotalsCache.get(key);
  if (!hit) {
    hit = getJson<HeroRow[]>("hero-stats", params).then((rows) => {
      const out = new Map<number, WinCell>();
      for (const r of rows) {
        const id = Number(r.hero_id);
        const c = out.get(id) ?? { wins: 0, matches: 0 };
        c.wins += r.wins;
        c.matches += r.matches;
        out.set(id, c);
      }
      return out;
    });
    heroTotalsCache.set(key, hit);
  }
  return hit;
}

export interface LoadedStratum extends PairStratum {
  label: string;
}

export async function loadStratum(heroId: number, filter: StratumFilter): Promise<LoadedStratum> {
  const [totals, itemRows, pairRows] = await Promise.all([
    heroTotals(filter.params),
    getJson<ItemRow[]>("item-stats", { ...filter.params, hero_id: heroId, min_matches: 1 }),
    getJson<PairRow[]>("item-permutation-stats", {
      ...filter.params,
      hero_id: heroId,
      comb_size: 2,
      min_matches: 1,
    }),
  ]);

  const singles = new Map<number, WinCell>();
  for (const r of itemRows) {
    const c = singles.get(r.item_id) ?? { wins: 0, matches: 0 };
    c.wins += r.wins;
    c.matches += r.matches;
    singles.set(r.item_id, c);
  }

  const pairs = new Map<string, WinCell>();
  for (const r of pairRows) {
    if (r.item_ids.length !== 2 || r.item_ids[0] === r.item_ids[1]) continue;
    const key = pairStatKey(r.item_ids[0], r.item_ids[1]);
    const c = pairs.get(key) ?? { wins: 0, matches: 0 };
    c.wins += r.wins;
    c.matches += r.matches;
    pairs.set(key, c);
  }

  const hero = totals.get(heroId);
  // Fail loudly: a missing hero total would null every 2x2 and silently keep 0 pairs.
  if (!hero || hero.matches <= 0) {
    throw new Error(`hero-stats has no matches for hero ${heroId} in stratum ${filter.label}`);
  }

  return {
    label: filter.label,
    hero,
    singles,
    pairs,
  };
}
