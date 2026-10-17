// lib/engine/synergy.ts
//
// Hand-authored positive item-pair synergies, same upkeep shape as
// `ANTI_SYNERGY_RULES` in lib/scoring/antiSynergy.ts. Entries must come from
// confirmed play knowledge, not inference from data. Pairs are unordered.
//
// Deliberately NOT added:
// - Tesla Bullets: a known OPTIONAL third piece of the Ricochet/Toxic build.
// - Ricochet + Mystic Shot: Mystic Shot is not affected by Ricochet.

export interface SynergyRule {
  /** ItemCandidate.itemId (= API class_name) of each side. Unordered. */
  itemIds: readonly [string, string];
  /** (0, 1]; 1 = full SYNERGY_MAX_FRACTION. */
  strength: number;
  /** Player-facing, plain English. */
  reason: string;
}

export const SYNERGY_RULES: ReadonlyArray<SynergyRule> = [
  {
    itemIds: ["upgrade_dps_aura", "upgrade_crackshot"],
    strength: 1,
    reason:
      "Heroic Aura and Mystic Shot are an established gun-build pairing whose combined value is more than the per-item scores show",
  },
  {
    itemIds: ["upgrade_ricochet", "upgrade_toxic_bullets"],
    strength: 1,
    reason:
      "Ricochet and Toxic Bullets are an established gun-build pairing whose combined value is more than the per-item scores show",
  },
  {
    itemIds: ["upgrade_aoe_root", "upgrade_thermal_detonator"],
    strength: 1,
    reason:
      "Vortex Web pulls enemies into one spot, so Alchemical Fire's area damage lands on all of them",
  },
];

/**
 * Rules where `itemId` is one side and the OTHER side is in `pickedIds`,
 * sorted by partner id ascending. Never pairs an item with itself.
 */
export function findSynergyRules(itemId: string, pickedIds: ReadonlySet<string>): SynergyRule[] {
  const matches: Array<{ partner: string; rule: SynergyRule }> = [];

  for (const rule of SYNERGY_RULES) {
    const [a, b] = rule.itemIds;
    if (a === b) continue;
    const partner = a === itemId ? b : b === itemId ? a : null;
    if (partner === null || partner === itemId) continue;
    if (!pickedIds.has(partner)) continue;
    matches.push({ partner, rule });
  }

  matches.sort((x, y) => x.partner.localeCompare(y.partner));
  return matches.map((m) => m.rule);
}
