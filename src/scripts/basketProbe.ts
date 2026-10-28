// src/scripts/basketProbe.ts — live basket check against real API data
// Run: npm run probe -- <hero> [--owned a,b] [--boon N] [--rank T] [--item x] [--top N]
//
// Runs the same pipeline as BuildClient's `heroBasket` (runHeroBasket in
// lib/engine/heroBasket.ts) for one hero, on data loaded the way
// app/build/[heroId]/page.tsx loads it (./basketData.ts), and prints what the
// basket picks and why. Use it for the "live sanity check" after an engine
// change instead of writing a throwaway script. Only the inputs BuildClient
// derives itself (souls from the boon slider, spirit power from owned items)
// are computed here; keep those in step with BuildClient.
//
// Live network, NOT a fixture: results move with patches and match data.
// Hermetic engine fixtures live in lib/engine/__fixtures__/mini.ts.

import type { Item } from "@/lib/items";
import { calculateStatsAtBoon } from "@/lib/heroStats";
import { calculateStatTotals, combineStatTotal } from "@/lib/buildCalculations";
import { BOON_THRESHOLDS } from "@/lib/boonSystem";
import {
  DEFAULT_BASKET_TERMS,
  blockedByComponents,
  componentClosures,
  effectiveCost,
  initialBasketState,
  rankingPrice,
} from "@/lib/engine/basketSelect";
import { runHeroBasket } from "@/lib/engine/heroBasket";
import { ANCHOR_MARGIN, basketPlans } from "@/lib/engine/basketSelect";
import { heroPairLift } from "@/lib/engine/pairLift";
import { heroCategorySplit } from "@/lib/engine/categorySplit";
import { enemyHealthRates, heroPhaseItems } from "@/lib/engine/phaseItems";
import { SCORE_CATEGORIES } from "@/lib/engine/types";
import { findHero, loadHeroKit, loadLiveBasketData } from "./basketData";
import type { ItemCandidate, MarginalTerm } from "@/lib/engine/types";

const USAGE = `Usage: npm run probe -- <hero> [options]

  <hero>          hero id (e.g. 6) or name (e.g. graves, "lady geist")

Options:
  --owned a,b     items already in the build: item ids or names, comma-separated
  --boon N        boon level 0-${BOON_THRESHOLDS.length - 1} (default 15); sets souls exactly as the UI slider does
  --rank T        rank tier 0-11 for accuracy (default: pooled across ranks)
  --item x        also report this item's first-pick rank and terms (repeatable)
  --top N         rows of the first-pick ranking to print (default 15)
  --no-pair-lift  omit the measured pair table (pairTerm inert, hand synergy rules
                  never overridden): the pre-Milestone-F-PR-3 basket, for before/after
  --no-category-split
                  omit the measured gun/spirit/vitality split (kit-only need vector,
                  no category-split term), for before/after
  --split-need-only  apply the split to the need vector only (ablation)
  --split-term-only  apply the split as the basket term only (ablation)
  --no-phase-items  omit what high-rank players on this hero buy per phase
                  (phaseItemTerm inert), for before/after
`;

interface ProbeArgs {
  hero: string;
  owned: string[];
  boon: number;
  rank: number | null;
  items: string[];
  top: number;
  pairLift: boolean;
  categorySplit: boolean;
  phaseItems: boolean;
  splitMode: "both" | "need-only" | "term-only";
}

