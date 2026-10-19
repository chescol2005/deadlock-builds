// src/scripts/pairProbe.ts — Milestone F spike: measured item-pair interaction
// Run: npm run pair-probe -- <hero> [--rank T] [--days N] [--bands a,b,c] [--pair a,b] [--top N]
//
// Asks one question of live match data: once the wealth confound is held
// fixed, do item PAIRS win more (or less) than their two items predict on their
// own? Read-only exploration for ONE hero, with diagnostics. The committed
// all-hero table comes from fitPairTable.ts, using the same math.
//
// Data loading: ./pairData.ts. Method (2x2 log odds ratio, net-worth bands,
// shrinkage, item-wide effects removed): lib/engine/pairLift.ts. Findings:
// engine-design-notes.md, "Milestone F spike".
//
// Live network, NOT a fixture: results move with patches and match data.

import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import type { Item } from "@/lib/items";
import { SYNERGY_RULES } from "@/lib/engine/synergy";
import { fitHeroPairs, pairStatKey } from "@/lib/engine/pairLift";
import type { PairFit } from "@/lib/engine/pairLift";
import { DEFAULT_NET_WORTH_BANDS, buildStrata, loadStratum } from "./pairData";
import type { LoadedStratum } from "./pairData";

const USAGE = `Usage: npm run pair-probe -- <hero> [options]

  <hero>          hero id (e.g. 76) or name (e.g. graves, "lady geist")

Options:
  --rank T        one rank tier 0-11 (badge T0-T9); default: all ranks
  --min-rank T    rank tier T and above (8 = Oracle reproduces the committed table)
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
  minRank: number | null;
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
    minRank: null,
    days: 30,
    bands: [...DEFAULT_NET_WORTH_BANDS],
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
    } else if (a === "--min-rank") {
      out.minRank = parseIntArg(a, argv[++i], 0, 11);
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
  const name = (id: string) => byId.get(id)?.name ?? id;

  const strata = buildStrata({
    days: args.days,
    rank: args.rank,
    minRank: args.minRank,
    bands: args.bands,
  });
  console.log(`\nLoading ${1 + strata.bands.length} strata x 3 endpoints for ${hero.name}...`);
  const raw = await loadStratum(heroId, strata.all);
  const bands: LoadedStratum[] = [];
  for (const b of strata.bands) bands.push(await loadStratum(heroId, b));

  console.log(`\n=== ${hero.name} (hero ${heroId}) — measured pair interaction ===`);
  console.log(
    `Window: ${strata.from} to ${strata.to} (${args.days}d), game_mode normal, ` +
      (args.rank !== null
        ? `rank tier ${args.rank} (badge ${args.rank * 10}-${args.rank * 10 + 9})`
        : args.minRank !== null
          ? `rank tier ${args.minRank}+ (badge >= ${args.minRank * 10})`
          : "all ranks"),
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

  const fit = fitHeroPairs(raw, bands, byNumeric, args.min);
  const results = fit.pairs;
  console.log(
    `\nPairs ranked: ${results.length} with >= ${args.min} matches ` +
      `(dropped ${fit.droppedChain} component->upgrade pairs, ${fit.droppedUnknown} unknown ids)`,
  );

  // ── Confound check: how much does holding net worth fixed move the estimates?
  if (results.length >= 3) {
    const rawLor = results.map((r) => r.raw.logOr);
    const bandLor = results.map((r) => r.banded.logOr);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const agree = results.filter(
      (r) => Math.sign(r.raw.logOr) === Math.sign(r.banded.logOr),
    ).length;
    const sig = results.filter((r) => Math.abs(r.banded.logOr / r.banded.se) > 3).length;
    console.log("\n--- Wealth confound: raw vs net-worth-banded log odds ratio ---");
    console.log(
      `  mean          raw ${signed(mean(rawLor), 3)}   banded ${signed(mean(bandLor), 3)}`,
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
      `  shrinkage     tau ${fmt(Math.sqrt(fit.tau2), 3)} (spread beyond sampling noise); median se ${fmt(median(results.map((r) => r.banded.se)), 3)}`,
    );
  }

  const header =
    `  ${pad("pair", 44)} ${lpad("both", 8)} ${lpad("wr", 6)} ${lpad("exp", 6)} ` +
    `${lpad("raw", 7)} ${lpad("banded", 7)} ${lpad("se", 6)} ${lpad("shrunk", 7)} ${lpad("~pp", 6)} ` +
    `${lpad("pairOnly", 8)}`;
  const row = (r: PairFit) => {
    // Rough percentage-point reading of the shrunk banded effect at this pair's win rate.
    const pp = 100 * r.shrunk * r.raw.wrPair * (1 - r.raw.wrPair);
    return (
      `  ${pad(`${name(r.a)} + ${name(r.b)}`, 44)} ${lpad(String(r.raw.pairMatches), 8)} ` +
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
      (r) => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id),
    );
    if (hit) {
      console.log(`${row(hit)}  [${src}]`);
      continue;
    }
    const cell = raw.pairs.get(pairStatKey(a.numericId, b.numericId));
    console.log(
      `  ${pad(`${a.name} + ${b.name}`, 44)} ${lpad(String(cell?.matches ?? 0), 8)}  ` +
        `not ranked (below --min, thin band, or component chain)  [${src}]`,
    );
  }

  const items = [...fit.itemEffects.byItem.entries()]
    .filter(([, e]) => e.pairs >= 10)
    .map(([id, e]) => ({ id, effect: e.effect, n: e.pairs }))
    .sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect) || x.id.localeCompare(y.id));
  console.log(`\n--- Item-wide effects (least-squares additive item effect on shrunk values) ---`);
  for (const e of items.slice(0, args.top)) {
    console.log(`  ${pad(name(e.id), 28)} ${lpad(signed(e.effect, 3), 7)}  over ${e.n} pairs`);
  }

  const sorted = [...results].sort(
    (x, y) => y.pairOnly - x.pairOnly || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
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
