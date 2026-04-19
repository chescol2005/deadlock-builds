export type BuildableItem = {
  category: "weapon" | "vitality" | "spirit";
  cost: number;
  spiritBonus: number;
  gunBonus: number;
  vitalityBonus: number;
};

export type DamageSplit = {
  spirit: number;
  gun: number;
  vitality: number;
  total: number;
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
    else if (it.category === "weapon") gun += it.cost;
    else vitality += it.cost;
  }
  return { spirit, gun, vitality, total: spirit + gun + vitality };
}

export function calculateStatTotals(items: BuildableItem[]): StatTotals {
  let spirit = 0;
  let gun = 0;
  let vitality = 0;
  for (const it of items) {
    spirit += it.spiritBonus;
    gun += it.gunBonus;
    vitality += it.vitalityBonus;
  }
  return { spirit, gun, vitality };
}

export function calculateTotalCost(items: BuildableItem[]): number {
  let total = 0;
  for (const it of items) total += it.cost;
  return total;
}
