import Image from "next/image";
import Link from "next/link";
import { InfoTooltip } from "@/app/components/Tooltip";
import type { CompareColumn, CompareRow, CompareSortKey } from "@/lib/heroProfile/compare";
import { LEAN_COPY, METRIC_COPY, ordinal } from "@/lib/heroProfile/metricCopy";
import { LEAN_STYLES, RankBar } from "@/app/heroes/components/profileDisplay";

interface HeroCompareTableProps {
  rows: ReadonlyArray<CompareRow>;
  columns: ReadonlyArray<CompareColumn>;
  sortKey: CompareSortKey;
  sortOrder: "best" | "worst";
  onSort: (key: CompareSortKey) => void;
  /** Rank tier the rows were ranked at, carried into each hero link. */
  rankTier: number | null;
  rosterSize: number;
  /** New-player view: rank and bar only, no raw values. Default false. */
  simplified?: boolean;
}

// next/image only allows hosts in next.config.ts remotePatterns; any other
// host falls back to the hero's initial instead of throwing at render.
const ICON_HOST = "assets-bucket.deadlock-api.com";
function iconAllowed(src: string): boolean {
  try {
    return new URL(src).hostname === ICON_HOST;
  } catch {
    return false;
  }
}

function SortButton({
  label,
  active,
  order,
  onClick,
}: {
  label: string;
  active: boolean;
  order: "best" | "worst";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-left text-[11px] font-semibold tracking-wide uppercase pointer-coarse:min-h-10 ${active ? "text-amber-300" : "text-zinc-400 hover:text-zinc-200"}`}
    >
      {label}
      <span aria-hidden className="text-[10px]">
        {active ? (order === "best" ? "▼" : "▲") : "↕"}
      </span>
    </button>
  );
}

export function HeroCompareTable({
  rows,
  columns,
  sortKey,
  sortOrder,
  onSort,
  rankTier,
  rosterSize,
  simplified = false,
}: HeroCompareTableProps) {
  const ariaSort = (key: CompareSortKey) =>
    sortKey === key ? (sortOrder === "best" ? "descending" : "ascending") : "none";
  const heroHref = (id: number) =>
    rankTier != null ? `/heroes/${id}?rank=${rankTier}` : `/heroes/${id}`;

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full min-w-[640px] text-xs">
        <thead className="bg-zinc-900/80">
          <tr className="border-b border-zinc-800">
            <th className="px-3 py-2 text-left" aria-sort={ariaSort("name")}>
              <SortButton
                label="Hero"
                active={sortKey === "name"}
                order={sortOrder}
                onClick={() => onSort("name")}
              />
            </th>
            <th className="px-3 py-2 text-left" aria-sort={ariaSort("lean")}>
              <span className="inline-flex items-center gap-1">
                <SortButton
                  label="Lean"
                  active={sortKey === "lean"}
                  order={sortOrder}
                  onClick={() => onSort("lean")}
                />
                <InfoTooltip content="Where the hero's late-game strength is: Gun (strong gun, weaker ability scaling), Spirit (the reverse), Hybrid (both strong) or Flexible (neither stands out)." />
              </span>
            </th>
            {columns.map((col) => (
              <th key={col.id} className="px-3 py-2 text-left" aria-sort={ariaSort(col.id)}>
                <span className="inline-flex items-center gap-1">
                  <SortButton
                    label={col.label}
                    active={sortKey === col.id}
                    order={sortOrder}
                    onClick={() => onSort(col.id)}
                  />
                  <InfoTooltip content={METRIC_COPY[col.id].help} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.heroId}
              className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900/40"
            >
              <td className="px-3 py-2">
                <Link
                  href={heroHref(row.heroId)}
                  className="flex items-center gap-2 font-semibold text-zinc-100 hover:text-amber-300 pointer-coarse:min-h-10"
                >
                  {row.icon && iconAllowed(row.icon) ? (
                    <Image src={row.icon} alt="" width={24} height={24} className="rounded" />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-[10px] text-zinc-400">
                      {row.name.slice(0, 1)}
                    </span>
                  )}
                  {row.name}
                </Link>
              </td>
              <td className="px-3 py-2">
                {row.lean ? (
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${LEAN_STYLES[row.lean]}`}
                  >
                    {LEAN_COPY[row.lean].label}
                  </span>
                ) : (
                  <span className="text-zinc-600">—</span>
                )}
                {!simplified && row.scalesIntoLongFights ? (
                  <span className="ml-1.5 text-[10px] text-sky-300">long fights</span>
                ) : null}
              </td>
              {columns.map((col) => {
                const cell = row.cells[col.id];
                return (
                  <td key={col.id} className="px-3 py-2">
                    {cell.rank != null ? (
                      <div className="min-w-24">
                        <div className="flex items-baseline justify-between gap-2 tabular-nums">
                          <span className="text-zinc-200">{ordinal(cell.rank)}</span>
                          {!simplified && cell.value != null ? (
                            <span className="text-[11px] text-zinc-500">
                              {METRIC_COPY[col.id].format(cell.value)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1">
                          <RankBar rank={cell} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                    {col.id === "landedDps" && row.accuracyEstimated && !simplified ? (
                      <span className="mt-0.5 block text-[10px] text-zinc-500">est. accuracy</span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-500">
        {rosterSize} heroes at boon 30 (about 30,000 souls), no items. Ranks are against the whole
        roster; a dash means the data isn&apos;t there for that hero.
      </p>
    </div>
  );
}
