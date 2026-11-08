"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { InfoTooltip } from "@/app/components/Tooltip";

interface ProfileRankPickerProps {
  /** Tiers with accuracy data (tier > 0). Empty hides the picker. */
  rankTiers: ReadonlyArray<{ tier: number; name: string }>;
  /** The tier the server ranked at; null = All ranks. */
  selected: number | null;
}

/**
 * The roster profile's rank picker (Milestone O.4 / O.5). The rank lives in the
 * URL (`?rank=`): the server re-ranks for it and the link is shareable.
 */
export function ProfileRankPicker({ rankTiers, selected }: ProfileRankPickerProps) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  if (rankTiers.length === 0) return null;

  const onChange = (value: string) => {
    const href = value === "" ? pathname : `${pathname}?rank=${value}`;
    startTransition(() => router.push(href, { scroll: false }));
  };

  return (
    <div aria-busy={pending}>
      <label
        htmlFor="profile-rank-tier"
        className="mb-1 flex items-center gap-1.5 text-xs text-zinc-300"
      >
        Your rank
        <InfoTooltip content="Higher-ranked players land more of their shots, so a gun is worth more to them. Picking a rank re-ranks the gun numbers (and Wraith's cards) using real hit rates at that rank. Everything else stays the same." />
      </label>
      <select
        id="profile-rank-tier"
        value={selected ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none disabled:opacity-60 pointer-coarse:min-h-10"
      >
        <option value="">All ranks (average)</option>
        {rankTiers.map((t) => (
          <option key={t.tier} value={t.tier}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
