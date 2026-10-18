// src/scripts/pairProbe.ts — Milestone F spike: measured item-pair interaction
// Run: npm run pair-probe -- <hero> [--rank T] [--days N] [--bands a,b,c] [--pair a,b] [--top N]
//
// Asks one question of live match data: once the wealth confound is held
// fixed, do item PAIRS win more (or less) than their two items predict on their
// own? Read-only exploration, nothing here feeds the engine. Findings go in
// engine-design-notes.md ("Milestone F spike").
//
// Data (verified by data-verifier, see the notes):
// - /v1/analytics/item-permutation-stats?comb_size=2 — ORDERED pairs
//   [bought-first, bought-second]; each unordered pair can appear twice, so the
//   two orders are summed. "Owned" means EVER PURCHASED in that match: sold items
//   and consumed components count, so component -> upgrade pairs are dropped.
// - /v1/analytics/item-stats — singles. Counts PURCHASES, so a rebuy counts
//   twice (small, accepted mismatch with pairs, which count player-matches).
// - /v1/analytics/hero-stats — the hero's total, for the "neither" cell.
// All three get the SAME explicit time window and filters on every call.
//
// Method: per pair, a 2x2 table of (has A) x (has B) for this hero's players.
// The interaction is the log odds ratio
//   logit(AB) - logit(A only) - logit(B only) + logit(neither)
// = 0 when the pair is exactly what the two items predict on their own.
// "Richer players own more items and win more" inflates it, so it is computed
// both raw and within final-net-worth bands (pooled by inverse variance), then
// shrunk toward 0 by an empirical-Bayes factor estimated across all pairs.
//
// Live network, NOT a fixture: results move with patches and match data.

import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import type { Item } from "@/lib/items";
import { SYNERGY_RULES } from "@/lib/engine/synergy";

const ANALYTICS_BASE = "https://api.deadlock-api.com/v1/analytics";
const DAY_S = 86_400;

const USAGE = `Usage: npm run pair-probe -- <hero> [options]

  <hero>          hero id (e.g. 76) or name (e.g. graves, "lady geist")

Options:
  --rank T        rank tier 0-11 (badge T0-T9); default: all ranks
  --days N        window length in days, ending at today 00:00 UTC (default 30)
  --bands a,b,c   final-net-worth band edges in souls (default 0,15000,25000,35000,45000,60000;
                  the last band is open-ended)
  --min N         minimum matches with BOTH items (all bands) to rank a pair (default 500)
  --pair a,b      also report this pair: item ids or names (repeatable)
  --top N         rows in each of the top-positive / top-negative lists (default 15)
`;

interface ProbeArgs {
  hero: string;
  rank: number | null;
  days: number;
  bands: number[];
  min: number;
  pairs: Array<[string, string]>;
  top: number;
}

