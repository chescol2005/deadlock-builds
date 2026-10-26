// lib/coach/templates.ts — what the coach says (M6.2, templates first: user
// decision, docs/milestone-m6.md §7). One message per fact and audience.
//
// Rules (C6, enforced by responseValidator and Fixture 18):
// - only names and numbers present in the fact;
// - every warning carries what to do instead;
// - new players: plain English, no stat names, at most 60 words;
// - veterans: short, at most 40 words.

import { ROLE_LABELS, ROLE_PLANS } from "../heroRoles";
import type { CoachFact, PlayerMode } from "./coachTypes";

const CATEGORY_PLAIN: Readonly<Record<"gun" | "spirit" | "vitality", string>> = {
  gun: "Gun items make your bullets hit harder or fire faster.",
  spirit: "Spirit items make your abilities stronger: more damage, shorter cooldowns.",
  vitality: "Vitality items keep you alive: more health, healing and protection.",
};

const CATEGORY_NAME: Readonly<Record<"gun" | "spirit" | "vitality", string>> = {
  gun: "gun",
  spirit: "spirit",
  vitality: "vitality",
};

/** "A", "A and B", "A, B and C". */
export function listNames(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Souls as the planner shows them: 4,800. */
export function fmtSouls(souls: number): string {
  return Math.round(souls).toLocaleString("en-US");
}

/** "a carry" / "an off-carry". */
function aRole(label: string): string {
  return /^[aeiou]/i.test(label) ? `an ${label.toLowerCase()}` : `a ${label.toLowerCase()}`;
}

export function renderInsight(fact: CoachFact, mode: PlayerMode): string {
  const v = mode === "veteran";
  switch (fact.id) {
    case "role_intro":
      return `${fact.heroName} is ${aRole(ROLE_LABELS[fact.role])}. ${ROLE_PLANS[fact.role]}`;
    case "empty_build":
      return `Not sure where to start with ${fact.heroName}? The Suggested Starter Build panel has a complete plan with a reason for every item: press "Start from this build".`;
    case "first_in_category":
      return `${fact.itemName} is your first ${CATEGORY_NAME[fact.category]} item. ${CATEGORY_PLAIN[fact.category]}`;
    case "green_before_spike":
      return v
        ? `${fmtSouls(fact.vitalitySouls)} souls in vitality and no damage spike yet: buy a big damage item next.`
        : `You have plenty of defence now (${fmtSouls(fact.vitalitySouls)} souls in vitality). Make your next big purchase a damage item, so you can win the fights you survive.`;
    case "counter_stack":
      return v
        ? `${listNames(fact.counterItems)}: that's a lot of counters with no damage spike. Keep one and buy damage.`
        : `${listNames(fact.counterItems)} are counter items: each protects you from one kind of enemy threat. One is usually enough; put your next souls into damage instead.`;
    case "anti_synergy":
      return v
        ? `${fact.reason} Consider swapping one of them.`
        : `${fact.reason} If you want more of that effect, try a different item instead of the second one.`;
    case "next_buy_reason":
      return v
        ? `Next: ${fact.itemName}. ${fact.reason}`
        : `A good next buy is ${fact.itemName}. ${fact.reason}`;
    case "spike_reached":
      return `This is your power spike. As ${aRole(ROLE_LABELS[fact.role])}, ${fact.heroName} is strong enough now: start joining team fights instead of only farming.`;
    case "support_greed":
      return `Supports win fights with their abilities, not expensive items. ${listNames(fact.expensiveItems)} can wait: stay with your team and push lanes by clearing enemy troopers.`;
    case "no_sustain":
      return v
        ? `${fact.itemCount} items and no healing: consider one sustain item.`
        : `None of your ${fact.itemCount} items heal you. Add one healing item so you can stay in fights and lanes longer.`;
    case "gap_after_remove":
      return v
        ? `${fact.itemName} was your only ${CATEGORY_NAME[fact.category]} item: add one back if you still need it.`
        : `${fact.itemName} was your only ${CATEGORY_NAME[fact.category]} item, so your build has none now. Add one back if you still need it. ${CATEGORY_PLAIN[fact.category]}`;
    case "starter_explained":
      return `This build for ${fact.heroName} is split into early, mid and late. Buy each phase in order; the panel shows why each item is there.`;
  }
}
