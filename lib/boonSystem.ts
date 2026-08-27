// Souls-per-level and ability-unlock table.
// Sourced from GET /v1/assets/heroes/{id} → level_info (required_gold, bonus_currencies),
// with the 600 free starting souls every player begins the match with added to each
// threshold — the API's required_gold is souls needed *beyond* that starting stack, but
// this table (and deadlock.wiki/Boon) express thresholds as total cumulative souls, so
// the offset must be applied or every threshold undercounts by 600.
// Verified hero-independent (identical on hero ids 1 and 2) and cross-checked against
// deadlock.wiki/Boon on 2026-07-20 — hardcoded here rather than fetched because every
// consumer reads this table synchronously with no heroId in scope.

export type BoonThreshold = {
  souls: number;
  boonLevel: number;
  abilityUnlock: boolean;
  abilityPoints: number;
  isUltimateUnlock: boolean;
};

// GENERATED:BOON_THRESHOLDS:START
export const BOON_THRESHOLDS: BoonThreshold[] = [
  { souls: 600, boonLevel: 1, abilityUnlock: true, abilityPoints: 0, isUltimateUnlock: false },
  { souls: 800, boonLevel: 2, abilityUnlock: false, abilityPoints: 1, isUltimateUnlock: false },
  { souls: 1100, boonLevel: 3, abilityUnlock: true, abilityPoints: 1, isUltimateUnlock: false },
  { souls: 1500, boonLevel: 4, abilityUnlock: false, abilityPoints: 2, isUltimateUnlock: false },
  { souls: 2000, boonLevel: 5, abilityUnlock: true, abilityPoints: 2, isUltimateUnlock: false },
  { souls: 2600, boonLevel: 6, abilityUnlock: false, abilityPoints: 3, isUltimateUnlock: false },
  { souls: 3200, boonLevel: 7, abilityUnlock: false, abilityPoints: 4, isUltimateUnlock: false },
  { souls: 3800, boonLevel: 8, abilityUnlock: true, abilityPoints: 4, isUltimateUnlock: true },
  { souls: 4500, boonLevel: 9, abilityUnlock: false, abilityPoints: 5, isUltimateUnlock: false },
  { souls: 5200, boonLevel: 10, abilityUnlock: false, abilityPoints: 6, isUltimateUnlock: false },
  { souls: 5900, boonLevel: 11, abilityUnlock: false, abilityPoints: 7, isUltimateUnlock: false },
  { souls: 6600, boonLevel: 12, abilityUnlock: false, abilityPoints: 8, isUltimateUnlock: false },
  { souls: 7400, boonLevel: 13, abilityUnlock: false, abilityPoints: 9, isUltimateUnlock: false },
  { souls: 8200, boonLevel: 14, abilityUnlock: false, abilityPoints: 10, isUltimateUnlock: false },
  { souls: 9000, boonLevel: 15, abilityUnlock: false, abilityPoints: 11, isUltimateUnlock: false },
  { souls: 9800, boonLevel: 16, abilityUnlock: false, abilityPoints: 12, isUltimateUnlock: false },
  { souls: 10700, boonLevel: 17, abilityUnlock: false, abilityPoints: 13, isUltimateUnlock: false },
  { souls: 11600, boonLevel: 18, abilityUnlock: false, abilityPoints: 14, isUltimateUnlock: false },
  { souls: 12500, boonLevel: 19, abilityUnlock: false, abilityPoints: 15, isUltimateUnlock: false },
  { souls: 13400, boonLevel: 20, abilityUnlock: false, abilityPoints: 16, isUltimateUnlock: false },
  { souls: 14400, boonLevel: 21, abilityUnlock: false, abilityPoints: 17, isUltimateUnlock: false },
  { souls: 15500, boonLevel: 22, abilityUnlock: false, abilityPoints: 18, isUltimateUnlock: false },
  { souls: 16700, boonLevel: 23, abilityUnlock: false, abilityPoints: 19, isUltimateUnlock: false },
  { souls: 18000, boonLevel: 24, abilityUnlock: false, abilityPoints: 20, isUltimateUnlock: false },
  { souls: 19500, boonLevel: 25, abilityUnlock: false, abilityPoints: 21, isUltimateUnlock: false },
  { souls: 21200, boonLevel: 26, abilityUnlock: false, abilityPoints: 22, isUltimateUnlock: false },
  { souls: 23100, boonLevel: 27, abilityUnlock: false, abilityPoints: 23, isUltimateUnlock: false },
  { souls: 25200, boonLevel: 28, abilityUnlock: false, abilityPoints: 24, isUltimateUnlock: false },
  { souls: 27500, boonLevel: 29, abilityUnlock: false, abilityPoints: 25, isUltimateUnlock: false },
  { souls: 30000, boonLevel: 30, abilityUnlock: false, abilityPoints: 26, isUltimateUnlock: false },
  { souls: 32700, boonLevel: 31, abilityUnlock: false, abilityPoints: 27, isUltimateUnlock: false },
  { souls: 35600, boonLevel: 32, abilityUnlock: false, abilityPoints: 28, isUltimateUnlock: false },
  { souls: 38700, boonLevel: 33, abilityUnlock: false, abilityPoints: 29, isUltimateUnlock: false },
  { souls: 42000, boonLevel: 34, abilityUnlock: false, abilityPoints: 30, isUltimateUnlock: false },
  { souls: 45500, boonLevel: 35, abilityUnlock: false, abilityPoints: 31, isUltimateUnlock: false },
  { souls: 49200, boonLevel: 36, abilityUnlock: false, abilityPoints: 32, isUltimateUnlock: false },
];
// GENERATED:BOON_THRESHOLDS:END

