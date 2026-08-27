"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import type { BuildCategory, Item, ItemAssignment, ItemDestination, ItemPhase } from "@/lib/items";
import { getSellRefund } from "@/lib/buildCalculations";
import { MAX_ACTIVE_ITEMS } from "@/lib/buildUtils";
import { accentFor, CATEGORY_META, getFixedDestination, PHASE_META } from "./constants";
import { DroppableZone } from "./DroppableZone";
import { SortableItem } from "./ItemRow";
import { CollapsibleFixedSection, FlagFilterSection } from "./Sections";
import { SortableCategory } from "./SortableCategory";
import { findCategoryOfItem, findTargetCategory } from "./helpers";

// ─── Pure helpers (module-level, not component-local) ─────────────────────────
// Defined outside the component body — rather than as closures inside it — so
// they aren't recreated on every render. This component re-renders on every
// drag-over event (it tracks `activeItemId` state that updates on hover), so
// avoiding per-render function allocation here matters more than elsewhere.
// They take the data they need (itemAssignments/categories/uncategorizedItems)
// as explicit params instead of closing over component scope.

// Resolves the drop destination for a cross-zone item move (phase zone,
// phase item, uncategorized zone/item, or user category). Only called from
// handleDragEnd — NOT from onDragOver — so the assignment/category commit
// happens exactly once, at drop, using the final `over` target. Committing
// this live on every hover (the previous behavior) meant a cancelled drag
// (Escape, or dropping outside any droppable) left the item wherever it had
// last hovered instead of reverting, since there was nothing left to revert.
function resolveItemDestination(
  overId: string,
  itemAssignments: ItemAssignment[],
  uncategorizedItems: Item[],
  categories: BuildCategory[],
): ItemDestination | null {
  // 1. Hovering over a phase zone (the zone background itself)
  const fixedDest = getFixedDestination(overId);
  if (fixedDest && fixedDest.type === "phase") {
    return fixedDest;
  }

  // 2. Hovering over an item that belongs to a phase (cross-phase or within-phase)
  const overItemPhase = itemAssignments.find((a) => a.itemId === overId)?.phase ?? null;
  if (overItemPhase !== null) {
    return { type: "phase", phase: overItemPhase };
  }

  // 3. Hovering over uncategorized zone or uncategorized item
  const isOverUncategorized =
    overId === "uncategorized" || uncategorizedItems.some((it) => it.id === overId);
  if (isOverUncategorized) {
    return { type: "uncategorized" };
  }

  // 4. Hovering over a user category
  const targetCategory = findTargetCategory(overId, categories);
  if (targetCategory) {
    return { type: "category", categoryId: targetCategory.id };
  }

  return null;
}

// Current destination of an item, in the same shape as resolveItemDestination,
// used to skip a no-op onItemMove call when the drop target is where the
// item already lives (e.g. dropped back on its own phase-zone background).
function currentItemDestination(
  itemId: string,
  itemAssignments: ItemAssignment[],
  categories: BuildCategory[],
): ItemDestination {
  const phase = itemAssignments.find((a) => a.itemId === itemId)?.phase ?? null;
  if (phase !== null) return { type: "phase", phase };
  const category = findCategoryOfItem(itemId, categories);
  if (category) return { type: "category", categoryId: category.id };
  return { type: "uncategorized" };
}

function destinationsEqual(a: ItemDestination, b: ItemDestination): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "phase" && b.type === "phase") return a.phase === b.phase;
  if (a.type === "category" && b.type === "category") return a.categoryId === b.categoryId;
  return true; // both "uncategorized"
}

