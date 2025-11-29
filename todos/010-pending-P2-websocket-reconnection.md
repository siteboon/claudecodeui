---
id: "010"
title: "No WebSocket reconnection logic"
priority: P2
category: reliability
status: pending
created: 2024-01-29
source: code-review
files:
  - src/utils/permissionWebSocketClient.js
  - src/contexts/WebSocketContext.jsx
---

# No WebSocket Reconnection Logic

## Problem
When the WebSocket connection drops:
1. No automatic reconnection attempt
2. Permission requests during disconnect are lost
3. User must manually refresh to restore connection
4. No exponential backoff strategy

## Locations
- `src/utils/permissionWebSocketClient.js` - Client connection handling
- `src/contexts/WebSocketContext.jsx` - Connection state management

## Risk
- **Severity**: HIGH
- **Impact**: Lost permissions during network issues
- **User Experience**: Poor - requires manual refresh

## Recommended Fix
Implement reconnection with exponential backoff:

```javascript
class WebSocketClient {
  constructor() {
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.baseDelay = 1000;
    this.maxDelay = 30000;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.emit('connected');
    };

    this.ws.onclose = (event) => {
      if (!event.wasClean) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect-failed');
      return;
    }

    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.reconnectAttempts),
      this.maxDelay
    );

    this.reconnectAttempts++;
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    setTimeout(() => this.connect(), delay);
  }
}
```
