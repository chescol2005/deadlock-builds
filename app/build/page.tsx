import BuildClient from "./BuildClient";
import { fetchVisibleHeroes } from "@/lib/deadlock";

export default async function BuildPage() {
  const heroes = await fetchVisibleHeroes();
  return <BuildClient heroes={heroes} selectedHeroId={null} />;
}
