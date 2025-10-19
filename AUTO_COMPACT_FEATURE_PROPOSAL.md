# Auto-Compact Feature Implementation Proposal for Claude Code UI

## Executive Summary

**Feasibility**: ✅ **HIGHLY FEASIBLE** - Implementation is straightforward with existing architecture

The Claude CLI auto-compact feature from infra-assist can be successfully integrated into claudecodeui. The UI already tracks token usage through stream-json output, making auto-compact monitoring and triggering a natural extension.

**Estimated Effort**: 2-3 days (16-24 hours development + testing)
**Complexity**: Medium
**Risk Level**: Low

## Current State Analysis

### claudecodeui Architecture

**Frontend (React + Vite)**:
- `src/components/ClaudeStatus.jsx`: Displays token count during Claude execution
- `src/components/ChatInterface.jsx`: Handles WebSocket messaging and status updates
- Token tracking: Parses `tokens` and `token_count` from stream-json status messages
- Current display: Shows real-time token usage during processing (e.g., "⚒ 1,234 tokens")

**Backend (Node.js + Express)**:
- `server/claude-cli.js`: Spawns Claude CLI with `--output-format stream-json`
- `server/index.js`: WebSocket server for real-time communication
- Streams Claude output events: `claude-status`, `session-created`, `claude-complete`, `claude-error`
- No current token budget monitoring or auto-compact logic

**Key Integration Points Identified**:
1. ✅ Token data already available via stream-json format
2. ✅ WebSocket infrastructure supports real-time notifications
3. ✅ UI component structure supports status banners and alerts
4. ✅ Backend can spawn additional Claude commands (e.g., `/context save`)

### infra-assist Auto-Compact Feature

**Trigger Conditions**:
- Automatic trigger when remaining tokens < 30,000 (out of 200,000 total)
- Before specialist handoffs
- Before complex operations
- At end of work sessions

**Workflow**:
1. Claude monitors system warnings: `<system_warning>Token usage: X/200000; Y remaining</system_warning>`
2. When threshold hit: Auto-executes `/context save` command
3. Notifies user: "⚡ Auto-compressed context (tokens: Y remaining) → Saved Z tokens → Continuing workflow"
4. Continues seamlessly without interruption

**Recovery**:
- User runs `/remind me about [project]` in new session to restore context

## Implementation Design

### Phase 1: Token Budget Monitoring (Backend)

**File**: `server/claude-cli.js`

**Add Token Parsing Logic**:
```javascript
// Constants
const TOKEN_BUDGET_TOTAL = 200000;
const TOKEN_WARNING_THRESHOLD = 30000;
const TOKEN_CRITICAL_THRESHOLD = 30000; // Auto-compact trigger

// Track token usage per session
const sessionTokenUsage = new Map();

function parseSystemWarnings(output) {
  // Parse: <system_warning>Token usage: X/200000; Y remaining</system_warning>
  const warningMatch = output.match(/Token usage: (\d+)\/(\d+); (\d+) remaining/);
  if (warningMatch) {
    return {
      used: parseInt(warningMatch[1]),
      total: parseInt(warningMatch[2]),
      remaining: parseInt(warningMatch[3])
    };
  }
  return null;
}

function shouldTriggerAutoCompact(sessionId, tokenData) {
  // Check if remaining tokens below critical threshold
  if (tokenData.remaining < TOKEN_CRITICAL_THRESHOLD) {
    // Check if we haven't auto-compacted recently (avoid loops)
    const lastCompact = sessionTokenUsage.get(sessionId)?.lastCompactTime;
    const now = Date.now();
    if (!lastCompact || (now - lastCompact) > 300000) { // 5 min cooldown
      return true;
    }
  }
  return false;
}
```

**Modify Claude Process Stream Handler**:
```javascript
claudeProcess.stdout.on('data', (data) => {
  const output = data.toString();

  // Parse token warnings
  const tokenData = parseSystemWarnings(output);
  if (tokenData) {
    // Send token budget update to frontend
    ws.send(JSON.stringify({
      type: 'token-budget-update',
      data: tokenData
    }));

    // Check if auto-compact should trigger
    if (shouldTriggerAutoCompact(sessionId, tokenData)) {
      triggerAutoCompact(sessionId, tokenData, ws);
    }
  }

  // ... existing stream-json parsing logic
});
```

