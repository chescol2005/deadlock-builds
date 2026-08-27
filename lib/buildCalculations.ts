import type { CategoryBonus } from "./categoryBonuses";
import { getCurrentBonusTier, getSoulsToNextTier } from "./categoryBonuses";
import type { Item, ItemAssignment } from "./items";
import { ABILITY_SLOT_UNLOCK_SOULS, BOON_THRESHOLDS } from "./boonSystem";
import type { HeroAbility } from "./abilityCoefficients";
import type { AbilityLevels, AbilityLevel, SignatureSlot } from "./deadlock";

export const SELL_REFUND_RATE = 0.5;
export const getSellRefund = (cost: number): number => Math.floor(cost * SELL_REFUND_RATE);

// Shared stat-combination formula: a base value plus flat item bonuses, then
// scaled by a percent bonus. Used for spirit power, weapon damage, and any
// other stat that combines flat + percent item contributions on top of a
// hero base value (pass percent 0 for flat-only stats like max health).
export function combineStatTotal(base: number, flat: number, percent: number): number {
  return (base + flat) * (1 + percent / 100);
}

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
  spiritPowerFlat: number;
  spiritPowerPercent: number;
  bonusHealthFlat: number;
  weaponDamageFlat: number;
  weaponDamagePercent: number;
  healthRegen: number;
};

const SPIRIT_POWER_KEYS = ["TechPower"];
const SPIRIT_POWER_PERCENT_KEYS = ["TechPowerPercent"];
const HEALTH_BONUS_KEYS = ["BonusHealth"];
const WEAPON_DAMAGE_KEYS = ["WeaponPower"];
const WEAPON_DAMAGE_PERCENT_KEYS = ["BaseAttackDamagePercent"];
const HEALTH_REGEN_KEYS = ["BonusHealthRegen", "OutOfCombatHealthRegen"];

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

export function calculateStatTotals(items: Item[], assignments?: ItemAssignment[]): StatTotals {
  const optionalIds = assignments
    ? new Set(assignments.filter((a) => a.optional).map((a) => a.itemId))
    : new Set<string>();
  const activeItems = assignments ? items.filter((it) => !optionalIds.has(it.id)) : items;

  const totals: StatTotals = {
    spirit: 0,
    gun: 0,
    vitality: 0,
    spiritPowerFlat: 0,
    spiritPowerPercent: 0,
    bonusHealthFlat: 0,
    weaponDamageFlat: 0,
    weaponDamagePercent: 0,
    healthRegen: 0,
  };

  for (const item of activeItems) {
    for (const [key, value] of Object.entries(item.stats)) {
      if (SPIRIT_POWER_KEYS.includes(key)) {
        totals.spiritPowerFlat += value;
        totals.spirit += value;
      }
      if (SPIRIT_POWER_PERCENT_KEYS.includes(key)) {
        totals.spiritPowerPercent += value;
        totals.spirit += value;
      }
      if (HEALTH_BONUS_KEYS.includes(key)) {
        totals.bonusHealthFlat += value;
        totals.vitality += value;
      }
      if (WEAPON_DAMAGE_KEYS.includes(key)) {
        totals.weaponDamageFlat += value;
        totals.gun += value;
      }
      if (WEAPON_DAMAGE_PERCENT_KEYS.includes(key)) {
        totals.weaponDamagePercent += value;
        totals.gun += value;
      }
      if (HEALTH_REGEN_KEYS.includes(key)) {
        totals.healthRegen += value;
      }
    }
  }

  return totals;
}

export function calculateTotalCost(items: BuildableItem[]): number {
  let total = 0;
  for (const it of items) total += it.cost;
  return total;
}

export type PhaseBreakdown = {
  phase: "early" | "mid" | "late" | "uncategorized";
  items: Item[];
  totalCost: number;
  cumulativeCost: number;
  sellRefund: number;
  netCost: number;
};

export type SoulTimeline = {
  early: PhaseBreakdown;
  mid: PhaseBreakdown;
  late: PhaseBreakdown;
  uncategorized: PhaseBreakdown;
  grandTotal: number;
  activeTotal: number;
  sellRecovery: number;
};

