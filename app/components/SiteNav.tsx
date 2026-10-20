"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Tooltip } from "@/app/components/Tooltip";
import { GUIDES, NAV_SECTIONS, isActiveSection } from "@/lib/navigation";

const MENU_ID = "site-nav-menu";

// Global nav; it has no veteran-only detail, so no `simplified` prop.
export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close on navigation: adjust state during render when the pathname changes
  // (React's recommended alternative to a setState-in-effect).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // The menu unmounts; return focus to the toggle rather than <body>.
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // "page" only on the exact page; a parent section of the current page is "true".
  const ariaCurrent = (href: string) =>
    pathname === href ? ("page" as const) : isActiveSection(pathname, href) ? true : undefined;

  const linkClass = (active: boolean) =>
    `border-b-2 px-1 py-4 text-sm font-medium transition-colors ${
      active
        ? "border-amber-500 text-amber-400"
        : "border-transparent text-zinc-300 hover:text-white"
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <nav aria-label="Main" className="mx-auto max-w-7xl px-4">
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="text-base font-bold text-white hover:text-amber-400">
            Deadlock Foundry
          </Link>

          <ul className="hidden items-center gap-6 md:flex">
            {NAV_SECTIONS.map((section) => {
              const active = isActiveSection(pathname, section.href);
              return (
                <li key={section.href} className="flex items-center">
                  <Tooltip side="bottom" content={section.description}>
                    <Link
                      href={section.href}
                      aria-current={ariaCurrent(section.href)}
                      className={linkClass(active)}
                    >
                      {section.label}
                    </Link>
                  </Tooltip>
                </li>
              );
            })}
          </ul>

          <button
            ref={toggleRef}
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-400 md:hidden"
            aria-expanded={open}
            aria-controls={MENU_ID}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {open ? (
          <div id={MENU_ID} className="max-h-[calc(100vh-3.5rem)] overflow-y-auto pb-4 md:hidden">
            <ul className="flex flex-col gap-1">
              {NAV_SECTIONS.map((section) => {
                const active = isActiveSection(pathname, section.href);
                const isGuides = section.href === "/guide";
                return (
                  <li key={section.href}>
                    <Link
                      href={section.href}
                      aria-current={ariaCurrent(section.href)}
                      onClick={() => setOpen(false)}
                      className={`block rounded-lg px-3 py-2 ${
                        active ? "bg-zinc-900 text-amber-400" : "text-white hover:bg-zinc-900"
                      }`}
                    >
                      <span className="block text-sm font-medium">{section.label}</span>
                      <span className="block text-xs text-zinc-400">{section.description}</span>
                    </Link>
                    {isGuides ? (
                      <ul className="mt-1 ml-4 flex flex-col gap-1 border-l border-zinc-800 pl-3">
                        {GUIDES.map((guide) => {
                          const guideActive = isActiveSection(pathname, guide.href);
                          return (
                            <li key={guide.href}>
                              <Link
                                href={guide.href}
                                aria-current={ariaCurrent(guide.href)}
                                onClick={() => setOpen(false)}
                                className={`block rounded-lg px-3 py-2 ${
                                  guideActive
                                    ? "bg-zinc-900 text-amber-400"
                                    : "text-zinc-200 hover:bg-zinc-900"
                                }`}
                              >
                                <span className="block text-sm font-medium">{guide.label}</span>
                                <span className="block text-xs text-zinc-400">
                                  {guide.description}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </nav>
    </header>
  );
}
