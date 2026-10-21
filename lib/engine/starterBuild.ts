// lib/engine/starterBuild.ts — "Start from a suggested build" (Work 2).
//
// Runs the hero basket (runHeroBasket) at three fixed soul checkpoints, each
// phase owning everything the earlier phases picked, so the result is one
// phased build: early items, then what to add by mid game, then late game.
// Use cases and acceptance criteria: docs/starter-build-use-cases.md.
//
// PR 2c: owned items count toward coverage, and an upgrade of an earlier
// phase's component is priced at the difference and consumes it (it leaves the
// build, freeing its slot). The need-vector fix is a later PR; the fixtures'
// KNOWN_LEAN_GAPS list records what still falls short.
//
// Pure: same inputs, same output.

import type { Item, ItemPhase } from "../items";
import { BOON_THRESHOLDS } from "../boonSystem";
import { calculateStatTotals, combineStatTotal } from "../buildCalculations";
import { calculateStatsAtBoon } from "../heroStats";
import { runHeroBasket } from "./heroBasket";
import type { HeroBasketInputs } from "./heroBasket";
import type { BasketResult } from "./types";

/**
 * Phase checkpoints as planner boon-SLIDER indices (BuildClient's
 * `manualBoonLevel`, the probe's `--boon`), NOT `BOON_THRESHOLDS[i].boonLevel`,
 * which is the index + 1. The field is named `boonLevel` to match the planner.
 * Each phase's souls come
 * from BOON_THRESHOLDS rather than being restated here. Chosen from the live
 * mean net-worth curve (/v1/analytics/player-performance-curve, 2026-10-20,
 * all ranks): 5,900 souls ≈ 9–10 min (laning ends ~8 min, deadlock.wiki/Souls),
 * 16,700 ≈ 19–20 min, 30,000 ≈ 30 min. See docs/starter-build-use-cases.md §2.1.
 */
export const STARTER_PHASE_BOON_LEVELS: ReadonlyArray<{ phase: ItemPhase; boonLevel: number }> = [
  { phase: "early", boonLevel: 10 },
  { phase: "mid", boonLevel: 22 },
  { phase: "late", boonLevel: 29 },
];

export type StarterBuildInputs = Omit<
  HeroBasketInputs,
  "ownedItems" | "souls" | "boonLevel" | "spiritPower"
> & {
  /** Items the player already has; kept, never re-suggested, and committed first. */
  ownedItems: ReadonlyArray<Item>;
};

export interface StarterPhase {
  phase: ItemPhase;
  boonLevel: number;
  /** Cumulative souls at this checkpoint. */
  souls: number;
  /** Items this phase adds, in pick order. */
  items: ReadonlyArray<Item>;
  /** Earlier items this phase's upgrades consumed (they leave the build). */
  consumed: ReadonlyArray<Item>;
  /** The basket run behind this phase: per-pick reasons, coverage, stop reason. */
  basket: BasketResult;
}

export interface StarterBuild {
  ownedItems: ReadonlyArray<Item>;
  phases: ReadonlyArray<StarterPhase>;
}

/** Spirit power from the hero's base at this boon plus every owned item. */
function spiritPowerAt(input: StarterBuildInputs, owned: ReadonlyArray<Item>, boonLevel: number) {
  const totals = calculateStatTotals([...owned]);
  return combineStatTotal(
    calculateStatsAtBoon(input.heroBaseStats, boonLevel).spiritPower,
    totals.spiritPowerFlat,
    totals.spiritPowerPercent,
  );
}

/** Null when the hero kit or item list is missing (same rule as runHeroBasket). */
export function buildStarterBuild(input: StarterBuildInputs): StarterBuild | null {
  const itemsById = new Map(input.allItems.map((i) => [i.id, i]));
  let owned: ReadonlyArray<Item> = input.ownedItems;
  const phases: StarterPhase[] = [];

  for (const { phase, boonLevel } of STARTER_PHASE_BOON_LEVELS) {
    const threshold = BOON_THRESHOLDS[boonLevel];
    if (!threshold) throw new Error(`starterBuild: no BOON_THRESHOLDS entry at ${boonLevel}`);
    const souls = threshold.souls;
    const run = runHeroBasket({
      ...input,
      ownedItems: owned,
      souls,
      boonLevel,
      spiritPower: spiritPowerAt(input, owned, boonLevel),
    });
    if (!run) return null;

    // Picks come from candidates built from allItems, so every id resolves. If one
    // ever didn't, items and picks would disagree and the next phase's budget would
    // be wrong without any signal, so fail loudly instead.
    const items = run.basket.picks.map((p) => {
      const item = itemsById.get(p.item.itemId);
      if (!item) throw new Error(`starterBuild: pick ${p.item.itemId} is not in allItems`);
      return item;
    });
    // Upgrades consume their held components (the planner's resolveAddItem does
    // the same), so those leave the build before the next phase.
    const consumedIds = new Set(run.basket.picks.flatMap((p) => [...p.consumes]));
    const consumed = owned.filter((i) => consumedIds.has(i.id));
    phases.push({ phase, boonLevel, souls, items, consumed, basket: run.basket });
    owned = [...owned.filter((i) => !consumedIds.has(i.id)), ...items];
  }

  return { ownedItems: input.ownedItems, phases };
}
