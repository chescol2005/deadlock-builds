// lib/coachContext.ts — turns what BuildClient already computed into the plain
// facts the coach speaks from (Milestone M6.3, docs/milestone-m6.md §2, §5).
//
// The ONE bridge between the build and lib/coach/: it may read engine outputs
// (the basket's reasons, an item's hero-agnostic values) and the anti-synergy
// rules; the coach itself never does (Fixture 18, C1). Pure: same input, same
// facts. Every fact is true of the build right now; the coach picks at most one.

import type { Item } from "./items";
import type { BasketResult } from "./engine/types";
import { toItemCandidate } from "./engine/itemAdapter";
import { MID_PHASE_MAX_SOULS } from "./engine/categorySplit";
import { headlineTerm, POPULATION_TERMS } from "./basketReasons";
import { detectAntiSynergies } from "./scoring/antiSynergy";
import { CATEGORY_BONUS_TIERS } from "./categoryBonuses";
import { heroOnlineAtSouls, heroRolesOf } from "./heroRoles";
import type { CoachContext, CoachFact, CoachItem, CoachTrigger, PlayerMode } from "./coach";

/**
 * The shop's 3,200-soul counter items: each defends against one kind of enemy
 * threat (a reactable spell, debuffs, bullets, spirit). High-level advice
 * (docs/milestone-m6.md §9, counter items): one is usually enough before your
 * big damage item. data-verifier confirmed ids, costs and that no other live
 * 3,200-soul item is this kind of counter, 2026-10-25.
 */
export const MID_GAME_COUNTERS: ReadonlySet<string> = new Set([
  "upgrade_counterspell", // Counterspell
  "upgrade_reduce_debuff_duration", // Dispel Magic
  "upgrade_metal_skin", // Metal Skin
  "upgrade_tech_purge", // Spirit Resilience
  "upgrade_improved_bullet_armor", // Bullet Resilience
]);

/** A "big" item: the 6,400-soul tier (power spikes, support greed). */
export const BIG_ITEM_COST = 6400;

/**
 * Vitality souls after which more defence should wait for damage: the
 * significant investment tier (4,800, CATEGORY_BONUS_TIERS), which is also the
 * "~4.8k in greens, then your power spike" rule from high-level play.
 */
export const VITALITY_ENOUGH_SOULS =
  CATEGORY_BONUS_TIERS.find((t) => t.isSignificant)?.soulsThreshold ?? 4800;

/** Builds of this size with no healing get the no-sustain tip (C7). */
export const NO_SUSTAIN_ITEMS = 8;

