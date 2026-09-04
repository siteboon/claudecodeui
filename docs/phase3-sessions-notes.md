# Phase 3 Implementation Notes: ZCode Sessions + Synchronizer + Watcher

## Overview
This document provides implementation notes for Phase 3 of the ZCode integration plan, which implements session history provider, session synchronizer, and watcher integration components.

## Completed Components

### 1. Session History Provider (`zcode-sessions.provider.ts`)

**Location:** `/Users/azrael/workspaces/cloudcli/server/modules/providers/list/zcode/zcode-sessions.provider.ts`

**Key Features:**
- Implements `IProviderSessions` interface for ZCode provider
- Read-only SQLite connection to `~/.zcode/cli/db/db.sqlite`
- Proper pagination with LIMIT/OFFSET via `sliceTailPage` utility
- Joins `message` and `part` tables for complete message content
- Uses existing `sequence` column and `message_session_time_created_id_idx` index

**Implementation Details:**

#### SQLite Integration
```typescript
function getZCodeDatabasePath(): string {
  return path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
}

function openZCodeDatabase(): Database.Database | null {
  const dbPath = getZCodeDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    return null;
  }
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}
```

#### Message Normalization
The `normalizeMessage()` method handles both:
- **Online sources:** Live protocol events from app-server
- **Offline sources:** Historical SQLite rows from database

Event mapping follows the §4 normalization table:
- `stream_delta` → `kind:'stream_delta'` with text content
- `text` → `kind:'text'` with role classification
- `thinking/reasoning` → `kind:'thinking'`
- `tool_use/tool` → `kind:'tool_use'` with toolName/toolInput/toolId
- `complete/done` → `kind:'complete'` with token usage
- `error/fatal` → `kind:'error'`

#### Sub-Agent Filtering
Sessions starting with `sess_subagent_agent_*` are filtered out as required:
```typescript
if (sessionId.startsWith('sess_subagent_agent_')) {
  return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
}
```

#### Token Usage Aggregation
Token counts are extracted from `message.data.tokens`:
```typescript
{
  input: number,
  output: number, 
  reasoning: number,
  cache: { read: number, write: number }
}
```

Aggregated across all messages in a session for complete usage statistics.

### 2. Session Synchronizer (`zcode-session-synchronizer.provider.ts`)

**Location:** `/Users/azrael/workspaces/cloudcli/server/modules/providers/list/zcode/zcode-session-synchronizer.provider.ts`

**Key Features:**
- Implements `IProviderSessionSynchronizer` interface
- Read-only SQLite access with strict connection discipline
- High-water mark tracking for efficient incremental synchronization
- Filters sub-agent sessions and parent-child relationships
- Uses ZCode's pre-generated titles directly

**SQLite Access Discipline:**
- **Mode:** `{ readonly: true, fileMustExist: true }`
- **Connection lifetime:** Short-lived, closed immediately after query
- **Transactions:** Never holds write transactions to avoid lock conflicts
- **Error handling:** Graceful degradation with null returns on failures

**Synchronization Logic:**

#### Full Synchronization (`synchronize()`)
```sql
SELECT s.id, s.directory, s.title, s.time_created, s.time_updated
FROM session s
WHERE s.parent_id IS NULL
  AND s.id NOT LIKE 'sess_subagent_agent_%'
  AND (? IS NULL OR s.time_updated > ?)
ORDER BY s.time_updated DESC, s.id DESC
```

#### File-Based Synchronization (`synchronizeFile()`)
Adapted from file-based API to handle SQLite database-level changes:
- Monitors `db.sqlite` and `db.sqlite-wal` files
- Uses high-water mark for incremental sync
- Limited to 100 most recent sessions to handle WAL write frequency
- Relies on existing 500ms/2s debouncing in watcher service

**High-Water Mark Tracking:**
```typescript
private highWaterMarkTimeUpdated: number = 0;

// Updated after each successful sync
if (timeUpdated > this.highWaterMarkTimeUpdated) {
  this.highWaterMarkTimeUpdated = timeUpdated;
}
```

### 3. Watcher Integration (`sessions-watcher.service.ts`)

**Location:** `/Users/azrael/workspaces/cloudcli/server/modules/providers/services/sessions-watcher.service.ts`

**Changes Made:**

#### Added to `PROVIDER_WATCH_PATHS`:
```typescript
{
  provider: 'zcode',
  rootPath: path.join(os.homedir(), '.zcode', 'cli', 'db'),
}
```

#### Updated `isWatcherTargetFile` function:
```typescript
if (provider === 'zcode') {
  const fileName = path.basename(filePath);
  return fileName === 'db.sqlite' || fileName === 'db.sqlite-wal';
}
```

**Rationale:**
- Primary target: `db.sqlite` (main database file)
- Secondary target: `db.sqlite-wal` (write-ahead log for performance)
- Existing debouncing absorbs high-frequency WAL writes
- Both files trigger incremental sync via high-water mark

## Technical Architecture

### Database Schema Utilization
ZCode's SQLite schema (from spike validation):
```sql
-- Session metadata
session(id, project_id, parent_id, title, title_source, directory, 
        task_type, time_created, time_updated, ...)

-- Message data  
message(id, session_id, data, sequence, ...)

-- Message parts (text, tool calls, etc.)
part(id, session_id, message_id, data, time_created, ...)
```

### Index Usage
The implementation leverages existing indexes:
- `message_session_time_created_id_idx` for time-based queries
- `sequence` column for message ordering
- Primary key indexes for session lookups

