"use client";

import { Bell, BellOff, MessageCircleMore, X } from "lucide-react";
import { InfoTooltip } from "@/app/components/Tooltip";

export interface CoachPanelProps {
  /** Latest coach message, pre-computed upstream. null = nothing to say right now. */
  message: { insight: string; text: string } | null;
  /** The coach is muted: no tips are shown. */
  muted: boolean;
  /** Hides the current message. */
  onDismiss: () => void;
  onToggleMute: () => void;
  /** "Review my build": asks the coach for a tip on the current build. */
  onReview: () => void;
  /** Only changes the empty-state hint wording. Defaults false. */
  simplified?: boolean;
}

const COACH_HELP =
  "The coach watches your build and points out one thing that matters right now, in plain English. It never repeats itself. Mute it any time.";

export function CoachPanel({
  message,
  muted,
  onDismiss,
  onToggleMute,
  onReview,
  simplified = false,
}: CoachPanelProps) {
  const hint = simplified
    ? "Nothing new to point out. Keep building, or press Review my build."
    : "No tip right now.";

  return (
    <section
      aria-label="Coach"
      className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageCircleMore size={16} className="text-amber-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-white">Coach</h2>
          <InfoTooltip content={COACH_HELP} label="About the coach" />
        </div>
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? "Unmute coach" : "Mute coach"}
          aria-pressed={muted}
          className="flex shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 p-1.5 text-zinc-300 hover:border-amber-500 hover:text-amber-400 pointer-coarse:min-h-10 pointer-coarse:min-w-10"
        >
          {muted ? <BellOff size={14} aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />}
        </button>
      </div>

      {muted ? (
        <p className="text-xs text-zinc-500">Coach muted. Unmute to get tips while you build.</p>
      ) : (
        <>
          {/* One persistent live region: screen readers announce each new tip. */}
          <div role="status" aria-live="polite">
            {message ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
                <p className="min-w-0 flex-1 text-sm text-zinc-300">{message.text}</p>
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Dismiss tip"
                  className="flex shrink-0 items-center justify-center rounded-md p-1 text-zinc-500 hover:text-white pointer-coarse:min-h-10 pointer-coarse:min-w-10"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">{hint}</p>
            )}
          </div>

          <button
            type="button"
            onClick={onReview}
            className="self-start rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-amber-500 hover:text-amber-400 pointer-coarse:min-h-10"
          >
            Review my build
          </button>
        </>
      )}
    </section>
  );
}
