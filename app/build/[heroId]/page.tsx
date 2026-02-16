import BuildClient from "../BuildClient";
import { fetchVisibleHeroes } from "@/lib/deadlock";

export default async function BuildHeroPage({
  params,
}: {
  params: Promise<{ heroId: string }>;
}) {
  const { heroId } = await params;

  const heroes = await fetchVisibleHeroes();

  return <BuildClient heroes={heroes} selectedHeroId={heroId} />;
}
