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
import type { BuildCategory, Item, ItemCategory } from "@/lib/items";

const CATEGORY_META: Record<
  ItemCategory,
  { label: string; solid: string; accentSoft: string }
> = {
  gun: { label: "Gun", solid: "#ea580c", accentSoft: "rgba(234,88,12,0.08)" },
  vitality: { label: "Vitality", solid: "#16a34a", accentSoft: "rgba(22,163,74,0.08)" },
  spirit: { label: "Spirit", solid: "#7c3aed", accentSoft: "rgba(124,58,237,0.08)" },
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

// ─── Sortable item ────────────────────────────────────────────────────────────

function SortableItem({
  item,
  categoryId,
  onRemove,
  consumed,
}: {
  item: Item;
  categoryId: string | null;
  onRemove: (itemId: string) => void;
  consumed: boolean;
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
    opacity: isDragging ? 0.4 : consumed ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: "1px solid rgba(255,255,255,0.10)",
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

// ─── Sortable category row ────────────────────────────────────────────────────

function SortableCategory({
  category,
  items,
  onRename,
  onRemoveFromCategory,
  consumedComponents,
}: {
  category: BuildCategory;
  items: Item[];
  onRename: (id: string, name: string) => void;
  onRemoveFromCategory: (categoryId: string, itemId: string) => void;
  consumedComponents: Map<string, string>;
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

        {/* Items — DroppableZone registers this area as a drop target */}
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
                  {items.map((item) => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      categoryId={category.id}
                      onRemove={(itemId) => onRemoveFromCategory(category.id, itemId)}
                      consumed={consumedComponents.has(item.id)}
                    />
                  ))}
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

function findCategoryOfItem(
  itemId: string,
  categories: BuildCategory[],
): BuildCategory | null {
  return categories.find((c) => c.itemIds.includes(itemId)) ?? null;
}

// overId may be a category id, an item id within a category, or "zone-{categoryId}"
function findTargetCategory(
  overId: string,
  categories: BuildCategory[],
): BuildCategory | null {
  if (overId.startsWith("zone-")) {
    const categoryId = overId.slice(5);
    return categories.find((c) => c.id === categoryId) ?? null;
  }
  return categories.find((c) => c.id === overId || c.itemIds.includes(overId)) ?? null;
}

// ─── Main CategoryManager ─────────────────────────────────────────────────────

export function CategoryManager({
  categories,
  buildItems,
  onCategoriesChange,
  onRemoveBuildItem,
  consumedComponents,
}: {
  categories: BuildCategory[];
  buildItems: Item[];
  onCategoriesChange: (categories: BuildCategory[]) => void;
  onRemoveBuildItem: (itemId: string) => void;
  consumedComponents: Map<string, string>;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const assignedItemIds = new Set(categories.flatMap((c) => c.itemIds));
  const uncategorizedItems = buildItems.filter((it) => !assignedItemIds.has(it.id));

  const itemById = new Map(buildItems.map((it) => [it.id, it]));

  function addCategory() {
    onCategoriesChange([
      ...categories,
      { id: crypto.randomUUID(), name: "New Category", itemIds: [] },
    ]);
  }

  function handleRename(id: string, name: string) {
    onCategoriesChange(categories.map((c) => (c.id === id ? { ...c, name } : c)));
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

    const currentCategory = findCategoryOfItem(itemId, categories);
    const currentCategoryId = currentCategory?.id ?? "uncategorized";

    // Hovering over the uncategorized zone or an uncategorized item
    const isOverUncategorized =
      overId === "uncategorized" || uncategorizedItems.some((it) => it.id === overId);

    if (isOverUncategorized) {
      if (currentCategoryId === "uncategorized") return;
      onCategoriesChange(
        categories.map((c) =>
          c.id === currentCategoryId
            ? { ...c, itemIds: c.itemIds.filter((id) => id !== itemId) }
            : c,
        ),
      );
      return;
    }

    const targetCategory = findTargetCategory(overId, categories);
    if (!targetCategory || targetCategory.id === currentCategoryId) return;

    onCategoriesChange(
      categories.map((c) => {
        if (c.id === currentCategoryId) {
          return { ...c, itemIds: c.itemIds.filter((id) => id !== itemId) };
        }
        if (c.id === targetCategory.id) {
          return { ...c, itemIds: [...c.itemIds, itemId] };
        }
        return c;
      }),
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveItemId(null);

    if (!over || active.id === over.id) return;

    const activeData = active.data.current as { type?: string } | undefined;

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

      // Same-category reorder: both item and over target are in the same category
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

      // Drop onto uncategorized sentinel — onDragOver may not have caught it
      if (overId === "uncategorized" && itemCategory) {
        onCategoriesChange(
          categories.map((c) => ({ ...c, itemIds: c.itemIds.filter((id) => id !== itemId) })),
        );
      }

      // All other cross-category moves were already handled by onDragOver
    }
  }

  const categoryIds = categories.map((c) => c.id);
  const uncatItemIds = uncategorizedItems.map((it) => it.id);
  const activeItem = activeItemId ? itemById.get(activeItemId) : null;

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

        <div style={{ display: "grid", gap: 16 }}>
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
                      {uncategorizedItems.map((item) => (
                        <SortableItem
                          key={item.id}
                          item={item}
                          categoryId={null}
                          onRemove={onRemoveBuildItem}
                          consumed={consumedComponents.has(item.id)}
                        />
                      ))}
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
                    onRemoveFromCategory={handleRemoveFromCategory}
                    consumedComponents={consumedComponents}
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
