"use client";

import { useState } from "react";
import type { Item, ItemAssignment } from "@/lib/items";
import type { SignatureSlot, AbilityLevels } from "@/lib/deadlock";
import type { HeroAbility } from "@/lib/abilityCoefficients";
import {
  calculateSoulTimeline,
  getSkillPathGrid,
  type SkillPathRow,
} from "@/lib/buildCalculations";
import { BOON_THRESHOLDS } from "@/lib/boonSystem";

export interface SoulTimelineProps {
  buildItems: Item[];
  assignments: ItemAssignment[];
  manualBoonLevel: number;
  allItems: Item[];
  heroAbilities?: HeroAbility[];
  abilityLevels?: AbilityLevels;
}

type UnlockMarker = {
  souls: number;
  unlockNumber: 1 | 2 | 3 | 4;
  slot: SignatureSlot;
  isUltimate: boolean;
  defaultLabel: string;
};

const UNLOCK_MARKERS: UnlockMarker[] = [
  { souls: 600, unlockNumber: 1, slot: "signature1", isUltimate: false, defaultLabel: "Ab 1" },
  { souls: 1200, unlockNumber: 2, slot: "signature2", isUltimate: false, defaultLabel: "Ab 2" },
  { souls: 2100, unlockNumber: 3, slot: "signature3", isUltimate: false, defaultLabel: "Ab 3" },
  { souls: 3600, unlockNumber: 4, slot: "signature4", isUltimate: true, defaultLabel: "Ultimate" },
];

const ABILITY_POINT_SOULS = [900, 1500, 2800, 4400] as const;
const INVESTMENT_SOULS = 4800;

const PHASES = [
  { key: "early" as const, label: "Early Game", color: "#facc15" },
  { key: "mid" as const, label: "Mid Game", color: "#60a5fa" },
  { key: "late" as const, label: "Late Game", color: "#f97316" },
];

const PHASE_KEYS = ["early", "mid", "late"] as const;

