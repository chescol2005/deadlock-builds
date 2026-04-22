export type CategoryBonus = {
  soulsThreshold: number;
  weaponDamagePercent: number;
  healthBonus: number;
  spiritPowerBonus: number;
  isSignificant: boolean;
};

export const CATEGORY_BONUS_TIERS: CategoryBonus[] = [
  {
    soulsThreshold: 800,
    weaponDamagePercent: 7,
    healthBonus: 8,
    spiritPowerBonus: 7,
    isSignificant: false,
  },
  {
    soulsThreshold: 1600,
    weaponDamagePercent: 9,
    healthBonus: 10,
    spiritPowerBonus: 11,
    isSignificant: false,
  },
  {
    soulsThreshold: 2400,
    weaponDamagePercent: 13,
    healthBonus: 13,
    spiritPowerBonus: 15,
    isSignificant: false,
  },
  {
    soulsThreshold: 3200,
    weaponDamagePercent: 20,
    healthBonus: 17,
    spiritPowerBonus: 19,
    isSignificant: false,
  },
  {
    soulsThreshold: 4800,
    weaponDamagePercent: 49,
    healthBonus: 34,
    spiritPowerBonus: 38,
    isSignificant: true,
  },
  {
    soulsThreshold: 7200,
    weaponDamagePercent: 60,
    healthBonus: 39,
    spiritPowerBonus: 48,
    isSignificant: false,
  },
  {
    soulsThreshold: 9600,
    weaponDamagePercent: 80,
    healthBonus: 44,
    spiritPowerBonus: 57,
    isSignificant: false,
  },
  {
    soulsThreshold: 16000,
    weaponDamagePercent: 95,
    healthBonus: 48,
    spiritPowerBonus: 66,
    isSignificant: false,
  },
  {
    soulsThreshold: 22400,
    weaponDamagePercent: 115,
    healthBonus: 52,
    spiritPowerBonus: 75,
    isSignificant: false,
  },
  {
    soulsThreshold: 28800,
    weaponDamagePercent: 135,
    healthBonus: 56,
    spiritPowerBonus: 100,
    isSignificant: false,
  },
];

export function getCurrentBonusTier(soulsInCategory: number): CategoryBonus | null {
  let current: CategoryBonus | null = null;
  for (const tier of CATEGORY_BONUS_TIERS) {
    if (soulsInCategory >= tier.soulsThreshold) {
      current = tier;
    } else {
      break;
    }
  }
  return current;
}

export function getSoulsToNextTier(soulsInCategory: number): number | null {
  for (const tier of CATEGORY_BONUS_TIERS) {
    if (soulsInCategory < tier.soulsThreshold) {
      return tier.soulsThreshold - soulsInCategory;
    }
  }
  return null;
}

export function isApproachingSignificantBonus(soulsInCategory: number): boolean {
  return soulsInCategory >= 3200 && soulsInCategory < 4800;
}
