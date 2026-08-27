"use client";

import { Minimap, type MinimapMarker } from "@/app/guide/components/Minimap";
import {
  LANE_MINIMAP_URL,
  LANE_MINIMAP_MARKERS,
  LANE_STRUCTURES,
  STRUCTURE_MARKER_COLORS,
} from "@/lib/lanes/laneData";

const STRUCTURE_RADIUS: Record<string, number> = {
  guardian: 1.6,
  walker: 2.1,
  base_guardian: 1.6,
  patron: 2.6,
};

function StructureShape({
  structureId,
  cx,
  cy,
  color,
}: {
  structureId: string;
  cx: number;
  cy: number;
  color: string;
}) {
  const r = STRUCTURE_RADIUS[structureId] ?? 1.8;
  return <circle cx={cx} cy={cy} r={r} fill={color} stroke="white" strokeWidth={0.35} />;
}

const LEGEND_ENTRIES = [
  { structureId: "guardian", label: "Guardian" },
  { structureId: "walker", label: "Walker" },
  { structureId: "patron", label: "Patron" },
] as const;

interface StructureMinimapMarker extends MinimapMarker {
  structureId: string;
}

const MARKERS: StructureMinimapMarker[] = LANE_MINIMAP_MARKERS.map((marker, i) => ({
  id: `${marker.structureId}-${marker.laneId}-${marker.side}-${i}`,
  left: marker.left,
  top: marker.top,
  structureId: marker.structureId,
}));

const LEGEND = (
  <>
    {LEGEND_ENTRIES.map(({ structureId, label }) => (
      <div key={structureId} className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="-3 -3 6 6">
          <StructureShape
            structureId={structureId}
            cx={0}
            cy={0}
            color={STRUCTURE_MARKER_COLORS[structureId] ?? "#71717a"}
          />
        </svg>
        {label}
      </div>
    ))}
  </>
);

export function LaneMinimapOverlay() {
  return (
    <Minimap
      title="Lane Structures"
      imageUrl={LANE_MINIMAP_URL}
      imageAlt="Deadlock minimap"
      markers={MARKERS}
      legend={LEGEND}
      renderMarker={(marker) => (
        <StructureShape
          structureId={marker.structureId}
          cx={marker.left}
          cy={marker.top}
          color={STRUCTURE_MARKER_COLORS[marker.structureId] ?? "#71717a"}
        />
      )}
      renderTooltip={(marker) => {
        const structure = LANE_STRUCTURES.find((s) => s.id === marker.structureId);
        if (!structure) return null;
        return (
          <>
            <span className="font-semibold">{structure.name}</span>
            {structure.hp !== null && (
              <span className="ml-1 text-amber-400">{structure.hp.toLocaleString()} HP</span>
            )}
          </>
        );
      }}
    />
  );
}
