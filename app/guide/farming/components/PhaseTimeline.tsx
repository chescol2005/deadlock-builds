import { PHASE_CARDS, PILL_COLORS } from "@/lib/farming/campData";

export function PhaseTimeline() {
  return (
    <div>
      {PHASE_CARDS.map((card) => (
        <div key={card.phase} className="mb-3 rounded-lg border border-zinc-700 bg-zinc-800 p-4">
          <div className="flex items-center">
            <span className="font-semibold text-white">{card.phase}</span>
            <span className="ml-2 rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
              {card.timeRange}
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-300">{card.tip}</p>
          <div className="flex flex-wrap">
            {card.available.map((label) => (
              <span
                key={label}
                className={`mt-2 mr-1 rounded-full border px-2 py-0.5 text-xs ${
                  PILL_COLORS[label] ?? "border-zinc-600 text-zinc-400"
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
