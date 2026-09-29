"use client";

import { useMemo } from "react";
import { ShoppingBasket, CircleAlert, Package } from "lucide-react";
import type { Item, ItemCategory } from "@/lib/items";
import type { BasketResult, BasketPick, MarginalTerm, ScoreCategory } from "@/lib/engine/types";
import { SCORE_CATEGORIES } from "@/lib/engine/types";
import { Tooltip, InfoTooltip } from "@/app/components/Tooltip";

export interface HeroBasketSuggestionProps {
  /** Pre-computed basket from `lib/engine/basketSelect.ts` — this panel never computes one. */
  basket: BasketResult | null;
  /** Full item catalog, used only to resolve `ItemCandidate.itemId` → `Item` for icon/name/cost. */
  allItems: Item[];
  /** Adds a single pick to the build. */
  onAdd: (item: Item) => void;
  /** Optional: adds every resolvable pick in the basket at once. */
  onAddAll?: (items: Item[]) => void;
  slotsFull?: boolean;
  /** Hides veteran-only detail (raw marginal values, per-term breakdowns, full coverage table). Defaults false. */
  simplified?: boolean;
}

// `border` (all-side color) and `accentLeft` (left-side-only color, for the
// thick accent edge on cards) are kept as separate class strings — mixing an
// all-side border-color utility with a border-l-{width} utility on the same
// element re-creates the borderLeft/shorthand conflict this repo already hit
// once (see git history on CategoryManager's border handling).
const CATEGORY_STYLES: Record<
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

const SCORE_CATEGORY_META: Record<ScoreCategory, { label: string; text: string; bar: string }> = {
  gunDamage: { label: "Gun Damage", text: "text-orange-400", bar: "bg-orange-600" },
  spiritDamage: { label: "Spirit Damage", text: "text-purple-400", bar: "bg-violet-600" },
  gunShred: { label: "Bullet Shred", text: "text-orange-300", bar: "bg-orange-500" },
  spiritShred: { label: "Spirit Shred", text: "text-purple-300", bar: "bg-violet-500" },
  antiHeal: { label: "Anti-Heal", text: "text-rose-400", bar: "bg-rose-600" },
  bonusHealth: { label: "Max Health", text: "text-green-400", bar: "bg-green-600" },
  resist: { label: "Resistances", text: "text-teal-400", bar: "bg-teal-600" },
  shield: { label: "Shields / Barriers", text: "text-lime-400", bar: "bg-lime-600" },
  sustain: { label: "Sustain / Healing", text: "text-emerald-400", bar: "bg-emerald-600" },
  mobility: { label: "Mobility", text: "text-sky-400", bar: "bg-sky-600" },
  utility: { label: "Utility", text: "text-amber-400", bar: "bg-amber-600" },
  economy: { label: "Economy", text: "text-zinc-400", bar: "bg-zinc-500" },
};

const STOP_REASON_COPY: Record<BasketResult["stopReason"], string> = {
  budget:
    "Stopped because the soul budget ran out — every item still worth adding costs more than what's left to spend.",
  slots:
    "Stopped because the 12-item active build cap was reached — free up a slot to fit more.",
  "no-positive-value":
    "Stopped early because nothing left would meaningfully help this hero's build — the basket avoided adding filler.",
  "no-candidates": "No eligible items were found to build a basket from.",
};

// Literal width classes so Tailwind's static scanner can see every value this
// component might apply — a runtime-interpolated `w-[${pct}%]` class name
// would not be discovered at build time.
const WIDTH_CLASSES = [
  "w-0",
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
  "w-full",
] as const;

