# Sidebar redesign for worktree projects

**Status:** Design — pending implementation plan
**Date:** 2026-04-25
**Branch:** `feat/worktree-toggle`
**Scope:** Left sidebar only. Specifically `src/components/sidebar/view/subcomponents/`.

## Problem

The recent worktree-toggle feature added the ability to spawn linked git worktrees per project, but the sidebar's three-level nesting (`RepoGroup → Project → Sessions`) created two real usability problems:

1. **No clear top-level for worktree-only repos.** When the server synthesizes a "main" project for a group with no real main worktree, the repo-group header is just a collapse toggle — there's no obvious "the project" entry to click.
2. **The nesting feels heavy.** Visiting any session requires expanding the repo group, then expanding the project, then finding the session. Worktrees and sessions blur together in a deep tree.

A secondary issue: `RECENT` activity gets buried. The user's primary task is "find what I was just working on", but the current layout privileges hierarchy over recency.

## Mental model

The redesign replaces "repo group with N projects" with a single coherent model:

> **The main folder IS the repo.** It's the project's primary checkout, where most sessions live, and what `+ New` defaults to.
> **Linked worktrees are extras.** Alternate checkouts in separate folders, typically one session each.
> **Sessions are recency-sorted across both** — `RECENT` shows them all interleaved, with a branch chip telling you which folder each one belongs to.

This matches how developers actually think about worktrees: "I'm working on `claudecodeui`, currently on branch `feat/worktree-toggle` in the main folder, and I've also got a worktree for `fix/windows` and one for `feat/resize`."

## Visual structure

```
┌──────────────────────────────────────────────┐
│ ▾ 📁 claudecodeui  [feat/worktree-toggle]    │  ← Repo header
│        8 sessions · 3 worktrees              │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐     │
│ │ ⊕  New session                       │     │  ← Primary CTA
│ └──────────────────────────────────────┘     │
│                                              │
│  RECENT · 5                       Show all 12│  ← Section label
│  ● Per-session worktree control  [feat/wt-…] │
│  ○ Address PR review feedback    [feat/wt-…] │  ← Mixed sessions
│  ○ Windows path compat            [fix/win…] │     w/ branch chips
│  ○ Update sidebar branch badge   [feat/wt-…] │
│  ○ Resizable sidebar polish       [feat/res] │
│                                              │
│  WORKTREES · 3                               │  ← Linked worktrees only
│   [fix/windows]      1 session · 2d ago    + │  ← Hover "+" appears
│   [feat/resize]      1 session · 5d ago    + │
│   [prototype/auth]   empty · click to start  │  ← Dormant, dimmed
└──────────────────────────────────────────────┘
```

## Components and behavior

### Repo header

- One row per repo: chevron · folder icon · repo name · branch chip (current branch of main folder) · subtitle.
- **Subtitle:** `<N> sessions · <M> worktrees` where `N` is total sessions across main + linked worktrees, and `M` is the count of *linked* worktrees only.
- **Branch chip is omitted** if the repo isn't a git repo or the main folder has no `worktreeInfo.branchName`.
- **Click row or chevron** → expand/collapse. Expansion state persists per repo (existing `expandedProjects` set works, keyed by main-project name).
- **No "+ New session" button in the header** — the title gets full breathing room.

### "+ New session" primary row

- Full-width green dashed-bordered row, placed immediately under the repo header when expanded.
- Always represents "new session in the **main folder**".
- Click → existing new-session flow (model/CLI picker, with worktree-or-not choice). No additional UI needed since the existing flow already covers worktree choice.
- For new sessions in a *linked* worktree, users use the per-worktree hover "+" in the WORKTREES section instead.

### RECENT section

- Section label: `RECENT · <count>` with a `Show all <total>` link aligned right.
- Default shows top 5 sessions sorted by `lastActivity` (or equivalent per provider, using existing `getSessionDate`) **across the main folder AND all linked worktrees**.
- "Show all" expands to show all sessions in this repo (still recency-sorted across all worktrees).
- Each session row: live-bullet · title · sub (relative time + message count) · branch chip.
- **Branch chip** shows the worktree's branch name (or its `displayName` if branch is unavailable). Color is deterministic per branch name (hash → palette).
- **Click session** → existing select-session flow. Implicitly selects whichever worktree the session belongs to (replacing the explicit two-step "select project then select session" today).
- Active session: highlighted background, live green bullet.

### WORKTREES section

- Section label: `WORKTREES · <count>`. Only present when the repo has at least one *linked* worktree.
- Each row: branch chip · meta (`<N> session(s) · <relative time>` or `empty · click to start`).
- **No chevron, no inline expansion.** A worktree's sessions are visible in `RECENT` (recency-sorted alongside main-folder sessions). Older sessions for any worktree surface via the `Show all` link.
- **Click row** → opens that worktree's most recent session. If empty, triggers the new-session flow targeting that worktree.
- **Hover** → small `+` appears on the right; clicking it triggers the new-session flow targeting that worktree explicitly (rather than its most recent).
- Dormant (empty) worktrees are visually dimmed (`opacity ~0.65`) but still clickable.
- The session-count meta deliberately omits a chevron arrow — clicking the row opens, not expands.

