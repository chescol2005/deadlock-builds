---
name: wireframe-to-component
description: >
  Convert hand-drawn wireframe sketches or rough mockups into
  production-ready React component specs and JSX for Deadlock Foundry.
  Use this skill whenever the user uploads a photo of a whiteboard sketch,
  hand-drawn wireframe, napkin drawing, or rough layout mockup and wants
  it turned into code or a component spec. Also use when the user says
  "here's my sketch", "I drew this out", "can you build this from my
  drawing", or shares any image that looks like a UI layout. Always use
  this skill before writing any component code from a visual reference —
  interpret the sketch first, confirm the interpretation, then produce
  the spec.
---

# Wireframe-to-Component Skill

## The Workflow

```
1. Interpret   — read the sketch, name every element
2. Confirm     — state your interpretation, flag ambiguities
3. Spec        — produce a written component spec
4. Scaffold    — produce the JSX shell with props + layout
5. Handoff     — produce the Claude Code prompt
```

Never skip straight to code. Always confirm interpretation first —
a misread sketch costs more to fix than 30 seconds of confirmation.

---

## Step 1 — Interpret the Sketch

When an image is provided, identify and name:

**Layout elements:**

- Page sections (header, sidebar, main panel, bottom bar)
- Grid or flex structure (how many columns, rows)
- Navigation flow arrows (what leads to what)
- Any labels written directly on the sketch
  **Interactive elements:**
- Tabs (label each one)
- Buttons (label and note position)
- Cards or grid items (how many, what they contain)
- Input fields or dropdowns
- Toggles or checkboxes
  **Annotations:**
- Any written notes near elements — these are often the most
  important design intent clues
- Arrows indicating navigation or data flow
- Asterisks or circles marking "important" areas
  **For Deadlock Foundry specifically, map sketch elements to:**

| Sketch element             | Likely component                  |
| -------------------------- | --------------------------------- |
| Hero portrait grid         | `HeroPickerGrid.tsx`              |
| Item grid with tabs        | `ItemBrowser.tsx`                 |
| Stat block / numbers panel | `BuildSummaryPanel.tsx`           |
| Horizontal bar             | `DamageSplitBar` or soul timeline |
| Ability cards in a row     | `AbilityLevelingPanel.tsx`        |
| Small grid (3x4 ish)       | `ActiveItemsGrid.tsx`             |
| Large scrollable list      | Game Plan section                 |
| Stick figure / character   | Hero display area                 |
| Navigation arrows          | Route transitions                 |

---

## Step 2 — Confirm Before Coding

After interpreting, present your reading back to the user in this format:

```
Here's what I read from the sketch:

**Page/Screen**: [name]
**Layout**: [describe the overall structure]

**Sections identified:**
1. [Section name] — [what it contains, what it does]
2. [Section name] — [what it contains, what it does]
...

**Navigation flow**: [describe any arrows or flow indicators]

**Notes from the sketch**: [any written annotations]

**Ambiguities — I need your input on:**
- [unclear element]: did you mean X or Y?
- [unlabeled area]: what should this show?

Does this match your intent?
```

Do not proceed to spec or code until the user confirms.

---

## Step 3 — Component Spec

Once confirmed, produce a written spec before any code:

````markdown
## Component: [ComponentName]

**File**: src/app/build/components/[ComponentName].tsx
**Type**: Client component (has interaction) | Server component (display only)

**Purpose**: [one sentence — what does this component do for the user?]

**New Player Consideration**: [how does this component serve new players?
Does it need a simplified?: boolean prop?]

**Props**:

```typescript
interface [ComponentName]Props {
  // list every prop with type and purpose
  heroId: string;                    // which hero this build is for
  simplified?: boolean;              // hide advanced controls for new players
}
```
````

**State** (if client component):

```typescript
// list useState and useMemo — never useState for derived values
const [activeTab, setActiveTab] = useState<"gun" | "spirit" | "vitality">("gun");
const filteredItems = useMemo(() => ..., [items, activeTab]);
```

**Sub-components needed**:

- [SubComponent] — [one line description]
  **Data dependencies**:
