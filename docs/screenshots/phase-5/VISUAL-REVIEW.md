# Phase 5 Visual Review

Worktree: `/Users/home/src/Dispatch-wt-5`
Branch: `feat/preview-chrome-worktrees`
Captured: 2026-04-23

Playwright was used to capture headless Chromium screenshots at two viewports
(**375 x 812 iPhone** and **1440 x 900 desktop**) against the running dev
server (`VITE_PORT=5175`, `SERVER_PORT=3011`). A reference shot of
`docs/midnight/demo.html` was captured for side-by-side comparison.

## Screenshots captured

| File | Viewport | State captured |
|------|----------|----------------|
| `home-mobile.png` | 375 x 812 | Initial load after auth, mobile shell |
| `home-desktop.png` | 1440 x 900 | Initial load after auth, desktop rail + sidebar |
| `preview-tab-mobile.png` | 375 x 812 | Preview tab active (bottom nav, eye icon + label) |
| `preview-tab-desktop.png` | 1440 x 900 | Preview tab active (left rail, PreviewPane with URL bar + Fill preset) |
| `browser-tab-mobile.png` | 375 x 812 | Browser tab active (bottom nav, monitor icon + label) |
| `browser-tab-desktop.png` | 1440 x 900 | Browser tab active (BrowserPane Offline / No active tab / View only) |
| `worktree-list-desktop.png` | 1440 x 900 | Sidebar with project expanded: sessions + WORKTREES section listing sibling worktrees |
| `worktree-list-mobile.png` | 375 x 812 | Mobile sidebar sheet (project rows collapsed; WorktreeList not reached on mobile due to tap flow, see notes) |
| `tasks-drawer-fallback-desktop.png` | 1440 x 900 | Fallback — no session selected, floating Tasks button doesn't render (gated on `selectedSession?.id`) |
| `tasks-drawer-fallback-mobile.png` | 375 x 812 | Fallback — same, no session |
| `midnight-demo-reference.png` | 1440 x 900 | Reference: `docs/midnight/demo.html` token gallery |

## Per-image notes

### home-mobile.png
- Bottom tab bar renders with five slots; only the active slot shows its label
  ("Chat"), others icon-only. Good: matches `.ds-tabbar*` pattern.
- Tab-bar pill appears truncated on the right edge — the "More" icon sits flush
  against the right of the screen, label cut off. Check `mx-3` margin applies
  evenly.
