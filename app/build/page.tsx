import BuildClient from "./BuildClient";
import { fetchHeroes } from "@/lib/deadlock";

export default async function BuildPage() {
  const heroes = await fetchHeroes();
  heroes.sort((a, b) => a.name.localeCompare(b.name));

  return <BuildClient heroes={heroes} selectedHeroId={null} />;
}
