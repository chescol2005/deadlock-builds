"use client";

import { useState } from "react";
import { AudienceTabs, GUIDE_AUDIENCE_TABS } from "@/app/components/AudienceTabs";
import { PhaseTimeline } from "@/app/guide/components/PhaseTimeline";
import { BOON_PHASE_CARDS, BOON_PILL_COLORS } from "@/lib/boons/boonsGuideData";
import { BoonThresholdTable } from "./BoonThresholdTable";

export function BoonsPageClient() {
  const [activeTab, setActiveTab] = useState<"new_player" | "advanced">("new_player");

  return (
    <div>
      <div className="mb-6">
        <AudienceTabs tabs={GUIDE_AUDIENCE_TABS} value={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === "new_player" && (
        <>
          <p className="mb-4 text-sm text-zinc-400">
            Every hero levels up automatically as they earn souls over the match — no experience
            points, no last-hitting for XP. This is the boon system. It hands you ability points and
            unlocks new ability slots on its own, on top of whatever you buy in the shop.
          </p>
          <PhaseTimeline cards={BOON_PHASE_CARDS} pillColors={BOON_PILL_COLORS} />
        </>
      )}

      {activeTab === "advanced" && (
        <>
          <p className="mb-4 text-sm text-zinc-400">
            36 boon levels total, each triggered by a cumulative souls-earned threshold. Ability
            points climb roughly linearly; the four highlighted rows are ability-slot unlocks, and
            boon level 8 (3,800 souls) is also your ultimate unlock.
          </p>
          <BoonThresholdTable />
        </>
      )}
    </div>
  );
}
