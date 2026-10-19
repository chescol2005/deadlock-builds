// src/scripts/fitPairTable.ts — Milestone F: fit the committed pair-lift table
// Run: npm run fit-pairs [-- --heroes a,b] [--min-rank T] [--days N] [--min N] [--z Z] [--dry]
//
// OFFLINE fitter. For every visible hero, loads the same strata as
// pairProbe.ts (./pairData.ts), fits every pair with fitHeroPairs
// (lib/engine/pairLift.ts), keeps only clear pair-specific effects, and writes
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

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import { fetchRankTiers } from "@/lib/api/analyticsApi";
import { fitHeroPairs, pairLiftKey } from "@/lib/engine/pairLift";
import { SYNERGY_RULES } from "@/lib/engine/synergy";
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
  --z Z           keep a pair only if |lift| / se >= Z (default 3)
  --min-rank T    only matches whose average badge is rank tier T or above
                  (0-11; 8 = Oracle, 10 = Ascendant; default 8). -1 = all ranks
  --dry           fit and print the summary, but do not write the file
`;

interface FitArgs {
  heroes: string[];
  minRank: number | null;
  days: number;
  min: number;
  z: number;
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
  const out: FitArgs = { heroes: [], minRank: 8, days: 90, min: 300, z: 3, dry: false };
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
    } else if (a === "--z") {
      out.z = parseNumArg(a, argv[++i], 0.1, 20);
    } else if (a === "--min-rank") {
      const t = Math.round(parseNumArg(a, argv[++i], -1, 11));
      out.minRank = t < 0 ? null : t;
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
 * real effect of about 0.15 log odds (roughly 4 win-rate points) would have
 * cleared 3 se. Below that precision, "measured about 0" is just "no
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
  section("rulePairs", table.rulePairs, true);
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
    rank: null,
    minRank: args.minRank,
    bands: DEFAULT_NET_WORTH_BANDS,
  });
  console.log(
    `Fitting ${heroes.length} heroes over ${strata.from} to ${strata.to}; ` +
      `${1 + strata.bands.length} strata each, ${minRankName === null ? "all ranks" : `${minRankName}+`}, ` +
      `keep |lift|/se >= ${args.z}, >= ${args.min} matches`,
  );

  const table: PairLiftTable = {
    version: 2,
    generated: new Date().toISOString().slice(0, 10),
    window: { from: strata.from, to: strata.to },
    method: {
      gameMode: "normal",
      netWorthBands: [...DEFAULT_NET_WORTH_BANDS],
      minPairMatches: args.min,
      minAbsZ: args.z,
      minItemPairs: MIN_ITEM_PAIRS,
      minRank: args.minRank,
      minRankName,
      days: args.days,
      ruleMaxSe: RULE_MAX_SE,
    },
    fits: {},
    heroes: {},
    rulePairs: {},
  };
  const ruleKeys = new Set(SYNERGY_RULES.map((r) => pairLiftKey(r.itemIds[0], r.itemIds[1])));

  let totalKept = 0;
  for (const hero of heroes) {
    const heroId = Number(hero.id);
    const started = Date.now();
    const raw = await loadStratum(heroId, strata.all);
    const bands: LoadedStratum[] = [];
    for (const b of strata.bands) bands.push(await loadStratum(heroId, b));

    const fit = fitHeroPairs(raw, bands, itemsByNumericId, args.min);
    const entries: Record<string, PairLiftEntry> = {};
    let pos = 0;
    for (const p of fit.pairs) {
      // Threshold on the ROUNDED values, so the committed file satisfies its own
      // minAbsZ exactly (the table-integrity fixture checks it strictly).
      const pa = fit.itemEffects.byItem.get(p.a)?.pairs ?? 0;
      const pb = fit.itemEffects.byItem.get(p.b)?.pairs ?? 0;
      if (pa < MIN_ITEM_PAIRS || pb < MIN_ITEM_PAIRS) continue;
      const lift = round3(p.pairOnly);
      const se = round3(p.banded.se);
      if (se <= 0 || Math.abs(lift) / se < args.z) continue;
      entries[pairLiftKey(p.a, p.b)] = { lift, se, n: p.raw.pairMatches };
      if (p.pairOnly > 0) pos += 1;
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
      const pa = fit.itemEffects.byItem.get(p.a)?.pairs ?? 0;
      const pb = fit.itemEffects.byItem.get(p.b)?.pairs ?? 0;
      const se = round3(p.banded.se);
      if (pa < MIN_ITEM_PAIRS || pb < MIN_ITEM_PAIRS || se <= 0 || se > RULE_MAX_SE) continue;
      rules[key] = { lift: round3(p.pairOnly), se, n: p.raw.pairMatches };
    }
    if (Object.keys(rules).length > 0) table.rulePairs[String(heroId)] = rules;

    const kept = Object.keys(entries).length;
    totalKept += kept;
    table.heroes[String(heroId)] = entries;
    table.fits[String(heroId)] = {
      matches: raw.hero.matches,
      pairsFitted: fit.pairs.length,
      kept,
      tau: round3(Math.sqrt(fit.tau2)),
    };
    console.log(
      `  ${hero.name.padEnd(18)} ${String(raw.hero.matches).padStart(9)} matches  ` +
        `${String(fit.pairs.length).padStart(5)} fitted  ${String(kept).padStart(4)} kept ` +
        `(${pos} +, ${kept - pos} -)  rules ${Object.keys(rules).length}  ` +
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
