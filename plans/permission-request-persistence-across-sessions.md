# feat: Permission Request Persistence Across Page Refresh and Sessions

## Overview

Implement persistent permission request state that survives page refreshes and supports switching between sessions while maintaining visibility of each session's pending permission requests.

**Current State:** Permission requests are stored only in React Context (frontend) and in-memory Map (backend). Page refresh loses all pending requests.

**Desired State:** Users can refresh the page and still see pending permission requests. Users can switch between sessions and see each session's pending permissions.

## Problem Statement / Motivation

Currently, when a user refreshes the page while a permission request is pending:
1. The permission dialog disappears
2. The backend PermissionManager still has the request in memory (with a waiting Promise)
3. The user cannot respond to the permission request
4. The tool call eventually times out or hangs

This creates a poor user experience and can cause workflows to fail unexpectedly.

Additionally, users cannot see pending permissions when switching between sessions, making multi-session workflows difficult to manage.

## Proposed Solution

Implement a **hybrid persistence architecture**:
- **Client-side**: sessionStorage for fast UI restoration on refresh
- **Backend**: Add session-aware permission tracking with WebSocket sync on reconnect
- **Synchronization**: WebSocket protocol extensions for state recovery

```
┌─────────────────────────────────────────────────────────────────┐
│                        Page Refresh Flow                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Before Refresh:                                              │
│     ┌──────────────┐     ┌─────────────────────┐                │
│     │ sessionStorage│     │ PermissionManager   │                │
│     │ (requests)   │     │ (in-memory Map)     │                │
│     └──────────────┘     └─────────────────────┘                │
│                                                                  │
│  2. User Refreshes Page                                          │
│                                                                  │
│  3. After Refresh:                                               │
│     ┌──────────────┐     WebSocket      ┌─────────────────────┐ │
│     │ sessionStorage│ ←── Reconnect ──→ │ PermissionManager   │ │
│     │ (restored)   │      + Sync        │ (still has requests)│ │
│     └──────────────┘                    └─────────────────────┘ │
│                                                                  │
│  4. Dialog Reappears with Pending Request                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Technical Approach

### Architecture

#### 1. Storage Strategy

| Data | Storage Location | Purpose |
|------|------------------|---------|
| Pending requests per session | sessionStorage (keyed by sessionId) | Fast UI restore on refresh |
| Backend request state | PermissionManager in-memory Map (existing) | Promise resolution |
| Request validation | WebSocket sync on reconnect | Ensure frontend/backend consistency |

#### 2. State Machine for Permission Requests

```
┌─────────┐    request    ┌─────────┐
│  IDLE   │ ────────────→ │ PENDING │
└─────────┘               └────┬────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ↓                ↓                ↓
        ┌──────────┐    ┌──────────┐    ┌───────────┐
        │ APPROVED │    │  DENIED  │    │  EXPIRED  │
        └──────────┘    └──────────┘    └───────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                               ↓
                         ┌──────────┐
                         │ RESOLVED │
                         └──────────┘
```

### Implementation Phases

#### Phase 1: Frontend Persistence Layer

**Files to modify:**
- `src/contexts/PermissionContext.jsx` - Add sessionStorage persistence
- `src/hooks/usePermissions.js` - Add restore logic on mount
- `src/utils/permissionStorage.js` (new) - Storage utilities

**Key changes:**

```javascript
// src/utils/permissionStorage.js

const STORAGE_KEY_PREFIX = 'claude-ui:permissions:';

export function getPendingRequests(sessionId) {
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  const stored = sessionStorage.getItem(key);
  if (!stored) return [];

  try {
    const requests = JSON.parse(stored);
    return requests.filter(r => !isExpired(r));
  } catch {
    return [];
  }
}

export function savePendingRequest(sessionId, request) {
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  const existing = getPendingRequests(sessionId);
  const updated = [...existing.filter(r => r.id !== request.id), request];
  sessionStorage.setItem(key, JSON.stringify(updated));
}

export function removePendingRequest(sessionId, requestId) {
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  const existing = getPendingRequests(sessionId);
  const updated = existing.filter(r => r.id !== requestId);
  sessionStorage.setItem(key, JSON.stringify(updated));
}

function isExpired(request) {
  const TTL_MS = 60 * 60 * 1000; // 1 hour
  return Date.now() - request.timestamp > TTL_MS;
}
```

#### Phase 2: WebSocket Protocol Extensions

**Files to modify:**
- `server/services/permissionWebSocketHandler.js` - Add sync messages
- `server/services/permissionManager.js` - Add query methods
- `server/index.js` - Wire up new message handlers

**New WebSocket message types:**

```javascript
// Client → Server: Request sync after reconnect
{
  type: 'permission-sync-request',
  sessionId: 'session-uuid'
}

