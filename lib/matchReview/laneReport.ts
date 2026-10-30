// lib/matchReview/laneReport.ts — the lane report: one player's first 9 minutes against
// their two lane opponents and their lane partner (docs/match-review-use-cases.md §3–4).
//
// Pure and deterministic: the same match, hero and catalogue always give the same
// report, whatever the order of players or items. Imports nothing from lib/coach,
// lib/engine, lib/scoring or app (Fixture 21).

import type { Item } from "../items";
import type {
  LaneDeath,
  LaneItem,
  LanePlayer,
  LaneReviewResult,
  LaneSnapshot,
  LeadJudgement,
  MatchDeath,
  MatchItemEvent,
  MatchMetadata,
  MatchPlayer,
  MatchStatsSnapshot,
  TradeJudgement,
} from "./matchTypes";

/** Normal 6v6 matches only. */
export const SUPPORTED_GAME_MODE = 1;
/**
 * Lane end: the 9:00 snapshot. The wiki defines no hard end; deadlock.wiki/Souls puts
 * it at about 8 minutes, and the first Guardian fell at 6:35–8:19 in the three verified
 * matches (docs/match-review-use-cases.md §3).
 */
export const LANE_END_S = 540;
/** 6:00, the "fell behind early" check. */
export const EARLY_CHECK_S = 360;
/** Snapshots the report shows: 3:00, 6:00, 9:00, and 12:00 (Guardian armour gone). */
export const LANE_CHECKPOINTS_S = [180, 360, 540, 720] as const;

/** `assigned_lane` → lane name (`/v1/assets/generic-data` lane_info, deadlock.wiki/Lanes). */
export const LANE_NAMES: Readonly<Record<number, string>> = {
  1: "York",
  4: "Broadway",
  6: "Greenwich",
};

/** More than 10% above or below the comparison is ahead or behind (§4.1). */
export const LEAD_MARGIN = 0.1;
/** Dealt / taken above this is a won trade (§4.1). */
export const WON_TRADE_RATIO = 1.25;
/** Dealt / taken below this is a lost trade (§4.1). */
export const LOST_TRADE_RATIO = 0.8;
/**
 * Last-hit share this many points below the opponents' average is "missed last hits".
 * Against the better opponent instead, it flagged 8 of 12 players in a real match
 * (most lanes have one strong last-hitter); the average flags 3, each the clear lowest.
 */
export const LAST_HIT_SHARE_MARGIN = 0.1;
/** This many deaths before lane end are costly. */
export const COSTLY_DEATHS = 2;
/** Float tolerance: a value exactly on a threshold is "even", never a rounding accident. */
const EPS = 1e-9;

/** The catalogue fields the report needs; the planner's shop items (`getItems()`). */
export type CatalogueItem = Pick<Item, "id" | "numericId" | "name" | "cost">;

export function judgeLead(mine: number, theirs: number): LeadJudgement {
  if (theirs <= 0) return mine > 0 ? "ahead" : "even";
  const lead = (mine - theirs) / theirs;
  if (lead > LEAD_MARGIN + EPS) return "ahead";
  if (lead < -LEAD_MARGIN - EPS) return "behind";
  return "even";
}

export function judgeTrades(dealt: number, taken: number): TradeJudgement {
  if (taken <= 0) return dealt > 0 ? "won" : "even";
  const ratio = dealt / taken;
  if (ratio > WON_TRADE_RATIO + EPS) return "won";
  if (ratio < LOST_TRADE_RATIO - EPS) return "lost";
  return "even";
}

/** Last hits as a share of the creeps available; null when none were available. */
export function lastHitShare(s: Pick<LaneSnapshot, "lastHits" | "possibleCreeps">): number | null {
  return s.possibleCreeps > 0 ? s.lastHits / s.possibleCreeps : null;
}

/** Shots hit as a share of shots fired; null when none were fired. */
export function shotAccuracy(s: Pick<LaneSnapshot, "shotsHit" | "shotsMissed">): number | null {
  const fired = s.shotsHit + s.shotsMissed;
  return fired > 0 ? s.shotsHit / fired : null;
}

export function judgeMissedLastHits(
  mine: number | null,
  opponents: ReadonlyArray<number | null>,
): boolean | null {
  // Unknown on either side is unknown, never "did not miss".
  if (mine === null || opponents.length === 0 || opponents.some((s) => s === null)) return null;
  const known = opponents.filter((s): s is number => s !== null);
  const average = known.reduce((sum, s) => sum + s, 0) / known.length;
  return average - mine > LAST_HIT_SHARE_MARGIN + EPS;
}

function toSnapshot(s: MatchStatsSnapshot): LaneSnapshot {
  return {
    timeS: s.time_stamp_s,
    souls: s.net_worth,
    lastHits: s.creep_kills,
    possibleCreeps: s.possible_creeps,
    denies: s.denies,
    damageDealt: s.player_damage,
    damageTaken: s.player_damage_taken,
    kills: s.kills,
    deaths: s.deaths,
    level: s.level,
    shotsHit: s.shots_hit,
    shotsMissed: s.shots_missed,
  };
}

function snapshotAt(p: MatchPlayer, timeS: number): MatchStatsSnapshot | undefined {
  return p.stats.find((s) => s.time_stamp_s === timeS);
}