**Auto-Compact Trigger Function**:
```javascript
async function triggerAutoCompact(sessionId, tokenData, ws) {
  console.log(`⚡ Auto-compact triggered for session ${sessionId}: ${tokenData.remaining} tokens remaining`);

  // Record compact time to prevent loops
  const sessionData = sessionTokenUsage.get(sessionId) || {};
  sessionData.lastCompactTime = Date.now();
  sessionTokenUsage.set(sessionId, sessionData);

  // Notify frontend
  ws.send(JSON.stringify({
    type: 'auto-compact-triggered',
    data: {
      sessionId,
      remainingTokens: tokenData.remaining,
      message: `⚡ Auto-compressing context (${tokenData.remaining} tokens remaining)...`
    }
  }));

  // Execute /context save command
  // Option 1: Spawn new Claude process with /context save
  // Option 2: Send instruction to current session (if supported)

  try {
    const compactResult = await executeContextSave(sessionId);

    ws.send(JSON.stringify({
      type: 'auto-compact-complete',
      data: {
        sessionId,
        tokensSaved: compactResult.tokensSaved,
        message: `✅ Context compressed → Saved ${compactResult.tokensSaved} tokens → Continuing workflow`
      }
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'auto-compact-error',
      data: {
        sessionId,
        error: error.message
      }
    }));
  }
}
```

### Phase 2: UI Token Budget Display (Frontend)

**File**: `src/components/TokenBudgetIndicator.jsx` (NEW)

```jsx
import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';

function TokenBudgetIndicator({ tokenData }) {
  if (!tokenData) return null;

  const { used, total, remaining } = tokenData;
  const percentage = (used / total) * 100;

  // Color coding based on remaining tokens
  const getStatusColor = () => {
    if (remaining < 30000) return 'text-red-500';
    if (remaining < 60000) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getBarColor = () => {
    if (remaining < 30000) return 'bg-red-500';
    if (remaining < 60000) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="px-4 py-2 bg-gray-900 dark:bg-gray-950 text-white rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">Token Budget</span>
        <span className={cn("text-xs font-medium", getStatusColor())}>
          {remaining.toLocaleString()} remaining
        </span>
      </div>

      <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className={cn("h-full transition-all duration-300", getBarColor())}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-400">
          {used.toLocaleString()} / {total.toLocaleString()} tokens used
        </span>
        <span className="text-xs text-gray-400">
          {percentage.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export default TokenBudgetIndicator;
```

**File**: `src/components/AutoCompactNotification.jsx` (NEW)

```jsx
import React, { useState, useEffect } from 'react';

function AutoCompactNotification({ notification, onDismiss }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (notification?.type === 'auto-compact-complete') {
      // Auto-dismiss after 5 seconds for success messages
      const timer = setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification, onDismiss]);

  if (!notification || !visible) return null;

  const getNotificationStyle = () => {
    switch (notification.type) {
      case 'auto-compact-triggered':
        return 'bg-blue-900 border-blue-500';
      case 'auto-compact-complete':
        return 'bg-green-900 border-green-500';
      case 'auto-compact-error':
        return 'bg-red-900 border-red-500';
      default:
        return 'bg-gray-900 border-gray-500';
    }
  };

  return (
    <div className={`fixed top-4 right-4 z-50 max-w-md p-4 rounded-lg border-2 ${getNotificationStyle()} text-white shadow-lg animate-in slide-in-from-top duration-300`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-medium">{notification.data?.message}</p>
          {notification.data?.tokensSaved && (
            <p className="text-sm text-gray-300 mt-1">
              Tokens saved: {notification.data.tokensSaved.toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={() => {
            setVisible(false);
            onDismiss?.();
          }}
          className="ml-4 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default AutoCompactNotification;
```

**File**: `src/components/ChatInterface.jsx` (MODIFY)

Add WebSocket event handlers for token budget and auto-compact notifications:

