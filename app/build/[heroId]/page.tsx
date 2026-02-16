import BuildClient from "../BuildClient";
import {
  fetchHeroes,
  fetchHeroById,
  fetchUpgradeItems,
  normalizeUpgradeItems,
  fetchAbilityItems,
  getHeroSignatureSlotsFromHeroItems,
} from "@/lib/deadlock";

export default async function BuildHeroPage({
  params,
}: {
  params: Promise<{ heroId: string }>;
}) {
  const { heroId } = await params;

  const heroes = await fetchHeroes();
  heroes.sort((a, b) => a.name.localeCompare(b.name));

  const upgrades = normalizeUpgradeItems(await fetchUpgradeItems());

  // Abilities (4 slots) come from ability API + heroData.items.signature1-4
  const heroData = await fetchHeroById(heroId);
  const allAbilities = await fetchAbilityItems();
  const heroAbilities = getHeroSignatureSlotsFromHeroItems(
    heroData.items,
    allAbilities,
    heroData.id
  );

  return (
    <BuildClient
      heroes={heroes}
      selectedHeroId={heroId}
      upgrades={upgrades}
      heroAbilities={heroAbilities}
    />
  );
}
