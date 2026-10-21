// lib/engine/heroDamage.ts — what an item's damage stats are worth to THIS hero.
//
// Why this exists (coverage-model PR 3, "hero-relative damage", user decision
// 2026-10-20): item category values used to be a heuristic sum of raw stat
// numbers × a weight class, identical for every hero. Rapid Rounds (+9% fire
// rate) scored 9 for Haze and for Seven alike, while a spirit item's own nuke
// entered as tens of raw damage points, so every early basket drifted to spirit
// and vitality items whatever the hero needed. The need vector could not fix
// that: it only CAPS how much of a category the basket fills, it never scales
// what an item is worth.
//
// Here damage stats are converted into one unit: % of this hero's total damage
// per second. Gun stats go through the hero's own weapon (sustained DPS over a
// clip and its reload); spirit power goes through the hero's own ability
// coefficients and cooldowns. Mechanics verified 2026-10-20 (data-verifier;
// deadlock.wiki Fire_Rate / Weapon_Damage / Ammo / Reload / Spirit_Power and
// the live item API):
// - weapon damage % (`BaseAttackDamagePercent`) multiplies every shot;
// - fire rate % (`BonusFireRate`, `FireRateBonus`, `ActivatedFireRate`) is
//   additive and speeds firing only, not the reload;
// - clip size: (base + flat) × (1 + Σ%); reload time `ReloadSpeedMultipler` is
//   a SIGNED % change (−35 = 35% faster);
// - `WeaponPower` is 0 on every item (a sentinel) and is never read;
// - spirit damage = base + spirit power × the ability's coefficient.
//
// Pure: same inputs, same output.

import type { ItemStats } from "../items";

export interface GunProfile {
  /** Damage per shot at the current boon level. */
  perShot: number;
  shotsPerSecond: number;
  clip: number;
  /** Reload duration, seconds. */
  reload: number;
  /**
   * Extra seconds per clip the API's own with-reload DPS includes beyond
   * clip / rate + reload (≈0.25 s for most weapons, data-verifier). Derived
   * from `dpsWithReload`; 0 when unknown.
   */
  overhead: number;
}

export interface GunMods {
  damagePercent?: number;
  fireRatePercent?: number;
  clipPercent?: number;
  clipFlat?: number;
  /** Signed % change to reload TIME; negative = faster. */
  reloadTimePercent?: number;
}

export interface DamagingAbility {
  baseDamage: number | null;
  spiritScaling: number | null;
  cooldown: number | null;
}

export interface HeroDamageModel {
  gun: GunProfile;
  /** Share of shots that land (rank-aware); 1 = every shot. */
  accuracy: number;
  abilities: ReadonlyArray<DamagingAbility>;
  spiritPower: number;
}

/**
 * Weight for stats that only apply some of the time: on an active's buff, at
 * close or long range, on headshots, at max duration. The same 0.4 as
 * itemAdapter's WEIGHT_CONDITIONAL, so the two valuations agree on what
 * "conditional" is worth.
 */
export const CONDITIONAL_DAMAGE_WEIGHT = 0.4;

