// app/match/matchApi.ts — fetches match data from the visitor's browser
// (docs/match-review-use-cases.md §5). The optional deadlock-api key goes only to
// api.deadlock-api.com, as the X-API-KEY header: never to this site, never in a URL
// (Fixture 23, R9). Every request goes through apiGet(), the one fetch call.
// Responses verified: match metadata 2026-10-26 (404 "Match metadata not found.",
// 503 "Steam is busy" with Retry-After); match history 2026-10-28 (a JSON array; a bad
// account id is a 400 with a plain-text body); the performance curve 2026-10-29 (a JSON
// array, no key needed, §10).

import {
  parseMatchHistory,
  parseMatchMetadata,
  parsePerformanceCurve,
  performanceCurveQuery,
} from "@/lib/matchReview";
import type { CurvePoint, MatchMetadata, RecentMatch } from "@/lib/matchReview";

export const API_ORIGIN = "https://api.deadlock-api.com";
export const MATCH_API_BASE = `${API_ORIGIN}/v1/matches`;
export const PLAYER_API_BASE = `${API_ORIGIN}/v1/players`;

/** A match ID: digits only. */
export const MATCH_ID_PATTERN = /^\d{1,12}$/;

export type MatchLoadError =
  | { kind: "invalid_id" }
  | { kind: "not_found" }
  /** Steam fetch refused; retry after this many seconds (null = not given). */
  | { kind: "steam_busy"; retryAfterS: number | null }
  | { kind: "rate_limited"; retryAfterS: number | null }
  | { kind: "bad_key" }
  | { kind: "unreadable" }
  | { kind: "network" }
  | { kind: "http"; status: number };

export type MatchLoadResult =
  | { ok: true; match: MatchMetadata }
  | { ok: false; error: MatchLoadError };

export type HistoryLoadResult =
  | { ok: true; matches: RecentMatch[] }
  | { ok: false; error: MatchLoadError };

function retryAfter(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * GET a deadlock-api path and read its JSON, mapping every failure to a MatchLoadError.
 * Aborts propagate, so a newer lookup can cancel an older one.
 */
async function apiGet(
  path: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ ok: true; json: unknown } | { ok: false; error: MatchLoadError }> {
  const key = apiKey.trim();
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}${path}`, {
      headers: key ? { "X-API-KEY": key } : undefined,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, error: { kind: "network" } };
  }
  if (res.status === 404) return { ok: false, error: { kind: "not_found" } };
  if (res.status === 503) {
    return { ok: false, error: { kind: "steam_busy", retryAfterS: retryAfter(res) } };
  }
  if (res.status === 429) {
    return { ok: false, error: { kind: "rate_limited", retryAfterS: retryAfter(res) } };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: { kind: "bad_key" } };
  if (!res.ok) return { ok: false, error: { kind: "http", status: res.status } };
  try {
    return { ok: true, json: await res.json() };
  } catch {
    return { ok: false, error: { kind: "unreadable" } };
  }
}

export async function fetchMatchMetadata(
  matchId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<MatchLoadResult> {
  if (!MATCH_ID_PATTERN.test(matchId)) return { ok: false, error: { kind: "invalid_id" } };
  const got = await apiGet(`/v1/matches/${matchId}/metadata`, apiKey, signal);
  if (!got.ok) return got;
  const match = parseMatchMetadata(got.json);
  return match ? { ok: true, match } : { ok: false, error: { kind: "unreadable" } };
}

/** The account's recent normal matches; `accountId` comes from parsePlayerId(). */
export async function fetchMatchHistory(
  accountId: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<HistoryLoadResult> {
  if (!Number.isInteger(accountId) || accountId <= 0 || accountId > 0xffffffff) {
    return { ok: false, error: { kind: "invalid_id" } };
  }
  const got = await apiGet(`/v1/players/${accountId}/match-history`, apiKey, signal);
  if (!got.ok) return got;
  const matches = parseMatchHistory(got.json);
  return matches ? { ok: true, matches } : { ok: false, error: { kind: "unreadable" } };
}

/**
 * The typical player's 9:00 point for this hero and rank tier (null = all ranks), or
 * null when it can't be loaded or read: the lane report then shows without it (§10.4).
 */
export async function fetchPerformanceCurve(
  heroId: number,
  tier: number | null,
  apiKey: string,
  signal?: AbortSignal,
): Promise<CurvePoint | null> {
  const got = await apiGet(
    `/v1/analytics/player-performance-curve?${performanceCurveQuery(heroId, tier)}`,
    apiKey,
    signal,
  );
  return got.ok ? parsePerformanceCurve(got.json) : null;
}
