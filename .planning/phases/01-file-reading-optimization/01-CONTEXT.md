# Phase 1: File Reading Optimization - Context

**Gathered:** 2026-01-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Server can extract metadata from large JSONL files without running out of memory. Implements byte-limited reads (100KB) for cwd extraction, uses file mtime for timestamps, and gracefully handles cases where metadata isn't found. Existing skip patterns and size limits continue to work unchanged.

</domain>

<decisions>
## Implementation Decisions

### Fallback behavior
- When cwd not found in first 100KB: use parent folder name as project identifier
- Corrupt or truncated files: include session in results but mark with warning flag indicating potentially incomplete data
- Sessions with incomplete metadata still appear in UI, not silently dropped

### Claude's Discretion
- Whether to show indicator when timestamp comes from mtime vs parsed content
- Sorting behavior for sessions with incomplete metadata (normal vs bottom)
- Exact warning flag representation in API response

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-file-reading-optimization*
*Context gathered: 2026-01-24*
