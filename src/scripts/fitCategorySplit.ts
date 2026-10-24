// src/scripts/fitCategorySplit.ts — writes lib/engine/data/heroCategorySplit.json
// Run: npm run fit-category-split [-- --days 30] [--min-badge 80] [--min 2000] [--dry]
//
// For every visible hero, measures how high-rank players split their FINAL
// inventory's item souls across gun / spirit / vitality, from
// /v1/analytics/item-stats (hero_ids=<id>, min_average_badge, pinned window).
// "Final inventory" is approximated as (times bought − times sold) × cost:
// `sold` counts any item that left the inventory, which includes components
// consumed by an upgrade, so components are mostly excluded and upgrades are
// counted once. Methodology verified by data-verifier 2026-10-20; see
// "Measured category split" in engine-design-notes.md.
//
// The engine uses the split as a PRIOR (lib/engine/categorySplit.ts): it
// redistributes the kit-derived need vector between the three families, per
// phase (early / mid purchase splits, final split late), and each phase's stat
// profile sets the five non-family categories. Heroes below --min matches are
// left out and fall back to the kit-only vector.
//
// Also writes lib/engine/data/heroPhaseItems.json from the same purchase
// queries: per hero and phase (0–10 / 10–20 / 20+ min), the share of matches in
// which the hero BOUGHT each item (lib/engine/phaseItems.ts, phaseItemTerm).
//
// Refresh on the same monthly cadence as `npm run fit-pairs` (CLAUDE.md, Data
// Verification Cadence) and review the diff before committing.
//
// NOTE the analytics parameter is `hero_ids`; `hero_id` is silently ignored and
// returns catalogue-wide counts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import type { CategorySplitTable } from "@/lib/engine/categorySplit";
import { PHASE_ITEM_MIN_RATE } from "@/lib/engine/phaseItems";
import type { PhaseItemsTable } from "@/lib/engine/phaseItems";
import { toItemCandidate } from "@/lib/engine/itemAdapter";
import { SCORE_CATEGORIES } from "@/lib/engine/types";
import type { ScoreCategory } from "@/lib/engine/types";
import type { Item } from "@/lib/items";
import { getJson } from "./pairData";

