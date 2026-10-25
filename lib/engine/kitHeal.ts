// lib/engine/kitHeal.ts — a hero's own self-healing, in HP per trade
// (Milestone G3, docs/milestone-g.md §3.2).
//
// The parser (abilityCoefficients.ts, KIT_SELF_HEAL_KEYS) records each
// ability's self-heal properties; this converts them to HP healed in one
// trade, through the same trade model as ability damage (heroDamage.ts:
// TRADE_SECONDS, castsPerTrade). Upgrade tiers count by the per-phase prior
// UPGRADE_CHARGE_CREDIT ("has this tier been bought by now"), as R2c does for
// charges.
//
// Used to value heal amplification (Healing Booster, Healing Tempo) per hero:
// it multiplies the healing the hero actually has.
//
// Pure: same inputs, same output.

import type { HeroAbility, SelfHeal } from "../abilityCoefficients";
import { damagePerCastFactor } from "../abilityCoefficients";
import type { GamePhase } from "./categorySplit";
import {
  castsPerTrade,
  MELEE_HITS_PER_TRADE,
  MELEE_LANDS,
  TRADE_SECONDS,
  UPGRADE_CHARGE_CREDIT,
} from "./heroDamage";

/** Share of max HP that is missing when a missing-HP heal lands (mid-trade). */
export const MISSING_HP_SHARE = 0.5;
/** Share of max HP a trade costs (damage taken), for heals on damage taken. */
export const TRADE_DAMAGE_TAKEN_SHARE = 0.5;

export interface KitHealContext {
  phase: GamePhase;
  spiritPower: number;
  maxHealth: number;
  /** Landed gun DPS and this hero's ability DPS (heroDamage.heroDps). */
  gunDps: number;
  abilityDps: number;
  /** Light melee damage per hit, when known. */
  meleeDamage?: number;
}

/** A heal property's value at this phase: base plus credited tiers, plus spirit scaling. */
export function selfHealValue(h: SelfHeal, phase: GamePhase, spiritPower: number): number {
  let value = h.base;
  let scale = h.spiritScale;
  for (let i = 0; i < 3; i += 1) {
    const credit = UPGRADE_CHARGE_CREDIT[(i + 1) as 1 | 2 | 3][phase];
    value += credit * h.tierBonus[i];
    scale += credit * h.tierSpiritScale[i];
  }
  return Math.max(0, value + scale * Math.max(0, spiritPower));
}

/** This ability's own damage in one trade (0 when it deals none). */
function ownDamagePerTrade(a: HeroAbility, spiritPower: number): number {
  const base = a.baseDamage ?? 0;
  const scaling = a.spiritScaling ?? 0;
  const perCast = (base + scaling * Math.max(0, spiritPower)) * damagePerCastFactor(a);
  // No cooldown = not a damaging cast, as heroDamage.abilityDps treats it.
  const cooldown = a.cooldown ?? 0;
  return perCast > 0 && cooldown > 0 ? perCast * castsPerTrade(cooldown) : 0;
}

/** HP one ability heals its caster in one trade. */
export function abilityHealPerTrade(a: HeroAbility, ctx: KitHealContext): number {
  if (!a.selfHeals || a.selfHeals.length === 0) return 0;
  const casts = castsPerTrade(a.cooldown ?? 0);
  // Seconds an effect lasts within the trade: its duration, or the whole trade.
  const lasts = Math.min(TRADE_SECONDS, a.duration && a.duration > 0 ? a.duration : TRADE_SECONDS);
  const hp = Math.max(0, ctx.maxHealth);
  let heal = 0;
  for (const h of a.selfHeals) {
    const v = selfHealValue(h, ctx.phase, ctx.spiritPower);
    if (!(v > 0)) continue;
    switch (h.kind) {
      case "abilityLifesteal": {
        const own = ownDamagePerTrade(a, ctx.spiritPower);
        // A buff with no damage of its own steals from the hero's abilities while up.
        const damage = own > 0 ? own : ctx.abilityDps * lasts * Math.min(1, casts);
        heal += (v / 100) * damage;
        break;
      }
      case "gunLifesteal":
        heal += (v / 100) * ctx.gunDps * lasts * Math.min(1, casts);
        break;
      case "meleeLifesteal":
        // The trade's melee hits that land while the buff is up.
        heal +=
          (v / 100) *
          (ctx.meleeDamage ?? 0) *
          MELEE_HITS_PER_TRADE *
          MELEE_LANDS *
          (lasts / TRADE_SECONDS) *
          Math.min(1, casts);
        break;
      case "flat":
        heal += v * casts;
        break;
      case "perSecond":
        heal += v * lasts * Math.min(1, casts);
        break;
      case "maxHpPercent":
        heal += (v / 100) * hp * casts;
        break;
      case "maxHpPercentPerSecond":
        heal += (v / 100) * hp * lasts * Math.min(1, casts);
        break;
      case "missingHpPercent":
        heal += (v / 100) * hp * MISSING_HP_SHARE * casts;
        break;
      case "incomingDamagePercent":
        heal += (v / 100) * hp * TRADE_DAMAGE_TAKEN_SHARE * Math.min(1, casts);
        break;
    }
  }
  return heal;
}

/** HP the hero's whole kit heals it in one trade. */
export function kitHealPerTrade(
  abilities: ReadonlyArray<HeroAbility>,
  ctx: KitHealContext,
): number {
  return abilities.reduce((sum, a) => sum + abilityHealPerTrade(a, ctx), 0);
}
