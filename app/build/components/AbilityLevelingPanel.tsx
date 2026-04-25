"use client";

import { useState } from "react";
import type { SignatureSlot, AbilityLevel, AbilityLevels } from "@/lib/deadlock";
import type { HeroAbility } from "@/lib/abilityCoefficients";
import { calculateAbilityDamage } from "@/lib/abilityCoefficients";
import { ABILITY_SLOT_UNLOCK_SOULS } from "@/lib/boonSystem";

const SIGNATURE_SLOTS: SignatureSlot[] = [
  "signature1",
  "signature2",
  "signature3",
  "signature4",
];

const SLOT_LABELS: Record<SignatureSlot, string> = {
  signature1: "Ability 1",
  signature2: "Ability 2",
  signature3: "Ability 3",
  signature4: "Ultimate",
};

const TIER_COSTS = [1, 2, 5] as const;
const MAX_LEVEL = 3 as const;

// Soul threshold required to unlock each slot (indexed 0–3)
const SLOT_UNLOCK_SOULS: Record<SignatureSlot, number> = {
  signature1: ABILITY_SLOT_UNLOCK_SOULS[0],
  signature2: ABILITY_SLOT_UNLOCK_SOULS[1],
  signature3: ABILITY_SLOT_UNLOCK_SOULS[2],
  signature4: ABILITY_SLOT_UNLOCK_SOULS[3],
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function TierBadge({
  cost,
  purchased,
}: {
  cost: 1 | 2 | 5;
  purchased: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        border: `1px solid ${purchased ? "rgba(250,204,21,0.6)" : "rgba(255,255,255,0.2)"}`,
        background: purchased ? "rgba(250,204,21,0.15)" : "transparent",
        color: purchased ? "#facc15" : "rgba(255,255,255,0.5)",
        flexShrink: 0,
      }}
    >
      {cost}
    </span>
  );
}

