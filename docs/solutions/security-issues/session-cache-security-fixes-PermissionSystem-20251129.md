# Session Cache Security and Memory Leak Fixes

## Metadata

```yaml
module: Permission System
date: 2025-11-29
problem_type: security_issue
component: nodejs_service
symptoms:
  - "Session permission cache shared globally across all sessions"
  - "Cache key collisions due to colon separator in keys"
  - "Memory leaks in Maps without bounds or TTL"
  - "Missing authorization checks on permission responses"
  - "Incorrect timeout constant (30000000ms instead of 30000ms)"
root_cause: multiple_security_vulnerabilities
severity: critical
tags: [security, memory-leak, session-isolation, permission-system, cache]
```

## Problem Summary

The permission persistence feature implemented for Claude Code UI had multiple security and performance vulnerabilities identified through comprehensive 6-agent code review.

## Symptoms

1. **Session Cache Not Isolated**: Permission decisions cached with `allow-session` were stored globally, not per-session, allowing one session to access another's cached permissions
2. **Cache Key Collisions**: Using `:` as separator in cache keys could cause collisions (e.g., `Read:file:path` vs `Read:file` with input `path`)
3. **Memory Leaks**: Maps grew unbounded without TTL or size limits
4. **Missing Auth Checks**: No verification that the client responding to a permission request owned that session
5. **Timeout Bug**: `PERMISSION_TIMEOUT_MS` was set to 30000000ms (~8.3 hours) instead of 30000ms (30 seconds)

## Investigation

A comprehensive 6-agent parallel code review was performed:
- Security Sentinel: Found 8 vulnerabilities (2 CRITICAL, 2 HIGH)
- Performance Oracle: Found 12 issues (2 CRITICAL, 4 HIGH)
- Architecture Strategist: Multiple architectural concerns
- Pattern Recognition: Code duplication and anti-patterns
- Data Integrity Guardian: 8 critical data handling issues
- Code Simplicity Reviewer: 25-30% potential code reduction

## Root Cause

Multiple interconnected issues:

1. **Session cache used wrong API**: Line 193-194 in `permissionManager.js` called `this.sessionPermissions.set(cacheKey, decision)` without the sessionId, making it global
2. **Cache key separator choice**: Using `:` which appears in file paths caused ambiguous keys
3. **No cache eviction**: Maps only grew, never shrank
4. **Broadcast model**: Permission requests broadcast to all clients without session ownership tracking
5. **Typo in constant**: Extra zeros in timeout value

## Solution

### 1. Session Cache Isolation (CRITICAL)

**Before:**
```javascript
// Handle session-level caching
if (decision === PermissionDecision.ALLOW_SESSION) {
  const cacheKey = this.getSessionCacheKey(request.toolName, request.input);
  this.sessionPermissions.set(cacheKey, decision);  // WRONG: global cache
}
```

**After:**
```javascript
// Handle session-level caching (properly isolated per session)
if (decision === PermissionDecision.ALLOW_SESSION && request.sessionId) {
  const cacheKey = this.getSessionCacheKey(request.toolName, request.input);
  this.setSessionPermission(request.sessionId, cacheKey, decision);  // Correct: per-session
}
```

### 2. Cache Key Collision Fix

**Before:**
```javascript
return keyParts.join(':');  // Ambiguous with file paths
```

**After:**
```javascript
return keyParts.join('\x00');  // Null character - never appears in legitimate input
```

### 3. TTL and LRU Eviction

Added cache configuration and proper session permission methods:

```javascript
// Cache configuration
this.maxSessionCacheEntries = 1000;
this.sessionCacheTTL = 60 * 60 * 1000; // 1 hour

getSessionPermission(sessionId, cacheKey) {
  const sessionCache = this.sessionPermissions.get(sessionId);
  if (!sessionCache) return null;

  const entry = sessionCache.get(cacheKey);
  if (!entry) return null;

  // Check TTL expiration
  if (Date.now() - entry.timestamp > this.sessionCacheTTL) {
    sessionCache.delete(cacheKey);
    return null;
  }

  return entry.decision;
}

setSessionPermission(sessionId, cacheKey, permission) {
  let sessionCache = this.sessionPermissions.get(sessionId);
  if (!sessionCache) {
    sessionCache = new Map();
    this.sessionPermissions.set(sessionId, sessionCache);
  }

  // Evict oldest entries if cache is full (simple LRU approximation)
  if (sessionCache.size >= this.maxSessionCacheEntries) {
    const oldestKey = sessionCache.keys().next().value;
    sessionCache.delete(oldestKey);
  }

  sessionCache.set(cacheKey, { decision: permission, timestamp: Date.now() });
}
```

### 4. Authorization Checks on Responses

```javascript
handlePermissionResponse(clientId, message, permissionManager = null) {
  // Verify the client actually has this request pending
  if (!client.pendingRequests.has(message.requestId)) {
    console.warn(`Client ${clientId} sent response for non-pending request`);
    this.sendError(clientId, message.requestId, 'Request not found');
    return;
  }

  // Verify session ownership
  if (permissionManager) {
    const request = permissionManager.pendingRequests.get(message.requestId);
    if (request?.sessionId && client.sessionId && request.sessionId !== client.sessionId) {
      console.warn(`Client attempted to respond to request from different session`);
      this.sendError(clientId, message.requestId, 'Unauthorized: session mismatch');
      return;
    }
  }
}
```

### 5. Timeout Constant Fix

```javascript
// Before
export const PERMISSION_TIMEOUT_MS = 30000000; // ~8.3 hours (BUG!)

// After
export const PERMISSION_TIMEOUT_MS = 30000; // 30 seconds (correct)
```

### 6. JSON Deserialization Validation

```javascript
export function getPendingRequests(sessionId) {
  try {
    const requests = JSON.parse(stored);

    // Validate the parsed data is an array
    if (!Array.isArray(requests)) {
      console.warn('Invalid permission storage format, clearing');
      sessionStorage.removeItem(key);
      return [];
    }

    // Filter and validate each request
    return requests.filter(r => {
      if (!r || typeof r !== 'object') return false;
      if (!r.id || typeof r.id !== 'string') return false;
      if (typeof r.timestamp !== 'number') return false;
      return Date.now() - r.timestamp < REQUEST_TTL_MS;
    });
  } catch (e) {
    console.warn('Failed to parse permission storage:', e);
    sessionStorage.removeItem(key);
    return [];
  }
}
```

## Files Changed

- `server/services/permissionManager.js` - Session cache isolation, TTL, LRU eviction
- `server/services/permissionWebSocketHandler.js` - Auth checks, memory bounds
- `server/services/permissionTypes.js` - Timeout constant fix
- `src/utils/permissionStorage.js` - JSON validation, removed unused exports
- `src/hooks/usePermissions.js` - Removed unused analytics code

## Prevention

1. **Code Review Checklist**: Always verify session-scoped data uses session ID as key
2. **Cache Key Design**: Use non-printable separators (null char) for compound keys
3. **Memory Management**: All Maps/caches need TTL and/or size limits
4. **Security Review**: Any client-initiated action needs ownership verification
5. **Constant Validation**: Double-check time constants for correct magnitude

## Verification

- Build passes: `npm run build` succeeds
- No TypeScript/ESLint errors
- Commits created with descriptive messages

## Related Issues

- 28 todo files created in `todos/` directory documenting all findings
- Part of persistent-permissions branch feature implementation
