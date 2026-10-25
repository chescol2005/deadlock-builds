// lib/engine/heroDamage.ts — what an item's damage stats are worth to THIS hero.
//
// Why this exists ("one value scale", 2026-10-20 to 10-24): item category
// values used to be a heuristic sum of raw stat numbers × a weight class,
// identical for every hero. Rapid Rounds (+9% fire rate) scored 9 for Haze and
// for Seven alike, while a spirit item's own nuke entered as tens of raw damage
// points, so every early basket drifted to spirit and vitality items whatever
// the hero needed. The need vector could not fix that: it only sets how much of
// a category the basket wants, it never scales what an item is worth.
//
// Here damage stats are converted into one unit: % of this hero's damage per
// second in a TRADE (a short fight). Gun stats go through the hero's own weapon
// (sustained DPS over a clip and its reload); spirit power goes through the
// hero's own ability coefficients, each ability cast as often as it would be in
// a trade (castsPerTrade). heroFight.ts prices every non-damage stat in the
// same unit. Mechanics verified 2026-10-20 (data-verifier; deadlock.wiki
// Fire_Rate / Weapon_Damage / Ammo / Reload / Spirit_Power and the live API):
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
  /** Per cast (a DPS ability's rate x its seconds, see damagePerCastFactor). */
  baseDamage: number | null;
  spiritScaling: number | null;
  cooldown: number | null;
  /** Seconds one cast keeps hitting (a DPS ability); absent = one hit. */
  seconds?: number;
  /** Has charges: Extra Charge / Rapid Recharge spirit applies to it. */
  charged?: boolean;
}

export interface HeroDamageModel {
  gun: GunProfile;
  /** Share of shots that land (rank-aware); 1 = every shot. */
  accuracy: number;
  abilities: ReadonlyArray<DamagingAbility>;
  spiritPower: number;
  /** Light melee damage at this boon level (melee damage items). */
  meleeDamage?: number;
  /**
   * Max health at this boon level and base move speed (m/s), for the
   * fight-value model (heroFight.ts). Omitted: non-damage stats keep the
   * hero-agnostic valuation.
   */
  survival?: { maxHealth: number; moveSpeed: number };
}

/**
 * Weight for stats that only apply some of the time: on an active's buff, at
 * close or long range, at max duration. The same 0.4 as itemAdapter's
 * WEIGHT_CONDITIONAL, so the two valuations agree on what "conditional" is
 * worth.
 */
export const CONDITIONAL_DAMAGE_WEIGHT = 0.4;

/**
 * Seconds of a trade, the window every value is priced over. Every ability is
 * cast at least once in a trade, so ability damage is spread over the trade,
 * not over its full cooldown: per-cooldown averaging made casters look like
 * gun heroes (Lady Geist's whole kit came to ~8 DPS).
 */
export const TRADE_SECONDS = 10;
/**
 * Most casts of one ability (or item active) credited per trade. Also caps
 * resource-gated abilities whose "cooldown" is only the minimum time between
 * casts: Wraith's Card Trick lists 0.6 s but its cards come from landing
 * bullets (2 charges), and per-cooldown it counted 75 DPS.
 */
export const MAX_CASTS_PER_TRADE = 2;
/** Seconds between trades: a cooldown longer than this misses some trades. */
export const TRADE_GAP_SECONDS = 30;
/** Chance a cooldown's "next headshot" bonus lands within a trade. */
export const HEADSHOT_IN_TRADE = 0.7;

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

/**
 * Casts of a cooldown-gated effect in one trade: a short cooldown counts up to
 * MAX_CASTS_PER_TRADE; a long one counts once, weighted by the share of trades
 * it is ready for (an ultimate on 200 s is ready for ~15% of them). Shared by
 * hero abilities and item actives. No cooldown = one cast.
 */
export function castsPerTrade(cooldown: number): number {
  if (!(cooldown > 0)) return 1;
  return cooldown < TRADE_SECONDS
    ? Math.min(MAX_CASTS_PER_TRADE, TRADE_SECONDS / cooldown)
    : Math.min(1, TRADE_GAP_SECONDS / cooldown);
}

/** Σ (base + coefficient × spirit power) × casts per trade ÷ trade, over damaging abilities. */
export function abilityDps(abilities: ReadonlyArray<DamagingAbility>, spiritPower: number): number {
  let dps = 0;
  for (const a of abilities) {
    const base = num(a.baseDamage ?? undefined);
    const cd = num(a.cooldown ?? undefined);
    if (!(base > 0) || !(cd > 0)) continue;
    const perCast = base + num(a.spiritScaling ?? undefined) * Math.max(0, spiritPower);
    dps += (perCast * castsPerTrade(cd)) / TRADE_SECONDS;
  }
  return dps;
}

