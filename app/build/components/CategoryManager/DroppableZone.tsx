"use client";

import { useDroppable } from "@dnd-kit/core";

export function DroppableZone({ id, children }: { id: string; children: React.ReactNode }) {
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
