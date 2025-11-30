# Plan: Implement Plan Approval System (Level 2 - Balanced Approach)

## Executive Summary

Based on analysis of the existing permissions system (`specs/permissions-and-approval-system.md`), I recommend **Level 2 (Medium Effort)** - a balanced approach that reuses WebSocket infrastructure while keeping plan approval logic separate and focused.

## Key Findings

### Similarities with Permissions System:
- Both require user decisions that block execution
- Both use WebSocket async request/response pattern
- Both need timeout handling and state management
- Both use modal UI for user interaction

### Key Differences:
- **Plans**: Large markdown content, strategic decisions, no caching needed
- **Permissions**: Small parameters, tactical decisions, session+permanent caching
- **Plans**: Typically one at a time, trigger mode switching
- **Permissions**: Multiple queued requests, immediate tool execution

## Effort Level Comparison

### Level 1 - Low Effort (1-2 hours)
- Direct WebSocket in ChatInterface
- No queue/timeout management
- Quick but fragile
- ❌ **Not recommended**: Too simplistic, hard to maintain

### Level 2 - Medium Effort (4-6 hours) ⭐ **RECOMMENDED**
- Dedicated PlanApprovalContext + PlanApprovalDialog
- Reuse WebSocket infrastructure
- Proper timeout/state management
- Separate from permissions (cleaner architecture)
- ✅ **Best balance**: Quality + maintainability + reasonable effort

### Level 3 - High Effort (8-12 hours)
- Full integration: plans as "special permissions"
- Maximum code reuse
- Most consistent architecture
- ❌ **Not recommended**: Over-engineering, higher risk of breaking existing permissions

## Detailed Implementation Plan (Level 2)

### Phase 1: Backend Infrastructure

#### 1.1 Create Plan Approval Manager
**File**: `server/services/planApprovalManager.js`

**Features**:
- Single pending plan tracking (unlike permission queue)
- Promise-based resolution pattern
- Timeout handling (reuse PERMISSION_TIMEOUT_MS)
- EventEmitter for plan request events
- Statistics tracking (optional)

**Key Methods**:
- `requestPlanApproval(planId, planContent, sessionId)` → Promise
- `resolvePlanApproval(planId, decision, permissionMode)` → void
- `rejectPlanApproval(planId, reason)` → void
- `timeoutPlanApproval(planId)` → void

#### 1.2 Extend WebSocket Handler
**File**: `server/services/permissionWebSocketHandler.js`

**Changes**:
- Import planApprovalManager
- Add message types: `PLAN_APPROVAL_REQUEST`, `PLAN_APPROVAL_RESPONSE`
- Add listener for plan approval events
- Broadcast plan requests to connected clients
- Handle plan approval responses from clients
- Reuse existing broadcast/client management

#### 1.3 Integrate with SDK
**File**: `server/claude-sdk.js`

**Changes** (in `queryClaudeSDK` function):
- Detect ExitPlanMode tool in message stream
- Extract plan from tool input
- Call `planApprovalManager.requestPlanApproval()`
- Await approval result
- On approval: Switch permission mode + continue execution
- On rejection: Send rejection message + abort

**Detection Point**: When `message.type === 'assistant'` and content contains `tool_use` with `name === 'ExitPlanMode'`

### Phase 2: Frontend Context & State

#### 2.1 Create Plan Approval Context
**File**: `src/contexts/PlanApprovalContext.jsx`

**State**:
```javascript
{
  activePlan: {
    planId: string,
    content: string,
    timestamp: number,
    expiresAt: number
  } | null,
  isProcessing: boolean
}
```

**Methods**:
- `handlePlanApproval(planId, permissionMode)` - Send approval via WebSocket
- `handlePlanRejection(planId, reason)` - Send rejection via WebSocket
- WebSocket message handlers for PLAN_APPROVAL_REQUEST
- Timeout countdown logic

**Integration**: Add to App.jsx providers

#### 2.2 Update ChatInterface
**File**: `src/components/ChatInterface.jsx`

**Changes**:
- Keep the beautiful blue card rendering for ExitPlanMode tool input
- Remove the TODO approval buttons (lines 719-744)
- Add "Awaiting approval..." status indicator
- PlanApprovalDialog will handle approval interaction

### Phase 3: UI Component

#### 3.1 Create Plan Approval Dialog
**File**: `src/components/PlanApprovalDialog.jsx`

