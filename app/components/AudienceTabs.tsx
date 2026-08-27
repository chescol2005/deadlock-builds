"use client";

interface AudienceTabsProps<T extends string> {
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

// Shared constant for guide pages: new player vs. advanced audience tabs.
export const GUIDE_AUDIENCE_TABS = [
  { value: "new_player", label: "New Player" },
  { value: "advanced", label: "Advanced" },
] as const;

// Reusable two-(or more-)audience tab switcher, extracted from the farming
// guide's original new-player/advanced tabs so every guide page — and the
// build planner's simplified/advanced toggle — gets progressive disclosure
// for free instead of a re-implemented one-off.
export function AudienceTabs<T extends string>({ tabs, value, onChange }: AudienceTabsProps<T>) {
  return (
    <div className="flex gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={
            value === tab.value
              ? "rounded-lg bg-amber-500 px-4 py-2 font-semibold text-zinc-900"
              : "rounded-lg bg-zinc-800 px-4 py-2 text-zinc-400 hover:text-white"
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
