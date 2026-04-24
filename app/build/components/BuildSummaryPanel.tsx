"use client";

import { useState } from "react";
import type { Item, ItemAssignment } from "@/lib/items";
import type { CategoryBonus } from "@/lib/categoryBonuses";
import { isApproachingSignificantBonus } from "@/lib/categoryBonuses";
import { detectAntiSynergies } from "@/lib/scoring/antiSynergy";
import {
  calculateDamageSplit,
  calculateTotalCost,
  getActiveItems,
  getPlanItems,
} from "@/lib/buildCalculations";
import { ActiveItemsGrid } from "./ActiveItemsGrid";

const COLORS = {
  spirit: { solid: "#7c3aed", label: "Spirit" },
  gun: { solid: "#ea580c", label: "Gun" },
  vitality: { solid: "#16a34a", label: "Vitality" },
} as const;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

type CategoryKey = "gun" | "vitality" | "spirit";

type BonusRowProps = {
  label: string;
  souls: number;
  bonus: CategoryBonus | null;
  toNextTier: number | null;
  color: string;
  getBonusValue: (b: CategoryBonus) => string;
};

function BonusRow({ label, souls, bonus, toNextTier, color, getBonusValue }: BonusRowProps) {
  const approaching = isApproachingSignificantBonus(souls);
  const atSignificant = bonus?.isSignificant === true || (bonus !== null && souls >= 4800);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${color}33`,
        background: `${color}0a`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
        {bonus ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: atSignificant ? "#facc15" : "rgba(255,255,255,0.85)",
            }}
          >
            {atSignificant ? "★ " : ""}
            {getBonusValue(bonus)}
          </span>
        ) : (
          <span style={{ fontSize: 12, opacity: 0.4 }}>No bonus yet</span>
        )}
      </div>

      {approaching ? (
        <div style={{ fontSize: 11, color: "#facc15", fontWeight: 600 }}>
          {fmt(toNextTier ?? 0)} souls to +49% bonus!
        </div>
      ) : toNextTier !== null && !atSignificant ? (
        <div style={{ fontSize: 11, opacity: 0.45 }}>{fmt(toNextTier)} to next tier</div>
      ) : null}
    </div>
  );
}

const BONUS_META: Record<
  CategoryKey,
  { label: string; color: string; getBonusValue: (b: CategoryBonus) => string }
> = {
  gun: {
    label: "Weapon",
    color: COLORS.gun.solid,
    getBonusValue: (b) => `+${b.weaponDamagePercent}% Weapon Damage`,
  },
  vitality: {
    label: "Vitality",
    color: COLORS.vitality.solid,
    getBonusValue: (b) => `+${b.healthBonus}% Max Health`,
  },
  spirit: {
    label: "Spirit",
    color: COLORS.spirit.solid,
    getBonusValue: (b) => `+${b.spiritPowerBonus} Spirit Power`,
  },
};

export function BuildSummaryPanel({
  selectedItems,
  suggestedBuildItems = [],
  assignments = [],
  activeError = null,
  onToggleActive,
}: {
  selectedItems: Item[];
  suggestedBuildItems?: Item[];
  assignments?: ItemAssignment[];
  activeError?: string | null;
  onToggleActive?: (itemId: string) => void;
}) {
  const [mode, setMode] = useState<"active" | "plan">("plan");

  const allBuildItems = [...selectedItems, ...suggestedBuildItems];

  const displayItems =
    mode === "active"
      ? getActiveItems(allBuildItems, assignments)
      : getPlanItems(allBuildItems, assignments);

  const split = calculateDamageSplit(displayItems);
  const totalCost = calculateTotalCost(displayItems);
  const hasItems = displayItems.length > 0;

  const antiSynergies = detectAntiSynergies(allBuildItems);

  const bonusRows: {
    key: CategoryKey;
    souls: number;
    bonus: CategoryBonus | null;
    toNextTier: number | null;
  }[] = [
    { key: "gun", souls: split.gun, bonus: split.gunBonus, toNextTier: split.gunToNextTier },
    {
      key: "vitality",
      souls: split.vitality,
      bonus: split.vitalityBonus,
      toNextTier: split.vitalityToNextTier,
    },
    {
      key: "spirit",
      souls: split.spirit,
      bonus: split.spiritBonus,
      toNextTier: split.spiritToNextTier,
    },
  ];

  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Active Items Grid */}
      {onToggleActive ? (
        <ActiveItemsGrid
          allItems={allBuildItems}
          assignments={assignments}
          activeError={activeError}
          onToggleActive={onToggleActive}
        />
      ) : null}

      {/* Mode toggle */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 3,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {(["plan", "active"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              flex: 1,
              padding: "5px 8px",
              borderRadius: 6,
              border: "none",
              background: mode === m ? "rgba(255,255,255,0.12)" : "transparent",
              color: "inherit",
              fontSize: 12,
              fontWeight: mode === m ? 700 : 400,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {m === "plan" ? "Full Plan" : "Active Build"}
          </button>
        ))}
      </div>

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

      {/* Section 2: Category Investment Bonuses */}
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
          Investment Bonuses
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {bonusRows.map(({ key, souls, bonus, toNextTier }) => {
            const meta = BONUS_META[key];
            return (
              <BonusRow
                key={key}
                label={meta.label}
                souls={souls}
                bonus={bonus}
                toNextTier={toNextTier}
                color={meta.color}
                getBonusValue={meta.getBonusValue}
              />
            );
          })}
        </div>
      </section>

      {/* Section 3: Anti-synergy warnings */}
      {antiSynergies.length > 0 && (
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#f97316",
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 10,
            }}
          >
            Conflicts Detected
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {antiSynergies.map(({ itemIds, reason }) => (
              <div
                key={itemIds.join("+")}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(249,115,22,0.35)",
                  background: "rgba(249,115,22,0.08)",
                  fontSize: 12,
                  color: "#fdba74",
                  lineHeight: 1.4,
                }}
              >
                <span style={{ fontWeight: 700 }}>
                  {itemIds[0]} + {itemIds[1]}:
                </span>{" "}
                {reason}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 4: Total Soul Cost */}
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