const num = (x: number | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** Sustained gun DPS over a full clip and its reload, with optional modifiers. */
export function sustainedGunDps(gun: GunProfile, mods: GunMods): number {
  const perShot = gun.perShot * (1 + num(mods.damagePercent) / 100);
  const rate = gun.shotsPerSecond * Math.max(0.5, 1 + num(mods.fireRatePercent) / 100);
  const clip = (gun.clip + num(mods.clipFlat)) * (1 + num(mods.clipPercent) / 100);
  const reload = gun.reload * Math.max(0, 1 + num(mods.reloadTimePercent) / 100);
  if (!(perShot > 0 && rate > 0 && clip > 0)) return 0;
  const cycle = clip / rate + reload + Math.max(0, gun.overhead);
  return cycle > 0 ? (perShot * clip) / cycle : 0;
}

/** Σ (base + coefficient × spirit power) / cooldown over abilities that deal damage. */
export function abilityDps(abilities: ReadonlyArray<DamagingAbility>, spiritPower: number): number {
  let dps = 0;
  for (const a of abilities) {
    const base = num(a.baseDamage ?? undefined);
    const cd = num(a.cooldown ?? undefined);
    if (!(base > 0) || !(cd > 0)) continue;
    dps += (base + num(a.spiritScaling ?? undefined) * Math.max(0, spiritPower)) / cd;
  }
  return dps;
}

/** The hero's damage per second: landed gun DPS + ability DPS. */
export function heroDps(model: HeroDamageModel): { gun: number; ability: number; total: number } {
  const gun = sustainedGunDps(model.gun, {}) * Math.max(0, Math.min(1, model.accuracy));
  const ability = abilityDps(model.abilities, model.spiritPower);
  return { gun, ability, total: gun + ability };
}

/** Stat keys `damageValues` prices; itemAdapter skips its heuristic for them. */
export const HERO_RELATIVE_GUN_KEYS: ReadonlySet<string> = new Set([
  "WeaponPower",
  "BaseAttackDamagePercent",
  "BonusFireRate",
  "FireRateBonus",
  "ActivatedFireRate",
  "BonusClipSizePercent",
  "BonusClipSize",
  "ReloadSpeedMultipler",
  "CloseRangeBonusWeaponPower",
  "LongRangeBonusWeaponPower",
  "HeadShotBonusDamage",
  "BaseAttackDamagePercentAtMaxDuration",
  "ProcBaseAttackDamagePercent",
]);
export const HERO_RELATIVE_SPIRIT_KEYS: ReadonlySet<string> = new Set([
  "TechPower",
  "TechPowerPercent",
  "SpiritPower",
  "BonusSpirit",
  "ImbuedTechPower",
  "TechDamagePercent",
]);

/**
 * gunDamage / spiritDamage for an item's damage STATS, in % of this hero's
 * total DPS. Null when the hero deals no measurable damage (no model to scale
 * against); the caller then keeps the hero-agnostic valuation.
 */
export function damageValues(
  stats: ItemStats,
  model: HeroDamageModel,
): { gunDamage: number; spiritDamage: number } {
  const s = (k: string) => num(stats[k]);
  const dps = heroDps(model);
  if (!(dps.total > 0)) return { gunDamage: 0, spiritDamage: 0 };

  // A fire-rate stat on an item with an active cooldown is that active's buff
  // (Active Reload, Kinetic Dash), not a permanent bonus.
  const onActive = s("AbilityCooldown") > 0;
  const c = CONDITIONAL_DAMAGE_WEIGHT;
  const mods: GunMods = {
    damagePercent:
      s("BaseAttackDamagePercent") +
      c *
        (s("CloseRangeBonusWeaponPower") +
          s("LongRangeBonusWeaponPower") +
          s("HeadShotBonusDamage") +
          s("BaseAttackDamagePercentAtMaxDuration") +
          s("ProcBaseAttackDamagePercent")),
    fireRatePercent:
      s("BonusFireRate") * (onActive ? c : 1) + c * (s("FireRateBonus") + s("ActivatedFireRate")),
    clipPercent: s("BonusClipSizePercent"),
    clipFlat: s("BonusClipSize"),
    // Signed: read raw, not clamped at 0.
    reloadTimePercent: Number.isFinite(stats.ReloadSpeedMultipler) ? stats.ReloadSpeedMultipler : 0,
  };
  const before = sustainedGunDps(model.gun, {});
  const after = sustainedGunDps(model.gun, mods);
  const gunGain = before > 0 ? (after / before - 1) * dps.gun : 0;

  const sp = Math.max(0, model.spiritPower);
  const deltaSp =
    s("TechPower") +
    s("SpiritPower") +
    s("BonusSpirit") +
    c * s("ImbuedTechPower") +
    (sp * s("TechPowerPercent")) / 100;
  const abilityAfter =
    abilityDps(model.abilities, sp + deltaSp) * (1 + s("TechDamagePercent") / 100);
  const spiritGain = abilityAfter - dps.ability;

  return {
    gunDamage: (gunGain / dps.total) * 100,
    spiritDamage: (spiritGain / dps.total) * 100,
  };
}
