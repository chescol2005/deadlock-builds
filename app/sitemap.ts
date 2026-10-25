import type { MetadataRoute } from "next";
import { unstable_rethrow } from "next/navigation";
import { fetchVisibleHeroes } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import { siteUrl, sitemapEntries } from "@/lib/seo";

// Static routes always; hero, build and item pages when the API answers.
// Entries come from lib/seo.ts sitemapEntries().
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let heroIds: number[] = [];
  let itemIds: string[] = [];
  try {
    const [heroes, items] = await Promise.all([fetchVisibleHeroes(), getItems()]);
    heroIds = heroes.map((h) => h.id);
    itemIds = items.map((i) => i.id);
  } catch (err) {
    unstable_rethrow(err);
    console.error("[sitemap] live data unavailable, listing static routes only:", err);
  }
  return sitemapEntries(siteUrl(), heroIds, itemIds);
}
