# Task 5: Background Tasks Management - Design Document

**Date**: 2026-03-01
**Author**: Claude (Brainstorming Session)
**Status**: Design Approved
**Implementation Approach**: Complete Feature Migration (Option 1)

---

## Executive Summary

This document outlines the design for migrating the Background Tasks Management feature from the `feature/personal-enhancements` branch to `upstream/main`. The feature enables users to monitor and manage background subagent and bash tasks through a real-time UI with at-least-once event delivery guarantees.

**Key Components**:
- New file: `server/ws-clients.js` (WebSocket client registry + event queue)
- Enhanced: `server/claude-sdk.js` (monitoring functions + task storage)
- Enhanced: `server/index.js` (WebSocket message handlers)
- New UI: `BackgroundTasksPopover.tsx` (drawer) + `BackgroundTasksPage.tsx` (standalone page)
- i18n: 4 languages (en, ja, ko, zh-CN)

**Estimated Effort**: 8-12 hours (backend 4-6h, frontend 2-3h, testing 2-3h)

---

## 1. Architecture Overview

### 1.1 System Goals

Enable users to:
- View running background subagent and bash tasks
- Monitor real-time task progress and output
- Terminate unwanted tasks (UI dismiss for now, SDK limitation)
- Recover task state after WebSocket reconnection (no data loss)

### 1.2 Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  ┌──────────────────┐         ┌─────────────────────────┐  │
│  │ BackgroundTasks  │◄────────┤  WebSocketContext       │  │
│  │ Popover (Drawer) │         │  (subscribe/sendMessage)│  │
│  └──────────────────┘         └─────────────────────────┘  │
│  ┌──────────────────┐                                       │
│  │ BackgroundTasks  │                                       │
│  │ Page (Standalone)│                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend (server/)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ws-clients.js (NEW)                                  │  │
│  │  - connectedClients registry                          │  │
│  │  - pendingEvents queue (at-least-once delivery)       │  │
│  │  - emitTaskEvent() / ackEvent() / syncPendingEvents() │  │
│  └──────────────────────────────────────────────────────┘  │
│                              │                               │
│  ┌──────────────────────────▼───────────────────────────┐  │
│  │  claude-sdk.js (ENHANCED)                             │  │
│  │  - monitorSubagentCompletion() (fd-based polling)     │  │
│  │  - monitorBackgroundBash() (fd-based polling)         │  │
│  │  - backgroundTasks Map (taskId → task info)           │  │
│  │  - backgroundTaskOutputs Map (taskId → output cache)  │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│  ┌──────────────────────────▼───────────────────────────┐  │
│  │  index.js (ENHANCED)                                  │  │
│  │  - WebSocket message handlers:                        │  │
│  │    • query-task-output                                │  │
│  │    • kill-background-task                             │  │
│  │    • sync-background-events                           │  │
│  │    • ack-event                                        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Key Design Decisions

1. **At-least-once Event Delivery**: MQTT QoS 1 style acknowledgment mechanism ensures no task state loss after WebSocket reconnection
2. **File Descriptor (fd) Monitoring**: Use `fs.openSync()` + `fs.fstatSync()` to monitor task output even after CLI deletes file paths
3. **Dual Storage**: Bash task output written to both `/tmp/claude/tasks/` and `~/.claude/task-outputs/` (persistent backup)
4. **Decentralized Architecture**: `ws-clients.js` as independent module to avoid circular dependencies between `index.js` and `claude-sdk.js`

### 1.4 Upstream Compatibility

Adaptations needed for upstream changes:
- SDK upgraded to 0.2.59 (added model usage logging)
- `claude-sdk.js` session management refactored
- Component splits (`ChatInterface.tsx` → multiple subcomponents)

---

## 2. Migration Strategy

### 2.1 Code Scale Assessment

**Feature Branch Changes**:
- `server/claude-sdk.js`: +777 lines, -22 lines (from 721 to ~1500 lines)
- New file `server/ws-clients.js`: ~200 lines
- `server/index.js`: estimated +100 lines (WebSocket message handling)
- Frontend components: 2 new files + multiple file modifications

**Upstream Changes**:
- SDK upgraded to 0.2.59 (from 0.1.x)
- No structural refactoring of `claude-sdk.js` (function signatures stable)

### 2.2 Migration Approach

**Strategy: Incremental Migration Based on upstream/main**

