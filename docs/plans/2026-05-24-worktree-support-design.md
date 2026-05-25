# Git worktree support — design

**Date:** 2026-05-24
**Branch:** simplify
**Status:** approved, ready for implementation

## Goal

Let a user work on the same git repo across multiple worktrees from a single project entry in the sidebar. Today each worktree shows up as an unrelated project; after this change, the sidebar groups worktrees of the same repo under one project and lets the user open any worktree's sessions.

Read-only feature: the UI **discovers** worktrees via `git worktree list`. Creating, removing, or switching worktrees is done externally with the `git` CLI — the UI just observes.

## Data model

A project is now a git repo with one or more worktrees. Each worktree has its own Claude session history because Claude keys sessions by absolute directory path (`~/.claude/projects/<encoded-path>/`).

```ts
type Project = {
  projectId: string;
  path: string;              // absolute path of the "main" worktree
  displayName: string;
  isStarred: boolean;
  sessions: Session[];       // sessions of the main worktree (kept for BC)
  worktrees: Worktree[];     // NEW. Empty for non-git projects.
};

type Worktree = {
  path: string;              // absolute path of the worktree
  branch: string | null;     // null if detached HEAD
  isMain: boolean;           // true for the primary worktree
  isLocked: boolean;
  sessions: Session[];
};
```

Backward compat: `project.sessions` continues to mean "main worktree sessions". New code reads `project.worktrees`. When `worktrees.length === 1`, the UI collapses to today's appearance.

## Detection (backend)

For each project that's a git repo, on every `GET /api/projects` fetch:

1. `git -C <path> rev-parse --git-common-dir` — if it fails, this isn't a git repo → `worktrees: []`.
2. `git -C <path> worktree list --porcelain` — parse output into `Worktree[]`.
3. For each worktree, load its Claude sessions using the existing session loader, passing the worktree's path.

All projects are processed in parallel (`Promise.allSettled`). Failures fall back to `worktrees: []` silently.

### Porcelain parsing rules

`git worktree list --porcelain` emits blocks separated by blank lines:

```
worktree /Users/me/repo
HEAD abc123...
branch refs/heads/main

worktree /Users/me/wt/feat-x
HEAD def456...
branch refs/heads/feat-x

worktree /Users/me/wt/detached
HEAD 789ghi...
detached

worktree /Users/me/wt/locked
HEAD jkl012...
branch refs/heads/wip
locked some reason
```

For each block:
- `path`: from `worktree <path>`
- `branch`: strip `refs/heads/` prefix from the `branch` line; absent if `detached` present → `null`.
- `isMain`: first non-bare block wins.
- `isLocked`: presence of `locked` line.
- Skip blocks flagged `bare`.
- Skip blocks whose `worktree` path no longer exists on disk (stale; user didn't `git worktree prune`).

## Sidebar UI

**Single-worktree repos:** unchanged. Project row → sessions.

**Multi-worktree repos:** three-level tree.

```
▾ my-app                    (3)  ← project, badge shows count
  ▾ main          [main]         ← worktree row, branch chip
    • Session 1
    • Session 2
  ▸ feat-x        [feat-x]
  ▸ detached      [detached]
```

- Project row: clicking expands/collapses. No sessions at this level.
- Worktree row: clicking expands sessions. Branch chip shows the branch name (or "detached" for null). A small lock icon if `isLocked`. Right-click → "Reveal in Finder" (existing functionality, scoped to this worktree's path).
- Sessions: rendered the same way they are today; the parent context is the worktree path.

### State

`useSidebarController` gains:

- `expandedWorktreePaths: Set<string>` — independent of `expandedProjectIds`.
- The selection model becomes `{ projectId, worktreePath, sessionId }` instead of `{ projectId, sessionId }`. For single-worktree projects, `worktreePath === project.path`.

### Active working directory

The chat panel (and any "new session" / "open in shell" action) reads the **selected worktree path**, not `project.path`. Existing call sites that pass `project.path` get switched to `selectedWorktreePath ?? project.path`.

## Edge cases

- **Detached HEAD** — `branch: null`, chip shows "detached".
- **Locked worktree** — lock icon; otherwise functional.
- **Stale worktree on disk** — skipped silently.
- **Bare repo** — skipped.
- **Submodule** — treated as regular dir, no special handling.
- **Non-git project** — `worktrees: []`, behavior identical to today.
- **`git` binary missing** — first `rev-parse` throws → fall back to `worktrees: []`.

## Performance

`git worktree list --porcelain` runs ~5ms locally. With ~50 projects that's 250ms serially → we run them in parallel with `Promise.allSettled`. No file-watching; refresh on the next projects-list fetch (already periodic).

## Files touched

**New:**
- `server/modules/projects/services/git-worktrees.service.ts` — runs the two git commands, parses porcelain, returns `Worktree[]` (without sessions).
- `server/modules/projects/services/git-worktrees.service.test.ts` — unit tests for the parser.

**Modified — backend:**
- `server/modules/projects/services/projects-with-sessions-fetch.service.ts` — calls `git-worktrees.service`, attaches sessions per worktree.
- `server/modules/providers/services/sessions.service.ts` (or equivalent) — expose a helper to load sessions for an arbitrary path, not just a registered project.

**Modified — shared types:**
- `src/types/sharedTypes.ts` (or wherever `Project` lives) — add `worktrees: Worktree[]` and the `Worktree` type.

**Modified — frontend:**
- `src/components/sidebar/view/subcomponents/SidebarProjectItem.tsx` — render worktree-count badge.
- `src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx` — when `worktrees.length > 1`, render the worktree layer; otherwise inline-render sessions.
- New: `src/components/sidebar/view/subcomponents/SidebarWorktreeItem.tsx` — the worktree row + branch chip + sessions list.
- `src/components/sidebar/hooks/useSidebarController.ts` — `expandedWorktreePaths` state + worktreePath-aware selection.
- `src/components/sidebar/types/types.ts` — selection shape.
- Wherever the chat/new-session reads "project path" — read selected worktree path instead.

## Out of scope

- Adding, removing, locking, or switching worktrees from the UI.
- Conflict / branch-sync warnings.
- Worktree creation wizard.
- File-watching `.git/worktrees/`.

## Rollout

Single PR. No flag — if `worktrees.length <= 1` the UI looks identical to today, so risk is contained to multi-worktree users (who already opted in by running `git worktree add`).
