// lib/coach/coachTypes.ts — the coach's input: plain facts, never build state
// (Milestone M6.2, docs/milestone-m6.md §3).
//
// The coach decides whether to speak and words what it says from these facts
// alone. It imports nothing from lib/engine, lib/scoring or app state (Fixture
// 18); lib/coachContext.ts (M6.3) builds the facts from what BuildClient already
// computed. Each fact carries exactly the names and numbers its message may use.

import type { HeroRole } from "../heroRoles";

export type PlayerMode = "new" | "veteran";
export type ShopCategory = "gun" | "spirit" | "vitality";

export interface CoachItem {
  id: string;
  name: string;
  category: ShopCategory;
  tier: number;
  cost: number;
}

export type CoachTrigger =
  | { type: "hero_selected" }
  | { type: "item_added"; itemId: string }
  | { type: "item_removed"; itemId: string }
  | { type: "starter_applied" }
  | { type: "build_reviewed" }
  /** A lane report loaded on the match review page (docs/match-review-use-cases.md §6). */
  | { type: "match_reviewed" };

export type LaneResult = "ahead" | "even" | "behind";

export type CoachFact =
  | { id: "role_intro"; heroName: string; role: HeroRole }
  /** Emitted only when this hero HAS a suggested starter build (the copy points at it). */
  | { id: "empty_build"; heroName: string }
  | { id: "first_in_category"; category: ShopCategory; itemName: string }
  /** Not a tank, 4,800+ souls in vitality, no 6,400-soul damage item yet. */
  | { id: "green_before_spike"; vitalitySouls: number }
  /** Two or more mid-game counter items and no big damage item. */
  | { id: "counter_stack"; counterItems: ReadonlyArray<string> }
  | { id: "anti_synergy"; itemNames: readonly [string, string]; reason: string }
  /**
   * The basket's top pick and its reason: a full plain-English sentence
   * (MarginalTerm.plain), never a raw term reason with engine numbers.
   */
  | { id: "next_buy_reason"; itemName: string; reason: string }
  | { id: "spike_reached"; heroName: string; role: HeroRole }
  | { id: "support_greed"; expensiveItems: ReadonlyArray<string> }
  /** The skill's "no healing after 8 items" scenario (C7). */
  | { id: "no_sustain"; itemCount: number }
  /** A removal left a category empty. */
  | { id: "gap_after_remove"; itemName: string; category: ShopCategory }
  | { id: "starter_explained"; heroName: string }
  // Match review lane insights (MR2). Times are carried as the text the message
  // shows ("5:31", "9:00"), souls and damage rounded to 50, shares in whole percents.
  /**
   * Two or more deaths before lane end; gankers are enemies from other lanes, by
   * hero name ("an enemy" when the name is unknown, so a gank is never dropped).
   */
  | {
      id: "lane_deaths";
      count: number;
      deathTimes: ReadonlyArray<string>;
      gankers: ReadonlyArray<string>;
      laneEnd: string;
    }
  /** Behind the opponent average at 6:00; recovered = not behind at lane end. */
  | {
      id: "fell_behind_early";
      soulsBehind: number;
      recovered: boolean;
      checkTime: string;
      laneEnd: string;
    }
  | { id: "lost_trades"; dealt: number; taken: number; laneEnd: string }
  | { id: "missed_last_hits"; yourShare: number; opponentShare: number }
  /** Your souls against the opponent average at lane end; never with strong_lane. */
  | { id: "lane_result"; result: LaneResult; soulGap: number; laneEnd: string }
  /** Ahead at lane end with no deaths. */
  | { id: "strong_lane"; soulGap: number; laneEnd: string }
  /**
   * Your souls at lane end against a typical player on your hero (match review §10.5),
   * only when above or below typical. Souls rounded to 50; rankName null = all ranks.
   */
  | {
      id: "typical_souls";
      heroName: string;
      rankName: string | null;
      result: "above" | "below";
      yourSouls: number;
      typicalSouls: number;
      laneEnd: string;
    };

export type InsightId = CoachFact["id"];

export interface CoachContext {
  playerMode: PlayerMode;
  hero: { id: number; name: string; complexity: number; roles: ReadonlyArray<HeroRole> };
  souls: number;
  boonLevel: number;
  build: ReadonlyArray<CoachItem>;
  /**
   * Every fact true right now. The build coach says at most one per action; a match
   * review shows up to MATCH_REVIEW_MAX_MESSAGES (getCoachMessages).
   */
  facts: ReadonlyArray<CoachFact>;
  trigger: CoachTrigger;
}

/** What the coach has already said this session (never repeated). */
export interface CoachMemory {
  fired: ReadonlyArray<string>;
}

export interface CoachMessage {
  insight: InsightId;
  /** Session-memory key: the insight plus what it was about. */
  key: string;
  text: string;
}
