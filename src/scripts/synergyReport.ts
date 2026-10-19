// src/scripts/synergyReport.ts — Milestone F: the synergy audit report
// Run: npm run synergy-report [-- --out reports/synergy-audit.html]
//
// Writes a self-contained HTML page comparing the hand-authored pair rules
// (SYNERGY_RULES, ANTI_SYNERGY_RULES) with the measured per-hero pair table
// (lib/engine/data/pairLiftTable.json), plus a per-hero explorer of every
// significant measured pair. Same family as item-scoring-audit.html, but
// regenerable: the HTML is NOT committed (reports/ is gitignored). Re-run this
// after every `npm run fit-pairs` and republish the same artifact.
//
// Deterministic from its inputs: the committed table, the item/hero names
// from the assets API, the two rule sets and RULE_REVIEW below. No analytics
// calls and no clock: the page's dates come from the table.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import type { Item } from "@/lib/items";
import { pairLiftKey } from "@/lib/engine/pairLift";
import type { PairLiftEntry, PairLiftTable } from "@/lib/engine/pairLift";
import { SYNERGY_RULES } from "@/lib/engine/synergy";
import { ANTI_SYNERGY_RULES } from "@/lib/scoring/antiSynergy";
import pairLiftTableJson from "@/lib/engine/data/pairLiftTable.json";

const DEFAULT_OUT = path.join("reports", "synergy-audit.html");
const CLIENT_SCRIPT = path.join(process.cwd(), "src", "scripts", "synergyReport.client.js");

/**
 * Mechanics review of each hand-authored rule's REASON text, by the
 * data-verifier agent against deadlock.wiki and the live item API. Update the
 * date and entries whenever a rule or its reason changes.
 */
const RULE_REVIEW_DATE = "2026-10-18";
type ReviewVerdict = "sound" | "partly-wrong" | "wrong" | "opinion";
const RULE_REVIEW: Record<string, { verdict: ReviewVerdict; note: string }> = {
  [pairLiftKey("upgrade_dps_aura", "upgrade_crackshot")]: {
    verdict: "opinion",
    note: "Play knowledge; the wiki documents no interaction between Heroic Aura and Mystic Shot.",
  },
  [pairLiftKey("upgrade_ricochet", "upgrade_toxic_bullets")]: {
    verdict: "sound",
    note: "Ricochet applies bullet procs to nearby enemies (deadlock.wiki/Ricochet), so it spreads Toxic Bullets.",
  },
  [pairLiftKey("upgrade_aoe_root", "upgrade_thermal_detonator")]: {
    verdict: "sound",
    note: "Vortex Web pulls enemies into a small area (4s); Alchemical Fire burns a 10m area for 5s.",
  },
  [pairLiftKey("upgrade_damage_recycler", "upgrade_surging_power")]: {
    verdict: "partly-wrong",
    note: "Lifesteal stacks multiplicatively (deadlock.wiki/Lifesteal): 28% and 13% give 37.4% instead of 41%, a small loss, not 'far below the sum'.",
  },
  [pairLiftKey("upgrade_critshot", "upgrade_glass_cannon")]: {
    verdict: "opinion",
    note: "No mechanical conflict. Budget opinion only, and the combined cost is 12,800 souls, not 12,400.",
  },
  [pairLiftKey("upgrade_cold_front", "upgrade_containment")]: {
    verdict: "partly-wrong",
    note: "Slows stack multiplicatively with a 2 m/s speed floor (deadlock.wiki/Slow). There is no DR cap.",
  },
  [pairLiftKey("upgrade_cloaking_device_active", "upgrade_self_bubble")]: {
    verdict: "opinion",
    note: "Role-overlap opinion. Shadow Weave is mainly an ambush tool (fire rate, spirit, melee), not an escape.",
  },
  [pairLiftKey("upgrade_rapid_recharge", "upgrade_extra_charge")]: {
    verdict: "wrong",
    note: "Extra Charge is Rapid Recharge's own component, and the charge bonuses add up with no documented cap. This warns on the normal upgrade path.",
  },
};

