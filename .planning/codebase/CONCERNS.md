# Codebase Concerns

**Analysis Date:** 2026-01-24

## Tech Debt

**Inconsistent Error Messaging in Git Operations:**
- Issue: Multiple TODO comments indicate user-friendly error messages are not consistently implemented for Git operations (pull, push, fetch failures)
- Files: `src/components/GitPanel.jsx:256`, `src/components/GitPanel.jsx:283`, `src/components/GitPanel.jsx:311`
- Impact: Users see console errors but no UI feedback for failed git operations, leading to confusion about operation status
- Fix approach: Implement toast notifications or error modals for all git operation failures. Add logging to understand failure patterns before showing generic user messages

**Incomplete MCP Server Management UI:**
- Issue: Cursor MCP server add/edit/delete operations are stubbed with TODO comments, preventing users from managing Cursor-specific MCP servers through the UI
- Files: `src/components/Settings.jsx:1429-1431`
- Impact: Users cannot configure MCP servers for Cursor sessions via UI despite having the capability in Claude settings
- Fix approach: Implement MCP server form handlers for Cursor similar to Claude's implementation in Settings component. Mirror the validation and API call patterns from Claude section

**WebSocket Connection Cleanup on Client Disconnect:**
- Issue: WebSocket handlers don't fully clean up shell PTY processes or sessions when clients disconnect unexpectedly
- Files: `server/index.js:900-902` (handleChatConnection), `server/index.js:906-1200` (handleShellConnection)
- Impact: Orphaned PTY processes may consume resources and cause memory leaks over time with many disconnects
- Fix approach: Add explicit cleanup for ptySessionsMap entries when ws.close() or ws.error events occur. Implement TTL-based garbage collection for abandoned sessions

**Unhandled Promise Rejections in Async Operations:**
- Issue: Multiple async operations in ChatInterface and Settings don't wrap all promise chains with proper error boundaries
- Files: `src/components/GitPanel.jsx:105-116` (multiple fetchFileDiff calls in loop), `src/components/Settings.jsx` (multiple API calls)
- Impact: Unhandled promise rejections can cause silent failures and state inconsistencies
- Fix approach: Wrap all async operations in try-catch blocks or add .catch() handlers. Consider implementing a global error boundary for async operations

**Large Files with Complex Logic:**
- Issue: Several files exceed 1500+ lines combining multiple concerns (routing, business logic, WebSocket handling)
- Files: `server/index.js:1775` lines, `server/projects.js:1895` lines, `server/routes/taskmaster.js:1962` lines
- Impact: Difficult to test, maintain, and reason about code. Hard to locate bugs across multiple responsibilities
- Fix approach: Break large files into smaller modules: split server/index.js into separate files for shell, chat, and project management; move session management to dedicated module

## Known Bugs

**Path Traversal Risk in Binary File Serving:**
- Symptoms: Could potentially serve files outside project root with crafted paths
- Files: `server/index.js:611-614` (binary file endpoint validation logic)
- Trigger: Path validation uses `path.resolve()` on untrusted filePath without first resolving it relative to projectRoot
- Workaround: Current implementation includes startsWith() check that prevents most traversal attempts, but logic is fragile
- Fix: Always resolve relative paths against projectRoot first before validation: `const resolved = path.resolve(projectRoot, filePath)`

**Race Condition in Project Directory Caching:**
- Symptoms: extractProjectDirectory() cache may return stale paths if project is moved/deleted while server is running
- Files: `server/projects.js` (projectDirectory cache implementation around line 282)
- Trigger: Rename or move project directory while server is actively caching it
- Workaround: Restart server to clear cache; manually clear via API if exposed
- Fix: Implement cache invalidation triggers based on file system watcher events. Add TTL-based cache expiration (e.g., 5 minutes)

**Missing Error Handling for JSON Parse Failures:**
- Symptoms: Server crashes if malformed WebSocket messages are sent or corrupted session files are parsed
- Files: `server/index.js:786` (JSON.parse(message) in handleChatConnection), `server/index.js:914` (JSON.parse in handleShellConnection)
- Trigger: Send invalid JSON to WebSocket endpoint or have corrupted .jsonl session files
- Workaround: Manually restart server
- Fix: Wrap JSON.parse in try-catch and send error response to client instead of crashing

