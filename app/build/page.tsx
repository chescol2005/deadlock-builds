import BuildClient from "./BuildClient";
import {
  fetchVisibleHeroes,
  fetchUpgradeItems,
  normalizeUpgradeItems,
} from "@/lib/deadlock";

export default async function BuildPage() {
  const heroes = await fetchVisibleHeroes();
  const upgrades = normalizeUpgradeItems(await fetchUpgradeItems());

  return (
    <BuildClient
      heroes={heroes}
      selectedHeroId={null}
      upgrades={upgrades}
    />
  );
}