- [what data does this component need and where does it come from]
  **AI Coach hook** (if applicable):
- [what trigger event should fire from this component, if any]

````

---

## Step 4 — JSX Scaffold

Produce a working JSX shell that matches the spec. Follow these rules:

**Project conventions (non-negotiable):**
- Tailwind only — no inline styles, no CSS modules
- `lucide-react` for all icons
- Explicit TypeScript interface above the component
- `useMemo` for derived state — never `useState` for computed values
- `simplified?: boolean` prop on any panel that has advanced controls
- Loading skeleton consistent with `ItemBrowser.tsx` pattern

**Design conventions for Deadlock Foundry:**
- Dark theme — `bg-zinc-900`, `bg-zinc-800` for panels
- Accent color: amber/orange — `text-amber-400`, `border-amber-500`
- Category colors: gun = `text-orange-400`, spirit = `text-purple-400`,
  vitality = `text-green-400`
- Borders: `border-zinc-700` standard, `border-amber-500` for active/selected
- Text hierarchy: `text-white` headings, `text-zinc-300` body,
  `text-zinc-500` muted/labels

**Scaffold structure:**

```tsx
"use client"; // only if client component

import { useState, useMemo } from "react";
import { [Icons] } from "lucide-react";

interface [ComponentName]Props {
  // from spec
}

export function [ComponentName]({ ...props }: [ComponentName]Props) {
  // state (if client)

  // derived state via useMemo

  // simplified mode guard
  const showAdvanced = !props.simplified;

  return (
    <div className="[layout classes]">
      {/* section structure matching wireframe */}

      {showAdvanced && (
        <div>{/* advanced controls */}</div>
      )}
    </div>
  );
}
````

---

## Step 5 — Claude Code Prompt

After the scaffold is confirmed, produce a ready-to-run Claude Code
prompt. Use this template:

```
Context: Working on Deadlock Foundry (Next.js App Router, TypeScript
strict, Tailwind). Read CLAUDE.md and SKILL.md before starting.

Task: Implement [ComponentName] based on the following spec and scaffold.

Spec:
[paste spec from Step 3]

Starting scaffold:
[paste JSX from Step 4]

Integration points:
- Wire into [parent component] at [location]
- Receives [props] from BuildClient state
- Fires [coach trigger] when [event]

Acceptance criteria:
- [ ] Renders correctly with empty/loading state
- [ ] simplified={true} hides advanced controls
- [ ] No TypeScript errors (strict mode)
- [ ] Matches dark theme conventions (zinc + amber)
- [ ] Run npm run mini before marking complete

Do not modify any scoring files. Do not add any AI logic.
Run prettier before committing.
```

---

## Deadlock Foundry Sketch Vocabulary

Common shorthand Francesco uses in sketches:

| Sketch label                             | Meaning                                    |
| ---------------------------------------- | ------------------------------------------ |
| "chars" / "Characters"                   | Hero picker grid                           |
| "Items"                                  | Item browser with Spirit/Gun/Vitality tabs |
| "Stats"                                  | Build summary / stat totals panel          |
| "Build"                                  | Active items grid (12-slot)                |
| "Character" (in build screen)            | Hero portrait + base stats                 |
| Numbers in boxes (1-4)                   | Item tier indicators                       |
| Letters in boxes (A-E)                   | Hero cards in picker                       |
| Arrow between screens                    | Navigation / page flow                     |
| "Go from X to Y" annotation              | Route transition                           |
| Small grid below main                    | Ability leveling panel                     |
| "S / G / V" or "Spirit / Gun / Vitality" | Category tabs                              |

---

## Quality Check Before Handoff

Before producing the Claude Code prompt, verify:

- [ ] Every element from the sketch is accounted for in the spec
- [ ] `simplified?: boolean` prop added if component has 2+ complexity levels
- [ ] Coach trigger identified if the component is interactive
- [ ] All props are typed — no `any`
- [ ] Dark theme classes are correct (zinc-900/800, amber-400/500)
- [ ] Component file location follows `src/app/build/components/` convention
- [ ] No scoring imports — component is purely presentational or
      receives pre-computed values via props