**Features**:
- Modal overlay (reuse PermissionDialog backdrop pattern)
- Large scrollable plan content area with markdown
- Three action buttons:
  1. **"Approve & Auto-Execute"** (green) - Switches to `acceptEdits` mode
  2. **"Approve & Manual Review"** (blue) - Stays in `default` mode
  3. **"Reject Plan"** (red) - Cancels execution
- Timeout countdown display (30 seconds)
- Keyboard shortcuts:
  - `A` - Approve & Auto
  - `M` - Approve & Manual
  - `R` - Reject
  - `ESC` - Reject
- Mode indicator tooltip explaining what each mode does
- Plan metadata: timestamp, session info

**Styling**: Consistent with PermissionDialog patterns but adapted for large content

### Phase 4: WebSocket Message Types

#### 4.1 Add New Message Types
**File**: `server/services/permissionTypes.js` (or new `planApprovalTypes.js`)

**Message Types**:
```javascript
// Backend → Frontend
PLAN_APPROVAL_REQUEST: {
  type: 'plan-approval-request',
  planId: string,
  content: string,  // markdown plan
  sessionId: string,
  timestamp: number,
  expiresAt: number
}

// Frontend → Backend
PLAN_APPROVAL_RESPONSE: {
  type: 'plan-approval-response',
  planId: string,
  decision: 'approve' | 'reject',
  permissionMode?: 'default' | 'acceptEdits', // only if approved
  reason?: string  // only if rejected
}

// Backend → Frontend (timeout)
PLAN_APPROVAL_TIMEOUT: {
  type: 'plan-approval-timeout',
  planId: string
}
```

### Phase 5: Mode Transition & Execution

#### 5.1 Handle Approval in Backend
**File**: `server/claude-sdk.js`

**After approval received**:
1. Update permission mode in SDK options
2. Resume SDK execution (plan was approved, now execute)
3. Send mode change notification to frontend
4. Clean up plan approval state

**After rejection**:
1. Send rejection message to SDK/user
2. Abort current query
3. Return to normal chat mode

### Phase 6: Testing & Polish

**Test Scenarios**:
1. ✅ Plan approval → auto-execute mode → tools execute automatically
2. ✅ Plan approval → manual mode → tools require permission
3. ✅ Plan rejection → abort → return to chat
4. ✅ Timeout handling → auto-reject after 30s
5. ✅ WebSocket disconnect during approval → reconnect + restore state
6. ✅ Multiple sessions → approval in one doesn't affect others
7. ✅ Keyboard shortcuts work correctly
8. ✅ UI renders large plans properly (scrolling)

## File Modifications Summary

### New Files (3):
1. `server/services/planApprovalManager.js` (~150 lines)
2. `src/contexts/PlanApprovalContext.jsx` (~200 lines)
3. `src/components/PlanApprovalDialog.jsx` (~250 lines)

### Modified Files (4):
1. `server/services/permissionWebSocketHandler.js` (+50 lines)
2. `server/claude-sdk.js` (+80 lines for detection + mode switching)
3. `src/components/ChatInterface.jsx` (~20 lines - remove TODO buttons)
4. `src/App.jsx` (+5 lines - add PlanApprovalProvider)

### Optional New File (1):
5. `server/services/planApprovalTypes.js` (~50 lines - message type definitions)

**Total New Code**: ~600 lines
**Modified Code**: ~155 lines

## Timeline Estimate

- **Phase 1** (Backend): 1.5 hours
- **Phase 2** (Context): 1 hour
- **Phase 3** (UI Component): 1.5 hours
- **Phase 4** (Message Types): 0.5 hours
- **Phase 5** (Mode Transition): 1 hour
- **Phase 6** (Testing): 1.5 hours

**Total**: 6-7 hours

## Why Level 2 (Not Level 1 or 3)

### vs Level 1:
- ✅ Proper architecture (not hacky)
- ✅ Timeout handling
- ✅ State management
- ✅ Reusable components
- ✅ Testable

### vs Level 3:
- ✅ Lower risk (doesn't touch existing permissions)
- ✅ Cleaner separation (plans ≠ permissions conceptually)
- ✅ Faster to implement
- ✅ Plans don't need caching like permissions do
- ✅ Easier to understand and maintain

## Next Steps

After approval:
1. Create planApprovalManager.js
2. Extend WebSocket handler
3. Create PlanApprovalContext
4. Create PlanApprovalDialog
5. Integrate with SDK message stream
6. Update ChatInterface to remove TODO buttons
7. Test end-to-end flow

**Ready to proceed with Level 2 implementation?**
