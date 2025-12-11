---
id: "023"
title: "Missing TypeScript types"
priority: P3
category: patterns
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - src/contexts/PermissionContext.jsx
  - src/utils/permissionStorage.js
---

# Missing TypeScript Types

## Problem
The permission system uses plain JavaScript without type definitions:
- No interfaces for permission requests/responses
- No type safety for message types
- Easy to pass wrong properties

This is especially problematic given the multiple layers and message passing.

## Locations
- All permission-related files are `.js` / `.jsx`

## Risk
- **Severity**: LOW
- **Impact**: Runtime errors, maintenance difficulty
- **Fix Complexity**: Medium-High (conversion effort)

## Recommended Fix
Either convert to TypeScript or add JSDoc types:

**Option 1: TypeScript conversion**
```typescript
// types/permission.ts
export interface PermissionRequest {
  id: string;
  toolName: string;
  operation: 'execute' | 'read' | 'write';
  input?: Record<string, unknown>;
  timestamp: number;
  sessionId?: string;
}

export type PermissionDecision =
  | 'allow'
  | 'deny'
  | 'allow-session'
  | 'allow-always';

export interface PermissionResponse {
  requestId: string;
  decision: PermissionDecision;
  updatedInput?: Record<string, unknown>;
}
```

**Option 2: JSDoc types**
```javascript
/**
 * @typedef {Object} PermissionRequest
 * @property {string} id
 * @property {string} toolName
 * @property {'execute'|'read'|'write'} operation
 * @property {Object} [input]
 * @property {number} timestamp
 */

/**
 * @param {PermissionRequest} request
 * @returns {void}
 */
const processRequest = (request) => { ... };
```
