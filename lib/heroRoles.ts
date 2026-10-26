// lib/heroRoles.ts — what each hero is FOR in a team (Milestone M6.0b).
//
// Hand-authored data, cited like BOON_THRESHOLDS: the role lists of high-level
// players (docs/milestone-m6.md §4), checked against measured match data
// (`npm run role-check`). The coach context reads it to explain how a hero is
// played ("you're on a carry: farm, then join fights after your first big
// item"). It is NOT a scoring input. API `tags` are flavour words and
// `hero_type` files Infernus as a marksman (G5), so neither is used.
//
// Missing data is not a guess: a hero absent from the table, or with no role
// yet, resolves to `unknown` and the coach says nothing role-specific.

export type HeroRole = "carry" | "offCarry" | "support" | "initiator" | "tank" | "hybrid";

/** Where a hero's roles come from. */
export type RoleSource =
  | "metro-roles-2026" // Metro, "Every hero's role explained" (youtube.com/watch?v=JouUab99B4Y)
  | "user"; // decided by the user against the measured check (`npm run role-check`)

export interface HeroRoleEntry {
  /** API hero name, for review; the key is the hero id. */
  name: string;
  /** Primary role first; empty = unknown (see `unknownReason`). */
  roles: ReadonlyArray<HeroRole>;
  source: RoleSource;
  unknownReason?: string;
}

/** Plain-English role names, for the coach and the UI. */
export const ROLE_LABELS: Readonly<Record<HeroRole, string>> = {
  carry: "Carry",
  offCarry: "Off-carry",
  support: "Support",
  initiator: "Initiator",
  tank: "Tank",
  hybrid: "Hybrid",
};

/**
 * How the role is played, in one line each (summarised from the two role
 * videos in docs/milestone-m6.md §9). The coach quotes these; they carry no numbers.
 */
export const ROLE_PLANS: Readonly<Record<HeroRole, string>> = {
  carry:
    "Farm a side lane and the jungle, play safe, and join team fights once your first big item makes you strong.",
  offCarry:
    "Win your lane, then pressure other lanes and fight while you are at your strongest in the mid game. Don't spend that time farming.",
  support:
    "Your abilities matter more than your items: push lanes, stay with your team and save teammates. Don't farm your carry's lane.",
  initiator:
    "Roam where the enemy can't see you and start fights by catching someone. The team that catches first usually wins.",
  tank: "Go into fights first and soak the enemy's damage so your damage dealers can work. Join every big fight.",
  hybrid:
    "Play the role your team is missing (damage, support or tank) and build for it from the start.",
};

/**
 * Cumulative souls (net worth) at which the role usually comes online and
 * should start joining fights (the videos: carries at their first big item,
 * ~20–25k; off-carries peak at ~12–15k; supports from the start). Roles with no
 * entry have no such timing and get no "power spike" tip.
 */
export const ROLE_ONLINE_AT_SOULS: Readonly<Partial<Record<HeroRole, number>>> = {
  carry: 20000,
  offCarry: 12000,
  support: 0,
};

const METRO = "metro-roles-2026" as const;

