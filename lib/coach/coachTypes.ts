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
  | { type: "build_reviewed" };

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
  | { id: "starter_explained"; heroName: string };

export type InsightId = CoachFact["id"];

export interface CoachContext {
  playerMode: PlayerMode;
  hero: { id: number; name: string; complexity: number; roles: ReadonlyArray<HeroRole> };
  souls: number;
  boonLevel: number;
  build: ReadonlyArray<CoachItem>;
  /** Every fact true of the build right now; the coach picks at most one. */
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
