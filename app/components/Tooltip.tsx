"use client";

import { useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
}

// Shared tooltip wrapper — the sanctioned replacement for raw `title` attributes.
// Opens on hover and on keyboard focus so it stays usable without a mouse.
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [open, setOpen] = useState(false);
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
          className={`pointer-events-none absolute z-50 w-max max-w-64 rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-xs leading-snug text-zinc-100 shadow-lg ${
            side === "top"
              ? "bottom-full left-1/2 mb-2 -translate-x-1/2"
              : "top-full left-1/2 mt-2 -translate-x-1/2"
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
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex items-center justify-center text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <Info size={13} strokeWidth={2} />
      </button>
    </Tooltip>
  );
}
