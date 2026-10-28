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

/** "an enemy" at the start of a sentence. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "9:00" -> "9": the minute of a game clock the fact carries. */
function minutes(clock: string): string {
  return clock.split(":")[0];
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
    case "lane_deaths": {
      const gank = fact.gankers.length > 0;
      if (v) {
        const by = gank ? `, ganked by ${listNames(fact.gankers)}` : "";
        return `${fact.count} deaths before ${fact.laneEnd} (${fact.deathTimes.join(", ")})${by}. Respect missing enemies and trade near your Guardian.`;
      }
      const advice = gank
        ? `${capitalise(listNames(fact.gankers))} came from another lane to catch you: when an enemy goes missing from the map, play closer to your tower.`
        : "Back off when your health is low and fight near your own tower.";
      return `You died ${fact.count} times before ${minutes(fact.laneEnd)} minutes (${listNames(fact.deathTimes)}). Each death gives your lane opponents free souls and time. ${advice}`;
    }
    case "fell_behind_early":
      if (v) {
        return fact.recovered
          ? `${fmtSouls(fact.soulsBehind)} souls behind at ${fact.checkTime}, recovered by ${fact.laneEnd}. Keep that up.`
          : `${fmtSouls(fact.soulsBehind)} souls behind at ${fact.checkTime}, still behind at ${fact.laneEnd}. Focus last hits and orb denies in the first waves.`;
      }
      return fact.recovered
        ? `By ${minutes(fact.checkTime)} minutes you were ${fmtSouls(fact.soulsBehind)} souls behind your lane opponents, but you caught up by ${minutes(fact.laneEnd)} minutes. Keep that up.`
        : `By ${minutes(fact.checkTime)} minutes you were ${fmtSouls(fact.soulsBehind)} souls behind your lane opponents. Early souls come from troopers: take the last shot on each one, then shoot the soul orb before the enemy does.`;
    case "lost_trades":
      return v
        ? `Lost trades: ${fmtSouls(fact.dealt)} dealt, ${fmtSouls(fact.taken)} taken by ${fact.laneEnd}. Fight on your cooldowns, not theirs.`
        : `Your lane opponents hurt you more than you hurt them: you took ${fmtSouls(fact.taken)} damage and dealt ${fmtSouls(fact.dealt)}. Fight when your abilities are ready, and step back behind your troopers in between.`;
    case "missed_last_hits":
      return v
        ? `Last hits ${fact.yourShare}% against ${fact.opponentShare}% for your opponents. Secure your orbs and deny theirs.`
        : `You got the last hit on ${fact.yourShare}% of the troopers you could, your opponents ${fact.opponentShare}%. The last hit pays the souls, so save your shot for when a trooper is almost dead.`;
    case "lane_result":
      if (v) {
        if (fact.result === "even") {
          return `Even at ${fact.laneEnd} (within ${fmtSouls(fact.soulGap)} souls).`;
        }
        return fact.result === "ahead"
          ? `${fmtSouls(fact.soulGap)} ahead at ${fact.laneEnd}.`
          : `${fmtSouls(fact.soulGap)} souls behind the opponent average at ${fact.laneEnd}. Farm safe camps until your next item.`;
      }
      if (fact.result === "even") {
        return `At ${minutes(fact.laneEnd)} minutes you were level with your lane opponents. Small edges win lanes: a few more last hits and one fewer death.`;
      }
      return fact.result === "ahead"
        ? `At ${minutes(fact.laneEnd)} minutes you were ${fmtSouls(fact.soulGap)} souls ahead of your lane opponents. Use the lead: buy your next item and help a nearby lane.`
        : `At ${minutes(fact.laneEnd)} minutes you were ${fmtSouls(fact.soulGap)} souls behind your lane opponents. You can recover: farm the camps on your side of the map and avoid risky fights until your next item.`;
    case "strong_lane":
      return v
        ? `Clean lane: ${fmtSouls(fact.soulGap)} souls up at ${fact.laneEnd}, no deaths. Push and take the Guardian.`
        : `Strong lane: ${fmtSouls(fact.soulGap)} souls ahead at ${minutes(fact.laneEnd)} minutes and no deaths. Keep the pressure on by pushing your wave toward the enemy Guardian.`;
  }
}
