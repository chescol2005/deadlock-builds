// lib/engine/pairLift.ts
//
// Milestone F: measured item-PAIR win-rate interaction, the measured
// counterpart to the hand-authored SYNERGY_RULES (synergy.ts).
//
// Two halves, both pure:
// - FITTING math (pairInteraction … fitHeroPairs), used OFFLINE by
//   src/scripts/fitPairTable.ts (writes data/pairLiftTable.json) and
//   src/scripts/pairProbe.ts. Inputs are pre-fetched win/match counts; nothing
//   here touches the network.
// - The committed TABLE's types and lookups: heroPairLift (one hero's slice,
//   built server-side for the basket), pairLiftIn, pairLiftFor.
//
// Method, data caveats and measured results: engine-design-notes.md,
// "Milestone F spike" and "Pair lift table".

// ─── Fitting inputs ───────────────────────────────────────────────────────────

export interface WinCell {
  wins: number;
  matches: number;
}

/** One filter stratum (e.g. a final-net-worth band) for one hero. */
export interface PairStratum {
  /** The hero's total: every player-match on this hero in the stratum. */
  hero: WinCell;
  /** Keyed by numeric item id (Item.numericId). Counts PURCHASES (rebuys twice). */
  singles: ReadonlyMap<number, WinCell>;
  /** Keyed by pairStatKey: both purchase orders already summed. */
  pairs: ReadonlyMap<string, WinCell>;
}

/** Unordered numeric pair key, `lo:hi`. */
export function pairStatKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// ─── 2x2 interaction ──────────────────────────────────────────────────────────

/** Minimum matches in each of the four 2x2 groups for a stratum to count. */
export const MIN_GROUP_MATCHES = 20;

export interface PairInteraction {
  /** logit(AB) - logit(A only) - logit(B only) + logit(neither); 0 = additive. */
  logOr: number;
  variance: number;
  /** Win rate with both items, and what the two items predict on their own. */
  wrPair: number;
  wrExpected: number;
  pairMatches: number;
}

// +0.5 per cell (Haldane) keeps empty win/loss counts finite.
const logit = (c: WinCell) => Math.log((c.wins + 0.5) / (c.matches - c.wins + 0.5));
const logitVar = (c: WinCell) => 1 / (c.wins + 0.5) + 1 / (c.matches - c.wins + 0.5);
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * The (has A) x (has B) interaction for one pair in one stratum, or null when
 * a group is under MIN_GROUP_MATCHES or a derived cell is out of range.
 */
export function pairInteraction(st: PairStratum, a: number, b: number): PairInteraction | null {
  if (a === b) return null;
  const ab = st.pairs.get(pairStatKey(a, b));
  const sa = st.singles.get(a);
  const sb = st.singles.get(b);
  if (!ab || !sa || !sb) return null;

  const groups: WinCell[] = [
    ab,
    { wins: sa.wins - ab.wins, matches: sa.matches - ab.matches },
    { wins: sb.wins - ab.wins, matches: sb.matches - ab.matches },
    {
      wins: st.hero.wins - sa.wins - sb.wins + ab.wins,
      matches: st.hero.matches - sa.matches - sb.matches + ab.matches,
    },
  ];
  // Singles count purchases, not player-matches, so a derived cell can go
  // slightly out of range; skip rather than guess.
  for (const g of groups) {
    if (g.matches < MIN_GROUP_MATCHES || g.wins < 0 || g.wins > g.matches) return null;
  }

  const [lab, la, lb, ln] = groups.map(logit);
  return {
    logOr: lab - la - lb + ln,
    variance: groups.reduce((s, g) => s + logitVar(g), 0),
    wrPair: ab.wins / ab.matches,
    wrExpected: sigmoid(la + lb - ln),
    pairMatches: ab.matches,
  };
}

export interface PooledInteraction {
  logOr: number;
  se: number;
  strataUsed: number;
}

/** Inverse-variance pooling across strata; null when no stratum qualifies. */
export function poolInteractions(
  parts: ReadonlyArray<PairInteraction | null>,
): PooledInteraction | null {
  let sw = 0;
  let swx = 0;
  let used = 0;
  for (const p of parts) {
    if (!p) continue;
    const w = 1 / p.variance;
    sw += w;
    swx += w * p.logOr;
    used += 1;
  }
  if (used === 0) return null;
  return { logOr: swx / sw, se: Math.sqrt(1 / sw), strataUsed: used };
}

