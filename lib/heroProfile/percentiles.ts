// Roster percentile ranking (Milestone O §4, docs/milestone-o.md). Pure and
// deterministic: the same entries in any order give the same ranks.

/** Which way a metric improves. */
export type Direction = "higher" | "lower";

/** One entry's standing in its pool. */
export type MetricRank = {
  /** 1 + the number of entries strictly better. Tied entries share a rank. */
  rank: number;
  /** Entries in the pool with a known value. */
  n: number;
  /**
   * 0 (worst) to 100 (best): (strictly worse + 0.5 x (equal - 1)) / (n - 1) x 100.
   * Null when n < 2, where there is nothing to compare against.
   */
  percentile: number | null;
};

/**
 * Values this close count as equal. Metrics are computed in floating point
 * (sustained DPS x accuracy, resist x boons), so two heroes with the same raw
 * stats must not split on rounding noise.
 */
const TIE_EPSILON = 1e-9;

/** A usable value: finite. Null, NaN and infinities mean "unknown", never 0. */
export function isKnown(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= TIE_EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Ranks every entry with a known value against the others. Entries with an
 * unknown value are left out of the pool (so `n` drops) and map to null.
 */
export function percentileRanks<K>(
  entries: ReadonlyArray<{ key: K; value: number | null }>,
  direction: Direction,
): Map<K, MetricRank | null> {
  const known = entries.filter((e): e is { key: K; value: number } => isKnown(e.value));
  const n = known.length;
  const out = new Map<K, MetricRank | null>();

  for (const entry of entries) {
    if (!isKnown(entry.value)) {
      out.set(entry.key, null);
      continue;
    }
    const value = entry.value;
    let better = 0;
    let worse = 0;
    let equal = 0;
    for (const other of known) {
      if (sameValue(other.value, value)) equal += 1;
      else if (direction === "higher" ? other.value > value : other.value < value) better += 1;
      else worse += 1;
    }
    out.set(entry.key, {
      rank: 1 + better,
      n,
      percentile: n < 2 ? null : ((worse + 0.5 * (equal - 1)) / (n - 1)) * 100,
    });
  }
  return out;
}

/**
 * The lower median of the known values, or null when there are none. Lower,
 * not the mean of the middle two, so it is always a value some entry has.
 */
export function lowerMedian(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter(isKnown).sort((a, b) => a - b);
  if (known.length === 0) return null;
  return known[Math.floor((known.length - 1) / 2)] ?? null;
}