const SLOT_LABELS: Record<SignatureSlot, string> = {
  signature1: "Ability 1",
  signature2: "Ability 2",
  signature3: "Ability 3",
  signature4: "Ultimate",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function SkillPathGrid({
  heroAbilities,
  rows,
  timeline,
  hasPhaseItems,
}: {
  heroAbilities: HeroAbility[];
  rows: SkillPathRow[];
  timeline: ReturnType<typeof calculateSoulTimeline>;
  hasPhaseItems: boolean;
}) {
  if (heroAbilities.length === 0 || rows.length === 0) return null;

  return (
    <section style={{ marginTop: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          opacity: 0.6,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          marginBottom: 8,
        }}
      >
        Skill Path
      </div>

      {!hasPhaseItems ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.03)",
            fontSize: 11,
            opacity: 0.5,
            textAlign: "center",
          }}
        >
          Add items to phases to see skill path
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "3px 4px",
                    fontSize: 10,
                    opacity: 0.5,
                    width: 80,
                  }}
                />
                {PHASE_KEYS.map((phase) => (
                  <th
                    key={phase}
                    style={{
                      textAlign: "center",
                      padding: "3px 4px",
                      fontSize: 10,
                      opacity: timeline[phase].totalCost > 0 ? 0.75 : 0.3,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {phase.charAt(0).toUpperCase() + phase.slice(1)}
                    {timeline[phase].cumulativeCost > 0 ? (
                      <span style={{ opacity: 0.65, marginLeft: 3 }}>
                        (${fmt(timeline[phase].cumulativeCost)})
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const label = row.ability.name || SLOT_LABELS[row.ability.slot];
                const allocated = row.currentLevel > 0;
                return (
                  <tr key={row.ability.slot}>
                    <td
                      style={{
                        padding: "3px 4px",
                        fontSize: 10,
                        opacity: allocated ? 1 : 0.55,
                        color: row.ability.isUltimate ? "#facc15" : undefined,
                        fontWeight: row.ability.isUltimate ? 700 : 400,
                        whiteSpace: "nowrap",
                        maxWidth: 80,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={label}
                    >
                      {truncate(label, 12)}
                    </td>
                    {PHASE_KEYS.map((phase) => {
                      const events: string[] = [];
                      if (row.unlockPhase === phase) events.push("\u26a1");
                      if (row.tier1Phase === phase) events.push("1");
                      if (row.tier2Phase === phase) events.push("3");
                      if (row.tier3Phase === phase) events.push("5");
                      return (
                        <td
                          key={phase}
                          style={{ textAlign: "center", padding: "3px 2px", verticalAlign: "middle" }}
                        >
                          {events.length > 0 ? (
                            <span
                              style={{ display: "inline-flex", gap: 2, alignItems: "center" }}
                            >
                              {events.map((e, i) =>
                                e === "\u26a1" ? (
                                  <span
                                    key={i}
                                    style={{ fontSize: 11, color: "#facc15", fontWeight: 700 }}
                                  >
                                    {e}
                                  </span>
                                ) : (
                                  <span
                                    key={i}
                                    style={{
                                      fontSize: 9,
                                      color: "rgba(255,255,255,0.7)",
                                      fontWeight: 600,
                                      background: "rgba(255,255,255,0.1)",
                                      borderRadius: 3,
                                      padding: "0 3px",
                                    }}
                                  >
                                    [{e}]
                                  </span>
                                ),
                              )}
                            </span>
                          ) : (
                            <span style={{ opacity: 0.15, fontSize: 9 }}>\u00b7</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function SoulTimeline({
  buildItems,
  assignments,
  manualBoonLevel,
  heroAbilities,
  abilityLevels,
}: SoulTimelineProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredSouls, setHoveredSouls] = useState<number | null>(null);

  const timeline = calculateSoulTimeline(buildItems, assignments);
  const { early, mid, late, grandTotal, sellRecovery } = timeline;

  const hasPhaseItems = early.items.length > 0 || mid.items.length > 0 || late.items.length > 0;

  const boonSouls = BOON_THRESHOLDS[manualBoonLevel]?.souls ?? 0;
  const showBoonCursor =
    manualBoonLevel > 0 && boonSouls > 0 && grandTotal > 0 && boonSouls <= grandTotal;

  const phaseBreakdowns = { early, mid, late } as const;

  const visibleUnlockMarkers =
    grandTotal > 0 ? UNLOCK_MARKERS.filter((m) => m.souls <= grandTotal) : [];
  const visiblePointSouls =
    grandTotal > 0 ? ABILITY_POINT_SOULS.filter((s) => s <= grandTotal) : [];
  const showInvestmentMarker = grandTotal > 0 && INVESTMENT_SOULS <= grandTotal;

  const skillRows =
    heroAbilities && heroAbilities.length > 0
      ? getSkillPathGrid(timeline, heroAbilities, abilityLevels ?? {})
      : [];

  function abilityForSlot(slot: SignatureSlot): HeroAbility | undefined {
    return heroAbilities?.find((a) => a.slot === slot);
  }

  function isAllocated(slot: SignatureSlot): boolean {
    return (abilityLevels?.[slot] ?? 0) > 0;
  }

  return (
    <section>
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          padding: 0,
          marginBottom: collapsed ? 0 : 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            opacity: 0.6,
            textTransform: "uppercase",
            letterSpacing: 0.8,
          }}
        >
          Soul Economy Timeline
        </span>
        <span style={{ fontSize: 10, opacity: 0.4 }}>{collapsed ? "\u25bc" : "\u25b2"}</span>
      </button>

      {!collapsed && (
        <div>
          {!hasPhaseItems ? (
            <div
              style={{
                padding: "12px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
                fontSize: 12,
                opacity: 0.5,
                textAlign: "center",
              }}
            >
              Add items to phases to see soul timeline
            </div>
          ) : (
            <div>
              {/* Phase cost labels */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 6,
                  flexWrap: "wrap",
                  fontSize: 11,
                }}
              >
                {PHASES.map(({ key, label, color }) => {
                  const bd = phaseBreakdowns[key];
                  return (
                    <span key={key}>
                      <span style={{ color, fontWeight: 700 }}>{label}</span>
                      <span style={{ opacity: 0.65, marginLeft: 4 }}>
                        {bd.totalCost > 0 ? `$${fmt(bd.totalCost)}` : "(empty)"}
                      </span>
                    </span>
                  );
                })}
              </div>

              {/* Timeline bar area */}
              <div style={{ position: "relative", marginBottom: 48 }}>
                {/* Boon cursor label above bar */}
                {showBoonCursor && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${(boonSouls / grandTotal) * 100}%`,
                      bottom: "calc(100% + 2px)",
                      transform: "translateX(-50%)",
                      fontSize: 9,
                      color: "#a78bfa",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      pointerEvents: "none",
                    }}
                  >
                    Boon {manualBoonLevel}
                  </div>
                )}

                {/* Bar */}
                <div style={{ position: "relative" }}>
                  <div
                    style={{
                      height: 18,
                      borderRadius: 6,
                      background: "rgba(255,255,255,0.07)",
                      overflow: "hidden",
                      display: "flex",
                    }}
                  >
                    {PHASES.map(({ key, color }) => {
                      const bd = phaseBreakdowns[key];
                      if (bd.totalCost === 0) return null;
                      return (
                        <div
                          key={key}
                          title={`${key}: ${fmt(bd.totalCost)} souls`}
                          style={{ flex: bd.totalCost, background: color, opacity: 0.82 }}
                        />
                      );
                    })}
                  </div>

                  {/* Non-interactive tick overlay: point markers + investment + boon */}
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 18,
                      pointerEvents: "none",
                    }}
                  >
                    {/* Unlock marker ticks */}
                    {visibleUnlockMarkers.map((m) => (
                      <div
                        key={m.souls}
                        style={{
                          position: "absolute",
                          left: `${(m.souls / grandTotal) * 100}%`,
                          top: 0,
                          width: 2,
                          height: "100%",
                          background:
                            m.isUltimate || isAllocated(m.slot)
                              ? "#facc15"
                              : "rgba(255,255,255,0.75)",
                          transform: "translateX(-50%)",
                        }}
                      />
                    ))}

                    {/* Ability point ticks — shorter, subtle */}
                    {visiblePointSouls.map((s) => (
                      <div
                        key={s}
                        style={{
                          position: "absolute",
                          left: `${(s / grandTotal) * 100}%`,
                          top: "30%",
                          width: 1,
                          height: "40%",
                          background: "rgba(255,255,255,0.3)",
                          transform: "translateX(-50%)",
                        }}
                      />
                    ))}

                    {/* Investment marker tick */}
                    {showInvestmentMarker && (
                      <div
                        style={{
                          position: "absolute",
                          left: `${(INVESTMENT_SOULS / grandTotal) * 100}%`,
                          top: 0,
                          width: 2,
                          height: "100%",
                          background: "#facc15",
                          transform: "translateX(-50%)",
                        }}
                      />
                    )}

                    {/* Boon cursor tick */}
                    {showBoonCursor && (
                      <div
                        style={{
                          position: "absolute",
                          left: `${(boonSouls / grandTotal) * 100}%`,
                          top: 0,
                          width: 2,
                          height: "100%",
                          background: "#a78bfa",
                          transform: "translateX(-50%)",
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Marker labels below bar */}
                <div
                  style={{
                    position: "relative",
                    minHeight: 28,
                    marginTop: 3,
                    overflow: "visible",
                  }}
                >
                  {/* Interactive unlock markers */}
                  {visibleUnlockMarkers.map((m) => {
                    const ability = abilityForSlot(m.slot);
                    const allocated = isAllocated(m.slot);
                    const hovered = hoveredSouls === m.souls;
                    const color =
                      m.isUltimate || allocated ? "#facc15" : "rgba(255,255,255,0.5)";
                    const displayName = ability?.name ?? m.defaultLabel;

                    return (
                      <div
                        key={m.souls}
                        onMouseEnter={() => setHoveredSouls(m.souls)}
                        onMouseLeave={() => setHoveredSouls(null)}
                        style={{
                          position: "absolute",
                          left: `${(m.souls / grandTotal) * 100}%`,
                          top: 0,
                          transform: "translateX(-50%)",
                          cursor: "default",
                          textAlign: "center",
                          zIndex: hovered ? 10 : 1,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9,
                            fontWeight: m.isUltimate ? 700 : 500,
                            color,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {allocated ? "\u2713" : "\u26a1"} {truncate(displayName, 10)}
                        </div>

                        {hovered && (
                          <div
                            style={{
                              position: "absolute",
                              bottom: "calc(100% + 28px)",
                              left: "50%",
                              transform: "translateX(-50%)",
                              background: "#1a1a2e",
                              border: "1px solid rgba(255,255,255,0.2)",
                              borderRadius: 8,
                              padding: "8px 12px",
                              zIndex: 100,
                              whiteSpace: "nowrap",
                              boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                              pointerEvents: "none",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                color: "#facc15",
                                fontWeight: 700,
                                marginBottom: 3,
                              }}
                            >
                              \u26a1 Unlock #{m.unlockNumber}
                              {m.isUltimate ? " \u2014 Ultimate" : ""}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{displayName}</div>
                            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>
                              {fmt(m.souls)} souls
                            </div>
                            {allocated && (
                              <div
                                style={{ fontSize: 10, color: "#4ade80", marginTop: 3, fontWeight: 600 }}
                              >
                                \u2713 Allocated
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Ability point labels — non-interactive, subtle */}
                  {visiblePointSouls.map((s) => (
                    <div
                      key={s}
                      style={{
                        position: "absolute",
                        left: `${(s / grandTotal) * 100}%`,
                        top: 14,
                        transform: "translateX(-50%)",
                        fontSize: 8,
                        opacity: 0.3,
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                      }}
                    >
                      +1pt
                    </div>
                  ))}

                  {/* Investment marker label */}
                  {showInvestmentMarker && (
                    <div
                      style={{
                        position: "absolute",
                        left: `${(INVESTMENT_SOULS / grandTotal) * 100}%`,
                        top: 0,
                        transform: "translateX(-50%)",
                        fontSize: 9,
                        fontWeight: 700,
                        color: "#facc15",
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                      }}
                    >
                      Invest. \u2605
                    </div>
                  )}
                </div>
              </div>

              {/* Cumulative labels */}
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  fontSize: 11,
                  marginBottom: 6,
                }}
              >
                {PHASES.map(({ key, label, color }) => {
                  const bd = phaseBreakdowns[key];
                  if (bd.totalCost === 0) return null;
                  return (
                    <div key={key}>
                      <span style={{ color, fontWeight: 700 }}>{label}:</span>
                      <span style={{ opacity: 0.75, marginLeft: 4 }}>${fmt(bd.cumulativeCost)}</span>
                    </div>
                  );
                })}
              </div>

              {/* Sell recovery */}
              {sellRecovery > 0 && (
                <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>
                  \u21a9 Recover ${fmt(sellRecovery)} from sells
                </div>
              )}

              {/* Skill Path Grid */}
              {heroAbilities && heroAbilities.length > 0 ? (
                <SkillPathGrid
                  heroAbilities={heroAbilities}
                  rows={skillRows}
                  timeline={timeline}
                  hasPhaseItems={hasPhaseItems}
                />
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
