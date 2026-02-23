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

## How to test
- 
