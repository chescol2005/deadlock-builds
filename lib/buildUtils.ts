import type { AssignmentData, BuildCategory, Item } from "./items";

export const MAX_ACTIVE_ITEMS = 12;

// Returns a map of consumed component IDs → the names of every build item that
// consumed them. A component is consumed when it appears in a build item's
// componentItems but is not itself directly present in the build. More than one
// build item can share the same component (branching upgrade chains), so each
// owning item's name is accumulated rather than overwriting the previous one.
export function getConsumedComponents(currentBuild: Item[]): Map<string, string[]> {
  const buildIds = new Set(currentBuild.map((i) => i.id));
  const consumed = new Map<string, string[]>();

  for (const item of currentBuild) {
    for (const componentId of item.componentItems ?? []) {
      if (!buildIds.has(componentId)) {
        consumed.set(componentId, [...(consumed.get(componentId) ?? []), item.name]);
      }
    }
  }

  return consumed;
}

// Returns the effective purchase cost of an item given the current build.
// Components already present in the build are treated as a discount (they will be
// consumed on purchase). Partial component sets receive proportional discounts.
// Always returns at least 0.
export function getEffectiveAddCost(item: Item, currentBuild: Item[], allItems: Item[]): number {
  if (!item.componentItems || item.componentItems.length === 0) return item.cost;

  const buildIds = new Set(currentBuild.map((i) => i.id));
  const allById = new Map(allItems.map((i) => [i.id, i]));

  let discount = 0;
  for (const componentId of item.componentItems) {
    if (buildIds.has(componentId)) {
      const component = allById.get(componentId);
      if (component) discount += component.cost;
    }
  }

  return Math.max(0, item.cost - discount);
}

// Adds newItem to the build, removing any of its componentItems that are currently
// present. Components not in the build are simply absent — they do not block the add.
// If newItem is already present in currentBuild, the build is returned unchanged —
// callers must not be able to double-add the same item by calling this directly.
export function resolveAddItem(currentBuild: Item[], newItem: Item): Item[] {
  if (currentBuild.some((it) => it.id === newItem.id)) return currentBuild;
  const componentSet = new Set(newItem.componentItems ?? []);
  const withoutConsumed = currentBuild.filter((it) => !componentSet.has(it.id));
  return [...withoutConsumed, newItem];
}

// Filters a category's itemIds down to ids still present in the build. Categories
// are hand-edited state (rename/reorder/delete), so this derivation is what keeps
// them from referencing items removed elsewhere (e.g. via upgrade-chain resolution).
export function cleanCategories(categories: BuildCategory[], buildItems: Item[]): BuildCategory[] {
  const buildIds = new Set(buildItems.map((i) => i.id));
  return categories.map((cat) => ({
    ...cat,
    itemIds: cat.itemIds.filter((id) => buildIds.has(id)),
  }));
}

// Filters an assignment map down to entries for items still present in the build.
// Assignment flags (phase/active/sell/optional) are set per-itemId independently of
// buildItems, so removals elsewhere (resolveAddItem dropping a consumed component,
// a future add flow) can leave stale entries behind unless every write path
// remembers to prune them. Deriving the "clean" view here removes that requirement —
// stale entries simply can't affect active-count, share links, or rendering.
export function cleanAssignmentMap(
  assignmentMap: Map<string, AssignmentData>,
  buildItems: Item[],
): Map<string, AssignmentData> {
  const buildIds = new Set(buildItems.map((i) => i.id));
  const next = new Map<string, AssignmentData>();
  for (const [id, data] of assignmentMap) {
    if (buildIds.has(id)) next.set(id, data);
  }
  return next;
}

export type ActiveToggleResult = { allowed: boolean; reason?: string };

// Whether an item can be toggled into the active build (12-slot cap; optional items
// are never active). Pure so it can be unit-tested without touching component state.
export function canActivateItem(activeCount: number, isOptional: boolean): ActiveToggleResult {
  if (isOptional) return { allowed: false, reason: "Optional items cannot be active" };
  if (activeCount >= MAX_ACTIVE_ITEMS) {
    return { allowed: false, reason: "Active build full — remove an active item first" };
  }
  return { allowed: true };
}
