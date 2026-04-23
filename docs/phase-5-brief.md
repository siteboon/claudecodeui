# Phase 5 — Preview tab + live Chrome viewport + worktrees + tasks

## Goal
Four related features shipped together:
1. **Preview tab** — iframe + URL bar, reverse-proxied `/preview/*` → `localhost:{port}`
2. **Live Chrome viewport** — CDP `Page.startScreencast` → WS → `<canvas>` with take-control
3. **Worktree parallel sessions** — each `.claude/worktrees/<slug>/` as a sub-item in sidebar, spawn new via menu
4. **Tasks / kanban** — TodoWrite output → kanban cards

## Repo location
Worktree `/Users/home/src/Dispatch-wt-5` on branch `feat/preview-chrome-worktrees`.

## Files to CREATE

### Preview
- `server/routes/preview-proxy.js` — Express route `/preview/:port/*` → proxy to `localhost:{port}/*`
  - Use `http-proxy-middleware` (add to deps — justify in PR)
  - Rewrite cookies/headers to our hostname
  - Handle WebSocket upgrade for dev-server HMR
- `src/components/preview/PreviewPane.tsx` — iframe + URL bar + refresh + device-size presets (iPhone SE 375, iPhone Pro 430, iPad 820, Desktop 1280)
- `src/components/preview/PreviewModal.tsx` — mobile fullscreen wrapper

### Live Chrome viewport
- `server/routes/chrome-screencast.js` — WS route `/ws/chrome-view`
  - Connects to local Chrome via CDP (`http://localhost:9222/json/version`)
  - Attaches to the active tab
  - `Page.startScreencast({format:"jpeg", quality:80, everyNthFrame:2, maxWidth:1920, maxHeight:1080})`
  - On `Page.screencastFrame`: forwards JPEG base64 + ack back via CDP
  - On client input messages: `Input.dispatchMouseEvent` / `Input.insertText`
- `src/components/browser/BrowserPane.tsx` — canvas renderer + take-control toggle
- `src/components/browser/BrowserModal.tsx` — mobile fullscreen wrapper

### Worktrees (steal from yxwucq/CCUI)
- `server/routes/worktrees.js` — endpoints: list worktrees, create new, delete
- `src/components/sidebar/worktrees/WorktreeList.tsx` — renders worktrees under parent repo
- Activity indicators: green/grey/red/pulse dots — borrowed from Ark0N/Codeman

### Tasks (steal from guilhermexp/claudecodeui-kanban)
- `server/routes/tasks.js` — reads the active session's latest `TodoWrite` tool output, serves as JSON
- `src/components/tasks/TasksPane.tsx` — 3-column kanban
- `src/components/tasks/TaskCard.tsx` — `.ds-tile` with pastel accent matching session's topic

## Files to TOUCH
- `server/index.js` — one require per new route: `app.use(require('./routes/preview-proxy'));` etc. **No other edits.**
- Main layout: add Preview, Browser, Tasks panels + nav integration. Wire the mobile tab bar slots to open modals; wire desktop right panel to toggle between them via segmented control.

## Files NOT to touch
Same three churny files as always.

## Behavior specs

### Preview
- URL bar: port input (default 3000), path input (default `/`), device-size dropdown
- Refresh button + "Open in new tab" button
- On submit: iframe src = `/preview/{port}/{path}`
- Mobile: fullscreen modal, close button top-right
- Desktop: resizable right panel, 50% default width

### Chrome viewport
- Canvas element, 1280×720 default. Scales responsively.
- "Take control" toggle (right side)
  - Off: canvas shows frames, pointer-events disabled
  - On: click/drag/keyboard events captured and forwarded via CDP `Input.*`
- Bottom bar: active tab URL (read-only), "Open tab in browser" link
- Mobile: fullscreen modal, pinch-to-zoom (CSS transform on canvas wrapper), single-tap = click, hold = right-click

### Worktrees
- Under each project in sidebar tree, show worktrees as children
- Activity indicator dot:
  - 🟢 green: session has active messages in last 60s
  - 🟡 yellow: pulsing, waiting on model response
  - 🔴 red: blocked on permission request
  - ⚪ grey: idle >5 min
- Right-click project → "New parallel session" → calls `claude --worktree=<generated-slug>` in a new tmux pane (use `--tmux` flag) or via `server/routes/worktrees.js:create`
- Optional "Parallel Sessions" view in main area: all active worktrees side-by-side (desktop split-pane), stacked (mobile vertical scroll)

### Tasks
- Columns: **To-do · In-progress · Done**
- Pulled from Claude Code's native `TodoWrite` tool output for the currently selected session
- Cards: `.ds-tile`, pastel accent = topic's accent, with description + creation time
- Mobile: horizontal swipe between columns (`react-swipeable`)
- Desktop: classic 3-column layout

## Visual review required
**This phase has mandatory visual review.** Opus sub takes Playwright screenshots:
- Mobile 375×812: Preview modal (iPhone SE preset), Browser modal (take-control on/off), Tasks swipeable, Worktree list, activity indicators
- Desktop 1440×900: right panel with Preview/Browser/Tasks toggle, worktree split-pane, hover states
- Compares against Midnight demo for fidelity of shadows/blur/accents

## Acceptance criteria
1. Preview iframe loads http://localhost:3000 correctly from both mobile + desktop viewports
2. Chrome viewport shows live frames when local Chrome is open (requires `--remote-debugging-port=9222` flag; add to Phase 0 launch setup if missing)
3. Take-control toggle works — clicking on canvas actually clicks in Chrome
4. Worktrees render under their parent repo; activity indicators update live via WebSocket
5. Creating a new worktree spawns a tmux pane (or terminal window) with `claude` running
6. Tasks column updates live as Claude's TodoWrite fires
7. All four features work on both mobile + desktop at the specified viewports
8. `npm run build` + tests pass
9. Visual review screenshots stored in `docs/screenshots/phase-5/`

## Cost
- No extra AI cost (Chrome screencast is free, Voyage not used here, Preview is just a proxy)
- Reminder: Chrome must be launched with `--remote-debugging-port=9222` for CDP access. Orchestrator Phase 0 sets this.