function AbilityCard({
  slot,
  ability,
  level,
  availableAbilityPoints,
  pointsSpent,
  planSouls,
  spiritPower,
  onLevelChange,
  pointCostForNextLevel,
}: {
  slot: SignatureSlot;
  ability: HeroAbility | undefined;
  level: AbilityLevel;
  availableAbilityPoints: number;
  pointsSpent: number;
  planSouls: number;
  spiritPower: number;
  onLevelChange: (slot: SignatureSlot, level: AbilityLevel) => void;
  pointCostForNextLevel: (current: AbilityLevel) => number;
}) {
  const [expanded, setExpanded] = useState(false);

  const unlockSouls = SLOT_UNLOCK_SOULS[slot];
  const isSlotLocked = planSouls < unlockSouls;

  const canDecrement = level > 0 && !isSlotLocked;

  const nextCost = level < MAX_LEVEL ? pointCostForNextLevel(level) : 0;
  const remainingPoints = availableAbilityPoints - pointsSpent;
  const canIncrement =
    !isSlotLocked && level < MAX_LEVEL && nextCost <= remainingPoints;

  const label = ability?.name ?? SLOT_LABELS[slot];

  // Projected damage at each level
  const projectedDamages =
    ability && ability.baseDamage != null
      ? ([0, 1, 2, 3] as AbilityLevel[]).map((lvl) =>
          calculateAbilityDamage(ability, lvl, spiritPower, 0),
        )
      : null;

  return (
    <li
      style={{
        border: `1px solid ${isSlotLocked ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.15)"}`,
        borderRadius: 12,
        overflow: "hidden",
        opacity: isSlotLocked ? 0.55 : 1,
      }}
    >
      {/* Collapsed header — always visible */}
      <div
        style={{
          padding: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: ability ? "pointer" : "default",
        }}
        onClick={() => ability && setExpanded((v) => !v)}
      >
        {/* Icon */}
        {ability?.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ability.icon}
            alt={label}
            width={36}
            height={36}
            style={{ borderRadius: 8, flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "rgba(255,255,255,0.08)",
              flexShrink: 0,
            }}
          />
        )}

        {/* Name + subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </div>
          {ability ? (
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 1 }}>
              {ability.spiritScaling != null ? `☆×${ability.spiritScaling}` : null}
              {ability.spiritScaling != null && ability.cooldown != null ? " · " : null}
              {ability.cooldown != null ? `${ability.cooldown}s CD` : null}
              {ability.baseDamage != null &&
              (ability.spiritScaling != null || ability.cooldown != null)
                ? " · "
                : null}
              {ability.baseDamage != null ? `${ability.baseDamage} dmg` : null}
            </div>
          ) : null}
        </div>

        {/* Level counter + controls */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {isSlotLocked ? (
            <span
              title={`Unlocks at ${fmt(unlockSouls)} souls`}
              style={{ fontSize: 11, opacity: 0.5, whiteSpace: "nowrap" }}
            >
              🔒 {fmt(unlockSouls)}
            </span>
          ) : (
            <>
              <button
                onClick={() => onLevelChange(slot, (level - 1) as AbilityLevel)}
                disabled={!canDecrement}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "inherit",
                  cursor: canDecrement ? "pointer" : "not-allowed",
                  opacity: canDecrement ? 1 : 0.35,
                  fontWeight: 700,
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                −
              </button>

              <span style={{ minWidth: 36, textAlign: "center", fontWeight: 700, fontSize: 13 }}>
                {level}/{MAX_LEVEL}
              </span>

              <button
                onClick={() => onLevelChange(slot, (level + 1) as AbilityLevel)}
                disabled={!canIncrement}
                title={
                  !canIncrement && level < MAX_LEVEL
                    ? `Need ${nextCost} point${nextCost !== 1 ? "s" : ""} (have ${remainingPoints})`
                    : undefined
                }
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "inherit",
                  cursor: canIncrement ? "pointer" : "not-allowed",
                  opacity: canIncrement ? 1 : 0.35,
                  fontWeight: 700,
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                +
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && ability && !isSlotLocked ? (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.08)",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Passive / Active description */}
          {ability.passive ? (
            <div style={{ fontSize: 11, lineHeight: 1.5, opacity: 0.8 }}>
              <span style={{ fontWeight: 700, opacity: 0.5 }}>Passive: </span>
              {ability.passive}
            </div>
          ) : null}
          {ability.active ? (
            <div style={{ fontSize: 11, lineHeight: 1.5, opacity: 0.8 }}>
              <span style={{ fontWeight: 700, opacity: 0.5 }}>Active: </span>
              {ability.active}
            </div>
          ) : null}

          {/* Stat grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px 12px",
              fontSize: 11,
            }}
          >
            {ability.baseDamage != null ? (
              <div>
                <span style={{ opacity: 0.5 }}>Base Damage: </span>
                <strong>{ability.baseDamage}</strong>
              </div>
            ) : null}
            {ability.spiritScaling != null ? (
              <div>
                <span style={{ opacity: 0.5 }}>Spirit Scaling: </span>
                <strong>☆×{ability.spiritScaling}</strong>
              </div>
            ) : null}
            {ability.cooldown != null ? (
              <div>
                <span style={{ opacity: 0.5 }}>Cooldown: </span>
                <strong>{ability.cooldown}s</strong>
              </div>
            ) : null}
            {ability.duration != null ? (
              <div>
                <span style={{ opacity: 0.5 }}>Duration: </span>
                <strong>{ability.duration}s</strong>
              </div>
            ) : null}
            {ability.castRange != null ? (
              <div>
                <span style={{ opacity: 0.5 }}>Cast Range: </span>
                <strong>{ability.castRange}m</strong>
              </div>
            ) : null}
          </div>

          {/* Upgrade path */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                opacity: 0.4,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginBottom: 5,
              }}
            >
              Upgrade Path
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {ability.upgrades.map((tier, i) => {
                const purchased = level > i;
                const tierCost = TIER_COSTS[i];
                const hasDesc = tier.description.trim().length > 0;
                const changes = tier.statChanges
                  .map((c) => `${c.stat}: ${c.delta}`)
                  .join(", ");
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "flex-start",
                      padding: "4px 6px",
                      borderRadius: 6,
                      background: purchased ? "rgba(250,204,21,0.06)" : "transparent",
                    }}
                  >
                    <TierBadge cost={tierCost} purchased={purchased} />
                    <span
                      style={{
                        fontSize: 11,
                        lineHeight: 1.4,
                        opacity: purchased ? 1 : 0.65,
                        flex: 1,
                      }}
                    >
                      {hasDesc ? tier.description : changes || "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Projected damage */}
          {projectedDamages ? (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  opacity: 0.4,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  marginBottom: 5,
                }}
              >
                Projected Damage (☆{Math.round(spiritPower)} spirit)
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                {projectedDamages.map((dmg, lvl) => (
                  <div key={lvl} style={{ opacity: level === lvl ? 1 : 0.5 }}>
                    <span style={{ opacity: 0.6 }}>Lv{lvl}: </span>
                    <strong>{dmg ?? "—"}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function AbilityLevelingPanel({
  abilities,
  abilityLevels,
  onLevelChange,
  availableAbilityPoints,
  unlockedAbilitySlots,
  planSouls,
  spiritPower,
  pointsSpent,
  pointCostForNextLevel,
}: {
  abilities: HeroAbility[];
  abilityLevels: AbilityLevels;
  onLevelChange: (slot: SignatureSlot, level: AbilityLevel) => void;
  availableAbilityPoints: number;
  unlockedAbilitySlots: number;
  planSouls: number;
  spiritPower: number;
  pointsSpent: number;
  pointCostForNextLevel: (current: AbilityLevel) => number;
}) {
  const abilityBySlot = new Map<SignatureSlot, HeroAbility>(
    abilities.map((a) => [a.slot, a]),
  );

  return (
    <section style={{ marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Abilities</h2>
        <span style={{ fontSize: 11, opacity: 0.5 }}>
          {pointsSpent}/{availableAbilityPoints} pts used
          {" · "}
          {unlockedAbilitySlots}/4 slots
        </span>
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 8,
        }}
      >
        {SIGNATURE_SLOTS.map((slot) => {
          const ability = abilityBySlot.get(slot);
          const level = (abilityLevels[slot] ?? 0) as AbilityLevel;

          return (
            <AbilityCard
              key={slot}
              slot={slot}
              ability={ability}
              level={level}
              availableAbilityPoints={availableAbilityPoints}
              pointsSpent={pointsSpent}
              planSouls={planSouls}
              spiritPower={spiritPower}
              onLevelChange={onLevelChange}
              pointCostForNextLevel={pointCostForNextLevel}
            />
          );
        })}
      </ul>
    </section>
  );
}
