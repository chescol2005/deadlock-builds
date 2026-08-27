"use client";

import { useState } from "react";
import { AudienceTabs, GUIDE_AUDIENCE_TABS } from "@/app/components/AudienceTabs";
import { PhaseTimeline } from "@/app/guide/components/PhaseTimeline";
import {
  ITEMIZATION_PHASE_CARDS,
  ITEMIZATION_PILL_COLORS,
} from "@/lib/itemization/itemizationGuideData";
import { CategoryBonusTable } from "./CategoryBonusTable";

export function ItemizationPageClient() {
  const [activeTab, setActiveTab] = useState<"new_player" | "advanced">("new_player");

  return (
    <div>
      <div className="mb-6">
        <AudienceTabs tabs={GUIDE_AUDIENCE_TABS} value={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === "new_player" && (
        <PhaseTimeline cards={ITEMIZATION_PHASE_CARDS} pillColors={ITEMIZATION_PILL_COLORS} />
      )}

      {activeTab === "advanced" && (
        <>
          <p className="mb-4 text-sm text-zinc-400">
            Category investment bonuses stack on top of an item&apos;s own stats — the more souls
            you commit to one category, the stronger every item in it becomes.
          </p>
          <CategoryBonusTable />
        </>
      )}
    </div>
  );
}
