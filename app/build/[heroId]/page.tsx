import { redirect } from "next/navigation";
import BuildClient from "../BuildClient";
import {
  fetchVisibleHeroes,
  fetchHeroById,
  fetchUpgradeItems,
  normalizeUpgradeItems,
  fetchAbilityItems,
  getHeroSignatureSlotsFromHeroItems,
} from "@/lib/deadlock";
import { deserializeBuild } from "@/lib/buildSerializer";
import type { BuildState } from "@/lib/buildSerializer";

export default async function BuildHeroPage({
  params,
  searchParams,
}: {
  params: Promise<{ heroId: string }>;
  searchParams: Promise<{ build?: string }>;
}) {
  const { heroId } = await params;
  const { build } = await searchParams;

  // Keep hero set consistent with /build (visible/selectable only)
  const heroes = await fetchVisibleHeroes();

  // If someone navigates to a non-visible heroId, bounce them back
  const isVisible = heroes.some((h) => String(h.id) === String(heroId));
  if (!isVisible) {
    redirect("/build");
  }

  const upgrades = normalizeUpgradeItems(await fetchUpgradeItems());

  // Abilities (4 slots) come from ability API + heroData.items.signature1-4
  const heroData = await fetchHeroById(heroId);
  const allAbilities = await fetchAbilityItems();
  const heroAbilities = getHeroSignatureSlotsFromHeroItems(
    heroData.items,
    allAbilities,
    heroData.id,
  );

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
      initialState={initialState}
    />
  );
}
