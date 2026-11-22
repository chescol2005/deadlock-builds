// src/scripts/fitPairTable.ts — Milestone F: fit the committed pair-lift table
// Run: npm run fit-pairs [-- --heroes a,b] [--min-rank T] [--days N] [--min N] [--q Q] [--dry]
//
// OFFLINE fitter. For every visible hero, loads the same strata as
// pairProbe.ts (./pairData.ts), fits every pair with fitHeroPairs
// (lib/engine/pairLift.ts), keeps pair-specific effects at a false discovery
// rate (Benjamini-Hochberg per hero, on the unshrunk pair z), and writes
// lib/engine/data/pairLiftTable.json. That file is committed. The app reads
// the file and never calls these endpoints at page load: a full fit costs
// about 600 calls and hundreds of MB, which is affordable offline but not per
// request.
//
// Defaults: Oracle+ matches (badge >= 80) over 90 days. The product decision
// (Milestone F PR 3) was to measure higher-rank play; Ascendant+ alone left
// almost every hero with zero measurable pairs, so the floor is Oracle.
//
// Refresh it on the data-verification cadence (CLAUDE.md) and after a major
// item patch. Review the diff like any data change: the per-hero summary this
// prints is the thing to compare.

import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import { fetchRankTiers } from "@/lib/api/analyticsApi";
import { fdrZCutoff, fitHeroPairs, pairLiftKey } from "@/lib/engine/pairLift";
import { SYNERGY_RULES } from "@/lib/engine/synergy";
import { ANTI_SYNERGY_RULES } from "@/lib/scoring/antiSynergy";
import type { FitItem, PairLiftEntry, PairLiftTable } from "@/lib/engine/pairLift";
import { DEFAULT_NET_WORTH_BANDS, buildStrata, loadStratum } from "./pairData";
import type { LoadedStratum } from "./pairData";

const OUT_PATH = path.join(process.cwd(), "lib", "engine", "data", "pairLiftTable.json");

const USAGE = `Usage: npm run fit-pairs -- [options]

Options:
  --heroes a,b    only these heroes (ids or names); default: every visible hero.
                  A partial run still REPLACES the whole file, so use it with --dry
  --days N        window length in days, ending at today 00:00 UTC (default 90)
  --min N         minimum matches with BOTH items to fit a pair (default 300)
  --q Q           false discovery rate for kept pairs, per hero (default 0.1)
  --min-rank T    only matches whose average badge is rank tier T or above
                  (0-11; 8 = Oracle, 10 = Ascendant; default 8). -1 = all ranks
  --end-days-ago N  end the window N days before today (default 0), e.g. to
                  fit two halves of a window separately for a replication check
  --dump FILE     also write every tested pair (z, lift, se, n, kept) as JSON
                  lines to FILE, for offline checks; the table is unaffected
  --dry           fit and print the summary, but do not write the file
`;

interface FitArgs {
  heroes: string[];
  minRank: number | null;
  days: number;
  min: number;
  q: number;
  endDaysAgo: number;
  dump: string | null;
  dry: boolean;
}