- Empty state text ("Choose Your Project", "Tap the menu button above to access
  projects") sits in a `ds-tile`-style inset card — frosted-surface treatment
  is visible. Matches demo "Inset section" feel.

### home-desktop.png
- 56px left rail with 5 icon slots; Chat is active (pill-highlighted). Matches
  demo `nav-pill-active` treatment.
- Secondary sidebar (`data-accent="lavender"`) shows project list. Good.
- Right-side panel shows "Choose Your Project" empty state — reads cleanly.
- No off-palette colors in the shell chrome itself.

### preview-tab-desktop.png  **KEY SHOT**
- Preview tab active in rail (Eye icon, `data-accent="mint"`). Good.
- PreviewPane URL bar renders: globe icon, `LOCALHOST:` label, port spinner
  (3000), path input (`/`), and device preset dropdown (`Fill`). Matches the
  mint-accented tile from the demo.
- Iframe host area is a large dark pane (502 since nothing on :3000 — expected
  per brief). No raw red/blue error border — good.
- **Sidebar**: project expanded, sessions listed, and the `WORKTREES` section
  appears beneath with 3 rows: `Dispatch  MAIN`, `Dispatc...  FEAT/SIDEB...`,
  `Dispat...  FEAT/MCP-IN...`. This confirms `WorktreeList` is wired via
  `SidebarProjectSessions`.
- **Issue**: the branch tag pills (`MAIN`, `FEAT/SIDEB...`, `FEAT/MCP-IN...`)
  render in a muted neutral style. They are not clearly using a pastel badge
  variant (`.badge` from Midnight). Consider mapping to `.ds-chip` or `.badge`
  with a lavender/mint accent per the catalog.

### preview-tab-mobile.png
- Bottom tab bar shows the Preview slot active with "Preview" label and mint
  pill. Good.
- Main area shows empty state since no project is selected on mobile (mobile
  project row click only toggles expansion, not selection). Not a Phase 5 bug
  — mobile flow normally drives project selection via session tap.
- No PreviewPane content to review here; the rail colour accent is correct.

### browser-tab-desktop.png  **KEY SHOT**
- Browser tab active in rail (Monitor icon, `data-accent="peach"`).
- BrowserPane shows a thin status strip at the top: `OFFLINE  No active tab`
  on the left, `View only` on the right (label is clipped at right edge).
- Expected: CDP isn't running, so the empty state renders as a large dark
  canvas. This matches brief. No off-palette error text.
- **Possible concern**: the `View only` label is clipped (cut off at right).
  Check right-padding on the BrowserPane header / status bar.

### browser-tab-mobile.png
- Bottom tab bar shows Browser active with "Browser" label and peach pill.
- Main area: empty state (no project). Acceptable.

### worktree-list-desktop.png
- Same sidebar as preview-tab-desktop.png, but active tab is Chat. Project
  `@cloudcli-ai/cl... (Dispatch-wt-5)` expanded: "New Session" button, two
  session rows with red error badges + session IDs, then `WORKTREES` heading
  and three worktree rows with branch pills.
- **Issue**: the red "error" badges on session rows (483 / 108 message count
  with red background) may be raw Tailwind red — need to verify in code that
  these map to `.badge` with a danger/blush variant.
- **Issue (potentially pre-existing)**: the sidebar rendered a yellow-ish
  highlight on hover via Tailwind `bg-yellow-50` / `dark:bg-yellow-900/10`
  for starred rows (seen in SidebarProjectItem.tsx L127, L279). This is raw
  Tailwind color and violates Rule 3 — should be mapped to Midnight butter
  accent.
- **Issue**: mobile rendering of SidebarProjectItem uses raw Tailwind:
  `bg-green-500`, `bg-red-500/10`, `bg-yellow-500/10`, `bg-gray-500/10`,
  `text-red-600`, `text-yellow-600` (see SidebarProjectItem.tsx lines 195,
  220, 239, 245, 253). These should all go through Midnight tokens.
  **BUT**: this file is `SidebarProjectItem.tsx` — one of the three churny
  files that Rule 1 says **do not edit in place**. A wrapper / restyle must
  happen via a new module.

### worktree-list-mobile.png
- Sidebar sheet shows 4 project rows (all collapsed). Each row has star
  (yellow), trash (red), and edit (gray) action buttons visible. Those
  buttons use raw Tailwind reds/yellows — see `worktree-list-desktop` notes.
- No WorktreeList visible at this zoom because the tap flow didn't expand a
  project (mobile row tap toggles only; the test harness observed the click
  registered but the project stayed collapsed on the post-navigation sheet
  reopen). Not a strict blocker; the desktop shot confirms the component
  renders correctly and the mobile behavior would match if a user expands
  manually.

### tasks-drawer-fallback-*.png
- Brief anticipated this: Tasks drawer is gated on `selectedSession?.id`. With
  no session selected, the `aria-label="Show tasks"` floating button is not
  rendered. The capture shows the "Choose Your AI Assistant" panel instead.
- Live visual inspection of `TasksPane` / `TasksModal` would need a session;
  on the chat screen the "Tasks" button is expected to appear at bottom-right
  as a peach/butter pill per MainContent.tsx L226-236.

### midnight-demo-reference.png
- Reference token gallery: Glass tile, Inset section, raised surfaces,
  pastel cards in mint/peach/lavender/butter/blush/sky with proper shadows
  and blur.

## Midnight-fidelity findings

Summary of potential deviations spotted vs `docs/midnight/demo.html`:

1. **Raw Tailwind colors in SidebarProjectItem** (file is the churny
   `SidebarProjectItem.tsx`, off-limits per Rule 1):
   - Delete button: `bg-red-500/10`, `border-red-200`, `text-red-600`
   - Star button: `bg-yellow-500/10`, `border-yellow-200`,
     `text-yellow-600`
   - Edit button: `bg-gray-500/10`, `border-gray-200`,
     `text-gray-600`
   - Save: `bg-green-500`, `bg-green-600`
   - These violate Rule 3 (no raw Tailwind colors) but the fix must be done
     via a wrapper module, not an in-place edit. Since this file is
     pre-Phase-5, it may be pre-existing debt — worth flagging in review
     but not a Phase 5 blocker.

2. **Error / message-count badges on session rows** — verify the red badge
   numbers (483, 108) route through a `.badge` variant. If they're raw
   Tailwind, they'd need to use Midnight blush or a danger token.

3. **WORKTREES branch pills** render with a muted neutral treatment. The
   demo shows `.ds-chip` pastel pills — the WorktreeList branch labels
   could benefit from lavender or sky `.ds-chip` styling. Check
   `src/components/sidebar/worktrees/WorktreeList.tsx`.

4. **`View only` badge in BrowserPane** is clipped on the right edge. Add
   right-padding or shorten the label.

5. **Mobile tab bar "More" icon** sits flush against the right viewport
   edge, label may be cut off. Check the `.ds-tabbar` margin.

## Positives / what matches the demo

- **Rail + tab-bar accent colors** are correctly applied via `data-accent`:
  mint for Preview, peach for Browser. Chat (sky) active on default.
- **Sidebar container** uses `data-accent="lavender"` per App Content.
- **MainContent container** toggles `data-accent` per tab: mint / peach /
  butter / sky. Good.
- **PreviewPane URL bar + Fill preset dropdown** renders cleanly, matches
  the inset-tile treatment from the demo.
- **BrowserPane Offline state** uses a low-key neutral header — no raw
  red error treatment.
- **WorktreeList** renders under each project's session list as expected
  (visible in `preview-tab-desktop.png` and `worktree-list-desktop.png`).
- **Desktop Chat pill** highlight matches the demo's
  `nav-pill-active` treatment.

## Bug notice (backend crash)

While capturing the Browser-tab shots, the Phase 5 CDP screencast endpoint
(`/ws/chrome-view`) raised:

```
Error: server.handleUpgrade() was called more than once with the same socket
  at WebSocketServer.completeUpgrade (node_modules/ws/lib/websocket-server.js:369:13)
```

This crashes the backend process when two clients open the Browser tab (or
when the tab is clicked twice in quick succession). Should be triaged in
`server/routes/chrome-screencast.js` — likely a missing `.once('upgrade')`
guard. Not a *visual* fidelity issue, but worth noting for the Phase 5 PR.

## Touch-target verification

DesktopRail buttons: `h-11 w-11` = 44x44px. **Pass.**
MobileTabBar buttons: use `mobile-touch-target` class on the button,
`Icon` width/height 18px — the outer pill wraps to keep 44px. Pass.
Floating Tasks button: uses `btn-pill` + `mobile-touch-target`. Pass.
Sidebar project mobile rows: `p-3` padding on a row with 28x28 icon — total
row height ~56px. Pass.

## Summary

Phase 5 Preview/Browser tabs and WorktreeList **render correctly with the
midnight palette** in the captured happy paths. Main open items:

- Churny-file (`SidebarProjectItem.tsx`) still has raw Tailwind colors —
  pre-existing debt; fix via wrapper per Rule 1.
- WorktreeList branch pills could adopt `.ds-chip` pastels for visual
  polish.
- BrowserPane `View only` label needs right-padding.
- Server crash on `/ws/chrome-view` double-upgrade is a backend bug
  separate from visual review but surfaced during testing.
