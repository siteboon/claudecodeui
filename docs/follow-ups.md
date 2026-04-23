# Post-merge follow-ups

Tracking nice-to-have items surfaced by the post-merge review pass on
`review/post-merge-fixes`. None block production; each can be picked up by
the next phase or a polish PR. Citations point at file:line in the merged
commit; line numbers may drift after the review PR lands.

## Phase 1 — Midnight skin + mobile-first

- **Tasks slot missing from primary nav** — `useAppNavItems.ts:18-24` defines
  five slots (Chat / Sessions / Preview / Browser / More). `AppContent.tsx:202`
  honors `activeTab === 'tasks'` for accent, but no rail/tab-bar entry surfaces
  the kanban view. The floating "Tasks" button in `MainContent.tsx` is the
  only entry point. Decide: surface as a sixth slot or accept floating-only.
- **Sheet initial focus** — `MobileSidebarSheet.tsx:65` opens with no initial
  focus target, so screen readers land on the trigger. Move focus to the sheet
  container or first interactive child on open.
- **Drag-handle hit area** — `MobileSidebarSheet.tsx:84-92` is `pt-3 pb-2`
  (~28px). Below the 44×44 minimum the rest of the app respects.
- **`visualViewport` listener cleanup** — `AppContent.tsx:128-137` registers
  once; consider also listening to `scroll` (iOS sometimes only fires that on
  keyboard show) and clearing `--keyboard-height` if `vv` becomes undefined.

## Phase 2 — Sidebar tree + repo grouping

- **Native `prompt`/`confirm` for topic rename/delete** —
  `SidebarTopicGroup.tsx:138`. Works but jarring vs. Midnight; replace with
  inline editable chip + custom modal.
- **Mobile search-scope segment uses ad-hoc styles** — `SidebarHeader.tsx`
  mobile branch (~line 240). Desktop got the `.ds-segment` polish; apply the
  same to mobile.
- **Aria mismatch for single-project repos** — `SidebarProjectTree.tsx:189`:
  when no group header renders, `aria-labelledby={groupId}` points at a
  nonexistent button. Drop the attr in that branch.
- **`crypto.randomUUID()` fallback** — `useTopicStorage.ts:106`. Add a
  `Math.random()`-based fallback for insecure-context resilience.
- **Repo-grouper cache invalidation** — `repo-grouper.js:333` keys by
  `fullPath` only. Add a TTL or git-mtime check so origin URL changes are
  picked up without manual cache deletion.

## Phase 5 — Preview + Chrome + Worktrees + Tasks

- **Worktree → session map is partial** — only the *currently selected*
  worktree's dot can light up. Cross-worktree resolution requires the
  server-side activity stream to know which sessionId is running in each
  `<repo>/.claude/worktrees/<slug>` cwd. Add `/api/worktrees/active-sessions`
  (or include `__cwd` on every session payload) and feed it into
  `SessionActivityProvider` in `AppContent.tsx`.
- **Tasks aside is fixed-width on desktop** — `MainContent.tsx:194-208` uses
  `w-[380px]`. The phase-5 brief asks for a resizable right panel.
- **Preview proxy CSP/X-Frame strip is unconditional** —
  `preview-proxy.js:79-81` strips CSP and X-Frame-Options on every response.
  In production deployments that's broader than needed — consider gating to
  `process.env.NODE_ENV !== 'production'` or to the configured port allowlist.
- **`SpawnSubAgentButton` SSE event narrowing** — `SpawnSubAgentButton.tsx:127`
  casts `evt.event` straight to `StreamEvent['type']`, so a malformed server
  event would silently produce a garbage payload. Narrow with a `switch`.
- **`SessionFilesTouchedChips` layout shift** — `SessionFilesTouchedChips.tsx:88`
  reserves no height before chips arrive; once the IntersectionObserver
  resolves, the row jumps. Reserve a min-height.
- **`spawn-sub-agent` has no time/output cap** — `mcp-bootstrap.js:259`. A
  runaway sub-agent could stream forever. Add a hard timeout + byte cap.

## Cross-cutting

- **Bundle size warning** — main client chunk is 2.5 MB minified (~760 KB
  gzipped). Vite warns above 1 MB. Worth a code-split pass: lazy-load
  Preview/Browser/Tasks panes, split CodeMirror/xterm vendor chunks further.
- **No `npm test` script** — Phase briefs reference test runs but
  `package.json` has none. Add at minimum a Vitest harness with smoke tests
  for the new server routes (preview-proxy port allowlist, mcp-bootstrap
  workingDir validation, tasks path-traversal guard).
