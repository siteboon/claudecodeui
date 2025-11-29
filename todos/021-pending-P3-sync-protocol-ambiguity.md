---
id: "021"
title: "Sync protocol ambiguity"
priority: P3
category: architecture
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - server/services/permissionWebSocketHandler.js
---

# Sync Protocol Ambiguity

## Problem
The `permission-sync-request/response` protocol is loosely defined:
- No schema validation
- Unclear what happens with conflicts
- No versioning for protocol changes
- Missing error cases in documentation

## Locations
- `src/hooks/usePermissions.js:52-63` - Send sync request
- `src/hooks/usePermissions.js:133-164` - Handle sync response
- `server/services/permissionWebSocketHandler.js:133-161` - Server handling

## Risk
- **Severity**: LOW
- **Impact**: Future maintenance, debugging
- **Fix Complexity**: Medium

## Recommended Fix
Define formal protocol:

```javascript
// Protocol definition
const SYNC_PROTOCOL = {
  version: '1.0',

  request: {
    type: 'permission-sync-request',
    sessionId: 'string (required)',
    clientVersion: 'string (optional)',
    lastKnownSequence: 'number (optional)'
  },

  response: {
    type: 'permission-sync-response',
    sessionId: 'string',
    pendingRequests: 'array',
    serverVersion: 'string',
    currentSequence: 'number'
  },

  errors: {
    INVALID_SESSION: 'Session not found',
    VERSION_MISMATCH: 'Protocol version mismatch',
    // ...
  }
};

// Validation
const validateSyncRequest = (message) => {
  if (!message.sessionId) throw new Error('Missing sessionId');
  // ... more validation
};
```