**Session ID Collision Risk:**
- Symptoms: Multiple users with same session ID could interfere with each other's sessions
- Files: `server/index.js:936` (ptySessionKey generation), `server/claude-sdk.js:39-44` (createRequestId generation)
- Trigger: Very unlikely but possible with weak random generation or same user opening multiple windows
- Workaround: None - sessions would interfere in rare cases
- Fix: Include user ID and timestamp in session key generation to guarantee uniqueness

## Security Considerations

**Exposed Debug Logging:**
- Risk: Sensitive information (file paths, commands, project names) is logged to console with [DEBUG] prefix
- Files: `server/index.js:558` (file read), `server/index.js:599` (binary serve), `server/index.js:653` (file save), `server/index.js:789` (user messages)
- Current mitigation: Console logs only visible to server operators; not exposed in production UI
- Recommendations: Filter debug logs in production. Implement log level controls (DEBUG should be disabled by default). Never log file contents, API keys, or auth tokens

**Missing CSRF Protection:**
- Risk: POST requests lack CSRF token validation, allowing cross-site attacks if authentication cookies are used
- Files: `server/index.js` (all POST handlers), `server/routes/*.js` (all API endpoints)
- Current mitigation: Token-based authentication in header (less vulnerable to CSRF than cookies)
- Recommendations: Still add explicit CSRF tokens for added safety. Validate Origin/Referer headers

**Environment Variable Secrets in .env Example:**
- Risk: .env.example may contain placeholder secrets that developers accidentally keep
- Files: `.env.example`
- Current mitigation: Example file marked executable, clearly marked as example
- Recommendations: Implement pre-commit hook to warn if .env is accidentally committed. Document secret rotation procedures

**Command Injection Risk in Shell Terminal:**
- Risk: User commands passed to PTY are not sanitized before execution
- Files: `server/index.js:980-1050` (shell initialization and command execution)
- Current mitigation: Commands executed directly via user input (intentional for terminal), but user has initiated execution
- Recommendations: Warn users about running untrusted commands. Implement sandboxing if shell executes from untrusted sources. Document security implications

**Unsafe Project Path Resolution:**
- Risk: Symlink attacks could bypass path validation if project root is a symlink
- Files: `server/index.js:574` (path validation with startsWith check), `server/projects.js` (project directory resolution)
- Current mitigation: Basic path traversal check with startsWith()
- Recommendations: Use `fs.realpathSync()` to resolve symlinks before validation. Validate all resolved paths are under expected roots

## Performance Bottlenecks

**Session Loading from Large JSONL Files:**
- Problem: Reading large session JSONL files line-by-line can be memory-intensive even with early exit
- Files: `server/projects.js:857` (parseJsonlSessions function)
- Cause: Each line parsed to JSON before checking if limit reached. No streaming parser used
- Improvement path: Implement streaming JSON parser or read file in chunks before parsing. Cache recently accessed sessions with LRU cache to reduce repeated reads

**Project Discovery File I/O Bottleneck:**
- Problem: Discovering projects requires reading and parsing all .jsonl files even for known projects
- Files: `server/projects.js:234-300` (getProjects function)
- Cause: No caching of project metadata beyond extractProjectDirectory; full directory scan on every request
- Improvement path: Persist project list to cache file with hash-based validation. Invalidate cache on file system watcher events only

**WebSocket Message Serialization Overhead:**
- Problem: Every message sent to WebSocket is JSON.stringify'd, creating garbage for large responses
- Files: `server/index.js:761` (WebSocketWriter.send)
- Cause: No batching or compression of WebSocket frames
- Improvement path: Implement message batching for rapid successive sends. Consider message compression for large payloads

