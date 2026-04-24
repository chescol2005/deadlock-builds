"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  BuildCategory,
  Item,
  ItemCategory,
  ItemAssignment,
  ItemDestination,
  ItemPhase,
} from "@/lib/items";
import { getSellRefund } from "@/lib/buildCalculations";

const CATEGORY_META: Record<
  ItemCategory,
  { label: string; solid: string; accentSoft: string }
> = {
  gun: { label: "Gun", solid: "#ea580c", accentSoft: "rgba(234,88,12,0.08)" },
  vitality: { label: "Vitality", solid: "#16a34a", accentSoft: "rgba(22,163,74,0.08)" },
  spirit: { label: "Spirit", solid: "#7c3aed", accentSoft: "rgba(124,58,237,0.08)" },
};

const PHASE_META: Record<ItemPhase, { label: string; accent: string; bg: string }> = {
  early: { label: "Early Game", accent: "#eab308", bg: "rgba(234,179,8,0.08)" },
  mid: { label: "Mid Game", accent: "#3b82f6", bg: "rgba(59,130,246,0.08)" },
  late: { label: "Late Game", accent: "#ef4444", bg: "rgba(239,68,68,0.08)" },
};

function accentFor(item: Item): string {
  return CATEGORY_META[item.category]?.solid ?? "#7c3aed";
}

// ─── Droppable zone ───────────────────────────────────────────────────────────

function DroppableZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 48,
        background: isOver ? "rgba(255,255,255,0.05)" : "transparent",
        transition: "background 0.15s",
        borderRadius: 4,
      }}
    >
      {children}
    </div>
  );
}

// ─── Flag buttons ─────────────────────────────────────────────────────────────

function StarButton({
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
  const title = isOptional
    ? "Optional items cannot be active"
    : activeFull && !isActive
      ? "Active build full — remove an active item first"
      : isActive
        ? "Remove from active build"
        : "Mark as active build item";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      title={title}
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
  );
}

function SellButton({ isSell, onToggle }: { isSell: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={isSell ? "Remove sell priority" : "Mark as sell priority"}
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
  );
}

function OptionalButton({ isOptional, onToggle }: { isOptional: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={isOptional ? "Remove optional flag" : "Mark as optional"}
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
  );
}

// ─── Sortable item (used in uncategorized + user categories) ──────────────────

function SortableItem({
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : consumed ? 0.5 : isOptional ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: 6,
        border: isOptional
          ? "1px dashed rgba(255,255,255,0.25)"
          : "1px solid rgba(255,255,255,0.10)",
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
            textDecoration: consumed ? "line-through" : "none",
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
          {isOptional ? (
            <>
              <span>·</span>
              <span style={{ color: "rgba(255,255,255,0.5)", fontStyle: "italic" }}>Optional</span>
            </>
          ) : null}
        </div>
      </div>

      {/* Remove / Consumed */}
      {consumed ? (
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
      )}
    </li>
  );
}

// ─── Sortable phase-section item ──────────────────────────────────────────────

