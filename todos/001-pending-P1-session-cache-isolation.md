---
id: "001"
title: "Session cache isolation vulnerability"
priority: P1
category: security
status: pending
created: 2024-01-29
source: code-review
files:
  - server/services/permissionManager.js
---

# Session Cache Isolation Vulnerability

## Problem
The `sessionPermissions` cache in `permissionManager.js` (line 33) is a single shared Map across all users/sessions. This means permission decisions from one session could theoretically leak to or be overwritten by another session if there's any cache key collision.

## Location
- `server/services/permissionManager.js:33` - `this.sessionPermissions = new Map();`

## Risk
- **Severity**: CRITICAL
- **Impact**: Permission decisions could leak across sessions
- **CVSS**: High (confidentiality + integrity impact)

## Recommended Fix
Add session isolation by either:
1. Prefix cache keys with a unique session identifier
2. Use nested Maps: `sessionId -> (toolKey -> permission)`
3. Move session permissions to per-session storage

## Code Example
```javascript
// Current (vulnerable)
this.sessionPermissions = new Map();

// Fixed: Nested Map approach
this.sessionPermissions = new Map(); // sessionId -> Map<toolKey, permission>

getSessionPermission(sessionId, toolKey) {
  const sessionCache = this.sessionPermissions.get(sessionId);
  return sessionCache?.get(toolKey);
}
```
