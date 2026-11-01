// src/scripts/fitRushGroups.ts — writes src/scripts/data/heroRushGroups.json
// Run: npm run fit-rush-groups [-- --dry]
//
// Milestone J (docs/milestone-j.md): for every hero in the committed heroPhaseItems.json,
// what its players bought in the early (0–9 min) and mid (9–20 min) columns of
// /v1/analytics/item-flow-stats, for all players and for the players who bought the
// hero's top early 3,200+ item in the first 9 minutes (locked_item_ids +
// locked_columns=0). Non-rushers are the difference, taken in rushGroups.ts.
//
// item-stats can't make this split: its include_item_ids matches a purchase at ANY time
// (data-verifier, 2026-10-31). item-flow's columns are fixed; its early column equals
// item-stats max_bought_at_s=539, against 600 for the committed tables (J0 measured the
// difference: M1 mean 0.001, O2 none).
//
// Pinned to the committed tables' window and rank, so the groups are the players the
// engine is tuned on. Only the starter-build fixtures (M1, O2) read the output. Rerun
// after every `npm run fit-category-split` and review the diff.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getItems } from "@/lib/itemStore";
import type { PhaseItemsTable } from "@/lib/engine/phaseItems";
import phaseItemsTableJson from "@/lib/engine/data/heroPhaseItems.json";
import { topRushItem } from "./bigItemChecks";
import { getJson } from "./pairData";
import { rushGroupsProblem } from "./rushGroups";
import type { GroupCounts, HeroRushGroups, PhaseCounts, RushGroupsTable } from "./rushGroups";

/**
 * Keep an item in a column when at least this share of all players bought it there. At
 * 2% the dropped tail moved the M1 mean from 0.127 (J0, every node) to 0.132; at 0.5% it
 * matches J0 (2026-10-31).
 */
const MIN_SHARE = 0.005;

interface FlowNode {
  column: number;
  item_id: number;
  matches: number;
}
interface FlowResponse {
  nodes: FlowNode[];
  summary: { matches: number };
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const phaseItems = phaseItemsTableJson as unknown as PhaseItemsTable;
  const items = await getItems();
  // getItems() fails open to []: never let an outage overwrite the committed table.
  if (items.length === 0) throw new Error("refusing to fit: no items loaded");
  const byNumericId = new Map(items.map((i) => [i.numericId, i]));
  const costOf = (id: string) => items.find((i) => i.id === id)?.cost;
  const window = {
    min_unix_timestamp: Date.parse(phaseItems.window.from) / 1000,
    max_unix_timestamp: Date.parse(phaseItems.window.to) / 1000,
    min_average_badge: phaseItems.method.minAverageBadge,
  };

  // Item ids by column, with the all-player kept set applied to both groups so the
  // subtraction stays item by item.
  const columns = (flow: FlowResponse, keep?: { early: PhaseCounts; mid: PhaseCounts }) => {
    const out = { early: {} as Record<string, number>, mid: {} as Record<string, number> };
    const min = MIN_SHARE * flow.summary.matches;
    for (const n of flow.nodes) {
      const phase = n.column === 0 ? "early" : n.column === 1 ? "mid" : null;
      const item = byNumericId.get(n.item_id);
      if (!phase || !item) continue;
      if (keep ? keep[phase][item.id] === undefined : n.matches < min) continue;
      out[phase][item.id] = n.matches;
    }
    const sorted = (c: Record<string, number>) =>
      Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));
    return { early: sorted(out.early), mid: sorted(out.mid) };
  };

  const table: RushGroupsTable = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    window: phaseItems.window,
    method: {
      minAverageBadge: phaseItems.method.minAverageBadge,
      source: "item-flow-stats; rushers: locked_item_ids=<rushItem>&locked_columns=0",
      minShare: MIN_SHARE,
      measure: "player-matches that bought the item in the column (early 0-9 min, mid 9-20 min)",
    },
    heroes: {},
  };

  const heroIds = Object.keys(phaseItems.heroes).sort((a, b) => Number(a) - Number(b));
  for (const heroId of heroIds) {
    const rush = topRushItem(phaseItems.heroes[heroId].early, costOf);
    const rushItem = rush ? items.find((i) => i.id === rush[0]) : undefined;
    const flow = await getJson<FlowResponse>("item-flow-stats", { ...window, hero_ids: heroId });
    if (!(flow.summary.matches > 0)) {
      console.warn(`  skip hero ${heroId}: no matches`);
      continue;
    }
    const all: GroupCounts = { matches: flow.summary.matches, ...columns(flow) };
    const entry: HeroRushGroups = { rushItem: rushItem?.id ?? null, all };
    if (rushItem) {
      const locked = await getJson<FlowResponse>("item-flow-stats", {
        ...window,
        hero_ids: heroId,
        locked_item_ids: rushItem.numericId,
        locked_columns: 0,
      });
      entry.rushers = { matches: locked.summary.matches, ...columns(locked, all) };
    }
    const problem = rushGroupsProblem(entry);
    if (problem) throw new Error(`hero ${heroId}: ${problem}`);
    table.heroes[heroId] = entry;
    const share = entry.rushers ? entry.rushers.matches / all.matches : 0;
    console.log(
      `  hero ${heroId.padStart(2)}  ${all.matches} matches  rush ${rushItem?.name ?? "-"}${entry.rushers ? ` ${(share * 100).toFixed(1)}% rushers` : ""}`,
    );
  }

  const heroLines = Object.entries(table.heroes)
    .map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`)
    .join(",\n");
  const { heroes: _omit, ...head } = table;
  void _omit;
  const headJson = JSON.stringify(head, null, 2);
  const text = `${headJson.slice(0, -2)},\n  "heroes": {\n${heroLines}\n  }\n}\n`;

  const out = path.join(process.cwd(), "src/scripts/data/heroRushGroups.json");
  const fitted = Object.keys(table.heroes).length;
  // A large drop in fitted heroes means a broken fetch, not a meta shift.
  if (fitted < heroIds.length * 0.8) {
    throw new Error(`refusing to write: ${fitted} heroes fitted of ${heroIds.length}`);
  }
  if (existsSync(out)) {
    const before = Object.keys(
      (JSON.parse(readFileSync(out, "utf8")) as RushGroupsTable).heroes,
    ).length;
    if (fitted < before * 0.8) {
      throw new Error(`refusing to write: ${fitted} heroes fitted vs ${before} committed`);
    }
  }
  if (dry) console.log(`\n--dry: would write ${fitted} heroes to ${out}`);
  else {
    writeFileSync(out, text);
    console.log(`\nwrote ${fitted} heroes to ${out}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