### Single-worktree projects

- A project with no linked worktrees (just the main folder) renders identically to the structure above, *minus* the `WORKTREES` section.
- The repo header still shows the current-branch chip.
- Behavior matches today's standalone projects but with the new visual language.

### Stale / archived worktrees

- Same dimming pattern, kept inside the `WORKTREES` section. Today's separate "X archived" toggle inside the repo group goes away — stale worktrees just appear at the bottom of `WORKTREES`, dimmed, sorted last. (Total worktree count includes them; counted separately in subtitle if needed.)

### Branch chip styling

- Pill shape, colored by branch-name hash → small palette (green, blue, purple, amber).
- A "main-folder current branch" chip on the repo header uses a slightly heavier weight to read as more prominent.
- Chips on session rows and worktree rows use the same color/style for visual consistency: same branch = same chip everywhere.

### Worktree creation

- **Not surfaced in this redesign.** Worktree creation already happens inline in the new-session flow (model/CLI picker has a worktree toggle). No separate "+ New worktree" affordance is added.
- The previously-considered "+ New worktree" button is dropped from the design.

## Data model — what's needed

The existing `Project` shape is sufficient (`worktreeInfo`, `repoGroup`, `isMainWorktree`, `isStale`). The existing `groupProjectsByRepo` utility already produces the right grouping.

Two small derived computations are added:

1. **Per-repo session list (recency-sorted across worktrees).** Combines sessions from the main project + all linked worktree projects in a group, sorted via existing `getSessionDate`. This drives `RECENT`.
2. **Per-repo session count.** Sum of session counts across all worktrees in the group. Drives the repo-header subtitle.

Both can live in `src/components/sidebar/utils/utils.ts` as pure functions.

## Component changes

```
SidebarProjectList.tsx
├── Replaces SidebarRepoGroup with the new RepoCard
├── Renders standalone projects via the same RepoCard (no WORKTREES section)

SidebarRepoGroup.tsx → RepoCard.tsx (renamed, rewritten)
├── Repo header (with branch chip + subtitle)
├── New-session row
├── RECENT section
└── WORKTREES section

SidebarProjectItem.tsx
├── Becomes WorktreeRow.tsx (lighter — no per-worktree session expansion)

SidebarProjectSessions.tsx
├── Becomes RecentSessions.tsx (now repo-scoped, not project-scoped)

New small components:
├── BranchChip.tsx (one source of truth for chip rendering + color)
└── NewSessionRow.tsx
```

Existing integration with `useSidebarController` stays largely the same; the props shape changes only at the rendering layer.

## Search interaction

- **Project-mode search:** filter matches against repo name, main-folder branch name, and any linked-worktree branch name. Result rendering uses the same `RepoCard` shape.
- **Conversation-mode search:** unchanged.

## Mobile

The mobile sidebar uses larger card-style rows already. The redesign translates: repo header becomes a slightly larger card; sessions and worktree rows use the existing larger touch targets. No structural change in behavior.

## What's deliberately out of scope

- **Drag-and-drop reordering** of worktrees or pinning.
- **Filter chips** (e.g., "show only fix/windows sessions"). Branch chips are not clickable for filter — they're informational. May be added later if RECENT gets unwieldy.
- **Worktree creation UI.** Already covered by the existing new-session flow.
- **Backend changes.** The synthesized "main project" pattern continues to work; the redesign just stops treating that synthesized project as a separate row in the sidebar — it becomes the repo header instead.
- **Other sidebar concerns** (search bar styling, settings entry, version banner, footer). Untouched.

## Open follow-ups

- The currently-visible "X archived" submenu pattern is replaced by always-visible-but-dimmed stale worktrees inside `WORKTREES`. If users have many stale worktrees, this could be re-introduced later as a "show archived (N)" toggle.
- Branch-chip color assignment: deterministic hash → palette is fine for v1. Could grow into user-customizable colors later.

## Acceptance criteria

1. A worktree-only project (no real main checkout) still gets a repo header that's clickable and labeled with the repo name — no `.claude/worktrees/...` paths visible at the top level.
2. RECENT shows sessions from main folder + linked worktrees interleaved by recency, with branch chips identifying each.
3. Click on a session in RECENT → opens that session, regardless of which worktree it belongs to. The chat pane updates to that worktree's context.
4. Click on a worktree row in WORKTREES → opens that worktree's most recent session (or triggers new-session flow if empty).
5. Hover on a worktree row → `+` icon appears; clicking it triggers new-session flow targeting that worktree.
6. Single-worktree projects render with no WORKTREES section.
7. Repo-header branch chip reflects the main folder's current branch and updates when the branch is switched.
8. Visual hierarchy reads top-down: repo identity → primary action → recent activity → worktree directory.
