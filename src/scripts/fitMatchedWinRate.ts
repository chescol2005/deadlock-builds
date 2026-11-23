// src/scripts/fitMatchedWinRate.ts — fit the committed matched item win-rate table
// Run: npm run fit-matched-wr [-- --heroes a,b] [--brackets 8,11] [--days N] [--min N] [--q Q] [--dry]
//
// OFFLINE fitter for lib/engine/matchedWinRate.ts. For every visible hero and
// rank bracket it loads /v1/analytics/item-stats once per buy-time window,
// bucketed by net worth AT PURCHASE (net_worth_by_5000; verified 2026-11-23:
// 800-soul items sit almost entirely in the 0-5k bucket, 6,400-soul items in
// 15-30k), so every (window x band) cell is one stratum. It compares each item
// with the other purchases in its stratum (matchedExcess), shrinks the edges and
// keeps those passing a Benjamini-Hochberg false discovery test
// (fitMatchedWinRate), and writes lib/engine/data/matchedWinRate.json, which is
// committed. The app never calls these endpoints at page load.
//
// Cost: 7 calls per hero per bracket (about 310 per bracket for 44 heroes),
// throttled to 150/min by pairData.getJson.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import { fetchRankTiers } from "@/lib/api/analyticsApi";
import { fitMatchedWinRate, matchedExcess } from "@/lib/engine/matchedWinRate";
import type { MatchedRow, MatchedWinRateTable } from "@/lib/engine/matchedWinRate";
import { buildStrata, getJson } from "./pairData";

const OUT_PATH = path.join(process.cwd(), "lib", "engine", "data", "matchedWinRate.json");

/** Net-worth-at-purchase band width: the API's net_worth_by_5000 bucket. */
const NET_WORTH_BAND = 5000;
/** Buy-time windows (lower bounds, seconds); the last is open-ended. */
const BUY_TIME_WINDOWS_S = [0, 600, 900, 1200, 1500, 1800, 2400];

const USAGE = `Usage: npm run fit-matched-wr -- [options]

Options:
  --heroes a,b    only these heroes (ids or names); default: every visible hero.
                  A partial run still REPLACES the whole file, so use it with --dry
  --brackets T,U  rank brackets to fit, as minimum match-average rank tiers
                  (8 = Oracle, 9 = Phantom, 10 = Ascendant, 11 = Eternus; default 8).
                  The file holds only the brackets of its last run
  --days N        window length in days, ending at today 00:00 UTC (default 23:
                  the days since the 2026-10-30 patch on 2026-11-23)
  --min N         minimum purchases for an item to be tested (default 300)
  --q Q           false discovery rate for kept items, per hero (default 0.1)
  --dry           fit and print the summary, but do not write the file
`;

interface Args {
  heroes: string[];
  brackets: number[];
  days: number;
  min: number;
  q: number;
  dry: boolean;
}

