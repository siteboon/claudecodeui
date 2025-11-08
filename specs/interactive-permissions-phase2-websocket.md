# Feature: Interactive Permissions - Phase 2 WebSocket Communication

## Feature Description
Establish real-time bidirectional communication between the backend permission system and the frontend UI using WebSocket. This phase implements the message protocol for permission requests and responses, enabling the frontend to receive permission requests, display them to users, and send back decisions. The implementation will extend the existing WebSocket infrastructure to handle permission-specific messages while maintaining compatibility with current chat functionality.

## User Story
As a frontend developer
I want to receive permission requests via WebSocket and send responses
So that users can review and approve/deny operations in real-time

## Problem Statement
Phase 1 created the backend permission infrastructure, but without frontend communication:
- Permission requests are queued but not sent to the UI
- No way for users to see pending permission requests
- No mechanism to send user decisions back to the backend
- Requests timeout with auto-deny since no responses are possible
- No real-time updates about permission queue status

## Solution Statement
Implement WebSocket message handlers and protocol to:
- Broadcast permission requests to connected clients
- Receive and process permission responses from the frontend
- Handle connection state and recovery
- Provide queue status updates
- Support request cancellation and timeout notifications
- Maintain message ordering and delivery guarantees

## Relevant Files
Use these files to implement the feature:

- `server/index.js` - Main WebSocket server implementation
- `server/services/permissionManager.js` - Permission manager from Phase 1
- `server/claude-sdk.js` - SDK integration that generates requests
- `src/components/ChatInterface.jsx` - Frontend WebSocket client
- `src/contexts/WebSocketContext.jsx` - WebSocket context provider

### New Files
- `server/services/permissionWebSocketHandler.js` - Dedicated WebSocket handler for permissions
- `src/utils/permissionWebSocketClient.js` - Frontend permission message handling

## Implementation Plan
### Phase 1: Foundation
Define message protocol and types

### Phase 2: Core Implementation
Implement WebSocket handlers for permission messages

### Phase 3: Integration
Connect frontend to receive and respond to permission requests

## Step by Step Tasks

### Define WebSocket Message Protocol
- Create permission message type constants in `server/services/permissionTypes.js`
- Define `permission-request` message structure (type, id, toolName, input, context, timestamp)
- Define `permission-response` message structure (type, requestId, decision, updatedInput)
- Define `permission-timeout` message structure (type, requestId, toolName)
- Define `permission-queue-status` message structure (type, pending, processing)
- Add message validation schemas
- Document message flow diagram

### Create Permission WebSocket Handler
- Create `server/services/permissionWebSocketHandler.js`
- Implement PermissionWebSocketHandler class
- Add method to broadcast permission requests to all clients
- Add method to handle permission responses from clients
- Implement client connection tracking
- Add reconnection handling for dropped connections
- Implement message queuing for offline clients
- Add error handling and retry logic

### Integrate with Permission Manager
- Modify `server/services/permissionManager.js` to emit events
- Add EventEmitter inheritance to PermissionManager
- Emit 'permission-request' event when request added
- Emit 'permission-timeout' event on timeout
- Emit 'permission-resolved' event on resolution
- Connect WebSocket handler to permission events
- Add WebSocket handler initialization in server startup

### Update Backend WebSocket Server
- Modify `server/index.js` WebSocket connection handler
- Import and initialize PermissionWebSocketHandler
- Add message type routing for permission messages
- Handle 'permission-response' messages from frontend
- Add connection state tracking per client
- Implement heartbeat/ping-pong for connection health
- Add graceful shutdown handling
- Add metrics logging for permission messages

### Implement Frontend WebSocket Client
- Create `src/utils/permissionWebSocketClient.js`
- Implement PermissionWebSocketClient class
- Add methods to handle incoming permission requests
- Add method to send permission responses
- Implement request queue for offline handling
- Add reconnection logic with exponential backoff
- Handle connection state changes
- Add request timeout tracking

