import type { PhaseCard } from "@/app/guide/components/PhaseTimeline";

export interface CampDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | null;
  firstSpawnMin: number;
  respawnSeconds: number;
  soulBase: number;
  soulPerMin: number;
  dropChance?: number;
}

export const CAMPS: CampDef[] = [
  {
    id: "small_denizen",
    name: "Small Camp",
    tier: 1,
    firstSpawnMin: 2,
    respawnSeconds: 85,
    soulBase: 41,
    soulPerMin: 0.44,
  },
  {
    id: "medium_denizen",
    name: "Medium Camp",
    tier: 2,
    firstSpawnMin: 6,
    respawnSeconds: 290,
    soulBase: 68,
    soulPerMin: 0.73,
  },
  {
    id: "large_denizen",
    name: "Hard Camp",
    tier: 3,
    firstSpawnMin: 8,
    respawnSeconds: 335,
    soulBase: 181,
    soulPerMin: 1.95,
  },
  {
    id: "sinners_sacrifice",
    name: "Sinner's Sacrifice",
    tier: null,
    firstSpawnMin: 8,
    respawnSeconds: 300,
    soulBase: 310,
    soulPerMin: 3.35,
  },
  {
    id: "crate",
    name: "Crate",
    tier: null,
    firstSpawnMin: 2,
    respawnSeconds: 180,
    soulBase: 23,
    soulPerMin: 2.0,
    dropChance: 0.6,
  },
];

export function soulsAt(camp: CampDef, gameMinute: number): number | null {
  if (gameMinute < camp.firstSpawnMin) return null;
  return Math.round(camp.soulBase + camp.soulPerMin * gameMinute);
}

// Efficiency: souls earned per minute of respawn cycle, evaluated at gameMinute
// Default 20min is a representative midgame snapshot
export function soulsPerMinEfficiency(camp: CampDef, gameMinute: number = 20): number {
  const souls = soulsAt(camp, gameMinute);
  if (souls === null) return 0;
  return Math.round((souls / camp.respawnSeconds) * 60);
}

export const GAME_MINUTE_COLUMNS = [5, 10, 15, 20, 25, 30] as const;
export type GameMinuteColumn = (typeof GAME_MINUTE_COLUMNS)[number];

export const MINIMAP_URL =
  "https://assets-bucket.deadlock-api.com/assets-api-res/images/maps/minimap.png";

// Camp marker positions as % of minimap image dimensions.
// ⚠️ TWEAK_ME: adjust left/top values after first visual render.
// Francesco will review and tune these after seeing the first render.
export interface CampMarker {
  campId: string;
  label: string;
  left: number;
  top: number;
}

