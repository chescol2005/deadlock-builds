export type HeroBaseStats = {
  heroId: number;
  // Weapon
  bulletDamage: number;
  bulletDamagePerBoon: number;
  bulletsPerSecond: number;
  reloadTime: number;
  ammo: number;
  // Valve's own sustained DPS at base (boon 0), reload downtime included --
  // NOT bulletDamage x bulletsPerSecond, which assumes the clip never empties.
  // 0 means no weapon_info data was available (see fetchHeroStats); consumers
  // must treat 0 as "unknown," never as a real zero-DPS weapon. Used by
  // lib/engine/heroNeed.ts to discount nominal gun DPS by reload uptime.
  dpsWithReload: number;
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
