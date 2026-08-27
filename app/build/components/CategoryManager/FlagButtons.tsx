"use client";

import { Tooltip } from "@/app/components/Tooltip";

export function StarButton({
  isActive,
  isOptional,
  activeFull,
  onToggle,
}: {
  isActive: boolean;
  isOptional: boolean;
  activeFull: boolean;
  onToggle: () => void;
}) {
  const disabled = isOptional || (activeFull && !isActive);
  const content = isOptional
    ? "Optional items can't be active — remove the optional flag first."
    : activeFull && !isActive
      ? "Active build is full (12/12). Remove another active item first."
      : isActive
        ? "Active — this item is part of your final 12-slot loadout. Click to remove."
        : "Mark as active. Active items are what you'll actually carry into a match (max 12).";

  return (
    <Tooltip content={content}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onToggle();
        }}
        aria-label={isActive ? "Remove from active build" : "Mark as active build item"}
        style={{
          padding: 0,
          background: "none",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
          fontSize: 20,
          lineHeight: 1,
          color: isActive ? "#facc15" : "rgba(255,255,255,0.3)",
          opacity: disabled ? 0.35 : 1,
          width: 22,
          textAlign: "center",
          transition: "color 0.12s, opacity 0.12s",
        }}
      >
        {isActive ? "★" : "☆"}
      </button>
    </Tooltip>
  );
}

export function SellButton({ isSell, onToggle }: { isSell: boolean; onToggle: () => void }) {
  return (
    <Tooltip
      content={
        isSell
          ? "Sell priority — flagged to sell first when you need souls for a bigger item mid-match. Click to unflag."
          : "Mark as sell priority. Sells refund 50% of cost — flag items you're comfortable selling early."
      }
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={isSell ? "Remove sell priority" : "Mark as sell priority"}
        style={{
          padding: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          fontSize: 13,
          lineHeight: 1,
          color: isSell ? "#f87171" : "rgba(255,255,255,0.22)",
          width: 18,
          textAlign: "center",
          transition: "color 0.12s",
        }}
      >
        💰
      </button>
    </Tooltip>
  );
}

export function OptionalButton({
  isOptional,
  onToggle,
}: {
  isOptional: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip
      content={
        isOptional
          ? "Optional — a situational suggestion in your game plan, not a commitment. It won't count against your active slot cap. Click to unflag."
          : "Mark as optional. Optional items are situational picks you note for later without committing an active slot."
      }
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={isOptional ? "Remove optional flag" : "Mark as optional"}
        style={{
          padding: "0 2px",
          background: "none",
          border: isOptional ? "1px dashed rgba(255,255,255,0.45)" : "1px dashed transparent",
          borderRadius: 3,
          cursor: "pointer",
          flexShrink: 0,
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1,
          color: isOptional ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.2)",
          width: 18,
          textAlign: "center",
          transition: "color 0.12s, border-color 0.12s",
        }}
      >
        ?
      </button>
    </Tooltip>
  );
}
