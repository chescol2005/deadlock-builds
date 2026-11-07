import { InfoTooltip } from "@/app/components/Tooltip";
import type { FightLength } from "@/lib/heroProfile/fight";
import {
  GATE_COPY,
  LEAN_COPY,
  METRIC_COPY,
  METRIC_GROUP_LABELS,
  POOL_LABELS,
  rankLabel,
} from "@/lib/heroProfile/metricCopy";
import type { MetricGroup } from "@/lib/heroProfile/metrics";
import type { AbilityRow, HeroRankView, MetricRow, RankCell } from "@/lib/heroProfile/view";

interface HeroRosterRankPanelProps {
  heroName: string;
  view: HeroRankView;
  /** New-player view: lead metrics, the lean and one line per ability. Default false. */
  simplified?: boolean;
}

const GROUP_ORDER: MetricGroup[] = ["gun", "spirit", "vitality", "melee"];

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

function barWidth(percentile: number): string {
  const i = Math.min(20, Math.max(0, Math.round(percentile / 5)));
  return BAR_WIDTHS[i] ?? "w-[0%]";
}

function barColor(percentile: number): string {
  if (percentile >= 65) return "bg-amber-400";
  if (percentile >= 50) return "bg-amber-500/60";
  return "bg-zinc-500";
}

const LEAN_STYLES = {
  gun: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  spirit: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  hybrid: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  flexible: "border-zinc-600 bg-zinc-800/60 text-zinc-300",
} as const;