function DraggableFixedItem({
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
        border: isOptional
          ? "1px dashed rgba(255,255,255,0.25)"
          : "1px solid rgba(255,255,255,0.10)",
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
        </div>
        {extraInfo ? (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 1 }}>{extraInfo}</div>
        ) : null}
      </div>

      {/* Section-remove + build-remove buttons */}
      <div
        style={{ display: "flex", gap: 4, flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
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

function FilterViewItem({
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
  consumedComponents: Map<string, string>;
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
        border: "1px solid rgba(255,255,255,0.08)",
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
            flagType === "sell"
              ? "1px solid rgba(239,68,68,0.4)"
              : "1px dashed rgba(255,255,255,0.3)",
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

// ─── Collapsible phase section (sortable items, droppable zone) ───────────────

function CollapsibleFixedSection({
  zoneId,
  label,
  accentColor,
  bg,
  headerExtra,
  items,
  onRemoveFromSection,
  onRemoveBuildItem,
  consumedComponents,
  onToggleActive,
  assignments,
  activeFull,
  onToggleSell,
  onToggleOptional,
}: {
  zoneId: string;
  label: string;
  accentColor: string;
  bg: string;
  headerExtra?: string;
  items: Item[];
  onRemoveFromSection: (itemId: string) => void;
  onRemoveBuildItem: (itemId: string) => void;
  consumedComponents: Map<string, string>;
  onToggleActive?: (itemId: string) => void;
  assignments: ItemAssignment[];
  activeFull?: boolean;
  onToggleSell?: (itemId: string) => void;
  onToggleOptional?: (itemId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(items.length === 0);
  const { setNodeRef, isOver } = useDroppable({ id: zoneId });

  const showContent = !collapsed || isOver;

  return (
    <div
      style={{
        border: `1px solid ${accentColor}33`,
        borderRadius: 12,
        overflow: "hidden",
        background: bg,
      }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
          borderBottom: showContent ? `1px solid ${accentColor}22` : "none",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: accentColor,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: accentColor }}>
          {label}
        </span>
        {items.length > 0 ? (
          <span style={{ fontSize: 12, opacity: 0.6 }}>{items.length}</span>
        ) : null}
        {headerExtra ? (
          <span style={{ fontSize: 11, opacity: 0.6 }}>{headerExtra}</span>
        ) : null}
        <span style={{ fontSize: 11, opacity: 0.45 }}>{collapsed && !isOver ? "▶" : "▼"}</span>
      </button>

      {/* Drop zone + sortable content */}
      <div ref={setNodeRef}>
        {showContent ? (
          <div style={{ padding: items.length === 0 ? "10px 12px" : "8px 12px" }}>
            {items.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.4,
                  fontStyle: "italic",
                  textAlign: "center",
                  padding: "8px 0",
                  border: `1px dashed ${accentColor}44`,
                  borderRadius: 8,
                }}
              >
                Drop items here
              </div>
            ) : (
              <SortableContext
                items={items.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul
                  style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}
                >
                  {items.map((item) => {
                    const assignment = assignments.find((a) => a.itemId === item.id);
                    return (
                      <DraggableFixedItem
                        key={item.id}
                        item={item}
                        sectionId={zoneId}
                        onRemoveFromSection={onRemoveFromSection}
                        onRemoveBuildItem={onRemoveBuildItem}
                        consumed={consumedComponents.has(item.id)}
                        onToggleActive={onToggleActive}
                        isActive={assignment?.active ?? false}
                        activeFull={activeFull}
                        isSellPriority={assignment?.sellPriority ?? false}
                        isOptional={assignment?.optional ?? false}
                        onToggleSell={onToggleSell}
                        onToggleOptional={onToggleOptional}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            )}
          </div>
        ) : (
          <div style={{ height: 6 }} />
        )}
      </div>
    </div>
  );
}

// ─── Flag filter section (non-droppable, read-only view) ─────────────────────

function FlagFilterSection({
  label,
  accentColor,
  bg,
  headerExtra,
  items,
  consumedComponents,
  renderItemExtra,
  onToggleFlag,
  flagType,
}: {
  label: string;
  accentColor: string;
  bg: string;
  headerExtra?: string;
  items: Item[];
  consumedComponents: Map<string, string>;
  renderItemExtra?: (item: Item) => string | undefined;
  onToggleFlag: (itemId: string) => void;
  flagType: "sell" | "optional";
}) {
  const [collapsed, setCollapsed] = useState(items.length === 0);
  const showContent = !collapsed;

  return (
    <div
      style={{
        border: `1px solid ${accentColor}33`,
        borderRadius: 12,
        overflow: "hidden",
        background: bg,
      }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
          borderBottom: showContent ? `1px solid ${accentColor}22` : "none",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: accentColor,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: accentColor }}>
          {label}
        </span>
        {items.length > 0 ? (
          <span style={{ fontSize: 12, opacity: 0.6 }}>{items.length}</span>
        ) : null}
        {headerExtra ? (
          <span style={{ fontSize: 11, opacity: 0.6 }}>{headerExtra}</span>
        ) : null}
        <span style={{ fontSize: 11, opacity: 0.45 }}>{collapsed ? "▶" : "▼"}</span>
      </button>

      {/* Content — no droppable zone */}
      {showContent ? (
        <div style={{ padding: items.length === 0 ? "10px 12px" : "8px 12px" }}>
          {items.length === 0 ? (
            <div
              style={{
                fontSize: 12,
                opacity: 0.4,
                fontStyle: "italic",
                textAlign: "center",
                padding: "8px 0",
              }}
            >
              No {flagType === "sell" ? "sell priority" : "optional"} items
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {items.map((item) => (
                <FilterViewItem
                  key={item.id}
                  item={item}
                  flagType={flagType}
                  onToggleFlag={onToggleFlag}
                  extraInfo={renderItemExtra?.(item)}
                  consumedComponents={consumedComponents}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Sortable category row ────────────────────────────────────────────────────

function SortableCategory({
  category,
  items,
  onRename,
  onDelete,
  onRemoveFromCategory,
  consumedComponents,
  onToggleActive,
  onToggleSell,
  onToggleOptional,
  assignments,
  activeFull,
}: {
  category: BuildCategory;
  items: Item[];
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRemoveFromCategory: (categoryId: string, itemId: string) => void;
  consumedComponents: Map<string, string>;
  onToggleActive: (itemId: string) => void;
  onToggleSell: (itemId: string) => void;
  onToggleOptional: (itemId: string) => void;
  assignments: ItemAssignment[];
  activeFull: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    data: { type: "category" },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const [deleteHovered, setDeleteHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(category.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    setEditing(false);
    const trimmed = draft.trim() || "New Category";
    onRename(category.id, trimmed);
  }

  return (
    <div ref={setNodeRef} style={style} data-category-id={category.id}>
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 12,
          overflow: "hidden",
          background: "rgba(0,0,0,0.15)",
          transition: "background 0.15s",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderBottom:
              category.itemIds.length > 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(category.name);
                }
              }}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 6,
                padding: "3px 8px",
                color: "inherit",
                fontSize: 14,
                fontWeight: 700,
              }}
            />
          ) : (
            <button
              onClick={startEdit}
              style={{
                flex: 1,
                textAlign: "left",
                background: "none",
                border: "none",
                color: "inherit",
                fontWeight: 700,
                fontSize: 14,
                cursor: "text",
                padding: 0,
              }}
              title="Click to rename"
            >
              {category.name}
            </button>
          )}

          <button
            onClick={() => onDelete(category.id)}
            onMouseEnter={() => setDeleteHovered(true)}
            onMouseLeave={() => setDeleteHovered(false)}
            style={{
              background: "none",
              border: "none",
              color: deleteHovered ? "#f87171" : "rgba(255,255,255,0.3)",
              cursor: "pointer",
              padding: "2px 4px",
              fontSize: 13,
              lineHeight: 1,
              flexShrink: 0,
              transition: "color 0.12s",
            }}
            title="Delete category"
            aria-label="Delete category"
          >
            ✕
          </button>

          <button
            {...attributes}
            {...listeners}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "grab",
              padding: "2px 4px",
              fontSize: 16,
              lineHeight: 1,
              flexShrink: 0,
            }}
            title="Drag to reorder"
            aria-label="Drag to reorder category"
          >
            ⠿
          </button>
        </div>

        {/* Items */}
        <DroppableZone id={`zone-${category.id}`}>
          <div style={{ padding: category.itemIds.length === 0 ? "10px 12px" : "8px 12px" }}>
            {category.itemIds.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.4,
                  fontStyle: "italic",
                  textAlign: "center",
                  padding: "8px 0",
                  border: "1px dashed rgba(255,255,255,0.15)",
                  borderRadius: 8,
                }}
              >
                Drop items here
              </div>
            ) : (
              <SortableContext items={category.itemIds} strategy={verticalListSortingStrategy}>
                <ul
                  style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}
                >
                  {items.map((item) => {
                    const assignment = assignments.find((a) => a.itemId === item.id);
                    return (
                      <SortableItem
                        key={item.id}
                        item={item}
                        categoryId={category.id}
                        onRemove={(itemId) => onRemoveFromCategory(category.id, itemId)}
                        consumed={consumedComponents.has(item.id)}
                        onToggleActive={onToggleActive}
                        isActive={assignment?.active ?? false}
                        isOptional={assignment?.optional ?? false}
                        isSellPriority={assignment?.sellPriority ?? false}
                        activeFull={activeFull}
                        onToggleSell={onToggleSell}
                        onToggleOptional={onToggleOptional}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            )}
          </div>
        </DroppableZone>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findCategoryOfItem(itemId: string, categories: BuildCategory[]): BuildCategory | null {
  return categories.find((c) => c.itemIds.includes(itemId)) ?? null;
}

function findTargetCategory(overId: string, categories: BuildCategory[]): BuildCategory | null {
  if (overId.startsWith("zone-")) {
    const categoryId = overId.slice(5);
    return categories.find((c) => c.id === categoryId) ?? null;
  }
  return categories.find((c) => c.id === overId || c.itemIds.includes(overId)) ?? null;
}

// Only phase zones are valid drag destinations now
const FIXED_ZONE_MAP: Record<string, ItemDestination> = {
  "zone-phase-early": { type: "phase", phase: "early" },
  "zone-phase-mid": { type: "phase", phase: "mid" },
  "zone-phase-late": { type: "phase", phase: "late" },
};

function getFixedDestination(overId: string): ItemDestination | null {
  return FIXED_ZONE_MAP[overId] ?? null;
}

function getCurrentPhaseZone(itemId: string, assignments: ItemAssignment[]): string | null {
  const a = assignments.find((x) => x.itemId === itemId);
  if (!a?.phase) return null;
  return `zone-phase-${a.phase}`;
}

// ─── Main CategoryManager ─────────────────────────────────────────────────────

export function CategoryManager({
  categories,
  buildItems,
  itemAssignments,
  onCategoriesChange,
  onItemMove,
  onRemoveBuildItem,
  onToggleActive,
  onToggleSellPriority,
  onToggleOptional,
  onReorderBuildItems,
  consumedComponents,
}: {
  categories: BuildCategory[];
  buildItems: Item[];
  itemAssignments: ItemAssignment[];
  onCategoriesChange: (categories: BuildCategory[]) => void;
  onItemMove: (itemId: string, dest: ItemDestination) => void;
  onRemoveBuildItem: (itemId: string) => void;
  onToggleActive: (itemId: string) => void;
  onToggleSellPriority: (itemId: string) => void;
  onToggleOptional: (itemId: string) => void;
  onReorderBuildItems: (itemId: string, overId: string) => void;
  consumedComponents: Map<string, string>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const activeFull = itemAssignments.filter((a) => a.active).length >= 12;

  // Only phase assignments exclude items from uncategorized/user categories
  const fixedItemIds = new Set(
    itemAssignments.filter((a) => a.phase !== null).map((a) => a.itemId),
  );

  const assignedCategoryItemIds = new Set(categories.flatMap((c) => c.itemIds));
  const uncategorizedItems = buildItems.filter(
    (it) => !fixedItemIds.has(it.id) && !assignedCategoryItemIds.has(it.id),
  );

  const itemById = new Map(buildItems.map((it) => [it.id, it]));

  // Derive per-section item lists
  const phaseItems = (phase: ItemPhase) =>
    buildItems.filter((it) => itemAssignments.find((a) => a.itemId === it.id)?.phase === phase);

  // Sell/optional are flags — items can be anywhere AND have these flags
  const sellItems = buildItems.filter(
    (it) => itemAssignments.find((a) => a.itemId === it.id)?.sellPriority,
  );
  const optionalItems = buildItems.filter(
    (it) => itemAssignments.find((a) => a.itemId === it.id)?.optional,
  );

  const totalSellValue = sellItems.reduce((sum, it) => sum + getSellRefund(it.cost), 0);

  function addCategory() {
    onCategoriesChange([
      ...categories,
      { id: crypto.randomUUID(), name: "New Category", itemIds: [] },
    ]);
  }

  function handleRename(id: string, name: string) {
    onCategoriesChange(categories.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  function handleDeleteCategory(id: string) {
    onCategoriesChange(categories.filter((c) => c.id !== id));
  }

  function handleRemoveFromCategory(categoryId: string, itemId: string) {
    onCategoriesChange(
      categories.map((c) =>
        c.id === categoryId ? { ...c, itemIds: c.itemIds.filter((id) => id !== itemId) } : c,
      ),
    );
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { type?: string } | undefined;
    if (data?.type === "item") {
      setActiveItemId(String(event.active.id));
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as { type?: string } | undefined;
    if (activeData?.type !== "item") return;

    const itemId = String(active.id);
    const overId = String(over.id);

    // 1. Hovering over a phase zone (the zone background itself)
    const fixedDest = getFixedDestination(overId);
    if (fixedDest && fixedDest.type === "phase") {
      const currentZone = getCurrentPhaseZone(itemId, itemAssignments);
      const destZoneId = `zone-phase-${fixedDest.phase}`;
      if (currentZone === destZoneId) return;
      onItemMove(itemId, fixedDest);
      return;
    }

    // 2. Hovering over an item that belongs to a phase (cross-phase or within-phase)
    const overItemPhase =
      itemAssignments.find((a) => a.itemId === overId)?.phase ?? null;
    if (overItemPhase !== null) {
      const curPhase = itemAssignments.find((a) => a.itemId === itemId)?.phase ?? null;
      if (curPhase === overItemPhase) return; // Same phase — SortableContext handles visual
      onItemMove(itemId, { type: "phase", phase: overItemPhase });
      return;
    }

    // 3. Hovering over uncategorized zone or uncategorized item
    const currentCategory = findCategoryOfItem(itemId, categories);
    const currentCategoryId = currentCategory?.id ?? "uncategorized";

    const isOverUncategorized =
      overId === "uncategorized" || uncategorizedItems.some((it) => it.id === overId);

    if (isOverUncategorized) {
      const currentZone = getCurrentPhaseZone(itemId, itemAssignments);
      if (currentCategoryId === "uncategorized" && currentZone === null) return;
      onItemMove(itemId, { type: "uncategorized" });
      return;
    }

    // 4. Hovering over a user category
    const targetCategory = findTargetCategory(overId, categories);
    if (!targetCategory || targetCategory.id === currentCategoryId) return;
    onItemMove(itemId, { type: "category", categoryId: targetCategory.id });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveItemId(null);

    if (!over || active.id === over.id) return;

    const activeData = active.data.current as { type?: string } | undefined;

    // Category reorder
    if (activeData?.type === "category") {
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = categories.findIndex((c) => c.id === activeId);
      const newIndex = categories.findIndex((c) => c.id === overId);
      if (oldIndex !== -1 && newIndex !== -1) {
        onCategoriesChange(arrayMove(categories, oldIndex, newIndex));
      }
      return;
    }

    if (activeData?.type === "item") {
      const itemId = String(active.id);
      const overId = String(over.id);

      // Same user-category reorder
      const itemCategory = findCategoryOfItem(itemId, categories);
      if (itemCategory && itemCategory.itemIds.includes(overId)) {
        const oldIndex = itemCategory.itemIds.indexOf(itemId);
        const newIndex = itemCategory.itemIds.indexOf(overId);
        onCategoriesChange(
          categories.map((c) =>
            c.id === itemCategory.id
              ? { ...c, itemIds: arrayMove(c.itemIds, oldIndex, newIndex) }
              : c,
          ),
        );
        return;
      }

      // Same phase reorder
      const activePhase = itemAssignments.find((a) => a.itemId === itemId)?.phase ?? null;
      const overPhase = itemAssignments.find((a) => a.itemId === overId)?.phase ?? null;
      if (activePhase !== null && activePhase === overPhase) {
        onReorderBuildItems(itemId, overId);
        return;
      }

      // All other cross-zone moves are handled live by onDragOver
    }
  }

  const categoryIds = categories.map((c) => c.id);
  const uncatItemIds = uncategorizedItems.map((it) => it.id);
  const activeItem = activeItemId ? itemById.get(activeItemId) : null;

  const phases: ItemPhase[] = ["early", "mid", "late"];

  // Helper: get location label for filter view items
  function getLocationLabel(itemId: string): string {
    const a = itemAssignments.find((x) => x.itemId === itemId);
    if (a?.phase) return PHASE_META[a.phase].label;
    const cat = categories.find((c) => c.itemIds.includes(itemId));
    if (cat) return cat.name;
    return "Uncategorized";
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>Build</h2>
          <button
            onClick={addCategory}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(255,255,255,0.07)",
              color: "inherit",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            + Add Category
          </button>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {/* Phase sections — sortable, droppable */}
          {phases.map((phase) => {
            const meta = PHASE_META[phase];
            const items = phaseItems(phase);
            return (
              <CollapsibleFixedSection
                key={phase}
                zoneId={`zone-phase-${phase}`}
                label={meta.label}
                accentColor={meta.accent}
                bg={meta.bg}
                items={items}
                onRemoveFromSection={(itemId) => onItemMove(itemId, { type: "uncategorized" })}
                onRemoveBuildItem={onRemoveBuildItem}
                consumedComponents={consumedComponents}
                onToggleActive={onToggleActive}
                onToggleSell={onToggleSellPriority}
                onToggleOptional={onToggleOptional}
                assignments={itemAssignments}
                activeFull={activeFull}
              />
            );
          })}

          {/* Sell Priority — flag filter view, not a drag destination */}
          <FlagFilterSection
            label="Sell Priority"
            accentColor="#ef4444"
            bg="rgba(239,68,68,0.06)"
            headerExtra={
              totalSellValue > 0
                ? `~$${totalSellValue.toLocaleString("en-US")} back`
                : undefined
            }
            items={sellItems}
            consumedComponents={consumedComponents}
            renderItemExtra={(item) => {
              const location = getLocationLabel(item.id);
              return `${location} · Sells for $${getSellRefund(item.cost).toLocaleString("en-US")} souls`;
            }}
            onToggleFlag={onToggleSellPriority}
            flagType="sell"
          />

          {/* Optional — flag filter view, not a drag destination */}
          <FlagFilterSection
            label="Optional"
            accentColor="#6b7280"
            bg="rgba(107,114,128,0.06)"
            items={optionalItems}
            consumedComponents={consumedComponents}
            renderItemExtra={(item) => getLocationLabel(item.id)}
            onToggleFlag={onToggleOptional}
            flagType="optional"
          />

          {/* Uncategorized section */}
          <div>
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
              Uncategorized
            </div>
            <DroppableZone id="uncategorized">
              <div
                style={{
                  border: "1px dashed rgba(255,255,255,0.12)",
                  borderRadius: 10,
                  padding: uncategorizedItems.length === 0 ? "10px 12px" : "8px 12px",
                  minHeight: 44,
                  background: "rgba(0,0,0,0.08)",
                }}
              >
                {buildItems.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.5, fontStyle: "italic" }}>
                    No items added yet.
                  </div>
                ) : uncategorizedItems.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.4, fontStyle: "italic" }}>
                    All items are categorized.
                  </div>
                ) : (
                  <SortableContext items={uncatItemIds} strategy={verticalListSortingStrategy}>
                    <ul
                      style={{
                        listStyle: "none",
                        padding: 0,
                        margin: 0,
                        display: "grid",
                        gap: 6,
                      }}
                    >
                      {uncategorizedItems.map((item) => {
                        const assignment = itemAssignments.find((a) => a.itemId === item.id);
                        return (
                          <SortableItem
                            key={item.id}
                            item={item}
                            categoryId={null}
                            onRemove={onRemoveBuildItem}
                            consumed={consumedComponents.has(item.id)}
                            onToggleActive={onToggleActive}
                            isActive={assignment?.active ?? false}
                            isOptional={assignment?.optional ?? false}
                            isSellPriority={assignment?.sellPriority ?? false}
                            activeFull={activeFull}
                            onToggleSell={onToggleSellPriority}
                            onToggleOptional={onToggleOptional}
                          />
                        );
                      })}
                    </ul>
                  </SortableContext>
                )}
              </div>
            </DroppableZone>
          </div>

          {/* User-created categories */}
          <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
            <div style={{ display: "grid", gap: 10 }}>
              {categories.map((cat) => {
                const catItems = cat.itemIds.flatMap((id) => {
                  const it = itemById.get(id);
                  return it ? [it] : [];
                });
                return (
                  <SortableCategory
                    key={cat.id}
                    category={cat}
                    items={catItems}
                    onRename={handleRename}
                    onDelete={handleDeleteCategory}
                    onRemoveFromCategory={handleRemoveFromCategory}
                    consumedComponents={consumedComponents}
                    onToggleActive={onToggleActive}
                    onToggleSell={onToggleSellPriority}
                    onToggleOptional={onToggleOptional}
                    assignments={itemAssignments}
                    activeFull={activeFull}
                  />
                );
              })}
            </div>
          </SortableContext>
        </div>
      </section>

      <DragOverlay>
        {activeItem ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "1px solid rgba(255,255,255,0.20)",
              borderLeft: `4px solid ${accentFor(activeItem)}`,
              borderRadius: 12,
              padding: "0 10px",
              height: 60,
              boxSizing: "border-box",
              background: "#1e1e2e",
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              cursor: "grabbing",
              overflow: "hidden",
            }}
          >
            {activeItem.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeItem.icon}
                alt={activeItem.name}
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
            <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {activeItem.name}
              </div>
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 3 }}>
                <span style={{ color: CATEGORY_META[activeItem.category].solid }}>
                  {CATEGORY_META[activeItem.category].label}
                </span>
                {" · "}T{activeItem.tier}
                {" · "}${activeItem.cost.toLocaleString("en-US")}
              </div>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
