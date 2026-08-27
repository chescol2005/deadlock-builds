"use client";

import type { DamageSplit } from "@/lib/buildCalculations";

const COLORS = {
  spirit: { solid: "#7c3aed", label: "Spirit" },
  gun: { solid: "#ea580c", label: "Gun" },
  vitality: { solid: "#16a34a", label: "Vitality" },
} as const;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export interface SoulSplitBarProps {
  split: DamageSplit;
  /** Bar thickness in px. Defaults to 20 (BuildSummaryPanel's size). */
  height?: number;
  /** Bar corner radius in px. Defaults to 6 (BuildSummaryPanel's size). */
  borderRadius?: number;
}

/**
 * Row of colored bar segments (Gun / Vitality / Spirit) showing the soul-cost
 * split across categories, with native title= tooltips per segment. This is
 * a purely mechanical/chrome tooltip (documented exception, see FlagButtons.tsx),
 * not converted to the shared Tooltip component.
 */
export function SoulSplitBar({ split, height = 20, borderRadius = 6 }: SoulSplitBarProps) {
  return (
    <div
      style={{
        height,
        borderRadius,
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
  );
}
