// Shared display pieces for the roster profile (Milestone O.4 / O.5): the
// percentile bar and the lean badge colours. Presentational only.

import type { RankCell } from "@/lib/heroProfile/view";

// Percentile bar widths in 5-point steps, as literal classes so Tailwind emits them.
const BAR_WIDTHS = [
  "w-[0%]",
  "w-[5%]",
  "w-[10%]",
  "w-[15%]",
  "w-[20%]",
  "w-[25%]",
  "w-[30%]",
  "w-[35%]",
  "w-[40%]",
  "w-[45%]",
  "w-[50%]",
  "w-[55%]",
  "w-[60%]",
  "w-[65%]",
  "w-[70%]",
  "w-[75%]",
  "w-[80%]",
  "w-[85%]",
  "w-[90%]",
  "w-[95%]",
  "w-[100%]",
] as const;

export function barWidth(percentile: number): string {
  const i = Math.min(20, Math.max(0, Math.round(percentile / 5)));
  return BAR_WIDTHS[i] ?? "w-[0%]";
}

export function barColor(percentile: number): string {
  if (percentile >= 65) return "bg-amber-400";
  if (percentile >= 50) return "bg-amber-500/60";
  return "bg-zinc-500";
}

export const LEAN_STYLES = {
  gun: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  spirit: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  hybrid: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  flexible: "border-zinc-600 bg-zinc-800/60 text-zinc-300",
} as const;

export function RankBar({ rank }: { rank: Pick<RankCell, "percentile"> | null }) {
  if (!rank || rank.percentile == null) {
    return <div className="h-1.5 w-full rounded-full bg-zinc-800" />;
  }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        className={`h-full rounded-full ${barColor(rank.percentile)} ${barWidth(rank.percentile)}`}
      />
    </div>
  );
}
