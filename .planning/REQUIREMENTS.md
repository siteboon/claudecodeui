# Requirements: ClaudeCodeUI Memory Optimization

**Defined:** 2026-01-24
**Core Value:** ClaudeCodeUI must load and display projects of any size without running out of memory

## v1 Requirements

Requirements for memory optimization release.

### File Reading Optimization

- [ ] **READ-01**: Byte-limit JSONL file reads to 100KB maximum for metadata extraction
- [ ] **READ-02**: Stop reading file immediately once `cwd` value is found
- [ ] **READ-03**: Use file `mtime` for session timestamps instead of parsing timestamp fields
- [ ] **READ-04**: Graceful fallback to defaults when byte-limited read doesn't find expected data

### Lazy Loading

- [x] **LAZY-01**: Derive session list from JSONL filenames without parsing file content
- [x] **LAZY-02**: Load session summaries on-demand only when project is expanded in sidebar
- [x] **LAZY-03**: Return minimal project metadata on initial `/api/projects` call
- [x] **LAZY-04**: Add endpoint for fetching session summaries separately

### UI Indicators

- [x] **UI-01**: Display total project size (sum of session files) in project card
- [x] **UI-02**: Display individual session file size in session list
- [x] **UI-03**: Format sizes appropriately (KB, MB, GB with 1 decimal)

### Backward Compatibility

- [ ] **COMPAT-01**: Preserve existing API response structure for frontend compatibility
- [ ] **COMPAT-02**: Existing skip patterns and size limits continue to work
- [ ] **COMPAT-03**: Full message content still available via `getSessionMessages()`

## v2 Requirements

Deferred to future release.

### Progressive Loading

- **PROG-01**: Prefetch session metadata in background after initial load
- **PROG-02**: Load more sessions as user scrolls
- **PROG-03**: Cache session metadata with TTL

### Advanced UI

- **ADV-01**: Visual warning for projects over 1GB
- **ADV-02**: Storage breakdown chart in settings
- **ADV-03**: Session age indicators (old sessions that could be archived)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Session archiving/cleanup | User responsibility; ClaudeCodeUI is read-focused |
| JSONL compression | Would change Claude Code's data format |
| Database caching | Adds staleness complexity; files change frequently |
| Splitting large files | Claude Code's responsibility |
| Real-time memory monitoring | Over-engineering for this problem |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| READ-01 | Phase 1 | Complete |
| READ-02 | Phase 1 | Complete |
| READ-03 | Phase 1 | Complete |
| READ-04 | Phase 1 | Complete |
| COMPAT-01 | Phase 1 | Complete |
| COMPAT-02 | Phase 1 | Complete |
| COMPAT-03 | Phase 1 | Complete |
| LAZY-01 | Phase 2 | Complete |
| LAZY-02 | Phase 2 | Complete |
| LAZY-03 | Phase 2 | Complete |
| LAZY-04 | Phase 2 | Complete |
| UI-01 | Phase 3 | Complete |
| UI-02 | Phase 3 | Complete |
| UI-03 | Phase 3 | Complete |

**Coverage:**
- v1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0

---
*Requirements defined: 2026-01-24*
*Last updated: 2026-01-24 after Phase 3 completion*
