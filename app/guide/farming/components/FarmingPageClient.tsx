"use client";

import { useState } from "react";
import { PhaseTimeline } from "./PhaseTimeline";
import { CampTable } from "./CampTable";
import { MinimapOverlay } from "./MinimapOverlay";

export function FarmingPageClient() {
  const [activeTab, setActiveTab] = useState<"new_player" | "advanced">("new_player");

  return (
    <div>
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setActiveTab("new_player")}
          className={
            activeTab === "new_player"
              ? "rounded-lg bg-amber-500 px-4 py-2 font-semibold text-zinc-900"
              : "rounded-lg bg-zinc-800 px-4 py-2 text-zinc-400 hover:text-white"
          }
        >
          New Player
        </button>
        <button
          onClick={() => setActiveTab("advanced")}
          className={
            activeTab === "advanced"
              ? "rounded-lg bg-amber-500 px-4 py-2 font-semibold text-zinc-900"
              : "rounded-lg bg-zinc-800 px-4 py-2 text-zinc-400 hover:text-white"
          }
        >
          Advanced
        </button>
      </div>

      {activeTab === "new_player" && (
        <>
          <PhaseTimeline />
          <MinimapOverlay />
        </>
      )}

      {activeTab === "advanced" && (
        <>
          <CampTable />
          <MinimapOverlay />
        </>
      )}
    </div>
  );
}