1. **Direct Copy for New Files**:
   - `server/ws-clients.js` → Copy directly from feature branch (no conflicts)
   - Frontend components → Copy directly (check import paths)

2. **Manual Merge for claude-sdk.js**:
   - Extract new functions and variables from feature branch
   - Insert into corresponding positions in upstream/main
   - Preserve upstream's SDK calling patterns

3. **Incremental Addition for index.js**:
   - Add WebSocket message handling branches
   - Add `ws-clients.js` imports and calls

### 2.3 Key Adaptation Points

**Adaptation Point 1: SDK Version Differences**

Feature branch based on SDK 0.1.x, upstream upgraded to 0.2.59. API changes to check:
- `query()` function signature
- Message format (`message.type`, `message.tool`, etc.)
- New model usage logging

**Adaptation Strategy**: Preserve upstream's SDK calling patterns, only add background task monitoring logic.

---

**Adaptation Point 2: Export List**

Feature branch new exports:
```javascript
export {
  // upstream existing...
  backgroundTasks,           // NEW
  backgroundTaskOutputs      // NEW
};
```

Upstream export list:
```javascript
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter
};
```

**Adaptation Strategy**: Directly append new exports to upstream's export list.

---

**Adaptation Point 3: Monitoring Function Insertion Position**

Need to insert monitoring logic in `queryClaudeSDK()`'s message processing loop.

**Insertion Position**: When processing `tool_result` messages, check if it's a background task:
```javascript
// In upstream's queryClaudeSDK() function
for await (const message of stream) {
  // ... existing processing logic ...

  if (message.type === 'tool_result') {
    // NEW: Check if background task
    const toolUse = findCorrespondingToolUse(message.tool_use_id);
    if (toolUse?.tool === 'Task' && toolUse?.input?.run_in_background) {
      // Start subagent monitoring
    }
    if (toolUse?.tool === 'Bash' && toolUse?.input?.run_in_background) {
      // Start bash monitoring
    }
  }
}
```

**Adaptation Strategy**: Find corresponding message processing position in upstream code, insert monitoring logic.

---

### 2.4 Migration Steps

**Step 1: Preparation**
1. Create new branch `feat/background-tasks-management` from `main`
2. Ensure `main` is synced to latest `upstream/main`

**Step 2: Backend Migration**
1. Copy `server/ws-clients.js` (no modifications)
2. Manually merge `server/claude-sdk.js`:
   - Add new Map variables (`backgroundTasks`, `backgroundTaskOutputs`, monitors)
   - Add monitoring functions (`monitorSubagentCompletion`, `monitorBackgroundBash`)
   - Insert monitoring trigger logic in `queryClaudeSDK()`
   - Update export list
3. Modify `server/index.js`:
   - Import `ws-clients.js` and new exports
   - Add WebSocket message handling branches
   - Call `registerClient`/`unregisterClient` on connection/disconnection

**Step 3: Frontend Migration**
1. Copy `src/components/app/BackgroundTasksPopover.tsx`
2. Copy `src/components/app/BackgroundTasksPage.tsx`
3. Copy i18n files (4 languages)
4. Modify `src/i18n/i18n.ts` to register new namespace
5. Modify `src/components/app/AppContent.tsx` to add route
6. Modify `src/components/sidebar/Sidebar.tsx` to add entry point
7. Modify `src/components/chat/hooks/useChatRealtimeHandlers.ts` to handle background task events

**Step 4: Verification**
1. `npm install` to install dependencies
2. `npm run build` to check compilation errors
3. Manual testing: Start background subagent and bash tasks
4. Test WebSocket reconnection recovery

---

## 3. Frontend Design and Integration

### 3.1 Component Architecture

**New Components**:

1. **BackgroundTasksPopover.tsx** (Drawer UI)
   - Position: Right-side drawer
   - Trigger: Click background tasks icon in Sidebar
   - Function: Real-time display of running tasks, support viewing output and termination

2. **BackgroundTasksPage.tsx** (Standalone Page)
   - Route: `/background-tasks`
   - Function: Same as Popover, but as standalone page
   - Use case: Users can open in new tab for continuous monitoring

**Component Relationships**:
```
AppContent.tsx
├── Sidebar.tsx
│   └── [Background Tasks Icon] → Open BackgroundTasksPopover
├── Routes
│   └── /background-tasks → BackgroundTasksPage
└── BackgroundTasksPopover (Global Drawer)
```

