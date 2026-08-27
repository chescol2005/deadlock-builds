"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Item, ItemCategory, ItemTier } from "@/lib/items";
import type { ItemAnalytics } from "@/lib/analyticsStore";
import { DataTable, type DataTableColumn } from "@/app/components/DataTable";
import { HeroArchetypeTags } from "@/app/components/HeroDifficultyBadge";
import { STAT_PROPERTY_LABELS } from "@/lib/statLabels";

const CATEGORY_OPTIONS: { value: ItemCategory; label: string }[] = [
  { value: "gun", label: "Gun" },
  { value: "vitality", label: "Vitality" },
  { value: "spirit", label: "Spirit" },
];

const TIER_OPTIONS: ItemTier[] = [1, 2, 3, 4];

// Rank used for the default view: group by category (in this display order),
// then tier, then win rate (best first). Matches CATEGORY_OPTIONS' order.
const CATEGORY_ORDER: Record<ItemCategory, number> = {
  gun: 0,
  vitality: 1,
  spirit: 2,
};

const CATEGORY_TEXT_COLOR: Record<ItemCategory, string> = {
  gun: "text-orange-400",
  spirit: "text-purple-400",
  vitality: "text-green-400",
};

function normalize(s: string) {
  return s.toLowerCase().trim();
}

function getParam(sp: URLSearchParams, key: string) {
  return sp.get(key) ?? "";
}

// "BonusFireRate" -> "Bonus Fire Rate" — fallback for stat keys with no
// curated label in STAT_PROPERTY_LABELS, so feature search still matches
// something readable instead of the raw camelCase key.
function humanizeStatKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
}

// Does this item have a stat property whose human-readable label mentions
// the (already-normalized) feature query? e.g. "fire rate" matches an item
// with a `FireRate` or `BonusFireRate` stat.
function itemMatchesFeature(item: Item, normalizedFeatureQuery: string): boolean {
  if (!normalizedFeatureQuery) return true;
  return Object.keys(item.stats).some((key) => {
    const label = STAT_PROPERTY_LABELS[key] ?? humanizeStatKey(key);
    return normalize(label).includes(normalizedFeatureQuery);
  });
}

interface ItemsTableClientProps {
  items: Item[];
  itemAnalytics: Record<number, ItemAnalytics>;
}

