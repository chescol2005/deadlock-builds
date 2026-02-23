# DeadlockFoundry.gg – Copilot Instructions (Deterministic-First)

## Core principle
Prefer deterministic, explainable systems over heuristics or “magic.” If uncertain, ask for missing requirements or implement the smallest safe change plus TODOs/tests.

## Non-negotiables
- Do not introduce `any`. Use `unknown` and narrow with runtime checks where needed.
- Keep data contracts explicit: types + parsing/normalization are the source of truth.
- Favor pure functions for scoring/modeling logic (easy to test).
- No silent behavior changes: if behavior changes, update docs/tests.

## Engineering guardrails
- Keep PRs small and reviewable.
- Don’t refactor unrelated code unless requested.
- Add/maintain unit tests when touching deterministic engine logic.
- Prefer additive changes over rewrites.

## Project structure conventions
- `lib/` is data access + normalization. Keep fetch/normalize logic here.
- Deterministic engine logic should live under `engine/` (or `lib/engine/`) as pure modules:
  - inputs/outputs typed
  - no network calls
  - no reliance on browser APIs

## UI conventions
- Do not bake logic into UI components.
- Avoid storing derived state; derive from source-of-truth when possible.
- Keep client-only APIs (localStorage, search params) isolated to client components.

## When making changes
Always run (or ensure CI will run):
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