```javascript
// Add state for token budget and auto-compact notifications
const [tokenBudget, setTokenBudget] = useState(null);
const [autoCompactNotification, setAutoCompactNotification] = useState(null);

// In WebSocket message handler
useEffect(() => {
  // ... existing WebSocket setup

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case 'token-budget-update':
        setTokenBudget(message.data);
        break;

      case 'auto-compact-triggered':
      case 'auto-compact-complete':
      case 'auto-compact-error':
        setAutoCompactNotification(message);
        break;

      // ... existing cases
    }
  };
}, [/* deps */]);

// In render
return (
  <div className="flex flex-col h-full">
    {/* Token Budget Indicator */}
    {tokenBudget && (
      <div className="p-2 border-b border-gray-700">
        <TokenBudgetIndicator tokenData={tokenBudget} />
      </div>
    )}

    {/* Auto-Compact Notification */}
    <AutoCompactNotification
      notification={autoCompactNotification}
      onDismiss={() => setAutoCompactNotification(null)}
    />

    {/* Existing chat interface components */}
    {/* ... */}
  </div>
);
```

### Phase 3: Settings and Configuration

**File**: `src/components/Settings.jsx` (MODIFY)

Add auto-compact configuration options:

```jsx
// In Settings component state
const [autoCompactSettings, setAutoCompactSettings] = useState({
  enabled: true,
  threshold: 30000,
  showNotifications: true,
  autoResumeAfterCompact: true
});

// Settings UI
<div className="setting-section">
  <h3>Auto-Compact Settings</h3>

  <label className="flex items-center gap-2">
    <input
      type="checkbox"
      checked={autoCompactSettings.enabled}
      onChange={(e) => setAutoCompactSettings({
        ...autoCompactSettings,
        enabled: e.target.checked
      })}
    />
    <span>Enable automatic context compression</span>
  </label>

  <label>
    <span>Token threshold for auto-compact:</span>
    <input
      type="number"
      min="10000"
      max="100000"
      step="5000"
      value={autoCompactSettings.threshold}
      onChange={(e) => setAutoCompactSettings({
        ...autoCompactSettings,
        threshold: parseInt(e.target.value)
      })}
    />
    <span className="text-sm text-gray-400">
      (default: 30,000 tokens)
    </span>
  </label>

  <label className="flex items-center gap-2">
    <input
      type="checkbox"
      checked={autoCompactSettings.showNotifications}
      onChange={(e) => setAutoCompactSettings({
        ...autoCompactSettings,
        showNotifications: e.target.checked
      })}
    />
    <span>Show auto-compact notifications</span>
  </label>
</div>
```

### Phase 4: Context Save Command Implementation

**Option A: Spawn Separate Claude Process**

```javascript
async function executeContextSave(sessionId) {
  return new Promise((resolve, reject) => {
    const args = [
      '--resume', sessionId,
      '--output-format', 'stream-json',
      '--print', '/context save'
    ];

    const compactProcess = spawnFunction('claude', args, {
      cwd: projectPath,
      env: process.env
    });

    let compactOutput = '';

    compactProcess.stdout.on('data', (data) => {
      compactOutput += data.toString();
    });

    compactProcess.on('close', (code) => {
      if (code === 0) {
        // Parse output to extract tokens saved
        const tokensSaved = parseTokensSavedFromOutput(compactOutput);
        resolve({ tokensSaved });
      } else {
        reject(new Error(`Context save failed with code ${code}`));
      }
    });
  });
}
```

**Option B: Send Command to Current Session**

```javascript
async function executeContextSave(sessionId, currentProcess) {
  // Send /context save command to stdin of current Claude process
  currentProcess.stdin.write('/context save\n');

  // Listen for completion in existing stdout handler
  // This approach requires tracking compact completion in stream
}
```

## Implementation Phases

### Phase 1: Backend Token Monitoring (4-6 hours)
- [ ] Add token budget parsing from system warnings
- [ ] Implement token tracking per session
- [ ] Create auto-compact trigger logic with cooldown
- [ ] Add WebSocket events for token budget updates
- [ ] Test token parsing with Claude CLI stream-json output

### Phase 2: UI Components (4-6 hours)
- [ ] Create `TokenBudgetIndicator.jsx` component
- [ ] Create `AutoCompactNotification.jsx` component
- [ ] Integrate components into `ChatInterface.jsx`
- [ ] Add WebSocket message handlers for token events
- [ ] Style components for mobile and desktop

