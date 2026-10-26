// lib/coach/sessionMemory.ts — the coach never repeats itself in a session
// (docs/milestone-m6.md §5, C5). Pure: memory in, memory out.

import type { CoachFact, CoachMemory } from "./coachTypes";

export const EMPTY_MEMORY: CoachMemory = { fired: [] };

/**
 * What makes two messages "the same insight": the insight plus what it was
 * about, so a second anti-synergy pair or a new next buy can still be said.
 */
export function insightKey(fact: CoachFact): string {
  switch (fact.id) {
    case "role_intro":
    case "empty_build":
    case "spike_reached":
    case "starter_explained":
      return `${fact.id}:${fact.heroName}`;
    case "first_in_category":
      return `${fact.id}:${fact.category}`;
    case "anti_synergy":
      return `${fact.id}:${[...fact.itemNames].sort().join("+")}`;
    case "next_buy_reason":
    case "gap_after_remove":
      return `${fact.id}:${fact.itemName}`;
    default:
      return fact.id;
  }
}

export function hasFired(memory: CoachMemory, key: string): boolean {
  return memory.fired.includes(key);
}

export function remember(memory: CoachMemory, key: string): CoachMemory {
  return hasFired(memory, key) ? memory : { fired: [...memory.fired, key] };
}
