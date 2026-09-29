import { redirect } from "next/navigation";
import BuildClient from "../BuildClient";
import { fetchHeroById, fetchUpgradeItems, normalizeUpgradeItems } from "@/lib/deadlock";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import { deserializeBuild } from "@/lib/buildSerializer";
import type { BuildState } from "@/lib/buildSerializer";
import { getItems } from "@/lib/itemStore";
import { getHeroAccuracy, getItemAnalytics, getRankTiers } from "@/lib/analyticsStore";
import { getHeroStats } from "@/lib/heroStore";
import { fetchHeroAbilityItems } from "@/lib/api/deadlockApi";
import { mapHeroAbilities } from "@/lib/abilityCoefficients";

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

  let initialState: BuildState | null = null;
  if (build) {
    try {
      initialState = deserializeBuild(build);
    } catch {
      // Malformed param — fall through to empty state
    }
  }

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
    />
  );
}
