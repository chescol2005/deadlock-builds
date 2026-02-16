"use client";

import Link from "next/link";
import { useMemo, useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DeadlockHeroListItem } from "@/lib/deadlock";

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

export default function HeroesGridClient({ heroes }: { heroes: DeadlockHeroListItem[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize from URL once
  const initialQ = getParam(new URLSearchParams(searchParams.toString()), "q");
  const initialClass = getParam(new URLSearchParams(searchParams.toString()), "class");

  const [query, setQuery] = useState(initialQ);
  const [classFilter, setClassFilter] = useState(initialClass);

  const didMountRef = useRef(false);

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

  // URL -> UI (back/forward / shared links)
  useEffect(() => {
    const sp = new URLSearchParams(searchParams.toString());
    const nextQ = getParam(sp, "q");
    const nextClass = getParam(sp, "class");

    // Only update if different (prevents cursor jumps)
    if (nextQ !== query) setQuery(nextQ);
    if (nextClass !== classFilter) setClassFilter(nextClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // UI -> URL (shareable)
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    const t = window.setTimeout(() => {
      const sp = new URLSearchParams(searchParams.toString());

      const q = query.trim();
      if (q) sp.set("q", q);
      else sp.delete("q");

      if (classFilter) sp.set("class", classFilter);
      else sp.delete("class");

      const qs = sp.toString();
      router.replace(qs ? `/heroes?${qs}` : "/heroes", { scroll: false });
    }, 150);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, classFilter]);

  const clearFilters = () => {
    setQuery("");
    setClassFilter("");
  };

  return (
    <main style={{ padding: 32 }}>
      <h1>Heroes</h1>

      <p style={{ opacity: 0.8 }}>Loaded {heroes.length} heroes from the Deadlock Assets API.</p>

      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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

            <div>
              <div style={{ fontWeight: 700 }}>
                {/* keep id-based routing consistent with your current setup */}
                <Link href={`/heroes/${h.id}`}>{h.name}</Link>
              </div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                {h.class_name ? formatClassLabel(h.class_name) : ""}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
