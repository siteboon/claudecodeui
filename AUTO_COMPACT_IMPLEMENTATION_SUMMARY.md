# Auto-Compact Feature - Quick Implementation Guide

## TL;DR

**✅ FEASIBLE** - The Claude CLI auto-compact feature can be successfully integrated into claudecodeui.

**Effort**: 2-3 days development
**Complexity**: Medium
**Risk**: Low

## What is Auto-Compact?

Auto-compact automatically compresses Claude's conversation context when token usage approaches the limit (< 30,000 remaining out of 200,000 total). This prevents context loss and enables seamless long-running sessions.

**From infra-assist CLAUDE.md**:
```
When tokens < 30,000: Claude AUTOMATICALLY executes /context save
→ Notifies user: "⚡ Auto-compressed context → Saved X tokens → Continuing"
→ Session continues seamlessly
```

## Current State of claudecodeui

### ✅ Already Has
- Token tracking via stream-json output
- Real-time token display in UI (`ClaudeStatus.jsx`)
- WebSocket infrastructure for live updates
- Claude CLI spawning and management

### ❌ Missing
- Token budget monitoring (total vs remaining)
- Auto-compact trigger logic
- `/context save` command execution
- User notifications for auto-compact events
- Settings for auto-compact configuration

## Implementation Overview

### 1. Backend Changes (server/claude-cli.js)

**Add Token Budget Parsing**:
```javascript
// Parse system warnings from Claude output
function parseSystemWarnings(output) {
  // Match: <system_warning>Token usage: 95000/200000; 105000 remaining</system_warning>
  const match = output.match(/Token usage: (\d+)\/(\d+); (\d+) remaining/);
  return match ? {
    used: parseInt(match[1]),
    total: parseInt(match[2]),
    remaining: parseInt(match[3])
  } : null;
}
```

**Add Auto-Compact Trigger**:
```javascript
function shouldTriggerAutoCompact(tokenData) {
  return tokenData.remaining < 30000;
}

async function triggerAutoCompact(sessionId, ws) {
  // Notify frontend
  ws.send(JSON.stringify({
    type: 'auto-compact-triggered',
    data: { message: '⚡ Auto-compressing context...' }
  }));

  // Execute /context save
  await executeContextSave(sessionId);

  // Notify completion
  ws.send(JSON.stringify({
    type: 'auto-compact-complete',
    data: { message: '✅ Context compressed → Continuing workflow' }
  }));
}
```

### 2. Frontend Changes (src/components/)

**New Component: TokenBudgetIndicator.jsx**
```jsx
// Display token budget with progress bar
<TokenBudgetIndicator tokenData={{
  used: 95000,
  total: 200000,
  remaining: 105000
}} />
```

**New Component: AutoCompactNotification.jsx**
```jsx
// Toast notification for auto-compact events
<AutoCompactNotification
  notification={{
    type: 'auto-compact-complete',
    data: { message: '✅ Context compressed', tokensSaved: 85000 }
  }}
/>
```

**Modified: ChatInterface.jsx**
```jsx
// Add WebSocket handlers for token budget and auto-compact
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  switch (message.type) {
    case 'token-budget-update':
      setTokenBudget(message.data);
      break;
    case 'auto-compact-triggered':
    case 'auto-compact-complete':
      setAutoCompactNotification(message);
      break;
  }
};
```

### 3. Settings (src/components/Settings.jsx)

**Add Configuration Options**:
```jsx
<div className="auto-compact-settings">
  <label>
    <input type="checkbox" checked={autoCompactEnabled} />
    Enable automatic context compression
  </label>

  <label>
    Token threshold:
    <input type="number" value={threshold} min="10000" max="100000" />
  </label>

  <label>
    <input type="checkbox" checked={showNotifications} />
    Show auto-compact notifications
  </label>
</div>
```

## Key Integration Points

