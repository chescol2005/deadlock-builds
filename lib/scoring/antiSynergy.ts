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
// - Reasons are plain English (shown to new players and quoted by the coach,
//   M6; reworded 2026-10-25 without "lifesteal" / "multiplicatively").
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
// - Item scoring review R3 (2026-10-25, data-verifier + user): only real
//   diminishing returns stay. Lucky Shot + Glass Cannon and Shadow Weave +
//   Ethereal Shift were budget advice, not conflicts, and were removed. No item
//   text or wiki page states another conflicting pair. Leech + Vampiric Burst
//   share a component, but that is not a cost: owning it only discounts the
//   other upgrade.
//
// Exported read-only for the offline synergy audit report and the pair-table
// fitter's audit-only handPairs; detectAntiSynergies is still the only consumer
// in the app.
export const ANTI_SYNERGY_RULES: ReadonlyArray<AntiSynergyRule> = [
  {
    itemIds: ["upgrade_damage_recycler", "upgrade_surging_power"],
    reason:
      "Leech and Vampiric Burst both heal you when your bullets hit. Together they heal a little less than their two tooltips add up to.",
  },
  {
    itemIds: ["upgrade_cold_front", "upgrade_containment"],
    reason:
      "Cold Front and Slowing Hex both slow enemies down. Together they slow less than their two tooltips add up to, and an enemy can only be slowed so far.",
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