// Souls needed to unlock each ability slot (1-indexed: [0]=ability1, [3]=ultimate)
// GENERATED:ABILITY_SLOT_UNLOCK_SOULS:START
export const ABILITY_SLOT_UNLOCK_SOULS = [600, 1100, 2000, 3800] as const;
// GENERATED:ABILITY_SLOT_UNLOCK_SOULS:END

export function getBoonThreshold(soulsSpent: number): BoonThreshold {
  let result = BOON_THRESHOLDS[0];
  for (const t of BOON_THRESHOLDS) {
    if (soulsSpent >= t.souls) result = t;
    else break;
  }
  return result;
}

export function getAbilityPointsAtSouls(soulsSpent: number): number {
  return getBoonThreshold(soulsSpent).abilityPoints;
}

export function getAbilityUnlocksAtSouls(soulsSpent: number): number {
  let count = 0;
  for (const threshold of ABILITY_SLOT_UNLOCK_SOULS) {
    if (soulsSpent >= threshold) count++;
    else break;
  }
  return count;
}

export function getSoulsToNextBoon(soulsSpent: number): number | null {
  const last = BOON_THRESHOLDS[BOON_THRESHOLDS.length - 1];
  if (!last || soulsSpent >= last.souls) return null;

  for (const t of BOON_THRESHOLDS) {
    if (t.souls > soulsSpent) return t.souls - soulsSpent;
  }
  return null;
}

export function isApproachingUltimateUnlock(soulsSpent: number): boolean {
  // Derive upper bound from ABILITY_SLOT_UNLOCK_SOULS (ultimate at index 3)
  const ultimateUnlockSouls = ABILITY_SLOT_UNLOCK_SOULS[ABILITY_SLOT_UNLOCK_SOULS.length - 1];

  // Derive lower bound from the threshold before ultimate unlock in BOON_THRESHOLDS
  const ultimateThresholdIndex = BOON_THRESHOLDS.findIndex((t) => t.isUltimateUnlock);
  const approachingThreshold =
    ultimateThresholdIndex > 0 ? BOON_THRESHOLDS[ultimateThresholdIndex - 1].souls : 0;

  return soulsSpent >= approachingThreshold && soulsSpent < ultimateUnlockSouls;
}

export function getAbilityUnlockOrder(): {
  souls: number;
  unlockNumber: 1 | 2 | 3 | 4;
  isUltimate: boolean;
}[] {
  return ABILITY_SLOT_UNLOCK_SOULS.map((souls, i) => ({
    souls,
    unlockNumber: (i + 1) as 1 | 2 | 3 | 4,
    isUltimate: i === 3,
  }));
}
