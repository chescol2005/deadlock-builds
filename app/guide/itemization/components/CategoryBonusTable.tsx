import { CATEGORY_BONUS_TIERS } from "@/lib/categoryBonuses";

export function CategoryBonusTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-800 text-xs text-zinc-400 uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Souls in Category</th>
            <th className="px-3 py-2 text-right">Weapon Damage</th>
            <th className="px-3 py-2 text-right">Health</th>
            <th className="px-3 py-2 text-right">Spirit Power</th>
          </tr>
        </thead>
        <tbody>
          {CATEGORY_BONUS_TIERS.map((tier) => (
            <tr
              key={tier.soulsThreshold}
              className={`border-b border-zinc-800 bg-zinc-900 ${
                tier.isSignificant ? "border-l-2 border-l-amber-500" : ""
              }`}
            >
              <td className="px-3 py-2 text-white">
                {tier.soulsThreshold.toLocaleString()}
                {tier.isSignificant && (
                  <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-400">
                    Significant
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono text-orange-400">
                +{tier.weaponDamagePercent}%
              </td>
              <td className="px-3 py-2 text-right font-mono text-green-400">
                +{tier.healthBonus}%
              </td>
              <td className="px-3 py-2 text-right font-mono text-purple-400">
                +{tier.spiritPowerBonus}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-zinc-500">
        Souls invested within a single category (Weapon, Vitality, or Spirit) unlock a stacking
        bonus applied to every item in that category. The 4,800-soul &ldquo;Significant&rdquo; tier
        is where committing to one category starts meaningfully outscoring spreading souls across
        all three.
      </p>
    </div>
  );
}
