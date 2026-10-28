// lib/matchReview/parseHistory.ts — a player's recent normal matches, from
// GET https://api.deadlock-api.com/v1/players/{account_id}/match-history (verified
// 2026-10-28: a top-level array, newest first, the full stored history, uncapped).
// Rows missing a field the picker shows are dropped, never read as 0.

import { SUPPORTED_GAME_MODE } from "./laneReport";

export interface RecentMatch {
  matchId: number;
  heroId: number;
  /** Unix seconds. */
  startTime: number;
  durationS: number;
  /** match_result is the winning team; a win is match_result === player_team. */
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

/** How many recent matches the picker shows. */
export const RECENT_MATCH_LIMIT = 10;

const REQUIRED = [
  "match_id",
  "hero_id",
  "start_time",
  "game_mode",
  "match_duration_s",
  "match_result",
  "player_team",
  "player_kills",
  "player_deaths",
  "player_assists",
] as const;

type Row = Record<(typeof REQUIRED)[number], number>;

function readRow(v: unknown): Row | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const obj = v as Record<string, unknown>;
  const out: Partial<Row> = {};
  for (const f of REQUIRED) {
    const x = obj[f];
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    out[f] = x;
  }
  return out as Row;
}

/**
 * The newest `limit` normal (6v6) matches, newest first; null when the response is not
 * a list at all. Street Brawl and malformed rows are left out.
 */
export function parseMatchHistory(
  json: unknown,
  limit: number = RECENT_MATCH_LIMIT,
): RecentMatch[] | null {
  if (!Array.isArray(json)) return null;
  const rows: RecentMatch[] = [];
  for (const v of json) {
    const r = readRow(v);
    if (!r || r.game_mode !== SUPPORTED_GAME_MODE) continue;
    rows.push({
      matchId: r.match_id,
      heroId: r.hero_id,
      startTime: r.start_time,
      durationS: r.match_duration_s,
      won: r.match_result === r.player_team,
      kills: r.player_kills,
      deaths: r.player_deaths,
      assists: r.player_assists,
    });
  }
  return rows.sort((a, b) => b.startTime - a.startTime || b.matchId - a.matchId).slice(0, limit);
}
