import { Suspense } from "react";
import { fetchVisibleHeroes } from "@/lib/deadlock";
import HeroesGridClient from "./HeroesGridClient";

export default async function HeroesPage() {
  const heroes = await fetchVisibleHeroes();
  heroes.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Suspense fallback={<div style={{ padding: 32, opacity: 0.8 }}>Loading heroes…</div>}>
      <HeroesGridClient heroes={heroes} />
    </Suspense>
  );
}