### 3.2 Frontend Migration Adaptation Points

**Adaptation Point 1: Component Import Paths**

Feature branch component structure may differ from upstream. Need to check:
- `useWebSocket` hook import path
- `useTranslation` configuration
- UI component library (Button, Drawer, etc.) imports

**Adaptation Strategy**:
1. Copy components, run `npm run build`
2. Adjust import paths based on compilation errors
3. Check if upstream has component renames or moves

---

**Adaptation Point 2: WebSocket Message Types**

Frontend needs to handle new message types:
```typescript
// Received from server
type BackgroundTaskMessage =
  | { type: 'background-task-started', task: BackgroundTask, eventId: string, sessionId: string }
  | { type: 'background-task-completed', taskId: string, eventId: string, sessionId: string }
  | { type: 'subagent-progress', taskId: string, agentId: string, messages: ProgressMessage[] }
  | { type: 'subagent-completed', taskId: string, agentId: string, output: string }
  | { type: 'bash-started', bash: BashTask }
  | { type: 'bash-completed', bashId: string, background: boolean }
  | { type: 'task-output', taskId: string, output: TaskOutput }
  | { type: 'background-task-deleted', taskId: string };

// Sent to server
type BackgroundTaskRequest =
  | { type: 'query-task-output', taskId: string, maxLines: number }
  | { type: 'kill-background-task', taskId: string }
  | { type: 'sync-background-events', sessionId: string }
  | { type: 'ack-event', eventId: string, sessionId: string };
```

**Adaptation Strategy**:
- Add type definitions in `WebSocketContext.tsx` (if using TypeScript)
- Ensure message format matches backend

---

**Adaptation Point 3: At-least-once Event Deduplication**

Frontend needs to implement deduplication logic to avoid processing same event repeatedly:

```typescript
// In BackgroundTasksPopover.tsx
const seenEventsRef = useRef(new Set<string>());

useEffect(() => {
  return subscribe((msg: any) => {
    // 1. Send ACK
    if (msg.eventId) {
      sendMessage({ type: 'ack-event', eventId: msg.eventId, sessionId: msg.sessionId });

      // 2. Deduplication check
      if (seenEventsRef.current.has(msg.eventId)) return;
      seenEventsRef.current.add(msg.eventId);

      // 3. Limit Set size (prevent memory leak)
      if (seenEventsRef.current.size > 500) {
        // Delete oldest 100 entries
      }
    }

    // 4. Process message
    if (msg.type === 'background-task-started') {
      setTasks(prev => [...prev, msg.task]);
    }
    // ...
  });
}, [subscribe, sendMessage]);
```

**Adaptation Strategy**: Copy this logic directly from feature branch, no modifications needed.

---

**Adaptation Point 4: WebSocket Reconnection Recovery**

After WebSocket reconnection, frontend needs to proactively request sync of unacknowledged events:

```typescript
// In BackgroundTasksPopover.tsx
const prevConnectedRef = useRef(false);

useEffect(() => {
  if (isConnected && !prevConnectedRef.current && currentSessionId) {
    // After reconnection, request event sync
    sendMessage({ type: 'sync-background-events', sessionId: currentSessionId });
  }
  prevConnectedRef.current = isConnected;
}, [isConnected, currentSessionId, sendMessage]);
```

**Adaptation Strategy**: Copy directly from feature branch, ensure `isConnected` state comes from `WebSocketContext`.

---

### 3.3 Integration Point Modifications

**Modification 1: src/i18n/i18n.ts**

Add `backgroundTasks` namespace:
```typescript
import backgroundTasksEN from './locales/en/backgroundTasks.json';
import backgroundTasksJA from './locales/ja/backgroundTasks.json';
import backgroundTasksKO from './locales/ko/backgroundTasks.json';
import backgroundTasksZH from './locales/zh-CN/backgroundTasks.json';

// Add to resources
resources: {
  en: {
    // ...
    backgroundTasks: backgroundTasksEN,
  },
  ja: {
    // ...
    backgroundTasks: backgroundTasksJA,
  },
  // ...
}
```

---

**Modification 2: src/components/app/AppContent.tsx**

Add route:
```typescript
<Route path="/background-tasks" element={<BackgroundTasksPage currentSessionId={currentSessionId} />} />
```

---

**Modification 3: src/components/sidebar/Sidebar.tsx**

