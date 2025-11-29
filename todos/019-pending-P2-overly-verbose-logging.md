---
id: "019"
title: "Overly verbose logging"
priority: P2
category: simplification
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
  - server/services/permissionManager.js
  - server/services/permissionWebSocketHandler.js
---

# Overly Verbose Logging

## Problem
Extensive console.log statements throughout the permission system:
- Emojis in production logs (🔄, 📥, 📤, ⚡, etc.)
- Logging same event multiple times at different layers
- No log level filtering (debug vs info vs error)

This causes:
- Console noise in production
- Performance impact from string formatting
- Difficulty finding important logs

## Locations
- `src/hooks/usePermissions.js` - ~15 console.log statements
- `server/services/permissionManager.js` - Multiple logs
- `server/services/permissionWebSocketHandler.js` - Multiple logs

## Risk
- **Severity**: LOW-MEDIUM
- **Impact**: Debugging noise, minor performance
- **Fix Complexity**: Low

## Recommended Fix
Implement proper logging:

```javascript
// Create logger utility
const createLogger = (module) => ({
  debug: (...args) => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[${module}]`, ...args);
    }
  },
  info: (...args) => console.log(`[${module}]`, ...args),
  warn: (...args) => console.warn(`[${module}]`, ...args),
  error: (...args) => console.error(`[${module}]`, ...args),
});

// Usage
const log = createLogger('PermissionManager');

log.debug('Processing request:', requestId); // Only in debug mode
log.info('Permission granted:', requestId);  // Always
log.error('Failed to process:', error);      // Always
```
