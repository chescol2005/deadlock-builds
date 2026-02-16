import { fetchVisibleHeroes } from "@/lib/deadlock";
import HeroesGridClient from "./HeroesGridClient";

export default async function HeroesPage() {
  const heroes = await fetchVisibleHeroes();
  heroes.sort((a, b) => a.name.localeCompare(b.name));

  return <HeroesGridClient heroes={heroes} />;
}
