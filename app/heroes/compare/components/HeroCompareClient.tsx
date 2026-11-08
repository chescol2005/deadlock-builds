"use client";

import { useMemo, useState } from "react";
import { AudienceTabs } from "@/app/components/AudienceTabs";
import {
  COMPARE_COLUMNS,
  sortCompareRows,
  type CompareRow,
  type CompareSortKey,
} from "@/lib/heroProfile/compare";
import { ProfileRankPicker } from "@/app/heroes/components/ProfileRankPicker";
import { HeroCompareTable } from "./HeroCompareTable";

interface HeroCompareClientProps {
  rows: ReadonlyArray<CompareRow>;
  rankTier: number | null;
  rankTiers: ReadonlyArray<{ tier: number; name: string }>;
}

const VIEW_TABS = [
  { value: "simplified", label: "Simplified" },
  { value: "advanced", label: "Advanced" },
] as const;

type ViewMode = (typeof VIEW_TABS)[number]["value"];

/**
 * /heroes/compare (Milestone O.5). The server ranks; this only sorts (by value,
 * then hero id) and switches the view. The rank lives in the URL.
 */
export function HeroCompareClient({ rows, rankTier, rankTiers }: HeroCompareClientProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("simplified");
  const [sortKey, setSortKey] = useState<CompareSortKey>("landedDps");
  const [sortOrder, setSortOrder] = useState<"best" | "worst">("best");
  const simplified = viewMode === "simplified";

  const columns = useMemo(
    () => COMPARE_COLUMNS.filter((c) => !simplified || c.simplified),
    [simplified],
  );
  // A sort column hidden by the simplified view falls back to the gun lead.
  const activeKey: CompareSortKey =
    sortKey === "name" || sortKey === "lean" || columns.some((c) => c.id === sortKey)
      ? sortKey
      : "landedDps";
  const sorted = useMemo(
    () => sortCompareRows(rows, activeKey, sortOrder),
    [rows, activeKey, sortOrder],
  );

  const onSort = (key: CompareSortKey) => {
    if (key === activeKey) setSortOrder((o) => (o === "best" ? "worst" : "best"));
    else {
      setSortKey(key);
      // Names read A to Z first; metrics best first.
      setSortOrder("best");
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-end gap-3">
        <ProfileRankPicker rankTiers={rankTiers} selected={rankTier} />
        <AudienceTabs tabs={VIEW_TABS} value={viewMode} onChange={setViewMode} />
      </div>
      <HeroCompareTable
        rows={sorted}
        columns={columns}
        sortKey={activeKey}
        sortOrder={sortOrder}
        onSort={onSort}
        rankTier={rankTier}
        rosterSize={rows.length}
        simplified={simplified}
      />
    </div>
  );
}
