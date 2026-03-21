# Session Context Tracking

## Problem

When working with Claude Code on multi-step features (brainstorm → plan → implement → validate), work spans 2-4 separate sessions. With multiple features in flight, navigating between sessions becomes difficult — which session is the executor? Which one has the spec context? Which is stale waiting for implementation to finish? The current flat session list per project provides no grouping or lifecycle tracking.

## Solution

Add a **Contexts tab** in the sidebar that groups sessions by superpowers plan, with plan lifecycle state tracking and a context header bar in the main content area for navigating between sessions within a context.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data store | `docs/superpowers/session-tracking.json` per project | Single source of truth, git-trackable, no DB needed |
| Plan state tracking | State field in tracking file (not directory-based) | Cleaner git history, single source of truth |
| Agent involvement | None — UI-only | Avoids context bloat on agents, unnecessary complexity |
| Sidebar organization | Separate "Contexts" tab | Existing Sessions tab untouched, clean separation |
| Context detail view | Header bar with session tabs in main content | Quick session switching within a context |
| Unassigned sessions | Stay in Sessions tab with "Link to plan" action | Contexts tab stays focused on plan-linked work |

## Data Model

### `docs/superpowers/session-tracking.json`

```json
{
  "version": 1,
  "plans": {
    "docs/superpowers/plans/2026-03-19-clean-conversation-view.md": {
      "name": "Clean conversation view",
      "state": "progress",
      "sessions": [
        {
          "sessionId": "3cc9ab2a-4437-4685-aee9-3249e6908e18",
          "name": "Spec & planning",
          "role": "planner",
          "addedAt": "2026-03-19T10:00:00Z"
        },
        {
          "sessionId": "f1a2b3c4-d5e6-7890-abcd-ef1234567890",
          "name": "Implementing (3/9)",
          "role": "executor",
          "addedAt": "2026-03-19T12:30:00Z"
        }
      ]
    }
  }
}
```

### Plan States

| State | Meaning | Badge Color |
|-------|---------|-------------|
| `todo` | Plan written, not started | Gray |
| `progress` | Active implementation | Blue |
| `validate` | Implementation done, testing/reviewing | Amber |
| `closed` | Complete, archived | Gray (dimmed) |

Transitions: any state → any state (no enforced order). Forward and reverse movement supported.

### Session Roles

| Role | Meaning | Typical Use |
|------|---------|-------------|
| `planner` | Brainstorm/spec/plan session | Has full context of requirements |
| `executor` | Implementing the plan | Fresh session, less context bloat |
| `reviewer` | Testing/validation session | Validates after implementation |
| `origin` | Where the issue was discovered | Original debugging session |

Roles are informational labels. The UI displays them but doesn't enforce behavior.

### File Ownership

- **Written by:** claudecodeui server only (via API endpoints)
- **Read by:** claudecodeui frontend
- **Agents:** Do not read or write this file

## UI Architecture

### Sidebar: Contexts Tab

A new tab alongside the existing Sessions tab in the sidebar.

**Tab bar:** Two tabs — "Sessions" (existing, default) and "Contexts" (new).

**Contexts tab content per project:**

1. **Active contexts** (state: `todo`, `progress`, `validate`) — shown as cards:
   - Plan name (editable inline)
   - State badge with color
   - Stacked session list showing: name, role, active/stale status
   - Session status: "active" (activity < 10 min), "stale Xh/Xd" (relative time)

2. **Closed contexts** — shown dimmed at bottom, collapsed by default, expandable

3. **Untracked plans** — Plan files in `docs/superpowers/plans/` not yet in `session-tracking.json` appear with an "Add to tracking" action, prompting the user to start tracking and link sessions.

**Search on Contexts tab:** The existing search bar filters context cards by plan name (simple text match). No conversation-level search on this tab — use the Sessions tab for that.

### Main Content: Context Header Bar