// ─── Data model embedded in the page ─────────────────────────────────────────

type Verdict = "supported" | "contradicted" | "no-effect" | "inconclusive" | "no-data";

interface ReportItem {
  id: string;
  name: string;
  /** "gun" | "spirit" | "vitality" */
  cat: string;
  tier: number;
  cost: number;
}

interface RuleHero {
  hero: string;
  heroId: string;
  lift: number;
  se: number;
  n: number;
  verdict: Verdict;
  /** Synergy rules only: the basket uses this measurement instead of the rule. */
  basketUsesMeasurement: boolean;
}

interface ReportRule {
  kind: "synergy" | "anti";
  key: string;
  a: string;
  b: string;
  reason: string;
  review: { verdict: ReviewVerdict; note: string } | null;
  counts: Record<Verdict, number>;
  heroes: RuleHero[];
}

interface ReportHero {
  id: string;
  name: string;
  matches: number;
  fitted: number;
  kept: number;
  tau: number;
  /** [itemA, itemB, lift, se, n], strongest first. */
  pairs: Array<[string, string, number, number, number]>;
}

interface ReportItemReach {
  id: string;
  pairs: number;
  heroes: number;
  positive: number;
  meanLift: number;
}

interface ReportData {
  generated: string;
  window: { from: string; to: string };
  scope: string;
  method: PairLiftTable["method"];
  reviewDate: string;
  items: Record<string, ReportItem>;
  rules: ReportRule[];
  heroes: ReportHero[];
  reach: ReportItemReach[];
  totals: { heroes: number; pairs: number; heroesWithPairs: number };
}

const z = (e: PairLiftEntry) => (e.se > 0 ? Math.abs(e.lift) / e.se : 0);
const byCode = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

function verdictFor(
  entry: PairLiftEntry | undefined,
  expectPositive: boolean,
  method: PairLiftTable["method"],
): Verdict {
  if (!entry) return "no-data";
  if (z(entry) >= method.minAbsZ) {
    return entry.lift > 0 === expectPositive ? "supported" : "contradicted";
  }
  return entry.se <= method.ruleMaxSe ? "no-effect" : "inconclusive";
}

