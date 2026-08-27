"use client";

import { useState, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@/lib/items";
import { CATEGORY_META } from "./constants";
import { OptionalButton, SellButton, StarButton } from "./FlagButtons";

type CategoryMeta = (typeof CATEGORY_META)[keyof typeof CATEGORY_META];

// ─── Shared row chrome (flag buttons + icon + name/subline) ───────────────────
// Internal only — not exported. Both SortableItem and DraggableFixedItem render
// this as the interior of their own <li>, then append their own footer markup.
// Because this returns a Fragment, its children become direct flex-item
// siblings of the footer inside the parent <li> — no extra wrapper element.

function ItemRowChrome({
  item,
  meta,
  consumed,
  isOptional,
  isActive,
  isSellPriority,
  activeFull,
  onToggleActive,
  onToggleSell,
  onToggleOptional,
  strikethroughOnConsumed = false,
  showOptionalTag = false,
  extraInfo,
}: {
  item: Item;
  meta: CategoryMeta;
  consumed: boolean;
  isOptional?: boolean;
  isActive?: boolean;
  isSellPriority?: boolean;
  activeFull?: boolean;
  onToggleActive?: (itemId: string) => void;
  onToggleSell?: (itemId: string) => void;
  onToggleOptional?: (itemId: string) => void;
  strikethroughOnConsumed?: boolean;
  showOptionalTag?: boolean;
  extraInfo?: string;
}) {
  return (
    <>
      {/* Flag buttons */}
      {onToggleActive ? (
        <StarButton
          isActive={isActive ?? false}
          isOptional={isOptional ?? false}
          activeFull={activeFull ?? false}
          onToggle={() => onToggleActive(item.id)}
        />
      ) : null}
      {onToggleSell ? (
        <SellButton isSell={isSellPriority ?? false} onToggle={() => onToggleSell(item.id)} />
      ) : null}
      {onToggleOptional ? (
        <OptionalButton
          isOptional={isOptional ?? false}
          onToggle={() => onToggleOptional(item.id)}
        />
      ) : null}

      {/* Icon */}
      {item.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.icon}
          alt={item.name}
          width={32}
          height={32}
          style={{ borderRadius: 8, flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "rgba(255,255,255,0.08)",
            flexShrink: 0,
          }}
        />
      )}

      {/* Name + sub-line */}
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            ...(strikethroughOnConsumed
              ? { textDecoration: consumed ? "line-through" : "none" }
              : {}),
          }}
          title={item.name}
        >
          {item.name}
        </div>
        <div
          style={{
            display: "flex",
            gap: 5,
            marginTop: 3,
            alignItems: "center",
            fontSize: 11,
            opacity: 0.75,
          }}
        >
          <span style={{ color: meta.solid }}>{meta.label}</span>
          <span>·</span>
          <span>T{item.tier}</span>
          <span>·</span>
          <span>${item.cost.toLocaleString("en-US")}</span>
          {showOptionalTag && isOptional ? (
            <>
              <span>·</span>
              <span style={{ color: "rgba(255,255,255,0.5)", fontStyle: "italic" }}>Optional</span>
            </>
          ) : null}
        </div>
        {extraInfo ? (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 1 }}>{extraInfo}</div>
        ) : null}
      </div>
    </>
  );
}

// ─── Sortable item (used in uncategorized + user categories) ──────────────────

