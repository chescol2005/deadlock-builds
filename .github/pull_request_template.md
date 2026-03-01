## What changed
- 

## Why
- 

## Deterministic / Data-First Checklist
- [ ] No `any` introduced (prefer `unknown` + narrowing)
- [ ] Types updated where needed (no silent shape drift)
- [ ] Lint + Typecheck + Build pass locally (`npm run lint && npx tsc --noEmit && npm run build`)
- [ ] Any new “engine” logic includes tests or fixtures (if applicable)
- [ ] Changes are explainable and reproducible (no hidden heuristics)
- [ ] AI layer changes (explanations, summaries) are separate from deterministic scoring changes — not in the same PR

## How to test
- [ ] `mini.ts` fixture output included below (paste or screenshot)
