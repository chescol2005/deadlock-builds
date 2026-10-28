// lib/coach/triggerRules.ts — whether the coach speaks, and about what
// (docs/milestone-m6.md §5). Deterministic: the same context and memory always
// give the same choice. At most one insight per build action; a match review shows
// up to MATCH_REVIEW_MAX_MESSAGES.

import type {
  CoachContext,
  CoachFact,
  CoachMemory,
  CoachTrigger,
  InsightId,
  PlayerMode,
} from "./coachTypes";
import { hasFired, insightKey } from "./sessionMemory";

interface InsightRule {
  /** Triggers this insight may answer. */
  triggers: ReadonlyArray<CoachTrigger["type"]>;
  /** Audiences that hear it. Veterans only get what they'd likely miss. */
  modes: ReadonlyArray<PlayerMode>;
}

const BOTH: ReadonlyArray<PlayerMode> = ["new", "veteran"];
const NEW: ReadonlyArray<PlayerMode> = ["new"];

export const INSIGHT_RULES: Readonly<Record<InsightId, InsightRule>> = {
  role_intro: { triggers: ["hero_selected"], modes: NEW },
  empty_build: { triggers: ["hero_selected", "build_reviewed"], modes: NEW },
  first_in_category: { triggers: ["item_added"], modes: NEW },
  green_before_spike: { triggers: ["item_added", "build_reviewed"], modes: BOTH },
  counter_stack: { triggers: ["item_added", "build_reviewed"], modes: BOTH },
  anti_synergy: { triggers: ["item_added", "build_reviewed"], modes: BOTH },
  // Veterans: only when they ask for a review; never on every item add (the
  // skill's "noise kills trust").
  next_buy_reason: { triggers: ["item_added", "build_reviewed"], modes: BOTH },
  spike_reached: { triggers: ["item_added"], modes: NEW },
  support_greed: { triggers: ["item_added", "build_reviewed"], modes: NEW },
  no_sustain: { triggers: ["item_added", "build_reviewed"], modes: BOTH },
  gap_after_remove: { triggers: ["item_removed"], modes: BOTH },
  starter_explained: { triggers: ["starter_applied"], modes: NEW },
  lane_deaths: { triggers: ["match_reviewed"], modes: BOTH },
  fell_behind_early: { triggers: ["match_reviewed"], modes: BOTH },
  lost_trades: { triggers: ["match_reviewed"], modes: BOTH },
  missed_last_hits: { triggers: ["match_reviewed"], modes: BOTH },
  lane_result: { triggers: ["match_reviewed"], modes: BOTH },
  strong_lane: { triggers: ["match_reviewed"], modes: BOTH },
};

/** A match review shows at most this many messages (docs/match-review-use-cases.md §6). */
export const MATCH_REVIEW_MAX_MESSAGES = 2;

/**
 * When several insights apply, the most urgent speaks: a mistake to undo, then
 * a gap, then a spending warning, then encouragement, then teaching.
 */
export const INSIGHT_PRIORITY: ReadonlyArray<InsightId> = [
  "anti_synergy",
  "gap_after_remove",
  "green_before_spike",
  "counter_stack",
  "support_greed",
  "no_sustain",
  "spike_reached",
  "role_intro",
  "starter_explained",
  "empty_build",
  "first_in_category",
  "next_buy_reason",
  // Match review: causes before the summary, which the page already shows
  // (approved order, MR2).
  "lane_deaths",
  "fell_behind_early",
  "lost_trades",
  "missed_last_hits",
  "lane_result",
  "strong_lane",
];

function allowed(fact: CoachFact, ctx: CoachContext): boolean {
  const rule = INSIGHT_RULES[fact.id];
  if (!rule.triggers.includes(ctx.trigger.type) || !rule.modes.includes(ctx.playerMode)) {
    return false;
  }
  if (fact.id === "next_buy_reason" && ctx.playerMode === "veteran") {
    return ctx.trigger.type === "build_reviewed";
  }
  // The intro covers an empty build on hero select; the empty-build nudge is for
  // a hero with no known role, or when the player asks for a review.
  if (fact.id === "empty_build" && ctx.trigger.type === "hero_selected") {
    return ctx.hero.roles.length === 0;
  }
  return true;
}

/**
 * Every fact the coach may speak about now, most urgent first (ties broken by
 * subject, so the order is total). The caller speaks the first one whose
 * message is valid.
 */
export function coachCandidates(ctx: CoachContext, memory: CoachMemory): CoachFact[] {
  return ctx.facts
    .filter((f) => allowed(f, ctx) && !hasFired(memory, insightKey(f)))
    .sort(
      (a, b) =>
        INSIGHT_PRIORITY.indexOf(a.id) - INSIGHT_PRIORITY.indexOf(b.id) ||
        insightKey(a).localeCompare(insightKey(b)),
    );
}

/** The one fact to speak about now, or null for silence. */
export function shouldFireCoach(ctx: CoachContext, memory: CoachMemory): CoachFact | null {
  return coachCandidates(ctx, memory)[0] ?? null;
}
