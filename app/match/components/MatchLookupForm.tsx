"use client";

import { useState, type FormEvent } from "react";
import { InfoTooltip } from "@/app/components/Tooltip";

export interface MatchLookupFormProps {
  matchId: string;
  onMatchIdChange: (v: string) => void;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  rememberKey: boolean;
  onRememberKeyChange: (v: boolean) => void;
  onSubmit: () => void;
  loading: boolean;
  /** Plain-English error to show under the form, or null. */
  error: string | null;
  /** Hides the API key field behind a disclosure. Defaults false. */
  simplified?: boolean;
  /** What the player typed to identify themselves (Steam ID, friend code or profile link). */
  playerInput: string;
  onPlayerInputChange: (v: string) => void;
  /** Look up the player's recent matches. */
  onFindMatches: () => void;
  historyLoading: boolean;
}

const KEY_HELP =
  'Optional. Matches the API has already fetched load without a key. A key raises the limit for fetching new matches from Steam. It is sent only to api.deadlock-api.com from your browser, never to this site, and never stored unless you tick "Remember for this tab".';

const PLAYER_HELP =
  "Your matches are looked up on the deadlock-api from your browser. Your Steam ID is not stored and is never put in the page link.";

const INPUT_CLASS =
  "w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none pointer-coarse:min-h-10";

const SUBMIT_CLASS =
  "self-start rounded-md border border-amber-500 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-400 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500 pointer-coarse:min-h-10";

export function MatchLookupForm({
  matchId,
  onMatchIdChange,
  apiKey,
  onApiKeyChange,
  rememberKey,
  onRememberKeyChange,
  onSubmit,
  loading,
  error,
  simplified = false,
  playerInput,
  onPlayerInputChange,
  onFindMatches,
  historyLoading,
}: MatchLookupFormProps) {
  // UI-only: whether the key field is revealed in the simplified view.
  const [keyOpen, setKeyOpen] = useState(false);
  const showKey = !simplified || keyOpen;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit();
  }

  function handleFind(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onFindMatches();
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <form onSubmit={handleFind} aria-label="Find your matches" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label htmlFor="match-player" className="text-sm font-semibold text-white">
              Your Steam ID or friend code
            </label>
            <InfoTooltip content={PLAYER_HELP} label="About your Steam ID" />
          </div>
          <input
            id="match-player"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={playerInput}
            onChange={(e) => onPlayerInputChange(e.target.value)}
            placeholder="e.g. 76561198… or steamcommunity.com/profiles/…"
            className={INPUT_CLASS}
          />
          <p className="text-xs text-zinc-500">
            Paste your Steam profile link, SteamID64 or friend code. Custom /id/ links can&apos;t be
            looked up.
          </p>
        </div>
        <button type="submit" disabled={historyLoading} className={SUBMIT_CLASS}>
          {historyLoading ? "Loading…" : "Show my matches"}
        </button>
      </form>

      <div className="flex items-center gap-3" role="separator">
        <span className="h-px flex-1 bg-zinc-700" />
        <span className="text-xs font-medium text-zinc-500">or paste a match ID</span>
        <span className="h-px flex-1 bg-zinc-700" />
      </div>

      <form onSubmit={handleSubmit} aria-label="Look up a match" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="match-id" className="text-sm font-semibold text-white">
            Match ID
          </label>
          <input
            id="match-id"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={matchId}
            onChange={(e) => onMatchIdChange(e.target.value)}
            placeholder="e.g. 126035190"
            className={INPUT_CLASS}
          />
          <p className="text-xs text-zinc-500">Find it in your in-game match history.</p>
        </div>

        {simplified && !keyOpen ? (
          <button
            type="button"
            onClick={() => setKeyOpen(true)}
            aria-expanded={false}
            className="self-start text-xs font-medium text-amber-400 hover:text-amber-300 pointer-coarse:min-h-10"
          >
            Have an API key?
          </button>
        ) : null}

        {showKey ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label htmlFor="match-api-key" className="text-sm font-semibold text-white">
                  deadlock-api key <span className="font-normal text-zinc-500">(optional)</span>
                </label>
                <InfoTooltip content={KEY_HELP} label="About the API key" />
              </div>
              <input
                id="match-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-300 pointer-coarse:min-h-10">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(e) => onRememberKeyChange(e.target.checked)}
                className="h-4 w-4 accent-amber-500"
              />
              Remember for this tab
            </label>
          </div>
        ) : null}

        <button type="submit" disabled={loading} className={SUBMIT_CLASS}>
          {loading ? "Loading…" : "Review lane"}
        </button>
      </form>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-sm text-red-300"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
