// app/match/matchApi.ts — fetches match metadata from the visitor's browser
// (docs/match-review-use-cases.md §5). The optional deadlock-api key goes only to
// api.deadlock-api.com, as the X-API-KEY header: never to this site, never in a URL
// (Fixture 23, R9). Responses verified 2026-10-26: 404 "Match metadata not found.",
// 503 "Steam is busy" with Retry-After.

import { parseMatchMetadata } from "@/lib/matchReview";
import type { MatchMetadata } from "@/lib/matchReview";

export const MATCH_API_BASE = "https://api.deadlock-api.com/v1/matches";

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

function retryAfter(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function fetchMatchMetadata(
  matchId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<MatchLoadResult> {
  if (!MATCH_ID_PATTERN.test(matchId)) return { ok: false, error: { kind: "invalid_id" } };
  const key = apiKey.trim();
  let res: Response;
  try {
    res = await fetch(`${MATCH_API_BASE}/${matchId}/metadata`, {
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
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: { kind: "unreadable" } };
  }
  const match = parseMatchMetadata(json);
  return match ? { ok: true, match } : { ok: false, error: { kind: "unreadable" } };
}
