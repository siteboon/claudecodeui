# Upstream PR Contribution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `feature/personal-enhancements` (32 commits) into independent feature branches and submit focused PRs to `upstream` (`siteboon/claudecodeui`).

**Architecture:** Sync local `main` with `upstream/main`, create per-feature branches, cherry-pick/port relevant commits, resolve conflicts, verify builds, push and open PRs.

**Tech Stack:** Git (cherry-pick, rebase), GitHub CLI (`gh`), npm (build verification)

---

## Execution Progress

| Task | PR | Status | Notes |
|------|----|--------|-------|
| Task 0: Stash & Sync | — | DONE | main synced to `9e22f42`, pushed to origin |
| Task 1: React 18 Message Sync | [#461](https://github.com/siteboon/claudecodeui/pull/461) | DONE | Skipped commit `9a84153` (core fix already in upstream's subscribe pattern). Cherry-picked f71a2f8, ceaa704, c9fa0fc, 2ff419e cleanly. Squashed to 1 commit. |
| Task 2: WebSocket Permission | [#462](https://github.com/siteboon/claudecodeui/pull/462) | DONE | Cherry-pick failed (architecture diverged). Manually ported to upstream code: added writer storage, reconnectSessionWriter, getPendingApprovalsForSession, frontend recovery effect. |
| Task 3: Tool Display Refactor | — | SKIPPED | Commit `631f3f7` only touches `BackgroundTasksPopover.tsx` which doesn't exist on main. Merged into Task 5. |
| Task 4: Slash Commands | — | DESIGNED | Full design doc at `docs/plans/2026-03-01-task4-slash-commands-design.md`. Single PR approach. |
| Task 5: Background Tasks | — | TODO | Very high difficulty — see revised plan below |
| Task 6: System Messages | [#463](https://github.com/siteboon/claudecodeui/pull/463) | DONE | Manual porting of classifyUserMessage() + collapsible card rendering. No cherry-pick. |
| Task 7: Cleanup | — | TODO | — |

---

## Current Git State (2026-03-01 17:04 UTC+8)

- **Current branch:** `main` (at commit `a1fe7e5` - design docs committed)
- **Stash:** `WIP: unstaged changes during PR split` (from `feature/personal-enhancements`)
- **feature/personal-enhancements:** Untouched, safe
- **Branches created & pushed:** `fix/react18-message-sync`, `fix/websocket-permission-persistence`, `feat/system-injected-messages`
- **PRs open:** [#461](https://github.com/siteboon/claudecodeui/pull/461), [#462](https://github.com/siteboon/claudecodeui/pull/462), [#463](https://github.com/siteboon/claudecodeui/pull/463)

**To resume Task 4 implementation:**
```bash
cd /e/Heyang5/claudecodeui
git checkout main  # Already on main
# Run: /superpowers:executing-plans @docs/plans/2026-03-01-task4-slash-commands-design.md
```

---

## Lessons Learned

1. **Cherry-pick rarely works cleanly.** Upstream has done major refactors (component splits, Gemini integration, SDK upgrade). Most commits from `feature/personal-enhancements` conflict. **Default approach should be manual porting**, not cherry-pick.

2. **Check commit scope before planning.** Commit `631f3f7` (Tool Display) and `eaaf3ac` (System Messages) both bundle unrelated changes. Always verify `git diff-tree --name-only` matches the plan's assumptions.

3. **Check if upstream already solved the problem.** Commit `9a84153`'s core fix (subscribe pattern bypassing React 18 batching) was already in upstream. Skipping it avoided a meaningless conflict.

4. **`git rebase -i` doesn't work in non-interactive CLI.** Use `git reset --soft main && git commit` for squashing.

5. **`npm install` needed after syncing main.** Upstream added new dependencies. Run `npm install` on each new branch before `npm run build`.

---

## Remaining Tasks (Revised)

### Task 6: PR 5 — System-Injected Message Display

**Difficulty: Medium.** Cannot cherry-pick — commit `eaaf3ac` is a 14-file bundle including unrelated files (docs, BackgroundTasksPage, ecosystem.config, vite.config).

**Approach: Manual porting.** Only port these changes:

1. **`messageTransforms.ts`** — Add `classifyUserMessage()` function that detects system-injected messages by content patterns (system-reminder tags, task notifications, command hooks, continuations). No upstream changes to this file since fork → should be straightforward.

2. **`MessageComponent.tsx`** — Add rendering logic: if message is classified as system-injected, render as collapsible card instead of user bubble. **Upstream has 3 commits since fork** (component refactor, copy icon, Gemini). Must read upstream version and adapt.

3. **`ChatMessagesPane.tsx`** — Minor changes to support system message styling. Upstream has 1 commit (Gemini). Check for conflicts.

4. **i18n files** — Add translation keys for collapsible UI labels. Upstream has added new keys since fork → merge carefully, don't overwrite.

**Steps:**
```bash
git checkout -b feat/system-injected-messages main
# Read feature branch versions of each file, identify the diff, apply to upstream version
# Commit, build, push, PR
```

---

### Task 4: PR 2 — Slash Commands & Skills Support

**Difficulty: High.** 7 commits touching 4 files, 3 of which have upstream changes.

**Key conflicts:**
- `ChatInterface.tsx` — upstream refactored into smaller components (#402), added Gemini (#422)
- `useChatComposerState.ts` — upstream has minor changes
- `server/claude-sdk.js` — upstream upgraded SDK (#446); need to add `appendSystemPrompt` support without touching other areas

**Approach: Manual porting.** Read the feature branch's final versions of the 4 files. Identify the slash-command-specific changes. Apply them to the upstream versions.

**Key changes to port:**
1. `useSlashCommands.ts` — New file, copy from feature branch
2. `useChatComposerState.ts` — Add skill detection, slash command trigger logic
3. `ChatInterface.tsx` — Wire up slash command/skill handlers into the refactored component structure
4. `server/claude-sdk.js` — Add `appendSystemPrompt()` call in the SDK session flow

**Steps:**
```bash
git checkout -b feat/slash-commands-skills main
# Copy useSlashCommands.ts from feature branch
# Manually port changes to the other 3 files
# Commit, build, push, PR
```

---

### Task 5: PR 1 — Background Tasks Management

**Difficulty: Very high.** Largest PR, ~400 lines of new server code, 11+ commits, manual porting required for all server files.

**Approach unchanged from original plan** — manual porting is the only option. Key steps:
1. Copy new files from feature branch (ws-clients.js, UI components, i18n)
2. Manually port server-side logic to upstream's `claude-sdk.js`
3. Manually port API routes to upstream's `index.js` and `commands.js`
4. Manually port frontend integration (AppContent, Sidebar, useChatRealtimeHandlers, WebSocketContext, i18n config)

**Additional note:** Include `631f3f7` (getToolInputSummary helper) as part of this PR since it only touches `BackgroundTasksPopover.tsx`.

---

### Task 7: Cleanup

**Steps:**
```bash
git checkout feature/personal-enhancements
git stash pop  # Restore working changes
# Update CLAUDE.md with PR URLs and status
```

---

## Checklist per PR

Before pushing each PR, verify:

- [ ] Branch is based on latest `main` (which tracks `upstream/main`)
- [ ] No `debug:` commits included
- [ ] No cross-feature changes leaked in
- [ ] `npm run build` passes (run `npm install` first if dependencies changed)
- [ ] Commit messages follow Conventional Commits
- [ ] UI changes include screenshots in PR body
- [ ] No `Co-Authored-By` or emoji generated lines in commits