**Repeated Diff Generation for Files:**
- Problem: Git diffs are fetched for every file in the changed set even if user doesn't view all files
- Files: `src/components/GitPanel.jsx:105-116` (loop fetching diffs for all modified/added/deleted files)
- Cause: All diffs loaded eagerly when git status is fetched
- Improvement path: Implement lazy-loading of diffs. Only fetch diff when user expands file in UI. Cache fetched diffs to avoid refetching

## Fragile Areas

**Project Path Extraction from JSONL:**
- Files: `server/projects.js` (extractProjectDirectory and related functions)
- Why fragile: Relies on parsing JSONL files to find 'cwd' field; if file format changes or cwd field is missing, project discovery breaks
- Safe modification: Add schema validation for JSONL entries. Add fallback to directory name decoding if cwd not found. Test with corrupted files
- Test coverage: No unit tests found for project extraction logic. Should test with various JSONL formats, missing fields, and corrupted files

**Git Operation Status Detection:**
- Files: `src/components/GitPanel.jsx` (fetchGitStatus and related functions)
- Why fragile: Relies on git command output parsing; changes in git versions or output format could break detection
- Safe modification: Parse git status porcelain format strictly. Add version checking for git binary. Test against multiple git versions
- Test coverage: No tests found for git parsing. Should mock git responses and test various output formats

**WebSocket Session Lifecycle Management:**
- Files: `server/index.js:906-1100` (handleShellConnection with PTY session management)
- Why fragile: Complex state machine with multiple timeout and reconnection scenarios; difficult to trace all execution paths
- Safe modification: Extract PTY session logic to separate module with clear state transitions. Add logging at each state change. Test with simulated client disconnects/reconnects
- Test coverage: No integration tests for WebSocket session management found

**MCP Server Configuration Detection:**
- Files: `server/routes/taskmaster.js` (detectTaskMasterMCPServer function), `server/utils/mcp-detector.js`
- Why fragile: Checks for specific file names and structures; changes in TaskMaster format break detection
- Safe modification: Make file checks more flexible with fallbacks. Document expected TaskMaster structure. Add validation of detected config
- Test coverage: No tests for MCP detection found. Should test with various TaskMaster configurations

**Settings Component State Management:**
- Files: `src/components/Settings.jsx` (27 useState hooks with complex interdependencies)
- Why fragile: Large component with 27 separate state variables; easy to create inconsistencies between related states
- Safe modification: Extract related states into useReducer for better coherence. Create separate sub-components for each settings section. Add form validation layer
- Test coverage: No tests found for Settings component. Should test state transitions, form validation, API error handling

## Scaling Limits

**Project Discovery Memory Usage:**
- Current capacity: Handles ~100-200 projects comfortably before slowing down
- Limit: Crashes with "heap out of memory" on monorepos >2GB or >500+ projects
- Scaling path: Already implemented with SKIP_LARGE_PROJECTS_MB and SKIP_PROJECTS_PATTERN env vars (documented in MEMORY_OPTIMIZATION.md). Further improvements: implement streaming project list, add pagination support to UI

**WebSocket Connection Limits:**
- Current capacity: Handles ~50-100 concurrent WebSocket connections before slowdown
- Limit: OS file descriptor limits, memory grows linearly with connections
- Scaling path: Implement connection pooling. Move to horizontal scaling with message broker (Redis). Use connection compression

**Session History Size:**
- Current capacity: Can handle projects with ~5000 sessions before UI becomes sluggish
- Limit: Loading all sessions into memory causes browser to hang
- Scaling path: Implement server-side pagination with limit/offset. Add session filtering/search. Archive old sessions to separate storage

**Database Query Performance:**
- Current capacity: SQLite performs adequately for <10k users
- Limit: SQLite doesn't scale well beyond that; needs migration to PostgreSQL for high concurrency
- Scaling path: Abstract database layer to support pluggable backends. Add query caching. Implement read replicas

## Dependencies at Risk

**node-pty Beta Version:**
- Risk: Using ^1.1.0-beta34 which is pre-release; stability not guaranteed for production
- Impact: Terminal functionality (shell WebSocket) could break with version updates
- Migration plan: Monitor for stable release. Consider pinning exact version until stable. Have fallback to child_process spawning if pty fails

