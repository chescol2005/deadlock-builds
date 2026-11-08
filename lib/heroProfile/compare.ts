// The roster compare table (Milestone O.5, docs/milestone-o.md §6 Q4): every
// hero x the lead metrics, short and long fight, plus the lean. Pure: the server
// ranks, the client only sorts, by value then hero id, so the order never
// depends on input order.

import { HERO_METRICS, type HeroMetricId } from "./metrics";
import type { Direction } from "./percentiles";
import type { HeroProfile, LateGameLean } from "./profile";

export type CompareColumnId = HeroMetricId;

export type CompareColumn = {
  id: CompareColumnId;
  label: string;
  direction: Direction;
  /** Shown in the simplified view too (the three headline leads). */
  simplified: boolean;
};

/**
 * Lead metrics in display order, plus the long-fight spirit lead (§3.2: the two
 * fight lengths are ranked separately). Only gun, spirit and vitality show in
 * the simplified view; melee and the long fight are advanced.
 */
const COMPARE_COLUMN_IDS: ReadonlyArray<{ id: CompareColumnId; simplified: boolean }> = [
  { id: "landedDps", simplified: true },
  { id: "kitSpiritShort", simplified: true },
  { id: "kitSpiritLong", simplified: false },
  { id: "maxHealth", simplified: true },
  { id: "heavyMelee", simplified: false },
];

export const COMPARE_COLUMNS: ReadonlyArray<CompareColumn> = COMPARE_COLUMN_IDS.map((c) => {
  const def = HERO_METRICS.find((d) => d.id === c.id);
  if (!def) throw new Error(`compare column ${c.id} is not a hero metric`);
  return { id: c.id, label: def.label, direction: def.direction, simplified: c.simplified };
});

export type CompareCell = { value: number | null; rank: number | null; percentile: number | null };

export type CompareRow = {
  heroId: number;
  name: string;
  icon: string | null;
  lean: LateGameLean | null;
  scalesIntoLongFights: boolean;
  accuracyEstimated: boolean;
  cells: Record<CompareColumnId, CompareCell>;
};

export type CompareHero = { id: number; name: string; icon: string | null };

/** One row per hero in `heroes` that has a profile, in hero id order. */
export function compareRows(
  profiles: ReadonlyMap<number, HeroProfile>,
  heroes: ReadonlyArray<CompareHero>,
): CompareRow[] {
  return [...heroes]
    .sort((a, b) => a.id - b.id)
    .flatMap((hero) => {
      const p = profiles.get(hero.id);
      if (!p) return [];
      const cells = {} as Record<CompareColumnId, CompareCell>;
      for (const col of COMPARE_COLUMNS) {
        const m = p.metrics[col.id];
        cells[col.id] = {
          value: m.value,
          rank: m.rank?.rank ?? null,
          percentile: m.rank?.percentile ?? null,
        };
      }
      return [
        {
          heroId: hero.id,
          name: hero.name,
          icon: hero.icon,
          lean: p.lean,
          scalesIntoLongFights: p.scalesIntoLongFights,
          accuracyEstimated: p.accuracyEstimated,
          cells,
        },
      ];
    });
}

export type CompareSortKey = CompareColumnId | "name" | "lean";

const LEAN_ORDER: Record<LateGameLean, number> = { gun: 0, hybrid: 1, spirit: 2, flexible: 3 };

/**
 * Sorted copy. `best` puts the best value first (respecting each metric's
 * direction); unknown values always sort last. Ties break by hero id, so the
 * order is the same whatever order the rows came in.
 */
export function sortCompareRows(
  rows: ReadonlyArray<CompareRow>,
  key: CompareSortKey,
  order: "best" | "worst",
): CompareRow[] {
  const sign = order === "best" ? 1 : -1;
  const column = COMPARE_COLUMNS.find((c) => c.id === key);
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (key === "name") cmp = sign * a.name.localeCompare(b.name);
    else if (key === "lean") {
      const la = a.lean == null ? null : LEAN_ORDER[a.lean];
      const lb = b.lean == null ? null : LEAN_ORDER[b.lean];
      if (la == null || lb == null) cmp = la == null ? (lb == null ? 0 : 1) : -1;
      else cmp = sign * (la - lb);
    } else if (column) {
      const va = a.cells[column.id].value;
      const vb = b.cells[column.id].value;
      if (va == null || vb == null) cmp = va == null ? (vb == null ? 0 : 1) : -1;
      else {
        const better = column.direction === "higher" ? vb - va : va - vb;
        cmp = sign * better;
      }
    }
    return cmp !== 0 ? cmp : a.heroId - b.heroId;
  });
}
