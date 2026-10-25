// lib/engine/__fixtures__/frozen/baselines.ts — the recorded baseline baskets
// (item scoring review §2.1). Computed on the frozen inputs, so the only things
// that can change them are scoring code and a deliberate re-capture. The engine
// harness diffs against baselines.json; `npm run baseline -- --update` rewrites it,
// and every scoring PR shows that diff in its body.
//
// Each case is a few readable lines (picks in order, souls paid, the headline
// term), so a git diff of baselines.json reads as "what changed for whom".

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOON_THRESHOLDS } from "../../../boonSystem";
import { calculateStatTotals, combineStatTotal } from "../../../buildCalculations";
import { calculateStatsAtBoon } from "../../../heroStats";
import type { Item } from "../../../items";
import { headlineTerm } from "../../../basketReasons";
import { heroPairLift } from "../../pairLift";
import { heroCategorySplit } from "../../categorySplit";
import { heroPhaseItems } from "../../phaseItems";
import { runHeroBasket } from "../../heroBasket";
import type { HeroBasketInputs } from "../../heroBasket";
import { buildStarterBuild } from "../../starterBuild";
import type { StarterBuild } from "../../starterBuild";
import { FROZEN_DIR } from "./frozenInputs";
import type { FrozenData, FrozenKit } from "./frozenInputs";

export const BASELINES_FILE = join(FROZEN_DIR, "baselines.json");

/** Planner boon-slider indices: laning, early, mid-early, mid, late. */
export const BASELINE_BOON_LEVELS = [5, 10, 16, 22, 29] as const;

export interface BaselineFile {
  version: 1;
  /** The frozen inputs these were computed on. */
  inputs: { captured: string; patch: string };
  cases: Record<string, string[]>;
}

type BaseInputs = Omit<HeroBasketInputs, "ownedItems" | "souls" | "boonLevel" | "spiritPower">;

function baseInputs(data: FrozenData, kit: FrozenKit): BaseInputs {
  return {
    heroAbilities: kit.heroAbilities,
    heroBaseStats: kit.heroBaseStats,
    heroRoster: data.roster,
    allItems: data.allItems,
    itemAnalytics: data.itemAnalytics,
    heroAccuracy: data.heroAccuracy,
    rankTier: null,
    pairLift: heroPairLift(data.tables.pairLift, kit.id) ?? undefined,
    categorySplit: heroCategorySplit(data.tables.categorySplit, kit.id) ?? undefined,
    phaseItems: heroPhaseItems(data.tables.phaseItems, kit.id) ?? undefined,
  };
}

/** The basket BuildClient shows at this boon level with these items owned. */
function basketLines(base: BaseInputs, owned: ReadonlyArray<Item>, boonLevel: number): string[] {
  const totals = calculateStatTotals([...owned]);
  const spiritPower = combineStatTotal(
    calculateStatsAtBoon(base.heroBaseStats, boonLevel).spiritPower,
    totals.spiritPowerFlat,
    totals.spiritPowerPercent,
  );
  const run = runHeroBasket({
    ...base,
    ownedItems: owned,
    souls: BOON_THRESHOLDS[boonLevel]?.souls ?? 0,
    boonLevel,
    spiritPower,
  });
  if (!run) return ["no basket"];
  const { basket } = run;
  return [
    `stop=${basket.stopReason} total=${basket.totalCost}`,
    ...basket.picks.map((p) => {
      const top = headlineTerm(p.terms);
      const trade = p.consumes.length > 0 ? ` trades ${p.consumes.join("+")}` : "";
      return `${p.item.itemId} ${p.effectiveCost} ${top?.termId ?? "-"}${trade}`;
    }),
  ];
}

function starterLines(build: StarterBuild | null): string[] {
  if (!build) return ["no starter build"];
  return build.phases.flatMap((p) => [
    `${p.phase}: ${p.buyOrder.map((i) => i.id).join(", ")}`,
    ...(p.consumed.length > 0
      ? [`${p.phase} trades: ${p.consumed.map((i) => i.id).join(", ")}`]
      : []),
  ]);
}

export function computeBaselines(data: FrozenData): BaselineFile {
  const cases: Record<string, string[]> = {};
  for (const kit of data.kits) {
    const base = baseInputs(data, kit);
    const starter = buildStarterBuild({ ...base, ownedItems: [] });
    cases[`starter ${kit.name}`] = starterLines(starter);
    const earlyOwned = starter?.phases[0]?.items ?? [];
    for (const boon of BASELINE_BOON_LEVELS) {
      cases[`basket ${kit.name} boon${boon} empty`] = basketLines(base, [], boon);
      if (boon > 10 && earlyOwned.length > 0) {
        cases[`basket ${kit.name} boon${boon} owns-early`] = basketLines(base, earlyOwned, boon);
      }
    }
  }
  return { version: 1, inputs: { captured: data.captured, patch: data.patch }, cases };
}

export function readBaselines(): BaselineFile | null {
  try {
    return JSON.parse(readFileSync(BASELINES_FILE, "utf-8")) as BaselineFile;
  } catch {
    return null;
  }
}

/** Keys whose lines differ (added, removed or changed), in key order. */
export function diffBaselines(
  before: BaselineFile,
  after: BaselineFile,
): Array<{ key: string; before: string[] | null; after: string[] | null }> {
  const keys = [...new Set([...Object.keys(before.cases), ...Object.keys(after.cases)])].sort();
  return keys.flatMap((key) => {
    const b = before.cases[key] ?? null;
    const a = after.cases[key] ?? null;
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ key, before: b, after: a }];
  });
}

/** One JSON line per case, so a git diff shows exactly which baskets moved. */
export function formatBaselines(file: BaselineFile): string {
  const keys = Object.keys(file.cases).sort();
  const body = keys
    .map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(file.cases[k])}`)
    .join(",\n");
  return `{\n  "version": 1,\n  "inputs": ${JSON.stringify(file.inputs)},\n  "cases": {\n${body}\n  }\n}\n`;
}
