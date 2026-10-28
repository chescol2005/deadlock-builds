import { fetchHeroes } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import { MatchReviewClient } from "./MatchReviewClient";
import type { MatchPageHero } from "./MatchReviewClient";

export const metadata = {
  title: "Match review",
  description:
    "Paste a Deadlock match ID, pick your hero and see how your lane went in the first 9 minutes, with plain-English coaching.",
  alternates: { canonical: "/match" },
};

export default async function MatchPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; hero?: string }>;
}) {
  const [{ id, hero }, heroList, allItems] = await Promise.all([
    searchParams,
    fetchHeroes(),
    getItems(),
  ]);
  // Every hero, not only the selectable ones: a match can include any of them.
  const heroes: MatchPageHero[] = heroList.map((h) => ({
    id: h.id,
    name: h.name,
    icon: h.images?.icon_image_small_webp ?? h.images?.icon_image_small ?? null,
    complexity: h.complexity ?? null,
  }));
  const heroParam = Number(hero);
  return (
    <MatchReviewClient
      heroes={heroes}
      allItems={allItems}
      initialMatchId={typeof id === "string" ? id : ""}
      initialHeroId={Number.isInteger(heroParam) && heroParam > 0 ? heroParam : null}
    />
  );
}
