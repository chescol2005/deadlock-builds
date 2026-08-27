import type { PhaseCard } from "@/app/guide/components/PhaseTimeline";
import { getAbilityUnlockOrder } from "@/lib/boonSystem";

const UNLOCK_LABELS = ["First Ability", "Second Ability", "Third Ability", "Ultimate"] as const;

// Presentation copy for the new-player view, derived from boonSystem.ts's
// ABILITY_SLOT_UNLOCK_SOULS rather than re-hardcoding the soul thresholds —
// that table is the single source of truth, shared with the build planner.
export const BOON_PHASE_CARDS: PhaseCard[] = getAbilityUnlockOrder().map((unlock, i) => ({
  phase: UNLOCK_LABELS[i],
  timeRange: `${unlock.souls.toLocaleString()} souls`,
  tip: unlock.isUltimate
    ? "Your ultimate unlocks once your hero has earned 3,800 total souls — the single biggest power spike in the match. Track your net worth against this number, not the game clock."
    : `Unlocks your ${UNLOCK_LABELS[i].toLowerCase()} slot. This triggers off your hero's total souls earned, not souls spent on items — you don't need to buy anything to hit it.`,
  available: unlock.isUltimate ? ["Ultimate"] : ["Ability Slot"],
}));

export const BOON_PILL_COLORS: Record<string, string> = {
  "Ability Slot": "text-amber-400 border-amber-500",
  Ultimate: "text-purple-400 border-purple-500",
};