/** The hero's damage per second in a trade: landed gun DPS + ability DPS. */
export function heroDps(model: HeroDamageModel): { gun: number; ability: number; total: number } {
  const gun = sustainedGunDps(model.gun, {}) * Math.max(0, Math.min(1, model.accuracy));
  const ability = abilityDps(model.abilities, model.spiritPower);
  return { gun, ability, total: gun + ability };
}

/** Melee hits landed in a trade (shared with heroFight's melee heals). */
export const MELEE_HITS_PER_TRADE = 3;
/** Share of melee attempts that land. */
export const MELEE_LANDS = 0.5;
/**
 * A stacking spirit amp (Escalating Exposure) gains at most one stack per this
 * many seconds of continuous spirit damage on a target (its "Max Frequency Per
 * Target", ProcCooldown 0.7 s; data-verifier 2026-10-25).
 */
const AMP_STACK_INTERVAL = 0.7;

/** Spirit hits one target takes from this kit in a trade (stacks for an amp). */
function spiritHitsPerTrade(abilities: ReadonlyArray<DamagingAbility>, interval: number): number {
  let hits = 0;
  for (const a of abilities) {
    const cd = num(a.cooldown ?? undefined);
    if (!(num(a.baseDamage ?? undefined) > 0) || !(cd > 0)) continue;
    const perCast = a.seconds != null && a.seconds > 0 ? Math.max(1, a.seconds / interval) : 1;
    hits += castsPerTrade(cd) * perCast;
  }
  return hits;
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
  "BonusSpiritForChargedAbilities",
  "MagicIncreasePerStack",
  // Priced at 0 on purpose: Mystic Reverb's "Current Health Bonus Damage" is in
  // no tooltip and not on the wiki (data-verifier 2026-10-25), so unconfirmed.
  // The item's real effect is the TechDamagePercent proc.
  "MaxHealthDamage",
]);
/** Melee keys `damageValues` prices as gun-category damage. */
export const HERO_RELATIVE_MELEE_KEYS: ReadonlySet<string> = new Set(["BonusMeleeDamagePercent"]);

/**
 * gunDamage / spiritDamage for an item's damage STATS, in % of this hero's
 * trade DPS. Both 0 when the hero deals no measurable damage.
 *
 * `innate`: stat keys the API lists as always on (Item.innateStats). A stat on
 * an item with a cooldown or a duration is otherwise treated as that active's
 * buff, but Burst Fire's +10% fire rate is innate while its on-hit burst is not.
 */
