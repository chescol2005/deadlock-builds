// lib/engine/enemyHealth.ts — how much health a typical enemy has at this point
// in the game (2026-10-25, follow-up to Milestone G2c).
//
// Toxic Bullets and Siphon Bullets deal or steal % of the TARGET's max health.
// They were priced on a fixed 2,500 (REFERENCE_ENEMY_HEALTH), but enemy health
// grows over the game: max builds at boon 35 sit at 3,356 (Graves) to 4,629
// (Abrams) in the sandbox (user screenshots, 2026-10-25). Base health with boons
// alone is far lower (roster median 2,210 at boon 35), because most of it comes
// from the shop:
// - the vitality investment bonus (CATEGORY_BONUS_TIERS healthBonus, up to +56%
//   of base health): Abrams 2,515 x 1.56 + ~700 flat items = ~4,629;
// - flat item health (BonusHealth) and % base health (Colossus, Glass Cannon).
//
// So: enemy health = roster median base health at this boon level
//   x (1 + vitality bonus % + item % base health) + flat item health.
// The shop part is MEASURED from what Oracle+ players buy (heroPhaseItems.json:
// per-phase buy rates; heroCategorySplit.json: per-phase vitality share),
// as a rate per soul spent in each phase, accumulated over the souls so far.
// Pure: the rates are fitted offline by `npm run fit-category-split`.

import type { Item } from "../items";
import type { HeroBaseStats } from "../heroStats";
import { calculateStatsAtBoon } from "../heroStats";
import { getCurrentBonusTier } from "../categoryBonuses";
import { EARLY_PHASE_MAX_SOULS, MID_PHASE_MAX_SOULS } from "./categorySplit";
import type { CategorySplitTable, GamePhase } from "./categorySplit";
import type { PhaseItemsTable } from "./phaseItems";

const PHASES: ReadonlyArray<GamePhase> = ["early", "mid", "late"];

/** Per-phase rates of the shop part of enemy health, per soul spent in that phase. */
export interface EnemyHealthRates {
  /** Flat item health (BonusHealth) per soul. */
  flatHealthPerSoul: Record<GamePhase, number>;
  /** % of base health from items (Colossus +25, Glass Cannon -13) per soul. */
  basePercentPerSoul: Record<GamePhase, number>;
  /** Share of souls spent on vitality items (drives the investment bonus). */
  vitalityShare: Record<GamePhase, number>;
}

/**
 * Items whose BonusHealth is not the owner's max health: the API flags both
 * `ConditionallyApplied`. Unstable Concoction's 3,000 is a per-effect value,
 * Cultist Sacrifice's applies to its summon (data-verifier, 2026-10-25).
 */
const CONDITIONAL_HEALTH_ITEMS: ReadonlySet<string> = new Set([
  "upgrade_non_player_bonus_sacrifice",
  "upgrade_unstable_concoction",
]);

