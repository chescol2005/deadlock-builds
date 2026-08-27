"use client";

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";

export type DataTableColumn<T> = {
  /** Stable id — used for sort state and as the React key for header/body cells. */
  key: string;
  /** Header text. */
  label: string;
  /** Defaults to true. A sortable column still needs `sortValue` to actually sort. */
  sortable?: boolean;
  /** Header + cell alignment. Defaults to "left". */
  align?: "left" | "right";
  /** Caller-supplied cell renderer — the table never introspects the row shape. */
  render: (row: T) => ReactNode;
  /** Comparable value for this column. Required in practice whenever `sortable !== false`. */
  sortValue?: (row: T) => number | string;
  /** Rare escape hatch for one-off header sizing (e.g. `w-12`). */
  headerClassName?: string;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  /** Shown in place of rows when `rows` is empty. Defaults to "No results." */
  emptyMessage?: string;
  /** Optional whole-row click handler. Callers mixing this with interactive cell
   *  content (a `<Link>` inside `render`) are responsible for `stopPropagation`. */
  onRowClick?: (row: T) => void;
};

type SortState = { key: string; dir: "asc" | "desc" };

// A column counts as sortable only if it opts in (the default) AND supplies a
// `sortValue`. A column marked sortable without one is treated as NOT sortable —
// its header stays inert — and a dev-only console warning is emitted rather than
// silently rendering a sort affordance that does nothing.
function isSortable<T>(column: DataTableColumn<T>): boolean {
  return column.sortable !== false && typeof column.sortValue === "function";
}

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Generic sortable table primitive. Styling matches the static guide tables
 * (see app/guide/lanes/components/StructureTable.tsx); the caller supplies
 * column definitions with render callbacks — the same "generic component +
 * render props" philosophy as app/guide/components/Minimap.tsx.
 *
 * Sort state is internal (uncontrolled) on purpose: page-level concerns like
 * search, filtering, and URL sync stay outside this component.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  initialSort,
  emptyMessage = "No results.",
  onRowClick,
}: DataTableProps<T>): ReactElement {
  const [sort, setSort] = useState<SortState | null>(() => {
    if (initialSort) {
      const target = columns.find((c) => c.key === initialSort.key);
      if (target && isSortable(target)) return initialSort;
    }
    const firstSortable = columns.find(isSortable);
    return firstSortable ? { key: firstSortable.key, dir: "asc" } : null;
  });

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    for (const column of columns) {
      if (column.sortable !== false && typeof column.sortValue !== "function") {
        console.warn(
          `DataTable: column "${column.key}" is sortable but has no sortValue() — rendering it as non-sortable.`,
        );
      }
    }
  }, [columns]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    const sortValue = column?.sortValue;
    if (!column || !sortValue) return rows;
    const direction = sort.dir === "asc" ? 1 : -1;
    // Spread first — never mutate the caller's array.
    return [...rows].sort((a, b) => compareValues(sortValue(a), sortValue(b)) * direction);
  }, [rows, columns, sort]);

  function handleHeaderClick(column: DataTableColumn<T>) {
    if (!isSortable(column)) return;
    setSort((current) =>
      current && current.key === column.key
        ? { key: column.key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key: column.key, dir: "asc" },
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-800 text-xs text-zinc-400 uppercase">
          <tr>
            {columns.map((column) => {
              const sortable = isSortable(column);
              const activeDir = sort && sort.key === column.key ? sort.dir : null;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    activeDir === null
                      ? undefined
                      : activeDir === "asc"
                        ? "ascending"
                        : "descending"
                  }
                  onClick={sortable ? () => handleHeaderClick(column) : undefined}
                  className={`px-3 py-2 ${column.align === "right" ? "text-right" : "text-left"} ${
                    sortable ? "cursor-pointer select-none hover:text-white" : ""
                  } ${activeDir ? "text-white" : ""} ${column.headerClassName ?? ""}`}
                >
                  {sortable ? (
                    // The <th> owns the click handler; this inner button exists so
                    // the sort is keyboard-reachable. Enter/Space fire a click that
                    // bubbles to the <th> — no separate key handler needed.
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 uppercase ${
                        column.align === "right" ? "flex-row-reverse" : ""
                      }`}
                    >
                      <span>{column.label}</span>
                      {activeDir ? (
                        <span aria-hidden="true" className="text-amber-400">
                          {activeDir === "asc" ? "▲" : "▼"}
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-b border-zinc-800 bg-zinc-900">
              <td colSpan={columns.length} className="px-3 py-6 text-center text-zinc-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-zinc-800 bg-zinc-900 ${
                  onRowClick ? "cursor-pointer hover:bg-zinc-800" : ""
                }`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2 ${
                      column.align === "right"
                        ? "text-right font-mono text-amber-400"
                        : "text-zinc-400"
                    }`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
