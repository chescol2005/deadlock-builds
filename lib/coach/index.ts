// lib/coach/ — the build coach (Milestone M6, docs/milestone-m6.md).
//
// Pure and isolated: it reads a CoachContext of plain facts and returns one
// message or silence. It imports nothing from lib/engine, lib/scoring or app
// state (Fixture 18, C1); lib/coachContext.ts builds the facts.

import type { CoachContext, CoachMemory, CoachMessage } from "./coachTypes";
import { validateCoachResponse } from "./responseValidator";
import { insightKey, remember } from "./sessionMemory";
import { renderInsight } from "./templates";
import { coachCandidates } from "./triggerRules";

export type * from "./coachTypes";
export { EMPTY_MEMORY } from "./sessionMemory";

/**
 * The coach's response to this action: at most one message, and the memory to
 * carry forward. A message that fails validation is never shown; the next
 * candidate speaks instead, so one bad fact can't silence the coach.
 * `knownItemNames` (the shop catalogue) is required: without it the validator
 * can't catch an item the fact doesn't carry.
 */
export function getCoachMessage(
  ctx: CoachContext,
  memory: CoachMemory,
  knownItemNames: ReadonlyArray<string>,
): { message: CoachMessage | null; memory: CoachMemory } {
  for (const fact of coachCandidates(ctx, memory)) {
    const text = renderInsight(fact, ctx.playerMode);
    if (validateCoachResponse(text, fact, ctx.playerMode, knownItemNames).ok) {
      const key = insightKey(fact);
      return { message: { insight: fact.id, key, text }, memory: remember(memory, key) };
    }
  }
  return { message: null, memory };
}
