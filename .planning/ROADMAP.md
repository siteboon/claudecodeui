# Roadmap: ClaudeCodeUI Memory Optimization

## Overview

Transform ClaudeCodeUI from crashing on large projects to handling projects of any size through byte-limited file reading, lazy loading architecture, and size visibility in the UI. Each phase builds on the previous, starting with optimized file reading, enabling lazy loading patterns, and finishing with user-facing size indicators.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: File Reading Optimization** - Byte-limit JSONL reads and graceful fallbacks
- [x] **Phase 2: Lazy Loading Architecture** - On-demand session metadata and new API endpoints
- [ ] **Phase 3: UI Size Indicators** - Display project and session sizes for visibility

## Phase Details

### Phase 1: File Reading Optimization
**Goal**: Server can extract metadata from large JSONL files without running out of memory
**Depends on**: Nothing (first phase)
**Requirements**: READ-01, READ-02, READ-03, READ-04, COMPAT-01, COMPAT-02, COMPAT-03
**Success Criteria** (what must be TRUE):
  1. Server processes 300MB+ JSONL files without OOM errors
  2. Project `cwd` extracted from first 100KB of file, reading stops once found
  3. Session timestamps derived from file `mtime` without parsing content
  4. When metadata not found in byte-limited read, defaults are used and server continues
  5. Existing skip patterns and size limits continue to work unchanged
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md - TDD: Byte-limited cwd extraction function
- [x] 01-02-PLAN.md - Integrate byte-limited extraction with fallbacks
- [x] 01-03-PLAN.md - Use file mtime for session timestamps

### Phase 2: Lazy Loading Architecture
**Goal**: Projects load instantly with minimal data, session details fetched on-demand
**Depends on**: Phase 1
**Requirements**: LAZY-01, LAZY-02, LAZY-03, LAZY-04
**Success Criteria** (what must be TRUE):
  1. Session list derived from filenames without opening JSONL files
  2. Session summaries only loaded when user expands a project in sidebar
  3. Initial `/api/projects` response contains minimal metadata per project
  4. New API endpoint exists for fetching session summaries separately
  5. Full message content still available when user opens a session
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md - Server-side minimal project metadata extraction
- [x] 02-02-PLAN.md - API and frontend lazy loading integration

### Phase 3: UI Size Indicators
**Goal**: Users can see which projects and sessions are large
**Depends on**: Phase 2
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. Project card displays total size (sum of all session files) - DONE in Phase 2
  2. Session list shows individual session file size
  3. Sizes formatted appropriately (KB, MB, GB with 1 decimal place) - DONE in Phase 2
**Plans**: 1 plan

Plans:
- [ ] 03-01-PLAN.md - Add session file size to backend and display in sidebar

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. File Reading Optimization | 3/3 | Complete | 2026-01-24 |
| 2. Lazy Loading Architecture | 2/2 | Complete | 2026-01-24 |
| 3. UI Size Indicators | 0/1 | Not started | - |
