"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  // Optional controlled mode. When `open` is provided the caller owns the
  // state and hover/focus changes are reported through `onOpenChange`.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Shared tooltip wrapper — the sanctioned replacement for raw `title` attributes.
// Opens on hover and on keyboard focus so it stays usable without a mouse.
export function Tooltip({
  content,
  children,
  side = "top",
  open: controlledOpen,
  onOpenChange,
}: TooltipProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      {open ? (
        <span
          role="tooltip"
          id={id}
          // Below sm the bubble is a sheet pinned inside the screen edges: a
          // 16rem bubble centred on an icon near the edge of a phone would be cut off.
          className={`pointer-events-none z-50 rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-xs leading-snug text-zinc-100 shadow-lg max-sm:fixed max-sm:inset-x-4 max-sm:bottom-4 sm:absolute sm:w-max sm:max-w-64 ${
            side === "top"
              ? "sm:bottom-full sm:left-1/2 sm:mb-2 sm:-translate-x-1/2"
              : "sm:top-full sm:left-1/2 sm:mt-2 sm:-translate-x-1/2"
          }`}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

// Convenience wrapper for the common "info icon next to a label" case — used
// for the New Player UX "why does this matter?" copy where there's no
// existing element to attach a tooltip to.
export function InfoTooltip({
  content,
  label = "More info",
}: {
  content: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  // Pointer type and open state captured at pointerdown. Touch browsers emit
  // compat mouseenter (opening the tooltip) before click, so click must act on
  // the state from before the tap rather than toggling the current one.
  const pressRef = useRef<{ pointerType: string; wasOpen: boolean } | null>(null);

  // Dismiss on outside tap or Escape — listeners exist only while open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className="inline-flex">
      <Tooltip content={content} open={open} onOpenChange={setOpen}>
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          onPointerDown={(e) => {
            pressRef.current = { pointerType: e.pointerType, wasOpen: open };
          }}
          onClick={() => {
            const press = pressRef.current;
            pressRef.current = null;
            if (press?.pointerType === "mouse") {
              // Hover already opened it; a click keeps it open.
              setOpen(true);
            } else if (press) {
              setOpen(!press.wasOpen);
            } else {
              // Keyboard: focus already opened it, so Enter/Space keeps it open.
              setOpen(true);
            }
          }}
          className="inline-flex items-center justify-center text-zinc-500 transition-colors hover:text-zinc-300 pointer-coarse:p-2.5"
        >
          <Info size={13} strokeWidth={2} />
        </button>
      </Tooltip>
    </span>
  );
}
