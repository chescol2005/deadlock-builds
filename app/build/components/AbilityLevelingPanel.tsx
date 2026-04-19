"use client";

import type {
  HeroAbilitySlot,
  SignatureSlot,
  AbilityLevel,
  AbilityLevels,
} from "@/lib/deadlock";

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

const MAX_LEVEL = 3 as const;
const MIN_LEVEL = 0 as const;

function clampLevel(n: number): AbilityLevel {
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, n)) as AbilityLevel;
}

export function AbilityLevelingPanel({
  abilities,
  abilityLevels,
  onLevelChange,
}: {
  abilities: HeroAbilitySlot[];
  abilityLevels: AbilityLevels;
  onLevelChange: (slot: SignatureSlot, level: AbilityLevel) => void;
}) {
  const abilityBySlot = new Map<SignatureSlot, HeroAbilitySlot>();
  for (const a of abilities) {
    abilityBySlot.set(a.slot, a);
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ margin: 0 }}>Ability Levels</h2>
      <ul
        style={{
          marginTop: 12,
          listStyle: "none",
          padding: 0,
          display: "grid",
          gap: 10,
        }}
      >
        {SIGNATURE_SLOTS.map((slot) => {
          const ability = abilityBySlot.get(slot);
          const level = abilityLevels[slot] ?? 0;

          return (
            <li
              key={slot}
              style={{
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 12,
                padding: 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "center", flex: 1 }}>
                {ability?.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ability.icon}
                    alt={ability.name}
                    width={40}
                    height={40}
                    style={{ borderRadius: 10 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.08)",
                      flexShrink: 0,
                    }}
                  />
                )}

                <div>
                  <div style={{ fontWeight: 700 }}>{ability?.name ?? SLOT_LABELS[slot]}</div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    {slot}
                    {ability?.abilityType ? ` • ${ability.abilityType}` : ""}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <button
                  onClick={() => onLevelChange(slot, clampLevel(level - 1))}
                  disabled={level <= MIN_LEVEL}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "transparent",
                    color: "inherit",
                    cursor: level <= MIN_LEVEL ? "not-allowed" : "pointer",
                    opacity: level <= MIN_LEVEL ? 0.4 : 1,
                    fontWeight: 700,
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  −
                </button>

                <div
                  style={{
                    minWidth: 56,
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 15,
                  }}
                >
                  {level} / {MAX_LEVEL}
                </div>

                <button
                  onClick={() => onLevelChange(slot, clampLevel(level + 1))}
                  disabled={level >= MAX_LEVEL}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "transparent",
                    color: "inherit",
                    cursor: level >= MAX_LEVEL ? "not-allowed" : "pointer",
                    opacity: level >= MAX_LEVEL ? 0.4 : 1,
                    fontWeight: 700,
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
