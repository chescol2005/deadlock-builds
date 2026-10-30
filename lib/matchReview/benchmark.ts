// lib/matchReview/benchmark.ts — you against a typical player on the same hero at 9:00
// (docs/match-review-use-cases.md §10, MRB1).
//
// Source: GET https://api.deadlock-api.com/v1/analytics/player-performance-curve
// ?hero_ids={hero}&resolution=0[&min_average_badge=…&max_average_badge=…]: one row per
// stats-snapshot time, each with `<stat>_avg`, `<stat>_std` and `samples` (player
// snapshots averaged). Fields verified by data-verifier 2026-10-29.
//
// Pure and deterministic. Imports only its own files (Fixture 24).

import { LANE_END_S } from "./laneReport";
import type { LaneReport } from "./matchTypes";

/** The five stats compared (§10.3). */
export const BENCHMARK_STATS = ["souls", "lastHits", "denies", "damageDealt", "deaths"] as const;
export type BenchmarkStat = (typeof BENCHMARK_STATS)[number];

/** The curve's field prefix for each stat; the lane report reads the same snapshot fields. */
const CURVE_FIELDS: Readonly<Record<BenchmarkStat, string>> = {
  souls: "net_worth",
  lastHits: "creep_kills",
  denies: "denies",
  damageDealt: "player_damage",
  deaths: "deaths",
};

/** Deaths are the one stat where fewer is better. */
const LOWER_IS_BETTER: ReadonlySet<BenchmarkStat> = new Set(["deaths"]);

/** More than this many standard deviations from the average is above / below typical. */
export const BENCHMARK_STD_MARGIN = 1;
/** Fewer player snapshots than this is not enough to compare (as ANALYTICS_MIN_MATCHES). */
export const BENCHMARK_MIN_SNAPSHOTS = 200;
/** Ranked tiers, 1 Initiate to 11 Eternus (`/v1/assets/ranks`); 0 (Obscurus) is unranked. */
export const MIN_RANK_TIER = 1;
export const MAX_RANK_TIER = 11;
/** Float tolerance: exactly one standard deviation away is "typical". */
const EPS = 1e-9;

export interface StatDistribution {
  avg: number;
  std: number;
}

/** The curve's 9:00 point. A stat whose fields are missing or invalid is null (no benchmark). */
export interface CurvePoint {
  snapshots: number;
  stats: Readonly<Record<BenchmarkStat, StatDistribution | null>>;
}

export type TypicalJudgement = "above" | "typical" | "below";

export interface StatBenchmark {
  stat: BenchmarkStat;
  you: number;
  avg: number;
  std: number;
  /** null when the standard deviation is 0 (nothing to judge against). */
  judgement: TypicalJudgement | null;
}

export interface LaneBenchmark {
  heroId: number;
  /** The rank tier compared against; null = all ranks. */
  tier: number | null;
  snapshots: number;
  /** In BENCHMARK_STATS order; a stat the curve lacks is left out. */
  stats: StatBenchmark[];
}

export type NoBenchmarkReason =
  /** The fetch failed or the response could not be read. */
  | "unavailable"
  /** Fewer than BENCHMARK_MIN_SNAPSHOTS player snapshots in the bracket. */
  | "not_enough_games";

export type LaneBenchmarkResult =
  | { ok: true; benchmark: LaneBenchmark }
  | { ok: false; reason: NoBenchmarkReason };

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Reads the curve response (unknown JSON) at lane end. Null when it is not an array, has
 * no 9:00 row, or the row's snapshot count is missing: missing data is never read as 0.
 */
export function parsePerformanceCurve(json: unknown): CurvePoint | null {
  if (!Array.isArray(json)) return null;
  const rows = json.filter((r): r is Json => isObject(r) && r.game_time === LANE_END_S);
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!isNum(row.samples) || row.samples < 0) return null;
  const stats = {} as Record<BenchmarkStat, StatDistribution | null>;
  for (const stat of BENCHMARK_STATS) {
    const avg = row[`${CURVE_FIELDS[stat]}_avg`];
    const std = row[`${CURVE_FIELDS[stat]}_std`];
    stats[stat] = isNum(avg) && isNum(std) && std >= 0 ? { avg, std } : null;
  }
  return { snapshots: row.samples, stats };
}

/** A badge's rank tier (badge = tier x 10 + subtier 1–6); null when not a ranked badge. */
export function rankTierOf(badge: number | null): number | null {
  if (badge === null || !Number.isInteger(badge)) return null;
  const tier = Math.floor(badge / 10);
  const subtier = badge % 10;
  if (tier < MIN_RANK_TIER || tier > MAX_RANK_TIER || subtier < 1 || subtier > 6) return null;
  return tier;
}

/** The badge range one tier covers in the curve's `min/max_average_badge` filter. */
export function badgeRange(tier: number): { min: number; max: number } {
  return { min: tier * 10 + 1, max: tier * 10 + 6 };
}

/** The default bracket: your rank at match start, else all ranks (null). §10.2. */
export function defaultBenchmarkTier(report: LaneReport): number | null {
  return rankTierOf(report.you.rankBadge);
}

/** The curve query string for this hero and bracket (null tier = all ranks). */
export function performanceCurveQuery(heroId: number, tier: number | null): string {
  const params = new URLSearchParams({ hero_ids: String(heroId), resolution: "0" });
  if (tier !== null) {
    const { min, max } = badgeRange(tier);
    params.set("min_average_badge", String(min));
    params.set("max_average_badge", String(max));
  }
  return params.toString();
}

export function judgeAgainstTypical(
  value: number,
  dist: StatDistribution,
  lowerIsBetter: boolean,
): TypicalJudgement | null {
  if (dist.std <= 0) return null;
  const better = ((lowerIsBetter ? -1 : 1) * (value - dist.avg)) / dist.std;
  if (better > BENCHMARK_STD_MARGIN + EPS) return "above";
  if (better < -BENCHMARK_STD_MARGIN - EPS) return "below";
  return "typical";
}

/** Your lane-end value for each stat (the same snapshot fields the curve averages). */
function yourValue(report: LaneReport, stat: BenchmarkStat): number {
  const s = report.you.atLaneEnd;
  switch (stat) {
    case "souls":
      return s.souls;
    case "lastHits":
      return s.lastHits;
    case "denies":
      return s.denies;
    case "damageDealt":
      return s.damageDealt;
    case "deaths":
      return s.deaths;
  }
}

/**
 * Your 9:00 against the curve point for your hero in `tier` (null = all ranks). `curve`
 * null (failed fetch or unreadable response) gives "unavailable".
 */
export function benchmarkLane(
  report: LaneReport,
  curve: CurvePoint | null,
  tier: number | null,
): LaneBenchmarkResult {
  if (!curve) return { ok: false, reason: "unavailable" };
  if (curve.snapshots < BENCHMARK_MIN_SNAPSHOTS) return { ok: false, reason: "not_enough_games" };
  const stats: StatBenchmark[] = [];
  for (const stat of BENCHMARK_STATS) {
    const dist = curve.stats[stat];
    if (!dist) continue;
    const you = yourValue(report, stat);
    stats.push({
      stat,
      you,
      avg: dist.avg,
      std: dist.std,
      judgement: judgeAgainstTypical(you, dist, LOWER_IS_BETTER.has(stat)),
    });
  }
  if (stats.length === 0) return { ok: false, reason: "unavailable" };
  return {
    ok: true,
    benchmark: { heroId: report.you.heroId, tier, snapshots: curve.snapshots, stats },
  };
}
