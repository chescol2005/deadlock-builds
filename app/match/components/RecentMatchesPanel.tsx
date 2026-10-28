"use client";

import { InfoTooltip } from "@/app/components/Tooltip";
import type { RecentMatchView } from "../matchViewTypes";
import { MatchIcon } from "./MatchIcon";

export interface RecentMatchesPanelProps {
  matches: ReadonlyArray<RecentMatchView>;
  selectedMatchId: number | null;
  onSelect: (match: RecentMatchView) => void;
  /** Simplified shows hero, result and date. Advanced adds K/D/A and duration. */
  simplified?: boolean;
}

const HELP = "Normal 6v6 matches, newest first. Pick one to review your lane.";

export function RecentMatchesPanel({
  matches,
  selectedMatchId,
  onSelect,
  simplified = false,
}: RecentMatchesPanelProps) {
  return (
    <section
      aria-label="Your recent matches"
      className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white">Your recent matches</h2>
        <InfoTooltip content={HELP} label="About recent matches" />
      </div>

      {matches.length === 0 ? (
        <p className="text-sm text-zinc-300">
          No normal matches found for this account yet. Very recent matches can take a few minutes
          to appear.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {matches.map((m) => {
            const selected = m.matchId === selectedMatchId;
            return (
              <li key={m.matchId}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(m)}
                  className={`flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-zinc-800 p-2 text-left transition-colors hover:border-amber-500 pointer-coarse:min-h-10 ${
                    selected ? "border-amber-500 bg-amber-500/10" : "border-zinc-700"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 basis-32 items-center gap-2">
                    <MatchIcon src={m.hero.icon} name={m.hero.name} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                      {m.hero.name}
                    </span>
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
                      m.won
                        ? "border-green-500/40 bg-green-500/10 text-green-400"
                        : "border-red-500/40 bg-red-500/10 text-red-400"
                    }`}
                  >
                    {m.won ? "Win" : "Loss"}
                  </span>
                  {simplified ? null : (
                    <>
                      <span className="shrink-0 text-sm text-zinc-300">
                        {m.kills} / {m.deaths} / {m.assists}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-500">{m.duration}</span>
                    </>
                  )}
                  <span className="shrink-0 text-xs text-zinc-500">{m.playedAt}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
