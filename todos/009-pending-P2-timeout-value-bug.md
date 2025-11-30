---
id: "009"
title: "Timeout value bug - 30 million ms"
priority: P2
category: bug
status: pending
created: 2024-01-29
source: code-review
files:
  - server/services/permissionManager.js
---

# Timeout Value Bug - 30 Million Milliseconds

## Problem
The `PERMISSION_TIMEOUT_MS` constant appears to be set to `30000000` (30 million ms = 8.3 hours) instead of the intended `30000` (30 seconds).

This means permission requests will never actually timeout in practice, leading to:
- Accumulated pending requests
- Memory leaks
- Poor user experience (stuck requests)

## Location
- `server/services/permissionManager.js` - `PERMISSION_TIMEOUT_MS` constant

## Risk
- **Severity**: HIGH (classified as bug, not security)
- **Impact**: Permissions never timeout, resource accumulation
- **Fix Complexity**: Trivial

## Recommended Fix
```javascript
// Change from
const PERMISSION_TIMEOUT_MS = 30000000; // 8.3 hours (bug!)

// To
const PERMISSION_TIMEOUT_MS = 30000; // 30 seconds (correct)

// Or better, make it configurable
const PERMISSION_TIMEOUT_MS = process.env.PERMISSION_TIMEOUT_MS
  ? parseInt(process.env.PERMISSION_TIMEOUT_MS, 10)
  : 30000;
```
