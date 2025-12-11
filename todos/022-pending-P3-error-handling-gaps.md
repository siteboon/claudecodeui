---
id: "022"
title: "Error handling gaps"
priority: P3
category: reliability
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - server/services/permissionManager.js
---

# Error Handling Gaps

## Problem
Several error scenarios are not handled gracefully:

1. **Storage errors** (lines 96-98):
   `savePendingRequest` failures are silent

2. **WebSocket send failures** (line 205):
   Logged but not recovered

3. **Missing request in handleDecision**:
   No specific error for request-not-found

4. **Backend timeout callback errors**:
   Could leave request in limbo

## Locations
- `src/hooks/usePermissions.js:96-98` - Storage save
- `src/hooks/usePermissions.js:205-224` - WS response send
- `server/services/permissionManager.js` - Various handlers

## Risk
- **Severity**: LOW
- **Impact**: Silent failures, debugging difficulty
- **Fix Complexity**: Low

## Recommended Fix
Add comprehensive error handling:

```javascript
// Storage with error handling
const safeStorageOp = (operation, fallback = null) => {
  try {
    return operation();
  } catch (error) {
    console.error('Storage operation failed:', error);
    // Optionally notify user
    return fallback;
  }
};

// Usage
safeStorageOp(() => savePendingRequest(sessionId, request));

// WebSocket with retry
const sendWithRetry = async (message, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await wsClient.send(message);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await delay(1000 * Math.pow(2, i));
    }
  }
};

// Explicit error states
if (!request) {
  throw new PermissionError('REQUEST_NOT_FOUND', `Request ${id} not found`);
}
```
