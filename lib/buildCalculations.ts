import type { CategoryBonus } from "./categoryBonuses";
import { getCurrentBonusTier, getSoulsToNextTier } from "./categoryBonuses";
import type { Item, ItemAssignment } from "./items";

export const SELL_REFUND_RATE = 0.5;
export const getSellRefund = (cost: number): number => Math.floor(cost * SELL_REFUND_RATE);

export function getActiveItems(items: Item[], assignments: ItemAssignment[]): Item[] {
  const activeIds = new Set(assignments.filter((a) => a.active).map((a) => a.itemId));
  return items.filter((it) => activeIds.has(it.id));
}

export function getPlanItems(items: Item[], assignments: ItemAssignment[]): Item[] {
  const optionalIds = new Set(assignments.filter((a) => a.optional).map((a) => a.itemId));
  return items.filter((it) => !optionalIds.has(it.id));
}

export type BuildableItem = {
  category: "gun" | "weapon" | "vitality" | "spirit";
  cost: number;
  spiritBonus?: number;
  gunBonus?: number;
  vitalityBonus?: number;
};

export type DamageSplit = {
  spirit: number;
  gun: number;
  vitality: number;
  total: number;
  spiritBonus: CategoryBonus | null;
  gunBonus: CategoryBonus | null;
  vitalityBonus: CategoryBonus | null;
  spiritToNextTier: number | null;
  gunToNextTier: number | null;
  vitalityToNextTier: number | null;
};

export type StatTotals = {
  spirit: number;
  gun: number;
  vitality: number;
};

export function calculateDamageSplit(items: BuildableItem[]): DamageSplit {
  let spirit = 0;
  let gun = 0;
  let vitality = 0;
  for (const it of items) {
    if (it.category === "spirit") spirit += it.cost;
    else if (it.category === "weapon" || it.category === "gun") gun += it.cost;
    else vitality += it.cost;
  }
  return {
    spirit,
    gun,
    vitality,
    total: spirit + gun + vitality,
    spiritBonus: getCurrentBonusTier(spirit),
    gunBonus: getCurrentBonusTier(gun),
    vitalityBonus: getCurrentBonusTier(vitality),
    spiritToNextTier: getSoulsToNextTier(spirit),
    gunToNextTier: getSoulsToNextTier(gun),
    vitalityToNextTier: getSoulsToNextTier(vitality),
  };
}

export function calculateStatTotals(items: BuildableItem[]): StatTotals {
  let spirit = 0;
  let gun = 0;
  let vitality = 0;
  for (const it of items) {
    spirit += it.spiritBonus ?? 0;
    gun += it.gunBonus ?? 0;
    vitality += it.vitalityBonus ?? 0;
  }
  return { spirit, gun, vitality };
}

export function calculateTotalCost(items: BuildableItem[]): number {
  let total = 0;
  for (const it of items) total += it.cost;
  return total;
}
