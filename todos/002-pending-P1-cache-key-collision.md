---
id: "002"
title: "Cache key collision vulnerability"
priority: P1
category: security
status: pending
created: 2024-01-29
source: code-review
files:
  - server/services/permissionManager.js
---

# Cache Key Collision Vulnerability

## Problem
The `getCacheKey` function (lines 312-334) generates keys by concatenating tool name and stringified input. Malicious input could craft collisions like:
- Tool: "read" + Input: {"file": "a|write"}
- Tool: "read|write" + Input: {"file": "a"}

These could result in the same cache key, allowing permission bypass.

## Location
- `server/services/permissionManager.js:312-334` - `getCacheKey` function

## Risk
- **Severity**: CRITICAL
- **Impact**: Permission bypass through key collision
- **Attack Vector**: Crafted tool names or inputs

## Recommended Fix
Use a cryptographic hash or structured serialization:

```javascript
getCacheKey(toolName, input) {
  const normalized = JSON.stringify({
    tool: toolName,
    input: input
  });
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
```

Or use a delimiter that cannot appear in tool names:
```javascript
getCacheKey(toolName, input) {
  const inputStr = JSON.stringify(input);
  return `${toolName}\x00${inputStr}`; // NULL byte delimiter
}
```