function widthClassForPercent(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const idx = Math.round(clamped / 5);
  return WIDTH_CLASSES[idx];
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function bestTerm(terms: ReadonlyArray<MarginalTerm>): MarginalTerm | null {
  if (terms.length === 0) return null;
  return terms.reduce((best, t) => (t.value > best.value ? t : best), terms[0]);
}

function CoverageRow({
  category,
  coverage,
  target,
}: {
  category: ScoreCategory;
  coverage: number;
  target: number;
}) {
  const meta = SCORE_CATEGORY_META[category];
  const pct = target > 0 ? Math.min(100, Math.round((coverage / target) * 100)) : coverage > 0 ? 100 : 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
        <span className="text-zinc-500">
          {coverage.toFixed(1)} / {target.toFixed(1)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${meta.bar} ${widthClassForPercent(pct)}`} />
      </div>
    </div>
  );
}

function PickCard({
  pick,
  index,
  item,
  onAdd,
  slotsFull,
  simplified,
}: {
  pick: BasketPick;
  index: number;
  item: Item | null;
  onAdd: (item: Item) => void;
  slotsFull: boolean;
  simplified: boolean;
}) {
  const category = item?.category ?? pick.item.category;
  const styles = CATEGORY_STYLES[category];
  const name = item?.name ?? pick.item.name;
  const cost = item?.cost ?? pick.item.cost;
  const icon = item?.icon;
  const top = bestTerm(pick.terms);

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border-t border-r border-b border-zinc-700 border-l-4 ${styles.accentLeft} bg-zinc-900 p-3`}
    >
      <div className="flex items-center gap-3">
        <span className="w-4 shrink-0 text-center text-[10px] font-bold text-zinc-500">
          {index + 1}
        </span>

        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={icon}
            alt={name}
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-md"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-800">
            <Package size={14} className="text-zinc-600" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{name}</div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className={`font-semibold capitalize ${styles.text}`}>{category}</span>
            <span>◈ {fmt(cost)}</span>
            {!simplified ? (
              <span className="text-zinc-600">
                value {pick.marginalValue >= 0 ? "+" : ""}
                {pick.marginalValue.toFixed(2)}
              </span>
            ) : null}
          </div>
        </div>

        {!item ? (
          <Tooltip content="This pick's item data couldn't be found in the current item list, so it can't be added directly.">
            <button
              disabled
              className="shrink-0 cursor-not-allowed rounded-md border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-600"
            >
              Unavailable
            </button>
          </Tooltip>
        ) : slotsFull ? (
          <button
            disabled
            className="shrink-0 cursor-not-allowed rounded-md border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-600"
          >
            Build Full
          </button>
        ) : (
          <button
            onClick={() => onAdd(item)}
            className={`shrink-0 cursor-pointer rounded-md border ${styles.border} ${styles.softBg} px-2 py-1 text-[11px] font-semibold ${styles.text}`}
          >
            Add ◈{fmt(cost)}
          </button>
        )}
      </div>

      {simplified ? (
        <div className="text-[11px] italic text-zinc-400">
          {top ? top.reason : "No specific reason recorded for this pick."}
        </div>
      ) : pick.terms.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-zinc-800 pt-2">
          {pick.terms.map((term) => (
            <li
              key={term.termId}
              className="flex items-center justify-between gap-2 text-[11px] text-zinc-400"
            >
              <span className="italic">{term.reason}</span>
              <span
                className={`shrink-0 font-mono ${term.value >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {term.value >= 0 ? "+" : ""}
                {term.value.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-t border-zinc-800 pt-2 text-[11px] italic text-zinc-600">
          No specific reason recorded for this pick.
        </div>
      )}
    </div>
  );
}

export function HeroBasketSuggestion({
  basket,
  allItems,
  onAdd,
  onAddAll,
  slotsFull = false,
  simplified = false,
}: HeroBasketSuggestionProps) {
  const itemById = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);

  const resolvedPicks = useMemo(
    () =>
      (basket?.picks ?? []).map((pick) => ({
        pick,
        item: itemById.get(pick.item.itemId) ?? null,
      })),
    [basket, itemById],
  );

  const addAllItems = useMemo(
    () => resolvedPicks.map((r) => r.item).filter((i): i is Item => i !== null),
    [resolvedPicks],
  );

  const coverageCategories = useMemo(() => {
    if (!basket) return [];
    if (!simplified) return [...SCORE_CATEGORIES];
    return [...SCORE_CATEGORIES]
      .filter((cat) => (basket.target[cat] ?? 0) > 0.01 || (basket.coverage[cat] ?? 0) > 0.01)
      .sort((a, b) => (basket.target[b] ?? 0) - (basket.target[a] ?? 0))
      .slice(0, 4);
  }, [basket, simplified]);

  const unmetEntries = useMemo(() => {
    if (!basket) return [];
    return SCORE_CATEGORIES.map((cat) => ({ cat, value: basket.unmetNeed[cat] ?? 0 }))
      .filter((e) => e.value > 0.05)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
  }, [basket]);

  return (
    <section className="flex flex-col gap-3">
      <div className="mb-1 flex items-center gap-2">
        <ShoppingBasket size={14} className="text-amber-400" />
        <span className="text-[11px] font-bold tracking-wide text-zinc-400 uppercase">
          Hero Basket
        </span>
        <InfoTooltip content="A basket is a set of items picked together to cover this hero's specific needs — not just the single best item, but the best combination. Items are chosen one at a time, each one filling the biggest remaining gap left by the picks before it." />
      </div>

      {!basket ? (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-xs text-zinc-500">
          No basket suggestion is available yet for this hero and build.
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-[11px] text-zinc-400">
            <CircleAlert size={12} className="mt-0.5 shrink-0 text-amber-400" />
            <span>{STOP_REASON_COPY[basket.stopReason]}</span>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2">
            <span className="text-xs text-zinc-400">Total Basket Cost</span>
            <span className="text-sm font-bold text-amber-400">◈ {fmt(basket.totalCost)}</span>
          </div>

          {coverageCategories.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-wide text-zinc-500 uppercase">
                  Coverage vs. Need
                </span>
                <InfoTooltip content="Each bar shows how much of this hero's need in that category the basket currently covers. A full bar means this need is met — an empty one means it's still a gap." />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {coverageCategories.map((cat) => (
                  <CoverageRow
                    key={cat}
                    category={cat}
                    coverage={basket.coverage[cat] ?? 0}
                    target={basket.target[cat] ?? 0}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {unmetEntries.length > 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
              Still needs:{" "}
              {unmetEntries
                .map((e) => `${SCORE_CATEGORY_META[e.cat].label} (${e.value.toFixed(1)})`)
                .join(", ")}
            </div>
          ) : null}

          {resolvedPicks.length === 0 ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-xs text-zinc-500">
              No items were picked for this basket.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {resolvedPicks.map(({ pick, item }, index) => (
                <PickCard
                  key={pick.item.itemId}
                  pick={pick}
                  index={index}
                  item={item}
                  onAdd={onAdd}
                  slotsFull={slotsFull}
                  simplified={simplified}
                />
              ))}
            </div>
          )}

          {onAddAll && addAllItems.length > 0 ? (
            <button
              onClick={() => onAddAll(addAllItems)}
              disabled={slotsFull}
              className={`rounded-md border border-amber-500 px-3 py-2 text-xs font-semibold text-amber-400 ${
                slotsFull
                  ? "cursor-not-allowed opacity-40"
                  : "cursor-pointer bg-amber-500/10 hover:bg-amber-500/20"
              }`}
            >
              Add All {addAllItems.length} Basket Items
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
