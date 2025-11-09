# Missing Integration for Interactive Permission System

## Executive Summary
The interactive permission system (Phases 1-3) is **95% complete** but NOT functional due to missing WebSocket message handler in ChatInterface.jsx. All components exist but the critical link between backend permission requests and frontend UI is missing.

## Status Overview

### ✅ COMPLETE: Backend (Phase 1 & 2)
- `server/services/permissionManager.js` - Working permission queue with EventEmitter
- `server/services/permissionTypes.js` - Type definitions and constants
- `server/claude-sdk.js:100-175` - canUseTool callback properly configured
- `server/index.js:811-819` - permission-response handler working
- `server/index.js:1515-1551` - Permission event listeners registered
- WebSocket messages ARE being sent from backend (line 142-148 in claude-sdk.js)

### ✅ COMPLETE: Frontend Components (Phase 3)
- `src/contexts/PermissionContext.jsx` - Context provider with full state management
- `src/hooks/usePermissions.js` - Hook with all permission logic
- `src/components/PermissionDialog.jsx` - Complete dialog UI with keyboard shortcuts
- `src/components/PermissionQueueIndicator.jsx` - Queue indicator component
- `src/components/PermissionRequestCard.jsx` - Request card component
- `src/App.jsx:953-966` - PermissionProvider properly wraps app

### ❌ MISSING: Message Handler Connection
**File**: `src/components/ChatInterface.jsx`
**Location**: Lines 2921-3459 (WebSocket message switch statement)
**Issue**: No case for `'permission-request'` messages

## The Missing Code

In `src/components/ChatInterface.jsx`, the WebSocket message handler needs this case added:

```javascript
// Around line 3458, before the closing brace of the switch statement
case 'permission-request':
  // Forward to permission system
  if (latestMessage.requestId && latestMessage.toolName) {
    const request = {
      id: latestMessage.requestId,
      tool: latestMessage.toolName,
      operation: latestMessage.operation || 'default',
      description: latestMessage.description || `Permission request for ${latestMessage.toolName}`,
      input: latestMessage.input || {},
      timestamp: latestMessage.timestamp || Date.now(),
    };

    // enqueueRequest is from usePermissions hook
    const result = enqueueRequest(request);

    if (!result.autoApproved) {
      // Dialog will be shown by usePermissions logic
      console.log('🔐 Permission request queued:', request.id);
    } else {
      console.log('✅ Permission auto-approved:', request.id, result.decision);
    }
  }
  break;

case 'permission-timeout':
  // Handle timeout notification from server
  console.warn('⏰ Permission request timed out:', latestMessage.requestId);
  // Context will handle cleanup
  break;
```

## Why It's Not Working Now

1. **Backend sends message** (claude-sdk.js:142-148):
   ```javascript
   ws.send(JSON.stringify({
     type: 'permission-request',
     requestId,
     toolName,
     input,
     timestamp: Date.now()
   }));
   ```

2. **Frontend receives message** but there's no handler for `type: 'permission-request'`

3. **Switch statement falls through** without processing the permission request

4. **usePermissions hook is imported** (line 33) but never called in the WebSocket handler

5. **enqueueRequest is not extracted** from usePermissions hook

## What Needs to Happen

### Minimal Fix (5 minutes)
Add the missing case statement to the WebSocket message handler.

### Complete Fix (15 minutes)
1. Extract `enqueueRequest` from `usePermissions()` hook at component level
2. Add `case 'permission-request':` handler
3. Add `case 'permission-timeout':` handler
4. Test the flow

### Verification Steps
1. Start dev server: `npm run dev`
2. Open browser console
3. Send message that triggers tool usage
4. Should see:
   - Backend log: `🔐 Permission request ... for tool: ...`
   - Frontend log: `🔐 Permission request queued: ...`
   - Dialog should appear

## Code Locations Reference

### Backend: Permission Request Sent
**File**: `server/claude-sdk.js`
**Lines**: 142-148
```javascript
ws.send(JSON.stringify({
  type: 'permission-request',
  requestId,
  toolName,
  input,
  timestamp: Date.now()
}));
```

### Backend: Response Handler
**File**: `server/index.js`
**Lines**: 811-819
```javascript
case 'permission-response':
  const permissionManager = getPermissionManager();
  const success = permissionManager.resolveRequest(
    message.id,
    message.decision,
    message.updatedInput
  );
```

### Frontend: Hook Declaration (Working)
**File**: `src/components/ChatInterface.jsx`
**Line**: 33
```javascript
import usePermissions from '../hooks/usePermissions';
```

