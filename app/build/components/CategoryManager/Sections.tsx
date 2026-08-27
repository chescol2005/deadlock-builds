"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Item, ItemAssignment } from "@/lib/items";
import { DraggableFixedItem, FilterViewItem } from "./ItemRow";

// ─── Collapsible phase section (sortable items, droppable zone) ───────────────

export function CollapsibleFixedSection({
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
  consumedComponents: Map<string, string[]>;
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
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: accentColor }}>{label}</span>
        {items.length > 0 ? <span style={{ fontSize: 12, opacity: 0.6 }}>{items.length}</span> : null}
        {headerExtra ? <span style={{ fontSize: 11, opacity: 0.6 }}>{headerExtra}</span> : null}
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
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
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

export function FlagFilterSection({
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
  consumedComponents: Map<string, string[]>;
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
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: accentColor }}>{label}</span>
        {items.length > 0 ? <span style={{ fontSize: 12, opacity: 0.6 }}>{items.length}</span> : null}
        {headerExtra ? <span style={{ fontSize: 11, opacity: 0.6 }}>{headerExtra}</span> : null}
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
