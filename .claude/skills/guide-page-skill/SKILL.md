---
name: guide-page
description: >
  Build new guide pages for Deadlock Foundry under the /guide/* route namespace.
  Use this skill whenever creating any educational or reference page for players —
  examples include farming guides, boon guides, mechanics explainers, item
  overviews, or any page that teaches game concepts rather than planning a build.
  Also use when a page needs the two-audience pattern (new player / advanced),
  a formula-driven data table with game-minute columns, a minimap overlay, or
  hardcoded game constants sourced from the API or deadlock.wiki. Trigger any
  time the user says "guide page", "new page for players", "explain X to new
  players", or "farming/boons/mechanics page".
---

# Guide Page Skill

## What a Guide Page Is

Guide pages live at `/guide/*` and teach players about game mechanics. They are
distinct from build planner pages — they have no scoring logic, no BuildState,
and no AI coach. They are purely educational.

The two audiences are always present:

- **New players**: prescriptive, plain English, "do this at this time"
- **Advanced / Veterans**: efficiency numbers, sortable tables, raw formula data

---

## Architecture Rules (Non-Negotiable)

- Route: `src/app/guide/[topic]/page.tsx` — server component shell
- Constants: `src/lib/[topic]/[topic]Data.ts` — all hardcoded game data
- Components: `src/app/guide/[topic]/components/` — co-located with the page
- **Zero imports from `src/lib/scoring/`** — guide pages never touch scoring
- **Zero imports from `src/lib/coach/`** — guide pages are static, not AI-driven
- `mini.ts` must still pass — guide pages add no scoring logic so all 50
  fixtures should be unaffected; run it anyway before every PR

---

## Data Sources (Authoritative)

Always verify game mechanic values from these sources, in priority order:

1. **deadlock.wiki** — soul values, spawn timers, boon thresholds, ability data
2. **`assets.deadlock-api.com/v2/misc-entities`** — breakable/spawner timings
3. **`assets.deadlock-api.com/v2/generic-data`** — item prices, new_player_metrics
4. **`assets.deadlock-api.com/v2/npc-units`** — NPC combat stats (not soul values)
5. **`assets.deadlock-api.com/v1/map`** — minimap image URLs, objective positions

**Soul value formulas** (verified May 2026, deadlock.wiki):

```typescript
// All return souls at a given game minute
trooper: (min: number) => 116 + 1.16 * min;
smallDenizen: (min: number) => 41 + 0.44 * min;
mediumDenizen: (min: number) => 68 + 0.73 * min;
largeDenizen: (min: number) => 181 + 1.95 * min;
sinnersSacrifice: (min: number) => 310 + 3.35 * min;
crate: (min: number) => 23 + 2.0 * min; // 60% drop chance
hero: (min: number) => 250 + 48.75 * min;
```

**Minimap image URL** (from /v1/map):

```
https://assets-bucket.deadlock-api.com/assets-api-res/images/maps/minimap.png
```

**Denizen spawn timers** (community verified, steamcommunity.com):

```
Small Camp  (T1): first spawn 2:00, respawn 1:25 (85s)
Medium Camp (T2): first spawn 6:00, respawn 4:50 (290s)
Hard Camp   (T3): first spawn 8:00, respawn 5:35 (335s)
Sinner's Sacrifice: first spawn 8:00, respawn 5:00 (300s)
Crate: first spawn 2:00, respawn 3:00 (180s)
Powerup spawner: first spawn 5:00, interval 5:00 (300s)
```

**Boon thresholds** (April 30 2026 patch — use these, not older values):

- After 13.2k: scales at 14.5k, then +1.5k per boon, ends at 40k
- Old values (15k/+2k ending at 49k) are WRONG — do not use

---

## Constants File Pattern

All game data for a guide page lives in `src/lib/[topic]/[topic]Data.ts`.

**Critical TypeScript rule**: Do NOT use `as const` on objects containing
functions. Arrow functions in `as const` objects break TypeScript strict mode.
Instead, separate static data from computed functions:

```typescript
// WRONG — breaks strict mode
export const CAMPS = [{ id: "small", available: (min: number) => min >= 2 }] as const;

// CORRECT — separate data from functions
export interface CampDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | null;
  firstSpawnMin: number;
  respawnSeconds: number;
  soulBase: number;
  soulPerMin: number;
  dropChance?: number; // only for probabilistic sources like crates
}

export const CAMPS: CampDef[] = [
  {
    id: "small_denizen",
    name: "Small Camp",
    tier: 1,
    firstSpawnMin: 2,
    respawnSeconds: 85,
    soulBase: 41,
    soulPerMin: 0.44,
  },
  // ...
];

// Pure functions separate from data
export function soulsAt(camp: CampDef, gameMinute: number): number | null {
  if (gameMinute < camp.firstSpawnMin) return null;
  return Math.round(camp.soulBase + camp.soulPerMin * gameMinute);
}

export function soulsPerMinEfficiency(camp: CampDef, gameMinute: number = 20): number {
  const souls = soulsAt(camp, gameMinute);
  if (souls === null) return 0;
  return Math.round((souls / camp.respawnSeconds) * 60);
}
```

---

## Two-Audience Page Pattern

Every guide page has a client component that toggles between new player and
advanced views. This is the standard pattern:

```tsx
// GuidePageClient.tsx — "use client"
const [activeTab, setActiveTab] = useState<"new_player" | "advanced">("new_player");

// Tab toggle bar
// active:   bg-amber-500 text-zinc-900 font-semibold rounded-lg px-4 py-2
// inactive: bg-zinc-800 text-zinc-400 hover:text-white rounded-lg px-4 py-2
```

The toggle always defaults to `"new_player"`. Veterans know to switch; new
players should never see the numbers table first.

---

## New Player Section Design

New player content must follow these rules:

- **Plain English only** — no stat names, no soul formulas, no respawn math
- **Prescriptive** — "do this at this time", not "here are your options"
- **Phase-based** — organize by game phase (laning / early jungle / mid / late)
- **One key insight per phase** — don't list everything available, highlight
  what matters most
- **Pill labels** for what's available — colored by source type, not by value

Phase card structure:

```tsx
// bg-zinc-800 border border-zinc-700 rounded-lg p-4
// Header: phase name (text-white font-semibold) + time badge (bg-zinc-700 text-xs)
// Body: tip (text-zinc-300 text-sm mt-2) — ONE sentence, prescriptive
// Footer: availability pills (border rounded-full text-xs px-2 py-0.5)
```

Pill color conventions:

```
Troopers:           text-orange-400  border-orange-400
Crates:             text-zinc-400    border-zinc-600
Small Camps:        text-zinc-300    border-zinc-500
Medium Camps:       text-amber-400   border-amber-500
Hard Camps:         text-orange-400  border-orange-500
Sinner's Sacrifice: text-purple-400  border-purple-500
All Camps:          text-amber-400   border-amber-500
Objectives:         text-red-400     border-red-500
```

---

## Advanced Section Design

Advanced content is for veterans who want efficiency data.

**Formula-driven table** — fixed game-minute columns, no slider:

- Columns at **5 / 10 / 15 / 20 / 25 / 30 minutes** (not a slider)
- Unavailable cells (camp not yet spawned): render `"—"` in `text-zinc-600`
  — NEVER render `0` for unavailable camps
- Soul value cells: `text-amber-400 font-mono`
- Souls/min efficiency column: `text-green-400 font-mono` — this is the
  key metric, put it last and make it visually distinct
- Highlight standout rows: Sinner's Sacrifice gets
  `border-l-2 border-purple-500` — it's almost always the best farm
- Sortable columns: clicking header cycles asc/desc, show `↑` / `↓` indicator
- Table chrome: `bg-zinc-900` body, `bg-zinc-800` header, `border-zinc-700`

**Efficiency formula** (souls per minute of respawn cycle, at 20min):

```typescript
soulsPerMinEfficiency = Math.round((soulsAt(camp, 20) / respawnSeconds) * 60);
```

---

## Minimap Overlay Pattern

Use the minimap image from `/v1/map` as a background with an SVG overlay for
camp markers. This is always a client component due to hover state.

```tsx
// MinimapOverlay.tsx — "use client"
// Container: relative div, max-w-md, aspect-square
// Image: <img src={MINIMAP_URL} className="w-full h-full object-cover rounded-lg" />
// SVG: absolute inset-0 w-full h-full pointer-events-none (except markers)
```

Marker color conventions (match pill colors):

```
small_denizen:    fill="#71717a"  (zinc-500)
medium_denizen:   fill="#f59e0b"  (amber-400)
large_denizen:    fill="#f97316"  (orange-400)
sinners_sacrifice: fill="#a855f7" (purple-500)
```

Marker anatomy:

```svg
<circle r="12" stroke="white" strokeWidth="1.5" fill={color} />
<text fontSize="8" fill="white" textAnchor="middle" dominantBaseline="middle">
  {label}
</text>
```

**Hover tooltips**: Do NOT use the HTML `title` attribute — it doesn't work
reliably on SVG across browsers. Use a positioned `<div>` with
`pointer-events-none` that appears on marker hover via React state.

**Marker positions**: Camp positions are hardcoded as `{ left: number, top: number }`
percentages of the image dimensions. Mark them with a `// ⚠️ TWEAK_ME` comment
— they will always need a visual tuning pass after first render since the API
gives no camp coordinates. Francesco will adjust after reviewing the first render.

Legend below the map: colored dot + label for each camp tier.

---

## Component File Structure

```
src/app/guide/[topic]/
  page.tsx                          — server component, metadata, layout shell
  components/
    [Topic]PageClient.tsx           — "use client", tab toggle
    PhaseTimeline.tsx               — new player phase cards (server-safe)
    CampTable.tsx (or data table)   — advanced sortable table ("use client")
    MinimapOverlay.tsx              — minimap + SVG markers ("use client")

src/lib/[topic]/
  [topic]Data.ts                    — all constants, types, pure functions
```

---

## Page Shell Template

```tsx
// src/app/guide/[topic]/page.tsx
import { [Topic]PageClient } from "./components/[Topic]PageClient";

export const metadata = { title: "[Topic] Guide | Deadlock Foundry" };

export default function [Topic]GuidePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <nav className="text-sm text-zinc-500 mb-6">
          <span>Home</span>
          <span className="mx-2">/</span>
          <span>Guides</span>
          <span className="mx-2">/</span>
          <span className="text-zinc-300">[Topic]</span>
        </nav>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">[Topic] Guide</h1>
          <p className="text-zinc-400 mt-2">[One-line description]</p>
        </div>
        <[Topic]PageClient />
      </div>
    </main>
  );
}
```

---

## /guide Layout

If `src/app/guide/layout.tsx` doesn't exist, create a minimal passthrough:

```tsx
export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

Do not add nav chrome here — the root layout handles that.

---

## Pre-PR Checklist

Before marking any guide page task complete:

- [ ] `/guide/[topic]` renders without errors in dev
- [ ] New Player tab is the default view
- [ ] Advanced tab shows formula-driven table with correct soul values
- [ ] Unavailable camps show `"—"` not `0`
- [ ] Minimap renders (markers may need tuning — expected, flag for Francesco)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] No imports from `src/lib/scoring/` or `src/lib/coach/`
- [ ] Prettier run before commit (`npx prettier --write src/`)
- [ ] `npm run mini` passes all 50 fixtures (guide pages don't touch scoring)
- [ ] Paste mini.ts output in PR body

---

## Philosophy to Encode in New Player Copy

The core message for any farming/economy guide:

> **Farm on the way to objectives. Objectives are always the priority.
> Farming is opportunistic — never detour for a camp.**

This framing should appear in phase card copy, not as a header or callout. It
should feel like advice from a teammate, not a rule from a manual.
