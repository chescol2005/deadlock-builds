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
}

const KEY_HELP =
  'Optional. Matches the API has already fetched load without a key. A key raises the limit for fetching new matches from Steam. It is sent only to api.deadlock-api.com from your browser, never to this site, and never stored unless you tick "Remember for this tab".';

const INPUT_CLASS =
  "w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none pointer-coarse:min-h-10";

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
}: MatchLookupFormProps) {
  // UI-only: whether the key field is revealed in the simplified view.
  const [keyOpen, setKeyOpen] = useState(false);
  const showKey = !simplified || keyOpen;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Look up a match"
      className="flex flex-col gap-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4"
    >
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

      <button
        type="submit"
        disabled={loading}
        className="self-start rounded-md border border-amber-500 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-400 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500 pointer-coarse:min-h-10"
      >
        {loading ? "Loading…" : "Review lane"}
      </button>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-sm text-red-300"
        >
          {error}
        </div>
      ) : null}
    </form>
  );
}