// Helper: get location label for filter view items
function getLocationLabel(
  itemId: string,
  itemAssignments: ItemAssignment[],
  categories: BuildCategory[],
): string {
  const a = itemAssignments.find((x) => x.itemId === itemId);
  if (a?.phase) return PHASE_META[a.phase].label;
  const cat = categories.find((c) => c.itemIds.includes(itemId));
  if (cat) return cat.name;
  return "Uncategorized";
}

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
  simplified = false,
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
  consumedComponents: Map<string, string[]>;
  // New-player mode: hides sell-priority/optional flagging, which are
  // veteran organizational concepts, not core to placing an item.
  simplified?: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const activeFull = itemAssignments.filter((a) => a.active).length >= MAX_ACTIVE_ITEMS;

  // Suppressing these handlers (rather than threading `simplified` into every
  // child) hides the Sell/Optional buttons for free — ItemRow/SortableCategory
  // already render them conditionally on the handler being present.
  const effOnToggleSell = simplified ? undefined : onToggleSellPriority;
  const effOnToggleOptional = simplified ? undefined : onToggleOptional;

  // Only phase assignments exclude items from uncategorized/user categories
  const fixedItemIds = useMemo(
    () => new Set(itemAssignments.filter((a) => a.phase !== null).map((a) => a.itemId)),
    [itemAssignments],
  );

  const assignedCategoryItemIds = useMemo(
    () => new Set(categories.flatMap((c) => c.itemIds)),
    [categories],
  );
  const uncategorizedItems = useMemo(
    () => buildItems.filter((it) => !fixedItemIds.has(it.id) && !assignedCategoryItemIds.has(it.id)),
    [buildItems, fixedItemIds, assignedCategoryItemIds],
  );

  const itemById = useMemo(() => new Map(buildItems.map((it) => [it.id, it])), [buildItems]);

  // Derive per-section item lists
  const phaseItems = (phase: ItemPhase) =>
    buildItems.filter((it) => itemAssignments.find((a) => a.itemId === it.id)?.phase === phase);

  // Sell/optional are flags — items can be anywhere AND have these flags
  const sellItems = useMemo(
    () => buildItems.filter((it) => itemAssignments.find((a) => a.itemId === it.id)?.sellPriority),
    [buildItems, itemAssignments],
  );
  const optionalItems = useMemo(
    () => buildItems.filter((it) => itemAssignments.find((a) => a.itemId === it.id)?.optional),
    [buildItems, itemAssignments],
  );

  const totalSellValue = useMemo(
    () => sellItems.reduce((sum, it) => sum + getSellRefund(it.cost), 0),
    [sellItems],
  );

  function addCategory() {
    onCategoriesChange([...categories, { id: crypto.randomUUID(), name: "New Category", itemIds: [] }]);
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
            c.id === itemCategory.id ? { ...c, itemIds: arrayMove(c.itemIds, oldIndex, newIndex) } : c,
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

      // Cross-zone move — resolve and commit once, using the final drop target.
      const dest = resolveItemDestination(overId, itemAssignments, uncategorizedItems, categories);
      if (
        dest &&
        !destinationsEqual(dest, currentItemDestination(itemId, itemAssignments, categories))
      ) {
        onItemMove(itemId, dest);
      }
    }
  }

  // Cancelled drag (Escape key, or sensor/collision abort) — clear the ghost
  // overlay and do NOT call onItemMove. Since the commit only ever happens in
  // handleDragEnd now, there is nothing to revert: the underlying assignment/
  // category state was never touched during the drag.
  function handleDragCancel() {
    setActiveItemId(null);
  }

  const categoryIds = useMemo(() => categories.map((c) => c.id), [categories]);
  const uncatItemIds = useMemo(() => uncategorizedItems.map((it) => it.id), [uncategorizedItems]);
  const activeItem = activeItemId ? itemById.get(activeItemId) : null;

  const phases: ItemPhase[] = ["early", "mid", "late"];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      // CollapsibleFixedSection expands on hover (isOver), which resizes its
      // droppable rect mid-drag. With the default WhileDragging strategy that
      // resize feeds back into closestCenter on the next remeasure, and two
      // adjacent collapsed sections can flip `over` back and forth forever.
      // Freezing rects at drag-start breaks that feedback loop.
      measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
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
                onToggleSell={effOnToggleSell}
                onToggleOptional={effOnToggleOptional}
                assignments={itemAssignments}
                activeFull={activeFull}
              />
            );
          })}

          {!simplified ? (
            <>
              {/* Sell Priority — flag filter view, not a drag destination */}
              <FlagFilterSection
                label="Sell Priority"
                accentColor="#ef4444"
                bg="rgba(239,68,68,0.06)"
                headerExtra={
                  totalSellValue > 0 ? `~$${totalSellValue.toLocaleString("en-US")} back` : undefined
                }
                items={sellItems}
                consumedComponents={consumedComponents}
                renderItemExtra={(item) => {
                  const location = getLocationLabel(item.id, itemAssignments, categories);
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
                renderItemExtra={(item) => getLocationLabel(item.id, itemAssignments, categories)}
                onToggleFlag={onToggleOptional}
                flagType="optional"
              />
            </>
          ) : null}

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
                            onToggleSell={effOnToggleSell}
                            onToggleOptional={effOnToggleOptional}
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
                    onToggleSell={effOnToggleSell}
                    onToggleOptional={effOnToggleOptional}
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
              borderTop: "1px solid rgba(255,255,255,0.20)",
              borderRight: "1px solid rgba(255,255,255,0.20)",
              borderBottom: "1px solid rgba(255,255,255,0.20)",
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