### Phase 3: Context Save Execution (3-4 hours)
- [ ] Implement `executeContextSave()` function
- [ ] Choose spawn approach (separate process vs stdin)
- [ ] Parse tokens saved from compact output
- [ ] Handle errors and edge cases
- [ ] Test context save and resume workflow

### Phase 4: Settings and Configuration (2-3 hours)
- [ ] Add auto-compact settings to Settings component
- [ ] Persist settings in localStorage
- [ ] Pass settings to backend via API
- [ ] Implement threshold configuration
- [ ] Add notification preferences

### Phase 5: Testing and Refinement (3-4 hours)
- [ ] Test with real Claude CLI sessions
- [ ] Verify auto-compact triggers at threshold
- [ ] Test cooldown prevents loops
- [ ] Verify context resume after compact
- [ ] Test mobile and desktop UI
- [ ] Handle edge cases (network errors, process crashes)

## Technical Challenges and Solutions

### Challenge 1: Parsing System Warnings
**Problem**: System warnings may not be in stream-json format
**Solution**: Use regex parsing on raw stdout before JSON parsing

### Challenge 2: Context Save Timing
**Problem**: Auto-compact must not interrupt active Claude responses
**Solution**: Queue auto-compact until `claude-complete` event, or use cooldown period

### Challenge 3: Session Continuity
**Problem**: Context save creates new session ID
**Solution**: Track session ID changes and update frontend session reference

### Challenge 4: Multiple Concurrent Sessions
**Problem**: UI supports multiple sessions, each may need auto-compact
**Solution**: Use `Map` to track token usage per session ID

### Challenge 5: Token Budget Persistence
**Problem**: Token budget resets on page reload
**Solution**: Store token budget in sessionStorage or backend database

## Success Criteria

1. ✅ Token budget displays in UI during Claude sessions
2. ✅ Auto-compact triggers automatically when < 30,000 tokens remain
3. ✅ User receives clear notification when auto-compact occurs
4. ✅ Context successfully compresses and saves
5. ✅ User can configure auto-compact threshold in settings
6. ✅ Auto-compact has cooldown to prevent loops
7. ✅ Mobile and desktop UI both support token budget display
8. ✅ Session continues seamlessly after auto-compact

## Benefits

**For Users**:
- Never lose context due to token exhaustion
- Transparent token budget awareness
- Seamless long-running sessions
- Mobile-friendly token monitoring

**For Developers**:
- Reusable token budget component
- Clean WebSocket event architecture
- Configurable thresholds
- Extensible for other automation features

## Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| System warnings format changes | High | Low | Version-specific parsing with fallbacks |
| Auto-compact loops | Medium | Medium | Cooldown period (5 min) + tracking |
| Context save fails | High | Low | Error handling + user notification |
| Token parsing accuracy | Medium | Low | Comprehensive testing with real sessions |
| Performance impact | Low | Low | Lightweight parsing, async operations |

## Future Enhancements

1. **Token Budget History**: Graph showing token usage over session lifetime
2. **Predictive Auto-Compact**: ML-based prediction of when to compact
3. **Multi-Level Compression**: Configurable compression levels (light, medium, aggressive)
4. **Context Recovery UI**: Browse and restore previous compressed contexts
5. **Token Usage Analytics**: Per-project token usage statistics
6. **Shared Context**: Team collaboration with shared compressed contexts

## Conclusion

The auto-compact feature is **highly feasible** for claudecodeui. The existing architecture provides all necessary integration points:

- ✅ Token data already streamed via stream-json
- ✅ WebSocket infrastructure for real-time updates
- ✅ UI component structure supports new features
- ✅ Backend can execute Claude commands

**Recommendation**: **PROCEED WITH IMPLEMENTATION**

This feature will significantly enhance user experience for long-running Claude sessions, especially on mobile devices where token budget awareness is critical.

---

**Next Steps**:
1. Review this proposal with project stakeholders
2. Create feature branch: `feat/auto-compact-token-monitoring`
3. Begin Phase 1 implementation (backend token monitoring)
4. Iterate with user testing after Phase 2 (UI components)
5. Release as beta feature with opt-in flag
6. Gather feedback and refine before full release

**Estimated Timeline**: 2-3 weeks (including testing and refinement)
**Priority**: Medium-High (valuable feature for power users)
