import { Suspense } from "react";
import { getItems } from "@/lib/itemStore";
import { getItemAnalytics } from "@/lib/analyticsStore";
import type { ItemAnalytics } from "@/lib/analyticsStore";
import { ItemsTableClient } from "./ItemsTableClient";

export const metadata = { title: "Items | Deadlock Foundry" };

export default async function ItemsPage() {
  const [items, itemAnalyticsMap] = await Promise.all([getItems(), getItemAnalytics()]);

  // RSC boundary can't serialize a Map — hand the client component a plain
  // object instead (see app/build/[heroId]/page.tsx for the sibling
  // "one parallel fetch, zero rendering, hand off to one client component"
  // pattern this route follows).
  const itemAnalytics = Object.fromEntries(itemAnalyticsMap) as Record<number, ItemAnalytics>;

  return (
    <Suspense fallback={<div className="p-8 text-zinc-400">Loading items…</div>}>
      <ItemsTableClient items={items} itemAnalytics={itemAnalytics} />
    </Suspense>
  );
}
