# Fix Plan: Plan Approval System Not Working + UI/UX Improvements

## Issues Identified

### 1. **Dialog Not Appearing** (Critical Bug)
- Backend detection logic exists but plan approval dialog never shows
- Likely cause: ExitPlanMode detection in `claude-sdk.js` not matching actual SDK message format
- Need debug logging to see actual message structure

### 2. **State Lost on Refresh** (User Request)
- Current: WebSocket-only state (lost on page refresh)
- User wants: Persistent state so dialog reappears when reloading session
- Need: Store approval state in session storage

### 3. **UI/UX Issues** (User Preference)
- Current: Modal dialog approach
- User wants: **Inline buttons** within the plan card (not separate modal)
- User wants: Visual indication of approval decision after choice is made

## Implementation Plan

### Phase 1: Debug & Fix Detection (Priority: CRITICAL)
**Goal**: Find why ExitPlanMode isn't triggering approval flow

**File**: `server/claude-sdk.js` (lines 520-561)

**Changes**:
1. Add extensive debug logging before detection:
   ```javascript
   console.log('🔍 [DEBUG] Message structure:', {
     type: message.type,
     hasContent: !!message.content,
     isArray: Array.isArray(message.content),
     contentLength: Array.isArray(message.content) ? message.content.length : 'N/A',
     contentTypes: Array.isArray(message.content)
       ? message.content.map(c => ({ type: c.type, name: c.name }))
       : 'N/A',
     rawContentPreview: JSON.stringify(message).substring(0, 500)
   });
   ```

2. Add logging after detection attempt:
   ```javascript
   const exitPlanModeTool = message.content?.find(c =>
     c.type === 'tool_use' && c.name === 'ExitPlanMode'
   );
   console.log('🔍 [DEBUG] ExitPlanMode detection:', {
     found: !!exitPlanModeTool,
     toolName: exitPlanModeTool?.name,
     hasInput: !!exitPlanModeTool?.input,
     hasPlan: !!exitPlanModeTool?.input?.plan,
     planLength: exitPlanModeTool?.input?.plan?.length
   });
   ```

3. Add logging inside the approval request:
   ```javascript
   if (exitPlanModeTool && exitPlanModeTool.input && exitPlanModeTool.input.plan) {
     console.log('✅ [DEBUG] Requesting plan approval NOW!');
     // existing code...
   }
   ```

**Test**: Run plan mode, check console logs to see actual message structure

---

### Phase 2: Replace Modal with Inline UI (Priority: HIGH)
**Goal**: Remove modal dialog, add approval buttons inside plan card

#### 2.1: Remove Modal Dialog Components

**File**: `src/components/ChatInterface.jsx` (line 4833)
- Remove: `<PlanApprovalDialog />`

**File**: `src/components/PlanApprovalDialog.jsx`
- Delete this file (no longer needed)

#### 2.2: Add Inline Approval UI to Plan Card

**File**: `src/components/ChatInterface.jsx` (lines 696-725)

**Current Structure**:
```jsx
{message.toolInput && message.toolName === 'ExitPlanMode' && (() => {
  // Beautiful blue card with plan
  // "Awaiting approval..." message
})()}
```

**New Structure**:
```jsx
{message.toolInput && message.toolName === 'ExitPlanMode' && (() => {
  const input = JSON.parse(message.toolInput);
  const planContent = input.plan;
  const planId = message.toolId; // Use toolId as planId

  // Check if this plan has been approved/rejected
  const approval = planApprovals[planId]; // From context

  return (
    <div className="relative mt-3">
      {/* Beautiful blue card */}
      <div className="bg-gradient-to-br from-blue-50/50...">
        {/* Plan header */}
        <div className="flex items-center...">
          {/* Icon + Title */}
        </div>

        {/* Plan content markdown */}
        <Markdown>{planContent}</Markdown>
      </div>

      {/* Approval Section - INLINE */}
      {!approval ? (
        // PENDING: Show approval buttons
        <div className="flex gap-3 mt-4">
          <button onClick={() => handlePlanApproval(planId, 'acceptEdits')}>
            ✓ Approve & Auto-Execute (A)
          </button>
          <button onClick={() => handlePlanApproval(planId, 'default')}>
            ✓ Approve & Manual Review (M)
          </button>
          <button onClick={() => handlePlanRejection(planId)}>
            ✗ Reject Plan (R)
          </button>
        </div>
      ) : (
        // APPROVED/REJECTED: Show decision badge
        <div className={`mt-4 p-3 rounded-lg ${
          approval.decision === 'approved'
            ? 'bg-green-100 dark:bg-green-900/30'
            : 'bg-red-100 dark:bg-red-900/30'
        }`}>
          {approval.decision === 'approved' ? (
            <>✅ Approved with {approval.permissionMode} mode</>
          ) : (
            <>❌ Rejected: {approval.reason}</>
          )}
        </div>
      )}
    </div>
  );
})()}
```