// ─── Shrinkage and item-wide effects ──────────────────────────────────────────

/**
 * Empirical-Bayes prior variance for shrinking toward ZERO: E[x^2] = tau^2 +
 * se^2 under a zero-centred prior, so tau^2 = mean(x^2) - mean(se^2) (method
 * of moments, floored at 0). Centring on the sample mean instead would
 * understate tau^2 whenever the estimates share a nonzero mean, and over-shrink.
 */
export function estimateTau2(estimates: ReadonlyArray<{ logOr: number; se: number }>): number {
  const n = estimates.length;
  if (n < 2) return 0;
  const meanSq = estimates.reduce((s, e) => s + e.logOr ** 2, 0) / n;
  const meanSe2 = estimates.reduce((s, e) => s + e.se ** 2, 0) / n;
  return Math.max(0, meanSq - meanSe2);
}

/** Shrink one estimate toward 0 by tau2 / (tau2 + se^2). tau2 = 0 gives 0. */
export function shrinkTowardZero(logOr: number, se: number, tau2: number): number {
  if (tau2 <= 0) return 0;
  return (logOr * tau2) / (tau2 + se ** 2);
}

/** Code-unit string order: the same order as `<`, pairLiftKey and the JSON, independent of ICU. */
export const compareIds = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/** Fixed sweep count for the additive item-effect fit; converges far sooner on real data. */
const ITEM_EFFECT_SWEEPS = 200;

export interface ItemEffects {
  /** Intercept of the additive fit value ~ grand + effect(a) + effect(b). */
  grand: number;
  /** Per item: fitted additive effect (mean 0 across items) and how many pairs it is in. */
  byItem: ReadonlyMap<string, { effect: number; pairs: number }>;
  /** Aligned with the input: value - grand - effect(a) - effect(b). */
  pairOnly: number[];
}

/**
 * Remove item-wide effects by least squares: fit value = grand + effect(a) +
 * effect(b) over the observed pairs (Gauss-Seidel, a fixed number of sweeps,
 * items in code-unit order), and return the residual as pairOnly. An item that
 * "interacts" with everything (bought when behind, bought only in long games)
 * is a per-item effect of WHEN it is bought, not a pair effect.
 *
 * Least squares, not per-item means: the pair graph is incomplete (pairs under
 * the match floor, chains, thin bands are missing), and plain means are only
 * exact on a complete graph. With means, an item in ONE pair got
 * pairOnly = grand - effect(partner), a number about the partner, not the
 * pair. Under least squares that pair's residual is 0 (it is all absorbed by
 * the item's own effect), and items in few pairs are filtered out separately
 * (MIN_ITEM_PAIRS in the fitter).
 */
export function removeItemEffects(
  rows: ReadonlyArray<{ a: string; b: string; value: number }>,
): ItemEffects {
  const n = rows.length;
  const incident = new Map<string, number[]>();
  rows.forEach((r, i) => {
    for (const id of [r.a, r.b]) {
      const list = incident.get(id) ?? [];
      list.push(i);
      incident.set(id, list);
    }
  });
  const ids = [...incident.keys()].sort(compareIds);
  const effect = new Map<string, number>(ids.map((id) => [id, 0]));
  const eff = (id: string) => effect.get(id) as number;
  let grand = rows.reduce((s, r) => s + r.value, 0) / Math.max(1, n);

  for (let sweep = 0; sweep < ITEM_EFFECT_SWEEPS && n > 0; sweep += 1) {
    for (const id of ids) {
      const list = incident.get(id) as number[];
      let sum = 0;
      for (const i of list) {
        const r = rows[i];
        sum += r.value - grand - eff(r.a === id ? r.b : r.a);
      }
      effect.set(id, sum / list.length);
    }
    grand = rows.reduce((s, r) => s + r.value - eff(r.a) - eff(r.b), 0) / n;
    // Identifiability: (effect + c, grand - 2c) fits identically; pin mean effect to 0.
    const c = ids.reduce((s, id) => s + eff(id), 0) / ids.length;
    for (const id of ids) effect.set(id, eff(id) - c);
    grand += 2 * c;
  }

  const byItem = new Map<string, { effect: number; pairs: number }>();
  for (const id of ids)
    byItem.set(id, { effect: eff(id), pairs: (incident.get(id) as number[]).length });
  return {
    grand,
    byItem,
    pairOnly: rows.map((r) => r.value - grand - eff(r.a) - eff(r.b)),
  };
}

