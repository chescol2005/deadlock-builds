"use client";

import { useState } from "react";
import { AudienceTabs, GUIDE_AUDIENCE_TABS } from "@/app/components/AudienceTabs";
import { PhaseTimeline } from "./PhaseTimeline";
import { CampTable } from "./CampTable";
import { MinimapOverlay } from "./MinimapOverlay";

export function FarmingPageClient() {
  const [activeTab, setActiveTab] = useState<"new_player" | "advanced">("new_player");

  return (
    <div>
      <div className="mb-6">
        <AudienceTabs tabs={GUIDE_AUDIENCE_TABS} value={activeTab} onChange={setActiveTab} />
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