Add background tasks entry button:
```typescript
<button onClick={() => setShowBackgroundTasks(true)}>
  <TaskIcon />
  {runningTasksCount > 0 && <Badge>{runningTasksCount}</Badge>}
</button>
```

Need to get `runningTasksCount` from `WebSocketContext` or global state.

---

**Modification 4: src/components/chat/hooks/useChatRealtimeHandlers.ts**

Handle background task completion notifications, display system messages in chat interface:

```typescript
case 'bash-completed':
  if (latestMessage.background && latestMessage.bash?.command) {
    // Add system-injected message to chat history
    setChatMessages(prev => [...prev, {
      type: 'system',
      injectedType: 'background-task-result',
      injectedSummary: `Bash completed: ${command}`,
      // ...
    }]);
  }
  break;

case 'subagent-completed':
  setChatMessages(prev => [...prev, {
    type: 'system',
    injectedType: 'background-task-result',
    injectedSummary: `Agent ${agentId} completed`,
    // ...
  }]);
  break;
```

**Adaptation Strategy**:
1. Check upstream's `useChatRealtimeHandlers.ts` structure
2. Find message processing switch/if branches
3. Insert background task message handling logic

---

### 3.4 i18n Files

Need to copy 4 translation files:
- `src/i18n/locales/en/backgroundTasks.json`
- `src/i18n/locales/ja/backgroundTasks.json`
- `src/i18n/locales/ko/backgroundTasks.json`
- `src/i18n/locales/zh-CN/backgroundTasks.json`

**Content Example** (English):
```json
{
  "title": "Background Tasks",
  "subagents": "Subagents",
  "bash": "Bash Commands",
  "running": "Running",
  "completed": "Completed",
  "terminate": "Terminate",
  "viewOutput": "View Output",
  "noTasks": "No background tasks running"
}
```

**Adaptation Strategy**: Copy directly from feature branch, no modifications needed.

---

### 3.5 Frontend Migration Verification Checklist

After migration completion, need to verify:

1. ✅ Components compile without errors
2. ✅ Import paths correct
3. ✅ WebSocket message send/receive normal
4. ✅ At-least-once deduplication effective
5. ✅ Event sync normal after reconnection
6. ✅ UI displays correctly (Popover + standalone page)
7. ✅ i18n translations load normally
8. ✅ Chat interface displays background task completion notifications

---

## 4. Data Flow and State Management

### 4.1 Event Delivery Flow

**Complete Event Lifecycle**:

```
1. Background Task Start
   claude-sdk.js: Detect run_in_background=true
   ↓
   Call monitorSubagentCompletion() or monitorBackgroundBash()
   ↓
   ws-clients.emitTaskEvent(sessionId, { type: 'background-task-started', task: {...} })
   ↓
   Store in pendingEvents + broadcast to all clients

2. Client Receive
   WebSocketContext receives message
   ↓
   BackgroundTasksPopover subscribe callback triggered
   ↓
   Send ACK: sendMessage({ type: 'ack-event', eventId, sessionId })
   ↓
   Deduplication check (seenEventsRef)
   ↓
   Update local state: setTasks(prev => [...prev, msg.task])

3. Server Acknowledgment
   ws-clients.ackEvent(sessionId, eventId)
   ↓
   Delete event from pendingEvents

4. Task Completion
   Monitoring function detects completion (fd reads RESULT or file size stable)
   ↓
   ws-clients.emitTaskEvent(sessionId, { type: 'background-task-completed', taskId })
   ↓
   Repeat steps 2-3

5. WebSocket Reconnection
   Client detects isConnected from false → true
   ↓
   Send sync-background-events request
   ↓
   Server calls ws-clients.syncPendingEvents()
   ↓
   Resend all unacknowledged events
   ↓
   Client deduplication processing (already processed events ignored)
```

### 4.2 State Management Architecture

**Server-side State**:

```javascript
// claude-sdk.js
const backgroundTasks = new Map();
// Structure: taskId → {
//   taskId: string,
//   toolName: 'Task' | 'Bash',
//   input: any,
//   sessionId: string | null,
//   startTime: number,
//   status: 'running' | 'monitoring' | 'completed' | 'terminating',
//   endTime?: number,
//   agentId?: string  // subagent only
// }

const backgroundTaskOutputs = new Map();
// Structure: taskId → string (cached output content)

// ws-clients.js
const pendingEvents = new Map();
// Structure: sessionId → Map<eventId, { data: any, createdAt: number }>
```

