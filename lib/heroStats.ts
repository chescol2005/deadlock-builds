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
  // Weapon class name from hero.items.weapon_primary (e.g.
  // "citadel_weapon_necro_set"). Carried so lib/engine/heroNeed.ts can apply
  // per-weapon range-profile exceptions, since some weapons' falloff_* fields
  // do not mean what they mean on every other weapon. "" when unavailable.
  weaponClass: string;
  // Damage-falloff profile, converted to METRES at fetch time (the API reports
  // source units; / 39.37). Full damage holds to falloffStartRange, then scales
  // toward falloffEndScale -- the fraction of damage RETAINED at and beyond
  // falloffEndRange -- reached at falloffEndRange. maxRange is the hard travel
  // cap past which the weapon deals nothing at all.
  //
  // All 0 when no weapon_info was available; consumers must treat a 0
  // falloffEndRange as "unknown" and apply no discount, never as a weapon that
  // deals zero damage everywhere.
  falloffStartRange: number;
  falloffEndRange: number;
  falloffStartScale: number;
  falloffEndScale: number;
  maxRange: number;
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
