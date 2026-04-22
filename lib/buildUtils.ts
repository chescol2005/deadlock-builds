import type { Item } from "./items";

// Returns a map of consumed component IDs → the name of the build item that consumed them.
// A component is consumed when it appears in a build item's componentItems but is not
// itself directly present in the build.
export function getConsumedComponents(currentBuild: Item[]): Map<string, string> {
  const buildIds = new Set(currentBuild.map((i) => i.id));
  const consumed = new Map<string, string>();

  for (const item of currentBuild) {
    for (const componentId of item.componentItems ?? []) {
      if (!buildIds.has(componentId)) {
        consumed.set(componentId, item.name);
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
export function resolveAddItem(currentBuild: Item[], newItem: Item, _allItems: Item[]): Item[] {
  const componentSet = new Set(newItem.componentItems ?? []);
  const withoutConsumed = currentBuild.filter((it) => !componentSet.has(it.id));
  return [...withoutConsumed, newItem];
}
