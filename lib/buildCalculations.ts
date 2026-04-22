import type { CategoryBonus } from "./categoryBonuses";
import { getCurrentBonusTier, getSoulsToNextTier } from "./categoryBonuses";

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