function RankBar({ rank }: { rank: RankCell | null }) {
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

function MetricLine({ row, simplified }: { row: MetricRow; simplified: boolean }) {
  const copy = METRIC_COPY[row.id];
  const label = row.lead ? (
    <span className="font-semibold text-zinc-100">{row.label}</span>
  ) : (
    <span className="text-zinc-300">{row.label}</span>
  );
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="flex items-center gap-1.5">
          {label}
          <InfoTooltip content={copy.help} />
        </span>
        <span className="text-right text-zinc-100 tabular-nums">
          {row.value != null ? copy.format(row.value) : "—"}
          {!simplified && row.boon0 != null && row.value != null && row.boon0 !== row.value ? (
            <span className="ml-1.5 text-[11px] text-zinc-500">
              ({copy.format(row.boon0)} at start)
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <RankBar rank={row.rank} />
        <span className="shrink-0 text-[11px] text-zinc-400 tabular-nums">
          {row.rank ? rankLabel(row.rank.rank, row.rank.n, row.rank.percentile) : "no data"}
        </span>
      </div>
    </div>
  );
}

const num2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;

function castsText(row: AbilityRow, f: FightLength): string {
  if (row.damageSeconds) return `${num2(row.damageSeconds[f])} s of damage`;
  const c = row.casts[f];
  return c == null ? "—" : `${num2(c)} avg casts`;
}

function AbilityCard({ row, simplified }: { row: AbilityRow; simplified: boolean }) {
  const ranked = row.scalingPerCastRank;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-100">
          {row.name}
          {row.isUltimate ? (
            <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 uppercase">
              Ultimate
            </span>
          ) : null}
        </span>
        <span className="text-[11px] text-zinc-400">{POOL_LABELS[row.pool]}</span>
      </div>

      {ranked ? (
        <div className="mt-2">
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-300">
            <span className="flex items-center gap-1.5">
              Scaling per cast
              <InfoTooltip
                content={
                  row.pool === "spirit"
                    ? "Extra damage of one cast for each point of spirit power, fully upgraded. Ranked against every spirit-scaling ability in the game."
                    : "Extra damage of one cast per weapon damage, fully upgraded. Ranked against the other weapon-scaling abilities."
                }
              />
            </span>
            <span className="text-[11px] text-zinc-400 tabular-nums">
              {rankLabel(ranked.rank, ranked.n, ranked.percentile)}
            </span>
          </div>
          <div className="mt-1">
            <RankBar rank={ranked} />
          </div>
        </div>
      ) : row.baseDamageRank ? (
        <p className="mt-2 text-xs text-zinc-400">
          Fixed damage: doesn&apos;t grow with spirit or weapon items. Base damage{" "}
          {rankLabel(row.baseDamageRank.rank, row.baseDamageRank.n, row.baseDamageRank.percentile)}.
        </p>
      ) : (
        <p className="mt-2 text-xs text-zinc-400">
          No damage the data can read, so it isn&apos;t ranked. Its value is its effect.
        </p>
      )}

      {row.pool !== "utility" ? (
        <p className="mt-2 text-[11px] text-zinc-500">{GATE_COPY[row.gate]}</p>
      ) : null}

      {!simplified && row.pool !== "utility" ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
          {(["short", "long"] as const).map((f) => (
            <div key={f} className="rounded border border-zinc-800 p-2">
              <div className="font-semibold text-zinc-300">
                {f === "short" ? "Short fight (10 s)" : "Long fight (30 s)"}
              </div>
              <div className="tabular-nums">{castsText(row, f)}</div>
              {row.scaling[f] != null ? (
                <div className="tabular-nums">
                  {num2(row.scaling[f] ?? 0)} per {row.pool === "weapon" ? "weapon dmg" : "spirit"}
                  {row.scalingRank[f] ? (
                    <span className="text-zinc-500">
                      {" · "}
                      {rankLabel(
                        row.scalingRank[f].rank,
                        row.scalingRank[f].n,
                        row.scalingRank[f].percentile,
                      )}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!simplified && row.cdr.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300">
            Cooldown items
            <InfoTooltip content="A top-quarter ability: what each cooldown reduction setup adds in casts and damage. The highlighted row is the best gain per soul. This doesn't change any rank above, which are all without items." />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-zinc-400 tabular-nums">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1 pr-2 font-normal">Setup</th>
                  <th className="py-1 pr-2 font-normal">Short</th>
                  <th className="py-1 font-normal">Long</th>
                </tr>
              </thead>
              <tbody>
                {row.cdr.map((c) => (
                  <tr key={c.setupId} className="border-t border-zinc-800">
                    <td className="py-1 pr-2 text-zinc-300">
                      {c.label}{" "}
                      <span className="text-zinc-500">({c.souls.toLocaleString("en-US")})</span>
                    </td>
                    {(["short", "long"] as const).map((f) => (
                      <td
                        key={f}
                        className={`py-1 pr-2 ${c.best[f] ? "font-semibold text-amber-300" : ""}`}
                      >
                        {c.gain[f] > 1e-9
                          ? `${num2(c.casts[f])} casts, ${pct(c.gain[f])}`
                          : "adds nothing"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!simplified && row.fireRateStep ? (
        <p className="mt-2 text-[11px] text-zinc-500">
          +10% fire rate: +{num2(row.fireRateStep.short)} cards in a short fight, +
          {num2(row.fireRateStep.long)} in a long one.
        </p>
      ) : null}
    </div>
  );
}

export function HeroRosterRankPanel({
  heroName,
  view,
  simplified = false,
}: HeroRosterRankPanelProps) {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    rows: view.metrics.filter((m) => m.group === group && (!simplified || m.lead)),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {view.lean ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${LEAN_STYLES[view.lean]}`}
          >
            {LEAN_COPY[view.lean].label}
            <InfoTooltip content={LEAN_COPY[view.lean].help} label="What the lean means" />
          </span>
        ) : (
          <span className="text-xs text-zinc-500">
            No lean: part of this hero&apos;s data is missing.
          </span>
        )}
        {view.scalesIntoLongFights ? (
          <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs text-sky-300">
            Scales into long fights
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {groups.map(({ group, rows }) => (
          <div key={group} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-1 text-xs font-bold tracking-wide text-zinc-500 uppercase">
              {METRIC_GROUP_LABELS[group]}
            </h3>
            <div className="divide-y divide-zinc-800/60">
              {rows.map((row) => (
                <MetricLine key={row.id} row={row} simplified={simplified} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {view.abilities.length > 0 ? (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide text-zinc-500 uppercase">
            {heroName}&apos;s abilities against every ability in the game
            <InfoTooltip content="Each ability fully upgraded (all three tiers). At 30k souls you can't max all four, so this is each ability's ceiling, not your kit at that point." />
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {view.abilities.map((row) => (
              <AbilityCard key={row.classname} row={row} simplified={simplified} />
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-[11px] text-zinc-500">
        Compared with all {view.rosterSize} heroes at boon {view.evalBoon} (about 30,000 souls),
        with no items.
        {view.accuracy != null
          ? ` Gun numbers use ${Math.round(view.accuracy * 100)}% accuracy${view.accuracyEstimated ? " (estimated: no shot data for this hero, so the roster median)" : ""}. Abilities are assumed to hit.`
          : " No accuracy data, so landed DPS isn't ranked."}
      </p>
    </div>
  );
}
