"use client";

import type { Item, ItemAssignment } from "@/lib/items";
import { getActiveItems } from "@/lib/buildCalculations";
import { calculateDamageSplit, calculateTotalCost } from "@/lib/buildCalculations";

const COLORS = {
  spirit: { solid: "#7c3aed", label: "Spirit" },
  gun: { solid: "#ea580c", label: "Gun" },
  vitality: { solid: "#16a34a", label: "Vitality" },
} as const;

const SLOT_COUNT = 12;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function ActiveItemsGrid({
  allItems,
  assignments,
  activeError,
  onToggleActive,
}: {
  allItems: Item[];
  assignments: ItemAssignment[];
  activeError: string | null;
  onToggleActive: (itemId: string) => void;
}) {
  const activeItems = getActiveItems(allItems, assignments);
  const split = calculateDamageSplit(activeItems);
  const totalCost = calculateTotalCost(activeItems);
  const count = activeItems.length;

  const slots: Array<Item | null> = [
    ...activeItems,
    ...Array<null>(Math.max(0, SLOT_COUNT - activeItems.length)).fill(null),
  ];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            opacity: 0.6,
            textTransform: "uppercase",
            letterSpacing: 0.8,
          }}
        >
          Active Build
        </div>
        <span
          style={{
            fontSize: 12,
            opacity: 0.55,
            fontWeight: 600,
            color: count >= SLOT_COUNT ? "#f87171" : "inherit",
          }}
        >
          {count} / {SLOT_COUNT} active
        </span>
      </div>

      {activeError ? (
        <div
          style={{
            fontSize: 12,
            color: "#f87171",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 6,
            padding: "6px 10px",
          }}
        >
          {activeError}
        </div>
      ) : null}

      {/* 4×3 slot grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
        }}
      >
        {slots.map((item, i) =>
          item ? (
            <button
              key={item.id}
              onClick={() => onToggleActive(item.id)}
              title="Click to remove from active build"
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: "6px 4px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.07)",
                cursor: "pointer",
                color: "inherit",
                minHeight: 64,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  right: 4,
                  fontSize: 9,
                  lineHeight: 1,
                  color: "#facc15",
                  pointerEvents: "none",
                }}
              >
                ★
              </span>
              {item.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.icon}
                  alt={item.name}
                  width={28}
                  height={28}
                  style={{ borderRadius: 6, flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.1)",
                  }}
                />
              )}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  textAlign: "center",
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  wordBreak: "break-word",
                }}
              >
                {item.name}
              </span>
            </button>
          ) : (
            <div
              key={`empty-${i}`}
              style={{
                minHeight: 64,
                borderRadius: 8,
                border: "1px dashed rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.02)",
              }}
            />
          ),
        )}
      </div>

      {/* Soul cost split bar */}
      {count > 0 ? (
        <>
          <div
            style={{
              height: 6,
              borderRadius: 4,
              overflow: "hidden",
              background: "rgba(255,255,255,0.08)",
              display: "flex",
            }}
          >
            {split.gun > 0 && (
              <div
                style={{ flex: split.gun, background: COLORS.gun.solid }}
                title={`Gun: ${fmt(split.gun)}`}
              />
            )}
            {split.vitality > 0 && (
              <div
                style={{ flex: split.vitality, background: COLORS.vitality.solid }}
                title={`Vitality: ${fmt(split.vitality)}`}
              />
            )}
            {split.spirit > 0 && (
              <div
                style={{ flex: split.spirit, background: COLORS.spirit.solid }}
                title={`Spirit: ${fmt(split.spirit)}`}
              />
            )}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              opacity: 0.7,
            }}
          >
            <span>◈ {fmt(totalCost)} souls</span>
            <span style={{ display: "flex", gap: 8 }}>
              {split.gun > 0 && (
                <span style={{ color: COLORS.gun.solid }}>{fmt(split.gun)}</span>
              )}
              {split.vitality > 0 && (
                <span style={{ color: COLORS.vitality.solid }}>{fmt(split.vitality)}</span>
              )}
              {split.spirit > 0 && (
                <span style={{ color: COLORS.spirit.solid }}>{fmt(split.spirit)}</span>
              )}
            </span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.4, fontStyle: "italic" }}>
          Use ★ buttons in the build list to mark items as active
        </div>
      )}
    </section>
  );
}
