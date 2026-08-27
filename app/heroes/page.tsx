import { Suspense } from "react";
import { fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import HeroesGridClient from "./HeroesGridClient";

export default async function HeroesPage() {
  // fetchVisibleHeroes() (which fetchVisibleHeroesEnriched wraps) already
  // sorts by name internally, so no redundant .sort() call is needed here.
  const heroes = await fetchVisibleHeroesEnriched();

  return (
    <Suspense fallback={<div style={{ padding: 32, opacity: 0.8 }}>Loading heroes…</div>}>
      <HeroesGridClient heroes={heroes} />
    </Suspense>
  );
}
