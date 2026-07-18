---
name: ship-check
description: >
  Run the mandatory pre-commit / pre-PR gate for Deadlock Foundry and prepare
  a mergeable PR. Use this skill before any commit, before opening or updating
  a pull request, or whenever the user asks "is this ready", "can I commit",
  "open a PR", "prep for merge", or "did CI pass". It centralizes the required
  ordered checks (prettier, tsc, next build, mini.ts), the explicit-staging and
  dev-server rules, the PR body requirements (mini output), gh label syntax, and
  the CI mirror. Always run this gate before marking any coding task complete.
---

# Ship Check Skill

The single source of truth for "is this change ready to commit / merge". Every
other skill's checklist defers here.

> Paths: real tree is `lib/…` and `app/…` (no `src/`). Commands below use `.`
> so they cover the whole repo regardless.

---

## The Gate — run in THIS order, all must pass

```bash
npx prettier --write .     # 1. format everything (CI fails on any unformatted file)
npx tsc --noEmit           # 2. typecheck — zero errors, zero `any`
npx next build             # 3. production build must succeed
npm run mini               # 4. 50-case fixture regression (final gate)
```

If any step fails, **stop and fix the root cause** — never skip a step, never
commit around a red gate. Order matters: prettier first so the later steps run
on formatted code.

---

## Staging & commit rules

- **Never `git add .`** — stage files explicitly by path.
- Branch first if on `main`/`master`; do not commit to the default branch.
- Commit and push only when the user asks.
- End every commit message with:

  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

- Kill the dev server before finishing a session.
- Turbopack dev-lock stuck? Clear it: `rm -rf .next` (POSIX) /
  `Remove-Item -Recurse -Force .next` (PowerShell).

---

## Pull request requirements

- **Paste the full `npm run mini` output in the PR body.** Every PR. No mini
  output = not mergeable.
- Keep scoring changes and AI-coach changes in **separate PRs** (architecture
  rule — reviewers reject mixed PRs).
- `gh` label syntax that actually works:

  ```bash
  gh pr create --title "…" --body "…" --field "labels[]=value"
  ```

- End PR bodies with:

  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

---

## CI mirror — local must equal remote

GitHub Actions runs on every push, in this order. Your local gate above covers
1–2 and 4–5; run lint (3) too before pushing:

1. Format (Prettier) — fails if any file unformatted
2. Typecheck (`tsc --noEmit`)
3. Lint (`npx eslint .`)
4. Build (`next build`)
5. Fixture (`mini.ts` — 50 regression cases)

All five must be green. Running them locally first avoids red-CI churn.

---

## Final checklist

- [ ] `prettier --write .` → clean
- [ ] `tsc --noEmit` → zero errors
- [ ] `eslint .` → clean
- [ ] `next build` → succeeds
- [ ] `npm run mini` → all 50 fixtures pass, output captured
- [ ] Files staged explicitly (no `git add .`)
- [ ] On a feature branch, not `main`
- [ ] PR body includes mini output; scoring/AI changes not mixed
- [ ] Dev server killed
