"use client";

import { useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import type { DeadlockHeroListItem } from "@/lib/heroApi";
import { HeroDifficultyBadge, HeroArchetypeTags } from "@/app/components/HeroDifficultyBadge";

// Landing-page component, not a build panel: it has no veteran-only detail to
// hide, so it does not take the `simplified` prop.
interface HomeHeroPickerProps {
  heroes: DeadlockHeroListItem[];
}

// next/image only allows hosts listed in next.config.ts remotePatterns. Every hero
// icon is on this host today; anything else falls back to the initial rather
// than throwing at render.
const OPTIMIZED_HOST = "assets-bucket.deadlock-api.com";

function canOptimize(src: string): boolean {
  try {
    return new URL(src).hostname === OPTIMIZED_HOST;
  } catch {
    return false;
  }
}

export function HomeHeroPicker({ heroes }: HomeHeroPickerProps) {
  const sorted = useMemo(() => [...heroes].sort((a, b) => a.name.localeCompare(b.name)), [heroes]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-center">
        <p className="text-zinc-300">Couldn&apos;t load heroes right now.</p>
        <Link
          href="/heroes"
          className="mt-3 inline-block text-sm font-medium text-amber-400 hover:text-amber-300"
        >
          Browse heroes →
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-8">
      {sorted.map((hero) => {
        const src = hero.images?.icon_image_small_webp ?? hero.images?.icon_image_small;
        return (
          <li key={hero.id}>
            <Link
              href={`/build/${hero.id}`}
              className="flex h-full flex-col items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-center transition-colors hover:border-amber-500"
            >
              {src && canOptimize(src) ? (
                <Image
                  src={src}
                  alt=""
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded-lg object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-xl font-bold text-zinc-300"
                >
                  {hero.name.charAt(0)}
                </span>
              )}
              <span className="w-full truncate text-sm font-medium text-white">{hero.name}</span>
              <HeroDifficultyBadge complexity={hero.complexity} />
              <HeroArchetypeTags tags={hero.tags?.slice(0, 2)} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
