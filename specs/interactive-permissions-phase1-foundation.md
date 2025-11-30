# Feature: Interactive Permissions - Phase 1 Foundation

## Feature Description
Implement the core backend infrastructure for interactive permissions by integrating the Claude Code SDK's `canUseTool` callback mechanism. This phase establishes the foundation for permission interception, request queuing, and async response handling. The implementation will hook into the existing SDK integration to capture tool usage requests and create a promise-based system for awaiting user decisions.

## User Story
As a system administrator
I want the backend to intercept and queue permission requests
So that tool operations can be reviewed before execution

## Problem Statement
The current implementation in `server/claude-sdk.js` completely bypasses the SDK's permission system by not implementing the `canUseTool` callback. This means:
- No ability to intercept tool usage requests
- No mechanism to pause execution for user review
- No infrastructure for permission decision handling
- All operations execute immediately without review

## Solution Statement
Implement the `canUseTool` callback in the SDK configuration to:
- Intercept all tool usage requests from Claude
- Create a promise-based queue for pending permissions
- Handle async user responses with proper timeout management
- Return properly formatted permission results to the SDK
- Maintain compatibility with existing bypass modes

## Relevant Files
Use these files to implement the feature:

- `server/claude-sdk.js` - Main SDK integration file where canUseTool will be implemented
- `server/index.js` - WebSocket server that will handle permission messages
- `package.json` - May need to add UUID library for request IDs

### New Files
- `server/services/permissionManager.js` - Core permission queue and handling logic
- `server/services/permissionTypes.js` - TypeScript-style type definitions and constants

## Implementation Plan
### Phase 1: Foundation
Create the permission manager service and basic queue infrastructure

### Phase 2: Core Implementation
Implement canUseTool callback and integrate with SDK

### Phase 3: Integration
Connect permission manager with WebSocket for frontend communication

## Step by Step Tasks

### Create Permission Manager Service
- Create `server/services/permissionManager.js` with PermissionManager class
- Implement request queue with Map structure for O(1) lookups
- Add Promise-based response handling with resolve/reject callbacks
- Implement 30-second timeout with auto-deny behavior
- Add abort signal support from SDK
- Create method to add permission requests to queue
- Create method to resolve permission requests with user decision
- Add queue status methods (getPending, clearExpired)

### Define Permission Types and Constants
- Create `server/services/permissionTypes.js` with type definitions
- Define PermissionRequest structure (id, toolName, input, timestamp, resolver, rejector)
- Define PermissionResponse structure (behavior, updatedInput, updatedPermissions)
- Define PermissionDecision enum (allow, deny, allow-session, allow-always)
- Add permission timeout constant (30000ms)
- Define risk levels for different tool types
- Create tool category mappings

### Implement canUseTool Callback
- Modify `server/claude-sdk.js` to import PermissionManager
- Create singleton instance of PermissionManager
- Add canUseTool to SDK options configuration
- Implement permission mode check (bypass if in bypassPermissions mode)
- Generate unique request ID using crypto.randomUUID()
- Create permission request object with tool details
- Add request to queue and await response
- Handle abort signal from SDK
- Format and return permission result

### Add Basic WebSocket Handlers
- Modify `server/index.js` to import PermissionManager
- Add handler for 'permission-response' message type
- Parse response and validate request ID exists
- Call PermissionManager.resolveRequest with decision
- Add error handling for invalid responses
- Send acknowledgment back to frontend

### Implement Permission Mode Integration
- Check current permission mode before processing
- Skip canUseTool for bypassPermissions mode
- Auto-allow Read operations in acceptEdits mode
- Auto-allow Write/Edit operations in acceptEdits mode
- Apply plan mode restrictions (limited tools only)

### Add Logging and Debugging
- Add detailed logging for permission requests
- Log tool name, input preview, and decision
- Create debug mode flag for verbose output
- Add performance timing logs
- Implement error logging with stack traces

### Create Unit Tests
- Test PermissionManager queue operations
- Test timeout behavior (auto-deny after 30s)
- Test abort signal handling
- Test permission mode integration
- Test WebSocket message handling
- Test error scenarios and edge cases

### Add Configuration Support
- Add permission configuration to settings
- Support default timeout configuration
- Add option to disable permissions globally
- Support tool-specific timeout overrides
- Add configuration validation

### Implement Graceful Degradation
- Handle case where frontend is not connected
- Auto-deny if no WebSocket connection
- Add fallback to console-based approval (for testing)
- Ensure system doesn't hang on permission timeout
- Add circuit breaker for repeated timeouts

## Testing Strategy
### Unit Tests
- PermissionManager class methods (add, resolve, timeout)
- canUseTool callback with various inputs
- Permission mode behavior (bypass, acceptEdits, plan)
- WebSocket message handling
- Timeout and abort scenarios

### Integration Tests
- Full flow from SDK request to response
- Multiple concurrent permission requests
- Queue management under load
- WebSocket connection/disconnection handling
- Mode switching during active requests

### Edge Cases
- Timeout during pending request
- Abort signal triggered mid-request
- Invalid permission response format
- WebSocket disconnection during request
- Rapid successive requests for same tool
- Memory leaks from unresolved promises

## Acceptance Criteria
- [ ] canUseTool callback intercepts all tool usage requests
- [ ] Permission requests are queued with unique IDs
- [ ] Requests timeout after 30 seconds with auto-deny
- [ ] Abort signals from SDK are properly handled
- [ ] Permission modes are correctly applied
- [ ] WebSocket handlers process responses correctly
- [ ] No memory leaks from pending promises
- [ ] System remains stable under load
- [ ] Backward compatibility with bypass mode maintained
- [ ] All tests pass with 100% coverage

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

```bash
# Run existing tests to ensure no regressions
npm test

# Test the permission manager in isolation
node -e "const PM = require('./server/services/permissionManager'); const pm = new PM(); console.log(pm.getPendingCount());"

# Start server with debug logging
DEBUG=permissions npm run server

# Test with different permission modes
# In one terminal:
npm run server

# In another terminal, test each mode:
curl -X POST http://localhost:3000/api/settings -H "Content-Type: application/json" -d '{"permissionMode":"default"}'
curl -X POST http://localhost:3000/api/settings -H "Content-Type: application/json" -d '{"permissionMode":"bypassPermissions"}'

# Monitor WebSocket messages (requires wscat)
wscat -c ws://localhost:3000

# Check for memory leaks
npm run test:memory

# Verify no TypeScript/linting errors
npm run lint
```

## Notes
- This phase creates the foundation but won't have a UI yet
- Console logging will be used for debugging permission requests
- The system will auto-deny all requests until Phase 2 (WebSocket) is complete
- Consider adding a temporary console-based approval for testing
- Ensure all promises are properly handled to prevent memory leaks
- The permission manager should be stateless and restart-safe
- Future phases will add persistence and pattern matching