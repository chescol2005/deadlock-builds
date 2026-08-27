import { Tooltip } from "./Tooltip";

const DIFFICULTY_LABELS = ["Easy", "Moderate", "Hard"] as const;

// Complexity (1-3) and archetype tags come straight from the hero detail
// endpoint (see DeadlockHeroDetail) — this just renders what the API already
// gives us, since the product philosophy calls these "first-class" and they
// were previously fetched but never displayed anywhere.
export function HeroDifficultyBadge({ complexity }: { complexity?: number }) {
  if (complexity == null) return null;
  const level = Math.max(1, Math.min(3, Math.round(complexity)));
  const label = DIFFICULTY_LABELS[level - 1];

  return (
    <Tooltip
      content={`Difficulty: ${label} (${level}/3) — Valve's official complexity rating for this hero.`}
    >
      <span className="inline-flex items-center gap-0.5" aria-label={`Difficulty: ${label}`}>
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= level ? "text-amber-400" : "text-zinc-700"}>
            ●
          </span>
        ))}
      </span>
    </Tooltip>
  );
}

export function HeroArchetypeTags({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400"
        >
          {t}
        </span>
      ))}
    </div>
  );
}
