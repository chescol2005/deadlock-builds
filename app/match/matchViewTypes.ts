// app/match/matchViewTypes.ts — the props the match review panels receive. Computed
// in MatchReviewClient; the panels are presentational (docs/match-review-use-cases.md).

import type { ItemCategory } from "@/lib/items";

export interface MatchHeroInfo {
  id: number;
  name: string;
  /** Small hero icon URL, or null when the API has none. */
  icon: string | null;
}

/** One lane of the loaded match: its two heroes on each team. */
export interface LaneGroup {
  /** `assigned_lane`: 1, 4 or 6. */
  lane: number;
  /** "York", "Broadway", "Greenwich"; the number as text if unknown. */
  laneName: string;
  /** [team 0 heroes, team 1 heroes], each sorted by player slot. */
  teams: [MatchHeroInfo[], MatchHeroInfo[]];
}

/** An item the reviewed player held at lane end. */
export interface LaneItemView {
  id: string;
  name: string;
  cost: number;
  category: ItemCategory;
  icon?: string;
  /** Purchase time as game clock, e.g. "3:12". */
  boughtAt: string;
}

export interface CoachLine {
  insight: string;
  text: string;
}

/** One of the player's recent normal matches, ready to show. */
export interface RecentMatchView {
  matchId: number;
  hero: MatchHeroInfo;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  /** Match length as a clock, e.g. "34:12". */
  duration: string;
  /** When it was played, e.g. "Oct 27, 21:40" (the viewer's time zone). */
  playedAt: string;
}
