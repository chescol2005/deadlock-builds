import type { Item, ItemCategory, ItemDestination, ItemPhase } from "@/lib/items";

export const CATEGORY_META: Record<
  ItemCategory,
  { label: string; solid: string; accentSoft: string }
> = {
  gun: { label: "Gun", solid: "#ea580c", accentSoft: "rgba(234,88,12,0.08)" },
  vitality: { label: "Vitality", solid: "#16a34a", accentSoft: "rgba(22,163,74,0.08)" },
  spirit: { label: "Spirit", solid: "#7c3aed", accentSoft: "rgba(124,58,237,0.08)" },
};

export const PHASE_META: Record<ItemPhase, { label: string; accent: string; bg: string }> = {
  early: { label: "Early Game", accent: "#eab308", bg: "rgba(234,179,8,0.08)" },
  mid: { label: "Mid Game", accent: "#3b82f6", bg: "rgba(59,130,246,0.08)" },
  late: { label: "Late Game", accent: "#ef4444", bg: "rgba(239,68,68,0.08)" },
};

export function accentFor(item: Item): string {
  return CATEGORY_META[item.category]?.solid ?? "#7c3aed";
}

// Only phase zones are valid drag destinations now
const FIXED_ZONE_MAP: Record<string, ItemDestination> = {
  "zone-phase-early": { type: "phase", phase: "early" },
  "zone-phase-mid": { type: "phase", phase: "mid" },
  "zone-phase-late": { type: "phase", phase: "late" },
};

export function getFixedDestination(overId: string): ItemDestination | null {
  return FIXED_ZONE_MAP[overId] ?? null;
}