| Component | Change | Purpose |
|-----------|--------|---------|
| `server/claude-cli.js` | Parse system warnings | Extract token budget from Claude output |
| `server/claude-cli.js` | Add auto-compact trigger | Execute `/context save` when threshold hit |
| `src/components/TokenBudgetIndicator.jsx` | NEW | Display token budget with progress bar |
| `src/components/AutoCompactNotification.jsx` | NEW | Toast notifications for auto-compact events |
| `src/components/ChatInterface.jsx` | Add WebSocket handlers | Receive token budget and auto-compact events |
| `src/components/Settings.jsx` | Add auto-compact settings | User configuration for thresholds |

## Implementation Phases

### Phase 1: Backend Token Monitoring (4-6 hours)
1. Parse system warnings for token budget
2. Track token usage per session
3. Implement auto-compact trigger with cooldown
4. Send token budget updates via WebSocket

### Phase 2: UI Components (4-6 hours)
1. Create `TokenBudgetIndicator` component
2. Create `AutoCompactNotification` component
3. Integrate into `ChatInterface`
4. Style for mobile and desktop

### Phase 3: Context Save Execution (3-4 hours)
1. Implement `/context save` execution
2. Parse tokens saved from output
3. Handle errors gracefully
4. Test context resume workflow

### Phase 4: Settings (2-3 hours)
1. Add auto-compact settings UI
2. Persist settings in localStorage
3. Pass settings to backend
4. Test configuration changes

### Phase 5: Testing (3-4 hours)
1. Test with real Claude sessions
2. Verify auto-compact at threshold
3. Test cooldown prevents loops
4. Verify mobile and desktop UI

**Total Estimated Time**: 16-23 hours (2-3 days)

## Testing Checklist

- [ ] Token budget displays correctly during Claude execution
- [ ] Auto-compact triggers when < 30,000 tokens remain
- [ ] User receives notification when auto-compact occurs
- [ ] Context successfully saves and compresses
- [ ] Session continues after auto-compact
- [ ] Cooldown prevents auto-compact loops
- [ ] Settings persist across sessions
- [ ] Mobile UI displays token budget correctly
- [ ] Desktop UI displays token budget correctly
- [ ] Error handling works for failed compacts

## Example User Experience

**Before Auto-Compact**:
```
User: [working on long project]
Claude: [responds... responds... responds...]
[Token limit reached - conversation stops]
User: 😞 Lost all context
```

**After Auto-Compact**:
```
User: [working on long project]
Claude: [responds... responds...]
UI: ⚡ Auto-compressing context (28,000 tokens remaining)...
UI: ✅ Context compressed → Saved 85,000 tokens → Continuing workflow
Claude: [continues seamlessly]
User: 😊 No interruption!
```

## Files to Create/Modify

**New Files**:
- `src/components/TokenBudgetIndicator.jsx`
- `src/components/AutoCompactNotification.jsx`
- `AUTO_COMPACT_FEATURE_PROPOSAL.md` (this document)
- `AUTO_COMPACT_IMPLEMENTATION_SUMMARY.md` (quick reference)

**Modified Files**:
- `server/claude-cli.js` (token parsing, auto-compact logic)
- `src/components/ChatInterface.jsx` (WebSocket handlers, UI integration)
- `src/components/Settings.jsx` (auto-compact configuration)

## Next Steps

1. ✅ Review feature proposal and implementation plan
2. Create feature branch: `git checkout -b feat/auto-compact-token-monitoring`
3. Implement Phase 1 (backend token monitoring)
4. Implement Phase 2 (UI components)
5. Implement Phase 3 (context save execution)
6. Implement Phase 4 (settings)
7. Test thoroughly with real Claude sessions
8. Create pull request for review
9. Deploy as beta feature with opt-in flag
10. Gather user feedback and refine

## Questions?

See full proposal: `AUTO_COMPACT_FEATURE_PROPOSAL.md`

**Recommendation**: **Proceed with implementation** - This feature significantly enhances claudecodeui for long-running sessions and aligns with infra-assist's proven auto-compact workflow.
