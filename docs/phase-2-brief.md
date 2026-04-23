# Phase 2 — Sidebar tree + tab bug fix

## Goal
Replace the flat Projects/Conversations tab behavior with a true three-level sidebar tree:
**Project (repo) → Topic → Conversation**. Fix the misleading Projects/Conversations toggle
(it's actually a search-scope toggle — relabel & disable when search is empty).

## Repo location
Worktree `/Users/home/src/Dispatch-wt-2` on branch `feat/sidebar-tree`.

## Files to TOUCH
- `src/components/sidebar/view/Sidebar.tsx` — import new `SidebarTopicGroup` wrapper
- `src/components/sidebar/subcomponents/SidebarContent.tsx` — render wrapped tree
- i18n keys for search: `search.modeProjects`, `search.modeConversations` → relabel
- Search input component wherever it lives in sidebar — grey out tabs when empty

## Files to CREATE
- `src/components/sidebar/topics/SidebarTopicGroup.tsx` — wraps existing `SidebarProjectItem` additively
- `src/components/sidebar/topics/SidebarProjectTree.tsx` — orchestrates 3-level rendering
- `src/components/sidebar/topics/TopicChip.tsx` — mobile horizontal-scroll chip row
- `server/services/repo-grouper.js` — walks up CWD, finds `.git`, returns remote.origin.url or folder
- Hook into `server/projects.js` getProjects: `const grouper = require('./services/repo-grouper'); const grouped = grouper.group(rawProjects);` — single new line in shared file

## Files NOT to touch
`server/projects.js` internals (only add one require line), `server/index.js`,
`src/components/sidebar/subcomponents/SidebarProjectItem.tsx`.

## Behavior

### Tab "bug" fix
- Relabel tabs to "Search projects" / "Search inside conversations"
- When search input is empty: disable toggle, show placeholder text "Type to search"
- When text entered: toggle active, scopes the full-text match

### Repo grouping
`repo-grouper.js` algorithm:
1. For each project/session cwd: walk up directory tree looking for `.git`
2. If `.git` found: run `git -C <gitroot> config --get remote.origin.url`
   - If success → key = origin URL (normalized: strip `.git`, strip trailing slash, lowercase)
   - If failure (no remote) → key = basename of git root dir
3. If no `.git` ancestor: key = longest common ancestor of all known cwds sharing a prefix, or "Uncategorized"
4. Worktrees: detect `.claude/worktrees/` segment or `gitBranch` prefix `claude/` → collapse into parent repo's group
5. Cache the mapping in `~/.cloudcli/project-config.json` keyed by project slug; recompute on getProjects if cache missing

### Sidebar rendering
Mobile (<lg):
- Sheet opens on Sessions tab tap
- Full-screen bottom sheet (80% viewport)
- Search input + scope tabs at top
- Below: list of **Project** headers. Tap → sheet navigates into project view (breadcrumb, back button)
- Project view: horizontal chip row of Topics at top (`.ds-chip` variants mapped to pastels). Tap chip → filter conversations below.
- Conversation list: `SidebarSessionItem` instances, tap → chat opens, sheet dismisses.

Desktop (lg+):
- Persistent 340px column
- Collapsible 3-level tree: ▶ Project → ▶ Topic → conversation rows
- Arrow keys navigate, Enter opens, Right-arrow expands
- Right-click menu: Rename, Move to Topic, Archive
- Drag-and-drop: drag a conversation onto a Topic to reassign

### "Show as list" escape hatch
Toggle in settings; when on, sidebar renders the current flat slug list instead of the tree.

## Ecosystem steals

### open-webui draggable folders
Reference: https://github.com/open-webui/open-webui — their folder hierarchy UX is the gold
standard. Borrow: drag cursor, drop zones highlighted with `data-accent` ring, optimistic UI update.
Use `@dnd-kit/core` (lightweight, already probably in shadcn stack — verify).

### AionUi conversation search + filter UX
Reference: https://github.com/iOfficeAI/AionUi — their search results show snippets from the
matching message with the query highlighted. Borrow this presentation; reuse existing
`searchConversations()` backend in `server/projects.js` (don't modify that file beyond the
one-line require for repo-grouper).

## Acceptance criteria
1. Sessions tab opens sheet on mobile, sidebar renders tree on desktop
2. `admiring-payne-e269b9`-style worktree slugs no longer appear as top-level — they're children of their parent repo
3. Search toggle correctly labeled, disabled when empty, functional when typed
4. Drag a conversation to a Topic on desktop → it stays assigned across reload
5. Long-press + drag on mobile works too
6. `npm run build` + tests pass
7. No edits to the 3 churny files beyond one `require` line in `server/projects.js`

## Test plan
1. Visual review sub (Opus):
   - Playwright, 375×812: screenshot empty sheet, sheet with projects, project-detail view, topic filtering, keyboard/swipe interactions
   - Playwright, 1440×900: screenshot collapsed tree, expanded tree, drag-in-progress, hover states
   - Compare to Midnight demo for fidelity
2. Fresh-eyes reviewer (Opus): diff + CLAUDE.md + this brief → checklist
3. Smoke test: multi-project fake fixtures (or real `~/.claude/` contents) confirm grouping correctness

## Commits
`feat(sidebar): repo grouping`, `feat(sidebar): topic tree render`, `feat(sidebar): search scope relabel`, `feat(sidebar): drag-reassign`, `fix(sidebar): keyboard nav`
