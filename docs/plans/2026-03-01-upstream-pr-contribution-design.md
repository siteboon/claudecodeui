# Upstream PR Contribution Design

Date: 2026-03-01

## Goal

Split the `feature/personal-enhancements` branch (32 commits ahead of `main`) into independent, focused PRs for the upstream repository `siteboon/claudecodeui`.

## Context

### Repository Structure

| Remote | URL | Purpose |
|--------|-----|---------|
| `origin` | `github.com/shikihane/claudecodeui` | Personal fork |
| `upstream` | `github.com/siteboon/claudecodeui` | Main repository |

### Current State (2026-03-01)

- Local `main` at `597e9c5`, behind upstream/main by 19 commits (upstream at v1.21.0)
- `feature/personal-enhancements` has 32 commits on top of local main
- 4 unstaged working tree changes
- Upstream merged a major refactor (#402: Settings, FileTree, GitPanel, Shell, CodeEditor) plus Gemini integration

### Conflict Analysis

- **18 files** modified by both feature branch and upstream
- **27 files** modified only by feature branch (no upstream conflict)
- High-conflict files: `server/claude-sdk.js`, `server/index.js`, `ChatInterface.tsx`, `useChatRealtimeHandlers.ts`

## Design: Per-Feature Branch Strategy

### Step 1: Sync local main

Merge `upstream/main` into local `main` and push to `origin/main`. This gives all feature branches a clean, up-to-date base.

### Step 2: Feature Modules to Extract

Each module becomes an independent branch off `main` and a separate PR.

#### PR 1: Background Tasks Management (largest, highest value)

**Scope**: Full background task lifecycle — spawn, monitor, display, complete.

New files (no conflict):
- `server/ws-clients.js` — WebSocket broadcast helpers
- `src/components/app/BackgroundTasksPage.tsx` — full-page task view
- `src/components/app/BackgroundTasksPopover.tsx` — popover task list
- `src/i18n/locales/*/backgroundTasks.json` — i18n (4 languages)

Files requiring upstream adaptation:
- `server/claude-sdk.js` — background task spawning, subagent monitoring, fd-based polling
- `server/index.js` — route registration for background task endpoints
- `server/routes/commands.js` — task status/output API endpoints
- `src/components/chat/hooks/useChatRealtimeHandlers.ts` — WS event handling for task updates
- `src/components/app/AppContent.tsx` — routing for background tasks page
- `src/components/sidebar/view/subcomponents/SidebarContent.tsx` — sidebar nav entry

Commits to include (squashed, excluding debug): `c73489f`, `c762977`, `4ff0d53`, `48787e3`, `f5b3aab`, `be64cfc`, `52b74d0`, `532a285`, `5f1d3b9`, `4d7fe5d`

#### PR 2: Slash Commands & Skills Support

**Scope**: Enable slash command/skill detection, loading, and execution in chat input.

Files:
- `src/components/chat/hooks/useSlashCommands.ts`
- `src/components/chat/hooks/useChatComposerState.ts`
- `src/components/chat/view/ChatInterface.tsx`
- `server/claude-sdk.js` (appendSystemPrompt integration)

Commits: `547ee5e`, `3966f81`, `9479876`, `6466464`, `c64617d`, `1e685ec`, `abee2a0`

#### PR 3: WebSocket Permission Request Fixes

**Scope**: Fix permission requests lost on WebSocket reconnection.

Files:
- `src/contexts/WebSocketContext.tsx`
- `server/claude-sdk.js` (server-side permission state)
- `src/components/chat/hooks/useChatRealtimeHandlers.ts`

Commits: `42c8437`, `589af13`, `4a6b04e`

#### PR 4: React 18 Message Sync Fixes

**Scope**: Fix message disappearing and Thinking indicator stuck due to React 18 batching.

Files:
- `src/components/chat/hooks/useChatSessionState.ts`
- `src/components/chat/view/subcomponents/MessageComponent.tsx`
- `src/components/chat/utils/messageTransforms.ts`

Commits: `9a84153`, `f71a2f8`, `ceaa704`, `c9fa0fc`, `2ff419e`

#### PR 5: System-Injected Message Display (optional, low priority)

**Scope**: Collapsible UI for system-injected messages.

Commits: `eaaf3ac`

#### PR 6: Tool Display Refactor (optional, low priority)

**Scope**: Extract `getToolInputSummary` helper.

Commits: `631f3f7`

### Step 3: Per-Branch Workflow

For each feature branch:

1. `git checkout -b feat/<name> main`
2. Cherry-pick or manually port relevant commits
3. Remove all `debug:` commits
4. Squash related fix commits into clean logical commits
5. Resolve conflicts against upstream's latest code
6. Verify `npm run build` passes
7. Push to `origin` and open PR against `upstream/main`
8. Add screenshots for UI changes per CONTRIBUTING.md

### Commit Exclusions

The following commits are debug-only and should NOT appear in any PR:
- `85c9577` debug: add logging to trace background bash monitoring
- `087e465` debug: add logging to trace subagent progress input data
- `b375752` debug: add console logs for permission request handling
- `b64dec5` debug: add logs to PermissionRequestsBanner component
- `e019dc2` fix: add detailed logging for permission request flow

### Priority Order

1. **PR 4** (React 18 Message Sync) — smallest scope, highest chance of clean merge
2. **PR 3** (Permission Requests) — focused fix, moderate conflict
3. **PR 6** (Tool Display Refactor) — single commit, trivial
4. **PR 2** (Slash Commands) — medium scope
5. **PR 1** (Background Tasks) — largest scope, most conflict, most value
6. **PR 5** (System Messages) — optional

## Success Criteria

- Each PR passes `npm run build` independently
- Each PR contains only related changes (no cross-feature leakage)
- No debug logging commits in any PR
- All commits follow Conventional Commits format
- UI change PRs include screenshots
