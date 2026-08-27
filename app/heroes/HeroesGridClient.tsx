"use client";

import Link from "next/link";
import { useMemo, useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DeadlockHeroListItemEnriched } from "@/lib/heroApi";
import { HeroDifficultyBadge, HeroArchetypeTags } from "@/app/components/HeroDifficultyBadge";

function formatClassLabel(className: string) {
  // hero_cadence -> Cadence
  return className
    .replace(/^hero_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalize(s: string) {
  return s.toLowerCase().trim();
}

function getParam(sp: URLSearchParams, key: string) {
  return sp.get(key) ?? "";
}

export default function HeroesGridClient({ heroes }: { heroes: DeadlockHeroListItemEnriched[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize from URL once
  const initialQ = getParam(new URLSearchParams(searchParams.toString()), "q");
  const initialClass = getParam(new URLSearchParams(searchParams.toString()), "class");

  const [query, setQuery] = useState(initialQ);
  const [classFilter, setClassFilter] = useState(initialClass);

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
  // effect keyed only on `searchParams` that calls setQuery/setClassFilter
  // synchronously in its body causes an extra, avoidable render pass (React
  // flags this — see the "Adjusting state when a prop changes" pattern at
  // https://react.dev/learn/you-might-not-need-an-effect). Comparing against
  // a `prevSearchParamsKey` snapshot lets this run exactly once per distinct
  // incoming URL, without re-firing on every render caused by local typing
  // (which never changes `searchParams` itself) and without needing
  // `query`/`classFilter` as reactive inputs at all.
  const searchParamsKey = searchParams.toString();
  const [prevSearchParamsKey, setPrevSearchParamsKey] = useState(searchParamsKey);
  if (searchParamsKey !== prevSearchParamsKey) {
    setPrevSearchParamsKey(searchParamsKey);
    const sp = new URLSearchParams(searchParamsKey);
    setQuery(getParam(sp, "q"));
    setClassFilter(getParam(sp, "class"));
  }

  const classOptions = useMemo(() => {
    // Map key -> display name (take first occurrence)
    const map = new Map<string, string>();
    for (const h of heroes) {
      if (h.class_name && !map.has(h.class_name)) {
        map.set(h.class_name, h.name);
      }
    }

    // Sort by label (hero name)
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [heroes]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    return heroes.filter((h) => {
      const matchesName = !q || normalize(h.name).includes(q);
      const matchesClass = !classFilter || h.class_name === classFilter;
      return matchesName && matchesClass;
    });
  }, [heroes, query, classFilter]);

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

      if (classFilter) sp.set("class", classFilter);
      else sp.delete("class");

      const qs = sp.toString();
      router.replace(qs ? `/heroes?${qs}` : "/heroes", { scroll: false });
    }, 150);

    return () => window.clearTimeout(t);
  }, [query, classFilter, router]);

  const clearFilters = () => {
    setQuery("");
    setClassFilter("");
  };

  return (
    <main style={{ padding: 32 }}>
      <h1>Heroes</h1>

      <p style={{ opacity: 0.8 }}>Loaded {heroes.length} heroes from the Deadlock Assets API.</p>

      <div
        style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search heroes by name…"
          style={{ padding: "10px 12px", borderRadius: 10, minWidth: 240 }}
        />

        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 10, minWidth: 200 }}
        >
          <option value="">All</option>
          {classOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div style={{ opacity: 0.75, fontSize: 13 }}>
          {filtered.length === heroes.length
            ? `Showing all ${heroes.length}`
            : `Showing ${filtered.length} of ${heroes.length}`}
        </div>

        {(query || classFilter) && (
          <button onClick={clearFilters} style={{ padding: "10px 12px", borderRadius: 10 }}>
            Clear filters
          </button>
        )}
      </div>

      <ul style={{ marginTop: 16, display: "grid", gap: 12, padding: 0, listStyle: "none" }}>
        {filtered.map((h) => (
          <li
            key={h.id}
            style={{
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 12,
              padding: 12,
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            {h.images?.icon_image_small_webp || h.images?.icon_image_small ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={h.images.icon_image_small_webp ?? h.images.icon_image_small}
                alt={h.name}
                width={48}
                height={48}
                style={{ borderRadius: 10 }}
              />
            ) : null}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>
                  {/* keep id-based routing consistent with your current setup */}
                  <Link href={`/heroes/${h.id}`}>{h.name}</Link>
                </div>
                <HeroDifficultyBadge complexity={h.complexity} />
              </div>
              <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>
                {h.class_name ? formatClassLabel(h.class_name) : ""}
                {h.hero_type ? (
                  <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                    {h.hero_type}
                  </span>
                ) : null}
              </div>
              <HeroArchetypeTags tags={h.tags} />
              {h.baseStats || h.analytics ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                  {h.baseStats ? (
                    <>
                      <span>{Math.round(h.baseStats.maxHealth)} HP</span>
                      <span>{Math.round(h.baseStats.moveSpeed)} spd</span>
                      <span>{Math.round(h.baseStats.bulletDamage)} dmg</span>
                    </>
                  ) : null}
                  {h.analytics ? (
                    <span className="text-amber-500/80">
                      {(h.analytics.winRate * 100).toFixed(1)}% WR
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