function fail(message: string): never {
  console.error(`basketProbe: ${message}\n\n${USAGE}`);
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
    owned: [],
    boon: 15,
    rank: null,
    items: [],
    top: 15,
    pairLift: true,
    categorySplit: true,
    phaseItems: true,
    splitMode: "both",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--owned") {
      out.owned.push(
        ...(argv[++i] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (a === "--boon") {
      out.boon = parseIntArg(a, argv[++i], 0, BOON_THRESHOLDS.length - 1);
    } else if (a === "--rank") {
      out.rank = parseIntArg(a, argv[++i], 0, 11);
    } else if (a === "--item") {
      const v = argv[++i];
      if (!v) fail("--item needs a value");
      out.items.push(v);
    } else if (a === "--no-pair-lift") {
      out.pairLift = false;
    } else if (a === "--no-category-split") {
      out.categorySplit = false;
    } else if (a === "--no-phase-items") {
      out.phaseItems = false;
    } else if (a === "--split-need-only") {
      out.splitMode = "need-only";
    } else if (a === "--split-term-only") {
      out.splitMode = "term-only";
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
const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));
const lpad = (s: string, w: number) => (s.length >= w ? s : " ".repeat(w - s.length) + s);

function termSummary(terms: ReadonlyArray<MarginalTerm>): string {
  return terms.map((t) => `${t.termId} ${t.value >= 0 ? "+" : ""}${fmt(t.value)}`).join(", ");
}

interface Ranked {
  candidate: ItemCandidate;
  value: number;
  terms: MarginalTerm[];
  effective: { cost: number; consumes: ItemCandidate[] };
  /** value ÷ rankingPrice: the order the greedy loop actually uses. */
  score: number;
}

/** "3200" or "3200→2400 (upgrades Cold Front)" when held components are consumed. */
function costLabel(cost: number, effective: number, consumedNames: ReadonlyArray<string>): string {
  if (consumedNames.length === 0) return String(cost);
  return `${cost}→${effective} (upgrades ${consumedNames.join(", ")})`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // ── Load: same sources as app/build/[heroId]/page.tsx ────────────────────
  const data = await loadLiveBasketData();
  const { allItems, itemAnalytics, heroAccuracy, rankTiers } = data;

  const hero = findHero(data.heroes, args.hero);
  if (!hero) fail(`no visible hero matches "${args.hero}"`);

  const kit = await loadHeroKit(hero);
  if (!kit) fail(`no base stats for ${hero.name} — the hero stats fetch failed`);

  const buildItems = args.owned.map((q) => findItem(allItems, q));
  const probeItems = args.items.map((q) => findItem(allItems, q));

  // ── Same inputs BuildClient derives: totalSpiritPower / boonSouls ────────
  const manualBoonLevel = args.boon;
  const boonSouls = BOON_THRESHOLDS[manualBoonLevel]?.souls ?? 0;
  const itemStatTotals = calculateStatTotals(buildItems);
  const totalSpiritPower = combineStatTotal(
    calculateStatsAtBoon(kit.heroBaseStats, manualBoonLevel).spiritPower,
    itemStatTotals.spiritPowerFlat,
    itemStatTotals.spiritPowerPercent,
  );

  // The pipeline itself is shared with BuildClient (lib/engine/heroBasket.ts).
  const run = runHeroBasket({
    heroAbilities: kit.heroAbilities,
    heroBaseStats: kit.heroBaseStats,
    heroRoster: data.heroRoster,
    allItems,
    ownedItems: buildItems,
    souls: boonSouls,
    boonLevel: manualBoonLevel,
    spiritPower: totalSpiritPower,
    itemAnalytics,
    heroAccuracy,
    rankTier: args.rank,
    // Sliced like app/build/[heroId]/page.tsx does on the server.
    pairLift: args.pairLift ? (heroPairLift(data.pairLiftTable, hero.id) ?? undefined) : undefined,
    // Sliced like page.tsx; --no-category-split gives the kit-only need vector.
    categorySplit: args.categorySplit
      ? (heroCategorySplit(data.categorySplitTable, hero.id) ?? undefined)
      : undefined,
    categorySplitMode: args.splitMode,
    // Sliced like page.tsx; --no-phase-items turns phaseItemTerm off.
    phaseItems: args.phaseItems
      ? (heroPhaseItems(data.phaseItemsTable, hero.id) ?? undefined)
      : undefined,
    // Roster-wide, like page.tsx: independent of --no-phase-items.
    enemyHealthRates: enemyHealthRates(data.phaseItemsTable),
  });
  if (!run) fail(`${hero.name} has no ability data or the item list is empty`);
  const { basket, ctx, candidates, needVector, procPlatformFactor, hitReliabilityFactor } = run;
  const ownedIds = new Set(buildItems.map((i) => i.id));
  const nameOf = new Map(allItems.map((i) => [i.id, i.name]));

  // First-pick ranking: every candidate the loop's FIRST iteration would
  // consider, scored against the same starting state (owned coverage, investment
  // souls and held set from initialBasketState), filtered the same way (H2
  // component rule, effective cost, slots), and ordered exactly as the greedy
  // loop breaks ties (value desc, cost asc, itemId asc).
  const startState = initialBasketState(ctx);
  const closures = componentClosures([...ctx.owned, ...candidates]);
  const startHeld = startState.held ?? [];
  const ranked: Ranked[] = candidates
    .filter((c) => !blockedByComponents(c, startState, closures))
    .filter((c) => {
      const eff = effectiveCost(c, startHeld);
      return eff.cost <= ctx.soulBudget && ctx.maxItems - 1 + eff.consumes.length >= 0;
    })
    .map((candidate) => {
      const terms: MarginalTerm[] = [];
      let value = 0;
      for (const term of DEFAULT_BASKET_TERMS) {
        const r = term.evaluate(candidate, startState, ctx);
        if (r === null || !Number.isFinite(r.value)) continue;
        terms.push(r);
        value += r.value;
      }
      const effective = effectiveCost(candidate, startHeld);
      // Same ranking as the loop: value per unit of the binding resource.
      // (Shop budgets are not applied here: an item ranked first can still be
      // skipped by the loop's first pass when its shop's share is spent.)
      const score =
        value /
        rankingPrice(
          effective.cost,
          ctx.soulBudget,
          ctx.maxItems,
          ctx.phase === "early" ? ctx.soulBudget : undefined,
        );
      return { candidate, value, terms, effective, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.candidate.cost !== b.candidate.cost) return a.candidate.cost - b.candidate.cost;
      return a.candidate.itemId.localeCompare(b.candidate.itemId);
    });

  // ── Report ──────────────────────────────────────────────────────────────
  const rankName =
    args.rank === null
      ? "pooled (all ranks)"
      : (rankTiers.find((r) => r.tier === args.rank)?.name ?? `tier ${args.rank}`);
  console.log(
    `\n${hero.name} (id ${hero.id}) — boon ${manualBoonLevel}, ${boonSouls} souls, accuracy: ${rankName}`,
  );
  console.log(
    `owned: ${buildItems.length ? buildItems.map((i) => `${i.name} (${i.cost})`).join(", ") : "none"}` +
      ` | budget ${ctx.soulBudget}, ${ctx.maxItems} slots | spirit power ${fmt(totalSpiritPower, 1)}`,
  );
  console.log(
    `proc platform ${fmt(procPlatformFactor, 3)}, hit reliability ${fmt(hitReliabilityFactor, 3)}` +
      ` | analytics rows ${itemAnalytics.size}, accuracy rows ${heroAccuracy.size}`,
  );

  console.log("\nNeed vector (target per category):");
  console.log(
    SCORE_CATEGORIES.filter((c) => needVector[c] > 0)
      .map((c) => `  ${pad(c, 13)} need ${fmt(needVector[c])}  target ${fmt(basket.target[c], 1)}`)
      .join("\n"),
  );

  console.log(
    `\nBasket — ${basket.picks.length} picks, ${basket.totalCost} souls, stopped: ${basket.stopReason}`,
  );
  basket.picks.forEach((p, i) => {
    console.log(
      `  ${lpad(String(i + 1), 2)}. ${pad(p.item.name, 24)} ${pad(p.item.category, 8)} ${lpad(
        costLabel(
          p.item.cost,
          p.effectiveCost,
          p.consumes.map((id) => nameOf.get(id) ?? id),
        ),
        5,
      )}` + `  value ${lpad(fmt(p.marginalValue), 7)}  [${termSummary(p.terms)}]`,
    );
  });
  const unmet = SCORE_CATEGORIES.filter((c) => basket.unmetNeed[c] > 0.005);
  console.log(
    `  unmet: ${unmet.length ? unmet.map((c) => `${c} ${fmt(basket.unmetNeed[c], 1)}`).join(", ") : "none"}`,
  );

  // Planned big items (Milestone H): the plans constructBasket compared.
  const plans = basketPlans(candidates, ctx);
  console.log(
    `\nPlans compared (an anchored plan is kept only above +${ANCHOR_MARGIN * 100}%): greedy ${fmt(plans.greedy.value)}`,
  );
  for (const a of plans.anchored) {
    const gain = plans.greedy.value > 0 ? (a.value / plans.greedy.value - 1) * 100 : 0;
    console.log(
      `  save for ${pad(a.anchor.name, 24)} ${a.result ? `${lpad(fmt(a.value), 7)} (${gain >= 0 ? "+" : ""}${fmt(gain, 1)}%)` : "cannot lead"}` +
        (plans.chosen?.anchor.itemId === a.anchor.itemId ? "  <- chosen" : ""),
    );
  }
  if (plans.anchored.length === 0) console.log("  no big item to save for");

  console.log(
    `\nFirst-pick ranking (top ${Math.min(args.top, ranked.length)} of ${ranked.length} affordable):`,
  );
  ranked.slice(0, args.top).forEach((r, i) => {
    console.log(
      `  ${lpad(String(i + 1), 3)}. ${pad(r.candidate.name, 24)} ${pad(r.candidate.category, 8)}` +
        ` ${lpad(
          costLabel(
            r.candidate.cost,
            r.effective.cost,
            r.effective.consumes.map((c) => c.name),
          ),
          5,
        )}  ${lpad(fmt(r.value), 7)}  per-price ${fmt(r.score * 1000, 1)}/1k  [${termSummary(r.terms)}]`,
    );
  });

  for (const item of probeItems) {
    console.log(`\nItem: ${item.name} (${item.id}, ${item.category}, ${item.cost} souls)`);
    if (ownedIds.has(item.id)) {
      console.log("  owned — not a candidate");
      continue;
    }
    const pickIndex = basket.picks.findIndex((p) => p.item.itemId === item.id);
    console.log(`  in basket: ${pickIndex >= 0 ? `yes, pick ${pickIndex + 1}` : "no"}`);
    const idx = ranked.findIndex((r) => r.candidate.itemId === item.id);
    if (idx < 0) {
      console.log(`  first-pick rank: not affordable (budget ${ctx.soulBudget})`);
      continue;
    }
    const r = ranked[idx];
    const sameCat = ranked.filter((x) => x.candidate.category === item.category);
    const catIdx = sameCat.findIndex((x) => x.candidate.itemId === item.id);
    console.log(
      `  first-pick rank: ${idx + 1} of ${ranked.length} overall, ${catIdx + 1} of ${sameCat.length} ${item.category}` +
        ` | value ${fmt(r.value)}`,
    );
    for (const t of r.terms)
      console.log(`    ${pad(t.termId, 15)} ${lpad(fmt(t.value), 7)}  ${t.reason}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
