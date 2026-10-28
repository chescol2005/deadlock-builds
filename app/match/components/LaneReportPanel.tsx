"use client";

import { useMemo, type ReactNode } from "react";
import { InfoTooltip } from "@/app/components/Tooltip";
import {
  LANE_END_S,
  LANE_NAMES,
  lastHitShare,
  shotAccuracy,
  type LanePlayer,
  type LaneReport,
  type LaneSnapshot,
} from "@/lib/matchReview";
import type { LaneItemView, MatchHeroInfo } from "../matchViewTypes";
import { MatchIcon } from "./MatchIcon";

export interface LaneReportPanelProps {
  report: LaneReport;
  heroes: ReadonlyMap<number, MatchHeroInfo>;
  items: ReadonlyArray<LaneItemView>;
  /** Simplified shows souls, soul gap, deaths and items. Advanced adds the numbers table. */
  simplified?: boolean;
}

type Tone = "good" | "neutral" | "bad";

const TONE_CLASS: Record<Tone, string> = {
  good: "border-green-500/40 bg-green-500/10 text-green-400",
  neutral: "border-zinc-600 bg-zinc-800 text-zinc-300",
  bad: "border-red-500/40 bg-red-500/10 text-red-400",
};

const LEAD_WORD = { ahead: "Ahead", even: "Even", behind: "Behind" } as const;
const LEAD_TONE: Record<keyof typeof LEAD_WORD, Tone> = {
  ahead: "good",
  even: "neutral",
  behind: "bad",
};
const TRADE_WORD = { won: "Won", even: "Even", lost: "Lost" } as const;
const TRADE_TONE: Record<keyof typeof TRADE_WORD, Tone> = {
  won: "good",
  even: "neutral",
  lost: "bad",
};

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtClock(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtPercent(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/** "+650" / "−650" with a real minus sign. */
function fmtSigned(n: number): string {
  const rounded = Math.round(n);
  if (rounded > 0) return `+${fmtNum(rounded)}`;
  if (rounded < 0) return `−${fmtNum(-rounded)}`;
  return "0";
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

function snapshotAt(p: LanePlayer, timeS: number): LaneSnapshot | undefined {
  return p.snapshots.find((s) => s.timeS === timeS);
}

interface HeaderProps {
  children: ReactNode;
  help?: string;
}

function Th({ children, help }: HeaderProps) {
  return (
    <th scope="col" className="px-2 py-1.5 text-left text-xs font-medium whitespace-nowrap">
      <span className="inline-flex items-center gap-1">
        {children}
        {help ? <InfoTooltip content={help} label={`About ${String(children)}`} /> : null}
      </span>
    </th>
  );
}

interface Row {
  key: string;
  label: string;
  heroName: string;
  player: LanePlayer;
}

export function LaneReportPanel({
  report,
  heroes,
  items,
  simplified = false,
}: LaneReportPanelProps) {
  const heroName = (id: number | null): string =>
    id === null ? "troopers or a structure" : (heroes.get(id)?.name ?? "an enemy");

  const rows = useMemo<Row[]>(() => {
    const name = (id: number) => heroes.get(id)?.name ?? "Unknown hero";
    return [
      { key: "you", label: "You", heroName: name(report.you.heroId), player: report.you },
      {
        key: "partner",
        label: "Partner",
        heroName: name(report.partner.heroId),
        player: report.partner,
      },
      {
        key: "opp1",
        label: "Opponent 1",
        heroName: name(report.opponents[0].heroId),
        player: report.opponents[0],
      },
      {
        key: "opp2",
        label: "Opponent 2",
        heroName: name(report.opponents[1].heroId),
        player: report.opponents[1],
      },
    ];
  }, [report, heroes]);

  const snapshotTimes = useMemo(() => report.you.snapshots.map((s) => s.timeS), [report.you]);

  const oppAverageSouls = useMemo(
    () => (report.opponents[0].atLaneEnd.souls + report.opponents[1].atLaneEnd.souls) / 2,
    [report.opponents],
  );

  const yourName = heroes.get(report.you.heroId)?.name ?? "Your hero";
  const laneName = LANE_NAMES[report.lane] ?? String(report.lane);
  const { judgements } = report;
  const gapWord = (gap: number) => `${fmtSigned(gap)} souls`;

  return (
    <section
      aria-label="Lane report"
      className="flex flex-col gap-4 rounded-lg border border-zinc-700 bg-zinc-900 p-3 sm:p-4"
    >
      <h2 className="text-base font-semibold text-white">
        {yourName} · {laneName} lane · first {Math.round(LANE_END_S / 60)} minutes
      </h2>

      {/* Souls */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-md border border-zinc-700 bg-zinc-800 p-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            Souls at {fmtClock(LANE_END_S)}
            <InfoTooltip
              content="Souls are the money you earn from trooper kills and fights. More souls means more items."
              label="About souls"
            />
          </div>
          <p className="text-2xl font-bold text-white">{fmtNum(report.you.atLaneEnd.souls)}</p>
          <p className="text-xs text-zinc-500">
            Opponent average: {fmtNum(Math.round(oppAverageSouls))}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm text-zinc-300">
              {gapWord(report.soulGap)} vs your lane opponents
            </span>
            <Pill tone={LEAD_TONE[judgements.souls]}>{LEAD_WORD[judgements.souls]}</Pill>
          </div>
        </div>

        <div className="flex flex-col gap-1 rounded-md border border-zinc-700 bg-zinc-800 p-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            Your lane (you and your partner)
            <InfoTooltip
              content="Your souls plus your partner's, against both opponents' souls added together."
              label="About the lane gap"
            />
          </div>
          <p className="text-2xl font-bold text-white">{gapWord(report.laneSoulGap)}</p>
          <div className="mt-1">
            <Pill tone={LEAD_TONE[judgements.lane]}>{LEAD_WORD[judgements.lane]}</Pill>
          </div>
        </div>
      </div>

      {/* Deaths */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-white">Deaths before {fmtClock(LANE_END_S)}</h3>
        {report.deaths.length === 0 ? (
          <p className="text-sm text-zinc-500">None</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {report.deaths.map((d) => (
              <li
                key={`${d.timeS}-${d.killerHeroId ?? "none"}`}
                className="flex flex-wrap items-center gap-2 text-sm text-zinc-300"
              >
                <span className="font-semibold text-white tabular-nums">{fmtClock(d.timeS)}</span>
                <span>killed by {heroName(d.killerHeroId)}</span>
                {d.gank ? (
                  <span className="inline-flex items-center gap-1">
                    <Pill tone="bad">gank</Pill>
                    <InfoTooltip
                      content="A gank is a kill by an enemy from another lane."
                      label="What is a gank?"
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Items */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-white">Items held at {fmtClock(LANE_END_S)}</h3>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">No items yet</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <li
                key={`${item.id}-${item.boughtAt}`}
                className="flex min-w-0 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 p-2"
              >
                <MatchIcon src={item.icon} name={item.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-white">{item.name}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {fmtNum(item.cost)} · {item.boughtAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Advanced numbers */}
      {simplified ? null : (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-white">The numbers</h3>
          <div className="overflow-x-auto rounded-md border border-zinc-700">
            <table className="w-full min-w-max border-collapse text-sm text-zinc-300">
              <thead className="bg-zinc-800 text-zinc-500">
                <tr>
                  <Th>Player</Th>
                  {snapshotTimes.map((t) => (
                    <Th key={t}>{`Souls ${fmtClock(t)}`}</Th>
                  ))}
                  <Th help="The last shot on a trooper pays its souls. The share is how many of the available troopers you finished.">
                    Last hits
                  </Th>
                  <Th help="Shooting the soul orb from an enemy's last hit before they claim it, so they lose those souls.">
                    Denies
                  </Th>
                  <Th help="Damage you dealt to enemy players by 9:00.">Damage dealt</Th>
                  <Th help="Damage you took from enemy players by 9:00.">Damage taken</Th>
                  <Th help="Shots that hit, out of all shots fired.">Accuracy</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const end = r.player.atLaneEnd;
                  return (
                    <tr
                      key={r.key}
                      className={`border-t border-zinc-700 ${r.key === "you" ? "bg-amber-500/5" : ""}`}
                    >
                      <th scope="row" className="px-2 py-1.5 text-left whitespace-nowrap">
                        <span className="block font-semibold text-white">{r.label}</span>
                        <span className="block text-xs font-normal text-zinc-500">
                          {r.heroName}
                        </span>
                      </th>
                      {snapshotTimes.map((t) => {
                        const snap = snapshotAt(r.player, t);
                        return (
                          <td key={t} className="px-2 py-1.5 tabular-nums">
                            {snap ? fmtNum(snap.souls) : "—"}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                        {fmtNum(end.lastHits)} ({fmtPercent(lastHitShare(end))})
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{fmtNum(end.denies)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{fmtNum(end.damageDealt)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{fmtNum(end.damageTaken)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{fmtPercent(shotAccuracy(end))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1 rounded-md border border-zinc-700 bg-zinc-800 p-2.5">
              <dt className="flex items-center gap-1.5 text-xs text-zinc-500">
                Trades
                <InfoTooltip
                  content="Trading is exchanging damage with the enemy. Won means you dealt clearly more than you took."
                  label="About trades"
                />
              </dt>
              <dd>
                <Pill tone={TRADE_TONE[judgements.trades]}>{TRADE_WORD[judgements.trades]}</Pill>
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-zinc-700 bg-zinc-800 p-2.5">
              <dt className="flex items-center gap-1.5 text-xs text-zinc-500">
                At 6:00
                <InfoTooltip
                  content="Your souls against the opponent average at 6:00. Falling behind early is hard to recover from."
                  label="About the 6:00 check"
                />
              </dt>
              <dd>
                {judgements.atSixMinutes === null ? (
                  <span className="text-sm text-zinc-500">—</span>
                ) : (
                  <Pill tone={LEAD_TONE[judgements.atSixMinutes]}>
                    {LEAD_WORD[judgements.atSixMinutes]}
                  </Pill>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-zinc-700 bg-zinc-800 p-2.5">
              <dt className="flex items-center gap-1.5 text-xs text-zinc-500">
                Last hits
                <InfoTooltip
                  content="Your share of available troopers finished, against the opponent average. The last shot on a trooper pays its souls."
                  label="About missed last hits"
                />
              </dt>
              <dd>
                {judgements.missedLastHits === null ? (
                  <span className="text-sm text-zinc-500">—</span>
                ) : judgements.missedLastHits ? (
                  <Pill tone="bad">Behind on last hits</Pill>
                ) : (
                  <Pill tone="neutral">Keeping up</Pill>
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
