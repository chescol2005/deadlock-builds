"use client";

import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BuildCategory, Item, ItemAssignment } from "@/lib/items";
import { DroppableZone } from "./DroppableZone";
import { SortableItem } from "./ItemRow";

export function SortableCategory({
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
  consumedComponents: Map<string, string[]>;
  onToggleActive: (itemId: string) => void;
  onToggleSell?: (itemId: string) => void;
  onToggleOptional?: (itemId: string) => void;
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
            borderBottom: category.itemIds.length > 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
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
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
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