#### 2.3: Update PlanApprovalContext

**File**: `src/contexts/PlanApprovalContext.jsx`

**Changes**:
- Replace `activePlan` (single plan) with `planApprovals` (map of all plans)
- Structure: `{ [planId]: { decision: 'approved'|'rejected', permissionMode, reason, timestamp } }`
- Keep approval functions but update to work with the map
- Remove WebSocket message listener (approval will be triggered directly from UI)

**New State**:
```javascript
const [planApprovals, setPlanApprovals] = useState({});
const [pendingPlans, setPendingPlans] = useState(new Set());
```

---

### Phase 3: Add Persistence (Priority: MEDIUM)
**Goal**: Store approval decisions so they survive page refresh

#### 3.1: Backend - Write Approval to Session File

**File**: `server/claude-sdk.js`

**When approval is received** (after planApprovalManager resolves):
```javascript
// After: const approvalResult = await planApprovalManager.requestPlanApproval(...)

// Write approval entry to session JSONL file
const sessionDir = path.join(os.homedir(), '.claude', 'projects', projectName);
const sessionFile = path.join(sessionDir, `${capturedSessionId}.jsonl`);

const approvalEntry = {
  type: 'plan-approval',
  sessionId: capturedSessionId,
  planId: exitPlanModeTool.id,
  timestamp: new Date().toISOString(),
  decision: 'approved',
  permissionMode: approvalResult.permissionMode,
  planContent: exitPlanModeTool.input.plan
};

await fs.appendFile(sessionFile, JSON.stringify(approvalEntry) + '\n');
```

#### 3.2: Backend - Return Approval Entries with Session

**File**: `server/projects.js` (function `getSessionMessages`, lines 806-874)

**Add parsing for plan-approval entries**:
```javascript
// Inside the JSONL parsing loop
if (entry.type === 'plan-approval') {
  messages.push({
    type: 'plan-approval',
    planId: entry.planId,
    decision: entry.decision,
    permissionMode: entry.permissionMode,
    reason: entry.reason,
    timestamp: entry.timestamp
  });
}
```

#### 3.3: Frontend - Restore Approval State

**File**: `src/components/ChatInterface.jsx`

**When loading session messages**:
```javascript
useEffect(() => {
  // Existing message loading code...

  // Extract and restore plan approvals
  const approvals = {};
  messages.forEach(msg => {
    if (msg.type === 'plan-approval') {
      approvals[msg.planId] = {
        decision: msg.decision,
        permissionMode: msg.permissionMode,
        reason: msg.reason,
        timestamp: msg.timestamp
      };
    }
  });

  // Update context with restored approvals
  setPlanApprovals(approvals);
}, [sessionId]);
```

---

### Phase 4: Simplify WebSocket Flow (Priority: LOW)
**Goal**: Keep WebSocket for real-time but don't rely on it for state

**Changes**:
- Backend still broadcasts `plan-approval-request` (for multi-tab support)
- Frontend listens but only adds to `pendingPlans` Set
- Approval actions go directly through context, not WebSocket
- WebSocket response is optional (for multi-tab sync only)

**File**: `server/claude-sdk.js`
- Keep the planApprovalManager.requestPlanApproval() call
- But also immediately proceed (don't block on approval)
- User can approve/reject asynchronously via UI

---

## Summary of Changes

### Files to Modify:
1. ✏️ `server/claude-sdk.js` - Add debug logs, write approval to JSONL
2. ✏️ `src/components/ChatInterface.jsx` - Add inline approval UI, remove modal
3. ✏️ `src/contexts/PlanApprovalContext.jsx` - Change to map-based state
4. ✏️ `server/projects.js` - Parse plan-approval entries
5. ✏️ `src/App.jsx` - Keep provider (already done)

### Files to Delete:
1. 🗑️ `src/components/PlanApprovalDialog.jsx` - Modal no longer needed

### Testing Checklist:
- [ ] Debug logs show ExitPlanMode detection working
- [ ] Plan card displays with inline approval buttons
- [ ] Clicking "Approve & Auto" → Badge appears showing decision
- [ ] Refresh page → Badge still shows (persisted)
- [ ] Load old session → Approval decisions restored
- [ ] Keyboard shortcuts work (A, M, R)

---

## Expected Outcome

**Before**:
- Plan appears → No dialog → Auto-approved
- Refresh → State lost

**After**:
- Plan appears → Inline buttons show in the card
- Click approve → Badge replaces buttons showing decision
- Refresh → Badge still visible (persisted to JSONL)
- Switch sessions → Each has own approval state

**Ready to implement these fixes?**
