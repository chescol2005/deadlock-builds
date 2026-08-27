"use client";

import { useState, type ReactNode } from "react";

export interface MinimapMarker {
  id: string;
  left: number;
  top: number;
}

interface MinimapProps<M extends MinimapMarker> {
  imageUrl: string;
  imageAlt: string;
  markers: M[];
  renderMarker: (marker: M, isHovered: boolean) => ReactNode;
  renderTooltip?: (marker: M) => ReactNode;
  legend?: ReactNode;
  title?: string;
}

// Shared minimap-overlay shell for guide pages: an image with an SVG marker
// layer on top. Callers supply marker data and render functions so the shape
// language (triangles, squares, colors) stays specific to each guide topic
// while the hover/tooltip/legend plumbing is written once.
export function Minimap<M extends MinimapMarker>({
  imageUrl,
  imageAlt,
  markers,
  renderMarker,
  renderTooltip,
  legend,
  title,
}: MinimapProps<M>) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredMarker = markers.find((m) => m.id === hoveredId) ?? null;

  return (
    <div className="mt-8">
      {title ? <h3 className="mb-3 font-semibold text-white">{title}</h3> : null}
      <div className="relative max-w-md" style={{ aspectRatio: "1 / 1" }}>
        <img src={imageUrl} alt={imageAlt} className="h-full w-full rounded-lg object-cover" />
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {markers.map((marker) => (
            <g
              key={marker.id}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredId(marker.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* transparent hit area — larger than the visual so hover is easy */}
              <circle cx={marker.left} cy={marker.top} r={3} fill="transparent" />
              {renderMarker(marker, marker.id === hoveredId)}
            </g>
          ))}
        </svg>

        {hoveredMarker && renderTooltip ? (
          <div
            className="pointer-events-none absolute z-10 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-white"
            style={{
              left: `${hoveredMarker.left}%`,
              top: `${hoveredMarker.top - 8}%`,
              transform: "translateX(-50%)",
            }}
          >
            {renderTooltip(hoveredMarker)}
          </div>
        ) : null}
      </div>

      {legend ? (
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">{legend}</div>
      ) : null}
    </div>
  );
}