### Concurrency Strategy
- **Read-only access** prevents lock conflicts
- **Short connections** minimize lock holding time  
- **No transactions** avoids write transaction conflicts
- **Graceful failures** return empty results rather than throwing

## Integration Points

### 1. Type System Updates
The `LLMProvider` type in `/Users/azrael/workspaces/cloudcli/server/shared/types.ts` includes:
```typescript
export type LLMProvider = 'claude' | 'codex' | 'cursor' | 'opencode' | 'zcode';
```

This type change propagates through:
- Provider registry (`provider.registry.ts`)
- Route validation (`provider.routes.ts`)
- Type-safe provider-specific operations

### 2. Provider Integration Pattern
Following the existing `opencode` provider pattern:
- Shared utilities from `server/shared/utils.ts`
- Database operations through `sessionsDb` service
- Watcher events via `sessions-watcher.service`
- Read-only SQLite with better-sqlite3

### 3. Session Mapping Strategy
Session ID mapping preserves relationships:
- **App-created sessions:** App ID → Provider ID mapping via `provider_session_id`
- **Provider-created sessions:** Direct Provider ID usage
- **Pending sessions:** Bound via `findLatestPendingAppSession()`

## Performance Considerations

### Query Optimization
1. **Pagination:** Server-side LIMIT/OFFSET pushed to SQLite
2. **Index usage:** Time-based queries use `message_session_time_created_id_idx`
3. **Filtering:** Sub-agent sessions filtered at SQL level
4. **Incremental sync:** High-water mark reduces query scope

### Memory Management
1. **Connection pooling:** Short-lived connections, no persistent handles
2. **Result streaming:** Large result sets processed row-by-row
3. **Pagination:** `sliceTailPage` prevents loading entire history

### Concurrency Safety
1. **Read-only mode:** Prevents write lock conflicts
2. **Short transactions:** Minimizes lock holding time
3. **Error isolation:** Individual query failures don't crash sync process

## Testing Recommendations

### Unit Test Coverage
```typescript
// Test database path resolution
expect(getZCodeDatabasePath()).toBe('~/zcode/cli/db/db.sqlite');

// Test sub-agent filtering  
const subAgentId = 'sess_subagent_agent_123';
const result = await provider.fetchHistory(subAgentId);
expect(result.messages).toEqual([]);

// Test message normalization
const rawEvent = { type: 'tool_use', tool: 'Read', input: { path: '/tmp' } };
const normalized = provider.normalizeMessage(rawEvent, 'sess_123');
expect(normalized[0].kind).toBe('tool_use');

// Test SQLite error handling
const result = await provider.fetchHistory('nonexistent');
expect(result).toHaveProperty('messages', []);
```

### Integration Test Scenarios
1. **Full sync:** Verify session discovery and database updates
2. **Incremental sync:** Test high-water mark tracking efficiency
3. **Watcher integration:** Verify file change detection and sync triggers
4. **Concurrent access:** Test with ZCode CLI running simultaneously
5. **Error recovery:** Test graceful handling of locked/missing database

## Deployment Notes

### Prerequisites
1. **ZCode installation:** Desktop App 3.7.7+ with embedded CLI 0.16.3+
2. **Database location:** Default `~/.zcode/cli/db/db.sqlite`
3. **File permissions:** Read access to ZCode data directory

### Configuration
No additional configuration required - uses default ZCode paths:
- Database: `~/.zcode/cli/db/db.sqlite`
- Watcher path: `~/.zcode/cli/db/`

### Monitoring
Key log messages for operational visibility:
```typescript
'[ZCodeProvider] Failed to open database:'
'[ZCodeProvider] Failed to synchronize sessions:'
'[ZCodeProvider] Failed to load session ${sessionId}:'
'Session synchronization triggered by ${eventType} event for provider "zcode"'
```

## Known Limitations

### Current Scope
1. **Read-only access:** No database modifications
2. **SQLite dependency:** Requires ZCode database to exist
3. **Platform support:** macOS/Linux (Windows paths pending validation)
4. **Sub-agent visibility:** Sub-agent sessions filtered from history

### Future Enhancements
1. **Windows support:** Validate `%LOCALAPPDATA%\Programs\ZCode\` paths
2. **Sub-agent history:** Optional sub-agent session inclusion
3. **Real-time streaming:** Direct protocol event consumption
4. **Token optimization:** Cached token usage calculations

## References

### Related Documentation
- ZCode Integration Plan: `/docs/zcode-integration-plan.md`
- Backend Module Standards: `.agents/skills/backend-module-standards/SKILL.md`
- Coding Agent Integration Guide: `/docs/coding-agent-integration-guide.md`

### Reference Implementations
- OpenCode Provider: `/server/modules/providers/list/opencode/`
- Cursor Provider: `/server/modules/providers/list/cursor/`
- Claude Provider: `/server/modules/providers/list/claude/`

### Database Schema
- Session table structure from spike validation (2026-08-17)
- Message/part table relationships for history loading
- Index definitions for query performance

## Conclusion

Phase 3 successfully implements the core session synchronization infrastructure for ZCode integration. The implementation follows established patterns from existing providers while accommodating ZCode's unique SQLite-based architecture. The read-only access strategy ensures compatibility with running ZCode processes, and the high-water mark tracking enables efficient incremental synchronization.

The components are ready for integration testing with live ZCode installations and can be extended with additional features as needed for production use.