// ⚠️ TWEAK_ME: all positions approximated from annotated minimap image.
// Map is divided horizontally: enemy side (top, y<48%) / friendly side (bottom, y>48%).
// SS split: friendly cluster left (x≈30-37%), enemy cluster right (x≈57-65%).
export const CAMP_MARKERS: CampMarker[] = [
  // ── Small camps (△, 4 total — 2 per side) ───────────────────────────────
  { campId: "small_denizen", label: "S", left: 21, top: 34 }, // enemy left
  { campId: "small_denizen", label: "S", left: 76, top: 30 }, // enemy right
  { campId: "small_denizen", label: "S", left: 21, top: 62 }, // friendly left
  { campId: "small_denizen", label: "S", left: 77, top: 64 }, // friendly right

  // ── Medium camps (△—, 24 total — 12 per side) ────────────────────────────
  // Enemy side (12)
  { campId: "medium_denizen", label: "M", left: 20, top: 27 },
  { campId: "medium_denizen", label: "M", left: 23, top: 37 },
  { campId: "medium_denizen", label: "M", left: 29, top: 41 },
  { campId: "medium_denizen", label: "M", left: 37, top: 38 },
  { campId: "medium_denizen", label: "M", left: 43, top: 33 },
  { campId: "medium_denizen", label: "M", left: 51, top: 28 },
  { campId: "medium_denizen", label: "M", left: 57, top: 34 },
  { campId: "medium_denizen", label: "M", left: 64, top: 38 },
  { campId: "medium_denizen", label: "M", left: 70, top: 34 },
  { campId: "medium_denizen", label: "M", left: 76, top: 27 },
  { campId: "medium_denizen", label: "M", left: 80, top: 37 },
  { campId: "medium_denizen", label: "M", left: 53, top: 42 },
  // Friendly side (12)
  { campId: "medium_denizen", label: "M", left: 22, top: 52 },
  { campId: "medium_denizen", label: "M", left: 26, top: 58 },
  { campId: "medium_denizen", label: "M", left: 31, top: 54 },
  { campId: "medium_denizen", label: "M", left: 36, top: 60 },
  { campId: "medium_denizen", label: "M", left: 42, top: 55 },
  { campId: "medium_denizen", label: "M", left: 47, top: 65 },
  { campId: "medium_denizen", label: "M", left: 53, top: 54 },
  { campId: "medium_denizen", label: "M", left: 57, top: 58 },
  { campId: "medium_denizen", label: "M", left: 62, top: 54 },
  { campId: "medium_denizen", label: "M", left: 67, top: 58 },
  { campId: "medium_denizen", label: "M", left: 74, top: 60 },
  { campId: "medium_denizen", label: "M", left: 48, top: 68 },

  // ── Hard camps (△═, 12 total — 5 enemy + 5 friendly + 2 far flanks) ─────
  // Enemy side (5)
  { campId: "large_denizen", label: "H", left: 27, top: 25 },
  { campId: "large_denizen", label: "H", left: 41, top: 30 },
  { campId: "large_denizen", label: "H", left: 60, top: 25 },
  { campId: "large_denizen", label: "H", left: 26, top: 44 },
  { campId: "large_denizen", label: "H", left: 67, top: 43 },
  // Friendly side (5)
  { campId: "large_denizen", label: "H", left: 26, top: 53 },
  { campId: "large_denizen", label: "H", left: 41, top: 59 },
  { campId: "large_denizen", label: "H", left: 50, top: 57 },
  { campId: "large_denizen", label: "H", left: 62, top: 62 },
  { campId: "large_denizen", label: "H", left: 28, top: 64 },
  // Far flanks (2)
  { campId: "large_denizen", label: "H", left: 10, top: 47 },
  { campId: "large_denizen", label: "H", left: 85, top: 46 },

  // ── Sinner's Sacrifice (⊡, 10 total — 5 left cluster / 5 right cluster) ─
  // Left cluster — friendly side (x≈30-37%)
  { campId: "sinners_sacrifice", label: "SS", left: 30, top: 43 },
  { campId: "sinners_sacrifice", label: "SS", left: 35, top: 45 },
  { campId: "sinners_sacrifice", label: "SS", left: 31, top: 49 },
  { campId: "sinners_sacrifice", label: "SS", left: 36, top: 52 },
  { campId: "sinners_sacrifice", label: "SS", left: 30, top: 55 },
  // Right cluster — enemy side (x≈57-65%)
  { campId: "sinners_sacrifice", label: "SS", left: 58, top: 43 },
  { campId: "sinners_sacrifice", label: "SS", left: 63, top: 45 },
  { campId: "sinners_sacrifice", label: "SS", left: 59, top: 49 },
  { campId: "sinners_sacrifice", label: "SS", left: 64, top: 52 },
  { campId: "sinners_sacrifice", label: "SS", left: 59, top: 55 },
];

export const MARKER_COLORS: Record<string, string> = {
  small_denizen: "#71717a",
  medium_denizen: "#f59e0b",
  large_denizen: "#f97316",
  sinners_sacrifice: "#a855f7",
  crate: "#52525b",
};

export const PHASE_CARDS: PhaseCard[] = [
  {
    phase: "Laning",
    timeRange: "0 – 6 min",
    tip: "Focus on troopers and last hits. Break any crates you walk past — they respawn every 3 minutes. Don't leave your lane to chase jungle camps yet.",
    available: ["Troopers", "Crates"],
  },
  {
    phase: "Early Jungle",
    timeRange: "6 – 10 min",
    tip: "Medium camps go live at 6:00. Hard camps and Sinner's Sacrifice spawn at 8:00. Check one on your way back from a push — never detour for it.",
    available: ["Medium Camps", "Hard Camps", "Sinner's Sacrifice"],
  },
  {
    phase: "Mid Game",
    timeRange: "10 – 20 min",
    tip: "Hard camps respawn every ~5:30. Sinner's Sacrifice every 5:00. Clear them on rotation between objective pushes — they should never be sitting idle.",
    available: ["All Camps", "Sinner's Sacrifice", "Crates"],
  },
  {
    phase: "Late Game",
    timeRange: "20 – 30 min",
    tip: "Sinner's Sacrifice is worth ~377 souls with a 5-minute respawn — treat it like a mini-objective. Crates are worth 63+ souls each at this point.",
    available: ["All Camps", "Sinner's Sacrifice", "Crates"],
  },
  {
    phase: "Very Late",
    timeRange: "30+ min",
    tip: "Every soul source has scaled significantly. Clear everything on your path to objectives. A single crate is worth 83 souls.",
    available: ["All Camps", "Sinner's Sacrifice", "Crates"],
  },
];

export const PILL_COLORS: Record<string, string> = {
  Troopers: "text-orange-400 border-orange-400",
  Crates: "text-zinc-400 border-zinc-600",
  "Small Camps": "text-zinc-300 border-zinc-500",
  "Medium Camps": "text-amber-400 border-amber-500",
  "Hard Camps": "text-orange-400 border-orange-500",
  "Sinner's Sacrifice": "text-purple-400 border-purple-500",
  "All Camps": "text-amber-400 border-amber-500",
};