/** Every item id reachable through component lists (all tiers down). */
export function componentClosure(
  id: string,
  componentsOf: (id: string) => ReadonlyArray<string> | undefined,
): Set<string> {
  const out = new Set<string>();
  const stack = [...(componentsOf(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (out.has(next)) continue;
    out.add(next);
    stack.push(...(componentsOf(next) ?? []));
  }
  return out;
}

// ─── Whole-hero fit ───────────────────────────────────────────────────────────

export interface FitItem {
  /** Item.id (class_name), what ItemCandidate.itemId carries. */
  id: string;
  componentItems?: ReadonlyArray<string>;
}

export interface PairFit {
  /** Item.id of each side, a < b. */
  a: string;
  b: string;
  raw: PairInteraction;
  banded: PooledInteraction;
  shrunk: number;
  pairOnly: number;
}

export interface HeroPairFit {
  pairs: PairFit[];
  tau2: number;
  itemEffects: ItemEffects;
  droppedChain: number;
  droppedUnknown: number;
}

/**
 * Fit every pair for one hero: raw 2x2 on the unfiltered stratum, pooled
 * across the net-worth bands, shrunk, then item-wide effects removed. Kept
 * pairs are sorted (code-unit order) BEFORE any float sum, so tau2, the item
 * effects and every output are identical whatever order the API returned rows in.
 * Throws if two numeric ids share a class name (the join would be ambiguous).
 */
export function fitHeroPairs(
  raw: PairStratum,
  bands: ReadonlyArray<PairStratum>,
  itemsByNumericId: ReadonlyMap<number, FitItem>,
  minPairMatches: number,
): HeroPairFit {
  const byId = new Map<string, FitItem>();
  for (const it of itemsByNumericId.values()) {
    if (byId.has(it.id)) throw new Error(`fitHeroPairs: duplicate item id ${it.id}`);
    byId.set(it.id, it);
  }
  const componentsOf = (id: string) => byId.get(id)?.componentItems;

  const kept: Array<Omit<PairFit, "shrunk" | "pairOnly">> = [];
  let droppedChain = 0;
  let droppedUnknown = 0;
  for (const key of [...raw.pairs.keys()].sort(compareIds)) {
    const cell = raw.pairs.get(key) as WinCell;
    if (cell.matches < minPairMatches) continue;
    const [na, nb] = key.split(":").map(Number);
    const ia = itemsByNumericId.get(na);
    const ib = itemsByNumericId.get(nb);
    if (!ia || !ib) {
      droppedUnknown += 1;
      continue;
    }
    if (
      componentClosure(ia.id, componentsOf).has(ib.id) ||
      componentClosure(ib.id, componentsOf).has(ia.id)
    ) {
      droppedChain += 1;
      continue;
    }
    const r = pairInteraction(raw, na, nb);
    const banded = poolInteractions(bands.map((s) => pairInteraction(s, na, nb)));
    if (!r || !banded) continue;
    const [a, b] = ia.id < ib.id ? [ia.id, ib.id] : [ib.id, ia.id];
    kept.push({ a, b, raw: r, banded });
  }
  kept.sort((x, y) => compareIds(x.a, y.a) || compareIds(x.b, y.b));

  const tau2 = estimateTau2(kept.map((k) => k.banded));
  const shrunk = kept.map((k) => shrinkTowardZero(k.banded.logOr, k.banded.se, tau2));
  const itemEffects = removeItemEffects(kept.map((k, i) => ({ a: k.a, b: k.b, value: shrunk[i] })));
  const pairs = kept.map((k, i) => ({
    ...k,
    shrunk: shrunk[i],
    pairOnly: itemEffects.pairOnly[i],
  }));

  return { pairs, tau2, itemEffects, droppedChain, droppedUnknown };
}

// ─── The committed table ──────────────────────────────────────────────────────

export interface PairLiftEntry {
  /** pairOnly: shrunk, net-worth-banded log odds ratio, item-wide effects removed. */
  lift: number;
  /**
   * Standard error of the BANDED estimate. lift is shrunk and has item effects
   * removed, so lift / se is a ranking threshold, not a z-score, and lift ± se
   * is not a confidence interval.
   */
  se: number;
  /** Matches where this hero's player bought both items (all bands). */
  n: number;
}

export interface PairLiftTable {
  version: 3;
  /** YYYY-MM-DD the fitter ran. */
  generated: string;
  window: { from: string; to: string };
  method: {
    gameMode: string;
    netWorthBands: number[];
    minPairMatches: number;
    minAbsZ: number;
    /** Both items must be in at least this many fitted pairs. */
    minItemPairs: number;
    /** Only matches whose average badge is this rank tier or above; null = all ranks. */
    minRank: number | null;
    /** Display name of minRank (e.g. "Oracle"), from /v1/assets/ranks. */
    minRankName: string | null;
    /** Length of the window in days. */
    days: number;
    /** rulePairs keeps a hand-rule pair's measurement only when se <= this. */
    ruleMaxSe: number;
  };
  /** heroId -> fit summary, for reviewing a refresh diff. */
  fits: Record<string, { matches: number; pairsFitted: number; kept: number; tau: number }>;
  /** heroId -> pairLiftKey -> entry. Only pairs with |lift| / se >= minAbsZ. */
  heroes: Record<string, Record<string, PairLiftEntry>>;
  /**
   * heroId -> pairLiftKey -> entry for SYNERGY_RULES pairs that override the
   * hand rule: measured precisely enough (se <= ruleMaxSe) WHATEVER their z (a
   * precise "about 0" is a real finding), or significant (also in heroes,
   * whatever their se). Heroes with none are absent.
   */
  rulePairs: Record<string, Record<string, PairLiftEntry>>;
  /**
   * AUDIT ONLY: never read by the engine (heroPairLift does not expose it).
   * heroId -> pairLiftKey -> entry for EVERY hand-authored pair, synergy and
   * anti-synergy, that was fitted for that hero, whatever its z or se, so the
   * synergy audit report can show "measured ~0" vs "no data". Absent = the pair
   * was not fitted (too few co-owning matches, a component chain, or thin bands).
   */
  handPairs: Record<string, Record<string, PairLiftEntry>>;
}

/** Unordered key over Item.id (class_name), `lo|hi`. */
export function pairLiftKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/**
 * Lift for a pair in one hero's entry map, in either order. null means NO DATA
 * (pair not measured, under the thresholds, or an item with itself), which is
 * not the same as a measured zero.
 */
export function pairLiftIn(
  entries: Readonly<Record<string, PairLiftEntry>> | undefined,
  idA: string,
  idB: string,
): PairLiftEntry | null {
  if (idA === idB || !entries) return null;
  return entries[pairLiftKey(idA, idB)] ?? null;
}

/** pairLiftIn over a whole table's significant pairs for one hero. */
export function pairLiftFor(
  table: PairLiftTable,
  heroId: number | string,
  idA: string,
  idB: string,
): PairLiftEntry | null {
  return pairLiftIn(table.heroes[String(heroId)], idA, idB);
}

/**
 * One hero's slice of the table: what the basket needs, small enough to pass
 * to a client component (never pass the whole table).
 */
export interface HeroPairLift {
  /** Significant pairs (|lift| / se >= minAbsZ), for pairTerm. */
  pairs: Readonly<Record<string, PairLiftEntry>>;
  /** Precisely measured SYNERGY_RULES pairs, for synergyTerm's override. */
  rulePairs: Readonly<Record<string, PairLiftEntry>>;
  /** Player-facing scope of the measurement, e.g. "Oracle+ matches, last 90 days". */
  scope: string;
}

/** This hero's slice, or null if the table has no fit for the hero at all. */
export function heroPairLift(table: PairLiftTable, heroId: number | string): HeroPairLift | null {
  const id = String(heroId);
  if (!table.fits[id]) return null;
  const rank = table.method.minRankName ? `${table.method.minRankName}+ matches` : "matches";
  return {
    pairs: table.heroes[id] ?? {},
    rulePairs: table.rulePairs[id] ?? {},
    scope: `${rank}, last ${table.method.days} days`,
  };
}
