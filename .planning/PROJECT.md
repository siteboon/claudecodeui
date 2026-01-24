# ClaudeCodeUI Memory Optimization

## What This Is

Memory optimization for ClaudeCodeUI to handle large Claude Code projects without crashing. ClaudeCodeUI is a web interface for browsing and interacting with Claude Code, Cursor, and Codex sessions. The `/api/projects` endpoint crashes with OOM errors when processing projects containing multi-hundred-megabyte JSONL session files created by extensive Claude Code usage (especially with GSD/sub-agents).

## Core Value

ClaudeCodeUI must be able to load and display projects of any size without running out of memory.

## Requirements

### Validated

<!-- Existing functionality that works and must be preserved -->

- [x] **PROJ-01**: List Claude Code projects from `~/.claude/projects/` — existing
- [x] **PROJ-02**: Display project name and path in sidebar — existing
- [x] **PROJ-03**: List sessions within projects with summaries — existing
- [x] **PROJ-04**: View session message history — existing
- [x] **PROJ-05**: Real-time project updates via WebSocket — existing
- [x] **PROJ-06**: Skip projects by size threshold (`SKIP_LARGE_PROJECTS_MB`) — existing
- [x] **PROJ-07**: Skip projects by name pattern (`SKIP_PROJECTS_PATTERN`) — existing
- [x] **CURSOR-01**: Detect and list Cursor sessions for projects — existing
- [x] **CODEX-01**: Detect and list Codex sessions for projects — existing

### Active

<!-- Current scope: Memory optimization for large projects -->

- [ ] **OPT-01**: Byte-limit JSONL file reads (100KB max for metadata extraction)
- [ ] **OPT-02**: Extract `cwd` from first 100KB only, stop reading once found
- [ ] **OPT-03**: Extract session metadata from JSONL filename + file stats (not content)
- [ ] **OPT-04**: Lazy-load session summaries only when project is expanded
- [ ] **OPT-05**: Defer full message content loading until session is opened
- [ ] **OPT-06**: Display project size in UI (MB/GB indicator)
- [ ] **OPT-07**: Display session file size in UI
- [ ] **OPT-08**: Graceful degradation when metadata extraction fails (use defaults)

### Out of Scope

- Session archiving/cleanup tools — user can manage files manually
- JSONL file compression — changes Claude Code's data format
- Database caching of metadata — adds complexity, files change frequently
- Splitting large JSONL files — Claude Code's responsibility, not ours

## Context

### Current Architecture

ClaudeCodeUI's project discovery (`server/projects.js`) works as follows:

1. **`getProjects()`** scans `~/.claude/projects/` directory
2. For each project directory, it:
   - Calls `extractProjectDirectory()` — streams JSONL files to find `cwd`
   - Calls `getSessions()` — streams JSONL files for session metadata
   - Calls `getCursorSessions()` / `getCodexSessions()` — additional providers
3. Returns full project list to frontend

### The Problem

- JSONL session files grow to 100MB-600MB due to embedded tool outputs, file contents, thinking blocks
- Current code limits by **line count** (5000 entries) but average line is 400KB+
- Processing even limited lines from a 300MB file exhausts Node.js heap
- One 2.4GB project directory with 30+ large sessions crashes the server

### Key Findings from Research

1. **Metadata is at the top**: `cwd` appears in first 5 lines, `summary` entries at line 1-3
2. **Session ID is the filename**: `{uuid}.jsonl` — no need to parse file for this
3. **File stats provide timestamps**: `mtime` is sufficient for sorting
4. **Full content only needed for message viewing**: `getSessionMessages()` is separate

### Files Involved

- `server/projects.js` — main project discovery logic
- `server/index.js` — API endpoints
- `src/components/Sidebar.jsx` — displays project/session list

## Constraints

- **Tech stack**: Node.js/Express backend, React frontend — no changes
- **Compatibility**: Must work with existing Claude Code session format
- **Performance**: Project list should load in <2 seconds even with large projects
- **Memory**: Must not exceed ~500MB heap during project loading

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Byte-limit reads vs line-limit | Line-limiting doesn't prevent OOM when lines are 400KB+ | — Pending |
| Lazy-load summaries | Reduces initial load; summaries only needed for visible projects | — Pending |
| File stats for timestamps | Avoids parsing; `mtime` is reliable enough | — Pending |
| No caching layer | Files change frequently; caching adds staleness issues | — Pending |

---
*Last updated: 2026-01-24 after initialization*
