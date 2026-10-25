"use client";

import { useMemo, useState } from "react";
import { Sparkles, CircleCheck, Package } from "lucide-react";
import type { Item, ItemPhase } from "@/lib/items";
import type { StarterBuild, StarterPhase } from "@/lib/engine/starterBuild";
import type { BasketPick } from "@/lib/engine/types";
import { InfoTooltip } from "@/app/components/Tooltip";
import { headlineReason, measuredPairReason } from "@/lib/basketReasons";
import { CATEGORY_STYLES, TermBreakdown, fmt } from "@/app/build/components/basketDisplay";

export interface StarterBuildPanelProps {
  /** Pre-computed by BuildClient via buildStarterBuild(); null = no hero data. The panel computes nothing. */
  starterBuild: StarterBuild | null;
  /** Items in the build now that applying would remove: owned components an upgrade trades in. Non-empty => confirm first. */
  removedOnApply: ReadonlyArray<Item>;
  /** The build already IS this suggested build (applied, unchanged since). */
  applied: boolean;
  /** Applies the build. The panel calls it directly, or after the inline confirm when removedOnApply is non-empty. */
  onApply: () => void;
  /** Hides veteran-only detail (per-term breakdowns). Defaults false. */
  simplified?: boolean;
}

const PHASE_META: Record<ItemPhase, { title: string; minutes: string; note: string }> = {
  early: { title: "Early game", minutes: "by ~10 min", note: "Start with these active" },
  mid: { title: "Mid game", minutes: "~20 min", note: "Added to your game plan" },
  late: { title: "Late game", minutes: "~30 min", note: "Added to your game plan" },
};

interface PickRowProps {
  pick: BasketPick | null;
  item: Item;
  index: number;
  simplified: boolean;
  /** Names of the items this pick upgrades (trades in). Usually empty. */
  consumedNames: ReadonlyArray<string>;
}

function PickRow({ pick, item, index, simplified, consumedNames }: PickRowProps) {
  const styles = CATEGORY_STYLES[item.category];
  const cost = pick?.effectiveCost ?? item.cost;
  const headline = pick ? headlineReason(pick.terms) : null;
  const measuredPair = pick ? measuredPairReason(pick.terms) : null;

  return (
    <li
      className={`flex flex-col gap-1.5 rounded-lg border-t border-r border-b border-zinc-700 border-l-4 ${styles.accentLeft} bg-zinc-900 p-2.5`}
    >
      <div className="flex items-center gap-2">
        <span className="w-4 shrink-0 text-center text-[10px] font-bold text-zinc-500">
          {index + 1}
        </span>
        {item.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.icon}
            alt={item.name}
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 rounded-md"
          />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-800">
            <Package size={12} className="text-zinc-600" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-white">{item.name}</div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className={`font-semibold capitalize ${styles.text}`}>{item.category}</span>
            <span>◈{fmt(cost)}</span>
          </div>
        </div>
      </div>

      {consumedNames.length > 0 ? (
        <div className="text-[11px] text-amber-300/90">
          Upgrades your {consumedNames.join(" and ")}, which you trade in, so it costs less.
        </div>
      ) : null}

      {simplified ? (
        <>
          {headline ? <div className="text-[11px] text-zinc-400 italic">{headline}</div> : null}
          {measuredPair ? (
            <div className="text-[11px] text-sky-300/80">
              <span className="mr-1 rounded border border-sky-400/30 px-1 text-[9px] font-semibold tracking-wide uppercase">
                Measured
              </span>
              {measuredPair}
            </div>
          ) : null}
        </>
      ) : pick && pick.terms.length > 0 ? (
        <TermBreakdown terms={pick.terms} />
      ) : null}
    </li>
  );
}

interface PhaseBlockProps {
  phase: StarterPhase;
  itemById: ReadonlyMap<string, Item>;
  simplified: boolean;
}

