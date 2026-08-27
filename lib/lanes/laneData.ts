import type { PhaseCard } from "@/app/guide/components/PhaseTimeline";
import { MINIMAP_URL } from "@/lib/farming/campData";

// All values verified against deadlock.wiki (Guardian, Walker, Patron, Trooper,
// Mechanics, Strategy) 2026-07-21. Where the wiki is silent or conflicting we
// leave the field null rather than guess — see note per entry.
export interface LaneStructureDef {
  id: string;
  name: string;
  hp: number | null;
  soulReward: number | null;
  note: string;
}

export const LANE_STRUCTURES: LaneStructureDef[] = [
  {
    id: "guardian",
    name: "Guardian",
    hp: 5500,
    soulReward: 1250,
    note: "Outermost structure per lane. Invulnerable unless an enemy trooper or hero is within 24m — no rush to solo one down.",
  },
  {
    id: "walker",
    name: "Walker",
    hp: 6000,
    soulReward: 3500,
    note: "HP scales up as allied Walkers fall (6,000 → 9,000 → 12,000, healing on each loss), so the first one is always the easiest. Destroying it grants your whole team a bonus item slot. Invulnerable unless an enemy is within 22m, plus 65% backdoor damage reduction before the lane has pushed to it.",
  },
  {
    id: "base_guardian",
    name: "Base Guardian",
    hp: 4000,
    soulReward: null,
    note: "Pair guarding each base in front of the Shrines. HP figure is not consistently documented — treat as approximate.",
  },
  {
    id: "patron",
    name: "Patron",
    hp: 12000,
    soulReward: null,
    note: "The win condition, one per base. Regenerates 120 HP/s — only commit with your team ready to burst it down, not poke it.",
  },
];

// Trooper wave spawn cadence speeds up twice over the course of a match.
export interface TrooperWaveInterval {
  fromMin: number;
  toMin: number | null;
  intervalSeconds: number;
}

export const TROOPER_WAVE_INTERVALS: TrooperWaveInterval[] = [
  { fromMin: 0, toMin: 20, intervalSeconds: 30 },
  { fromMin: 20, toMin: 35, intervalSeconds: 25 },
  { fromMin: 35, toMin: null, intervalSeconds: 20 },
];

export interface LaneDef {
  id: string;
  name: string;
  colorLabel: string;
}

// Deadlock is a 2-2-2 duo-lane setup across three lanes, not a 1v1/open jungle.
export const LANES: LaneDef[] = [
  { id: "york", name: "York", colorLabel: "Yellow" },
  { id: "broadway", name: "Broadway", colorLabel: "Blue" },
  { id: "park", name: "Park / Greenwich", colorLabel: "Green" },
];

export const LANE_PHASE_CARDS: PhaseCard[] = [
  {
    phase: "Laning",
    timeRange: "0 – 6 min",
    tip: "Deadlock runs a 2-2-2 duo setup across three lanes. Stay with your lane partner, farm the wave, and deny your own dying troopers when you can't hold the wave — it stops the enemy from banking those souls.",
    available: ["Troopers", "Deny"],
  },
  {
    phase: "First Rotation",
    timeRange: "6 – 10 min",
    tip: "Leave lane right after you secure a wave, not mid-fight for one, and come back before the next wave lands. Guardians only take damage while an enemy is standing in range, so group up before committing to one.",
    available: ["Guardians"],
  },
  {
    phase: "Breaking Walkers",
    timeRange: "10 – 20 min",
    tip: "Walkers get tankier and heal every time an allied Walker falls, so focus the first one as a team — it's the cheapest. Knocking one down hands your whole team a bonus item slot.",
    available: ["Walkers"],
  },
  {
    phase: "Closing It Out",
    timeRange: "20+ min",
    tip: "Wave spawns speed up as the match goes on, so an idle lane keeps pushing itself. The Patron regenerates fast — only dive it with your team ready to burst it down.",
    available: ["Patron"],
  },
];

export const LANE_PILL_COLORS: Record<string, string> = {
  Troopers: "text-orange-400 border-orange-400",
  Deny: "text-zinc-300 border-zinc-500",
  Guardians: "text-sky-400 border-sky-500",
  Walkers: "text-indigo-400 border-indigo-500",
  Patron: "text-red-400 border-red-500",
};

// Alias for minimap URL (canonical location: lib/farming/campData.ts)
export const LANE_MINIMAP_URL = MINIMAP_URL;

export interface LaneMinimapMarkerDef {
  structureId: string;
  laneId: string;
  side: "enemy" | "friendly";
  left: number;
  top: number;
}

// ⚠️ TWEAK_ME: all positions approximated — the API gives no structure
// coordinates. Enemy side is top (y<50), friendly side is bottom (y>50),
// mirrored across the three lanes. Francesco will tune after first render.
export const LANE_MINIMAP_MARKERS: LaneMinimapMarkerDef[] = [
  // York (left lane)
  { structureId: "guardian", laneId: "york", side: "enemy", left: 18, top: 22 },
  { structureId: "walker", laneId: "york", side: "enemy", left: 18, top: 33 },
  { structureId: "walker", laneId: "york", side: "friendly", left: 18, top: 67 },
  { structureId: "guardian", laneId: "york", side: "friendly", left: 18, top: 78 },

  // Broadway (mid lane)
  { structureId: "guardian", laneId: "broadway", side: "enemy", left: 50, top: 15 },
  { structureId: "walker", laneId: "broadway", side: "enemy", left: 50, top: 28 },
  { structureId: "walker", laneId: "broadway", side: "friendly", left: 50, top: 72 },
  { structureId: "guardian", laneId: "broadway", side: "friendly", left: 50, top: 85 },

  // Park / Greenwich (right lane)
  { structureId: "guardian", laneId: "park", side: "enemy", left: 82, top: 22 },
  { structureId: "walker", laneId: "park", side: "enemy", left: 82, top: 33 },
  { structureId: "walker", laneId: "park", side: "friendly", left: 82, top: 67 },
  { structureId: "guardian", laneId: "park", side: "friendly", left: 82, top: 78 },

  // Patrons
  { structureId: "patron", laneId: "broadway", side: "enemy", left: 50, top: 6 },
  { structureId: "patron", laneId: "broadway", side: "friendly", left: 50, top: 94 },
];

export const STRUCTURE_MARKER_COLORS: Record<string, string> = {
  guardian: "#38bdf8",
  walker: "#6366f1",
  base_guardian: "#38bdf8",
  patron: "#dc2626",
};
