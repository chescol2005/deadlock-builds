This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.


# 🧠 DeadlockBuilder (Working Title)

A Deadlock build planner + AI-powered match review coach.

StatLocker is a modern web application built with Next.js (App Router) that helps players:

Plan optimized builds

Understand item synergies

Analyze match performance

Receive structured, actionable improvement feedback

# 🚀 Vision

## DeadlockBuilder combines three pillars:

Hero Exploration
Deep hero stats and ability insights

Build Planner
Structured item + ability planning with intelligent suggestions

Match Review Coach
AI-assisted feedback on gameplay performance

The goal is to build the Deadlock equivalent of:

OP.GG + U.GG + Path of Building + AI Coach. But focused on clarity, speed, and actionable feedback.

## 🏗 Tech Stack

Next.js (App Router)
TypeScript
Vercel hosting
ISR (Incremental Static Regeneration)
LocalStorage (v1 build persistence)
Future: Database (Supabase/Postgres), KV cache

## 📂 Project Structure
app/
  build/
    BuildClient.tsx
    page.tsx
    [heroId]/
      page.tsx
  heroes/
    page.tsx
    [slug]/
      page.tsx
  review/
    page.tsx
    [matchId]/
      page.tsx
  api/
    review/
      route.ts

lib/
  deadlock.ts
  buildStorage.ts
  scoring.ts
  reviewNormalizer.ts
  ruleEngine.ts
  types.ts

## 📊 Data Sources
Static Data (Cached with ISR)

### Heroes
https://assets.deadlock-api.com/v2/heroes

### Items (planned)

### Abilities (planned)

Example fetch pattern:

fetch(url, {
  next: { revalidate: 3600 },
});

Dynamic Data (No Cache)

Match telemetry

Replay/log upload analysis

fetch(url, {
  cache: "no-store",
});

## 🧩 Core Features
### 1️⃣ Hero Explorer
Route
/heroes
/heroes/[slug]

## Features

Hero grid
Search + filter
Hero detail page
Ability display
Base stats
Build entry point
Definition of Done
All heroes render correctly
Detail page loads without errors
“Start Build” routes to /build/[heroId]

## 2️⃣ Build Planner
Routes
/build
/build/[heroId]

### Layout (3 Panel System)
#### Left Panel
Hero image
Class
Ability leveling planner
Derived stats

#### Center Panel
Items grouped by category:

Spirit
Gun
Vitality

#### Right Panel
Build summary
Suggested items
Warnings / synergy notes

Build State Model
type BuildState = {
  heroId: string;
  items: BuildItem[];
  abilities?: AbilityPlan;
};


Persisted in:

v1: localStorage
v2: Shareable URL
v3: Database save

Item Model
type Item = {
  id: string;
  name: string;
  category: "Spirit" | "Gun" | "Vitality";
  stats: Record<string, number>;
  tags: string[];
};

# 3️⃣ Deterministic Recommendation Engine

LLMs are NOT used for scoring.
User selects goal:
Burst
Sustain
Tank
Mobility
Objective damage
Convert goal → weights:
{
  spiritPower: 1.5,
  cooldownReduction: 1.2,
  health: 0.2
}

Score items:
score =
  spiritPower * weight.spiritPower +
  cooldownReduction * weight.cooldownReduction +
  health * weight.health

Output:

Top 3 recommended items

Explanation (stat-based)

Anti-synergy warnings

4️⃣ Match Review Coach
Routes
/review
/review/[matchId]

User Input

Match ID

Hero

Player name or slot

Optional role intent

Review Pipeline
Step 1 – Ingest

Fetch match telemetry.

Step 2 – Normalize
type ReviewInput = {
  hero: string;
  durationMin: number;
  score: { kills: number; deaths: number; assists: number };
  items: { name: string; tMin: number }[];
  deathMoments: { tMin: number }[];
  objectives?: { towers?: number; objDamage?: number };
};

Step 3 – Rule Engine

Examples:

Early death streaks

Late first item

Fighting before spike

No objective participation

Repeated isolated deaths

Step 4 – AI Narrative Layer (Optional)

LLM receives:

Normalized summary

Rule flags

LLM produces:

✅ What you did well

❌ Biggest mistakes

🎯 Top 3 improvement priorities

Important:

AI writes the explanation, not the facts.

🧠 Architectural Principles
1. Normalize external data immediately

Never trust external API shape directly in UI.

2. Deterministic logic before AI

Math first. LLM second.

3. Cache static data aggressively

Heroes/items rarely change.

4. Never cache match telemetry

Always fetch fresh.

5. Keep UI reactive and state-driven

Build page is fully client-side.

🛣 Roadmap
Phase 1 – Core MVP

Hero explorer

Basic build planner

Item grouping

Clear/remove build

Phase 2 – Intelligence

Deterministic scoring engine

Suggested next items

Anti-synergy detection

Phase 3 – Review MVP

Match ID ingestion

Rule-based feedback

Basic coaching output

Phase 4 – AI Layer

LLM narrative generation

Personalized improvement advice

Historical match comparison

Phase 5 – Community + Persistence

Accounts

Saved builds

Public build pages

Match history tracking

🎯 Definition of Success

A user can:

Pick a hero

Build items

Understand why items are good

Paste a Match ID

Receive actionable, prioritized feedback

Share the build or review with a URL

🔮 Long-Term Expansion Ideas

Meta build trends

“Average build vs your build” comparison

Skill leveling optimizer

Team comp synergy analyzer

Build export/import system

Seasonal balance tracking

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
