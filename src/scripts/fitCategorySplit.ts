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
// redistributes the kit-derived need vector between the three families. Heroes
// below --min matches are left out and fall back to the kit-only vector.
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
    table.heroes[String(hero.id)] = {
      gun: round3(souls.gun / total),
      spirit: round3(souls.spirit / total),
      vitality: round3(souls.vitality / total),
      matches,
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
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
