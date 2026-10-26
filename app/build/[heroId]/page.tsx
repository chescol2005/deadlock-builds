import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import BuildClient from "../BuildClient";
import { fetchHeroById, fetchUpgradeItems, normalizeUpgradeItems } from "@/lib/deadlock";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import type { BuildState } from "@/lib/buildSerializer";
import { getItems } from "@/lib/itemStore";
import { getHeroAccuracy, getItemAnalytics, getRankTiers } from "@/lib/analyticsStore";
import { getHeroStats } from "@/lib/heroStore";
import { fetchHeroAbilityItems } from "@/lib/api/deadlockApi";
import { mapHeroAbilities } from "@/lib/abilityCoefficients";
import { heroPairLift } from "@/lib/engine/pairLift";
import type { PairLiftTable } from "@/lib/engine/pairLift";
import pairLiftTableJson from "@/lib/engine/data/pairLiftTable.json";
import { heroCategorySplit } from "@/lib/engine/categorySplit";
import type { CategorySplitTable } from "@/lib/engine/categorySplit";
import categorySplitTableJson from "@/lib/engine/data/heroCategorySplit.json";
import { enemyHealthRates, heroPhaseItems } from "@/lib/engine/phaseItems";
import type { PhaseItemsTable } from "@/lib/engine/phaseItems";
import phaseItemsTableJson from "@/lib/engine/data/heroPhaseItems.json";
import { buildPageMetadata, buildPreview, decodeBuildParam } from "@/lib/seo";

// The share preview: the hero plus the shared build's items (lib/seo.ts). Same
// cached fetches as the page, so this adds no extra API round-trips.
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ heroId: string }>;
  searchParams: Promise<{ build?: string }>;
}): Promise<Metadata> {
  const { heroId } = await params;
  const { build } = await searchParams;
  try {
    const [hero, allItems] = await Promise.all([fetchHeroById(heroId), getItems()]);
    return buildPageMetadata(hero, buildPreview(hero, decodeBuildParam(build), allItems), build);
  } catch (err) {
    unstable_rethrow(err);
    return { title: "Build planner" };
  }
}

export default async function BuildHeroPage({
  params,
  searchParams,
}: {
  params: Promise<{ heroId: string }>;
  searchParams: Promise<{ build?: string }>;
}) {
  const { heroId } = await params;
  const { build } = await searchParams;
  const heroIdNum = Number(heroId);

  // Keep hero set consistent with /build (visible/selectable only). Fetched
  // alongside everything else — the common case is a valid heroId, so we
  // avoid an extra round-trip there and only pay for wasted work on the rare
  // invalid-heroId redirect path.
  // `fetchVisibleHeroesEnriched` is the lighter list PLUS each hero's base
  // stats — needed here (not just for the hero cards) because the Milestone E
  // need vector normalizes this hero's health/move speed against the rest of
  // the roster. Its per-hero `getHeroStats` calls are module-cached and
  // revalidate hourly, the same path /heroes already pays.
  const [
    heroes,
    upgrades,
    allItems,
    heroData,
    rawAbilities,
    heroBaseStats,
    itemAnalytics,
    heroAccuracy,
    rankTiers,
  ] = await Promise.all([
    fetchVisibleHeroesEnriched(),
    fetchUpgradeItems().then(normalizeUpgradeItems),
    getItems(),
    fetchHeroById(heroId),
    fetchHeroAbilityItems(heroIdNum),
    getHeroStats(heroIdNum),
    getItemAnalytics(),
    getHeroAccuracy(),
    getRankTiers(),
  ]);

  // Real per-item win rates feed the basket's (deliberately small) empirical
  // term. `getItemAnalytics` fails open with an empty map, which the engine
  // treats as "no empirical signal" rather than an error.
  const heroRoster = heroes.flatMap((h) => (h.baseStats ? [h.baseStats] : []));

  // If someone navigates to a non-visible heroId, bounce them back
  const isVisible = heroes.some((h) => String(h.id) === String(heroId));
  if (!isVisible) {
    redirect("/build");
  }

  const heroAbilities = mapHeroAbilities(rawAbilities, heroData.items);

  // Measured item-pair lift (Milestone F): a committed, offline-fitted table
  // (npm run fit-pairs). Sliced here, on the server, so the client only receives
  // this hero's few dozen KB, never the whole file. null when the hero was not
  // fitted (the basket's pairTerm is then inert).
  const pairLift = heroPairLift(pairLiftTableJson as unknown as PairLiftTable, heroIdNum);

  // Measured gun / spirit / vitality split (npm run fit-category-split), sliced
  // the same way. null when the hero's data is too thin (kit-only need vector).
  const categorySplit = heroCategorySplit(
    categorySplitTableJson as unknown as CategorySplitTable,
    heroIdNum,
  );
  // What high-rank players on this hero buy per phase (same fitter), sliced the
  // same way. null when the hero was not fitted (phaseItemTerm inert).
  const phaseItems = heroPhaseItems(phaseItemsTableJson as unknown as PhaseItemsTable, heroIdNum);
  // Roster-wide (an enemy is any hero), so read from the table, not the slice.
  const enemyRates = enemyHealthRates(phaseItemsTableJson as unknown as PhaseItemsTable) ?? null;

  // Malformed or missing param: empty state. Same decoder as generateMetadata,
  // so the share preview and the opened build always agree.
  const initialState: BuildState | null = decodeBuildParam(build);

  return (
    <BuildClient
      heroes={heroes}
      selectedHeroId={heroId}
      upgrades={upgrades}
      heroAbilities={heroAbilities}
      heroBaseStats={heroBaseStats}
      initialState={initialState}
      allItems={allItems}
      heroRoster={heroRoster}
      itemAnalytics={itemAnalytics}
      heroAccuracy={heroAccuracy}
      rankTiers={rankTiers}
      pairLift={pairLift}
      categorySplit={categorySplit}
      phaseItems={phaseItems}
      enemyHealthRates={enemyRates}
    />
  );
}