export function SortableItem({
  item,
  categoryId,
  onRemove,
  consumed,
  onToggleActive,
  isActive,
  isOptional,
  isSellPriority,
  activeFull,
  onToggleSell,
  onToggleOptional,
}: {
  item: Item;
  categoryId: string | null;
  onRemove: (itemId: string) => void;
  consumed: boolean;
  onToggleActive?: (itemId: string) => void;
  isActive?: boolean;
  isOptional?: boolean;
  isSellPriority?: boolean;
  activeFull?: boolean;
  onToggleSell?: (itemId: string) => void;
  onToggleOptional?: (itemId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item", categoryId },
  });

  const [hovered, setHovered] = useState(false);
  const [removeHovered, setRemoveHovered] = useState(false);

  const meta = CATEGORY_META[item.category];
  const accentColor = consumed ? "#6b7280" : meta.solid;
  const edgeBorder = isOptional
    ? "1px dashed rgba(255,255,255,0.25)"
    : "1px solid rgba(255,255,255,0.10)";

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : consumed ? 0.5 : isOptional ? 0.6 : 1,
  };

  const footer: ReactNode = consumed ? (
    <span
      style={{
        fontSize: 11,
        color: "rgba(255,255,255,0.4)",
        flexShrink: 0,
        fontStyle: "italic",
      }}
    >
      Consumed
    </span>
  ) : (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onRemove(item.id);
      }}
      onMouseEnter={() => setRemoveHovered(true)}
      onMouseLeave={() => setRemoveHovered(false)}
      style={{
        padding: "3px 8px",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.12)",
        background: removeHovered ? "rgba(239,68,68,0.15)" : "transparent",
        color: removeHovered ? "#f87171" : "rgba(255,255,255,0.4)",
        cursor: "pointer",
        fontSize: 13,
        flexShrink: 0,
        transition: "background 0.12s, color 0.12s",
        lineHeight: 1,
      }}
      aria-label={`Remove ${item.name}`}
    >
      ✕
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderTop: edgeBorder,
        borderRight: edgeBorder,
        borderBottom: edgeBorder,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 12,
        padding: "0 10px",
        height: 60,
        boxSizing: "border-box",
        background: hovered && !consumed ? "rgba(255,255,255,0.06)" : meta.accentSoft,
        cursor: consumed ? "default" : "grab",
        transition: "background 0.15s",
        overflow: "hidden",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...attributes}
      {...listeners}
    >
      <ItemRowChrome
        item={item}
        meta={meta}
        consumed={consumed}
        isOptional={isOptional}
        isActive={isActive}
        isSellPriority={isSellPriority}
        activeFull={activeFull}
        onToggleActive={onToggleActive}
        onToggleSell={onToggleSell}
        onToggleOptional={onToggleOptional}
        strikethroughOnConsumed
        showOptionalTag
      />

      {/* Remove / Consumed */}
      {footer}
    </li>
  );
}

// ─── Sortable phase-section item ──────────────────────────────────────────────

