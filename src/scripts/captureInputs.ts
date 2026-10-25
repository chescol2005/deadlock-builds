// src/scripts/captureInputs.ts — pins the live inputs of the hero basket for the
// offline baseline baskets (lib/engine/__fixtures__/frozen/). Item scoring review
// PR R1 (docs/item-scoring-review.md §2.1).
//
// Run: npm run capture-inputs [-- --tables-only]
//   --tables-only  refresh only the copies of the three committed data tables
//                  (after `npm run fit-pairs` / `fit-category-split`), keeping
//                  the pinned API data as it was
//
// Then `npm run baseline -- --update` and review the baseline diff.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchAllItems, fetchHeroAbilityItems } from "@/lib/api/deadlockApi";
import { fetchHeroById, fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { getHeroStats } from "@/lib/heroStore";
import { getHeroAccuracy, getItemAnalytics } from "@/lib/analyticsStore";
import type { PairLiftTable } from "@/lib/engine/pairLift";
import type { CategorySplitTable } from "@/lib/engine/categorySplit";
import type { PhaseItemsTable } from "@/lib/engine/phaseItems";
import pairLiftTableJson from "@/lib/engine/data/pairLiftTable.json";
import categorySplitTableJson from "@/lib/engine/data/heroCategorySplit.json";
import phaseItemsTableJson from "@/lib/engine/data/heroPhaseItems.json";
import {
  FROZEN_INPUTS_FILE,
  FROZEN_ITEMS_FILE,
} from "@/lib/engine/__fixtures__/frozen/frozenInputs";
import type { FrozenHero, FrozenInputsFile } from "@/lib/engine/__fixtures__/frozen/frozenInputs";
import { findHero } from "./basketData";
import { REFERENCE_HEROES } from "./starterBuildFixtures";

// Per-hero maps in the committed tables. The snapshot keeps only the reference
// heroes' entries (the baselines read nothing else), cutting it by ~450 KB.
const PER_HERO_KEYS = ["heroes", "fits", "rulePairs", "handPairs"] as const;

function sliceTable<T extends object>(table: T, heroIds: ReadonlySet<number>): T {
  const out: Record<string, unknown> = { ...(table as Record<string, unknown>) };
  for (const key of PER_HERO_KEYS) {
    const map = out[key];
    if (map && typeof map === "object") {
      out[key] = Object.fromEntries(
        Object.entries(map as Record<string, unknown>).filter(([id]) => heroIds.has(Number(id))),
      );
    }
  }
  return out as T;
}

function tablesFor(heroIds: ReadonlySet<number>): FrozenInputsFile["tables"] {
  return {
    pairLift: sliceTable(pairLiftTableJson as unknown as PairLiftTable, heroIds),
    categorySplit: sliceTable(categorySplitTableJson as unknown as CategorySplitTable, heroIds),
    phaseItems: sliceTable(phaseItemsTableJson as unknown as PhaseItemsTable, heroIds),
  };
}

async function latestPatch(): Promise<string> {
  try {
    const res = await fetch("https://api.deadlock-api.com/v2/patches");
    const list = (await res.json()) as Array<{ source?: string; title?: string }>;
    return list.find((p) => p.source === "forum")?.title ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main() {
  if (process.argv.includes("--tables-only")) {
    if (!existsSync(FROZEN_INPUTS_FILE))
      throw new Error("no frozen inputs yet: run a full capture");
    const file = JSON.parse(readFileSync(FROZEN_INPUTS_FILE, "utf-8")) as FrozenInputsFile;
    const tables = tablesFor(new Set(file.heroes.map((h) => h.id)));
    writeFileSync(FROZEN_INPUTS_FILE, JSON.stringify({ ...file, tables }) + "\n");
    console.log("refreshed the three table copies; API data unchanged");
    return;
  }

  const [rawItems, heroes, itemAnalytics, heroAccuracy, patch] = await Promise.all([
    fetchAllItems(),
    fetchVisibleHeroesEnriched(),
    getItemAnalytics(),
    getHeroAccuracy(),
    latestPatch(),
  ]);
  if (rawItems.length === 0)
    throw new Error("item fetch failed: refusing to write an empty snapshot");

  const frozenHeroes: FrozenHero[] = [];
  for (const name of REFERENCE_HEROES) {
    const hero = findHero(heroes, name);
    if (!hero) throw new Error(`reference hero not found: ${name}`);
    const [detail, abilitiesRaw, baseStats] = await Promise.all([
      fetchHeroById(hero.id),
      fetchHeroAbilityItems(hero.id),
      getHeroStats(hero.id),
    ]);
    if (!baseStats) throw new Error(`no base stats for ${name}`);
    frozenHeroes.push({
      id: hero.id,
      name: hero.name,
      heroItems: detail.items ?? {},
      abilitiesRaw,
      baseStats,
    });
  }

  const file: FrozenInputsFile = {
    version: 1,
    captured: new Date().toISOString().slice(0, 10),
    patch,
    heroes: frozenHeroes,
    roster: heroes.flatMap((h) => (h.baseStats ? [h.baseStats] : [])),
    itemAnalytics: [...itemAnalytics.values()].sort((a, b) => a.itemId - b.itemId),
    heroAccuracy: [...heroAccuracy.values()]
      .sort((a, b) => a.heroId - b.heroId)
      .map((a) => ({ ...a, byRankTier: [...a.byRankTier.entries()].sort((x, y) => x[0] - y[0]) })),
    tables: tablesFor(new Set(frozenHeroes.map((h) => h.id))),
  };
  writeFileSync(FROZEN_ITEMS_FILE, JSON.stringify(rawItems) + "\n");
  writeFileSync(FROZEN_INPUTS_FILE, JSON.stringify(file) + "\n");
  console.log(
    `captured ${rawItems.length} items, ${frozenHeroes.length} reference heroes, ` +
      `${file.roster.length} roster heroes (patch ${patch}, ${file.captured})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
