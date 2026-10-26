// src/scripts/heroRoleCheck.ts — checks lib/heroRoles.ts against match data
// (Milestone M6.0b, docs/milestone-m6.md §4 / C3).
//
// The role lists come from high-level players' videos. This measures, per hero
// at Oracle+ over the last N days, ALL in matches of 35–45 min (one population
// for every signal; both endpoints default to ranked + unranked, normal mode):
//   - mid-game net worth, relative to the table's mean (who gets the souls):
//     /v1/analytics/player-performance-curve per hero, at the game_time=50
//     point: snapshots from 50–60% of the match, ~21–22 min (data-verifier).
//     With resolution > 0, game_time is a % of the match, not seconds.
//     End-of-game totals barely separate roles (0.86–1.11); mid-game net worth
//     does. Cross-checked once with the exact team share at 20:00 from the
//     deadlock MCP database (docs/milestone-m6.md §4);
//   - damage taken and damage dealt per match (/v1/analytics/hero-stats);
//   - jungle share: neutral / (neutral + creep damage), printed for context
//     only (it is not a flag rule).
// roleFlag (lib/heroRoles.ts) decides what contradicts a hero's PRIMARY role.
// Flags are for the user to decide; nothing here edits the table.
//
// Run: npm run role-check [-- --days 30 --min-badge 80]

import { getJson } from "./pairData";
import { HERO_ROLES, ROLE_LABELS, roleFlag } from "@/lib/heroRoles";
import type { HeroRole } from "@/lib/heroRoles";

interface HeroStatsRow {
  hero_id: number;
  matches: number;
  total_neutral_damage: number;
  total_creep_damage: number;
  total_player_damage_taken: number;
  total_player_damage: number;
}

interface CurvePoint {
  game_time: number;
  net_worth_avg: number;
}

interface Measured {
  heroId: number;
  name: string;
  roles: ReadonlyArray<HeroRole>;
  matches: number;
  netWorth?: number; // mid-game net worth / mean; undefined = no curve point
  jungle: number; // share 0-1
  taken: number; // per match / mean
  dealt: number; // per match / mean
  nwRank?: number;
  takenRank: number;
  dealtRank: number;
}

// One population for every signal: matches of 35–45 minutes.
const MIN_DURATION_S = 2100;
const MAX_DURATION_S = 2700;

