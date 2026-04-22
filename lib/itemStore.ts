import { fetchAllItems } from "./api/deadlockApi";
import { normalizeItem } from "./itemNormalizer";
import type { Item, ItemCategory, ItemTier } from "./items";

let cachedItems: Item[] | null = null;

function deriveUpgradesInto(items: Item[]): Item[] {
  return items.map((item) => ({
    ...item,
    upgradesInto: items
      .filter((other) => (other.componentItems ?? []).includes(item.id))
      .map((other) => other.id),
  }));
}

export async function getItems(): Promise<Item[]> {
  if (cachedItems) return cachedItems;

  const raw = await fetchAllItems();
  const normalized = raw.map(normalizeItem);
  const withUpgradesInto = deriveUpgradesInto(normalized);
  console.log(`[itemStore] loaded ${withUpgradesInto.length} items from API`);
  cachedItems = withUpgradesInto;
  return cachedItems;
}

export function getItemByClassname(classname: string, items: Item[]): Item | undefined {
  return items.find((it) => it.id === classname);
}

export function getItemsBySlot(slot: ItemCategory, items: Item[]): Item[] {
  return items.filter((it) => it.category === slot);
}

export function getItemsByTier(tier: ItemTier, items: Item[]): Item[] {
  return items.filter((it) => it.tier === tier);
}

export function getUpgradeChain(item: Item, allItems: Item[]): Item[] {
  const chain: Item[] = [];
  const seen = new Set<string>();
  const queue = [...(item.componentItems ?? [])];

  while (queue.length > 0 && chain.length < 10) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);

    const found = allItems.find((it) => it.id === id);
    if (!found) continue;
    chain.push(found);
    queue.push(...(found.componentItems ?? []));
  }

  return chain;
}
