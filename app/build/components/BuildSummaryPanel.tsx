import type { ShopItem } from "@/lib/deadlock";
import {
  calculateDamageSplit,
  calculateStatTotals,
  calculateTotalCost,
} from "@/lib/buildCalculations";

const COLORS = {
  spirit: { solid: "#7c3aed", label: "Spirit" },
  gun: { solid: "#ea580c", label: "Gun" },
  vitality: { solid: "#16a34a", label: "Vitality" },
} as const;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function BuildSummaryPanel({ selectedItems }: { selectedItems: ShopItem[] }) {
  const split = calculateDamageSplit(selectedItems);
  const stats = calculateStatTotals(selectedItems);
  const totalCost = calculateTotalCost(selectedItems);
  const hasItems = selectedItems.length > 0;

  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Section 1: Soul Cost Split Bar */}
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
          Soul Cost Split
        </div>

        <div
          style={{
            height: 20,
            borderRadius: 6,
            overflow: "hidden",
            background: "rgba(255,255,255,0.08)",
            display: "flex",
          }}
        >
          {hasItems && split.total > 0 ? (
            <>
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
            </>
          ) : null}
        </div>

        {!hasItems ? (
          <div style={{ marginTop: 8, opacity: 0.45, fontSize: 12 }}>No items selected</div>
        ) : (
          <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            <span style={{ color: COLORS.spirit.solid }}>Spirit: {fmt(split.spirit)}</span>
            <span style={{ color: COLORS.gun.solid }}>Gun: {fmt(split.gun)}</span>
            <span style={{ color: COLORS.vitality.solid }}>Vitality: {fmt(split.vitality)}</span>
          </div>
        )}
      </section>

      {/* Section 2: Stat Totals */}
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
          Stat Contributions
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {(["spirit", "gun", "vitality"] as const).map((cat) => (
            <div
              key={cat}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: 8,
                border: `1px solid ${COLORS[cat].solid}40`,
                background: `${COLORS[cat].solid}12`,
              }}
            >
              <span style={{ color: COLORS[cat].solid, fontWeight: 700, fontSize: 13 }}>
                {COLORS[cat].label}
              </span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{fmt(stats[cat])}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: Total Soul Cost */}
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
          Total Build Cost
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.05)",
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>◈</span>
          <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: -0.5 }}>
            {fmt(totalCost)}
          </span>
        </div>
      </section>
    </aside>
  );
}