/** null when the player has no lane-end snapshot. */
function toLanePlayer(p: MatchPlayer): LanePlayer | null {
  const end = snapshotAt(p, LANE_END_S);
  if (!end) return null;
  const snapshots = LANE_CHECKPOINTS_S.map((t) => snapshotAt(p, t))
    .filter((s): s is MatchStatsSnapshot => s !== undefined)
    .map(toSnapshot);
  return {
    heroId: p.hero_id,
    playerSlot: p.player_slot,
    team: p.team,
    rankBadge: p.rank_badge,
    snapshots,
    atLaneEnd: toSnapshot(end),
  };
}

function bySlot(a: MatchPlayer, b: MatchPlayer): number {
  return a.player_slot - b.player_slot;
}

function laneDeaths(
  deaths: readonly MatchDeath[],
  you: MatchPlayer,
  opponentSlots: ReadonlySet<number>,
  players: readonly MatchPlayer[],
): LaneDeath[] {
  return deaths
    .filter((d) => d.game_time_s < LANE_END_S)
    .map((d) => {
      const killer = players.find((p) => p.player_slot === d.killer_player_slot);
      return {
        timeS: d.game_time_s,
        killerHeroId: killer?.hero_id ?? null,
        gank: !!killer && killer.team !== you.team && !opponentSlots.has(killer.player_slot),
      };
    })
    .sort((a, b) => a.timeS - b.timeS || (a.killerHeroId ?? -1) - (b.killerHeroId ?? -1));
}

/** Shop items (catalogue entries) bought before lane end and still held at lane end. */
function laneItems(
  events: readonly MatchItemEvent[],
  catalogue: readonly CatalogueItem[],
): LaneItem[] {
  const byNumericId = new Map(catalogue.map((i) => [i.numericId, i]));
  const held: LaneItem[] = [];
  for (const e of events) {
    const item = byNumericId.get(e.item_id);
    if (!item || e.game_time_s >= LANE_END_S) continue;
    if (e.sold_time_s > 0 && e.sold_time_s < LANE_END_S) continue;
    held.push({
      itemId: item.id,
      numericId: item.numericId,
      name: item.name,
      cost: item.cost,
      boughtAtS: e.game_time_s,
    });
  }
  return held.sort((a, b) => a.boughtAtS - b.boughtAtS || a.numericId - b.numericId);
}

/**
 * The lane review for the player on `heroId`, or why there is none. `catalogue` is the
 * planner's shop items: entries of `items[]` not in it (ability unlocks) are ignored.
 */
export function laneReview(
  match: MatchMetadata,
  heroId: number,
  catalogue: readonly CatalogueItem[],
): LaneReviewResult {
  if (match.game_mode !== SUPPORTED_GAME_MODE) return { ok: false, reason: "unsupported_mode" };
  // Each hero is played once per match; anything else is not a match we can read.
  const withHero = match.players.filter((p) => p.hero_id === heroId);
  if (withHero.length !== 1) return { ok: false, reason: "hero_not_in_match" };
  const youRaw = withHero[0];
  if (match.duration_s < LANE_END_S) return { ok: false, reason: "too_short" };

  const inLane = match.players.filter((p) => p.assigned_lane === youRaw.assigned_lane);
  const partners = inLane.filter((p) => p.team === youRaw.team && p !== youRaw);
  const opponentsRaw = inLane.filter((p) => p.team !== youRaw.team).sort(bySlot);
  if (partners.length !== 1 || opponentsRaw.length !== 2) {
    return { ok: false, reason: "lane_incomplete" };
  }

  const you = toLanePlayer(youRaw);
  const partner = toLanePlayer(partners[0]);
  const opp1 = toLanePlayer(opponentsRaw[0]);
  const opp2 = toLanePlayer(opponentsRaw[1]);
  if (!you || !partner || !opp1 || !opp2) return { ok: false, reason: "missing_snapshot" };

  const opponentSlots = new Set(opponentsRaw.map((p) => p.player_slot));
  const deaths = laneDeaths(youRaw.death_details, youRaw, opponentSlots, match.players);
  const oppAvgSouls = (opp1.atLaneEnd.souls + opp2.atLaneEnd.souls) / 2;
  const duoSouls = you.atLaneEnd.souls + partner.atLaneEnd.souls;
  const oppSouls = opp1.atLaneEnd.souls + opp2.atLaneEnd.souls;

  const soulsAtSix = (p: LanePlayer) => p.snapshots.find((s) => s.timeS === EARLY_CHECK_S)?.souls;
  const youSix = soulsAtSix(you);
  const o1Six = soulsAtSix(opp1);
  const o2Six = soulsAtSix(opp2);
  const atSixMinutes =
    youSix !== undefined && o1Six !== undefined && o2Six !== undefined
      ? judgeLead(youSix, (o1Six + o2Six) / 2)
      : null;

  return {
    ok: true,
    report: {
      matchId: match.match_id,
      lane: youRaw.assigned_lane,
      you,
      partner,
      opponents: [opp1, opp2],
      deaths,
      items: laneItems(youRaw.items, catalogue),
      soulGap: you.atLaneEnd.souls - oppAvgSouls,
      laneSoulGap: duoSouls - oppSouls,
      judgements: {
        souls: judgeLead(you.atLaneEnd.souls, oppAvgSouls),
        lane: judgeLead(duoSouls, oppSouls),
        atSixMinutes,
        costlyDeaths: deaths.length >= COSTLY_DEATHS,
        trades: judgeTrades(you.atLaneEnd.damageDealt, you.atLaneEnd.damageTaken),
        missedLastHits: judgeMissedLastHits(lastHitShare(you.atLaneEnd), [
          lastHitShare(opp1.atLaneEnd),
          lastHitShare(opp2.atLaneEnd),
        ]),
      },
    },
  };
}
