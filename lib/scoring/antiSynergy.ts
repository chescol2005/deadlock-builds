import type { Item } from "../items";

export type AntiSynergyWarning = {
  itemIds: [string, string];
  reason: string;
};

export type AntiSynergyRule = {
  itemIds: [string, string];
  reason: string;
};

// Explicit anti-synergy rules based on real Deadlock item interactions.
// Each rule encodes a specific diminishing-returns or overlapping-role pair.
//
// Reviewed 2026-10-19 against deadlock.wiki and the live item API (data-verifier;
// see "Synergy audit report" in engine-design-notes.md):
// - Reasons state mechanics the wiki documents, or say plainly that they are
//   advice rather than mechanics. No hardcoded soul costs or percentages: those
//   go stale when Valve patches (a "12 400 souls" figure here was already wrong).
// - Never pair an item with its own component: buying the component first is
//   the normal upgrade path. Rapid Recharge + Extra Charge was removed for this
//   (Extra Charge is Rapid Recharge's component, and their charges add up).
//   mini.ts enforces it against the live item data.
// - Measured on Oracle+ matches, none of these pairs shows a significant
//   win-rate penalty for any hero; they are warnings about tooltips and budget,
//   not about lost games.
//
// Exported read-only for the offline synergy audit report and the pair-table
// fitter's audit-only handPairs; detectAntiSynergies is still the only consumer
// in the app.
export const ANTI_SYNERGY_RULES: ReadonlyArray<AntiSynergyRule> = [
  {
    itemIds: ["upgrade_damage_recycler", "upgrade_surging_power"],
    reason:
      "Leech and Vampiric Burst both grant bullet lifesteal. Lifesteal sources stack multiplicatively, so the second one adds a bit less healing than its tooltip suggests.",
  },
  {
    itemIds: ["upgrade_critshot", "upgrade_glass_cannon"],
    reason:
      "Lucky Shot and Glass Cannon don't conflict mechanically, but both are expensive offensive gun items. Owning both puts a large share of your souls into one category; check whether some of that budget would serve you better elsewhere.",
  },
  {
    itemIds: ["upgrade_cold_front", "upgrade_containment"],
    reason:
      "Cold Front and Slowing Hex both slow movement. Slows stack multiplicatively and movement speed has a floor, so the second slow adds less than its tooltip suggests.",
  },
  {
    itemIds: ["upgrade_cloaking_device_active", "upgrade_self_bubble"],
    reason:
      "Shadow Weave (stealth and ambush) and Ethereal Shift (brief invulnerability) are both actives for getting into or out of a fight. They don't conflict mechanically, but most builds only need one of them.",
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
