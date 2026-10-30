// lib/matchReview/matchTypes.ts — the slice of match metadata the lane review reads,
// and the lane report it produces (docs/match-review-use-cases.md, MR1).
//
// Source: GET https://api.deadlock-api.com/v1/matches/{match_id}/metadata, field names
// verified against live matches 2026-10-26. Only the fields used here are typed;
// parseMatchMetadata() checks them at runtime because the page reads unknown JSON.

/** One `stats[]` entry. Every value is a running total since the match start. */
export interface MatchStatsSnapshot {
  time_stamp_s: number;
  /** Total souls earned. */
  net_worth: number;
  /** Last hits. NOT the top-level `last_hits`, which counts something else. */
  creep_kills: number;
  /** Creeps available to this player; undocumented, so only compared within a lane. */
  possible_creeps: number;
  denies: number;
  player_damage: number;
  player_damage_taken: number;
  deaths: number;
  kills: number;
  level: number;
  shots_hit: number;
  shots_missed: number;
}

/** One `items[]` entry: shop items AND ability unlocks share this list. */
export interface MatchItemEvent {
  item_id: number;
  game_time_s: number;
  /** 0 = still held at the end of the match. */
  sold_time_s: number;
}

export interface MatchDeath {
  game_time_s: number;
  killer_player_slot: number;
}

export interface MatchPlayer {
  player_slot: number;
  team: number;
  hero_id: number;
  /** 1 = York (yellow), 4 = Broadway (blue), 6 = Greenwich (green). */
  assigned_lane: number;
  /**
   * `player_rank_data.initial_display_rank`: the player's badge at match start (tier x 10
   * + subtier, e.g. 65 = Ritualist 5). Optional in the response: null when absent.
   */
  rank_badge: number | null;
  items: MatchItemEvent[];
  death_details: MatchDeath[];
  stats: MatchStatsSnapshot[];
}

export interface MatchMetadata {
  match_id: number;
  duration_s: number;
  /** 1 = normal 6v6; 4 = Street Brawl. */
  game_mode: number;
  players: MatchPlayer[];
}

// ---------------------------------------------------------------------------
// The lane report
// ---------------------------------------------------------------------------

export type LeadJudgement = "ahead" | "even" | "behind";
export type TradeJudgement = "won" | "even" | "lost";

/** One player's numbers at one snapshot. */
export interface LaneSnapshot {
  timeS: number;
  souls: number;
  lastHits: number;
  possibleCreeps: number;
  denies: number;
  damageDealt: number;
  damageTaken: number;
  kills: number;
  deaths: number;
  level: number;
  shotsHit: number;
  shotsMissed: number;
}

export interface LanePlayer {
  heroId: number;
  playerSlot: number;
  team: number;
  /** The badge at match start (MatchPlayer.rank_badge); null when unknown. */
  rankBadge: number | null;
  /** The snapshots at LANE_CHECKPOINTS_S that the match has, in time order. */
  snapshots: LaneSnapshot[];
  /** The lane-end (9:00) snapshot. */
  atLaneEnd: LaneSnapshot;
}

export interface LaneDeath {
  timeS: number;
  /** null = the killer slot matches no player (troopers or a structure). */
  killerHeroId: number | null;
  /** The killer was an enemy player from another lane. */
  gank: boolean;
}

export interface LaneItem {
  itemId: string;
  numericId: number;
  name: string;
  cost: number;
  boughtAtS: number;
}

export interface LaneJudgements {
  /** Your souls against the opponent average at lane end. */
  souls: LeadJudgement;
  /** Your duo's souls against the opponents' total at lane end. */
  lane: LeadJudgement;
  /** Your souls against the opponent average at 6:00; null if a 6:00 snapshot is missing. */
  atSixMinutes: LeadJudgement | null;
  /** Two or more deaths before lane end. */
  costlyDeaths: boolean;
  /** Damage dealt against damage taken by lane end. */
  trades: TradeJudgement;
  /** Your last-hit share is more than 10 points below the opponents' average; null if unknown. */
  missedLastHits: boolean | null;
}

export interface LaneReport {
  matchId: number;
  lane: number;
  you: LanePlayer;
  partner: LanePlayer;
  /** The two enemy players in your lane, by player slot. */
  opponents: [LanePlayer, LanePlayer];
  /** Your deaths before lane end, in time order. */
  deaths: LaneDeath[];
  /** Shop items you held at lane end, in purchase order. */
  items: LaneItem[];
  /** Your souls minus the opponent average, at lane end. */
  soulGap: number;
  /** (You + partner) minus (both opponents), at lane end. */
  laneSoulGap: number;
  judgements: LaneJudgements;
}

export type NoReviewReason =
  /** Not a normal 6v6 match (e.g. Street Brawl). */
  | "unsupported_mode"
  /** The match ended before lane end. */
  | "too_short"
  /** The match reached lane end, but a lane player has no 9:00 snapshot. */
  | "missing_snapshot"
  | "hero_not_in_match"
  /** The lane is not two players per team. */
  | "lane_incomplete";

export type LaneReviewResult =
  | { ok: true; report: LaneReport }
  | { ok: false; reason: NoReviewReason };