function fail(message: string): never {
  console.error(`pairProbe: ${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseIntArg(flag: string, raw: string | undefined, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n) || n < min || n > max) {
    fail(`${flag} needs an integer from ${min} to ${max}, got ${raw ?? "nothing"}`);
  }
  return n;
}

function parseArgs(argv: string[]): ProbeArgs {
  const out: ProbeArgs = {
    hero: "",
    rank: null,
    days: 30,
    bands: [0, 15000, 25000, 35000, 45000, 60000],
    min: 500,
    pairs: [],
    top: 15,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--rank") {
      out.rank = parseIntArg(a, argv[++i], 0, 11);
    } else if (a === "--days") {
      out.days = parseIntArg(a, argv[++i], 1, 90);
    } else if (a === "--bands") {
      const edges = (argv[++i] ?? "").split(",").map((s) => Number(s.trim()));
      if (
        edges.length < 2 ||
        edges.some((e, k) => !Number.isInteger(e) || e < 0 || (k > 0 && e <= edges[k - 1]))
      ) {
        fail("--bands needs at least two increasing non-negative integers");
      }
      out.bands = edges;
    } else if (a === "--min") {
      out.min = parseIntArg(a, argv[++i], 1, 10_000_000);
    } else if (a === "--pair") {
      const parts = (argv[++i] ?? "").split(",").map((s) => s.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) fail("--pair needs two items: a,b");
      out.pairs.push([parts[0], parts[1]]);
    } else if (a === "--top") {
      out.top = parseIntArg(a, argv[++i], 1, 500);
    } else if (a.startsWith("--")) {
      fail(`unknown option ${a}`);
    } else if (out.hero === "") {
      out.hero = a;
    } else {
      fail(`unexpected argument ${a}`);
    }
  }
  if (out.hero === "") fail("missing <hero>");
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function findItem(allItems: Item[], query: string): Item {
  const q = norm(query);
  const hit =
    allItems.find((i) => i.id === query) ??
    allItems.find((i) => norm(i.id) === q) ??
    allItems.find((i) => norm(i.name) === q);
  if (!hit) fail(`no item matches "${query}" (use an item id like upgrade_crackshot or its name)`);
  return hit;
}

const fmt = (n: number, d = 2) => n.toFixed(d);
const signed = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;
const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));
const lpad = (s: string, w: number) => (s.length >= w ? s : " ".repeat(w - s.length) + s);

// ─── Fetching ─────────────────────────────────────────────────────────────────

interface Cell {
  wins: number;
  matches: number;
}

interface WinRow {
  wins: number;
  matches: number;
}
interface ItemRow extends WinRow {
  item_id: number;
}
interface PairRow extends WinRow {
  item_ids: number[];
}
interface HeroRow extends WinRow {
  hero_id: number;
}

type Params = Record<string, string | number>;

async function getJson<T>(path: string, params: Params): Promise<T> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${ANALYTICS_BASE}/${path}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

interface Stratum {
  label: string;
  hero: Cell;
  singles: Map<number, Cell>;
  /** Unordered pair key `lo:hi` -> both purchase orders summed. */
  pairs: Map<string, Cell>;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

async function loadStratum(label: string, heroId: number, filters: Params): Promise<Stratum> {
  // hero-stats has no hero filter: it returns every hero, so pick ours out.
  // min_matches=1 on pairs: the server's default floor (20) applies per ORDERED
  // row, which would silently drop the rarer purchase order of a pair.
  const [heroRows, itemRows, pairRows] = await Promise.all([
    getJson<HeroRow[]>("hero-stats", filters),
    getJson<ItemRow[]>("item-stats", { ...filters, hero_id: heroId, min_matches: 1 }),
    getJson<PairRow[]>("item-permutation-stats", {
      ...filters,
      hero_id: heroId,
      comb_size: 2,
      min_matches: 1,
    }),
  ]);

  const heroRow = heroRows.find((r) => Number(r.hero_id) === heroId);
  const hero: Cell = { wins: heroRow?.wins ?? 0, matches: heroRow?.matches ?? 0 };

  const singles = new Map<number, Cell>();
  for (const r of itemRows) {
    const c = singles.get(r.item_id) ?? { wins: 0, matches: 0 };
    c.wins += r.wins;
    c.matches += r.matches;
    singles.set(r.item_id, c);
  }

  const pairs = new Map<string, Cell>();
  for (const r of pairRows) {
    if (r.item_ids.length !== 2 || r.item_ids[0] === r.item_ids[1]) continue;
    const key = pairKey(r.item_ids[0], r.item_ids[1]);
    const c = pairs.get(key) ?? { wins: 0, matches: 0 };
    c.wins += r.wins;
    c.matches += r.matches;
    pairs.set(key, c);
  }

  return { label, hero, singles, pairs };
}

// ─── Statistics ───────────────────────────────────────────────────────────────

/** Minimum matches in each of the four 2x2 groups for a stratum to count. */
const MIN_GROUP_MATCHES = 20;

interface Interaction {
  logOr: number;
  variance: number;
  /** Win rate with both items, and what the two items predict on their own. */
  wrPair: number;
  wrExpected: number;
  pairMatches: number;
}

const logit = (wins: number, matches: number) => Math.log((wins + 0.5) / (matches - wins + 0.5));
const logitVar = (wins: number, matches: number) => 1 / (wins + 0.5) + 1 / (matches - wins + 0.5);
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** The 2x2 interaction for one pair in one stratum, or null if a group is too thin. */
function interaction(st: Stratum, a: number, b: number): Interaction | null {
  const ab = st.pairs.get(pairKey(a, b));
  const sa = st.singles.get(a);
  const sb = st.singles.get(b);
  if (!ab || !sa || !sb) return null;

  const groups: Cell[] = [
    ab,
    { wins: sa.wins - ab.wins, matches: sa.matches - ab.matches },
    { wins: sb.wins - ab.wins, matches: sb.matches - ab.matches },
    {
      wins: st.hero.wins - sa.wins - sb.wins + ab.wins,
      matches: st.hero.matches - sa.matches - sb.matches + ab.matches,
    },
  ];
  // Rebuys make singles count purchases, not player-matches, so a derived cell
  // can go slightly out of range; skip rather than guess.
  for (const g of groups) {
    if (g.matches < MIN_GROUP_MATCHES || g.wins < 0 || g.wins > g.matches) return null;
  }

  const [lab, la, lb, ln] = groups.map((g) => logit(g.wins, g.matches));
  return {
    logOr: lab - la - lb + ln,
    variance: groups.reduce((s, g) => s + logitVar(g.wins, g.matches), 0),
    wrPair: ab.wins / ab.matches,
    wrExpected: sigmoid(la + lb - ln),
    pairMatches: ab.matches,
  };
}

interface Pooled {
  logOr: number;
  se: number;
  strataUsed: number;
}

/** Inverse-variance pooling across net-worth bands. */
function pool(parts: Array<Interaction | null>): Pooled | null {
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

/** Item ids reachable through component_items (all tiers down). */
function componentClosure(item: Item, byId: Map<string, Item>): Set<string> {
  const out = new Set<string>();
  const stack = [...(item.componentItems ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(byId.get(id)?.componentItems ?? []));
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[s.length >> 1];
};

// ─── Main ─────────────────────────────────────────────────────────────────────

interface PairResult {
  a: Item;
  b: Item;
  raw: Interaction;
  banded: Pooled;
  shrunk: number;
  /** shrunk minus both items' item-wide effects: the pair-specific remainder. */
  pairOnly: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const [heroes, allItems] = await Promise.all([fetchVisibleHeroesEnriched(), getItems()]);
  const heroQuery = norm(args.hero);
  const hero =
    heroes.find((h) => String(h.id) === args.hero) ??
    heroes.find((h) => norm(h.name) === heroQuery);
  if (!hero) fail(`no visible hero matches "${args.hero}"`);
  const heroId = Number(hero.id);

  const byNumeric = new Map<number, Item>();
  const byId = new Map<string, Item>();
  for (const it of allItems) {
    byNumeric.set(it.numericId, it);
    byId.set(it.id, it);
  }

  // Pin the window: the API's default "30 days ago" moves between calls.
  const maxTs = Math.floor(Date.now() / 1000 / DAY_S) * DAY_S;
  const minTs = maxTs - args.days * DAY_S;
  const base: Params = {
    game_mode: "normal",
    min_unix_timestamp: minTs,
    max_unix_timestamp: maxTs,
  };
  if (args.rank !== null) {
    base.min_average_badge = args.rank * 10;
    base.max_average_badge = args.rank * 10 + 9;
  }

  const bandFilters: Array<{ label: string; filters: Params }> = args.bands.map((lo, k) => {
    const hi = args.bands[k + 1];
    const filters: Params = { ...base, min_networth: lo };
    if (hi !== undefined) filters.max_networth = hi - 1;
    return { label: hi === undefined ? `${lo}+` : `${lo}-${hi - 1}`, filters };
  });

  console.log(`\nLoading ${1 + bandFilters.length} strata x 3 endpoints for ${hero.name}...`);
  const raw = await loadStratum("all", heroId, base);
  const bands: Stratum[] = [];
  for (const b of bandFilters) bands.push(await loadStratum(b.label, heroId, b.filters));

  console.log(`\n=== ${hero.name} (hero ${heroId}) — measured pair interaction ===`);
  console.log(
    `Window: ${new Date(minTs * 1000).toISOString().slice(0, 10)} to ${new Date(maxTs * 1000)
      .toISOString()
      .slice(0, 10)} (${args.days}d), game_mode normal, ` +
      (args.rank === null
        ? "all ranks"
        : `rank tier ${args.rank} (badge ${args.rank * 10}-${args.rank * 10 + 9})`),
  );
  console.log(
    `All: ${raw.hero.matches} player-matches, win rate ${fmt((100 * raw.hero.wins) / Math.max(1, raw.hero.matches), 1)}%; ` +
      `${raw.singles.size} items, ${raw.pairs.size} unordered pairs`,
  );
  console.log("Final-net-worth bands:");
  for (const s of bands) {
    console.log(
      `  ${pad(s.label, 13)} ${lpad(String(s.hero.matches), 9)} matches, win rate ` +
        `${fmt((100 * s.hero.wins) / Math.max(1, s.hero.matches), 1)}%, ${s.pairs.size} pairs`,
    );
  }

  // Every pair with enough data, minus component -> upgrade chains.
  const results: PairResult[] = [];
  let droppedChain = 0;
  let droppedUnknown = 0;
  for (const [key, cell] of raw.pairs) {
    if (cell.matches < args.min) continue;
    const [na, nb] = key.split(":").map(Number);
    const a = byNumeric.get(na);
    const b = byNumeric.get(nb);
    if (!a || !b) {
      droppedUnknown += 1;
      continue;
    }
    if (componentClosure(a, byId).has(b.id) || componentClosure(b, byId).has(a.id)) {
      droppedChain += 1;
      continue;
    }
    const r = interaction(raw, na, nb);
    const banded = pool(bands.map((s) => interaction(s, na, nb)));
    if (!r || !banded) continue;
    results.push({ a, b, raw: r, banded, shrunk: 0, pairOnly: 0 });
  }

  // Empirical-Bayes shrinkage toward 0: tau^2 = spread of the estimates beyond
  // what their sampling error explains (method of moments, floored at 0).
  const est = results.map((r) => r.banded.logOr);
  const meanEst = est.reduce((s, x) => s + x, 0) / Math.max(1, est.length);
  const varEst = est.reduce((s, x) => s + (x - meanEst) ** 2, 0) / Math.max(1, est.length - 1);
  const meanSe2 = results.reduce((s, r) => s + r.banded.se ** 2, 0) / Math.max(1, results.length);
  const tau2 = Math.max(0, varEst - meanSe2);
  for (const r of results) r.shrunk = (r.banded.logOr * tau2) / (tau2 + r.banded.se ** 2);

  // Item-wide effects: an item that "interacts" with everything (bought when
  // behind, bought only in long games) is a per-item effect of WHEN it is bought,
  // not a pair effect. Double-centre: pairOnly = shrunk - itemA - itemB + grand.
  const grand = results.reduce((s, r) => s + r.shrunk, 0) / Math.max(1, results.length);
  const itemSum = new Map<string, { sum: number; n: number }>();
  for (const r of results) {
    for (const it of [r.a, r.b]) {
      const e = itemSum.get(it.id) ?? { sum: 0, n: 0 };
      e.sum += r.shrunk;
      e.n += 1;
      itemSum.set(it.id, e);
    }
  }
  const itemEffect = (id: string) => {
    const e = itemSum.get(id);
    return e ? e.sum / e.n : grand;
  };
  for (const r of results) r.pairOnly = r.shrunk - itemEffect(r.a.id) - itemEffect(r.b.id) + grand;

  console.log(
    `\nPairs ranked: ${results.length} with >= ${args.min} matches ` +
      `(dropped ${droppedChain} component->upgrade pairs, ${droppedUnknown} unknown ids)`,
  );

  // ── Confound check: how much does holding net worth fixed move the estimates?
  if (results.length >= 3) {
    const rawLor = results.map((r) => r.raw.logOr);
    const bandLor = results.map((r) => r.banded.logOr);
    const agree = results.filter(
      (r) => Math.sign(r.raw.logOr) === Math.sign(r.banded.logOr),
    ).length;
    const sig = results.filter((r) => Math.abs(r.banded.logOr / r.banded.se) > 3).length;
    console.log("\n--- Wealth confound: raw vs net-worth-banded log odds ratio ---");
    console.log(
      `  mean          raw ${signed(rawLor.reduce((s, x) => s + x, 0) / rawLor.length, 3)}   banded ${signed(meanEst, 3)}`,
    );
    console.log(
      `  median |lor|  raw ${fmt(median(rawLor.map(Math.abs)), 3)}    banded ${fmt(median(bandLor.map(Math.abs)), 3)}`,
    );
    console.log(`  correlation   ${fmt(pearson(rawLor, bandLor), 3)}`);
    console.log(
      `  same sign     ${agree}/${results.length} (${fmt((100 * agree) / results.length, 0)}%)`,
    );
    console.log(`  |z| > 3       ${sig}/${results.length} banded`);
    console.log(
      `  shrinkage     tau ${fmt(Math.sqrt(tau2), 3)} (spread beyond sampling noise); median se ${fmt(median(results.map((r) => r.banded.se)), 3)}`,
    );
  }

  const header =
    `  ${pad("pair", 44)} ${lpad("both", 8)} ${lpad("wr", 6)} ${lpad("exp", 6)} ` +
    `${lpad("raw", 7)} ${lpad("banded", 7)} ${lpad("se", 6)} ${lpad("shrunk", 7)} ${lpad("~pp", 6)} ` +
    `${lpad("pairOnly", 8)}`;
  const row = (r: PairResult) => {
    // Rough percentage-point reading of the shrunk banded effect at this pair's win rate.
    const pp = 100 * r.shrunk * r.raw.wrPair * (1 - r.raw.wrPair);
    return (
      `  ${pad(`${r.a.name} + ${r.b.name}`, 44)} ${lpad(String(r.raw.pairMatches), 8)} ` +
      `${lpad(fmt(100 * r.raw.wrPair, 1), 6)} ${lpad(fmt(100 * r.raw.wrExpected, 1), 6)} ` +
      `${lpad(signed(r.raw.logOr, 3), 7)} ${lpad(signed(r.banded.logOr, 3), 7)} ` +
      `${lpad(fmt(r.banded.se, 3), 6)} ${lpad(signed(r.shrunk, 3), 7)} ${lpad(signed(pp, 1), 6)} ` +
      `${lpad(signed(r.pairOnly, 3), 8)}`
    );
  };

  // ── Check the hand-authored table and any requested pairs.
  const requested: Array<[Item, Item, string]> = [
    ...SYNERGY_RULES.map((rule): [Item, Item, string] => [
      findItem(allItems, rule.itemIds[0]),
      findItem(allItems, rule.itemIds[1]),
      "SYNERGY_RULES",
    ]),
    ...args.pairs.map(([x, y]): [Item, Item, string] => [
      findItem(allItems, x),
      findItem(allItems, y),
      "--pair",
    ]),
  ];
  console.log("\n--- Hand-authored SYNERGY_RULES and --pair ---");
  console.log(header);
  for (const [a, b, src] of requested) {
    const hit = results.find(
      (r) => (r.a.id === a.id && r.b.id === b.id) || (r.a.id === b.id && r.b.id === a.id),
    );
    if (hit) {
      console.log(`${row(hit)}  [${src}]`);
      continue;
    }
    const cell = raw.pairs.get(pairKey(a.numericId, b.numericId));
    console.log(
      `  ${pad(`${a.name} + ${b.name}`, 44)} ${lpad(String(cell?.matches ?? 0), 8)}  ` +
        `not ranked (below --min, thin band, or component chain)  [${src}]`,
    );
  }

  const items = [...itemSum.entries()]
    .filter(([, e]) => e.n >= 10)
    .map(([id, e]) => ({ item: byId.get(id) as Item, effect: e.sum / e.n - grand, n: e.n }))
    .sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect) || x.item.id.localeCompare(y.item.id));
  console.log(
    `\n--- Item-wide effects (mean shrunk over the item's pairs, minus overall mean) ---`,
  );
  for (const e of items.slice(0, args.top)) {
    console.log(`  ${pad(e.item.name, 28)} ${lpad(signed(e.effect, 3), 7)}  over ${e.n} pairs`);
  }

  const sorted = [...results].sort(
    (x, y) =>
      y.pairOnly - x.pairOnly || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id),
  );
  console.log(
    `\n--- Top ${args.top} positive (pairOnly: shrunk, banded, item-wide effects removed) ---`,
  );
  console.log(header);
  for (const r of sorted.slice(0, args.top)) console.log(row(r));
  console.log(`\n--- Top ${args.top} negative ---`);
  console.log(header);
  for (const r of sorted.slice(-args.top).reverse()) console.log(row(r));
  console.log(
    "\nColumns: both = matches with both items (all bands); wr = their win rate; exp = what the two\n" +
      "items predict on their own (additive log odds); raw/banded = interaction log odds ratio, without\n" +
      "and with final-net-worth bands; shrunk = banded after empirical-Bayes shrinkage; ~pp = shrunk\n" +
      "effect as approximate win-rate percentage points; pairOnly = shrunk minus both items' item-wide\n" +
      "effects (what is specific to the PAIR).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