**Client-side State**:

```typescript
// BackgroundTasksPopover.tsx
const [tasks, setTasks] = useState<BackgroundTask[]>([]);
const [bashTasks, setBashTasks] = useState<BashTask[]>([]);
const [taskOutputs, setTaskOutputs] = useState<Map<string, TaskOutput>>(new Map());
const seenEventsRef = useRef(new Set<string>());
```

### 4.3 State Synchronization Strategy

**Problem**: How to recover task state after client refreshes page or reconnects?

**Solution**:
1. **Server Maintains Source of Truth**: `backgroundTasks` Map persisted on server (within process lifecycle)
2. **Proactive Sync on Reconnection**: Client sends `sync-background-events` request
3. **Deduplication Ensures Idempotency**: Use `eventId` and `seenEventsRef` to avoid duplicate processing

**Edge Cases**:
- If server restarts, `backgroundTasks` lost → Client-displayed tasks become stale
- Solution: Clear all pending events on server startup (current implementation includes this)

### 4.4 Output Caching Strategy

**Problem**: Task output may be large (thousands of lines), how to transmit efficiently?

**Solution**:
1. **Server-side Caching**: `backgroundTaskOutputs` Map stores complete output
2. **On-demand Query**: Client requests via `query-task-output`, specifying `maxLines`
3. **Truncation Marker**: Response includes `truncated: boolean` and `totalLines: number`

**Example Response**:
```json
{
  "type": "task-output",
  "taskId": "abc123",
  "output": {
    "content": "... (up to 200 lines) ...",
    "truncated": true,
    "totalLines": 1523,
    "skippedLines": 1323
  }
}
```

**Mobile Optimization**:
- Desktop: `maxLines = 200`
- Mobile: `maxLines = 50` (reduce transmission)

### 4.5 Monitor Lifecycle Management

**Problem**: How to avoid monitor leaks (still polling after task completion)?

**Solution**:
1. **Cleanup on Completion**: `clearInterval()` and delete from Map when task completes
2. **Timeout Protection**: Auto-stop monitoring after 1 hour (`setTimeout`)
3. **File Descriptor Closure**: Call `fs.closeSync(fd)` when stopping monitoring

**Code Example** (already implemented in feature branch):
```javascript
function monitorSubagentCompletion(agentId, toolUseId, ws) {
  const interval = setInterval(() => {
    // ... monitoring logic ...
    if (completed) {
      clearInterval(interval);
      subagentMonitors.delete(agentId);
      if (fd !== null) fs.closeSync(fd);
    }
  }, 2000);

  subagentMonitors.set(agentId, interval);

  // Force cleanup after 1 hour
  setTimeout(() => {
    if (subagentMonitors.has(agentId)) {
      clearInterval(interval);
      subagentMonitors.delete(agentId);
      if (fd !== null) fs.closeSync(fd);
    }
  }, 60 * 60 * 1000);
}
```

---

## 5. Error Handling and Edge Cases

### 5.1 File System Error Handling

**Scenario 1: Claude tasks directory doesn't exist**

```javascript
function findClaudeTasksDir() {
  const candidates = [
    '/tmp/claude/tasks/',
    path.join(os.homedir(), '.claude/tasks/')
  ];

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch (e) {
      // Permission error or invalid path, continue trying
    }
  }

  return null; // Directory not found
}
```

**Handling Strategy**:
- If returns `null`, monitoring function logs warning but doesn't crash
- Task status remains `running`, but won't receive completion notification
- User can manually terminate task

---

**Scenario 2: Output file deleted by CLI prematurely**

**Problem**: CLI may delete `.output` file path before task completion.

**Solution**: Use file descriptor (fd)
```javascript
let fd = null;

// 1. Wait for file to appear
if (fd === null && fs.existsSync(outputFile)) {
  fd = fs.openSync(outputFile, 'r');
}

// 2. Even if path deleted, fd remains valid
if (fd !== null) {
  const stat = fs.fstatSync(fd); // Doesn't depend on path
  const buffer = Buffer.alloc(stat.size);
  fs.readSync(fd, buffer, 0, stat.size, 0);
}
```

**Backup Strategy** (bash tasks):
- Also write to `~/.claude/task-outputs/` as persistent copy
- If fd fails, fallback to reading backup path