function fail(msg: string): never {
  console.error(`error: ${msg}\n\n${USAGE}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const out: Args = { heroes: [], brackets: [8], days: 23, min: 300, q: 0.1, dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) fail(`${a} needs a value`);
      i += 1;
      return v;
    };
    const int = (v: string, lo: number, hi: number): number => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < lo || n > hi) fail(`${a} must be an integer ${lo}-${hi}`);
      return n;
    };
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--heroes")
      out.heroes = next()
        .split(",")
        .map((s) => s.trim());
    else if (a === "--brackets") {
      out.brackets = [
        ...new Set(
          next()
            .split(",")
            .map((s) => int(s.trim(), 1, 11)),
        ),
      ].sort((x, y) => x - y);
    } else if (a === "--days") out.days = int(next(), 1, 365);
    else if (a === "--min") out.min = int(next(), 1, 1_000_000);
    else if (a === "--q") {
      const q = Number(next());
      if (!(q >= 0.001 && q <= 0.5)) fail("--q must be 0.001-0.5");
      out.q = q;
    } else if (a === "--dry") out.dry = true;
    else fail(`unknown option ${a}`);
  }
  return out;
}

interface ItemStatsRow {
  item_id: number;
  bucket: number;
  wins: number;
  matches: number;
}

const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** One hero per line under fits / heroes, so a refit diffs hero by hero. */
function serialize(table: MatchedWinRateTable): string {
  const perHero = (m: Record<string, unknown>): string => {
    const ids = Object.keys(m).sort((a, b) => Number(a) - Number(b));
    if (ids.length === 0) return "{}";
    const rows = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(m[id])}`);
    return `{\n${rows.join(",\n")}\n  }`;
  };
  return [
    "{",
    `  "version": ${table.version},`,
    `  "generated": ${JSON.stringify(table.generated)},`,
    `  "window": ${JSON.stringify(table.window)},`,
    `  "method": ${JSON.stringify(table.method)},`,
    `  "fits": ${perHero(table.fits)},`,
    `  "heroes": ${perHero(table.heroes)}`,
    "}",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [allHeroes, allItems, rankTiers] = await Promise.all([
    fetchVisibleHeroesEnriched(),
    getItems(),
    fetchRankTiers(),
  ]);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  // Shop items only: the planner's catalogue. Abilities and non-shop upgrades
  // also appear in item-stats and would distort the peer rate.
  const idByNumeric = new Map(allItems.map((it) => [it.numericId, it.id]));
  const rankName = (t: number): string =>
    rankTiers.find((r) => r.tier === t)?.name ?? fail(`unknown rank tier ${t}`);

  const table: MatchedWinRateTable = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    window: { from: "", to: "", days: args.days },
    method: {
      gameMode: "normal",
      netWorthBand: NET_WORTH_BAND,
      buyTimeWindowsS: [...BUY_TIME_WINDOWS_S],
      minMatches: args.min,
      fdrQ: args.q,
      brackets: Object.fromEntries(args.brackets.map((t) => [String(t), `${rankName(t)}+`])),
    },
    fits: {},
    heroes: {},
  };

  for (const tier of args.brackets) {
    const base = buildStrata({ days: args.days, rank: null, minRank: tier, bands: [] });
    table.window.from = base.from;
    table.window.to = base.to;
    console.log(
      `${rankName(tier)}+: ${heroes.length} heroes, ${base.from} to ${base.to}, ` +
        `${BUY_TIME_WINDOWS_S.length} buy-time windows x ${NET_WORTH_BAND}-soul bands, ` +
        `false discovery rate ${args.q}, >= ${args.min} purchases`,
    );
    let totalKept = 0;
    for (const hero of heroes) {
      const heroId = Number(hero.id);
      const strata: MatchedRow[][] = [];
      for (let w = 0; w < BUY_TIME_WINDOWS_S.length; w += 1) {
        const lo = BUY_TIME_WINDOWS_S[w];
        const hi = BUY_TIME_WINDOWS_S[w + 1];
        const rows = await getJson<ItemStatsRow[]>("item-stats", {
          ...base.all.params,
          hero_id: heroId,
          bucket: "net_worth_by_5000",
          min_bought_at_s: lo,
          ...(hi === undefined ? {} : { max_bought_at_s: hi - 1 }),
        });
        const byBand = new Map<number, MatchedRow[]>();
        for (const r of rows) {
          const id = idByNumeric.get(r.item_id);
          if (id === undefined || !(r.matches > 0)) continue;
          const band = byBand.get(r.bucket) ?? [];
          band.push({ itemId: id, wins: r.wins, matches: r.matches });
          byBand.set(r.bucket, band);
        }
        for (const b of [...byBand.keys()].sort((x, y) => x - y)) {
          const band = byBand.get(b);
          if (band && band.length > 0) strata.push(band);
        }
      }
      const { entries, fit } = fitMatchedWinRate(matchedExcess(strata), {
        minMatches: args.min,
        fdrQ: args.q,
        strata: strata.length,
      });
      const kept: Record<string, (typeof entries)[string]> = {};
      for (const id of Object.keys(entries).sort()) {
        const e = entries[id];
        const edge = round4(e.edge);
        if (edge === 0) continue;
        kept[id] = { edge, se: round4(e.se), z: round3(e.z), n: e.n };
      }
      const key = String(heroId);
      table.fits[key] = {
        ...table.fits[key],
        [String(tier)]: {
          ...fit,
          kept: Object.keys(kept).length,
          tau: round4(fit.tau),
          zCut: fit.zCut === null ? null : round3(fit.zCut),
        },
      };
      table.heroes[key] = { ...table.heroes[key], [String(tier)]: kept };
      totalKept += Object.keys(kept).length;
      const top = Object.entries(kept)
        .sort(([, a], [, b]) => b.edge - a.edge)
        .slice(0, 3)
        .map(
          ([id, e]) =>
            `${allItems.find((i) => i.id === id)?.name ?? id} ${(e.edge * 100).toFixed(1)}`,
        )
        .join(", ");
      console.log(
        `  ${hero.name.padEnd(14)} strata ${String(fit.strata).padStart(3)}  tested ${String(fit.tested).padStart(3)}` +
          `  kept ${String(Object.keys(kept).length).padStart(3)}  tau ${round4(fit.tau).toFixed(4)}` +
          `  zCut ${fit.zCut === null ? "-" : round3(fit.zCut).toFixed(2)}  ${top}`,
      );
    }
    console.log(`  total kept: ${totalKept}`);
  }

  if (args.dry) {
    console.log("--dry: table not written");
    return;
  }
  writeFileSync(OUT_PATH, serialize(table), "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
