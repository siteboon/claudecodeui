---
id: "006"
title: "Session cache never cleaned"
priority: P1
category: performance
status: pending
created: 2024-01-29
source: code-review
files:
  - server/services/permissionManager.js
---

# Session Cache Never Cleaned

## Problem
The `sessionPermissions` Map stores permission decisions indefinitely. There's no mechanism to:
1. Clear permissions when a session ends
2. Expire old permission decisions
3. Limit total cache size

This leads to unbounded memory growth proportional to unique sessions × tools used.

## Location
- `server/services/permissionManager.js:33` - `this.sessionPermissions = new Map()`

## Risk
- **Severity**: CRITICAL
- **Impact**: Memory exhaustion in long-running server
- **Growth Rate**: Linear with session count

## Recommended Fix
Implement LRU cache with TTL:

```javascript
import LRU from 'lru-cache';

// In constructor
this.sessionPermissions = new LRU({
  max: 10000, // Max entries
  ttl: 1000 * 60 * 60, // 1 hour TTL
  updateAgeOnGet: true
});

// Or manual TTL tracking
this.sessionPermissions = new Map();
this.permissionTimestamps = new Map();

setSessionPermission(key, value) {
  this.sessionPermissions.set(key, value);
  this.permissionTimestamps.set(key, Date.now());
}

// Periodic cleanup
cleanExpiredPermissions() {
  const cutoff = Date.now() - PERMISSION_TTL;
  for (const [key, timestamp] of this.permissionTimestamps) {
    if (timestamp < cutoff) {
      this.sessionPermissions.delete(key);
      this.permissionTimestamps.delete(key);
    }
  }
}
```
