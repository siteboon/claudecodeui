---
id: "024"
title: "Magic numbers and strings"
priority: P3
category: patterns
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - server/services/permissionManager.js
  - server/services/permissionWebSocketHandler.js
---

# Magic Numbers and Strings

## Problem
Hard-coded values scattered throughout:

1. **Numbers**:
   - `100` - localStorage history limit (line 27-28)
   - `30000` - Heartbeat interval
   - `100` - Message queue limit

2. **Strings**:
   - `'mock-'` - Mock request prefix
   - `'permissionHistory'` - localStorage key
   - Message type strings duplicated

## Locations
- `src/hooks/usePermissions.js:27-28` - History limit
- `server/services/permissionWebSocketHandler.js:304-306` - Queue limit
- `server/services/permissionWebSocketHandler.js:358` - Heartbeat interval

## Risk
- **Severity**: LOW
- **Impact**: Maintenance, inconsistency
- **Fix Complexity**: Low

## Recommended Fix
Extract to constants:

```javascript
// constants/permission.js
export const PERMISSION_CONSTANTS = {
  // Limits
  MAX_HISTORY_ENTRIES: 100,
  MAX_QUEUED_MESSAGES: 100,

  // Timeouts (ms)
  PERMISSION_TIMEOUT: 30000,
  HEARTBEAT_INTERVAL: 30000,
  RECONNECT_BASE_DELAY: 1000,
  RECONNECT_MAX_DELAY: 30000,

  // Storage keys
  STORAGE_KEYS: {
    HISTORY: 'permissionHistory',
    PENDING: 'pendingPermissions',
    SESSION: 'sessionPermissions',
    PERMANENT: 'permanentPermissions'
  },

  // Prefixes
  MOCK_REQUEST_PREFIX: 'mock-'
};
```
