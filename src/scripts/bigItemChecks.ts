// src/scripts/bigItemChecks.ts — Milestone H's measures of "does the build save up for
// big items like real players do" (docs/milestone-h.md §2, §4.1). Pure: starter builds
// and the hero's real buy rates in, counts out. Used by Fixture 13.

import type { StarterBuild } from "@/lib/engine/starterBuild";
import type { HeroPhaseItems } from "@/lib/engine/phaseItems";
import type { Item } from "@/lib/items";

/** An early rush item costs at least this (one 3,200-soul tier-3 item). */
export const RUSH_COST = 3200;
/** A mid / late big item costs at least this (tier 4). */
export const BIG_COST = 6400;
/** A real rush or mid big item: bought in that window by at least this share of players. */
export const BIG_BUY_RATE = 0.2;
/** T1 tolerance: engine vs real early share of souls in 3,200+ items. */
export const T1_TOLERANCE = 0.15;

export interface BigItemHero {
  name: string;
  build: StarterBuild;
  rates: HeroPhaseItems;
}

export interface CountCheck {
  hit: number;
  total: number;
  /** "Hero: item" for each miss, for the fixture detail. */
  misses: string[];
}

export interface BigItemMeasures {
  /** P1: real early rushes held at the early phase. */
  earlyRush: CountCheck;
  /** P2: heroes whose early share of souls in 3,200+ items is within T1_TOLERANCE of real. */
  earlyShare: CountCheck;
  /** P4: 6,400+ items in the real late top 3, held by the late phase. */
  lateTopBig: CountCheck;
  /** P5: 6,400+ items bought in mid by >= BIG_BUY_RATE, held by the mid phase. */
  midBig: CountCheck;
}

/** What the player holds after phase `upto`: picks minus components an upgrade consumed. */
export function heldAfter(build: StarterBuild, upto: number): Item[] {
  let held: Item[] = [];
  for (const p of build.phases.slice(0, upto + 1)) {
    const gone = new Set(p.consumed.map((i) => i.id));
    held = [...held.filter((i) => !gone.has(i.id)), ...p.items];
  }
  return held;
}

/** Early share of souls in 3,200+ items: real (Σ rate × cost) and the engine's picks. */
export function earlyBigShares(
  h: BigItemHero,
  costOf: (id: string) => number | undefined,
): { engine: number; real: number } {
  let realAll = 0;
  let realBig = 0;
  for (const [id, rate] of Object.entries(h.rates.early)) {
    const cost = costOf(id) ?? 0;
    realAll += rate * cost;
    if (cost >= RUSH_COST) realBig += rate * cost;
  }
  const picks = h.build.phases[0].basket.picks;
  const paid = picks.reduce((s, p) => s + p.effectiveCost, 0);
  const big = picks
    .filter((p) => p.item.cost >= RUSH_COST)
    .reduce((s, p) => s + p.effectiveCost, 0);
  return { engine: paid > 0 ? big / paid : 0, real: realAll > 0 ? realBig / realAll : 0 };
}

const byRate = (a: [string, number], b: [string, number]) =>
  b[1] - a[1] || a[0].localeCompare(b[0]);

export function measureBigItems(
  heroes: ReadonlyArray<BigItemHero>,
  items: ReadonlyArray<Item>,
): BigItemMeasures {
  const byId = new Map(items.map((i) => [i.id, i]));
  const costOf = (id: string) => byId.get(id)?.cost;
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const empty = (): CountCheck => ({ hit: 0, total: 0, misses: [] });
  const out: BigItemMeasures = {
    earlyRush: empty(),
    earlyShare: empty(),
    lateTopBig: empty(),
    midBig: empty(),
  };
  const count = (c: CountCheck, hero: string, ids: string[], held: ReadonlySet<string>) => {
    for (const id of ids) {
      c.total++;
      if (held.has(id)) c.hit++;
      else c.misses.push(`${hero}: ${nameOf(id)}`);
    }
  };
  for (const h of [...heroes].sort((a, b) => a.name.localeCompare(b.name))) {
    const atLeast = (rates: Readonly<Record<string, number>>, cost: number) =>
      Object.entries(rates)
        .filter(([id, r]) => (costOf(id) ?? 0) >= cost && r >= BIG_BUY_RATE)
        .sort(byRate)
        .map(([id]) => id);
    const lateTop3 = Object.entries(h.rates.late)
      .sort(byRate)
      .slice(0, 3)
      .filter(([id]) => (costOf(id) ?? 0) >= BIG_COST)
      .map(([id]) => id);
    const ids = (upto: number) => new Set(heldAfter(h.build, upto).map((i) => i.id));
    count(out.earlyRush, h.name, atLeast(h.rates.early, RUSH_COST), ids(0));
    count(out.midBig, h.name, atLeast(h.rates.mid, BIG_COST), ids(1));
    count(out.lateTopBig, h.name, lateTop3, ids(2));
    const share = earlyBigShares(h, costOf);
    out.earlyShare.total++;
    if (Math.abs(share.engine - share.real) <= T1_TOLERANCE) out.earlyShare.hit++;
    else
      out.earlyShare.misses.push(
        `${h.name}: engine ${Math.round(share.engine * 100)}%, real ${Math.round(share.real * 100)}%`,
      );
  }
  return out;
}
