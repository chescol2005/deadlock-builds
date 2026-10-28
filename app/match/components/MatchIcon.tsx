"use client";

import Image from "next/image";

export interface MatchIconProps {
  /** Icon URL, or null/undefined when there is none. */
  src: string | null | undefined;
  /** Used for the initial-letter fallback. */
  name: string;
  /** "sm" is 24px, "md" is 36px. Defaults to "md". */
  size?: "sm" | "md";
}

// next/image only allows hosts listed in next.config.ts remotePatterns; anything
// else falls back to the initial rather than throwing at render.
const OPTIMIZED_HOST = "assets-bucket.deadlock-api.com";

const SIZES = {
  sm: { px: 24, box: "h-6 w-6" },
  md: { px: 36, box: "h-9 w-9" },
} as const;

function canOptimize(src: string): boolean {
  try {
    return new URL(src).hostname === OPTIMIZED_HOST;
  } catch {
    return false;
  }
}

/** Hero or item icon with an initial-letter fallback. */
export function MatchIcon({ src, name, size = "md" }: MatchIconProps) {
  const { px, box } = SIZES[size];
  if (src && canOptimize(src)) {
    return (
      <Image
        src={src}
        alt=""
        width={px}
        height={px}
        className={`${box} shrink-0 rounded-md object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} flex shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300`}
    >
      {name.charAt(0)}
    </span>
  );
}
