---
id: "003"
title: "Unsanitized JSON deserialization"
priority: P1
category: security
status: pending
created: 2024-01-29
source: code-review
files:
  - src/utils/permissionStorage.js
  - src/hooks/usePermissions.js
---

# Unsanitized JSON Deserialization

## Problem
Multiple locations use `JSON.parse()` without validation on sessionStorage data:
- `permissionStorage.js` - `getPendingRequests()`, `getSessionPermissions()`
- `usePermissions.js` - `getPermissionStats()` (line 295)

If an attacker can inject malicious data into sessionStorage (via XSS or other means), parsed objects could contain prototype pollution payloads.

## Locations
- `src/utils/permissionStorage.js:31` - `JSON.parse(stored)`
- `src/utils/permissionStorage.js:71` - `JSON.parse(stored)`
- `src/hooks/usePermissions.js:295` - `JSON.parse(localStorage.getItem(...))`

## Risk
- **Severity**: HIGH
- **Impact**: Prototype pollution, code execution
- **Prerequisite**: XSS or direct storage access

## Recommended Fix
Validate parsed JSON structure before use:

```javascript
function safeParse(json, validator) {
  try {
    const parsed = JSON.parse(json);
    if (!validator(parsed)) {
      console.warn('Invalid data structure in storage');
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Usage
const requests = safeParse(stored, (data) =>
  Array.isArray(data) && data.every(r =>
    typeof r.id === 'string' && typeof r.tool === 'string'
  )
);
```