function fail(message: string): never {
  console.error(`fitPairTable: ${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseNumArg(flag: string, raw: string | undefined, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isFinite(n) || n < min || n > max) {
    fail(`${flag} needs a number from ${min} to ${max}, got ${raw ?? "nothing"}`);
  }
  return n;
}

function parseArgs(argv: string[]): FitArgs {
  const out: FitArgs = {
    heroes: [],
    minRank: 8,
    days: 90,
    min: 300,
    q: 0.1,
    endDaysAgo: 0,
    dump: null,
    dry: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--heroes") {
      out.heroes = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--days") {
      out.days = Math.round(parseNumArg(a, argv[++i], 1, 90));
    } else if (a === "--min") {
      out.min = Math.round(parseNumArg(a, argv[++i], 1, 10_000_000));
    } else if (a === "--q") {
      out.q = parseNumArg(a, argv[++i], 0.001, 0.5);
    } else if (a === "--min-rank") {
      const t = Math.round(parseNumArg(a, argv[++i], -1, 11));
      out.minRank = t < 0 ? null : t;
    } else if (a === "--end-days-ago") {
      out.endDaysAgo = Math.round(parseNumArg(a, argv[++i], 0, 365));
    } else if (a === "--dump") {
      out.dump = argv[++i] ?? fail("--dump needs a file path");
    } else if (a === "--dry") {
      out.dry = true;
    } else {
      fail(`unknown argument ${a}`);
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Keep a pair only if BOTH items are in at least this many fitted pairs: an
 * item's additive effect (removeItemEffects) is poorly determined from a
 * handful of pairs, so its pairs' residuals are not trustworthy.
 */
const MIN_ITEM_PAIRS = 10;

/**
 * A hand-authored SYNERGY_RULES pair's measurement is recorded in rulePairs
 * (whatever its z) only when its se is at most this: precise enough that a
 * real effect of about 0.15 log odds (roughly 4 win-rate points) is 3 se. Below that precision, "measured about 0" is just "no
 * information", and the hand rule should keep firing.
 */
const RULE_MAX_SE = 0.05;

/**
 * One entry per line, keys sorted, so a refresh diffs readably. The file is in
 * .prettierignore: this layout is the canonical format.
 */
function serialize(table: PairLiftTable): string {
  const lines: string[] = ["{"];
  lines.push(`  "version": ${table.version},`);
  lines.push(`  "generated": ${JSON.stringify(table.generated)},`);
  lines.push(`  "window": ${JSON.stringify(table.window)},`);
  lines.push(`  "method": ${JSON.stringify(table.method)},`);
  const section = (
    name: string,
    data: Record<string, Record<string, PairLiftEntry>>,
    last: boolean,
  ) => {
    const heroIds = Object.keys(data).sort((a, b) => Number(a) - Number(b));
    lines.push(`  "${name}": {`);
    heroIds.forEach((id, h) => {
      const entries = data[id];
      const keys = Object.keys(entries).sort();
      lines.push(`    ${JSON.stringify(id)}: {`);
      keys.forEach((key, k) => {
        lines.push(
          `      ${JSON.stringify(key)}: ${JSON.stringify(entries[key])}${k < keys.length - 1 ? "," : ""}`,
        );
      });
      lines.push(`    }${h < heroIds.length - 1 ? "," : ""}`);
    });
    lines.push(last ? "  }" : "  },");
  };
  const fitIds = Object.keys(table.fits).sort((a, b) => Number(a) - Number(b));
  lines.push(`  "fits": {`);
  fitIds.forEach((id, k) => {
    lines.push(
      `    ${JSON.stringify(id)}: ${JSON.stringify(table.fits[id])}${k < fitIds.length - 1 ? "," : ""}`,
    );
  });
  lines.push("  },");
  section("heroes", table.heroes, false);
  section("rulePairs", table.rulePairs, false);
  section("handPairs", table.handPairs, true);
  lines.push("}");
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const [allHeroes, allItems, rankTiers] = await Promise.all([
    fetchVisibleHeroesEnriched(),
    getItems(),
    fetchRankTiers(),
  ]);
  const minRankName =
    args.minRank === null
      ? null
      : (rankTiers.find((r) => r.tier === args.minRank)?.name ??
        fail(`unknown rank tier ${args.minRank}`));
  const heroes =
    args.heroes.length === 0
      ? [...allHeroes].sort((a, b) => Number(a.id) - Number(b.id))
      : args.heroes.map((q) => {
          const hit =
            allHeroes.find((h) => String(h.id) === q) ??
            allHeroes.find((h) => norm(h.name) === norm(q));
          if (!hit) fail(`no visible hero matches "${q}"`);
          return hit;
        });

  const itemsByNumericId = new Map<number, FitItem>();
  for (const it of allItems)
    itemsByNumericId.set(it.numericId, { id: it.id, componentItems: it.componentItems });

  const strata = buildStrata({
    days: args.days,
    endDaysAgo: args.endDaysAgo,
    rank: null,
    minRank: args.minRank,
    bands: DEFAULT_NET_WORTH_BANDS,
  });
  console.log(
    `Fitting ${heroes.length} heroes over ${strata.from} to ${strata.to}; ` +
      `${1 + strata.bands.length} strata each, ${minRankName === null ? "all ranks" : `${minRankName}+`}, ` +
      `false discovery rate ${args.q}, >= ${args.min} matches`,
  );

  const table: PairLiftTable = {
    version: 4,
    generated: new Date().toISOString().slice(0, 10),
    window: { from: strata.from, to: strata.to },
    method: {
      gameMode: "normal",
      netWorthBands: [...DEFAULT_NET_WORTH_BANDS],
      minPairMatches: args.min,
      fdrQ: args.q,
      minItemPairs: MIN_ITEM_PAIRS,
      minRank: args.minRank,
      minRankName,
      days: args.days,
      ruleMaxSe: RULE_MAX_SE,
    },
    fits: {},
    heroes: {},
    rulePairs: {},
    handPairs: {},
  };
  const handKeys = new Set(
    [...SYNERGY_RULES, ...ANTI_SYNERGY_RULES].map((r) => pairLiftKey(r.itemIds[0], r.itemIds[1])),
  );
  const ruleKeys = new Set(SYNERGY_RULES.map((r) => pairLiftKey(r.itemIds[0], r.itemIds[1])));

  let totalKept = 0;
  if (args.dump !== null) writeFileSync(args.dump, "", "utf8"); // one run per dump file
  for (const hero of heroes) {
    const heroId = Number(hero.id);
    const started = Date.now();
    const raw = await loadStratum(heroId, strata.all);
    const bands: LoadedStratum[] = [];
    for (const b of strata.bands) bands.push(await loadStratum(heroId, b));

    const fit = fitHeroPairs(raw, bands, itemsByNumericId, args.min);
    const entryOf = (p: (typeof fit.pairs)[number]): PairLiftEntry => ({
      lift: round3(p.pairOnly),
      se: round3(p.banded.se),
      z: round3(p.z),
      n: p.raw.pairMatches,
    });
    const itemPairsOk = (p: (typeof fit.pairs)[number]) =>
      (fit.itemEffects.byItem.get(p.a)?.pairs ?? 0) >= MIN_ITEM_PAIRS &&
      (fit.itemEffects.byItem.get(p.b)?.pairs ?? 0) >= MIN_ITEM_PAIRS;
    // The false-discovery family: every pair whose items' effects are well
    // determined. The cut-off is on the ROUNDED z (what the file stores), so the
    // table-integrity fixture can check |z| >= zCut exactly.
    const tested = fit.pairs.filter((p) => itemPairsOk(p) && round3(p.banded.se) > 0);
    const rawCut = fdrZCutoff(
      tested.map((p) => round3(p.z)),
      args.q,
    );
    const zCut = rawCut === null ? null : round3(rawCut);
    const entries: Record<string, PairLiftEntry> = {};
    let pos = 0;
    for (const p of tested) {
      const e = entryOf(p);
      if (zCut === null || Math.abs(e.z) < zCut) continue;
      // Shrinking can move a pair's residual across 0; keep only pairs whose
      // stored lift points the same way as the evidence.
      if (e.lift === 0 || Math.sign(e.lift) !== Math.sign(e.z)) continue;
      entries[pairLiftKey(p.a, p.b)] = e;
      if (e.lift > 0) pos += 1;
    }
    if (args.dump !== null) {
      const lines = tested.map((p) => {
        const key = pairLiftKey(p.a, p.b);
        return JSON.stringify({ hero: heroId, key, ...entryOf(p), kept: key in entries });
      });
      if (lines.length > 0) appendFileSync(args.dump, lines.join("\n") + "\n", "utf8");
    }
    // Hand-rule pairs: record the measurement when it is precise enough to
    // override the rule ("measured wins"), whatever its sign or z.
    const rules: Record<string, PairLiftEntry> = {};
    for (const p of fit.pairs) {
      const key = pairLiftKey(p.a, p.b);
      if (!ruleKeys.has(key)) continue;
      // A significant hand-rule pair is always recorded (whatever its se), so
      // rulePairs ⊇ the hand-rule pairs in heroes. The fixture checks this.
      const significant = entries[key];
      if (significant) {
        rules[key] = significant;
        continue;
      }
      const e = entryOf(p);
      if (!itemPairsOk(p) || e.se <= 0 || e.se > RULE_MAX_SE) continue;
      rules[key] = e;
    }
    if (Object.keys(rules).length > 0) table.rulePairs[String(heroId)] = rules;

    // Audit only (synergy report): every fitted hand pair, any z or se.
    const hand: Record<string, PairLiftEntry> = {};
    for (const p of fit.pairs) {
      const key = pairLiftKey(p.a, p.b);
      if (!handKeys.has(key)) continue;
      hand[key] = entryOf(p);
    }
    if (Object.keys(hand).length > 0) table.handPairs[String(heroId)] = hand;

    const kept = Object.keys(entries).length;
    totalKept += kept;
    table.heroes[String(heroId)] = entries;
    table.fits[String(heroId)] = {
      matches: raw.hero.matches,
      pairsFitted: fit.pairs.length,
      tested: tested.length,
      zCut,
      kept,
      tau: round3(Math.sqrt(fit.tau2)),
    };
    console.log(
      `  ${hero.name.padEnd(18)} ${String(raw.hero.matches).padStart(9)} matches  ` +
        `${String(fit.pairs.length).padStart(5)} fitted  ${String(kept).padStart(4)} kept ` +
        `(${pos} +, ${kept - pos} -)  z >= ${zCut === null ? "none" : zCut.toFixed(2)} of ${tested.length}  rules ${Object.keys(rules).length}  ` +
        `tau ${Math.sqrt(fit.tau2).toFixed(3)}  ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
  }

  const text = serialize(table);
  console.log(
    `\n${totalKept} entries across ${heroes.length} heroes, ${(text.length / 1024).toFixed(0)} KB`,
  );
  if (args.dry) {
    console.log("--dry: not written");
    return;
  }
  writeFileSync(OUT_PATH, text, "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
