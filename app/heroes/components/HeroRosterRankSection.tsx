"use client";

import { useState } from "react";
import Link from "next/link";
import { AudienceTabs } from "@/app/components/AudienceTabs";
import { InfoTooltip } from "@/app/components/Tooltip";
import type { HeroRankView } from "@/lib/heroProfile/view";
import { HeroRosterRankPanel } from "./HeroRosterRankPanel";
import { ProfileRankPicker } from "./ProfileRankPicker";

interface HeroRosterRankSectionProps {
  heroName: string;
  view: HeroRankView;
  /** Tiers with accuracy data (tier > 0), name for the picker. */
  rankTiers: ReadonlyArray<{ tier: number; name: string }>;
}

const VIEW_TABS = [
  { value: "simplified", label: "Simplified" },
  { value: "advanced", label: "Advanced" },
] as const;

type ViewMode = (typeof VIEW_TABS)[number]["value"];

/**
 * The hero page's roster rank section (Milestone O.4). Owns only UI state: the
 * view mode. The rank tier lives in the URL (ProfileRankPicker).
 */
export function HeroRosterRankSection({ heroName, view, rankTiers }: HeroRosterRankSectionProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("simplified");
  const compareHref =
    view.rankTier != null ? `/heroes/compare?rank=${view.rankTier}` : "/heroes/compare";

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-zinc-200">
            How {heroName} ranks late game
            <InfoTooltip content="Every hero compared on the same footing: late game (boon 30, about 30,000 souls) with no items. It shows where this hero is naturally strong, so you know which items will pay off most." />
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Against the whole roster. A full bar is the best hero in the game at that stat.{" "}
            <Link href={compareHref} className="text-amber-400 hover:text-amber-300">
              Compare every hero →
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <ProfileRankPicker rankTiers={rankTiers} selected={view.rankTier} />
          <AudienceTabs tabs={VIEW_TABS} value={viewMode} onChange={setViewMode} />
        </div>
      </div>
      <HeroRosterRankPanel heroName={heroName} view={view} simplified={viewMode === "simplified"} />
    </section>
  );
}
