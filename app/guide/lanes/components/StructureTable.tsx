import { LANE_STRUCTURES, TROOPER_WAVE_INTERVALS } from "@/lib/lanes/laneData";

export function StructureTable() {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800 text-xs text-zinc-400 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Structure</th>
              <th className="px-3 py-2 text-right">HP</th>
              <th className="px-3 py-2 text-right">Soul Reward</th>
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {LANE_STRUCTURES.map((structure) => (
              <tr key={structure.id} className="border-b border-zinc-800 bg-zinc-900">
                <td className="px-3 py-2 text-white">{structure.name}</td>
                <td className="px-3 py-2 text-right font-mono text-amber-400">
                  {structure.hp !== null ? structure.hp.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-green-400">
                  {structure.soulReward !== null ? structure.soulReward.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-zinc-400">{structure.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-6 mb-2 font-semibold text-white">Trooper Wave Cadence</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800 text-xs text-zinc-400 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Game Time</th>
              <th className="px-3 py-2 text-right">Spawn Interval</th>
            </tr>
          </thead>
          <tbody>
            {TROOPER_WAVE_INTERVALS.map((interval) => (
              <tr key={interval.fromMin} className="border-b border-zinc-800 bg-zinc-900">
                <td className="px-3 py-2 text-zinc-400">
                  {interval.fromMin}min – {interval.toMin !== null ? `${interval.toMin}min` : "end"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-amber-400">
                  {interval.intervalSeconds}s
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
