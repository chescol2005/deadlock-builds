import BuildClient from "./BuildClient";
import {
  fetchVisibleHeroes,
  fetchUpgradeItems,
  normalizeUpgradeItems,
} from "@/lib/deadlock";
import { getItems } from "@/lib/itemStore";

export const metadata = {
  title: "Build planner",
  description:
    "Plan a Deadlock build: pick a hero and get item suggestions tailored to its kit, each with a plain-English reason.",
};

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
