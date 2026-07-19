import { redirect } from "next/navigation";
import BuildClient from "../BuildClient";
import { fetchVisibleHeroes, fetchHeroById, fetchUpgradeItems, normalizeUpgradeItems } from "@/lib/deadlock";
import { deserializeBuild } from "@/lib/buildSerializer";
import type { BuildState } from "@/lib/buildSerializer";
import { getItems } from "@/lib/itemStore";
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
  const [heroes, upgrades, allItems, heroData, rawAbilities, heroBaseStats] = await Promise.all([
    fetchVisibleHeroes(),
    fetchUpgradeItems().then(normalizeUpgradeItems),
    getItems(),
    fetchHeroById(heroId),
    fetchHeroAbilityItems(heroIdNum),
    getHeroStats(heroIdNum),
  ]);

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
    />
  );
}
