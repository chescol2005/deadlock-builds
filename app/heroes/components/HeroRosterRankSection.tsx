"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AudienceTabs } from "@/app/components/AudienceTabs";
import { InfoTooltip } from "@/app/components/Tooltip";
import type { HeroRankView } from "@/lib/heroProfile/view";
import { HeroRosterRankPanel } from "./HeroRosterRankPanel";

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
 * view mode, and the rank tier, which lives in the URL (`?rank=`) so the server
 * ranks for it and the link is shareable.
 */
export function HeroRosterRankSection({ heroName, view, rankTiers }: HeroRosterRankSectionProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("simplified");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const onRankChange = (value: string) => {
    const href = value === "" ? pathname : `${pathname}?rank=${value}`;
    startTransition(() => router.push(href, { scroll: false }));
  };

  return (
    <section className="mt-6" aria-busy={pending}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-zinc-200">
            How {heroName} ranks late game
            <InfoTooltip content="Every hero compared on the same footing: late game (boon 30, about 30,000 souls) with no items. It shows where this hero is naturally strong, so you know which items will pay off most." />
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Against the whole roster. A full bar is the best hero in the game at that stat.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {rankTiers.length > 0 ? (
            <div>
              <label
                htmlFor="profile-rank-tier"
                className="mb-1 flex items-center gap-1.5 text-xs text-zinc-300"
              >
                Your rank
                <InfoTooltip content="Higher-ranked players land more of their shots, so a gun is worth more to them. Picking a rank re-ranks the gun numbers (and Wraith's cards) using real hit rates at that rank. Everything else stays the same." />
              </label>
              <select
                id="profile-rank-tier"
                value={view.rankTier ?? ""}
                onChange={(e) => onRankChange(e.target.value)}
                disabled={pending}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none pointer-coarse:min-h-10"
              >
                <option value="">All ranks (average)</option>
                {rankTiers.map((t) => (
                  <option key={t.tier} value={t.tier}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <AudienceTabs tabs={VIEW_TABS} value={viewMode} onChange={setViewMode} />
        </div>
      </div>
      <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <HeroRosterRankPanel
          heroName={heroName}
          view={view}
          simplified={viewMode === "simplified"}
        />
      </div>
    </section>
  );
}