---

**Scenario 3: File read permission error**

```javascript
try {
  fd = fs.openSync(outputFile, 'r');
} catch (e) {
  if (e.code === 'EACCES') {
    console.error(`[MONITOR] Permission denied: ${outputFile}`);
    // Stop monitoring, mark task as failed
    emitTaskEvent(sessionId, {
      type: 'background-task-failed',
      taskId,
      error: 'Permission denied'
    });
    clearInterval(interval);
  }
}
```

---

### 5.2 WebSocket Error Handling

**Scenario 1: Client disconnects with unsent events**

**Handling Strategy**:
- Events already stored in `pendingEvents`, won't be lost
- Client sends `sync-background-events` request after reconnection
- Server resends all unacknowledged events

---

**Scenario 2: Client never sends ACK**

**Problem**: Malicious or buggy client may not send ACK, causing `pendingEvents` to grow indefinitely.

**Solution**: Periodically clean expired events
```javascript
// ws-clients.js
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, events] of pendingEvents) {
    for (const [eventId, { createdAt }] of events) {
      if (now - createdAt > PENDING_TTL_MS) {
        events.delete(eventId);
      }
    }
    if (events.size === 0) {
      pendingEvents.delete(sessionId);
    }
  }
}, SWEEP_INTERVAL_MS);
```

Configuration:
- `PENDING_TTL_MS = 60 * 60 * 1000` (1 hour)
- `SWEEP_INTERVAL_MS = 5 * 60 * 1000` (5 minutes)

---

**Scenario 3: Client connection closed when broadcasting message**

```javascript
function broadcastMessage(data) {
  const msg = JSON.stringify(data);
  connectedClients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(msg);
      } catch (e) {
        console.error('[WS] Send failed:', e.message);
        // Don't throw exception, continue sending to other clients
      }
    }
  });
}
```

---

### 5.3 Task Termination Error Handling

**Scenario: SDK doesn't support terminating individual background tasks**

**Current Limitation**: Claude Agent SDK 0.1.71 doesn't provide API to terminate individual background tasks.

**Implementation Strategy**:
```javascript
// index.js
case 'kill-background-task':
  const task = backgroundTasks.get(taskId);
  if (task) {
    // Only hide from UI, task continues running
    backgroundTasks.delete(taskId);
    backgroundTaskOutputs.delete(taskId);

    emitTaskEvent(task.sessionId, {
      type: 'background-task-deleted',
      taskId
    });
  }
  break;
```

**User Experience**:
- UI displays "Dismiss" instead of "Terminate"
- Tooltip explains: "Remove from list (task continues running)"

**Future Improvement**:
- If SDK supports termination API in future, update this logic
- For bash tasks, can terminate via PID (requires additional implementation)

---

### 5.4 Memory Leak Protection

**Scenario 1: Monitors not cleaned up**

**Protection Measures**:
1. Immediate cleanup on task completion: `clearInterval()` + `Map.delete()`
2. 1-hour timeout forced cleanup
3. Close file descriptor: `fs.closeSync(fd)`

---

**Scenario 2: Event deduplication Set grows indefinitely**

**Problem**: `seenEventsRef` grows indefinitely during client continuous operation.

**Solution**: Limit Set size
```typescript
if (seenEventsRef.current.has(msg.eventId)) return;
seenEventsRef.current.add(msg.eventId);

// Limit to 500, delete oldest 100 when exceeded
if (seenEventsRef.current.size > 500) {
  const iter = seenEventsRef.current.values();
  for (let i = 0; i < 100; i++) iter.next();
  const toKeep = new Set<string>();
  for (const v of iter) toKeep.add(v);
  seenEventsRef.current = toKeep;
}
```

---

**Scenario 3: Task output cache too large**

**Problem**: `backgroundTaskOutputs` may cache MB of output.

**Solution**:
1. Only cache recent output (e.g., last 10000 lines)
2. Auto-cleanup cache 1 hour after task completion
3. Auto-clear on server restart

**Implementation** (optional enhancement):
```javascript
function evictOldCompletedTasks() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  for (const [taskId, task] of backgroundTasks) {
    if (task.status === 'completed' && task.endTime && now - task.endTime > ONE_HOUR) {
      backgroundTasks.delete(taskId);
      backgroundTaskOutputs.delete(taskId);
    }
  }
}
```