### Frontend: Hook Usage (Incomplete)
**File**: `src/components/ChatInterface.jsx`
**Around line**: 2600-2700 (estimated, needs to be added)
```javascript
// THIS IS MISSING - needs to be added
const {
  isDialogOpen,
  currentRequest,
  sendPermissionResponse,
  handleDialogDecision,
  closeDialog,
} = usePermissions();
```

### Frontend: Dialog Rendering (Working but never triggered)
**File**: `src/components/ChatInterface.jsx`
**Lines**: 4781-4790
```javascript
{isDialogOpen && currentRequest && (
  <PermissionDialog
    request={currentRequest}
    onClose={() => handleDialogDecision(currentRequest.id, PERMISSION_DECISIONS.DENY)}
    sendResponse={sendPermissionResponse}
  />
)}
```

### Frontend: WebSocket Message Switch (Missing case)
**File**: `src/components/ChatInterface.jsx`
**Lines**: 2921-3459
**Missing**: `case 'permission-request':`

## Implementation Priority

### CRITICAL (Blocks everything)
1. Add `usePermissions()` hook extraction in ChatInterface component body
2. Add `case 'permission-request':` to WebSocket switch

### HIGH (Needed for testing)
3. Add `case 'permission-timeout':` to WebSocket switch
4. Verify message format matches between backend and frontend

### MEDIUM (Nice to have)
5. Add debug logging for message flow
6. Add error handling for malformed messages
7. Test button (already exists for development)

### LOW (Future enhancement)
8. Performance optimization
9. Analytics tracking
10. Advanced error recovery

## Expected Message Flow

1. **User sends chat message** → Claude SDK needs tool
2. **SDK calls canUseTool** (claude-sdk.js:105)
3. **Backend creates permission request** (claude-sdk.js:107-130)
4. **Backend sends WebSocket message** (claude-sdk.js:142-148)
   - Type: 'permission-request'
   - Data: {requestId, toolName, input, timestamp}
5. **Frontend receives WebSocket message** (ChatInterface.jsx:2906)
6. **❌ MISSING: case 'permission-request' handler**
7. **SHOULD: enqueueRequest() called** (would trigger dialog)
8. **User makes decision** (PermissionDialog.jsx)
9. **Frontend sends response** (usePermissions.js:90-129)
   - Type: 'permission-response'
   - Data: {id, decision, updatedInput}
10. **Backend receives response** (index.js:811-819)
11. **PermissionManager resolves** (permissionManager.js)
12. **SDK receives result** and continues/stops execution

## Testing Checklist

### Quick Test (After Fix)
```bash
# Start server
npm run dev

# In browser console:
# 1. Check for permission dialog components
document.querySelector('[data-testid="permission-dialog"]')

# 2. Monitor WebSocket messages
# Open Network tab → WS → Messages
# Look for: permission-request, permission-response

# 3. Send a message that needs bash tool
# Example: "List files in the current directory"
# Should trigger permission dialog
```

### Full Integration Test
1. Test permission dialog appears
2. Test "Allow Once" button
3. Test "Allow Session" (should auto-approve next)
4. Test "Allow Always" (persist in localStorage)
5. Test "Deny" button
6. Test keyboard shortcuts (Y/N/A/S/D)
7. Test timeout (wait 30 seconds)
8. Test queue indicator (multiple rapid requests)
9. Test different permission modes
10. Test WebSocket reconnection

## Estimated Fix Time
- **Reading this doc**: 10 minutes
- **Implementing fix**: 15 minutes
- **Testing**: 15 minutes
- **Total**: 40 minutes

## Success Criteria
✅ Permission dialog appears when Claude requests tool usage
✅ All decision buttons work
✅ Responses reach backend
✅ SDK receives permission results
✅ Tool execution continues/stops based on decision
✅ No console errors

## Notes
- usePermissions hook has mock test function already (line 163-184)
- Test button exists in development mode (line 4794-4802)
- All styling is complete (Tailwind classes)
- Dark mode support is already implemented
- Mobile responsiveness is handled
- The system is very close to working - just needs the message handler connection

## Next Steps
1. Read ChatInterface.jsx around line 2600 to find where hooks are called
2. Add `usePermissions()` hook extraction
3. Add permission-request case to switch statement (around line 3458)
4. Test with development test button first
5. Test with actual Claude tool usage
6. Verify WebSocket message format matches
7. Update TEST_PERMISSION_UI.md with findings
