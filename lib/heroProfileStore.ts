// Server-side loader for the roster profile (Milestone O.4). Fetches the
// filtered roster's stats and kits, accuracy, rank tiers and the CDR ladder's
// live items, then ranks through the pure lib/heroProfile modules. Every fetch
// is cached hourly by the underlying helpers; nothing here is a scoring input.

import { unstable_rethrow } from "next/navigation";
import { fetchHeroAbilityItems } from "@/lib/api/deadlockApi";
import type { RankTierRaw } from "@/lib/api/analyticsApi";
import { getHeroAccuracy, getRankTiers, type HeroAccuracy } from "@/lib/analyticsStore";
import { fetchHeroById, fetchVisibleHeroesEnriched } from "@/lib/heroApi";
import type { HeroBaseStats } from "@/lib/heroStats";
import { getItems } from "@/lib/itemStore";
import { kitAtT3, type AbilityT3 } from "@/lib/heroProfile/abilities";
import { rankAbilities } from "@/lib/heroProfile/abilityRanks";
import { cdrLadder, type CdrSetup } from "@/lib/heroProfile/cdr";
import { rankRoster } from "@/lib/heroProfile/profile";
import { heroRankView, type HeroRankView } from "@/lib/heroProfile/view";
import { compareRows, type CompareHero, type CompareRow } from "@/lib/heroProfile/compare";

export type RosterProfileInputs = {
  roster: HeroBaseStats[];
  /** Hero id -> kit at T3, slot order. A hero whose kit failed to load is absent. */
  kits: Map<number, AbilityT3[]>;
  accuracy: Map<number, HeroAccuracy>;
  /** Rank tiers with accuracy data (tier > 0), for the picker. */
  rankTiers: RankTierRaw[];
  cdrSetups: CdrSetup[];
  /** Name and small icon per roster hero, for the compare table. */
  heroes: CompareHero[];
};

async function loadKit(heroId: number): Promise<AbilityT3[] | null> {
  try {
    const [detail, abilitiesRaw] = await Promise.all([
      fetchHeroById(heroId),
      fetchHeroAbilityItems(heroId),
    ]);
    const kit = kitAtT3(heroId, abilitiesRaw, detail.items);
    return kit.length > 0 ? kit : null;
  } catch (err) {
    unstable_rethrow(err);
    // Fail open: this hero's kit metrics show as unknown, never as 0.
    console.error(`[heroProfileStore] kit for hero ${heroId}:`, err);
    return null;
  }
}

/** Everything the roster profile ranks on. */
export async function getRosterProfileInputs(): Promise<RosterProfileInputs> {
  const [heroes, accuracy, tiers, items] = await Promise.all([
    fetchVisibleHeroesEnriched(),
    getHeroAccuracy(),
    getRankTiers(),
    getItems(),
  ]);
  const roster = heroes.flatMap((h) => (h.baseStats ? [h.baseStats] : []));
  const heroList: CompareHero[] = heroes
    .filter((h) => h.baseStats)
    .map((h) => ({
      id: h.id,
      name: h.name,
      icon: h.images?.icon_image_small_webp ?? h.images?.icon_image_small ?? null,
    }));
  const kitList = await Promise.all(roster.map((s) => loadKit(s.heroId)));
  const kits = new Map<number, AbilityT3[]>();
  roster.forEach((s, i) => {
    const kit = kitList[i];
    if (kit) kits.set(s.heroId, kit);
  });

  const ladder = cdrLadder(items);
  if (ladder.missing.length > 0) {
    console.warn(
      `[heroProfileStore] CDR ladder items missing from live data, setups dropped: ${ladder.missing.join(", ")}`,
    );
  }

  return {
    roster,
    heroes: heroList,
    kits,
    accuracy,
    rankTiers: tiers.filter((t) => t.tier > 0).sort((a, b) => a.tier - b.tier),
    cdrSetups: ladder.setups,
  };
}

/** Ranks the roster at `rankTier` and returns one hero's view. Null = hero not in the roster. */
export function heroRankViewFrom(
  inputs: RosterProfileInputs,
  heroId: number,
  rankTier: number | null,
): HeroRankView | null {
  const profiles = rankRoster({
    roster: inputs.roster,
    accuracy: inputs.accuracy,
    rankTier,
    kits: inputs.kits,
  });
  const abilities = rankAbilities({
    kits: inputs.roster.flatMap((stats) => {
      const kit = inputs.kits.get(stats.heroId);
      return kit ? [{ heroId: stats.heroId, stats, abilities: kit }] : [];
    }),
    accuracy: inputs.accuracy,
    rankTier,
    cdrSetups: inputs.cdrSetups,
  });
  return heroRankView({
    heroId,
    profiles,
    abilities,
    abilityOrder: (inputs.kits.get(heroId) ?? []).map((a) => a.classname),
    cdrSetups: inputs.cdrSetups,
    rankTier,
  });
}

/** Every roster hero ranked at `rankTier`, as compare-table rows (O.5). */
export function rosterCompareFrom(
  inputs: RosterProfileInputs,
  rankTier: number | null,
): CompareRow[] {
  const profiles = rankRoster({
    roster: inputs.roster,
    accuracy: inputs.accuracy,
    rankTier,
    kits: inputs.kits,
  });
  return compareRows(profiles, inputs.heroes);
}
