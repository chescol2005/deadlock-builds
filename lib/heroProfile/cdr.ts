// Cooldown reduction impact for strong abilities (Milestone O §3.3). A display
// annotation only: ranks stay item-free, so nothing here changes a rank.
//
// The ladder is hand-authored from deadlock.wiki/Cooldown_Reduction (checked
// 2026-11-06); each setup's % is read from the LIVE item, so a patch moves the
// numbers without a code change. A missing item drops its setup, never falls
// back to a hardcoded percentage.

import type { Item } from "@/lib/items";
import { FIGHT_LENGTHS, type FightLength } from "./fight";
import { castsInFight, type AbilityT3, type CastContext } from "./abilities";

/** Abilities at or above this percentile of their pool on scaling per cast get the annotation. */
export const CDR_SPOTLIGHT_PERCENTILE = 75;

/** The fire-rate step for the resource gate's sensitivity (§3.3): +10%. */
export const FIRE_RATE_STEP = 0.1;

type LadderEntry = {
  id: string;
  label: string;
  items: ReadonlyArray<string>;
  /** Compress Cooldown imbues ONE ability: it counts only on that ability. */
  thisAbilityOnly?: boolean;
};

/**
 * Compress -> Superior -> Transcendent Cooldown is one upgrade line (each
 * consumes the one before), so a build holds one of them. Left out: Enchanter's
 * Emblem (only above 65% health), Witchmail (seconds per hit, not a %), Mystic
 * Conduit (tier 5, Street Brawl only).
 */
export const CDR_LADDER: ReadonlyArray<LadderEntry> = [
  {
    id: "compress",
    label: "Compress Cooldown, on this ability",
    items: ["upgrade_magic_tempo"],
    thisAbilityOnly: true,
  },
  { id: "superior", label: "Superior Cooldown", items: ["upgrade_cooldown_reduction"] },
  { id: "transcendent", label: "Transcendent Cooldown", items: ["upgrade_transcendent_cooldown"] },
  {
    id: "transcendentSpellslinger",
    label: "Transcendent Cooldown + Spellslinger",
    items: ["upgrade_transcendent_cooldown", "upgrade_enchanted_holsters"],
  },
];

export type CdrSetup = {
  id: string;
  label: string;
  items: ReadonlyArray<string>;
  thisAbilityOnly: boolean;
  /** Total reduction, 0-1: 1 - product(1 - r_i). */
  reduction: number;
  /** Full souls of the setup: each item's cost already includes its components. */
  souls: number;
};

/** CDR from several items multiplies (deadlock.wiki/Cooldown_Reduction, no cap stated). */
export function combinedReduction(shares: ReadonlyArray<number>): number {
  return 1 - shares.reduce((keep, r) => keep * (1 - r), 1);
}

/**
 * The ladder with live values. `missing` lists the item class names not found
 * (or without a CooldownReduction): their setups are dropped, and the caller
 * logs it.
 */
export function cdrLadder(items: ReadonlyArray<Pick<Item, "id" | "cost" | "stats">>): {
  setups: CdrSetup[];
  missing: string[];
} {
  const byId = new Map(items.map((i) => [i.id, i]));
  const missing = new Set<string>();
  const setups: CdrSetup[] = [];
  for (const entry of CDR_LADDER) {
    const found = entry.items.map((id) => {
      const item = byId.get(id);
      const pct = item?.stats.CooldownReduction;
      if (!item || !(typeof pct === "number" && pct > 0)) missing.add(id);
      return item && typeof pct === "number" && pct > 0 ? { pct, cost: item.cost } : null;
    });
    if (found.some((f) => f == null)) continue;
    const ok = found.filter((f): f is { pct: number; cost: number } => f != null);
    setups.push({
      id: entry.id,
      label: entry.label,
      items: entry.items,
      thisAbilityOnly: entry.thisAbilityOnly ?? false,
      reduction: combinedReduction(ok.map((f) => f.pct / 100)),
      souls: ok.reduce((s, f) => s + f.cost, 0),
    });
  }
  return { setups, missing: [...missing].sort() };
}

export type CdrSetupImpact = {
  setupId: string;
  casts: number;
  /** Damage gain: casts with / casts without, minus 1 (damage per cast is unchanged). */
  gain: number;
  /** Gain per 1,000 souls of the setup. */
  gainPer1000Souls: number;
  /** The best gain per soul in this fight length (ties: the earlier setup). False when nothing gains. */
  best: boolean;
};

export type CdrFightImpact = {
  /** Avg casts per fight with no items. */
  casts: number;
  setups: CdrSetupImpact[];
};

export type CdrImpact = {
  fights: Record<FightLength, CdrFightImpact>;
  /**
   * Resource gate only (Card Trick): extra cards per fight from +10% fire rate,
   * short and long. Null for every other gate.
   */
  fireRateStep: Record<FightLength, number> | null;
};

/** CDR impact of every setup on one ability. Null when its casts are unknown. */
export function cdrImpact(
  ability: Pick<AbilityT3, "gate">,
  ctx: CastContext,
  setups: ReadonlyArray<CdrSetup>,
): CdrImpact | null {
  const fights = {} as Record<FightLength, CdrFightImpact>;
  for (const length of Object.keys(FIGHT_LENGTHS) as FightLength[]) {
    const F = FIGHT_LENGTHS[length];
    const base = castsInFight(ability, F, { ...ctx, cdr: 0 });
    if (base == null || !(base > 0)) return null;
    const rows = setups.map((s) => {
      const casts = castsInFight(ability, F, { ...ctx, cdr: s.reduction }) ?? base;
      const gain = casts / base - 1;
      return {
        setupId: s.id,
        casts,
        gain,
        gainPer1000Souls: s.souls > 0 ? gain / (s.souls / 1000) : 0,
        best: false,
      };
    });
    let bestIndex = -1;
    rows.forEach((row, i) => {
      if (
        row.gain > 1e-9 &&
        (bestIndex < 0 || row.gainPer1000Souls > rows[bestIndex].gainPer1000Souls)
      )
        bestIndex = i;
    });
    fights[length] = {
      casts: base,
      setups: rows.map((row, i) => (i === bestIndex ? { ...row, best: true } : row)),
    };
  }

  let fireRateStep: CdrImpact["fireRateStep"] = null;
  if (ability.gate.kind === "resource") {
    const step = {} as Record<FightLength, number>;
    for (const length of Object.keys(FIGHT_LENGTHS) as FightLength[]) {
      const F = FIGHT_LENGTHS[length];
      const at = castsInFight(ability, F, { ...ctx, cdr: 0 }) ?? 0;
      const up =
        castsInFight(ability, F, { ...ctx, cdr: 0, fireRateScale: 1 + FIRE_RATE_STEP }) ?? 0;
      step[length] = up - at;
    }
    fireRateStep = step;
  }
  return { fights, fireRateStep };
}
