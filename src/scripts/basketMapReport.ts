// src/scripts/basketMapReport.ts — writes the gitignored reports/basket-map.html
// ("Item Need Baskets"): for each need category, every item that helps with it,
// and for the 8 reference heroes at the baseline boon levels, the engine's own
// hero-priced values, need targets, coverage and picks with an empty build.
//
// Run: npm run basket-map
//
// Reads the frozen engine inputs (lib/engine/__fixtures__/frozen/), the same
// ones the baselines use, so the page shows exactly what the baselines record.
// Refresh them first with `npm run capture-inputs` to show newer data. The page
// layout lives in basketMapReport.template.html; this script only fills its data.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BOON_THRESHOLDS } from "@/lib/boonSystem";
import { calculateStatsAtBoon } from "@/lib/heroStats";
import { heroCategorySplit } from "@/lib/engine/categorySplit";
import { runHeroBasket } from "@/lib/engine/heroBasket";
import { toItemCandidates } from "@/lib/engine/itemAdapter";
import { heroPairLift } from "@/lib/engine/pairLift";
import { enemyHealthRates, heroPhaseItems } from "@/lib/engine/phaseItems";
import { SCORE_CATEGORIES, SCORE_CATEGORY_PLAIN } from "@/lib/engine/types";
import type { ScoreCategory } from "@/lib/engine/types";
import { BASELINE_BOON_LEVELS } from "@/lib/engine/__fixtures__/frozen/baselines";
import { loadFrozen } from "@/lib/engine/__fixtures__/frozen/frozenInputs";

const TEMPLATE = path.join(process.cwd(), "src", "scripts", "basketMapReport.template.html");
const OUT_DIR = path.join(process.cwd(), "reports");
const OUT_FILE = path.join(OUT_DIR, "basket-map.html");
// Whitespace-tolerant: prettier puts the template's `null` on its own line.
const DATA_SLOT = /<script id="data" type="application\/json">\s*null\s*<\/script>/;

type Values = Partial<Record<ScoreCategory, number>>;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Positive categories only, rounded: the page treats a missing key as 0. */
function positive(values: Readonly<Values>): Values {
  const out: Values = {};
  for (const c of SCORE_CATEGORIES) {
    const v = round2(values[c] ?? 0);
    if (v > 0) out[c] = v;
  }
  return out;
}

const data = loadFrozen();
const items = [...data.allItems].sort(
  (a, b) => a.category.localeCompare(b.category) || a.cost - b.cost || a.name.localeCompare(b.name),
);
// "Any hero": the hero-agnostic valuation (no hero model, no spirit power).
const generic = new Map(toItemCandidates(items).map((c) => [c.itemId, c.categoryValues]));

const heroes = data.kits.map((kit) => {
  const levels = BASELINE_BOON_LEVELS.map((boon) => {
    const souls = BOON_THRESHOLDS[boon]?.souls ?? 0;
    const run = runHeroBasket({
      heroAbilities: kit.heroAbilities,
      heroBaseStats: kit.heroBaseStats,
      heroRoster: data.roster,
      allItems: data.allItems,
      ownedItems: [],
      souls,
      boonLevel: boon,
      spiritPower: calculateStatsAtBoon(kit.heroBaseStats, boon).spiritPower,
      itemAnalytics: data.itemAnalytics,
      heroAccuracy: data.heroAccuracy,
      rankTier: null,
      pairLift: heroPairLift(data.tables.pairLift, kit.id) ?? undefined,
      categorySplit: heroCategorySplit(data.tables.categorySplit, kit.id) ?? undefined,
      phaseItems: heroPhaseItems(data.tables.phaseItems, kit.id) ?? undefined,
      enemyHealthRates: enemyHealthRates(data.tables.phaseItems),
    });
    if (!run) throw new Error(`no basket for ${kit.name} at boon ${boon}`);
    const { basket, candidates } = run;
    return {
      boon,
      souls,
      stop: basket.stopReason,
      total: basket.totalCost,
      target: positive(basket.target),
      coverage: positive(basket.coverage),
      picks: basket.picks.map((p) => p.item.itemId),
      values: Object.fromEntries(candidates.map((c) => [c.itemId, positive(c.categoryValues)])),
    };
  });
  return { id: kit.id, name: kit.name, levels };
});

const payload = {
  captured: data.captured,
  patch: data.patch,
  categories: SCORE_CATEGORIES.map((id) => ({ id, plain: SCORE_CATEGORY_PLAIN[id] })),
  items: items.map((i) => ({
    id: i.id,
    name: i.name,
    family: i.category,
    cost: i.cost,
    tier: i.tier,
    icon: i.icon ?? "",
    values: positive(generic.get(i.id) ?? {}),
  })),
  heroes,
};

const template = readFileSync(TEMPLATE, "utf8");
if (!DATA_SLOT.test(template)) throw new Error(`template has no data slot: ${TEMPLATE}`);
// "<" is escaped so no item text can close the JSON script tag.
const json = JSON.stringify(payload).replace(/</g, "\\u003c");
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT_FILE,
  template.replace(DATA_SLOT, () => `<script id="data" type="application/json">${json}</script>`),
);
console.log(
  `wrote ${OUT_FILE}: ${payload.items.length} items, ${heroes.length} heroes x ` +
    `${BASELINE_BOON_LEVELS.length} boon levels (inputs ${data.captured}, patch ${data.patch})`,
);