// Server → Client: Current pending requests for session
{
  type: 'permission-sync-response',
  sessionId: 'session-uuid',
  pendingRequests: [
    { id, toolName, input, timestamp, expiresAt }
  ]
}

// Server → Client: Invalidate stale requests
{
  type: 'permission-invalidate',
  requestIds: ['req-1', 'req-2']
}
```

#### Phase 3: Session-Aware Permission State

**Files to modify:**
- `src/contexts/PermissionContext.jsx` - Track current session
- `src/hooks/usePermissions.js` - Load permissions on session switch
- `server/services/permissionManager.js` - Add sessionId to requests

**Key changes:**

```javascript
// PermissionContext.jsx - Track session and restore on switch

function PermissionProvider({ children }) {
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);

  useEffect(() => {
    if (!currentSessionId) return;

    const restored = getPendingRequests(currentSessionId);
    setPendingRequests(restored);

    if (wsClient?.connected) {
      wsClient.send({
        type: 'permission-sync-request',
        sessionId: currentSessionId
      });
    }
  }, [currentSessionId]);

  // Handle sync response from backend
  const handleSyncResponse = useCallback((message) => {
    if (message.type === 'permission-sync-response') {
      const serverRequests = message.pendingRequests || [];
      const localRequests = getPendingRequests(message.sessionId);

      const merged = mergeRequests(serverRequests, localRequests);
      setPendingRequests(merged);
    }
  }, []);
}
```

#### Phase 4: Backend Session Tracking

**Files to modify:**
- `server/services/permissionManager.js` - Add session grouping
- `server/claude-sdk.js` - Pass sessionId to permission requests

**Key changes:**

```javascript
// permissionManager.js - Track requests by session

class PermissionManager extends EventEmitter {
  constructor() {
    super();
    this.pendingRequests = new Map();
    this.requestsBySession = new Map(); // sessionId → Set<requestId>
  }

  addRequest(id, toolName, input, sessionId, abortSignal = null) {
    // ... existing logic ...

    if (!this.requestsBySession.has(sessionId)) {
      this.requestsBySession.set(sessionId, new Set());
    }
    this.requestsBySession.get(sessionId).add(id);
  }

  getRequestsForSession(sessionId) {
    const requestIds = this.requestsBySession.get(sessionId) || new Set();
    return Array.from(requestIds)
      .map(id => this.pendingRequests.get(id))
      .filter(Boolean);
  }
}
```

## Acceptance Criteria

### Functional Requirements

- [ ] **Page refresh preserves permission dialogs**: User refreshes page → pending permission dialog reappears
- [ ] **Session switching shows correct permissions**: Switch from Session A to B → see Session B's permissions (if any)
- [ ] **New permissions appear in correct session**: Permission request arrives → shown only in matching session
- [ ] **Responses work after refresh**: Approve/deny after refresh → backend receives and processes correctly
- [ ] **Expired requests auto-dismissed**: Request older than 1 hour → auto-removed with notification
- [ ] **Stale request detection**: Backend restarts → stale requests detected and cleaned up

### Non-Functional Requirements

- [ ] **Fast restore**: Permissions restore within 100ms of page load
- [ ] **Low storage footprint**: sessionStorage usage < 100KB per session
- [ ] **Graceful degradation**: If storage fails, fall back to memory-only (current behavior)
- [ ] **No duplicate responses**: Multiple windows/retries → only one response processed

### Quality Gates

- [ ] Unit tests for storage utilities
- [ ] Integration tests for WebSocket sync protocol
- [ ] E2E tests for page refresh scenario
- [ ] Manual testing of session switching

## Success Metrics

1. **User Experience**: Zero lost permission requests due to page refresh
2. **Reliability**: <0.1% of permission responses fail due to stale state
3. **Performance**: Permission restore adds <100ms to page load time

## Dependencies & Prerequisites

1. **Current WebSocket infrastructure** - Already exists, needs extensions
2. **sessionStorage availability** - Standard browser API
3. **PermissionManager session awareness** - Needs sessionId passed through

## Risk Analysis & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Race condition on refresh | High | Medium | Optimistic UI + server validation |
| Backend restart loses state | High | Low | Frontend initiates sync, detects stale |
| Storage quota exceeded | Medium | Low | Limit stored requests, expire old ones |
| Multi-window conflicts | Medium | Medium | First-response-wins + sync via localStorage events |

## MVP Implementation

### permissionStorage.js

```javascript
const STORAGE_KEY_PREFIX = 'claude-ui:permissions:';
const REQUEST_TTL_MS = 60 * 60 * 1000;