export function DraggableFixedItem({
  item,
  sectionId,
  onRemoveFromSection,
  onRemoveBuildItem,
  consumed,
  extraInfo,
  onToggleActive,
  isActive,
  activeFull,
  isSellPriority,
  isOptional,
  onToggleSell,
  onToggleOptional,
}: {
  item: Item;
  sectionId: string;
  onRemoveFromSection: (itemId: string) => void;
  onRemoveBuildItem: (itemId: string) => void;
  consumed: boolean;
  extraInfo?: string;
  onToggleActive?: (itemId: string) => void;
  isActive?: boolean;
  activeFull?: boolean;
  isSellPriority?: boolean;
  isOptional?: boolean;
  onToggleSell?: (itemId: string) => void;
  onToggleOptional?: (itemId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item", categoryId: sectionId },
  });

  const [hovered, setHovered] = useState(false);
  const [removeHovered, setRemoveHovered] = useState(false);
  const [sectionRemoveHovered, setSectionRemoveHovered] = useState(false);

  const meta = CATEGORY_META[item.category];
  const accentColor = consumed ? "#6b7280" : meta.solid;
  const edgeBorder = isOptional
    ? "1px dashed rgba(255,255,255,0.25)"
    : "1px solid rgba(255,255,255,0.10)";

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : consumed ? 0.5 : isOptional ? 0.6 : 1,
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderTop: edgeBorder,
        borderRight: edgeBorder,
        borderBottom: edgeBorder,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 12,
        padding: "0 10px",
        height: 60,
        boxSizing: "border-box",
        background: hovered && !consumed ? "rgba(255,255,255,0.06)" : meta.accentSoft,
        cursor: consumed ? "default" : "grab",
        overflow: "hidden",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...attributes}
      {...listeners}
    >
      <ItemRowChrome
        item={item}
        meta={meta}
        consumed={consumed}
        isOptional={isOptional}
        isActive={isActive}
        isSellPriority={isSellPriority}
        activeFull={activeFull}
        onToggleActive={onToggleActive}
        onToggleSell={onToggleSell}
        onToggleOptional={onToggleOptional}
        extraInfo={extraInfo}
      />

      {/* Section-remove + build-remove buttons */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemoveFromSection(item.id);
          }}
          onMouseEnter={() => setSectionRemoveHovered(true)}
          onMouseLeave={() => setSectionRemoveHovered(false)}
          title="Return to Uncategorized"
          style={{
            padding: "3px 6px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.12)",
            background: sectionRemoveHovered ? "rgba(255,255,255,0.1)" : "transparent",
            color: sectionRemoveHovered ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontSize: 12,
            transition: "background 0.12s, color 0.12s",
            lineHeight: 1,
          }}
          aria-label={`Remove ${item.name} from section`}
        >
          ↩
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemoveBuildItem(item.id);
          }}
          onMouseEnter={() => setRemoveHovered(true)}
          onMouseLeave={() => setRemoveHovered(false)}
          title="Remove from build"
          style={{
            padding: "3px 8px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.12)",
            background: removeHovered ? "rgba(239,68,68,0.15)" : "transparent",
            color: removeHovered ? "#f87171" : "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontSize: 13,
            transition: "background 0.12s, color 0.12s",
            lineHeight: 1,
          }}
          aria-label={`Remove ${item.name} from build`}
        >
          ✕
        </button>
      </div>
    </li>
  );
}

// ─── Filter view item (non-draggable, for sell/optional sections) ─────────────

export function FilterViewItem({
  item,
  flagType,
  onToggleFlag,
  extraInfo,
  consumedComponents,
}: {
  item: Item;
  flagType: "sell" | "optional";
  onToggleFlag: (itemId: string) => void;
  extraInfo?: string;
  consumedComponents: Map<string, string[]>;
}) {
  const meta = CATEGORY_META[item.category];
  const accentColor = consumedComponents.has(item.id) ? "#6b7280" : meta.solid;
  const [hovered, setHovered] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 12,
        padding: "0 10px",
        height: 52,
        boxSizing: "border-box",
        background: hovered ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)",
        transition: "background 0.15s",
        overflow: "hidden",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Icon */}
      {item.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.icon}
          alt={item.name}
          width={28}
          height={28}
          style={{ borderRadius: 6, flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "rgba(255,255,255,0.08)",
            flexShrink: 0,
          }}
        />
      )}

      {/* Name + extra info */}
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 12,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={item.name}
        >
          {item.name}
        </div>
        {extraInfo ? (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{extraInfo}</div>
        ) : null}
      </div>

      {/* Unflag button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFlag(item.id);
        }}
        onMouseEnter={() => setBtnHovered(true)}
        onMouseLeave={() => setBtnHovered(false)}
        title={flagType === "sell" ? "Remove sell priority" : "Remove optional flag"}
        style={{
          padding: "3px 7px",
          borderRadius: 6,
          border:
            flagType === "sell" ? "1px solid rgba(239,68,68,0.4)" : "1px dashed rgba(255,255,255,0.3)",
          background: btnHovered
            ? flagType === "sell"
              ? "rgba(239,68,68,0.15)"
              : "rgba(255,255,255,0.07)"
            : "transparent",
          color: flagType === "sell" ? "#f87171" : "rgba(255,255,255,0.55)",
          cursor: "pointer",
          fontSize: 11,
          flexShrink: 0,
          transition: "background 0.12s",
          whiteSpace: "nowrap",
        }}
      >
        {flagType === "sell" ? "💰 Remove" : "? Remove"}
      </button>
    </li>
  );
}
