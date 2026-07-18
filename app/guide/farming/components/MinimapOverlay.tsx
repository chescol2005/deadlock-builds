"use client";

import { useState } from "react";
import { MINIMAP_URL, CAMP_MARKERS, MARKER_COLORS, CAMPS, soulsAt } from "@/lib/farming/campData";

// Base radius in SVG units (viewBox 0-100). Keep small — 50 markers on screen.
const R = 1.8;

function MarkerShape({
  campId,
  cx,
  cy,
  color,
}: {
  campId: string;
  cx: number;
  cy: number;
  color: string;
}) {
  const sw = 0.35;
  const triW = R * 0.866; // equilateral half-width
  const triB = cy + R * 0.5; // y of triangle base
  const pts = `${cx},${cy - R} ${cx - triW},${triB} ${cx + triW},${triB}`;

  // Sinner's Sacrifice — square with inner circle
  if (campId === "sinners_sacrifice") {
    return (
      <>
        <rect
          x={cx - R}
          y={cy - R}
          width={R * 2}
          height={R * 2}
          fill={color}
          stroke="white"
          strokeWidth={sw}
        />
        <circle cx={cx} cy={cy} r={R * 0.42} fill="none" stroke="white" strokeWidth={sw} />
      </>
    );
  }

  // Triangle base shared by all denizen tiers
  return (
    <>
      <polygon points={pts} fill={color} stroke="white" strokeWidth={sw} />
      {/* Medium — 1 line below triangle */}
      {(campId === "medium_denizen" || campId === "large_denizen") && (
        <line
          x1={cx - triW}
          y1={triB + 0.75}
          x2={cx + triW}
          y2={triB + 0.75}
          stroke="white"
          strokeWidth={sw}
        />
      )}
      {/* Hard — 2nd line below triangle */}
      {campId === "large_denizen" && (
        <line
          x1={cx - triW}
          y1={triB + 1.5}
          x2={cx + triW}
          y2={triB + 1.5}
          stroke="white"
          strokeWidth={sw}
        />
      )}
    </>
  );
}

const LEGEND_ENTRIES = [
  { campId: "small_denizen", label: "Small Camp" },
  { campId: "medium_denizen", label: "Medium Camp" },
  { campId: "large_denizen", label: "Hard Camp" },
  { campId: "sinners_sacrifice", label: "Sinner's Sacrifice" },
] as const;

export function MinimapOverlay() {
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);

  return (
    <div className="mt-8">
      <h3 className="mb-3 font-semibold text-white">Camp Locations</h3>
      <div className="relative max-w-md" style={{ aspectRatio: "1 / 1" }}>
        <img
          src={MINIMAP_URL}
          alt="Deadlock minimap"
          className="h-full w-full rounded-lg object-cover"
        />
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {CAMP_MARKERS.map((marker, i) => (
            <g
              key={i}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredMarkerId(String(i))}
              onMouseLeave={() => setHoveredMarkerId(null)}
            >
              {/* transparent hit area — larger than the visual so hover is easy */}
              <circle cx={marker.left} cy={marker.top} r={3} fill="transparent" />
              <MarkerShape
                campId={marker.campId}
                cx={marker.left}
                cy={marker.top}
                color={MARKER_COLORS[marker.campId] ?? "#71717a"}
              />
            </g>
          ))}
        </svg>

        {hoveredMarkerId !== null &&
          (() => {
            const marker = CAMP_MARKERS[Number(hoveredMarkerId)];
            const camp = CAMPS.find((c) => c.id === marker.campId);
            if (!camp) return null;
            const souls20 = soulsAt(camp, 20);
            return (
              <div
                className="pointer-events-none absolute z-10 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white"
                style={{
                  left: `${marker.left}%`,
                  top: `${marker.top - 8}%`,
                  transform: "translateX(-50%)",
                }}
              >
                <span className="font-semibold">{camp.name}</span>
                {souls20 !== null && (
                  <span className="ml-1 text-amber-400">~{souls20} souls @20min</span>
                )}
              </div>
            );
          })()}
      </div>

      {/* Legend — shows actual shapes, not just color dots */}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">
        {LEGEND_ENTRIES.map(({ campId, label }) => (
          <div key={campId} className="flex items-center gap-1.5">
            {/* viewBox sized to fit the tallest shape (hard camp with 2 lines) */}
            <svg width="11" height="13" viewBox="-2.5 -2.5 5 8">
              <MarkerShape
                campId={campId}
                cx={0}
                cy={0}
                color={MARKER_COLORS[campId] ?? "#71717a"}
              />
            </svg>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
