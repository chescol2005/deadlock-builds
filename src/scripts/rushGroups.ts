// src/scripts/rushGroups.ts — Milestone J's rush groups (docs/milestone-j.md): what the
// players who made the build's own early rush choice buy, for the M1 and O2 guards in
// Fixture 13. Pure: the committed table (src/scripts/data/heroRushGroups.json, written by
// `npm run fit-rush-groups`) in, splits and top items out. Only fixtures read it; the
// engine never does.

import type { CategoryShares } from "@/lib/engine/categorySplit";
import type { Item } from "@/lib/items";

/** Purchases per item id in one phase column: player-matches that bought it there. */
export type PhaseCounts = Readonly<Record<string, number>>;

/** One group's purchases: early = 0–9 min, mid = 9–20 min (item-flow-stats columns). */
export interface GroupCounts {
  matches: number;
  early: PhaseCounts;
  mid: PhaseCounts;
}

export interface HeroRushGroups {
  /** The hero's top early 3,200+ item (topRushItem on heroPhaseItems.json), or null. */
  rushItem: string | null;
  all: GroupCounts;
  /** Players who bought rushItem in the first 9 minutes; absent when rushItem is null. */
  rushers?: GroupCounts;
}

export interface RushGroupsTable {
  version: 1;
  generated: string;
  window: { from: string; to: string };
  method: {
    minAverageBadge: number;
    source: string;
    /** Items kept: bought in the column by at least this share of all players. */
    minShare: number;
    measure: string;
  };
  heroes: Record<string, HeroRushGroups>;
}

export type RushGroupLabel = "rushers" | "non-rushers" | "all players";

export interface RushGroup {
  label: RushGroupLabel;
  counts: GroupCounts;
}

/** all − rushers, item by item (rushers are a subset of all; never below 0). */
function minus(a: GroupCounts, b: GroupCounts): GroupCounts {
  const sub = (x: PhaseCounts, y: PhaseCounts) =>
    Object.fromEntries(Object.entries(x).map(([id, n]) => [id, Math.max(0, n - (y[id] ?? 0))]));
  return {
    matches: Math.max(0, a.matches - b.matches),
    early: sub(a.early, b.early),
    mid: sub(a.mid, b.mid),
  };
}

/**
 * The players who made the build's early choice about the hero's rush item: rushers when
 * the build's early phase holds it, non-rushers when it doesn't, all players when the
 * hero has no rush item (docs/milestone-j.md §4.1).
 */
export function sameChoiceGroup(
  entry: HeroRushGroups,
  earlyItemIds: ReadonlyArray<string>,
): RushGroup {
  if (entry.rushItem === null || !entry.rushers) return { label: "all players", counts: entry.all };
  return earlyItemIds.includes(entry.rushItem)
    ? { label: "rushers", counts: entry.rushers }
    : { label: "non-rushers", counts: minus(entry.all, entry.rushers) };
}

/** Gun / spirit / vitality shares of the souls a group spent in one phase; null if none. */
export function groupShares(
  counts: PhaseCounts,
  itemById: ReadonlyMap<string, Item>,
): CategoryShares | null {
  const s = { gun: 0, spirit: 0, vitality: 0 };
  for (const [id, n] of Object.entries(counts)) {
    const item = itemById.get(id);
    if (item) s[item.category] += n * item.cost;
  }
  const t = s.gun + s.spirit + s.vitality;
  return t > 0 ? { gun: s.gun / t, spirit: s.spirit / t, vitality: s.vitality / t } : null;
}

/** The group's n most bought items in one phase (ties by id). */
export function groupTopIds(counts: PhaseCounts, n: number): Set<string> {
  return new Set(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([id]) => id),
  );
}

/**
 * G2's integrity check: the rushers are a subset of all players, item by item. Returns
 * the first violation, or null.
 */
export function rushGroupsProblem(entry: HeroRushGroups): string | null {
  if ((entry.rushItem === null) !== (entry.rushers === undefined)) {
    return "rushers present without a rush item, or missing with one";
  }
  const r = entry.rushers;
  if (!r) return null;
  if (r.matches > entry.all.matches) return `rushers ${r.matches} > all ${entry.all.matches}`;
  for (const phase of ["early", "mid"] as const) {
    for (const [id, n] of Object.entries(r[phase])) {
      const all = entry.all[phase][id];
      if (all === undefined || n > all) return `${phase} ${id}: rushers ${n} > all ${all ?? 0}`;
    }
  }
  return null;
}
