"use client";

import { MessageCircleMore } from "lucide-react";
import { InfoTooltip } from "@/app/components/Tooltip";
import type { CoachLine } from "../matchViewTypes";

export interface LaneCoachPanelProps {
  messages: ReadonlyArray<CoachLine>;
  /** Reserved for the shared panel convention; wording is the same in both views. */
  simplified?: boolean;
}

const COACH_HELP = "The coach points out the one or two things that mattered most in your lane.";

// `simplified` is part of the panel convention; the coach already words each message
// for the audience upstream, so this panel shows the same layout in both views.
export function LaneCoachPanel({ messages }: LaneCoachPanelProps) {
  return (
    <section
      aria-label="Coach"
      className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3"
    >
      <div className="flex items-center gap-2">
        <MessageCircleMore size={16} className="text-amber-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-white">Coach</h2>
        <InfoTooltip content={COACH_HELP} label="About the coach" />
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {messages.length > 0 ? (
          messages.map((m) => (
            <p
              key={m.insight}
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm text-zinc-300"
            >
              {m.text}
            </p>
          ))
        ) : (
          <p className="text-xs text-zinc-500">Nothing stood out in this lane.</p>
        )}
      </div>
    </section>
  );
}