export function damageValues(
  stats: ItemStats,
  model: HeroDamageModel,
  innate?: ReadonlySet<string>,
): { gunDamage: number; spiritDamage: number } {
  const s = (k: string) => num(stats[k]);
  const dps = heroDps(model);
  if (!(dps.total > 0)) return { gunDamage: 0, spiritDamage: 0 };

  // A stat on an item with a cooldown (Active Reload) or a timed effect
  // (Kinetic Dash: +25% fire rate for 7 s after a dash) belongs to that effect,
  // unless the API lists it as innate.
  const timed = s("AbilityCooldown") > 0 || s("AbilityDuration") > 0;
  const c = CONDITIONAL_DAMAGE_WEIGHT;
  const cond = (k: string) => (timed && !innate?.has(k) ? c : 1);
  // A headshot bonus on a cooldown is FLAT damage once per cooldown (Headshot
  // Booster 45 / 9 s, Headhunter 75 / 8 s: "your next headshot against an enemy
  // hero deals bonus weapon damage"), priced below. It was read as +45% weapon
  // damage before 2026-10-24.
  const flatHeadshot = s("AbilityCooldown") > 0 ? s("HeadShotBonusDamage") : 0;
  const mods: GunMods = {
    damagePercent:
      s("BaseAttackDamagePercent") +
      c *
        (s("CloseRangeBonusWeaponPower") +
          s("LongRangeBonusWeaponPower") +
          (flatHeadshot > 0 ? 0 : s("HeadShotBonusDamage")) +
          s("BaseAttackDamagePercentAtMaxDuration") +
          s("ProcBaseAttackDamagePercent")),
    fireRatePercent:
      s("BonusFireRate") * cond("BonusFireRate") +
      c * (s("FireRateBonus") + s("ActivatedFireRate")),
    clipPercent: s("BonusClipSizePercent"),
    clipFlat: s("BonusClipSize"),
    // Signed: read raw, not clamped at 0.
    reloadTimePercent: Number.isFinite(stats.ReloadSpeedMultipler) ? stats.ReloadSpeedMultipler : 0,
  };
  const before = sustainedGunDps(model.gun, {});
  const after = sustainedGunDps(model.gun, mods);
  let gunGain = before > 0 ? (after / before - 1) * dps.gun : 0;
  if (flatHeadshot > 0) {
    gunGain +=
      (flatHeadshot * castsPerTrade(s("AbilityCooldown")) * HEADSHOT_IN_TRADE) / TRADE_SECONDS;
  }

  const sp = Math.max(0, model.spiritPower);
  const deltaSp =
    s("TechPower") +
    s("SpiritPower") +
    s("BonusSpirit") +
    c * s("ImbuedTechPower") +
    (sp * s("TechPowerPercent")) / 100;
  const spAfter = sp + deltaSp;
  const abilityAfter = abilityDps(model.abilities, spAfter);
  let spiritGain = abilityAfter - dps.ability;

  // Item scoring review C2 (docs/item-scoring-review.md §1.3 items 4-5).
  // Extra spirit for charged abilities only (Extra Charge 7, Rapid Recharge 14):
  // nothing for a kit without charges (Haze, Abrams).
  const chargedSp = s("BonusSpiritForChargedAbilities");
  if (chargedSp > 0) {
    const charged = model.abilities.filter((a) => a.charged);
    spiritGain += abilityDps(charged, spAfter + chargedSp) - abilityDps(charged, spAfter);
  }
  // Mystic Reverb: +50% of ONE imbued ability's hit (at least MinimumDamage),
  // once per item cooldown, not a permanent +50% to every ability.
  const reverbPct = s("TechDamagePercent");
  if (reverbPct > 0) {
    let best = 0;
    let bestCasts = 0;
    for (const a of model.abilities) {
      const cd = num(a.cooldown ?? undefined);
      const perCast = num(a.baseDamage ?? undefined) + num(a.spiritScaling ?? undefined) * spAfter;
      // "The first instance" of a damage-over-time ability is one second of it,
      // not the whole cast (Lightning Ball: 75, not 75 x 5).
      const firstHit = a.seconds != null && a.seconds > 0 ? perCast / a.seconds : perCast;
      if (!(cd > 0) || !(firstHit > best)) continue;
      best = firstHit;
      bestCasts = castsPerTrade(cd);
    }
    if (best > 0) {
      const itemCd = s("AbilityCooldown");
      const procs = itemCd > 0 ? Math.min(bestCasts, castsPerTrade(itemCd)) : bestCasts;
      spiritGain +=
        (Math.max(s("MinimumDamage"), (best * reverbPct) / 100) * procs) / TRADE_SECONDS;
    }
  }
  // Escalating Exposure: +MagicIncreasePerStack% spirit damage per stack, one
  // stack per spirit hit (at most every AMP_STACK_INTERVAL s), MaxStacks cap.
  // Over a trade the target carries about half the stacks it reaches.
  const perStack = s("MagicIncreasePerStack");
  if (perStack > 0) {
    // MaxStacks is on the only item with this key (Escalating Exposure 12); a
    // missing cap counts as a single stack rather than an invented one.
    const reached = Math.min(
      Math.max(1, s("MaxStacks")),
      spiritHitsPerTrade(model.abilities, AMP_STACK_INTERVAL),
    );
    spiritGain += (abilityAfter * perStack * (reached / 2)) / 100;
  }

  // Melee damage items: % of the hero's light melee on the hits it lands in a
  // trade. Colossus carries it on its active (7 s of 37 s), so it counts at
  // that uptime unless the API lists it as innate.
  const meleePct = s("BonusMeleeDamagePercent");
  if (meleePct > 0 && num(model.meleeDamage) > 0) {
    const uptime =
      timed && !innate?.has("BonusMeleeDamagePercent") && s("AbilityCooldown") > 0
        ? Math.min(1, s("AbilityDuration") / s("AbilityCooldown"))
        : 1;
    gunGain +=
      ((meleePct / 100) * num(model.meleeDamage) * MELEE_HITS_PER_TRADE * MELEE_LANDS * uptime) /
      TRADE_SECONDS;
  }

  return {
    gunDamage: (gunGain / dps.total) * 100,
    spiritDamage: (spiritGain / dps.total) * 100,
  };
}
