# feat: Add Orchestrator Client Mode for Remote Access via Central Hub

## Summary

This PR adds orchestrator client mode to claudecodeui, enabling instances to connect to a central orchestrator server for remote access and management. Users can now access their Claude Code UI instances from anywhere through a unified web interface, with automatic authentication pass-through and real-time status reporting.

## Motivation

When running Claude Code UI on multiple machines (development servers, remote workstations, etc.), users need a way to:

- Access all instances from a single dashboard
- Authenticate once at the orchestrator level
- View real-time status (idle/active/busy) of each instance
- Use the full web interface through a reverse proxy

## Key Features

- **WebSocket-based orchestrator connection** with automatic reconnection and heartbeats
- **HTTP proxy support** allowing full UI access through the orchestrator
- **Auto-authentication pass-through** from orchestrator's GitHub OAuth to local instances
- **Real-time status tracking** (idle → active → busy) reported to orchestrator
- **PWA support through proxy** with service worker URL normalization
- **Graceful degradation** - runs standalone if orchestrator is unavailable

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

## Files Changed

### New Files: `server/orchestrator/`

| File                | Purpose                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.js`          | Main orchestrator module - exports all components, provides `initializeOrchestrator()` factory function                                      |
| `client.js`         | `OrchestratorClient` class - WebSocket client with auto-reconnect, heartbeats, HTTP proxy handling, URL rewriting                            |
| `protocol.js`       | Message protocol definitions for claudecodeui ↔ orchestrator communication (register, status_update, ping/pong, http_proxy_request/response) |
| `github-auth.js`    | GitHub OAuth validation for pass-through authentication (org/team/user restrictions)                                                         |
| `status-tracker.js` | Tracks Claude session status (idle/active/busy) and reports changes to orchestrator                                                          |
| `proxy.js`          | WebSocket proxy utilities for handling user requests routed through orchestrator                                                             |

### Modified Files

| File                        | Changes                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `server/cli.js`             | Added orchestrator initialization on server startup; environment variable handling for orchestrator config              |
| `server/middleware/auth.js` | Added debug logging for JWT verification; supports orchestrator-generated tokens                                        |
| `server/database/db.js`     | Added `getOrCreateUser()` for auto-creating users from orchestrator OAuth; bcrypt import for password handling          |
| `public/sw.js`              | Added `proxyBase` query parameter support for PWA through proxy; URL normalization for cache keys                       |
| `src/App.jsx`               | Added dynamic React Router `basename` detection for proxy access; ensures routing works at `/clients/{id}/proxy/` paths |
| `.env.example`              | Added orchestrator configuration documentation (ORCHESTRATOR_MODE, URL, TOKEN, etc.)                                    |

## Configuration

### Environment Variables

```bash
# Orchestrator mode: 'standalone' (default) or 'client'
ORCHESTRATOR_MODE=client

# Orchestrator WebSocket URL
ORCHESTRATOR_URL=wss://orchestrator.example.com/ws/connect

# Authentication token from orchestrator dashboard
ORCHESTRATOR_TOKEN=your-token-here

# Optional: Custom client ID (defaults to hostname-pid)
ORCHESTRATOR_CLIENT_ID=my-dev-machine

# Optional: Reconnection/heartbeat intervals (ms)
ORCHESTRATOR_RECONNECT_INTERVAL=5000
ORCHESTRATOR_HEARTBEAT_INTERVAL=30000

# Pass-through auth: restrict which GitHub users can access
ORCHESTRATOR_GITHUB_ORG=your-org
ORCHESTRATOR_GITHUB_TEAM=your-org/your-team
ORCHESTRATOR_GITHUB_USERS=user1,user2
```

## Technical Details

### HTTP Proxy URL Rewriting

When requests come through the orchestrator proxy (`/clients/{id}/proxy/*`), the client performs URL rewriting to ensure the React app works correctly:

1. **HTML rewriting** (`rewriteHtmlUrls`):
   - Rewrites `src="/..."`, `href="/..."`, `action="/..."` attributes
   - Injects `fetch()` patch script to redirect API calls through proxy
   - Injects auto-authentication script with orchestrator-generated JWT
   - Adds service worker registration with `proxyBase` query parameter

2. **JavaScript rewriting** (`rewriteJsUrls`):
   - Rewrites string literals for known URL prefixes (api, assets, auth, ws, etc.)
   - Preserves regex patterns to avoid breaking code

3. **Service Worker** (`sw.js`):
   - Accepts `proxyBase` parameter to normalize cache keys
   - Handles both direct and proxied access transparently

### Auto-Authentication Flow

1. User authenticates with orchestrator via GitHub OAuth
2. Orchestrator proxies HTTP request to claudecodeui with `X-Orchestrator-User-Id` and `X-Orchestrator-Username` headers
3. `OrchestratorClient.handleHttpProxyRequest()` calls `getOrCreateOrchestratorToken()`
4. Token is generated for the orchestrator user (creating user in DB if needed)
5. HTML response includes injected `<script>` that stores token in localStorage
6. React app initializes with valid authentication

### Status Tracking

The `StatusTracker` monitors:

- Active WebSocket connections (browser tabs)
- Busy sessions (Claude generating responses)

Status values:

- `idle`: No active connections
- `active`: Browser connected, not generating
- `busy`: Claude is generating a response

### Message Protocol

**Outbound (claudecodeui → Orchestrator):**

- `register`: Initial registration with metadata
- `status_update`: Status changes (idle/active/busy)
- `ping`: Heartbeat
- `http_proxy_response`: Response to proxied HTTP request

**Inbound (Orchestrator → claudecodeui):**

- `registered`: Registration confirmation
- `pong`: Heartbeat response
- `command`: Commands (disconnect, refresh_status)
- `http_proxy_request`: Proxied HTTP request

## Testing

1. **Standalone mode** (default): No changes to existing behavior
2. **Client mode**:
   - Set `ORCHESTRATOR_MODE=client` with URL and token
   - Verify WebSocket connection to orchestrator
   - Access UI through orchestrator proxy URL
   - Verify auto-authentication works
   - Verify status updates appear in orchestrator dashboard

## Breaking Changes

None - orchestrator mode is opt-in via environment variables.

## Migration Guide

Existing installations continue to work in standalone mode. To enable orchestrator mode:

1. Deploy an orchestrator server (see ai-orchestrator repo)
2. Generate a connection token from the orchestrator dashboard
3. Add environment variables to your claudecodeui instance
4. Restart claudecodeui - it will automatically connect

---

Generated with [Claude Code](https://claude.com/code)
