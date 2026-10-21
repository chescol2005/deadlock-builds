// src/scripts/basketData.ts — live data for the hero basket, loaded the same way
// app/build/[heroId]/page.tsx loads it. Shared by basketProbe.ts and the live
// starter-build fixtures in mini.ts so both see exactly what the planner sees.
//
// Live network: results move with patches and match data. Node-only (scripts).

import { fetchHeroById } from "@/lib/deadlock";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import type { DeadlockHeroListItemEnriched } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import type { Item } from "@/lib/items";
import { getHeroAccuracy, getItemAnalytics, getRankTiers } from "@/lib/analyticsStore";
import type { HeroAccuracy, ItemAnalytics } from "@/lib/analyticsStore";
import type { RankTierRaw } from "@/lib/api/analyticsApi";
import { getHeroStats } from "@/lib/heroStore";
import type { HeroBaseStats } from "@/lib/heroStats";
import { fetchHeroAbilityItems } from "@/lib/api/deadlockApi";
import { mapHeroAbilities } from "@/lib/abilityCoefficients";
import type { HeroAbility } from "@/lib/abilityCoefficients";
import type { PairLiftTable } from "@/lib/engine/pairLift";
import pairLiftTableJson from "@/lib/engine/data/pairLiftTable.json";
import type { CategorySplitTable } from "@/lib/engine/categorySplit";
import categorySplitTableJson from "@/lib/engine/data/heroCategorySplit.json";

export interface LiveBasketData {
  heroes: DeadlockHeroListItemEnriched[];
  allItems: Item[];
  itemAnalytics: Map<number, ItemAnalytics>;
  heroAccuracy: Map<number, HeroAccuracy>;
  rankTiers: RankTierRaw[];
  /** Base stats of every visible hero that has them (need-vector z-scores). */
  heroRoster: HeroBaseStats[];
  pairLiftTable: PairLiftTable;
  categorySplitTable: CategorySplitTable;
}

export interface LiveHeroKit {
  hero: DeadlockHeroListItemEnriched;
  heroAbilities: HeroAbility[];
  heroBaseStats: HeroBaseStats;
}

export async function loadLiveBasketData(): Promise<LiveBasketData> {
  const [heroes, allItems, itemAnalytics, heroAccuracy, rankTiers] = await Promise.all([
    fetchVisibleHeroesEnriched(),
    getItems(),
    getItemAnalytics(),
    getHeroAccuracy(),
    getRankTiers(),
  ]);
  return {
    heroes,
    allItems,
    itemAnalytics,
    heroAccuracy,
    rankTiers,
    heroRoster: heroes.flatMap((h) => (h.baseStats ? [h.baseStats] : [])),
    pairLiftTable: pairLiftTableJson as unknown as PairLiftTable,
    categorySplitTable: categorySplitTableJson as unknown as CategorySplitTable,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Match a hero by numeric id or by name, ignoring case and punctuation. */
export function findHero(
  heroes: ReadonlyArray<DeadlockHeroListItemEnriched>,
  query: string,
): DeadlockHeroListItemEnriched | undefined {
  const q = norm(query);
  return heroes.find((h) => String(h.id) === query) ?? heroes.find((h) => norm(h.name) === q);
}

/** Hero kit as the build page loads it. Null when the base-stats fetch failed. */
export async function loadHeroKit(hero: DeadlockHeroListItemEnriched): Promise<LiveHeroKit | null> {
  const [heroData, rawAbilities, heroBaseStats] = await Promise.all([
    fetchHeroById(hero.id),
    fetchHeroAbilityItems(hero.id),
    getHeroStats(hero.id),
  ]);
  if (!heroBaseStats) return null;
  return { hero, heroAbilities: mapHeroAbilities(rawAbilities, heroData.items), heroBaseStats };
}
