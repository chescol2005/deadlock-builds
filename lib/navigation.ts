// Site navigation — the single source of truth for top-level sections and guides.
//
// SiteNav, the /guide index, the homepage guide strip and mini.ts all read from
// here, so adding a guide means adding one entry below. mini.ts fails if a
// folder under app/guide/ is missing from GUIDES, or if any href here does not
// resolve to an app/**/page.tsx — that is how the guides went unlinked before.

export interface NavLink {
  href: string;
  label: string;
  // Plain-English "why does this matter?" line, shown in tooltips and cards.
  description: string;
}

export const GUIDES: ReadonlyArray<NavLink> = [
  {
    href: "/guide/farming",
    label: "Farming",
    description: "Where souls come from and when to farm camps vs. push lanes.",
  },
  {
    href: "/guide/lanes",
    label: "Lanes",
    description: "Guardians, Walkers and Patrons: what they're worth and how waves arrive.",
  },
  {
    href: "/guide/boons",
    label: "Boons",
    description: "How your hero levels from souls, and when your ultimate unlocks.",
  },
  {
    href: "/guide/itemization",
    label: "Itemization",
    description: "Item tiers, upgrades, selling and the category investment bonus.",
  },
];

export const NAV_SECTIONS: ReadonlyArray<NavLink> = [
  {
    href: "/heroes",
    label: "Heroes",
    description: "Every hero with difficulty, playstyle tags and abilities.",
  },
  {
    href: "/items",
    label: "Items",
    description: "The full shop with stats, costs and how often each item wins.",
  },
  {
    href: "/build",
    label: "Build",
    description: "Plan a build for a hero and see why each item is suggested.",
  },
  {
    href: "/guide",
    label: "Guides",
    description: "Short explainers on the systems the game doesn't teach you.",
  },
];

// True when `pathname` is inside the section `href` (so /build/7 lights "Build").
export function isActiveSection(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
