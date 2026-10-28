// lib/matchReview/playerId.ts — turns what a player pastes to identify themselves into
// the 32-bit Steam account id the deadlock-api uses (the "friend code" Steam shows).
//
// Accepted: a friend code / account id, a SteamID64, a steamcommunity.com/profiles/
// link, SteamID3 ([U:1:N]) and SteamID2 (STEAM_X:Y:Z). A vanity link (/id/<name>) can
// only be resolved by a name search, which this site does not do, so it gets its own
// reason. Pure; the SteamID64 maths uses BigInt (7.6e16 is past Number's safe range).

/** SteamID64 of account 0 for individual accounts (developer.valvesoftware.com/wiki/SteamID). */
const STEAM_ID64_BASE = BigInt("76561197960265728");
const MAX_ACCOUNT_ID = 0xffffffff;

export type PlayerIdResult =
  | { ok: true; accountId: number }
  | { ok: false; reason: "empty" | "vanity" | "invalid" };

function fromAccountId(n: bigint): PlayerIdResult {
  return n > BigInt(0) && n <= BigInt(MAX_ACCOUNT_ID)
    ? { ok: true, accountId: Number(n) }
    : { ok: false, reason: "invalid" };
}

function fromSteamId64(digits: string): PlayerIdResult {
  return fromAccountId(BigInt(digits) - STEAM_ID64_BASE);
}

export function parsePlayerId(input: string): PlayerIdResult {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "empty" };

  if (/steamcommunity\.com\/id\//i.test(text)) return { ok: false, reason: "vanity" };
  const profile = /steamcommunity\.com\/profiles\/(\d{17})(?:\/|\?|#|$)/i.exec(text);
  if (profile) return fromSteamId64(profile[1]);

  const id3 = /^\[?U:1:(\d{1,10})\]?$/i.exec(text);
  if (id3) return fromAccountId(BigInt(id3[1]));

  const id2 = /^STEAM_[0-5]:([01]):(\d{1,10})$/i.exec(text);
  if (id2) return fromAccountId(BigInt(id2[2]) * BigInt(2) + BigInt(id2[1]));

  if (/^\d{17}$/.test(text) && text.startsWith("7656119")) return fromSteamId64(text);
  if (/^\d{1,10}$/.test(text)) return fromAccountId(BigInt(text));
  return { ok: false, reason: "invalid" };
}
