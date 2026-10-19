// src/scripts/basketProbe.ts — live basket check against real API data
// Run: npm run probe -- <hero> [--owned a,b] [--boon N] [--rank T] [--item x] [--top N]
//
// Reproduces BuildClient's `heroBasket` useMemo for one hero, using the same
// loaders as app/build/[heroId]/page.tsx, and prints what the basket picks and
// why. Use it for the "live sanity check" after an engine change instead of
// writing a throwaway script. It calls the lib functions — it never
// reimplements them — so if BuildClient's pipeline changes, change this to
// match (search for "MIRRORS BuildClient").
//
// Live network, NOT a fixture: results move with patches and match data.
// Fixtures stay hermetic in lib/engine/__fixtures__/mini.ts.

import { fetchHeroById } from "@/lib/deadlock";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import type { Item } from "@/lib/items";
import {
  getHeroAccuracy,
  getItemAnalytics,
  getRankTiers,
  resolveAccuracyAtRank,
} from "@/lib/analyticsStore";
import { getHeroStats } from "@/lib/heroStore";
import { fetchHeroAbilityItems } from "@/lib/api/deadlockApi";
import { mapHeroAbilities } from "@/lib/abilityCoefficients";
import { calculateStatsAtBoon } from "@/lib/heroStats";
import { calculateStatTotals, combineStatTotal } from "@/lib/buildCalculations";
import { BOON_THRESHOLDS } from "@/lib/boonSystem";
import { MAX_ACTIVE_ITEMS } from "@/lib/buildUtils";
import {
  DEFAULT_BASKET_TERMS,
  constructBasket,
  makeBasketContext,
} from "@/lib/engine/basketSelect";
import {
  deriveHeroNeedVector,
  deriveHitReliabilityFactor,
  deriveProcPlatformFactor,
} from "@/lib/engine/heroNeed";
import { toItemCandidates } from "@/lib/engine/itemAdapter";
import { heroPairLift } from "@/lib/engine/pairLift";
import type { PairLiftTable } from "@/lib/engine/pairLift";
import pairLiftTableJson from "@/lib/engine/data/pairLiftTable.json";
import { SCORE_CATEGORIES } from "@/lib/engine/types";
import type { BasketState, ItemCandidate, MarginalTerm, ScoreCategory } from "@/lib/engine/types";

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
`;

interface ProbeArgs {
  hero: string;
  owned: string[];
  boon: number;
  rank: number | null;
  items: string[];
  top: number;
  pairLift: boolean;
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
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // ── Load: same sources as app/build/[heroId]/page.tsx ────────────────────
  const [heroes, allItems, itemAnalytics, heroAccuracy, rankTiers] = await Promise.all([
    fetchVisibleHeroesEnriched(),
    getItems(),
    getItemAnalytics(),
    getHeroAccuracy(),
    getRankTiers(),
  ]);

  const heroQuery = norm(args.hero);
  const hero =
    heroes.find((h) => String(h.id) === args.hero) ??
    heroes.find((h) => norm(h.name) === heroQuery);
  if (!hero) fail(`no visible hero matches "${args.hero}"`);

  const [heroData, rawAbilities, heroBaseStats] = await Promise.all([
    fetchHeroById(hero.id),
    fetchHeroAbilityItems(hero.id),
    getHeroStats(hero.id),
  ]);
  if (!heroBaseStats) fail(`no base stats for ${hero.name} — the hero stats fetch failed`);

  const heroAbilities = mapHeroAbilities(rawAbilities, heroData.items);
  const heroRoster = heroes.flatMap((h) => (h.baseStats ? [h.baseStats] : []));
  const buildItems = args.owned.map((q) => findItem(allItems, q));
  const probeItems = args.items.map((q) => findItem(allItems, q));

  // ── MIRRORS BuildClient: totalSpiritPower / boonSouls / heroBasket ───────
  const manualBoonLevel = args.boon;
  const boonSouls = BOON_THRESHOLDS[manualBoonLevel]?.souls ?? 0;
  const itemStatTotals = calculateStatTotals(buildItems);
  const totalSpiritPower = combineStatTotal(
    calculateStatsAtBoon(heroBaseStats, manualBoonLevel).spiritPower,
    itemStatTotals.spiritPowerFlat,
    itemStatTotals.spiritPowerPercent,
  );

  // BuildClient resolves whenever the prop exists, including an empty (failed-
  // open) map, so do the same rather than special-casing size 0.
  const gunAccuracyByHeroId = resolveAccuracyAtRank(heroAccuracy, args.rank);

  const needVector = deriveHeroNeedVector({
    abilities: heroAbilities,
    baseStats: heroBaseStats,
    roster: heroRoster,
    gunAccuracyByHeroId,
  });

  const ownedIds = new Set(buildItems.map((i) => i.id));
  const candidates = toItemCandidates(
    allItems.filter((i) => !ownedIds.has(i.id)),
    { spiritPower: totalSpiritPower, boonLevel: manualBoonLevel },
  );
  const committed = buildItems.reduce((sum, i) => sum + i.cost, 0);

  const procPlatformFactor = deriveProcPlatformFactor({
    baseStats: heroBaseStats,
    roster: heroRoster,
    gunAccuracyByHeroId,
  });
  const hitReliabilityFactor = deriveHitReliabilityFactor({
    baseStats: heroBaseStats,
    roster: heroRoster,
    gunAccuracyByHeroId,
  });

  const ctx = makeBasketContext({
    needVector,
    soulBudget: Math.max(0, boonSouls - committed),
    maxItems: Math.max(0, MAX_ACTIVE_ITEMS - buildItems.length),
    itemAnalytics,
    procPlatformFactor,
    hitReliabilityFactor,
    ownedItemNames: new Map(buildItems.map((i) => [i.id, i.name])),
    // Sliced like app/build/[heroId]/page.tsx does on the server.
    pairLift: args.pairLift
      ? (heroPairLift(pairLiftTableJson as unknown as PairLiftTable, hero.id) ?? undefined)
      : undefined,
  });

  const basket = constructBasket(candidates, ctx);
  // ── end mirror ───────────────────────────────────────────────────────────

  // First-pick ranking: every affordable candidate scored against the empty
  // starting state, ordered exactly as the greedy loop breaks ties
  // (value desc, cost asc, itemId asc). Shows where items sit before the
  // basket's own picks start changing coverage.
  const emptyCoverage = {} as Record<ScoreCategory, number>;
  for (const cat of SCORE_CATEGORIES) emptyCoverage[cat] = 0;
  const startState: BasketState = {
    picked: [],
    coverage: emptyCoverage,
    soulsPerCategory: { gun: 0, spirit: 0, vitality: 0 },
    spent: 0,
  };
  const ranked: Ranked[] = candidates
    .filter((c) => c.cost <= ctx.soulBudget)
    .map((candidate) => {
      const terms: MarginalTerm[] = [];
      let value = 0;
      for (const term of DEFAULT_BASKET_TERMS) {
        const r = term.evaluate(candidate, startState, ctx);
        if (r === null || !Number.isFinite(r.value)) continue;
        terms.push(r);
        value += r.value;
      }
      return { candidate, value, terms };
    })
    .sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
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
      `  ${lpad(String(i + 1), 2)}. ${pad(p.item.name, 24)} ${pad(p.item.category, 8)} ${lpad(String(p.item.cost), 5)}` +
        `  value ${lpad(fmt(p.marginalValue), 7)}  [${termSummary(p.terms)}]`,
    );
  });
  const unmet = SCORE_CATEGORIES.filter((c) => basket.unmetNeed[c] > 0.005);
  console.log(
    `  unmet: ${unmet.length ? unmet.map((c) => `${c} ${fmt(basket.unmetNeed[c], 1)}`).join(", ") : "none"}`,
  );

  console.log(
    `\nFirst-pick ranking (top ${Math.min(args.top, ranked.length)} of ${ranked.length} affordable):`,
  );
  ranked.slice(0, args.top).forEach((r, i) => {
    console.log(
      `  ${lpad(String(i + 1), 3)}. ${pad(r.candidate.name, 24)} ${pad(r.candidate.category, 8)}` +
        ` ${lpad(String(r.candidate.cost), 5)}  ${lpad(fmt(r.value), 7)}  [${termSummary(r.terms)}]`,
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
