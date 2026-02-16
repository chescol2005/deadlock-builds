import HeroesGridClient from "./HeroesGridClient";
import { fetchVisibleHeroes } from "@/lib/deadlock";

export default async function HeroesPage() {
  const heroes = await fetchVisibleHeroes();
  return <HeroesGridClient heroes={heroes} />;
}