export function calculateSoulTimeline(
  buildItems: Item[],
  assignments: ItemAssignment[],
): SoulTimeline {
  const assignmentMap = new Map(assignments.map((a) => [a.itemId, a]));

  const planItems = buildItems.filter((it) => !assignmentMap.get(it.id)?.optional);

  const grouped: Record<"early" | "mid" | "late" | "uncategorized", Item[]> = {
    early: [],
    mid: [],
    late: [],
    uncategorized: [],
  };

  for (const item of planItems) {
    const phase = assignmentMap.get(item.id)?.phase ?? null;
    if (phase === "early" || phase === "mid" || phase === "late") {
      grouped[phase].push(item);
    } else {
      grouped.uncategorized.push(item);
    }
  }

  function buildBreakdown(
    phase: "early" | "mid" | "late" | "uncategorized",
    items: Item[],
    runningTotal: number,
  ): PhaseBreakdown {
    const totalCost = items.reduce((s, it) => s + it.cost, 0);
    const cumulativeCost = runningTotal + totalCost;
    const sellRefund = items
      .filter((it) => assignmentMap.get(it.id)?.sellPriority)
      .reduce((s, it) => s + getSellRefund(it.cost), 0);
    return {
      phase,
      items,
      totalCost,
      cumulativeCost,
      sellRefund,
      netCost: cumulativeCost - sellRefund,
    };
  }

  const early = buildBreakdown("early", grouped.early, 0);
  const mid = buildBreakdown("mid", grouped.mid, early.cumulativeCost);
  const late = buildBreakdown("late", grouped.late, mid.cumulativeCost);
  const uncategorized = buildBreakdown("uncategorized", grouped.uncategorized, late.cumulativeCost);

  const grandTotal = planItems.reduce((s, it) => s + it.cost, 0);
  const activeTotal = planItems
    .filter((it) => assignmentMap.get(it.id)?.active)
    .reduce((s, it) => s + it.cost, 0);
  const sellRecovery =
    early.sellRefund + mid.sellRefund + late.sellRefund + uncategorized.sellRefund;

  return { early, mid, late, uncategorized, grandTotal, activeTotal, sellRecovery };
}

export type SkillPathRow = {
  ability: HeroAbility;
  unlockPhase: "early" | "mid" | "late" | "beyond";
  tier1Phase: "early" | "mid" | "late" | "beyond" | null;
  tier2Phase: "early" | "mid" | "late" | "beyond" | null;
  tier3Phase: "early" | "mid" | "late" | "beyond" | null;
  currentLevel: AbilityLevel;
};

const SIGNATURE_SLOTS: SignatureSlot[] = ["signature1", "signature2", "signature3", "signature4"];

function soulsForAbilityPoints(n: number): number {
  for (const t of BOON_THRESHOLDS) {
    if (t.abilityPoints >= n) return t.souls;
  }
  return Infinity;
}

function classifyPhase(
  soulsNeeded: number,
  timeline: SoulTimeline,
): "early" | "mid" | "late" | "beyond" {
  if (timeline.grandTotal === 0) return "beyond";
  if (soulsNeeded <= timeline.early.cumulativeCost) return "early";
  if (soulsNeeded <= timeline.mid.cumulativeCost) return "mid";
  if (soulsNeeded <= timeline.late.cumulativeCost) return "late";
  return "beyond";
}

export function getSkillPathGrid(
  timeline: SoulTimeline,
  abilities: HeroAbility[],
  abilityLevels: AbilityLevels,
): SkillPathRow[] {
  const tier1Souls = soulsForAbilityPoints(1);
  const tier2Souls = soulsForAbilityPoints(3);
  const tier3Souls = soulsForAbilityPoints(8);
  const noPhaseItems = timeline.grandTotal === 0;

  return SIGNATURE_SLOTS.flatMap((slot, i) => {
    const ability = abilities.find((a) => a.slot === slot);
    if (!ability) return [];

    const unlockSouls = ABILITY_SLOT_UNLOCK_SOULS[i] ?? 0;
    const unlockPhase = classifyPhase(unlockSouls, timeline);

    const tier1Phase = noPhaseItems
      ? null
      : classifyPhase(Math.max(unlockSouls, tier1Souls), timeline);
    const tier2Phase = noPhaseItems
      ? null
      : classifyPhase(Math.max(unlockSouls, tier2Souls), timeline);
    const tier3Phase = noPhaseItems
      ? null
      : classifyPhase(Math.max(unlockSouls, tier3Souls), timeline);

    const currentLevel = (abilityLevels[slot] ?? 0) as AbilityLevel;

    return [{ ability, unlockPhase, tier1Phase, tier2Phase, tier3Phase, currentLevel }];
  });
}
