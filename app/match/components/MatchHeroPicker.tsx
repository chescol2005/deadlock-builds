"use client";

import type { LaneGroup, MatchHeroInfo } from "../matchViewTypes";
import { MatchIcon } from "./MatchIcon";

export interface MatchHeroPickerProps {
  lanes: ReadonlyArray<LaneGroup>;
  selectedHeroId: number | null;
  onSelect: (heroId: number) => void;
  /** Reserved for the shared panel convention; the picker has no veteran-only detail. */
  simplified?: boolean;
}

interface HeroButtonProps {
  hero: MatchHeroInfo;
  selected: boolean;
  onSelect: (heroId: number) => void;
}

function HeroButton({ hero, selected, onSelect }: HeroButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(hero.id)}
      className={`flex min-w-0 items-center gap-2 rounded-md border bg-zinc-800 p-2 text-left transition-colors hover:border-amber-500 pointer-coarse:min-h-10 ${
        selected ? "border-amber-500 bg-amber-500/10" : "border-zinc-700"
      }`}
    >
      <MatchIcon src={hero.icon} name={hero.name} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{hero.name}</span>
    </button>
  );
}

// `simplified` is part of the panel convention; picking a hero has no veteran-only detail.
export function MatchHeroPicker({ lanes, selectedHeroId, onSelect }: MatchHeroPickerProps) {
  return (
    <section
      aria-label="Pick your hero"
      className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4"
    >
      <h2 className="text-sm font-semibold text-white">Which hero were you?</h2>
      <ul className="flex flex-col gap-3">
        {lanes.map((group) => (
          <li
            key={group.lane}
            className="flex flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-950 p-2.5"
          >
            <p className="text-xs font-medium text-zinc-500">{group.laneName} lane</p>
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <div className="flex flex-col gap-2">
                {group.teams[0].map((hero) => (
                  <HeroButton
                    key={hero.id}
                    hero={hero}
                    selected={hero.id === selectedHeroId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
              <span className="text-center text-xs font-semibold text-zinc-500">vs</span>
              <div className="flex flex-col gap-2">
                {group.teams[1].map((hero) => (
                  <HeroButton
                    key={hero.id}
                    hero={hero}
                    selected={hero.id === selectedHeroId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
