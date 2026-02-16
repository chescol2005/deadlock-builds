import BuildClient from "../BuildClient";
import { fetchHeroes } from "@/lib/deadlock";

export default async function BuildHeroPage({
  params,
}: {
  params: Promise<{ heroId: string }>;
}) {
  const { heroId } = await params;

  const heroes = await fetchHeroes();
  heroes.sort((a, b) => a.name.localeCompare(b.name));

  return <BuildClient heroes={heroes} selectedHeroId={heroId} />;
}
