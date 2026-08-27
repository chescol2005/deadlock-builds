import Link from "next/link";
import { notFound } from "next/navigation";
import { getItems, getItemByClassname } from "@/lib/itemStore";
import { getItemAnalytics } from "@/lib/analyticsStore";
import type { Item, ItemCategory } from "@/lib/items";
import { ItemStatsSection } from "../components/ItemStatsSection";

const CATEGORY_TEXT_COLOR: Record<ItemCategory, string> = {
  gun: "text-orange-400",
  spirit: "text-purple-400",
  vitality: "text-green-400",
};

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [items, itemAnalytics] = await Promise.all([getItems(), getItemAnalytics()]);
  const item = getItemByClassname(id, items);

  // /items/{id} is already the canonical URL (Item.id === class_name is a
  // single stable identifier, unlike heroes' numeric-id-vs-slug split) — no
  // redirect needed, just 404 on an unknown id.
  if (!item) notFound();

  const analytics = itemAnalytics.get(item.numericId);
  const components = (item.componentItems ?? [])
    .map((cid) => getItemByClassname(cid, items))
    .filter((x): x is Item => !!x);
  const upgrades = (item.upgradesInto ?? [])
    .map((uid) => getItemByClassname(uid, items))
    .filter((x): x is Item => !!x);

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="mb-6 text-sm text-zinc-500">
          <Link href="/items" className="hover:text-zinc-300">
            Items
          </Link>
          <span className="mx-2">/</span>
          <span className="text-zinc-300">{item.name}</span>
        </nav>

        <div className="mb-8 flex items-center gap-4">
          {item.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.icon} alt={item.name} width={64} height={64} className="rounded-lg" />
          ) : (
            <div className="h-16 w-16 rounded-lg bg-zinc-800" />
          )}
          <div>
            <h1 className="text-3xl font-bold text-white">{item.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
              <span className={`font-semibold capitalize ${CATEGORY_TEXT_COLOR[item.category]}`}>
                {item.category}
              </span>
              <span className="text-zinc-500">Tier {item.tier}</span>
              <span className="font-mono text-amber-400">
                {item.cost.toLocaleString("en-US")} souls
              </span>
            </div>
          </div>
        </div>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-white">Stats</h2>
          <ItemStatsSection item={item} />
        </section>

        {components.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-white">Builds From</h2>
            <ItemCardList items={components} />
          </section>
        )}

        {upgrades.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-white">Upgrades Into</h2>
            <ItemCardList items={upgrades} />
          </section>
        )}

        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Match Data</h2>
          {analytics ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="Win Rate" value={`${(analytics.winRate * 100).toFixed(1)}%`} />
              <StatCard
                label="Pick Rate"
                value={analytics.players != null ? analytics.players.toLocaleString("en-US") : "—"}
              />
              <StatCard
                label="Avg Buy Time"
                value={
                  analytics.avgBuyTimeS != null
                    ? `${(analytics.avgBuyTimeS / 60).toFixed(1)}m`
                    : "—"
                }
              />
            </dl>
          ) : (
            <p className="text-sm text-zinc-500">No match data yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function ItemCardList({ items }: { items: Item[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((it) => (
        <Link
          key={it.id}
          href={`/items/${it.id}`}
          className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 hover:border-amber-500"
        >
          {it.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.icon} alt={it.name} width={28} height={28} className="rounded-md" />
          ) : (
            <div className="h-7 w-7 flex-shrink-0 rounded-md bg-zinc-800" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">{it.name}</div>
            <div className="text-xs text-zinc-500">{it.cost.toLocaleString("en-US")} souls</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <dt className="text-xs tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-amber-400">{value}</dd>
    </div>
  );
}
