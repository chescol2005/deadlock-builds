## What changed

-

## Why

-

## Issues closed

<!-- Closes #XX -->

## Milestone

<!-- Which milestone does this complete or contribute to? -->

## Deterministic / Data-First Checklist

- [ ] No `any` introduced (prefer `unknown` + narrowing)
- [ ] Types updated where needed (no silent shape drift)
- [ ] Prettier clean (`npx prettier --write .`)
- [ ] Lint + Typecheck + Build pass locally
      (`npm run lint && npx tsc --noEmit && npm run build`)
- [ ] Any new scoring/engine logic has mini.ts fixture coverage
- [ ] Changes are explainable and reproducible (no hidden heuristics)
- [ ] AI layer changes are separate from deterministic scoring
      changes — not in the same PR
- [ ] Dev server killed before committing

## Game mechanic changes

<!-- If any game constants changed (costs, thresholds,
     scaling values), note them here with wiki source -->

## mini.ts fixture output

<!-- Run `npm run mini` and paste output below -->
<!-- PR will not be merged without this -->
