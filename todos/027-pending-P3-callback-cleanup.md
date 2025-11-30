---
id: "027"
title: "Response callbacks not cleaned up"
priority: P3
category: performance
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
---

# Response Callbacks Not Cleaned Up

## Problem
`responseCallbacksRef` (line 43) stores callbacks but they're only deleted when:
1. A response is successfully sent
2. The callback is executed

If a request times out or is cancelled without going through `sendPermissionResponse`, the callback remains in the Map forever.

## Location
- `src/hooks/usePermissions.js:43` - `responseCallbacksRef = useRef(new Map())`
- `src/hooks/usePermissions.js:211-214` - Callback execution and deletion

## Risk
- **Severity**: LOW
- **Impact**: Minor memory leak, stale callbacks
- **Fix Complexity**: Low

## Recommended Fix
Clean up callbacks on timeout/cancel:

```javascript
// Add cleanup in timeout handler
if (message.type === WS_MESSAGE_TYPES.PERMISSION_TIMEOUT) {
  const reqId = message.requestId || message.id;

  // Clean up callback
  const callback = responseCallbacksRef.current.get(reqId);
  if (callback) {
    callback({ decision: 'timeout', error: 'Request timed out' });
    responseCallbacksRef.current.delete(reqId);
  }

  // ... rest of timeout handling
}

// Add periodic cleanup for very old callbacks
useEffect(() => {
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, data] of responseCallbacksRef.current) {
      if (data.timestamp && now - data.timestamp > CALLBACK_TTL) {
        responseCallbacksRef.current.delete(id);
      }
    }
  }, CLEANUP_INTERVAL);

  return () => clearInterval(cleanup);
}, []);
```
