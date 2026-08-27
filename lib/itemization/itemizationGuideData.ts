import type { PhaseCard } from "@/app/guide/components/PhaseTimeline";
import { SELL_REFUND_RATE } from "@/lib/buildCalculations";
import { MAX_ACTIVE_ITEMS } from "@/lib/buildUtils";
import { TIER_POINT_COSTS } from "@/lib/abilityCoefficients";

const refundPercent = Math.round(SELL_REFUND_RATE * 100);

// Concept-based cards rather than time-based — itemization doesn't have a
// laning-style clock, so `timeRange` doubles as a short category badge here.
export const ITEMIZATION_PHASE_CARDS: PhaseCard[] = [
  {
    phase: "Three Categories",
    timeRange: "Weapon / Vitality / Spirit",
    tip: "Weapon items boost your gun damage, Vitality boosts survivability, Spirit boosts ability power. Most builds mix all three — check what's already strong on your hero before stacking more of it.",
    available: ["Weapon", "Vitality", "Spirit"],
  },
  {
    phase: "Four Tiers",
    timeRange: "Tier 1 – 4",
    tip: "Items get stronger — and pricier — as you go up in tier. Don't rush a tier 4 item early; a full set of tier 2s usually covers more gaps than one expensive tier 4.",
    available: ["Tiers"],
  },
  {
    phase: "Components & Upgrades",
    timeRange: "Build up",
    tip: "Some items are components that combine into a stronger upgrade later. Buying the component still gives you its stats immediately — you're not wasting souls while you save for the upgrade.",
    available: ["Components"],
  },
  {
    phase: "Active Slots",
    timeRange: `${MAX_ACTIVE_ITEMS} max`,
    tip: `You can carry ${MAX_ACTIVE_ITEMS} active items into a match at once. Plan for more than that — mark your top ${MAX_ACTIVE_ITEMS} as active and keep the rest as backup for whatever the enemy team is playing.`,
    available: ["Active Build"],
  },
  {
    phase: "Selling",
    timeRange: `${refundPercent}% refund`,
    tip: `Selling refunds ${refundPercent}% of an item's cost. It isn't a punishment — respeccing a bad buy for half price is almost always better than playing the rest of the match with dead stats.`,
    available: ["Sell Priority"],
  },
  {
    phase: "Ability Upgrades",
    timeRange: TIER_POINT_COSTS.join(" / ") + " points",
    tip: `Each ability has three upgrade tiers costing ${TIER_POINT_COSTS.join(", ")} ability points in order. Boon levels hand you ability points automatically as you earn souls — see the Boons guide.`,
    available: ["Abilities"],
  },
];

export const ITEMIZATION_PILL_COLORS: Record<string, string> = {
  Weapon: "text-orange-400 border-orange-400",
  Vitality: "text-green-400 border-green-500",
  Spirit: "text-purple-400 border-purple-500",
  Tiers: "text-amber-400 border-amber-500",
  Components: "text-zinc-300 border-zinc-500",
  "Active Build": "text-amber-400 border-amber-500",
  "Sell Priority": "text-red-400 border-red-500",
  Abilities: "text-sky-400 border-sky-500",
};