export function ItemsTableClient({ items, itemAnalytics }: ItemsTableClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize from URL once.
  const initialQ = getParam(new URLSearchParams(searchParams.toString()), "q");
  const initialFeature = getParam(new URLSearchParams(searchParams.toString()), "feature");
  const initialCategory = getParam(new URLSearchParams(searchParams.toString()), "category");
  const initialTier = getParam(new URLSearchParams(searchParams.toString()), "tier");

  const [query, setQuery] = useState(initialQ);
  const [featureQuery, setFeatureQuery] = useState(initialFeature);
  const [category, setCategory] = useState(initialCategory);
  const [tier, setTier] = useState(initialTier);

  const didMountRef = useRef(false);

  // Ref mirroring the latest `searchParams` on every render, kept in sync via
  // its own effect (mutating a ref during render itself is disallowed by this
  // project's lint rules). The push-to-URL effect further down deliberately
  // excludes `searchParams` from its dependency array (see its comment for
  // why — depending on it would make the effect retrigger itself after every
  // URL update it makes), but still needs to read the *current* URL params
  // (to preserve any query params this component doesn't manage) rather than
  // a value pinned to whenever the effect last re-ran. This sync effect is
  // declared first so it runs before the push effect whenever both fire in
  // the same commit.
  const searchParamsRef = useRef(searchParams);

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  // URL -> UI (back/forward / shared links).
  // This mirrors external `searchParams` changes into local state. It's
  // deliberately done here, during render, rather than in a useEffect: an
  // effect keyed only on `searchParams` that calls setQuery/setCategory/setTier
  // synchronously in its body causes an extra, avoidable render pass (React
  // flags this — see the "Adjusting state when a prop changes" pattern at
  // https://react.dev/learn/you-might-not-need-an-effect). Comparing against
  // a `prevSearchParamsKey` snapshot lets this run exactly once per distinct
  // incoming URL, without re-firing on every render caused by local typing
  // (which never changes `searchParams` itself) and without needing
  // `query`/`category`/`tier` as reactive inputs at all.
  const searchParamsKey = searchParams.toString();
  const [prevSearchParamsKey, setPrevSearchParamsKey] = useState(searchParamsKey);
  if (searchParamsKey !== prevSearchParamsKey) {
    setPrevSearchParamsKey(searchParamsKey);
    const sp = new URLSearchParams(searchParamsKey);
    setQuery(getParam(sp, "q"));
    setFeatureQuery(getParam(sp, "feature"));
    setCategory(getParam(sp, "category"));
    setTier(getParam(sp, "tier"));
  }

  const filtered = useMemo(() => {
    const q = normalize(query);
    const fq = normalize(featureQuery);
    return items.filter((it) => {
      const matchesQuery = !q || normalize(it.name).includes(q);
      const matchesFeature = itemMatchesFeature(it, fq);
      const matchesCategory = !category || it.category === category;
      const matchesTier = !tier || String(it.tier) === tier;
      return matchesQuery && matchesFeature && matchesCategory && matchesTier;
    });
  }, [items, query, featureQuery, category, tier]);

  // UI -> URL (shareable).
  // Deliberately excludes `searchParams` from deps: this effect is what
  // pushes `router.replace` calls that themselves change `searchParams`, so
  // depending on it would make the effect retrigger itself after every
  // update it makes. `searchParamsRef` gives it the latest URL params (to
  // preserve any query params this component doesn't manage) without that
  // self-retrigger. `router` is included — Next's `useRouter()` returns a
  // stable reference for the component's lifetime, so listing it satisfies
  // the lint rule without changing when this effect actually re-runs.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    const t = window.setTimeout(() => {
      const sp = new URLSearchParams(searchParamsRef.current.toString());

      const q = query.trim();
      if (q) sp.set("q", q);
      else sp.delete("q");

      const fq = featureQuery.trim();
      if (fq) sp.set("feature", fq);
      else sp.delete("feature");

      if (category) sp.set("category", category);
      else sp.delete("category");

      if (tier) sp.set("tier", tier);
      else sp.delete("tier");

      const qs = sp.toString();
      router.replace(qs ? `/items?${qs}` : "/items", { scroll: false });
    }, 150);

    return () => window.clearTimeout(t);
  }, [query, featureQuery, category, tier, router]);

  const clearFilters = () => {
    setQuery("");
    setFeatureQuery("");
    setCategory("");
    setTier("");
  };

  const columns: DataTableColumn<Item>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Item",
        sortValue: (it) => it.name,
        render: (it) => (
          <Link href={`/items/${it.id}`} className="flex items-center gap-2 hover:text-white">
            {it.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.icon} alt={it.name} width={32} height={32} className="rounded-md" />
            ) : (
              <div className="h-8 w-8 flex-shrink-0 rounded-md bg-zinc-800" />
            )}
            <span className="font-medium text-white">{it.name}</span>
          </Link>
        ),
      },
      {
        key: "category",
        label: "Category",
        // Composite key so the default (and any click-to-sort) view groups
        // by category, then tier, then win rate (highest first) — not just
        // category alone. Missing win-rate data sorts to the back of its tier.
        sortValue: (it) => {
          const winRate = itemAnalytics[it.numericId]?.winRate ?? -1;
          return CATEGORY_ORDER[it.category] * 1_000_000 + it.tier * 10_000 + (1 - winRate) * 100;
        },
        render: (it) => (
          <span className={`capitalize ${CATEGORY_TEXT_COLOR[it.category]}`}>{it.category}</span>
        ),
      },
      {
        key: "tier",
        label: "Tier",
        align: "right",
        sortValue: (it) => it.tier,
        render: (it) => it.tier,
      },
      {
        key: "cost",
        label: "Cost",
        align: "right",
        sortValue: (it) => it.cost,
        render: (it) => it.cost.toLocaleString("en-US"),
      },
      {
        key: "winRate",
        label: "Win Rate",
        align: "right",
        // Missing analytics sorts last, not first, on ascending sort.
        sortValue: (it) => itemAnalytics[it.numericId]?.winRate ?? -1,
        render: (it) => {
          const winRate = itemAnalytics[it.numericId]?.winRate;
          return winRate == null ? "—" : `${(winRate * 100).toFixed(1)}%`;
        },
      },
      {
        key: "tags",
        label: "Tags",
        sortable: false,
        render: (it) => <HeroArchetypeTags tags={it.tags} />,
      },
    ],
    [itemAnalytics],
  );

  const hasFilters = Boolean(query || featureQuery || category || tier);

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <nav className="mb-6 text-sm text-zinc-500">
          <span>Home</span>
          <span className="mx-2">/</span>
          <span className="text-zinc-300">Items</span>
        </nav>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Items</h1>
          <p className="mt-2 text-zinc-400">
            Browse every shop item — search by name or by feature (e.g. &ldquo;fire rate&rdquo;,
            &ldquo;lifesteal&rdquo;, &ldquo;cooldown&rdquo;), filter by category or tier, and sort
            by cost or win rate.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items by name…"
            className="min-w-60 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          />

          <input
            value={featureQuery}
            onChange={(e) => setFeatureQuery(e.target.value)}
            placeholder="Search by feature (e.g. fire rate, lifesteal)…"
            className="min-w-72 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
          >
            <option value="">All Categories</option>
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
          >
            <option value="">All Tiers</option>
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                Tier {t}
              </option>
            ))}
          </select>

          <div className="text-sm text-zinc-500">
            {filtered.length === items.length
              ? `Showing all ${items.length}`
              : `Showing ${filtered.length} of ${items.length}`}
          </div>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-amber-500 hover:text-white"
            >
              Clear filters
            </button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(it) => it.id}
          initialSort={{ key: "category", dir: "asc" }}
          emptyMessage="No items match your filters."
        />
      </div>
    </main>
  );
}
