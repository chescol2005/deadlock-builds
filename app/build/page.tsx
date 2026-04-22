import BuildClient from "./BuildClient";
import {
  fetchVisibleHeroes,
  fetchUpgradeItems,
  normalizeUpgradeItems,
} from "@/lib/deadlock";
import { getItems } from "@/lib/itemStore";

export default async function BuildPage() {
  const [heroes, upgrades, allItems] = await Promise.all([
    fetchVisibleHeroes(),
    fetchUpgradeItems().then(normalizeUpgradeItems),
    getItems(),
  ]);

  return (
    <BuildClient
      heroes={heroes}
      selectedHeroId={null}
      upgrades={upgrades}
      allItems={allItems}
    />
  );
}
