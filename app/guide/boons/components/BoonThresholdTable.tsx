import { BOON_THRESHOLDS } from "@/lib/boonSystem";

export function BoonThresholdTable() {
  return (
    <div className="max-h-[28rem] overflow-x-auto overflow-y-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-zinc-800 text-xs text-zinc-400 uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Boon Level</th>
            <th className="px-3 py-2 text-right">Souls Earned</th>
            <th className="px-3 py-2 text-right">Ability Points</th>
            <th className="px-3 py-2 text-left">Unlocks</th>
          </tr>
        </thead>
        <tbody>
          {BOON_THRESHOLDS.map((t) => (
            <tr
              key={t.boonLevel}
              className={`border-b border-zinc-800 bg-zinc-900 ${
                t.isUltimateUnlock ? "border-l-2 border-l-purple-500" : ""
              }`}
            >
              <td className="px-3 py-2 text-white">{t.boonLevel}</td>
              <td className="px-3 py-2 text-right font-mono text-amber-400">
                {t.souls.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right font-mono text-green-400">{t.abilityPoints}</td>
              <td className="px-3 py-2 text-zinc-400">
                {t.isUltimateUnlock ? (
                  <span className="text-purple-400">Ultimate</span>
                ) : t.abilityUnlock ? (
                  <span className="text-amber-400">Ability Slot</span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
