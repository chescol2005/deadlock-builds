// The roster profile's fight model (Milestone O §3.2). Fractional on purpose:
// a cast count is the AVERAGE over many fights, not half a cast.
//
// It is the engine's castsPerTrade (lib/engine/heroDamage.ts) generalized to any
// fight length and WITHOUT its blanket MAX_CASTS_PER_TRADE cap: the profile
// models what actually limits each ability instead (cast gates, §3.2.1, O.3).
// The engine itself is unchanged and keeps its cap.

import { TRADE_GAP_SECONDS, TRADE_SECONDS } from "@/lib/engine/heroDamage";

/** A short fight: the engine's trade. */
export const SHORT_FIGHT_SECONDS = TRADE_SECONDS;
/** A long teamfight. A model, not a measurement; open to tuning. */
export const LONG_FIGHT_SECONDS = 30;

export const FIGHT_LENGTHS = { short: SHORT_FIGHT_SECONDS, long: LONG_FIGHT_SECONDS } as const;
export type FightLength = keyof typeof FIGHT_LENGTHS;

/**
 * Average casts of a cooldown-gated ability in a fight of `fightSeconds`:
 * F / cd below the fight length; at or above it, the engine's readiness weight,
 * the share of fights the ability is up for. No cooldown is one cast.
 * Equals castsPerTrade(cd) at F = 10 for any cd >= 5, where its cap doesn't bind.
 */
export function castsFromCooldown(cooldown: number, fightSeconds: number): number {
  if (!(cooldown > 0) || !(fightSeconds > 0)) return 1;
  return cooldown < fightSeconds
    ? fightSeconds / cooldown
    : Math.min(1, TRADE_GAP_SECONDS / cooldown);
}
