---
id: "004"
title: "Race condition in permission resolution"
priority: P1
category: security
status: pending
created: 2024-01-29
source: code-review
files:
  - server/services/permissionManager.js
---

# Race Condition in Permission Resolution

## Problem
The permission resolution flow has a TOCTOU (Time-of-Check to Time-of-Use) vulnerability:
1. `getSessionPermission()` checks cache
2. Between check and use, another request could modify the cache
3. Original request proceeds with stale/wrong permission

This is especially risky with concurrent WebSocket connections.

## Location
- `server/services/permissionManager.js` - `checkAutoApproval()` and related methods

## Risk
- **Severity**: HIGH
- **Impact**: Race condition could grant unintended permissions
- **Likelihood**: Medium (requires concurrent requests)

## Recommended Fix
Use atomic operations or locks:

```javascript
async resolvePermission(request) {
  const lockKey = `${request.sessionId}:${request.toolName}`;

  return await this.withLock(lockKey, async () => {
    const cached = this.getSessionPermission(request.sessionId, request.toolName);
    if (cached) return cached;

    // ... permission resolution logic

    this.setSessionPermission(request.sessionId, request.toolName, decision);
    return decision;
  });
}
```

Or use a concurrent-safe data structure with compare-and-swap semantics.
