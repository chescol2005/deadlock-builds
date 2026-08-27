"use client";

import type { HeroBaseStats } from "@/lib/heroStats";
import { calculateStatsAtBoon } from "@/lib/heroStats";
import type { StatTotals } from "@/lib/buildCalculations";
import { combineStatTotal } from "@/lib/buildCalculations";

function StatRow({ label, value, perBoon }: { label: string; value: number; perBoon?: number }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 8,
        padding: "3px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span style={{ fontSize: 12, opacity: 0.7 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>
        {Math.round(value * 10) / 10}
        {perBoon != null && perBoon > 0 ? (
          <span style={{ fontSize: 11, opacity: 0.45, marginLeft: 4 }}>
            +{Math.round(perBoon * 100) / 100}/boon
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function HeroStatsPanel({
  stats,
  heroLevel,
  itemTotals,
}: {
  stats: HeroBaseStats;
  heroLevel: number;
  itemTotals?: StatTotals;
}) {
  const scaled = calculateStatsAtBoon(stats, heroLevel);

  const totalSpiritPower = combineStatTotal(
    scaled.spiritPower,
    itemTotals?.spiritPowerFlat ?? 0,
    itemTotals?.spiritPowerPercent ?? 0,
  );

  const totalMaxHealth = combineStatTotal(scaled.maxHealth, itemTotals?.bonusHealthFlat ?? 0, 0);
  const totalHealthRegen = combineStatTotal(stats.healthRegen, itemTotals?.healthRegen ?? 0, 0);

  return (
    <section style={{ marginTop: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          opacity: 0.5,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          marginBottom: 6,
        }}
      >
        Weapon Stats
      </div>
      <StatRow
        label="Bullet Damage"
        value={scaled.bulletDamage}
        perBoon={stats.bulletDamagePerBoon}
      />
      <StatRow label="Light Melee" value={scaled.lightMeleeDamage} perBoon={stats.lightMeleePerBoon} />
      <StatRow label="Heavy Melee" value={scaled.heavyMeleeDamage} perBoon={stats.heavyMeleePerBoon} />

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          opacity: 0.5,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          marginTop: 10,
          marginBottom: 6,
        }}
      >
        Vitality Stats
      </div>
      <StatRow label="Max Health" value={totalMaxHealth} perBoon={stats.maxHealthPerBoon} />
      {itemTotals && itemTotals.bonusHealthFlat > 0 ? (
        <div style={{ fontSize: 11, opacity: 0.45, padding: "1px 0 3px", textAlign: "right" }}>
          {Math.round(scaled.maxHealth)} base + {itemTotals.bonusHealthFlat} items
        </div>
      ) : null}
      <StatRow label="Health Regen" value={totalHealthRegen} />
      <StatRow label="Move Speed" value={stats.moveSpeed} />

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          opacity: 0.5,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          marginTop: 10,
          marginBottom: 6,
        }}
      >
        Spirit Stats
      </div>
      <StatRow label="Spirit Power" value={totalSpiritPower} perBoon={stats.spiritPowerPerBoon} />
      {itemTotals && (itemTotals.spiritPowerFlat > 0 || itemTotals.spiritPowerPercent > 0) ? (
        <div style={{ fontSize: 11, opacity: 0.45, padding: "1px 0 3px", textAlign: "right" }}>
          {Math.round(scaled.spiritPower)} base
          {itemTotals.spiritPowerFlat > 0 ? ` + ${itemTotals.spiritPowerFlat} items` : ""}
          {itemTotals.spiritPowerPercent > 0 ? ` + ${itemTotals.spiritPowerPercent}%` : ""}
        </div>
      ) : null}
    </section>
  );
}
