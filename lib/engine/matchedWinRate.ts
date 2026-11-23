// lib/engine/matchedWinRate.ts
//
// Matched item win rate (2026-11-23). An item's raw win rate mostly measures
// who could afford it: a 6,400-soul item is bought by players who are already
// ahead, so its raw win rate sits ~5.6 points above the hero's (8 reference
// heroes, Oracle+, 2026-10-31..11-23). This module compares each purchase with
// the OTHER purchases this hero's players made in the same position: the same
// net worth at the time of purchase (5,000-soul bands) and the same game-time
// window. That is a benchmark-relative return, not a raw one: the 6,400-soul
// premium falls to ~1 point, and items that were only "bought when winning"
// drop out.
//
// Still observational: players who choose an item can differ in ways the bands
// can't see (skill within a rank bracket, game state beyond net worth). The
// fitter keeps an item only when its edge passes a Benjamini-Hochberg false
// discovery test, and shrinks every edge toward zero by its noise.
//
// Pure: no I/O. The fitter (src/scripts/fitMatchedWinRate.ts) writes the
// committed table; the server slices it per hero and rank bracket
// (heroMatchedWinRate), and the basket's analyticsTerm reads the slice.

import { fdrZCutoff } from "./pairLift";

/** One item's purchases in one stratum (net-worth band x buy-time window). */
export interface MatchedRow {
  /** Item.id (class_name). */
  itemId: string;
  wins: number;
  matches: number;
}

/** An item's matched edge before shrinkage, pooled over strata. */
export interface MatchedExcess {
  /** Purchase-weighted mean of (item win rate - peers' win rate), per stratum. */
  excess: number;
  se: number;
  n: number;
}

export interface MatchedWinRateEntry {
  /** Shrunk matched edge in win probability (0.03 = 3 points). */
  edge: number;
  /** Standard error of the UNSHRUNK edge. */
  se: number;
  /** Unshrunk edge / se: what the FDR test selects on. */
  z: number;
  /** Purchases pooled over all strata. */
  n: number;
}

export interface MatchedWinRateFit {
  /** Strata with at least one purchase. */
  strata: number;
  /** Items with at least minMatches purchases and se > 0 (the FDR family). */
  tested: number;
  kept: number;
  /** Spread of the true edges (empirical Bayes, method of moments). */
  tau: number;
  /** Benjamini-Hochberg |z| cut-off; null when nothing passes. */
  zCut: number | null;
}

export interface MatchedWinRateTable {
  version: 1;
  generated: string;
  window: { from: string; to: string; days: number };
  method: {
    gameMode: string;
    /** Width of the net-worth-at-purchase bands, in souls. */
    netWorthBand: number;
    /** Buy-time windows, as their lower bounds in seconds. */
    buyTimeWindowsS: number[];
    minMatches: number;
    fdrQ: number;
    /** Fitted rank brackets: minimum match-average rank tier -> label ("Oracle+"). */
    brackets: Record<string, string>;
  };
  /** hero id -> bracket (min rank tier) -> fit summary. */
  fits: Record<string, Record<string, MatchedWinRateFit>>;
  /** hero id -> bracket -> Item.id -> kept entry. */
  heroes: Record<string, Record<string, Record<string, MatchedWinRateEntry>>>;
}

/** One hero's kept items at one rank bracket: what the basket reads. */
export interface HeroMatchedWinRate {
  minRank: number;
  /** "Oracle+" */
  label: string;
  days: number;
  /** Last day of the fit window (YYYY-MM-DD), so reasons don't go stale. */
  to: string;
  items: Readonly<Record<string, MatchedWinRateEntry>>;
}

/**
 * The bracket the planner reads: Oracle (tier 8) and above. The planner's rank
 * picker (BuildClient's selectedRankTier) feeds gun accuracy only; mapping it to
 * a bracket waits until the table is fitted for more brackets.
 */
export const DEFAULT_MATCHED_MIN_RANK = 8;

/**
 * Each item against its peers, stratum by stratum. The peer rate is
 * leave-one-out: every OTHER purchase in the stratum, so an item bought by most
 * of a stratum is not compared with itself. Strata are pooled weighted by the
 * item's purchases there. The se treats the peer rate as known (it pools far
 * more purchases than any one item).
 *
 * Deterministic: rows are summed per stratum in item-id order, and strata in
 * the order given.
 */
