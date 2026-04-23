# Dispatch — Master Build Plan

## Vision
Fork `siteboon/claudecodeui` (v1.30.0) into `4Gaige/Dispatch`. Apply Midnight design system as
mobile-first skin. Add automatic session naming, repo-based project grouping, Topic clustering,
live preview + live Chrome viewport, worktree parallelism, kanban task view, and selective MCP
integrations. Keep up with upstream via weekly auto-PR.

## Waves
```
Wave 0 (done by human, this session)   Phase 0 — Setup / fork / docs / orchestrator
       ↓
Wave 1 (solo, 1 session)                Phase 1 — Midnight skin + mobile-first layout
       ↓
Wave 2 (3 parallel sessions)            Phase 2 — Sidebar tree + tab-bug fix       [visual review]
                                        Phase 5 — Preview + Chrome + worktrees + tasks  [visual review]
                                        Phase 6 — MCP integrations + auto-update verify
       ↓
Wave 3 (1 session, sequential within)   Phase 3 — Auto-naming
                                        Phase 4 — Topic clustering
```

## Phase summaries (briefs in `docs/phase-N-brief.md`)
| # | Name | Time | Parallel? | Visual review? |
|---|---|---|---|---|
| 1 | Midnight skin + mobile layout | 2–3d | No | Yes |
| 2 | Sidebar tree + tab fix | 1.5d | Wave 2 | **Yes** |
| 3 | Auto-naming (Haiku titler) | 0.5d | No | No |
| 4 | Topic clustering (Haiku tags + HDBSCAN) | 1d | No | No |
| 5 | Preview + Chrome + worktrees + tasks | 3d | Wave 2 | **Yes** |
| 6 | MCP integrations + upstream tracking | 0.5d | Wave 2 | No |

## Ecosystem steals (distributed into phases)
| Source | Stars | Phase | What to borrow |
|---|---|---|---|
| [open-webui/open-webui](https://github.com/open-webui/open-webui) | 133k | 1, 2, 3, 4 | Mobile chat composer, draggable folders, title-gen prompt, tag-as-filter |
| [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi) | 22k | 1, 2 | Swipe-between-sessions gesture, conversation search/filter UX |
| [yxwucq/CCUI](https://github.com/yxwucq/CCUI) | 30 | 5 | Git-worktree parallel session pattern |
| [Ark0N/Codeman](https://github.com/Ark0N/Codeman) | 329 | 5 | Session activity indicators (green/grey/red/pulse) |
| [guilhermexp/claudecodeui-kanban](https://github.com/guilhermexp/claudecodeui-kanban) | 11 | 5 | TodoWrite → kanban cards |
| [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | 1.7k | 6 | Repo-aware sidebar signals |
| [steipete/claude-code-mcp](https://github.com/steipete/claude-code-mcp) | 1.2k | 6 | Spawn sub-agent button |

## Upstream tracking
`aormsby/Fork-Sync-With-Upstream-action@v3.4` on `.github/workflows/sync-upstream.yml`.
Monday noon UTC cron → PR `upstream-sync → main` → human review + merge.

## Running locally
`git pull && npm install && npm run build && launchctl kickstart -k gui/$UID/com.cloudcli.server`

Launchd plist at `~/Library/LaunchAgents/com.cloudcli.server.plist` runs
`node /Users/home/src/Dispatch/dist-server/server/index.js`.
