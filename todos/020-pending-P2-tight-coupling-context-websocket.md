---
id: "020"
title: "Tight coupling between Context and WebSocket"
priority: P2
category: architecture
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - src/contexts/PermissionContext.jsx
  - src/contexts/WebSocketContext.jsx
---

# Tight Coupling Between Context and WebSocket

## Problem
The `usePermissions` hook tightly couples:
1. PermissionContext (UI state)
2. WebSocketContext (transport)
3. Storage utilities (persistence)

This creates:
- Difficult unit testing (must mock multiple systems)
- Hard to swap implementations
- Complex dependency chain

## Locations
- `src/hooks/usePermissions.js` - Imports and couples all three

## Risk
- **Severity**: MEDIUM
- **Impact**: Testing difficulty, maintenance burden
- **Fix Complexity**: Medium-High

## Recommended Fix
Use dependency injection or ports/adapters pattern:

```javascript
// Define interfaces
interface PermissionTransport {
  sendResponse(requestId: string, decision: string): Promise<void>;
  onRequest(callback: (request) => void): void;
}

interface PermissionStorage {
  save(sessionId: string, request: object): void;
  load(sessionId: string): object[];
  remove(sessionId: string, requestId: string): void;
}

// Hook accepts dependencies
const usePermissions = ({
  transport = useDefaultWebSocketTransport(),
  storage = useDefaultStorage(),
  context = usePermission()
} = {}) => {
  // ... implementation using injected dependencies
};

// Easy to test
const { result } = renderHook(() => usePermissions({
  transport: mockTransport,
  storage: mockStorage,
  context: mockContext
}));
```