function PhaseBlock({ phase, itemById, simplified }: PhaseBlockProps) {
  const meta = PHASE_META[phase.phase];
  const pickById = useMemo(
    () => new Map(phase.basket.picks.map((p) => [p.item.itemId, p])),
    [phase.basket],
  );
  const spend = useMemo(
    () => phase.basket.picks.reduce((sum, p) => sum + p.effectiveCost, 0),
    [phase.basket],
  );

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 p-3">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-white">{meta.title}</h3>
          <span className="shrink-0 text-xs font-bold text-amber-400">◈{fmt(spend)}</span>
        </div>
        <div className="text-[11px] text-zinc-500">
          {meta.minutes} · ◈{fmt(phase.souls)}
        </div>
        <div className="mt-1 text-[11px] text-zinc-400">{meta.note}</div>
      </div>

      {phase.buyOrder.length === 0 ? (
        <div className="text-[11px] text-zinc-500 italic">Nothing new to add in this phase.</div>
      ) : (
        <ol className="flex flex-col gap-2">
          {phase.buyOrder.map((item, index) => {
            const pick = pickById.get(item.id) ?? null;
            return (
              <PickRow
                key={item.id}
                pick={pick}
                item={item}
                index={index}
                simplified={simplified}
                consumedNames={(pick?.consumes ?? []).map((id) => itemById.get(id)?.name ?? id)}
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function StarterBuildPanel({
  starterBuild,
  removedOnApply,
  applied,
  onApply,
  simplified = false,
}: StarterBuildPanelProps) {
  // The suggestion the open confirm was raised for. If the build changes while
  // it is open, the suggestion is a new object, so the confirm closes rather
  // than applying something the player never reviewed.
  const [confirmingFor, setConfirmingFor] = useState<StarterBuild | null>(null);
  const confirming =
    confirmingFor !== null && confirmingFor === starterBuild && removedOnApply.length > 0;
  const [showPlan, setShowPlan] = useState(false);

  // Name lookup for traded-in components: owned items and every phase's items.
  const itemById = useMemo(() => {
    const map = new Map<string, Item>();
    if (!starterBuild) return map;
    for (const item of starterBuild.ownedItems) map.set(item.id, item);
    for (const phase of starterBuild.phases) {
      for (const item of phase.items) map.set(item.id, item);
      for (const item of phase.consumed) map.set(item.id, item);
    }
    return map;
  }, [starterBuild]);

  // Owned items the plan keeps as they are (not traded in for an upgrade).
  const keptOwnedCount = useMemo(() => {
    if (!starterBuild) return 0;
    const consumed = new Set(starterBuild.phases.flatMap((p) => p.consumed.map((i) => i.id)));
    return starterBuild.ownedItems.filter((i) => !consumed.has(i.id)).length;
  }, [starterBuild]);

  // Everything the suggestion would add is already in the build (e.g. a shared
  // starter build reopened from its link): there is nothing to apply.
  const nothingToAdd = useMemo(
    () => starterBuild !== null && starterBuild.phases.every((p) => p.buyOrder.length === 0),
    [starterBuild],
  );

  const removedNames = useMemo(
    () => removedOnApply.map((i) => i.name).join(", "),
    [removedOnApply],
  );

  const handleStart = () => {
    if (removedOnApply.length === 0) onApply();
    else setConfirmingFor(starterBuild);
  };

  const handleConfirm = () => {
    setConfirmingFor(null);
    onApply();
  };

  return (
    <section className="@container flex flex-col gap-3">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles size={14} className="text-amber-400" />
        <span className="text-[11px] font-bold tracking-wide text-zinc-400 uppercase">
          Suggested Starter Build
        </span>
        <InfoTooltip content="A full early, mid and late game plan picked for this hero's kit. Each phase builds on the one before it, and the same hero with the same items always gets the same plan. Items you already have are kept." />
      </div>

      {!starterBuild ? (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-xs text-zinc-500">
          No suggested build is available for this hero yet.
        </div>
      ) : nothingToAdd && !applied ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-xs text-emerald-300">
          <CircleCheck size={14} className="shrink-0" />
          <span>
            Your build already covers every phase of the suggested build, so there is nothing to
            add.
          </span>
        </div>
      ) : (
        <>
          {!applied && keptOwnedCount > 0 ? (
            <div className="text-[11px] text-zinc-400">
              Keeps the {keptOwnedCount} {keptOwnedCount === 1 ? "item" : "items"} you already
              have and builds around them.
            </div>
          ) : null}

          {/* Once applied, the plan is already in the build below, so the
              phases fold away until the player asks to see the reasons. */}
          {!applied || showPlan ? (
            <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
              {starterBuild.phases.map((phase) => (
                <PhaseBlock
                  key={phase.phase}
                  phase={phase}
                  itemById={itemById}
                  simplified={simplified}
                />
              ))}
            </div>
          ) : null}

          {applied ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-xs text-emerald-300">
              <CircleCheck size={14} className="shrink-0" />
              <span className="min-w-0 flex-1">
                This is your build now — edit anything you like.
              </span>
              <button
                onClick={() => setShowPlan((v) => !v)}
                className="shrink-0 cursor-pointer rounded-md border border-emerald-600/50 px-2 py-1 font-semibold hover:bg-emerald-600/20"
              >
                {showPlan ? "Hide the plan" : "Show why each item"}
              </button>
            </div>
          ) : confirming ? (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="text-xs text-amber-200">
                This trades in {removedNames} for their upgrades. Continue?
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  className="cursor-pointer rounded-md border border-amber-500 bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                >
                  Apply
                </button>
                <button
                  onClick={() => setConfirmingFor(null)}
                  className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleStart}
              className="cursor-pointer rounded-md border border-amber-500 bg-amber-500 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
            >
              Start from this build
            </button>
          )}
        </>
      )}
    </section>
  );
}