### Update ChatInterface WebSocket Handling
- Modify `src/components/ChatInterface.jsx`
- Import PermissionWebSocketClient utilities
- Add handler for 'permission-request' messages
- Store pending requests in component state
- Add handler for 'permission-timeout' messages
- Implement response sending on user decision
- Add connection status indicator
- Handle message ordering and deduplication

### Add WebSocket Context Integration
- Update `src/contexts/WebSocketContext.jsx`
- Add permission message handlers to context
- Expose permission-specific methods
- Add permission queue state to context
- Implement queue status updates
- Add connection health monitoring
- Provide hooks for permission handling

### Implement Message Reliability
- Add message acknowledgment system
- Implement retry logic for failed sends
- Add sequence numbers for ordering
- Handle duplicate message detection
- Implement message persistence for recovery
- Add circuit breaker for repeated failures
- Create health check endpoint

### Add Frontend State Management
- Create permission request queue in React state
- Implement queue operations (add, remove, update)
- Add optimistic updates for responses
- Handle race conditions between requests
- Implement request expiration in UI
- Add loading states for pending responses
- Create error recovery mechanisms

### Create Integration Tests
- Test full flow from request to response
- Test multiple concurrent requests
- Test connection drop and recovery
- Test message ordering preservation
- Test timeout handling
- Test error scenarios
- Test high load conditions

## Testing Strategy
### Unit Tests
- WebSocket message parsing and validation
- Permission handler methods
- Message queuing and retry logic
- Connection state management
- Event emission and handling

### Integration Tests
- End-to-end permission flow via WebSocket
- Multiple client connections
- Connection recovery scenarios
- Message ordering under concurrent requests
- Timeout and cancellation handling
- Load testing with many requests

### Edge Cases
- WebSocket connection drops during request
- Multiple responses for same request
- Malformed message handling
- Client reconnection with pending requests
- Server restart with active requests
- Network partitioning scenarios
- Race conditions in response handling

## Acceptance Criteria
- [ ] Permission requests are sent to frontend via WebSocket
- [ ] Frontend can send permission responses back
- [ ] Connection drops are handled gracefully
- [ ] Messages maintain correct ordering
- [ ] Timeouts are communicated to frontend
- [ ] Queue status updates are real-time
- [ ] No message loss during reconnection
- [ ] System handles high message volume
- [ ] Error states are properly communicated
- [ ] All existing WebSocket functionality still works

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

```bash
# Run existing tests to ensure no regressions
npm test

# Start server with WebSocket debug logging
DEBUG=websocket,permissions npm run server

# Test WebSocket connection
wscat -c ws://localhost:3000

# Send test permission response (in wscat)
{"type":"permission-response","requestId":"test-123","decision":"allow"}

# Monitor WebSocket messages in browser console
# Open browser DevTools and run:
# ws = new WebSocket('ws://localhost:3000')
# ws.onmessage = (e) => console.log('WS:', JSON.parse(e.data))

# Test connection recovery
# 1. Start server
# 2. Connect client
# 3. Kill server (Ctrl+C)
# 4. Restart server
# 5. Verify client reconnects

# Load test WebSocket with multiple connections
npm run test:websocket-load

# Check for memory leaks in WebSocket handling
npm run test:memory-websocket

# Verify message ordering
node scripts/test-permission-ordering.js

# Test with network throttling
# Use browser DevTools Network tab to simulate slow connection

# Verify no regressions in chat functionality
npm run test:chat
```

## Notes
- This phase enables communication but doesn't include the UI dialog yet
- Use browser console to manually send permission responses for testing
- WebSocket messages should be kept small for performance
- Consider implementing compression for large input parameters
- Message batching might be needed for high-volume scenarios
- Ensure backward compatibility with existing WebSocket messages
- Future phases will add the actual UI components
- Consider adding WebSocket subprotocol for versioning