// lib/matchReview/parseMatch.ts — reads the match metadata response (unknown JSON) into
// MatchMetadata, keeping only the fields the lane review uses. Returns null when a
// required field is missing or the wrong type: missing data is never read as zero.

import type {
  MatchDeath,
  MatchItemEvent,
  MatchMetadata,
  MatchPlayer,
  MatchStatsSnapshot,
} from "./matchTypes";

type Json = Record<string, unknown>;

const SNAPSHOT_FIELDS = [
  "time_stamp_s",
  "net_worth",
  "creep_kills",
  "possible_creeps",
  "denies",
  "player_damage",
  "player_damage_taken",
  "deaths",
  "kills",
  "level",
  "shots_hit",
  "shots_missed",
] as const satisfies ReadonlyArray<keyof MatchStatsSnapshot>;

// Compile-time check that SNAPSHOT_FIELDS lists every MatchStatsSnapshot field, so the
// cast in readSnapshot() can never leave one undefined.
type UnlistedSnapshotField = Exclude<keyof MatchStatsSnapshot, (typeof SNAPSHOT_FIELDS)[number]>;
const ALL_SNAPSHOT_FIELDS_LISTED: [UnlistedSnapshotField] extends [never] ? true : never = true;
void ALL_SNAPSHOT_FIELDS_LISTED;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Maps every element, or null if any element fails. */
function mapAll<T>(v: unknown, read: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const r = read(x);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

function readSnapshot(v: unknown): MatchStatsSnapshot | null {
  if (!isObject(v)) return null;
  const out: Partial<MatchStatsSnapshot> = {};
  for (const f of SNAPSHOT_FIELDS) {
    const x = v[f];
    if (!isNum(x)) return null;
    out[f] = x;
  }
  return out as MatchStatsSnapshot;
}

function readItem(v: unknown): MatchItemEvent | null {
  // sold_time_s is required: 0 means still held, and absent is unknown, not held.
  if (!isObject(v) || !isNum(v.item_id) || !isNum(v.game_time_s) || !isNum(v.sold_time_s)) {
    return null;
  }
  return { item_id: v.item_id, game_time_s: v.game_time_s, sold_time_s: v.sold_time_s };
}

function readDeath(v: unknown): MatchDeath | null {
  if (!isObject(v) || !isNum(v.game_time_s) || !isNum(v.killer_player_slot)) return null;
  return { game_time_s: v.game_time_s, killer_player_slot: v.killer_player_slot };
}

function readPlayer(v: unknown): MatchPlayer | null {
  if (!isObject(v)) return null;
  const { player_slot, team, hero_id, assigned_lane } = v;
  if (!isNum(player_slot) || !isNum(team) || !isNum(hero_id) || !isNum(assigned_lane)) {
    return null;
  }
  // An empty list is "none"; an absent one is unknown, so the match is rejected.
  const items = mapAll(v.items, readItem);
  const death_details = mapAll(v.death_details, readDeath);
  const stats = mapAll(v.stats, readSnapshot);
  if (!items || !death_details || !stats) return null;
  return { player_slot, team, hero_id, assigned_lane, items, death_details, stats };
}

/** Accepts the API response (`{ match_info: ... }`) or the bare match_info object. */
export function parseMatchMetadata(json: unknown): MatchMetadata | null {
  const m = isObject(json) && isObject(json.match_info) ? json.match_info : json;
  if (!isObject(m)) return null;
  const { match_id, duration_s, game_mode } = m;
  if (!isNum(match_id) || !isNum(duration_s) || !isNum(game_mode)) return null;
  const players = mapAll(m.players, readPlayer);
  if (!players || players.length === 0) return null;
  return { match_id, duration_s, game_mode, players };
}