/** Flat max health an item gives its owner. */
export function itemFlatHealth(item: Item): number {
  if (CONDITIONAL_HEALTH_ITEMS.has(item.id)) return 0;
  const v = item.stats.BonusHealth;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** % of base health an item adds (Colossus) or removes (Glass Cannon). */
export function itemBaseHealthPercent(item: Item): number {
  const add = item.stats.BonusBaseHealth;
  const loss = item.stats.MaxHealthLossPercent; // stored negative
  return (Number.isFinite(add) ? add : 0) + (Number.isFinite(loss) ? loss : 0);
}

/** The vitality investment bonus (% max health) at this many souls in vitality items. */
export function vitalityHealthBonus(vitalitySouls: number): number {
  return getCurrentBonusTier(vitalitySouls)?.healthBonus ?? 0;
}

/**
 * What buying `item` adds over its direct components: an upgrade consumes them
 * and costs the difference (buildUtils.getEffectiveAddCost), and their own buys
 * are counted where they happened. So a chain counts its final health once.
 */
function marginal(item: Item, byId: ReadonlyMap<string, Item>) {
  const parts = (item.componentItems ?? []).flatMap((id) => {
    const c = byId.get(id);
    return c ? [c] : [];
  });
  const sum = (f: (i: Item) => number) => parts.reduce((s, c) => s + f(c), 0);
  return {
    cost: item.cost - sum((c) => c.cost),
    flat: itemFlatHealth(item) - sum(itemFlatHealth),
    pct: itemBaseHealthPercent(item) - sum(itemBaseHealthPercent),
  };
}

/**
 * Fits the rates from the two committed tables. Rates are roster-wide: every
 * hero's buys weighted equally (an enemy is any hero). Upgrades count only what
 * they add over their components (`marginal`). Accepted simplifications: items
 * sold later still count, and the late vitality share is the final inventory's
 * (it includes earlier buys) applied to late souls. Null when any phase has no
 * data, so the caller keeps the fixed reference everywhere.
 */
export function measureEnemyHealthRates(
  phaseItems: PhaseItemsTable,
  categorySplit: CategorySplitTable,
  items: ReadonlyArray<Item>,
): EnemyHealthRates | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  const rates: EnemyHealthRates = {
    flatHealthPerSoul: { early: 0, mid: 0, late: 0 },
    basePercentPerSoul: { early: 0, mid: 0, late: 0 },
    vitalityShare: { early: 0, mid: 0, late: 0 },
  };
  for (const phase of PHASES) {
    let flat = 0;
    let pct = 0;
    let souls = 0;
    for (const row of Object.values(phaseItems.heroes)) {
      for (const [id, rate] of Object.entries(row[phase])) {
        const item = byId.get(id);
        if (!item) continue;
        const m = marginal(item, byId);
        if (!(m.cost > 0)) continue;
        flat += rate * m.flat;
        pct += rate * m.pct;
        souls += rate * m.cost;
      }
    }
    if (!(souls > 0)) return null;
    rates.flatHealthPerSoul[phase] = round(flat / souls, 6);
    rates.basePercentPerSoul[phase] = round(pct / souls, 8);
    // Early / mid purchase splits; the final inventory stands for late.
    const shares = Object.values(categorySplit.heroes)
      .map((h) => (phase === "late" ? h.vitality : h[phase]?.vitality))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (shares.length === 0) return null;
    rates.vitalityShare[phase] = round(shares.reduce((a, b) => a + b, 0) / shares.length, 4);
  }
  return rates;
}

/** Souls spent in each phase, given the cumulative souls so far. */
function soulsByPhase(souls: number): Record<GamePhase, number> {
  const s = Math.max(0, souls);
  return {
    early: Math.min(s, EARLY_PHASE_MAX_SOULS),
    mid: Math.max(0, Math.min(s, MID_PHASE_MAX_SOULS) - EARLY_PHASE_MAX_SOULS),
    late: Math.max(0, s - MID_PHASE_MAX_SOULS),
  };
}

// The roster is fixed for a page, and runHeroBasket runs on every build edit.
const baseHealthCache = new WeakMap<ReadonlyArray<HeroBaseStats>, Map<number, number>>();

/** Median of the roster's max health at this boon level, before items. */
export function rosterBaseHealth(roster: ReadonlyArray<HeroBaseStats>, boonLevel: number): number {
  let byBoon = baseHealthCache.get(roster);
  if (!byBoon) {
    byBoon = new Map();
    baseHealthCache.set(roster, byBoon);
  }
  const cached = byBoon.get(boonLevel);
  if (cached !== undefined) return cached;
  const median = medianBaseHealth(roster, boonLevel);
  byBoon.set(boonLevel, median);
  return median;
}

function medianBaseHealth(roster: ReadonlyArray<HeroBaseStats>, boonLevel: number): number {
  const hp = roster
    .map((h) => calculateStatsAtBoon(h, boonLevel).maxHealth)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (hp.length === 0) return 0;
  const mid = Math.floor(hp.length / 2);
  return hp.length % 2 ? hp[mid] : (hp[mid - 1] + hp[mid]) / 2;
}

/**
 * A typical enemy's max health after `souls` cumulative souls at `boonLevel`.
 * Undefined when the roster or the rates are missing: the caller then keeps
 * REFERENCE_ENEMY_HEALTH (missing data is not zero).
 */
export function enemyHealthAt(input: {
  souls: number;
  boonLevel: number;
  roster: ReadonlyArray<HeroBaseStats>;
  rates?: EnemyHealthRates;
}): number | undefined {
  if (!input.rates) return undefined;
  const base = rosterBaseHealth(input.roster, input.boonLevel);
  if (!(base > 0)) return undefined;
  const spent = soulsByPhase(input.souls);
  let flat = 0;
  let pct = 0;
  let vitalitySouls = 0;
  for (const phase of PHASES) {
    flat += spent[phase] * input.rates.flatHealthPerSoul[phase];
    pct += spent[phase] * input.rates.basePercentPerSoul[phase];
    vitalitySouls += spent[phase] * input.rates.vitalityShare[phase];
  }
  return Math.round(base * (1 + (vitalityHealthBonus(vitalitySouls) + pct) / 100) + flat);
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
