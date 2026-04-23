# Phase 1 — Midnight skin + mobile-first layout

## Goal
Apply Midnight design system globally. Implement mobile-first layout: bottom tab bar on mobile,
persistent left rail on desktop. All new/touched components use Midnight tokens & classes.

## Repo location
`/Users/home/src/Dispatch` (worktree for this phase: created by orchestrator at
`/Users/home/src/Dispatch-wt-1` on branch `feat/midnight-skin`).

## Files to TOUCH
| File | What to do |
|---|---|
| `tailwind.config.js` | Merge `docs/midnight/tailwind.midnight.config.ts` theme.extend. Keep existing shadcn vars. |
| `src/index.css` | Append `@import url("/docs/midnight/midnight.css");` OR copy midnight.css into `src/styles/midnight.css` and import. Also override shadcn CSS vars (`--background`, `--foreground`, `--primary`, `--muted`, `--card`, `--popover`, `--border`, `--input`, `--ring`, etc.) to map to Midnight tokens. Dark mode only. |
| `src/App.tsx` | Add mobile tab bar component at bottom, persistent left rail at `lg:`. Adapt main grid layout. |
| All hardcoded color sites | Replace `bg-blue-500` etc. with Midnight semantic classes. Non-exhaustive list: `src/components/mcp/constants.ts`, `src/components/task-master/view/TaskCard.tsx`, `src/components/task-master/utils/taskKanban.ts`, `src/components/file-tree/view/ImageViewer.tsx`, `src/components/auth/view/LoginForm.tsx`, `src/shared/view/ui/Queue.tsx`. Grep for offenders. |

## Files NOT to touch
- `server/projects.js`
- `server/index.js`
- `src/components/sidebar/subcomponents/SidebarProjectItem.tsx`

## Mobile-first layout spec

Below 1024px (`< lg:`):
- `.ds-tabbar` at bottom, 5 slots: **Chat · Sessions · Preview · Browser · More**
  - Icons only, label on active. 44px tap targets minimum.
  - `padding-bottom: env(safe-area-inset-bottom)` on the tab bar container.
- Chat view = home, fills viewport minus tab bar height + composer height.
- Sidebar opens as `.ds-sheet` on tap of Sessions tab. 80% viewport height, swipe-down to close.
- Preview + Browser = fullscreen modals. Close button top-right.
- More = settings, MCPs, plugins, version info.

At 1024px (`lg:`) and up:
- Tab bar becomes 64px-wide persistent **left rail** (icons only, same 5 slots as nav).
- Sidebar = persistent second column (340px). Does not overlay chat.
- Preview + Browser = resizable right panel (50% default, drag handle).
- Chat = middle column, fills remaining width.
- Header: `.topbar-glass` across the top with current project breadcrumb + global search.

## Per-section accents
Set `data-accent` on each top-level section's root:
```jsx
<div data-accent="sky" className="flex flex-col h-screen">   {/* Chat */}
<aside data-accent="lavender" className="...">               {/* Sidebar */}
<div data-accent="mint" className="...">                     {/* Preview */}
<div data-accent="peach" className="...">                    {/* Browser */}
<div data-accent="butter" className="...">                   {/* Tasks */}
<div data-accent="blush" className="...">                    {/* Settings/More */}
```

## Ecosystem steals for this phase

### open-webui mobile chat composer
Study https://github.com/open-webui/open-webui (most-starred chat UI). Their composer:
- Sticky bottom, `padding-bottom: env(safe-area-inset-bottom)`
- Auto-grows up to ~5 lines, scrolls after
- Inline icons: `+` (attach), 🎤 (mic), ↑ (send) — mic becomes send once text exists
- Keyboard-avoiding on iOS: use `visualViewport` API or CSS `svh` units
- Focus ring matches `data-accent`

### AionUi swipe-between-sessions
On mobile, horizontal swipe across chat area (>80px, <30° angle) moves to prev/next session in
the current project's conversation list. Use `react-swipeable` or native pointer events.
Velocity threshold 0.3px/ms. Spring back if threshold not met.

## Acceptance criteria
1. At 375×812: full iOS-native feel. Tab bar sticky, safe-area-padded. Every UI primitive is Midnight.
2. At 1440×900: multi-pane desktop layout. Persistent left rail + sidebar + chat + optional right panel.
3. `npm run build` succeeds, bundle size ≤ +5% vs upstream main.
4. Grep shows **zero raw Tailwind color classes** in touched files: `grep -rE 'bg-(blue|red|green|gray|yellow|pink|purple|indigo|orange|slate|zinc|neutral|stone)-[0-9]' src/ | wc -l` returns 0 (pre-existing untouched files may still have them — audit your diff only).
5. Playwright smoke: app boots on both viewports, tab bar nav works, chat accepts input, sidebar sheet opens + closes.

## Test plan
1. `npm run build` must succeed
2. `npm run dev` in background
3. Playwright script (spawn as test agent):
   - Launch `iPhone 14` device preset (`page.emulate('iPhone 14 Pro')` or manual 375×812)
   - Navigate to `/`, wait for mount
   - Screenshot to `docs/screenshots/phase-1/mobile-chat.png`
   - Tap Sessions tab → sheet slides up → screenshot `mobile-sessions.png`
   - Tap More → screenshot `mobile-more.png`
   - Resize to 1440×900 → screenshot `desktop.png`
   - Hover rail items, click them, screenshot `desktop-sidebar-active.png`
4. Fresh-eyes reviewer (Opus) reads diff + CLAUDE.md + this brief → runs checklist
5. Visual reviewer (Opus) reads screenshots + opens `docs/midnight/demo.html` → judges fidelity
6. PR opens with all screenshots inline; merge once CI green

## Commit convention
`feat(skin): apply Midnight to <area>` — one logical commit per area so the diff is readable.
