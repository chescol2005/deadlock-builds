export type HeroBaseStats = {
  heroId: number;
  // Weapon
  bulletDamage: number;
  bulletDamagePerBoon: number;
  bulletsPerSecond: number;
  reloadTime: number;
  ammo: number;
  lightMeleeDamage: number;
  lightMeleePerBoon: number;
  heavyMeleeDamage: number;
  heavyMeleePerBoon: number;
  // Vitality
  maxHealth: number;
  maxHealthPerBoon: number;
  healthRegen: number;
  moveSpeed: number;
  // Spirit
  spiritPower: number;
  spiritPowerPerBoon: number;
};

const MAX_BOON = 35;

export function calculateStatsAtBoon(base: HeroBaseStats, heroLevel: number): HeroBaseStats {
  const b = Math.min(Math.max(0, heroLevel), MAX_BOON);
  return {
    ...base,
    bulletDamage: base.bulletDamage + base.bulletDamagePerBoon * b,
    lightMeleeDamage: base.lightMeleeDamage + base.lightMeleePerBoon * b,
    heavyMeleeDamage: base.heavyMeleeDamage + base.heavyMeleePerBoon * b,
    maxHealth: base.maxHealth + base.maxHealthPerBoon * b,
    spiritPower: base.spiritPower + base.spiritPowerPerBoon * b,
  };
}
