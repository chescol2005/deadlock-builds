import Link from "next/link";
import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { fetchHeroByRouteKey, isHeroIdKey } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import { getHeroStats } from "@/lib/heroStore";
import { getHeroAnalytics } from "@/lib/analyticsStore";
import { fetchHeroAbilityItems } from "@/lib/api/deadlockApi";
import { mapHeroAbilities } from "@/lib/abilityCoefficients";
import { ShopGrid } from "../components/ShopGrid";
import { HeroDifficultyBadge, HeroArchetypeTags } from "@/app/components/HeroDifficultyBadge";
import { HeroStatsSection } from "../components/HeroStatsSection";
import { HeroAbilitiesSection } from "../components/HeroAbilitiesSection";
import { heroPageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ hero: string[] }>;
}): Promise<Metadata> {
  const { hero } = await params;
  const routeKey = hero?.[0];
  if (!routeKey) return { title: "Heroes" };
  try {
    return heroPageMetadata(await fetchHeroByRouteKey(routeKey));
  } catch (err) {
    unstable_rethrow(err);
    return { title: "Heroes" };
  }
}

export default async function HeroPage({ params }: { params: Promise<{ hero: string[] }> }) {
  const { hero } = await params;

  const segments = hero ?? [];
  const routeKey = segments[0];
  if (!routeKey) redirect("/heroes");

  const hasSubroute = segments.length > 1;
  const isId = isHeroIdKey(routeKey);
  const heroData = await fetchHeroByRouteKey(routeKey);

  if (!isId && !hasSubroute) redirect(`/heroes/${heroData.id}`);

  // Abilities + shop items + base stats + analytics, via the same scoped
  // per-hero pipeline /build/[heroId] uses (fetchHeroAbilityItems +
  // mapHeroAbilities) rather than fetching every hero's abilities just to
  // filter down. Shop items: the same canonical fetchAllItems() +
  // normalizeItem() pipeline /build uses.
  const [shopItems, rawAbilities, baseStats, heroAnalyticsMap] = await Promise.all([
    getItems(),
    fetchHeroAbilityItems(heroData.id),
    getHeroStats(heroData.id),
    getHeroAnalytics(),
  ]);

  const heroAbilities = mapHeroAbilities(rawAbilities, heroData.items);
  const analytics = heroAnalyticsMap.get(heroData.id);

  return (
    <main style={{ padding: 32 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0 }}>{heroData.name}</h1>
            <HeroDifficultyBadge complexity={heroData.complexity} />
          </div>
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            {heroData.class_name}
            {heroData.hero_type ? ` · ${heroData.hero_type}` : null}
            {analytics ? ` · ${(analytics.winRate * 100).toFixed(1)}% win rate` : null}
          </div>
          <div style={{ marginTop: 8 }}>
            <HeroArchetypeTags tags={heroData.tags} />
          </div>
        </div>

        <Link href={`/build/${heroData.id}`} style={{ opacity: 0.9 }}>
          Build →
        </Link>
      </div>

      {baseStats ? <HeroStatsSection stats={baseStats} /> : null}

      <HeroAbilitiesSection abilities={heroAbilities} />

      <ShopGrid heroId={heroData.id} items={shopItems} />
    </main>
  );
}
