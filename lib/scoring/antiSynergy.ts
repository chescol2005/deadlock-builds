import type { Item } from "../items";

export type AntiSynergyWarning = {
  itemIds: [string, string];
  reason: string;
};

type AntiSynergyRule = {
  itemIds: [string, string];
  reason: string;
};

// Explicit anti-synergy rules based on real Deadlock item interactions.
// Each rule encodes a specific diminishing-returns or conflicting-use-case interaction.
const ANTI_SYNERGY_RULES: ReadonlyArray<AntiSynergyRule> = [
  {
    itemIds: ["upgrade_damage_recycler", "upgrade_surging_power"],
    reason:
      "Leech and Vampiric Burst both stack BulletLifestealPercent; Deadlock's lifesteal DR means the combined healing return is far below the sum of both tooltips.",
  },
  {
    itemIds: ["upgrade_critshot", "upgrade_glass_cannon"],
    reason:
      "Lucky Shot and Glass Cannon are both Tier-4 pure-offense gun items; the combined cost (12 400 souls) would fund meaningful diversity across categories instead.",
  },
  {
    itemIds: ["upgrade_cold_front", "upgrade_containment"],
    reason:
      "Cold Front and Slowing Hex both apply movement-speed slow; overlapping slows hit Deadlock's DR cap quickly, making the second source significantly weaker.",
  },
  {
    itemIds: ["upgrade_cloaking_device_active", "upgrade_self_bubble"],
    reason:
      "Shadow Weave and Ethereal Shift are both active escape tools; stacking two escapes on the same build limits damage-item budget without meaningful extra safety.",
  },
  {
    itemIds: ["upgrade_rapid_recharge", "upgrade_extra_charge"],
    reason:
      "Rapid Recharge and Extra Charge both grant bonus ability charges; charges are capped per ability so the second item's charge bonus is largely wasted.",
  },
];

export function detectAntiSynergies(currentBuild: Item[]): AntiSynergyWarning[] {
  const buildIds = new Set(currentBuild.map((i) => i.id));
  const warnings: AntiSynergyWarning[] = [];

  for (const rule of ANTI_SYNERGY_RULES) {
    const [a, b] = rule.itemIds;
    if (buildIds.has(a) && buildIds.has(b)) {
      warnings.push({ itemIds: rule.itemIds, reason: rule.reason });
    }
  }

  return warnings;
}
