---
id: "012"
title: "Missing authorization check on permission responses"
priority: P2
category: security
status: pending
created: 2024-01-29
source: code-review
files:
  - server/services/permissionWebSocketHandler.js
---

# Missing Authorization Check on Permission Responses

## Problem
The `handlePermissionResponse` method (lines 107-128) accepts responses from any connected client without verifying:
1. The client is authorized to respond to this request
2. The request belongs to the client's session
3. The request hasn't already been resolved

A malicious client could potentially respond to other clients' permission requests.

## Location
- `server/services/permissionWebSocketHandler.js:107-128` - `handlePermissionResponse()`

## Risk
- **Severity**: HIGH
- **Impact**: Permission hijacking across sessions
- **Prerequisite**: Malicious client connection

## Recommended Fix
Add authorization verification:

```javascript
handlePermissionResponse(clientId, message) {
  try {
    validatePermissionResponse(message);

    // Verify request exists and belongs to this client/session
    const request = this.permissionManager.getRequest(message.requestId);
    if (!request) {
      throw new Error('Request not found or already resolved');
    }

    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error('Client not found');
    }

    // Verify the client's session matches the request's session
    if (request.sessionId && client.sessionId !== request.sessionId) {
      throw new Error('Unauthorized: request belongs to different session');
    }

    // Verify request is in client's pending set
    if (!client.pendingRequests.has(message.requestId)) {
      throw new Error('Request not pending for this client');
    }

    // ... rest of handling
  } catch (error) {
    console.error('Permission response rejected:', error.message);
    this.sendError(clientId, message.requestId, error.message);
  }
}
```
