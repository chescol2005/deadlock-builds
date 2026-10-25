// Display pieces shared by the basket panels (HeroBasketSuggestion,
// StarterBuildPanel), so category colours and the reason breakdown can't drift.

import type { ItemCategory } from "@/lib/items";
import type { MarginalTerm } from "@/lib/engine/types";

// `border` (all-side color) and `accentLeft` (left-side-only color, for the
// thick accent edge on cards) are kept as separate class strings — mixing an
// all-side border-color utility with a border-l-{width} utility on the same
// element re-creates the borderLeft/shorthand conflict this repo already hit
// once (see git history on CategoryManager's border handling).
export const CATEGORY_STYLES: Record<
  ItemCategory,
  { border: string; accentLeft: string; text: string; softBg: string }
> = {
  gun: {
    border: "border-orange-600",
    accentLeft: "border-l-orange-600",
    text: "text-orange-400",
    softBg: "bg-orange-600/10",
  },
  vitality: {
    border: "border-green-600",
    accentLeft: "border-l-green-600",
    text: "text-green-400",
    softBg: "bg-green-600/10",
  },
  spirit: {
    border: "border-violet-600",
    accentLeft: "border-l-violet-600",
    text: "text-purple-400",
    softBg: "bg-violet-600/10",
  },
};

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export interface TermBreakdownProps {
  terms: ReadonlyArray<MarginalTerm>;
}

/** Every term behind a pick with its signed value (the advanced view). */
export function TermBreakdown({ terms }: TermBreakdownProps) {
  return (
    <ul className="flex flex-col gap-1 border-t border-zinc-800 pt-2">
      {terms.map((term) => (
        <li
          key={term.termId}
          className="flex items-start justify-between gap-2 text-[11px] text-zinc-400"
        >
          <span className="min-w-0 italic">{term.reason}</span>
          <span
            className={`shrink-0 font-mono ${term.value >= 0 ? "text-emerald-400" : "text-red-400"}`}
          >
            {term.value >= 0 ? "+" : ""}
            {term.value.toFixed(2)}
          </span>
        </li>
      ))}
    </ul>
  );
}
