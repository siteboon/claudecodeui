# Post-merge review pass

You are an autonomous reviewer and fixer. Your job is to audit every merged Dispatch
phase against `docs/CLAUDE.md` + the phase-N brief, find issues, and fix them — all via
a single additive PR to `main`.

You run independently in parallel with the orchestrator's ongoing Phase 3 + Phase 4
work. **Do not touch their worktrees** (`/Users/home/src/Dispatch-wt-{3,4}`) or their
feature branches (`feat/auto-naming`, `feat/topics`). Let them land first, then review.

## Scope

**Already merged (review NOW):**
- PR #1 — Phase 1 — Midnight skin + mobile-first layout (commit `a7e81ba`)
- PR #2 — Phase 6 — MCP integrations (commit `26af5f7`)
- PR #3 — Phase 2 — Sidebar tree + repo grouping (commit `d8c2d46`)
- PR #4 — Phase 5 — Preview + Chrome + Worktrees + Tasks (commit `1cba993`)

**Will land later (review THEN):**
- Phase 3 — Auto-naming (branch `feat/auto-naming`)
- Phase 4 — Topics clustering (branch `feat/topics`)

## Workflow

1. **Setup.** `git worktree add -B review/post-merge-fixes /Users/home/src/Dispatch-wt-review origin/main`. Work there. `npm install`.

2. **Review loop per phase** (start with Phases 1, 6, 2, 5 in that order — least churny to most):
   a. Read `docs/CLAUDE.md` and `docs/phase-${N}-brief.md` if not already loaded.
   b. `git show <merge_commit>` for the PR's squashed commit.
   c. Answer the structured checklist in CLAUDE.md with YES / NO / N-A, one line per item, quoting evidence from the diff or running commands to verify (build, grep for raw Tailwind classes, etc.).
   d. For each NO: decide if it's critical (blocks functionality, user-visible regression, security) or nice-to-have (a11y polish, perf hint). Fix critical issues in this worktree.
   e. For nice-to-haves you can't fix cheaply, file them in a tracking doc at `docs/follow-ups.md`.
   f. Also spot-check: run `npm run build` — does it succeed? Run `npm run dev` briefly — does the app boot? Use Playwright to screenshot mobile (375×812) and desktop (1440×900), save to `docs/screenshots/review/phase-${N}/`. Compare to `docs/midnight/demo.html` for visual-language fidelity.

3. **Delegate heavy lifting via sub-agents.** Spawn Haiku subs for greps/scans, Sonnet subs for implementation, Opus subs for design-judgment calls. Don't burn your own context window on mechanical work.

4. **Commit incrementally.** Use conventional commits, lowercase subject, body lines ≤100 chars. Good messages so the orchestrator team knows what you changed.

5. **When Phases 1, 6, 2, 5 are reviewed + fixed:**
   - Push `review/post-merge-fixes`
   - Open PR to `main` with a structured body (table of findings, fixes applied, follow-ups deferred)
   - `gh pr merge --auto --squash --delete-branch`
   - Wait for CI + merge
   - Send iMessage via `/Users/home/src/Dispatch/scripts/notify.sh "Review pass 1 complete — PR #N"`

6. **Poll for Phase 3 + 4.** Every 5 minutes check `gh --repo 4Gaige/Dispatch pr list --state merged --head feat/auto-naming` and same for `feat/topics`. Deadline: 4 hours from start. If either never merges, note in follow-ups and proceed with whatever is merged.

7. **When Phase 3 and/or 4 merge:**
   - Create a second review branch `review/post-merge-fixes-2` from latest main
   - Repeat review + fix + PR flow
   - Send iMessage "Review pass 2 complete — PR #N"

8. **Final summary.** Send one last iMessage with a one-paragraph summary: how many issues found per phase, how many fixed vs deferred, link to the follow-ups doc.

## Hard constraints

- **Never modify `server/projects.js`, `server/index.js`, `src/components/sidebar/subcomponents/SidebarProjectItem.tsx`** beyond single require/import lines.
- **Never touch wt-3 or wt-4** or their branches.
- **Never force-push**, never delete branches you didn't create, never rewrite main's history.
- **Never enter secrets** in commits. If you find hardcoded secrets, flag them immediately via iMessage — don't commit a fix that removes them, because the history still has them.
- **Follow additive-patch rule** from CLAUDE.md.
- **Every new class must be Midnight** — grep your diffs for raw Tailwind color classes before each commit.
- **Commit messages satisfy commitlint** (lowercase subject after type, body ≤100 chars).

## Review checklist (paste into your PR body for each phase)

- [ ] Additive-patch rule respected (3 churny files untouched beyond single import lines)
- [ ] Every new class is Midnight catalog or Midnight-mapped shadcn semantic
- [ ] No raw Tailwind color classes on touched files (`grep -rE 'bg-(blue|red|green|gray|yellow|pink|purple|indigo|orange|slate|zinc|neutral|stone)-[0-9]'`)
- [ ] Mobile layout screenshot clean at 375×812
- [ ] Desktop layout screenshot clean at 1440×900
- [ ] Touch targets ≥44×44 on mobile
- [ ] `npm run build` succeeds (including on main)
- [ ] `npm test` passes if tests exist (note if none)
- [ ] No hardcoded secrets
- [ ] Keyboard navigation works for new UI
- [ ] Empty / loading / error states handled
- [ ] Phase brief acceptance criteria all met
- [ ] TypeScript compiles without new errors
- [ ] New deps in `package.json` (not just implicit via transitive)

## You are not blocked

If the orchestrator's Phase 3 or 4 fails/aborts, still do your review of what landed.
If Phase 3+4 take hours, that's fine — review pass 1 on the already-merged phases is
useful on its own.

Go.