**better-sqlite3 Native Build:**
- Risk: Requires native compilation; fails on systems without build tools or incompatible architectures
- Impact: Database functionality breaks if build fails during installation
- Migration plan: Add fallback to sqlite3 (async). Test installation on target platforms. Consider prebuilt binary distribution

**@anthropic-ai/claude-agent-sdk Rapid Evolution:**
- Risk: SDK version 0.1.29 indicates early development; API may change with minor version updates
- Impact: Claude integration could break with dependency updates
- Migration plan: Pin exact version until API stabilizes. Implement abstraction layer around SDK. Subscribe to release notes

**node-fetch v2 Deprecation:**
- Risk: node-fetch v2 is deprecated in favor of native fetch in Node 18+
- Impact: Will eventually become incompatible; needs migration before Node.js versions requiring it drop v2 support
- Migration plan: Upgrade to Node 18+ baseline. Remove node-fetch import and use native fetch. Test all fetch calls

## Missing Critical Features

**Session Export/Import:**
- Problem: No way to export session history for backup or sharing
- Blocks: Users cannot preserve conversation history if project deleted, cannot migrate between installations
- Priority: Medium - quality of life feature but not blocking core functionality

**Rate Limiting on APIs:**
- Problem: No rate limiting on API endpoints
- Blocks: Could allow resource exhaustion attacks, no protection against runaway scripts
- Priority: High - security concern for production deployments

**Cursor MCP Server Management:**
- Problem: Cursor-specific MCP servers cannot be added/edited/deleted through UI
- Blocks: Users must manually edit config files; inconsistent UX compared to Claude
- Priority: Medium - UX parity issue

**Transaction Support for Multi-Step Operations:**
- Problem: Operations like commit + push could fail mid-operation leaving inconsistent state
- Blocks: Users may have partial commits if operation interrupted
- Priority: Low - rare edge case but data consistency concern

## Test Coverage Gaps

**Git Command Parsing:**
- What's not tested: git status/diff output parsing, branch listing, commit history
- Files: `server/routes/git.js`, `src/components/GitPanel.jsx`
- Risk: Changes in git versions or corrupted output could break silently
- Priority: High - core feature with high failure surface

**WebSocket Connection Management:**
- What's not tested: Client disconnects, reconnections, session resumption, timeout handling
- Files: `server/index.js:906-1100` (handleShellConnection), PTY session management
- Risk: Connection issues could hang sessions or leak resources undetected
- Priority: High - production stability concern

**Path Validation Security:**
- What's not tested: Symlink attacks, path traversal attempts, edge cases with .. and ./
- Files: `server/index.js:570-590` (file read), `server/index.js:611-615` (binary serve)
- Risk: Security vulnerability if path validation fails
- Priority: Critical - security concern

**Project Discovery Edge Cases:**
- What's not tested: Corrupted .jsonl files, missing cwd field, moved/deleted projects, permission denied
- Files: `server/projects.js` (extractProjectDirectory, parseJsonlSessions)
- Risk: Project list could become unreliable or crash on corrupted data
- Priority: Medium - data resilience concern

**Settings State Synchronization:**
- What's not tested: Concurrent setting updates, form validation, API error handling, unsaved changes
- Files: `src/components/Settings.jsx` (27 useState hooks across multiple sections)
- Risk: Settings could be lost or saved inconsistently
- Priority: Medium - data integrity concern

**MCP Server Configuration:**
- What's not tested: Malformed config detection, missing required fields, invalid command/URL formats
- Files: `server/utils/mcp-detector.js`, `src/components/settings/McpServersContent.jsx`
- Risk: Invalid configs could crash MCP server spawning or create security vulnerabilities
- Priority: Medium - operational stability concern

**Error Recovery in Long-Running Operations:**
- What's not tested: Timeout handling, abort handling, cleanup after failures in git operations, file operations
- Files: `src/components/GitPanel.jsx` (git operations), `server/index.js` (file operations)
- Risk: Failed operations could leave UI in broken state or consume resources
- Priority: Medium - UX and stability concern

---

*Concerns audit: 2026-01-24*
