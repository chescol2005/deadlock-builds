// Plain-English copy and number formats for the roster profile (Milestone O.4).
// Shared by the hero page section and, in O.5, the roster compare table.

import type { AbilityPool, CastGate } from "./abilities";
import type { HeroMetricId, MetricGroup } from "./metrics";
import type { LateGameLean } from "./profile";

export const METRIC_GROUP_LABELS: Record<MetricGroup, string> = {
  gun: "Gun",
  melee: "Melee",
  vitality: "Vitality",
  spirit: "Spirit",
};

type MetricCopy = {
  /** What it means for the player, one sentence. */
  help: string;
  format: (v: number) => string;
};

const fixed =
  (digits: number, suffix = "") =>
  (v: number) =>
    `${v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}${suffix}`;
const percentGrowth = (v: number) => `+${Math.round(v * 100)}%`;

export const METRIC_COPY: Record<HeroMetricId, MetricCopy> = {
  landedDps: {
    help: "Gun damage per second that actually hits, reloads included, at the selected rank's real accuracy. The fairest single number for how strong a hero's gun is.",
    format: fixed(0),
  },
  sustainedDps: {
    help: "Gun damage per second if every bullet hit, reloads included. Compare it with landed DPS to see how much aim matters.",
    format: fixed(0),
  },
  damagePerBullet: {
    help: "Damage of one bullet. On its own it misleads: a fast-firing gun with small bullets can out-damage a slow one.",
    format: fixed(1),
  },
  fireRate: { help: "Bullets fired per second.", format: fixed(2, "/s") },
  clipSize: { help: "Bullets before you have to reload.", format: fixed(0) },
  reloadTime: { help: "Seconds to reload. Lower is better.", format: fixed(2, "s") },
  gunGrowth: {
    help: "How much stronger the gun gets from boons alone, from the start of the match to late game.",
    format: percentGrowth,
  },
  lightMelee: { help: "Damage of a quick melee hit.", format: fixed(0) },
  heavyMelee: { help: "Damage of a charged melee hit.", format: fixed(0) },
  maxHealth: { help: "Health late game, from boons alone (no items).", format: fixed(0) },
  healthPerBoon: { help: "Health gained each time you earn a boon.", format: fixed(0) },
  healthGrowth: {
    help: "How much of the hero's late-game health comes from boons.",
    format: percentGrowth,
  },
  bulletResist: {
    help: "Bullet damage the hero ignores without any items. Most heroes have none.",
    format: fixed(1, "%"),
  },
  spiritResist: {
    help: "Spirit damage the hero ignores without any items. Most heroes have none.",
    format: fixed(1, "%"),
  },
  ehpBullet: {
    help: "How much bullet damage it takes to kill the hero: health with bullet resist counted.",
    format: fixed(0),
  },
  ehpSpirit: {
    help: "How much spirit damage it takes to kill the hero: health with spirit resist counted.",
    format: fixed(0),
  },
  healthRegen: { help: "Health recovered per second.", format: fixed(1, "/s") },
  moveSpeed: { help: "Running speed in metres per second.", format: fixed(2, " m/s") },
  boonSpiritPower: {
    help: "Spirit power from boons alone. Items add much more.",
    format: fixed(0),
  },
  kitSpiritShort: {
    help: "Extra ability damage per short fight (10 s) for each point of spirit power, with all four abilities fully upgraded. High means spirit items pay off.",
    format: fixed(2),
  },
  kitSpiritLong: {
    help: "The same over a long teamfight (30 s). Short cooldowns gain here, because they cast again.",
    format: fixed(2),
  },
  kitWeaponShort: {
    help: "Extra ability damage per short fight from weapon damage. Only a handful of abilities scale this way, so most heroes have none.",
    format: fixed(2),
  },
  kitWeaponLong: {
    help: "The same over a long teamfight (30 s).",
    format: fixed(2),
  },
};

export const LEAN_COPY: Record<LateGameLean, { label: string; help: string }> = {
  gun: {
    label: "Leans gun",
    help: "This hero's gun ranks high and its abilities scale less with spirit, so late game most of your souls should go into weapon items.",
  },
  spirit: {
    label: "Leans spirit",
    help: "This hero's abilities scale strongly with spirit power and its gun ranks lower, so late game most of your souls should go into spirit items.",
  },
  hybrid: {
    label: "Hybrid",
    help: "Both the gun and the abilities rank high, so late game both weapon and spirit items pay off.",
  },
  flexible: {
    label: "Flexible",
    help: "Neither the gun nor the abilities stand out against the roster, so build for what the match needs.",
  },
};

export const POOL_LABELS: Record<AbilityPool, string> = {
  spirit: "Scales with spirit",
  weapon: "Scales with weapon damage",
  unscaled: "Fixed damage",
  utility: "Utility (no damage)",
};

export const GATE_COPY: Record<CastGate["kind"], string> = {
  cooldown: "Limited by its cooldown.",
  resource:
    "Limited by cards: you start with a full hand and earn more by landing bullets, so better aim means more throws.",
  charges: "Limited by charges: you start with them banked and one comes back on a timer.",
  channel: "A channel: damage per second for as long as it lasts, then a short cooldown.",
  battery:
    "Charged by damage you take. Counted as one charge per fight, since how much damage you take varies.",
};

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "7th of 38 · top 16%", or "1st of 38 · best" (§4). */
export function rankLabel(rank: number, n: number, percentile: number | null): string {
  if (rank === 1) return `1st of ${n} · best`;
  if (percentile == null) return `${ordinal(rank)} of ${n}`;
  return `${ordinal(rank)} of ${n} · top ${Math.max(1, Math.round(100 - percentile))}%`;
}
