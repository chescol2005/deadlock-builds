"use client";

import { Minimap, type MinimapMarker } from "@/app/guide/components/Minimap";
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

interface CampMinimapMarker extends MinimapMarker {
  campId: string;
}

const MARKERS: CampMinimapMarker[] = CAMP_MARKERS.map((marker, i) => ({
  id: `${marker.campId}-${i}`,
  left: marker.left,
  top: marker.top,
  campId: marker.campId,
}));

const LEGEND = (
  <>
    {LEGEND_ENTRIES.map(({ campId, label }) => (
      <div key={campId} className="flex items-center gap-1.5">
        {/* viewBox sized to fit the tallest shape (hard camp with 2 lines) */}
        <svg width="11" height="13" viewBox="-2.5 -2.5 5 8">
          <MarkerShape campId={campId} cx={0} cy={0} color={MARKER_COLORS[campId] ?? "#71717a"} />
        </svg>
        {label}
      </div>
    ))}
  </>
);

export function MinimapOverlay() {
  return (
    <Minimap
      title="Camp Locations"
      imageUrl={MINIMAP_URL}
      imageAlt="Deadlock minimap"
      markers={MARKERS}
      legend={LEGEND}
      renderMarker={(marker) => (
        <MarkerShape
          campId={marker.campId}
          cx={marker.left}
          cy={marker.top}
          color={MARKER_COLORS[marker.campId] ?? "#71717a"}
        />
      )}
      renderTooltip={(marker) => {
        const camp = CAMPS.find((c) => c.id === marker.campId);
        if (!camp) return null;
        const souls20 = soulsAt(camp, 20);
        return (
          <>
            <span className="font-semibold">{camp.name}</span>
            {souls20 !== null && (
              <span className="ml-1 text-amber-400">~{souls20} souls @20min</span>
            )}
          </>
        );
      }}
    />
  );
}
