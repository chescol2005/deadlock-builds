import type { BuildCategory, ItemAssignment } from "@/lib/items";

export function findCategoryOfItem(itemId: string, categories: BuildCategory[]): BuildCategory | null {
  return categories.find((c) => c.itemIds.includes(itemId)) ?? null;
}

export function findTargetCategory(overId: string, categories: BuildCategory[]): BuildCategory | null {
  if (overId.startsWith("zone-")) {
    const categoryId = overId.slice(5);
    return categories.find((c) => c.id === categoryId) ?? null;
  }
  return categories.find((c) => c.id === overId || c.itemIds.includes(overId)) ?? null;
}

export function getCurrentPhaseZone(itemId: string, assignments: ItemAssignment[]): string | null {
  const a = assignments.find((x) => x.itemId === itemId);
  if (!a?.phase) return null;
  return `zone-phase-${a.phase}`;
}
