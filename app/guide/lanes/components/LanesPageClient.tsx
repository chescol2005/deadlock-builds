"use client";

import { useState } from "react";
import { AudienceTabs, GUIDE_AUDIENCE_TABS } from "@/app/components/AudienceTabs";
import { PhaseTimeline } from "@/app/guide/components/PhaseTimeline";
import { LANE_PHASE_CARDS, LANE_PILL_COLORS } from "@/lib/lanes/laneData";
import { StructureTable } from "./StructureTable";
import { LaneMinimapOverlay } from "./LaneMinimapOverlay";

export function LanesPageClient() {
  const [activeTab, setActiveTab] = useState<"new_player" | "advanced">("new_player");

  return (
    <div>
      <div className="mb-6">
        <AudienceTabs tabs={GUIDE_AUDIENCE_TABS} value={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === "new_player" && (
        <>
          <PhaseTimeline cards={LANE_PHASE_CARDS} pillColors={LANE_PILL_COLORS} />
          <LaneMinimapOverlay />
        </>
      )}

      {activeTab === "advanced" && (
        <>
          <StructureTable />
          <LaneMinimapOverlay />
        </>
      )}
    </div>
  );
}
