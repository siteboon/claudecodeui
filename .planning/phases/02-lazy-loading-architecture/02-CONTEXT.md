# Phase 2: Lazy Loading Architecture - Context

**Gathered:** 2026-01-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Server loads projects instantly with minimal data. Session list derived from filenames without opening JSONL files. Session summaries only loaded when user expands a project in sidebar. New API endpoint for fetching session summaries separately.

</domain>

<decisions>
## Implementation Decisions

### Backward Compatibility
- No backward compatibility needed — client and server always deployed together
- Breaking changes are acceptable — update UI alongside API changes
- No API versioning — evolve existing endpoints directly

### Project Payload
- Initial `/api/projects` response includes session count and total size upfront
- Sessions array deferred to separate endpoint call
- Stats (count, size) computed from filesystem without opening JSONL files

### Claude's Discretion
- Exact field names and response shapes
- Whether to use separate endpoint or parameter-based loading
- Loading state implementation details
- Error handling patterns for deferred fetches

</decisions>

<specifics>
## Specific Ideas

- Co-deployment model simplifies everything — no need to maintain multiple API versions
- Stats should be visible on project cards before expansion

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-lazy-loading-architecture*
*Context gathered: 2026-01-24*