interface Args {
  days: number;
  minBadge: number;
  minMatches: number;
  dry: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { days: 30, minBadge: 80, minMatches: 2000, dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const num = () => {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${a} needs a positive number`);
      return n;
    };
    if (a === "--days") out.days = num();
    else if (a === "--min-badge") out.minBadge = num();
    else if (a === "--min") out.minMatches = num();
    else if (a === "--dry") out.dry = true;
    else throw new Error(`unknown option ${a}`);
  }
  return out;
}

// Badge tier names by tens digit (badge = tier × 10 + subtier), for the scope label.
const TIER_NAMES: Record<number, string> = {
  6: "Archon",
  7: "Ascendant",
  8: "Oracle",
  9: "Phantom",
  10: "Eternus",
};

interface HeroStatsRow {
  hero_id: number;
  matches: number;
}
interface ItemStatsRow {
  item_id: number;
  matches: number;
  sold?: number;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
/** Item rates sorted by item id, so refresh diffs are stable. */
const sortedRates = (rates: Record<string, number>) =>
  Object.fromEntries(Object.entries(rates).sort(([a], [b]) => a.localeCompare(b)));
const round4 = (x: number) => Math.round(x * 10000) / 10000;

/**
 * Measured STAT profile: Σ weight × the item's category values (unscaled, as
 * lib/engine/itemAdapter scores items), normalized to shares of 1 across all 12
 * score categories. This is what the purchases actually covered, so it gives
 * the categories the kit cannot derive (antiHeal, sustain, utility, economy,
 * mobility) a measured per-hero, per-phase weight.
 */
function statProfile(
  weighted: ReadonlyArray<{ item: Item; weight: number }>,
): Record<ScoreCategory, number> | undefined {
  const sum = {} as Record<ScoreCategory, number>;
  for (const c of SCORE_CATEGORIES) sum[c] = 0;
  for (const { item, weight } of weighted) {
    if (!(weight > 0)) continue;
    const values = toItemCandidate(item).categoryValues;
    for (const c of SCORE_CATEGORIES) sum[c] += weight * Math.max(0, values[c]);
  }
  const total = SCORE_CATEGORIES.reduce((t, c) => t + sum[c], 0);
  if (!(total > 0)) return undefined;
  const out = {} as Record<ScoreCategory, number>;
  for (const c of SCORE_CATEGORIES) out[c] = round4(sum[c] / total);
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const to = Math.floor(Date.now() / 1000 / 86400) * 86400; // pinned to a UTC day
  const from = to - args.days * 86400;
  const window = {
    min_unix_timestamp: from,
    max_unix_timestamp: to,
    min_average_badge: args.minBadge,
  };

  const [heroes, items] = await Promise.all([fetchVisibleHeroesEnriched(), getItems()]);
  // getItems() fails open to []: never let an outage overwrite the committed table.
  if (items.length === 0 || heroes.length === 0) {
    throw new Error(`refusing to fit: ${items.length} items, ${heroes.length} heroes loaded`);
  }
  const itemByNumericId = new Map(items.map((i) => [i.numericId, i]));
  const heroStats = await getJson<HeroStatsRow[]>("hero-stats", window);
  const matchesByHero = new Map(heroStats.map((r) => [r.hero_id, r.matches]));

  const table: CategorySplitTable = {
    version: 1,
    generated: new Date(to * 1000).toISOString().slice(0, 10),
    window: {
      from: new Date(from * 1000).toISOString().slice(0, 10),
      to: new Date(to * 1000).toISOString().slice(0, 10),
    },
    method: {
      minAverageBadge: args.minBadge,
      minRankName: TIER_NAMES[Math.floor(args.minBadge / 10)] ?? `badge ${args.minBadge}`,
      days: args.days,
      minMatches: args.minMatches,
      measure: "final-inventory item souls: (bought - sold) x cost, per shop category",
    },
    heroes: {},
  };

  const phaseItems: PhaseItemsTable = {
    version: 1,
    generated: table.generated,
    window: table.window,
    method: {
      minAverageBadge: table.method.minAverageBadge,
      minRankName: table.method.minRankName,
      days: table.method.days,
      minMatches: table.method.minMatches,
      minRate: PHASE_ITEM_MIN_RATE,
      measure: "share of matches in which the hero bought the item in the phase window",
    },
    heroes: {},
  };

  for (const hero of [...heroes].sort((a, b) => a.id - b.id)) {
    const matches = matchesByHero.get(hero.id) ?? 0;
    if (matches < args.minMatches) {
      console.log(`  skip ${hero.name}: ${matches} matches < ${args.minMatches}`);
      continue;
    }
    const rows = await getJson<ItemStatsRow[]>("item-stats", { ...window, hero_ids: hero.id });
    const souls = { gun: 0, spirit: 0, vitality: 0 };
    // Rows whose item is no longer in the shop (removed or disabled mid-window)
    // carry no current cost, so their souls are dropped; count how many purchases
    // that was and warn when it is enough to shift the split.
    let droppedPurchases = 0;
    let keptPurchases = 0;
    for (const r of rows) {
      const kept = Math.max(0, r.matches - (r.sold ?? 0));
      const item = itemByNumericId.get(r.item_id);
      if (!item) {
        droppedPurchases += kept;
        continue;
      }
      keptPurchases += kept;
      souls[item.category] += kept * item.cost;
    }
    const droppedShare = droppedPurchases / Math.max(1, droppedPurchases + keptPurchases);
    if (droppedShare > 0.02) {
      console.warn(
        `  WARN ${hero.name}: ${(droppedShare * 100).toFixed(1)}% of final-inventory purchases are items not in the current shop`,
      );
    }
    const total = souls.gun + souls.spirit + souls.vitality;
    if (total <= 0) {
      console.log(`  skip ${hero.name}: no priced purchases`);
      continue;
    }
    // Phase splits: souls BOUGHT in 0–10 and 10–20 min (exact buy-time filters;
    // not net of sells, since an early buy later sold is still an early buy).
    // Read by the engine's phaseView and by the starter-build fixtures (M1).
    const bought = async (extra: Record<string, number>) => {
      const phaseRows = await getJson<ItemStatsRow[]>("item-stats", {
        ...window,
        hero_ids: hero.id,
        min_matches: 1,
        ...extra,
      });
      const ps = { gun: 0, spirit: 0, vitality: 0 };
      const weighted: Array<{ item: Item; weight: number }> = [];
      // Buy rate per item: matches with a purchase in this window / all matches.
      const rates: Record<string, number> = {};
      for (const r of phaseRows) {
        const item = itemByNumericId.get(r.item_id);
        if (!item) continue;
        ps[item.category] += r.matches * item.cost;
        weighted.push({ item, weight: r.matches });
        const rate = Math.min(1, r.matches / matches);
        if (rate >= PHASE_ITEM_MIN_RATE) rates[item.id] = round3(rate);
      }
      const pt = ps.gun + ps.spirit + ps.vitality;
      const shares =
        pt > 0
          ? {
              gun: round3(ps.gun / pt),
              spirit: round3(ps.spirit / pt),
              vitality: round3(ps.vitality / pt),
            }
          : undefined;
      return { shares, profile: statProfile(weighted), rates: sortedRates(rates) };
    };
    const earlyBought = await bought({ max_bought_at_s: 600 });
    const midBought = await bought({ min_bought_at_s: 600, max_bought_at_s: 1200 });
    const lateBought = await bought({ min_bought_at_s: 1200 });
    phaseItems.heroes[String(hero.id)] = {
      matches,
      early: earlyBought.rates,
      mid: midBought.rates,
      late: lateBought.rates,
    };
    const early = earlyBought.shares;
    const mid = midBought.shares;
    // Late profile: the final inventory, (bought − sold), as for the late split.
    const lateProfile = statProfile(
      rows.flatMap((r) => {
        const item = itemByNumericId.get(r.item_id);
        return item ? [{ item, weight: Math.max(0, r.matches - (r.sold ?? 0)) }] : [];
      }),
    );
    const profile =
      earlyBought.profile && midBought.profile && lateProfile
        ? { early: earlyBought.profile, mid: midBought.profile, late: lateProfile }
        : undefined;

    table.heroes[String(hero.id)] = {
      gun: round3(souls.gun / total),
      spirit: round3(souls.spirit / total),
      vitality: round3(souls.vitality / total),
      matches,
      ...(early ? { early } : {}),
      ...(mid ? { mid } : {}),
      ...(profile ? { profile } : {}),
    };
    const s = table.heroes[String(hero.id)];
    console.log(
      `  ${hero.name.padEnd(14)} gun ${(s.gun * 100).toFixed(1).padStart(5)}%  spirit ${(s.spirit * 100).toFixed(1).padStart(5)}%  vitality ${(s.vitality * 100).toFixed(1).padStart(5)}%  (${matches} matches)`,
    );
  }

  // One hero per line, like pairLiftTable.json (prettier-ignored), so refresh
  // diffs read hero by hero.
  const heroLines = Object.entries(table.heroes)
    .map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`)
    .join(",\n");
  const { heroes: _omit, ...head } = table;
  void _omit;
  const headJson = JSON.stringify(head, null, 2);
  const text = `${headJson.slice(0, -2)},\n  "heroes": {\n${heroLines}\n  }\n}\n`;

  const out = path.join(process.cwd(), "lib/engine/data/heroCategorySplit.json");
  // A large drop in fitted heroes means a broken fetch, not a meta shift.
  if (existsSync(out)) {
    const previous = JSON.parse(readFileSync(out, "utf8")) as CategorySplitTable;
    const before = Object.keys(previous.heroes).length;
    const now = Object.keys(table.heroes).length;
    if (now < before * 0.8) {
      throw new Error(`refusing to write: ${now} heroes fitted vs ${before} committed`);
    }
  }
  if (args.dry) {
    console.log(`\n--dry: would write ${Object.keys(table.heroes).length} heroes to ${out}`);
  } else {
    writeFileSync(out, text);
    console.log(`\nwrote ${Object.keys(table.heroes).length} heroes to ${out}`);
  }

  // Same layout and the same drop guard for the phase-item table.
  const itemLines = Object.entries(phaseItems.heroes)
    .map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`)
    .join(",\n");
  const { heroes: _omitItems, ...itemsHead } = phaseItems;
  void _omitItems;
  const itemsHeadJson = JSON.stringify(itemsHead, null, 2);
  const itemsText = `${itemsHeadJson.slice(0, -2)},\n  "heroes": {\n${itemLines}\n  }\n}\n`;
  const itemsOut = path.join(process.cwd(), "lib/engine/data/heroPhaseItems.json");
  if (existsSync(itemsOut)) {
    const previous = JSON.parse(readFileSync(itemsOut, "utf8")) as PhaseItemsTable;
    const before = Object.keys(previous.heroes).length;
    const now = Object.keys(phaseItems.heroes).length;
    if (now < before * 0.8) {
      throw new Error(`refusing to write: ${now} heroes of phase items vs ${before} committed`);
    }
  }
  if (args.dry) {
    console.log(
      `--dry: would write ${Object.keys(phaseItems.heroes).length} heroes to ${itemsOut}`,
    );
  } else {
    writeFileSync(itemsOut, itemsText);
    console.log(`wrote ${Object.keys(phaseItems.heroes).length} heroes to ${itemsOut}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
