import type { HeroAbility } from "@/lib/abilityCoefficients";

const TIER_COSTS = [1, 2, 5] as const;

const DAMAGE_TYPE_LABELS: Record<HeroAbility["damageType"], string> = {
  spirit: "Spirit Damage",
  weapon: "Weapon Damage",
  mixed: "Mixed Damage",
  none: "No Damage",
};

function StatPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold text-zinc-200">{value}</span>
    </div>
  );
}

// Read-only reference display of the same HeroAbility data the build
// planner's AbilityLevelingPanel renders interactively — no level buttons,
// no point budget, no simplified toggle. Always shows full detail since this
// is a hero-info page, not the build planner.
function AbilityCard({ ability }: { ability: HeroAbility }) {
  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-3">
        {ability.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ability.icon}
            alt={ability.name}
            width={44}
            height={44}
            className="rounded-lg"
          />
        ) : (
          <div className="h-11 w-11 rounded-lg bg-zinc-800" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-bold text-zinc-100">{ability.name}</span>
            {ability.isUltimate ? (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-400 uppercase">
                Ultimate
              </span>
            ) : null}
          </div>
          {ability.damageType !== "none" ? (
            <div className="mt-0.5 text-xs text-zinc-500">
              {DAMAGE_TYPE_LABELS[ability.damageType]}
            </div>
          ) : null}
        </div>
      </div>

      {ability.passive ? (
        <div className="mt-3 text-xs leading-relaxed text-zinc-400">
          <span className="font-bold text-zinc-500">Passive: </span>
          {ability.passive}
        </div>
      ) : null}
      {ability.active ? (
        <div className="mt-2 text-xs leading-relaxed text-zinc-400">
          <span className="font-bold text-zinc-500">Active: </span>
          {ability.active}
        </div>
      ) : null}

      {/* Damage/scaling + cooldown/duration/castRange — only render entries that exist */}
      {ability.baseDamage != null ||
      ability.spiritScaling != null ||
      ability.weaponScaling != null ||
      ability.cooldown != null ||
      ability.duration != null ||
      ability.castRange != null ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-black/20 p-3 text-xs">
          {ability.baseDamage != null ? (
            <StatPair label="Base Damage" value={String(ability.baseDamage)} />
          ) : null}
          {ability.spiritScaling != null ? (
            <StatPair label="Spirit Scaling" value={`☆×${ability.spiritScaling}`} />
          ) : null}
          {ability.weaponScaling != null ? (
            <StatPair label="Weapon Scaling" value={`×${ability.weaponScaling}`} />
          ) : null}
          {ability.cooldown != null ? (
            <StatPair label="Cooldown" value={`${ability.cooldown}s`} />
          ) : null}
          {ability.duration != null ? (
            <StatPair label="Duration" value={`${ability.duration}s`} />
          ) : null}
          {ability.castRange != null ? (
            <StatPair label="Cast Range" value={`${ability.castRange}m`} />
          ) : null}
        </dl>
      ) : null}

      {/* Upgrade path — all 3 tiers always visible on this reference page */}
      <div className="mt-3">
        <div className="mb-1.5 text-[10px] font-bold tracking-wider text-zinc-600 uppercase">
          Upgrade Path
        </div>
        <div className="flex flex-col gap-1.5">
          {ability.upgrades.map((tier, i) => {
            const descHtml =
              tier.description.trim().length > 0
                ? tier.description
                : tier.statChanges.map((c) => `${c.stat}: ${c.delta}`).join(", ") || "—";
            return (
              <div key={i} className="flex items-start gap-2 rounded-md bg-zinc-950/50 px-2 py-1.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-700 text-[11px] font-bold text-zinc-400">
                  {TIER_COSTS[i]}
                </span>
                <span
                  className="ability-upgrade-desc text-xs leading-snug text-zinc-300"
                  dangerouslySetInnerHTML={{ __html: descHtml }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </li>
  );
}

export function HeroAbilitiesSection({ abilities }: { abilities: HeroAbility[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-bold text-zinc-200">Abilities</h2>
      {abilities.length === 0 ? (
        <div className="text-sm text-zinc-500">No ability data found.</div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {abilities.map((a) => (
            <AbilityCard key={a.classname} ability={a} />
          ))}
        </ul>
      )}
    </section>
  );
}