---

### 5.5 Cross-platform Compatibility

**Scenario: Windows path differences**

**Problem**:
- Linux/macOS: `/tmp/claude/tasks/`
- Windows: `C:\Users\<user>\AppData\Local\Temp\claude\tasks\`

**Solution**: Use `os.tmpdir()` and `path.join()`
```javascript
const tasksDir = path.join(os.tmpdir(), 'claude', 'tasks');
```

**Already implemented in feature branch**, keep unchanged during migration.

---

### 5.6 Testing Verification Checklist

After migration completion, need to test following scenarios:

**Basic Functionality**:
- ✅ Start background subagent task, UI displays
- ✅ Start background bash task, UI displays
- ✅ After task completion, UI updates status
- ✅ View task output, content correct

**Error Handling**:
- ✅ Task directory doesn't exist, doesn't crash
- ✅ Output file deleted, still readable (fd)
- ✅ Client disconnects, events not lost

**State Recovery**:
- ✅ Refresh page, task list recovers
- ✅ WebSocket reconnects, incomplete tasks recover
- ✅ Deduplication effective, no duplicate processing

**Memory Management**:
- ✅ After task completion, monitor stops
- ✅ After 1 hour, expired events cleaned
- ✅ Long-term operation, no memory leak

**Cross-platform**:
- ✅ Windows paths correct
- ✅ Linux/macOS paths correct

---

## 6. Implementation Summary

### 6.1 Complete Migration Checklist

**Backend**:
- [ ] Copy `server/ws-clients.js` from feature branch
- [ ] Manually merge `server/claude-sdk.js`:
  - [ ] Add `backgroundTasks`, `backgroundTaskOutputs`, monitor Maps
  - [ ] Add `monitorSubagentCompletion()` function
  - [ ] Add `monitorBackgroundBash()` function
  - [ ] Insert monitoring trigger logic in `queryClaudeSDK()`
  - [ ] Update export list
- [ ] Modify `server/index.js`:
  - [ ] Import `ws-clients.js` functions
  - [ ] Import new exports from `claude-sdk.js`
  - [ ] Add WebSocket message handlers (query-task-output, kill-background-task, sync-background-events, ack-event)
  - [ ] Call `registerClient`/`unregisterClient` in connection lifecycle

**Frontend**:
- [ ] Copy `src/components/app/BackgroundTasksPopover.tsx`
- [ ] Copy `src/components/app/BackgroundTasksPage.tsx`
- [ ] Copy i18n files (4 languages)
- [ ] Modify `src/i18n/i18n.ts` to register namespace
- [ ] Modify `src/components/app/AppContent.tsx` to add route
- [ ] Modify `src/components/sidebar/Sidebar.tsx` to add entry
- [ ] Modify `src/components/chat/hooks/useChatRealtimeHandlers.ts` to handle events

**Verification**:
- [ ] `npm install`
- [ ] `npm run build` passes
- [ ] Manual testing: background tasks work
- [ ] WebSocket reconnection recovery works
- [ ] Run full testing checklist (Section 5.6)

### 6.2 Estimated Effort

- **Backend Migration**: 4-6 hours (manual merge + testing)
- **Frontend Migration**: 2-3 hours (component copy + path adjustment)
- **Testing & Verification**: 2-3 hours (functional testing + edge cases)
- **Total**: 8-12 hours

### 6.3 Risk Assessment

**Low Risk**:
- New file `ws-clients.js` (no conflicts)
- i18n files (no conflicts)
- Frontend components (minimal upstream changes)

**Medium Risk**:
- `claude-sdk.js` manual merge (large diff, need careful review)
- `index.js` WebSocket handlers (need to find correct insertion points)

**High Risk**:
- None identified (feature branch code already tested and working)

### 6.4 Success Criteria

Migration considered successful when:
1. All compilation errors resolved
2. Background tasks display in UI
3. Task completion notifications work
4. WebSocket reconnection recovery works
5. No memory leaks during long-term operation
6. All tests in checklist pass

---

## 7. Next Steps

After design approval:
1. Invoke `writing-plans` skill to create detailed implementation plan
2. Create feature branch `feat/background-tasks-management`
3. Execute migration following the plan
4. Submit PR to upstream with:
   - Clear description of functionality
   - Screenshots of UI
   - Testing evidence
   - Reference to this design document

---

**End of Design Document**
