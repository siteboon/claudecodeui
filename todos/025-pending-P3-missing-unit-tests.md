---
id: "025"
title: "Missing unit tests"
priority: P3
category: testing
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - src/contexts/PermissionContext.jsx
  - src/utils/permissionStorage.js
  - server/services/permissionManager.js
---

# Missing Unit Tests

## Problem
No test files found for the permission system:
- `usePermissions.test.js` - Missing
- `PermissionContext.test.jsx` - Missing
- `permissionStorage.test.js` - Missing
- `permissionManager.test.js` - Missing

Given the critical nature of permissions, this is a significant gap.

## Risk
- **Severity**: LOW (for now, HIGH for future changes)
- **Impact**: Regression risk, refactoring fear
- **Fix Complexity**: Medium-High

## Recommended Tests

**1. permissionStorage.test.js**
```javascript
describe('permissionStorage', () => {
  beforeEach(() => sessionStorage.clear());

  test('savePendingRequest stores request correctly', () => { ... });
  test('getPendingRequests returns empty array when no data', () => { ... });
  test('removePendingRequest removes correct request', () => { ... });
  test('handles JSON parse errors gracefully', () => { ... });
});
```

**2. usePermissions.test.js**
```javascript
describe('usePermissions', () => {
  test('sends sync request on connection', () => { ... });
  test('handles WS permission request', () => { ... });
  test('auto-approves based on session permissions', () => { ... });
  test('shows dialog for manual approval', () => { ... });
  test('sends correct response on decision', () => { ... });
});
```

**3. permissionManager.test.js**
```javascript
describe('PermissionManager', () => {
  test('queues permission request', () => { ... });
  test('resolves permission with callback', () => { ... });
  test('times out after configured interval', () => { ... });
  test('tracks requests by session', () => { ... });
});
```