export function matchedExcess(
  strata: ReadonlyArray<ReadonlyArray<MatchedRow>>,
): Map<string, MatchedExcess> {
  const acc = new Map<string, { sum: number; varSum: number; n: number }>();
  for (const stratum of strata) {
    const rows = [...stratum]
      .filter(
        (r) =>
          Number.isFinite(r.wins) &&
          Number.isFinite(r.matches) &&
          r.matches > 0 &&
          r.wins >= 0 &&
          r.wins <= r.matches,
      )
      .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    let W = 0;
    let N = 0;
    for (const r of rows) {
      W += r.wins;
      N += r.matches;
    }
    for (const r of rows) {
      const peerN = N - r.matches;
      if (peerN <= 0) continue;
      const q = (W - r.wins) / peerN;
      const p = r.wins / r.matches;
      const a = acc.get(r.itemId) ?? { sum: 0, varSum: 0, n: 0 };
      a.sum += r.matches * (p - q);
      a.varSum += r.matches * p * (1 - p);
      a.n += r.matches;
      acc.set(r.itemId, a);
    }
  }
  const out = new Map<string, MatchedExcess>();
  for (const id of [...acc.keys()].sort()) {
    const a = acc.get(id);
    if (!a || a.n <= 0) continue;
    out.set(id, { excess: a.sum / a.n, se: Math.sqrt(a.varSum) / a.n, n: a.n });
  }
  return out;
}

/**
 * Shrinks and selects one hero's matched edges.
 *  - tested: n >= minMatches and se > 0;
 *  - tau^2 = max(0, var(excess) - mean(se^2)) over the tested items, the
 *    spread around their own mean (the leave-one-out, purchase-weighted
 *    construction does not force the tested items' unweighted mean to 0);
 *  - edge = excess * tau^2 / (tau^2 + se^2);
 *  - kept: |excess / se| >= the Benjamini-Hochberg cut-off at fdrQ, and a
 *    non-zero shrunk edge.
 */
export function fitMatchedWinRate(
  excess: ReadonlyMap<string, MatchedExcess>,
  opts: { minMatches: number; fdrQ: number; strata: number },
): { entries: Record<string, MatchedWinRateEntry>; fit: MatchedWinRateFit } {
  const tested = [...excess.entries()]
    .filter(([, e]) => e.n >= opts.minMatches && e.se > 0 && Number.isFinite(e.excess))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const m = tested.length;
  let tau2 = 0;
  if (m > 0) {
    let sum = 0;
    for (const [, e] of tested) sum += e.excess;
    const mean = sum / m;
    let dev2 = 0;
    let s2 = 0;
    for (const [, e] of tested) {
      dev2 += (e.excess - mean) * (e.excess - mean);
      s2 += e.se * e.se;
    }
    tau2 = Math.max(0, (dev2 - s2) / m);
  }
  const zs = tested.map(([, e]) => e.excess / e.se);
  const zCut = fdrZCutoff(zs, opts.fdrQ);
  const entries: Record<string, MatchedWinRateEntry> = {};
  if (zCut !== null && tau2 > 0) {
    tested.forEach(([id, e], i) => {
      const z = zs[i];
      if (Math.abs(z) < zCut) return;
      const edge = (e.excess * tau2) / (tau2 + e.se * e.se);
      if (edge === 0) return;
      entries[id] = { edge, se: e.se, z, n: e.n };
    });
  }
  return {
    entries,
    fit: {
      strata: opts.strata,
      tested: m,
      kept: Object.keys(entries).length,
      tau: Math.sqrt(tau2),
      zCut,
    },
  };
}

/**
 * One hero's kept items at one rank bracket, or null when the table has no fit
 * for it (no data is not "no edge": the basket term stays inert).
 */
export function heroMatchedWinRate(
  table: MatchedWinRateTable,
  heroId: number,
  minRank: number = DEFAULT_MATCHED_MIN_RANK,
): HeroMatchedWinRate | null {
  const bracket = String(minRank);
  const label = table.method.brackets[bracket];
  const items = table.heroes[String(heroId)]?.[bracket];
  if (label === undefined || items === undefined) return null;
  return { minRank, label, days: table.window.days, to: table.window.to, items };
}