/** Keyed by API hero id. Every live hero has an entry (Fixture: hero roles). */
export const HERO_ROLES: Readonly<Record<number, HeroRoleEntry>> = {
  1: { name: "Infernus", roles: ["carry"], source: METRO },
  2: { name: "Seven", roles: ["carry"], source: METRO },
  3: { name: "Vindicta", roles: ["offCarry"], source: METRO },
  4: { name: "Lady Geist", roles: ["carry"], source: METRO },
  6: { name: "Abrams", roles: ["tank"], source: METRO },
  7: { name: "Wraith", roles: ["carry"], source: METRO },
  8: { name: "McGinnis", roles: ["hybrid"], source: METRO },
  10: { name: "Paradox", roles: ["initiator"], source: METRO },
  11: { name: "Dynamo", roles: ["support"], source: METRO },
  12: { name: "Kelvin", roles: ["support"], source: METRO },
  // Metro: "you could place Haze into a carry role", but her catch is her value.
  13: { name: "Haze", roles: ["initiator", "carry"], source: METRO },
  14: { name: "Holliday", roles: ["initiator"], source: METRO },
  // Metro: "Bebop very well place into a tank role".
  15: { name: "Bebop", roles: ["initiator", "tank"], source: METRO },
  16: { name: "Calico", roles: ["offCarry"], source: METRO },
  17: { name: "Grey Talon", roles: ["offCarry"], source: METRO },
  // Metro lists support; measured: most damage taken of all 44 heroes and average
  // mid-game net worth (every other support is #30 or lower). User, 2026-10-25.
  18: { name: "Mo & Krill", roles: ["tank", "support"], source: "user" },
  19: { name: "Shiv", roles: ["tank"], source: METRO },
  20: { name: "Ivy", roles: ["hybrid"], source: METRO },
  25: { name: "Warden", roles: ["carry"], source: METRO },
  // Metro: "you could add Yamato in here [tanks]".
  27: { name: "Yamato", roles: ["offCarry", "tank"], source: METRO },
  31: { name: "Lash", roles: ["offCarry"], source: METRO },
  35: { name: "Viscous", roles: ["hybrid"], source: METRO },
  50: { name: "Pocket", roles: ["offCarry"], source: METRO },
  52: { name: "Mirage", roles: ["carry"], source: METRO },
  58: { name: "Vyper", roles: ["offCarry"], source: METRO },
  60: { name: "Sinclair", roles: ["support"], source: METRO },
  63: { name: "Mina", roles: ["offCarry"], source: METRO },
  64: { name: "Drifter", roles: ["hybrid"], source: METRO },
  65: { name: "Venator", roles: ["carry"], source: METRO },
  66: { name: "Victor", roles: ["carry"], source: METRO },
  67: { name: "Paige", roles: ["support"], source: METRO },
  69: { name: "The Doorman", roles: ["support"], source: METRO },
  72: { name: "Billy", roles: ["tank"], source: METRO },
  76: { name: "Graves", roles: ["hybrid"], source: METRO },
  77: { name: "Apollo", roles: ["offCarry"], source: METRO },
  // Not in the role videos (released later). Measured: low mid-game net worth (#41)
  // and jungle share (26%); user chose off-carry, 2026-10-25.
  78: { name: "Deadman Danny", roles: ["offCarry"], source: "user" },
  79: { name: "Rem", roles: ["support"], source: METRO },
  80: { name: "Silver", roles: ["tank"], source: METRO },
  81: { name: "Celeste", roles: ["offCarry"], source: METRO },
  84: { name: "Rat King", roles: ["carry"], source: METRO },
  85: { name: "Solomon", roles: ["support"], source: METRO },
  86: { name: "Violet", roles: ["offCarry"], source: METRO },
  87: { name: "Nurse Harrow", roles: ["support"], source: METRO },
  88: { name: "Baba", roles: ["tank"], source: METRO },
};

/** This hero's roles, primary first; empty when unknown (never a guess). */
export function heroRolesOf(heroId: number): ReadonlyArray<HeroRole> {
  return HERO_ROLES[heroId]?.roles ?? [];
}

/** Souls at which this hero's primary role comes online; undefined = no timing. */
export function heroOnlineAtSouls(heroId: number): number | undefined {
  const primary = heroRolesOf(heroId)[0];
  return primary ? ROLE_ONLINE_AT_SOULS[primary] : undefined;
}

/** One hero's measured ranks among the table's heroes (1 = highest). */
export interface RoleRanks {
  /** Mid-game net worth rank; undefined = no data (never flagged on it). */
  netWorth?: number;
  damageTaken: number;
  damageDealt: number;
}

/**
 * Why the measured ranks contradict the PRIMARY role, or null (`npm run
 * role-check`, M6.0b). Secondary roles are expert or user calls and are not
 * checked; initiator and hybrid have no measurable signature. Off-carries fight
 * instead of farming (user, 2026-10-25), so low net worth alone is expected:
 * they flag only when they also deal little damage.
 */
export function roleFlag(
  roles: ReadonlyArray<HeroRole>,
  r: RoleRanks,
  heroes: number,
): string | null {
  const half = heroes / 2;
  const third = heroes / 3;
  const nw = r.netWorth;
  switch (roles[0]) {
    case undefined:
      return "no role listed";
    case "carry":
      return nw !== undefined && nw > half
        ? `carry in the bottom half for net worth (#${nw})`
        : null;
    case "support":
      return nw !== undefined && nw <= half
        ? `support in the top half for net worth (#${nw})`
        : null;
    case "offCarry":
      return nw !== undefined && nw > heroes - third && r.damageDealt > heroes - third
        ? `off-carry in the bottom third for net worth (#${nw}) and damage dealt (#${r.damageDealt})`
        : null;
    case "tank":
      return r.damageTaken > half
        ? `tank in the bottom half for damage taken (#${r.damageTaken})`
        : null;
    default:
      return null;
  }
}
