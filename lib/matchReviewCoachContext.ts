// lib/matchReviewCoachContext.ts — turns a lane report into the plain facts the coach
// speaks from (match review MR2, docs/match-review-use-cases.md §6).
//
// The ONE bridge between lib/matchReview and lib/coach: neither imports the other
// (Fixtures 18 and 21). Pure: same report, same facts. Each fact carries exactly the
// numbers its message shows: times as game-clock text, souls and damage rounded to
// 50, shares in whole percents.

import type { Item } from "./items";
import { getBoonThreshold } from "./boonSystem";
import { heroRolesOf } from "./heroRoles";
import { EARLY_CHECK_S, LANE_END_S, lastHitShare } from "./matchReview";
import type { LaneBenchmark, LanePlayer, LaneReport } from "./matchReview";
import type { CoachContext, CoachFact, CoachItem, PlayerMode } from "./coach";

export interface MatchCoachInput {
  playerMode: PlayerMode;
  report: LaneReport;
  /** The reviewed player's hero. */
  hero: { id: number; name: string; complexity: number };
  /** Hero id → name, for killers. A hero missing here is left out of the message. */
  heroNames: ReadonlyMap<number, string>;
  /** Every shop item: lane items' details, and names for the validator. */
  allItems: ReadonlyArray<Item>;
  /** The typical-player comparison, once loaded (§10); absent = no benchmark line. */
  benchmark?: { result: LaneBenchmark; rankName: string | null } | null;
}

/** Seconds → game clock: 331 → "5:31". */
export function gameClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const STEP = 50;

/** A ganker whose hero name is unknown. */
export const UNNAMED_GANKER = "an enemy";

/** Souls or damage as the coach says them: nearest 50. */
export function roundAmount(n: number): number {
  return Math.round(n / STEP) * STEP;
}

/** A gap the coach calls ahead or behind: nearest 50, never shown as 0. */
function gapAmount(n: number): number {
  return Math.max(STEP, roundAmount(Math.abs(n)));
}

function soulsAt(p: LanePlayer, timeS: number): number | undefined {
  return p.snapshots.find((s) => s.timeS === timeS)?.souls;
}

function percent(share: number): number {
  return Math.round(share * 100);
}

export function laneFacts(report: LaneReport, heroNames: ReadonlyMap<number, string>): CoachFact[] {
  const { judgements: j, deaths } = report;
  const laneEnd = gameClock(LANE_END_S);
  const facts: CoachFact[] = [];

  if (j.costlyDeaths) {
    const gankers: string[] = [];
    for (const d of deaths) {
      if (!d.gank) continue;
      // A gank by a hero we can't name is still a gank: never fall back to "no gank" advice.
      const name =
        (d.killerHeroId !== null ? heroNames.get(d.killerHeroId) : undefined) ?? UNNAMED_GANKER;
      if (!gankers.includes(name)) gankers.push(name);
    }
    facts.push({
      id: "lane_deaths",
      count: deaths.length,
      deathTimes: deaths.map((d) => gameClock(d.timeS)),
      gankers,
      laneEnd,
    });
  }

  if (j.atSixMinutes === "behind") {
    const mine = soulsAt(report.you, EARLY_CHECK_S);
    const o1 = soulsAt(report.opponents[0], EARLY_CHECK_S);
    const o2 = soulsAt(report.opponents[1], EARLY_CHECK_S);
    if (mine !== undefined && o1 !== undefined && o2 !== undefined) {
      facts.push({
        id: "fell_behind_early",
        soulsBehind: gapAmount((o1 + o2) / 2 - mine),
        recovered: j.souls !== "behind",
        checkTime: gameClock(EARLY_CHECK_S),
        laneEnd,
      });
    }
  }

  const dealt = roundAmount(report.you.atLaneEnd.damageDealt);
  const taken = roundAmount(report.you.atLaneEnd.damageTaken);
  // Rounding must not make a lost trade read as an even one ("100 dealt, 100 taken").
  if (j.trades === "lost" && dealt < taken) {
    facts.push({ id: "lost_trades", dealt, taken, laneEnd });
  }

  if (j.missedLastHits === true) {
    const mine = lastHitShare(report.you.atLaneEnd);
    const theirs = report.opponents.map((o) => lastHitShare(o.atLaneEnd));
    if (mine !== null && theirs[0] !== null && theirs[1] !== null) {
      facts.push({
        id: "missed_last_hits",
        yourShare: percent(mine),
        opponentShare: percent((theirs[0] + theirs[1]) / 2),
      });
    }
  }

  if (j.souls === "ahead" && deaths.length === 0) {
    facts.push({ id: "strong_lane", soulGap: gapAmount(report.soulGap), laneEnd });
  } else {
    facts.push({
      id: "lane_result",
      result: j.souls,
      // "Within N souls" must hold: an even gap rounds up, never down.
      soulGap:
        j.souls === "even"
          ? Math.max(STEP, Math.ceil(Math.abs(report.soulGap) / STEP) * STEP)
          : gapAmount(report.soulGap),
      laneEnd,
    });
  }
  return facts;
}

/**
 * The typical-player souls fact (§10.5): only above or below typical, and only when the
 * rounded numbers still differ (rounding must not make "below" read as equal).
 */
export function typicalSoulsFact(
  benchmark: LaneBenchmark,
  heroName: string,
  rankName: string | null,
): CoachFact | null {
  const souls = benchmark.stats.find((s) => s.stat === "souls");
  if (!souls || (souls.judgement !== "above" && souls.judgement !== "below")) return null;
  const yourSouls = roundAmount(souls.you);
  const typicalSouls = roundAmount(souls.avg);
  if (souls.judgement === "below" ? yourSouls >= typicalSouls : yourSouls <= typicalSouls) {
    return null;
  }
  return {
    id: "typical_souls",
    heroName,
    rankName,
    result: souls.judgement,
    yourSouls,
    typicalSouls,
    laneEnd: gameClock(LANE_END_S),
  };
}

function toCoachItem(item: Item): CoachItem {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    tier: item.tier,
    cost: item.cost,
  };
}

export function buildMatchCoachContext(input: MatchCoachInput): {
  context: CoachContext;
  knownItemNames: string[];
} {
  const { report } = input;
  const byNumericId = new Map(input.allItems.map((i) => [i.numericId, i]));
  const souls = report.you.atLaneEnd.souls;
  const facts = laneFacts(report, input.heroNames);
  const typical = input.benchmark
    ? typicalSoulsFact(input.benchmark.result, input.hero.name, input.benchmark.rankName)
    : null;
  if (typical) facts.push(typical);
  return {
    context: {
      playerMode: input.playerMode,
      hero: { ...input.hero, roles: heroRolesOf(input.hero.id) },
      souls,
      // The planner slider's numbering, as BuildClient passes it (BOON_THRESHOLDS − 1).
      boonLevel: getBoonThreshold(souls).boonLevel - 1,
      build: report.items
        .map((it) => byNumericId.get(it.numericId))
        .filter((i): i is Item => i !== undefined)
        .map(toCoachItem),
      facts,
      trigger: { type: "match_reviewed" },
    },
    knownItemNames: input.allItems.map((i) => i.name),
  };
}