function buildData(
  table: PairLiftTable,
  allItems: Item[],
  heroNames: Map<string, string>,
): ReportData {
  const items: Record<string, ReportItem> = {};
  for (const it of allItems) {
    items[it.id] = { id: it.id, name: it.name, cat: it.category, tier: it.tier, cost: it.cost };
  }
  const heroName = (id: string) => heroNames.get(id) ?? `Hero ${id}`;
  const heroIds = Object.keys(table.fits).sort(
    (x, y) => heroName(x).localeCompare(heroName(y), "en") || byCode(x, y),
  );

  const rules: ReportRule[] = [
    ...SYNERGY_RULES.map((r) => ({ kind: "synergy" as const, ids: r.itemIds, reason: r.reason })),
    ...ANTI_SYNERGY_RULES.map((r) => ({ kind: "anti" as const, ids: r.itemIds, reason: r.reason })),
  ].map(({ kind, ids, reason }) => {
    const key = pairLiftKey(ids[0], ids[1]);
    const [a, b] = key.split("|");
    const counts: Record<Verdict, number> = {
      supported: 0,
      contradicted: 0,
      "no-effect": 0,
      inconclusive: 0,
      "no-data": 0,
    };
    const heroes: RuleHero[] = [];
    for (const id of heroIds) {
      const entry = table.handPairs[id]?.[key];
      const verdict = verdictFor(entry, kind === "synergy", table.method);
      counts[verdict] += 1;
      if (!entry) continue;
      heroes.push({
        hero: heroName(id),
        heroId: id,
        lift: entry.lift,
        se: entry.se,
        n: entry.n,
        verdict,
        basketUsesMeasurement:
          kind === "synergy" &&
          (table.rulePairs[id]?.[key] !== undefined || table.heroes[id]?.[key] !== undefined),
      });
    }
    heroes.sort((x, y) => y.n - x.n || byCode(x.heroId, y.heroId));
    return { kind, key, a, b, reason, review: RULE_REVIEW[key] ?? null, counts, heroes };
  });

  const heroes: ReportHero[] = heroIds.map((id) => {
    const fit = table.fits[id];
    const pairs = Object.entries(table.heroes[id] ?? {})
      .map(([key, e]): [string, string, number, number, number] => {
        const [a, b] = key.split("|");
        return [a, b, e.lift, e.se, e.n];
      })
      .sort((x, y) => Math.abs(y[2]) - Math.abs(x[2]) || byCode(x[0], y[0]) || byCode(x[1], y[1]));
    return {
      id,
      name: heroName(id),
      matches: fit.matches,
      fitted: fit.pairsFitted,
      kept: fit.kept,
      tau: fit.tau,
      pairs,
    };
  });

  // Items that show up in many significant pairs across the roster: candidates
  // for context effects (what the enemy team is), not pair mechanics.
  const reachMap = new Map<
    string,
    { pairs: number; heroes: Set<string>; pos: number; sum: number }
  >();
  for (const h of heroes) {
    for (const [a, b, lift] of h.pairs) {
      for (const id of [a, b]) {
        const r = reachMap.get(id) ?? { pairs: 0, heroes: new Set<string>(), pos: 0, sum: 0 };
        r.pairs += 1;
        r.heroes.add(h.id);
        if (lift > 0) r.pos += 1;
        r.sum += lift;
        reachMap.set(id, r);
      }
    }
  }
  const reach = [...reachMap.entries()]
    .map(([id, r]) => ({
      id,
      pairs: r.pairs,
      heroes: r.heroes.size,
      positive: r.pos,
      meanLift: Math.round((r.sum / r.pairs) * 1000) / 1000,
    }))
    .sort((x, y) => y.pairs - x.pairs || byCode(x.id, y.id))
    .slice(0, 15);

  const rank = table.method.minRankName ? `${table.method.minRankName}+ matches` : "All ranks";
  return {
    generated: table.generated,
    window: table.window,
    scope: `${rank}, ${table.window.from} to ${table.window.to}, ${table.method.days} days`,
    method: table.method,
    reviewDate: RULE_REVIEW_DATE,
    items,
    rules,
    heroes,
    reach,
    totals: {
      heroes: heroIds.length,
      pairs: heroes.reduce((s, h) => s + h.pairs.length, 0),
      heroesWithPairs: heroes.filter((h) => h.pairs.length > 0).length,
    },
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON safe to inline inside <script type="application/json">. */
const inlineJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const CSS = `
/* Layout: one reading column; rule cards in a 2-up grid, explorer as a sortable table. */
:root {
  --bg: #f7f5fa; --surface: #ffffff; --raised: #fbfafc; --line: #e4e0ea; --line2: #efecf3;
  --ink: #191622; --mut: #6a6379; --dim: #a49db1;
  --gun: #c2410c; --spirit: #6d28d9; --vit: #15803d;
  --good: #15803d; --bad: #be123c; --flat: #0369a1; --unsure: #b45309; --none: #a49db1;
  --display: "Oswald", "Arial Narrow", sans-serif;
  --body: "IBM Plex Sans", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #100e17; --surface: #181524; --raised: #1e1a2b; --line: #2b2639; --line2: #221e30;
    --ink: #eae6f2; --mut: #9d95b0; --dim: #6b6480;
    --gun: #fb923c; --spirit: #a78bfa; --vit: #4ade80;
    --good: #4ade80; --bad: #fb7185; --flat: #7dd3fc; --unsure: #fbbf24; --none: #6b6480;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #100e17; --surface: #181524; --raised: #1e1a2b; --line: #2b2639; --line2: #221e30;
  --ink: #eae6f2; --mut: #9d95b0; --dim: #6b6480;
  --gun: #fb923c; --spirit: #a78bfa; --vit: #4ade80;
  --good: #4ade80; --bad: #fb7185; --flat: #7dd3fc; --unsure: #fbbf24; --none: #6b6480;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font: 15px/1.55 var(--body); margin: 0; }
.wrap { max-width: 1120px; margin: 0 auto; padding-inline: 16px; padding-block: 28px 64px; display: grid; gap: 40px; }
h1, h2 { font-family: var(--display); font-weight: 600; letter-spacing: 0.01em; text-wrap: balance; margin: 0; }
h1 { font-size: clamp(28px, 5vw, 40px); line-height: 1.1; }
h2 { font-size: 22px; }
h3 { font-size: 16px; margin: 0; font-weight: 600; }
p { margin: 0; max-width: 68ch; }
.mut { color: var(--mut); }
.small { font-size: 13px; }
.eyebrow { font: 600 11px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--mut); }
header { display: grid; gap: 12px; }
.stats { display: flex; flex-wrap: wrap; gap: 10px 28px; margin-top: 6px; }
.stat b { display: block; font: 600 22px/1.2 var(--display); font-variant-numeric: tabular-nums; }
.stat span { font-size: 12px; color: var(--mut); }
section { display: grid; gap: 16px; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px; color: var(--mut); }
.pill { display: inline-flex; align-items: center; gap: 6px; font: 600 11px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 8px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.v-supported, .r-sound { color: var(--good); }
.v-contradicted, .r-wrong { color: var(--bad); }
.v-no-effect { color: var(--flat); }
.v-inconclusive, .r-partly-wrong { color: var(--unsure); }
.v-no-data, .r-opinion { color: var(--none); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr)); gap: 16px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 18px; display: grid; gap: 12px; align-content: start; min-width: 0; }
.card-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.kind { font: 600 11px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; }
.kind.synergy { color: var(--good); }
.kind.anti { color: var(--bad); }
.items { font-family: var(--display); font-size: 19px; font-weight: 400; line-height: 1.25; }
.plus { color: var(--dim); padding-inline: 4px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 2px; }
.d-gun { background: var(--gun); } .d-spirit { background: var(--spirit); } .d-vitality { background: var(--vit); }
.reason { font-size: 13.5px; color: var(--mut); }
.review { display: grid; gap: 6px; font-size: 13px; padding: 10px 12px; background: var(--raised); border-radius: 6px; }
.bar { display: flex; height: 10px; border-radius: 3px; overflow: hidden; background: var(--line2); }
.bar i { display: block; height: 100%; }
.bar .supported { background: var(--good); } .bar .contradicted { background: var(--bad); }
.bar .no-effect { background: var(--flat); } .bar .inconclusive { background: var(--unsure); }
.bar .no-data { background: var(--line); }
.counts { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--mut); font-variant-numeric: tabular-nums; }
.counts b { color: var(--ink); }
details summary { cursor: pointer; font-size: 13px; color: var(--mut); }
details summary:focus-visible, select:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid var(--spirit); outline-offset: 2px; }
.tablewrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th { text-align: left; font: 600 11px/1.2 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--mut); padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 7px 10px; border-bottom: 1px solid var(--line2); vertical-align: top; }
td.n, th.n { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pos { color: var(--good); } .neg { color: var(--bad); }
.controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.controls label { display: grid; gap: 4px; font-size: 12px; color: var(--mut); }
select, input[type="search"] { font: 14px var(--body); color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; min-width: 0; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.seg button { font: 13px var(--body); color: var(--mut); background: var(--surface); border: 0; padding: 7px 12px; cursor: pointer; }
.seg button[aria-pressed="true"] { color: var(--ink); background: var(--raised); font-weight: 600; }
.herofacts { display: flex; flex-wrap: wrap; gap: 6px 20px; font-size: 13px; color: var(--mut); font-variant-numeric: tabular-nums; }
.herofacts b { color: var(--ink); }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: grid; gap: 14px; min-width: 0; }
.more { justify-self: start; font: 13px var(--body); color: var(--ink); background: var(--raised); border: 1px solid var(--line); border-radius: 6px; padding: 7px 12px; cursor: pointer; }
.method { display: grid; gap: 10px; font-size: 14px; color: var(--mut); }
.method b { color: var(--ink); }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
`;

function page(data: ReportData, clientJs: string): string {
  return `<title>Deadlock Synergy Audit</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" />
<style>${CSS}</style>
<div class="wrap">
  <header>
    <div class="eyebrow">Deadlock Foundry · Milestone F</div>
    <h1>Deadlock Synergy Audit</h1>
    <p class="mut">Hand-authored item pairings checked against what players actually won with.
    Measured on ${esc(data.scope)}. Table fitted ${esc(data.generated)}.</p>
    <div class="stats" id="stats"></div>
  </header>

  <section aria-labelledby="read-h">
    <h2 id="read-h">How to read lift</h2>
    <p class="small mut">Lift is how much better a hero's players did when they owned both items
    than the two items predict on their own, in log odds. It is measured within final-net-worth
    bands, pulled toward zero when the data is thin, and has each item's own effect removed.
    Roughly, 0.1 is about 2.5 win-rate points. It is correlation, not proof the items combine.</p>
    <div class="legend" id="legend"></div>
  </section>

  <section aria-labelledby="rules-h">
    <h2 id="rules-h">Hand-authored rules vs. measurement</h2>
    <p class="small mut">Each card shows the rule's own reason, a mechanics review of that reason
    (deadlock.wiki and live item data, ${esc(data.reviewDate)}), and the verdict on every fitted
    hero. Synergy rules expect a positive lift; anti-synergy rules expect a negative one.</p>
    <div class="cards" id="rules"></div>
  </section>

  <section aria-labelledby="hero-h">
    <h2 id="hero-h">Hero explorer</h2>
    <div class="panel">
      <div class="controls">
        <label for="hero">Hero <select id="hero"></select></label>
        <label for="q">Item <input type="search" id="q" placeholder="Filter by item name" /></label>
        <div class="seg" role="group" aria-label="Show">
          <button type="button" id="f-all" aria-pressed="true">All</button>
          <button type="button" id="f-pos" aria-pressed="false">Better together</button>
          <button type="button" id="f-neg" aria-pressed="false">Worse together</button>
        </div>
      </div>
      <div class="herofacts" id="herofacts"></div>
      <div class="tablewrap"><table id="pairs"></table></div>
      <button type="button" class="more" id="more" hidden>Show all</button>
    </div>
  </section>

  <section aria-labelledby="reach-h">
    <h2 id="reach-h">Items in the most significant pairs</h2>
    <p class="small mut">An item that turns up in many strong pairs across many heroes often
    reflects the situation it is bought in (for example a spirit-heavy enemy team) rather than
    a real pairing. Treat these with extra caution.</p>
    <div class="tablewrap"><table id="reach"></table></div>
  </section>

  <section aria-labelledby="method-h">
    <h2 id="method-h">Method and limits</h2>
    <div class="method" id="method"></div>
  </section>
</div>
<script type="application/json" id="data">${inlineJson(data)}</script>
<script>
${clientJs}
</script>
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) out = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: npm run synergy-report [-- --out reports/synergy-audit.html]");
      return;
    } else {
      console.error(`synergyReport: unknown argument ${argv[i]}`);
      process.exit(1);
    }
  }

  const table = pairLiftTableJson as unknown as PairLiftTable;
  const [heroes, allItems] = await Promise.all([fetchVisibleHeroesEnriched(), getItems()]);
  const heroNames = new Map(heroes.map((h) => [String(h.id), h.name]));

  // Every rule must resolve to a live item, or the page would show raw ids.
  const known = new Set(allItems.map((i) => i.id));
  for (const r of [...SYNERGY_RULES, ...ANTI_SYNERGY_RULES]) {
    for (const id of r.itemIds)
      if (!known.has(id)) throw new Error(`rule item ${id} not in the item list`);
  }

  const data = buildData(table, allItems, heroNames);
  const html = page(data, readFileSync(CLIENT_SCRIPT, "utf8"));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, html, "utf8");
  console.log(
    `Wrote ${out} (${(html.length / 1024).toFixed(0)} KB): ${data.rules.length} rules, ` +
      `${data.totals.pairs} pairs across ${data.totals.heroes} heroes (${data.scope})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