export interface CoachContextInput {
  playerMode: PlayerMode;
  hero: { id: number; name: string; complexity: number };
  /** Cumulative souls (boon slider); passed through to the coach. Game phase is
   * judged from the build's own item souls. */
  souls: number;
  boonLevel: number;
  /** The planner's items AFTER the action (an upgrade has replaced its component). */
  build: ReadonlyArray<Item>;
  /** The hero basket BuildClient shows; null when there is none. */
  basket: BasketResult | null;
  /** Whether the Suggested Starter Build panel has a build for this hero. */
  hasStarterBuild: boolean;
  trigger: CoachTrigger;
  /** Every shop item: names for the validator, and the removed item's details. */
  allItems: ReadonlyArray<Item>;
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

const soulsIn = (items: ReadonlyArray<Item>) => items.reduce((s, i) => s + i.cost, 0);
const byName = (a: string, b: string) => a.localeCompare(b);

export function buildCoachContext(input: CoachContextInput): {
  context: CoachContext;
  knownItemNames: string[];
} {
  const { build, trigger } = input;
  const roles = heroRolesOf(input.hero.id);
  const primary = roles[0];
  const facts: CoachFact[] = [];
  const byId = new Map(input.allItems.map((i) => [i.id, i]));

  // The engine's hero-agnostic values, once per item: does it add damage / heal?
  const valueCache = new Map<string, { damage: boolean; heals: boolean }>();
  const valuesOf = (item: Item) => {
    let v = valueCache.get(item.id);
    if (!v) {
      const c = toItemCandidate(item).categoryValues;
      v = { damage: c.gunDamage + c.spiritDamage > 0, heals: c.sustain > 0 };
      valueCache.set(item.id, v);
    }
    return v;
  };
  /** A 6,400+ gun or spirit item that adds damage (not a defensive spirit item). */
  const isDamageSpike = (item: Item) =>
    item.category !== "vitality" && item.cost >= BIG_ITEM_COST && valuesOf(item).damage;
  const hasSpike = build.some(isDamageSpike);

  // The item just added, if it is really in the build, and the build before it:
  // the planner replaced its direct components (buildUtils.resolveAddItem), so
  // they are put back. (A deeper owned ancestor stays in the build, as in the
  // planner, and is counted alongside the upgrade.)
  const added =
    trigger.type === "item_added" && build.some((i) => i.id === trigger.itemId)
      ? byId.get(trigger.itemId)
      : undefined;
  const before: Item[] = added
    ? [
        ...build.filter((i) => i.id !== added.id),
        ...(added.componentItems ?? [])
          .filter((id) => !build.some((i) => i.id === id))
          .flatMap((id) => {
            const c = byId.get(id);
            return c ? [c] : [];
          }),
      ]
    : [...build];

  if (primary) facts.push({ id: "role_intro", heroName: input.hero.name, role: primary });
  if (build.length === 0 && input.hasStarterBuild) {
    facts.push({ id: "empty_build", heroName: input.hero.name });
  }
  if (added && !before.some((i) => i.category === added.category)) {
    facts.push({ id: "first_in_category", category: added.category, itemName: added.name });
  }

  const vitalitySouls = soulsIn(build.filter((i) => i.category === "vitality"));
  if (!roles.includes("tank") && vitalitySouls >= VITALITY_ENOUGH_SOULS && !hasSpike) {
    facts.push({ id: "green_before_spike", vitalitySouls });
  }
  const counters = build.filter((i) => MID_GAME_COUNTERS.has(i.id));
  if (counters.length >= 2 && !hasSpike) {
    facts.push({ id: "counter_stack", counterItems: counters.map((i) => i.name).sort(byName) });
  }
  for (const w of detectAntiSynergies([...build])) {
    facts.push({
      id: "anti_synergy",
      itemNames: [
        byId.get(w.itemIds[0])?.name ?? w.itemIds[0],
        byId.get(w.itemIds[1])?.name ?? w.itemIds[1],
      ],
      reason: w.reason,
    });
  }

  // Next buy: only the engine's plain-English line for the pick's own reason,
  // never a raw term reason and never "other players buy it" (population data).
  const top = input.basket?.picks[0];
  const headline = top ? headlineTerm(top.terms) : null;
  if (top && headline?.plain && !POPULATION_TERMS.has(headline.termId)) {
    facts.push({ id: "next_buy_reason", itemName: top.item.name, reason: headline.plain });
  }

  // Where the build is in the game: souls in its items (the same measure for the
  // power spike and support greed; the boon slider can sit anywhere).
  const buildSouls = soulsIn(build);

  // Power spike: this item crossed the role's online-at souls, or is the first
  // big damage item ever held.
  const onlineAt = heroOnlineAtSouls(input.hero.id);
  if (added && (primary === "carry" || primary === "offCarry") && onlineAt !== undefined) {
    const crossed = soulsIn(before) < onlineAt && buildSouls >= onlineAt;
    const firstSpike = isDamageSpike(added) && !before.some(isDamageSpike);
    if (crossed || firstSpike) {
      facts.push({ id: "spike_reached", heroName: input.hero.name, role: primary });
    }
  }

  const big = build.filter((i) => i.cost >= BIG_ITEM_COST);
  if (primary === "support" && big.length >= 2 && buildSouls <= MID_PHASE_MAX_SOULS) {
    facts.push({ id: "support_greed", expensiveItems: big.map((i) => i.name).sort(byName) });
  }
  if (build.length >= NO_SUSTAIN_ITEMS && !build.some((i) => valuesOf(i).heals)) {
    facts.push({ id: "no_sustain", itemCount: build.length });
  }
  if (trigger.type === "item_removed") {
    const removed = byId.get(trigger.itemId);
    if (removed && !build.some((i) => i.category === removed.category)) {
      facts.push({ id: "gap_after_remove", itemName: removed.name, category: removed.category });
    }
  }
  if (trigger.type === "starter_applied") {
    facts.push({ id: "starter_explained", heroName: input.hero.name });
  }

  return {
    context: {
      playerMode: input.playerMode,
      hero: { ...input.hero, roles },
      souls: input.souls,
      boonLevel: input.boonLevel,
      build: build.map(toCoachItem),
      facts,
      trigger,
    },
    knownItemNames: input.allItems.map((i) => i.name),
  };
}
