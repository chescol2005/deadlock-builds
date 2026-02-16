"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AddToBuildButton } from "./AddToBuildButton";
import type { ShopItem, ShopTier } from "@/lib/deadlock";

type TabKey = "weapon" | "vitality" | "spirit";

const TIERS: ShopTier[] = [1, 2, 3, 4];

const TAB_META: Record<
  TabKey,
  { label: string; accent: string; accentSoft: string; border: string }
> = {
  weapon: {
    label: "Gun",
    accent: "rgba(255, 165, 0, 0.95)",
    accentSoft: "rgba(255, 165, 0, 0.15)",
    border: "rgba(255, 165, 0, 0.35)",
  },
  vitality: {
    label: "Vitality",
    accent: "rgba(80, 200, 120, 0.95)",
    accentSoft: "rgba(80, 200, 120, 0.15)",
    border: "rgba(80, 200, 120, 0.35)",
  },
  spirit: {
    label: "Spirit",
    accent: "rgba(170, 90, 255, 0.95)",
    accentSoft: "rgba(170, 90, 255, 0.15)",
    border: "rgba(170, 90, 255, 0.35)",
  },
};

function tierCost(t: ShopTier) {
  if (t === 1) return 800;
  if (t === 2) return 1600;
  if (t === 3) return 3200;
  return 6400;
}

export function ShopGrid({
  heroId,
  items,
  showBuildLink = true,
}: {
  heroId: string | number;
  items: ShopItem[];
  showBuildLink?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("weapon");
  const [q, setQ] = useState("");

  const meta = TAB_META[tab];

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items
      .filter((i) => i.shopable)
      .filter((i) => i.category === tab)
      .filter((i) => (query ? i.name.toLowerCase().includes(query) : true))
      .filter((i) => i.tier === 1 || i.tier === 2 || i.tier === 3 || i.tier === 4)
      .sort((a, b) => a.tier - b.tier || a.cost - b.cost || a.name.localeCompare(b.name));
  }, [items, tab, q]);

  const byTier = useMemo(() => {
    const m = new Map<ShopTier, ShopItem[]>();
    for (const t of TIERS) m.set(t, []);

    for (const it of filtered) {
      const t = it.tier;
      if (t === 1 || t === 2 || t === 3 || t === 4) {
        m.get(t)!.push(it);
      }
      // else: ignore items with missing/invalid tier
    }

    return m;
  }, [filtered]);

    return (
      <section style={{ marginTop: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Shop</h2>

          {showBuildLink ? (
            <Link
              href={`/build/${heroId}`}
              style={{
                opacity: 0.9,
                textDecoration: "none",
                border: `1px solid ${meta.border}`,
                padding: "6px 10px",
                borderRadius: 999,
                background: meta.accentSoft,
                color: meta.accent,
                fontWeight: 800,
              }}
            >
              Build →
            </Link>
          ) : null}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8 }}>
          {(Object.keys(TAB_META) as TabKey[]).map((k) => {
            const t = TAB_META[k];
            const active = tab === k;

            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                style={{
                  padding: "7px 12px",
                  borderRadius: 999,
                  border: `1px solid ${active ? t.border : "rgba(255,255,255,0.15)"}`,
                  background: active ? t.accentSoft : "transparent",
                  color: active ? t.accent : "rgba(255,255,255,0.85)",
                  fontWeight: 800,
                  letterSpacing: 0.2,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${meta.label} items…`}
          style={{
            marginLeft: "auto",
            padding: "8px 10px",
            borderRadius: 10,
            border: `1px solid ${meta.border}`,
            background: "transparent",
            color: "inherit",
            minWidth: 240,
          }}
        />
      </div>

      {/* Tier blocks */}
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
                <div style={{ fontWeight: 900, color: meta.accent }}>
                  Tier {tier}
                </div>
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
                  {tierItems.map((it) => (
                    <li
                      key={it.id}
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 12,
                        padding: 10,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        {it.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.icon}
                            alt={it.name}
                            width={34}
                            height={34}
                            style={{ borderRadius: 10 }}
                          />
                        ) : null}

                        <div>
                          <div style={{ fontWeight: 750, lineHeight: 1.15 }}>{it.name}</div>
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

                      <AddToBuildButton heroId={heroId} item={{ id: it.id, name: it.name }} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
