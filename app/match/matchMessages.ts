// app/match/matchMessages.ts — plain-English text for every way a match review can
// fail (docs/match-review-use-cases.md §5). Both records are exhaustive by type, so
// a new error kind or no-review reason can't ship without wording (Fixture 23).

import type { NoReviewReason } from "@/lib/matchReview";
import type { MatchLoadError } from "./matchApi";

/** Seconds → "about 25 minutes" / "about a minute". */
function waitText(seconds: number | null): string {
  if (seconds === null) return "a little while";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

export const LOAD_ERROR_MESSAGES: {
  readonly [K in MatchLoadError["kind"]]: (e: Extract<MatchLoadError, { kind: K }>) => string;
} = {
  invalid_id: () => "A match ID is a number. Copy it from your in-game match history.",
  not_found: () =>
    "We couldn't find that match. Check the ID; very recent matches can take a few minutes to appear.",
  steam_busy: (e) =>
    `This match hasn't been fetched yet, and Steam is busy. Try again in ${waitText(e.retryAfterS)}. A deadlock-api key raises this limit.`,
  rate_limited: (e) =>
    `Too many lookups for now. Try again in ${waitText(e.retryAfterS)}. A deadlock-api key raises this limit.`,
  bad_key: () => "That API key was refused. Check it, or clear it: most matches load without one.",
  unreadable: () => "This match's data couldn't be read, so there is no lane review for it.",
  network: () => "Couldn't reach the match data service. Check your connection and try again.",
  http: (e) => `The match data service returned an error (${e.status}). Try again later.`,
};

export function loadErrorMessage(error: MatchLoadError): string {
  // The record is keyed by kind, so this lookup is exhaustive by construction.
  const render = LOAD_ERROR_MESSAGES[error.kind] as (e: MatchLoadError) => string;
  return render(error);
}

export const NO_REVIEW_MESSAGES: Readonly<Record<NoReviewReason, string>> = {
  unsupported_mode:
    "Lane reviews are for normal 6v6 matches. This one is a different mode, such as Street Brawl.",
  too_short: "This match ended before 9 minutes, so there is no full lane to review.",
  missing_snapshot:
    "The match data is missing a lane player's 9-minute stats, so the lane can't be compared fairly.",
  hero_not_in_match: "That hero isn't in this match. Pick one of the heroes below.",
  lane_incomplete:
    "This lane didn't have two players on each team, so there are no clear lane opponents to compare with.",
};

export const PLAYER_ID_MESSAGES: Readonly<Record<"empty" | "vanity" | "invalid", string>> = {
  empty: "Paste your Steam profile link, SteamID64 or friend code to see your recent matches.",
  vanity:
    "Custom Steam links (steamcommunity.com/id/…) can't be looked up. Use your SteamID64 or friend code instead: Steam shows the friend code under Friends > Add a Friend.",
  invalid:
    "That doesn't look like a Steam ID. Paste a steamcommunity.com/profiles/… link, a 17-digit SteamID64 or your friend code.",
};
