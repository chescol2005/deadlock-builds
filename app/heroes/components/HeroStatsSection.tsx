import type { HeroBaseStats } from "@/lib/heroStats";

// Read-only base-stat display for the hero reference page. Unlike the build
// page's boon-slider-driven HeroStatsPanel, there's no interactive boon level
// here — stats that scale with boon level show their base value plus a
// "+X per boon level" suffix instead.
function StatRow({
  label,
  value,
  perBoon,
  suffix = "",
}: {
  label: string;
  value: number;
  perBoon?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-zinc-400">{label}</span>
      <span className="text-sm font-semibold text-zinc-100">
        {value.toLocaleString("en-US")}
        {suffix}
        {perBoon ? (
          <span className="ml-1.5 text-[11px] font-normal text-amber-400/80">
            +{perBoon.toLocaleString("en-US")}
            {suffix} / boon level
          </span>
        ) : null}
      </span>
    </div>
  );
}

function StatGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="mb-2 text-xs font-bold tracking-wide text-zinc-500 uppercase">{title}</h3>
      <div className="divide-y divide-zinc-800/60">{children}</div>
    </div>
  );
}

export function HeroStatsSection({ stats }: { stats: HeroBaseStats }) {
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-bold text-zinc-200">Base Stats</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatGroup title="Weapon">
          <StatRow
            label="Bullet Damage"
            value={stats.bulletDamage}
            perBoon={stats.bulletDamagePerBoon}
          />
          <StatRow label="Bullets / Second" value={stats.bulletsPerSecond} />
          <StatRow label="Reload Time" value={stats.reloadTime} suffix="s" />
          <StatRow label="Ammo" value={stats.ammo} />
          <StatRow
            label="Light Melee Damage"
            value={stats.lightMeleeDamage}
            perBoon={stats.lightMeleePerBoon}
          />
          <StatRow
            label="Heavy Melee Damage"
            value={stats.heavyMeleeDamage}
            perBoon={stats.heavyMeleePerBoon}
          />
        </StatGroup>

        <StatGroup title="Vitality">
          <StatRow label="Max Health" value={stats.maxHealth} perBoon={stats.maxHealthPerBoon} />
          <StatRow label="Health Regen" value={stats.healthRegen} suffix="/s" />
          <StatRow label="Move Speed" value={stats.moveSpeed} />
        </StatGroup>

        <StatGroup title="Spirit">
          <StatRow
            label="Spirit Power"
            value={stats.spiritPower}
            perBoon={stats.spiritPowerPerBoon}
          />
        </StatGroup>
      </div>
    </section>
  );
}