function parseArgs(argv: string[]): { days: number; minBadge: number } {
  const get = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    const v = i >= 0 ? Number(argv[i + 1]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return { days: get("--days", 30), minBadge: get("--min-badge", 80) };
}

/** Assigns 1-based ranks, highest value first, to the entries that have one. */
function rank<T>(items: T[], value: (t: T) => number | undefined, set: (t: T, r: number) => void) {
  items
    .filter((t) => value(t) !== undefined)
    .sort((a, b) => (value(b) ?? 0) - (value(a) ?? 0))
    .forEach((t, i) => set(t, i + 1));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const to = Math.floor(Date.now() / 1000 / 86400) * 86400; // pinned to a UTC day
  const from = to - args.days * 86400;
  const window = {
    min_unix_timestamp: from,
    max_unix_timestamp: to,
    min_average_badge: args.minBadge,
    min_duration_s: MIN_DURATION_S,
    max_duration_s: MAX_DURATION_S,
  };
  const rows = await getJson<HeroStatsRow[]>("hero-stats", window);
  // Only the table's heroes are ranked: a test or hidden hero id must not shift
  // the thresholds. Others are listed separately.
  const usable = rows.filter((r) => r.matches > 0 && HERO_ROLES[r.hero_id]);
  const outside = rows.filter((r) => r.matches > 0 && !HERO_ROLES[r.hero_id]);
  if (usable.length === 0) throw new Error("hero-stats returned no matches for the table's heroes");

  const per = (r: HeroStatsRow, total: number) => total / r.matches;
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const meanTaken = mean(usable.map((r) => per(r, r.total_player_damage_taken)));
  const meanDealt = mean(usable.map((r) => per(r, r.total_player_damage)));

  // Mid-game net worth per hero (one throttled call each). A hero with no
  // point at 50 is "no data", never the mean.
  const midNw = new Map<number, number>();
  for (const r of usable) {
    const curve = await getJson<CurvePoint[]>("player-performance-curve", {
      ...window,
      hero_ids: r.hero_id,
      resolution: 10,
    });
    const at = curve.find((p) => Math.round(p.game_time) === 50)?.net_worth_avg;
    if (typeof at === "number" && at > 0) midNw.set(r.hero_id, at);
  }
  if (midNw.size < usable.length * 0.8) {
    throw new Error(`mid-game net worth for only ${midNw.size} of ${usable.length} heroes`);
  }
  const meanNw = mean([...midNw.values()]);

  const measured: Measured[] = usable.map((r) => {
    const farm = r.total_neutral_damage + r.total_creep_damage;
    const nw = midNw.get(r.hero_id);
    return {
      heroId: r.hero_id,
      name: HERO_ROLES[r.hero_id].name,
      roles: HERO_ROLES[r.hero_id].roles,
      matches: r.matches,
      ...(nw !== undefined ? { netWorth: nw / meanNw } : {}),
      jungle: farm > 0 ? r.total_neutral_damage / farm : 0,
      taken: per(r, r.total_player_damage_taken) / meanTaken,
      dealt: per(r, r.total_player_damage) / meanDealt,
      takenRank: 0,
      dealtRank: 0,
    };
  });
  rank(
    measured,
    (m) => m.netWorth,
    (m, i) => (m.nwRank = i),
  );
  rank(
    measured,
    (m) => m.taken,
    (m, i) => (m.takenRank = i),
  );
  rank(
    measured,
    (m) => m.dealt,
    (m, i) => (m.dealtRank = i),
  );

  console.log(
    `Oracle+ (badge ${args.minBadge}), matches of 35–45 min, ` +
      `${new Date(from * 1000).toISOString().slice(0, 10)} → ` +
      `${new Date(to * 1000).toISOString().slice(0, 10)}, ${usable.length} heroes\n`,
  );
  console.log(
    "hero            roles                 matches  midNW(#)      jungle  taken(#)    dealt(#)    flag",
  );
  const n = measured.length;
  let flagged = 0;
  const byNw = [...measured].sort((a, b) => (a.nwRank ?? n + 1) - (b.nwRank ?? n + 1));
  for (const m of byNw) {
    const flag = roleFlag(
      m.roles,
      {
        ...(m.nwRank !== undefined ? { netWorth: m.nwRank } : {}),
        damageTaken: m.takenRank,
        damageDealt: m.dealtRank,
      },
      n,
    );
    if (flag) flagged += 1;
    const roles = m.roles.map((r) => ROLE_LABELS[r]).join(" + ") || "unknown";
    const nw =
      m.netWorth !== undefined
        ? `${m.netWorth.toFixed(2)} (#${String(m.nwRank).padStart(2)})`
        : "   n/a      ";
    console.log(
      `${m.name.padEnd(15)} ${roles.padEnd(21)} ${String(m.matches).padStart(7)}  ${nw}  ` +
        `${(m.jungle * 100).toFixed(0).padStart(5)}%  ` +
        `${m.taken.toFixed(2)} (#${String(m.takenRank).padStart(2)})  ` +
        `${m.dealt.toFixed(2)} (#${String(m.dealtRank).padStart(2)})  ${flag ?? ""}`,
    );
  }
  for (const [id, e] of Object.entries(HERO_ROLES)) {
    if (!measured.some((m) => m.heroId === Number(id))) {
      console.log(`${e.name.padEnd(15)} no matches in the window`);
    }
  }
  for (const r of outside) console.log(`hero id ${r.hero_id}: has matches but no role entry`);
  console.log(`\n${flagged} of ${n} heroes flagged for review`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
