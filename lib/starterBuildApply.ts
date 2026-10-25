// lib/starterBuildApply.ts — turns a StarterBuild (lib/engine/starterBuild.ts)
// into planner state: the item list plus each item's phase / active flags.
// "Start from a suggested build" (Work 2d, docs/starter-build-use-cases.md UC1–UC5).
//
// Pure: same inputs, same output. Nothing here scores items; the engine already
// chose them. The result is an ordinary build, so the share link reproduces it
// with no new URL format (UC5).

import type { AssignmentData, Item } from "./items";
import { MAX_ACTIVE_ITEMS } from "./buildUtils";
import type { StarterBuild } from "./engine/starterBuild";
import { STARTER_PHASE_BOON_LEVELS } from "./engine/starterBuild";

export interface AppliedStarterBuild {
  items: Item[];
  /** Assignment per item id in `items`; nothing else. */
  assignments: Map<string, AssignmentData>;
  /** Boon slider index of the last phase, so the planner's souls match the build. */
  boonLevel: number;
}

const UNASSIGNED: AssignmentData = {
  phase: null,
  active: false,
  sellPriority: false,
  optional: false,
};

/**
 * Owned items keep their place and flags (UC2), except a component an upgrade
 * consumes: it is traded in, exactly as resolveAddItem does when the player
 * buys the upgrade. Each phase's items follow in buy order, assigned to that
 * phase. Early items are active (UC1), and an upgrade first takes over the active
 * slot of a component it consumes, as in game. Activation never passes
 * MAX_ACTIVE_ITEMS; later items wait in the game plan.
 */
export function applyStarterBuild(
  build: StarterBuild,
  ownedAssignments: ReadonlyMap<string, AssignmentData>,
): AppliedStarterBuild {
  let items: Item[] = [...build.ownedItems];
  const assignments = new Map<string, AssignmentData>();
  for (const item of items) {
    assignments.set(item.id, { ...(ownedAssignments.get(item.id) ?? UNASSIGNED) });
  }
  const activeCount = () => [...assignments.values()].filter((a) => a.active).length;

  for (const phase of build.phases) {
    const consumedIds = new Set(phase.consumed.map((i) => i.id));
    const consumedActive = new Set(
      [...consumedIds].filter((id) => assignments.get(id)?.active === true),
    );
    // Every slot this phase trades in is freed before any item claims one.
    items = items.filter((i) => !consumedIds.has(i.id));
    for (const id of consumedIds) assignments.delete(id);

    for (const item of phase.buyOrder) {
      items.push(item);
      assignments.set(item.id, { ...UNASSIGNED, phase: phase.phase });
    }
    // Upgrades take over their traded-in component's slot first; early items
    // then fill the free slots in buy order.
    const inherits = (item: Item) =>
      (item.componentItems ?? []).some((id) => consumedActive.has(id));
    const claimOrder = [
      ...phase.buyOrder.filter(inherits),
      ...phase.buyOrder.filter((item) => !inherits(item)),
    ];
    for (const item of claimOrder) {
      if (!inherits(item) && phase.phase !== "early") continue;
      if (activeCount() >= MAX_ACTIVE_ITEMS) break;
      assignments.set(item.id, { ...UNASSIGNED, phase: phase.phase, active: true });
    }
  }

  const last = build.phases[build.phases.length - 1];
  return {
    items,
    assignments,
    boonLevel:
      last?.boonLevel ?? STARTER_PHASE_BOON_LEVELS[STARTER_PHASE_BOON_LEVELS.length - 1].boonLevel,
  };
}

/**
 * Items currently in the build that applying would remove: owned components an
 * upgrade trades in. Nothing else is ever removed or changed (UC2), so this is
 * exactly what the player confirms before applying (UC3); empty means applying
 * only adds.
 */
export function itemsRemovedByApply(
  current: ReadonlyArray<Item>,
  applied: AppliedStarterBuild,
): Item[] {
  const kept = new Set(applied.items.map((i) => i.id));
  return current.filter((i) => !kept.has(i.id));
}

/** True when the build already is `applied`: same items in order, same flags. */
export function isAppliedBuild(
  current: ReadonlyArray<Item>,
  currentAssignments: ReadonlyMap<string, AssignmentData>,
  applied: AppliedStarterBuild,
): boolean {
  if (current.length !== applied.items.length) return false;
  return current.every((item, i) => {
    if (applied.items[i]?.id !== item.id) return false;
    const a = currentAssignments.get(item.id) ?? UNASSIGNED;
    const b = applied.assignments.get(item.id) ?? UNASSIGNED;
    return (
      a.phase === b.phase &&
      a.active === b.active &&
      a.sellPriority === b.sellPriority &&
      a.optional === b.optional
    );
  });
}
