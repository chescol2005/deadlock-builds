"use client";

import { useState, useMemo } from "react";
import { CAMPS, GAME_MINUTE_COLUMNS, soulsAt, soulsPerMinEfficiency } from "@/lib/farming/campData";

type SortKey = "tier" | "respawn" | "efficiency";

export function CampTable() {
  const [sortKey, setSortKey] = useState<SortKey>("efficiency");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedCamps = useMemo(() => {
    return [...CAMPS].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      if (sortKey === "tier") {
        aVal = a.tier ?? 99;
        bVal = b.tier ?? 99;
      } else if (sortKey === "respawn") {
        aVal = a.respawnSeconds;
        bVal = b.respawnSeconds;
      } else {
        aVal = soulsPerMinEfficiency(a, 20);
        bVal = soulsPerMinEfficiency(b, 20);
      }

      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [sortKey, sortDir]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "desc" ? " ↓" : " ↑";
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-800 text-xs text-zinc-400 uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Camp</th>
            <th
              className="cursor-pointer px-3 py-2 text-left select-none hover:text-white"
              onClick={() => handleSort("tier")}
            >
              Tier{sortIndicator("tier")}
            </th>
            <th className="px-3 py-2 text-left">First Spawn</th>
            <th
              className="cursor-pointer px-3 py-2 text-left select-none hover:text-white"
              onClick={() => handleSort("respawn")}
            >
              Respawn{sortIndicator("respawn")}
            </th>
            {GAME_MINUTE_COLUMNS.map((min) => (
              <th key={min} className="px-3 py-2 text-right">
                {min}m
              </th>
            ))}
            <th
              className="cursor-pointer px-3 py-2 text-right select-none hover:text-white"
              onClick={() => handleSort("efficiency")}
            >
              Souls/min{sortIndicator("efficiency")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedCamps.map((camp) => (
            <tr
              key={camp.id}
              className={`border-b border-zinc-800 bg-zinc-900 hover:bg-zinc-800 ${
                camp.id === "sinners_sacrifice" ? "border-l-2 border-l-purple-500" : ""
              }`}
            >
              <td className="px-3 py-2 text-white">{camp.name}</td>
              <td className="px-3 py-2 text-zinc-400">{camp.tier ?? "—"}</td>
              <td className="px-3 py-2 text-zinc-400">{camp.firstSpawnMin}:00</td>
              <td className="px-3 py-2 text-zinc-400">
                {Math.floor(camp.respawnSeconds / 60)}:
                {String(camp.respawnSeconds % 60).padStart(2, "0")}
              </td>
              {GAME_MINUTE_COLUMNS.map((min) => {
                const souls = soulsAt(camp, min);
                return (
                  <td key={min} className="px-3 py-2 text-right">
                    {souls === null ? (
                      <span className="text-zinc-600">—</span>
                    ) : (
                      <span className="font-mono text-sm text-amber-400">{souls}</span>
                    )}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right">
                <span className="font-mono text-sm font-semibold text-green-400">
                  {soulsPerMinEfficiency(camp, 20)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
