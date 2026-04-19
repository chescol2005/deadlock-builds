"use client";

import { useMemo } from "react";
import type { ShopCategory, ShopItem, ShopTier } from "@/lib/deadlock";

const TIERS: ShopTier[] = [1, 2, 3, 4];

type TabMeta = {
  label: string;
  accent: string;
  accentSoft: string;
  border: string;
  solid: string;
};

const TAB_META: Record<ShopCategory, TabMeta> = {
  weapon: {
    label: "Gun",
    accent: "rgba(255, 165, 0, 0.95)",
    accentSoft: "rgba(255, 165, 0, 0.15)",
    border: "rgba(255, 165, 0, 0.35)",
    solid: "#ea580c",
  },
  vitality: {
    label: "Vitality",
    accent: "rgba(80, 200, 120, 0.95)",
    accentSoft: "rgba(80, 200, 120, 0.15)",
    border: "rgba(80, 200, 120, 0.35)",
    solid: "#16a34a",
  },
  spirit: {
    label: "Spirit",
    accent: "rgba(170, 90, 255, 0.95)",
    accentSoft: "rgba(170, 90, 255, 0.15)",
    border: "rgba(170, 90, 255, 0.35)",
    solid: "#7c3aed",
  },
};

function tierCost(t: ShopTier): number {
  if (t === 1) return 800;
  if (t === 2) return 1600;
  if (t === 3) return 3200;
  return 6400;
}

export function ItemBrowser({
  items,
  activeTab,
  onTabChange,
  selectedIds,
  onToggle,
}: {
  items: ShopItem[];
  activeTab: ShopCategory;
  onTabChange: (tab: ShopCategory) => void;
  selectedIds: ReadonlySet<string>;
  onToggle: (item: ShopItem) => void;
}) {
  const meta = TAB_META[activeTab];

  const byTier = useMemo(() => {
    const filtered = items
      .filter((i) => i.shopable && i.category === activeTab)
      .sort((a, b) => a.tier - b.tier || a.cost - b.cost || a.name.localeCompare(b.name));

    const m = new Map<ShopTier, ShopItem[]>();
    for (const t of TIERS) m.set(t, []);
    for (const it of filtered) {
      m.get(it.tier)?.push(it);
    }
    return m;
  }, [items, activeTab]);

  return (
    <section style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Items</h2>

        <div style={{ display: "flex", gap: 8 }}>
          {(Object.keys(TAB_META) as ShopCategory[]).map((cat) => {
            const t = TAB_META[cat];
            const active = activeTab === cat;
            return (
              <button
                key={cat}
                onClick={() => onTabChange(cat)}
                style={{
                  padding: "7px 12px",
                  borderRadius: 999,
                  border: `1px solid ${active ? t.border : "rgba(255,255,255,0.15)"}`,
                  background: active ? t.accentSoft : "transparent",
                  color: active ? t.accent : "rgba(255,255,255,0.85)",
                  fontWeight: 800,
                  letterSpacing: 0.2,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
        {TIERS.map((tier) => {
          const tierItems = byTier.get(tier)!;
          return (
            <div
              key={tier}
              style={{
                border: `1px solid ${meta.border}`,
                borderRadius: 14,
                padding: 12,
                background: "rgba(0,0,0,0.10)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontWeight: 900, color: meta.accent }}>Tier {tier}</div>
                <div style={{ opacity: 0.8 }}>${tierCost(tier)}</div>
              </div>

              {tierItems.length === 0 ? (
                <div style={{ opacity: 0.7, fontSize: 13 }}>No items.</div>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
                    gap: 10,
                  }}
                >
                  {tierItems.map((it) => {
                    const isSelected = selectedIds.has(it.id);
                    return (
                      <li
                        key={it.id}
                        style={{
                          border: isSelected
                            ? `2px solid ${meta.solid}`
                            : "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 12,
                          padding: isSelected ? 9 : 10,
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          justifyContent: "space-between",
                          background: isSelected ? meta.accentSoft : "transparent",
                        }}
                      >
                        <div
                          style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}
                        >
                          {it.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={it.icon}
                              alt={it.name}
                              width={34}
                              height={34}
                              style={{ borderRadius: 10, flexShrink: 0 }}
                            />
                          ) : null}

                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                lineHeight: 1.15,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {it.name}
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                              {it.isActive ? (
                                <span
                                  style={{
                                    fontSize: 11,
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    border: `1px solid ${meta.border}`,
                                    color: meta.accent,
                                    background: meta.accentSoft,
                                  }}
                                >
                                  ACTIVE
                                </span>
                              ) : null}
                              <span style={{ fontSize: 11, opacity: 0.75 }}>${it.cost}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => onToggle(it)}
                          style={{
                            padding: "5px 9px",
                            borderRadius: 8,
                            border: `1px solid ${isSelected ? meta.solid : "rgba(255,255,255,0.2)"}`,
                            background: isSelected ? meta.accentSoft : "transparent",
                            color: isSelected ? meta.accent : "rgba(255,255,255,0.75)",
                            fontWeight: isSelected ? 700 : 400,
                            cursor: "pointer",
                            fontSize: 12,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {isSelected ? "Added" : "Add"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
