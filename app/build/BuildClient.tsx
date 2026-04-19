"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DeadlockHeroListItem,
  ShopItem,
  ShopCategory,
  HeroAbilitySlot,
  SignatureSlot,
  AbilityLevel,
  AbilityLevels,
} from "@/lib/deadlock";
import { readBuild, removeFromBuild, clearBuild } from "@/lib/buildStorage";
import { ItemBrowser } from "@/app/build/components/ItemBrowser";
import { AbilityLevelingPanel } from "@/app/build/components/AbilityLevelingPanel";
import { BuildSummaryPanel } from "@/app/build/components/BuildSummaryPanel";

const CATEGORY_COLORS: Record<ShopCategory, string> = {
  weapon: "#ea580c",
  vitality: "#16a34a",
  spirit: "#7c3aed",
};

export default function BuildClient({
  heroes,
  selectedHeroId,
  upgrades,
  heroAbilities = [],
}: {
  heroes: DeadlockHeroListItem[];
  selectedHeroId: string | null;
  upgrades: ShopItem[];
  heroAbilities?: HeroAbilitySlot[];
}) {
  const router = useRouter();
  const [heroId, setHeroId] = useState<string>(selectedHeroId ?? "");
  const [refresh, setRefresh] = useState(0);
  const [activeTab, setActiveTab] = useState<ShopCategory>("weapon");
  const [abilityLevels, setAbilityLevels] = useState<AbilityLevels>({});

  const buildItems = useMemo(() => {
    if (!heroId) return [];
    return readBuild(heroId);
  }, [heroId, refresh]);

  const selectedIds = useMemo(
    () => new Set(buildItems.map((it) => it.id)),
    [buildItems]
  );

  const selectedItems = useMemo(() => {
    if (buildItems.length === 0) return [];
    const byId = new Map(upgrades.map((u) => [u.id, u]));
    return buildItems.flatMap((it) => {
      const shopItem = byId.get(it.id);
      return shopItem ? [shopItem] : [];
    });
  }, [buildItems, upgrades]);

  const selectedHero = useMemo(
    () => heroes.find((h) => String(h.id) === String(heroId)),
    [heroes, heroId]
  );

  useEffect(() => {
    const handler = () => setRefresh((x) => x + 1);
    window.addEventListener("deadlock-build-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("deadlock-build-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  function handleLevelChange(slot: SignatureSlot, level: AbilityLevel) {
    setAbilityLevels((prev) => ({ ...prev, [slot]: level }));
  }

  return (
    <main style={{ padding: 32 }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Build</h1>

        <select
          value={heroId}
          onChange={(e) => {
            const next = e.target.value;
            setHeroId(next);
            setAbilityLevels({});
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "300px 1fr 280px",
            gap: 24,
            marginTop: 24,
            alignItems: "start",
          }}
        >
          {/* Left panel */}
          <div>
            <AbilityLevelingPanel
              abilities={heroAbilities}
              abilityLevels={abilityLevels}
              onLevelChange={handleLevelChange}
            />
          </div>

          {/* Center panel */}
          <div>
            <section>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2 style={{ margin: 0 }}>{selectedHero?.name ?? "Selected Hero"}</h2>
                <button
                  onClick={() => {
                    clearBuild(heroId);
                    setRefresh((x) => x + 1);
                  }}
                  disabled={buildItems.length === 0}
                >
                  Clear
                </button>
              </div>

              {buildItems.length === 0 ? (
                <div style={{ marginTop: 12, opacity: 0.6 }}>No items added yet.</div>
              ) : (
                <ul
                  style={{
                    marginTop: 12,
                    listStyle: "none",
                    padding: 0,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  {selectedItems.map((it) => {
                    const accentColor = CATEGORY_COLORS[it.category];
                    return (
                      <li
                        key={it.id}
                        style={{
                          borderLeft: `3px solid ${accentColor}`,
                          borderTop: "1px solid rgba(255,255,255,0.10)",
                          borderRight: "1px solid rgba(255,255,255,0.10)",
                          borderBottom: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 10,
                          padding: "10px 12px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          background: `${accentColor}0d`,
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{it.name}</div>
                        <button
                          onClick={() => {
                            removeFromBuild(heroId, it.id);
                            setRefresh((x) => x + 1);
                          }}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 6,
                            border: "1px solid rgba(255,255,255,0.15)",
                            background: "transparent",
                            color: "rgba(255,255,255,0.6)",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <ItemBrowser
              heroId={heroId}
              items={upgrades}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              selectedIds={selectedIds}
            />
          </div>

          {/* Right panel */}
          <div>
            <BuildSummaryPanel selectedItems={selectedItems} />
          </div>
        </div>
      )}
    </main>
  );
}