When a context is selected (by clicking a context card in sidebar), a header bar appears above the chat view:

**Header bar contains:**
- Plan name (editable)
- State badge with dropdown to transition (forward and reverse)
- Horizontal session tabs within the context
- Each tab shows: session name, role badge, active/stale indicator
- "+ Add session" button to link an existing session
- Clicking a session tab loads its chat below

**When no context is selected** (user clicks a session directly from Sessions tab), header bar is hidden — current behavior unchanged.

**Initial session on context click:** Load the most recently active session. If no sessions have activity metadata, load the first session in the list.

**ContextHeader placement:** Renders as a child of `MainContent`, inserted between `MainContentHeader` and the chat tab content area. It does NOT replace `MainContentHeader`.

### Sessions Tab: Link to Plan Action

Each session in the existing Sessions tab gets a new action in its kebab/context menu:

- **"Link to plan..."** — Opens a dropdown/modal listing available plans. Selecting one adds the session to that plan's `sessions` array in the tracking file. User provides a name and role.

## API Endpoints

### `GET /api/projects/:name/contexts`

Returns all tracked plans with merged session metadata.

**Response:**
```json
{
  "contexts": [
    {
      "planPath": "docs/superpowers/plans/2026-03-19-clean-conversation-view.md",
      "name": "Clean conversation view",
      "state": "progress",
      "sessions": [
        {
          "sessionId": "3cc9ab2a-...",
          "name": "Spec & planning",
          "role": "planner",
          "addedAt": "2026-03-19T10:00:00Z",
          "lastActivity": "2026-03-19T14:30:00Z",
          "messageCount": 42,
          "isActive": false
        }
      ]
    }
  ],
  "untracked": [
    {
      "planPath": "docs/superpowers/plans/2026-03-20-batch-result-polling.md",
      "name": "Batch result polling"
    }
  ]
}
```

**Server logic:**
1. Resolve project working directory using `extractProjectDirectory(projectName)` from `projects.js`
2. Read `<projectDir>/docs/superpowers/session-tracking.json` (return empty if not exists)
3. Scan `<projectDir>/docs/superpowers/plans/` for `.md` files not yet tracked → return as `untracked`
4. For untracked plans, derive name by stripping date prefix (`YYYY-MM-DD-`) and extension, replacing hyphens with spaces, title-casing
5. For each tracked session, merge with actual session metadata (lastActivity, messageCount) from the already-parsed project session cache (reuse `getProjects()`/`getSessions()` data, do NOT re-parse JSONLs)
6. Compute `isActive` based on lastActivity < 10 minutes

**Session ordering:** Sessions within a plan are sorted by `addedAt` ascending in both the API response and the UI.

### `PUT /api/projects/:name/contexts`

Updates `session-tracking.json`. Supports these operations via request body:

```json
{
  "action": "setState",
  "planPath": "docs/superpowers/plans/...",
  "state": "validate"
}
```

```json
{
  "action": "renamePlan",
  "planPath": "docs/superpowers/plans/...",
  "name": "New name"
}
```

```json
{
  "action": "linkSession",
  "planPath": "docs/superpowers/plans/...",
  "session": {
    "sessionId": "abc-123",
    "name": "Implementation",
    "role": "executor"
  }
}
```

```json
{
  "action": "unlinkSession",
  "planPath": "docs/superpowers/plans/...",
  "sessionId": "abc-123"
}
```

```json
{
  "action": "renameSession",
  "planPath": "docs/superpowers/plans/...",
  "sessionId": "abc-123",
  "name": "New session name"
}
```

```json
{
  "action": "updateSessionRole",
  "planPath": "docs/superpowers/plans/...",
  "sessionId": "abc-123",
  "role": "reviewer"
}
```

```json
{
  "action": "trackPlan",
  "planPath": "docs/superpowers/plans/...",
  "name": "Plan display name"
}
```

```json
{
  "action": "untrackPlan",
  "planPath": "docs/superpowers/plans/..."
}
```

