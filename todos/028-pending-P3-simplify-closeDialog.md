---
id: "028"
title: "closeDialog sends deny unconditionally"
priority: P3
category: ux
status: pending
created: 2024-01-29
source: code-review
files:
  - src/hooks/usePermissions.js
---

# closeDialog Sends Deny Unconditionally

## Problem
When user closes dialog via X button (line 257-266), it automatically sends DENY:
- User might just want to defer decision
- No way to "snooze" or "remind later"
- Closing accidentally = denied

## Location
- `src/hooks/usePermissions.js:257-266` - `closeDialog` function

## Risk
- **Severity**: LOW
- **Impact**: User experience, accidental denials
- **Fix Complexity**: Low-Medium

## Recommended Fix
Consider alternative behaviors:

**Option 1: Confirm before deny**
```javascript
const closeDialog = useCallback(() => {
  if (currentRequest) {
    const confirmed = window.confirm(
      'Close will deny this permission. Continue?'
    );
    if (confirmed) {
      handleDialogDecision(currentRequest.id, PERMISSION_DECISIONS.DENY);
    }
  } else {
    setIsDialogOpen(false);
  }
}, [currentRequest, handleDialogDecision]);
```

**Option 2: Add minimize/defer option**
```javascript
const deferRequest = useCallback(() => {
  setIsDialogOpen(false);
  // Request stays in queue, will show again later
}, []);
```

**Option 3: Make behavior configurable**
```javascript
const closeDialog = useCallback((options = { sendDeny: true }) => {
  if (currentRequest && options.sendDeny) {
    handleDialogDecision(currentRequest.id, PERMISSION_DECISIONS.DENY);
  }
  setIsDialogOpen(false);
  setCurrentRequest(null);
}, [currentRequest, handleDialogDecision]);
```
