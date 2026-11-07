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
  // Resists, in PERCENTAGE POINTS (10 = 10%), Milestone O §2.2. Starting value
  // from starting_stats (bullet_/tech_armor_damage_reduction; negative values are
  // real: Pocket -15 spirit, Baba -7 bullet), growth per boon from
  // standard_level_up_upgrades (Dynamo +0.625 bullet), and points per spirit power
  // from scaling_stats (Venator 0.12178 on both). Most heroes have 0 everywhere.
  // Verified against deadlock.wiki/Damage_Resistance on 2026-11-06: Dynamo
  // 0.625 x 35 boons = 21.9 "At Max Boon"; boon and spirit-scaled resist stack
  // ADDITIVELY with the starting value (other resist sources stack
  // multiplicatively, see heroResistAtBoon).
  bulletResist: number;
  bulletResistPerBoon: number;
  bulletResistPerSpirit: number;
  spiritResist: number;
  spiritResistPerBoon: number;
  spiritResistPerSpirit: number;
  // Health regen per point of spirit power, from scaling_stats
  // (EBaseHealthRegen <- ETechPower). Only Victor, 0.08, live 2026-11-06.
  healthRegenPerSpirit: number;
  // Other hero stats that grow with spirit power (scaling_stats, keyed
  // <stat> <- ETechPower), each a FLAT amount per point of spirit power in the
  // stat's own unit: deadlock.wiki/Spirit_Power, "base + (Spirit Power x
  // coefficient)", and every value below matched its hero's wiki infobox on
  // 2026-11-06 (Milestone O §2.2.1).
  /** EBulletDamage: damage per bullet (Solomon 0.14, Grey Talon 0.08, Vindicta 0.022). */
  bulletDamagePerSpirit: number;
  /** EClipSize: bullets of clip (Haze 0.5, Yamato 0.15). */
  clipPerSpirit: number;
  /**
   * ERoundsPerSecond: shots per second (Warden 0.008). Warden's EFireRate 0.21
   * is the SAME bonus as a percent (0.21% x 3.81 base = 0.008), so it is not
   * read, or it would count twice.
   */
  bulletsPerSecondPerSpirit: number;
  /** EHeavyMeleeDamage: heavy melee damage (Paige 0.45). */
  heavyMeleePerSpirit: number;
  /** EMaxMoveSpeed: m/s (Vyper and Sinclair 0.0138, Grey Talon 0.0084). */
  moveSpeedPerSpirit: number;
};

/**
 * Fields Milestone O added, for stats captured before it (the frozen engine
 * snapshot, lib/engine/__fixtures__/frozen/inputs.json). The engine reads none of
 * them, so backfilling 0 keeps its baselines unchanged; nothing ranks resists
 * from that snapshot.
 */
export const HERO_PROFILE_STAT_DEFAULTS = {
  bulletResist: 0,
  bulletResistPerBoon: 0,
  bulletResistPerSpirit: 0,
  spiritResist: 0,
  spiritResistPerBoon: 0,
  spiritResistPerSpirit: 0,
  healthRegenPerSpirit: 0,
  bulletDamagePerSpirit: 0,
  clipPerSpirit: 0,
  bulletsPerSecondPerSpirit: 0,
  heavyMeleePerSpirit: 0,
  moveSpeedPerSpirit: 0,
} as const satisfies Partial<HeroBaseStats>;

/** Health regen at a spirit power: base + per spirit x spirit power. Pure. */
export function healthRegenAt(base: HeroBaseStats, spiritPower: number): number {
  return base.healthRegen + base.healthRegenPerSpirit * Math.max(0, spiritPower);
}

const MAX_BOON = 35;

/**
 * The hero's own bullet and spirit resist, in percentage points, at a boon
 * count and spirit power: starting + per boon x boons + per spirit x spirit
 * power, added together (deadlock.wiki/Damage_Resistance: "Boon and Spirit
 * scaling resistances stack additively"). Items are not included; item resist
 * stacks multiplicatively on top of this, 1 - (1 - a)(1 - b). Pure.
 */
export function heroResistAtBoon(
  base: HeroBaseStats,
  heroLevel: number,
  spiritPower: number,
): { bullet: number; spirit: number } {
  const b = Math.min(Math.max(0, heroLevel), MAX_BOON);
  const sp = Math.max(0, spiritPower);
  return {
    bullet: base.bulletResist + base.bulletResistPerBoon * b + base.bulletResistPerSpirit * sp,
    spirit: base.spiritResist + base.spiritResistPerBoon * b + base.spiritResistPerSpirit * sp,
  };
}

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
