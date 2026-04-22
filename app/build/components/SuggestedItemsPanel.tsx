"use client";

import { useMemo } from "react";
import type { Item, ItemCategory } from "@/lib/items";
import type { BuildGoal } from "@/lib/scoring/goalWeights";
import { scoreItems } from "@/lib/scoring/scoreItems";
import { getEffectiveAddCost } from "@/lib/buildUtils";

const CATEGORY_COLORS: Record<ItemCategory, string> = {
  gun: "#ea580c",
  vitality: "#16a34a",
  spirit: "#7c3aed",
};

const CATEGORY_SOFT: Record<ItemCategory, string> = {
  gun: "rgba(234,88,12,0.12)",
  vitality: "rgba(22,163,74,0.12)",
  spirit: "rgba(124,58,237,0.12)",
};

const TOP_N = 6;

export function SuggestedItemsPanel({
  allItems,
  currentBuild,
  selectedGoal,
  onAdd,
  consumedComponents = new Map(),
  slotsFull = false,
}: {
  allItems: Item[];
  currentBuild: Item[];
  selectedGoal: BuildGoal;
  onAdd: (item: Item) => void;
  consumedComponents?: ReadonlyMap<string, string>;
  slotsFull?: boolean;
}) {
  const buildIds = useMemo(() => new Set(currentBuild.map((i) => i.id)), [currentBuild]);

  const topItems = useMemo(
    () => scoreItems(allItems, selectedGoal, currentBuild).slice(0, TOP_N),
    [allItems, selectedGoal, currentBuild],
  );

  // Always surface direct upgrades of build items and consumed items so the
  // chain discount + consumed state are visible regardless of score rank.
  const upgradesAvailable = useMemo(() => {
    const shownIds = new Set([
      ...topItems.map((r) => r.item.id),
      ...currentBuild.map((i) => i.id),
    ]);

    const upgradeIds = new Set(currentBuild.flatMap((i) => i.upgradesInto ?? []));

    // Also surface upgrades of consumed items — e.g. Surge of Power stays
    // visible after Extra Spirit is consumed by Improved Spirit.
    const allById = new Map(allItems.map((i) => [i.id, i]));
    for (const consumedId of consumedComponents.keys()) {
      const consumedItem = allById.get(consumedId);
      for (const upgradeId of consumedItem?.upgradesInto ?? []) {
        upgradeIds.add(upgradeId);
      }
    }

    return allItems.filter(
      (it) => upgradeIds.has(it.id) && !shownIds.has(it.id) && !consumedComponents.has(it.id),
    );
  }, [allItems, currentBuild, topItems, consumedComponents]);

  // Consumed items not already visible in topItems or upgradesAvailable.
  const consumedNotShown = useMemo(() => {
    const shownIds = new Set([
      ...topItems.map((r) => r.item.id),
      ...upgradesAvailable.map((i) => i.id),
    ]);
    return allItems.filter((it) => consumedComponents.has(it.id) && !shownIds.has(it.id));
  }, [allItems, consumedComponents, topItems, upgradesAvailable]);

  function renderButton(item: Item) {
    const isConsumed = consumedComponents.has(item.id);
    const isInBuild = buildIds.has(item.id);

    if (isConsumed) {
      const consumedBy = consumedComponents.get(item.id)!;
      return (
        <button
          disabled
          title={`Consumed by ${consumedBy}`}
          style={{
            alignSelf: "flex-start",
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent",
            color: "rgba(255,255,255,0.3)",
            fontWeight: 600,
            fontSize: 12,
            cursor: "not-allowed",
          }}
        >
          Consumed
        </button>
      );
    }

    if (isInBuild) {
      const accent = CATEGORY_COLORS[item.category];
      return (
        <button
          disabled
          style={{
            alignSelf: "flex-start",
            padding: "4px 10px",
            borderRadius: 6,
            border: `1px solid ${accent}`,
            background: CATEGORY_SOFT[item.category],
            color: accent,
            fontWeight: 700,
            fontSize: 12,
            cursor: "default",
          }}
        >
          Added
        </button>
      );
    }

    if (slotsFull) {
      return (
        <button
          disabled
          style={{
            alignSelf: "flex-start",
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent",
            color: "rgba(255,255,255,0.3)",
            fontWeight: 600,
            fontSize: 12,
            cursor: "not-allowed",
          }}
        >
          Build Full
        </button>
      );
    }

    const effectiveCost = getEffectiveAddCost(item, currentBuild, allItems);
    const isDiscounted = effectiveCost < item.cost;
    const accent = CATEGORY_COLORS[item.category];
    const label = isDiscounted
      ? `Add $${effectiveCost.toLocaleString("en-US")} ↑`
      : `Add $${effectiveCost.toLocaleString("en-US")}`;

    return (
      <button
        onClick={() => onAdd(item)}
        style={{
          alignSelf: "flex-start",
          padding: "4px 10px",
          borderRadius: 6,
          border: `1px solid ${accent}`,
          background: CATEGORY_SOFT[item.category],
          color: accent,
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
    );
  }

  type Row = { item: Item; score: number | null; reason: string | null; tag: string | null };

  const allRows: Row[] = [
    ...topItems.map(({ item, score, reason }) => ({ item, score, reason, tag: null })),
    ...upgradesAvailable.map((item) => ({ item, score: null, reason: null, tag: "Upgrade" })),
    ...consumedNotShown.map((item) => ({ item, score: null, reason: null, tag: null })),
  ];

  return (
    <section>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          opacity: 0.6,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          marginBottom: 10,
        }}
      >
        Suggested Items
      </div>

      {allRows.length === 0 ? (
        <div style={{ opacity: 0.45, fontSize: 12 }}>No suggestions available.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {allRows.map(({ item, score, reason, tag }) => {
            const accent = CATEGORY_COLORS[item.category];
            const soft = CATEGORY_SOFT[item.category];
            const isConsumed = consumedComponents.has(item.id);
            return (
              <div
                key={item.id}
                style={{
                  borderLeft: `3px solid ${accent}`,
                  borderTop: "1px solid rgba(255,255,255,0.10)",
                  borderRight: "1px solid rgba(255,255,255,0.10)",
                  borderBottom: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: soft,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  opacity: isConsumed ? 0.55 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name}</div>
                  {score !== null ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: accent,
                        background: soft,
                        border: `1px solid ${accent}`,
                        borderRadius: 6,
                        padding: "2px 6px",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {score.toFixed(2)}
                    </span>
                  ) : tag ? (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: accent,
                        opacity: 0.7,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {tag}
                    </span>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: 8, fontSize: 11, opacity: 0.75 }}>
                  <span style={{ color: accent, textTransform: "capitalize", fontWeight: 600 }}>
                    {item.category}
                  </span>
                  <span>T{item.tier}</span>
                  <span>◈ {item.cost.toLocaleString("en-US")}</span>
                </div>

                {reason && (
                  <div style={{ fontSize: 12, opacity: 0.8, fontStyle: "italic" }}>{reason}</div>
                )}

                {renderButton(item)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
