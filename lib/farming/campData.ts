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

// Verified 2026-10-25 against deadlock.wiki (Neutral_Creeps, Crates,
// Sinner's_Sacrifice) and api.deadlock-api.com/v1/assets/map, after the map /
// jungle rework (themed "haunts"; medium camps now at 5:00, crates in waves at
// 3 / 5 / 10 min, new Tough Crates). Creep souls scale +1.08% of base per minute.
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
    firstSpawnMin: 5,
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
    // Most crates spawn at 3:00; tunnel / Sunken Plaza ones at 5:00, the room
    // under the Midboss pit at 10:00 (wiki Crates).
    firstSpawnMin: 3,
    respawnSeconds: 180,
    soulBase: 23,
    soulPerMin: 2.0,
    dropChance: 0.6,
  },
  {
    // Needs a heavy melee; always drops, twice a crate's souls, scales twice as
    // fast (wiki Crates; 74 on the map, API entities.tough_crates).
    id: "tough_crate",
    name: "Tough Crate",
    tier: null,
    firstSpawnMin: 3,
    respawnSeconds: 180,
    soulBase: 46,
    soulPerMin: 4.0,
    dropChance: 1,
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

// The current map (2026-10-25): api.deadlock-api.com/v1/assets/map `images.mid`.
// The old minimap.png is the pre-rework map and no longer matches the camps.
export const MINIMAP_URL =
  "https://assets-bucket.deadlock-api.com/assets-api-res/images/maps/minimap_midtown_mid.png";

// Camp marker positions as % of the minimap image (square), from the API's
// neutral_camps[].left_relative / top_relative (x100). Regenerate them from
// /v1/assets/map when the map changes; do not hand-place.
export interface CampMarker {
  campId: string;
  label: string;
  left: number;
  top: number;
}

export const CAMP_MARKERS: CampMarker[] = [
  // Small camps (4)
  { campId: "small_denizen", label: "S", left: 79.3, top: 45.5 }, // park_club_camp
  { campId: "small_denizen", label: "S", left: 44.0, top: 45.7 }, // nw_utility_south_neutrals
  { campId: "small_denizen", label: "S", left: 56.5, top: 54.6 }, // se_utility_neutrals
  { campId: "small_denizen", label: "S", left: 16.7, top: 56.0 }, // dock_authority_camp
  // Medium camps (25)
  { campId: "medium_denizen", label: "M", left: 9.9, top: 30.2 }, // nw_bank_camp
  { campId: "medium_denizen", label: "M", left: 77.1, top: 31.5 }, // ne_theater_upstairs_camp
  { campId: "medium_denizen", label: "M", left: 72.0, top: 32.7 }, // theater_upstairs_02_camp
  { campId: "medium_denizen", label: "M", left: 65.5, top: 32.7 }, // theater_upstairs_01_camp
  { campId: "medium_denizen", label: "M", left: 67.7, top: 32.8 }, // theater_lobby_camp
  { campId: "medium_denizen", label: "M", left: 29.2, top: 38.1 }, // hq_01_camp
  { campId: "medium_denizen", label: "M", left: 38.7, top: 38.1 }, // plaza_rink_02_camp
  { campId: "medium_denizen", label: "M", left: 79.3, top: 39.7 }, // park_mansion_roof_camp
  { campId: "medium_denizen", label: "M", left: 13.0, top: 40.5 }, // construction_camp
  { campId: "medium_denizen", label: "M", left: 67.6, top: 41.4 }, // theater_stage_02_camp
  { campId: "medium_denizen", label: "M", left: 23.5, top: 42.3 }, // hq_roof_camp
  { campId: "medium_denizen", label: "M", left: 69.9, top: 45.2 }, // theater_down_camp
  { campId: "medium_denizen", label: "M", left: 59.1, top: 46.1 }, // oracle_camp
  { campId: "medium_denizen", label: "M", left: 26.6, top: 53.2 }, // slums_bodega_down_camp
  { campId: "medium_denizen", label: "M", left: 41.1, top: 54.0 }, // dept_store_camp
  { campId: "medium_denizen", label: "M", left: 34.6, top: 55.9 }, // slums_garage_down_camp
  { campId: "medium_denizen", label: "M", left: 31.4, top: 57.9 }, // slums_alley_camp
  { campId: "medium_denizen", label: "M", left: 76.5, top: 58.0 }, // park_library_roof_camp
  { campId: "medium_denizen", label: "M", left: 70.8, top: 58.9 }, // nursery_downstairs_camp
  { campId: "medium_denizen", label: "M", left: 86.9, top: 60.6 }, // park_chapel_camp
  { campId: "medium_denizen", label: "M", left: 22.9, top: 61.2 }, // slums_roof_camp
  { campId: "medium_denizen", label: "M", left: 58.9, top: 66.2 }, // chinatown_fish_neutrals
  { campId: "medium_denizen", label: "M", left: 24.4, top: 67.1 }, // sw_bodega_upstairs_camp
  { campId: "medium_denizen", label: "M", left: 29.2, top: 67.9 }, // slums_storage_camp
  { campId: "medium_denizen", label: "M", left: 87.2, top: 72.0 }, // sw_asylum_camp
  // Hard camps (11)
  { campId: "large_denizen", label: "H", left: 32.3, top: 31.3 }, // plaza_corner_camp
  { campId: "large_denizen", label: "H", left: 46.1, top: 31.8 }, // plaza_rink_03_camp
  { campId: "large_denizen", label: "H", left: 36.2, top: 38.1 }, // plaza_rink_01_camp
  { campId: "large_denizen", label: "H", left: 71.1, top: 41.4 }, // theater_stage_01_camp
  { campId: "large_denizen", label: "H", left: 7.0, top: 50.0 }, // dock_camp
  { campId: "large_denizen", label: "H", left: 92.7, top: 50.0 }, // park_gate_camp
  { campId: "large_denizen", label: "H", left: 27.1, top: 58.3 }, // basketball_camp
  { campId: "large_denizen", label: "H", left: 61.1, top: 63.0 }, // chinatown_alley_camp
  { campId: "large_denizen", label: "H", left: 64.6, top: 68.1 }, // chinatown_bell_02_camp
  { campId: "large_denizen", label: "H", left: 68.0, top: 68.6 }, // chinatown_street_camp
  { campId: "large_denizen", label: "H", left: 33.6, top: 70.4 }, // slums_warehouse_camp
  // Sinner's Sacrifice locations (11)
  { campId: "sinners_sacrifice", label: "SS", left: 39.9, top: 35.9 }, // plaza_pit_vault1
  { campId: "sinners_sacrifice", label: "SS", left: 69.3, top: 37.1 }, // theater_balcony_camp
  { campId: "sinners_sacrifice", label: "SS", left: 39.9, top: 40.3 }, // plaza_pit_vault2
  { campId: "sinners_sacrifice", label: "SS", left: 77.5, top: 43.7 }, // park_club_vault
  { campId: "sinners_sacrifice", label: "SS", left: 23.4, top: 44.3 }, // york_radio_vault
  { campId: "sinners_sacrifice", label: "SS", left: 39.7, top: 45.2 }, // hotel_01_camp
  { campId: "sinners_sacrifice", label: "SS", left: 60.3, top: 54.5 }, // drug_store_camp
  { campId: "sinners_sacrifice", label: "SS", left: 22.5, top: 55.5 }, // dock_authority_vault
  { campId: "sinners_sacrifice", label: "SS", left: 76.9, top: 55.8 }, // park_library_vault
  { campId: "sinners_sacrifice", label: "SS", left: 34.8, top: 57.4 }, // slums_garage_up_camp
  { campId: "sinners_sacrifice", label: "SS", left: 65.1, top: 58.8 }, // chinatown_bell_1
];

export const MARKER_COLORS: Record<string, string> = {
  small_denizen: "#71717a",
  medium_denizen: "#f59e0b",
  large_denizen: "#f97316",
  sinners_sacrifice: "#a855f7",
  crate: "#52525b",
  tough_crate: "#a1a1aa",
};

export const PHASE_CARDS: PhaseCard[] = [
  {
    phase: "Laning",
    timeRange: "0 – 5 min",
    tip: "Focus on troopers and last hits. Crates appear at 3:00 and respawn every 3 minutes: break any you walk past. Tough Crates need a heavy melee but always drop double souls. Don't leave your lane to chase jungle camps yet.",
    available: ["Troopers", "Crates", "Tough Crates"],
  },
  {
    phase: "Early Jungle",
    timeRange: "5 – 10 min",
    tip: "Medium camps go live at 5:00. Hard camps and Sinner's Sacrifice spawn at 8:00. Check one on your way back from a push — never detour for it.",
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
    tip: "Sinner's Sacrifice is worth ~377 souls with a 5-minute respawn — treat it like a mini-objective. Crates are worth 63+ souls each at this point, Tough Crates 126.",
    available: ["All Camps", "Sinner's Sacrifice", "Crates"],
  },
  {
    phase: "Very Late",
    timeRange: "30+ min",
    tip: "Every soul source has scaled significantly. Clear everything on your path to objectives. A single crate is worth 83 souls, a Tough Crate 166.",
    available: ["All Camps", "Sinner's Sacrifice", "Crates"],
  },
];

export const PILL_COLORS: Record<string, string> = {
  Troopers: "text-orange-400 border-orange-400",
  Crates: "text-zinc-400 border-zinc-600",
  "Tough Crates": "text-zinc-300 border-zinc-400",
  "Small Camps": "text-zinc-300 border-zinc-500",
  "Medium Camps": "text-amber-400 border-amber-500",
  "Hard Camps": "text-orange-400 border-orange-500",
  "Sinner's Sacrifice": "text-purple-400 border-purple-500",
  "All Camps": "text-amber-400 border-amber-500",
};
