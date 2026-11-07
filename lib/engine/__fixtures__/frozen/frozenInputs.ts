// lib/engine/__fixtures__/frozen/frozenInputs.ts — a pinned snapshot of the live
// inputs the hero basket reads, so the baseline baskets (baselines.ts) run offline
// and never move with the API. Item scoring review, PR R1
// (docs/item-scoring-review.md §2.1).
//
// Raw API shapes are kept wherever a scoring fix could change how they are read:
// items go through normalizeItem, hero abilities through mapHeroAbilities, exactly
// as the planner does. Base stats, analytics and accuracy are stored as parsed.
// Written by `npm run capture-inputs` (src/scripts/captureInputs.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HeroAbilityRaw, UpgradeV2Raw } from "../../../api/deadlockApi";
import type { HeroAccuracy, ItemAnalytics } from "../../../analyticsStore";
import { mapHeroAbilities } from "../../../abilityCoefficients";
import type { HeroAbility } from "../../../abilityCoefficients";
import { HERO_PROFILE_STAT_DEFAULTS, type HeroBaseStats } from "../../../heroStats";
import { deriveUpgradesInto } from "../../../itemStore";
import { normalizeItem } from "../../../itemNormalizer";
import type { Item } from "../../../items";
import type { PairLiftTable } from "../../pairLift";
import type { CategorySplitTable } from "../../categorySplit";
import type { PhaseItemsTable } from "../../phaseItems";

export const FROZEN_DIR = join(process.cwd(), "lib/engine/__fixtures__/frozen");
export const FROZEN_ITEMS_FILE = join(FROZEN_DIR, "items.json");
export const FROZEN_INPUTS_FILE = join(FROZEN_DIR, "inputs.json");

export interface FrozenHero {
  id: number;
  name: string;
  /** `items` from the hero detail: slot → ability class name. */
  heroItems: Record<string, string>;
  /** Signature and ultimate abilities, raw. */
  abilitiesRaw: HeroAbilityRaw[];
  baseStats: HeroBaseStats;
}

export interface FrozenInputsFile {
  version: 1;
  captured: string;
  /** The game patch live at capture (latest forum changelog entry). */
  patch: string;
  heroes: FrozenHero[];
  /** Every visible hero's base stats: the need vector's roster baseline. */
  roster: HeroBaseStats[];
  itemAnalytics: ItemAnalytics[];
  heroAccuracy: Array<Omit<HeroAccuracy, "byRankTier"> & { byRankTier: Array<[number, number]> }>;
  tables: {
    pairLift: PairLiftTable;
    categorySplit: CategorySplitTable;
    phaseItems: PhaseItemsTable;
  };
}

export interface FrozenKit {
  id: number;
  name: string;
  heroAbilities: HeroAbility[];
  heroBaseStats: HeroBaseStats;
}

export interface FrozenData {
  captured: string;
  patch: string;
  allItems: Item[];
  kits: FrozenKit[];
  roster: HeroBaseStats[];
  itemAnalytics: Map<number, ItemAnalytics>;
  heroAccuracy: Map<number, HeroAccuracy>;
  tables: FrozenInputsFile["tables"];
}

export const FROZEN_ABILITY_ROSTER_FILE = join(FROZEN_DIR, "abilityRoster.json");

/**
 * Every visible hero's raw kit and fresh base stats, for the roster profile's
 * ability ranks and resist anchors (Milestone O §7.1). A separate file so
 * inputs.json and the engine baselines never move with it. Written by
 * `npm run capture-inputs -- --ability-roster`.
 */
export interface FrozenAbilityRosterFile {
  version: 1;
  captured: string;
  patch: string;
  heroes: FrozenHero[];
}

/** The ability roster snapshot, with base stats backfilled like loadFrozen. */
export function loadFrozenAbilityRoster(): FrozenAbilityRosterFile {
  const file = JSON.parse(
    readFileSync(FROZEN_ABILITY_ROSTER_FILE, "utf-8"),
  ) as FrozenAbilityRosterFile;
  return {
    ...file,
    heroes: file.heroes.map((h) => ({
      ...h,
      baseStats: { ...HERO_PROFILE_STAT_DEFAULTS, ...h.baseStats },
    })),
  };
}

/** Rebuilds the planner's inputs from the snapshot, through the app's own parsers. */
export function loadFrozen(): FrozenData {
  const rawItems = JSON.parse(readFileSync(FROZEN_ITEMS_FILE, "utf-8")) as UpgradeV2Raw[];
  const file = JSON.parse(readFileSync(FROZEN_INPUTS_FILE, "utf-8")) as FrozenInputsFile;
  return {
    captured: file.captured,
    patch: file.patch,
    allItems: deriveUpgradesInto(rawItems.map(normalizeItem)),
    kits: file.heroes.map((h) => ({
      id: h.id,
      name: h.name,
      heroAbilities: mapHeroAbilities(h.abilitiesRaw, h.heroItems),
      heroBaseStats: { ...HERO_PROFILE_STAT_DEFAULTS, ...h.baseStats },
    })),
    // Captured before Milestone O added its stat fields: backfill 0 (see HERO_PROFILE_STAT_DEFAULTS).
    roster: file.roster.map((s) => ({ ...HERO_PROFILE_STAT_DEFAULTS, ...s })),
    itemAnalytics: new Map(file.itemAnalytics.map((a) => [a.itemId, a])),
    heroAccuracy: new Map(
      file.heroAccuracy.map((a) => [a.heroId, { ...a, byRankTier: new Map(a.byRankTier) }]),
    ),
    tables: file.tables,
  };
}