**Server logic:**
1. Read current `session-tracking.json` (create with `{"version": 1, "plans": {}}` if not exists)
2. Apply the mutation
3. Write atomically: write to `docs/superpowers/.session-tracking.json.tmp` (same directory), then `fs.rename()` to `session-tracking.json`
4. Return updated context

## Components

### New Components

| Component | Location | Responsibility |
|-----------|----------|---------------|
| `SidebarTabBar` | `src/components/sidebar/view/subcomponents/` | Sessions/Contexts tab switcher |
| `SidebarContextsTab` | `src/components/sidebar/view/subcomponents/` | Contexts tab content — lists context cards grouped by project |
| `ContextCard` | `src/components/sidebar/view/subcomponents/` | Individual plan card: name, state badge, session list |
| `ContextHeader` | `src/components/context-header/view/` | Main content header bar with plan info and session tabs |
| `ContextSessionTab` | `src/components/context-header/view/` | Individual session tab within context header |
| `LinkToPlanModal` | `src/components/sidebar/view/subcomponents/` | Modal/dropdown for linking a session to a plan |
| `useContextState` | `src/hooks/` | All context state: data fetching, mutations, active context/tab selection, sidebar tab (Sessions vs Contexts). Keeps `useSidebarController` unchanged. |
| `contexts.js` | `server/routes/` | API endpoints for context CRUD |

### Modified Components

| Component | Change |
|-----------|--------|
| `Sidebar.tsx` | Accept `useContextState` output, pass to SidebarContent |
| `SidebarContent.tsx` | Render SidebarTabBar above scroll area; conditionally show Contexts or Sessions based on active tab |
| `SidebarSessionItem.tsx` | Add "Link to plan" action in kebab menu |
| `MainContent.tsx` | Render ContextHeader between MainContentHeader and chat area when a context is active |
| `AppContent.tsx` | Call `useContextState`, pass output to Sidebar and MainContent |

## User Workflows

### Starting a new feature

1. Write spec/plan via superpowers brainstorming + writing-plans skills
2. Open claudecodeui, go to Contexts tab
3. Auto-discovered plan appears as `todo` — click to start tracking
4. Current brainstorming session automatically offered for linking (by matching session ID from Claude Code)
5. Give it a name ("Spec & planning") and role ("planner")
6. Change state to `progress` when starting implementation

### Switching between sessions

1. Click context card in sidebar
2. Context header appears with session tabs
3. Click between "Spec & planning" and "Implementing (3/9)" tabs
4. Chat view updates instantly

### Linking an ad-hoc session

1. In Sessions tab, find a session that discovered a bug
2. Click kebab menu → "Link to plan..."
3. Select the relevant plan
4. Name it "Origin: auth debugging", role: "origin"
5. Session now appears in the context's session list

### Completing a feature

1. All sessions done → switch context state to `validate`
2. After testing → switch to `closed`
3. Context card dims and moves to bottom of list
4. Still viewable and navigable, just visually de-emphasized

## Edge Cases

- **Plan file deleted from disk** — Show as "orphaned" with warning icon, allow cleanup (remove from tracking)
- **Session JSONL deleted** — Show as "missing" in session list, allow unlinking
- **No `session-tracking.json` yet** — Untracked plans shown from filesystem scan, tracking file created on first mutation
- **Multiple projects** — Each project has its own tracking file in its own working directory
- **Concurrent UI writes** — Last-write-wins via atomic file replacement (single user, acceptable)
- **Plan path changes** — Not handled automatically; user can untrack old path and track new one
- **Session linked to multiple plans** — Allowed (a debugging session could be relevant to multiple contexts)

## Files NOT Modified

- `server/projects.js` — Existing session/project parsing unchanged
- `session-tracking.json` is never read or written by Claude Code agents
- Existing session selection flow in Sessions tab unchanged
- No changes to the chat interface or message rendering
