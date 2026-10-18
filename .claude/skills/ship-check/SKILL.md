---
name: ship-check
description: >
  Run the mandatory pre-commit / pre-PR gate for Deadlock Foundry and prepare
  a mergeable PR. Use this skill before any commit, before opening or updating
  a pull request, or whenever the user asks "is this ready", "can I commit",
  "open a PR", "prep for merge", or "did CI pass". It centralizes the required
  ordered checks (prettier, tsc, eslint, next build, mini), the explicit-staging and
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
npx prettier --check .     # 1. mirrors CI's format check
npx tsc --noEmit           # 2. typecheck — zero errors, zero `any`
npx eslint .               # 3. lint — 0 errors (2 pre-existing warnings are known)
npx next build             # 4. production build — judge by EXIT CODE
npm run mini               # 5. fixtures — final gate
```

Notes:

- **Prettier:** if `--check` lists files, run `npx prettier --write <those files>`
  only. **Never bare `prettier --write .`** — it once rewrote ~85 unrelated
  files with line-ending noise. (`.gitattributes` now pins `eol=lf`, but the
  rule stays.)
- **Build noise:** "Dynamic server usage … no-store fetch" and "items over 2MB
  can not be cached" are expected, not failures.
- **Mini:** `npm run mini` chains two harnesses with `&&`, each with its own
  summary line (`=== N passed, 0 failed ===` and `N passed, 0 failed`). A
  failure in the first hides the second, so read BOTH lines. Counts change
  constantly — never hardcode them.

If any step fails, **stop and fix the root cause** — never skip a step, never
commit around a red gate.

---

## Staging & commit rules

- **Never `git add .`** — stage files explicitly by path.
- Branch first if on `main`/`master`; do not commit to the default branch.
- Commit and push only when the user asks.
- End every commit message with the `Co-Authored-By` attribution line the
  session supplies for the model running (do not hardcode a model name here).
- Throwaway verification scripts (`src/scripts/_tmp*.ts`) must be deleted before
  commit; `git status --porcelain` should show none, and none may be staged.

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

GitHub Actions runs on pull requests to main, pushes to main, and `workflow_dispatch`.
It runs on every PR, docs-only included (`ci` is a required check on `main`, so a
skipped run would block the merge — never re-add `paths-ignore`). The gate above runs the same five steps in the same order. All must be
green; running them locally first avoids red-CI churn.

---

## Final checklist

- [ ] `prettier --check .` → clean (changed files only were `--write`n)
- [ ] `tsc --noEmit` → zero errors
- [ ] `eslint .` → 0 errors
- [ ] `next build` → exit code 0
- [ ] `npm run mini` → both harness summaries show 0 failed, output captured
- [ ] Files staged explicitly (no `git add .`), no `_tmp*` scripts
- [ ] On a feature branch, not `main`
- [ ] PR body includes mini output; scoring/AI changes not mixed
- [ ] Dev server killed
