"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeadlockHeroListItem } from "@/lib/deadlock";
import { readBuild, removeFromBuild, clearBuild, BuildItem } from "@/lib/buildStorage";

export default function BuildClient({
  heroes,
  selectedHeroId,
}: {
  heroes: DeadlockHeroListItem[];
  selectedHeroId: string | null;
}) {
  const router = useRouter();
  const [heroId, setHeroId] = useState<string>(selectedHeroId ?? "");
  const [items, setItems] = useState<BuildItem[]>([]);

  const selectedHero = useMemo(
    () => heroes.find((h) => String(h.id) === String(heroId)),
    [heroes, heroId]
  );

  useEffect(() => {
    if (!heroId) {
      setItems([]);
      return;
    }
    setItems(readBuild(heroId));
  }, [heroId]);

  useEffect(() => {
    const handler = () => {
      if (!heroId) return;
      setItems(readBuild(heroId));
    };
    window.addEventListener("deadlock-build-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("deadlock-build-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, [heroId]);

  return (
    <main style={{ padding: 32 }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Build</h1>

        <select
          value={heroId}
          onChange={(e) => {
            const next = e.target.value;
            setHeroId(next);
            if (!next) router.push("/build");
            else router.push(`/build/${next}`);
          }}
          style={{ padding: 8, borderRadius: 8 }}
        >
          <option value="">Select a hero…</option>
          {heroes.map((h) => (
            <option key={h.id} value={String(h.id)}>
              {h.name}
            </option>
          ))}
        </select>

        {selectedHero ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {selectedHero.images?.icon_image_small_webp ||
            selectedHero.images?.icon_image_small ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={
                  selectedHero.images.icon_image_small_webp ??
                  selectedHero.images.icon_image_small
                }
                alt={selectedHero.name}
                width={40}
                height={40}
                style={{ borderRadius: 10 }}
              />
            ) : null}

            <div>
              <div style={{ fontWeight: 700, lineHeight: 1.1 }}>{selectedHero.name}</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>{selectedHero.class_name}</div>
            </div>
          </div>
        ) : null}
      </header>

      {!heroId ? (
        <div style={{ marginTop: 24, opacity: 0.8 }}>Select a hero to start a build.</div>
      ) : (
        <section style={{ marginTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>{selectedHero?.name ?? "Selected Hero"}</h2>
            <button
              onClick={() => setItems(clearBuild(heroId))}
              disabled={items.length === 0}
              style={{ padding: "6px 10px", borderRadius: 8 }}
            >
              Clear
            </button>
          </div>

          {items.length === 0 ? (
            <div style={{ marginTop: 12, opacity: 0.8 }}>
              Blank canvas — add items from the hero page.
            </div>
          ) : (
            <ul style={{ marginTop: 12, listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
              {items.map((it) => (
                <li
                  key={it.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 12,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>{it.name}</div>
                  <button
                    onClick={() => setItems(removeFromBuild(heroId, it.id))}
                    style={{ padding: "6px 10px", borderRadius: 8 }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
