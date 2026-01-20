# Orchestrator Client Mode

Orchestrator client mode enables Claude Code UI instances to connect to a central orchestrator server ([Duratii](https://github.com/Epiphytic/duratii)) for remote access and management. Users can access their Claude Code UI instances from anywhere through a unified web interface, with automatic authentication pass-through and real-time status reporting.

## Overview

When running Claude Code UI on multiple machines (development servers, remote workstations, etc.), orchestrator mode provides:

- Access all instances from a single dashboard
- Authenticate once at the orchestrator level
- View real-time status (idle/active/busy) of each instance
- Use the full web interface through a reverse proxy

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────────┐
│  claudecodeui   │────▶│         Orchestrator Server                  │
│   instance 1    │     │  (Cloudflare Workers + Durable Objects)      │
└─────────────────┘     │                                              │
                        │  - WebSocket hub per user                    │
┌─────────────────┐     │  - HTTP proxy to instances                   │
│  claudecodeui   │────▶│  - GitHub OAuth authentication               │
│   instance 2    │     │  - Real-time status dashboard                │
└─────────────────┘     │                                              │
                        └──────────────────────────────────────────────┘
     ┌──────────┐                          │
     │ Browser  │◀─────────────────────────┘
     │ (User)   │    (Single entry point for all instances)
     └──────────┘
```

## Configuration

### Environment Variables

Add these to your `.env` file to enable orchestrator client mode:

```bash
# Orchestrator mode: 'standalone' (default) or 'client'
ORCHESTRATOR_MODE=client

# Orchestrator WebSocket URL
ORCHESTRATOR_URL=wss://orchestrator.example.com/ws/connect

# Authentication token from orchestrator dashboard
ORCHESTRATOR_TOKEN=your-token-here

# Optional: Custom client ID (defaults to hostname-pid)
ORCHESTRATOR_CLIENT_ID=my-dev-machine

# Optional: Reconnection interval in milliseconds (default: 5000)
ORCHESTRATOR_RECONNECT_INTERVAL=5000

# Optional: Heartbeat interval in milliseconds (default: 30000)
ORCHESTRATOR_HEARTBEAT_INTERVAL=30000

# Pass-through auth: restrict which GitHub users can access
ORCHESTRATOR_GITHUB_ORG=your-org
ORCHESTRATOR_GITHUB_TEAM=your-org/your-team
ORCHESTRATOR_GITHUB_USERS=user1,user2
```

### Configuration Options

| Variable                          | Required | Default      | Description                                              |
| --------------------------------- | -------- | ------------ | -------------------------------------------------------- |
| `ORCHESTRATOR_MODE`               | No       | `standalone` | Set to `client` to enable orchestrator mode              |
| `ORCHESTRATOR_URL`                | Yes\*    | -            | WebSocket URL of the orchestrator server                 |
| `ORCHESTRATOR_TOKEN`              | Yes\*    | -            | Authentication token from orchestrator dashboard         |
| `ORCHESTRATOR_CLIENT_ID`          | No       | hostname-pid | Unique identifier for this instance                      |
| `ORCHESTRATOR_RECONNECT_INTERVAL` | No       | 5000         | Milliseconds between reconnection attempts               |
| `ORCHESTRATOR_HEARTBEAT_INTERVAL` | No       | 30000        | Milliseconds between heartbeat pings                     |
| `ORCHESTRATOR_GITHUB_ORG`         | No       | -            | GitHub organization for access control                   |
| `ORCHESTRATOR_GITHUB_TEAM`        | No       | -            | GitHub team (format: `org/team-slug`) for access control |
| `ORCHESTRATOR_GITHUB_USERS`       | No       | -            | Comma-separated list of allowed GitHub usernames         |

\*Required when `ORCHESTRATOR_MODE=client`

## Features

### WebSocket Connection

The orchestrator client maintains a persistent WebSocket connection with:

- **Automatic reconnection** - Reconnects with exponential backoff when disconnected
- **Heartbeat monitoring** - Sends periodic pings to detect connection issues
- **Graceful degradation** - Falls back to standalone mode if orchestrator is unavailable

### HTTP Proxy Support

Full UI access through the orchestrator with intelligent URL rewriting:

1. **HTML rewriting** - Rewrites `src`, `href`, `action` attributes; injects fetch() patch and auto-auth scripts
2. **JavaScript rewriting** - Rewrites known URL prefixes while preserving regex patterns
3. **Binary content handling** - Properly handles binary responses with base64 encoding
4. **Service Worker** - Accepts `proxyBase` parameter to normalize cache keys for PWA support

### Auto-Authentication Flow

1. User authenticates with orchestrator via GitHub OAuth
2. Orchestrator proxies HTTP request with `X-Orchestrator-User-Id` and `X-Orchestrator-Username` headers
3. Claude Code UI generates JWT for orchestrator user (creating user in database if needed)
4. Token injected into HTML response and stored in localStorage
5. React app initializes with valid authentication

### Real-time Status Tracking

The status tracker monitors and reports to the orchestrator:

| Status   | Description                       |
| -------- | --------------------------------- |
| `idle`   | No active browser connections     |
| `active` | Browser connected, not generating |
| `busy`   | Claude is generating a response   |

Status changes are reported in real-time, allowing the orchestrator dashboard to display current activity across all connected instances.

## Message Protocol

### Outbound Messages (claudecodeui → Orchestrator)

| Type                  | Description                        |
| --------------------- | ---------------------------------- |
| `register`            | Initial registration with metadata |
| `status_update`       | Status changes (idle/active/busy)  |
| `ping`                | Heartbeat                          |
| `http_proxy_response` | Response to proxied HTTP request   |

### Inbound Messages (Orchestrator → claudecodeui)

| Type                 | Description                           |
| -------------------- | ------------------------------------- |
| `registered`         | Registration confirmation             |
| `pong`               | Heartbeat response                    |
| `command`            | Commands (disconnect, refresh_status) |
| `http_proxy_request` | Proxied HTTP request                  |

## File Structure

The orchestrator module is located in `server/orchestrator/`:

| File                | Purpose                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `index.js`          | Main module - exports all components, provides `initializeOrchestrator()` factory                  |
| `client.js`         | `OrchestratorClient` class - WebSocket client with auto-reconnect, heartbeats, HTTP proxy handling |
| `protocol.js`       | Message protocol definitions for communication                                                     |
| `github-auth.js`    | GitHub OAuth validation for pass-through authentication                                            |
| `status-tracker.js` | Tracks Claude session status and reports changes                                                   |
| `proxy.js`          | WebSocket proxy utilities for handling user requests                                               |

## Setup Guide

### Prerequisites

1. A running [Duratii](https://github.com/Epiphytic/duratii) orchestrator server
2. A connection token from the orchestrator dashboard
3. Claude Code UI instance

### Steps

1. **Deploy the orchestrator server**

   Follow the setup instructions at [github.com/Epiphytic/duratii](https://github.com/Epiphytic/duratii)

2. **Generate a connection token**

   From the orchestrator dashboard, create a new connection token for your Claude Code UI instance

3. **Configure your Claude Code UI instance**

   Add the required environment variables to your `.env` file:

   ```bash
   ORCHESTRATOR_MODE=client
   ORCHESTRATOR_URL=wss://your-orchestrator.example.com/ws/connect
   ORCHESTRATOR_TOKEN=your-generated-token
   ```

4. **Restart Claude Code UI**

   The instance will automatically connect to the orchestrator on startup

5. **Verify connection**

   Check the server logs for:

   ```
   [ORCHESTRATOR] Connected to orchestrator
   [ORCHESTRATOR] Successfully connected and registered
   ```

## Troubleshooting

### Connection Issues

**Problem**: Instance fails to connect to orchestrator

**Solutions**:

- Verify `ORCHESTRATOR_URL` is correct and accessible
- Check that the token is valid and not expired
- Ensure the orchestrator server is running
- Check firewall rules allow WebSocket connections

### Authentication Issues

**Problem**: Users cannot authenticate through orchestrator proxy

**Solutions**:

- Verify GitHub OAuth is configured on the orchestrator
- Check `ORCHESTRATOR_GITHUB_*` environment variables match your access requirements
- Ensure the user is a member of the required org/team

### Status Not Updating

**Problem**: Instance status not appearing in orchestrator dashboard

**Solutions**:

- Check WebSocket connection is established
- Verify heartbeat messages are being sent (check server logs)
- Ensure no network issues are causing message drops

## Security Considerations

- Tokens are stored securely and never logged in full
- GitHub OAuth provides enterprise-grade authentication
- Access can be restricted to specific orgs, teams, or users
- All communication uses encrypted WebSocket connections (WSS)
- Sensitive auth logging is gated behind `AUTH_DEBUG` environment variable

## Related Projects

- **[Duratii](https://github.com/Epiphytic/duratii)** - Orchestrator server for managing multiple Claude Code UI instances
