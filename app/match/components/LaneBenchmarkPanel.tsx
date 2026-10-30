"use client";

import { useMemo, type ReactNode } from "react";
import { InfoTooltip } from "@/app/components/Tooltip";
import { LANE_END_S, type BenchmarkStat, type TypicalJudgement } from "@/lib/matchReview";
import type { BenchmarkView, RankOption } from "../matchViewTypes";

export interface LaneBenchmarkPanelProps {
  heroName: string;
  /** "All ranks" first, then each rank tier. */
  ranks: ReadonlyArray<RankOption>;
  /** The bracket shown; null = all ranks. */
  tier: number | null;
  onTierChange: (tier: number | null) => void;
  view: BenchmarkView;
  /** Simplified shows one sentence about souls; advanced adds the five-stat table. */
  simplified?: boolean;
}

type Tone = "good" | "neutral" | "bad";

const TONE_CLASS: Record<Tone, string> = {
  good: "border-green-500/40 bg-green-500/10 text-green-400",
  neutral: "border-zinc-600 bg-zinc-800 text-zinc-300",
  bad: "border-red-500/40 bg-red-500/10 text-red-400",
};

const JUDGEMENT: Record<TypicalJudgement, { word: string; tone: Tone }> = {
  above: { word: "Above typical", tone: "good" },
  typical: { word: "Typical", tone: "neutral" },
  below: { word: "Below typical", tone: "bad" },
};

const STAT_LABEL: Record<BenchmarkStat, string> = {
  souls: "Souls",
  lastHits: "Last hits",
  denies: "Denies",
  damageDealt: "Damage dealt",
  deaths: "Deaths",
};

/** Counts that are small enough to need a decimal in the average. */
const DECIMAL_STATS: ReadonlySet<BenchmarkStat> = new Set(["lastHits", "denies", "deaths"]);

const TYPICAL_HELP =
  "Typical is the average player on this hero at the rank you pick, over the last 30 days. Above or below means more than one standard deviation away: about two in three players are within it.";

const ALL_RANKS_VALUE = "all";

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtStat(stat: BenchmarkStat, n: number): string {
  return DECIMAL_STATS.has(stat)
    ? n.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 })
    : fmtNum(Math.round(n));
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function LaneBenchmarkPanel({
  heroName,
  ranks,
  tier,
  onTierChange,
  view,
  simplified = false,
}: LaneBenchmarkPanelProps) {
  const rankName = ranks.find((r) => r.tier === tier)?.name ?? "All ranks";
  const benchmark = view.status === "ok" ? view.benchmark : null;
  const souls = useMemo(
    () => benchmark?.stats.find((s) => s.stat === "souls") ?? null,
    [benchmark],
  );
  const minute = Math.round(LANE_END_S / 60);

  return (
    <section
      aria-label="Against a typical player"
      className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-white">
          Against a typical {heroName}
          <InfoTooltip content={TYPICAL_HELP} label="What is typical?" />
        </h2>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Rank
          <select
            value={tier === null ? ALL_RANKS_VALUE : String(tier)}
            onChange={(e) =>
              onTierChange(e.target.value === ALL_RANKS_VALUE ? null : Number(e.target.value))
            }
            className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-white pointer-coarse:min-h-10"
          >
            {ranks.map((r) => (
              <option key={r.tier ?? ALL_RANKS_VALUE} value={r.tier ?? ALL_RANKS_VALUE}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {view.status === "loading" ? (
        <p className="text-sm text-zinc-500">Loading typical-player numbers…</p>
      ) : view.status === "none" ? (
        <p className="text-sm text-zinc-500">{view.message}</p>
      ) : (
        <>
          {souls ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
              <span>
                A typical {heroName} ({rankName}) has about{" "}
                {fmtNum(Math.round(souls.avg / 50) * 50)} souls at {minute}:00. You had{" "}
                {fmtNum(souls.you)}.
              </span>
              {souls.judgement ? (
                <Pill tone={JUDGEMENT[souls.judgement].tone}>
                  {JUDGEMENT[souls.judgement].word}
                </Pill>
              ) : null}
            </div>
          ) : null}

          {simplified || !benchmark ? null : (
            <div className="overflow-x-auto rounded-md border border-zinc-700">
              <table className="w-full min-w-max border-collapse text-sm text-zinc-300">
                <thead className="bg-zinc-800 text-xs text-zinc-500">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      At {minute}:00
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      You
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      Typical (avg ± std)
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      <span className="sr-only">Judgement</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {benchmark.stats.map((s) => (
                    <tr key={s.stat} className="border-t border-zinc-700">
                      <th scope="row" className="px-2 py-1.5 text-left font-medium text-white">
                        {STAT_LABEL[s.stat]}
                      </th>
                      <td className="px-2 py-1.5 tabular-nums">{fmtNum(s.you)}</td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {fmtStat(s.stat, s.avg)} ± {fmtStat(s.stat, s.std)}
                      </td>
                      <td className="px-2 py-1.5">
                        {s.judgement ? (
                          <Pill tone={JUDGEMENT[s.judgement].tone}>
                            {JUDGEMENT[s.judgement].word}
                          </Pill>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {benchmark ? (
            <p className="text-xs text-zinc-500">
              {rankName} · {fmtNum(benchmark.snapshots)} players at {minute}:00 · last 30 days
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
