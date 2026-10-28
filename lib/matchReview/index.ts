// lib/matchReview — the match review (docs/match-review-use-cases.md): lane facts from
// match metadata. Pure; imports nothing from lib/coach, lib/engine, lib/scoring or app.

export * from "./matchTypes";
export * from "./laneReport";
export { parseMatchMetadata } from "./parseMatch";
export { parsePlayerId } from "./playerId";
export type { PlayerIdResult } from "./playerId";
export { parseMatchHistory, RECENT_MATCH_LIMIT } from "./parseHistory";
export type { RecentMatch } from "./parseHistory";