export function getPendingRequests(sessionId) {
  if (!sessionId) return [];
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return [];
    const requests = JSON.parse(stored);
    return requests.filter(r => Date.now() - r.timestamp < REQUEST_TTL_MS);
  } catch {
    return [];
  }
}

export function savePendingRequest(sessionId, request) {
  if (!sessionId) return;
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  const existing = getPendingRequests(sessionId);
  const updated = [
    ...existing.filter(r => r.id !== request.id),
    { ...request, timestamp: request.timestamp || Date.now() }
  ];
  try {
    sessionStorage.setItem(key, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to persist permission request:', e);
  }
}

export function removePendingRequest(sessionId, requestId) {
  if (!sessionId) return;
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  const existing = getPendingRequests(sessionId);
  const updated = existing.filter(r => r.id !== requestId);
  try {
    sessionStorage.setItem(key, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to update permission storage:', e);
  }
}

export function clearAllRequests(sessionId) {
  if (!sessionId) return;
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  sessionStorage.removeItem(key);
}
```

### PermissionContext.jsx (key additions)

```jsx
import { getPendingRequests, savePendingRequest, removePendingRequest } from '../utils/permissionStorage';

export function PermissionProvider({ children }) {
  const { activeSession } = useSession();
  const sessionId = activeSession?.sessionId;
  const [pendingRequests, setPendingRequests] = useState([]);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setPendingRequests([]);
      setIsRestoring(false);
      return;
    }

    setIsRestoring(true);
    const restored = getPendingRequests(sessionId);
    setPendingRequests(restored);
    setIsRestoring(false);
  }, [sessionId]);

  const addRequest = useCallback((request) => {
    setPendingRequests(prev => {
      const updated = [...prev.filter(r => r.id !== request.id), request];
      savePendingRequest(sessionId, request);
      return updated;
    });
  }, [sessionId]);

  const removeRequest = useCallback((requestId) => {
    setPendingRequests(prev => {
      const updated = prev.filter(r => r.id !== requestId);
      removePendingRequest(sessionId, requestId);
      return updated;
    });
  }, [sessionId]);

  return (
    <PermissionContext.Provider value={{
      pendingRequests,
      addRequest,
      removeRequest,
      isRestoring,
      sessionId
    }}>
      {children}
    </PermissionContext.Provider>
  );
}
```

### permissionWebSocketHandler.js (key additions)

```javascript
handleSyncRequest(clientId, message) {
  const { sessionId } = message;
  if (!sessionId) return;

  const requests = permissionManager.getRequestsForSession(sessionId);
  const formattedRequests = requests.map(r => ({
    id: r.id,
    toolName: r.toolName,
    input: r.input,
    timestamp: r.timestamp,
    expiresAt: r.timestamp + REQUEST_TTL_MS
  }));

  const client = this.clients.get(clientId);
  if (client?.ws) {
    client.ws.send(JSON.stringify({
      type: 'permission-sync-response',
      sessionId,
      pendingRequests: formattedRequests
    }));
  }
}
```

## References

### Internal References
- Permission system entry point: `server/claude-sdk.js:125-197`
- Permission manager: `server/services/permissionManager.js`
- WebSocket handler: `server/services/permissionWebSocketHandler.js`
- Frontend context: `src/contexts/PermissionContext.jsx`
- Permission hook: `src/hooks/usePermissions.js`
- Session management: `server/projects.js`

### External References
- React useEffect patterns: https://react.dev/reference/react/useEffect
- sessionStorage API: https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
- WebSocket reconnection: https://socket.io/docs/v4/client-socket-instance/

### Related Work
- Plan approval implementation: `specs/plan-approval-implementation.md`
- Permission mode refactor: commit `91cddc4`

## Open Questions (To Resolve Before Implementation)

1. **Multi-window sync**: Should permission dialogs sync across browser tabs for the same session?
   - Recommendation: Use localStorage events for cross-tab sync, show in all tabs but disable after first response

2. **Request expiration UX**: How should expired requests be communicated to users?
   - Recommendation: Toast notification "Permission request expired" with option to retry

3. **Batch approval**: Should users be able to approve/deny multiple pending requests at once?
   - Recommendation: Out of scope for MVP, add later if needed
