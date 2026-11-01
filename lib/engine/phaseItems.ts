// lib/engine/phaseItems.ts — what high-rank players on each hero buy, per phase.
//
// Why this exists (2026-10-24): real openings follow a hero's kit in ways item
// maths cannot see. Abrams opens melee (Close Quarters 84%, Melee Charge 73%),
// Lady Geist regen (Mystic Regeneration 91%: her abilities cost health), Wraith
// Quicksilver Reload (94%, it pairs with her imbue), Haze fire rate (Rapid
// Rounds 89% then Swift Striker). With values alone, only 17 of ~50 early picks
// and 3 of 50 mid picks were in the hero's real top 10.
//
// The table holds, per hero and phase (0–10 / 10–20 / 20+ min), the share of
// high-rank matches in which the hero BOUGHT each item. `phaseItemTerm` in
// basketSelect.ts turns it into a bounded nudge. This is population data
// (what players do, not proof it is right), so it is capped and never the
// headline reason in the simplified view.
//
// GENERATED offline by `npm run fit-category-split` (src/scripts/
// fitCategorySplit.ts, same window and rank as the category split), committed,
// and sliced per hero on the server. Pure: nothing here fetches.

import type { GamePhase } from "./categorySplit";
import type { EnemyHealthRates } from "./enemyHealth";

/** Items under this buy rate are left out of the table (noise). */
export const PHASE_ITEM_MIN_RATE = 0.02;

/** Item.id -> share of matches (0..1] in which the hero bought it in that phase. */
export type ItemBuyRates = Readonly<Record<string, number>>;

export interface PhaseItemsTable {
  version: number;
  generated: string;
  window: { from: string; to: string };
  method: {
    minAverageBadge: number;
    minRankName: string;
    days: number;
    minMatches: number;
    minRate: number;
    measure: string;
  };
  heroes: Record<
    string,
    { matches: number; early: ItemBuyRates; mid: ItemBuyRates; late: ItemBuyRates }
  >;
  /**
   * Roster-wide rates for a typical enemy's health from the shop (enemyHealth.ts),
   * fitted in the same run. Absent on tables fitted before 2026-10-25.
   */
  enemyHealth?: EnemyHealthRates;
}

/** One hero's slice, as the basket reads it. */
export interface HeroPhaseItems {
  early: ItemBuyRates;
  mid: ItemBuyRates;
  late: ItemBuyRates;
  /** Human-readable scope, e.g. "Oracle+ players (last 30 days)". */
  scope: string;
}

/** Keeps only finite rates in (0, 1]; anything else is dropped, not zeroed. */
function validRates(rates: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!rates || typeof rates !== "object") return out;
  for (const [id, r] of Object.entries(rates as Record<string, unknown>)) {
    if (typeof r === "number" && Number.isFinite(r) && r > 0 && r <= 1) out[id] = r;
  }
  return out;
}

/**
 * This hero's slice of the table, or null when the hero is not in it (too few
 * matches): missing data means "no signal", never "nobody buys anything".
 */
export function heroPhaseItems(table: PhaseItemsTable, heroId: number): HeroPhaseItems | null {
  // A malformed table fails open (no signal) rather than throwing at render.
  const row = table?.heroes?.[String(heroId)];
  if (!row) return null;
  return {
    early: validRates(row.early),
    mid: validRates(row.mid),
    late: validRates(row.late),
    scope: `${table.method.minRankName}+ players (last ${table.method.days} days)`,
  };
}

/**
 * The table's roster-wide enemy health rates (enemyHealth.ts), read on the
 * server like the slice but NOT part of it: an enemy is any hero, so a hero
 * missing from the table (or phaseItemTerm switched off) still gets them.
 * Undefined when absent or malformed (fail open: the fixed reference health).
 */
export function enemyHealthRates(table: PhaseItemsTable): EnemyHealthRates | undefined {
  const rates: unknown = table?.enemyHealth;
  if (!rates || typeof rates !== "object") return undefined;
  const r = rates as Record<string, Record<string, unknown> | undefined>;
  const valid = (key: keyof EnemyHealthRates, ok: (v: number) => boolean) =>
    (["early", "mid", "late"] as const).every((p) => {
      const v = r[key]?.[p];
      return typeof v === "number" && Number.isFinite(v) && ok(v);
    });
  // Flat health and shares are never negative and shares are at most 1; the %
  // base health can be (Glass Cannon removes 13%).
  return valid("flatHealthPerSoul", (v) => v >= 0) &&
    valid("basePercentPerSoul", () => true) &&
    valid("vitalityShare", (v) => v >= 0 && v <= 1)
    ? (rates as EnemyHealthRates)
    : undefined;
}

/**
 * What this hero's players typically pay per item in one phase: the buy-rate-weighted
 * mean price (Σ rate × cost / Σ rate) over the phase's listed items with a known price.
 * Milestone I's reference price for `phaseItemTerm`; undefined when nothing is priced.
 */
export function phaseReferenceCost(
  rates: Readonly<Record<string, number>>,
  costOf: (itemId: string) => number | undefined,
): number | undefined {
  let weighted = 0;
  let total = 0;
  // Sorted, so the float sum never depends on the table's key order.
  for (const id of Object.keys(rates).sort()) {
    const cost = costOf(id);
    const rate = rates[id];
    if (cost === undefined || !Number.isFinite(cost) || cost <= 0) continue;
    weighted += rate * cost;
    total += rate;
  }
  return total > 0 ? weighted / total : undefined;
}

/** How the reason names the phase's buy window. */
export function phaseItemBasis(phase: GamePhase): string {
  if (phase === "early") return "buy it in the first 10 minutes";
  if (phase === "mid") return "buy it from minute 10 to 20";
  return "buy it after minute 20";
}
