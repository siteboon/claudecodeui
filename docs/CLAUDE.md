# Dispatch — Agent Playbook

You are working on a fork of `siteboon/claudecodeui` called **Dispatch**. Dispatch adds:
a Midnight design system skin, automatic session naming (Haiku-titled), repo-based project grouping,
topic clustering, a live-preview tab, a live Chrome viewport (CDP screencast), git-worktree parallel
sessions, and selective MCP integrations.

## Golden rules — read before touching anything

### 1. Additive patches only on churny files
These three files rebase-conflict every week from upstream. **Never edit them in place.**
- `server/projects.js` (85 KB, top-2 churn)
- `server/index.js` (95 KB, god-file)
- `src/components/sidebar/subcomponents/SidebarProjectItem.tsx`

Instead: create new modules under `server/services/`, new routes under `server/routes/`, new
components under `src/components/**/topics/` (etc). Touch the shared file with ONE new
`require`/`import` line, nothing more. Wrapper composition beats in-place edits.

### 2. Mobile-first, always
Every layout decision targets **375×812 iPhone** first. Grow with `md:` `lg:` `xl:` breakpoints.
- Touch targets ≥44×44px everywhere
- Bottom tab bar on mobile (`.ds-tabbar`), persistent left rail at `lg:` (≥1024px)
- Sidebar = `.ds-sheet` bottom sheet on mobile, persistent second column on desktop
- Preview + Browser = fullscreen modals on mobile, resizable right panels on desktop
- Sticky bottom elements use `padding-bottom: env(safe-area-inset-bottom)`

### 3. Midnight design system is the law
Every new class MUST come from the Midnight catalog. See `docs/midnight/README.md` and `docs/midnight/demo.html`.
- Buttons: `.btn-primary` (white pill) or `.btn.btn-secondary|-ghost|-danger|-pill|-pill-light`
- Cards/surfaces: `.ds-tile` (frosted glass), `.ds-tile-inset`, `.ds-tile-plain`, `.ds-pastel`
- Inputs: `.ds-input`
- Badges: `.badge` with pastel variants
- Chips: `.ds-chip` with pastel variants and `-active`
- Segmented: `.ds-segment` + `.ds-segment-item` + `-item-active`
- Tab bar: `.ds-tabbar` with `.ds-tabbar-item/-pill/-label`
- Bottom sheet: `.ds-sheet` + `.ds-sheet-backdrop` + `.ds-sheet-handle`
- Top bar: `.topbar-glass`

**Never raw Tailwind color classes** like `bg-blue-500`, `text-gray-400`. The only acceptable palette
is Midnight tokens via semantic Tailwind shadcn vars (`bg-background`, `text-muted-foreground`,
`bg-primary`, etc.) that Phase 1 maps to Midnight CSS variables.

### 4. Per-section accent discipline
Top-level containers set `data-accent`:
| Section | Accent |
|---|---|
| Chat | `sky` |
| Sidebar | `lavender` |
| Preview | `mint` |
| Browser viewport | `peach` |
| Tasks / Kanban | `butter` |
| Settings / More | `blush` |

Input focus borders + selections inherit `--midnight-accent` from the nearest `data-accent` ancestor.

### 5. Reuse existing data before adding schema
The `session_names` table already has `custom_name` (see `server/database/schema.js`). Auto-titles
reuse it — do not add a parallel table. New tables only for genuinely new data shapes (e.g., Topics).

### 6. New features live in new files
| Feature | Location |
|---|---|
| Auto-titler | `server/services/session-titler.js` |
| Repo grouper | `server/services/repo-grouper.js` (new fn called from `getProjects`) |
| Topic clusterer | `server/services/topic-clusterer.js` |
| Preview proxy | `server/routes/preview-proxy.js` |
| CDP screencast | `server/routes/chrome-screencast.js` |
| Topic UI | `src/components/sidebar/topics/` |
| Preview UI | `src/components/preview/` |
| Browser viewport UI | `src/components/browser/` |
| Kanban UI | `src/components/tasks/` |

### 7. Every PR ends with review
At the end of every phase, spawn a **fresh-eyes Opus reviewer** sub — no session history, reads
only the diff + this file + the phase brief. Reviewer answers the structured checklist below with
YES/NO. Fix findings until all YES (max 3 loops).

**Phases 2 and 5 additionally require a visual-review Opus sub** that:
1. Runs `npm run dev` in the worktree
2. Uses Playwright to screenshot the changed pages at 375×812 (iPhone 14) and 1440×900 (desktop)
3. Saves to `docs/screenshots/phase-N/`
4. Compares against `docs/midnight/demo.html` (open in browser via Playwright) for visual-language fidelity
5. Reports mismatches (wrong shadows, missing blur, off-palette, touch-targets too small, etc.)

## Review checklist (reviewer must answer YES to merge)
- [ ] Follows additive-patch rule (no edits to 3 churny files)
- [ ] Every new class is Midnight catalog or Midnight-mapped shadcn semantic var
- [ ] No raw Tailwind color classes in any new code (`grep -rE 'bg-(blue|red|green|gray|yellow|pink|purple|indigo|orange|slate|zinc|neutral|stone)-[0-9]'` on the diff returns nothing)
- [ ] Mobile layout renders cleanly at 375×812 (screenshot proves it)
- [ ] Desktop layout renders cleanly at 1440×900 (screenshot proves it)
- [ ] Touch targets ≥44×44px on mobile
- [ ] `npm run build` succeeds, bundle size delta ≤5% vs main
- [ ] `npm test` passes (or: no tests exist for touched files, noted in PR)
- [ ] No hardcoded secrets, no new network calls without cause
- [ ] Keyboard navigation works (Tab, Enter, arrow keys where appropriate)
- [ ] Empty / loading / error states handled
- [ ] Phase brief acceptance criteria all met

## Model tier discipline
- **Haiku** — grep, file search, simple edits, formatting, dependency bumps, test runners
- **Sonnet** — feature implementation, refactors, test writing, TypeScript fixes, docs
- **Opus** — architecture decisions, tricky refactors, design review, visual review, fresh-eyes review

Default to Sonnet. Escalate to Opus only for architecture/review. Use Haiku for mechanical ops.

## Architecture map (30-second version)
- Frontend: React 18 + Vite + Tailwind + shadcn-style tokens + CodeMirror
- Backend: Node/Express at `server/index.js`; routes split across `server/routes/`
- State: Context API for cross-cutting (`ThemeContext`, `AuthContext`, `WebSocketContext`, `PluginsContext`, `TaskMasterContext`, `TasksSettingsContext`, `PermissionContext`); `src/stores/useSessionStore.ts` for session messages
- Data: SQLite at `~/.cloudcli/auth.db`; Claude session JSONLs read from `~/.claude/projects/<slug>/`
- Sidebar entry: `src/components/sidebar/view/Sidebar.tsx`
- Tree rendering: `SidebarProjectList` → `SidebarProjectItem` (DO NOT edit, wrap) → `SidebarProjectSessions` → `SidebarSessionItem`

## If you get stuck
1. Retry up to 3 times with different approaches
2. If still stuck, log status + error to `/tmp/dispatch-build.log`
3. Exit nonzero; the orchestrator records the failure for the morning summary
